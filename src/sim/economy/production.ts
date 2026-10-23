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
import type { ResearchProject } from "../../state/empire";
import type { Body } from "../system";
import type { Galaxy } from "../galaxy";
import { gatedConnected } from "../ships/routing";
import { runEvents } from "../events/engine";
import { maintainShips } from "../ships/maintenance";
import type { EmpireStats } from "../research/techs";
import { TECH_BY_ID } from "../research/techs";
import { MINERALS, type MineralName } from "../minerals";
import { DAYS_PER_YEAR } from "../orbit";
import { INSTALLATION_BY_ID, SHIPYARD_TONS } from "./installations";
import { recomputeEnvironment } from "../system";
import {
  GAS_BY_ID,
  GREENHOUSE_MAX_K,
  GREENHOUSE_SCALE,
  OXYGEN_MIN,
  TEMP_MIN,
  greenhousePressure,
  greenhouseWarming,
  isBreathable,
  maxPressureFor,
  totalPressure,
} from "../atmosphere";
import { bonus, fullName, labCapacity } from "../people/officers";
import { evaluateStandingOrders } from "./standingOrders";
import {
  DEBT_INTEREST, GDP_PER_MILLION, RIOTS_BELOW, STABILITY_DRIFT, TRADE_PER_MILLION, UNREST_BELOW,
  connectionFactor, growthFactor, moraleFactor, stabilityTarget, tradeFactor,
} from "./finance";

/** Length of one production cycle, in days. */
export const CYCLE_DAYS = 5;

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

/**
 * Colony cost as the empire experiences it: the world's own figure, less
 * whatever genetic adaptation has bought. The world's figure already
 * reflects any terraforming done to its atmosphere.
 */
export function effectiveColonyCost(body: Body, stats: EmpireStats): number {
  if (!Number.isFinite(body.colonyCost)) return Infinity;
  return Math.max(0, body.colonyCost - stats.colonyCostReduction);
}

/** Population the colony can sustain, in millions. */
export function populationCapacity(body: Body, colony: Colony, stats: EmpireStats): number {
  const cost = effectiveColonyCost(body, stats);
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
  /** The parts of wealth: tax on output, commerce, and financial centres. */
  taxes: number;
  trade: number;
  centres: number;
  stability: number;
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
  const industry = (empire.austerity ? 0.5 : 1) * moraleFactor(colony.stability);
  const morale = moraleFactor(colony.stability);

  const buildPoints =
    installationCount(colony, "construction-factory") *
    stats.constructionRate *
    employment *
    (1 + bonus(governor, "production")) *
    industry *
    empire.effectFactor("industry", colony.bodyId);

  const mines = effectiveMines(colony, employment) * empire.effectFactor("mining", colony.bodyId) * morale;
  const mining: Partial<Record<MineralName, number>> = {};
  for (const deposit of body.minerals) {
    if (deposit.amount <= 0) continue;
    mining[deposit.mineral] =
      mines * stats.miningRate * deposit.accessibility * (1 + bonus(governor, "mining"));
  }

  const refineries = installationCount(colony, "fuel-refinery") * employment;
  const fuel = refineries * stats.fuelPerRefinery * empire.effectFactor("fuel", colony.bodyId) * morale;

  const researchPoints = empire.projects
    .filter((p) => p.colonyId === colony.bodyId)
    .reduce((sum, p) => {
      const scientist = empire.officers.get(p.scientistId ?? undefined);
      return sum + p.labs * stats.researchRate * employment * (1 + bonus(scientist, "research"));
    }, 0) * empire.effectFactor("research", colony.bodyId) * morale;

  const wealthFactor = (1 + stats.wealthBonus + bonus(governor, "wealth")) * empire.effectFactor("wealth", colony.bodyId);
  let populated = 0;
  for (const c of empire.colonies.values()) if (c.population > 0.1) populated++;
  const taxes = colony.population * GDP_PER_MILLION * empire.taxRate * wealthFactor;
  const trade =
    colony.population * TRADE_PER_MILLION * connectionFactor(populated) *
    tradeFactor(empire.taxRate, colony.stability) * wealthFactor;
  const centres =
    installationCount(colony, "financial-centre") * WEALTH_PER_FINANCIAL_CENTRE *
    empire.effectFactor("wealth", colony.bodyId);
  const wealth = taxes + trade + centres;

  const capacity = populationCapacity(body, colony, stats);
  const growthRate =
    BASE_GROWTH * (1 + stats.popGrowthBonus + bonus(governor, "populationGrowth")) *
    empire.effectFactor("growth", colony.bodyId) * growthFactor(colony.stability);
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
    taxes,
    trade,
    centres,
    stability: colony.stability,
    populationGrowth,
    capacity,
  };
}

