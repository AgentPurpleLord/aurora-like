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
import { compact, el, num, population, populationFixed } from "../format";
import { button, emptyNote, progressBar, section, select, stat } from "../widgets";
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

  constructor(private root: HTMLElement, private game: Game, private onOpenColony: (bodyId: string) => void) {
    this.root.classList.add("view-empire");
  }

  render(): void {
    this.root.textContent = "";
    const body = el("div", "dashboard");
    this.root.append(body);

    this.renderSinceStrip(body);
    this.renderColonies(body);

    const split = el("div", "dashboard-split");
    body.append(split);
    this.renderLedger(split);
    this.renderResearch(split);
    this.renderLogistics(split);

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

    const mark_ = el("button", "ghost-btn", "Mark reviewed");
    mark_.addEventListener("click", () => {
      empire.markReviewed(this.game.clock.seconds);
      this.render();
    });
    strip.append(mark_);
    parent.append(strip);
  }

  // -------------------------------------------------------------- colonies

  private renderColonies(parent: HTMLElement): void {
    const rows = colonyRows(this.game.empire, this.game.system);
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
          label: `built at ${this.game.system.byId.get(c.bodyId)?.name ?? c.bodyId}`,
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
                this.game.system.byId.get(source.bodyId)?.name
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
    const rows = mineralLedger(this.game.empire, this.game.system);
    const sec = section(parent, "Mineral Ledger");

    const table = el("div", "data-table ledger-table");
    const header = el("div", "data-row header");
    for (const label of ["Mineral", "Stockpile", "Mined/yr", "Used/yr", "Net", "Cover", "In ground"]) {
      header.append(el("span", label === "Mineral" ? "" : "right", label));
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
