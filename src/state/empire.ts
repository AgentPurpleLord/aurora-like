/**
 * The player's empire: its colonies, its officers, its research and its
 * treasury, plus the actions the UI can take against them.
 *
 * The per-cycle economic simulation itself lives in sim/economy/production.
 */

import { OfficerPool, type Assignment, type Branch, type Officer } from "../sim/people/officers";
import { Random } from "../sim/rng";
import { TECH_BY_ID, statsFor, type EmpireStats } from "../sim/research/techs";
import type { MineralName } from "../sim/minerals";
import { createColony, type Colony } from "./colony";
import type { StandingOrder } from "../sim/economy/standingOrders";
import { BUILT_IN_TEMPLATES, type BuildTemplate } from "../sim/economy/templates";

export type LogCategory = "research" | "construction" | "people" | "colony" | "economy";

export interface LogEntry {
  time: number;
  category: LogCategory;
  text: string;
}

export interface ResearchProject {
  id: string;
  techId: string;
  /** Body id of the colony whose laboratories are working the project. */
  colonyId: string;
  scientistId: string | null;
  /** Labs the player has assigned. */
  labs: number;
  /** Research points accumulated. */
  progress: number;
  started: number;
  /** Annualised RP from the last cycle, for the UI. */
  lastRate: number;
}

/** Annualised figures from the most recent production cycle, for display. */
export interface EmpireSnapshot {
  income: number;
  expenses: number;
  buildPoints: number;
  researchPoints: number;
  minerals: Partial<Record<MineralName, number>>;
  fuel: number;
  population: number;
}

export function emptySnapshot(): EmpireSnapshot {
  return {
    income: 0, expenses: 0, buildPoints: 0, researchPoints: 0,
    minerals: {}, fuel: 0, population: 0,
  };
}

/** State captured the last time the player reviewed the empire dashboard. */
export interface ReviewMark {
  time: number;
  treasury: number;
  population: number;
  techs: number;
}

export class Empire {
  readonly name = "Terran Federation";
  readonly colonies = new Map<string, Colony>();
  readonly officers: OfficerPool;
  readonly researched = new Set<string>();
  readonly log: LogEntry[] = [];
  projects: ResearchProject[] = [];
  treasury = 0;
  stats: EmpireStats;
  snapshot = emptySnapshot();
  /** Body id of the capital - the default destination for mass drivers. */
  capital = "earth";
  /** Set when the treasury is in deficit; halves industrial output. */
  austerity = false;
  /** Issue id -> simulation time at which the dismissal lapses. */
  readonly dismissed = new Map<string, number>();
  /** Rules that top colonies up without being asked each time. */
  standingOrders: StandingOrder[] = [];
  /** Templates the player has saved, on top of the built-in ones. */
  customTemplates: BuildTemplate[] = [];
  reviewMark: ReviewMark = { time: 0, treasury: 0, population: 0, techs: 0 };

  private nextProjectId = 1;
  private nextOrderId = 1;
  private nextRuleId = 1;

  constructor(readonly rng: Random = new Random("empire")) {
    this.officers = new OfficerPool(rng);
    this.stats = statsFor(this.researched);
  }

  // ------------------------------------------------------------- research

  research(techId: string): void {
    this.researched.add(techId);
    this.stats = statsFor(this.researched);
  }

  startProject(techId: string, colonyId: string, scientistId: string | null, labs: number): ResearchProject {
    const project: ResearchProject = {
      id: `proj-${this.nextProjectId++}`,
      techId,
      colonyId,
      scientistId,
      labs,
      progress: 0,
      started: 0,
      lastRate: 0,
    };
    this.projects.push(project);
    if (scientistId) {
      this.officers.assign(scientistId, { kind: "research", targetId: project.id, since: 0 });
    }
    return project;
  }

  cancelProject(projectId: string): void {
    this.projects = this.projects.filter((p) => p.id !== projectId);
    this.officers.unassignTarget("research", projectId);
  }

  /** Labs already committed on a colony, optionally ignoring one project. */
  labsInUse(colonyId: string, exceptProjectId?: string): number {
    return this.projects
      .filter((p) => p.colonyId === colonyId && p.id !== exceptProjectId)
      .reduce((sum, p) => sum + p.labs, 0);
  }

  // -------------------------------------------------------------- colonies

  colony(bodyId: string): Colony | undefined {
    return this.colonies.get(bodyId);
  }

