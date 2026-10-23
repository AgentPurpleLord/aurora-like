/**
 * The events themselves.
 *
 * Each is small and concrete: something happens to a particular colony,
 * project, officer or fleet, and where it is a choice the options say what
 * they cost before they are taken. Effects are instant and use only things
 * the game already has - treasury, stockpiles, installations, population,
 * progress, skills, fuel - so there is no hidden state to keep in sync.
 */

import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import { MINERALS, type MineralName } from "../minerals";
import { TECH_BY_ID } from "../research/techs";
import { fullName } from "../people/officers";
import { FAILING, shipCondition } from "../ships/maintenance";
import type { EffectKind } from "../../state/empire";
import type { EventContext, EventDef, EventOption, EventParams } from "./types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const bodyName = (ctx: EventContext, id: string) => ctx.galaxy.byId.get(id)?.name ?? id;
const colonyOf = (ctx: EventContext, params: EventParams): Colony | undefined =>
  ctx.empire.colonies.get(String(params.colony));

/** A pick among a colony's candidates, or null. */
function pickColony(ctx: EventContext, ok: (c: Colony) => boolean): Colony | null {
  const list = [...ctx.empire.colonies.values()].filter(ok);
  return list.length ? ctx.rng.pick(list) : null;
}

/** Whole money amounts that scale with the treasury but never vanish. */
const scaled = (ctx: EventContext, share: number, floor: number) =>
  Math.round(Math.max(floor, ctx.empire.treasury * share));

const link = (_ctx: EventContext, params: EventParams) =>
  params.colony ? { view: "colonies" as const, bodyId: String(params.colony) } : { view: "events" as const };

/** Remove up to `count` of an installation, never more than there are. */
function destroy(colony: Colony, id: string, count: number): number {
  const lost = Math.min(Math.floor(count), installationCount(colony, id));
  if (lost > 0) colony.installations[id] = installationCount(colony, id) - lost;
  return lost;
}

const KIND_TEXT: Record<EffectKind, string> = {
  industry: "Industry", mining: "Mining", fuel: "Fuel production", research: "Research", wealth: "Income", growth: "Population growth", stability: "Stability",
};
const span = (days: number) => (days >= 330 ? `${Math.round(days / 365 * 10) / 10} years` : days >= 45 ? `${Math.round(days / 30)} months` : `${days} days`);
const pct = (factor: number) => `${factor >= 1 ? "+" : "-"}${Math.round(Math.abs(factor - 1) * 100)}%`;

/** Start a lasting effect and describe it in words for the outcome. */
function lasting(ctx: EventContext, kind: EffectKind, target: string, factor: number, days: number, label: string): string {
  ctx.empire.addEffect({ kind, target, factor, label, source: ctx.eventId }, ctx.now, days);
  return `${KIND_TEXT[kind]} ${pct(factor)} for ${span(days)}`;
}

/** Queue the next link in a chain, a random while from now. */
function followUp(ctx: EventContext, defId: string, params: EventParams, fromDays: number, toDays: number): void {
  ctx.empire.scheduleEvent(defId, params, ctx.now, ctx.rng.int(fromDays, toDays), ctx.eventTitle);
}

const auto = (apply: EventOption["apply"]): EventOption[] => [
  { id: "auto", label: "Noted", detail: "", apply },
];

