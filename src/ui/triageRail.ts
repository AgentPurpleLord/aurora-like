/**
 * The triage rail: one prioritised list of everything that needs a decision,
 * visible from every view.
 *
 * Items are derived from state each time the rail renders, so resolving a
 * problem makes its entry disappear. Each carries the action that fixes it.
 */

import type { Game } from "../state/game";
import { activeIssues, countBySeverity, type Issue, type Severity } from "../sim/issues";
import { el } from "./format";

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Note",
};

export class TriageRail {
  private collapsed = false;
  private issues: Issue[] = [];

  constructor(
    private root: HTMLElement,
    private game: Game,
    private onAction: (issue: Issue) => void,
    private onToggle: () => void,
  ) {}

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    this.render();
    this.onToggle();
  }

  render(): void {
    this.issues = activeIssues(this.game.empire, this.game.system, this.game.clock.seconds);
    this.root.classList.toggle("collapsed", this.collapsed);
    this.root.textContent = "";
    if (this.collapsed) this.renderStrip();
    else this.renderFull();
  }

  private counts() {
    return countBySeverity(this.issues);
  }

  /** Collapsed: a 44px strip carrying only the severity counts. */
  private renderStrip(): void {
    const counts = this.counts();
    const toggle = el("button", "rail-toggle", "<");
    toggle.title = "Show attention list";
    toggle.addEventListener("click", () => this.setCollapsed(false));
    this.root.append(toggle);

    for (const severity of ["critical", "warning", "info"] as Severity[]) {
      if (!counts[severity]) continue;
      const chip = el("div", `rail-count ${severity}`, String(counts[severity]));
      chip.title = `${counts[severity]} ${SEVERITY_LABEL[severity].toLowerCase()}`;
      chip.addEventListener("click", () => this.setCollapsed(false));
      this.root.append(chip);
    }
  }

  private renderFull(): void {
    const counts = this.counts();
    const head = el("div", "panel-head rail-head");
    head.append(el("span", undefined, "Attention"));

    const summary = el("span", "rail-summary");
    for (const severity of ["critical", "warning", "info"] as Severity[]) {
      if (!counts[severity]) continue;
      summary.append(el("span", `rail-count ${severity}`, String(counts[severity])));
    }
    head.append(summary);

    const toggle = el("button", "rail-toggle", ">");
    toggle.title = "Hide attention list";
    toggle.addEventListener("click", () => this.setCollapsed(true));
    head.append(toggle);
    this.root.append(head);

    const list = el("div", "rail-list");
    this.root.append(list);

    if (!this.issues.length) {
      list.append(el("p", "muted rail-empty", "Nothing needs attention."));
      return;
    }

    for (const issue of this.issues) {
      const card = el("div", `issue ${issue.severity}`);
      const title = el("div", "issue-title");
      title.append(el("span", `issue-dot ${issue.severity}`));
      title.append(el("span", undefined, issue.title));
      card.append(title);
      card.append(el("div", "issue-detail", issue.detail));

      const actions = el("div", "issue-actions");

      // A proposal leads with the thing it is proposing; everything else
      // leads with where the problem is fixed.
      if (issue.proposal) {
        const accept = el("button", "primary-btn", issue.proposal.label);
        accept.addEventListener("click", () => {
          const { sourceId, installationId, quantity, destination } = issue.proposal!;
          this.game.empire.queueBuild(sourceId, installationId, quantity, destination);
          this.game.empire.addLog(
            this.game.clock.seconds,
            "construction",
            `Accepted: ${issue.proposal!.label}.`,
          );
          this.game.emit();
        });
        actions.append(accept);
      }

      const go = el("button", "ghost-btn", issue.action.label);
      go.addEventListener("click", () => this.onAction(issue));
      actions.append(go);

      const dismiss = el("button", "step-btn", "x");
      dismiss.title = "Dismiss for two years";
      dismiss.addEventListener("click", () => {
        this.game.empire.dismissIssue(issue.id, this.game.clock.seconds);
        this.render();
      });
      actions.append(dismiss);
      card.append(actions);
      list.append(card);
    }
  }
}
