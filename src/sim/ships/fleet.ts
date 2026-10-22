/**
 * Ships, fleets, and moving them about.
 *
 * Movement is integrated every frame against simulated time rather than on
 * the five-day production cycle, so a fleet crosses the map smoothly and
 * arrives when it actually arrives. Everything else a fleet does - loading,
 * unloading, refuelling, surveying - happens the moment it reaches a body,
 * in the order the player queued it.
 */

import type { Empire } from "../../state/empire";
import type { StarSystem } from "../system";
import type { MineralName } from "../minerals";
import { MINERALS } from "../minerals";
import { AU_KM, vecLength, vecSub, type Vec3 } from "../orbit";
import { INSTALLATION_BY_ID } from "../economy/installations";
import { bonus } from "../people/officers";
import { SURVEY_POINTS_NEEDED } from "./components";
import { planProgram } from "./programs";

export interface Ship {
  id: string;
  name: string;
  designId: string;
  fleetId: string;
  /** Litres aboard. */
  fuel: number;
  built: number;
}

export type FleetOrder =
  | { kind: "move"; bodyId: string }
  | { kind: "load-installation"; installationId: string; quantity: number }
  | { kind: "unload-installations" }
  | { kind: "load-colonists"; amount: number }
  | { kind: "unload-colonists" }
  | { kind: "load-minerals"; mineral: MineralName; amount: number }
  | { kind: "unload-minerals" }
  | { kind: "refuel" }
  | { kind: "survey" };

export interface FleetCargo {
  installations: Record<string, number>;
  minerals: Partial<Record<MineralName, number>>;
  /** People, not millions. */
  colonists: number;
}

export interface Fleet {
  id: string;
  name: string;
  shipIds: string[];
  /** Survey points banked on the body the fleet is currently surveying. */
  surveyProgress: number;
  /** Heliocentric position in AU. */
  position: Vec3;
  /** Body the fleet is sitting at, if any. A parked fleet orbits with it. */
  anchorId: string | null;
  orders: FleetOrder[];
  cargo: FleetCargo;
  commanderId: string | null;
  /** Set when the fleet cannot execute its orders. */
  note: string | null;
  /** Finished orders go to the back of the queue instead of away. */
  loop: boolean;
  /** A standing programme the fleet follows whenever it has nothing else to do. */
  program: FleetProgram | null;
  /** Simulation time before which an idle programme is not re-planned. */
  waitUntil: number;
  /** What the programme is doing or waiting for, in words. */
  programStatus: string | null;
}

/** What a freight leg carries. */
export type CargoSpec =
  | { kind: "minerals"; mineral: MineralName | "all"; keep: number }
  | { kind: "installations"; installationId: string | "all" }
  | { kind: "colonists"; amount: number };

export type FleetProgram =
  /** Survey every unsurveyed body, nearest first, refuelling as needed. */
  | { kind: "survey"; maxAu: number }
  /**
   * Shuttle between two colonies. `there` is carried from `fromId` to `toId`
   * (the fleet waits at the source until there is something to take);
   * `back` is carried the other way if there is anything to bring.
   */
  | { kind: "freight"; fromId: string; toId: string; there: CargoSpec | null; back: CargoSpec | null };

/**
 * Finish the order at the head of the queue. A fleet set to repeat sends it
 * to the back instead, so the same circuit runs again.
 */
function retire(fleet: Fleet): void {
  const done = fleet.orders.shift();
  if (done && fleet.loop) fleet.orders.push(done);
}

/** Routine work of an automated fleet is logged but does not interrupt. */
function routine(fleet: Fleet): boolean {
  return fleet.loop || fleet.program !== null;
}

export function emptyCargo(): FleetCargo {
  return { installations: {}, minerals: {}, colonists: 0 };
}

// --------------------------------------------------------------- fleet stats

export interface FleetStats {
  ships: number;
  tons: number;
  /** km/s, the slowest ship in the fleet; zero if anything is dry. */
  speed: number;
  fuel: number;
  fuelCapacity: number;
  /** Litres per hour under way. */
  fuelPerHour: number;
  cargoCapacity: number;
  cargoUsed: number;
  colonistCapacity: number;
  canSurvey: boolean;
  /** Survey points per day across every geological sensor in the fleet. */
  surveyRate: number;
  /** AU the fleet can still cover on the fuel aboard. */
  rangeAu: number;
}

/** Tons of a single installation, for cargo accounting. */
export function installationTons(installationId: string): number {
  return INSTALLATION_BY_ID.get(installationId)?.tons ?? 25_000;
}

