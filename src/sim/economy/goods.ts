/**
 * Pops and goods: who lives on a world, what they need, and whether they get it.
 *
 * Every colony's people fall into four groups - labourers, specialists,
 * merchants and spacers - in proportions set by the work the colony offers.
 * Each group needs food, consumer goods and luxuries in its own proportions,
 * and its satisfaction follows how much of that it gets. Colonies produce
 * goods (farms, consumer plants, luxury workshops, or simply good land) and
 * trade their surpluses along freight lines and civilian shipping.
 *
 * Satisfied groups work better and stay calm. Unsatisfied ones radicalise,
 * drag colony stability down and turn the factions they lean towards against
 * the government, so a shortage on one world becomes a political problem.
 */

import type { Empire } from "../../state/empire";
import type { Galaxy } from "../galaxy";
import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import { INSTALLATION_BY_ID } from "./installations";
import { employmentRatio } from "./production";
import { moraleFactor, NEUTRAL_TAX } from "./finance";
import { tradeLines } from "./trade";
import type { MineralName } from "../minerals";
import type { FactionId } from "../politics";

export type GoodId = "food" | "consumer" | "luxury";
export type PopId = "labourers" | "specialists" | "merchants" | "spacers";

export interface GoodDef {
  id: GoodId;
  name: string;
  /** What one unit is worth, for the levy on traded goods. */
  value: number;
  /** How much of a person's contentment this good decides. */
  weight: number;
}

export const GOODS: GoodDef[] = [
  { id: "food", name: "Food", value: 1, weight: 0.5 },
  { id: "consumer", name: "Consumer goods", value: 2, weight: 0.3 },
  { id: "luxury", name: "Luxuries", value: 6, weight: 0.2 },
];

export interface PopDef {
  id: PopId;
  name: string;
  blurb: string;
  /** Units of each good needed per million people per year. */
  needs: Record<GoodId, number>;
  /** How their politics divide among the factions; each row sums to one. */
  leaning: Record<FactionId, number>;
  /** What their contentment improves. */
  boosts: string;
}

export const POPS: PopDef[] = [
  { id: "labourers", name: "Labourers", blurb: "Miners, factory hands and farmers.",
    needs: { food: 1, consumer: 0.4, luxury: 0 },
    leaning: { industrialists: 0.15, academy: 0, colonists: 0.25, civic: 0.55, admiralty: 0.05 },
    boosts: "construction and mining output" },
  { id: "specialists", name: "Specialists", blurb: "Scientists, engineers and technicians.",
    needs: { food: 1, consumer: 0.6, luxury: 0.25 },
    leaning: { industrialists: 0.15, academy: 0.6, colonists: 0.1, civic: 0.1, admiralty: 0.05 },
    boosts: "research output" },
  { id: "merchants", name: "Merchants", blurb: "Traders, financiers and shopkeepers.",
    needs: { food: 1, consumer: 0.6, luxury: 0.5 },
    leaning: { industrialists: 0.55, academy: 0.05, colonists: 0.25, civic: 0.1, admiralty: 0.05 },
    boosts: "taxes and trade" },
  { id: "spacers", name: "Spacers", blurb: "Dockers, crews and refinery hands.",
    needs: { food: 1, consumer: 0.5, luxury: 0.15 },
    leaning: { industrialists: 0.05, academy: 0.05, colonists: 0.35, civic: 0.1, admiralty: 0.45 },
    boosts: "fuel production" },
];

export const POP_BY_ID = new Map(POPS.map((p) => [p.id, p]));

export interface PopGroup {
  id: PopId;
  /** Share of the colony's people, 0 to 1. */
  share: number;
  /** Contentment, 0 to 100. */
  satisfaction: number;
  /** Willingness to make trouble, 0 to 100. */
  radicalism: number;
}

/** What people do for a living when nothing in particular is offered. */
const BASE_SHARE: Record<PopId, number> = { labourers: 0.55, specialists: 0.15, merchants: 0.15, spacers: 0.15 };

