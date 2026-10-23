/**
 * Sub-fields: each research field is split into branches, so a long line of
 * techs sits under its own heading (Chemical Rockets, Armour, Lasers...)
 * instead of every name carrying its own prefix.
 *
 * Branches are assigned by id, in order, first match wins. A tech that
 * declares its own `branch` (the generated propulsion tree does) keeps it.
 */

import type { ResearchField } from "./fields";
import type { Tech } from "./techs";

type Rule = [branch: string, ids: RegExp];

const RULES: Record<ResearchField, Rule[]> = {
  construction: [
    ["Foundations", /^trans-newtonian$/],
    ["Mining", /^mining-/],
    ["Factories", /^construction-\d/],
    ["Laboratories", /^research-\d/],
    ["Fuel Refining", /^fuel-\d/],
    ["Mass Drivers", /^mass-drivers/],
    ["Maintenance", /^maintenance-|^ordnance-factories$|^spaceports$/],
    ["Terraforming", /^terraforming/],
    ["Finance & Trade", /^financial-management$|^banking|^stock-|^quantum-finance|^trade-networks|^mercantile|^interstellar-commerce|^sector-command$/],
    ["Administration", /^public-broadcasting|^civil-service|^arbitration|^enlightened|^parliamentary|^council-of|^constitutional|^grand-cabinet|^federal-charter/],
    ["Consumer Goods", /^consumer-lines|^luxury-fabrication/],
  ],
  power: [
    ["Jump Technology", /^jump-|^gate-construction/],
    ["Ship Components", /^military-specification$|^tank-efficiency/],
  ],
  sensors: [
    ["Survey Sensors", /^geo-survey|^grav-survey/],
    ["Detection", /^active-sensor|^thermal-sensor|^em-sensor|^deep-space-tracking/],
    ["Fire Control", /^fire-control/],
    ["Electronic Warfare", /^ecm-|^eccm-/],
  ],
  defence: [
    ["Armour", /^armour-|^composite-armour$/],
    ["Shields", /shields$|^shield-regen/],
    ["Damage Control", /^damage-control|^magazine-ejection$/],
    ["Hangars", /^fighter-bays$/],
  ],
  energy: [
    ["Lasers", /^laser-/],
    ["Kinetic Guns", /^railgun-|^gauss-cannon$/],
    ["Capacitors", /^capacitor-/],
    ["Turrets", /^turrets$|^turret-gearing/],
    ["Advanced Beams", /^plasma-|^meson-|^particle-beam$|^microwave-/],
  ],
  missiles: [
    ["Launchers", /^missile-launcher|^box-launcher$/],
    ["Warheads", /^warhead-/],
    ["Guidance", /^missile-agility/],
    ["Missile Engines", /^missile-fuel/],
    ["Ordnance Handling", /^magazine-armour$|^missile-reload/],
    ["Countermeasures", /^decoy-missiles$|^point-defence$/],
  ],
  biology: [
    ["Medicine", /^medical-/],
    ["Genetics", /^genome-/],
    ["Infrastructure", /^modular-infrastructure|^orbital-habitats$/],
    ["Agriculture", /^hydroponics-/],
    ["Colonisation", /^cryogenic-berths/],
    ["Xenobiology", /^xenobiology$/],
  ],
  logistics: [
    ["Cargo & Freight", /^cargo-handling|^freight-containers$|^automated-docks$|^orbital-lifts$|^autonomous-freighters$/],
    ["Crew", /^compact-quarters/],
    ["Officer Training", /^military-academies$|^officer-training/],
    ["Ground Forces", /^ground-/],
  ],
};

/** Branch headings in the order they appear, per field. Generated ones are listed explicitly. */
export const FIELD_BRANCHES: Record<ResearchField, string[]> = {
  construction: ["Foundations", "Mining", "Factories", "Laboratories", "Fuel Refining", "Mass Drivers", "Maintenance", "Terraforming", "Finance & Trade", "Administration", "Consumer Goods"],
  power: [
    "Chemical Rockets", "Electric Drives", "Nuclear Thermal", "Nuclear Electric", "Fusion", "Antimatter",
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

export function withBranch(tech: Tech): Tech {
  if (tech.branch) return tech;
  const rule = RULES[tech.field].find(([, ids]) => ids.test(tech.id));
  return { ...tech, branch: rule ? rule[0] : FALLBACK_BRANCH };
}

/** The order branches are shown in: the declared order, then anything unlisted. */
export function branchOrder(field: ResearchField, present: Iterable<string>): string[] {
  const listed = FIELD_BRANCHES[field];
  const have = [...new Set(present)];
  return [...listed.filter((b) => have.includes(b)), ...have.filter((b) => !listed.includes(b))];
}
