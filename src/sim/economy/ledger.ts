/**
 * Empire-wide planning figures.
 *
 * These answer the questions the per-colony screens cannot: is the empire
 * running out of Duranium, what will this order actually cost me, and when
 * will it be finished. Everything here is derived on demand from state - no
 * cached totals to drift.
 */

import type { Empire } from "../../state/empire";
import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import type { Body, StarSystem } from "../system";
import { MINERALS, type MineralName } from "../minerals";
import { DAYS_PER_YEAR, SECONDS_PER_DAY } from "../orbit";
import { colonyOutput } from "./production";

const FUEL_PER_SORIUM = 2000;

export interface LedgerRow {
  mineral: MineralName;
  /** Tons held across every colony. */
  stockpile: number;
  /** Tons mined per year across the empire. */
  production: number;
  /** Tons per year committed to build queues and refineries. */
  demand: number;
  net: number;
  /** Years until the stockpile runs out at the current net rate. */
  cover: number;
  /** Tons still in the ground at bodies the empire is actually mining. */
  reserves: number;
  /** Years until those reserves are exhausted at the current rate. */
  reservesYears: number;
}

/**
 * Minerals a colony's build queue will consume over a year, given the build
 * points it can actually produce. Mirrors how the production cycle spends -
 * down the queue, in order, until the budget runs out.
 */
export function queueDemand(
  empire: Empire,
  colony: Colony,
  annualBuildPoints: number,
): Partial<Record<MineralName, number>> {
  const demand: Partial<Record<MineralName, number>> = {};
  let remaining = annualBuildPoints;

  for (const order of colony.buildQueue) {
    if (remaining <= 0) break;
    const buildable = empire.buildableOf(order);
    if (!buildable) continue;
    const outstanding = order.quantity * buildable.cost - order.progress;
    const applied = Math.min(remaining, Math.max(0, outstanding));
    if (applied <= 0) continue;
    for (const [mineral, tons] of Object.entries(buildable.minerals) as [MineralName, number][]) {
      demand[mineral] = (demand[mineral] ?? 0) + (tons / buildable.cost) * applied;
    }
    remaining -= applied;
  }
  return demand;
}

/** Build points still outstanding across a colony's whole queue. */
export function queuedBuildPoints(empire: Empire, colony: Colony): number {
  let total = 0;
  for (const order of colony.buildQueue) {
    const buildable = empire.buildableOf(order);
    if (!buildable) continue;
    total += Math.max(0, order.quantity * buildable.cost - order.progress);
  }
  return total;
}

export function mineralLedger(empire: Empire, system: StarSystem): LedgerRow[] {
  const stockpile: Record<string, number> = {};
  const production: Record<string, number> = {};
  const demand: Record<string, number> = {};
  const reserves: Record<string, number> = {};

  for (const colony of empire.colonies.values()) {
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    const output = colonyOutput(empire, body, colony, empire.stats);

    for (const mineral of MINERALS) {
      stockpile[mineral] = (stockpile[mineral] ?? 0) + colony.stockpile[mineral];
      production[mineral] = (production[mineral] ?? 0) + (output.mining[mineral] ?? 0);
    }

    for (const [mineral, tons] of Object.entries(queueDemand(empire, colony, output.buildPoints))) {
      demand[mineral] = (demand[mineral] ?? 0) + (tons ?? 0);
    }

    // Refineries eat Sorium whether or not anything is being built.
    if (output.fuel > 0) {
      demand.Sorium = (demand.Sorium ?? 0) + output.fuel / FUEL_PER_SORIUM;
    }

    // Only count what the empire can actually reach: deposits under a colony
    // that has the mines to work them.
    if (effectiveMineCount(colony) > 0) {
      for (const deposit of body.minerals) {
        reserves[deposit.mineral] = (reserves[deposit.mineral] ?? 0) + deposit.amount;
      }
    }
  }

  return MINERALS.map((mineral) => {
    const held = stockpile[mineral] ?? 0;
    const made = production[mineral] ?? 0;
    const used = demand[mineral] ?? 0;
    const net = made - used;
    const inGround = reserves[mineral] ?? 0;
    return {
      mineral,
      stockpile: held,
      production: made,
      demand: used,
      net,
      cover: net >= 0 ? Infinity : held / -net,
      reserves: inGround,
      reservesYears: made > 0 ? inGround / made : Infinity,
    };
  });
}

function effectiveMineCount(colony: Colony): number {
  return installationCount(colony, "mine") + installationCount(colony, "automated-mine");
}

// ---------------------------------------------------------------- previews

export interface PreviewMineral {
  mineral: MineralName;
  required: number;
  held: number;
  shortfall: number;
  /** Years of empire-wide cover before and after paying for this order. */
  coverBefore: number;
  coverAfter: number;
  /** Years of empire-wide mining needed to replace what this order consumes. */
  replacementYears: number;
}