/** Which kind of person staffs which installation. */
const JOBS: Record<string, PopId> = {
  mine: "labourers", "construction-factory": "labourers", "hydroponic-farm": "labourers", "consumer-plant": "labourers",
  "research-lab": "specialists", maintenance: "specialists", terraforming: "specialists",
  "financial-centre": "merchants", "luxury-workshop": "merchants",
  "fuel-refinery": "spacers", shipyard: "spacers", spaceport: "spacers",
};

export function defaultPops(): PopGroup[] {
  return POPS.map((p) => ({ id: p.id, share: BASE_SHARE[p.id], satisfaction: 70, radicalism: 0 }));
}

export function popGroup(colony: Colony, id: PopId): PopGroup {
  return colony.pops.find((g) => g.id === id) ?? defaultPops().find((g) => g.id === id)!;
}

/** The shares a colony's installations pull its people towards. */
export function targetShares(colony: Colony): Record<PopId, number> {
  const jobs: Record<PopId, number> = { labourers: 0, specialists: 0, merchants: 0, spacers: 0 };
  let total = 0;
  for (const [id, count] of Object.entries(colony.installations)) {
    const group = JOBS[id];
    if (!group) continue;
    const workers = Math.max(0.05, INSTALLATION_BY_ID.get(id)?.workers ?? 0.05) * count;
    jobs[group] += workers;
    total += workers;
  }
  const out = { ...BASE_SHARE };
  if (total > 0) for (const id of Object.keys(out) as PopId[]) out[id] = 0.5 * BASE_SHARE[id] + 0.5 * (jobs[id] / total);
  return out;
}

/** A good world feeds itself and then some. */
export const NATURAL_FOOD = 1.25;
export const FARM_OUTPUT = 100;
export const CONSUMER_OUTPUT = 100;
export const LUXURY_OUTPUT = 40;
/** Tons of mineral consumed per unit made. */
export const CONSUMER_INPUT: [MineralName, number] = ["Corundium", 0.2];
export const LUXURY_INPUT: [MineralName, number] = ["Gallicite", 0.5];
/** Units a full freight link can move per year, and what civilian shipping moves per colony. */
export const LINK_FLOW = 3000;
export const CIVILIAN_FLOW = 1500;
/** Share of the value of traded goods that reaches the treasury. */
export const TRADE_LEVY = 0.15;
/** A plant needs this much of a year's input in hand to run flat out (five days). */
const STOCK_DAYS_YEARS = 5 / 365.25;

// ------------------------------------------------------------------ market

export interface GoodFlow {
  supply: number;
  demand: number;
  imported: number;
  exported: number;
  /** 0 to 1: how much of the demand is met. */
  met: number;
}

export interface ColonyMarket {
  goods: Record<GoodId, GoodFlow>;
  /** Minerals the colony's plants would use in a year. */
  inputs: Partial<Record<MineralName, number>>;
}

export interface Market {
  colonies: Map<string, ColonyMarket>;
  /** Value of everything that crossed between colonies, per year. */
  tradedValue: number;
  levy: number;
}

const emptyFlow = (): GoodFlow => ({ supply: 0, demand: 0, imported: 0, exported: 0, met: 1 });

/** Fertility of a world: 1 for a garden world, 0 where food must be grown under glass. */
export function fertility(colonyCost: number): number {
  if (!Number.isFinite(colonyCost)) return 0;
  return Math.max(0, Math.min(1, 1 - colonyCost / 1.5));
}

export function demandOf(colony: Colony, good: GoodId): number {
  let total = 0;
  for (const g of colony.pops) total += colony.population * g.share * POP_BY_ID.get(g.id)!.needs[good];
  return total;
}

