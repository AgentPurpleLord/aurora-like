/**
 * Finding a way between systems.
 *
 * A route is the list of jump points a fleet must cross, in order. Only
 * connections the empire has actually been through are known, and a fleet can
 * only use one if the connection has a gate or the fleet carries jump drives
 * rated for its whole tonnage - so a route depends on who is asking.
 */

import type { Empire } from "../../state/empire";
import type { Body } from "../system";
import type { Galaxy } from "../galaxy";
import { vecLength, vecSub, type Vec3 } from "../orbit";
import type { Fleet } from "./fleet";

/** Can a fleet of this size and drive capacity use this jump point now? */
export function canCross(empire: Empire, jumpPointId: string, tons: number, jumpCapacity: number): boolean {
  return empire.gates.has(jumpPointId) || jumpCapacity >= tons;
}

/**
 * The jump points to cross to get from one system to another, nearest
 * first, or null if no known route exists for this fleet.
 */
export function findRoute(
  empire: Empire,
  galaxy: Galaxy,
  fromSystem: string,
  toSystem: string,
  usable: (jumpPointId: string) => boolean,
): string[] | null {
  if (fromSystem === toSystem) return [];
  const came = new Map<string, { from: string; via: string }>();
  const queue = [fromSystem];
  const seen = new Set([fromSystem]);
  while (queue.length) {
    const here = queue.shift()!;
    if (here === toSystem) break;
    for (const jp of galaxy.jumpPointsIn(here)) {
      if (!empire.exploredJumpPoints.has(jp.id) || !usable(jp.id)) continue;
      const far = galaxy.otherEnd(jp.id);
      if (!far || seen.has(far.systemId)) continue;
      seen.add(far.systemId);
      came.set(far.systemId, { from: here, via: jp.id });
      queue.push(far.systemId);
    }
  }
  if (!came.has(toSystem)) return null;
  const route: string[] = [];
  for (let at = toSystem; at !== fromSystem;) {
    const step = came.get(at)!;
    route.unshift(step.via);
    at = step.from;
  }
  return route;
}

/** Route for a particular fleet, using its tonnage and drives. */
export function routeFor(
  empire: Empire,
  galaxy: Galaxy,
  fleet: Fleet,
  toSystem: string,
  tons: number,
  jumpCapacity: number,
): string[] | null {
  return findRoute(empire, galaxy, fleet.systemId, toSystem, (id) => canCross(empire, id, tons, jumpCapacity));
}

/**
 * Total distance in AU along a route from one body to another, counting only
 * the travel inside each system (jumps themselves are instant).
 */
export function routeLengthAu(
  galaxy: Galaxy,
  from: Vec3,
  to: Body,
  route: string[],
): number {
  let total = 0;
  let at = from;
  for (const jpId of route) {
    const jp = galaxy.byId.get(jpId)!;
    total += vecLength(vecSub(jp.world, at));
    at = galaxy.otherEnd(jpId)!.world;
  }
  total += vecLength(vecSub(to.world, at));
  return total;
}

/**
 * Distance to the nearest colony this fleet can get to, along its own best
 * route, and which colony that is. Null when no colony is reachable.
 */
export function nearestHome(
  empire: Empire,
  galaxy: Galaxy,
  from: Vec3,
  fromSystem: string,
  tons: number,
  jumpCapacity: number,
): { body: Body; distanceAu: number } | null {
  let best: { body: Body; distanceAu: number } | null = null;
  for (const colony of empire.colonies.values()) {
    const body = galaxy.byId.get(colony.bodyId);
    if (!body) continue;
    const route = findRoute(empire, galaxy, fromSystem, body.systemId, (id) => canCross(empire, id, tons, jumpCapacity));
    if (!route) continue;
    const distanceAu = routeLengthAu(galaxy, from, body, route);
    if (!best || distanceAu < best.distanceAu) best = { body, distanceAu };
  }
  return best;
}

/** Are two systems joined by gates alone, so civilian shipping can follow them? */
export function gatedConnected(empire: Empire, galaxy: Galaxy, a: string, b: string): boolean {
  return findRoute(empire, galaxy, a, b, (id) => empire.gates.has(id)) !== null;
}