export interface OrderPreview {
  name: string;
  /** Units of each installation the preview covers. */
  items: { installationId: string; quantity: number }[];
  buildPoints: number;
  /** Build points already queued ahead of this order. */
  queuedAhead: number;
  /** Build points this colony produces each year. */
  annualBuildPoints: number;
  /** Years until this order finishes, counting everything ahead of it. */
  years: number;
  completionSeconds: number;
  minerals: PreviewMineral[];
  /** The colony cannot cover the minerals from its own stockpile today. */
  affordable: boolean;
  /** Nothing is being built here, so the order would never start. */
  noIndustry: boolean;
}

/**
 * What an order would cost and when it would land, computed before the
 * player commits to it.
 */
export function previewOrder(
  empire: Empire,
  system: StarSystem,
  colony: Colony,
  installationId: string,
  quantity: number,
  ledger?: LedgerRow[],
  designId: string | null = null,
): OrderPreview | null {
  const buildable = empire.buildableOf({ installationId, designId });
  if (!buildable) return null;
  return previewItems(
    empire,
    system,
    colony,
    [{ installationId, quantity, designId }],
    buildable.name,
    ledger,
  );
}

/**
 * The same preview for a set of items at once - what a template would cost
 * if it were applied here.
 */
export function previewItems(
  empire: Empire,
  system: StarSystem,
  colony: Colony,
  items: { installationId: string; quantity: number; designId?: string | null }[],
  name = "Selected items",
  ledger?: LedgerRow[],
): OrderPreview | null {
  const body = system.byId.get(colony.bodyId);
  if (!body || !items.length) return null;

  const rows = ledger ?? mineralLedger(empire, system);
  const annual = colonyOutput(empire, body, colony, empire.stats).buildPoints;

  let buildPoints = 0;
  const required: Partial<Record<MineralName, number>> = {};
  for (const item of items) {
    const buildable = empire.buildableOf({
      installationId: item.installationId,
      designId: item.designId ?? null,
    });
    if (!buildable || item.quantity <= 0) continue;
    buildPoints += buildable.cost * item.quantity;
    for (const [mineral, tons] of Object.entries(buildable.minerals) as [MineralName, number][]) {
      required[mineral] = (required[mineral] ?? 0) + tons * item.quantity;
    }
  }

  const queuedAhead = queuedBuildPoints(empire, colony);
  const years = annual > 0 ? (queuedAhead + buildPoints) / annual : Infinity;

  const minerals: PreviewMineral[] = [];
  for (const [mineral, tons] of Object.entries(required) as [MineralName, number][]) {
    const held = colony.stockpile[mineral];
    const row = rows.find((r) => r.mineral === mineral);
    const drain = row ? Math.max(0, -row.net) : 0;
    const production = row?.production ?? 0;
    minerals.push({
      mineral,
      required: tons,
      held,
      shortfall: Math.max(0, tons - held),
      coverBefore: row?.cover ?? Infinity,
      coverAfter: drain > 0 ? Math.max(0, (row!.stockpile - tons) / drain) : Infinity,
      replacementYears: production > 0 ? tons / production : Infinity,
    });
  }
  minerals.sort((a, b) => b.required - a.required);

  return {
    name,
    items: items.filter((i) => i.quantity > 0),
    buildPoints,
    queuedAhead,
    annualBuildPoints: annual,
    years,
    completionSeconds:
      Number.isFinite(years) ? years * DAYS_PER_YEAR * SECONDS_PER_DAY : Infinity,
    minerals,
    affordable: minerals.every((m) => m.shortfall <= 0),
    noIndustry: annual <= 0,
  };
}

/** Colonies sorted for the dashboard table, with their headline figures. */
export interface ColonyRow {
  colony: Colony;
  body: Body;
  population: number;
  growth: number;
  employment: number;
  buildPoints: number;
  researchPoints: number;
  wealth: number;
  mining: number;
  queueDepth: number;
  /** Years until the head of the queue completes. */
  nextCompletion: number;
  stalled: boolean;
}

export function colonyRows(empire: Empire, system: StarSystem): ColonyRow[] {
  const rows: ColonyRow[] = [];
  for (const colony of empire.colonies.values()) {
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    const output = colonyOutput(empire, body, colony, empire.stats);
    const head = colony.buildQueue[0];
    const headBuildable = head ? empire.buildableOf(head) : undefined;
    const headRemaining = head && headBuildable
      ? head.quantity * headBuildable.cost - head.progress
      : 0;

    rows.push({
      colony,
      body,
      population: colony.population,
      growth: output.populationGrowth,
      employment: output.employment,
      buildPoints: output.buildPoints,
      researchPoints: output.researchPoints,
      wealth: output.wealth,
      mining: Object.values(output.mining).reduce((sum, v) => sum + (v ?? 0), 0),
      queueDepth: colony.buildQueue.length,
      nextCompletion: output.buildPoints > 0 ? headRemaining / output.buildPoints : Infinity,
      stalled: colony.buildQueue.some((o) => o.starved),
    });
  }
  return rows;
}
