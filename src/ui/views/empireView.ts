/**
 * Empire dashboard - the landing view.
 *
 * Answers the questions that used to require visiting every colony in turn:
 * how is each colony doing, what is the empire running out of, what is being
 * researched, and what happened while the clock was running.
 */

import type { Game } from "../../state/game";
import { colonyRows, mineralLedger, type ColonyRow, type LedgerRow } from "../../sim/economy/ledger";
import { TECH_BY_ID } from "../../sim/research/techs";
import { fullName } from "../../sim/people/officers";
import { installationCount } from "../../state/colony";
import { projectRate } from "../../sim/economy/production";
import { resolveTemplate } from "../../sim/economy/templates";
import { INSTALLATION_BY_ID } from "../../sim/economy/installations";
import { compact, el, num, population, populationFixed, themed } from "../format";
import { hintFor } from "../glossary";
import { deriveGoals } from "../../sim/goals";
import { saveSettings, settings } from "../settings";
import type { HistoryPoint, LogLink } from "../../state/empire";
import { button, emptyNote, numberInput, progressBar, section, select, stat } from "../widgets";
import { GOODS, computeMarket } from "../../sim/economy/goods";
import { budgetOf } from "../../sim/economy/budget";
import {
  MAX_TAX, MAX_WELFARE, NEUTRAL_TAX, PROGRAMMES, activeProgramme, buyProgramme, programmeCost, stabilityLabel,
} from "../../sim/economy/finance";
import { formatShortDate, formatYears } from "./economyView";

type SortKey = keyof Pick<
  ColonyRow,
  "population" | "growth" | "employment" | "buildPoints" | "researchPoints" | "wealth" | "mining" | "nextCompletion"
> | "name";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Colony" },
  { key: "population", label: "Population", align: "right" },
  { key: "growth", label: "Growth/yr", align: "right" },
  { key: "employment", label: "Staffed", align: "right" },
  { key: "buildPoints", label: "BP/yr", align: "right" },
  { key: "mining", label: "Mining t/yr", align: "right" },
  { key: "researchPoints", label: "RP/yr", align: "right" },
  { key: "wealth", label: "Wealth/yr", align: "right" },
  { key: "nextCompletion", label: "Next build", align: "right" },
];

export class EmpireView {
  private sortKey: SortKey = "population";
  private sortDescending = true;
  /** Colonies ticked for a bulk action. */
  private selected = new Set<string>();
  private bulkTemplate = "mining-outpost";
  private bulkSource = "";

  constructor(
    private root: HTMLElement,
    private game: Game,
    private onOpenColony: (bodyId: string) => void,
    private navigate: (link: LogLink) => void,
    private openDigest: () => void = () => {},
  ) {
    this.root.classList.add("view-empire");
  }

  render(): void {
    this.root.textContent = "";
    const body = el("div", "dashboard");
    this.root.append(body);

    this.renderSinceStrip(body);
    this.renderGuide(body);
    this.renderTrends(body);
    this.renderColonies(body);

    // Two columns: the wide ledger on the left, the smaller panels stacked
    // beside it. Three equal columns let the ledger spill into its neighbour.
    const split = el("div", "dashboard-split");
    body.append(split);
    this.renderLedger(split);
    const stack = el("div", "dashboard-stack");
    split.append(stack);
    this.renderFinance(stack);
    this.renderGoods(stack);
    this.renderResearch(stack);
    this.renderLogistics(stack);

    this.renderEvents(body);
  }

  /**
   * What changed since the player last looked. At thirty days a second it is
   * easy to skip five years; this is how you find out what happened in them.
   */
  private renderSinceStrip(parent: HTMLElement): void {
    const { empire } = this.game;
    const mark = empire.reviewMark;
    const now = this.game.clock.seconds;
    if (now <= mark.time) return;

    const since = empire.log.filter((entry) => entry.time > mark.time);
    const strip = el("div", "since-strip");
    strip.append(
      el("span", "since-label", `Since ${formatShortDate(mark.time)}`),
    );

    const currentPopulation = [...empire.colonies.values()].reduce((sum, c) => sum + c.population, 0);
    const items: [string, string, string?][] = [
      ["Population", `${currentPopulation >= mark.population ? "+" : ""}${population(currentPopulation - mark.population)}`, currentPopulation >= mark.population ? "good" : "bad"],
      ["Treasury", `${empire.treasury >= mark.treasury ? "+" : ""}${num(empire.treasury - mark.treasury)}`, empire.treasury >= mark.treasury ? "good" : "bad"],
      ["Technologies", `+${empire.researched.size - mark.techs}`],
      ["Construction", String(since.filter((e) => e.category === "construction").length)],
      ["Personnel", String(since.filter((e) => e.category === "people").length)],
    ];
    for (const [label, value, tone] of items) {
      const item = el("div", "since-item");
      item.append(el("span", "since-item-label", label));
      item.append(el("span", `since-item-value${tone ? ` ${tone}` : ""}`, value));
      strip.append(item);
    }

    strip.append(button("Open digest", () => this.openDigest()));
    const mark_ = el("button", "ghost-btn", "Mark reviewed");
    mark_.addEventListener("click", () => {
      empire.markReviewed(this.game.clock.seconds);
      this.render();
    });
    strip.append(mark_);
    parent.append(strip);
  }