export function cargoTons(cargo: FleetCargo): number {
  let total = 0;
  for (const [id, count] of Object.entries(cargo.installations)) {
    total += installationTons(id) * count;
  }
  for (const amount of Object.values(cargo.minerals)) total += amount ?? 0;
  return total;
}

export function fleetStats(empire: Empire, fleet: Fleet): FleetStats {
  let tons = 0;
  let speed = Infinity;
  let fuel = 0;
  let fuelCapacity = 0;
  let fuelPerHour = 0;
  let cargoCapacity = 0;
  let colonistCapacity = 0;
  let surveyRate = 0;
  let dry = false;

  for (const shipId of fleet.shipIds) {
    const ship = empire.ships.get(shipId);
    const stats = ship && empire.statsOf(ship.designId);
    if (!ship || !stats) continue;
    tons += stats.tons;
    speed = Math.min(speed, stats.speed);
    fuel += ship.fuel;
    fuelCapacity += stats.fuelCapacity;
    fuelPerHour += stats.fuelPerHour;
    cargoCapacity += stats.cargoCapacity;
    colonistCapacity += stats.colonistCapacity;
    surveyRate += stats.survey.geological;
    if (ship.fuel <= 0) dry = true;
  }

  const commander = empire.officers.get(fleet.commanderId ?? undefined);
  // A good engineer stretches the fuel; the effect is deliberately modest.
  const efficiency = 1 - bonus(commander, "engineering") / 2;
  fuelPerHour *= efficiency;

  const finalSpeed = !fleet.shipIds.length || dry || !Number.isFinite(speed) ? 0 : speed;
  const enduranceHours = fuelPerHour > 0 ? fuel / fuelPerHour : 0;

  return {
    ships: fleet.shipIds.length,
    tons,
    speed: finalSpeed,
    fuel,
    fuelCapacity,
    fuelPerHour,
    cargoCapacity,
    cargoUsed: cargoTons(fleet.cargo),
    colonistCapacity,
    canSurvey: surveyRate > 0,
    surveyRate,
    rangeAu: (finalSpeed * 3600 * enduranceHours) / AU_KM,
  };
}

/** Seconds until the fleet reaches its current destination, if it has one. */
export function fleetEta(empire: Empire, system: StarSystem, fleet: Fleet): number | null {
  const destination = destinationOf(fleet);
  if (!destination) return null;
  const target = system.byId.get(destination);
  if (!target) return null;
  const stats = fleetStats(empire, fleet);
  if (stats.speed <= 0) return null;
  const distance = vecLength(vecSub(target.world, fleet.position));
  return (distance * AU_KM) / stats.speed;
}

/** Distance in AU from the fleet to a body. */
export function distanceToBody(fleet: Fleet, world: Vec3): number {
  return vecLength(vecSub(world, fleet.position));
}

/** Where a fleet is heading, if it is heading anywhere. */
export function destinationOf(fleet: Fleet): string | null {
  const order = fleet.orders[0];
  return order?.kind === "move" ? order.bodyId : null;
}

// ------------------------------------------------------------------ movement

/**
 * Advance every fleet by `seconds` of simulated time. Called from the frame
 * loop, not the production cycle, so travel is continuous.
 */
