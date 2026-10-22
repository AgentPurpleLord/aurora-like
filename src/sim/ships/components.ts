/**
 * Ship components.
 *
 * Every component is gated on a technology, which is what finally gives the
 * engine and sensor branches of the research tree something to do. A design
 * is just a bag of these; everything about the ship is derived from them.
 *
 * Tonnage is in tons throughout. Aurora's hull space (50 tons) survives only
 * in the speed formula, which is the one place the unit is load-bearing.
 */

import type { MineralName } from "../minerals";

export type ComponentCategory = "engine" | "fuel" | "crew" | "cargo" | "sensor";

export interface ShipComponent {
  id: string;
  name: string;
  category: ComponentCategory;
  blurb: string;
  tons: number;
  /** Build points for one unit. */
  cost: number;
  minerals: Partial<Record<MineralName, number>>;
  /** Crew this component needs to run. */
  crew: number;
  /** Technology that has to be researched before it can be used. */
  requires?: string;

  /** Engines: thrust, in engine power. */
  power?: number;
  /** Fuel tanks: litres held. */
  fuel?: number;
  /** Crew quarters: people accommodated. */
  berths?: number;
  /** Cargo holds: tons carried. */
  cargo?: number;
  /** Cryogenic berths: colonists carried. */
  colonists?: number;
  /** Survey sensors: what they can survey. */
  survey?: "geological" | "gravitational";
}

export const COMPONENTS: ShipComponent[] = [
  {
    id: "engine-nuclear-thermal", name: "Nuclear Thermal Engine", category: "engine",
    blurb: "The first trans-Newtonian drive. Reliable, thirsty, and slow.",
    tons: 250, cost: 20, minerals: { Gallicite: 10 }, crew: 3,
    requires: "nuclear-thermal", power: 60,
  },
  {
    id: "engine-nuclear-pulse", name: "Nuclear Pulse Engine", category: "engine",
    blurb: "Twice the thrust of a thermal drive for the same volume.",
    tons: 250, cost: 32, minerals: { Gallicite: 16 }, crew: 3,
    requires: "nuclear-pulse", power: 120,
  },
  {
    id: "engine-ion", name: "Ion Drive", category: "engine",
    blurb: "The workhorse of the expansion era.",
    tons: 250, cost: 48, minerals: { Gallicite: 24 }, crew: 4,
    requires: "ion-drive", power: 200,
  },
  {
    id: "engine-magneto-plasma", name: "Magneto-Plasma Drive", category: "engine",
    blurb: "High output, and the fuel bill to match.",
    tons: 250, cost: 70, minerals: { Gallicite: 35 }, crew: 5,
    requires: "magneto-plasma", power: 320,
  },
  {
    id: "fuel-tank", name: "Fuel Tank", category: "fuel",
    blurb: "Holds 50,000 litres of refined Sorium.",
    tons: 250, cost: 5, minerals: { Duranium: 3 }, crew: 0,
    requires: "trans-newtonian", fuel: 50_000,
  },
  {
    id: "crew-quarters", name: "Crew Quarters", category: "crew",
    blurb: "Accommodation for twenty crew.",
    tons: 100, cost: 5, minerals: { Duranium: 3 }, crew: 0,
    requires: "trans-newtonian", berths: 20,
  },
  {
    id: "cargo-hold", name: "Cargo Hold", category: "cargo",
    blurb: "Carries 25,000 tons of minerals or disassembled installations.",
    tons: 1000, cost: 25, minerals: { Duranium: 20 }, crew: 2,
    requires: "trans-newtonian", cargo: 25_000,
  },
  {
    id: "cryogenic-berths", name: "Cryogenic Berths", category: "cargo",
    blurb: "Carries 50,000 colonists in cold sleep.",
    tons: 1000, cost: 30, minerals: { Duranium: 15, Mercassium: 10 }, crew: 4,
    requires: "trans-newtonian", colonists: 50_000,
  },
  {
    id: "geo-survey-sensor", name: "Geological Survey Sensors", category: "sensor",
    blurb: "Surveys a body's mineral deposits from orbit.",
    tons: 200, cost: 30, minerals: { Uridium: 15 }, crew: 4,
    requires: "geo-survey-sensors", survey: "geological",
  },
  {
    id: "grav-survey-sensor", name: "Gravitational Survey Sensors", category: "sensor",
    blurb: "Detects the anomalies that mark a jump point. Nothing to find until jump points exist.",
    tons: 200, cost: 35, minerals: { Uridium: 18 }, crew: 4,
    requires: "grav-survey-sensors", survey: "gravitational",
  },
];

export const COMPONENT_BY_ID = new Map(COMPONENTS.map((c) => [c.id, c]));

export const CATEGORY_NAMES: Record<ComponentCategory, string> = {
  engine: "Propulsion",
  fuel: "Fuel",
  crew: "Crew",
  cargo: "Cargo",
  sensor: "Sensors",
};

export function availableComponents(researched: ReadonlySet<string>): ShipComponent[] {
  return COMPONENTS.filter((c) => !c.requires || researched.has(c.requires));
}
