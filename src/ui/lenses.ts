/**
 * Map lenses.
 *
 * The map answers "where is everything?". A lens changes the question:
 * which worlds could I live on, what have I surveyed, where is the ore? Each
 * recolours the bodies by one property, so the answer is visible at a glance
 * rather than found by clicking fifty bodies one at a time.
 */

import type { Game } from "../state/game";
import type { Body } from "../sim/system";

export type LensId = "default" | "habitability" | "ownership" | "minerals";

export interface LegendEntry {
  color: string;
  label: string;
}

export interface Lens {
  id: LensId;
  label: string;
  question: string;
  /** Colour for a body, or null to leave it as it is. */
  color(body: Body, game: Game): string | null;
  legend: LegendEntry[];
}

const UNKNOWN = "#59626e";
const NONE = "#3d4651";

const HABITABILITY: LegendEntry[] = [
  { color: "#5fd08a", label: "Garden world (cost 0)" },
  { color: "#a6d06a", label: "Standard hostile (to 2.2)" },
  { color: "#e8c06a", label: "Harsh (to 3)" },
  { color: "#e8905a", label: "Severe (to 5)" },
  { color: "#d9604a", label: "Extreme (over 5)" },
  { color: NONE, label: "No surface" },
];

const OWNERSHIP: LegendEntry[] = [
  { color: "#7fd49a", label: "Colony" },
  { color: "#6aa6e8", label: "Surveyed" },
  { color: UNKNOWN, label: "Not surveyed" },
];

const MINERALS: LegendEntry[] = [
  { color: "#f0cf7a", label: "Rich (over 200k t)" },
  { color: "#d1a24a", label: "Good (50k - 200k)" },
  { color: "#9a7634", label: "Modest (5k - 50k)" },
  { color: "#5f4e30", label: "Poor or empty" },
  { color: UNKNOWN, label: "Not surveyed" },
];

function depositTotal(body: Body): number {
  return body.minerals.reduce((sum, d) => sum + d.amount, 0);
}

export const LENSES: Lens[] = [
  {
    id: "default",
    label: "Natural",
    question: "What does the system look like?",
    color: () => null,
    legend: [],
  },
  {
    id: "habitability",
    label: "Habitability",
    question: "Where could I live?",
    color: (body) => {
      if (body.cls === "star") return null;
      const cost = body.colonyCost;
      if (!Number.isFinite(cost)) return NONE;
      if (cost <= 0) return HABITABILITY[0].color;
      if (cost <= 2.2) return HABITABILITY[1].color;
      if (cost <= 3) return HABITABILITY[2].color;
      if (cost <= 5) return HABITABILITY[3].color;
      return HABITABILITY[4].color;
    },
    legend: HABITABILITY,
  },
  {
    id: "ownership",
    label: "Territory",
    question: "What do I hold, and what have I seen?",
    color: (body, game) => {
      if (body.cls === "star") return null;
      if (game.empire.colonies.has(body.id)) return OWNERSHIP[0].color;
      return game.empire.surveyed.has(body.id) ? OWNERSHIP[1].color : OWNERSHIP[2].color;
    },
    legend: OWNERSHIP,
  },
  {
    id: "minerals",
    label: "Minerals",
    question: "Where is the ore?",
    color: (body, game) => {
      if (body.cls === "star") return null;
      if (!game.empire.surveyed.has(body.id)) return UNKNOWN;
      const total = depositTotal(body);
      if (total > 200_000) return MINERALS[0].color;
      if (total > 50_000) return MINERALS[1].color;
      if (total > 5_000) return MINERALS[2].color;
      return MINERALS[3].color;
    },
    legend: MINERALS,
  },
];

export const LENS_BY_ID = new Map(LENSES.map((l) => [l.id, l]));

/** A few lines for the hover card, tuned to what the active lens is asking. */
export function hoverLines(body: Body, game: Game): string[] {
  const { empire } = game;
  const lines: string[] = [];
  const colony = empire.colonies.get(body.id);

  if (body.cls !== "star") {
    lines.push(
      Number.isFinite(body.colonyCost)
        ? `Colony cost ${body.colonyCost.toFixed(2)} - ${body.tempK.toFixed(0)} K`
        : "No solid surface",
    );
  }
  if (colony) {
    lines.push(`Colony - ${(colony.population >= 1000 ? `${(colony.population / 1000).toFixed(2)}bn` : `${colony.population.toFixed(1)}m`)} people`);
  } else if (body.cls !== "star") {
    lines.push(empire.surveyed.has(body.id) ? "Surveyed" : "Not surveyed");
  }
  if (empire.surveyed.has(body.id) && body.minerals.length) {
    const total = depositTotal(body);
    lines.push(`${(total / 1000).toFixed(0)}k t of minerals in ${body.minerals.length} deposits`);
  }
  return lines;
}
