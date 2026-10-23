/**
 * Shipyards, as in Aurora: a colony has named yards, each commercial or
 * military, each with a number of slipways.
 *
 * A slipway is a Shipyard installation. A yard's largest hull is 5,000 tons
 * per slipway, so splitting a colony's slipways between yards makes each one
 * smaller. Commercial yards lay down only commercial classes; military yards
 * build anything, but cost more to set up and need the military specification.
 */

import type { Empire } from "../../state/empire";
import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import { MILITARY_TECH } from "../ships/components";
import { hullOf } from "../ships/hulls";
import { SHIPYARD_TONS } from "./installations";
import type { MineralName } from "../minerals";

export type YardKind = "commercial" | "military";

export interface Shipyard {
  id: string;
  name: string;
  kind: YardKind;
  /** Slipways built and working. */
  slipways: number;
}

export const YARD_KIND_NAMES: Record<YardKind, string> = { commercial: "Commercial", military: "Military" };
export const YARD_KIND_BLURB: Record<YardKind, string> = {
  commercial: "Builds commercial classes only: freighters, tankers, colony and survey ships.",
  military: "Builds any class, warships included. Costs more to set up and needs the Military Specification.",
};
/** Wealth to set up, or convert to, a military yard, per slipway. */
export const MILITARY_YARD_COST = 1_500;
export const MAX_NEW_SLIPWAYS = 20;

export function yardLimit(yard: Shipyard): number {
  return yard.slipways * SHIPYARD_TONS;
}

/** Whether a class needs a military yard: it carries military parts or is a warship hull. */
export function isMilitaryDesign(empire: Empire, designId: string | null | undefined): boolean {
  const design = empire.design(designId);
  if (!design) return false;
  return Boolean(empire.statsOf(design.id)?.military) || hullOf(design)?.category === "military";
}

export function canBuildMilitary(empire: Empire): boolean {
  return empire.researched.has(MILITARY_TECH);
}

/**
 * Keep a colony's yards in step with the Shipyard installations it has: extras
 * join the first yard (or found one), a shortfall - say after a disaster -
 * comes off the last.
 */
export function syncYards(colony: Colony, military: boolean): void {
  colony.yards ??= [];
  const built = installationCount(colony, "shipyard");
  let have = colony.yards.reduce((s, y) => s + y.slipways, 0);
  if (built > have) {
    if (!colony.yards.length) {
      colony.yards.push({ id: nextYardId(colony), name: "Main Shipyard", kind: military ? "military" : "commercial", slipways: 0 });
    }
    colony.yards[0].slipways += built - have;
  } else if (built < have) {
    for (let i = colony.yards.length - 1; i >= 0 && have > built; i--) {
      const cut = Math.min(colony.yards[i].slipways, have - built);
      colony.yards[i].slipways -= cut;
      have -= cut;
    }
  }
}

export function nextYardId(colony: Colony): string {
  let n = colony.yards.length + 1;
  while (colony.yards.some((y) => y.id === `${colony.bodyId}:yard:${n}`)) n++;
  return `${colony.bodyId}:yard:${n}`;
}

/** Yards that may lay down a class of the given kind. */
function eligible(colony: Colony, military: boolean): Shipyard[] {
  return colony.yards.filter((y) => y.slipways > 0 && (!military || y.kind === "military"));
}

/** The largest hull any suitable yard here can lay down. */
export function hullCapacity(colony: Colony, military = false): number {
  // Colonies set up without yards (older saves, tests) fall back to the plain installation count.
  if (!colony.yards?.length) return installationCount(colony, "shipyard") * SHIPYARD_TONS;
  return eligible(colony, military).reduce((m, y) => Math.max(m, yardLimit(y)), 0);
}

/** The smallest suitable yard that can take a hull of this size, if any. */
export function yardFor(colony: Colony, tons: number, military: boolean): Shipyard | null {
  if (!colony.yards?.length) return null;
  return eligible(colony, military)
    .filter((y) => yardLimit(y) >= tons)
    .sort((a, b) => yardLimit(a) - yardLimit(b))[0] ?? null;
}

/** Slipways queued but not yet built for a yard. */
export function pendingSlipways(colony: Colony, yardId: string): number {
  return colony.buildQueue
    .filter((o) => o.installationId === "shipyard" && o.yardId === yardId)
    .reduce((s, o) => s + o.quantity, 0);
}

// ---------------------------------------------------------------- actions

/** Found a new yard and lay down its first slipways. Returns why not, or null. */
export function createYard(
  empire: Empire, bodyId: string, name: string, kind: YardKind, slipways: number,
): string | null {
  const colony = empire.colony(bodyId);
  if (!colony) return "No such colony.";
  const label = name.trim();
  if (!label) return "Give the yard a name.";
  if (colony.yards.some((y) => y.name.toLowerCase() === label.toLowerCase())) return "A yard here already has that name.";
  if (!Number.isInteger(slipways) || slipways < 1 || slipways > MAX_NEW_SLIPWAYS) return `Choose between 1 and ${MAX_NEW_SLIPWAYS} slipways.`;
  if (kind === "military") {
    if (!canBuildMilitary(empire)) return "Military yards need the Military Specification.";
    const cost = MILITARY_YARD_COST * slipways;
    if (empire.treasury < cost) return `A military yard of ${slipways} slipways costs ${cost.toLocaleString()} wealth.`;
    empire.treasury -= cost;
  }
  const yard: Shipyard = { id: nextYardId(colony), name: label, kind, slipways: 0 };
  colony.yards.push(yard);
  empire.queueBuild(bodyId, "shipyard", slipways, null, false, null, yard.id);
  return null;
}

