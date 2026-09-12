/**
 * Economy view: the colony's books.
 *
 * Left is the colony list, centre is the selected colony - industry, mining,
 * stockpile and the build queue - and right is the empire summary and the
 * event log.
 */

import type { Game } from "../../state/game";
import type { Body } from "../../sim/system";
import { classLabel } from "../../sim/system";
import type { Colony } from "../../state/colony";
import { installationCount } from "../../state/colony";
import {
  CATEGORY_NAMES,
  INSTALLATIONS,
  INSTALLATION_BY_ID,
  type InstallationCategory,
} from "../../sim/economy/installations";
import {
  colonyOutput,
  effectiveColonyCost,
  migrationInflow,
  populationCapacity,
} from "../../sim/economy/production";
import { MINERALS } from "../../sim/minerals";
import { fullName, type Officer } from "../../sim/people/officers";
import { compact, el, num, population } from "../format";
import { button, emptyNote, numberInput, progressBar, section, select, stat } from "../widgets";

export class EconomyView {
  private list: HTMLElement;
  private detail: HTMLElement;
  private side: HTMLElement;
  private orderInstallation = "automated-mine";
  private orderQuantity = 1;
  private orderDestination = "";

  constructor(private root: HTMLElement, private game: Game) {
    this.root.classList.add("view-economy");
    this.list = el("aside", "panel panel-left");
    this.detail = el("section", "colony-detail");
    this.side = el("aside", "panel panel-right");
    this.root.append(this.list, this.detail, this.side);
  }

  render(): void {
    this.renderColonyList();
    this.renderColony();
    this.renderEmpire();
  }

  // ------------------------------------------------------------- colonies

  private renderColonyList(): void {
    const { game } = this;
    this.list.textContent = "";
    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Colonies"));
    head.append(el("span", "muted", `${game.empire.colonies.size}`));
    this.list.append(head);

    const rows = el("div", "tree");
    for (const colony of game.empire.colonies.values()) {
      const body = game.system.byId.get(colony.bodyId);
      if (!body) continue;
      const row = el("div", "tree-row");
      row.classList.toggle("selected", game.selected?.id === body.id);

      const dot = el("span", "dot");
      dot.style.background = body.def.color;
      row.append(dot, el("span", "tree-name", body.name));
      row.append(el("span", "tree-meta", population(colony.population)));
      if (colony.buildQueue.length) {
        const flag = el("span", "colony-flag", "B");
        flag.title = `${colony.buildQueue.length} item(s) in the build queue`;
        row.append(flag);
      }
      row.addEventListener("click", () => game.select(body));
      rows.append(row);
    }
    this.list.append(rows);
  }

  private renderColony(): void {
    const { game } = this;
    this.detail.textContent = "";

    const body = game.selected;
    if (!body) {
      emptyNote(this.detail, "Select a colony.");
      return;
    }
    const colony = game.empire.colony(body.id);
    if (!colony) {
      this.renderNoColony(body);
      return;
    }

    const stats = game.empire.stats;
    const output = colonyOutput(game.empire, body, colony, stats);
    const cost = effectiveColonyCost(body, colony, stats);
    const capacity = populationCapacity(body, colony, stats);

    const head = el("div", "detail-head");
    const title = el("div", "detail-title", body.name);
    const dot = el("span", "dot big");
    dot.style.background = body.def.color;
    title.prepend(dot);
    head.append(title);
    head.append(
      el("div", "detail-sub", `${classLabel(body)} - settled ${formatShortDate(colony.founded)}`),
    );
    this.detail.append(head);

    const scroll = el("div", "detail-body");
    this.detail.append(scroll);

    // --- summary
    const summary = section(scroll, "Colony");
    summary.classList.add("two-col");
    stat(summary, "Population", population(colony.population));
    stat(summary, "Supported Population", capacity > 0 ? population(capacity) : "none");
    stat(summary, "Annual Growth", `${output.populationGrowth >= 0 ? "+" : ""}${population(output.populationGrowth)}`,
      output.populationGrowth >= 0 ? "good" : "bad");
    stat(summary, "Colony Cost", cost.toFixed(2) + (colony.terraformed > 0 ? `  (base ${body.colonyCost.toFixed(2)})` : ""));
    stat(
      summary,
      "Workforce",
      `${population(Math.min(colony.population, output.workersRequired))} / ${population(output.workersRequired)}`,
      output.employment < 0.999 ? "warn" : undefined,
    );
    stat(summary, "Wealth", `${num(output.wealth)} / year`);
    const inflow = migrationInflow(game.empire, body, colony);
    if (inflow > 0) {
      const row = stat(summary, "Colonists Arriving", `${population(inflow)} / year`, "good");
      row.title = "Civilian shipping from the capital - a stand-in until colony ships exist.";
    }

    this.renderGovernor(scroll, colony);
    this.renderIndustry(scroll, colony, output.buildPoints);
    this.renderMining(scroll, body, colony, output.mining);
    this.renderStockpile(scroll, colony);
    this.renderInstallations(scroll, colony);
  }

