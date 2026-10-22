/**
 * Officers view: the empire's people.
 *
 * Scientists lead research projects, administrators govern colonies. Naval
 * and ground officers are tracked, promoted and retired like everyone else,
 * but have nothing to command until ships and ground forces exist.
 */

import type { Game } from "../../state/game";
import {
  BRANCH_NAMES,
  RATING_SKILLS,
  SKILL_LABELS,
  ageOf,
  labCapacity,
  rankTitle,
  yearsOfService,
  type Branch,
  type Officer,
  type SkillId,
} from "../../sim/people/officers";
import { FIELD_NAMES } from "../../sim/research/fields";
import { TECH_BY_ID } from "../../sim/research/techs";
import { el, num } from "../format";
import { button, emptyNote, section, select, stat } from "../widgets";
import { formatShortDate } from "./economyView";

const BRANCHES: Branch[] = ["science", "civilian", "navy", "ground"];

export class OfficersView {
  private listPane: HTMLElement;
  private detailPane: HTMLElement;
  private branch: Branch = "science";
  private selectedId: string | null = null;

  constructor(private root: HTMLElement, private game: Game) {
    this.root.classList.add("view-officers");
    this.listPane = el("section", "officer-list");
    this.detailPane = el("aside", "panel panel-right");
    this.root.append(this.listPane, this.detailPane);
  }

  render(): void {
    this.renderList();
    this.renderDetail();
  }

