/**
 * Keeping military ships ready, after Aurora.
 *
 * A military ship carries maintenance supplies (MSP) in storage bays and
 * engineering sections, and runs a maintenance clock while it is away from a
 * base that can look after it. Each five-day increment on the clock it may
 * suffer a failure in one of its systems: spending MSP equal to that
 * system's cost prevents it, and without enough the system is destroyed -
 * an engine gone is speed lost, a jump drive gone may strand the ship. A
 * destroyed system is repaired by a shipyard (1x its cost, from the colony's
 * supplies) or by the crew (2x, from the ship's own, which takes an
 * engineering section).
 *
 * A ship parked at a colony whose maintenance facilities and shipyards have
 * the capacity for it, and which has supplies to draw on, does not run its
 * clock; it uses a quarter of its build cost in MSP a year, refills its
 * stores, and has its clock wound back four days for each day: an overhaul.
 *
 * Commercial classes are exempt. `condition` stays as a plain 0-100 reading
 * of readiness (clock and lost systems) for the screens that show it.
 */

import type { Empire } from "../../state/empire";
import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import type { Galaxy } from "../galaxy";
import type { Fleet, Ship } from "./fleet";
import {
  DOCKED_MSP_SHARE, FIELD_REPAIR_MULTIPLE, MAX_CLOCK_YEARS, OVERHAUL_SPEED, clockCondition, incrementChance,
} from "./maintenanceModel";

/** Tons of ship a shipyard can look after on its own, without maintenance facilities. */
export const SHIPYARD_SERVICE_TONS = 1500;
/** Below this condition a ship is overdue for overhaul. */
export const OVERDUE = 40;
/** Below this its systems are failing often. */
export const FAILING = 30;
/** MSP a maintenance facility makes in a year, and the stock it can keep. */
export const MSP_PER_FACILITY = 40;
export const MSP_STORE_PER_FACILITY = 300;
/** Minerals one MSP is made from: 2.5 tons, as in Aurora. */
export const MSP_MINERALS: [string, number][] = [["Duranium", 1.5], ["Tritanium", 1.0]];

/** Tons of ship a colony can look after at once. */
export function servicingCapacity(empire: Empire, colony: Colony): number {
  return (
    installationCount(colony, "maintenance") * empire.stats.serviceTonsPerFacility +
    installationCount(colony, "shipyard") * SHIPYARD_SERVICE_TONS
  );
}

/** MSP a colony's facilities can hold. */
export function mspStoreCapacity(colony: Colony): number {
  return installationCount(colony, "maintenance") * MSP_STORE_PER_FACILITY;
}

export function requiresMaintenance(empire: Empire, ship: Ship): boolean {
  return empire.statsOf(ship.designId)?.maintenance.maintained ?? false;
}

export function clockYears(ship: Ship): number {
  return ship.clock / 365.25;
}

/** Units of a design's component that still work. */
export function working(ship: Ship, componentId: string, count: number): number {
  return Math.max(0, count - (ship.broken[componentId] ?? 0));
}

export function brokenCount(ship: Ship): number {
  return Object.values(ship.broken).reduce((s, n) => s + n, 0);
}

/**
 * How much of a kind of capability the ship still has, 0 to 1: engines for
 * speed, jump drives for jumping, holds for cargo and so on.
 */
export function workingShare(empire: Empire, ship: Ship, kind: string): number {
  const stats = empire.statsOf(ship.designId);
  if (!stats || !brokenCount(ship)) return 1;
  let total = 0;
  let ok = 0;
  for (const system of stats.maintenance.systems) {
    if (system.kind !== kind) continue;
    total += system.count;
    ok += working(ship, system.componentId, system.count);
  }
  return total > 0 ? ok / total : 1;
}

/** Readiness 0-100: the clock, and the share of the ship's value that has been lost. */
export function shipCondition(empire: Empire, ship: Ship): number {
  const stats = empire.statsOf(ship.designId);
  if (!stats || !stats.maintenance.maintained) return 100;
  let value = 0;
  let lost = 0;
  for (const system of stats.maintenance.systems) {
    value += system.unitCost * system.count;
    lost += system.unitCost * Math.min(system.count, ship.broken[system.componentId] ?? 0);
  }
  return clockCondition(ship.clock) * (value > 0 ? 1 - lost / value : 1);
}

