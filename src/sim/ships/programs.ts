/**
 * Fleet programmes: standing orders for ships.
 *
 * A programme is not a list of orders. It is a rule - "survey every body",
 * "haul minerals from Earth to Mars" - that a fleet follows whenever it has
 * nothing queued. The planner looks at where the fleet is, what it carries
 * and what the colonies hold, and writes the next few ordinary orders; the
 * normal order machinery then flies and executes them. Because the state is
 * read fresh each time, nothing needs saving beyond the rule itself, and a
 * fleet that is interrupted, refuelled or re-routed simply picks up again.
 *
 * Planning happens only when a fleet is idle, so its cost is nothing for the
 * thousands of ships that are busy or unprogrammed.
 */

import type { Empire } from "../../state/empire";
import type { Colony } from "../../state/colony";
import type { Body, StarSystem } from "../system";
import { MINERALS, type MineralName } from "../minerals";
import { vecLength, vecSub, type Vec3 } from "../orbit";
import {
  cargoTons,
  fleetStats,
  installationTons,
  type CargoSpec,
  type Fleet,
  type FleetOrder,
  type FleetProgram,
  type FleetStats,
} from "./fleet";

/** An idle programme looks again after this long (a simulated day). */
const RECHECK_SECONDS = 86_400;
/** Distances are estimates while bodies move, so keep some fuel in hand. */
const RANGE_MARGIN = 1.15;
/** Top up before setting out if the tank is below this share. */
const REFUEL_BELOW = 0.7;
/** Treat a tank above this share as full. */
const FULL_TANK = 0.98;
/** Never carry fewer than this share of a hold on a mineral run. */
const MIN_LOAD_SHARE = 0.25;
/** A colony gives up at most this share of its people on one voyage. */
const MAX_COLONIST_SHARE = 0.2;

const distanceAu = (a: Vec3, b: Vec3): number => vecLength(vecSub(a, b));

export function describeProgram(program: FleetProgram, nameOf: (bodyId: string) => string): string {
  if (program.kind === "survey") {
    return program.maxAu > 0
      ? `Survey every body within ${program.maxAu} AU of the Sun`
      : "Survey every body in the system";
  }
  const there = program.there ? describeCargo(program.there) : null;
  const back = program.back ? describeCargo(program.back) : null;
  const route = `${nameOf(program.fromId)} - ${nameOf(program.toId)}`;
  if (there && back) return `Freight ${route}: ${there} out, ${back} back`;
  return `Freight ${route}: ${there ?? back}${there ? "" : " (return leg only)"}`;
}

export function describeCargo(spec: CargoSpec): string {
  switch (spec.kind) {
    case "minerals":
      return spec.mineral === "all" ? "minerals" : spec.mineral.toLowerCase();
    case "installations":
      return spec.installationId === "all" ? "stored installations" : spec.installationId.replace(/-/g, " ");
    case "colonists":
      return "colonists";
  }
}

/** Bodies a survey programme will cover, whether or not they are done. */
export function surveyScope(system: StarSystem, maxAu: number): Body[] {
  return system.bodies.filter(
    (b) => b.cls !== "star" && (maxAu <= 0 || vecLength(b.world) <= maxAu),
  );
}

// ------------------------------------------------------------------ planning

/** Write the fleet's next orders from its programme, or explain why it cannot. */
export function planProgram(empire: Empire, system: StarSystem, fleet: Fleet): void {
  const program = fleet.program;
  if (!program) return;

  fleet.note = null;
  fleet.programStatus = null;

  const stats = fleetStats(empire, fleet);
  if (!stats.ships) {
    wait(empire, fleet, "No ships in the fleet", "No ships in the fleet");
    return;
  }

  if (program.kind === "survey") planSurvey(empire, system, fleet, program, stats);
  else planFreight(empire, system, fleet, program, stats);
}

function wait(empire: Empire, fleet: Fleet, status: string, problem?: string): void {
  fleet.waitUntil = empire.lastTick + RECHECK_SECONDS;
  fleet.programStatus = status;
  fleet.note = problem ?? null;
}

