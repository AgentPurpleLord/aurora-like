/**
 * The propulsion and power technology tree, built from the specification in
 * propusion-power-techs.ts (via ships/engines.ts and the ladders in
 * ships/components.ts). Replaces the old nuclear thermal / ion / plasma line.
 *
 * Order of unlocking:
 *  - Chemical rockets first; the other engine families follow in turn.
 *  - Electric drives need a chemical fuel cell to power them; thermal engines
 *    follow the second chemical tier; nuclear electric needs the first nuclear
 *    reactor and an electric drive; fusion needs all of nuclear electric;
 *    antimatter needs all of fusion.
 *  - Power systems are stepped through in order: chemical, nuclear, fusion,
 *    antimatter.
 *  - The four secondary branches (engine size, power modifier,
 *    miniaturisation, fuel efficiency) open once a first engine exists.
 */

import type { Tech } from "./techs";
import {
  ENGINE_FAMILIES, POWER_FAMILIES, tierEfficiency, BASE_POWER_PER_HS,
} from "../ships/engines";
import {
  ENGINE_SIZE_LADDER, FUEL_USE_LADDER, MINIATURE_LADDER, POWER_MODIFIER_LADDER,
} from "../ships/components";

const FIRST_ENGINE = "solid-motor";

/** Where each family's first tier hangs. */
const ENGINE_ENTRY: Record<string, string[]> = {
  chemical: ["trans-newtonian"],
  electric: [FIRST_ENGINE, "fuel-cell-1"],
  "nuclear-thermal": ["pressure-fed"],
  "nuclear-electric": ["resistojet", "reactor-nuclear-1"],
  fusion: ["ne-adv-electric"],
  antimatter: ["fusion-direct"],
};

const POWER_ENTRY: Record<string, string[]> = {
  chemical: ["trans-newtonian"],
  nuclear: ["fuel-cell-4"],
  fusion: ["reactor-nuclear-4"],
  antimatter: ["reactor-fusion-4"],
};

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

function engineTechs(): Tech[] {
  const out: Tech[] = [];
  for (const family of ENGINE_FAMILIES) {
    family.tiers.forEach((tier, i) => {
      out.push({
        id: tier.id,
        name: tier.name,
        branch: family.name,
        field: "power",
        cost: tier.cost,
        prereqs: i === 0 ? ENGINE_ENTRY[family.id] : [family.tiers[i - 1].id],
        description:
          `${family.blurb} Engine for the component designer: ${fmt(BASE_POWER_PER_HS * family.density)} power per hull space, ` +
          `${fmt(Math.round(tierEfficiency(family, i) * 10) / 10)}x a chemical rocket's fuel economy` +
          (family.powerDraw > 0 ? `, and it draws reactor power (${family.powerDraw} per hull space).` : "."),
      });
    });
  }
  return out;
}

function powerTechs(): Tech[] {
  const out: Tech[] = [];
  for (const family of POWER_FAMILIES) {
    family.tiers.forEach((tier, i) => {
      out.push({
        id: tier.id,
        name: tier.name,
        branch: `${family.name} Power`,
        field: "power",
        cost: tier.cost,
        prereqs: i === 0 ? POWER_ENTRY[family.id] : [family.tiers[i - 1].id],
        description: `A ${family.name.toLowerCase()} reactor for the component designer, making ${tier.output} power per hull space. Electric drives draw on reactor power; a ship without enough cannot fly.`,
      });
    });
  }
  return out;
}

/** Costs double each tier, starting at `first`. */
const doubling = (first: number, i: number) => first * Math.pow(2, i);

function secondary(): Tech[] {
  const out: Tech[] = [];
  ENGINE_SIZE_LADDER.forEach(([id, hs], i) => out.push({
    id, name: `${hs} Hull Spaces`, branch: "Engine Size", field: "power", cost: doubling(2000, i),
    prereqs: [i === 0 ? FIRST_ENGINE : ENGINE_SIZE_LADDER[i - 1][0]],
    description: `A single engine may be up to ${hs} hull spaces (the largest is 400).`,
  }));
  POWER_MODIFIER_LADDER.forEach(([id, value], i) => out.push({
    id, name: `Power Modifier x${value}`, branch: "Power Modifier", field: "power", cost: doubling(2000, i),
    prereqs: [i === 0 ? FIRST_ENGINE : POWER_MODIFIER_LADDER[i - 1][0]],
    description: `Raises the engine power modifier ceiling to ${value}x: more thrust from the same engine, at a fuel premium that grows with its square.`,
  }));
  MINIATURE_LADDER.forEach(([id, value], i) => out.push({
    id, name: `Miniaturisation ${value}x`, branch: "Miniaturisation", field: "power", cost: doubling(1000, i),
    prereqs: [i === 0 ? FIRST_ENGINE : MINIATURE_LADDER[i - 1][0]],
    description: `Engines take up only ${value}x the hull space for the same thrust, on every ship, existing ones included.`,
  }));
  FUEL_USE_LADDER.forEach(([id, value], i) => out.push({
    id, name: `Fuel Use ${value}x`, branch: "Fuel Efficiency", field: "power", cost: doubling(1000, i),
    prereqs: [i === 0 ? FIRST_ENGINE : FUEL_USE_LADDER[i - 1][0]],
    description: `Every engine burns fuel at ${value}x the rate, existing ships included.`,
  }));
  return out;
}

export const PROPULSION_TECHS: Tech[] = [...engineTechs(), ...powerTechs(), ...secondary()];

/** The ids this module owns, so the old tree's engine techs can be dropped. */
export const REPLACED_TECH_IDS = new Set([
  "nuclear-thermal", "nuclear-pulse", "ion-drive", "magneto-plasma",
  "engine-power-125", "engine-power-150", "engine-power-175", "engine-power-200",
  "fuel-consumption-08", "fuel-consumption-07", "fuel-consumption-06", "fuel-consumption-05", "fuel-consumption-04",
  "fusion-magnetic", "fusion-inertial", "antimatter-solid", "antimatter-gas", "photonic-drive",
]);
