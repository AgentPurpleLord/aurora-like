/**
 * The production cycle.
 *
 * Everything economic happens here, in discrete five-day cycles rather than
 * continuously: mining and depletion, industry working the build queue,
 * refining, mass driver shipments, research, terraforming, population and
 * wealth. Rates are quoted per year and scaled by the length of the cycle,
 * so the same code handles a 5-day step and a 30-day jump identically.
 */

import { emptySnapshot, type Empire, type EmpireSnapshot } from "../../state/empire";
import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import type { Body, StarSystem } from "../system";
import type { EmpireStats } from "../research/techs";
import { TECH_BY_ID } from "../research/techs";
import { MINERALS, type MineralName } from "../minerals";
import { DAYS_PER_YEAR } from "../orbit";
import { INSTALLATION_BY_ID } from "./installations";
import { bonus, fullName, labCapacity } from "../people/officers";

/** Length of one production cycle, in days. */
export const CYCLE_DAYS = 5;

/** Wealth generated per million population per year. */
const TAX_PER_MILLION = 2.5;
const WEALTH_PER_FINANCIAL_CENTRE = 25;
const WEALTH_PER_BUILD_POINT = 1;
const WEALTH_PER_RESEARCH_POINT = 1;
const UPKEEP_PER_INSTALLATION = 0.05;

/** Base annual population growth on a world that can support it. */
const BASE_GROWTH = 0.02;
/** Colonists supported by one unit of infrastructure at colony cost 1.0. */
const POP_PER_INFRASTRUCTURE = 0.01;
/** Millions of people an Earth-sized garden world can hold. */
const EARTH_CAPACITY = 12_000;
/** Litres of fuel from one ton of Sorium. */
const FUEL_PER_SORIUM = 2000;

export function effectiveColonyCost(
  body: Body,
  colony: Colony | undefined,
  stats: EmpireStats,
): number {
  if (!Number.isFinite(body.colonyCost)) return Infinity;
  const reduction = (colony?.terraformed ?? 0) + stats.colonyCostReduction;
  return Math.max(0, body.colonyCost - reduction);
}

/** Population the colony can sustain, in millions. */
export function populationCapacity(body: Body, colony: Colony, stats: EmpireStats): number {
  const cost = effectiveColonyCost(body, colony, stats);
  if (!Number.isFinite(cost)) return 0;
  if (cost <= 0) return EARTH_CAPACITY * (body.def.radiusKm / 6371) ** 2;
  const infrastructure = installationCount(colony, "infrastructure");
  return (infrastructure * POP_PER_INFRASTRUCTURE * stats.infrastructureEfficiency) / cost;
}

/** Workers needed to run every installation on the colony, in millions. */
export function workersRequired(colony: Colony): number {
  let total = 0;
  for (const [id, count] of Object.entries(colony.installations)) {
    total += (INSTALLATION_BY_ID.get(id)?.workers ?? 0) * count;
  }
  return total;
}

/** 0 to 1: how much of the colony's manned industry is actually staffed. */
export function employmentRatio(colony: Colony): number {
  const required = workersRequired(colony);
  if (required <= 0) return 1;
  return Math.min(1, colony.population / required);
}

/** Mines, weighted so that automated mines never want for workers. */
export function effectiveMines(colony: Colony, employment: number): number {
  return installationCount(colony, "mine") * employment + installationCount(colony, "automated-mine");
}

export interface ColonyOutput {
  employment: number;
  workersRequired: number;
  buildPoints: number;
  researchPoints: number;
  mining: Partial<Record<MineralName, number>>;
  fuel: number;
  wealth: number;
  /** Annual population change in millions. */
  populationGrowth: number;
  capacity: number;
}

/**
 * Annualised output of a colony as it stands - used both by the cycle and by
 * the UI, so the numbers on screen are the numbers being simulated.
 */
