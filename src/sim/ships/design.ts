/**
 * Ship classes, and the figures derived from their components.
 *
 * Nothing about a class is stored twice: tonnage, speed, range, cost and
 * capacity are all computed from the component list and the empire's current
 * technology, so researching a better fuel efficiency improves every ship
 * already flying.
 */

import type { EmpireStats } from "../research/techs";
import type { MineralName } from "../minerals";
import { COMPONENT_BY_ID, type ShipComponent } from "./components";

export interface DesignComponent {
  componentId: string;
  count: number;
}

export interface ShipDesign {
  id: string;
  name: string;
  components: DesignComponent[];
  /** Simulation time the class was laid down. */
  created: number;
}

export interface DesignStats {
  tons: number;
  /** Total engine power. */
  power: number;
  /** km/s. */
  speed: number;
  /** Litres carried. */
  fuelCapacity: number;
  /** Litres burned per hour at full thrust. */
  fuelPerHour: number;
  /** Billions of km at cruising speed before the tanks run dry. */
  rangeAu: number;
  crewRequired: number;
  berths: number;
  cargoCapacity: number;
  colonistCapacity: number;
  survey: { geological: boolean; gravitational: boolean };
  buildCost: number;
  minerals: Partial<Record<MineralName, number>>;
  /** Problems that stop the class being built. */
  problems: string[];
}

/** Aurora's hull space: the speed formula is the one place it still matters. */
const TONS_PER_HS = 50;
/** Litres burned per point of engine power per hour. */
const FUEL_PER_POWER_HOUR = 5;
const AU_KM = 149_597_870.7;

export function engineModifier(stats: EmpireStats | undefined, researched: ReadonlySet<string>): number {
  void stats;
  // Tuned engines trade fuel for thrust; both are flat multipliers for now.
  return researched.has("engine-power-125") ? 1.25 : 1;
}

export function fuelModifier(researched: ReadonlySet<string>): number {
  return researched.has("fuel-consumption-08") ? 0.8 : 1;
}

export function designStats(
  design: ShipDesign,
  researched: ReadonlySet<string>,
  stats?: EmpireStats,
): DesignStats {
  let tons = 0;
  let power = 0;
  let fuelCapacity = 0;
  let crewRequired = 0;
  let berths = 0;
  let cargoCapacity = 0;
  let colonistCapacity = 0;
  let buildCost = 0;
  const minerals: Partial<Record<MineralName, number>> = {};
  const survey = { geological: false, gravitational: false };
  const problems: string[] = [];

  for (const entry of design.components) {
    const component = COMPONENT_BY_ID.get(entry.componentId);
    if (!component || entry.count <= 0) continue;
    if (component.requires && !researched.has(component.requires)) {
      problems.push(`${component.name} needs ${component.requires.replace(/-/g, " ")}.`);
      continue;
    }

    tons += component.tons * entry.count;
    power += (component.power ?? 0) * entry.count;
    fuelCapacity += (component.fuel ?? 0) * entry.count;
    crewRequired += component.crew * entry.count;
    berths += (component.berths ?? 0) * entry.count;
    cargoCapacity += (component.cargo ?? 0) * entry.count;
    colonistCapacity += (component.colonists ?? 0) * entry.count;
    buildCost += component.cost * entry.count;
    if (component.survey === "geological") survey.geological = true;
    if (component.survey === "gravitational") survey.gravitational = true;

    for (const [mineral, amount] of Object.entries(component.minerals) as [MineralName, number][]) {
      minerals[mineral] = (minerals[mineral] ?? 0) + amount * entry.count;
    }
  }

  const enginePower = power * engineModifier(stats, researched);
  const speed = tons > 0 ? (enginePower * 1000) / (tons / TONS_PER_HS) : 0;
  const fuelPerHour = enginePower * FUEL_PER_POWER_HOUR * fuelModifier(researched);
  // Hours of thrust the tanks allow, turned into a distance at cruise.
  const enduranceHours = fuelPerHour > 0 ? fuelCapacity / fuelPerHour : 0;
  const rangeAu = (speed * 3600 * enduranceHours) / AU_KM;

  if (tons === 0) problems.push("The class has no components.");
  if (power === 0 && tons > 0) problems.push("No engine: the class cannot move.");
  if (berths < crewRequired) {
    problems.push(`Crew quarters short by ${crewRequired - berths}.`);
  }

  return {
    tons,
    power: enginePower,
    speed,
    fuelCapacity,
    fuelPerHour,
    rangeAu,
    crewRequired,
    berths,
    cargoCapacity,
    colonistCapacity,
    survey,
    buildCost,
    minerals,
    problems,
  };
}

/** A one-line description of what a class is for. */
export function describeDesign(stats: DesignStats): string {
  const roles: string[] = [];
  if (stats.cargoCapacity > 0) roles.push("freighter");
  if (stats.colonistCapacity > 0) roles.push("colony ship");
  if (stats.survey.geological) roles.push("survey ship");
  if (stats.survey.gravitational) roles.push("jump survey");
  if (!roles.length) roles.push(stats.speed > 0 ? "scout" : "hulk");
  return roles.join(", ");
}

/** Starter classes offered once the technology for them exists. */
export function starterDesigns(researched: ReadonlySet<string>): Omit<ShipDesign, "id" | "created">[] {
  const engine = bestEngine(researched);
  if (!engine) return [];
  return [
    {
      name: "Hauler",
      components: [
        { componentId: engine.id, count: 2 },
        { componentId: "fuel-tank", count: 4 },
        { componentId: "cargo-hold", count: 4 },
        { componentId: "crew-quarters", count: 2 },
      ],
    },
    {
      name: "Pioneer",
      components: [
        { componentId: engine.id, count: 2 },
        { componentId: "fuel-tank", count: 4 },
        { componentId: "cryogenic-berths", count: 4 },
        { componentId: "crew-quarters", count: 2 },
      ],
    },
    {
      name: "Surveyor",
      components: [
        { componentId: engine.id, count: 1 },
        { componentId: "fuel-tank", count: 3 },
        { componentId: "geo-survey-sensor", count: 1 },
        { componentId: "crew-quarters", count: 1 },
      ],
    },
  ].filter((design) =>
    design.components.every((c) => {
      const component = COMPONENT_BY_ID.get(c.componentId);
      return component && (!component.requires || researched.has(component.requires));
    }),
  );
}

export function bestEngine(researched: ReadonlySet<string>): ShipComponent | undefined {
  const engines = [...COMPONENT_BY_ID.values()]
    .filter((c) => c.category === "engine" && (!c.requires || researched.has(c.requires)))
    .sort((a, b) => (b.power ?? 0) - (a.power ?? 0));
  return engines[0];
}
