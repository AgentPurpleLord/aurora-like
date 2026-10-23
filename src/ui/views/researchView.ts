/**
 * Research view.
 *
 * The aim is to answer, in order: what is happening, what can I start, what
 * does it do, and what is stopping me.
 *
 *  - A summary strip and the projects under way sit at the top, so the state
 *    of research is visible without clicking anything.
 *  - "Ready now" is the default tab: every technology that can be started
 *    today, grouped by field. The field tabs show each branch as columns by
 *    tier, so the shape of the tree is visible and selecting a technology
 *    highlights what it needs and what it opens.
 *  - The side panel explains the selected technology - what it unlocks, what
 *    it requires - and starts it in one step with a recommended scientist and
 *    laboratories already chosen.
 */

import type { Game } from "../../state/game";
import type { ResearchProject } from "../../state/empire";
import { installationCount } from "../../state/colony";
import { projectRate } from "../../sim/economy/production";
import { FIELD_NAMES, FIELD_SHORT, RESEARCH_FIELDS, type ResearchField } from "../../sim/research/fields";
import {
  FIELD_ORDER,
  etaYears,
  fieldProgress,
  freeLabs,
  freeScientists,
  missingPrereqs,
  recommend,
  techState,
  techsInField,
  unlocksOf,
  type TechState,
} from "../../sim/research/graph";
import { TECHS, TECH_BY_ID, type Tech } from "../../sim/research/techs";
import { fullName, labCapacity } from "../../sim/people/officers";
import { compact, el, num } from "../format";
import { button, emptyNote, numberInput, progressBar, section, select, stat } from "../widgets";
import { formatYears } from "./economyView";
import { saveSettings, settings } from "../settings";

type Tab = "ready" | "done" | ResearchField;

const STATE_LABEL: Record<TechState, string> = {
  researched: "Researched",
  active: "In progress",
  available: "Ready",
  locked: "Locked",
};

export class ResearchView {
  private main: HTMLElement;
  private side: HTMLElement;
  private boardHost = el("div", "research-board");

  private tab: Tab = "ready";
  private selected: string | null = null;
  private query = "";
  /** Kept across renders so typing is never interrupted by a redraw. */
  private searchInput = el("input", "search research-search");
  /** Locked technologies the player was sent to by a link, shown even while locked ones are hidden. */
  private revealed = new Set<string>();
  private dirty = false;

  /** The start-research form, initialised from the recommendation. */
  private form = { forTech: "", scientistId: "", colonyId: "", labs: 1 };

  constructor(private root: HTMLElement, private game: Game) {
    this.root.classList.add("view-research");
    this.main = el("section", "research-main");
    this.side = el("aside", "panel research-side");
    this.root.append(this.main, this.side);

    this.searchInput.type = "search";
    this.searchInput.placeholder = "Search technologies...";
    this.searchInput.addEventListener("input", () => {
      this.query = this.searchInput.value.trim().toLowerCase();
      this.renderBoard();
    });

    // A redraw that arrived while a control had focus is applied afterwards.
    this.root.addEventListener("focusout", () => {
      if (!this.dirty) return;
      setTimeout(() => {
        if (this.dirty && !this.hasFocusedControl()) this.draw();
      }, 0);
    });
  }

  /** Open the board at a technology, from a link elsewhere in the interface. */
  focusTech(techId: string): void {
    const tech = TECH_BY_ID.get(techId);
    if (!tech) return;
    this.tab = tech.field;
    this.searchInput.value = "";
    this.query = "";
    this.selected = techId;
    this.revealed.add(techId);
    this.form.forTech = "";
  }

