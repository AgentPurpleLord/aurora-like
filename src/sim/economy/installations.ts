/**
 * Planetary installations: what a colony can build, what it costs, and how
 * many workers it needs.
 *
 * Build cost is split between build points - produced by construction
 * factories - and minerals drawn from the colony's own stockpile. Both are
 * consumed progressively as an item is built.
 */

import type { MineralName } from "../minerals";

export type InstallationCategory = "production" | "mining" | "research" | "support" | "military";

export interface InstallationType {
  id: string;
  name: string;
  category: InstallationCategory;
  blurb: string;
  /** Build points for one unit. */
  cost: number;
  /** Minerals for one unit, in tons. */
  minerals: Partial<Record<MineralName, number>>;
  /** Workers required, in millions of people. */
  workers: number;
  /** Shipping mass of one unit, in tons. */
  tons: number;
}

export const INSTALLATIONS: InstallationType[] = [
  {
    id: "infrastructure", name: "Infrastructure", category: "support",
    blurb: "Sustains population on a world with a colony cost above zero. One unit supports 10,000 colonists at colony cost 1.0.",
    cost: 2, minerals: { Duranium: 2 }, workers: 0, tons: 500,
  },
  {
    id: "mine", name: "Mine", category: "mining",
    blurb: "Extracts every available mineral at a rate set by each deposit's accessibility. Requires workers.",
    cost: 120, minerals: { Duranium: 60, Corundium: 60 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "automated-mine", name: "Automated Mine", category: "mining",
    blurb: "Mines without population - the workhorse of belt and moon operations.",
    cost: 240, minerals: { Duranium: 120, Uridium: 120 }, workers: 0, tons: 25_000,
  },
  {
    id: "construction-factory", name: "Construction Factory", category: "production",
    blurb: "Produces the build points every other installation is made from.",
    cost: 120, minerals: { Duranium: 60, Tritanium: 60 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "fuel-refinery", name: "Fuel Refinery", category: "production",
    blurb: "Converts Sorium into fuel at 2,000 litres per ton.",
    cost: 120, minerals: { Duranium: 60, Boronide: 60 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "ordnance-factory", name: "Ordnance Factory", category: "military",
    blurb: "Produces missiles and other ordnance. Idle until ordnance design exists.",
    cost: 120, minerals: { Duranium: 60, Tritanium: 60 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "research-lab", name: "Research Laboratory", category: "research",
    blurb: "Hosts one scientist's project. A scientist can direct only as many labs as their administration rating allows.",
    cost: 900, minerals: { Duranium: 300, Mercassium: 300, Uridium: 300 }, workers: 0.1, tons: 25_000,
  },
  {
    id: "maintenance", name: "Maintenance Facility", category: "military",
    blurb: "Services ships in orbit, holding off maintenance failures.",
    cost: 150, minerals: { Duranium: 75, Neutronium: 75 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "mass-driver", name: "Mass Driver", category: "support",
    blurb: "Throws mineral packets to another colony - the only mineral transport available before freighters.",
    cost: 300, minerals: { Duranium: 150, Neutronium: 150 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "spaceport", name: "Spaceport", category: "support",
    blurb: "Speeds cargo loading and unloading at this colony.",
    cost: 1200, minerals: { Duranium: 600, Uridium: 600 }, workers: 0.1, tons: 25_000,
  },
  {
    id: "terraforming", name: "Terraforming Installation", category: "support",
    blurb: "Alters the atmosphere, permanently reducing this world's colony cost.",
    cost: 600, minerals: { Duranium: 200, Boronide: 200, Vendarite: 200 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "dstn", name: "Deep Space Tracking Station", category: "military",
    blurb: "Extends passive sensor coverage across the system.",
    cost: 600, minerals: { Duranium: 300, Uridium: 300 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "financial-centre", name: "Financial Centre", category: "production",
    blurb: "Generates 25 wealth per year regardless of population.",
    cost: 1200, minerals: { Duranium: 600, Corbomite: 600 }, workers: 0.05, tons: 25_000,
  },
  {
    id: "military-academy", name: "Military Academy", category: "military",
    blurb: "Trains two additional officers per year into the pool.",
    cost: 1500, minerals: { Duranium: 750, Mercassium: 750 }, workers: 0.1, tons: 25_000,
  },
  {
    id: "sector-command", name: "Sector Command", category: "support",
    blurb: "Regional headquarters. Idle until sector administration is implemented.",
    cost: 1000, minerals: { Duranium: 500, Corbomite: 500 }, workers: 0.1, tons: 25_000,
  },
  {
    id: "shipyard", name: "Shipyard", category: "production",
    blurb: "Builds and repairs ships. Each yard adds 5,000 tons to the largest hull the colony can lay down.",
    cost: 2400, minerals: { Duranium: 1200, Neutronium: 600, Uridium: 600 }, workers: 0.1,
    tons: 25_000,
  },
  {
    id: "gftf", name: "Ground Force Training Facility", category: "military",
    blurb: "Raises and trains ground formations. Idle until ground forces exist.",
    cost: 600, minerals: { Duranium: 300, Neutronium: 300 }, workers: 0.05, tons: 25_000,
  },
];

export const INSTALLATION_BY_ID = new Map(INSTALLATIONS.map((i) => [i.id, i]));

/** Tons of hull each shipyard lets a colony lay down at once. */
export const SHIPYARD_TONS = 5_000;

/** Placeholder installation id on a build order that is really a hull. */
export const SHIP_ORDER = "ship";

export const CATEGORY_NAMES: Record<InstallationCategory, string> = {
  production: "Industry",
  mining: "Mining",
  research: "Research",
  support: "Support",
  military: "Military",
};