/**
 * The empire's figures as they stand, without advancing anything - used to
 * populate the display before the first production cycle has run.
 */
export function computeSnapshot(empire: Empire, system: Galaxy): EmpireSnapshot {
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
export function runCycle(empire: Empire, system: Galaxy, now: number, days: number): void {
  const year = days / DAYS_PER_YEAR;
  const stats = empire.stats;

  // Rules top colonies up before anything is built, so new work can start
  // in the same cycle it was triggered.
  evaluateStandingOrders(empire, system);

  let income = 0;
  let expenses = 0;
  let buildPoints = 0;
  let researchPoints = 0;
  let fuelProduced = 0;
  let population = 0;
  let taxes = 0;
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
        empire.addLog(now, "colony", `${deposit.mineral} deposit on ${body.name} is exhausted.`, { view: "colonies", bodyId: body.id });
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
    const spent = buildFromQueue(empire, system, colony, output.buildPoints * year, now, body.name);
    buildPoints += spent / year;
    expenses += (spent * WEALTH_PER_BUILD_POINT) / year;

    // --- mass drivers
    shipMinerals(empire, system, colony, stats, year);

    // --- terraforming
    runTerraforming(empire, body, colony, output.employment, year, now);

    // --- population
    colony.population = Math.max(0, colony.population + output.populationGrowth * year);
    population += colony.population;

    // --- wealth
    income += output.wealth;
    taxes += output.taxes;
    expenses += totalUpkeep(colony);

    // --- stability drifts towards what taxes, welfare and the treasury call for
    const before = colony.stability;
    const { target } = stabilityTarget({
      taxRate: empire.taxRate,
      welfare: empire.welfare,
      treasury: empire.treasury,
      expenses: empire.snapshot.expenses,
      effect: empire.effectFactor("stability", colony.bodyId),
    });
    colony.stability = before + (target - before) * Math.min(1, STABILITY_DRIFT * year);
    announceMood(empire, body.name, colony.bodyId, before, colony.stability, now);
  }

  // Welfare is paid out of tax revenue; debts cost interest.
  expenses += taxes * empire.welfare;
  if (empire.treasury < 0) expenses += -empire.treasury * DEBT_INTEREST;

  migrate(empire, system, year);

  researchPoints = advanceResearch(empire, system, now, year);
  expenses += researchPoints * WEALTH_PER_RESEARCH_POINT;

  // Ships wear with use and are serviced at the colonies that can.
  const upkeep = maintainShips(empire, system, days);
  expenses += (upkeep.cost * WEALTH_PER_BUILD_POINT) / year;

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
      { view: "empire" },
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

  empire.recordHistory(now);

  for (const event of empire.officers.advance(year, now, academyRate(empire))) {
    empire.addLog(now, "people", event.text);
  }

  runEvents(empire, system, now, days);
}

/**
 * Colonists moving from the capital to colonies with spare infrastructure.
 *
 * This stands in for colony ships and civilian shipping, which need the ship
 * design and movement systems; without it a new colony could never be
 * populated and the expansion loop would be closed.
 */
export const MIGRATION_PER_COLONY = 1.0;

/**
 * Civilian shipping stands in for freighters, but it only runs where ships
 * could: within a system, or between systems joined by gates.
 */
export function sharesShipping(empire: Empire, system: Galaxy, aBodyId: string, bBodyId: string): boolean {
  const a = system.byId.get(aBodyId);
  const b = system.byId.get(bBodyId);
  if (!a || !b || a.systemId === b.systemId) return true;
  return gatedConnected(empire, system, a.systemId, b.systemId);
}

function migrate(empire: Empire, system: Galaxy, year: number): void {
  if (!empire.civilianShipping) return;
  const capital = empire.colonies.get(empire.capital);
  if (!capital || capital.population <= 1) return;

  for (const colony of empire.colonies.values()) {
    if (colony === capital) continue;
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    if (!sharesShipping(empire, system, empire.capital, colony.bodyId)) continue;

    const room = populationCapacity(body, colony, empire.stats) - colony.population;
    if (room <= 0) continue;

    const moved = Math.min(room, MIGRATION_PER_COLONY * year, capital.population * 0.01 * year);
    if (moved <= 0) continue;
    capital.population -= moved;
    colony.population += moved;
  }
}

