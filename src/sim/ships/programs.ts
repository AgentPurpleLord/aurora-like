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
import type { Body } from "../system";
import type { Galaxy } from "../galaxy";
import { MINERALS, type MineralName } from "../minerals";
import { vecLength, vecSub, type Vec3 } from "../orbit";
import { canCross, findRoute, nearestHome, routeLengthAu } from "./routing";
import { OVERDUE, fleetCondition, servicingCapacity } from "./maintenance";
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
  if (program.kind === "explore") return "Explore: find jump points and map the network";
  if (program.kind === "survey") {
    const where = program.systemId && program.systemId !== "sol" ? nameOf(program.systemId) : "the system";
    return program.maxAu > 0
      ? `Survey every body within ${program.maxAu} AU of the star in ${where}`
      : program.systemId && program.systemId !== "sol"
        ? `Survey every body in ${where}`
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
export function surveyScope(galaxy: Galaxy, systemId: string, maxAu: number): Body[] {
  const system = galaxy.systemById.get(systemId);
  if (!system) return [];
  return system.bodies.filter(
    (b) => b.cls !== "star" && b.cls !== "jump-point" && (maxAu <= 0 || vecLength(b.world) <= maxAu),
  );
}

// ------------------------------------------------------------------ planning

/** Write the fleet's next orders from its programme, or explain why it cannot. */
export function planProgram(empire: Empire, system: Galaxy, fleet: Fleet): void {
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
  else if (program.kind === "explore") planExplore(empire, system, fleet, stats);
  else planFreight(empire, system, fleet, program, stats);
}

function wait(empire: Empire, fleet: Fleet, status: string, problem?: string): void {
  fleet.waitUntil = empire.lastTick + RECHECK_SECONDS;
  fleet.programStatus = status;
  fleet.note = problem ?? null;
}

/**
 * A fleet that is worn out goes to be serviced, and a fleet that is being
 * serviced stays until it is nearly right. Returns true if it handled the
 * fleet this time (and the caller should plan nothing else).
 */
function seeToCondition(empire: Empire, system: Galaxy, fleet: Fleet, stats: FleetStats): boolean {
  const condition = fleetCondition(empire, fleet);
  const here = fleet.anchorId ? empire.colonies.get(fleet.anchorId) : undefined;
  const servicedHere = here !== undefined && servicingCapacity(empire, here) > 0;
  if (servicedHere && condition < 90) {
    wait(empire, fleet, `Being serviced (${Math.round(condition)}%)`);
    return true;
  }
  if (condition >= OVERDUE) return false;

  const stop = nearestHome(
    empire, system, fleet.position, fleet.systemId, stats.tons, stats.jumpCapacity,
    (id) => {
      const colony = empire.colonies.get(id);
      return colony !== undefined && servicingCapacity(empire, colony) > 0;
    },
  );
  if (!stop || stats.speed <= 0 || stats.rangeAu < stop.distanceAu) {
    wait(empire, fleet, "Worn out and nowhere in reach to service it", "Worn out and nowhere in reach to service it");
    return true;
  }
  fleet.orders.push({ kind: "move", bodyId: stop.body.id });
  fleet.programStatus = `Worn out (${Math.round(condition)}%): going to ${stop.body.name} for service`;
  return true;
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
  system: Galaxy,
  fleet: Fleet,
  program: Extract<FleetProgram, { kind: "survey" }>,
  stats: FleetStats,
): void {
  if (!stats.canSurvey) {
    wait(empire, fleet, "No survey sensors aboard", "No survey sensors aboard");
    return;
  }

  if (seeToCondition(empire, system, fleet, stats)) return;

  const targetSystem = program.systemId ?? "sol";
  const targetStar = system.systemById.get(targetSystem)?.root;
  const scope = surveyScope(system, targetSystem, program.maxAu);
  const pending = scope.filter((b) => !empire.surveyed.has(b.id));
  if (!pending.length) {
    finishSurvey(empire, system, fleet, scope.length);
    return;
  }

  // Assigned to a system the fleet is not in: go there first.
  if (fleet.systemId !== targetSystem && targetStar) {
    fleet.orders.push({ kind: "move", bodyId: targetStar.id });
    fleet.programStatus = `Heading to ${system.systemById.get(targetSystem)?.name}`;
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
    const home = nearestHome(empire, system, target.world, fleet.systemId, stats.tons, stats.jumpCapacity)?.distanceAu ?? 0;
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
  goHomeToRefuel(empire, system, fleet, stats);
}

/** Send a fleet to the nearest colony it can reach, to refuel. */
function goHomeToRefuel(empire: Empire, system: Galaxy, fleet: Fleet, stats: FleetStats): boolean {
  const home = nearestHome(empire, system, fleet.position, fleet.systemId, stats.tons, stats.jumpCapacity);
  if (!home || stats.speed <= 0 || stats.rangeAu < home.distanceAu) {
    wait(empire, fleet, "Stranded", stats.fuel <= 0 ? "Out of fuel" : "Cannot reach a colony to refuel");
    return false;
  }
  fleet.orders.push({ kind: "move", bodyId: home.body.id }, { kind: "refuel" });
  fleet.programStatus = `Returning to ${home.body.name} to refuel`;
  return true;
}

function finishSurvey(empire: Empire, system: Galaxy, fleet: Fleet, count: number): void {
  const program = fleet.program;
  fleet.program = null;
  fleet.programStatus = null;
  const where = program?.kind === "survey" && program.maxAu > 0 ? `within ${program.maxAu} AU` : "in the system";
  const systemId = program?.kind === "survey" ? (program.systemId ?? "sol") : fleet.systemId;
  const found = (system.systemById.get(systemId)?.bodies ?? [])
    .filter((b) => empire.surveyed.has(b.id))
    .reduce((sum, b) => sum + b.minerals.length, 0);
  empire.addLog(
    empire.lastTick,
    "fleet",
    `${fleet.name} has finished its survey programme: all ${count} bodies ${where} are surveyed (${found} deposits known in total).`,
    { view: "map", bodyId: system.systemById.get(systemId)?.root.id },
  );
  // Send the ship home rather than leaving it adrift between the planets.
  const stats = fleetStats(empire, fleet);
  const home = nearestHome(empire, system, fleet.position, fleet.systemId, stats.tons, stats.jumpCapacity);
  if (home && fleet.anchorId !== home.body.id) {
    fleet.orders.push({ kind: "move", bodyId: home.body.id });
  }
}

// ------------------------------------------------------------------ explore

/** Systems the empire knows with something still to find or cross. */
function unfinishedSystems(empire: Empire, system: Galaxy): string[] {
  const out: string[] = [];
  for (const id of empire.knownSystems) {
    const jps = system.jumpPointsIn(id);
    if (jps.some((jp) => !empire.knownJumpPoints.has(jp.id) || !empire.exploredJumpPoints.has(jp.id))) {
      out.push(id);
    }
  }
  return out;
}

function planExplore(empire: Empire, system: Galaxy, fleet: Fleet, stats: FleetStats): void {
  if (stats.gravRate <= 0) {
    wait(empire, fleet, "No gravitational sensors aboard", "No gravitational sensors aboard");
    return;
  }
  if (stats.jumpCapacity < stats.tons) {
    wait(
      empire, fleet,
      "Needs jump drives for the whole fleet",
      `Jump drives carry ${Math.round(stats.jumpCapacity).toLocaleString()} t; the fleet is ${Math.round(stats.tons).toLocaleString()} t`,
    );
    return;
  }

  if (seeToCondition(empire, system, fleet, stats)) return;

  const here = fleet.anchorId ? empire.colonies.get(fleet.anchorId) : undefined;
  const sysName = (id: string) => system.systemById.get(id)?.name ?? id;

  // Fuel first. Below the threshold, or unable to afford the way home, go back.
  const home = nearestHome(empire, system, fleet.position, fleet.systemId, stats.tons, stats.jumpCapacity);
  const low = fuelShare(stats) < 0.5;
  if (here) {
    if (fuelShare(stats) < FULL_TANK && here.fuel > 0) {
      fleet.orders.push({ kind: "refuel" });
      fleet.programStatus = "Refuelling";
      return;
    }
    if (fuelShare(stats) < FULL_TANK && here.fuel <= 0) {
      wait(empire, fleet, "No fuel at this colony", "No fuel at this colony");
      return;
    }
  } else if (low && home) {
    if (stats.speed > 0 && stats.rangeAu >= home.distanceAu) {
      fleet.orders.push({ kind: "move", bodyId: home.body.id }, { kind: "refuel" });
      fleet.programStatus = `Fuel is low: returning to ${home.body.name}`;
      return;
    }
  }

  const jps = system.jumpPointsIn(fleet.systemId);

  // 1. Look for jump points here.
  if (jps.some((jp) => !empire.knownJumpPoints.has(jp.id)) && fleet.anchorId) {
    fleet.orders.push({ kind: "gravsurvey" });
    fleet.programStatus = `Searching ${sysName(fleet.systemId)} for jump points`;
    return;
  }

  // 2. Cross one nobody has been through, if the fuel allows the trip.
  const unexplored = jps
    .filter((jp) => empire.knownJumpPoints.has(jp.id) && !empire.exploredJumpPoints.has(jp.id))
    .sort((a, b) => distanceAu(a.world, fleet.position) - distanceAu(b.world, fleet.position));
  for (const jp of unexplored) {
    const out = distanceAu(fleet.position, jp.world);
    const back = nearestHome(empire, system, jp.world, fleet.systemId, stats.tons, stats.jumpCapacity)?.distanceAu ?? 0;
    if (stats.speed > 0 && stats.rangeAu >= (out + back) * RANGE_MARGIN) {
      fleet.orders.push({ kind: "move", bodyId: jp.id }, { kind: "jump" });
      fleet.programStatus = `Crossing ${jp.name}`;
      return;
    }
  }
  if (unexplored.length) {
    // Something is waiting but the fuel will not stretch to it.
    if (home && !here && stats.speed > 0 && stats.rangeAu >= home.distanceAu) {
      fleet.orders.push({ kind: "move", bodyId: home.body.id }, { kind: "refuel" });
      fleet.programStatus = `Out of range of the next jump point: returning to ${home.body.name}`;
      return;
    }
    const stuck = !home || stats.rangeAu < home.distanceAu;
    const why = stuck
      ? "Far from home: neither the next jump point nor the way back is within the fuel left. It needs a colony or tanker nearby"
      : "The next jump point is beyond this fleet's range";
    wait(empire, fleet, why, why);
    return;
  }

  // 3. Nothing left here: go where there is something.
  const elsewhere = unfinishedSystems(empire, system)
    .filter((id) => id !== fleet.systemId)
    .map((id) => {
      const star = system.systemById.get(id)!.root;
      const route = findRoute(empire, system, fleet.systemId, id, (jp) => canCross(empire, jp, stats.tons, stats.jumpCapacity));
      return route ? { id, star, length: routeLengthAu(system, fleet.position, star, route) } : null;
    })
    .filter((x): x is { id: string; star: Body; length: number } => x !== null)
    .sort((a, b) => a.length - b.length);
  const next = elsewhere[0];
  if (next && stats.rangeAu >= next.length * 0.9) {
    fleet.orders.push({ kind: "move", bodyId: next.star.id });
    fleet.programStatus = `Heading to ${sysName(next.id)} to continue`;
    return;
  }
  if (next) {
    if (home && !here && stats.rangeAu >= home.distanceAu) {
      fleet.orders.push({ kind: "move", bodyId: home.body.id }, { kind: "refuel" });
      fleet.programStatus = `Refuelling before ${sysName(next.id)}`;
      return;
    }
    wait(empire, fleet, "Too far from the unexplored systems for the fuel left", "Too far from the unexplored systems for the fuel left");
    return;
  }

  // 4. Done.
  fleet.program = null;
  fleet.programStatus = null;
  empire.addLog(
    empire.lastTick,
    "fleet",
    `${fleet.name} has finished exploring: every jump point in the ${empire.knownSystems.size} known systems is found and charted.`,
    { view: "fleets", fleetId: fleet.id },
  );
  if (home && fleet.anchorId !== home.body.id) fleet.orders.push({ kind: "move", bodyId: home.body.id });
}

// ------------------------------------------------------------------- freight

function planFreight(
  empire: Empire,
  system: Galaxy,
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
  let leg = distanceAu(hereBody.world, otherBody.world);
  if (hereBody.systemId !== otherBody.systemId) {
    const route = findRoute(empire, system, hereBody.systemId, otherBody.systemId,
      (id) => canCross(empire, id, stats.tons, stats.jumpCapacity));
    if (!route) {
      fleet.orders.push(...orders);
      wait(empire, fleet, "No known route to the other end of the line", "No known route to the other end of the line");
      return;
    }
    leg = routeLengthAu(system, hereBody.world, otherBody, route);
  }
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
  system: Galaxy,
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
  let distance = distanceAu(a.world, b.world);
  if (a.systemId !== b.systemId) {
    const route = findRoute(empire, system, a.systemId, b.systemId,
      (id) => canCross(empire, id, stats.tons, stats.jumpCapacity));
    if (!route) return null;
    distance = routeLengthAu(system, a.world, b, route);
  }
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