  foundColony(bodyId: string, now: number): Colony {
    const colony = createColony(bodyId, now);
    colony.massDriverTarget = bodyId === this.capital ? null : this.capital;
    this.colonies.set(bodyId, colony);
    return colony;
  }

  abandonColony(bodyId: string): void {
    this.colonies.delete(bodyId);
    this.officers.unassignTarget("governor", bodyId);
    this.projects = this.projects.filter((p) => {
      if (p.colonyId !== bodyId) return true;
      this.officers.unassignTarget("research", p.id);
      return false;
    });
    for (const colony of this.colonies.values()) {
      if (colony.massDriverTarget === bodyId) colony.massDriverTarget = null;
    }
    this.standingOrders = this.standingOrders.filter(
      (o) => o.colonyId !== bodyId && o.sourceId !== bodyId,
    );
  }

  // ----------------------------------------------------------- build queue

  queueBuild(
    bodyId: string,
    installationId: string,
    quantity: number,
    destination: string | null = null,
    auto = false,
  ): void {
    const colony = this.colonies.get(bodyId);
    if (!colony || quantity <= 0) return;
    const target = destination === bodyId ? null : destination;
    const existing = colony.buildQueue.find(
      (o) => o.installationId === installationId && o.destination === target,
    );
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    colony.buildQueue.push({
      id: `ord-${this.nextOrderId++}`,
      installationId,
      quantity,
      destination: target,
      progress: 0,
      starved: false,
      auto,
    });
  }

  cancelOrder(bodyId: string, orderId: string): void {
    const colony = this.colonies.get(bodyId);
    if (!colony) return;
    colony.buildQueue = colony.buildQueue.filter((o) => o.id !== orderId);
  }

  moveOrder(bodyId: string, orderId: string, delta: number): void {
    const colony = this.colonies.get(bodyId);
    if (!colony) return;
    const index = colony.buildQueue.findIndex((o) => o.id === orderId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= colony.buildQueue.length) return;
    const [order] = colony.buildQueue.splice(index, 1);
    colony.buildQueue.splice(target, 0, order);
  }

  addStandingOrder(order: Omit<StandingOrder, "id">): StandingOrder {
    const stored: StandingOrder = { ...order, id: `rule-${this.nextRuleId++}` };
    this.standingOrders.push(stored);
    return stored;
  }

  removeStandingOrder(id: string): void {
    this.standingOrders = this.standingOrders.filter((o) => o.id !== id);
  }

  standingOrdersFor(colonyId: string): StandingOrder[] {
    return this.standingOrders.filter((o) => o.colonyId === colonyId);
  }

  get templates(): BuildTemplate[] {
    return [...BUILT_IN_TEMPLATES, ...this.customTemplates];
  }

  saveTemplate(template: BuildTemplate): void {
    this.customTemplates = this.customTemplates.filter((t) => t.id !== template.id);
    this.customTemplates.push(template);
  }

  deleteTemplate(id: string): void {
    this.customTemplates = this.customTemplates.filter((t) => t.id !== id);
  }

  // -------------------------------------------------------------- officers

  assignOfficer(officerId: string, assignment: Assignment | null): void {
    this.officers.assign(officerId, assignment);
  }

  governorOf(bodyId: string): Officer | undefined {
    return this.officers.holderOf("governor", bodyId);
  }

  scientistOf(projectId: string): Officer | undefined {
    return this.officers.holderOf("research", projectId);
  }

  seedOfficers(counts: Record<Branch, number>, now: number): void {
    this.officers.seed(counts, now);
  }

  // ------------------------------------------------------------------- log

  addLog(time: number, category: LogCategory, text: string): void {
    this.log.unshift({ time, category, text });
    if (this.log.length > 400) this.log.length = 400;
  }

  /** Hide an issue for a while; it returns if the condition persists. */
  dismissIssue(issueId: string, now: number, years = 2): void {
    this.dismissed.set(issueId, now + years * 365.25 * 86400);
  }

  /** Record the empire's state as "seen", for the what-changed summary. */
  markReviewed(now: number): void {
    this.reviewMark = {
      time: now,
      treasury: this.treasury,
      population: [...this.colonies.values()].reduce((sum, c) => sum + c.population, 0),
      techs: this.researched.size,
    };
  }

  techName(techId: string): string {
    return TECH_BY_ID.get(techId)?.name ?? techId;
  }
}