export function updateFleets(empire: Empire, system: StarSystem, seconds: number): void {
  if (seconds <= 0) return;

  for (const fleet of empire.fleets.values()) {
    // Anything parked stays with its body, which is itself in orbit.
    if (fleet.anchorId) {
      const body = system.byId.get(fleet.anchorId);
      if (body) fleet.position = { ...body.world };
    }

    executeArrivalOrders(empire, system, fleet);

    // A time step at thirty days a second can cover several legs, so the
    // fleet spends its budget until it runs out or runs out of orders.
    let budget = seconds;
    let guard = 0;
    while (budget > 0 && guard++ < 16) {
      let order = fleet.orders[0];
      // Out of orders: a fleet with a standing programme works out its next move.
      if (!order && fleet.program && empire.lastTick >= fleet.waitUntil) {
        planProgram(empire, system, fleet);
        executeArrivalOrders(empire, system, fleet);
        order = fleet.orders[0];
      }
      if (order?.kind === "survey" && fleet.anchorId) {
        budget = spendSurveyTime(empire, system, fleet, budget);
        continue;
      }
      if (!order || order.kind !== "move") break;

      const target = system.byId.get(order.bodyId);
      if (!target) {
        fleet.orders.shift();
        continue;
      }

      const stats = fleetStats(empire, fleet);
      if (stats.speed <= 0) {
        fleet.note = stats.fuel <= 0 ? "Out of fuel" : "No ships able to move";
        break;
      }

      const delta = vecSub(target.world, fleet.position);
      const distance = vecLength(delta);
      const reach = (stats.speed * budget) / AU_KM;

      if (reach >= distance || distance < 1e-9) {
        const used = distance > 0 ? (distance / stats.speed) * AU_KM : 0;
        burnFuel(empire, fleet, Math.min(used, budget));
        budget -= Math.min(used, budget);

        fleet.position = { ...target.world };
        fleet.anchorId = target.id;
        retire(fleet);
        fleet.note = null;
        empire.addLog(
          empire.lastTick, "fleet", `${fleet.name} has arrived at ${target.name}.`,
          { view: "fleets", fleetId: fleet.id }, routine(fleet),
        );
        executeArrivalOrders(empire, system, fleet);
        continue;
      }

      const scale = reach / distance;
      fleet.position = {
        x: fleet.position.x + delta.x * scale,
        y: fleet.position.y + delta.y * scale,
        z: fleet.position.z + delta.z * scale,
      };
      fleet.anchorId = null;
      fleet.surveyProgress = 0;
      fleet.note = null;
      burnFuel(empire, fleet, budget);
      budget = 0;
    }
  }
}

/**
 * Survey a body for as long as the budget allows. Returns the budget left.
 * Completing a survey reveals the body's deposits and moves on to the next
 * order.
 */
function spendSurveyTime(empire: Empire, system: StarSystem, fleet: Fleet, budget: number): number {
  const bodyId = fleet.anchorId!;
  const stats = fleetStats(empire, fleet);
  if (stats.surveyRate <= 0) {
    fleet.note = "No survey sensors aboard";
    return 0;
  }
  fleet.note = null;

  const needed = SURVEY_POINTS_NEEDED - fleet.surveyProgress;
  const secondsNeeded = (needed / stats.surveyRate) * 86_400;

  if (budget < secondsNeeded) {
    fleet.surveyProgress += (stats.surveyRate * budget) / 86_400;
    return 0;
  }

  fleet.surveyProgress = 0;
  retire(fleet);
  empire.surveyed.add(bodyId);
  const body = system.byId.get(bodyId);
  const deposits = body?.minerals.length ?? 0;
  empire.addLog(
    empire.lastTick,
    "fleet",
    `${fleet.name} has surveyed ${body?.name ?? bodyId}: ${
      deposits ? `${deposits} mineral deposits found` : "no deposits found"
    }.`,
    { view: "map", bodyId },
    // A survey programme reports once, when it is done, not for every body.
    fleet.program?.kind === "survey",
  );
  executeArrivalOrders(empire, system, fleet);
  return budget - secondsNeeded;
}

function burnFuel(empire: Empire, fleet: Fleet, seconds: number): void {
  const commander = empire.officers.get(fleet.commanderId ?? undefined);
  const efficiency = 1 - bonus(commander, "engineering") / 2;

  for (const shipId of fleet.shipIds) {
    const ship = empire.ships.get(shipId);
    const stats = ship && empire.statsOf(ship.designId);
    if (!ship || !stats) continue;
    const burn = (stats.fuelPerHour * efficiency * seconds) / 3600;
    const before = ship.fuel;
    ship.fuel = Math.max(0, ship.fuel - burn);
    if (before > 0 && ship.fuel <= 0) {
      empire.addLog(empire.lastTick, "fleet", `${ship.name} has run out of fuel.`, { view: "fleets", fleetId: fleet.id });
    }
  }
}

// -------------------------------------------------------------- cargo orders

/**
 * Work through every order at the head of the queue that can be carried out
 * where the fleet is standing. Stops at the next move order.
 */
