import "./style.css";
import { App } from "./ui/app";

const canvas = document.getElementById("map") as HTMLCanvasElement | null;
const tree = document.getElementById("system-panel");
const detail = document.getElementById("detail-panel");
const time = document.getElementById("time-controls");
const tools = document.getElementById("map-tools");
const overlay = document.getElementById("map-overlay");

if (!canvas || !tree || !detail || !time || !tools || !overlay) {
  throw new Error("application shell is missing required elements");
}

new App(canvas, { tree, detail, time, tools, overlay });
