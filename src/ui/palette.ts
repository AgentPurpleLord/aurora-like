/**
 * Command palette: type to go anywhere or do anything.
 *
 * A game this deep has hundreds of things worth reaching - fifty bodies,
 * every colony, fleet, technology and ship class - and no menu hierarchy
 * makes all of them one step away. Search does. It is the answer to "I know
 * what I want, where is it?", which is most of what navigating a big UI is.
 */

import type { Game } from "../state/game";
import { fleetStats } from "../sim/ships/fleet";
import { TECHS } from "../sim/research/techs";
import { techState } from "../sim/research/graph";
import { classLabel } from "../sim/system";
import type { Body } from "../sim/system";
import type { ViewId } from "./app";
import { el } from "./format";
import { settings } from "./settings";

export interface PaletteActions {
  goView(view: ViewId): void;
  openSystem(systemId: string): void;
  openBody(body: Body): void;
  openColony(bodyId: string): void;
  openFleet(fleetId: string): void;
  openTech(techId: string): void;
  openClass(designId: string): void;
  togglePause(): void;
  nextEvent(): void;
  openSaves(): void;
  quickSave(): void;
  quickLoad(): void;
  showDigest(): void;
  pendingEvents(): { id: string; title: string }[];
  openEvent(eventId: string): void;
  startSurvey(fleetId: string): void;
  toggleTheme(): void;
  toggleDensity(): void;
  toggleShipping(): void;
}

interface Entry {
  label: string;
  hint: string;
  kind: string;
  run: () => void;
}

const VIEWS: [ViewId, string, string][] = [
  ["empire", "Empire", "Dashboard: every colony, the mineral ledger, research"],
  ["map", "System Map", "The system to scale, with fleets and lenses"],
  ["system", "System", "Every planet, moon and rock in a system, with details"],
  ["galaxy", "Galaxy", "The neighbouring stars and the jump network"],
  ["events", "Events", "Random events: decisions waiting, and the log"],
  ["colonies", "Colonies", "Industry, mining, terraforming and automation"],
  ["fleets", "Fleets", "Orders, cargo and building ships"],
  ["design", "Design", "Component designer and ship designer"],
  ["research", "Research", "The technology tree"],
  ["officers", "Officers", "Scientists, governors and commanders"],
  ["politics", "Politics", "Factions, laws, political capital and elections"],
];

export class CommandPalette {
  private overlay = el("div", "palette-overlay");
  private input = el("input", "palette-input");
  private list = el("div", "palette-list");
  private entries: Entry[] = [];
  private shown: Entry[] = [];
  private active = 0;

  constructor(
    parent: HTMLElement,
    private game: Game,
    private actions: PaletteActions,
  ) {
    const box = el("div", "palette");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Command palette");
    this.input.type = "text";
    this.input.placeholder = "Go to a body, colony, fleet, technology, class... or run a command";
    this.input.setAttribute("aria-label", "Search");
    box.append(this.input, this.list);
    box.append(el("div", "palette-foot", "Up/Down to choose  -  Enter to open  -  Esc to close"));
    this.overlay.append(box);
    parent.append(this.overlay);

    this.overlay.addEventListener("mousedown", (event) => {
      if (event.target === this.overlay) this.close();
    });
    this.input.addEventListener("input", () => {
      this.active = 0;
      this.renderList();
    });
    this.input.addEventListener("keydown", (event) => this.onKey(event));
  }

  get isOpen(): boolean {
    return this.overlay.classList.contains("open");
  }

  open(): void {
    this.buildEntries();
    this.input.value = "";
    this.active = 0;
    this.overlay.classList.add("open");
    this.renderList();
    this.input.focus();
  }

