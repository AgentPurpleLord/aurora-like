/**
 * Research view: projects under way, the tech tree, and the scientists
 * available to direct them.
 *
 * A project needs three things - a tech whose prerequisites are met, a
 * scientist, and laboratories on a colony. A scientist can only direct as
 * many labs as their administration rating allows, so a brilliant researcher
 * with poor administration is a specialist, not a department head.
 */

import type { Game } from "../../state/game";
import type { ResearchProject } from "../../state/empire";
import { installationCount } from "../../state/colony";
import { FIELD_NAMES, RESEARCH_FIELDS, type ResearchField } from "../../sim/research/fields";
import { TECHS, TECH_BY_ID, availableTechs, type Tech } from "../../sim/research/techs";
import { fullName, labCapacity, type Officer } from "../../sim/people/officers";
import { el, num } from "../format";
import { button, emptyNote, numberInput, progressBar, section, select, stat } from "../widgets";
import { formatYears } from "./economyView";

export class ResearchView {
  private projectsPane: HTMLElement;
  private treePane: HTMLElement;
  private scientistPane: HTMLElement;

  /** Tech the player is currently setting up, if any. */
  private pending: { techId: string; scientistId: string; colonyId: string; labs: number } | null = null;
  private collapsed = new Set<ResearchField>();

  constructor(private root: HTMLElement, private game: Game) {
    this.root.classList.add("view-research");
    this.projectsPane = el("aside", "panel panel-left");
    this.treePane = el("section", "tech-tree");
    this.scientistPane = el("aside", "panel panel-right");
    this.root.append(this.projectsPane, this.treePane, this.scientistPane);
  }

  render(): void {
    this.renderProjects();
    this.renderTree();
    this.renderScientists();
  }

  // -------------------------------------------------------------- projects

  private renderProjects(): void {
    const { empire } = this.game;
    this.projectsPane.textContent = "";
    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Projects"));
    head.append(el("span", "muted", `${empire.projects.length} active`));
    this.projectsPane.append(head);

    const body = el("div", "detail-body");
    this.projectsPane.append(body);

    if (!empire.projects.length) {
      emptyNote(body, "No research under way. Pick a technology from the tree.");
    }

    for (const project of empire.projects) {
      const tech = TECH_BY_ID.get(project.techId);
      if (!tech) continue;
      const card = el("div", "project-card");
      card.append(el("div", "project-name", tech.name));
      card.append(el("div", "project-field", FIELD_NAMES[tech.field]));

      const scientist = empire.officers.get(project.scientistId ?? undefined);
      card.append(
        el("div", "project-lead", scientist ? fullName(scientist) : "unassigned - no progress"),
      );

      const colonyName = this.game.system.byId.get(project.colonyId)?.name ?? project.colonyId;
      card.append(
        el("div", "project-meta", `${num(project.labs)} labs at ${colonyName}`),
      );

      card.append(progressBar(project.progress / tech.cost));
      const remaining = tech.cost - project.progress;
      card.append(
        el(
          "div",
          "project-meta",
          `${num(project.progress)} / ${num(tech.cost)} RP  -  ${
            project.lastRate > 0 ? formatYears(remaining / project.lastRate) : "stalled"
          }`,
        ),
      );

      const controls = el("div", "project-controls");
      controls.append(
        el("span", "muted small", "Labs"),
        numberInput(
          project.labs,
          (value) => {
            project.labs = value;
            this.game.emit();
          },
          1,
          999,
        ),
      );
      controls.append(
        button("Cancel", () => {
          empire.cancelProject(project.id);
          this.game.emit();
        }),
      );
      card.append(controls);

      const warning = this.projectWarning(project);
      if (warning) card.append(el("div", "project-warning", warning));

      body.append(card);
    }
  }

  /** Why a project might not be progressing at the rate the player expects. */
  private projectWarning(project: ResearchProject): string | null {
    const { empire } = this.game;
    const colony = empire.colony(project.colonyId);
    if (!colony) return "The host colony no longer exists.";
    const scientist = empire.officers.get(project.scientistId ?? undefined);
    if (!scientist) return "No scientist assigned - the project is idle.";

    const available = installationCount(colony, "research-lab");
    const committed = empire.labsInUse(project.colonyId);
    if (committed > available) {
      return `Only ${available} laboratories exist here but ${committed} are assigned.`;
    }
    const capacity = labCapacity(scientist);
    if (project.labs > capacity) {
      return `${scientist.name} can direct ${capacity} labs (administration ${scientist.skills.administration ?? 0}).`;
    }
    return null;
  }

