/**
 * Keeping ships running.
 *
 * Every ship has a condition, 100 when new. Using a ship wears it down, at a
 * rate set by what it is made of: military-specification engines, sensors and
 * drives wear more than twice as fast as commercial ones, and passive parts
 * hardly at all. A worn ship is slower, and below a third it starts to break
 * down. A colony with a shipyard or maintenance facilities services the ships
 * parked at it - restoring condition for a fee that is a share of what the
 * ship cost to build, so a warship is dear to keep and a freighter is not -
 * and capacity is limited: more ships than it can handle share what there is.
 *
 * Nothing here is stored beyond the one number on each ship; wear rates,
 * capacities and costs are all derived.
 */

import type { Empire } from "../../state/empire";
import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import type { Galaxy } from "../galaxy";
import type { Fleet, Ship } from "./fleet";

/** Condition points a ship of wear 1 loses in a year under way. */
export const WEAR_PER_YEAR = 28;
/** Condition points a serviced ship regains per day, at full capacity. */
export const SERVICE_POINTS_PER_DAY = 4;
/** What a complete overhaul costs, as a share of the ship's build cost. */
export const SERVICE_COST_SHARE = 0.15;
/** Tons of ship a shipyard can service on its own, without facilities. */
export const SHIPYARD_SERVICE_TONS = 1500;
/** Below this condition a ship is overdue for service. */
export const OVERDUE = 40;
/** Below this a ship may break down. */
export const FAILING = 30;


/** Speed multiplier for a ship's condition: a wreck still limps at 60%. */
export function conditionSpeed(condition: number): number {
  return 0.6 + 0.4 * Math.max(0, Math.min(100, condition)) / 100;
}

/** Tons of ship a colony can service at once. */
export function servicingCapacity(empire: Empire, colony: Colony): number {
  return (
    installationCount(colony, "maintenance") * empire.stats.serviceTonsPerFacility +
    installationCount(colony, "shipyard") * SHIPYARD_SERVICE_TONS
  );
}

/** Condition points a ship loses per year while working. */
export function wearPerYear(empire: Empire, ship: Ship): number {
  return WEAR_PER_YEAR * (empire.statsOf(ship.designId)?.wear ?? 1);
}

/** How hard a fleet is working: under way or surveying wears fully, parked far less. */
function workRate(fleet: Fleet, atColony: boolean): number {
  if (fleet.anchorId === null) return 1;
  const order = fleet.orders[0]?.kind;
  if (order === "survey" || order === "gravsurvey" || order === "build-gate") return 1;
  return atColony ? 0.15 : 0.4;
}

export interface MaintenanceResult {
  /** Treasury spent on servicing this cycle. */
  cost: number;
  /** Points of condition restored across all ships. */
  restored: number;
}

/**
 * Wear every ship that is working and service every ship that is parked at a
 * colony able to. Called once per production cycle.
 */
export function maintainShips(empire: Empire, galaxy: Galaxy, days: number): MaintenanceResult {
  const result: MaintenanceResult = { cost: 0, restored: 0 };
  if (!empire.ships.size) return result;

  // Who is waiting at which colony to be serviced.
  const queue = new Map<string, Ship[]>();
  const year = days / 365.25;

  for (const fleet of empire.fleets.values()) {
    const colony = fleet.anchorId ? empire.colonies.get(fleet.anchorId) : undefined;
    const capacity = colony ? servicingCapacity(empire, colony) : 0;

    for (const shipId of fleet.shipIds) {
      const ship = empire.ships.get(shipId);
      if (!ship) continue;
      if (colony && capacity > 0 && ship.condition < 100) {
        const list = queue.get(colony.bodyId) ?? [];
        list.push(ship);
        queue.set(colony.bodyId, list);
        continue;
      }
      const rate = workRate(fleet, colony !== undefined);
      ship.condition = Math.max(0, ship.condition - wearPerYear(empire, ship) * rate * year);
    }
  }

  // Service what is waiting, within what each colony can handle.
  for (const [colonyId, ships] of queue) {
    const colony = empire.colonies.get(colonyId)!;
    const capacity = servicingCapacity(empire, colony);
    const tons = ships.reduce((sum, s) => sum + (empire.statsOf(s.designId)?.tons ?? 0), 0);
    const share = tons > 0 ? Math.min(1, capacity / tons) : 1;
    for (const ship of ships) {
      const stats = empire.statsOf(ship.designId);
      const gain = Math.min(100 - ship.condition, SERVICE_POINTS_PER_DAY * days * share);
      ship.condition += gain;
      result.restored += gain;
      result.cost += (stats?.buildCost ?? 0) * SERVICE_COST_SHARE * (gain / 100);
    }
  }
  void galaxy;
  return result;
}

/** Ships worth worrying about, worst first. */
export function overdueShips(empire: Empire): Ship[] {
  return [...empire.ships.values()].filter((s) => s.condition < OVERDUE).sort((a, b) => a.condition - b.condition);
}

/** The nearest-condition summary of a fleet: its worst ship. */
export function fleetCondition(empire: Empire, fleet: Fleet): number {
  let worst = 100;
  for (const id of fleet.shipIds) {
    const ship = empire.ships.get(id);
    if (ship) worst = Math.min(worst, ship.condition);
  }
  return worst;
}