/** The clock's age as a share of the worn-out age, for gauges. */
export function clockFraction(ship: Ship): number {
  return Math.min(1, ship.clock / (MAX_CLOCK_YEARS * 365.25));
}

export interface MaintenanceResult {
  /** Kept for the production cycle's books; supplies replaced the treasury cost. */
  cost: number;
  restored: number;
}

function pickSystem(empire: Empire, ship: Ship): { componentId: string; name: string; unitCost: number } | null {
  const stats = empire.statsOf(ship.designId);
  if (!stats) return null;
  const live = stats.maintenance.systems
    .map((s) => ({ s, n: working(ship, s.componentId, s.count) }))
    .filter((x) => x.n > 0 && x.s.weight > 0);
  const total = live.reduce((sum, x) => sum + x.s.weight * x.n, 0);
  if (total <= 0) return null;
  let roll = empire.maintRng.float() * total;
  for (const x of live) {
    roll -= x.s.weight * x.n;
    if (roll <= 0) return x.s;
  }
  return live[live.length - 1].s;
}

/**
 * Run one production cycle of maintenance: shipyards repair, bases overhaul
 * and resupply what they cover, and everything else ages and may fail.
 */
export function maintainShips(empire: Empire, galaxy: Galaxy, days: number): MaintenanceResult {
  const result: MaintenanceResult = { cost: 0, restored: 0 };
  if (!empire.ships.size) return result;
  const year = days / 365.25;
  const now = empire.lastTick;

  // Ships waiting at each colony, in a fixed order, so cover is first come first served.
  const waiting = new Map<string, { ship: Ship; fleet: Fleet }[]>();
  for (const fleet of empire.fleets.values()) {
    if (!fleet.anchorId || !empire.colonies.has(fleet.anchorId)) continue;
    for (const id of fleet.shipIds) {
      const ship = empire.ships.get(id);
      if (!ship || !requiresMaintenance(empire, ship)) continue;
      (waiting.get(fleet.anchorId) ?? waiting.set(fleet.anchorId, []).get(fleet.anchorId)!).push({ ship, fleet });
    }
  }
  for (const ship of empire.ships.values()) ship.covered = false;

  for (const [colonyId, list] of waiting) {
    const colony = empire.colonies.get(colonyId)!;
    let room = servicingCapacity(empire, colony);
    const hasYard = installationCount(colony, "shipyard") > 0;
    list.sort((a, b) => a.ship.id.localeCompare(b.ship.id, undefined, { numeric: true }));
    for (const { ship } of list) {
      const stats = empire.statsOf(ship.designId)!;
      if (stats.tons > room) continue;
      // Draw the upkeep from the colony's stores, then the ship's own.
      const overhauling = ship.clock > 0;
      const need = stats.buildCost * (overhauling ? 1 : DOCKED_MSP_SHARE) * year;
      if (colony.msp + ship.msp < need) continue;
      room -= stats.tons;
      ship.covered = true;
      const fromColony = Math.min(colony.msp, need);
      colony.msp -= fromColony;
      ship.msp -= need - fromColony;

      if (overhauling) {
        const unwound = Math.min(ship.clock, OVERHAUL_SPEED * days);
        ship.clock -= unwound;
        result.restored += unwound;
      }
      // Shipyards repair destroyed systems at their ordinary cost.
      if (hasYard && brokenCount(ship) > 0) {
        for (const system of stats.maintenance.systems) {
          if ((ship.broken[system.componentId] ?? 0) > 0 && colony.msp >= system.unitCost) {
            colony.msp -= system.unitCost;
            ship.broken[system.componentId]--;
            if (ship.broken[system.componentId] <= 0) delete ship.broken[system.componentId];
            empire.addLog(now, "fleet", `${ship.name}: ${system.name} repaired at ${galaxy.byId.get(colonyId)?.name ?? colonyId}.`, { view: "fleets", fleetId: ship.fleetId }, true);
            break;
          }
        }
      }
      // Top the stores up.
      const room2 = Math.max(0, stats.maintenance.mspCapacity - ship.msp);
      const loaded = Math.min(room2, colony.msp);
      colony.msp -= loaded;
      ship.msp += loaded;
    }
  }

  // Everything not covered ages, and may fail.
  for (const ship of empire.ships.values()) {
    if (!requiresMaintenance(empire, ship)) {
      ship.clock = 0;
      ship.condition = 100;
      continue;
    }
    if (!ship.covered) {
      ship.clock += days;
      const stats = empire.statsOf(ship.designId)!;
      if (empire.maintRng.chance(incrementChance(stats.maintenance, ship.clock))) failSystem(empire, ship, now);
    }
    ship.condition = shipCondition(empire, ship);
  }
  return result;
}