  // ----------------------------------------------------------------- guide

  /** The next few things worth doing, derived from where the empire stands. */
  private renderGuide(parent: HTMLElement): void {
    if (!settings.guide) return;
    const goals = deriveGoals(this.game.empire, this.game.galaxy);
    const remaining = goals.filter((g) => !g.done);
    if (!remaining.length) return;

    const done = goals.length - remaining.length;
    const card = el("div", "guide-card");
    const head = el("div", "guide-head");
    head.append(themed("Suggested next steps", "Mission objectives", "guide-title"));
    head.append(el("span", "muted small", `${done} of ${goals.length} done`));
    head.append(progressBar(done / goals.length));
    const hide = el("button", "ghost-btn guide-hide", "Hide");
    hide.title = "Hide this list. It can be brought back from Settings.";
    hide.addEventListener("click", () => {
      settings.guide = false;
      saveSettings();
      this.render();
    });
    head.append(hide);
    card.append(head);

    for (const goal of remaining.slice(0, 3)) {
      const row = el("div", "guide-row");
      const text = el("div", "guide-text");
      text.append(el("div", "guide-goal", goal.title), el("div", "muted small", goal.detail));
      row.append(text);
      row.append(button(goal.action.label, () => this.navigate(goal.action.link), "ghost-btn"));
      card.append(row);
    }
    parent.append(card);
  }

  // ----------------------------------------------------------------- trends

  /** Four vital signs with a line showing where each has been. */
  private renderTrends(parent: HTMLElement): void {
    const { empire } = this.game;
    const history = empire.history.slice(-72);
    const row = el("div", "trend-row");

    const tiles: {
      label: string;
      value: string;
      pick: (p: HistoryPoint) => number;
      format: (v: number) => string;
      current: number;
    }[] = [
      { label: "Population", value: population(empire.snapshot.population), pick: (p) => p.population, format: (v) => population(Math.abs(v)), current: empire.snapshot.population },
      { label: "Treasury", value: num(empire.treasury), pick: (p) => p.treasury, format: (v) => num(Math.abs(v)), current: empire.treasury },
      { label: "Research", value: `${num(empire.snapshot.researchPoints)} RP/yr`, pick: (p) => p.researchPoints, format: (v) => num(Math.abs(v)), current: empire.snapshot.researchPoints },
      { label: "Construction", value: `${num(empire.snapshot.buildPoints)} BP/yr`, pick: (p) => p.buildPoints, format: (v) => num(Math.abs(v)), current: empire.snapshot.buildPoints },
    ];

    for (const tile of tiles) {
      const card = el("div", "trend-tile");
      card.append(el("span", "trend-label", tile.label), el("span", "trend-value", tile.value));

      const series = history.map(tile.pick);
      if (series.length >= 2) {
        // Compare with roughly a year ago, or the start if the game is younger.
        const yearAgo = empire.history.find((p) => p.time >= this.game.clock.seconds - 365.25 * 86_400) ?? empire.history[0];
        const delta = tile.current - tile.pick(yearAgo);
        const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
        const period = this.game.clock.seconds - yearAgo.time >= 330 * 86_400 ? "vs a year ago" : "since the start";
        card.append(
          el("span", `trend-delta ${delta > 0 ? "good" : delta < 0 ? "bad" : "muted"}`,
            `${sign}${tile.format(delta)} ${period}`),
        );
        card.append(sparkline(series));
      } else {
        card.append(el("span", "trend-delta muted", "gathering data..."));
      }
      row.append(card);
    }
    parent.append(row);
  }

  // -------------------------------------------------------------- colonies

