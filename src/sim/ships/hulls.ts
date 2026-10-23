/**
 * Hull types: what kind of ship a class is.
 *
 * As in Aurora, a class has a name of its own - "Kestrel" - and a hull type
 * - "Destroyer" - chosen from a fixed list. The hull says what the ship is
 * for and what is allowed of it: how big it may be, and which grade of powered
 * part it may carry. Commercial hulls are civilian: they take only commercial
 * parts and cannot be armed for war. Military hulls are warships: their
 * engines must be built to the military specification. Beyond that the hull
 * only gives advice - a freighter with no cargo hold is allowed, and will be
 * told it is not much of a freighter.
 */

import type { ShipDesign, DesignStats } from "./design";
import { MILITARY_TECH } from "./components";

export type HullCategory = "commercial" | "military";

export interface HullType {
  id: string;
  name: string;
  /** Prefix used in lists: "DD" for a destroyer. */
  abbr: string;
  category: HullCategory;
  /** Allowed size, in tons. */
  minTons: number;
  maxTons: number;
  blurb: string;
  /** Research needed before the hull can be chosen. */
  tech?: string;
}

export const HULLS: HullType[] = [
  // ------------------------------------------------------------ commercial
  { id: "courier", name: "Courier", abbr: "CR", category: "commercial", minTons: 250, maxTons: 2_500,
    blurb: "A small, quick civilian ship for carrying people and messages." },
  { id: "survey-ship", name: "Survey Ship", abbr: "SV", category: "commercial", minTons: 500, maxTons: 5_000,
    blurb: "Carries geological sensors to map what a world is made of." },
  { id: "explorer", name: "Explorer", abbr: "XP", category: "commercial", minTons: 1_000, maxTons: 10_000,
    blurb: "A long-range survey ship with gravitational sensors and a jump drive, for finding the way out." },
  { id: "freighter", name: "Freighter", abbr: "FR", category: "commercial", minTons: 2_000, maxTons: 50_000,
    blurb: "Carries minerals and crated installations between colonies." },
  { id: "tanker", name: "Tanker", abbr: "TK", category: "commercial", minTons: 2_000, maxTons: 50_000,
    blurb: "Mostly fuel tank: carries fuel to where it is needed." },
  { id: "colony-ship", name: "Colony Ship", abbr: "CS", category: "commercial", minTons: 2_000, maxTons: 50_000,
    blurb: "Carries colonists in cold sleep to a new world." },
  { id: "jump-tender", name: "Jump Tender", abbr: "JT", category: "commercial", minTons: 2_000, maxTons: 30_000,
    blurb: "A ship built around a jump drive, to carry other ships through jump points." },
  { id: "construction-ship", name: "Construction Ship", abbr: "CN", category: "commercial", minTons: 2_000, maxTons: 30_000,
    blurb: "Carries gate construction modules to stabilise jump points.", tech: "jump-gate-construction" },

  // -------------------------------------------------------------- military
  { id: "corvette", name: "Corvette", abbr: "CT", category: "military", minTons: 500, maxTons: 3_000,
    blurb: "The smallest warship: a fast patrol and escort hull.", tech: MILITARY_TECH },
  { id: "frigate", name: "Frigate", abbr: "FF", category: "military", minTons: 3_000, maxTons: 6_000,
    blurb: "A general-purpose escort and patrol warship.", tech: MILITARY_TECH },
  { id: "destroyer", name: "Destroyer", abbr: "DD", category: "military", minTons: 6_000, maxTons: 10_000,
    blurb: "A fast, capable warship, the backbone of a fleet.", tech: MILITARY_TECH },
  { id: "cruiser", name: "Cruiser", abbr: "CA", category: "military", minTons: 10_000, maxTons: 20_000,
    blurb: "A heavy warship able to fight alone for long periods.", tech: MILITARY_TECH },
  { id: "battleship", name: "Battleship", abbr: "BB", category: "military", minTons: 20_000, maxTons: 50_000,
    blurb: "The largest and most expensive hull afloat.", tech: MILITARY_TECH },
];

export const HULL_BY_ID = new Map(HULLS.map((h) => [h.id, h]));

export function hullOf(design: Pick<ShipDesign, "hullId"> | undefined): HullType | undefined {
  return design?.hullId ? HULL_BY_ID.get(design.hullId) : undefined;
}

/** "Kestrel-class Destroyer", or just "Kestrel" for a class with no hull. */
export function classTitle(design: Pick<ShipDesign, "name" | "hullId">): string {
  const hull = hullOf(design);
  return hull ? `${design.name}-class ${hull.name}` : design.name;
}

