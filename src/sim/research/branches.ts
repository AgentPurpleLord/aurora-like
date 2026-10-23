/**
 * Sub-fields: each research field is split into branches, so a long line of
 * techs sits under its own heading (Chemical Rockets, Armour, Lasers...)
 * instead of every name carrying its own prefix.
 *
 * Each tech names its own branch in the tree data; this file only fixes the
 * order the branches are shown in. A branch not listed here is shown after
 * the listed ones.
 */

import type { ResearchField } from "./fields";

/** Branch headings in the order they appear, per field. Generated ones are listed explicitly. */
export const FIELD_BRANCHES: Record<ResearchField, string[]> = {
  construction: ["Foundations", "Mining", "Factories", "Laboratories", "Fuel Refining", "Mass Drivers", "Maintenance", "Terraforming", "Finance & Trade", "Administration", "Consumer Goods"],
  power: [
    "Conventional & Nuclear", "Ion & Fusion", "Antimatter & Photonic",
    "Chemical Power", "Nuclear Power", "Fusion Power", "Antimatter Power",
    "Engine Size", "Power Modifier", "Miniaturisation", "Fuel Efficiency", "Jump Technology", "Ship Components",
  ],
  sensors: ["Survey Sensors", "Detection", "Fire Control", "Electronic Warfare"],
  defence: ["Armour", "Shields", "Damage Control", "Hangars"],
  energy: ["Lasers", "Kinetic Guns", "Capacitors", "Turrets", "Advanced Beams"],
  missiles: ["Launchers", "Warheads", "Guidance", "Missile Engines", "Ordnance Handling", "Countermeasures"],
  biology: ["Medicine", "Genetics", "Infrastructure", "Agriculture", "Colonisation", "Xenobiology"],
  logistics: ["Cargo & Freight", "Crew", "Officer Training", "Ground Forces"],
};

export const FALLBACK_BRANCH = "General";

/** The order branches are shown in: the declared order, then anything unlisted. */
export function branchOrder(field: ResearchField, present: Iterable<string>): string[] {
  const listed = FIELD_BRANCHES[field];
  const have = [...new Set(present)];
  return [...listed.filter((b) => have.includes(b)), ...have.filter((b) => !listed.includes(b))];
}
