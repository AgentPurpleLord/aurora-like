/**
 * The event log: decisions waiting on you, and everything that has happened.
 *
 * Events are the part of the game that is not under your control, so the log
 * is the place to see the shape of it - what went well, what went wrong, what
 * you chose and what it cost - without having to have been watching.
 */

import type { Game } from "../../state/game";
import type { GameEvent } from "../../sim/events/types";
import { optionsFor, resolveEvent } from "../../sim/events/engine";
import { formatShortDate } from "../../sim/clock";
import { EVENT_FREQUENCY, settings } from "../settings";
import { el } from "../format";
import { button, emptyNote, section } from "../widgets";

type Filter = "all" | "good" | "bad" | "decisions";

export class EventsView {
  private filter: Filter = "all";
  private search = "";

  constructor(
    private root: HTMLElement,
    private game: Game,
    private actions: { open: (eventId: string) => void; navigate: (event: GameEvent) => void },
  ) {
    this.root.classList.add("view-events");
  }

  render(): void {
    const { game } = this;
    const { empire } = game;
    this.root.textContent = "";
    const page = el("div", "events-page");
    this.root.append(page);

    const head = el("div", "events-head");
    head.append(el("h2", undefined, "Events"));
    const good = empire.events.filter((e) => e.tone === "good").length;
    const bad = empire.events.filter((e) => e.tone === "bad").length;
    const rate = settings.events === "off" || empire.eventFrequency <= 0
      ? "Random events are switched off (Settings)."
      : `Random events: ${settings.events}. About ${EVENT_FREQUENCY[settings.events]} a year on average.`;
    head.append(
      el("p", "muted small", `${empire.events.length} so far - ${good} good, ${bad} bad. ${rate}`),
    );
    page.append(head);

    // --- waiting on you
    const pending = empire.pendingEvents;
    if (pending.length) {
      const sec = section(page, `Awaiting your decision (${pending.length})`);
      for (const event of pending) sec.append(this.pendingCard(event));
    }

    // --- history
    const history = section(page, "History");
    const bar = el("div", "events-filters");
    for (const [value, label] of [["all", "All"], ["good", "Good"], ["bad", "Bad"], ["decisions", "Decisions"]] as [Filter, string][]) {
      const btn = el("button", "tool-btn", label);
      btn.classList.toggle("active", this.filter === value);
      btn.addEventListener("click", () => {
        this.filter = value;
        this.render();
      });
      bar.append(btn);
    }
    const find = el("input", "search");
    find.type = "search";
    find.placeholder = "Search events...";
    find.value = this.search;
    find.setAttribute("aria-label", "Search events");
    find.addEventListener("input", () => {
      this.search = find.value.trim().toLowerCase();
      this.renderList(list);
    });
    bar.append(find);
    history.append(bar);

    const list = el("div", "events-list");
    history.append(list);
    this.renderList(list);
  }

  private renderList(list: HTMLElement): void {
    list.textContent = "";
    const rows = this.game.empire.events
      .filter((e) => e.status !== "pending")
      .filter((e) =>
        this.filter === "all" ||
        (this.filter === "decisions" ? e.decision : e.tone === this.filter),
      )
      .filter((e) => !this.search || `${e.title} ${e.text} ${e.outcome ?? ""}`.toLowerCase().includes(this.search));

    if (!rows.length) {
      emptyNote(list, this.game.empire.events.length ? "Nothing matches." : "Nothing has happened yet. Events arrive as the years pass.");
      return;
    }
    for (const event of rows) {
      const row = el("div", `event-row ${event.tone}`);
      const top = el("div", "event-row-head");
      top.append(
        el("span", "event-date", formatShortDate(event.time)),
        el("span", "event-title", event.title),
      );
      if (event.decision) top.append(el("span", "chip", event.status === "expired" ? "lapsed" : "decided"));
      row.append(top, el("div", "event-row-text", event.text));
      if (event.chosen) row.append(el("div", "event-row-chosen", `Chosen: ${event.chosen}`));
      if (event.outcome) row.append(el("div", "event-row-outcome", event.outcome));
      if (event.link) {
        row.append(button("Show", () => this.actions.navigate(event), "ghost-btn event-show"));
      }
      list.append(row);
    }
  }

  private pendingCard(event: GameEvent): HTMLElement {
    const { game } = this;
    const card = el("div", `event-card ${event.tone}`);
    card.dataset.event = event.id;
    card.append(
      el("div", "event-title", event.title),
      el("div", "event-row-text", event.text),
    );
    if (event.expires !== undefined) {
      const days = Math.max(0, Math.round((event.expires - game.clock.seconds) / 86_400));
      card.append(el("div", "muted small", `Settles itself in ${days} days if left.`));
    }
    const options = el("div", "event-options inline");
    for (const option of optionsFor(game.empire, game.galaxy, event, game.clock.seconds)) {
      const choice = el("button", "event-option");
      choice.append(el("span", "event-option-label", option.label));
      if (option.detail) choice.append(el("span", "muted small", option.detail));
      if (option.disabled) {
        choice.disabled = true;
        choice.title = option.disabled;
      }
      choice.addEventListener("click", () => {
        resolveEvent(game.empire, game.galaxy, event.id, option.id, game.clock.seconds);
        game.emit();
      });
      options.append(choice);
    }
    card.append(options);
    const more = el("div", "form-actions");
    more.append(button("Open as a popup", () => this.actions.open(event.id)));
    if (event.link) more.append(button("Look first", () => this.actions.navigate(event)));
    card.append(more);
    return card;
  }
}

