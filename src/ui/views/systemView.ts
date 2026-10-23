/**
 * System screen: every planet, moon and rock in a system, in one table, with
 * the full detail panel for whichever is selected.
 *
 * The map is for looking and the tree for finding; this is for comparing -
 * which world is temperate, which has the gravity and the minerals, which is
 * worth settling next.
 */

import type { Game } from "../../state/game";
import type { Body } from "../../sim/system";
import { classLabel } from "../../sim/system";
import { isBreathable, totalPressure } from "../../sim/atmosphere";
import { effectiveColonyCost } from "../../sim/economy/production";
import { AU_KM } from "../../sim/orbit";
import { compact, distance, el, formatPressure, num, population } from "../format";
import { DetailPanel } from "../detailPanel";
import { select } from "../widgets";

const EARTH_MASS = 5.97237e24;

type Filter = "all" | "planets" | "moons" | "small" | "colonies" | "surveyed" | "unsurveyed";
type SortKey = "tree" | "atmo" | "name" | "type" | "orbit" | "mass" | "gravity" | "temp" | "cost" | "minerals";

const FILTERS: [Filter, string][] = [
  ["all", "All bodies"],
  ["planets", "Planets and dwarf planets"],
  ["moons", "Moons"],
  ["small", "Asteroids and comets"],
  ["colonies", "Colonies"],
  ["surveyed", "Surveyed"],
  ["unsurveyed", "Not yet surveyed"],
];

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Body" },
  { key: "type", label: "Type" },
  { key: "orbit", label: "Orbit", align: "right" },
  { key: "mass", label: "Mass (Earth)", align: "right" },
  { key: "gravity", label: "Gravity", align: "right" },
  { key: "temp", label: "Temp", align: "right" },
  { key: "atmo", label: "Atmosphere" },
  { key: "cost", label: "Colony cost", align: "right" },
  { key: "minerals", label: "Minerals", align: "right" },
];

export class SystemView {
  private filter: Filter = "all";
  private search = "";
  private sortKey: SortKey = "tree";
  private sortDescending = false;
  private main: HTMLElement;
  private side: HTMLElement;
  private detail: DetailPanel;

  constructor(
    private root: HTMLElement,
    private game: Game,
    actions: { zoomTo: (body: Body) => void; openEconomy: () => void; openFleets: () => void },
  ) {
    this.root.classList.add("view-system");
    this.main = el("section", "fleet-detail system-main");
    this.side = el("aside", "panel panel-right");
    this.root.append(this.main, this.side);
    this.detail = new DetailPanel(this.side, game, actions);
  }

  render(): void {
    const { game } = this;
    const { empire, galaxy, viewSystem } = game;
    this.main.textContent = "";
    this.detail.render();

    // --- header: which system, and a one-line summary
    const head = el("div", "detail-head");
    const bar = el("div", "form-actions system-bar");
    const known = galaxy.systems.filter((s) => empire.knownSystems.has(s.id));
    const systemSelect = select(
      known.map((s) => ({ value: s.id, label: s.name })),
      viewSystem.id,
      (value) => game.setViewSystem(value),
    );
    systemSelect.setAttribute("aria-label", "System");
    bar.append(systemSelect);

    const filterSelect = select(FILTERS.map(([value, label]) => ({ value, label })), this.filter, (value) => {
      this.filter = value as Filter;
      this.render();
    });
    filterSelect.setAttribute("aria-label", "Show bodies");
    bar.append(filterSelect);

    const search = el("input", "search system-search");
    search.type = "search";
    search.placeholder = "Find a body...";
    search.value = this.search;
    search.setAttribute("aria-label", "Find a body");
    search.addEventListener("input", () => {
      this.search = search.value.trim().toLowerCase();
      this.renderTable();
    });
    bar.append(search);
    head.append(el("div", "detail-title", `${viewSystem.name} system`), bar);
    this.main.append(head);

    const meta = viewSystem.meta;
    const bodies = this.visibleBodies();
    const colonies = bodies.filter((b) => empire.colonies.has(b.id)).length;
    const surveyed = bodies.filter((b) => empire.surveyed.has(b.id)).length;
    this.main.append(
      el("p", "muted small system-summary",
        `${meta.spectral} star${meta.distanceLy > 0 ? `, ${meta.distanceLy.toFixed(1)} light years from Sol` : ""}. ` +
        `${bodies.length} bodies known, ${surveyed} surveyed, ${colonies} colonised. ${meta.blurb}`),
    );

    this.table = el("div", "data-table system-table");
    this.main.append(this.table);
    this.renderTable();
  }

  private table: HTMLElement = el("div");

  /** Everything the empire knows of in the system, in orbital order. */
  private visibleBodies(): Body[] {
    const { empire, viewSystem } = this.game;
    return viewSystem.tree().filter((b) => b.cls !== "jump-point" || empire.knownJumpPoints.has(b.id));
  }