export function colonyOutput(
  empire: Empire,
  body: Body,
  colony: Colony,
  stats: EmpireStats,
): ColonyOutput {
  const employment = employmentRatio(colony);
  const governor = empire.governorOf(colony.bodyId);
  const industry = empire.austerity ? 0.5 : 1;

  const buildPoints =
    installationCount(colony, "construction-factory") *
    stats.constructionRate *
    employment *
    (1 + bonus(governor, "production")) *
    industry;

  const mines = effectiveMines(colony, employment);
  const mining: Partial<Record<MineralName, number>> = {};
  for (const deposit of body.minerals) {
    if (deposit.amount <= 0) continue;
    mining[deposit.mineral] =
      mines * stats.miningRate * deposit.accessibility * (1 + bonus(governor, "mining"));
  }

  const refineries = installationCount(colony, "fuel-refinery") * employment;
  const fuel = refineries * stats.fuelPerRefinery;

  const researchPoints = empire.projects
    .filter((p) => p.colonyId === colony.bodyId)
    .reduce((sum, p) => {
      const scientist = empire.officers.get(p.scientistId ?? undefined);
      return sum + p.labs * stats.researchRate * employment * (1 + bonus(scientist, "research"));
    }, 0);

  const wealth =
    colony.population * TAX_PER_MILLION * (1 + stats.wealthBonus + bonus(governor, "wealth")) +
    installationCount(colony, "financial-centre") * WEALTH_PER_FINANCIAL_CENTRE;

  const capacity = populationCapacity(body, colony, stats);
  const growthRate = BASE_GROWTH * (1 + stats.popGrowthBonus + bonus(governor, "populationGrowth"));
  const populationGrowth =
    capacity <= 0
      ? colony.population > 0 ? -colony.population * 0.05 : 0
      : colony.population > capacity
        ? (capacity - colony.population) * 0.05
        : colony.population * growthRate * (1 - colony.population / capacity);

  return {
    employment,
    workersRequired: workersRequired(colony),
    buildPoints,
    researchPoints,
    mining,
    fuel,
    wealth,
    populationGrowth,
    capacity,
  };
}

/**
 * The empire's figures as they stand, without advancing anything - used to
 * populate the display before the first production cycle has run.
 */
export function computeSnapshot(empire: Empire, system: StarSystem): EmpireSnapshot {
  const snapshot = emptySnapshot();
  for (const colony of empire.colonies.values()) {
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    const output = colonyOutput(empire, body, colony, empire.stats);
    snapshot.income += output.wealth;
    snapshot.expenses += totalUpkeep(colony);
    snapshot.researchPoints += output.researchPoints;
    snapshot.fuel += output.fuel;
    snapshot.population += colony.population;
    for (const [mineral, rate] of Object.entries(output.mining) as [MineralName, number][]) {
      snapshot.minerals[mineral] = (snapshot.minerals[mineral] ?? 0) + rate;
    }
  }
  return snapshot;
}

/**
 * Advance the economy by `days`. Called once per production cycle; `now` is
 * the simulation time in seconds at the end of the cycle.
 */
