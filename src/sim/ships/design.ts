/**
 * Ship classes: a list of designed components, and the figures derived from
 * them.
 *
 * Nothing about a class is stored twice. Tonnage, speed, range, cost and
 * capacity are computed from the component designs and current research, so a
 * better fuel efficiency improves every ship already flying.
 */

import type { MineralName } from "../minerals";
import { hullOf, hullProblems } from "./hulls";
import {
  TONS_PER_HS,
  type ComponentDesign,
  type ComponentKind,
  type ComponentStats,
} from "./components";

export interface DesignComponent {
  /** Id of a ComponentDesign in the empire's library. */
  componentId: string;
  count: number;
}

export interface ShipDesign {
  id: string;
  name: string;
  components: DesignComponent[];
  created: number;
  /** Superseded classes stay in service but cannot be laid down again. */
  obsolete?: boolean;
  /** The hull type (see hulls.ts). Classes made before hulls existed have none. */
  hullId?: string;
}

/** What a class needs to know about a component: the design and its figures. */
export interface ResolvedComponent {
  design: ComponentDesign;
  stats: ComponentStats;
}

export type ComponentResolver = (id: string) => ResolvedComponent | undefined;

export interface DesignStats {
  tons: number;
  hullSpaces: number;
  /** Total engine power. */
  power: number;
  /** km/s. */
  speed: number;
  fuelCapacity: number;
  /** Litres burned per hour at full thrust. */
  fuelPerHour: number;
  enduranceHours: number;
  rangeAu: number;
  crewRequired: number;
  berths: number;
  cargoCapacity: number;
  colonistCapacity: number;
  /** Survey points per day, by sensor type. */
  survey: { geological: number; gravitational: number };
  /** Tons of ship the class's own jump drives can carry through a jump point. */
  jumpCapacity: number;
  /** Gate construction points per day. */
  gateRate: number;
  /** Tonnage-weighted wear multiplier: 1 is a plain commercial ship, higher wears faster. */
  wear: number;
  /** True if any powered component is built to the military specification. */
  military: boolean;
  /** Power the class's reactors make, and what its electric engines draw. */
  reactorOutput: number;
  powerDraw: number;
  /** How many engines of each specification the class carries. */
  engineGrades: { commercial: number; military: number };
  buildCost: number;
  minerals: Partial<Record<MineralName, number>>;
  /** Components by kind, for the designer's summary. */
  counts: Partial<Record<ComponentKind, number>>;
  /** Problems that stop the class being built or flown. */
  problems: string[];
}

const AU_KM = 149_597_870.7;

/**
 * Engine power per hull space gives speed through this factor. Deliberately
 * small: a ship should take days to cross to a neighbouring world and most of
 * a year to cross the system, so distance is something to plan around.
 */
export const SPEED_SCALE = 0.15;

