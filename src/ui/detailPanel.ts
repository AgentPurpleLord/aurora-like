/** Right-hand body detail panel - the "open up a planet" view. */

import type { Game } from "../state/game";
import { classLabel, orbitSummary, type Body } from "../sim/system";
import { INSTALLATIONS, INSTALLATION_BY_ID } from "../state/installations";
import { AU_KM } from "../sim/orbit";
import {
  compact,
  dayLength,
  distance,
  el,
  kelvinToCelsius,
  lightTime,
  num,
  population,
} from "./format";

type TabId = "overview" | "environment" | "minerals" | "colony";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "environment", label: "Environment" },
  { id: "minerals", label: "Minerals" },
  { id: "colony", label: "Colony" },
];

const EARTH_MASS = 5.97237e24;

export class DetailPanel {
  private tab: TabId = "overview";
  private body: HTMLElement;
  private header: HTMLElement;
  private tabBar: HTMLElement;

  constructor(
    private root: HTMLElement,
    private game: Game,
    private onZoomTo: (body: Body) => void,
  ) {
    this.header = el("div", "detail-head");
    this.tabBar = el("div", "tabs");
    this.body = el("div", "detail-body");
    this.root.append(this.header, this.tabBar, this.body);
    this.buildTabs();
    this.render();
  }

  private buildTabs(): void {
    for (const tab of TABS) {
      const btn = el("button", "tab", tab.label);
      btn.dataset.tab = tab.id;
      btn.addEventListener("click", () => {
        this.tab = tab.id;
        this.render();
      });
      this.tabBar.append(btn);
    }
  }

  render(): void {
    const body = this.game.selected;
    this.header.textContent = "";
    this.body.textContent = "";

    for (const btn of Array.from(this.tabBar.children) as HTMLElement[]) {
      btn.classList.toggle("active", btn.dataset.tab === this.tab);
    }

    if (!body) {
      this.header.append(el("div", "detail-title", "No body selected"));
      this.body.append(el("p", "muted", "Select a body on the map or in the system list."));
      return;
    }

    const title = el("div", "detail-title", body.name);
    const dot = el("span", "dot big");
    dot.style.background = body.def.color;
    title.prepend(dot);
    this.header.append(title);

    const subtitle = body.parent
      ? `${classLabel(body)} - orbiting ${body.parent.name}`
      : classLabel(body);
    this.header.append(el("div", "detail-sub", subtitle));

    const zoom = el("button", "ghost-btn", "Centre on map");
    zoom.addEventListener("click", () => this.onZoomTo(body));
    this.header.append(zoom);

    switch (this.tab) {
      case "overview": this.renderOverview(body); break;
      case "environment": this.renderEnvironment(body); break;
      case "minerals": this.renderMinerals(body); break;
      case "colony": this.renderColony(body); break;
    }
  }

  private section(title: string): HTMLElement {
    const wrap = el("div", "section");
    wrap.append(el("h3", undefined, title));
    this.body.append(wrap);
    return wrap;
  }

  private stat(parent: HTMLElement, label: string, value: string): void {
    const row = el("div", "stat");
    row.append(el("span", "stat-label", label));
    row.append(el("span", "stat-value", value));
    parent.append(row);
  }

  private renderOverview(body: Body): void {
    const phys = this.section("Physical");
    this.stat(phys, "Radius", `${num(body.def.radiusKm, body.def.radiusKm < 10 ? 2 : 0)} km`);
    this.stat(phys, "Diameter", `${num(body.def.radiusKm * 2, 0)} km`);
    this.stat(phys, "Mass", `${body.def.massKg.toExponential(3)} kg`);
    if (body.cls !== "star") {
      this.stat(phys, "Mass (Earth = 1)", (body.def.massKg / EARTH_MASS).toPrecision(3));
      this.stat(phys, "Surface Gravity", `${body.gravity.toFixed(3)} g`);
      this.stat(phys, "Escape Velocity", `${body.escapeVelocity.toFixed(2)} km/s`);
    }

    const orbit = orbitSummary(body);
    if (orbit && body.parent) {
      const o = this.section(`Orbit about ${body.parent.name}`);
      const inKm = body.cls === "moon";
      const fmt = (au: number) => (inKm ? `${num(au * AU_KM)} km` : distance(au));
      this.stat(o, "Semi-major Axis", fmt(orbit.semiMajorAu));
      this.stat(o, "Periapsis", fmt(orbit.periapsisAu));
      this.stat(o, "Apoapsis", fmt(orbit.apoapsisAu));
      this.stat(o, "Eccentricity", body.def.orbit!.e.toFixed(4));
      this.stat(o, "Inclination", `${body.def.orbit!.inc.toFixed(2)} deg`);
      this.stat(o, "Orbital Period", orbit.periodText);
      this.stat(o, "Current Distance", distance(Math.hypot(body.local.x, body.local.y, body.local.z)));
    }

    const nav = this.section("Navigation");
    const star = this.game.system.root;
    const earth = this.game.system.byId.get("earth");
    const fromStar = this.game.system.distance(body, star);
    this.stat(nav, "Distance from Sol", distance(fromStar));
    if (earth && earth !== body) {
      const d = this.game.system.distance(body, earth);
      this.stat(nav, "Distance from Earth", distance(d));
      this.stat(nav, "Signal Delay", lightTime(d));
    }

    if (body.def.notes) {
      const notes = this.section("Notes");
      notes.append(el("p", "notes", body.def.notes));
    }
  }

