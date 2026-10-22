/**
 * Governor policies.
 *
 * A governor with a policy does not act: they file proposals, which arrive in
 * the attention rail for the player to accept or dismiss. Automation that
 * queues work behind your back is the thing players distrust; automation that
 * drafts the order and waits is the thing they use.
 *
 * Proposals are derived from state, like issues, so an accepted or
 * overtaken proposal simply stops being made.
 */

import type { Empire } from "../state/empire";
import type { StarSystem } from "./system";
import { installationCount } from "../state/colony";
import { effectiveColonyCost, populationCapacity } from "./economy/production";
import { supplyToward } from "./economy/standingOrders";
import { INSTALLATION_BY_ID } from "./economy/installations";

export type GovernorPolicy = "none" | "grow" | "mine" | "develop";

export const POLICY_NAMES: Record<GovernorPolicy, string> = {
  none: "No proposals",
  grow: "Grow the population",
  mine: "Develop mining",
  develop: "Build up industry",
};

export const POLICY_BLURBS: Record<GovernorPolicy, string> = {
  none: "The governor administers the colony but proposes nothing.",
  grow: "Proposes infrastructure when the colony approaches the population it can support.",
  mine: "Proposes automated mines for unworked deposits, and a mass driver to ship the output home.",
  develop: "Proposes construction factories, then laboratories, once there is population to staff them.",
};

export interface Proposal {
  id: string;
  colonyId: string;
  title: string;
  detail: string;
  order: {
    sourceId: string;
    installationId: string;
    quantity: number;
    destination: string | null;
  };
}

/** The colony best placed to build for someone else. */
function bestSource(empire: Empire): string | null {
  let best: string | null = null;
  let bestFactories = 0;
  for (const colony of empire.colonies.values()) {
    const factories = installationCount(colony, "construction-factory");
    if (factories > bestFactories) {
      bestFactories = factories;
      best = colony.bodyId;
    }
  }
  return best;
}

export function deriveProposals(empire: Empire, system: StarSystem): Proposal[] {
  const proposals: Proposal[] = [];
  const source = bestSource(empire);
  if (!source) return proposals;

  for (const colony of empire.colonies.values()) {
    const policy = colony.policy;
    if (policy === "none") continue;
    const governor = empire.governorOf(colony.bodyId);
    if (!governor) continue;

    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    const name = body.name;

    const propose = (
      installationId: string,
      quantity: number,
      title: string,
      detail: string,
    ) => {
      if (quantity <= 0) return;
      if (!empire.stats.unlocked.has(installationId)) return;
      // Nothing to propose if it is already on its way.
      proposals.push({
        id: `proposal:${colony.bodyId}:${installationId}`,
        colonyId: colony.bodyId,
        title,
        detail,
        order: {
          sourceId: source,
          installationId,
          quantity,
          destination: source === colony.bodyId ? null : colony.bodyId,
        },
      });
    };

    if (policy === "grow") {
      const capacity = populationCapacity(body, colony, empire.stats);
      const cost = effectiveColonyCost(body, colony, empire.stats);
      const queued = supplyToward(empire, colony.bodyId, "infrastructure");
      const built = installationCount(colony, "infrastructure");
      // Only once the colony is actually pressing against its ceiling, and
      // only if nothing is already on the way.
      if (
        Number.isFinite(cost) && cost > 0 &&
        capacity > 0 && colony.population > capacity * 0.85 &&
        queued <= built
      ) {
        const wanted = Math.ceil((colony.population * 0.5 * 100 * cost) / empire.stats.infrastructureEfficiency);
        propose(
          "infrastructure",
          wanted,
          `${name}: expand infrastructure`,
          `${governor.name} reports the colony is at ${Math.round(
            (colony.population / capacity) * 100,
          )}% of what it can support. ${wanted} infrastructure would make room for half again as many colonists.`,
        );
      }
    }

    if (policy === "mine" && empire.surveyed.has(colony.bodyId)) {
      const reserves = body.minerals.reduce((sum, d) => sum + d.amount, 0);
      const mines = supplyToward(empire, colony.bodyId, "automated-mine");
      if (reserves > 10_000 && mines < 40) {
        propose(
          "automated-mine",
          Math.min(20, 40 - mines),
          `${name}: work the deposits`,
          `${Math.round(reserves).toLocaleString()} tons remain in the ground and only ${mines} automated mines are working them.`,
        );
      }
      const drivers = supplyToward(empire, colony.bodyId, "mass-driver");
      if (mines >= 10 && drivers < 1 && colony.bodyId !== empire.capital) {
        propose(
          "mass-driver",
          2,
          `${name}: ship the output`,
          "The colony is mining but has no mass driver, so everything it extracts stays where it is.",
        );
      }
    }

    if (policy === "develop") {
      const factories = supplyToward(empire, colony.bodyId, "construction-factory");
      const labs = supplyToward(empire, colony.bodyId, "research-lab");
      if (colony.population >= 2 && factories < 50) {
        propose(
          "construction-factory",
          Math.min(25, 50 - factories),
          `${name}: build up industry`,
          `${colony.population.toFixed(1)}m people and only ${factories} construction factories. The colony could be building for itself.`,
        );
      } else if (factories >= 50 && colony.population >= 5 && labs < 10) {
        propose(
          "research-lab",
          Math.min(5, 10 - labs),
          `${name}: add laboratories`,
          `Industry is established and there is population to staff research.`,
        );
      }
    }
  }

  return proposals.filter((p) => INSTALLATION_BY_ID.has(p.order.installationId));
}

/** Human-readable summary of what accepting a proposal would do. */
export function proposalLabel(proposal: Proposal, sourceName: string): string {
  const type = INSTALLATION_BY_ID.get(proposal.order.installationId);
  return `Queue ${proposal.order.quantity} ${type?.name ?? proposal.order.installationId} at ${sourceName}`;
}