export function executeArrivalOrders(empire: Empire, system: StarSystem, fleet: Fleet): void {
  let guard = 0;
  while (fleet.orders.length && fleet.orders[0].kind !== "move" && guard++ < 32) {
    const order = fleet.orders[0];
    const colony = fleet.anchorId ? empire.colonies.get(fleet.anchorId) : undefined;

    if (order.kind === "survey") {
      if (!fleet.anchorId) break;
      // Already known: nothing to do. Otherwise surveying takes time, which
      // updateFleets spends; here the order simply waits its turn.
      if (empire.surveyed.has(fleet.anchorId)) {
        retire(fleet);
        fleet.surveyProgress = 0;
        continue;
      }
      if (!fleetStats(empire, fleet).canSurvey) fleet.note = "No survey sensors aboard";
      break;
    }

    if (!colony) {
      fleet.note = "No colony here to trade with";
      break;
    }

    const stats = fleetStats(empire, fleet);
    switch (order.kind) {
      case "load-installation": {
        const stored = colony.stored[order.installationId] ?? 0;
        const perUnit = installationTons(order.installationId);
        const room = Math.max(0, stats.cargoCapacity - cargoTons(fleet.cargo));
        const taken = Math.min(order.quantity, stored, Math.floor(room / perUnit));
        if (taken > 0) {
          colony.stored[order.installationId] = stored - taken;
          fleet.cargo.installations[order.installationId] =
            (fleet.cargo.installations[order.installationId] ?? 0) + taken;
        }
        if (taken < order.quantity) {
          fleet.note = stored <= 0 ? "Nothing in store to load" : "Cargo holds full";
        }
        break;
      }
      case "unload-installations": {
        for (const [id, count] of Object.entries(fleet.cargo.installations)) {
          if (count <= 0) continue;
          colony.installations[id] = (colony.installations[id] ?? 0) + count;
        }
        if (routine(fleet)) logDelivery(empire, system, fleet, colony.bodyId, "installations");
        fleet.cargo.installations = {};
        break;
      }
      case "load-colonists": {
        const room = stats.colonistCapacity - fleet.cargo.colonists;
        const available = colony.population * 1e6;
        const taken = Math.max(0, Math.min(order.amount, room, available));
        colony.population -= taken / 1e6;
        fleet.cargo.colonists += taken;
        if (taken <= 0) fleet.note = room <= 0 ? "No berths free" : "Nobody to embark";
        break;
      }
      case "unload-colonists": {
        colony.population += fleet.cargo.colonists / 1e6;
        if (fleet.cargo.colonists > 0) {
          empire.addLog(
            empire.lastTick,
            "colony",
            `${Math.round(fleet.cargo.colonists).toLocaleString()} colonists have landed on ${
              system.byId.get(colony.bodyId)?.name ?? colony.bodyId
            }.`,
            { view: "colonies", bodyId: colony.bodyId },
            routine(fleet),
          );
        }
        fleet.cargo.colonists = 0;
        break;
      }
      case "load-minerals": {
        const room = Math.max(0, stats.cargoCapacity - cargoTons(fleet.cargo));
        const taken = Math.min(order.amount, colony.stockpile[order.mineral], room);
        if (taken > 0) {
          colony.stockpile[order.mineral] -= taken;
          fleet.cargo.minerals[order.mineral] =
            (fleet.cargo.minerals[order.mineral] ?? 0) + taken;
        }
        break;
      }
      case "unload-minerals": {
        for (const mineral of MINERALS) {
          const amount = fleet.cargo.minerals[mineral] ?? 0;
          if (amount > 0) colony.stockpile[mineral] += amount;
        }
        if (routine(fleet)) logDelivery(empire, system, fleet, colony.bodyId, "minerals");
        fleet.cargo.minerals = {};
        break;
      }
      case "refuel": {
        for (const shipId of fleet.shipIds) {
          const ship = empire.ships.get(shipId);
          const stats = empire.statsOf(ship?.designId);
          if (!ship || !stats) continue;
          const wanted = Math.max(0, stats.fuelCapacity - ship.fuel);
          const taken = Math.min(wanted, colony.fuel);
          ship.fuel += taken;
          colony.fuel -= taken;
        }
        break;
      }
    }

    retire(fleet);
  }
}

/** A quiet line in the log for goods an automated fleet has just set down. */
function logDelivery(
  empire: Empire,
  system: StarSystem,
  fleet: Fleet,
  bodyId: string,
  kind: "minerals" | "installations",
): void {
  const total = kind === "minerals"
    ? Object.values(fleet.cargo.minerals).reduce<number>((sum, n) => sum + (n ?? 0), 0)
    : Object.values(fleet.cargo.installations).reduce((sum, n) => sum + n, 0);
  if (total <= 0) return;
  empire.addLog(
    empire.lastTick,
    "fleet",
    `${fleet.name} delivered ${Math.round(total).toLocaleString()}${kind === "minerals" ? " t of minerals" : " installations"} to ${
      system.byId.get(bodyId)?.name ?? bodyId
    }.`,
    { view: "fleets", fleetId: fleet.id },
    true,
  );
}
