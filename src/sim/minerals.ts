/**
 * Trans-Newtonian minerals.
 *
 * Deposits are generated deterministically from the body's id, so a given
 * world always surveys the same way, and are weighted by body class: metallic
 * asteroids run rich and shallow, gas giants hold only Sorium, and the inner
 * planets carry broad but deeply buried deposits.
 */

import type { BodyDef } from "../data/bodies";
import { hashString, mulberry32 } from "./system";

export const MINERALS = [
  "Duranium",
  "Neutronium",
  "Corbomite",
  "Tritanium",
  "Boronide",
  "Mercassium",
  "Vendarite",
  "Sorium",
  "Uridium",
  "Corundium",
  "Gallicite",
] as const;

export type MineralName = (typeof MINERALS)[number];

export interface MineralDeposit {
  mineral: MineralName;
  /** Tons in the deposit. */
  amount: number;
  /** 0.1 - 1.0. Mining output scales with this. */
  accessibility: number;
}

export function mineralsFor(def: BodyDef): MineralDeposit[] {
  if (def.cls === "star") return [];
  const rng = mulberry32(hashString(`minerals:${def.id}`));

  const gasGiant = def.cls === "planet" && def.massKg > 5e25;
  if (gasGiant) {
    // Sorium harvesting only - there is no surface to mine.
    return [
      {
        mineral: "Sorium",
        amount: Math.round(400_000 + rng() * 2_600_000),
        accessibility: 1.0,
      },
    ];
  }

  const small = def.cls === "asteroid" || def.cls === "comet";
  // Rough mass scaling: big worlds hold more of everything.
  const massScale = Math.min(6, Math.max(0.15, Math.log10(def.massKg / 1e18) / 3));
  const chance = small ? 0.3 : 0.45;

  const deposits: MineralDeposit[] = [];
  for (const mineral of MINERALS) {
    if (rng() > chance) continue;
    const richness = rng() ** 2;
    const amount = Math.round(richness * massScale * 250_000 + 1_000);
    if (amount < 2_000) continue;
    // Small bodies are undifferentiated, so what is there is easy to reach.
    const base = small ? 0.5 + rng() * 0.5 : 0.1 + rng() * 0.8;
    deposits.push({
      mineral,
      amount,
      accessibility: Math.round(base * 10) / 10,
    });
  }

  // Comets are volatile-rich by construction.
  if (def.cls === "comet" && !deposits.some((d) => d.mineral === "Sorium")) {
    deposits.push({
      mineral: "Sorium",
      amount: Math.round(20_000 + rng() * 60_000),
      accessibility: 0.8,
    });
  }

  return deposits.sort((a, b) => b.amount - a.amount);
}