export function designStats(design: ShipDesign, resolve: ComponentResolver): DesignStats {
  let tons = 0;
  let power = 0;
  let fuelCapacity = 0;
  let fuelPerHour = 0;
  let crewRequired = 0;
  let berths = 0;
  let cargoCapacity = 0;
  let colonistCapacity = 0;
  let buildCost = 0;
  const survey = { geological: 0, gravitational: 0 };
  let jumpCapacity = 0;
  let gateRate = 0;
  let wearTons = 0;
  let military = false;
  let reactorOutput = 0;
  let powerDraw = 0;
  const engineGrades = { commercial: 0, military: 0 };
  const minerals: Partial<Record<MineralName, number>> = {};
  const counts: Partial<Record<ComponentKind, number>> = {};
  const problems: string[] = [];

  for (const entry of design.components) {
    if (entry.count <= 0) continue;
    const resolved = resolve(entry.componentId);
    if (!resolved) {
      problems.push("A component in this class no longer exists.");
      continue;
    }
    const { stats, design: component } = resolved;
    const n = entry.count;

    tons += stats.tons * n;
    power += (stats.power ?? 0) * n;
    fuelCapacity += (stats.fuel ?? 0) * n;
    fuelPerHour += (stats.fuelPerHour ?? 0) * n;
    crewRequired += stats.crew * n;
    berths += (stats.berths ?? 0) * n;
    cargoCapacity += (stats.cargo ?? 0) * n;
    colonistCapacity += (stats.colonists ?? 0) * n;
    buildCost += stats.cost * n;
    if (stats.survey) survey[stats.survey.type] += stats.survey.rate * n;
    wearTons += stats.wear * stats.tons * n;
    if (stats.grade === "military") military = true;
    if (component.kind === "engine") engineGrades[stats.grade] += n;
    reactorOutput += (stats.output ?? 0) * n;
    powerDraw += (stats.powerDraw ?? 0) * n;
    jumpCapacity += (stats.jump ?? 0) * n;
    gateRate += (stats.gate ?? 0) * n;
    counts[component.kind] = (counts[component.kind] ?? 0) + n;

    for (const [mineral, amount] of Object.entries(stats.minerals) as [MineralName, number][]) {
      minerals[mineral] = (minerals[mineral] ?? 0) + amount * n;
    }
    for (const problem of stats.problems) problems.push(`${component.name}: ${problem}`);
  }

  const hullSpaces = tons / TONS_PER_HS;
  const speed = hullSpaces > 0 ? (power * 1000 * SPEED_SCALE) / hullSpaces : 0;
  const enduranceHours = fuelPerHour > 0 ? fuelCapacity / fuelPerHour : 0;
  const rangeAu = (speed * 3600 * enduranceHours) / AU_KM;

  if (tons === 0) problems.push("The class has no components.");
  else if (power === 0) problems.push("No engine: the class cannot move.");
  else if (fuelCapacity === 0) problems.push("No fuel tank: the engines have nothing to burn.");
  if (powerDraw > reactorOutput + 1e-9) {
    problems.push(`Electric engines draw ${Math.round(powerDraw * 10) / 10} power but the reactors make ${Math.round(reactorOutput * 10) / 10}. Add a reactor.`);
  }
  if (berths < crewRequired) problems.push(`Crew quarters short by ${crewRequired - berths} berths.`);

  const stats: DesignStats = {
    tons,
    hullSpaces,
    power,
    speed,
    fuelCapacity,
    fuelPerHour,
    enduranceHours,
    rangeAu,
    crewRequired,
    berths,
    cargoCapacity,
    colonistCapacity,
    survey,
    jumpCapacity,
    gateRate,
    wear: tons > 0 ? wearTons / tons : 0,
    military,
    reactorOutput,
    powerDraw,
    engineGrades,
    buildCost,
    minerals,
    counts,
    problems,
  };
  const hull = hullOf(design);
  if (hull) problems.push(...hullProblems(hull, stats));
  return stats;
}

/** A one-line description of what a class is for. */
export function describeDesign(stats: DesignStats): string {
  const roles: string[] = [];
  if (stats.cargoCapacity > 0) roles.push("freighter");
  if (stats.colonistCapacity > 0) roles.push("colony ship");
  if (stats.survey.geological > 0) roles.push("survey ship");
  if (stats.survey.gravitational > 0) roles.push("jump survey");
  if (stats.jumpCapacity > 0) roles.push("jump ship");
  if (stats.gateRate > 0) roles.push("gate builder");
  if (!roles.length) roles.push(stats.speed > 0 ? "scout" : "hulk");
  return `${stats.military ? "military " : "commercial "}${roles.join(", ")}`;
}

/** Crew quarters (in components of this size) needed to berth everyone. */
export function quartersNeeded(shortfall: number, berthsPerQuarters: number): number {
  return berthsPerQuarters > 0 ? Math.ceil(shortfall / berthsPerQuarters) : 0;
}
