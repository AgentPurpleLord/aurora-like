import "./style.css";
import { App, type ViewId } from "./ui/app";

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id) as T | null;
  if (!node) throw new Error(`application shell is missing #${id}`);
  return node;
}

const views: Record<ViewId, HTMLElement> = {
  empire: need("view-empire"),
  map: need("view-map"),
  colonies: need("view-colonies"),
  research: need("view-research"),
  officers: need("view-officers"),
};

new App(need<HTMLCanvasElement>("map"), {
  tree: need("system-panel"),
  detail: need("detail-panel"),
  time: need("time-controls"),
  tools: need("map-tools"),
  overlay: need("map-overlay"),
  tabs: need("view-tabs"),
  empireBar: need("empire-bar"),
  rail: need("triage-rail"),
  views,
});
