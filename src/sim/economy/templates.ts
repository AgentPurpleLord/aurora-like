/**
 * Build templates: a named package of installations applied to a colony in
 * one action.
 *
 * Expansion is the most repetitive thing a player does - the same six orders
 * on every new rock - so a template carries the whole development plan.
 * Infrastructure is the one item that cannot be a fixed number, because how
 * much a world needs depends on its colony cost; template items can ask for
 * "enough infrastructure for N million people" and have it sized on apply.
 */

import type { Body } from "../system";
import type { Colony } from "../../state/colony";
import type { EmpireStats } from "../research/techs";
import { INSTALLATION_BY_ID } from "./installations";
import { effectiveColonyCost } from "./production";

export interface TemplateItem {
  installationId: string;
  /** A fixed number of units. */
  quantity?: number;
  /**
   * Infrastructure only: size the order to support this many million
   * colonists on the target world, at its current colony cost.
   */
  forPopulation?: number;
}

export interface BuildTemplate {
  id: string;
  name: string;
  description: string;
  items: TemplateItem[];
  /** Built-in templates cannot be deleted. */
  builtIn?: boolean;
}

export const BUILT_IN_TEMPLATES: BuildTemplate[] = [
  {
    id: "mining-outpost",
    name: "Mining Outpost",
    description: "A self-shipping mining base: enough infrastructure for a small crew, automated mines, and a mass driver to throw the output home.",
    builtIn: true,
    items: [
      { installationId: "infrastructure", forPopulation: 1 },
      { installationId: "automated-mine", quantity: 30 },
      { installationId: "mass-driver", quantity: 2 },
    ],
  },
  {
    id: "forward-base",
    name: "Forward Base",
    description: "A minimal foothold - somewhere to put a few colonists and start surveying the ground beneath them.",
    builtIn: true,
    items: [
      { installationId: "infrastructure", forPopulation: 0.5 },
      { installationId: "automated-mine", quantity: 8 },
      { installationId: "dstn", quantity: 1 },
    ],
  },
  {
    id: "industrial-base",
    name: "Industrial Base",
    description: "Turns a populated world into one that can build for itself, rather than waiting on shipments from the capital.",
    builtIn: true,
    items: [
      { installationId: "infrastructure", forPopulation: 5 },
      { installationId: "construction-factory", quantity: 50 },
      { installationId: "mine", quantity: 25 },
    ],
  },
  {
    id: "research-campus",
    name: "Research Campus",
    description: "Laboratories and the population to staff them. Labs are the one thing that cannot be bought with minerals alone.",
    builtIn: true,
    items: [
      { installationId: "infrastructure", forPopulation: 3 },
      { installationId: "research-lab", quantity: 10 },
    ],
  },
  {
    id: "fuel-depot",
    name: "Fuel Depot",
    description: "Sorium extraction and refining, for a world that sits on volatiles.",
    builtIn: true,
    items: [
      { installationId: "infrastructure", forPopulation: 2 },
      { installationId: "automated-mine", quantity: 15 },
      { installationId: "fuel-refinery", quantity: 20 },
    ],
  },
];

export interface ResolvedItem {
  installationId: string;
  quantity: number;
}

/**
 * Turn a template into concrete orders for one target. Items whose
 * installation is not yet researched are dropped, and infrastructure is sized
 * against the target's colony cost.
 */
export function resolveTemplate(
  template: BuildTemplate,
  body: Body,
  colony: Colony | undefined,
  stats: EmpireStats,
): ResolvedItem[] {
  const resolved: ResolvedItem[] = [];

  for (const item of template.items) {
    if (!stats.unlocked.has(item.installationId)) continue;
    if (!INSTALLATION_BY_ID.has(item.installationId)) continue;

    let quantity = item.quantity ?? 0;
    if (item.forPopulation !== undefined) {
      quantity = infrastructureFor(item.forPopulation, body, colony, stats);
    }
    if (quantity > 0) resolved.push({ installationId: item.installationId, quantity });
  }
  return resolved;
}

/** Units of infrastructure needed to support `millions` on this world. */
export function infrastructureFor(
  millions: number,
  body: Body,
  colony: Colony | undefined,
  stats: EmpireStats,
): number {
  const cost = effectiveColonyCost(body, colony, stats);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  const already = colony?.installations["infrastructure"] ?? 0;
  const needed = Math.ceil((millions * 100 * cost) / stats.infrastructureEfficiency);
  return Math.max(0, needed - already);
}

/** Templates the player cannot usefully apply have nothing left after resolve. */
export function templateIsApplicable(
  template: BuildTemplate,
  body: Body,
  colony: Colony | undefined,
  stats: EmpireStats,
): boolean {
  return resolveTemplate(template, body, colony, stats).length > 0;
}

/** A template built from whatever a colony currently has queued. */
export function templateFromQueue(name: string, colony: Colony, id: string): BuildTemplate {
  const items = new Map<string, number>();
  for (const order of colony.buildQueue) {
    items.set(order.installationId, (items.get(order.installationId) ?? 0) + order.quantity);
  }
  return {
    id,
    name,
    description: "Saved from a build queue.",
    items: [...items].map(([installationId, quantity]) => ({ installationId, quantity })),
  };
}