/** Supply at one colony, limited by the minerals its plants need. */
function supplyOf(system: Galaxy, colony: Colony): { supply: Record<GoodId, number>; inputs: Partial<Record<MineralName, number>> } {
  const body = system.byId.get(colony.bodyId);
  const employment = employmentRatio(colony);
  const morale = moraleFactor(colony.stability);
  const farms = installationCount(colony, "hydroponic-farm") * FARM_OUTPUT * employment * morale;
  const natural = body ? colony.population * NATURAL_FOOD * fertility(body.colonyCost) : 0;
  const inputs: Partial<Record<MineralName, number>> = {};

  const plantOutput = (count: number, perUnit: number, [mineral, perTon]: [MineralName, number]) => {
    const wanted = count * perUnit * employment * morale;
    if (wanted <= 0) return 0;
    const need = wanted * perTon;
    inputs[mineral] = (inputs[mineral] ?? 0) + need;
    // Without a few days' stock of the mineral the plant idles.
    return wanted * Math.min(1, colony.stockpile[mineral] / (need * STOCK_DAYS_YEARS));
  };
  return {
    supply: {
      food: farms + natural,
      consumer: plantOutput(installationCount(colony, "consumer-plant"), CONSUMER_OUTPUT, CONSUMER_INPUT),
      luxury: plantOutput(installationCount(colony, "luxury-workshop"), LUXURY_OUTPUT, LUXURY_INPUT),
    },
    inputs,
  };
}

const memo = new WeakMap<Empire, Market>();

const summaryMemo = new WeakMap<Empire, PopSummary[]>();

export function invalidateMarket(empire: Empire): void {
  memo.delete(empire);
  summaryMemo.delete(empire);
}

/** Move surplus to want, within a pool or along a line, and record what moved. */
function ship(
  market: Map<string, ColonyMarket>, good: GoodId, from: string, to: string, cap: number,
): number {
  const a = market.get(from)!.goods[good];
  const b = market.get(to)!.goods[good];
  const spare = a.supply - a.demand - a.exported + a.imported;
  const wanted = b.demand - b.supply - b.imported + b.exported;
  const moved = Math.min(spare, wanted, cap);
  if (moved <= 1e-9) return 0;
  a.exported += moved;
  b.imported += moved;
  return moved;
}

export function computeMarket(empire: Empire, system: Galaxy): Market {
  const cached = memo.get(empire);
  if (cached) return cached;

  const colonies = new Map<string, ColonyMarket>();
  for (const colony of empire.colonies.values()) {
    if (colony.population <= 0.1) continue;
    const { supply, inputs } = supplyOf(system, colony);
    const goods = { food: emptyFlow(), consumer: emptyFlow(), luxury: emptyFlow() } as Record<GoodId, GoodFlow>;
    for (const good of GOODS) {
      goods[good.id].supply = supply[good.id];
      goods[good.id].demand = demandOf(colony, good.id);
    }
    colonies.set(colony.bodyId, { goods, inputs });
  }

  let tradedValue = 0;
  const value = (good: GoodId) => GOODS.find((g) => g.id === good)!.value;

  // Civilian shipping: a pool within each system.
  if (empire.civilianShipping) {
    const bySystem = new Map<string, string[]>();
    for (const id of colonies.keys()) {
      const sys = system.byId.get(id)?.systemId ?? "sol";
      (bySystem.get(sys) ?? bySystem.set(sys, []).get(sys)!).push(id);
    }
    for (const ids of bySystem.values()) {
      if (ids.length < 2) continue;
      for (const good of GOODS) {
        let budget = CIVILIAN_FLOW * ids.length;
        const givers = ids.filter((id) => colonies.get(id)!.goods[good.id].supply > colonies.get(id)!.goods[good.id].demand);
        const takers = ids.filter((id) => colonies.get(id)!.goods[good.id].supply < colonies.get(id)!.goods[good.id].demand);
        for (const taker of takers) {
          for (const giver of givers) {
            if (budget <= 0) break;
            const moved = ship(colonies, good.id, giver, taker, budget);
            budget -= moved;
            tradedValue += moved * value(good.id);
          }
        }
      }
    }
  }

  // Freight lines, in both directions, as far as their holds allow.
  for (const line of tradeLines(empire).sort((a, b) => a.fleetId.localeCompare(b.fleetId))) {
    if (!colonies.has(line.fromId) || !colonies.has(line.toId)) continue;
    const cap = LINK_FLOW * line.strength;
    for (const good of GOODS) {
      for (const [from, to] of [[line.fromId, line.toId], [line.toId, line.fromId]] as const) {
        tradedValue += ship(colonies, good.id, from, to, cap) * value(good.id);
      }
    }
  }

  for (const m of colonies.values()) {
    for (const good of GOODS) {
      const f = m.goods[good.id];
      f.met = f.demand <= 1e-9 ? 1 : Math.min(1, (f.supply + f.imported - f.exported > f.demand ? f.demand : Math.max(0, f.supply + f.imported - f.exported)) / f.demand);
    }
  }

  const market: Market = { colonies, tradedValue, levy: tradedValue * TRADE_LEVY };
  memo.set(empire, market);
  return market;
}

