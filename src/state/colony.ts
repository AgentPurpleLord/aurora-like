/** A populated (or merely occupied) body, and what it is building. */

import { defaultPops, type PopGroup } from "../sim/economy/goods";
import { MINERALS, type MineralName } from "../sim/minerals";
import type { GovernorPolicy } from "../sim/governors";

export interface BuildOrder {
  id: string;
  installationId: string;
  /**
   * Colony the finished installation is delivered to. Null means it stays
   * where it was built. Build points and minerals always come from the
   * producing colony.
   */
  destination: string | null;
  /** Units still to build, including the one in progress. */
  quantity: number;
  /** Build points applied to the unit currently under construction. */
  progress: number;
  /** Set when the last cycle could not draw the minerals it needed. */
  starved: boolean;
  /** Ship class being built, when this is a hull rather than an installation. */
  designId: string | null;
  /** Queued by a standing order rather than by hand. */
  auto: boolean;
}

export interface Colony {
  bodyId: string;
  /** Millions of people. */
  population: number;
  installations: Record<string, number>;
  /** Built but not yet installed: crated up, waiting for a ship. */
  stored: Record<string, number>;
  stockpile: Record<MineralName, number>;
  /** Litres. */
  fuel: number;
  buildQueue: BuildOrder[];
  /** What the terraformers here are doing, if anything. */
  terraforming: { gasId: string; mode: "add" | "remove" } | null;
  /** Body id this colony's mass drivers throw minerals to. */
  massDriverTarget: string | null;
  /** What the governor posted here is allowed to propose. */
  policy: GovernorPolicy;
  founded: number;
  /** How content the people are, 0 to 100. 70 is neutral. */
  stability: number;
  /** The groups of people who live here; see economy/goods.ts. */
  pops: PopGroup[];
  /** Set while the colony is in famine, to log it once. */
  starving?: boolean;
}

export function emptyStockpile(): Record<MineralName, number> {
  const stock = {} as Record<MineralName, number>;
  for (const mineral of MINERALS) stock[mineral] = 0;
  return stock;
}

export function createColony(bodyId: string, founded: number): Colony {
  return {
    bodyId,
    population: 0,
    installations: {},
    stored: {},
    stockpile: emptyStockpile(),
    fuel: 0,
    buildQueue: [],
    terraforming: null,
    massDriverTarget: null,
    policy: "none",
    founded,
    stability: 70,
    pops: defaultPops(),
  };
}

export function installationCount(colony: Colony, id: string): number {
  return colony.installations[id] ?? 0;
}

export function totalInstallations(colony: Colony): number {
  return Object.values(colony.installations).reduce((sum, n) => sum + n, 0);
}