export function runCycle(empire: Empire, system: StarSystem, now: number, days: number): void {
  const year = days / DAYS_PER_YEAR;
  const stats = empire.stats;

  let income = 0;
  let expenses = 0;
  let buildPoints = 0;
  let researchPoints = 0;
  let fuelProduced = 0;
  let population = 0;
  const minerals: Partial<Record<MineralName, number>> = {};

  for (const colony of empire.colonies.values()) {
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    const output = colonyOutput(empire, body, colony, stats);

    // --- mining, straight out of the body's deposits
    for (const deposit of body.minerals) {
      const rate = output.mining[deposit.mineral];
      if (!rate) continue;
      const tons = Math.min(deposit.amount, rate * year);
      if (tons <= 0) continue;
      deposit.amount -= tons;
      colony.stockpile[deposit.mineral] += tons;
      minerals[deposit.mineral] = (minerals[deposit.mineral] ?? 0) + tons / year;
      if (deposit.amount <= 0) {
        empire.addLog(now, "colony", `${deposit.mineral} deposit on ${body.name} is exhausted.`);
      }
    }

    // --- refining
    if (output.fuel > 0) {
      const wanted = (output.fuel * year) / FUEL_PER_SORIUM;
      const sorium = Math.min(colony.stockpile.Sorium, wanted);
      colony.stockpile.Sorium -= sorium;
      colony.fuel += sorium * FUEL_PER_SORIUM;
      fuelProduced += (sorium * FUEL_PER_SORIUM) / year;
    }

    // --- industry
    const spent = buildFromQueue(empire, colony, output.buildPoints * year, now, body.name);
    buildPoints += spent / year;
    expenses += (spent * WEALTH_PER_BUILD_POINT) / year;

    // --- mass drivers
    shipMinerals(empire, colony, stats, year);

    // --- terraforming
    const terraformers = installationCount(colony, "terraforming") * output.employment;
    if (terraformers > 0 && Number.isFinite(body.colonyCost)) {
      const before = effectiveColonyCost(body, colony, stats);
      colony.terraformed = Math.min(
        body.colonyCost,
        colony.terraformed + terraformers * stats.terraformRate * year,
      );
      const after = effectiveColonyCost(body, colony, stats);
      if (before > 0 && after <= 0) {
        empire.addLog(now, "colony", `${body.name} has been terraformed to colony cost 0.00.`);
      }
    }

    // --- population
    colony.population = Math.max(0, colony.population + output.populationGrowth * year);
    population += colony.population;

    // --- wealth
    income += output.wealth;
    expenses += totalUpkeep(colony) ;
  }

  migrate(empire, system, year);

  researchPoints = advanceResearch(empire, system, now, year);
  expenses += researchPoints * WEALTH_PER_RESEARCH_POINT;

  empire.treasury += (income - expenses) * year;
  const wasAusterity = empire.austerity;
  empire.austerity = empire.treasury < 0;
  if (empire.austerity !== wasAusterity) {
    empire.addLog(
      now,
      "economy",
      empire.austerity
        ? "The treasury is in deficit. Industrial output halved until it recovers."
        : "The treasury is back in surplus. Industry returns to full output.",
    );
  }

  empire.snapshot = {
    income,
    expenses,
    buildPoints,
    researchPoints: researchPoints / year,
    minerals,
    fuel: fuelProduced,
    population,
  };

  for (const event of empire.officers.advance(year, now, academyRate(empire))) {
    empire.addLog(now, "people", event.text);
  }
}

/**
 * Colonists moving from the capital to colonies with spare infrastructure.
 *
 * This stands in for colony ships and civilian shipping, which need the ship
 * design and movement systems; without it a new colony could never be
 * populated and the expansion loop would be closed.
 */
export const MIGRATION_PER_COLONY = 1.0;

function migrate(empire: Empire, system: StarSystem, year: number): void {
  const capital = empire.colonies.get(empire.capital);
  if (!capital || capital.population <= 1) return;

  for (const colony of empire.colonies.values()) {
    if (colony === capital) continue;
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;

    const room = populationCapacity(body, colony, empire.stats) - colony.population;
    if (room <= 0) continue;

    const moved = Math.min(room, MIGRATION_PER_COLONY * year, capital.population * 0.01 * year);
    if (moved <= 0) continue;
    capital.population -= moved;
    colony.population += moved;
  }
}

/** Colonists per year currently arriving at a colony. */
export function migrationInflow(empire: Empire, body: Body, colony: Colony): number {
  const capital = empire.colonies.get(empire.capital);
  if (!capital || colony === capital || capital.population <= 1) return 0;
  const room = populationCapacity(body, colony, empire.stats) - colony.population;
  if (room <= 0) return 0;
  return Math.min(room, MIGRATION_PER_COLONY, capital.population * 0.01);
}

function totalUpkeep(colony: Colony): number {
  let total = 0;
  for (const [id, count] of Object.entries(colony.installations)) {
    if (id === "infrastructure") continue;
    total += count * UPKEEP_PER_INSTALLATION;
  }
  return total;
}

function academyRate(empire: Empire): number {
  let academies = 0;
  for (const colony of empire.colonies.values()) {
    academies += installationCount(colony, "military-academy");
  }
  return academies * 2;
}

/**
 * Spend build points down the queue. Minerals are drawn in proportion to the
 * build points applied, so a half-built factory has consumed half its
 * minerals; an order that cannot draw what it needs stalls and is flagged.
 */