  private renderNoColony(body: Body): void {
    const head = el("div", "detail-head");
    head.append(el("div", "detail-title", body.name));
    head.append(el("div", "detail-sub", classLabel(body)));
    this.detail.append(head);

    const scroll = el("div", "detail-body");
    const sec = section(scroll, "No Colony");
    const cost = effectiveColonyCost(body, undefined, this.game.empire.stats);
    if (!Number.isFinite(cost)) {
      emptyNote(sec, "This body has no surface to build on.");
    } else {
      emptyNote(sec, `Colony cost ${cost.toFixed(2)}. A colony can be established here.`);
      sec.append(
        button(
          "Establish Colony",
          () => {
            this.game.empire.foundColony(body.id, this.game.clock.seconds);
            this.game.empire.addLog(
              this.game.clock.seconds,
              "colony",
              `A colony has been established on ${body.name}.`,
            );
            this.game.emit();
          },
          "primary-btn",
        ),
      );
    }
    this.detail.append(scroll);
  }

  private renderGovernor(parent: HTMLElement, colony: Colony): void {
    const { empire } = this.game;
    const sec = section(parent, "Governor");
    const current = empire.governorOf(colony.bodyId);

    const options = [
      { value: "", label: "- vacant -" },
      ...empire.officers
        .byBranch("civilian")
        .filter((o) => !o.assignment || o.assignment.targetId === colony.bodyId)
        .map((o) => ({ value: o.id, label: `${fullName(o)}  ${skillTag(o)}` })),
    ];
    sec.append(
      select(options, current?.id ?? "", (value) => {
        if (current && value !== current.id) empire.assignOfficer(current.id, null);
        if (value) {
          empire.assignOfficer(value, {
            kind: "governor",
            targetId: colony.bodyId,
            since: this.game.clock.seconds,
          });
        }
        this.game.emit();
      }),
    );

    if (current) {
      const bonuses = el("div", "bonus-row");
      for (const [skill, label] of [
        ["production", "Production"],
        ["mining", "Mining"],
        ["wealth", "Wealth"],
        ["populationGrowth", "Growth"],
      ] as const) {
        const value = current.skills[skill] ?? 0;
        if (!value) continue;
        const chip = el("span", `chip ${value > 0 ? "good" : "bad"}`, `${label} ${value > 0 ? "+" : ""}${value}%`);
        bonuses.append(chip);
      }
      sec.append(bonuses);
    }
  }

