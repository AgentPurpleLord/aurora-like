/**
 * The arithmetic of ship maintenance, after Aurora.
 *
 * A military ship runs a maintenance clock from the day it leaves a base able
 * to look after it. Every five-day increment it may suffer a failure in one
 * of its systems; the older the clock, the likelier. A failure is prevented
 * by spending maintenance supplies (MSP) equal to the cost of the system; with
 * too few, the system is destroyed. Engineering sections cut the failure
 * rate; storage bays carry more supplies.
 *
 * Commercial classes - no military parts, no warship hull - are exempt, as in
 * Aurora: freighters and colony ships are not kept in readiness.
 *
 * Pure functions of a class's systems, so the class summary and the running
 * simulation can never disagree.
 */

/** Expected failures a year, at clock zero, per BP of wear-weighted system cost. */
export const FAIL_RATE_PER_BP = 0.002;
/** Failure rate is multiplied by 1 + this x the years on the clock. */
export const CLOCK_SLOPE = 2;
/** A ship this many years from overhaul is worn out (condition 0). */
export const MAX_CLOCK_YEARS = 3;
/** How strongly engineering share cuts failures: factor = 1 / (1 + this x share). */
export const ENGINEERING_REDUCTION = 8;
/** Production cycle length, days: failures roll once per increment. */
export const INCREMENT_DAYS = 5;
/** Overhaul unwinds this many days of clock per day. */
export const OVERHAUL_SPEED = 4;
/** MSP a ship in orbit of a base uses a year: this share of its build cost. */
export const DOCKED_MSP_SHARE = 0.25;
/** Damage control repairs cost this multiple of the system's cost. */
export const FIELD_REPAIR_MULTIPLE = 2;

export function clockMultiplier(clockYears: number): number {
  return 1 + CLOCK_SLOPE * Math.max(0, clockYears);
}

export function engineeringFactor(share: number): number {
  return 1 / (1 + ENGINEERING_REDUCTION * Math.max(0, share));
}

export interface MaintSystem {
  componentId: string;
  name: string;
  kind: string;
  count: number;
  /** BP: also what a failure costs in MSP. */
  unitCost: number;
  /** How likely one unit is to be the one that fails, relative to the others. */
  weight: number;
}

export interface MaintenanceProfile {
  /** False for commercial classes, which are not kept in readiness. */
  maintained: boolean;
  systems: MaintSystem[];
  mspCapacity: number;
  /** Share of the ship that is engineering section. */
  engineeringShare: number;
  /** Failures a year at clock zero. */
  afr0: number;
  /** Failures a year with one year on the clock - the "AFR" of a class summary. */
  afr: number;
  /** Chance of a failure in one five-day increment at one year on the clock. */
  ifr: number;
  /** Average MSP a failure costs. */
  averageCost: number;
  /** The dearest single system, doubled: the most a field repair can cost. */
  maxRepair: number;
  /** Years the carried supplies should last, from a fresh clock. */
  life: number;
  /** MSP expected to be used over the first year and the first five. */
  oneYear: number;
  fiveYear: number;
}

export function buildProfile(
  systems: MaintSystem[], mspCapacity: number, engineeringHS: number, hullSpaces: number, maintained: boolean,
): MaintenanceProfile {
  const share = hullSpaces > 0 ? engineeringHS / hullSpaces : 0;
  const weightSum = systems.reduce((s, x) => s + x.weight * x.count, 0);
  const afr0 = maintained ? FAIL_RATE_PER_BP * weightSum * engineeringFactor(share) : 0;
  // Weight is wear x cost; the average cost of a failure is weighted by it.
  const avg = weightSum > 0
    ? systems.reduce((s, x) => s + x.weight * x.count * x.unitCost, 0) / weightSum
    : 0;
  const perYear = avg * afr0;
  const life = perYear > 0 ? (-1 + Math.sqrt(1 + (4 * mspCapacity) / perYear)) / 2 : Infinity;
  const afr = afr0 * clockMultiplier(1);
  return {
    maintained,
    systems,
    mspCapacity,
    engineeringShare: share,
    afr0,
    afr,
    ifr: 1 - Math.exp(-afr / (365.25 / INCREMENT_DAYS)),
    averageCost: avg,
    maxRepair: systems.reduce((m, x) => Math.max(m, x.unitCost), 0) * FIELD_REPAIR_MULTIPLE,
    life,
    oneYear: perYear * (1 + CLOCK_SLOPE / 2),
    fiveYear: perYear * FIVE_YEAR_INTEGRAL,
  };
}

/** Integral of the failure multiplier over the first five years: 5 + 2 x 25 / 2. */
const FIVE_YEAR_INTEGRAL = 5 + (CLOCK_SLOPE * 25) / 2;

/** Chance a ship with this clock suffers a failure in one increment. */
export function incrementChance(profile: MaintenanceProfile, clockDays: number): number {
  const perYear = profile.afr0 * clockMultiplier(clockDays / 365.25);
  return 1 - Math.exp(-(perYear * INCREMENT_DAYS) / 365.25);
}

/** Readiness from the clock alone: 100 fresh, 0 at the worn-out age. */
export function clockCondition(clockDays: number): number {
  return Math.max(0, 100 * (1 - clockDays / (MAX_CLOCK_YEARS * 365.25)));
}
