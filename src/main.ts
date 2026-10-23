import "./style.css";
import "./theme-terminal.css";
import { applyDensity, applyTheme } from "./ui/settings";

applyDensity();
applyTheme();
import { App, type ViewId } from "./ui/app";
import { startingGame } from "./state/save";
import { rollEvent } from "./sim/events/engine";

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id) as T | null;
  if (!node) throw new Error(`application shell is missing #${id}`);
  return node;
}

const views: Record<ViewId, HTMLElement> = {
  empire: need("view-empire"),
  map: need("view-map"),
  galaxy: need("view-galaxy"),
  events: need("view-events"),
  colonies: need("view-colonies"),
  fleets: need("view-fleets"),
  design: need("view-design"),
  research: need("view-research"),
  officers: need("view-officers"),
  politics: need("view-politics"),
};

const start = startingGame();

// `?debug` exposes the game to the console and to the browser tests.
if (new URLSearchParams(window.location.search).has("debug")) {
  (window as unknown as { __game: unknown }).__game = start.game;
  // Raise a particular event now, for the browser tests.
  (window as unknown as { __rollEvent: unknown }).__rollEvent = (id: string) => {
    const g = start.game;
    const event = rollEvent({ empire: g.empire, galaxy: g.galaxy, now: g.clock.seconds, rng: g.empire.eventRng }, id);
    g.emit();
    return event;
  };
}

new App(need<HTMLCanvasElement>("map"), {
  tree: need("system-panel"),
  detail: need("detail-panel"),
  time: need("time-controls"),
  tools: need("map-tools"),
  overlay: need("map-overlay"),
  tabs: need("view-tabs"),
  empireBar: need("empire-bar"),
  rail: need("triage-rail"),
  paletteButton: need("palette-button"),
  settingsHost: need("settings-host"),
  saveButton: need("save-button"),
  views,
}, start.game, start);

// Offline support and installability, in the built app only.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* private browsing and some embedded browsers refuse; the game works regardless */
    });
  });
}
