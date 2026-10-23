/**
 * The propulsion and power technology tree.
 *
 * Engines are Aurora's line: fifteen technologies, each simply more power per
 * hull space (ships/engines.ts), in three sub-fields of five. Power systems
 * (reactors) follow the specification in propusion-power-techs.ts: chemical,
 * nuclear, fusion, antimatter, one after another. Four secondary branches -
 * engine size, power modifier, miniaturisation, fuel efficiency - open once
 * the first engine exists.
 */

import type { Tech } from "./techs";
import { ENGINE_LINE, POWER_FAMILIES } from "../ships/engines";
import {
  ENGINE_SIZE_LADDER, FUEL_USE_LADDER, MINIATURE_LADDER, POWER_MODIFIER_LADDER,
} from "../ships/components";

const FIRST_ENGINE = "conventional-engine";

const POWER_ENTRY: Record<string, string[]> = {
  chemical: ["trans-newtonian"],
  nuclear: ["fuel-cell-4"],
  fusion: ["reactor-nuclear-4"],
  antimatter: ["reactor-fusion-4"],
};

const fmt = (v: number) => String(Math.round(v * 100) / 100);

function engineTechs(): Tech[] {
  return ENGINE_LINE.map((engine, i) => ({
    id: engine.id,
    name: engine.name,
    branch: engine.branch,
    field: "power" as const,
    cost: engine.cost,
    prereqs: i === 0 ? ["trans-newtonian"] : [ENGINE_LINE[i - 1].id],
    description:
      `An engine for the component designer making ${fmt(engine.power)} power per hull space` +
      (i > 0 ? `, ${fmt(Math.round((engine.power / ENGINE_LINE[i - 1].power) * 100) / 100)}x the engine before it.` : "."),
  }));
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
  "nuclear-thermal", "nuclear-pulse", "ion-drive", "magneto-plasma", "photonic-drive",
  "engine-power-125", "engine-power-150", "engine-power-175", "engine-power-200",
  "fuel-consumption-08", "fuel-consumption-07", "fuel-consumption-06", "fuel-consumption-05", "fuel-consumption-04",
  "fusion-magnetic", "fusion-inertial", "antimatter-solid", "antimatter-gas", "photonic-drive",
]);
