/**
 * Suggested next steps.
 *
 * Attention items say what is wrong. Goals say what is possible: the natural
 * next move for the empire as it stands, derived from state like everything
 * else, so the list adapts to whatever the player has already done.
 */

import type { Empire, LogLink } from "../state/empire";
import { ENGINE_TYPES } from "./ships/components";
import { isBreathable } from "./atmosphere";
import type { Galaxy } from "./galaxy";

export interface Goal {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action: { label: string; link: LogLink };
}

export function deriveGoals(empire: Empire, system: Galaxy): Goal[] {
  const engine = ENGINE_TYPES.some((e) => empire.researched.has(e.tech));
  const hasSurveyor = [...empire.ships.values()].some(
    (ship) => (empire.statsOf(ship.designId)?.survey.geological ?? 0) > 0,
  );
  const outposts = [...empire.colonies.values()].filter(
    (c) =>
      c.bodyId !== empire.capital &&
      (c.installations["mine"] ?? 0) + (c.installations["automated-mine"] ?? 0) >= 10,
  );
  const terraforming = [...empire.colonies.values()].some((c) => c.terraforming);
  const habitable = [...empire.colonies.values()].some((c) => {
    const body = system.byId.get(c.bodyId);
    return body && c.bodyId !== empire.capital && isBreathable(body.atmosphere);
  });

  const jumpShip = [...empire.ships.values()].some(
    (ship) => (empire.statsOf(ship.designId)?.jumpCapacity ?? 0) > 0,
  );
  const abroad = [...empire.colonies.values()].some(
    (c) => system.byId.get(c.bodyId)?.systemId !== "sol",
  );

  return [
    {
      id: "engine",
      title: "Research your first engine",
      detail:
        "Nothing can leave Earth without a drive. The Conventional Engine is the cheapest, and the research view will propose a scientist and laboratories in one click.",
      done: engine,
      action: { label: "Open research", link: { view: "research", techId: "conventional-engine" } },
    },
    {
      id: "class",
      title: "Design a ship class",
      detail:
        "Components are designed first, then assembled into a class. \"Add standard set\" and \"Add standard classes\" give you a Hauler, a Pioneer and a Surveyor to start with.",
      done: empire.designs.length > 0,
      action: { label: "Open the designer", link: { view: "design" } },
    },
    {
      id: "sensors",
      title: "Research survey sensors",
      detail:
        "Until a world has been surveyed its minerals are unknown, and a governor will not propose mining it.",
      done: empire.researched.has("geo-survey-sensors"),
      action: { label: "Open research", link: { view: "research", techId: "geo-survey-sensors" } },
    },
    {
      id: "surveyor",
      title: "Build a survey ship",
      detail:
        "Design a class with a survey sensor (the standard Surveyor has one) and lay it down at a shipyard.",
      done: hasSurveyor,
      action: { label: "Open fleets", link: { view: "fleets" } },
    },
    {
      id: "survey-luna",
      title: "Survey the Moon",
      detail:
        "Send the surveyor to Luna with Move then Survey orders. A 4 HS sensor takes about five days.",
      done: empire.surveyed.has("luna"),
      action: { label: "Show Luna", link: { view: "map", bodyId: "luna" } },
    },
    {
      id: "settle",
      title: "Settle a second world",
      detail:
        "Establish a colony on Luna, then build infrastructure at Earth and ship it across so colonists can live there.",
      done: empire.colonies.size >= 2,
      action: { label: "Show Luna", link: { view: "map", bodyId: "luna" } },
    },
    {
      id: "outpost",
      title: "Develop a mining outpost",
      detail:
        "A development template applies a whole outpost - infrastructure, mines and mass drivers - in one action.",
      done: outposts.length > 0,
      action: { label: "Open colonies", link: { view: "colonies" } },
    },
    {
      id: "terraform",
      title: "Begin terraforming a world",
      detail:
        "Research Terraforming Technology, put processors on a settled world, and warm it with a greenhouse gas that is not a poison.",
      done: terraforming || habitable,
      action: { label: "Open research", link: { view: "research", techId: "terraforming" } },
    },
    {
      id: "jump-theory",
      title: "Find a way out of the system",
      detail:
        "Gravitational Survey Sensors locate jump points; Jump Point Theory gives ships a drive that can cross them. Both are a long research road.",
      done: empire.researched.has("jump-point-theory"),
      action: { label: "Open research", link: { view: "research", techId: "jump-point-theory" } },
    },
    {
      id: "jump-point",
      title: "Find a jump point",
      detail:
        "Design a ship with a gravitational survey sensor and a jump drive, then set it to explore. It searches each system, crosses what it finds, and turns back to refuel.",
      done: empire.knownJumpPoints.size > 0,
      action: { label: "Open the designer", link: { view: "design" } },
    },
    {
      id: "cross",
      title: jumpShip ? "Cross a jump point" : "Build a ship with a jump drive",
      detail:
        "The first crossing opens a new star system to survey. The galaxy map shows what you have charted.",
      done: empire.knownSystems.size > 1,
      action: { label: "Open the galaxy map", link: { view: "galaxy" } },
    },
    {
      id: "foothold",
      title: "Settle another star system",
      detail:
        "The first colony in a new system needs a ship with cryogenic berths in orbit. Gates, built by a ship with a gate construction module, make supply lines to it practical.",
      done: abroad,
      action: { label: "Open the galaxy map", link: { view: "galaxy" } },
    },
  ];
}
