/**
 * Politics: the factions a government has to keep sweet.
 *
 * Five factions each judge the empire by what they care about. Their support
 * drifts towards that judgement, and bends it to match what the government
 * does: laws it passes, favours it buys, demands it meets or ignores. Support
 * gives political capital to spend; unhappy factions sabotage their own
 * corner of the economy; and every four years there is an election that a
 * neglected government can lose.
 *
 * Nothing here is random except which demand comes next, and that draws from
 * a seeded stream like everything else.
 */

import type { Empire, EffectKind } from "../state/empire";
import type { Galaxy } from "./galaxy";
import { installationCount } from "../state/colony";
import { tradeLines } from "./economy/trade";
import { activeProgramme, PROGRAMME_BY_ID } from "./economy/finance";
import { freeLabs } from "./research/graph";
import { DAYS_PER_YEAR } from "./orbit";
import { baseMood, popInfluence } from "./economy/goods";

export type FactionId = "industrialists" | "academy" | "colonists" | "civic" | "admiralty";

export interface FactionDef {
  id: FactionId;
  name: string;
  /** What they stand for, for the player. */
  creed: string;
  /** What they sabotage when they are unhappy and reward when content. */
  domain: EffectKind[];
  domainText: string;
}

export const FACTIONS: FactionDef[] = [
  { id: "industrialists", name: "Industrial Combine", creed: "Low taxes, growing factories, no handouts.", domain: ["industry", "mining"], domainText: "construction and mining output" },
  { id: "academy", name: "Academy of Sciences", creed: "Busy laboratories, rising research, sound money.", domain: ["research"], domainText: "research output" },
  { id: "colonists", name: "Colonial League", creed: "New worlds, growing populations, working freight lines.", domain: ["growth"], domainText: "population growth" },
  { id: "civic", name: "Civic Union", creed: "Contented colonies, welfare, fair taxes.", domain: ["stability"], domainText: "stability" },
  { id: "admiralty", name: "Admiralty", creed: "A strong, well-kept fleet.", domain: ["fuel"], domainText: "fuel supply" },
];

export const FACTION_BY_ID = new Map(FACTIONS.map((f) => [f.id, f]));

// ----------------------------------------------------------------- policies

export interface PolicyDef {
  id: string;
  name: string;
  blurb: string;
  cost: number;
  effects: { kind: EffectKind; factor: number }[];
  /** Support shifts, held for as long as the law stands. */
  likes: Partial<Record<FactionId, number>>;
  /** Capital per year to keep it running, on top of the standard upkeep. */
  upkeep?: number;
  /** Repealed automatically after this many years. */
  maxYears?: number;
}

export const POLICIES: PolicyDef[] = [
  { id: "free-trade", name: "Free Trade Act", blurb: "Open markets: +8% income.", cost: 15,
    effects: [{ kind: "wealth", factor: 1.08 }], likes: { industrialists: 8, colonists: 4, civic: -5 } },
  { id: "research-charter", name: "Research Charter", blurb: "Public funding for science: +12% research.", cost: 20,
    effects: [{ kind: "research", factor: 1.12 }], likes: { academy: 12, industrialists: -4 } },
  { id: "industrial-mobilisation", name: "Industrial Mobilisation", blurb: "+12% industry, +5% mining, but -5% stability.", cost: 25,
    effects: [{ kind: "industry", factor: 1.12 }, { kind: "mining", factor: 1.05 }, { kind: "stability", factor: 0.95 }],
    likes: { industrialists: 12, civic: -8, academy: -3 } },
  { id: "colonial-charter", name: "Colonial Charter", blurb: "Land grants and passage: +12% population growth.", cost: 20,
    effects: [{ kind: "growth", factor: 1.12 }], likes: { colonists: 12, admiralty: -3, industrialists: -3 } },
  { id: "civil-liberties", name: "Civil Liberties Act", blurb: "Free speech and assembly: +6% stability.", cost: 20,
    effects: [{ kind: "stability", factor: 1.06 }], likes: { civic: 12, admiralty: -8 } },
  { id: "welfare-state", name: "Welfare State", blurb: "+4% stability, +5% growth, but -5% income.", cost: 20,
    effects: [{ kind: "stability", factor: 1.04 }, { kind: "growth", factor: 1.05 }, { kind: "wealth", factor: 0.95 }],
    likes: { civic: 10, industrialists: -8 } },
  { id: "naval-expansion", name: "Naval Expansion", blurb: "Fleet logistics: +15% fuel, -3% income.", cost: 20,
    effects: [{ kind: "fuel", factor: 1.15 }, { kind: "wealth", factor: 0.97 }], likes: { admiralty: 14, civic: -5 } },
  { id: "emergency-powers", name: "Emergency Powers", blurb: "Order by decree: +12% stability. Costs 2 extra capital a year and lapses after four years.", cost: 15,
    effects: [{ kind: "stability", factor: 1.12 }], likes: { civic: -15, academy: -8, admiralty: 8 }, upkeep: 2, maxYears: 4 },
];

