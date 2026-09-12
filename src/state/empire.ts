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

  private nextProjectId = 1;
  private nextOrderId = 1;

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
  }

  // ----------------------------------------------------------- build queue

  queueBuild(
    bodyId: string,
    installationId: string,
    quantity: number,
    destination: string | null = null,
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

  techName(techId: string): string {
    return TECH_BY_ID.get(techId)?.name ?? techId;
  }
}