// ------------------------------------------------------------- satisfaction

/** The contentment a group is heading for, given how well its needs are met. */
export function satisfactionTarget(empire: Empire, group: PopId, flows: Record<GoodId, GoodFlow>): number {
  const needs = POP_BY_ID.get(group)!.needs;
  let weights = 0;
  let served = 0;
  for (const good of GOODS) {
    if (needs[good.id] <= 0) continue;
    weights += good.weight;
    served += good.weight * flows[good.id].met;
  }
  const fulfilment = weights > 0 ? served / weights : 1;
  return Math.max(0, Math.min(100, 10 + 70 * fulfilment + empire.welfare * 50 - (empire.taxRate - NEUTRAL_TAX) * 30));
}

/** 1 at a neutral 70; contented groups work a little better, sullen ones worse. */
export function popFactor(colony: Colony, id: PopId): number {
  const sat = popGroup(colony, id).satisfaction;
  return Math.max(0.8, Math.min(1.1, 1 + (sat - 70) * 0.003));
}

export function meanSatisfaction(colony: Colony): number {
  return colony.pops.reduce((s, g) => s + g.share * g.satisfaction, 0);
}

export function meanRadicalism(colony: Colony): number {
  return colony.pops.reduce((s, g) => s + g.share * g.radicalism, 0);
}

/** What the mood of the colony's people does to its stability. */
export function popStability(colony: Colony): number {
  const sat = meanSatisfaction(colony) - 65;
  return (sat < 0 ? sat * 0.6 : sat * 0.2) - meanRadicalism(colony) * 0.15;
}

/** Advance the people of every colony by one cycle. */
export function runPops(empire: Empire, system: Galaxy, year: number, now: number): void {
  const market = computeMarket(empire, system);
  for (const colony of empire.colonies.values()) {
    const m = market.colonies.get(colony.bodyId);
    if (!m) continue;
    const name = system.byId.get(colony.bodyId)?.name ?? colony.bodyId;

    // Plants draw on the stockpile for the goods they actually made.
    for (const [mineral, need] of Object.entries(m.inputs) as [MineralName, number][]) {
      colony.stockpile[mineral] = Math.max(0, colony.stockpile[mineral] - Math.min(need * year, colony.stockpile[mineral]));
    }

    // Shares drift towards what the work calls for.
    const target = targetShares(colony);
    for (const g of colony.pops) g.share += (target[g.id] - g.share) * Math.min(1, 0.2 * year);
    const sum = colony.pops.reduce((s, g) => s + g.share, 0);
    for (const g of colony.pops) g.share /= sum;

    for (const g of colony.pops) {
      const before = g.satisfaction;
      const goal = satisfactionTarget(empire, g.id, m.goods);
      g.satisfaction += (goal - before) * Math.min(1, 0.8 * year);
      const swing = g.satisfaction < 40 ? (40 - g.satisfaction) * 2 : g.satisfaction > 60 ? -10 : 0;
      const radBefore = g.radicalism;
      g.radicalism = Math.max(0, Math.min(100, g.radicalism + swing * year));
      if (radBefore < 50 && g.radicalism >= 50) {
        empire.addLog(now, "colony", `The ${POP_BY_ID.get(g.id)!.name.toLowerCase()} of ${name} are radicalising: ${shortfall(m)}.`, { view: "colonies", bodyId: colony.bodyId });
      }
    }

    // People starve.
    const food = m.goods.food.met;
    if (food < 0.6) {
      colony.population = Math.max(0, colony.population * (1 - (0.6 - food) * 0.3 * year));
      if (food < 0.3 && !colony.starving) {
        colony.starving = true;
        empire.addLog(now, "colony", `Famine on ${name}: only ${Math.round(food * 100)}% of the food it needs.`, { view: "colonies", bodyId: colony.bodyId });
      }
    } else if (colony.starving && food >= 0.6) {
      colony.starving = false;
    }
  }
}