  // ------------------------------------------------------------- tech tree

  private renderTree(): void {
    const { empire } = this.game;
    this.treePane.textContent = "";

    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Technology"));
    head.append(
      el("span", "muted", `${empire.researched.size} of ${TECHS.length} researched`),
    );
    this.treePane.append(head);

    const body = el("div", "detail-body");
    this.treePane.append(body);

    const available = new Set(availableTechs(empire.researched).map((t) => t.id));
    const inProgress = new Map(empire.projects.map((p) => [p.techId, p]));

    for (const field of RESEARCH_FIELDS) {
      const techs = TECHS.filter((t) => t.field === field);
      const done = techs.filter((t) => empire.researched.has(t.id)).length;

      const group = el("div", "tech-group");
      const groupHead = el("div", "tech-group-head");
      groupHead.append(el("span", "tech-group-name", FIELD_NAMES[field]));
      groupHead.append(el("span", "muted small", `${done}/${techs.length}`));
      groupHead.addEventListener("click", () => {
        if (this.collapsed.has(field)) this.collapsed.delete(field);
        else this.collapsed.add(field);
        this.renderTree();
      });
      group.append(groupHead);

      if (!this.collapsed.has(field)) {
        for (const tech of techs) {
          group.append(this.techRow(tech, available.has(tech.id), inProgress.has(tech.id)));
        }
      }
      body.append(group);
    }
  }

  private techRow(tech: Tech, isAvailable: boolean, isActive: boolean): HTMLElement {
    const { empire } = this.game;
    const researched = empire.researched.has(tech.id);
    const row = el("div", "tech-row");
    row.classList.toggle("researched", researched);
    row.classList.toggle("locked", !researched && !isAvailable);

    const main = el("div", "tech-main");
    const name = el("span", "tech-name", tech.name);
    main.append(name);
    if (tech.future) {
      const chip = el("span", "chip future", "future system");
      chip.title = "Researchable now; its effects arrive with ship design and combat.";
      main.append(chip);
    }
    main.append(el("span", "tech-cost", researched ? "researched" : `${num(tech.cost)} RP`));
    row.append(main);
    row.append(el("div", "tech-desc", tech.description));

    if (!researched && !isAvailable) {
      const missing = tech.prereqs
        .filter((p) => !empire.researched.has(p))
        .map((p) => TECH_BY_ID.get(p)?.name ?? p);
      row.append(el("div", "tech-prereq", `Requires: ${missing.join(", ")}`));
    }

    if (!researched && isAvailable) {
      if (isActive) {
        row.append(el("div", "tech-prereq", "Research under way."));
      } else if (this.pending?.techId === tech.id) {
        row.append(this.assignmentForm(tech));
      } else {
        row.append(
          button(
            "Begin Research",
            () => {
              this.pending = {
                techId: tech.id,
                scientistId: this.suggestScientist(tech)?.id ?? "",
                colonyId: this.suggestColony(),
                labs: 10,
              };
              this.renderTree();
            },
            "ghost-btn",
          ),
        );
      }
    }
    return row;
  }

