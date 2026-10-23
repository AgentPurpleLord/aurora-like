/**
 * Triage: everything currently wrong with the empire, stated in one line
 * each, with somewhere to go and fix it.
 *
 * Issues are derived from state every time they are asked for - never stored,
 * never accumulated. An issue that has been resolved simply stops being
 * generated, which is what keeps this from turning into a second event log.
 */

import type { Empire } from "../state/empire";
import type { Galaxy } from "./galaxy";
import { FAILING, OVERDUE, fleetCondition } from "./ships/maintenance";
import { installationCount } from "../state/colony";
import { INSTALLATION_BY_ID } from "./economy/installations";
import { colonyOutput, populationCapacity } from "./economy/production";
import { mineralLedger, queuedBuildPoints } from "./economy/ledger";
import { TECH_BY_ID } from "./research/techs";
import { labCapacity } from "./people/officers";
import { FACTION_BY_ID, WIN_APPROVAL, approval } from "./politics";
import { deriveProposals, proposalLabel } from "./governors";
import { ENGINE_TYPES } from "./ships/components";

export type Severity = "critical" | "warning" | "info";

/** Where an issue is resolved. Mirrors the view ids the UI uses. */
export type IssueView = "empire" | "colonies" | "fleets" | "design" | "research" | "officers" | "map" | "politics";

/** A governor's draft order, ready for the player to accept. */
export interface IssueProposal {
  label: string;
  sourceId: string;
  installationId: string;
  quantity: number;
  destination: string | null;
}

