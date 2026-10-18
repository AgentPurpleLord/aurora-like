/** A populated (or merely occupied) body, and what it is building. */

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
  /** Queued by a standing order rather than by hand. */
  auto: boolean;
}

export interface Colony {
  bodyId: string;
  /** Millions of people. */
  population: number;
  installations: Record<string, number>;
  stockpile: Record<MineralName, number>;
  /** Litres. */
  fuel: number;
  buildQueue: BuildOrder[];
  /** Colony cost permanently removed by terraforming. */
  terraformed: number;
  /** Body id this colony's mass drivers throw minerals to. */
  massDriverTarget: string | null;
  /** What the governor posted here is allowed to propose. */
  policy: GovernorPolicy;
  founded: number;
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
    stockpile: emptyStockpile(),
    fuel: 0,
    buildQueue: [],
    terraformed: 0,
    massDriverTarget: null,
    policy: "none",
    founded,
  };
}

export function installationCount(colony: Colony, id: string): number {
  return colony.installations[id] ?? 0;
}

export function totalInstallations(colony: Colony): number {
  return Object.values(colony.installations).reduce((sum, n) => sum + n, 0);
}