  private hasFocusedControl(): boolean {
    const active = document.activeElement;
    return (
      active instanceof HTMLElement &&
      this.root.contains(active) &&
      /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)
    );
  }

  /** Called when the game changes under us; waits if someone is typing. */
  render(): void {
    if (this.hasFocusedControl()) {
      this.dirty = true;
      return;
    }
    this.draw();
  }

  /** Redraw now - for changes the player just made themselves. */
  private draw(): void {
    this.dirty = false;
    this.renderMain();
    this.renderSide();
  }

  // ----------------------------------------------------------------- main

  private renderMain(): void {
    this.main.textContent = "";
    this.renderSummary();
    this.renderProjects();
    this.renderToolbar();
    this.main.append(this.boardHost);
    this.renderBoard();
  }

  private renderSummary(): void {
    const { empire } = this.game;
    let totalLabs = 0;
    let working = 0;
    for (const colony of empire.colonies.values()) {
      const labs = installationCount(colony, "research-lab");
      totalLabs += labs;
      working += Math.min(labs, empire.labsInUse(colony.bodyId));
    }
    const freeScientistCount = freeScientists(empire).length;
    const ready = TECHS.filter((t) => techState(empire, t) === "available").length;

    const strip = el("div", "research-summary");
    const add = (label: string, value: string, tone?: string) => {
      const box = el("div", "summary-box");
      box.append(el("span", "summary-label", label));
      box.append(el("span", `summary-value${tone ? ` ${tone}` : ""}`, value));
      strip.append(box);
    };
    add("Output", `${num(empire.snapshot.researchPoints)} RP/yr`);
    add("Laboratories", `${num(working)} of ${num(totalLabs)} working`, working < totalLabs ? "warn" : undefined);
    add("Scientists free", num(freeScientistCount), freeScientistCount && working < totalLabs ? "warn" : undefined);
    add("Ready to start", num(ready));
    add("Researched", `${empire.researched.size} of ${TECHS.length}`);
    this.main.append(strip);
  }

  private renderProjects(): void {
    const { empire } = this.game;
    const sec = el("div", "research-projects");
    sec.append(el("h3", undefined, `In progress (${empire.projects.length})`));

    if (!empire.projects.length) {
      sec.append(
        el("p", "muted research-empty",
          "Nothing is being researched. Pick a technology below - the ready ones are listed first."),
      );
      this.main.append(sec);
      return;
    }

    const row = el("div", "project-strip");
    for (const project of empire.projects) {
      const tech = TECH_BY_ID.get(project.techId);
      if (!tech) continue;
      const rate = projectRate(empire, project);
      const card = el("div", "proj-card");
      card.classList.toggle("selected", this.selected === tech.id);
      card.classList.toggle("stalled", rate <= 0);

      card.append(el("div", "proj-name", tech.name));
      card.append(el("div", "proj-field", FIELD_SHORT[tech.field]));
      card.append(progressBar(project.progress / tech.cost));
      const scientist = empire.officers.get(project.scientistId ?? undefined);
      card.append(
        el("div", "proj-meta",
          rate > 0
            ? `${formatYears((tech.cost - project.progress) / rate)} left - ${scientist?.name ?? "no scientist"}`
            : "stalled"),
      );
      card.addEventListener("click", () => this.select(tech.id));
      row.append(card);
    }
    sec.append(row);
    this.main.append(sec);
  }

  /**
   * Technology that cannot be started yet is hidden unless the player asks
   * to see it: researched, under way and ready technologies always show, and
   * so does anything the player has been linked to or has selected.
   */
  private visible(tech: Tech): boolean {
    if (settings.showLocked || this.revealed.has(tech.id) || this.selected === tech.id) return true;
    return techState(this.game.empire, tech) !== "locked";
  }

  private renderToolbar(): void {
    const { empire } = this.game;
    const bar = el("div", "research-toolbar");

    const tabs = el("div", "research-tabs");
    const readyCount = TECHS.filter((t) => techState(empire, t) === "available").length;
    const tabButton = (id: Tab, label: string, badge?: string) => {
      const btn = el("button", "research-tab");
      btn.append(el("span", undefined, label));
      if (badge) btn.append(el("span", "tab-badge", badge));
      btn.classList.toggle("active", this.tab === id && !this.query);
      btn.addEventListener("click", () => {
        this.tab = id;
        this.searchInput.value = "";
        this.query = "";
        this.draw();
      });
      tabs.append(btn);
    };

    tabButton("ready", "Ready now", String(readyCount));
    for (const field of FIELD_ORDER) {
      const { done } = fieldProgress(empire, field);
      const shown = TECHS.filter((t) => t.field === field && this.visible(t)).length;
      tabButton(field, FIELD_SHORT[field], `${done}/${shown}`);
    }
    tabButton("done", "Researched", String(empire.researched.size));
    const reveal = el("label", "check-row research-reveal");
    const box = el("input");
    box.type = "checkbox";
    box.checked = settings.showLocked;
    box.addEventListener("change", () => {
      settings.showLocked = box.checked;
      saveSettings();
      this.draw();
    });
    reveal.append(box, el("span", "check-label", "Show locked technologies"));
    bar.append(tabs, this.searchInput, reveal);
    this.main.append(bar);
  }

  // ---------------------------------------------------------------- board

  private renderBoard(): void {
    const { empire } = this.game;
    this.boardHost.textContent = "";

    if (this.query) {
      const all = TECHS.filter(
        (t) =>
          t.name.toLowerCase().includes(this.query) ||
          t.description.toLowerCase().includes(this.query) ||
          FIELD_NAMES[t.field].toLowerCase().includes(this.query),
      );
      const matches = all.filter((t) => this.visible(t));
      this.boardHost.append(el("h3", "board-title", `${matches.length} match${matches.length === 1 ? "" : "es"}`));
      this.groupedGrid(matches);
      if (all.length > matches.length) {
        this.boardHost.append(
          el("p", "muted research-hint", `${all.length - matches.length} more match technology that is not available yet. Tick "Show locked technologies" to see it.`),
        );
      }
      return;
    }

    if (this.tab === "ready") {
      const ready = TECHS.filter((t) => techState(empire, t) === "available");
      if (!ready.length) {
        emptyNote(this.boardHost, "Nothing is ready to start. Everything available is already under way.");
        return;
      }
      this.boardHost.append(
        el("p", "muted research-hint",
          "Every technology whose prerequisites are done. Select one to see what it unlocks and start it."),
      );
      this.groupedGrid(ready);
      return;
    }

    if (this.tab === "done") {
      const done = TECHS.filter((t) => empire.researched.has(t.id));
      if (!done.length) {
        emptyNote(this.boardHost, "Nothing has been researched yet.");
        return;
      }
      this.groupedGrid(done);
      return;
    }

    // A field: the tree as columns, left to right.
    const field = this.tab as ResearchField;
    this.boardHost.append(el("h3", "board-title", FIELD_NAMES[field]));
    const board = el("div", "tier-board");
    techsInField(field).forEach((column, index) => {
      const shown = column.filter((t) => this.visible(t));
      if (!shown.length) return;
      const col = el("div", "tier-col");
      col.append(el("div", "tier-head", index === 0 ? "Foundations" : `Tier ${index + 1}`));
      for (const tech of shown) col.append(this.node(tech));
      board.append(col);
    });
    this.boardHost.append(board);
    if (!board.childElementCount) emptyNote(this.boardHost, "Nothing in this field is available yet.");
    else if (!settings.showLocked) {
      this.boardHost.append(el("p", "muted research-hint", "Technology that is not available yet is hidden. Tick \"Show locked technologies\" to see the whole tree."));
    }
  }

  private groupedGrid(techs: Tech[]): void {
    for (const field of RESEARCH_FIELDS) {
      const inField = techs.filter((t) => t.field === field);
      if (!inField.length) continue;
      const group = el("div", "node-group");
      group.append(el("div", "node-group-head", FIELD_NAMES[field]));
      const grid = el("div", "node-grid");
      for (const tech of inField) grid.append(this.node(tech));
      group.append(grid);
      this.boardHost.append(group);
    }
  }

  private node(tech: Tech): HTMLElement {
    const { empire } = this.game;
    const state = techState(empire, tech);
    const node = el("div", `tech-node ${state}`);
    node.dataset.tech = tech.id;
    node.classList.toggle("selected", this.selected === tech.id);

    if (this.selected) {
      const picked = TECH_BY_ID.get(this.selected);
      if (picked?.prereqs.includes(tech.id)) node.classList.add("is-prereq");
      if (picked && tech.prereqs.includes(picked.id)) node.classList.add("is-dependent");
    }

    node.append(el("div", "node-name", tech.name));
    const meta = el("div", "node-meta");
    meta.append(el("span", "node-state", STATE_LABEL[state]));
    meta.append(el("span", "node-cost", state === "researched" ? "" : `${compact(tech.cost)} RP`));
    if (tech.future) {
      const chip = el("span", "chip future", "future");
      chip.title = "Researchable, but its effects arrive with systems not built yet.";
      meta.append(chip);
    }
    node.append(meta);

    if (state === "active") {
      const project = empire.projects.find((p) => p.techId === tech.id);
      if (project) node.append(progressBar(project.progress / tech.cost));
    }
    node.addEventListener("click", () => this.select(tech.id));
    return node;
  }

  private select(techId: string): void {
    this.selected = techId;
    this.form.forTech = "";
    this.draw();
    // On a phone the detail panel is below the board.
    if (window.matchMedia("(max-width: 860px)").matches) {
      this.side.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ----------------------------------------------------------------- side

  private renderSide(): void {
    this.side.textContent = "";
    const tech = this.selected ? TECH_BY_ID.get(this.selected) : undefined;

    const head = el("div", "panel-head");
    head.append(el("span", undefined, tech ? "Technology" : "Details"));
    this.side.append(head);

    const body = el("div", "detail-body");
    this.side.append(body);

    if (!tech) {
      body.append(
        el("p", "research-hint",
          "Select a technology to see what it unlocks, what it needs, and to start it."),
      );
    } else {
      this.renderTechDetail(body, tech);
    }
    this.renderScientists(body);
  }

  private renderTechDetail(body: HTMLElement, tech: Tech): void {
    const { empire } = this.game;
    const state = techState(empire, tech);

    const title = el("div", "tech-title");
    title.append(el("div", "detail-title", tech.name));
    const sub = el("div", "tech-subline");
    sub.append(el("span", `state-pill ${state}`, STATE_LABEL[state]));
    sub.append(el("span", "muted small", FIELD_NAMES[tech.field]));
    sub.append(el("span", "muted small", `${num(tech.cost)} RP`));
    title.append(sub);
    body.append(title);
    body.append(el("p", "tech-desc-full", tech.description));

    // --- what it does
    const unlocks = unlocksOf(tech);
    if (unlocks.gains.length || unlocks.improves.length || unlocks.opens.length) {
      const sec = section(body, "What it does");
      for (const text of unlocks.gains) sec.append(this.bullet("gain", text));
      for (const text of unlocks.improves) sec.append(this.bullet("improve", text));
      if (unlocks.opens.length) {
        const row = el("div", "chip-row");
        row.append(el("span", "muted small", "Opens"));
        for (const next of unlocks.opens) row.append(this.techChip(next));
        sec.append(row);
      }
    }
    if (tech.future) {
      body.append(
        el("p", "muted small",
          "This can be researched now, but its effects arrive with systems that are not built yet."),
      );
    }

    // --- what it needs
    if (tech.prereqs.length) {
      const sec = section(body, "Requires");
      const row = el("div", "chip-row");
      for (const id of tech.prereqs) {
        const pre = TECH_BY_ID.get(id);
        if (pre) row.append(this.techChip(pre));
      }
      sec.append(row);
    }

    // --- action
    if (state === "researched") {
      body.append(el("p", "good", "Researched."));
    } else if (state === "active") {
      this.renderActive(body, tech);
    } else if (state === "locked") {
      this.renderLocked(body, tech);
    } else {
      this.renderStart(body, tech);
    }
  }

  private bullet(kind: "gain" | "improve", text: string): HTMLElement {
    const row = el("div", `bullet ${kind}`);
    row.append(el("span", "bullet-mark", kind === "gain" ? "+" : "^"), el("span", undefined, text));
    return row;
  }

  private techChip(tech: Tech): HTMLElement {
    const state = techState(this.game.empire, tech);
    const chip = el("button", `tech-chip ${state}`, tech.name);
    chip.title = STATE_LABEL[state];
    chip.addEventListener("click", () => {
      this.tab = tech.field;
      this.searchInput.value = "";
      this.query = "";
      this.select(tech.id);
    });
    return chip;
  }

  private renderLocked(body: HTMLElement, tech: Tech): void {
    const { empire } = this.game;
    const missing = missingPrereqs(empire, tech);
    const sec = section(body, "Not yet available");
    sec.append(
      el("p", "notes",
        `Research ${missing.map((m) => m.name).join(" and ")} first.`),
    );
    const next = missing.find((m) => techState(empire, m) === "available") ?? missing[0];
    if (next) {
      sec.append(
        button(`Go to ${next.name}`, () => {
          this.tab = next.field;
          this.select(next.id);
        }, "ghost-btn"),
      );
    }
  }

  private renderStart(body: HTMLElement, tech: Tech): void {
    const { empire } = this.game;
    const sec = section(body, "Start research");
    const rec = recommend(empire, tech);

    if (rec.blocker === "no-scientist") {
      sec.append(
        el("p", "project-warning",
          "Every scientist is leading a project. Finish or cancel one, or wait for a new scientist to join."),
      );
      return;
    }
    if (rec.blocker === "no-labs") {
      sec.append(
        el("p", "project-warning",
          "No laboratories are free. Build Research Laboratories at a colony, or reduce the labs on another project."),
      );
      return;
    }

    const scientists = freeScientists(empire, tech.field);
    const sites = freeLabs(empire);

    // Initialise the form from the recommendation the first time.
    if (this.form.forTech !== tech.id) {
      this.form = {
        forTech: tech.id,
        scientistId: rec.setup!.scientist.id,
        colonyId: rec.setup!.colonyId,
        labs: rec.setup!.labs,
      };
    }
    if (!scientists.some((s) => s.id === this.form.scientistId)) this.form.scientistId = scientists[0].id;
    if (!sites.some((s) => s.colonyId === this.form.colonyId)) this.form.colonyId = sites[0].colonyId;

    const scientist = empire.officers.get(this.form.scientistId)!;
    const site = sites.find((s) => s.colonyId === this.form.colonyId)!;
    const maxLabs = Math.max(1, Math.min(site.free, labCapacity(scientist)));
    this.form.labs = Math.max(1, Math.min(this.form.labs, maxLabs));

    const recommended = rec.setup!;
    const isRecommended =
      scientist.id === recommended.scientist.id &&
      this.form.colonyId === recommended.colonyId &&
      this.form.labs === recommended.labs;

    const field = (label: string, control: HTMLElement) => {
      const row = el("div", "field-row");
      row.append(el("label", "field-label", label), control);
      sec.append(row);
    };

    field(
      "Scientist",
      select(
        scientists.map((o, index) => ({
          value: o.id,
          label: `${fullName(o)} - ${o.skills.research ?? 0}%${o.specialty === tech.field ? ", specialist" : ""}${index === 0 ? " (best)" : ""}`,
        })),
        this.form.scientistId,
        (value) => {
          this.form.scientistId = value;
          this.draw();
        },
      ),
    );
    field(
      "Laboratories at",
      select(
        sites.map((s) => ({
          value: s.colonyId,
          label: `${this.game.galaxy.byId.get(s.colonyId)?.name ?? s.colonyId} (${s.free} free)`,
        })),
        this.form.colonyId,
        (value) => {
          this.form.colonyId = value;
          this.draw();
        },
      ),
    );
    field(
      `Labs (up to ${maxLabs})`,
      numberInput(this.form.labs, (value) => {
        this.form.labs = value;
        this.draw();
      }, 1, maxLabs),
    );

    const eta = etaYears(empire, tech, scientist, this.form.colonyId, this.form.labs);
    sec.append(
      el("p", "eta-line",
        eta === null ? "This setup would make no progress." : `Finishes in about ${formatYears(eta)}.`),
    );
    if (labCapacity(scientist) < site.free) {
      sec.append(
        el("p", "muted small",
          `${scientist.name} can direct ${labCapacity(scientist)} labs (administration ${scientist.skills.administration ?? 0}); ${site.free - labCapacity(scientist)} more are free here.`),
      );
    }

    const actions = el("div", "form-actions");
    actions.append(
      button(
        isRecommended ? "Start research (recommended)" : "Start research",
        () => {
          empire.startProject(tech.id, this.form.colonyId, this.form.scientistId, this.form.labs);
          empire.addLog(
            this.game.clock.seconds,
            "research",
            `${fullName(scientist)} has begun research into ${tech.name}.`,
          );
          this.form.forTech = "";
          this.game.emit();
          this.draw();
        },
        "primary-btn",
      ),
    );
    sec.append(actions);
  }

  private renderActive(body: HTMLElement, tech: Tech): void {
    const { empire } = this.game;
    const project = empire.projects.find((p) => p.techId === tech.id);
    if (!project) return;
    const sec = section(body, "In progress");

    sec.append(progressBar(project.progress / tech.cost));
    const rate = projectRate(empire, project);
    sec.append(
      el("p", "eta-line",
        `${num(project.progress)} of ${num(tech.cost)} RP - ${
          rate > 0 ? `about ${formatYears((tech.cost - project.progress) / rate)} left` : "stalled"
        }`),
    );

    const scientist = empire.officers.get(project.scientistId ?? undefined);
    stat(sec, "Led by", scientist ? fullName(scientist) : "nobody");
    stat(sec, "Rate", `${num(rate)} RP/year`);
    stat(sec, "At", this.game.galaxy.byId.get(project.colonyId)?.name ?? project.colonyId);

    const colony = empire.colony(project.colonyId);
    const available = colony ? installationCount(colony, "research-lab") : 0;
    const cap = scientist ? labCapacity(scientist) : 0;
    const maxLabs = Math.max(1, Math.min(cap || 1, available - empire.labsInUse(project.colonyId, project.id)));

    const row = el("div", "field-row");
    row.append(
      el("label", "field-label", `Labs (up to ${maxLabs})`),
      numberInput(project.labs, (value) => {
        project.labs = value;
        this.game.emit();
        this.draw();
      }, 1, maxLabs),
    );
    sec.append(row);

    const warning = this.projectWarning(project);
    if (warning) sec.append(el("p", "project-warning", warning));

    sec.append(
      button("Cancel research", () => {
        empire.cancelProject(project.id);
        this.game.emit();
        this.draw();
      }),
    );
  }

  /** Why a project might not be progressing at the rate the player expects. */
  private projectWarning(project: ResearchProject): string | null {
    const { empire } = this.game;
    const colony = empire.colony(project.colonyId);
    if (!colony) return "The host colony no longer exists.";
    const scientist = empire.officers.get(project.scientistId ?? undefined);
    if (!scientist) return "No scientist is leading this project, so it is making no progress.";
    const available = installationCount(colony, "research-lab");
    if (empire.labsInUse(project.colonyId) > available) {
      return `Only ${available} laboratories exist here but ${empire.labsInUse(project.colonyId)} are assigned.`;
    }
    if (project.labs > labCapacity(scientist)) {
      return `${scientist.name} can direct ${labCapacity(scientist)} labs; the rest are idle.`;
    }
    return null;
  }

  // ----------------------------------------------------------- scientists

  private renderScientists(body: HTMLElement): void {
    const { empire } = this.game;
    const sec = section(body, "Scientists");
    const field = this.selected ? TECH_BY_ID.get(this.selected)?.field : undefined;

    const scientists = empire.officers
      .byBranch("science")
      .sort((a, b) => Number(Boolean(a.assignment)) - Number(Boolean(b.assignment)) ||
        (b.skills.research ?? 0) - (a.skills.research ?? 0));

    if (!scientists.length) emptyNote(sec, "No scientists in service.");
    for (const scientist of scientists) {
      const project = scientist.assignment
        ? empire.projects.find((p) => p.id === scientist.assignment!.targetId)
        : undefined;
      const row = el("div", "scientist-row");
      row.classList.toggle("fits", Boolean(field && scientist.specialty === field && !scientist.assignment));

      const left = el("div", "scientist-main");
      left.append(el("div", "scientist-name", fullName(scientist)));
      left.append(
        el("div", "muted small",
          `${scientist.specialty ? FIELD_NAMES[scientist.specialty] : ""} - ${labCapacity(scientist)} labs`),
      );
      row.append(left);

      const right = el("div", "scientist-state");
      right.append(el("span", "chip good", `+${scientist.skills.research ?? 0}%`));
      right.append(
        el("div", "small " + (project ? "muted" : "good"),
          project ? `Leading ${TECH_BY_ID.get(project.techId)?.name}` : "Available"),
      );
      row.append(right);
      sec.append(row);
    }
  }
}