  private renderColonies(parent: HTMLElement): void {
    const rows = colonyRows(this.game.empire, this.game.galaxy);
    // A colony that has gone away should not stay selected.
    for (const id of [...this.selected]) {
      if (!rows.some((r) => r.colony.bodyId === id)) this.selected.delete(id);
    }

    const sec = section(parent, `Colonies (${rows.length})`);
    sec.classList.add("wide");
    this.renderBulkBar(sec, rows);

    const table = el("div", "data-table colony-table");
    const header = el("div", "data-row header");
    for (const column of COLUMNS) {
      const cell = el("span", column.align === "right" ? "right sortable" : "sortable", column.label);
      cell.title = hintFor(column.label) ?? "";
      if (column.key === "name") cell.classList.add("with-tick");
      if (this.sortKey === column.key) {
        cell.classList.add("sorted");
        cell.append(el("span", "sort-arrow", this.sortDescending ? " v" : " ^"));
      }
      cell.addEventListener("click", () => {
        if (this.sortKey === column.key) this.sortDescending = !this.sortDescending;
        else {
          this.sortKey = column.key;
          this.sortDescending = column.key !== "name";
        }
        this.render();
      });
      header.append(cell);
    }
    table.append(header);

    for (const row of this.sorted(rows)) {
      const line = el("div", "data-row");
      line.classList.toggle("attention", row.stalled);
      line.classList.toggle("picked", this.selected.has(row.colony.bodyId));

      const name = el("span", "cell-name");
      const tick = el("span", "row-tick", this.selected.has(row.colony.bodyId) ? "x" : "");
      tick.title = "Select for a bulk action";
      tick.addEventListener("click", (event) => {
        event.stopPropagation();
        if (this.selected.has(row.colony.bodyId)) this.selected.delete(row.colony.bodyId);
        else this.selected.add(row.colony.bodyId);
        this.render();
      });
      const dot = el("span", "dot");
      dot.style.background = row.body.def.color;
      name.append(tick, dot, el("span", undefined, row.body.name));
      if (row.stalled) name.append(el("span", "chip bad", "stalled"));
      line.append(name);

      line.append(el("span", "right", populationFixed(row.population)));
      line.append(
        el("span", `right ${row.growth >= 0 ? "good" : "bad"}`,
          `${row.growth >= 0 ? "+" : ""}${population(row.growth)}`),
      );
      line.append(
        el("span", `right ${row.employment < 0.95 ? "warn" : ""}`.trim(),
          `${Math.round(row.employment * 100)}%`),
      );
      line.append(el("span", "right", num(row.buildPoints)));
      line.append(el("span", "right", num(row.mining)));
      line.append(el("span", "right", num(row.researchPoints)));
      line.append(el("span", "right", num(row.wealth)));
      line.append(
        el("span", "right muted",
          row.queueDepth === 0 ? "idle" : formatYears(row.nextCompletion)),
      );

      line.addEventListener("click", () => this.onOpenColony(row.colony.bodyId));
      table.append(line);
    }
    sec.append(table);
  }