  private renderList(): void {
    const { empire } = this.game;
    this.listPane.textContent = "";

    const head = el("div", "panel-head");
    head.append(el("span", undefined, "Commanders & Specialists"));
    head.append(el("span", "muted", `${empire.officers.officers.size} in service`));
    this.listPane.append(head);

    const tabs = el("div", "tabs");
    for (const branch of BRANCHES) {
      const count = empire.officers.byBranch(branch).length;
      const tab = el("button", "tab", `${BRANCH_NAMES[branch]} (${count})`);
      tab.classList.toggle("active", branch === this.branch);
      tab.addEventListener("click", () => {
        this.branch = branch;
        this.render();
      });
      tabs.append(tab);
    }
    this.listPane.append(tabs);

    const now = this.game.clock.seconds;
    const officers = empire.officers
      .byBranch(this.branch)
      .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));

    const table = el("div", "officer-table");
    const header = el("div", "officer-row header");
    header.append(el("span", undefined, "Rank"));
    header.append(el("span", undefined, "Name"));
    header.append(el("span", undefined, "Age"));
    header.append(el("span", undefined, "Skills"));
    header.append(el("span", undefined, "Posting"));
    table.append(header);

    for (const officer of officers) {
      const row = el("div", "officer-row");
      row.classList.toggle("selected", officer.id === this.selectedId);
      row.append(el("span", "officer-rank", rankTitle(officer)));
      row.append(el("span", "officer-name", officer.name));
      row.append(el("span", "right", String(ageOf(officer, now))));

      const skills = el("span", "officer-skills");
      for (const [skill, value] of topSkills(officer, 3)) {
        skills.append(el("span", `chip ${value > 0 ? "good" : "bad"}`, formatSkill(skill, value)));
      }
      row.append(skills);

      row.append(el("span", "officer-post", this.postingText(officer)));
      row.addEventListener("click", () => {
        this.selectedId = officer.id;
        this.render();
      });
      table.append(row);
    }
    this.listPane.append(table);

    if (!officers.length) emptyNote(this.listPane, "Nobody in this branch.");
  }

  private postingText(officer: Officer): string {
    const { empire } = this.game;
    const assignment = officer.assignment;
    if (!assignment) return "unassigned";
    if (assignment.kind === "governor") {
      return `Governor, ${this.game.system.byId.get(assignment.targetId)?.name ?? assignment.targetId}`;
    }
    if (assignment.kind === "fleet") {
      const fleet = empire.fleets.get(assignment.targetId);
      return fleet ? `Commanding ${fleet.name}` : "unassigned";
    }
    const project = empire.projects.find((p) => p.id === assignment.targetId);
    return project ? `Research: ${TECH_BY_ID.get(project.techId)?.name}` : "unassigned";
  }

  private renderDetail(): void {
    const { empire } = this.game;
    this.detailPane.textContent = "";
    const officer = this.selectedId ? empire.officers.get(this.selectedId) : undefined;

    if (!officer) {
      const head = el("div", "panel-head");
      head.append(el("span", undefined, "Service Record"));
      this.detailPane.append(head);
      emptyNote(this.detailPane, "Select an officer.");
      return;
    }

    const now = this.game.clock.seconds;
    const head = el("div", "detail-head");
    head.append(el("div", "detail-title", officer.name));
    head.append(el("div", "detail-sub", `${rankTitle(officer)} - ${BRANCH_NAMES[officer.branch]}`));
    this.detailPane.append(head);

    const body = el("div", "detail-body");
    this.detailPane.append(body);

    const record = section(body, "Service Record");
    stat(record, "Age", `${ageOf(officer, now)}`);
    stat(record, "Commissioned", formatShortDate(officer.commissioned));
    stat(record, "Years of Service", yearsOfService(officer, now).toFixed(1));
    stat(record, "Promoted", formatShortDate(officer.lastPromotion));
    if (officer.specialty) stat(record, "Speciality", FIELD_NAMES[officer.specialty]);
    if (officer.branch === "science") {
      stat(record, "Laboratories", `${labCapacity(officer)} maximum`);
    }

    const skills = section(body, "Skills");
    const entries = Object.entries(officer.skills) as [SkillId, number][];
    if (!entries.length) emptyNote(skills, "No notable skills.");
    for (const [skill, value] of entries.sort((a, b) => b[1] - a[1])) {
      stat(skills, SKILL_LABELS[skill], formatSkill(skill, value), value > 0 ? "good" : value < 0 ? "bad" : undefined);
    }

    this.renderPosting(body, officer);
  }

  private renderPosting(parent: HTMLElement, officer: Officer): void {
    const { empire } = this.game;
    const sec = section(parent, "Posting");
    stat(sec, "Current", this.postingText(officer));

    if (officer.branch === "civilian") {
      const options = [
        { value: "", label: "- unassigned -" },
        ...[...empire.colonies.values()].map((c) => ({
          value: c.bodyId,
          label: `Governor, ${this.game.system.byId.get(c.bodyId)?.name ?? c.bodyId}`,
        })),
      ];
      sec.append(
        select(
          options,
          officer.assignment?.kind === "governor" ? officer.assignment.targetId : "",
          (value) => {
            empire.assignOfficer(
              officer.id,
              value ? { kind: "governor", targetId: value, since: this.game.clock.seconds } : null,
            );
            this.game.emit();
          },
        ),
      );
      return;
    }

    if (officer.branch === "science") {
      // Projects that have lost their lead - a scientist retiring mid-project
      // leaves the labs idle until someone else takes it on.
      const vacant = empire.projects.filter((p) => !empire.officers.get(p.scientistId ?? undefined));
      if (officer.assignment) {
        sec.append(
          button("Stand Down", () => {
            empire.assignOfficer(officer.id, null);
            const project = empire.projects.find((p) => p.scientistId === officer.id);
            if (project) project.scientistId = null;
            this.game.emit();
          }),
        );
      }
      if (!vacant.length) {
        emptyNote(sec, "No leaderless projects. Start one from the Research view.");
        return;
      }
      sec.append(
        select(
          [
            { value: "", label: "- take over a project -" },
            ...vacant.map((p) => ({
              value: p.id,
              label: TECH_BY_ID.get(p.techId)?.name ?? p.techId,
            })),
          ],
          "",
          (value) => {
            if (!value) return;
            const project = empire.projects.find((p) => p.id === value);
            if (!project) return;
            project.scientistId = officer.id;
            empire.assignOfficer(officer.id, {
              kind: "research",
              targetId: project.id,
              since: this.game.clock.seconds,
            });
            this.game.emit();
          },
        ),
      );
      return;
    }

    if (officer.branch === "navy") {
      const fleets = [...empire.fleets.values()];
      if (!fleets.length) {
        emptyNote(sec, "No fleets to command yet. Design a class and lay down a hull.");
        return;
      }
      sec.append(
        select(
          [
            { value: "", label: "- unassigned -" },
            ...fleets.map((f) => ({ value: f.id, label: `Command ${f.name}` })),
          ],
          officer.assignment?.kind === "fleet" ? officer.assignment.targetId : "",
          (value) => {
            // The fleet record carries its own commander, so keep both in step.
            const previous = officer.assignment?.kind === "fleet"
              ? empire.fleets.get(officer.assignment.targetId)
              : undefined;
            if (previous) previous.commanderId = null;
            empire.assignOfficer(
              officer.id,
              value ? { kind: "fleet", targetId: value, since: this.game.clock.seconds } : null,
            );
            const fleet = value ? empire.fleets.get(value) : undefined;
            if (fleet) fleet.commanderId = officer.id;
            this.game.emit();
          },
        ),
      );
      sec.append(
        el("p", "muted small", "Engineering reduces the fuel a fleet burns under way."),
      );
      return;
    }

    emptyNote(sec, "No commands available. Ground postings arrive with ground forces.");
  }
}

function topSkills(officer: Officer, count: number): [SkillId, number][] {
  return (Object.entries(officer.skills) as [SkillId, number][])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, count);
}

function formatSkill(skill: SkillId, value: number): string {
  if (RATING_SKILLS.includes(skill)) return `${SKILL_LABELS[skill]} ${num(value)}`;
  return `${SKILL_LABELS[skill]} ${value > 0 ? "+" : ""}${value}%`;
}
