/**
 * Trade follows the freight. A colony trades with the colonies its freight
 * lines reach, as strongly as those lines can actually carry: a line of
 * thin-hulled couriers counts for little, a line of fleet haulers for a lot.
 * The civilian shipping stand-in, if on, supplies a modest baseline so a new
 * empire is not penalised for having no ships yet.
 */

import type { Empire } from "../../state/empire";

/** Tons of hold a line needs to count as one full trade link. */
export const LINK_TONS = 2000;
/** Ships worn below this condition are in no state to trade. */
const MIN_CONDITION = 25;
/** Links civilian shipping provides by itself, at most. */
export const CIVILIAN_LINKS = 2;
export const MAX_LINKS = 4;

export interface TradeLine {
  fleetId: string;
  name: string;
  fromId: string;
  toId: string;
  tons: number;
  /** 0 to 1: how much of a full link this line is. */
  strength: number;
}

/** The working freight lines: fleets on a freight programme with something to carry cargo in. */
export function tradeLines(empire: Empire): TradeLine[] {
  const lines: TradeLine[] = [];
  for (const fleet of empire.fleets.values()) {
    const program = fleet.program;
    if (!program || program.kind !== "freight") continue;
    let tons = 0;
    for (const id of fleet.shipIds) {
      const ship = empire.ships.get(id);
      if (!ship || ship.condition < MIN_CONDITION) continue;
      tons += empire.statsOf(ship.designId)?.cargoCapacity ?? 0;
    }
    if (tons <= 0) continue;
    // Both ends must be live colonies, or there is nobody to trade with.
    const from = empire.colony(program.fromId);
    const to = empire.colony(program.toId);
    if (!from || !to || from.population <= 0.1 || to.population <= 0.1) continue;
    lines.push({
      fleetId: fleet.id,
      name: fleet.name,
      fromId: program.fromId,
      toId: program.toId,
      tons,
      strength: Math.min(1, tons / LINK_TONS),
    });
  }
  return lines;
}

const memo = new WeakMap<Empire, Map<string, number>>();

/** Forget the cached figures: the fleets or the colonies have moved on. */
export function invalidateTrade(empire: Empire): void {
  memo.delete(empire);
}

/** Effective trade links per colony, counting each freight line at both ends. */
export function tradeConnections(empire: Empire): Map<string, number> {
  const cached = memo.get(empire);
  if (cached) return cached;

  const links = new Map<string, number>();
  const bump = (id: string, by: number) => links.set(id, (links.get(id) ?? 0) + by);
  for (const line of tradeLines(empire)) {
    bump(line.fromId, line.strength);
    bump(line.toId, line.strength);
  }
  if (empire.civilianShipping) {
    let populated = 0;
    for (const c of empire.colonies.values()) if (c.population > 0.1) populated++;
    const base = Math.min(CIVILIAN_LINKS, Math.max(0, populated - 1));
    for (const c of empire.colonies.values()) if (c.population > 0.1) bump(c.bodyId, base);
  }
  for (const [id, n] of links) links.set(id, Math.min(MAX_LINKS, n));
  memo.set(empire, links);
  return links;
}
