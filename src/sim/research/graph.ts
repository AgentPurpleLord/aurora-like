/**
 * Reading the technology tree.
 *
 * The raw tree is a flat list with prerequisite ids, which is hard to browse.
 * These helpers answer the questions a player actually has: what can I start
 * now, what does this unlock, what is stopping me, and how long will it take.
 */

import type { Empire } from "../../state/empire";
import { installationCount } from "../../state/colony";
import { INSTALLATION_BY_ID } from "../economy/installations";
import { employmentRatio } from "../economy/production";
import { ENGINE_TYPES, KINDS, SENSOR_TYPES } from "../ships/components";
import { bonus, labCapacity, type Officer } from "../people/officers";
import { RESEARCH_FIELDS, type ResearchField } from "./fields";
import { TECHS, TECH_BY_ID, type Tech } from "./techs";

export type TechState = "researched" | "active" | "available" | "locked";

export function techState(empire: Empire, tech: Tech): TechState {
  if (empire.researched.has(tech.id)) return "researched";
  if (empire.projects.some((p) => p.techId === tech.id)) return "active";
  return tech.prereqs.every((p) => empire.researched.has(p)) ? "available" : "locked";
}

// ------------------------------------------------------------------- layout

const tierCache = new Map<string, number>();

/**
 * Column in a field's board: how many same-field techs lie between this one
 * and the start of the field. Prerequisites from other fields do not push a
 * tech right, because they are shown as links instead.
 */
export function tierOf(tech: Tech): number {
  const cached = tierCache.get(tech.id);
  if (cached !== undefined) return cached;
  let tier = 0;
  for (const id of tech.prereqs) {
    const pre = TECH_BY_ID.get(id);
    if (pre && pre.field === tech.field) tier = Math.max(tier, tierOf(pre) + 1);
  }
  tierCache.set(tech.id, tier);
  return tier;
}

export function techsInField(field: ResearchField): Tech[][] {
  const columns: Tech[][] = [];
  for (const tech of TECHS) {
    if (tech.field !== field) continue;
    const tier = tierOf(tech);
    (columns[tier] ??= []).push(tech);
  }
  return columns.map((c) => c ?? []);
}

export function dependentsOf(techId: string): Tech[] {
  return TECHS.filter((t) => t.prereqs.includes(techId));
}

/** Every prerequisite not yet researched, nearest first. */
export function missingPrereqs(empire: Empire, tech: Tech): Tech[] {
  return tech.prereqs
    .filter((id) => !empire.researched.has(id))
    .map((id) => TECH_BY_ID.get(id)!)
    .filter(Boolean);
}

export function fieldProgress(empire: Empire, field: ResearchField): { done: number; total: number } {
  const all = TECHS.filter((t) => t.field === field);
  return { done: all.filter((t) => empire.researched.has(t.id)).length, total: all.length };
}

// ------------------------------------------------------------------ unlocks

const STAT_LABELS: Record<string, string> = {
  miningRate: "Mine output",
  constructionRate: "Factory output",
  researchRate: "Laboratory output",
  fuelPerRefinery: "Refinery output",
  ordnanceRate: "Ordnance output",
  massDriverThroughput: "Mass driver throughput",
  terraformRate: "Terraforming rate",
  popGrowthBonus: "Population growth",
  colonyCostReduction: "Colony cost",
  infrastructureEfficiency: "Infrastructure efficiency",
  wealthBonus: "Tax revenue",
};

const STAT_UNITS: Record<string, string> = {
  miningRate: "t/year per mine",
  constructionRate: "BP/year per factory",
  researchRate: "RP/year per lab",
  fuelPerRefinery: "litres/year per refinery",
  massDriverThroughput: "t/year per driver",
  terraformRate: "atm/year per installation",
};

export interface Unlocks {
  /** Things that become buildable or designable. */
  gains: string[];
  /** Improvements to existing output. */
  improves: string[];
  /** Techs that this one opens. */
  opens: Tech[];
}