/** The colony nearest a point, among those that can refuel (or any if none can). */
function nearestColony(empire: Empire, system: StarSystem, point: Vec3): { body: Body; colony: Colony; distance: number } | null {
  let best: { body: Body; colony: Colony; distance: number } | null = null;
  for (const colony of empire.colonies.values()) {
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    const distance = distanceAu(body.world, point);
    if (!best || distance < best.distance) best = { body, colony, distance };
  }
  return best;
}

function fuelShare(stats: FleetStats): number {
  return stats.fuelCapacity > 0 ? stats.fuel / stats.fuelCapacity : 1;
}

// ------------------------------------------------------------------- survey

/** Bodies other fleets are already on their way to survey, or surveying. */
function claimedTargets(empire: Empire, self: Fleet): Set<string> {
  const claimed = new Set<string>();
  for (const other of empire.fleets.values()) {
    if (other === self) continue;
    const orders = other.orders;
    if (orders[0]?.kind === "survey" && other.anchorId) claimed.add(other.anchorId);
    for (let i = 0; i < orders.length - 1; i++) {
      const order = orders[i];
      if (order.kind === "move" && orders[i + 1].kind === "survey") claimed.add(order.bodyId);
    }
  }
  return claimed;
}

function planSurvey(
  empire: Empire,
  system: StarSystem,
  fleet: Fleet,
  program: Extract<FleetProgram, { kind: "survey" }>,
  stats: FleetStats,
): void {
  if (!stats.canSurvey) {
    wait(empire, fleet, "No survey sensors aboard", "No survey sensors aboard");
    return;
  }

  const scope = surveyScope(system, program.maxAu);
  const pending = scope.filter((b) => !empire.surveyed.has(b.id));
  if (!pending.length) {
    finishSurvey(empire, system, fleet, scope.length);
    return;
  }

  const claimed = claimedTargets(empire, fleet);
  const open = pending
    .filter((b) => !claimed.has(b.id))
    .sort((a, b) => distanceAu(a.world, fleet.position) - distanceAu(b.world, fleet.position));
  if (!open.length) {
    wait(empire, fleet, "Other fleets are covering the rest");
    return;
  }

  const here = fleet.anchorId ? empire.colonies.get(fleet.anchorId) : undefined;
  const hasFuel = (here?.fuel ?? 0) > 0;

  // Top up before leaving a colony, rather than being sent back half way.
  if (here && hasFuel && fuelShare(stats) < REFUEL_BELOW) {
    fleet.orders.push({ kind: "refuel" });
    fleet.programStatus = "Refuelling";
    return;
  }

  // Nearest first, but only what the fuel aboard can reach and come home from.
  for (const target of open) {
    const out = distanceAu(fleet.position, target.world);
    const home = nearestColony(empire, system, target.world)?.distance ?? 0;
    if (stats.speed > 0 && stats.rangeAu >= (out + home) * RANGE_MARGIN) {
      fleet.orders.push({ kind: "move", bodyId: target.id }, { kind: "survey" });
      fleet.programStatus = `Surveying ${target.name} (${pending.length} to go)`;
      return;
    }
  }

  // Nothing reachable as things stand.
  if (here) {
    if (fuelShare(stats) < FULL_TANK && hasFuel) {
      fleet.orders.push({ kind: "refuel" });
      fleet.programStatus = "Refuelling";
    } else if (!hasFuel && fuelShare(stats) < FULL_TANK) {
      wait(empire, fleet, "No fuel at this colony", "No fuel at this colony");
    } else {
      wait(
        empire, fleet,
        `${pending.length} bodies are beyond this fleet's range`,
        "Remaining targets are beyond this fleet's range",
      );
    }
    return;
  }

  // Out in the dark: head for the nearest colony and fill up.
  const home = nearestColony(empire, system, fleet.position);
  if (!home || stats.speed <= 0 || stats.rangeAu < home.distance) {
    wait(empire, fleet, "Stranded", stats.fuel <= 0 ? "Out of fuel" : "Cannot reach a colony to refuel");
    return;
  }
  fleet.orders.push({ kind: "move", bodyId: home.body.id }, { kind: "refuel" });
  fleet.programStatus = `Returning to ${home.body.name} to refuel`;
}

