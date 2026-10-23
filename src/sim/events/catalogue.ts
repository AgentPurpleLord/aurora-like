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
      return `The deposit grows by ${fmt(extra)} t (${p.percent}%).`;
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
      return `The treasury gains ${fmt(Number(p.amount))}.`;
    }),
  },
  {
    id: "genius",
    tone: "good",
    weight: (ctx) => (ctx.empire.projects.some((p) => p.scientistId) ? 0.9 : 0),
    build: (ctx) => {
      const led = ctx.empire.projects.filter((p) => p.scientistId);
      const project = led.length ? ctx.rng.pick(led) : null;
      return project ? { officer: String(project.scientistId), gain: ctx.rng.int(2, 5) } : null;
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
      return `Research skill rises by ${p.gain} points, to ${officer.skills.research}.`;
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
      return `Population rises by ${extra.toFixed(2)} million.`;
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
      return `The treasury loses ${fmt(Number(p.amount))}.`;
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
        detail: "Free, but a bad fire could take a tenth of the factories.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          if (!colony) return "The colony is gone.";
          const share = ctx.rng.float(0.04, 0.1);
          const lost = destroy(colony, "construction-factory", installationCount(colony, "construction-factory") * share);
          colony.population = Math.max(0, colony.population * 0.995);
          return `The fire spreads. ${lost} factories are destroyed and a few workers are lost.`;
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
        detail: `Costs ${fmt(Number(p.cost))}. Work resumes at once.`,
        disabled: ctx.empire.treasury < Number(p.cost) ? "The treasury cannot cover it." : undefined,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          return `A settlement is signed for ${fmt(Number(p.cost))} and work resumes.`;
        },
      },
      {
        id: "hold",
        label: "Hold firm",
        detail: "Free, but half the progress on the current build is spoiled.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          const head = colony?.buildQueue[0];
          if (head) head.progress = Math.round(head.progress * 0.5);
          return "The stoppage collapses after a fortnight; the current build has lost half its progress.";
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
          return `The outbreak is contained; the quarantine costs ${fmt(Number(p.cost))} and a few lives.`;
        },
      },
      {
        id: "ignore",
        label: "Let it run its course",
        detail: "Free, but it could take up to eight per cent of the population.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          const share = ctx.rng.float(0.03, 0.08);
          if (colony) colony.population *= 1 - share;
          return `The fever burns through the colony. ${(share * 100).toFixed(1)}% of the population is lost.`;
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
        detail: "Free, but it may take up to half the stored fuel.",
        apply: () => {
          const colony = colonyOf(ctx, p);
          const share = ctx.rng.float(0.3, 0.5);
          const lost = colony ? colony.fuel * share : 0;
          if (colony) colony.fuel -= lost;
          return `The depot burns for two days: ${fmt(lost)} litres are lost.`;
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
        detail: `Costs ${fmt(Number(p.cost))} in missing funds, and the governor stays.`,
        apply: () => {
          ctx.empire.treasury -= Number(p.cost);
          return `The matter is buried. ${fmt(Number(p.cost))} is written off.`;
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
            return `The wreck is a cargo hulk. ${fmt(tons)} t of ${mineral} is recovered.`;
          }
          const project = ctx.empire.projects[0];
          if (roll < 0.8 && project) {
            const gain = Math.round((TECH_BY_ID.get(project.techId)?.cost ?? 1000) * 0.2);
            project.progress += gain;
            return `Recorded data from the wreck advances research by ${fmt(gain)} points.`;
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