  private renderIndustry(parent: HTMLElement, colony: Colony, buildPoints: number): void {
    const { empire } = this.game;
    const sec = section(parent, "Industry");
    stat(sec, "Construction Factories", num(installationCount(colony, "construction-factory")));
    stat(sec, "Output Capacity", `${num(buildPoints)} BP / year`, empire.austerity ? "bad" : undefined);
    if (empire.austerity) {
      emptyNote(sec, "Treasury in deficit - industrial output is halved.");
    }

    const queue = section(parent, "Build Queue");
    if (!colony.buildQueue.length) {
      emptyNote(queue, "Nothing queued.");
    }
    for (const order of colony.buildQueue) {
      const type = INSTALLATION_BY_ID.get(order.installationId);
      if (!type) continue;
      const row = el("div", "queue-row");
      const destination = order.destination
        ? this.game.system.byId.get(order.destination)?.name ?? order.destination
        : null;
      const name = el(
        "span",
        "queue-name",
        `${type.name} x${num(order.quantity)}${destination ? ` -> ${destination}` : ""}`,
      );
      name.title = type.blurb;
      row.append(name);

      const remaining = order.quantity * type.cost - order.progress;
      const years = buildPoints > 0 ? remaining / buildPoints : Infinity;
      row.append(progressBar(order.progress / type.cost));
      row.append(
        el(
          "span",
          `queue-eta${order.starved ? " bad" : ""}`,
          order.starved ? "no minerals" : Number.isFinite(years) ? formatYears(years) : "stalled",
        ),
      );

      row.append(button("^", () => this.move(colony, order.id, -1), "step-btn"));
      row.append(button("v", () => this.move(colony, order.id, 1), "step-btn"));
      row.append(button("x", () => this.cancel(colony, order.id), "step-btn"));
      queue.append(row);
    }

    // --- add an order
    const add = el("div", "add-order");
    const options = INSTALLATIONS.filter((i) => empire.stats.unlocked.has(i.id)).map((i) => ({
      value: i.id,
      label: `${i.name}  (${num(i.cost)} BP)`,
    }));
    if (!options.some((o) => o.value === this.orderInstallation)) {
      this.orderInstallation = options[0]?.value ?? "";
    }
    add.append(
      select(options, this.orderInstallation, (value) => {
        this.orderInstallation = value;
        this.render();
      }),
    );
    add.append(numberInput(this.orderQuantity, (value) => (this.orderQuantity = value)));
    // Anything built here can be shipped to another colony on completion -
    // the stand-in for freighters.
    const destinations = [
      { value: "", label: "keep here" },
      ...[...empire.colonies.values()]
        .filter((c) => c.bodyId !== colony.bodyId)
        .map((c) => ({
          value: c.bodyId,
          label: `ship to ${this.game.system.byId.get(c.bodyId)?.name ?? c.bodyId}`,
        })),
    ];
    add.append(
      select(destinations, this.orderDestination, (value) => {
        this.orderDestination = value;
      }),
    );
    add.append(
      button(
        "Add",
        () => {
          empire.queueBuild(
            colony.bodyId,
            this.orderInstallation,
            this.orderQuantity,
            this.orderDestination || null,
          );
          this.game.emit();
        },
        "primary-btn",
      ),
    );
    queue.append(add);

    const type = INSTALLATION_BY_ID.get(this.orderInstallation);
    if (type) {
      const cost = Object.entries(type.minerals)
        .map(([mineral, tons]) => `${mineral} ${num(tons * this.orderQuantity)}`)
        .join(", ");
      const note = el("p", "muted small", `${type.blurb}`);
      queue.append(note);
      queue.append(
        el("p", "muted small", `Cost: ${num(type.cost * this.orderQuantity)} BP  -  ${cost || "no minerals"}`),
      );
    }
  }

  private renderMining(
    parent: HTMLElement,
    body: Body,
    colony: Colony,
    mining: Partial<Record<string, number>>,
  ): void {
    const { empire } = this.game;
    const sec = section(parent, "Mining");
    stat(sec, "Mines", num(installationCount(colony, "mine")));
    stat(sec, "Automated Mines", num(installationCount(colony, "automated-mine")));

    if (!body.minerals.length) {
      emptyNote(sec, "No deposits on this body.");
    } else {
      const table = el("div", "mineral-table");
      const header = el("div", "mineral-head");
      header.append(el("span", undefined, "Deposit"));
      header.append(el("span", undefined, "Remaining"));
      header.append(el("span", undefined, "Acc"));
      header.append(el("span", undefined, "Per year"));
      header.append(el("span", undefined, "Depleted"));
      table.append(header);

      for (const deposit of body.minerals) {
        const rate = mining[deposit.mineral] ?? 0;
        const row = el("div", "mineral-line");
        row.append(el("span", undefined, deposit.mineral));
        row.append(el("span", "right", compact(deposit.amount)));
        row.append(el("span", "right", deposit.accessibility.toFixed(1)));
        row.append(el("span", "right", rate > 0 ? num(rate) : "-"));
        row.append(
          el("span", "right muted", rate > 0 ? formatYears(deposit.amount / rate) : "-"),
        );
        if (deposit.amount <= 0) row.classList.add("depleted");
        table.append(row);
      }
      sec.append(table);
    }

    const drivers = installationCount(colony, "mass-driver");
    if (drivers > 0) {
      stat(sec, "Mass Drivers", `${num(drivers)}  (${num(drivers * empire.stats.massDriverThroughput)} tons/year)`);
      const targets = [
        { value: "", label: "- hold minerals here -" },
        ...[...empire.colonies.values()]
          .filter((c) => c.bodyId !== colony.bodyId)
          .map((c) => ({
            value: c.bodyId,
            label: this.game.system.byId.get(c.bodyId)?.name ?? c.bodyId,
          })),
      ];
      const row = el("div", "stat");
      row.append(el("span", "stat-label", "Shipping To"));
      row.append(
        select(targets, colony.massDriverTarget ?? "", (value) => {
          colony.massDriverTarget = value || null;
          this.game.emit();
        }),
      );
      sec.append(row);
    }
  }