function finishSurvey(empire: Empire, system: StarSystem, fleet: Fleet, count: number): void {
  const program = fleet.program;
  fleet.program = null;
  fleet.programStatus = null;
  const where = program?.kind === "survey" && program.maxAu > 0 ? `within ${program.maxAu} AU` : "in the system";
  const found = system.bodies
    .filter((b) => empire.surveyed.has(b.id))
    .reduce((sum, b) => sum + b.minerals.length, 0);
  empire.addLog(
    empire.lastTick,
    "fleet",
    `${fleet.name} has finished its survey programme: all ${count} bodies ${where} are surveyed (${found} deposits known in total).`,
    { view: "map" },
  );
  // Send the ship home rather than leaving it adrift between the planets.
  const home = nearestColony(empire, system, fleet.position);
  if (home && fleet.anchorId !== home.body.id) {
    fleet.orders.push({ kind: "move", bodyId: home.body.id });
  }
}

// ------------------------------------------------------------------- freight

function planFreight(
  empire: Empire,
  system: StarSystem,
  fleet: Fleet,
  line: Extract<FleetProgram, { kind: "freight" }>,
  stats: FleetStats,
): void {
  const from = empire.colonies.get(line.fromId);
  const to = empire.colonies.get(line.toId);
  const fromBody = system.byId.get(line.fromId);
  const toBody = system.byId.get(line.toId);
  if (!from || !to || !fromBody || !toBody) {
    wait(empire, fleet, "A colony on this line is gone", "A colony on this line is gone");
    return;
  }

  const aboard = cargoTons(fleet.cargo) > 0 || fleet.cargo.colonists > 0;
  const atFrom = fleet.anchorId === line.fromId;
  const atTo = fleet.anchorId === line.toId;

  // Somewhere in between: go to whichever end the load belongs at.
  if (!atFrom && !atTo) {
    if (stats.speed <= 0) {
      wait(empire, fleet, "Stranded", "Out of fuel");
      return;
    }
    const target = aboard ? line.toId : line.fromId;
    fleet.orders.push({ kind: "move", bodyId: target });
    fleet.programStatus = `Heading to ${system.byId.get(target)?.name ?? target}`;
    return;
  }

  const here = atFrom ? from : to;
  const hereBody = atFrom ? fromBody : toBody;
  const otherBody = atFrom ? toBody : fromBody;
  const spec = atFrom ? line.there : line.back;

  // 1. Set down whatever is aboard.
  const orders: FleetOrder[] = [];
  if (Object.keys(fleet.cargo.installations).length) orders.push({ kind: "unload-installations" });
  if (Object.values(fleet.cargo.minerals).some((n) => (n ?? 0) > 0)) orders.push({ kind: "unload-minerals" });
  if (fleet.cargo.colonists > 0) orders.push({ kind: "unload-colonists" });

  // 2. Fuel for the leg, topped up while here if it is short.
  const leg = distanceAu(hereBody.world, otherBody.world);
  const needFuel = fuelShare(stats) < REFUEL_BELOW || stats.speed <= 0 || stats.rangeAu < leg * RANGE_MARGIN;
  if (needFuel && here.fuel > 0 && fuelShare(stats) < FULL_TANK) {
    orders.push({ kind: "refuel" });
  } else if (needFuel && (stats.speed <= 0 || stats.rangeAu < leg * RANGE_MARGIN)) {
    wait(
      empire, fleet,
      stats.speed <= 0 ? `No fuel at ${hereBody.name}` : "The next leg is beyond this fleet's range",
      stats.speed <= 0 ? `No fuel at ${hereBody.name}` : "The next leg is beyond this fleet's range",
    );
    fleet.orders.push(...orders);
    return;
  }

  // 3. Cargo for the leg.
  const loads = spec ? loadOrders(here, spec, stats) : [];
  // The outbound end waits for cargo; the far end waits only on a return-only line.
  const holdsHere = spec !== null && (atFrom || line.there === null);
  if (spec && !loads.length && holdsHere) {
    fleet.orders.push(...orders);
    wait(empire, fleet, `Waiting for ${describeCargo(spec)} at ${hereBody.name}`);
    return;
  }

  fleet.orders.push(...orders, ...loads, { kind: "move", bodyId: otherBody.id });
  fleet.programStatus = loads.length
    ? `Carrying ${spec ? describeCargo(spec) : "cargo"} to ${otherBody.name}`
    : `Returning to ${otherBody.name}`;
}