/** Reasons the design may not be built as this hull. These block building. */
export function hullProblems(hull: HullType, stats: DesignStats): string[] {
  const problems: string[] = [];
  if (stats.tons > 0 && stats.tons < hull.minTons) {
    problems.push(`A ${hull.name} must be at least ${hull.minTons.toLocaleString()} t; this is ${Math.round(stats.tons).toLocaleString()} t.`);
  }
  if (stats.tons > hull.maxTons) {
    problems.push(`A ${hull.name} can be at most ${hull.maxTons.toLocaleString()} t; this is ${Math.round(stats.tons).toLocaleString()} t.`);
  }
  if (hull.category === "commercial" && stats.military) {
    problems.push("A commercial hull cannot carry military-specification parts.");
  }
  if (hull.category === "military" && stats.engineGrades.commercial > 0) {
    problems.push("A warship's engines must be built to the military specification.");
  }
  if (hull.category === "military" && stats.power > 0 && stats.engineGrades.military === 0) {
    problems.push("A warship needs military-specification engines.");
  }
  return problems;
}

/** Things worth knowing that do not stop a class being built. */
export function hullAdvice(hull: HullType, stats: DesignStats): string[] {
  const advice: string[] = [];
  const role = (cond: boolean, text: string) => {
    if (!cond) advice.push(text);
  };
  switch (hull.id) {
    case "survey-ship": role(stats.survey.geological > 0, "A survey ship needs a geological survey sensor."); break;
    case "explorer": role(stats.survey.gravitational > 0 && stats.jumpCapacity >= stats.tons, "An explorer needs a gravitational sensor and a jump drive rated for its own weight."); break;
    case "freighter": role(stats.cargoCapacity > 0, "A freighter needs a cargo hold."); break;
    case "tanker": role(stats.tons > 0 && stats.fuelCapacity / stats.tons >= 60, "A tanker should be mostly fuel tank: aim for 60 litres of fuel per ton or more."); break;
    case "colony-ship": role(stats.colonistCapacity > 0, "A colony ship needs cryogenic berths."); break;
    case "jump-tender": role(stats.jumpCapacity > 0, "A jump tender needs a jump drive."); break;
    case "construction-ship": role(stats.gateRate > 0, "A construction ship needs a gate construction module."); break;
    default:
      if (hull.category === "military") advice.push("Weapons and armour are not in the game yet, so this hull cannot be armed.");
  }
  return advice;
}

/** The best-fitting hull for what a design carries, or undefined if none fits. */
export function suggestHull(stats: DesignStats, researched: ReadonlySet<string>): HullType | undefined {
  const fits = (id: string): HullType | undefined => {
    const hull = HULL_BY_ID.get(id);
    return hull && stats.tons >= hull.minTons && stats.tons <= hull.maxTons ? hull : undefined;
  };
  if (stats.tons <= 0) return undefined;
  const open = (hull: HullType | undefined) => (hull && (!hull.tech || researched.has(hull.tech)) ? hull : undefined);

  if (stats.military) {
    const warships = HULLS.filter((h) => h.category === "military" && stats.tons >= h.minTons && stats.tons <= h.maxTons);
    return warships.map(open).find(Boolean);
  }
  if (stats.gateRate > 0) return fits("construction-ship");
  if (stats.survey.gravitational > 0 && stats.jumpCapacity > 0) return fits("explorer") ?? fits("jump-tender");
  if (stats.jumpCapacity > 0) return fits("jump-tender");
  if (stats.colonistCapacity > 0) return fits("colony-ship");
  if (stats.survey.geological > 0) return fits("survey-ship");
  if (stats.cargoCapacity > 0) return fits("freighter");
  if (stats.fuelCapacity / stats.tons >= 60) return fits("tanker") ?? fits("freighter");
  return fits("courier") ?? fits("freighter");
}

// ------------------------------------------------------------- class names

const MILITARY_NAMES = [
  "Kestrel", "Harrier", "Falcon", "Osprey", "Talon", "Vanguard", "Sentinel", "Warden", "Lancer", "Rapier",
  "Bulwark", "Aegis", "Spartan", "Valiant", "Dauntless", "Ironside", "Corsair", "Gladius", "Hellion", "Paladin",
];
const COMMERCIAL_NAMES = [
  "Wayfarer", "Pathfinder", "Meridian", "Horizon", "Voyager", "Navigator", "Drifter", "Pilgrim", "Trailblazer", "Mariner",
  "Odyssey", "Cartographer", "Compass", "Beacon", "Tradewind", "Lodestar", "Stalwart", "Haulier", "Caravan", "Pioneer",
];

/** A class name that is not in use, in the spirit of the hull. */
export function suggestClassName(hull: HullType | undefined, taken: ReadonlySet<string>): string {
  const pool = hull?.category === "military" ? MILITARY_NAMES : COMMERCIAL_NAMES;
  const free = pool.find((n) => !taken.has(n));
  if (free) return free;
  return `${pool[taken.size % pool.length]} Mk ${Math.floor(taken.size / pool.length) + 2}`;
}