export const POLICY_BY_ID = new Map(POLICIES.map((p) => [p.id, p]));

/** Laws that can be in force at once: three, and more with administration techs. */
export function policySlots(empire: Empire): number {
  return empire.stats.policySlots;
}
export const REPEAL_COST = 5;
export const BASE_UPKEEP = 0.5;
export const CAPITAL_CAP = 100;

// ------------------------------------------------------------------- state

export interface FactionState {
  id: FactionId;
  support: number;
  /** Share of political weight; the shares add up to 1. */
  influence: number;
}

export interface EnactedPolicy {
  id: string;
  since: number;
  /** Cannot be repealed before this time (an imposed law). */
  lockedUntil?: number;
}

export type DemandKind = "factories" | "labs" | "colonies" | "stability" | "ships";

export interface Demand {
  id: string;
  factionId: FactionId;
  kind: DemandKind;
  label: string;
  baseline: number;
  target: number;
  deadline: number;
  issued: number;
}

export interface Election {
  time: number;
  approval: number;
  won: boolean;
}

export interface PoliticsState {
  factions: FactionState[];
  capital: number;
  policies: EnactedPolicy[];
  demands: Demand[];
  nextDemand: number;
  nextDemandId: number;
  /** 0 until the first production cycle sets it. */
  nextElection: number;
  /** While set and in the future, a caretaker government is in charge. */
  caretakerUntil: number;
  lastElection: Election | null;
  /** Last time each faction was courted or funded, to ration favours. */
  courted: Partial<Record<FactionId, number>>;
}

export function defaultPolitics(): PoliticsState {
  return {
    factions: FACTIONS.map((f) => ({ id: f.id, support: 55, influence: 1 / FACTIONS.length })),
    capital: 20,
    policies: [],
    demands: [],
    nextDemand: 0,
    nextDemandId: 1,
    nextElection: 0,
    caretakerUntil: 0,
    lastElection: null,
    courted: {},
  };
}

export const ELECTION_YEARS = 4;
export const WIN_APPROVAL = 50;
const YEAR = DAYS_PER_YEAR * 86_400;

// ---------------------------------------------------------- satisfaction

export interface Term {
  label: string;
  value: number;
}