  /**
   * Bulk actions: apply one development template across every ticked colony,
   * so settling five moons is five ticks and one click.
   */
  private renderBulkBar(parent: HTMLElement, rows: ColonyRow[]): void {
    if (!this.selected.size) return;
    const { empire } = this.game;

    const targets = rows.filter((r) => this.selected.has(r.colony.bodyId));
    const templates = empire.templates;
    if (!templates.some((t) => t.id === this.bulkTemplate)) {
      this.bulkTemplate = templates[0]?.id ?? "";
    }
    const sources = [...empire.colonies.values()].filter(
      (c) => installationCount(c, "construction-factory") > 0,
    );
    if (!sources.some((c) => c.bodyId === this.bulkSource)) {
      this.bulkSource =
        sources.find((c) => c.bodyId === empire.capital)?.bodyId ?? sources[0]?.bodyId ?? "";
    }

    const template = templates.find((t) => t.id === this.bulkTemplate);
    const bar = el("div", "bulk-bar");
    bar.append(el("span", "bulk-count", `${this.selected.size} selected`));

    bar.append(
      select(
        templates.map((t) => ({ value: t.id, label: t.name })),
        this.bulkTemplate,
        (value) => {
          this.bulkTemplate = value;
          this.render();
        },
      ),
    );
    bar.append(
      select(
        sources.map((c) => ({
          value: c.bodyId,
          label: `built at ${this.game.galaxy.byId.get(c.bodyId)?.name ?? c.bodyId}`,
        })),
        this.bulkSource,
        (value) => {
          this.bulkSource = value;
          this.render();
        },
      ),
    );

    // Total cost of applying to everything ticked, before committing.
    let totalBp = 0;
    const plans = targets.map((row) => {
      const items = template
        ? resolveTemplate(template, row.body, row.colony, empire.stats)
        : [];
      for (const item of items) {
        totalBp += (INSTALLATION_BY_ID.get(item.installationId)?.cost ?? 0) * item.quantity;
      }
      return { row, items };
    });
    bar.append(el("span", "muted small", `${num(totalBp)} BP in total`));

    bar.append(
      button(
        "Apply to selected",
        () => {
          const source = empire.colony(this.bulkSource);
          if (!source || !template) return;
          let applied = 0;
          for (const plan of plans) {
            for (const item of plan.items) {
              empire.queueBuild(
                source.bodyId,
                item.installationId,
                item.quantity,
                source.bodyId === plan.row.colony.bodyId ? null : plan.row.colony.bodyId,
              );
              applied++;
            }
          }
          if (applied) {
            empire.addLog(
              this.game.clock.seconds,
              "construction",
              `${template.name} applied to ${plans.length} colonies from ${
                this.game.galaxy.byId.get(source.bodyId)?.name
              }.`,
            );
          }
          this.selected.clear();
          this.game.emit();
        },
        "primary-btn",
      ),
    );
    bar.append(
      button("Clear", () => {
        this.selected.clear();
        this.render();
      }),
    );
    parent.append(bar);
  }