  private renderEnvironment(body: Body): void {
    const env = this.section("Surface Conditions");
    if (body.def.tempK !== undefined) {
      this.stat(env, "Mean Temperature", `${kelvinToCelsius(body.def.tempK)}  (${body.def.tempK} K)`);
    }
    this.stat(env, "Day Length", dayLength(body.def.rotationDays));
    if (body.cls !== "star") {
      this.stat(env, "Surface Gravity", `${body.gravity.toFixed(3)} g`);
    }

    const atmo = this.section("Atmosphere");
    if (body.def.atmosphere) {
      this.stat(atmo, "Pressure", `${body.def.atmosphere.pressureAtm} atm`);
      this.stat(atmo, "Composition", body.def.atmosphere.composition);
      this.stat(atmo, "Breathable", body.def.atmosphere.breathable ? "Yes" : "No");
    } else {
      this.stat(atmo, "Pressure", "None - vacuum");
    }

    const hab = this.section("Habitability");
    const cost = body.colonyCost;
    if (!Number.isFinite(cost)) {
      this.stat(hab, "Colony Cost", "Not colonisable");
      hab.append(el("p", "notes", "No solid surface. Orbital habitats and gas harvesting only."));
    } else {
      this.stat(hab, "Colony Cost", cost.toFixed(2));
      const verdict =
        cost === 0
          ? "Garden world - population grows unaided."
          : cost <= 2.2
            ? "Standard hostile world. Infrastructure required in proportion to population."
            : cost <= 4
              ? "Harsh. Heavy infrastructure commitment; terraforming strongly advised."
              : "Extreme. Only automated or short-duration operations are practical.";
      hab.append(el("p", "notes", verdict));
      this.stat(hab, "Infrastructure / 1m pop", cost === 0 ? "0" : num(Math.ceil(cost * 100)));
    }
  }

  private renderMinerals(body: Body): void {
    const sec = this.section("Survey Results");
    if (!body.minerals.length) {
      sec.append(el("p", "muted", "No trans-Newtonian deposits detected."));
      return;
    }
    const table = el("div", "minerals");
    for (const dep of body.minerals) {
      const row = el("div", "mineral-row");
      row.append(el("span", "mineral-name", dep.mineral));
      row.append(el("span", "mineral-amount", compact(dep.amount)));
      const barWrap = el("span", "acc-bar");
      const bar = el("span", "acc-fill");
      bar.style.width = `${dep.accessibility * 100}%`;
      barWrap.append(bar);
      barWrap.title = `Accessibility ${dep.accessibility.toFixed(1)}`;
      row.append(barWrap);
      row.append(el("span", "mineral-acc", dep.accessibility.toFixed(1)));
      table.append(row);
    }
    sec.append(table);
    const total = body.minerals.reduce((s, d) => s + d.amount, 0);
    this.stat(sec, "Total Deposits", `${compact(total)} tons`);
  }

  private renderColony(body: Body): void {
    const colony = this.game.colonyFor(body);
    const sec = this.section("Colony");

    if (!Number.isFinite(body.colonyCost)) {
      sec.append(el("p", "muted", "This body has no surface to build on."));
      return;
    }

    if (!colony) {
      sec.append(
        el("p", "muted", `No colony on ${body.name}. Colony cost ${body.colonyCost.toFixed(2)}.`),
      );
      const btn = el("button", "primary-btn", "Establish Colony");
      btn.addEventListener("click", () => {
        this.game.foundColony(body.id, 0, {});
        this.game.emit();
      });
      sec.append(btn);
      return;
    }

    this.stat(sec, "Population", population(colony.population));
    this.stat(sec, "Colony Cost", body.colonyCost.toFixed(2));

    const required = Math.ceil(body.colonyCost * 100 * colony.population);
    if (required > 0) {
      const have = colony.installations["infrastructure"] ?? 0;
      this.stat(sec, "Infrastructure", `${num(have)} / ${num(required)}`);
    }

    const built = this.section("Installations");
    const entries = Object.entries(colony.installations).filter(([, n]) => n > 0);
    if (!entries.length) {
      built.append(el("p", "muted", "Nothing built here yet."));
    }
    for (const [id, count] of entries) {
      const type = INSTALLATION_BY_ID.get(id);
      const row = el("div", "install-row");
      row.append(el("span", "install-name", type?.name ?? id));
      row.append(el("span", "install-count", num(count)));
      built.append(row);
    }

    const build = this.section("Construction");
    build.append(
      el("p", "muted", "Prototype: installations are added instantly, with no cost or queue."),
    );
    for (const type of INSTALLATIONS) {
      const row = el("div", "build-row");
      const name = el("span", "install-name", type.name);
      name.title = `${type.blurb}  (${num(type.cost)} BP)`;
      row.append(name);
      const minus = el("button", "step-btn", "-");
      minus.addEventListener("click", () => this.game.addInstallation(body.id, type.id, -1));
      const plus = el("button", "step-btn", "+");
      plus.addEventListener("click", () => this.game.addInstallation(body.id, type.id, 1));
      const plus10 = el("button", "step-btn", "+10");
      plus10.addEventListener("click", () => this.game.addInstallation(body.id, type.id, 10));
      row.append(minus, plus, plus10);
      build.append(row);
    }

    const danger = el("button", "ghost-btn", "Abandon Colony");
    danger.addEventListener("click", () => this.game.abandonColony(body.id));
    build.append(danger);
  }
}
