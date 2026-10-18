/**
 * Standing orders: rules that keep queueing work so the player does not have
 * to notice that a colony needs more of something.
 *
 * They are evaluated once per production cycle, before anything is built, and
 * they only ever top a colony up to its target - an order that is already
 * satisfied queues nothing, so a rule cannot run away.
 */

import type { Empire } from "../../state/empire";
import type { StarSystem } from "../system";
import { installationCount } from "../../state/colony";
import { effectiveColonyCost } from "./production";

export type StandingRule =
  /** Keep at least `target` of an installation at the colony. */
  | { kind: "maintain"; installationId: string; target: number }
  /** Keep supported population this far ahead of actual population. */
  | { kind: "infrastructure"; headroomPercent: number };

export interface StandingOrder {
  id: string;
  /** Where the installations end up. */
  colonyId: string;
  /** Whose industry builds them. */
  sourceId: string;
  rule: StandingRule;
  enabled: boolean;
}

/**
 * Units of an installation already heading to a colony - built, or queued
 * anywhere in the empire with this colony as the destination.
 */
export function supplyToward(
  empire: Empire,
  colonyId: string,
  installationId: string,
): number {
  const colony = empire.colonies.get(colonyId);
  let total = colony ? installationCount(colony, installationId) : 0;

  for (const source of empire.colonies.values()) {
    for (const order of source.buildQueue) {
      if (order.installationId !== installationId) continue;
      const destination = order.destination ?? source.bodyId;
      if (destination === colonyId) total += order.quantity;
    }
  }
  return total;
}

export function describeRule(rule: StandingRule, installationName: (id: string) => string): string {
  return rule.kind === "maintain"
    ? `Keep ${rule.target} ${installationName(rule.installationId)}`
    : `Keep capacity ${rule.headroomPercent}% above population`;
}

/** How much work a rule wants queued right now. Zero when satisfied. */
export function shortfallFor(
  empire: Empire,
  system: StarSystem,
  order: StandingOrder,
): { installationId: string; quantity: number } | null {
  const colony = empire.colonies.get(order.colonyId);
  const body = system.byId.get(order.colonyId);
  if (!colony || !body) return null;

  if (order.rule.kind === "maintain") {
    const have = supplyToward(empire, order.colonyId, order.rule.installationId);
    const wanted = Math.ceil(order.rule.target - have);
    return wanted > 0 ? { installationId: order.rule.installationId, quantity: wanted } : null;
  }

  const cost = effectiveColonyCost(body, colony, empire.stats);
  // A world with no colony cost needs no infrastructure at all.
  if (!Number.isFinite(cost) || cost <= 0) return null;

  const target = colony.population * (1 + order.rule.headroomPercent / 100);
  const required = Math.ceil((target * 100 * cost) / empire.stats.infrastructureEfficiency);
  const have = supplyToward(empire, order.colonyId, "infrastructure");
  const wanted = required - have;
  // Ignore dribbles, or a growing colony re-queues one unit every cycle.
  return wanted >= 10 ? { installationId: "infrastructure", quantity: wanted } : null;
}

/** Run every enabled standing order. Returns a line per order that queued work. */
export function evaluateStandingOrders(empire: Empire, system: StarSystem): string[] {
  const notes: string[] = [];

  for (const order of empire.standingOrders) {
    if (!order.enabled) continue;
    if (!empire.colonies.has(order.sourceId)) continue;

    const shortfall = shortfallFor(empire, system, order);
    if (!shortfall) continue;

    empire.queueBuild(
      order.sourceId,
      shortfall.installationId,
      shortfall.quantity,
      order.sourceId === order.colonyId ? null : order.colonyId,
      true,
    );
    const target = system.byId.get(order.colonyId)?.name ?? order.colonyId;
    notes.push(`${target}: standing order queued ${shortfall.quantity} ${shortfall.installationId}`);
  }
  return notes;
}
