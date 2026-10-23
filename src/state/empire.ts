/**
 * The player's empire: its colonies, its officers, its research and its
 * treasury, plus the actions the UI can take against them.
 *
 * The per-cycle economic simulation itself lives in sim/economy/production.
 */

import { defaultPolitics, politicalFactors, type PoliticsState } from "../sim/politics";
import { OfficerPool, type Assignment, type Branch, type Officer } from "../sim/people/officers";
import { Random } from "../sim/rng";
import { TECH_BY_ID, statsFor, type EmpireStats } from "../sim/research/techs";
import type { MineralName } from "../sim/minerals";
import { createColony, type Colony } from "./colony";
import type { StandingOrder } from "../sim/economy/standingOrders";
import type { Vec3 } from "../sim/orbit";
import { INSTALLATION_BY_ID, SHIP_ORDER } from "../sim/economy/installations";
import {
  designStats,
  type DesignComponent,
  type DesignStats,
  type ResolvedComponent,
  type ShipDesign,
} from "../sim/ships/design";
import {
  ENGINE_TYPES,
  SENSOR_TYPES,
  componentStats,
  defaultParams,
  suggestName,
  type ComponentDesign,
  type ComponentKind,
  type ParamSet,
} from "../sim/ships/components";
import { emptyCargo, type Fleet, type Ship } from "../sim/ships/fleet";
import type { GameEvent } from "../sim/events/types";
import { BUILT_IN_TEMPLATES, type BuildTemplate } from "../sim/economy/templates";

export type LogCategory = "research" | "construction" | "people" | "colony" | "economy" | "fleet" | "event";

/** Where an event can take you, so a notification is a doorway, not a dead end. */
export interface LogLink {
  view: "empire" | "map" | "galaxy" | "events" | "politics" | "colonies" | "fleets" | "design" | "research" | "officers";
  bodyId?: string;
  fleetId?: string;
  techId?: string;
}

export interface LogEntry {
  /** Monotonic, so a reader can ask "what is new since I last looked". */
  seq: number;
  time: number;
  category: LogCategory;
  text: string;
  link?: LogLink;
  /**
   * Routine business of an automated fleet: kept in the log, but it neither
   * stops the clock nor raises a toast, or a freight line would never let go.
   */
  quiet?: boolean;
  /** Something is waiting on the player: always stops the clock. */
  decision?: boolean;
}

/** Categories worth interrupting the player for. */
export const IMPORTANT_CATEGORIES: readonly LogCategory[] = [
  "research", "construction", "fleet", "colony", "economy",
];

/** One sampled point of the empire's vital signs, for trend lines. */
export interface HistoryPoint {
  time: number;
  treasury: number;
  population: number;
  researchPoints: number;
  buildPoints: number;
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
  /** Newest log entry that had been seen. */
  seq: number;
  treasury: number;
  population: number;
  techs: number;
  colonies: number;
  ships: number;
}

/** What a timed effect changes. */
export type EffectKind = "industry" | "mining" | "fuel" | "research" | "wealth" | "growth" | "stability";

/**
 * A lasting change, applied as a multiplier for a while: a work-to-rule at one
 * colony, a credit squeeze across the empire. Output is always computed from
 * these, so ending one needs no undoing.
 */
export interface ActiveEffect {
  id: string;
  kind: EffectKind;
  /** A colony's body id, or "empire" for all of them. */
  target: string;
  factor: number;
  started: number;
  until: number;
  label: string;
  /** The event that caused it, for the log. */
  source?: string;
}

/** An event waiting its turn: the next link in a chain. */
export interface ScheduledEvent {
  id: string;
  defId: string;
  params: Record<string, string | number>;
  due: number;
  /** Title of the event this follows, to tell the player why it has happened. */
  follows?: string;
}

