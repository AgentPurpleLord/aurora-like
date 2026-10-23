/** Right-hand body detail panel - the "open up a planet" view. */

import type { Game } from "../state/game";
import { classLabel, orbitSummary, type Body } from "../sim/system";
import { settleBlocker } from "../sim/exploration";
import { INSTALLATION_BY_ID } from "../sim/economy/installations";
import {
  colonyOutput,
  effectiveColonyCost,
  populationCapacity,
} from "../sim/economy/production";
import { fullName } from "../sim/people/officers";
import {
  GAS_BY_ID,
  isBreathable,
  maxPressureFor,
  toxicGases,
  totalPressure,
} from "../sim/atmosphere";
import { formatPressure } from "./format";
import {
  destinationOf,
  fleetEta,
  fleetStats,
  type Fleet,
} from "../sim/ships/fleet";
import { formatYears } from "./views/economyView";
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
    private actions: {
      zoomTo: (body: Body) => void;
      openEconomy: () => void;
      openFleets: () => void;
    },
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

    const fleet = this.game.empire.fleets.get(this.game.selectedFleet ?? "");
    if (fleet) {
      this.renderFleetCard(fleet);
      if (!body) return;
    }

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
    zoom.addEventListener("click", () => this.actions.zoomTo(body));
    this.header.append(zoom);
    this.renderContextActions(body);

    if (body.cls === "jump-point") {
      this.renderJumpPoint(body);
      return;
    }

    switch (this.tab) {
      case "overview": this.renderOverview(body); break;
      case "environment": this.renderEnvironment(body); break;
      case "minerals": this.renderMinerals(body); break;
      case "colony": this.renderColony(body); break;
    }
  }

  /**
   * What can be done to this body right now. The buttons that appear depend on
   * what is selected: a body, and perhaps a fleet.
   */
  private renderContextActions(body: Body): void {
    const { game } = this;
    const { empire } = game;
    const actions = el("div", "context-actions");
    const colony = empire.colony(body.id);
    const fleet = empire.fleets.get(game.selectedFleet ?? "");

    if (colony) {
      actions.append(this.action("Open colony", () => this.actions.openEconomy()));
    } else if (Number.isFinite(body.colonyCost)) {
      const blocked = settleBlocker(empire, game.galaxy, body);
      const settle = this.action("Settle here", () => {
          empire.foundColony(body.id, game.clock.seconds);
          empire.addLog(game.clock.seconds, "colony", `A colony has been established on ${body.name}.`, {
            view: "colonies",
            bodyId: body.id,
          });
          game.emit();
        });
      if (blocked) {
        settle.disabled = true;
        settle.title = blocked;
      }
      actions.append(settle);
    }

    if (fleet && body.cls === "jump-point" && empire.knownJumpPoints.has(body.id)) {
      const fs = fleetStats(empire, fleet);
      const gated = empire.gates.has(body.id);
      const canJump = gated || fs.jumpCapacity >= fs.tons;
      const cross = this.action(`Send ${fleet.name} through`, () => {
        if (fleet.anchorId !== body.id) fleet.orders.push({ kind: "move", bodyId: body.id });
        fleet.orders.push({ kind: "jump" });
        game.emit();
      });
      if (!canJump) {
        cross.disabled = true;
        cross.title = "No jump drive rated for this fleet, and no gate here.";
      }
      actions.append(cross);
      if (fs.gateRate > 0 && empire.exploredJumpPoints.has(body.id) && !gated) {
        actions.append(
          this.action(`Build a gate with ${fleet.name}`, () => {
            if (fleet.anchorId !== body.id) fleet.orders.push({ kind: "move", bodyId: body.id });
            fleet.orders.push({ kind: "build-gate" });
            game.emit();
          }),
        );
      }
    } else if (fleet && body.cls !== "star") {
      actions.append(
        this.action(`Send ${fleet.name} here`, () => {
          fleet.orders.push({ kind: "move", bodyId: body.id });
          game.emit();
        }),
      );
      const canSurvey = fleetStats(empire, fleet).canSurvey;
      if (canSurvey && !empire.surveyed.has(body.id)) {
        actions.append(
          this.action(`Survey with ${fleet.name}`, () => {
            fleet.orders.push({ kind: "move", bodyId: body.id }, { kind: "survey" });
            game.emit();
          }),
        );
      }
    }
    if (actions.childElementCount) this.header.append(actions);
  }

  /** What is known about a jump point: where it leads, and whether it is gated. */
  private renderJumpPoint(body: Body): void {
    const { galaxy } = this.game;
    const { empire } = this.game;
    const sec = this.section("Jump point");
    const far = galaxy.otherEnd(body.id);
    const explored = empire.exploredJumpPoints.has(body.id);
    const where = explored && far ? galaxy.systemById.get(far.systemId)?.name ?? "?" : "Unexplored";
    this.stat(sec, "Leads to", where);
    this.stat(sec, "Status", empire.gates.has(body.id) ? "Stabilised gate: open to every ship" : "Unstable: jump drives only");
    const here = galaxy.systemById.get(body.systemId);
    if (here) this.stat(sec, "In system", here.name);
    this.stat(sec, "Distance from star", distance(Math.hypot(body.world.x, body.world.y, body.world.z)));
    sec.append(
      el(
        "p",
        "notes",
        explored
          ? "A ship with jump drives rated for the whole fleet can cross, and a gate lets any ship through."
          : "Nobody has been through this one yet. Send a fleet with jump drives to see where it leads.",
      ),
    );
  }

  private action(label: string, run: () => void): HTMLButtonElement {
    const btn = el("button", "ghost-btn context-btn", label);
    btn.addEventListener("click", run);
    return btn;
  }

  /** A compact read-out for the fleet picked on the map. */
  private renderFleetCard(fleet: Fleet): void {
    const { game } = this;
    const stats = fleetStats(game.empire, fleet);
    const card = el("div", "fleet-card");

    const title = el("div", "detail-title", fleet.name);
    card.append(title);

    const destination = destinationOf(fleet);
    const eta = fleetEta(game.empire, game.galaxy, fleet);
    const where = fleet.anchorId
      ? `At ${game.galaxy.byId.get(fleet.anchorId)?.name ?? fleet.anchorId}`
      : destination
        ? `To ${game.galaxy.byId.get(destination)?.name ?? destination}${
            eta !== null ? ` - ${formatYears(eta / (365.25 * 86400))}` : ""
          }`
        : "In deep space";
    card.append(el("div", "detail-sub", where));

    const stripe = el("div", "fleet-card-stats");
    stripe.append(el("span", undefined, `${stats.ships} ship${stats.ships === 1 ? "" : "s"}`));
    stripe.append(el("span", undefined, `${num(stats.speed)} km/s`));
    stripe.append(el("span", stats.fuel <= 0 ? "bad" : undefined, `${compact(stats.fuel)} l`));
    card.append(stripe);
    if (fleet.note) card.append(el("div", "project-warning", fleet.note));
    card.append(
      el("p", "muted small", "Right-click a body on the map to send this fleet there."),
    );

    const hidden = game.galaxy.jumpPointsIn(fleet.systemId).filter((b) => !game.empire.knownJumpPoints.has(b.id));
    if (stats.gravRate > 0 && hidden.length && fleet.anchorId) {
      const search = el("button", "ghost-btn", `Search for jump points (${hidden.length} unfound)`);
      search.addEventListener("click", () => {
        fleet.orders.push({ kind: "gravsurvey" });
        game.emit();
      });
      card.append(search);
    }

    const actions = el("div", "form-actions");
    const open = el("button", "ghost-btn", "Open in Fleets");
    open.addEventListener("click", () => this.actions.openFleets());
    const clear = el("button", "ghost-btn", "Deselect");
    clear.addEventListener("click", () => this.game.selectFleet(null));
    actions.append(open, clear);
    card.append(actions);

    this.header.append(card);
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
    const home = this.game.galaxy.systemById.get(body.systemId);
    const star = home?.root;
    const earth = this.game.galaxy.byId.get("earth");
    if (star && star !== body) {
      this.stat(nav, `Distance from ${star.name}`, distance(this.game.galaxy.distance(body, star)));
    }
    if (earth && earth !== body && earth.systemId === body.systemId) {
      const d = this.game.galaxy.distance(body, earth);
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
    const observed = body.def.tempK ?? 0;
    this.stat(env, "Temperature", `${kelvinToCelsius(body.tempK)}  (${body.tempK.toFixed(0)} K)`);
    if (Math.abs(body.tempK - observed) > 0.5) {
      // Only worth saying once someone has changed the air.
      this.stat(
        env,
        "Before Terraforming",
        `${kelvinToCelsius(observed)}  (${observed} K)`,
      );
    }
    this.stat(env, "Day Length", dayLength(body.def.rotationDays));
    if (body.cls !== "star") {
      this.stat(env, "Surface Gravity", `${body.gravity.toFixed(3)} g`);
    }

    const atmo = this.section("Atmosphere");
    const pressure = totalPressure(body.atmosphere);
    if (pressure <= 0) {
      this.stat(atmo, "Pressure", "None - vacuum");
    } else {
      this.stat(atmo, "Pressure", `${formatPressure(pressure)} atm`);
      this.stat(atmo, "Breathable", isBreathable(body.atmosphere) ? "Yes" : "No");
      const table = el("div", "gas-table");
      for (const [id, partial] of Object.entries(body.atmosphere).sort((a, b) => b[1] - a[1])) {
        if (partial <= 0) continue;
        const gas = GAS_BY_ID.get(id);
        const toxic = gas?.toxicAbove !== undefined && partial > gas.toxicAbove;
        const row = el("div", `gas-row${toxic ? " bad" : ""}`);
        row.append(el("span", undefined, gas?.name ?? id));
        row.append(el("span", "right", `${formatPressure(partial)} atm`));
        row.append(
          el("span", "right muted", `${((partial / pressure) * 100).toFixed(1)}%`),
        );
        table.append(row);
      }
      atmo.append(table);
      const toxins = toxicGases(body.atmosphere);
      if (toxins.length) {
        atmo.append(
          el("p", "notes bad",
            `Unsafe: ${toxins.map((t) => t.gas.name).join(", ")}. Colonists need sealed habitats.`),
        );
      }
    }

    const hab = this.section("Habitability");
    const cost = effectiveColonyCost(body, this.game.empire.stats);
    if (Number.isFinite(cost) && Math.abs(cost - body.colonyCost) > 0.001) {
      this.stat(hab, "Unmodified Colony Cost", body.colonyCost.toFixed(2));
    }
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
      this.stat(hab, "Maximum Pressure", `${formatPressure(maxPressureFor(body.gravity))} atm`);
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
    const { empire } = this.game;
    const colony = empire.colony(body.id);
    const sec = this.section("Colony");

    if (!Number.isFinite(body.colonyCost)) {
      sec.append(el("p", "muted", "This body has no surface to build on."));
      return;
    }

    if (!colony) {
      const cost = effectiveColonyCost(body, empire.stats);
      sec.append(el("p", "muted", `No colony on ${body.name}. Colony cost ${cost.toFixed(2)}.`));
      const blocked = settleBlocker(empire, this.game.galaxy, body);
      const btn = el("button", "primary-btn", "Establish Colony");
      if (blocked) {
        btn.disabled = true;
        sec.append(el("p", "project-warning", blocked));
      }
      btn.addEventListener("click", () => {
        empire.foundColony(body.id, this.game.clock.seconds);
        empire.addLog(
          this.game.clock.seconds,
          "colony",
          `A colony has been established on ${body.name}.`,
        );
        this.game.emit();
      });
      sec.append(btn);
      return;
    }

    const output = colonyOutput(empire, body, colony, empire.stats);
    const capacity = populationCapacity(body, colony, empire.stats);
    const governor = empire.governorOf(body.id);

    this.stat(sec, "Population", population(colony.population));
    this.stat(sec, "Supported Population", capacity > 0 ? population(capacity) : "none");
    this.stat(
      sec,
      "Annual Growth",
      `${output.populationGrowth >= 0 ? "+" : ""}${population(output.populationGrowth)}`,
    );
    this.stat(sec, "Colony Cost", effectiveColonyCost(body, empire.stats).toFixed(2));
    this.stat(sec, "Governor", governor ? fullName(governor) : "vacant");
    this.stat(
      sec,
      "Workforce",
      `${Math.round(output.employment * 100)}% staffed`,
    );

    const industry = this.section("Output");
    this.stat(industry, "Construction", `${num(output.buildPoints)} BP / year`);
    this.stat(industry, "Research", `${num(output.researchPoints)} RP / year`);
    this.stat(industry, "Wealth", `${num(output.wealth)} / year`);
    const mined = Object.values(output.mining).reduce((sum, v) => sum + (v ?? 0), 0);
    this.stat(industry, "Mining", `${num(mined)} tons / year`);

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

    const queue = this.section("Build Queue");
    if (!colony.buildQueue.length) {
      queue.append(el("p", "muted", "Nothing queued."));
    }
    for (const order of colony.buildQueue) {
      const type = INSTALLATION_BY_ID.get(order.installationId);
      if (!type) continue;
      const row = el("div", "install-row");
      row.append(el("span", "install-name", `${type.name} x${num(order.quantity)}`));
      row.append(
        el(
          "span",
          `install-count${order.starved ? " bad" : ""}`,
          order.starved ? "no minerals" : `${Math.round((order.progress / type.cost) * 100)}%`,
        ),
      );
      queue.append(row);
    }

    const manage = el("button", "primary-btn", "Manage in Economy View");
    manage.addEventListener("click", () => this.actions.openEconomy());
    queue.append(manage);
  }
}
