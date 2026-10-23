import "./style.css";
import { applyDensity } from "./ui/settings";

applyDensity();
import { App, type ViewId } from "./ui/app";
import { startingGame } from "./state/save";

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id) as T | null;
  if (!node) throw new Error(`application shell is missing #${id}`);
  return node;
}

const views: Record<ViewId, HTMLElement> = {
  empire: need("view-empire"),
  map: need("view-map"),
  galaxy: need("view-galaxy"),
  colonies: need("view-colonies"),
  fleets: need("view-fleets"),
  design: need("view-design"),
  research: need("view-research"),
  officers: need("view-officers"),
};

const start = startingGame();

// `?debug` exposes the game to the console and to the browser tests.
if (new URLSearchParams(window.location.search).has("debug")) {
  (window as unknown as { __game: unknown }).__game = start.game;
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