export const EVENTS: EventDef[] = [
  // ----------------------------------------------------------------- good
  {
    id: "rich-seam",
    tone: "good",
    weight: () => 1.2,
    build: (ctx) => {
      const colony = pickColony(ctx, (c) => installationCount(c, "mine") + installationCount(c, "automated-mine") > 0);
      const body = colony && ctx.galaxy.byId.get(colony.bodyId);
      const deposit = body?.minerals.filter((d) => d.amount > 0).sort((a, b) => b.accessibility - a.accessibility)[0];
      if (!colony || !deposit) return null;
      return { colony: colony.bodyId, mineral: deposit.mineral, percent: Math.round(ctx.rng.float(15, 45)) };
    },
    describe: (p, ctx) => ({
      title: "A richer seam",
      text: `Miners on ${bodyName(ctx, String(p.colony))} have broken into a far richer ${String(p.mineral).toLowerCase()} seam than the survey suggested.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => auto(() => {
      const deposit = ctx.galaxy.byId.get(String(p.colony))?.minerals.find((d) => d.mineral === p.mineral);
      if (!deposit) return "The seam turned out to be nothing.";
      const extra = Math.round(deposit.amount * Number(p.percent) / 100);
      deposit.amount += extra;
      const shift = lasting(ctx, "mining", String(p.colony), 1.2, 365, "New shift system");
      return `The deposit grows by ${fmt(extra)} t (${p.percent}%), and a new shift pattern lifts output: ${shift}.`;
    }),
  },
  {
    id: "breakthrough",
    tone: "good",
    weight: (ctx) => (ctx.empire.projects.length ? 1.4 : 0),
    build: (ctx) => {
      const project = ctx.empire.projects.length ? ctx.rng.pick(ctx.empire.projects) : null;
      return project ? { project: project.id, percent: Math.round(ctx.rng.float(10, 30)) } : null;
    },
    describe: (p, ctx) => {
      const project = ctx.empire.projects.find((x) => x.id === p.project);
      return {
        title: "A breakthrough",
        text: `A flash of insight in the ${project ? ctx.empire.techName(project.techId) : "research"} programme saves months of dead ends.`,
        link: { view: "research", techId: project?.techId },
      };
    },
    options: (p, ctx) => auto(() => {
      const project = ctx.empire.projects.find((x) => x.id === p.project);
      const cost = project ? TECH_BY_ID.get(project.techId)?.cost ?? 0 : 0;
      if (!project) return "The programme had already finished.";
      const gain = Math.round(cost * Number(p.percent) / 100);
      project.progress += gain;
      return `${fmt(gain)} research points are credited at once (${p.percent}% of the cost).`;
    }),
  },
  {
    id: "grant",
    tone: "good",
    weight: () => 1,
    build: (ctx) => ({ amount: Math.round(Math.max(2500, ctx.empire.snapshot.income * ctx.rng.float(0.04, 0.12))) }),
    describe: (p) => ({
      title: "An endowment",
      text: `A private foundation, impressed by the empire's progress, endows the treasury with ${fmt(Number(p.amount))}.`,
    }),
    options: (p, ctx) => auto(() => {
      ctx.empire.treasury += Number(p.amount);
      followUp(ctx, "foundation-review", { amount: Number(p.amount), cost: 1000 }, 150, 250);
      return `The treasury gains ${fmt(Number(p.amount))}. The foundation says it will want to see what became of it.`;
    }),
  },
  {
    id: "genius",
    tone: "good",
    weight: (ctx) => (ctx.empire.projects.some((p) => p.scientistId) ? 0.9 : 0),
    build: (ctx) => {
      const led = ctx.empire.projects.filter((p) => p.scientistId);
      const project = led.length ? ctx.rng.pick(led) : null;
      return project ? { officer: String(project.scientistId), colony: project.colonyId, gain: ctx.rng.int(2, 5) } : null;
    },
    describe: (p, ctx) => {
      const officer = ctx.empire.officers.get(String(p.officer));
      return {
        title: "A mind at its peak",
        text: `${officer ? fullName(officer) : "A scientist"} publishes the work of a career, and the whole laboratory raises its game.`,
        link: { view: "officers" },
      };
    },
    options: (p, ctx) => auto(() => {
      const officer = ctx.empire.officers.get(String(p.officer));
      if (!officer) return "The scientist has left the service.";
      officer.skills.research = (officer.skills.research ?? 0) + Number(p.gain);
      const ferment = lasting(ctx, "research", String(p.colony), 1.08, 200, "Intellectual ferment");
      return `Research skill rises by ${p.gain} points, to ${officer.skills.research}, and the laboratory buzzes: ${ferment}.`;
    }),
  },
  {
    id: "boom",
    tone: "good",
    weight: () => 0.9,
    build: (ctx) => {
      const colony = pickColony(ctx, (c) => c.population >= 0.5);
      return colony ? { colony: colony.bodyId, percent: Math.round(ctx.rng.float(3, 9)) } : null;
    },
    describe: (p, ctx) => ({
      title: "A baby boom",
      text: `Optimism is running high on ${bodyName(ctx, String(p.colony))}, and the birth rate shows it.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => auto(() => {
      const colony = colonyOf(ctx, p);
      if (!colony) return "The colony is gone.";
      const extra = colony.population * Number(p.percent) / 100;
      colony.population += extra;
      const lift = lasting(ctx, "growth", colony.bodyId, 1.5, 180, "Optimism");
      return `Population rises by ${extra.toFixed(2)} million, and the mood lasts: ${lift}.`;
    }),
  },
  {
    id: "recruits",
    tone: "good",
    weight: () => 0.6,
    build: (ctx) => ({ branch: ctx.rng.pick(["science", "civilian", "navy"]) }),
    describe: (p) => ({
      title: "A wave of volunteers",
      text: `A recruitment drive pays off: a gifted ${p.branch === "science" ? "researcher" : p.branch === "civilian" ? "administrator" : "officer"} joins the service.`,
      link: { view: "officers" },
    }),
    options: (p, ctx) => auto(() => {
      const officer = ctx.empire.officers.add(p.branch as "science" | "civilian" | "navy", ctx.now);
      return `${fullName(officer)} has entered service.`;
    }),
  },
  {
    id: "gravity-ripple",
    tone: "good",
    weight: (ctx) => (ctx.empire.researched.has("grav-survey-sensors") && hiddenJump(ctx) ? 0.8 : 0),
    build: (ctx) => {
      const jp = hiddenJump(ctx);
      return jp ? { jump: jp } : null;
    },
    describe: (p, ctx) => ({
      title: "A gravitational ripple",
      text: `A passing gravity wave makes a jump point in ${ctx.galaxy.systemById.get(ctx.galaxy.byId.get(String(p.jump))!.systemId)?.name} stand out against the background.`,
      link: { view: "map", bodyId: String(p.jump) },
    }),
    options: (p, ctx) => auto(() => {
      ctx.empire.knownJumpPoints.add(String(p.jump));
      return `${bodyName(ctx, String(p.jump))} is now on the chart, without a survey.`;
    }),
  },

  // ------------------------------------------------------------------ bad
  {
    id: "slump",
    tone: "bad",
    weight: (ctx) => (ctx.empire.treasury > 8000 ? 0.7 : 0),
    build: (ctx) => ({ amount: scaled(ctx, ctx.rng.float(0.03, 0.07), 2000) }),
    describe: (p) => ({
      title: "A market slump",
      text: `Confidence in the colonial bonds collapses for a season. The treasury loses ${fmt(Number(p.amount))} in revaluations.`,
    }),
    options: (p, ctx) => auto(() => {
      ctx.empire.treasury -= Number(p.amount);
      const squeeze = lasting(ctx, "wealth", "empire", 0.9, 150, "Credit squeeze");
      return `The treasury loses ${fmt(Number(p.amount))}, and borrowing stays dear: ${squeeze}.`;
    }),
  },
  {
    id: "solar-flare",
    tone: "bad",
    weight: (ctx) => (ctx.empire.ships.size ? 0.8 : 0),
    build: (ctx) => {
      const fleets = [...ctx.empire.fleets.values()].filter((f) => f.shipIds.length);
      return fleets.length ? { fleet: ctx.rng.pick(fleets).id, percent: Math.round(ctx.rng.float(10, 30)) } : null;
    },
    describe: (p, ctx) => ({
      title: "Solar flare",
      text: `A flare washes over ${ctx.empire.fleets.get(String(p.fleet))?.name ?? "a fleet"}, and radiation-damaged tank seals leak.`,
      link: { view: "fleets", fleetId: String(p.fleet) },
    }),
    options: (p, ctx) => auto(() => {
      const fleet = ctx.empire.fleets.get(String(p.fleet));
      if (!fleet) return "The fleet had already been disbanded.";
      let lost = 0;
      for (const id of fleet.shipIds) {
        const ship = ctx.empire.ships.get(id);
        if (!ship) continue;
        const loss = ship.fuel * Number(p.percent) / 100;
        ship.fuel -= loss;
        lost += loss;
      }
      return `${fmt(lost)} litres of fuel are lost (${p.percent}% of what the fleet carried).`;
    }),
  },
  {
    id: "accident",
    tone: "bad",
    decision: true,
    fallback: "carry-on",
    weight: (ctx) => ([...ctx.empire.colonies.values()].some((c) => installationCount(c, "construction-factory") >= 40) ? 1.2 : 0),
    build: (ctx) => {
      const colony = pickColony(ctx, (c) => installationCount(c, "construction-factory") >= 40);
      return colony ? { colony: colony.bodyId, cost: scaled(ctx, 0.02, 800) } : null;
    },
    describe: (p, ctx) => ({
      title: "Industrial accident",
      text: `A coolant failure at a factory complex on ${bodyName(ctx, String(p.colony))} is spreading. The foreman wants authority to shut the whole line down and inspect it.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => [
      {
        id: "review",
        label: "Order a full safety review",
        detail: `Costs ${fmt(Number(p.cost))}. Limits the damage to a few factories.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          const colony = colonyOf(ctx, p);
          ctx.empire.treasury -= Number(p.cost);
          const lost = colony ? destroy(colony, "construction-factory", Math.max(1, installationCount(colony, "construction-factory") * 0.01)) : 0;
          return `The line is shut down in time. ${lost} factor${lost === 1 ? "y" : "ies"} lost, ${fmt(Number(p.cost))} spent.`;
        },
      },
      {
        id: "carry-on",
        label: "Keep the line running",
        detail: "Free, but a bad fire could take a tenth of the factories, and the damaged lines run at a fifth less for three months.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          if (!colony) return "The colony is gone.";
          const share = ctx.rng.float(0.04, 0.1);
          const lost = destroy(colony, "construction-factory", installationCount(colony, "construction-factory") * share);
          colony.population = Math.max(0, colony.population * 0.995);
          const damage = lasting(ctx, "industry", colony.bodyId, 0.8, 90, "Fire-damaged lines");
          return `The fire spreads. ${lost} factories are destroyed and a few workers are lost. ${damage}.`;
        },
      },
    ],
  },
  {
    id: "strike",
    tone: "bad",
    decision: true,
    fallback: "hold",
    weight: (ctx) => ([...ctx.empire.colonies.values()].some((c) => c.population >= 2 && c.buildQueue.length > 0) ? 1 : 0),
    build: (ctx) => {
      const colony = pickColony(ctx, (c) => c.population >= 2 && c.buildQueue.length > 0);
      return colony ? { colony: colony.bodyId, cost: scaled(ctx, 0.03, 1000) } : null;
    },
    describe: (p, ctx) => ({
      title: "Work stoppage",
      text: `Workers on ${bodyName(ctx, String(p.colony))} have downed tools over conditions. Everything in the build queue is standing still.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => [
      {
        id: "negotiate",
        label: "Meet their demands",
        detail: `Costs ${fmt(Number(p.cost))}. Work resumes at once, and a content workforce lifts industry by a tenth for six months.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          const glow = lasting(ctx, "industry", String(p.colony), 1.1, 180, "Contented workforce");
          return `A settlement is signed for ${fmt(Number(p.cost))} and work resumes. ${glow}.`;
        },
      },
      {
        id: "hold",
        label: "Hold firm",
        detail: "Free, but half the progress on the current build is spoiled, output drops for months, and the stoppage may come back.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          const head = colony?.buildQueue[0];
          if (head) head.progress = Math.round(head.progress * 0.5);
          const slow = lasting(ctx, "industry", String(p.colony), 0.7, 180, "Work-to-rule");
          if (ctx.rng.chance(0.5)) followUp(ctx, "strike-returns", { colony: String(p.colony), cost: scaled(ctx, 0.06, 2500) }, 40, 70);
          return `The stoppage collapses after a fortnight, but resentment lingers. The current build has lost half its progress. ${slow}.`;
        },
      },
    ],
  },
  {
    id: "epidemic",
    tone: "bad",
    decision: true,
    fallback: "ignore",
    weight: (ctx) => ([...ctx.empire.colonies.values()].some((c) => c.population >= 1) ? 0.9 : 0),
    build: (ctx) => {
      const colony = pickColony(ctx, (c) => c.population >= 1);
      return colony ? { colony: colony.bodyId, cost: scaled(ctx, 0.03, 1200) } : null;
    },
    describe: (p, ctx) => ({
      title: "Outbreak",
      text: `A fast-spreading fever has appeared in the habitats of ${bodyName(ctx, String(p.colony))}. Doctors ask for emergency powers.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => [
      {
        id: "quarantine",
        label: "Fund a quarantine",
        detail: `Costs ${fmt(Number(p.cost))}. Keeps the toll under one per cent.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          const colony = colonyOf(ctx, p);
          ctx.empire.treasury -= Number(p.cost);
          if (colony) colony.population *= 0.995;
          const limits = lasting(ctx, "growth", String(p.colony), 0.8, 60, "Quarantine restrictions");
          return `The outbreak is contained; the quarantine costs ${fmt(Number(p.cost))} and a few lives. ${limits}.`;
        },
      },
      {
        id: "ignore",
        label: "Let it run its course",
        detail: "Free, but it could take up to eight per cent of the population and halves growth for five months.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          const share = ctx.rng.float(0.03, 0.08);
          if (colony) colony.population *= 1 - share;
          const sick = lasting(ctx, "growth", String(p.colony), 0.5, 150, "Sickness lingers");
          followUp(ctx, "epidemic-aftermath", { colony: String(p.colony), cost: scaled(ctx, 0.03, 1500) }, 100, 150);
          return `The fever burns through the colony. ${(share * 100).toFixed(1)}% of the population is lost. ${sick}.`;
        },
      },
    ],
  },
  {
    id: "refinery-fire",
    tone: "bad",
    decision: true,
    fallback: "burn",
    weight: (ctx) => ([...ctx.empire.colonies.values()].some((c) => c.fuel > 100_000) ? 0.9 : 0),
    build: (ctx) => {
      const colony = pickColony(ctx, (c) => c.fuel > 100_000);
      return colony ? { colony: colony.bodyId, cost: scaled(ctx, 0.02, 800) } : null;
    },
    describe: (p, ctx) => ({
      title: "Fuel depot fire",
      text: `A spark has reached the fuel depot on ${bodyName(ctx, String(p.colony))}. The tank farm could go up.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => [
      {
        id: "crews",
        label: "Pay for emergency crews",
        detail: `Costs ${fmt(Number(p.cost))}. Saves almost all of the fuel.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          const colony = colonyOf(ctx, p);
          ctx.empire.treasury -= Number(p.cost);
          const lost = colony ? colony.fuel * 0.05 : 0;
          if (colony) colony.fuel -= lost;
          return `The crews hold the fire to one tank: ${fmt(lost)} litres lost, ${fmt(Number(p.cost))} spent.`;
        },
      },
      {
        id: "burn",
        label: "Let it burn out",
        detail: "Free, but it may take up to half the stored fuel and halves fuel production for four months.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          const share = ctx.rng.float(0.3, 0.5);
          const lost = colony ? colony.fuel * share : 0;
          if (colony) colony.fuel -= lost;
          const down = lasting(ctx, "fuel", String(p.colony), 0.5, 120, "Depot being rebuilt");
          return `The depot burns for two days: ${fmt(lost)} litres are lost. ${down}.`;
        },
      },
    ],
  },
  {
    id: "scandal",
    tone: "bad",
    decision: true,
    fallback: "hush",
    weight: (ctx) => ([...ctx.empire.colonies.keys()].some((id) => ctx.empire.governorOf(id)) ? 0.7 : 0),
    build: (ctx) => {
      const governed = [...ctx.empire.colonies.keys()].filter((id) => ctx.empire.governorOf(id));
      if (!governed.length) return null;
      const colony = ctx.rng.pick(governed);
      return { colony, officer: ctx.empire.governorOf(colony)!.id, cost: scaled(ctx, 0.04, 1500), prosecute: scaled(ctx, 0.005, 400) };
    },
    describe: (p, ctx) => {
      const officer = ctx.empire.officers.get(String(p.officer));
      return {
        title: "Questions about the books",
        text: `Auditors find that ${officer ? fullName(officer) : "the governor"} of ${bodyName(ctx, String(p.colony))} has been taking more than the post allows.`,
        link: link(ctx, p),
      };
    },
    options: (p, ctx) => [
      {
        id: "prosecute",
        label: "Remove the governor",
        detail: `Costs ${fmt(Number(p.prosecute))} in legal fees. The post is left vacant.`,
        disabled: ctx.empire.treasury < Number(p.prosecute) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.prosecute);
          ctx.empire.assignOfficer(String(p.officer), null);
          return `The governor is removed from ${bodyName(ctx, String(p.colony))} and the post stands vacant.`;
        },
      },
      {
        id: "hush",
        label: "Keep it quiet",
        detail: `Costs ${fmt(Number(p.cost))} in missing funds and dents confidence for six months. The governor stays, and it may leak.`,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          const doubt = lasting(ctx, "wealth", "empire", 0.92, 180, "Loss of confidence");
          if (ctx.rng.chance(0.5)) followUp(ctx, "scandal-leak", { colony: String(p.colony), officer: String(p.officer), cost: scaled(ctx, 0.01, 600) }, 60, 100);
          return `The matter is buried. ${fmt(Number(p.cost))} is written off. ${doubt}.`;
        },
      },
    ],
  },

  // -------------------------------------------------------- new, lasting
  {
    id: "trade-boom",
    tone: "good",
    weight: () => 0.8,
    build: () => ({ percent: 15 }),
    describe: () => ({
      title: "A trade boom",
      text: "Merchants from every quarter are racing to supply the colonies, and tax receipts follow.",
    }),
    options: (_p, ctx) => auto(() => `${lasting(ctx, "wealth", "empire", 1.15, 200, "Trade boom")}.`),
  },
  {
    id: "shaft-collapse",
    tone: "bad",
    decision: true,
    fallback: "work-around",
    weight: (ctx) => ([...ctx.empire.colonies.values()].some((c) => installationCount(c, "mine") >= 20) ? 0.9 : 0),
    build: (ctx) => {
      const colony = pickColony(ctx, (c) => installationCount(c, "mine") >= 20);
      return colony ? { colony: colony.bodyId, cost: scaled(ctx, 0.025, 1500) } : null;
    },
    describe: (p, ctx) => ({
      title: "Shaft collapse",
      text: `The main shaft at the mines on ${bodyName(ctx, String(p.colony))} has caved in. Nobody is hurt, but half the workings are cut off.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => [
      {
        id: "shore-up",
        label: "Shore up the workings",
        detail: `Costs ${fmt(Number(p.cost))}. Mining is down by a fifth for two months.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          return `Engineers shore up the shaft for ${fmt(Number(p.cost))}. ${lasting(ctx, "mining", String(p.colony), 0.8, 60, "Shaft being rebuilt")}.`;
        },
      },
      {
        id: "work-around",
        label: "Work around it",
        detail: "Free, but mining is down by two-fifths for five months.",
        apply: () => `The crews dig around the collapse. ${lasting(ctx, "mining", String(p.colony), 0.6, 150, "Workings cut off")}.`,
      },
    ],
  },

  // ---------------------------------------------------------- follow-ups
  {
    id: "strike-returns",
    tone: "bad",
    decision: true,
    fallback: "force",
    weight: () => 0,
    valid: (p, ctx) => ctx.empire.colonies.has(String(p.colony)),
    build: () => null,
    describe: (p, ctx) => ({
      title: "The stoppage returns",
      text: `The grievances on ${bodyName(ctx, String(p.colony))} were never settled, and the workers are out again - angrier, and better organised.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => [
      {
        id: "force",
        label: "Send in security forces",
        detail: "Free. Ends it quickly but costs lives and halves industry for two months.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          if (colony) colony.population *= 0.99;
          return `Order is restored, at a price. ${lasting(ctx, "industry", String(p.colony), 0.5, 60, "Martial law")}.`;
        },
      },
      {
        id: "settle",
        label: "Settle on their terms",
        detail: `Costs ${fmt(Number(p.cost))}. Industry then runs 15% higher for eight months.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          return `A generous settlement is signed for ${fmt(Number(p.cost))}. ${lasting(ctx, "industry", String(p.colony), 1.15, 240, "A loyal workforce")}.`;
        },
      },
    ],
  },
  {
    id: "epidemic-aftermath",
    tone: "neutral",
    decision: true,
    fallback: "heal",
    weight: () => 0,
    valid: (p, ctx) => ctx.empire.colonies.has(String(p.colony)),
    build: () => null,
    describe: (p, ctx) => ({
      title: "After the fever",
      text: `${bodyName(ctx, String(p.colony))} is recovering from the outbreak. The clinics are overstretched, and many want a proper health service built.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => [
      {
        id: "fund",
        label: "Fund a health programme",
        detail: `Costs ${fmt(Number(p.cost))}. Population grows half again as fast for most of a year.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          return `Clinics are built for ${fmt(Number(p.cost))}. ${lasting(ctx, "growth", String(p.colony), 1.5, 270, "Healthy generation")}.`;
        },
      },
      { id: "heal", label: "Let it recover by itself", detail: "Free. Nothing changes.", apply: () => "The colony recovers at its own pace." },
    ],
  },
  {
    id: "scandal-leak",
    tone: "bad",
    decision: true,
    fallback: "deny",
    weight: () => 0,
    valid: (p, ctx) => ctx.empire.colonies.has(String(p.colony)),
    build: () => null,
    describe: (p, ctx) => ({
      title: "The story breaks",
      text: `Someone has leaked the audit of ${bodyName(ctx, String(p.colony))}'s books to the press. Everyone is asking what you knew.`,
      link: link(ctx, p),
    }),
    options: (p, ctx) => [
      {
        id: "inquiry",
        label: "Hold a public inquiry",
        detail: `Costs ${fmt(Number(p.cost))}. The governor is removed; confidence recovers sooner.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          ctx.empire.assignOfficer(String(p.officer), null);
          return `The inquiry finds against the governor, who is removed. ${lasting(ctx, "wealth", "empire", 0.96, 90, "Lingering doubt")}.`;
        },
      },
      {
        id: "deny",
        label: "Deny everything",
        detail: "Free, but confidence drops by 15% for eight months.",
        apply: () => `The denials convince no one. ${lasting(ctx, "wealth", "empire", 0.85, 240, "Crisis of confidence")}.`,
      },
    ],
  },
  {
    id: "derelict-beacon",
    tone: "neutral",
    decision: true,
    fallback: "ignore",
    weight: () => 0,
    build: () => null,
    describe: () => ({
      title: "The wreck is transmitting",
      text: "The transponder on the old wreck has woken up and is sending a repeating pattern towards somewhere outside the system. Analysts think it is a map.",
    }),
    options: (p, ctx) => [
      {
        id: "follow",
        label: "Decode the signal",
        detail: `Costs ${fmt(Number(p.cost))}. It may point to a jump point - or to nothing.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          const jp = hiddenJump(ctx);
          if (jp && ctx.rng.chance(0.7)) {
            ctx.empire.knownJumpPoints.add(jp);
            return `The pattern resolves into coordinates: ${bodyName(ctx, jp)} is now on the chart.`;
          }
          const project = ctx.empire.projects[0];
          if (project) {
            const gain = Math.round((TECH_BY_ID.get(project.techId)?.cost ?? 1000) * 0.15);
            project.progress += gain;
            return `The signal is a lesson in physics rather than a map. Research advances by ${fmt(gain)} points.`;
          }
          return "The signal turns out to be an echo of itself, and leads nowhere.";
        },
      },
      { id: "ignore", label: "Ignore it", detail: "Free. Nothing happens.", apply: () => "The signal is filed away and slowly fades." },
    ],
  },
  {
    id: "foundation-review",
    tone: "good",
    decision: true,
    fallback: "decline",
    weight: () => 0,
    build: () => null,
    describe: () => ({
      title: "The foundation calls",
      text: "The foundation that endowed the treasury has sent a delegation to see what became of its money. They are in a generous mood.",
    }),
    options: (p, ctx) => [
      {
        id: "host",
        label: "Show them the laboratories",
        detail: `Costs ${fmt(Number(p.cost))} to host. They give ${fmt(Number(p.amount) * 2)} more and research runs 5% faster for a year.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury += Number(p.amount) * 2 - Number(p.cost);
          return `The visit goes brilliantly: the foundation gives ${fmt(Number(p.amount) * 2)}. ${lasting(ctx, "research", "empire", 1.05, 365, "A patron's attention")}.`;
        },
      },
      { id: "decline", label: "Politely decline", detail: "Free. Nothing changes.", apply: () => "The delegation goes home, a little puzzled." },
    ],
  },
  {
    id: "ship-failure",
    tone: "bad",
    decision: true,
    fallback: "limp",
    weight: (ctx) => ([...ctx.empire.ships.values()].some((sh) => sh.condition < FAILING) ? 2 : 0),
    build: (ctx) => {
      const worn = [...ctx.empire.ships.values()].filter((sh) => sh.condition < FAILING);
      if (!worn.length) return null;
      const ship = ctx.rng.pick(worn);
      const cost = Math.max(400, Math.round((ctx.empire.statsOf(ship.designId)?.buildCost ?? 200) * 0.12));
      return { ship: ship.id, cost };
    },
    describe: (p, ctx) => {
      const ship = ctx.empire.ships.get(String(p.ship));
      return {
        title: "Breakdown",
        text: `${ship?.name ?? "A ship"} is badly overdue for overhaul and has lost main drive power. The engineers say they can patch it here - or you can ask them to keep going.`,
        link: { view: "fleets", fleetId: ship?.fleetId },
      };
    },
    valid: (p, ctx) => ctx.empire.ships.has(String(p.ship)),
    options: (p, ctx) => [
      {
        id: "repair",
        label: "Field repairs",
        detail: `Costs ${fmt(Number(p.cost))}. Takes four months off its maintenance clock on the spot.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          const ship = ctx.empire.ships.get(String(p.ship));
          ctx.empire.treasury -= Number(p.cost);
          if (ship) {
            ship.clock = Math.max(0, ship.clock - 120);
            ship.condition = shipCondition(ctx.empire, ship);
          }
          return `The crew patch the drive for ${fmt(Number(p.cost))}. Condition rises to ${Math.round(ship?.condition ?? 0)}%.`;
        },
      },
      {
        id: "limp",
        label: "Keep going",
        detail: "Free, but the drive degrades further and some fuel is lost.",
        apply: () => {
          const ship = ctx.empire.ships.get(String(p.ship));
          if (ship) {
            ship.clock += 45;
            ship.condition = shipCondition(ctx.empire, ship);
            ship.fuel *= 0.85;
          }
          return `The drive limps on. Condition falls to ${Math.round(ship?.condition ?? 0)}% and 15% of the fuel is lost.`;
        },
      },
    ],
  },
  {
    id: "derelict",
    tone: "neutral",
    decision: true,
    fallback: "leave",
    weight: (ctx) => (surveyedElsewhere(ctx).length ? 0.9 : 0),
    build: (ctx) => {
      const list = surveyedElsewhere(ctx);
      return list.length ? { body: ctx.rng.pick(list).id, cost: 1500 } : null;
    },
    describe: (p, ctx) => ({
      title: "Something in the survey data",
      text: `Analysts re-reading the survey of ${bodyName(ctx, String(p.body))} have found an artificial shape under the regolith. It is very old.`,
      link: { view: "map", bodyId: String(p.body) },
    }),
    options: (p, ctx) => [
      {
        id: "salvage",
        label: "Send a salvage team",
        detail: `Costs ${fmt(Number(p.cost))}. Could yield minerals, research notes - or nothing.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          const roll = ctx.rng.float(0, 1);
          const home = ctx.empire.colony(ctx.empire.capital) ?? [...ctx.empire.colonies.values()][0];
          if (roll < 0.5 && home) {
            const mineral = ctx.rng.pick(MINERALS) as MineralName;
            const tons = Math.round(ctx.rng.float(8_000, 30_000));
            home.stockpile[mineral] += tons;
            if (ctx.rng.chance(0.6)) followUp(ctx, "derelict-beacon", { cost: 3000 }, 60, 110);
            return `The wreck is a cargo hulk. ${fmt(tons)} t of ${mineral} is recovered. Its transponder is still warm.`;
          }
          const project = ctx.empire.projects[0];
          if (roll < 0.8 && project) {
            const gain = Math.round((TECH_BY_ID.get(project.techId)?.cost ?? 1000) * 0.2);
            project.progress += gain;
            if (ctx.rng.chance(0.6)) followUp(ctx, "derelict-beacon", { cost: 3000 }, 60, 110);
            return `Recorded data from the wreck advances research by ${fmt(gain)} points. One log entry mentions a beacon.`;
          }
          return "The wreck is a hoax - a pile of old plating. The expedition returns with nothing.";
        },
      },
      { id: "leave", label: "Leave it", detail: "Free. Nothing happens.", apply: () => "The find is logged and left where it lies." },
    ],
  },
];

/** A hidden jump point in a system the empire knows. */
function hiddenJump(ctx: EventContext): string | null {
  for (const id of ctx.empire.knownSystems) {
    const jp = ctx.galaxy.jumpPointsIn(id).find((b) => !ctx.empire.knownJumpPoints.has(b.id));
    if (jp) return jp.id;
  }
  return null;
}

/** Surveyed bodies with nobody on them. */
function surveyedElsewhere(ctx: EventContext) {
  return [...ctx.empire.surveyed]
    .map((id) => ctx.galaxy.byId.get(id))
    .filter((b): b is NonNullable<typeof b> => !!b && b.cls !== "star" && !ctx.empire.colonies.has(b.id));
}

export const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