  private passes(body: Body): boolean {
    const { empire } = this.game;
    if (this.search && !body.name.toLowerCase().includes(this.search)) return false;
    switch (this.filter) {
      case "planets": return body.cls === "planet" || body.cls === "dwarf";
      case "moons": return body.cls === "moon";
      case "small": return body.cls === "asteroid" || body.cls === "comet";
      case "colonies": return empire.colonies.has(body.id);
      case "surveyed": return empire.surveyed.has(body.id);
      case "unsurveyed": return !empire.surveyed.has(body.id) && body.cls !== "star" && body.cls !== "jump-point";
      default: return true;
    }
  }

  private atmosphereText(body: Body): string {
    const total = totalPressure(body.atmosphere);
    if (body.cls === "star") return "-";
    if (total < 0.001) return "None";
    return `${isBreathable(body.atmosphere) ? "Breathable, " : ""}${formatPressure(total)} atm`;
  }

  private mineralTons(body: Body): number | null {
    if (!this.game.empire.surveyed.has(body.id)) return null;
    return body.minerals.reduce((s, d) => s + d.amount, 0);
  }

  private sortValue(body: Body, key: SortKey): number | string {
    switch (key) {
      case "name": return body.name;
      case "type": return classLabel(body);
      case "orbit": return (body.def.orbit?.a ?? 0);
      case "mass": return body.def.massKg;
      case "gravity": return body.gravity;
      case "temp": return body.tempK;
      case "atmo": return totalPressure(body.atmosphere);
      case "cost": return Number.isFinite(body.colonyCost) ? body.colonyCost : 99;
      case "minerals": return this.mineralTons(body) ?? -1;
      default: return 0;
    }
  }

  private renderTable(): void {
    const { game } = this;
    const { empire } = game;
    this.table.textContent = "";

    const header = el("div", "data-row header");
    for (const column of COLUMNS) {
      const cell = el("span", column.align === "right" ? "right sortable" : "sortable", column.label);
      if (this.sortKey === column.key) {
        cell.classList.add("sorted");
        cell.append(el("span", "sort-arrow", this.sortDescending ? " v" : " ^"));
      }
      cell.addEventListener("click", () => {
        if (this.sortKey === column.key) this.sortDescending = !this.sortDescending;
        else {
          this.sortKey = column.key;
          this.sortDescending = false;
        }
        this.renderTable();
      });
      header.append(cell);
    }
    this.table.append(header);

    let rows = this.visibleBodies().filter((b) => this.passes(b));
    if (this.sortKey !== "tree") {
      const key = this.sortKey;
      rows = [...rows].sort((a, b) => {
        const x = this.sortValue(a, key);
        const y = this.sortValue(b, key);
        const order = typeof x === "string" ? x.localeCompare(String(y)) : (x as number) - (y as number);
        return this.sortDescending ? -order : order;
      });
    }
    if (!rows.length) {
      this.table.append(el("p", "muted", "No bodies match."));
      return;
    }

    for (const body of rows) {
      const line = el("div", "data-row system-row");
      line.classList.toggle("picked", game.selected?.id === body.id);
      line.dataset.id = body.id;

      const name = el("span", "cell-name");
      const indent = this.sortKey === "tree" ? Math.min(body.depth, 3) : 0;
      name.style.paddingLeft = `${indent * 12}px`;
      const dot = el("span", "dot");
      dot.style.background = body.def.color;
      name.append(dot, el("span", undefined, body.name));
      const colony = empire.colonies.get(body.id);
      if (colony) {
        const flag = el("span", "chip good", `Colony ${population(colony.population)}`);
        name.append(flag);
      }
      line.append(name);
      line.append(el("span", undefined, classLabel(body)));

      const orbit = !body.def.orbit
        ? "-"
        : body.cls === "moon" ? `${num(body.def.orbit.a * AU_KM)} km` : distance(body.def.orbit.a);
      line.append(el("span", "right", orbit));
      line.append(el("span", "right", body.cls === "star" ? "-" : (body.def.massKg / EARTH_MASS).toPrecision(3)));
      line.append(el("span", "right", body.cls === "star" ? "-" : `${body.gravity.toFixed(2)} g`));
      line.append(el("span", "right", body.cls === "star" ? "-" : `${body.tempK.toFixed(0)} K`));
      line.append(el("span", undefined, this.atmosphereText(body)));

      const solid = body.cls !== "star" && body.cls !== "jump-point";
      const cost = effectiveColonyCost(body, empire.stats);
      const costCell = el("span", "right", !solid ? "-" : Number.isFinite(cost) ? cost.toFixed(2) : "n/a");
      if (solid && Number.isFinite(cost)) costCell.classList.add(cost <= 0 ? "good" : cost > 3 ? "bad" : "warn");
      line.append(costCell);

      const tons = this.mineralTons(body);
      line.append(el("span", "right", !solid ? "-" : tons === null ? "unsurveyed" : `${compact(tons)} t`));

      line.addEventListener("click", () => game.select(body));
      line.addEventListener("dblclick", () => game.select(body));
      this.table.append(line);
    }
  }
}