function buildFromQueue(
  empire: Empire,
  colony: Colony,
  budget: number,
  now: number,
  bodyName: string,
): number {
  let remaining = budget;
  let spent = 0;

  for (const order of [...colony.buildQueue]) {
    if (remaining <= 0) break;
    const type = INSTALLATION_BY_ID.get(order.installationId);
    if (!type) continue;

    const outstanding = order.quantity * type.cost - order.progress;
    if (outstanding <= 0) continue;

    // How far the stockpile stretches, expressed in build points.
    let mineralLimit = Infinity;
    for (const [mineral, tons] of Object.entries(type.minerals) as [MineralName, number][]) {
      const perPoint = tons / type.cost;
      if (perPoint > 0) {
        mineralLimit = Math.min(mineralLimit, colony.stockpile[mineral] / perPoint);
      }
    }

    const wanted = Math.min(remaining, outstanding);
    const applied = Math.max(0, Math.min(wanted, mineralLimit));
    order.starved = mineralLimit < wanted - 1e-9;

    if (applied <= 0) continue;

    for (const [mineral, tons] of Object.entries(type.minerals) as [MineralName, number][]) {
      colony.stockpile[mineral] = Math.max(0, colony.stockpile[mineral] - (tons / type.cost) * applied);
    }

    order.progress += applied;
    remaining -= applied;
    spent += applied;

    const completed = Math.floor(order.progress / type.cost + 1e-9);
    if (completed > 0) {
      order.progress -= completed * type.cost;
      order.quantity -= completed;
      // Civilian shipping carries the finished item to its destination.
      const target = order.destination
        ? empire.colonies.get(order.destination) ?? colony
        : colony;
      target.installations[type.id] = (target.installations[type.id] ?? 0) + completed;
      if (order.quantity <= 0) {
        colony.buildQueue = colony.buildQueue.filter((o) => o.id !== order.id);
        const where = target === colony ? bodyName : `${bodyName} for ${order.destination}`;
        empire.addLog(now, "construction", `${where}: construction of ${type.name} complete.`);
      }
    }
  }
  return spent;
}

/** Mass drivers throw minerals to the colony's designated destination. */
function shipMinerals(empire: Empire, colony: Colony, stats: EmpireStats, year: number): void {
  const drivers = installationCount(colony, "mass-driver");
  if (!drivers || !colony.massDriverTarget) return;
  const target = empire.colonies.get(colony.massDriverTarget);
  if (!target || target === colony) return;

  const capacity = drivers * stats.massDriverThroughput * year;
  if (capacity <= 0) return;

  const total = MINERALS.reduce((sum, m) => sum + colony.stockpile[m], 0);
  if (total <= 0) return;
  const fraction = Math.min(1, capacity / total);

  for (const mineral of MINERALS) {
    const tons = colony.stockpile[mineral] * fraction;
    if (tons <= 0) continue;
    colony.stockpile[mineral] -= tons;
    target.stockpile[mineral] += tons;
  }
}

/** Apply research points to every active project. Returns RP spent. */
function advanceResearch(empire: Empire, system: StarSystem, now: number, year: number): number {
  let total = 0;

  for (const project of [...empire.projects]) {
    const colony = empire.colonies.get(project.colonyId);
    const body = system.byId.get(project.colonyId);
    if (!colony || !body) continue;

    const scientist = empire.officers.get(project.scientistId ?? undefined);
    // A project cannot use more labs than exist, nor more than its scientist
    // can personally direct.
    const available = installationCount(colony, "research-lab");
    const cap = scientist ? labCapacity(scientist) : 0;
    const labs = Math.min(project.labs, available, cap);
    if (labs <= 0) {
      project.lastRate = 0;
      continue;
    }

    const rate =
      labs * empire.stats.researchRate * employmentRatio(colony) * (1 + bonus(scientist, "research"));
    project.lastRate = rate;
    const points = rate * year;
    project.progress += points;
    total += points;

    const tech = TECH_BY_ID.get(project.techId);
    if (tech && project.progress >= tech.cost) {
      empire.research(tech.id);
      empire.projects = empire.projects.filter((p) => p.id !== project.id);
      empire.officers.unassignTarget("research", project.id);
      empire.addLog(
        now,
        "research",
        scientist
          ? `${fullName(scientist)} has completed research into ${tech.name}.`
          : `Research into ${tech.name} is complete.`,
      );
    }
  }

  return total;
}
