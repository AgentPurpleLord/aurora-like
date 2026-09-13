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
import { compact, el, num, population } from "../format";
import { emptyNote, progressBar, section, stat } from "../widgets";
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
    const sec = section(parent, `Colonies (${rows.length})`);
    sec.classList.add("wide");

    const table = el("div", "data-table colony-table");
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

      const name = el("span", "cell-name");
      const dot = el("span", "dot");
      dot.style.background = row.body.def.color;
      name.append(dot, el("span", undefined, row.body.name));
      if (row.stalled) name.append(el("span", "chip bad", "stalled"));
      line.append(name);

      line.append(el("span", "right", population(row.population)));
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
      const card = el("div", "mini-project");
      const head = el("div", "mini-project-head");
      head.append(el("span", "mini-project-name", tech.name));
      head.append(
        el("span", "muted small",
          project.lastRate > 0
            ? formatYears((tech.cost - project.progress) / project.lastRate)
            : "stalled"),
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