  private renderStockpile(parent: HTMLElement, colony: Colony): void {
    const sec = section(parent, "Stockpile");
    const grid = el("div", "stock-grid");
    for (const mineral of MINERALS) {
      const amount = colony.stockpile[mineral];
      const cell = el("div", `stock-cell${amount <= 0 ? " empty" : ""}`);
      cell.append(el("span", "stock-name", mineral));
      cell.append(el("span", "stock-value", compact(amount)));
      grid.append(cell);
    }
    sec.append(grid);
    stat(sec, "Fuel", `${compact(colony.fuel)} litres`);
  }

  private renderInstallations(parent: HTMLElement, colony: Colony): void {
    const sec = section(parent, "Installations");
    const entries = Object.entries(colony.installations).filter(([, n]) => n > 0);
    if (!entries.length) {
      emptyNote(sec, "Nothing built here yet.");
      return;
    }
    const byCategory = new Map<InstallationCategory, [string, number][]>();
    for (const [id, count] of entries) {
      const type = INSTALLATION_BY_ID.get(id);
      if (!type) continue;
      const list = byCategory.get(type.category) ?? [];
      list.push([type.name, count]);
      byCategory.set(type.category, list);
    }
    for (const [category, list] of byCategory) {
      sec.append(el("div", "sub-head", CATEGORY_NAMES[category]));
      for (const [name, count] of list) {
        const row = el("div", "install-row");
        row.append(el("span", "install-name", name));
        row.append(el("span", "install-count", num(count)));
        sec.append(row);
      }
    }
  }

  // --------------------------------------------------------------- empire

  private renderEmpire(): void {
    const { empire } = this.game;
    this.side.textContent = "";
    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Empire"));
    this.side.append(head);

    const body = el("div", "detail-body");
    this.side.append(body);

    const snap = empire.snapshot;
    const finance = section(body, "Treasury");
    stat(finance, "Balance", num(empire.treasury), empire.treasury < 0 ? "bad" : "good");
    stat(finance, "Income", `${num(snap.income)} / year`);
    stat(finance, "Expenditure", `${num(snap.expenses)} / year`);
    stat(
      finance,
      "Net",
      `${snap.income - snap.expenses >= 0 ? "+" : ""}${num(snap.income - snap.expenses)} / year`,
      snap.income - snap.expenses >= 0 ? "good" : "bad",
    );

    const out = section(body, "Output");
    stat(out, "Population", population(snap.population));
    stat(out, "Construction Used", `${num(snap.buildPoints)} BP / year`);
    stat(out, "Research", `${num(snap.researchPoints)} RP / year`);
    stat(out, "Fuel", `${compact(snap.fuel)} litres / year`);
    const totalMinerals = Object.values(snap.minerals).reduce((s, v) => s + (v ?? 0), 0);
    stat(out, "Mining", `${num(totalMinerals)} tons / year`);

    const log = section(body, "Events");
    if (!empire.log.length) emptyNote(log, "Nothing has happened yet.");
    for (const entry of empire.log.slice(0, 60)) {
      const row = el("div", `log-row log-${entry.category}`);
      row.append(el("span", "log-date", formatShortDate(entry.time)));
      row.append(el("span", "log-text", entry.text));
      log.append(row);
    }
  }

  private move(colony: Colony, orderId: string, delta: number): void {
    this.game.empire.moveOrder(colony.bodyId, orderId, delta);
    this.game.emit();
  }

  private cancel(colony: Colony, orderId: string): void {
    this.game.empire.cancelOrder(colony.bodyId, orderId);
    this.game.emit();
  }
}

function skillTag(officer: Officer): string {
  const best = Object.entries(officer.skills)
    .filter(([skill]) => skill !== "administration")
    .sort((a, b) => b[1] - a[1])[0];
  return best ? `(${best[0]} ${best[1] > 0 ? "+" : ""}${best[1]}%)` : "";
}

export function formatYears(years: number): string {
  if (!Number.isFinite(years)) return "never";
  if (years >= 100) return "100+ yr";
  if (years >= 1) return `${years.toFixed(1)} yr`;
  const days = years * 365.25;
  if (days >= 30) return `${(days / 30.44).toFixed(1)} mo`;
  return `${Math.max(1, Math.round(days))} d`;
}

export function formatShortDate(seconds: number): string {
  const date = new Date(Date.UTC(2000, 0, 1, 12) + seconds * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
