/**
 * The technology tree.
 *
 * A tech is available once every prerequisite is researched. Effects are
 * declarative so that the empire's working figures can always be recomputed
 * from the set of researched techs alone - there is no incremental state to
 * drift out of sync.
 *
 * Techs marked `future` are real research targets with no mechanical effect
 * yet; they gate ship design, surveying and combat, which are not built.
 */

import type { ResearchField } from "./fields";
import techData from "../../data/techs.json";

export interface EmpireStats {
  /** Tons per mine per year at accessibility 1.0. */
  miningRate: number;
  /** Build points per construction factory per year. */
  constructionRate: number;
  /** Research points per laboratory per year. */
  researchRate: number;
  /** Litres of fuel per refinery per year. */
  fuelPerRefinery: number;
  /** Ordnance build points per ordnance factory per year. */
  ordnanceRate: number;
  /** Tons per mass driver per year. */
  massDriverThroughput: number;
  /** Tons of ship one maintenance facility can service at a time. */
  serviceTonsPerFacility: number;
  /** Atmospheres of gas moved per terraforming installation per year. */
  terraformRate: number;
  /** Added to the base population growth rate as a multiplier. */
  popGrowthBonus: number;
  /** Subtracted from every body's colony cost. */
  colonyCostReduction: number;
  /** How many colonists one unit of infrastructure supports, relative to base. */
  infrastructureEfficiency: number;
  /** Added to wealth income as a multiplier. */
  wealthBonus: number;
  /** Added to commerce (trade income and the levy on traded goods) as a multiplier. */
  tradeBonus: number;
  /** Points added to every colony's stability target. */
  stabilityBonus: number;
  /** Political capital per year, on top of what approval earns. */
  capitalBonus: number;
  /** Laws that can be in force at once. */
  policySlots: number;
  /** Officers each Military Academy trains per year. */
  academyOutput: number;
  /** Units of food a hydroponic farm grows per year. */
  farmOutput: number;
  /** Units of consumer goods a consumer plant makes per year. */
  consumerOutput: number;
  /** Units of luxuries a luxury workshop makes per year. */
  luxuryOutput: number;
  /** Multiplier on how much freight lines and civilian shipping can move. */
  freightFlow: number;
  unlocked: Set<string>;
}

export type TechEffect =
  /** Raise a stat to `value` - the highest researched tech wins. */
  | { kind: "set"; stat: NumericStat; value: number }
  /** Accumulate across every researched tech that grants it. */
  | { kind: "add"; stat: NumericStat; value: number }
  | { kind: "unlock"; installation: string };

export type NumericStat = {
  [K in keyof EmpireStats]: EmpireStats[K] extends number ? K : never;
}[keyof EmpireStats];

export interface Tech {
  id: string;
  name: string;
  field: ResearchField;
  /** Research points required. */
  cost: number;
  prereqs: string[];
  effects?: TechEffect[];
  description: string;
  /** Sub-field within its field (see branches.ts for the order they are shown in). */
  branch?: string;
  /** True when the tech only matters to systems that are not built yet. */
  future?: boolean;
}

/**
 * The tree itself is data: src/data/techs.json. Edit it directly.
 */
export const TECHS: Tech[] = techData as Tech[];

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

export function baseStats(): EmpireStats {
  return {
    miningRate: 10,
    constructionRate: 10,
    researchRate: 200,
    fuelPerRefinery: 40000,
    ordnanceRate: 10,
    massDriverThroughput: 0,
    terraformRate: 0,
    serviceTonsPerFacility: 4000,
    popGrowthBonus: 0,
    colonyCostReduction: 0,
    infrastructureEfficiency: 1,
    wealthBonus: 0,
    tradeBonus: 0,
    stabilityBonus: 0,
    capitalBonus: 0,
    policySlots: 3,
    academyOutput: 2,
    farmOutput: 100,
    consumerOutput: 100,
    luxuryOutput: 40,
    freightFlow: 1,
    unlocked: new Set<string>([
      "infrastructure",
      "mine",
      "automated-mine",
      "construction-factory",
      "fuel-refinery",
      "research-lab",
      "shipyard",
    ]),
  };
}

/** Recompute every working figure from the set of researched techs. */
export function statsFor(researched: Iterable<string>): EmpireStats {
  const stats = baseStats();
  for (const id of researched) {
    const tech = TECH_BY_ID.get(id);
    if (!tech?.effects) continue;
    for (const effect of tech.effects) {
      if (effect.kind === "unlock") stats.unlocked.add(effect.installation);
      else if (effect.kind === "set") {
        stats[effect.stat] = Math.max(stats[effect.stat], effect.value);
      } else {
        stats[effect.stat] += effect.value;
      }
    }
  }
  return stats;
}

/** Techs whose prerequisites are all researched and which are not yet known. */
export function availableTechs(researched: ReadonlySet<string>): Tech[] {
  return TECHS.filter(
    (t) => !researched.has(t.id) && t.prereqs.every((p) => researched.has(p)),
  );
}