export interface Judgement {
  target: number;
  terms: Term[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function yearAgo(empire: Empire, now: number) {
  return empire.history.find((p) => p.time >= now - YEAR) ?? empire.history[0];
}

/** Ratio of now to a year ago, 1 when there is nothing to compare. */
function trend(now: number, then: number | undefined): number {
  return then && then > 0 ? now / then : 1;
}

/** What each faction makes of how things are going, and why. */
export function judge(empire: Empire, id: FactionId, now: number): Judgement {
  const terms: Term[] = [{ label: "Baseline", value: 55 }];
  const add = (label: string, value: number) => {
    if (Math.abs(value) >= 0.5) terms.push({ label, value });
  };
  const old = yearAgo(empire, now);
  const colonies = [...empire.colonies.values()].filter((c) => c.population > 0.1);
  const meanStability = colonies.length ? colonies.reduce((s, c) => s + c.stability, 0) / colonies.length : 70;
  const debt = empire.treasury < 0;
  const programme = (pid: string) => Boolean(activeProgramme(empire, PROGRAMME_BY_ID.get(pid)!));

  switch (id) {
    case "industrialists":
      add("Taxes", -(empire.taxRate - 0.3) * 60);
      add("Welfare spending", -empire.welfare * 100 * 0.6);
      add("Factory output trend", clamp((trend(empire.snapshot.buildPoints, old?.buildPoints) - 1) * 40, -10, 10));
      if (programme("industrial-subsidy")) add("Industrial subsidy", 10);
      if (debt) add("Treasury in debt", -12);
      break;
    case "academy": {
      add("Research trend", clamp((trend(empire.snapshot.researchPoints, old?.researchPoints) - 1) * 40, -10, 10));
      const idle = freeLabs(empire).reduce((s, l) => s + l.free, 0);
      add("Idle laboratories", -Math.min(9, idle * 0.5));
      if (programme("research-grant")) add("Research grant", 10);
      if (debt) add("Treasury in debt", -10);
      break;
    }
    case "colonists": {
      add("Population trend", clamp((trend(empire.snapshot.population, old?.population) - 1) * 100, -10, 10));
      add("Freight lines", Math.min(9, tradeLines(empire).length * 3));
      add("Colonies in unrest", -Math.min(12, colonies.filter((c) => c.stability < 40).length * 4));
      add("Colonies without a governor", -Math.min(8, colonies.filter((c) => !empire.governorOf(c.bodyId)).length * 2));
      if (programme("settlement-drive")) add("Settlement drive", 10);
      break;
    }
    case "civic":
      add("Stability", (meanStability - 70) * 0.6);
      add("Taxes", -(empire.taxRate - 0.3) * 50);
      add("Welfare spending", empire.welfare * 100 * 1.2);
      if (programme("public-festival")) add("Public festival", 8);
      if (debt) add("Treasury in debt", -10);
      break;
    case "admiralty": {
      const ships = [...empire.ships.values()];
      add("Fleet strength", clamp(ships.length * 1.5, 0, 12) - 6);
      if (ships.length) {
        add("Ship condition", (ships.reduce((s, x) => s + x.condition, 0) / ships.length - 75) * 0.2);
      }
      const warships = new Set(ships.filter((s) => empire.statsOf(s.designId)?.military).map((s) => s.designId));
      add("Military classes in service", Math.min(9, warships.size * 3));
      break;
    }
  }
  // The mood of the people who lean this way.
  if (empire.colonies.size) {
    const base = baseMood(empire, id);
    add("Mood of their people", (base.mood - 70) * 0.5);
    add("Radicalised followers", -base.radicalism * 0.1);
  }
  for (const entry of empire.politics.policies) {
    const like = POLICY_BY_ID.get(entry.id)?.likes[id];
    if (like) terms.push({ label: POLICY_BY_ID.get(entry.id)!.name, value: like });
  }
  const target = clamp(terms.reduce((s, t) => s + t.value, 0), 0, 100);
  return { target, terms };
}

// --------------------------------------------------------- consequences

/** How a faction's mood shows in its corner of the economy. */
export function moodEffect(support: number): number {
  if (support >= 70) return 0.04;
  if (support >= 50) return 0;
  if (support >= 35) return -0.03;
  if (support >= 15) return -0.08;
  return -0.15;
}

export function moodLabel(support: number): string {
  if (support >= 70) return "Loyal";
  if (support >= 50) return "Supportive";
  if (support >= 35) return "Restless";
  if (support >= 15) return "Hostile";
  return "In revolt";
}

/** Overall approval: each faction's support weighted by its influence. */
export function approval(politics: PoliticsState): number {
  return politics.factions.reduce((s, f) => s + f.support * f.influence, 0);
}

export function capitalIncome(empire: Empire, now: number): number {
  const p = empire.politics;
  const base = 4 + (approval(p) - 50) * 0.12 + empire.stats.capitalBonus;
  const caretaker = p.caretakerUntil > now ? 0.5 : 1;
  return Math.max(0, base * caretaker);
}

export function capitalUpkeep(politics: PoliticsState): number {
  return politics.policies.reduce((s, e) => s + BASE_UPKEEP + (POLICY_BY_ID.get(e.id)?.upkeep ?? 0), 0);
}

/** The multipliers politics puts on each kind of output. Recomputed when anything changes. */
export function politicalFactors(politics: PoliticsState, now: number): Record<EffectKind, number> {
  const out: Record<EffectKind, number> = { industry: 1, mining: 1, fuel: 1, research: 1, wealth: 1, growth: 1, stability: 1 };
  for (const entry of politics.policies) {
    for (const e of POLICY_BY_ID.get(entry.id)?.effects ?? []) out[e.kind] *= e.factor;
  }
  for (const state of politics.factions) {
    const def = FACTION_BY_ID.get(state.id)!;
    // Weight by influence: a faction with a fifth of the weight counts in full.
    const mood = moodEffect(state.support) * Math.min(2, state.influence * FACTIONS.length);
    for (const kind of def.domain) out[kind] *= 1 + mood;
  }
  if (politics.caretakerUntil > now) out.stability *= 0.95;
  return out;
}

// ------------------------------------------------------------- actions

/** Enact a law. Returns why it could not be done, or null. */
export function enactPolicy(empire: Empire, id: string, now: number): string | null {
  const def = POLICY_BY_ID.get(id);
  const p = empire.politics;
  if (!def) return "No such law.";
  if (p.policies.some((e) => e.id === id)) return `${def.name} is already law.`;
  if (p.policies.length >= policySlots(empire)) return "No free slot: repeal a law first.";
  if (p.capital < def.cost) return `Needs ${def.cost} political capital.`;
  p.capital -= def.cost;
  p.policies.push({ id, since: now });
  empire.refreshPolitics(now);
  empire.addLog(now, "economy", `${def.name} enacted. ${def.blurb}`, { view: "politics" });
  return null;
}

export function repealPolicy(empire: Empire, id: string, now: number): string | null {
  const p = empire.politics;
  const entry = p.policies.find((e) => e.id === id);
  const def = POLICY_BY_ID.get(id);
  if (!entry || !def) return "That law is not in force.";
  if (entry.lockedUntil && entry.lockedUntil > now) return "The caretaker government has locked this law in for now.";
  if (p.capital < REPEAL_COST) return `Repeal costs ${REPEAL_COST} political capital.`;
  p.capital -= REPEAL_COST;
  p.policies = p.policies.filter((e) => e.id !== id);
  empire.refreshPolitics(now);
  empire.addLog(now, "economy", `${def.name} repealed.`, { view: "politics" });
  return null;
}

export const COURT_COST = 10;
export const COURT_GAIN = 12;
export const FUND_GAIN = 18;
const COURT_COOLDOWN = YEAR / 2;

/** Spend capital on personal attention to a faction. */
export function courtFaction(empire: Empire, id: FactionId, now: number): string | null {
  const p = empire.politics;
  const state = p.factions.find((f) => f.id === id);
  if (!state) return "No such faction.";
  if (now - (p.courted[id] ?? -Infinity) < COURT_COOLDOWN) return "They were courted recently; give it time.";
  if (p.capital < COURT_COST) return `Needs ${COURT_COST} political capital.`;
  p.capital -= COURT_COST;
  state.support = Math.min(100, state.support + COURT_GAIN);
  p.courted[id] = now;
  empire.refreshPolitics(now);
  empire.addLog(now, "economy", `The government courts the ${FACTION_BY_ID.get(id)!.name}.`, { view: "politics" });
  return null;
}

/** Spend wealth on a faction's pet projects. */
export function fundFaction(empire: Empire, id: FactionId, cost: number, now: number): string | null {
  const p = empire.politics;
  const state = p.factions.find((f) => f.id === id);
  if (!state) return "No such faction.";
  if (now - (p.courted[id] ?? -Infinity) < COURT_COOLDOWN) return "They were courted recently; give it time.";
  if (empire.treasury < cost) return `Needs ${cost.toLocaleString()} in the treasury.`;
  empire.treasury -= cost;
  state.support = Math.min(100, state.support + FUND_GAIN);
  p.courted[id] = now;
  empire.refreshPolitics(now);
  empire.addLog(now, "economy", `Funds are directed to the ${FACTION_BY_ID.get(id)!.name}'s projects.`, { view: "politics" });
  return null;
}

export const REJECT_COST = 3;
export const REJECT_PENALTY = 5;

export function rejectDemand(empire: Empire, demandId: string, now: number): string | null {
  const p = empire.politics;
  const demand = p.demands.find((d) => d.id === demandId);
  if (!demand) return "No such demand.";
  if (p.capital < REJECT_COST) return `Needs ${REJECT_COST} political capital.`;
  p.capital -= REJECT_COST;
  p.demands = p.demands.filter((d) => d.id !== demandId);
  const state = p.factions.find((f) => f.id === demand.factionId);
  if (state) state.support = Math.max(0, state.support - REJECT_PENALTY);
  empire.refreshPolitics(now);
  empire.addLog(now, "economy", `The ${FACTION_BY_ID.get(demand.factionId)!.name}'s demand is turned down.`, { view: "politics" });
  return null;
}

// ------------------------------------------------------------- demands

function totals(empire: Empire) {
  let factories = 0;
  let labs = 0;
  let colonies = 0;
  let stability = 0;
  for (const c of empire.colonies.values()) {
    factories += installationCount(c, "construction-factory");
    labs += installationCount(c, "research-lab");
    if (c.population > 0.1) {
      colonies++;
      stability += c.stability;
    }
  }
  return { factories, labs, colonies, stability: colonies ? stability / colonies : 70, ships: empire.ships.size };
}

/** How far along a demand is: the figure it is measured by. */
export function demandProgress(empire: Empire, d: Demand): number {
  return totals(empire)[d.kind];
}

function makeDemand(empire: Empire, id: FactionId, now: number): Demand {
  const p = empire.politics;
  const t = totals(empire);
  const base = { id: `demand-${p.nextDemandId++}`, factionId: id, deadline: now + 2 * YEAR, issued: now };
  switch (id) {
    case "industrialists": {
      const target = t.factories + Math.max(10, Math.round(t.factories * 0.1));
      return { ...base, kind: "factories", baseline: t.factories, target, label: `Have ${target} construction factories` };
    }
    case "academy": {
      const target = t.labs + 5;
      return { ...base, kind: "labs", baseline: t.labs, target, label: `Have ${target} research laboratories` };
    }
    case "colonists": {
      const target = t.colonies + 1;
      return { ...base, kind: "colonies", baseline: t.colonies, target, label: `Settle a new colony (${target} in all)` };
    }
    case "civic": {
      const target = t.stability >= 75 ? 82 : 75;
      return { ...base, kind: "stability", baseline: Math.round(t.stability), target, label: `Bring average stability up to ${target}` };
    }
    default: {
      const target = t.ships + 2;
      return { ...base, kind: "ships", baseline: t.ships, target, label: `Have ${target} ships in service` };
    }
  }
}

// ----------------------------------------------------------------- tick

/** Advance politics by one production cycle. */
export function runPolitics(empire: Empire, _system: Galaxy, now: number, days: number): void {
  const p = empire.politics;
  const year = days / DAYS_PER_YEAR;
  if (p.nextElection === 0) {
    p.nextElection = now + ELECTION_YEARS * YEAR;
    p.nextDemand = now + (1 + empire.politicsRng.float()) * YEAR;
  }

  // --- support drifts towards each faction's judgement of events
  for (const state of p.factions) {
    const { target } = judge(empire, state.id, now);
    const before = state.support;
    state.support += (target - before) * Math.min(1, 0.6 * year);
    if (before >= 15 && state.support < 15) {
      empire.addLog(now, "economy", `The ${FACTION_BY_ID.get(state.id)!.name} is in open revolt: ${FACTION_BY_ID.get(state.id)!.domainText} will suffer.`, { view: "politics" });
    } else if (before >= 35 && state.support < 35) {
      empire.addLog(now, "economy", `The ${FACTION_BY_ID.get(state.id)!.name} turns hostile.`, { view: "politics" });
    } else if (before < 35 && state.support >= 35) {
      empire.addLog(now, "economy", `The ${FACTION_BY_ID.get(state.id)!.name} has been won round.`, { view: "politics" });
    }
  }

  // --- influence follows success, a little
  const mean = p.factions.reduce((s, f) => s + f.support, 0) / p.factions.length;
  for (const state of p.factions) state.influence = Math.max(0.08, state.influence + ((state.support - mean) / 100) * 0.04 * year);
  // ...and follows the people: whoever the population leans towards has the weight.
  const weight = popInfluence(empire);
  const weightSum = Object.values(weight).reduce((a, b) => a + b, 0) || 1;
  for (const state of p.factions) {
    state.influence += (Math.max(0.08, weight[state.id] / weightSum) - state.influence) * Math.min(1, 0.1 * year);
  }
  const sum = p.factions.reduce((s, f) => s + f.influence, 0);
  for (const state of p.factions) state.influence /= sum;

  // --- capital accrues, less what the laws cost to run
  p.capital = clamp(p.capital + (capitalIncome(empire, now) - capitalUpkeep(p)) * year, 0, CAPITAL_CAP);

  // --- laws with a time limit lapse
  for (const entry of [...p.policies]) {
    const def = POLICY_BY_ID.get(entry.id);
    if (def?.maxYears && now - entry.since >= def.maxYears * YEAR) {
      p.policies = p.policies.filter((e) => e !== entry);
      empire.addLog(now, "economy", `${def.name} lapses after ${def.maxYears} years.`, { view: "politics" });
    }
  }

  // --- demands: met, missed, or newly made
  for (const demand of [...p.demands]) {
    const state = p.factions.find((f) => f.id === demand.factionId)!;
    const name = FACTION_BY_ID.get(demand.factionId)!.name;
    if (demandProgress(empire, demand) >= demand.target) {
      p.demands = p.demands.filter((d) => d !== demand);
      state.support = Math.min(100, state.support + 15);
      p.capital = Math.min(CAPITAL_CAP, p.capital + 5);
      empire.addLog(now, "economy", `The ${name}'s demand is met: ${demand.label}. They are grateful.`, { view: "politics" });
    } else if (now >= demand.deadline) {
      p.demands = p.demands.filter((d) => d !== demand);
      state.support = Math.max(0, state.support - 12);
      empire.addLog(now, "economy", `The ${name}'s demand was ignored: ${demand.label}. They will not forget.`, { view: "politics" });
    }
  }
  if (now >= p.nextDemand) {
    p.nextDemand = now + (1.5 + empire.politicsRng.float()) * YEAR;
    if (p.demands.length < 2) {
      const open = new Set(p.demands.map((d) => d.factionId));
      const pool = p.factions.filter((f) => !open.has(f.id));
      const total = pool.reduce((s, f) => s + f.influence, 0);
      let roll = empire.politicsRng.float() * total;
      const pick = pool.find((f) => (roll -= f.influence) <= 0) ?? pool[0];
      if (pick) {
        const demand = makeDemand(empire, pick.id, now);
        p.demands.push(demand);
        empire.addLog(now, "economy", `The ${FACTION_BY_ID.get(pick.id)!.name} demands: ${demand.label}, within two years.`, { view: "politics" });
      }
    }
  }

  // --- the election
  const toGo = p.nextElection - now;
  if (toGo <= YEAR && toGo + days * 86_400 > YEAR) {
    empire.addLog(now, "economy", `An election is a year away. Approval stands at ${Math.round(approval(p))}%; ${WIN_APPROVAL}% wins.`, { view: "politics" });
  }
  if (now >= p.nextElection) holdElection(empire, now);

  empire.refreshPolitics(now);
}

function holdElection(empire: Empire, now: number): void {
  const p = empire.politics;
  const score = approval(p);
  const won = score >= WIN_APPROVAL;
  p.lastElection = { time: now, approval: score, won };
  p.nextElection = now + ELECTION_YEARS * YEAR;
  if (won) {
    const landslide = score >= 65;
    p.capital = Math.min(CAPITAL_CAP, p.capital + (landslide ? 20 : 10));
    empire.addLog(now, "economy", `The government wins the election with ${Math.round(score)}% approval${landslide ? " - a landslide" : ""}. Political capital +${landslide ? 20 : 10}.`, { view: "politics" });
    return;
  }
  // Defeat: a caretaker government takes over for a year, scraps the laws and
  // imposes the favourite of the faction that likes the government least.
  const worst = [...p.factions].sort((a, b) => a.support - b.support)[0];
  const imposed = POLICIES.filter((d) => d.likes[worst.id]).sort((a, b) => (b.likes[worst.id] ?? 0) - (a.likes[worst.id] ?? 0))[0];
  p.policies = [];
  p.capital = 0;
  p.caretakerUntil = now + YEAR;
  if (imposed) p.policies.push({ id: imposed.id, since: now, lockedUntil: now + YEAR });
  empire.addLog(
    now, "economy",
    `The government loses the election with ${Math.round(score)}% approval. A caretaker administration scraps every law${imposed ? ` and imposes ${imposed.name}` : ""}; capital is gone and stability suffers for a year.`,
    { view: "politics" },
  );
}
