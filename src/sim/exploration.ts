/** Questions the interface asks about what the empire has found. */

import type { Empire } from "../state/empire";
import type { Body } from "./system";
import type { Galaxy } from "./galaxy";
import { fleetStats } from "./ships/fleet";

/**
 * Why a body cannot be settled right now, or null if it can. A system with a
 * colony in it can open more; the first foothold in a new system needs a
 * colony ship in orbit, because there is nobody there to found it.
 */
export function settleBlocker(empire: Empire, galaxy: Galaxy, body: Body): string | null {
  if (!empire.knownSystems.has(body.systemId)) return "That system has not been explored.";
  for (const colony of empire.colonies.values()) {
    if (galaxy.byId.get(colony.bodyId)?.systemId === body.systemId) return null;
  }
  for (const fleet of empire.fleets.values()) {
    if (fleet.anchorId !== body.id) continue;
    if (fleetStats(empire, fleet).colonistCapacity > 0) return null;
  }
  return "The first settlement in a new system needs a ship with cryogenic berths in orbit.";
}

/** Bodies of a system the empire may look at: all of a known system, nothing of an unknown one. */
export function visibleBodies(empire: Empire, galaxy: Galaxy, systemId: string): Body[] {
  if (!empire.knownSystems.has(systemId)) return [];
  const system = galaxy.systemById.get(systemId);
  if (!system) return [];
  // A jump point is on the map only once a survey has found it.
  return system.bodies.filter((b) => b.cls !== "jump-point" || empire.knownJumpPoints.has(b.id));
}

/** Jump points found in a system, and how many it has. */
export function jumpCounts(empire: Empire, galaxy: Galaxy, systemId: string): { found: number; total: number } {
  const all = galaxy.jumpPointsIn(systemId);
  return { found: all.filter((b) => empire.knownJumpPoints.has(b.id)).length, total: all.length };
}