/** What researching a tech actually does, in plain words. */
export function unlocksOf(tech: Tech): Unlocks {
  const gains: string[] = [];
  const improves: string[] = [];

  for (const effect of tech.effects ?? []) {
    if (effect.kind === "unlock") {
      const name = INSTALLATION_BY_ID.get(effect.installation)?.name ?? effect.installation;
      gains.push(`${name} installation`);
    } else if (effect.kind === "set") {
      const unit = STAT_UNITS[effect.stat];
      improves.push(`${STAT_LABELS[effect.stat] ?? effect.stat} becomes ${effect.value}${unit ? ` ${unit}` : ""}`);
    } else {
      const label = STAT_LABELS[effect.stat] ?? effect.stat;
      const sign = effect.value >= 0 ? "+" : "";
      improves.push(
        effect.stat === "colonyCostReduction"
          ? `${label} -${effect.value.toFixed(2)} everywhere`
          : `${label} ${sign}${Math.round(effect.value * 100)}%`,
      );
    }
  }

  // Ship components are gated on technology too.
  for (const engine of ENGINE_TYPES) {
    if (engine.tech === tech.id) gains.push(`${engine.name} engines in the component designer`);
  }
  for (const sensor of SENSOR_TYPES) {
    if (sensor.tech === tech.id) gains.push(`${sensor.name} sensors in the component designer`);
  }
  if (tech.id === "engine-power-125") improves.push("Engine power modifier up to 1.25");
  if (tech.id === "fuel-consumption-08") improves.push("Every engine burns 20% less fuel");
  if (tech.id === "trans-newtonian") {
    const kinds = KINDS.filter((k) => !["engine", "survey-sensor", "jump-drive", "gate-module"].includes(k.kind)).map((k) => k.name);
    gains.push(`${kinds.join(", ")} in the component designer`);
  }
  if (tech.id === "grav-survey-sensors") gains.push("Finds the jump points in a system when a ship carrying one surveys it");
  if (tech.id === "jump-point-theory") gains.push("Jump Drives in the component designer: ships that can cross a jump point on their own");
  if (tech.id === "jump-gate-construction") gains.push("Gate Construction Modules: stabilise a jump point so any ship can cross it");

  return { gains, improves, opens: dependentsOf(tech.id) };
}

// ----------------------------------------------------------------- planning

export interface Setup {
  scientist: Officer;
  colonyId: string;
  labs: number;
}

export interface FreeLabs {
  colonyId: string;
  free: number;
}

export function freeLabs(empire: Empire): FreeLabs[] {
  const out: FreeLabs[] = [];
  for (const colony of empire.colonies.values()) {
    const free = installationCount(colony, "research-lab") - empire.labsInUse(colony.bodyId);
    if (free > 0) out.push({ colonyId: colony.bodyId, free });
  }
  return out.sort((a, b) => b.free - a.free);
}

export function freeScientists(empire: Empire, field?: ResearchField): Officer[] {
  return empire.officers
    .byBranch("science")
    .filter((o) => !o.assignment)
    .sort((a, b) => scientistScore(b, field) - scientistScore(a, field));
}

/** A specialist in the field first, then raw research bonus. */
export function scientistScore(officer: Officer, field?: ResearchField): number {
  return (officer.skills.research ?? 0) + (field && officer.specialty === field ? 100 : 0);
}

export interface Recommendation {
  setup: Setup | null;
  /** Why there is no setup, when there is none. */
  blocker: "no-scientist" | "no-labs" | null;
}

/** The best use of what is free right now for a given tech. */
export function recommend(empire: Empire, tech: Tech): Recommendation {
  const scientist = freeScientists(empire, tech.field)[0];
  if (!scientist) return { setup: null, blocker: "no-scientist" };
  const site = freeLabs(empire)[0];
  if (!site) return { setup: null, blocker: "no-labs" };
  return {
    setup: {
      scientist,
      colonyId: site.colonyId,
      labs: Math.max(1, Math.min(site.free, labCapacity(scientist))),
    },
    blocker: null,
  };
}

/** Years to finish a tech with a given setup, from its current progress. */
export function etaYears(
  empire: Empire,
  tech: Tech,
  scientist: Officer | undefined,
  colonyId: string,
  labs: number,
  progress = 0,
): number | null {
  const colony = empire.colony(colonyId);
  if (!colony || !scientist || labs <= 0) return null;
  const usable = Math.min(labs, labCapacity(scientist));
  const rate =
    usable * empire.stats.researchRate * employmentRatio(colony) * (1 + bonus(scientist, "research"));
  return rate > 0 ? Math.max(0, tech.cost - progress) / rate : null;
}

export const FIELD_ORDER = RESEARCH_FIELDS;