/** The saved form of an empire: plain data, safe to pass through JSON. */
export interface EmpireState {
  researched: string[];
  log: LogEntry[];
  logSeq: number;
  history: HistoryPoint[];
  projects: ResearchProject[];
  treasury: number;
  snapshot: EmpireSnapshot;
  capital: string;
  austerity: boolean;
  taxRate?: number;
  welfare?: number;
  politics?: PoliticsState;
  politicsRng?: number;
  dismissed: [string, number][];
  standingOrders: StandingOrder[];
  componentDesigns: ComponentDesign[];
  designs: ShipDesign[];
  ships: Ship[];
  fleets: Fleet[];
  surveyed: string[];
  knownSystems?: string[];
  knownJumpPoints?: string[];
  exploredJumpPoints?: string[];
  gates?: string[];
  gravProgress?: Record<string, number>;
  civilianShipping: boolean;
  lastTick: number;
  events?: GameEvent[];
  effects?: ActiveEffect[];
  scheduled?: ScheduledEvent[];
  eventFrequency?: number;
  eventRng?: number;
  lastEventTime?: number;
  nextEventId?: number;
  customTemplates: BuildTemplate[];
  reviewMark: ReviewMark;
  colonies: Colony[];
  officers: { officers: Officer[]; nextId: number };
  rng: number;
  counters: Record<"project" | "order" | "rule" | "design" | "ship" | "fleet" | "component", number>;
}

export class Empire {
  readonly name = "Terran Federation";
  readonly colonies = new Map<string, Colony>();
  readonly officers: OfficerPool;
  readonly researched = new Set<string>();
  readonly log: LogEntry[] = [];
  /** Sequence number of the newest log entry. */
  logSeq = 0;
  readonly history: HistoryPoint[] = [];
  projects: ResearchProject[] = [];
  treasury = 0;
  stats: EmpireStats;
  snapshot = emptySnapshot();
  /** Body id of the capital - the default destination for mass drivers. */
  capital = "earth";
  /** Set when the treasury is in deficit; halves industrial output. */
  austerity = false;
  /** Share of taxable output the government takes. 0.3 is neutral. */
  taxRate = 0.3;
  /** Share of tax revenue spent on public welfare, which buys stability. */
  welfare = 0;
  /** Factions, laws, capital and the election clock. */
  politics: PoliticsState = defaultPolitics();
  readonly politicsRng = new Random("politics");
  /** What politics currently does to each kind of output; see refreshPolitics. */
  private politicsFactors = politicalFactors(defaultPolitics(), 0);
  /** Issue id -> simulation time at which the dismissal lapses. */
  readonly dismissed = new Map<string, number>();
  /** Rules that top colonies up without being asked each time. */
  standingOrders: StandingOrder[] = [];
  /** Component designs: the library ship classes are assembled from. */
  componentDesigns: ComponentDesign[] = [];
  /** Ship classes the empire has designed. */
  designs: ShipDesign[] = [];
  readonly ships = new Map<string, Ship>();
  readonly fleets = new Map<string, Fleet>();
  /** Bodies whose mineral deposits are known. */
  readonly surveyed = new Set<string>();
  /** Systems the empire has been to. Only these show their planets. */
  readonly knownSystems = new Set<string>(["sol"]);
  /** Jump points a gravitational survey has located. */
  readonly knownJumpPoints = new Set<string>();
  /** Jump points a ship has actually gone through, and so knows the far end of. */
  readonly exploredJumpPoints = new Set<string>();
  /** Jump points with a stabilised gate. Both ends of a connection are listed. */
  readonly gates = new Set<string>();
  /** Gravitational survey points banked, by system, towards the next jump point. */
  gravProgress: Record<string, number> = {};
  /**
   * Civilian shipping stands in for freighters: installations built for
   * another colony arrive there by themselves and colonists migrate on their
   * own. Turn it off to run logistics entirely on ships you have built.
   */
  civilianShipping = true;
  /** Timed effects currently in force. */
  effects: ActiveEffect[] = [];
  /** Follow-up events waiting for their time. */
  scheduled: ScheduledEvent[] = [];
  private nextEffectId = 1;
  /** Random events so far, newest first. */
  events: GameEvent[] = [];
  /** How often events happen: 0 is off, 1 is normal, 0.4 rare, 2.5 often. */
  eventFrequency = 0;
  /** Events draw from their own stream so they never disturb anything else. */
  readonly eventRng = new Random("events");
  /** Simulation time of the last event, to keep them from clustering. */
  lastEventTime = 0;
  private nextEventId = 1;
  /** Current simulation time, so sim code can timestamp its own log lines. */
  lastTick = 0;
  /** Templates the player has saved, on top of the built-in ones. */
  customTemplates: BuildTemplate[] = [];
  reviewMark: ReviewMark = { time: 0, seq: 0, treasury: 0, population: 0, techs: 0, colonies: 0, ships: 0 };