function shortfall(m: ColonyMarket): string {
  const short = GOODS.filter((g) => m.goods[g.id].met < 0.8).map((g) => `${g.name.toLowerCase()} ${Math.round(m.goods[g.id].met * 100)}%`);
  return short.length ? short.join(", ") : "a long grievance";
}

// ------------------------------------------------------------- the nation

export interface PopSummary {
  id: PopId;
  /** Millions of people. */
  people: number;
  /** Share of everyone. */
  share: number;
  satisfaction: number;
  radicalism: number;
}

/** Each group across the whole empire, weighted by where its people live. */
export function summarisePops(empire: Empire): PopSummary[] {
  const cached = summaryMemo.get(empire);
  if (cached) return cached;
  let total = 0;
  const people: Record<PopId, number> = { labourers: 0, specialists: 0, merchants: 0, spacers: 0 };
  const sat: Record<PopId, number> = { ...people };
  const rad: Record<PopId, number> = { ...people };
  for (const colony of empire.colonies.values()) {
    for (const g of colony.pops) {
      const n = colony.population * g.share;
      people[g.id] += n;
      sat[g.id] += n * g.satisfaction;
      rad[g.id] += n * g.radicalism;
      total += n;
    }
  }
  const out = POPS.map((p) => ({
    id: p.id,
    people: people[p.id],
    share: total > 0 ? people[p.id] / total : BASE_SHARE[p.id],
    satisfaction: people[p.id] > 0 ? sat[p.id] / people[p.id] : 70,
    radicalism: people[p.id] > 0 ? rad[p.id] / people[p.id] : 0,
  }));
  summaryMemo.set(empire, out);
  return out;
}

/**
 * How the people who lean towards a faction feel about the government: the
 * mood of its base, and how worked up that base has become.
 */
export function baseMood(empire: Empire, faction: FactionId): { mood: number; radicalism: number } {
  const groups = summarisePops(empire);
  let weight = 0;
  let mood = 0;
  let radicalism = 0;
  for (const g of groups) {
    const w = POP_BY_ID.get(g.id)!.leaning[faction] * g.share;
    weight += w;
    mood += w * g.satisfaction;
    radicalism += w * g.radicalism;
  }
  return weight > 0 ? { mood: mood / weight, radicalism: radicalism / weight } : { mood: 70, radicalism: 0 };
}

/** The political weight each faction's base carries: leanings weighted by who the people are. */
export function popInfluence(empire: Empire): Record<FactionId, number> {
  const out = { industrialists: 0, academy: 0, colonists: 0, civic: 0, admiralty: 0 } as Record<FactionId, number>;
  for (const g of summarisePops(empire)) {
    for (const f of Object.keys(out) as FactionId[]) out[f] += POP_BY_ID.get(g.id)!.leaning[f] * g.share;
  }
  return out;
}