export interface Issue {
  /**
   * Stable across cycles for the same underlying problem, so that dismissing
   * one keeps it dismissed while the condition persists.
   */
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  action: { label: string; view: IssueView; bodyId?: string };
  /** Present on governor proposals: accepting queues exactly this. */
  proposal?: IssueProposal;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Years of cover below which a mineral shortage is worth raising. */
const COVER_WARNING_YEARS = 8;
const COVER_CRITICAL_YEARS = 3;
const DEPLETION_WARNING_YEARS = 5;
/** Idle fleets are listed individually only up to this many. */
const IDLE_FLEET_LIMIT = 4;

export function deriveIssues(empire: Empire, system: Galaxy): Issue[] {
  const issues: Issue[] = [];
  const add = (issue: Issue) => issues.push(issue);

  if (empire.treasury < 0) {
    add({
      id: "treasury:deficit",
      severity: "critical",
      title: "Treasury in deficit",
      detail: `Balance ${Math.round(empire.treasury).toLocaleString()}. Industry is halved, interest accrues and stability suffers until it recovers.`,
      action: { label: "Review economy", view: "empire" },
    });
  }

  for (const colony of empire.colonies.values()) {
    if (colony.population <= 0.1 || colony.stability >= 40) continue;
    const name = system.byId.get(colony.bodyId)?.name ?? colony.bodyId;
    add({
      id: `unrest:${colony.bodyId}`,
      severity: colony.stability < 20 ? "critical" : "warning",
      title: `${colony.stability < 20 ? "Riots" : "Unrest"} on ${name}`,
      detail: `Stability ${Math.round(colony.stability)}. Output and growth are reduced. Lower taxes, fund welfare or hold a festival.`,
      action: { label: "Review economy", view: "empire" },
    });
  }

  // ---------------------------------------------------------- politics
  {
    const p = empire.politics;
    for (const f of p.factions) {
      if (f.support >= 35) continue;
      const name = FACTION_BY_ID.get(f.id)!.name;
      add({
        id: `politics:faction:${f.id}`,
        severity: f.support < 15 ? "critical" : "warning",
        title: `${name} is ${f.support < 15 ? "in revolt" : "hostile"}`,
        detail: `Support ${Math.round(f.support)}. ${FACTION_BY_ID.get(f.id)!.domainText} is suffering. Court them, fund them, or meet their demands.`,
        action: { label: "Open Politics", view: "politics" },
      });
    }
    const now = empire.lastTick;
    const toElection = p.nextElection - now;
    if (p.nextElection > 0 && toElection < 365.25 * 86_400 && approval(p) < WIN_APPROVAL + 5) {
      add({
        id: "politics:election",
        severity: approval(p) < WIN_APPROVAL ? "critical" : "warning",
        title: approval(p) < WIN_APPROVAL ? "Heading for election defeat" : "A close election is coming",
        detail: `Approval ${Math.round(approval(p))}% against ${WIN_APPROVAL}% needed, with the vote in ${Math.max(0, toElection / (365.25 * 86_400)).toFixed(1)} years.`,
        action: { label: "Open Politics", view: "politics" },
      });
    }
    if (p.capital >= 90) {
      add({
        id: "politics:capital",
        severity: "info",
        title: "Political capital is going to waste",
        detail: "The reserve is nearly full. Enact a law, court a faction or settle a demand.",
        action: { label: "Open Politics", view: "politics" },
      });
    }
  }

  // ---------------------------------------------------------- minerals
  for (const row of mineralLedger(empire, system)) {
    if (row.net < 0 && row.cover < COVER_WARNING_YEARS) {
      add({
        id: `mineral:cover:${row.mineral}`,
        severity: row.cover < COVER_CRITICAL_YEARS ? "critical" : "warning",
        title: `${row.mineral} runs out in ${row.cover.toFixed(1)} years`,
        detail: `Using ${Math.round(row.demand).toLocaleString()} t/yr against ${Math.round(
          row.production,
        ).toLocaleString()} t/yr mined, with ${Math.round(row.stockpile).toLocaleString()} t in hand.`,
        action: { label: "Open ledger", view: "empire" },
      });
    } else if (row.production > 0 && row.reservesYears < DEPLETION_WARNING_YEARS) {
      add({
        id: `mineral:reserves:${row.mineral}`,
        severity: "warning",
        title: `${row.mineral} deposits exhausted in ${row.reservesYears.toFixed(1)} years`,
        detail: `Only ${Math.round(row.reserves).toLocaleString()} t remain in the ground at colonies that can mine it.`,
        action: { label: "Open ledger", view: "empire" },
      });
    }
  }

  // ---------------------------------------------------------- colonies
  for (const colony of empire.colonies.values()) {
    const body = system.byId.get(colony.bodyId);
    if (!body) continue;
    const output = colonyOutput(empire, body, colony, empire.stats);
    const name = body.name;

    for (const order of colony.buildQueue) {
      if (!order.starved) continue;
      const type = INSTALLATION_BY_ID.get(order.installationId);
      add({
        id: `queue:stalled:${colony.bodyId}:${order.installationId}`,
        severity: "critical",
        title: `${name}: ${type?.name ?? order.installationId} stalled`,
        detail: "The colony has run out of the minerals this order needs.",
        action: { label: "Open colony", view: "colonies", bodyId: colony.bodyId },
      });
    }

    for (const deposit of body.minerals) {
      const rate = output.mining[deposit.mineral] ?? 0;
      if (rate <= 0 || deposit.amount <= 0) continue;
      const years = deposit.amount / rate;
      if (years < DEPLETION_WARNING_YEARS) {
        add({
          id: `deposit:${colony.bodyId}:${deposit.mineral}`,
          severity: "warning",
          title: `${name}: ${deposit.mineral} deposit has ${years.toFixed(1)} years left`,
          detail: `${Math.round(deposit.amount).toLocaleString()} t remaining at ${Math.round(rate).toLocaleString()} t/yr.`,
          action: { label: "Open colony", view: "colonies", bodyId: colony.bodyId },
        });
      }
    }

    if (output.employment < 0.95 && output.workersRequired > 0) {
      add({
        id: `colony:workers:${colony.bodyId}`,
        severity: "warning",
        title: `${name} is understaffed`,
        detail: `${Math.round(output.employment * 100)}% of its installations are manned; everything runs at that rate.`,
        action: { label: "Open colony", view: "colonies", bodyId: colony.bodyId },
      });
    }

    const capacity = populationCapacity(body, colony, empire.stats);
    if (colony.population > capacity + 0.001) {
      add({
        id: `colony:overcapacity:${colony.bodyId}`,
        severity: "warning",
        title: `${name} cannot support its population`,
        detail: `${colony.population.toFixed(2)}m people against capacity for ${capacity.toFixed(
          2,
        )}m. Population is falling; build infrastructure.`,
        action: { label: "Open colony", view: "colonies", bodyId: colony.bodyId },
      });
    }

    if (output.buildPoints > 0 && colony.buildQueue.length === 0) {
      add({
        id: `colony:idle-industry:${colony.bodyId}`,
        severity: "info",
        title: `${name} has idle industry`,
        detail: `${Math.round(output.buildPoints).toLocaleString()} BP/yr of capacity with nothing queued.`,
        action: { label: "Queue work", view: "colonies", bodyId: colony.bodyId },
      });
    }

    if (installationCount(colony, "terraforming") > 0 && !colony.terraforming) {
      add({
        id: `colony:terraformers-idle:${colony.bodyId}`,
        severity: "warning",
        title: `${name}: terraformers have no programme`,
        detail: `${installationCount(colony, "terraforming")} installations are standing idle. Choose a gas to add or remove.`,
        action: { label: "Open colony", view: "colonies", bodyId: colony.bodyId },
      });
    }

    if (!empire.governorOf(colony.bodyId) && colony.population >= 1) {
      add({
        id: `colony:governor:${colony.bodyId}`,
        severity: "info",
        title: `${name} has no governor`,
        detail: "An administrator posted here would apply their bonuses to this colony.",
        action: { label: "Post a governor", view: "officers" },
      });
    }

    // A queue with nothing behind it is about to leave the colony idle.
    const outstanding = queuedBuildPoints(empire, colony);
    if (output.buildPoints > 0 && outstanding > 0 && outstanding / output.buildPoints < 0.5) {
      add({
        id: `colony:queue-short:${colony.bodyId}`,
        severity: "info",
        title: `${name}'s build queue is nearly empty`,
        detail: `Less than six months of work remains for ${Math.round(
          output.buildPoints,
        ).toLocaleString()} BP/yr of industry.`,
        action: { label: "Queue work", view: "colonies", bodyId: colony.bodyId },
      });
    }
  }

  // ------------------------------------------------------------- fleets
  const idle: typeof issues = [];
  for (const fleet of empire.fleets.values()) {
    if (fleet.note) {
      add({
        id: `fleet:blocked:${fleet.id}`,
        severity: fleet.note === "Out of fuel" ? "critical" : "warning",
        title: `${fleet.name}: ${fleet.note.toLowerCase()}`,
        detail:
          fleet.note === "Out of fuel"
            ? "The fleet cannot move until a tanker reaches it or it is refuelled at a colony."
            : "The fleet cannot carry out the order at the head of its queue.",
        action: { label: "Open fleet", view: "fleets" },
      });
    } else if (fleet.shipIds.length && !fleet.orders.length && fleet.anchorId && !fleet.program) {
      idle.push({
        id: `fleet:idle:${fleet.id}`,
        severity: "info",
        title: `${fleet.name} is idle`,
        detail: `${fleet.shipIds.length} ship${fleet.shipIds.length === 1 ? "" : "s"} holding station at ${
          system.byId.get(fleet.anchorId)?.name ?? fleet.anchorId
        }.`,
        action: { label: "Give orders", view: "fleets" },
      });
    }
  }

  // ---------------------------------------------------------- servicing
  for (const fleet of empire.fleets.values()) {
    if (!fleet.shipIds.length || fleet.program) continue;
    const worst = fleetCondition(empire, fleet);
    if (worst < OVERDUE) {
      add({
        id: `fleet:overdue:${fleet.id}`,
        severity: worst < FAILING ? "critical" : "warning",
        title: `${fleet.name} is overdue for servicing (${Math.round(worst)}%)`,
        detail: "Worn ships are slower and may break down. Park the fleet at a colony with a shipyard or maintenance facility.",
        action: { label: "Open fleet", view: "fleets" },
      });
    }
  }

  // A rail with forty "X is idle" cards is a rail nobody reads, so past a
  // handful they are collapsed into one line.
  if (idle.length > IDLE_FLEET_LIMIT) {
    add({
      id: "fleet:idle:many",
      severity: "info",
      title: `${idle.length} fleets are idle`,
      detail: "They are holding station with no orders queued.",
      action: { label: "Open fleets", view: "fleets" },
    });
  } else {
    for (const issue of idle) add(issue);
  }

  // Crates on the dock are only a problem when nothing collects them.
  if (!empire.civilianShipping) {
    for (const colony of empire.colonies.values()) {
      const waiting = Object.values(colony.stored).reduce((sum, n) => sum + n, 0);
      if (waiting <= 0) continue;
      add({
        id: `cargo:waiting:${colony.bodyId}`,
        severity: "warning",
        title: `${system.byId.get(colony.bodyId)?.name ?? colony.bodyId}: ${waiting} installations await transport`,
        detail: "Civilian shipping is off, so a freighter has to collect them.",
        action: { label: "Open colony", view: "colonies", bodyId: colony.bodyId },
      });
    }
  }

  if (!empire.designs.length && ENGINE_TYPES.some((e) => empire.researched.has(e.tech))) {
    add({
      id: "fleet:no-designs",
      severity: "info",
      title: "No ship classes have been designed",
      detail: "An engine has been researched. Design the components, then assemble a class.",
      action: { label: "Open the designer", view: "design" },
    });
  }

  // ---------------------------------------------------------- research
  for (const project of empire.projects) {
    const tech = TECH_BY_ID.get(project.techId);
    const scientist = empire.officers.get(project.scientistId ?? undefined);
    if (!scientist) {
      add({
        id: `research:leaderless:${project.id}`,
        severity: "critical",
        title: `${tech?.name ?? project.techId} has no scientist`,
        detail: "The project is idle and its laboratories are producing nothing.",
        action: { label: "Assign a scientist", view: "research" },
      });
      continue;
    }
    if (project.labs > labCapacity(scientist)) {
      add({
        id: `research:overcommitted:${project.id}`,
        severity: "warning",
        title: `${scientist.name} is directing more labs than they can`,
        detail: `${project.labs} assigned, ${labCapacity(scientist)} usable. The rest are idle.`,
        action: { label: "Open research", view: "research" },
      });
    }
  }

  let idleLabs = 0;
  for (const colony of empire.colonies.values()) {
    idleLabs += Math.max(
      0,
      installationCount(colony, "research-lab") - empire.labsInUse(colony.bodyId),
    );
  }
  if (idleLabs > 0) {
    const spare = empire.officers.byBranch("science").filter((o) => !o.assignment).length;
    add({
      id: "research:idle-labs",
      severity: spare > 0 ? "warning" : "info",
      title: `${idleLabs} research laboratories are idle`,
      detail: spare > 0
        ? `${spare} scientist${spare === 1 ? " is" : "s are"} available to lead a new project.`
        : "Every scientist is already leading a project.",
      action: { label: "Start research", view: "research" },
    });
  }

  // Governor proposals ride the same channel: a draft order the player
  // accepts or dismisses, never something that happened behind their back.
  for (const proposal of deriveProposals(empire, system)) {
    const sourceName = system.byId.get(proposal.order.sourceId)?.name ?? proposal.order.sourceId;
    issues.push({
      id: proposal.id,
      severity: "info",
      title: proposal.title,
      detail: proposal.detail,
      action: { label: "Open colony", view: "colonies", bodyId: proposal.colonyId },
      proposal: {
        label: proposalLabel(proposal, sourceName),
        sourceId: proposal.order.sourceId,
        installationId: proposal.order.installationId,
        quantity: proposal.order.quantity,
        destination: proposal.order.destination,
      },
    });
  }

  return issues.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title),
  );
}

/** Issues the player has not dismissed, newest dismissals having expired. */
export function activeIssues(empire: Empire, system: Galaxy, now: number): Issue[] {
  return deriveIssues(empire, system).filter((issue) => {
    const until = empire.dismissed.get(issue.id);
    return until === undefined || until <= now;
  });
}

export function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return counts;
}