export function failSystem(empire: Empire, ship: Ship, now: number): void {
  const system = pickSystem(empire, ship);
  if (!system) return;
  const link = { view: "fleets" as const, fleetId: ship.fleetId };
  if (ship.msp >= system.unitCost) {
    ship.msp -= system.unitCost;
    empire.addLog(now, "fleet", `${ship.name}: a ${system.name} failure was prevented (${Math.round(system.unitCost)} MSP).`, link, true);
    return;
  }
  ship.broken[system.componentId] = (ship.broken[system.componentId] ?? 0) + 1;
  empire.addLog(
    now, "fleet",
    `${ship.name}: a ${system.name} has failed with no supplies to prevent it and is out of action (${Math.round(system.unitCost)} MSP needed).`,
    link,
  );
}

/**
 * The crew repair a destroyed system, at double the cost, from the ship's own
 * supplies. Needs an engineering section aboard. Returns why not, or null.
 */
export function fieldRepair(empire: Empire, ship: Ship): string | null {
  const stats = empire.statsOf(ship.designId);
  if (!stats) return "No such class.";
  if (!brokenCount(ship)) return "Nothing is broken.";
  if (!stats.maintenance.systems.some((s) => s.kind === "engineering" && working(ship, s.componentId, s.count) > 0)) {
    return "Damage control needs a working engineering section aboard.";
  }
  const cheapest = stats.maintenance.systems
    .filter((s) => (ship.broken[s.componentId] ?? 0) > 0)
    .sort((a, b) => a.unitCost - b.unitCost)[0];
  if (!cheapest) return "Nothing is broken.";
  const cost = cheapest.unitCost * FIELD_REPAIR_MULTIPLE;
  if (ship.msp < cost) return `Repairing ${cheapest.name} costs ${Math.round(cost)} MSP (double); the ship has ${Math.round(ship.msp)}.`;
  ship.msp -= cost;
  ship.broken[cheapest.componentId]--;
  if (ship.broken[cheapest.componentId] <= 0) delete ship.broken[cheapest.componentId];
  ship.condition = shipCondition(empire, ship);
  empire.addLog(empire.lastTick, "fleet", `${ship.name}: the crew repaired a ${cheapest.name} for ${Math.round(cost)} MSP.`, { view: "fleets", fleetId: ship.fleetId });
  return null;
}

/** What colonies' maintenance facilities make, drawn from their own stockpiles. */
export function produceSupplies(empire: Empire, colony: Colony, employment: number, year: number): number {
  const facilities = installationCount(colony, "maintenance");
  if (facilities <= 0) return 0;
  const room = Math.max(0, mspStoreCapacity(colony) - colony.msp);
  let made = Math.min(room, facilities * MSP_PER_FACILITY * employment * year);
  for (const [mineral, per] of MSP_MINERALS) {
    made = Math.min(made, colony.stockpile[mineral as keyof typeof colony.stockpile] / per);
  }
  if (made <= 0) return 0;
  for (const [mineral, per] of MSP_MINERALS) colony.stockpile[mineral as keyof typeof colony.stockpile] -= made * per;
  colony.msp += made;
  void empire;
  return made;
}

/** Whether a fleet is being looked after at the colony it is parked at. */
export function fleetCovered(empire: Empire, fleet: Fleet): boolean {
  return fleet.shipIds.every((id) => {
    const ship = empire.ships.get(id);
    return !ship || !requiresMaintenance(empire, ship) || ship.covered;
  });
}

/** Ships worth worrying about, worst first. */
export function overdueShips(empire: Empire): Ship[] {
  return [...empire.ships.values()]
    .filter((s) => requiresMaintenance(empire, s) && s.condition < OVERDUE)
    .sort((a, b) => a.condition - b.condition);
}

/** The worst condition in a fleet. */
export function fleetCondition(empire: Empire, fleet: Fleet): number {
  let worst = 100;
  for (const id of fleet.shipIds) {
    const ship = empire.ships.get(id);
    if (ship) worst = Math.min(worst, ship.condition);
  }
  return worst;
}
