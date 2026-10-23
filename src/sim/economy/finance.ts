/**
 * Money and what it does.
 *
 * Wealth is not a score. Taxes buy a government its income but cost it the
 * goodwill of its people; trade grows where colonies are many and contented;
 * welfare spending buys calm; debt costs interest and unrest; and a full
 * treasury can be spent on programmes that speed industry, research, mining
 * or settlement for a few years.
 *
 * Everything here is a pure function of state, so the figures shown to the
 * player are the figures being simulated.
 */

import type { Empire, EffectKind } from "../../state/empire";

/** The tax rate at which a colony is neither pleased nor aggrieved. */
export const NEUTRAL_TAX = 0.3;
export const MAX_TAX = 0.6;
export const MAX_WELFARE = 0.15;
/** Taxable output per million people per year, before the tax rate is applied. */
export const GDP_PER_MILLION = 2.5 / NEUTRAL_TAX;
/** Commerce per million people per year, before connections and stability. */
export const TRADE_PER_MILLION = 0.4;
/** Share of a debt added every year as interest. */
export const DEBT_INTEREST = 0.06;
export const BASE_STABILITY = 70;
/** How fast stability moves towards what circumstances call for, per year. */
export const STABILITY_DRIFT = 0.5;

export const UNREST_BELOW = 40;
export const RIOTS_BELOW = 20;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * How much a colony's stability scales its work: 1 at the neutral 70, down to
 * 0.6 in the worst unrest, a little over 1 when people are content.
 */
export function moraleFactor(stability: number): number {
  if (stability >= BASE_STABILITY) return 1 + (Math.min(100, stability) - BASE_STABILITY) / 300;
  return Math.max(0.6, 0.6 + (stability / BASE_STABILITY) * 0.4);
}

/** Population growth scales with contentment: people settle where they are happy. */
export function growthFactor(stability: number): number {
  return clamp(stability / BASE_STABILITY, 0.3, 1.3);
}

/** Commerce is lost to heavy taxes and to unrest, and gained when taxes are light. */
export function tradeFactor(taxRate: number, stability: number): number {
  return Math.max(0, 1.3 - taxRate) * clamp(stability / BASE_STABILITY, 0.3, 1.2);
}

/** More trade links (see trade.ts) means more trade, up to four. */
export function connectionFactor(links: number): number {
  return 0.5 + 0.25 * Math.min(4, Math.max(0, links));
}

/** Idle reserves beyond this many years of spending are eaten away by inflation. */
export const FREE_RESERVE_YEARS = 3;
export const FREE_RESERVE_FLOOR = 1000;
export const RESERVE_EROSION = 0.04;

/** What a hoard loses in a year: a share of whatever exceeds a sensible reserve. */
export function reserveErosion(treasury: number, annualExpenses: number): number {
  const free = Math.max(FREE_RESERVE_FLOOR, FREE_RESERVE_YEARS * annualExpenses);
  return treasury > free ? (treasury - free) * RESERVE_EROSION : 0;
}

/**
 * What a governor does for the peace: a skilled administrator keeps order, a
 * poor one stirs resentment, and a colony with nobody in charge drifts.
 * `administration` is the officer's rating (1 to 8), or null for no governor.
 */
export function governorStability(administration: number | null): number {
  return administration === null ? -2 : (administration - 3) * 2;
}

export interface StabilityInputs {
  taxRate: number;
  welfare: number;
  treasury: number;
  /** Annual spending, to judge whether reserves are comfortable. */
  expenses: number;
  /** Product of timed effects on stability at this colony. */
  effect: number;
  /** The governor's administration rating, or null if there is none. */
  administration: number | null;
}

export interface StabilityBreakdown {
  target: number;
  tax: number;
  welfare: number;
  treasury: number;
  governor: number;
}

/** Where a colony's stability is heading, and why. */
export function stabilityTarget(i: StabilityInputs): StabilityBreakdown {
  const tax = -(i.taxRate - NEUTRAL_TAX) * 80;
  const welfare = i.welfare * 100;
  const treasury = i.treasury < 0 ? -15 : i.treasury >= i.expenses && i.expenses > 0 ? 5 : 0;
  const governor = governorStability(i.administration);
  const target = clamp((BASE_STABILITY + tax + welfare + treasury + governor) * i.effect, 0, 100);
  return { target, tax, welfare, treasury, governor };
}

export function stabilityLabel(stability: number): string {
  if (stability >= 85) return "Devoted";
  if (stability >= 70) return "Content";
  if (stability >= UNREST_BELOW) return "Uneasy";
  if (stability >= RIOTS_BELOW) return "Unrest";
  return "Rioting";
}

// -------------------------------------------------------------- programmes

export interface Programme {
  id: string;
  name: string;
  kind: EffectKind;
  factor: number;
  years: number;
  blurb: string;
}

export const PROGRAMMES: Programme[] = [
  { id: "industrial-subsidy", name: "Industrial subsidy", kind: "industry", factor: 1.25, years: 3, blurb: "Cheap credit for the factories: +25% construction output." },
  { id: "research-grant", name: "Research grant", kind: "research", factor: 1.25, years: 3, blurb: "Funds the laboratories: +25% research output." },
  { id: "mining-incentives", name: "Mining incentives", kind: "mining", factor: 1.25, years: 3, blurb: "Bonuses for the miners: +25% mineral output." },
  { id: "settlement-drive", name: "Settlement drive", kind: "growth", factor: 1.4, years: 3, blurb: "Grants to young families: +40% population growth." },
  { id: "public-festival", name: "Public festival", kind: "stability", factor: 1.15, years: 2, blurb: "Bread and circuses: +15% stability for two years." },
];

export const PROGRAMME_BY_ID = new Map(PROGRAMMES.map((p) => [p.id, p]));

/** Programmes cost most of a year's takings, so a big empire pays more. */
export function programmeCost(grossIncome: number): number {
  return Math.max(100, Math.round(grossIncome * 0.6));
}

export function activeProgramme(empire: Empire, programme: Programme) {
  return empire.effects.find((e) => e.source === `programme:${programme.id}`);
}

/** Buy a programme. Returns a reason it could not be done, or null on success. */
export function buyProgramme(empire: Empire, id: string, now: number): string | null {
  const programme = PROGRAMME_BY_ID.get(id);
  if (!programme) return "No such programme.";
  if (activeProgramme(empire, programme)) return `${programme.name} is already running.`;
  const cost = programmeCost(empire.snapshot.income);
  if (empire.treasury < cost) return `Needs ${cost.toLocaleString()} in the treasury.`;
  empire.treasury -= cost;
  empire.addEffect(
    { kind: programme.kind, target: "empire", factor: programme.factor, label: programme.name, source: `programme:${programme.id}` },
    now,
    programme.years * 365.25,
  );
  empire.addLog(now, "economy", `${programme.name} launched for ${cost.toLocaleString()}: ${programme.blurb}`, { view: "empire" });
  return null;
}