/** Colonists per year currently arriving at a colony. */
export function migrationInflow(empire: Empire, body: Body, colony: Colony, system?: Galaxy): number {
  if (!empire.civilianShipping) return 0;
  if (system && !sharesShipping(empire, system, empire.capital, colony.bodyId)) return 0;
  const capital = empire.colonies.get(empire.capital);
  if (!capital || colony === capital || capital.population <= 1) return 0;
  const room = populationCapacity(body, colony, empire.stats) - colony.population;
  if (room <= 0) return 0;
  return Math.min(room, MIGRATION_PER_COLONY, capital.population * 0.01);
}

/** Atmospheres per year the colony's terraformers can shift. */
export function terraformRate(empire: Empire, colony: Colony): number {
  return (
    installationCount(colony, "terraforming") *
    employmentRatio(colony) *
    empire.stats.terraformRate
  );
}

/**
 * What the current terraforming programme will achieve, and roughly when.
 * The same arithmetic the cycle uses, run forwards for the player.
 */
export function terraformOutlook(
  empire: Empire,
  body: Body,
  colony: Colony,
): { text: string; years: number | null } | null {
  const target = colony.terraforming;
  if (!target) return null;
  const gas = GAS_BY_ID.get(target.gasId);
  if (!gas) return null;

  const rate = terraformRate(empire, colony);
  if (rate <= 0) {
    // Terraformers need people to run them, which is the first thing a
    // hostile world does not have.
    const installations = installationCount(colony, "terraforming");
    if (installations > 0 && employmentRatio(colony) <= 0) {
      return {
        text: "Nobody is here to run the processors. The colony needs population.",
        years: null,
      };
    }
    return { text: "No terraforming installations are working.", years: null };
  }

  const held = body.atmosphere[target.gasId] ?? 0;

  if (target.mode === "remove") {
    if (held <= 0) return { text: `${gas.name} has already been cleared.`, years: 0 };
    return {
      text: `${gas.name} cleared from the atmosphere`,
      years: held / rate,
    };
  }

  const headroom = maxPressureFor(body.gravity) - totalPressure(body.atmosphere);
  if (headroom <= 0) {
    return { text: "The world cannot hold any more air.", years: null };
  }

  // Oxygen is about reaching a breathable partial pressure.
  if (gas.oxygen) {
    if (held >= OXYGEN_MIN) {
      return { text: "Oxygen is already at a breathable level.", years: 0 };
    }
    return { text: "Oxygen reaches a breathable level", years: (OXYGEN_MIN - held) / rate };
  }

  // A greenhouse gas is about reaching a liveable temperature.
  if (gas.greenhouse > 0 && body.tempK < TEMP_MIN) {
    const needed = pressureForTemperature(body, gas.greenhouse, TEMP_MIN);
    if (needed === null) {
      return { text: `${gas.name} alone cannot warm this world enough.`, years: null };
    }
    if (needed > headroom) {
      return { text: `Warming this world needs more air than it can hold.`, years: null };
    }
    return { text: `Surface temperature reaches ${TEMP_MIN} K`, years: needed / rate };
  }

  return { text: `${gas.name} thickens the atmosphere`, years: null };
}

/**
 * How much more of a greenhouse gas is needed to reach a temperature, given
 * that warming saturates. Null when the target is out of reach.
 */
function pressureForTemperature(body: Body, greenhouse: number, targetK: number): number | null {
  if (greenhouse <= 0) return null;
  const currentWarming = greenhouseWarming(body.atmosphere);
  const wanted = currentWarming + (targetK - body.tempK);
  if (wanted >= GREENHOUSE_MAX_K) return null;
  const ghNeeded = -GREENHOUSE_SCALE * Math.log(1 - wanted / GREENHOUSE_MAX_K);
  const extra = (ghNeeded - greenhousePressure(body.atmosphere)) / greenhouse;
  return extra > 0 ? extra : 0;
}

/**
 * Terraformers add or remove the gas the colony has been told to work on.
 * Everything that follows - temperature, breathability, colony cost - comes
 * out of recomputing the environment afterwards.
 */