/** Lay down more slipways at an existing yard. */
export function addSlipways(empire: Empire, bodyId: string, yardId: string, count: number): string | null {
  const colony = empire.colony(bodyId);
  const yard = colony?.yards.find((y) => y.id === yardId);
  if (!colony || !yard) return "No such yard.";
  if (!Number.isInteger(count) || count < 1 || count > MAX_NEW_SLIPWAYS) return `Choose between 1 and ${MAX_NEW_SLIPWAYS} slipways.`;
  if (yard.kind === "military") {
    const cost = MILITARY_YARD_COST * count;
    if (empire.treasury < cost) return `Military slipways cost ${MILITARY_YARD_COST.toLocaleString()} wealth each.`;
    empire.treasury -= cost;
  }
  empire.queueBuild(bodyId, "shipyard", count, null, false, null, yardId);
  return null;
}

export function convertYard(empire: Empire, bodyId: string, yardId: string, kind: YardKind): string | null {
  const colony = empire.colony(bodyId);
  const yard = colony?.yards.find((y) => y.id === yardId);
  if (!colony || !yard) return "No such yard.";
  if (yard.kind === kind) return null;
  if (kind === "military") {
    if (!canBuildMilitary(empire)) return "Military yards need the Military Specification.";
    const cost = MILITARY_YARD_COST * Math.max(1, yard.slipways);
    if (empire.treasury < cost) return `Converting costs ${cost.toLocaleString()} wealth.`;
    empire.treasury -= cost;
  }
  yard.kind = kind;
  return null;
}

export function renameYard(empire: Empire, bodyId: string, yardId: string, name: string): string | null {
  const colony = empire.colony(bodyId);
  const yard = colony?.yards.find((y) => y.id === yardId);
  if (!colony || !yard) return "No such yard.";
  const label = name.trim();
  if (!label) return "Give the yard a name.";
  if (colony.yards.some((y) => y !== yard && y.name.toLowerCase() === label.toLowerCase())) return "A yard here already has that name.";
  yard.name = label;
  return null;
}

/** Abandon a yard with no slipways, cancelling any it was waiting on. */
export function abandonYard(empire: Empire, bodyId: string, yardId: string): string | null {
  const colony = empire.colony(bodyId);
  const yard = colony?.yards.find((y) => y.id === yardId);
  if (!colony || !yard) return "No such yard.";
  if (yard.slipways > 0) return "A yard with slipways cannot be abandoned.";
  colony.buildQueue = colony.buildQueue.filter((o) => o.yardId !== yardId);
  colony.yards = colony.yards.filter((y) => y.id !== yardId);
  return null;
}

// ----------------------------------------------------------- build orders

/** Share of the minerals spent on a unit in progress that a cancelled order gives back. */
export const SALVAGE_SHARE = 0.5;

/** Minerals a cancelled order would hand back: half of what the unit in progress has used. */
export function orderRefund(empire: Empire, order: { installationId: string; designId: string | null; progress: number }): Partial<Record<MineralName, number>> {
  const buildable = empire.buildableOf(order);
  if (!buildable || buildable.cost <= 0 || order.progress <= 0) return {};
  const out: Partial<Record<MineralName, number>> = {};
  const done = Math.min(1, order.progress / buildable.cost);
  for (const [mineral, tons] of Object.entries(buildable.minerals) as [MineralName, number][]) {
    const back = tons * done * SALVAGE_SHARE;
    if (back > 0) out[mineral] = back;
  }
  return out;
}

/**
 * Why a class cannot be laid down at a colony (or at one yard of it), or null
 * when it can. The same test the build loop applies, run before queueing so
 * the player hears about it immediately.
 */
export function shipBuildProblem(empire: Empire, bodyId: string, designId: string, yardId: string | null = null): string | null {
  const colony = empire.colony(bodyId);
  const design = empire.design(designId);
  const stats = empire.statsOf(designId);
  if (!colony || !design || !stats) return "That class is not available.";
  if (stats.problems.length) return `${design.name} has design problems: ${stats.problems[0]}`;
  if (!colony.yards.length && installationCount(colony, "shipyard") <= 0) return "This colony has no shipyard.";
  if (!colony.yards.length) return null;
  const military = isMilitaryDesign(empire, designId);
  if (yardId) {
    const yard = colony.yards.find((y) => y.id === yardId);
    if (!yard) return "No such yard.";
    if (yard.slipways <= 0) return `${yard.name} has no finished slipways.`;
    if (military && yard.kind !== "military") return `${yard.name} is a commercial yard; ${design.name} is a military class.`;
    if (stats.tons > yardLimit(yard)) return `${yard.name} lays down hulls up to ${Math.round(yardLimit(yard)).toLocaleString()} t; ${design.name} is ${Math.round(stats.tons).toLocaleString()} t.`;
    return null;
  }
  if (military && !colony.yards.some((y) => y.kind === "military" && y.slipways > 0)) {
    return `${design.name} is a military class and needs a military shipyard. Found one on the Shipyards tab.`;
  }
  if (!yardFor(colony, stats.tons, military)) {
    return `No yard here can lay down ${Math.round(stats.tons).toLocaleString()} t${military ? " as a military hull" : ""}; the largest takes ${Math.round(hullCapacity(colony, military)).toLocaleString()} t. Add slipways on the Shipyards tab.`;
  }
  return null;
}