  /** Inline form: who leads the project, where, and with how many labs. */
  private assignmentForm(tech: Tech): HTMLElement {
    const { empire } = this.game;
    const pending = this.pending!;
    const form = el("div", "assign-form");

    const scientists = empire.officers
      .byBranch("science")
      .filter((o) => !o.assignment)
      .sort((a, b) => scientistScore(b, tech.field) - scientistScore(a, tech.field));

    if (!scientists.length) {
      emptyNote(form, "Every scientist is already leading a project.");
      form.append(button("Close", () => { this.pending = null; this.renderTree(); }));
      return form;
    }

    form.append(
      el("span", "muted small", "Scientist"),
      select(
        scientists.map((o) => ({
          value: o.id,
          label: `${fullName(o)} - ${o.skills.research ?? 0}% ${
            o.specialty === tech.field ? "(specialist)" : `(${o.specialty})`
          }, ${labCapacity(o)} labs`,
        })),
        pending.scientistId || scientists[0].id,
        (value) => {
          pending.scientistId = value;
          this.renderTree();
        },
      ),
    );

    const colonies = [...empire.colonies.values()].filter(
      (c) => installationCount(c, "research-lab") > 0,
    );
    form.append(
      el("span", "muted small", "Laboratories at"),
      select(
        colonies.map((c) => ({
          value: c.bodyId,
          label: `${this.game.system.byId.get(c.bodyId)?.name ?? c.bodyId} (${
            installationCount(c, "research-lab") - empire.labsInUse(c.bodyId)
          } free)`,
        })),
        pending.colonyId,
        (value) => {
          pending.colonyId = value;
          this.renderTree();
        },
      ),
    );

    const colony = empire.colony(pending.colonyId);
    const free = colony ? installationCount(colony, "research-lab") - empire.labsInUse(colony.bodyId) : 0;
    const scientist = empire.officers.get(pending.scientistId || scientists[0].id);
    const maxLabs = Math.max(1, Math.min(free, scientist ? labCapacity(scientist) : 1));

    form.append(
      el("span", "muted small", `Labs (max ${maxLabs})`),
      numberInput(Math.min(pending.labs, maxLabs), (value) => (pending.labs = value), 1, Math.max(1, maxLabs)),
    );

    const actions = el("div", "form-actions");
    actions.append(
      button(
        "Start",
        () => {
          const labs = Math.min(pending.labs, maxLabs);
          empire.startProject(tech.id, pending.colonyId, pending.scientistId || scientists[0].id, labs);
          const lead = empire.officers.get(pending.scientistId || scientists[0].id);
          empire.addLog(
            this.game.clock.seconds,
            "research",
            `${lead ? fullName(lead) : "A team"} has begun research into ${tech.name}.`,
          );
          this.pending = null;
          this.game.emit();
        },
        "primary-btn",
      ),
    );
    actions.append(button("Cancel", () => { this.pending = null; this.renderTree(); }));
    form.append(actions);
    return form;
  }

  private suggestScientist(tech: Tech): Officer | undefined {
    return this.game.empire.officers
      .byBranch("science")
      .filter((o) => !o.assignment)
      .sort((a, b) => scientistScore(b, tech.field) - scientistScore(a, tech.field))[0];
  }

  private suggestColony(): string {
    const { empire } = this.game;
    let best = empire.capital;
    let bestFree = -1;
    for (const colony of empire.colonies.values()) {
      const free = installationCount(colony, "research-lab") - empire.labsInUse(colony.bodyId);
      if (free > bestFree) {
        bestFree = free;
        best = colony.bodyId;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ scientists

  private renderScientists(): void {
    const { empire } = this.game;
    this.scientistPane.textContent = "";
    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Scientists"));
    this.scientistPane.append(head);

    const body = el("div", "detail-body");
    this.scientistPane.append(body);

    const scientists = empire.officers
      .byBranch("science")
      .sort((a, b) => (b.skills.research ?? 0) - (a.skills.research ?? 0));

    for (const scientist of scientists) {
      const card = el("div", "officer-card");
      card.append(el("div", "officer-name", fullName(scientist)));
      const spec = el("div", "officer-meta", scientist.specialty ? FIELD_NAMES[scientist.specialty] : "");
      card.append(spec);

      const row = el("div", "officer-skills");
      row.append(el("span", "chip good", `Research +${scientist.skills.research ?? 0}%`));
      row.append(el("span", "chip", `${labCapacity(scientist)} labs`));
      card.append(row);

      const project = scientist.assignment
        ? empire.projects.find((p) => p.id === scientist.assignment!.targetId)
        : undefined;
      card.append(
        el(
          "div",
          "officer-post",
          project ? `Leading ${TECH_BY_ID.get(project.techId)?.name}` : "Available",
        ),
      );
      body.append(card);
    }

    if (!scientists.length) emptyNote(body, "No scientists in service.");

    const stats = section(body, "Empire Research");
    stat(stats, "Rate per Laboratory", `${num(empire.stats.researchRate)} RP / year`);
    stat(stats, "Total Output", `${num(empire.snapshot.researchPoints)} RP / year`);
  }
}

/** Rank scientists for a field: specialists first, then raw bonus. */
function scientistScore(officer: Officer, field: ResearchField): number {
  return (officer.skills.research ?? 0) + (officer.specialty === field ? 100 : 0);
}