function runTerraforming(
  empire: Empire,
  body: Body,
  colony: Colony,
  employment: number,
  year: number,
  now: number,
): void {
  const target = colony.terraforming;
  if (!target || !Number.isFinite(body.colonyCost)) return;
  const installations = installationCount(colony, "terraforming") * employment;
  if (installations <= 0) return;

  const amount = installations * empire.stats.terraformRate * year;
  if (amount <= 0) return;

  const wasBreathable = isBreathable(body.atmosphere);
  const held = body.atmosphere[target.gasId] ?? 0;

  if (target.mode === "add") {
    // A world can only hold on to so much air.
    const room = Math.max(0, maxPressureFor(body.gravity) - totalPressure(body.atmosphere));
    const added = Math.min(amount, room);
    if (added <= 0) return;
    body.atmosphere[target.gasId] = held + added;
  } else {
    if (held <= 0) return;
    const left = Math.max(0, held - amount);
    if (left <= 0) delete body.atmosphere[target.gasId];
    else body.atmosphere[target.gasId] = left;
  }

  const before = body.colonyCost;
  recomputeEnvironment(body);

  if (!wasBreathable && isBreathable(body.atmosphere)) {
    empire.addLog(now, "colony", `The air on ${body.name} is now breathable.`, { view: "colonies", bodyId: body.id });
  }
  if (before > 0 && body.colonyCost <= 0) {
    empire.addLog(now, "colony", `${body.name} has been terraformed to colony cost 0.00.`, { view: "colonies", bodyId: body.id });
  }
}

/** Tell the player when a colony slides into unrest, or recovers from it. */
function announceMood(empire: Empire, name: string, bodyId: string, before: number, after: number, now: number): void {
  const link = { view: "colonies" as const, bodyId };
  if (before >= RIOTS_BELOW && after < RIOTS_BELOW) {
    empire.addLog(now, "colony", `Riots on ${name}. Output and growth are badly hit; lower taxes or fund welfare.`, link);
  } else if (before >= UNREST_BELOW && after < UNREST_BELOW) {
    empire.addLog(now, "colony", `Unrest on ${name}: the people are unhappy with the government.`, link);
  } else if (before < UNREST_BELOW && after >= UNREST_BELOW) {
    empire.addLog(now, "colony", `${name} has calmed down.`, link);
  }
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
  system: Galaxy,
  colony: Colony,
  budget: number,
  now: number,
  bodyName: string,
): number {
  let remaining = budget;
  let spent = 0;
  const capacity = shipyardCapacity(colony);

  for (const order of [...colony.buildQueue]) {
    if (remaining <= 0) break;
    const buildable = empire.buildableOf(order);
    if (!buildable) continue;

    // A hull needs a slipway long enough to lay it down in.
    if (buildable.isShip) {
      const tons = empire.statsOf(order.designId)?.tons ?? 0;
      if (tons > capacity) {
        order.starved = true;
        continue;
      }
    }

    const outstanding = order.quantity * buildable.cost - order.progress;
    if (outstanding <= 0) continue;

    // How far the stockpile stretches, expressed in build points.
    let mineralLimit = Infinity;
    for (const [mineral, tons] of Object.entries(buildable.minerals) as [MineralName, number][]) {
      const perPoint = tons / buildable.cost;
      if (perPoint > 0) {
        mineralLimit = Math.min(mineralLimit, colony.stockpile[mineral] / perPoint);
      }
    }

    const wanted = Math.min(remaining, outstanding);
    const applied = Math.max(0, Math.min(wanted, mineralLimit));
    order.starved = mineralLimit < wanted - 1e-9;

    if (applied <= 0) continue;

    for (const [mineral, tons] of Object.entries(buildable.minerals) as [MineralName, number][]) {
      colony.stockpile[mineral] = Math.max(
        0,
        colony.stockpile[mineral] - (tons / buildable.cost) * applied,
      );
    }

    order.progress += applied;
    remaining -= applied;
    spent += applied;

    const completed = Math.floor(order.progress / buildable.cost + 1e-9);
    if (completed > 0) {
      order.progress -= completed * buildable.cost;
      order.quantity -= completed;

      if (buildable.isShip && order.designId) {
        commissionShips(empire, system, colony, order.designId, completed, bodyName, now);
      } else {
        deliver(empire, system, colony, order.installationId, completed, order.destination, bodyName, now);
      }

      if (order.quantity <= 0) {
        colony.buildQueue = colony.buildQueue.filter((o) => o.id !== order.id);
        empire.addLog(
          now,
          buildable.isShip ? "fleet" : "construction",
          `${bodyName}: ${buildable.name} complete.`,
          buildable.isShip
            ? { view: "fleets" }
            : { view: "colonies", bodyId: colony.bodyId },
        );
      }
    }
  }
  return spent;
}

/** The largest hull a colony's shipyards can lay down, in tons. */
export function shipyardCapacity(colony: Colony): number {
  return installationCount(colony, "shipyard") * SHIPYARD_TONS;
}

