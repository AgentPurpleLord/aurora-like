/**
 * Player preferences, remembered between sessions.
 *
 * Everything here is presentation: density, which events stop the clock,
 * which panel sections are folded. None of it touches the simulation.
 */

import type { LogCategory } from "../state/empire";

export type Density = "comfortable" | "compact";

export interface Settings {
  density: Density;
  /** Which kinds of event stop the clock when it is running. */
  autoPause: Record<LogCategory, boolean>;
  /** Show the "next steps" guide on the dashboard. */
  guide: boolean;
  /** Section titles the player has folded away. */
  collapsed: string[];
  /** The colony screen's last-used tab. */
  colonyTab: string;
  /** The map's last-used lens. */
  lens: string;
}

const KEY = "aurora-like.settings";

const DEFAULTS: Settings = {
  density: "comfortable",
  autoPause: {
    research: true,
    construction: false,
    people: false,
    colony: true,
    economy: true,
    fleet: true,
  },
  guide: true,
  collapsed: [],
  colonyTab: "overview",
  lens: "default",
};

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULTS),
      ...saved,
      autoPause: { ...DEFAULTS.autoPause, ...(saved.autoPause ?? {}) },
    };
  } catch {
    // Storage can be unavailable or hold something unreadable; defaults are fine.
    return structuredClone(DEFAULTS);
  }
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode or full storage: preferences just will not persist */
  }
}

export function applyDensity(): void {
  document.documentElement.dataset.density = settings.density;
}

export function isCollapsed(title: string): boolean {
  return settings.collapsed.includes(title);
}

export function toggleCollapsed(title: string): boolean {
  const now = !isCollapsed(title);
  settings.collapsed = now
    ? [...settings.collapsed, title]
    : settings.collapsed.filter((t) => t !== title);
  saveSettings();
  return now;
}