  private nextProjectId = 1;
  private nextOrderId = 1;
  private nextRuleId = 1;
  private nextDesignId = 1;
  private nextShipId = 1;
  private nextFleetId = 1;
  /**
   * Bumped whenever research or a class changes. Derived ship figures are
   * cached against it, because they are read once per ship per frame and
   * recomputing them is the single hottest thing the simulation does.
   */
  revision = 0;
  private readonly designIndex = new Map<string, ShipDesign>();
  private readonly componentIndex = new Map<string, ComponentDesign>();
  private readonly componentCache = new Map<string, { revision: number; resolved: ResolvedComponent }>();
  private nextComponentId = 1;
  private readonly designStatsCache = new Map<string, { revision: number; stats: DesignStats }>();

  constructor(readonly rng: Random = new Random("empire")) {
    this.officers = new OfficerPool(rng);
    this.stats = statsFor(this.researched);
  }

  // ------------------------------------------------------------- research

  research(techId: string): void {
    this.researched.add(techId);
    this.stats = statsFor(this.researched);
    this.revision++;
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
    designId: string | null = null,
  ): void {
    const colony = this.colonies.get(bodyId);
    if (!colony || quantity <= 0) return;
    const target = destination === bodyId ? null : destination;
    const existing = colony.buildQueue.find(
      (o) =>
        o.installationId === installationId &&
        o.destination === target &&
        o.designId === designId,
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
      designId,
    });
  }

  /** Lay down hulls of a class at a colony with a shipyard. */
  queueShip(bodyId: string, designId: string, quantity: number): void {
    this.queueBuild(bodyId, SHIP_ORDER, quantity, null, false, designId);
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

  // ----------------------------------------------------------------- ships

  addDesign(name: string, components: DesignComponent[], now: number, hullId?: string): ShipDesign {
    const design: ShipDesign = {
      id: `design-${this.nextDesignId++}`,
      name,
      components,
      created: now,
    };
    if (hullId) design.hullId = hullId;
    this.designs.push(design);
    this.designIndex.set(design.id, design);
    this.revision++;
    return design;
  }

  design(id: string | null | undefined): ShipDesign | undefined {
    return id ? this.designIndex.get(id) : undefined;
  }

  /** A class is superseded rather than deleted while ships still fly it. */
  setDesignObsolete(id: string, obsolete: boolean): void {
    const design = this.designIndex.get(id);
    if (design) design.obsolete = obsolete;
  }

  /** Rename or re-equip a class, invalidating everything derived from it. */
  updateDesign(id: string, name: string, components: DesignComponent[], hullId?: string): void {
    const design = this.designIndex.get(id);
    if (!design) return;
    design.name = name;
    if (hullId) design.hullId = hullId;
    else delete design.hullId;
    design.components = components;
    this.revision++;
  }

  /**
   * Derived figures for a class, cached until research or the class itself
   * changes. Called for every ship on every frame.
   */
  statsOf(designId: string | null | undefined): DesignStats | undefined {
    const design = this.design(designId);
    if (!design) return undefined;
    const cached = this.designStatsCache.get(design.id);
    if (cached && cached.revision === this.revision) return cached.stats;
    const stats = designStats(design, this.resolveComponent);
    this.designStatsCache.set(design.id, { revision: this.revision, stats });
    return stats;
  }

  /** Component design and figures, cached until research or the library changes. */
  readonly resolveComponent = (id: string): ResolvedComponent | undefined => {
    const design = this.componentIndex.get(id);
    if (!design) return undefined;
    const cached = this.componentCache.get(id);
    if (cached && cached.revision === this.revision) return cached.resolved;
    const resolved = { design, stats: componentStats(design.kind, design.params, this.researched) };
    this.componentCache.set(id, { revision: this.revision, resolved });
    return resolved;
  };

  // ------------------------------------------------------ component library

  component(id: string | null | undefined): ComponentDesign | undefined {
    return id ? this.componentIndex.get(id) : undefined;
  }

  addComponentDesign(
    kind: ComponentKind,
    params: ParamSet,
    now: number,
    name?: string,
  ): ComponentDesign {
    const normal = { ...defaultParams(kind, this.researched), ...params };
    const design: ComponentDesign = {
      id: `comp-${this.nextComponentId++}`,
      name: name?.trim() || suggestName(kind, normal, this.researched),
      kind,
      params: normal,
      created: now,
    };
    this.componentDesigns.push(design);
    this.componentIndex.set(design.id, design);
    this.revision++;
    return design;
  }

  /** Classes that use a component, so it is not edited out from under them. */
  componentUsers(id: string): ShipDesign[] {
    return this.designs.filter((d) => d.components.some((c) => c.componentId === id && c.count > 0));
  }

  updateComponentDesign(id: string, name: string, params: ParamSet): boolean {
    const design = this.componentIndex.get(id);
    // A component already built into a class is superseded, never rewritten.
    if (!design || this.componentUsers(id).length) return false;
    design.name = name.trim() || design.name;
    design.params = { ...params };
    this.revision++;
    return true;
  }

  setComponentObsolete(id: string, obsolete: boolean): void {
    const design = this.componentIndex.get(id);
    if (!design) return;
    design.obsolete = obsolete;
  }

  removeComponentDesign(id: string): boolean {
    if (this.componentUsers(id).length) return false;
    this.componentDesigns = this.componentDesigns.filter((c) => c.id !== id);
    this.componentIndex.delete(id);
    this.componentCache.delete(id);
    this.revision++;
    return true;
  }

  /**
   * The workhorse set for whatever has been researched: one of each kind
   * sized for a general-purpose ship. Names are kept, so asking twice adds
   * nothing.
   */
  addStandardComponents(now: number): ComponentDesign[] {
    const made: ComponentDesign[] = [];
    const want: [ComponentKind, ParamSet][] = [];
    const engine = [...ENGINE_TYPES].reverse().find((e) => this.researched.has(e.tech));
    if (engine) want.push(["engine", { type: engine.id, size: 5, modifier: 1 }]);
    if (this.researched.has("trans-newtonian")) {
      want.push(
        ["fuel-tank", { size: 5 }],
        ["crew-quarters", { size: 2 }],
        ["cargo-hold", { size: 20 }],
        ["colony-module", { size: 20 }],
      );
    }
    const sensor = SENSOR_TYPES.find((s) => this.researched.has(s.tech));
    if (sensor) want.push(["survey-sensor", { type: sensor.id, size: 4 }]);

    for (const [kind, params] of want) {
      const name = suggestName(kind, params, this.researched);
      if (this.componentDesigns.some((c) => c.name === name)) continue;
      made.push(this.addComponentDesign(kind, params, now, name));
    }
    return made;
  }

  /** Hauler, Pioneer and Surveyor, assembled from the standard components. */
  addStandardClasses(now: number): ShipDesign[] {
    this.addStandardComponents(now);

    // Always the standard parts, never whatever was designed most recently.
    const standard = (kind: ComponentKind, params: ParamSet) => {
      const name = suggestName(kind, params, this.researched);
      return this.componentDesigns.find((c) => c.kind === kind && c.name === name);
    };
    const engineType = [...ENGINE_TYPES].reverse().find((e) => this.researched.has(e.tech));
    const sensorType = SENSOR_TYPES.find((s) => this.researched.has(s.tech));
    const engine = engineType && standard("engine", { type: engineType.id, size: 5, modifier: 1 });
    const tank = standard("fuel-tank", { size: 5 });
    const quarters = standard("crew-quarters", { size: 2 });
    if (!engine || !tank || !quarters) return [];

    const cargo = standard("cargo-hold", { size: 20 });
    const colony = standard("colony-module", { size: 20 });
    const sensor = sensorType && standard("survey-sensor", { type: sensorType.id, size: 4 });
    const specs: [string, string, DesignComponent[] | null | undefined][] = [
      ["Hauler", "freighter", cargo && [
        { componentId: engine.id, count: 2 }, { componentId: tank.id, count: 4 },
        { componentId: cargo.id, count: 4 }, { componentId: quarters.id, count: 2 },
      ]],
      ["Pioneer", "colony-ship", colony && [
        { componentId: engine.id, count: 2 }, { componentId: tank.id, count: 4 },
        { componentId: colony.id, count: 4 }, { componentId: quarters.id, count: 2 },
      ]],
      ["Surveyor", "survey-ship", sensor && [
        { componentId: engine.id, count: 1 }, { componentId: tank.id, count: 3 },
        { componentId: sensor.id, count: 1 }, { componentId: quarters.id, count: 1 },
      ]],
    ];
    const made: ShipDesign[] = [];
    for (const [name, hullId, components] of specs) {
      if (!components || this.designs.some((d) => d.name === name)) continue;
      made.push(this.addDesign(name, components, now, hullId));
    }
    return made;
  }

  removeDesign(id: string): void {
    // Keep a class that something is still flying or building.
    const inUse =
      [...this.ships.values()].some((s) => s.designId === id) ||
      [...this.colonies.values()].some((c) => c.buildQueue.some((o) => o.designId === id));
    if (inUse) return;
    this.designs = this.designs.filter((d) => d.id !== id);
    this.designIndex.delete(id);
    this.designStatsCache.delete(id);
    this.revision++;
  }

  createFleet(name: string, position: Vec3, anchorId: string | null, systemId = "sol"): Fleet {
    const fleet: Fleet = {
      id: `fleet-${this.nextFleetId++}`,
      systemId,
      gateProgress: 0,
      name,
      shipIds: [],
      position: { ...position },
      anchorId,
      orders: [],
      surveyProgress: 0,
      cargo: emptyCargo(),
      commanderId: null,
      note: null,
      loop: false,
      program: null,
      waitUntil: 0,
      programStatus: null,
    };
    this.fleets.set(fleet.id, fleet);
    return fleet;
  }

  /** Commission a hull into a fleet, fuelled from the colony that built it. */
  commissionShip(designId: string, fleet: Fleet, name: string, now: number): Ship {
    const ship: Ship = {
      id: `ship-${this.nextShipId++}`,
      name,
      designId,
      fleetId: fleet.id,
      fuel: 0,
      built: now,
      condition: 100,
    };
    this.ships.set(ship.id, ship);
    fleet.shipIds.push(ship.id);
    return ship;
  }

  disbandFleet(id: string): void {
    const fleet = this.fleets.get(id);
    if (!fleet || fleet.shipIds.length) return;
    this.officers.unassignTarget("fleet", id);
    this.fleets.delete(id);
  }

  /** Move every ship from one fleet into another, then retire the empty one. */
  mergeFleets(fromId: string, intoId: string): void {
    const from = this.fleets.get(fromId);
    const into = this.fleets.get(intoId);
    if (!from || !into || from === into) return;
    for (const shipId of from.shipIds) {
      const ship = this.ships.get(shipId);
      if (ship) ship.fleetId = into.id;
      into.shipIds.push(shipId);
    }
    from.shipIds = [];
    this.disbandFleet(from.id);
  }

  fleetOf(shipId: string): Fleet | undefined {
    const ship = this.ships.get(shipId);
    return ship ? this.fleets.get(ship.fleetId) : undefined;
  }

  /** What a queued order is building, whether a building or a hull. */
  buildableOf(order: { installationId: string; designId: string | null }):
    | { name: string; cost: number; minerals: Partial<Record<MineralName, number>>; isShip: boolean }
    | undefined {
    if (order.designId) {
      const design = this.design(order.designId);
      const stats = this.statsOf(order.designId);
      if (!design || !stats) return undefined;
      return { name: design.name, cost: stats.buildCost, minerals: stats.minerals, isShip: true };
    }
    const type = INSTALLATION_BY_ID.get(order.installationId);
    if (!type) return undefined;
    return { name: type.name, cost: type.cost, minerals: type.minerals, isShip: false };
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

  addLog(time: number, category: LogCategory, text: string, link?: LogLink, quiet = false, decision = false): void {
    this.log.unshift({
      seq: ++this.logSeq, time, category, text, link,
      ...(quiet ? { quiet } : {}),
      ...(decision ? { decision } : {}),
    });
    if (this.log.length > 400) this.log.length = 400;
  }

  /** Entries newer than a sequence number, oldest first. */
  logSince(seq: number): LogEntry[] {
    const fresh: LogEntry[] = [];
    for (const entry of this.log) {
      if (entry.seq <= seq) break;
      fresh.push(entry);
    }
    return fresh.reverse();
  }

  /**
   * Sample the vital signs about once a month of game time. Called every
   * production cycle; the throttle keeps the series short enough to draw.
   */
  recordHistory(now: number): void {
    const last = this.history[this.history.length - 1];
    if (last && now - last.time < 25 * 86_400) return;
    this.history.push({
      time: now,
      treasury: this.treasury,
      population: this.snapshot.population,
      researchPoints: this.snapshot.researchPoints,
      buildPoints: this.snapshot.buildPoints,
    });
    if (this.history.length > 240) this.history.shift();
  }

  /** Start a lasting effect. A second of the same kind on the same target stacks. */
  addEffect(
    spec: { kind: EffectKind; target: string; factor: number; label: string; source?: string },
    now: number,
    days: number,
  ): ActiveEffect {
    const effect: ActiveEffect = {
      id: `effect-${this.nextEffectId++}`,
      ...spec,
      started: now,
      until: now + days * 86_400,
    };
    this.effects.push(effect);
    return effect;
  }

  /** Recompute what laws and faction moods do to output. Call after changing politics. */
  refreshPolitics(now: number): void {
    this.politicsFactors = politicalFactors(this.politics, now);
  }

  /** The combined multiplier on one kind of output at a colony. 1 when nothing applies. */
  effectFactor(kind: EffectKind, colonyId: string): number {
    let factor = this.politicsFactors[kind];
    for (const effect of this.effects) {
      if (effect.kind === kind && (effect.target === colonyId || effect.target === "empire")) {
        factor *= effect.factor;
      }
    }
    return factor;
  }

  /** Queue a follow-up event. */
  scheduleEvent(
    defId: string,
    params: Record<string, string | number>,
    now: number,
    days: number,
    follows?: string,
  ): void {
    this.scheduled.push({
      id: `sched-${this.nextEventId++}`,
      defId,
      params,
      due: now + days * 86_400,
      follows,
    });
  }

  newEventId(): string {
    return `event-${this.nextEventId++}`;
  }

  get pendingEvents(): GameEvent[] {
    return this.events.filter((e) => e.status === "pending");
  }

  /** Hide an issue for a while; it returns if the condition persists. */
  dismissIssue(issueId: string, now: number, years = 2): void {
    this.dismissed.set(issueId, now + years * 365.25 * 86400);
  }

  /** Record the empire's state as "seen", for the what-changed summary. */
  markReviewed(now: number): void {
    this.reviewMark = {
      time: now,
      seq: this.logSeq,
      treasury: this.treasury,
      population: [...this.colonies.values()].reduce((sum, c) => sum + c.population, 0),
      techs: this.researched.size,
      colonies: this.colonies.size,
      ships: this.ships.size,
    };
  }

  // ------------------------------------------------------------ persistence

  /**
   * Everything that is not derived. Caches, indexes and the cached research
   * statistics are rebuilt on import rather than stored.
   */
  exportState(): EmpireState {
    return {
      researched: [...this.researched],
      log: this.log,
      logSeq: this.logSeq,
      history: this.history,
      projects: this.projects,
      treasury: this.treasury,
      snapshot: this.snapshot,
      capital: this.capital,
      austerity: this.austerity,
      taxRate: this.taxRate,
      welfare: this.welfare,
      politics: this.politics,
      politicsRng: this.politicsRng.state,
      dismissed: [...this.dismissed],
      standingOrders: this.standingOrders,
      componentDesigns: this.componentDesigns,
      designs: this.designs,
      ships: [...this.ships.values()],
      fleets: [...this.fleets.values()],
      surveyed: [...this.surveyed],
      knownSystems: [...this.knownSystems],
      knownJumpPoints: [...this.knownJumpPoints],
      exploredJumpPoints: [...this.exploredJumpPoints],
      gates: [...this.gates],
      gravProgress: this.gravProgress,
      civilianShipping: this.civilianShipping,
      lastTick: this.lastTick,
      events: this.events,
      effects: this.effects,
      scheduled: this.scheduled,
      eventFrequency: this.eventFrequency,
      eventRng: this.eventRng.state,
      lastEventTime: this.lastEventTime,
      nextEventId: this.nextEventId,
      customTemplates: this.customTemplates,
      reviewMark: this.reviewMark,
      colonies: [...this.colonies.values()],
      officers: this.officers.exportState(),
      rng: this.rng.state,
      counters: {
        project: this.nextProjectId,
        order: this.nextOrderId,
        rule: this.nextRuleId,
        design: this.nextDesignId,
        ship: this.nextShipId,
        fleet: this.nextFleetId,
        component: this.nextComponentId,
      },
    };
  }

  /** Replace this empire's contents with a saved one. */
  importState(data: EmpireState): void {
    this.researched.clear();
    for (const id of data.researched) this.researched.add(id);
    this.stats = statsFor(this.researched);

    this.log.length = 0;
    this.log.push(...data.log);
    this.logSeq = data.logSeq;
    this.history.length = 0;
    this.history.push(...data.history);
    this.projects = data.projects;
    this.treasury = data.treasury;
    this.snapshot = { ...emptySnapshot(), ...data.snapshot };
    this.capital = data.capital;
    this.austerity = data.austerity;
    this.taxRate = data.taxRate ?? 0.3;
    this.welfare = data.welfare ?? 0;
    this.politics = { ...defaultPolitics(), ...data.politics };
    if (data.politicsRng !== undefined) this.politicsRng.state = data.politicsRng;
    this.refreshPolitics(data.lastTick);
    this.dismissed.clear();
    for (const [id, until] of data.dismissed) this.dismissed.set(id, until);
    this.standingOrders = data.standingOrders;
    this.componentDesigns = data.componentDesigns;
    this.designs = data.designs;
    this.civilianShipping = data.civilianShipping;
    this.lastTick = data.lastTick;
    this.events = data.events ?? [];
    this.effects = data.effects ?? [];
    this.scheduled = data.scheduled ?? [];
    this.nextEffectId = this.effects.reduce((m, e) => Math.max(m, Number(e.id.replace("effect-", "")) + 1), 1);
    this.eventFrequency = data.eventFrequency ?? 0;
    if (data.eventRng !== undefined) this.eventRng.state = data.eventRng;
    this.lastEventTime = data.lastEventTime ?? 0;
    this.nextEventId = data.nextEventId ?? this.events.length + 1;
    this.customTemplates = data.customTemplates;
    this.reviewMark = Object.assign({ time: 0, seq: 0, treasury: 0, population: 0, techs: 0, colonies: 0, ships: 0 }, data.reviewMark);

    this.colonies.clear();
    for (const colony of data.colonies) {
      colony.stability ??= 70;
      this.colonies.set(colony.bodyId, colony);
    }
    this.ships.clear();
    for (const ship of data.ships) this.ships.set(ship.id, Object.assign({ condition: 100 }, ship));
    this.fleets.clear();
    for (const fleet of data.fleets) {
      // Fields added after the first release default sensibly for old saves.
      this.fleets.set(fleet.id, Object.assign({ systemId: "sol", gateProgress: 0, loop: false, program: null, waitUntil: 0, programStatus: null }, fleet));
    }
    this.surveyed.clear();
    for (const id of data.surveyed) this.surveyed.add(id);
    for (const [set, list] of [
      [this.knownSystems, data.knownSystems ?? ["sol"]],
      [this.knownJumpPoints, data.knownJumpPoints ?? []],
      [this.exploredJumpPoints, data.exploredJumpPoints ?? []],
      [this.gates, data.gates ?? []],
    ] as [Set<string>, string[]][]) {
      set.clear();
      for (const id of list) set.add(id);
    }
    this.gravProgress = { ...(data.gravProgress ?? {}) };

    this.officers.importState(data.officers);
    this.rng.state = data.rng;

    this.nextProjectId = data.counters.project;
    this.nextOrderId = data.counters.order;
    this.nextRuleId = data.counters.rule;
    this.nextDesignId = data.counters.design;
    this.nextShipId = data.counters.ship;
    this.nextFleetId = data.counters.fleet;
    this.nextComponentId = data.counters.component;

    this.designIndex.clear();
    for (const design of this.designs) this.designIndex.set(design.id, design);
    this.componentIndex.clear();
    for (const component of this.componentDesigns) this.componentIndex.set(component.id, component);
    this.designStatsCache.clear();
    this.componentCache.clear();
    this.revision++;
  }

  techName(techId: string): string {
    return TECH_BY_ID.get(techId)?.name ?? techId;
  }
}