/**
 * Where a finished installation ends up. With civilian shipping it arrives at
 * its destination by itself; without it, it is crated up at the colony that
 * built it and waits for a freighter.
 */
function deliver(
  empire: Empire,
  system: Galaxy,
  colony: Colony,
  installationId: string,
  count: number,
  destination: string | null,
  bodyName: string,
  now: number,
): void {
  if (!destination || destination === colony.bodyId) {
    colony.installations[installationId] = (colony.installations[installationId] ?? 0) + count;
    return;
  }

  if (empire.civilianShipping && sharesShipping(empire, system, colony.bodyId, destination)) {
    const target = empire.colonies.get(destination) ?? colony;
    target.installations[installationId] = (target.installations[installationId] ?? 0) + count;
    return;
  }

  colony.stored[installationId] = (colony.stored[installationId] ?? 0) + count;
  empire.addLog(
    now,
    "construction",
    `${bodyName}: ${count} ${installationId.replace(/-/g, " ")} awaiting transport.`,
  );
}

/** New hulls join the colony's own yard fleet, fuelled from its stores. */
function commissionShips(
  empire: Empire,
  system: Galaxy,
  colony: Colony,
  designId: string,
  count: number,
  bodyName: string,
  now: number,
): void {
  const design = empire.design(designId);
  const stats = empire.statsOf(designId);
  if (!design || !stats) return;

  let fleet = [...empire.fleets.values()].find(
    (f) => f.anchorId === colony.bodyId && f.name === `${bodyName} Yard`,
  );
  if (!fleet) {
    // Start the fleet where the yard is, or it spends a tick at the origin.
    const where = system.byId.get(colony.bodyId)?.world ?? { x: 0, y: 0, z: 0 };
    fleet = empire.createFleet(`${bodyName} Yard`, where, colony.bodyId, system.byId.get(colony.bodyId)?.systemId ?? "sol");
  }

  for (let i = 0; i < count; i++) {
    const ship = empire.commissionShip(designId, fleet, shipName(empire, design.name), now);
    const fuel = Math.min(stats.fuelCapacity, colony.fuel);
    ship.fuel = fuel;
    colony.fuel -= fuel;
  }
}

function shipName(empire: Empire, className: string): string {
  const existing = [...empire.ships.values()].filter((s) =>
    s.name.startsWith(`${className} `),
  ).length;
  return `${className} ${String(existing + 1).padStart(3, "0")}`;
}

/** Mass drivers throw minerals to the colony's designated destination. */
function shipMinerals(empire: Empire, system: Galaxy, colony: Colony, stats: EmpireStats, year: number): void {
  const drivers = installationCount(colony, "mass-driver");
  if (!drivers || !colony.massDriverTarget) return;
  const target = empire.colonies.get(colony.massDriverTarget);
  if (!target || target === colony) return;
  // A mass driver throws within its own system only.
  if (system.byId.get(colony.bodyId)?.systemId !== system.byId.get(target.bodyId)?.systemId) return;

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

/**
 * Research points a project generates per year as things stand. Computed
 * rather than remembered, so a project that has not yet been through a
 * production cycle still reports its rate instead of reading as stalled.
 */
export function projectRate(empire: Empire, project: ResearchProject): number {
  const colony = empire.colonies.get(project.colonyId);
  if (!colony) return 0;
  const scientist = empire.officers.get(project.scientistId ?? undefined);
  const available = installationCount(colony, "research-lab");
  const capacity = scientist ? labCapacity(scientist) : 0;
  const labs = Math.min(project.labs, available, capacity);
  if (labs <= 0) return 0;
  return (
    labs * empire.stats.researchRate * employmentRatio(colony) * (1 + bonus(scientist, "research")) *
    empire.effectFactor("research", project.colonyId)
  );
}

/** Apply research points to every active project. Returns RP spent. */
function advanceResearch(empire: Empire, system: Galaxy, now: number, year: number): number {
  let total = 0;

  for (const project of [...empire.projects]) {
    const colony = empire.colonies.get(project.colonyId);
    const body = system.byId.get(project.colonyId);
    if (!colony || !body) continue;

    const scientist = empire.officers.get(project.scientistId ?? undefined);
    // A project cannot use more labs than exist, nor more than its scientist
    // can personally direct; projectRate applies both limits.
    const rate = projectRate(empire, project);
    project.lastRate = rate;
    if (rate <= 0) continue;
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
        { view: "research", techId: tech.id },
      );
    }
  }

  return total;
}