  private sorted(rows: ColonyRow[]): ColonyRow[] {
    const key = this.sortKey;
    const direction = this.sortDescending ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (key === "name") return a.body.name.localeCompare(b.body.name) * direction;
      return (a[key] - b[key]) * direction;
    });
  }

  // ---------------------------------------------------------------- ledger

  private renderLedger(parent: HTMLElement): void {
    const rows = mineralLedger(this.game.empire, this.game.galaxy);
    const sec = section(parent, "Mineral Ledger");

    const table = el("div", "data-table ledger-table");
    const header = el("div", "data-row header");
    for (const label of ["Mineral", "Stockpile", "Mined/yr", "Used/yr", "Net", "Cover", "In ground"]) {
      const cell = el("span", label === "Mineral" ? "" : "right", label);
      cell.title = hintFor(label) ?? "";
      header.append(cell);
    }
    table.append(header);

    for (const row of rows) {
      const line = el("div", "data-row");
      const tone = coverTone(row);
      if (tone) line.classList.add(tone === "bad" ? "attention" : "caution");

      line.append(el("span", "cell-name", row.mineral));
      line.append(el("span", "right", compact(row.stockpile)));
      line.append(el("span", "right", num(row.production)));
      line.append(el("span", "right", num(row.demand)));
      line.append(
        el("span", `right ${row.net >= 0 ? "good" : "bad"}`,
          `${row.net >= 0 ? "+" : ""}${num(row.net)}`),
      );
      line.append(
        el("span", `right ${tone ?? ""}`.trim(),
          Number.isFinite(row.cover) ? formatYears(row.cover) : "-"),
      );
      line.append(
        el("span", "right muted",
          row.reserves > 0 ? `${compact(row.reserves)}` : "none"),
      );
      table.append(line);
    }
    sec.append(table);
    sec.append(
      el("p", "muted small",
        "Cover is how long the stockpile lasts at the current net rate. In-ground counts only deposits at colonies with mines."),
    );
  }

  // -------------------------------------------------------------- research

  private renderResearch(parent: HTMLElement): void {
    const { empire } = this.game;
    const sec = section(parent, "Research");

    let idleLabs = 0;
    let totalLabs = 0;
    for (const colony of empire.colonies.values()) {
      const labs = installationCount(colony, "research-lab");
      totalLabs += labs;
      idleLabs += Math.max(0, labs - empire.labsInUse(colony.bodyId));
    }

    stat(sec, "Output", `${num(empire.snapshot.researchPoints)} RP / year`);
    stat(sec, "Laboratories", `${num(totalLabs - idleLabs)} of ${num(totalLabs)} working`,
      idleLabs > 0 ? "warn" : undefined);

    if (!empire.projects.length) {
      emptyNote(sec, "No research under way.");
      return;
    }

    for (const project of empire.projects) {
      const tech = TECH_BY_ID.get(project.techId);
      if (!tech) continue;
      const scientist = empire.officers.get(project.scientistId ?? undefined);
      const rate = projectRate(empire, project);
      const card = el("div", "mini-project");
      const head = el("div", "mini-project-head");
      head.append(el("span", "mini-project-name", tech.name));
      head.append(
        el("span", "muted small",
          rate > 0 ? formatYears((tech.cost - project.progress) / rate) : "stalled"),
      );
      card.append(head);
      card.append(progressBar(project.progress / tech.cost));
      card.append(
        el("div", "muted small",
          `${scientist ? fullName(scientist) : "unassigned"} - ${project.labs} labs`),
      );
      sec.append(card);
    }
  }

  // ---------------------------------------------------------------- events

  /**
   * Civilian shipping is the stand-in that moves installations and colonists
   * without ships. Once there are freighters, it can be switched off.
   */
  private renderFinance(parent: HTMLElement): void {
    const { empire } = this.game;
    const b = budgetOf(empire, this.game.galaxy);
    const sec = section(parent, "Finance");
    const signed = (v: number) => `${v >= 0 ? "+" : "-"}${num(Math.abs(v))}`;

    stat(sec, "Treasury", num(empire.treasury), empire.treasury < 0 ? "bad" : undefined);
    stat(sec, "Net / yr", signed(b.net), b.net < 0 ? "bad" : "good");
    if (b.runwayYears !== null) {
      stat(sec, "Reserves last", `${b.runwayYears.toFixed(1)} years`, b.runwayYears < 2 ? "warn" : undefined);
    }
    if (empire.treasury < 0) {
      sec.append(el("p", "project-warning", "In debt: interest is charged, industry is halved and the people grow restless."));
    }

    const lines: [string, number][] = [
      ["Taxes", b.taxes], ["Trade", b.trade], ["Goods trade levy", b.goods], ["Financial centres", b.centres],
      ["Construction", -b.construction], ["Research", -b.research], ["Upkeep", -b.upkeep],
      ["Welfare", -b.welfare], ["Debt interest", -b.interest], ["Idle reserves lost", -b.erosion], ["Ships and other", -b.other],
    ];
    for (const [label, value] of lines) {
      if (Math.abs(value) < 0.05) continue;
      stat(sec, label, signed(value), undefined);
    }

    const effective = b.lines.reduce((sum, l) => sum + l.strength, 0);
    stat(sec, "Freight lines", b.lines.length ? `${b.lines.length} (${effective.toFixed(1)} links)` : "none",
      b.lines.length ? "good" : "warn");
    if (!b.lines.length) {
      sec.append(el("p", "muted small",
        "Trade follows freight: set a fleet to a freight line between two colonies to raise commerce. Civilian shipping gives only a modest baseline."));
    }
    sec.append(el("label", "muted small", `Tax rate - ${Math.round(empire.taxRate * 100)}% (${Math.round(NEUTRAL_TAX * 100)}% is neutral)`));
    const tax = numberInput(Math.round(empire.taxRate * 100), (v) => {
      empire.taxRate = v / 100;
      this.game.emit();
    }, 0, Math.round(MAX_TAX * 100));
    tax.setAttribute("data-field", "tax-rate");
    sec.append(tax);
    sec.append(el("label", "muted small", `Welfare - ${Math.round(empire.welfare * 100)}% of taxes`));
    const welfare = numberInput(Math.round(empire.welfare * 100), (v) => {
      empire.welfare = v / 100;
      this.game.emit();
    }, 0, Math.round(MAX_WELFARE * 100));
    welfare.setAttribute("data-field", "welfare");
    sec.append(welfare);
    sec.append(
      el("p", "muted small",
        "Heavy taxes raise income but wear down stability and trade; light taxes and welfare keep the people content, and content people work harder and settle faster."),
    );
    stat(sec, "Stability", `${Math.round(b.meanStability)} - ${stabilityLabel(b.meanStability)}`,
      b.meanStability < 40 ? "bad" : b.meanStability < 60 ? "warn" : undefined);

    const cost = programmeCost(b.income);
    const prog = section(parent, `Programmes - ${num(cost)} each`);
    for (const programme of PROGRAMMES) {
      const running = activeProgramme(empire, programme);
      const row = el("div", "queue-row");
      row.append(el("span", undefined, programme.name), el("span", "muted small", programme.blurb));
      if (running) {
        const left = Math.max(0, (running.until - this.game.clock.seconds) / (365.25 * 86_400));
        row.append(el("span", "chip good", `${left.toFixed(1)} yrs left`));
      } else {
        const buy = button("Fund", () => {
          buyProgramme(empire, programme.id, this.game.clock.seconds);
          this.game.emit();
        });
        buy.disabled = empire.treasury < cost;
        buy.setAttribute("aria-label", `Fund ${programme.name}`);
        row.append(buy);
      }
      prog.append(row);
    }
  }

  private renderGoods(parent: HTMLElement): void {
    const { empire } = this.game;
    const market = computeMarket(empire, this.game.galaxy);
    const sec = section(parent, "Goods");
    if (!market.colonies.size) {
      emptyNote(sec, "No one to feed yet.");
      return;
    }
    for (const good of GOODS) {
      let supply = 0;
      let demand = 0;
      let unmet = 0;
      let short = 0;
      for (const m of market.colonies.values()) {
        const f = m.goods[good.id];
        supply += f.supply;
        demand += f.demand;
        unmet += Math.max(0, f.demand - Math.min(f.demand, f.supply + f.imported - f.exported));
        if (f.met < 0.7) short++;
      }
      const met = demand > 0 ? 1 - unmet / demand : 1;
      stat(sec, good.name, `${num(supply)} made / ${num(demand)} needed`, met < 0.7 ? "bad" : met < 0.95 ? "warn" : "good");
      if (short) sec.append(el("p", "muted small", `${short} ${short === 1 ? "colony is" : "colonies are"} short of ${good.name.toLowerCase()}.`));
    }
    stat(sec, "Traded between colonies", `${num(market.tradedValue)} value / yr, levy ${num(market.levy)}`);
    sec.append(el("p", "muted small", "Surplus moves by civilian shipping within a system and along freight lines between them. See a colony's People tab."));
  }

  private renderLogistics(parent: HTMLElement): void {
    const { empire } = this.game;
    const sec = section(parent, "Logistics");
    const on = empire.civilianShipping;

    stat(sec, "Civilian Shipping", on ? "Enabled" : "Disabled", on ? "good" : "warn");
    sec.append(
      el(
        "p",
        "muted small",
        on
          ? "Installations built for another colony arrive by themselves and colonists migrate from the capital. Turn it off to run logistics on ships you have built."
          : "Installations built for another colony are crated up where they are built, and colonists only move aboard ship.",
      ),
    );
    sec.append(
      button(on ? "Turn off civilian shipping" : "Turn on civilian shipping", () => {
        empire.civilianShipping = !empire.civilianShipping;
        empire.addLog(
          this.game.clock.seconds,
          "economy",
          empire.civilianShipping
            ? "Civilian shipping contracts resumed."
            : "Civilian shipping contracts ended; the fleet now carries everything.",
        );
        this.game.emit();
      }),
    );

    const fleets = empire.fleets.size;
    if (fleets) {
      stat(sec, "Fleets", `${fleets}`);
      stat(sec, "Ships", `${empire.ships.size}`);
    }
  }

  private renderEvents(parent: HTMLElement): void {
    const { empire } = this.game;
    const sec = section(parent, "Events");
    sec.classList.add("wide");

    if (!empire.log.length) {
      emptyNote(sec, "Nothing has happened yet.");
      return;
    }

    let dividerDrawn = false;
    for (const entry of empire.log.slice(0, 80)) {
      if (!dividerDrawn && entry.time <= empire.reviewMark.time) {
        dividerDrawn = true;
        sec.append(el("div", "log-divider", "last reviewed"));
      }
      const row = el("div", `log-row log-${entry.category}`);
      row.append(el("span", "log-date", formatShortDate(entry.time)));
      row.append(el("span", "log-text", entry.text));
      sec.append(row);
    }
  }
}

function coverTone(row: LedgerRow): "bad" | "warn" | null {
  if (row.net < 0 && row.cover < 3) return "bad";
  if (row.net < 0 && row.cover < 8) return "warn";
  if (row.production > 0 && row.reservesYears < 5) return "warn";
  return null;
}

/** A tiny line chart. Drawn as SVG so it scales and stays crisp. */
function sparkline(values: number[]): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 100 26");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("aria-hidden", "true");

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(24 - ((v - min) / span) * 22).toFixed(2)}`)
    .join(" ");

  const area = document.createElementNS(ns, "polygon");
  area.setAttribute("points", `0,26 ${points} 100,26`);
  area.setAttribute("class", "spark-area");
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", points);
  line.setAttribute("class", "spark-line");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(area, line);
  return svg;
}