  close(): void {
    this.overlay.classList.remove("open");
    this.input.blur();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  // -------------------------------------------------------------- entries

  private buildEntries(): void {
    const { game, actions } = this;
    const { empire, galaxy: system } = game;
    const e: Entry[] = [];

    for (const [id, label, hint] of VIEWS) {
      e.push({ label: `Go to ${label}`, hint, kind: "View", run: () => actions.goView(id) });
    }

    e.push(
      { label: game.clock.paused ? "Resume the clock" : "Pause the clock", hint: "Space", kind: "Command", run: actions.togglePause },
      { label: "Skip to the next event", hint: "Runs until something happens  (N)", kind: "Command", run: actions.nextEvent },
      { label: "Save and load...", hint: "Manage saves  (Ctrl S)", kind: "Command", run: actions.openSaves },
      { label: "Quicksave", hint: "Overwrite the quick slot  (F5)", kind: "Command", run: actions.quickSave },
      { label: "Quickload", hint: "Return to the quick slot  (F9)", kind: "Command", run: actions.quickLoad },
      { label: "Show the digest", hint: "What happened since you last looked", kind: "Command", run: actions.showDigest },
      { label: "Switch theme: classic / terminal", hint: "Phosphor-green console look", kind: "Command", run: actions.toggleTheme },
      { label: "Toggle compact density", hint: "Fit more on screen", kind: "Command", run: actions.toggleDensity },
      {
        label: `${empire.civilianShipping ? "Turn off" : "Turn on"} civilian shipping`,
        hint: "Whether installations and colonists move without ships",
        kind: "Command",
        run: actions.toggleShipping,
      },
    );

    for (const pending of actions.pendingEvents()) {
      e.push({ label: `Decide: ${pending.title}`, hint: "An event is waiting on you", kind: "Command", run: () => actions.openEvent(pending.id) });
    }
    for (const star of game.galaxy.systems) {
      const visited = empire.knownSystems.has(star.id);
      e.push({
        label: `System: ${star.name}`,
        hint: visited ? `${star.meta.spectral} - visited` : `${star.meta.spectral} - ${star.meta.distanceLy} ly, unexplored`,
        kind: "System",
        run: () => actions.openSystem(star.id),
      });
    }

    for (const colony of empire.colonies.values()) {
      const body = system.byId.get(colony.bodyId);
      if (!body) continue;
      e.push({ label: `Colony: ${body.name}`, hint: "Open its industry, mining and automation", kind: "Colony", run: () => actions.openColony(body.id) });
    }
    for (const body of system.bodies) {
      if (!empire.knownSystems.has(body.systemId)) continue;
      e.push({
        label: body.name,
        hint: `${classLabel(body)}${body.parent ? ` of ${body.parent.name}` : ""} - show on the map`,
        kind: "Body",
        run: () => actions.openBody(body),
      });
    }
    for (const fleet of empire.fleets.values()) {
      e.push({ label: `Fleet: ${fleet.name}`, hint: `${fleet.shipIds.length} ships`, kind: "Fleet", run: () => actions.openFleet(fleet.id) });
      if (!fleet.program && fleetStats(empire, fleet).canSurvey) {
        e.push({
          label: `Survey the whole system with ${fleet.name}`,
          hint: "Standing programme: nearest body first, refuels itself",
          kind: "Command",
          run: () => actions.startSurvey(fleet.id),
        });
      }
    }
    for (const tech of TECHS) {
      const state = techState(empire, tech);
      // Technology that is not available yet stays out of search, like the research board.
      if (state === "locked" && !settings.showLocked) continue;
      e.push({
        label: tech.name,
        hint: `${state === "available" ? "Ready to research" : state === "locked" ? "Locked" : state === "active" ? "In progress" : "Researched"} - ${tech.description}`,
        kind: "Tech",
        run: () => actions.openTech(tech.id),
      });
    }
    for (const design of empire.designs) {
      e.push({ label: `Class: ${design.name}`, hint: "Open in the ship designer", kind: "Class", run: () => actions.openClass(design.id) });
    }
    this.entries = e;
  }

  // --------------------------------------------------------------- search

  private score(entry: Entry, tokens: string[]): number {
    const label = entry.label.toLowerCase();
    const hint = entry.hint.toLowerCase();
    let total = 0;
    for (const token of tokens) {
      let best = 0;
      if (label.startsWith(token)) best = 100;
      else if (label.split(/[\s:]+/).some((w) => w.startsWith(token))) best = 70;
      else if (label.includes(token)) best = 45;
      else if (hint.includes(token)) best = 15;
      else if (this.subsequence(label, token)) best = 8;
      if (best === 0) return 0;
      total += best;
    }
    return total;
  }

  private subsequence(text: string, token: string): boolean {
    let at = 0;
    for (const ch of token) {
      at = text.indexOf(ch, at);
      if (at < 0) return false;
      at++;
    }
    return true;
  }

  private renderList(): void {
    const query = this.input.value.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);

    if (!tokens.length) {
      // Nothing typed: the things most worth a shortcut.
      this.shown = this.entries.filter((e) => e.kind === "View" || e.kind === "Command").slice(0, 12);
    } else {
      this.shown = this.entries
        .map((entry) => ({ entry, score: this.score(entry, tokens) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((r) => r.entry);
    }

    this.list.textContent = "";
    if (!this.shown.length) {
      this.list.append(el("div", "palette-empty", "Nothing matches."));
      return;
    }
    this.shown.forEach((entry, index) => {
      const row = el("div", "palette-row");
      row.classList.toggle("active", index === this.active);
      row.append(el("span", "palette-kind", entry.kind));
      const text = el("span", "palette-text");
      text.append(el("span", "palette-label", entry.label), el("span", "palette-hint", entry.hint));
      row.append(text);
      row.addEventListener("mousemove", () => {
        if (this.active === index) return;
        this.active = index;
        this.highlight();
      });
      row.addEventListener("click", () => this.choose(index));
      this.list.append(row);
    });
  }

  private highlight(): void {
    Array.from(this.list.children).forEach((child, i) => {
      child.classList.toggle("active", i === this.active);
      if (i === this.active) (child as HTMLElement).scrollIntoView({ block: "nearest" });
    });
  }

  private choose(index: number): void {
    const entry = this.shown[index];
    if (!entry) return;
    this.close();
    entry.run();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.active = Math.min(this.shown.length - 1, this.active + 1);
      this.highlight();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.active = Math.max(0, this.active - 1);
      this.highlight();
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.choose(this.active);
    }
  }
}