/** Load orders that fill the hold from a colony according to a cargo rule. */
function loadOrders(colony: Colony, spec: CargoSpec, stats: FleetStats): FleetOrder[] {
  const orders: FleetOrder[] = [];

  if (spec.kind === "colonists") {
    if (stats.colonistCapacity <= 0) return orders;
    const take = Math.min(spec.amount, stats.colonistCapacity, colony.population * 1e6 * MAX_COLONIST_SHARE);
    if (colony.population > 0.5 && take >= 100) orders.push({ kind: "load-colonists", amount: Math.floor(take) });
    return orders;
  }

  let room = stats.cargoCapacity;
  if (room <= 0) return orders;

  if (spec.kind === "minerals") {
    const wanted: MineralName[] = spec.mineral === "all" ? [...MINERALS] : [spec.mineral];
    const available = wanted
      .map((mineral) => ({ mineral, tons: Math.max(0, colony.stockpile[mineral] - spec.keep) }))
      .filter((m) => m.tons > 0)
      .sort((a, b) => b.tons - a.tons);
    const total = Math.min(room, available.reduce((sum, m) => sum + m.tons, 0));
    if (total < stats.cargoCapacity * MIN_LOAD_SHARE) return orders;
    for (const { mineral, tons } of available) {
      if (room <= 0) break;
      const amount = Math.min(tons, room);
      orders.push({ kind: "load-minerals", mineral, amount });
      room -= amount;
    }
    return orders;
  }

  const kinds = spec.installationId === "all"
    ? Object.keys(colony.stored)
    : [spec.installationId];
  for (const installationId of kinds) {
    const stored = colony.stored[installationId] ?? 0;
    const tons = installationTons(installationId);
    const quantity = Math.min(stored, Math.floor(room / tons));
    if (quantity <= 0) continue;
    orders.push({ kind: "load-installation", installationId, quantity });
    room -= quantity * tons;
  }
  return orders;
}

/**
 * A rough forecast for the freight form: what a line can move before it is
 * built, from the fleet's own figures and the current distance.
 */
export function freightForecast(
  empire: Empire,
  system: StarSystem,
  fleet: Fleet,
  fromId: string,
  toId: string,
): { distanceAu: number; roundTripDays: number; cargoPerTrip: number; perYear: number } | null {
  const a = system.byId.get(fromId);
  const b = system.byId.get(toId);
  const stats = fleetStats(empire, fleet);
  if (!a || !b || !fleet.shipIds.length) return null;
  // Use the design speed even if the tanks happen to be empty today.
  let speed = Infinity;
  for (const shipId of fleet.shipIds) {
    const ship = empire.ships.get(shipId);
    const design = ship && empire.statsOf(ship.designId);
    if (design) speed = Math.min(speed, design.speed);
  }
  if (!Number.isFinite(speed) || speed <= 0) return null;
  const distance = distanceAu(a.world, b.world);
  const AU_KM = 149_597_870.7;
  const oneWayDays = (distance * AU_KM) / speed / 86_400;
  const roundTripDays = oneWayDays * 2 + 0.5;
  return {
    distanceAu: distance,
    roundTripDays,
    cargoPerTrip: stats.cargoCapacity,
    perYear: (stats.cargoCapacity * 365.25) / roundTripDays,
  };
}
