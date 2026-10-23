/** Wires the map, the views, the panels and input into a running application. */

import { SystemMapRenderer, formatAu, type FleetMarker, type RenderOptions } from "../render/map";
import { destinationOf } from "../sim/ships/fleet";
import type { Game } from "../state/game";
import { classLabel, type Body, type StarSystem } from "../sim/system";
import { AU_KM } from "../sim/orbit";
import { BodyTreePanel } from "./bodyTree";
import { DetailPanel } from "./detailPanel";
import { TimeControls } from "./timeControls";
import { EconomyView } from "./views/economyView";
import { EmpireView } from "./views/empireView";
import { TriageRail } from "./triageRail";
import type { Issue } from "../sim/issues";
import { ResearchView } from "./views/researchView";
import { OfficersView } from "./views/officersView";
import { FleetsView } from "./views/fleetsView";
import { DesignView } from "./views/designView";
import { GalaxyView } from "./views/galaxyView";
import { distance, el, lightTime, num } from "./format";
import { CommandPalette } from "./palette";
import { SettingsMenu } from "./settingsMenu";
import { Toasts } from "./toasts";
import { applyDensity, saveSettings, settings } from "./settings";
import { LENSES, LENS_BY_ID, hoverLines, type LensId } from "./lenses";
import { IMPORTANT_CATEGORIES, type LogEntry, type LogLink } from "../state/empire";
import { QUICKSAVE_ID, listSaves, requestLoad, saveAuto, saveQuick, type SaveMeta } from "../state/save";
import { buildDigest, worthShowing } from "../sim/digest";
import { formatShortDate } from "../sim/clock";
import { openSaveDialog } from "./saveDialog";
import { openDigestDialog } from "./digestDialog";
import { dialogOpen } from "./dialog";

interface ZoomPreset {
  label: string;
  /** Half-width of the view in AU. */
  spanAu: number;
  center?: string;
}

const ZOOM_PRESETS: ZoomPreset[] = [
  { label: "Earth", spanAu: 0.02, center: "earth" },
  { label: "Inner", spanAu: 2.2 },
  { label: "Belt", spanAu: 4.2 },
  { label: "Jovian", spanAu: 0.02, center: "jupiter" },
  { label: "Saturnian", spanAu: 0.035, center: "saturn" },
  { label: "Outer", spanAu: 33 },
  { label: "Kuiper", spanAu: 75 },
];

export type ViewId = "empire" | "map" | "galaxy" | "colonies" | "fleets" | "design" | "research" | "officers";

const VIEW_TABS: { id: ViewId; label: string; key: string }[] = [
  { id: "empire", label: "Empire", key: "e" },
  { id: "map", label: "Map", key: "m" },
  { id: "galaxy", label: "Galaxy", key: "x" },
  { id: "colonies", label: "Colonies", key: "c" },
  { id: "fleets", label: "Fleets", key: "f" },
  { id: "design", label: "Design", key: "d" },
  { id: "research", label: "Research", key: "r" },
  { id: "officers", label: "Officers", key: "o" },
];

/** The rail costs real estate the map wants, so it starts folded there. */
const RAIL_COLLAPSED_BY_DEFAULT: Record<ViewId, boolean> = {
  empire: false,
  galaxy: true,
  map: true,
  colonies: false,
  fleets: false,
  design: true,
  research: false,
  officers: false,
};

export interface AppRoots {
  tree: HTMLElement;
  detail: HTMLElement;
  time: HTMLElement;
  tools: HTMLElement;
  overlay: HTMLElement;
  tabs: HTMLElement;
  empireBar: HTMLElement;
  rail: HTMLElement;
  paletteButton: HTMLElement;
  settingsHost: HTMLElement;
  saveButton: HTMLElement;
  views: Record<ViewId, HTMLElement>;
}

/** Screens on a phone's bottom bar; the rest live behind "More". */
const PRIMARY_VIEWS: ViewId[] = ["empire", "map", "colonies", "fleets"];

export class App {
  private renderer: SystemMapRenderer;
  private tree: BodyTreePanel;
  private detail: DetailPanel;
  private time: TimeControls;
  private empireView: EmpireView;
  private economy: EconomyView;
  private research: ResearchView;
  private officers: OfficersView;
  private fleetsView: FleetsView;
  private designView: DesignView;
  private galaxyView: GalaxyView;
  /** The map-tools controls that depend on which system is showing. */
  private zoomGroup = el("div", "tool-group");
  private systemSelect = el("select", "tool-select");
  private shownSystemId = "";
  private rail: TriageRail;
  private toasts: Toasts;
  private palette: CommandPalette;
  private moreSheet = el("div", "more-sheet");
  private lens: LensId = (LENS_BY_ID.has(settings.lens as LensId) ? settings.lens : "default") as LensId;
  private legend = el("div", "map-legend");
  private hoverCard = el("div", "map-hover");
  /** Real time of the last autosave, and whether anything changed since. */
  private lastAutosave = Date.now();
  private dirty = false;
  /** The review mark a digest was last offered for, so it is offered once. */
  private digestOfferedFor = -1;
  /** Newest log entry already turned into a toast. */
  private toastSeq = 0;
  private lastToastClock = 0;

  private view: ViewId = "empire";
  /** The map camera cannot be framed until its container has a size. */
  private mapFramed = false;
  private railCollapsed: Record<ViewId, boolean> = { ...RAIL_COLLAPSED_BY_DEFAULT };
  private hovered: Body | null = null;
  private lastFrame = performance.now();
  private dragging = false;
  private dragMoved = 0;
  private pointer = { x: 0, y: 0 };
  /** Active pointers on the canvas, for drag and pinch. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance: number | null = null;
  private readonly narrow = window.matchMedia("(max-width: 860px)");

  private options: RenderOptions = {
    showOrbits: true,
    showLabels: true,
    showBelts: true,
    showGrid: true,
    showFleets: true,
  };

  constructor(
    private canvas: HTMLCanvasElement,
    private roots: AppRoots,
    private game: Game,
    startup: { resumed: SaveMeta | null; error?: string } = { resumed: null },
  ) {
    this.renderer = new SystemMapRenderer(canvas, this.game.viewSystem);
    this.renderer.setKnowledge(
      (body) => body.cls !== "jump-point" || this.game.empire.knownJumpPoints.has(body.id),
      (body) =>
        this.game.empire.gates.has(body.id)
          ? "gate"
          : this.game.empire.exploredJumpPoints.has(body.id) ? "explored" : "unexplored",
    );
    this.shownSystemId = this.game.viewSystem.id;
    this.tree = new BodyTreePanel(roots.tree, this.game, (b) => this.zoomTo(b));
    this.detail = new DetailPanel(roots.detail, this.game, {
      zoomTo: (b) => this.zoomTo(b),
      openEconomy: () => this.setView("colonies"),
      openFleets: () => this.setView("fleets"),
    });
    this.time = new TimeControls(roots.time, this.game, () => this.nextEvent());
    this.economy = new EconomyView(roots.views.colonies, this.game);
    this.research = new ResearchView(roots.views.research, this.game);
    this.officers = new OfficersView(roots.views.officers, this.game);
    this.empireView = new EmpireView(
      roots.views.empire,
      this.game,
      (bodyId) => this.openColony(bodyId),
      (link) => this.navigate(link),
      () => this.openDigest(),
    );
    this.fleetsView = new FleetsView(roots.views.fleets, this.game, {
      openDesigner: (classId) => {
        this.designView.focusClass(classId);
        this.setView("design");
      },
    });
    this.designView = new DesignView(roots.views.design, this.game, {
      openFleets: () => this.setView("fleets"),
    });
    this.galaxyView = new GalaxyView(roots.views.galaxy, this.game, {
      openSystem: (systemId) => {
        this.game.setViewSystem(systemId);
        const star = this.game.galaxy.systemById.get(systemId)?.root;
        this.game.select(star ?? null);
        this.setView("map");
        this.syncSystem(true);
      },
      openFleet: (fleetId) => this.navigate({ view: "fleets", fleetId }),
      showView: () => this.setView("galaxy"),
    });
    this.rail = new TriageRail(
      roots.rail,
      this.game,
      (issue) => this.followIssue(issue),
      () => this.onRailToggled(),
    );

    this.toasts = new Toasts(document.getElementById("app")!, (link) => this.navigate(link));
    this.palette = new CommandPalette(document.getElementById("app")!, this.game, {
      goView: (view) => this.setView(view),
      openSystem: (systemId) => this.galaxyView.show(systemId),
      openBody: (body) => this.zoomTo(body),
      openColony: (bodyId) => this.openColony(bodyId),
      openFleet: (fleetId) => this.navigate({ view: "fleets", fleetId }),
      openTech: (techId) => this.navigate({ view: "research", techId }),
      openClass: (designId) => {
        this.designView.focusClass(designId);
        this.setView("design");
      },
      togglePause: () => {
        this.game.clock.togglePause();
        this.time.refresh(true);
      },
      nextEvent: () => this.nextEvent(),
      openSaves: () => this.openSaves(),
      quickSave: () => this.quickSave(),
      quickLoad: () => this.quickLoad(),
      showDigest: () => this.openDigest(),
      startSurvey: (fleetId) => {
        const fleet = this.game.empire.fleets.get(fleetId);
        if (fleet) {
          fleet.program = { kind: "survey", maxAu: 0 };
          fleet.waitUntil = 0;
        }
        this.navigate({ view: "fleets", fleetId });
        this.game.emit();
      },
      toggleDensity: () => {
        settings.density = settings.density === "compact" ? "comfortable" : "compact";
        applyDensity();
        saveSettings();
      },
      toggleShipping: () => {
        this.game.empire.civilianShipping = !this.game.empire.civilianShipping;
        this.game.emit();
      },
    });
    // The menu owns its own button and panel; it only needs to tell us when to redraw.
    new SettingsMenu(roots.settingsHost, () => this.renderActiveView());
    roots.paletteButton.addEventListener("click", () => this.palette.open());
    roots.saveButton.addEventListener("click", () => this.openSaves());

    // Events that stop the clock are the player's choice, remembered.
    this.game.autoPauseFilter = (entry) => settings.autoPause[entry.category];

    this.buildViewTabs();
    this.buildTools(roots.tools);

    this.game.subscribe(() => {
      this.syncSystem();
      this.detail.render();
      this.tree.rebuild();
      this.renderActiveView();
      this.rail.render();
      this.updateBadges();
      this.announceEvents();
      this.dirty = true;
      this.offerDigest();
    });

    this.bindCanvas();
    this.bindKeys();
    window.addEventListener("resize", () => this.renderer.resize());

    // On a phone the rail is a sheet rather than a column, so it starts
    // folded everywhere and is summoned when wanted.
    if (this.narrow.matches) this.foldRailEverywhere();
    this.placeTabs();
    this.narrow.addEventListener("change", (event) => {
      if (event.matches) this.foldRailEverywhere();
      else this.railCollapsed = { ...RAIL_COLLAPSED_BY_DEFAULT };
      this.placeTabs();
      this.applyRailState();
      requestAnimationFrame(() => this.renderer.resize());
    });

    this.applyRailState();
    this.renderActiveView();
    this.rail.render();
    this.updateBadges();
    this.toastSeq = this.game.empire.logSeq;
    this.startAutosave();
    this.announceStartup(startup);
    this.frame();
  }

  // ------------------------------------------------------- saving, digest

  /** Autosave while the tab is open, and when it is hidden or closed. */
  private startAutosave(): void {
    const AUTOSAVE_MS = 120_000;
    window.setInterval(() => {
      if (this.dirty && Date.now() - this.lastAutosave >= AUTOSAVE_MS) this.autosave();
    }, 15_000);
    const flush = () => {
      if (this.dirty && Date.now() - this.lastAutosave > 3_000) this.autosave();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  private autosave(): void {
    const result = saveAuto(this.game);
    this.lastAutosave = Date.now();
    if (result.ok) {
      this.dirty = false;
    } else {
      this.toasts.push({ title: "Autosave failed", text: result.error ?? "Could not save.", category: "info" });
    }
  }

  private openSaves(): void {
    openSaveDialog(this.game, {
      saved: () => {
        this.lastAutosave = Date.now();
      },
      toast: (text) => this.toasts.push({ text, category: "info" }),
    });
  }

  private quickSave(): void {
    const result = saveQuick(this.game);
    this.toasts.push({
      text: result.ok ? `Quicksaved ${formatShortDate(this.game.clock.seconds)}.` : (result.error ?? "Could not save."),
      category: "info",
    });
  }

  private quickLoad(): void {
    if (!listSaves().some((m) => m.id === QUICKSAVE_ID)) {
      this.toasts.push({ text: "There is no quicksave yet. Press F5 to make one.", category: "info" });
      return;
    }
    requestLoad(QUICKSAVE_ID);
  }

  private openDigest(): void {
    openDigestDialog(this.game, (link) => this.navigate(link), () => this.game.emit());
  }

  /**
   * After a long run of time with news in it, offer the digest once the clock
   * is stopped - never mid-run, when the player is watching.
   */
  private offerDigest(): void {
    const { game } = this;
    const mark = game.empire.reviewMark;
    if (!game.clock.paused || dialogOpen() || this.digestOfferedFor === mark.seq) return;
    // Cheap test first: this runs on every change.
    if (game.clock.seconds - mark.time < 30 * 86_400 || game.empire.logSeq - mark.seq < 3) return;
    const digest = buildDigest(game.empire, game.galaxy, game.clock.seconds);
    if (!worthShowing(digest)) return;
    this.digestOfferedFor = mark.seq;
    const events = digest.groups.reduce((sum, g) => sum + g.entries.length, 0);
    this.toasts.push({
      title: "While you were away",
      text: `${events} events over ${Math.round(digest.days)} days.`,
      category: "info",
      action: { label: "Review digest", run: () => this.openDigest() },
      lifetime: 20_000,
    });
  }

  private announceStartup(startup: { resumed: SaveMeta | null; error?: string }): void {
    if (startup.error) {
      this.toasts.push({ title: "Could not load save", text: startup.error, category: "info", lifetime: 15_000 });
    }
    if (startup.resumed) {
      this.toasts.push({
        title: "Game loaded",
        text: `${startup.resumed.name} - ${formatShortDate(startup.resumed.gameTime)}. The clock is paused.`,
        category: "info",
      });
      this.dirty = false;
      this.offerDigest();
    }
  }

  // ----------------------------------------------------------------- views

  private buildViewTabs(): void {
    const tabs = this.roots.tabs;
    for (const tab of VIEW_TABS) {
      const btn = el("button", "view-tab");
      btn.dataset.view = tab.id;
      btn.append(el("span", "tab-label", tab.label), el("span", "tab-badge-dot"));
      btn.title = `${tab.label}  (${tab.key.toUpperCase()})`;
      // The badge is extra information; the name of the screen stays the name.
      btn.setAttribute("aria-label", tab.label);
      // Screens past the first four fold behind "More" on a phone.
      if (!PRIMARY_VIEWS.includes(tab.id)) btn.classList.add("secondary");
      btn.addEventListener("click", () => this.setView(tab.id));
      tabs.append(btn);
    }

    const more = el("button", "view-tab more-tab");
    more.append(el("span", "tab-label", "More"), el("span", "tab-badge-dot"));
    more.setAttribute("aria-label", "More screens");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      this.moreSheet.classList.toggle("open");
    });
    for (const tab of VIEW_TABS.filter((t) => !PRIMARY_VIEWS.includes(t.id))) {
      const entry = el("button", "more-entry");
      entry.dataset.view = tab.id;
      entry.setAttribute("aria-label", tab.label);
      entry.append(el("span", undefined, tab.label), el("span", "tab-badge-dot"));
      entry.addEventListener("click", () => {
        this.moreSheet.classList.remove("open");
        this.setView(tab.id);
      });
      this.moreSheet.append(entry);
    }
    document.addEventListener("click", () => this.moreSheet.classList.remove("open"));
    tabs.append(more, this.moreSheet);
    this.syncViewTabs();
  }

  /** A dot on each screen that has something wrong, coloured by how wrong. */
  private updateBadges(): void {
    const worst = new Map<string, { count: number; severity: string }>();
    for (const issue of this.rail.current) {
      if (issue.severity === "info") continue;
      const entry = worst.get(issue.action.view) ?? { count: 0, severity: "warning" };
      entry.count++;
      if (issue.severity === "critical") entry.severity = "critical";
      worst.set(issue.action.view, entry);
    }
    const apply = (node: Element, view: string | undefined) => {
      const dot = node.querySelector(".tab-badge-dot") as HTMLElement | null;
      const info = view ? worst.get(view) : undefined;
      if (!dot) return;
      dot.className = `tab-badge-dot${info ? ` on ${info.severity}` : ""}`;
      dot.textContent = info ? String(info.count) : "";
      dot.title = info ? `${info.count} item${info.count === 1 ? "" : "s"} need attention here` : "";
    };
    for (const node of Array.from(this.roots.tabs.querySelectorAll(".view-tab[data-view], .more-entry"))) {
      apply(node, (node as HTMLElement).dataset.view);
    }
    // The More button carries the worst of whatever it hides.
    const hidden = VIEW_TABS.filter((t) => !PRIMARY_VIEWS.includes(t.id)).map((t) => worst.get(t.id));
    const moreDot = this.roots.tabs.querySelector(".more-tab .tab-badge-dot") as HTMLElement | null;
    if (moreDot) {
      const total = hidden.reduce((n, h) => n + (h?.count ?? 0), 0);
      const critical = hidden.some((h) => h?.severity === "critical");
      moreDot.className = `tab-badge-dot${total ? ` on ${critical ? "critical" : "warning"}` : ""}`;
      moreDot.textContent = total ? String(total) : "";
    }
  }

  // ------------------------------------------------- events and navigation

  /** Turn fresh events into toasts, and explain a pause. */
  private announceEvents(): void {
    const { empire, clock } = this.game;
    const fresh = empire.logSince(this.toastSeq);
    this.toastSeq = empire.logSeq;

    // If no time passed this was the player's own action, which they know about.
    const advanced = clock.seconds !== this.lastToastClock;
    this.lastToastClock = clock.seconds;
    const pausedBy = this.game.pausedBy;
    this.game.pausedBy = null;

    if (pausedBy) {
      this.toasts.push({
        title: "Clock paused",
        text: pausedBy.text,
        category: pausedBy.category,
        link: pausedBy.link,
      });
    }
    if (!advanced) return;

    // After a long jump there can be dozens; the most important few are enough.
    const worth = fresh
      .filter((e) => !e.quiet && IMPORTANT_CATEGORIES.includes(e.category) && e !== pausedBy)
      .slice(-3);
    for (const entry of worth) {
      this.toasts.push({ text: entry.text, category: entry.category, link: entry.link });
    }
  }

  /** Run until something worth knowing about happens. */
  private nextEvent(): void {
    this.toasts.clear();
    const found = this.game.runUntilEvent(
      (entry: LogEntry) => !entry.quiet && IMPORTANT_CATEGORIES.includes(entry.category),
      365,
    );
    this.game.pausedBy = null;
    this.toasts.push(
      found
        ? { title: "Next event", text: found.text, category: found.category, link: found.link }
        : { text: "Nothing notable happened in the next year.", category: "info" },
    );
    this.time.refresh(true);
  }

  /** Take the player to wherever an event or notice points. */
  private navigate(link: LogLink): void {
    const body = link.bodyId ? this.game.galaxy.byId.get(link.bodyId) : undefined;
    if (link.view === "map" && body) {
      this.zoomTo(body);
      return;
    }
    if (body) this.game.select(body);
    if (link.fleetId) this.game.selectFleet(link.fleetId);
    if (link.techId) this.research.focusTech(link.techId);
    this.setView(link.view);
  }

  setView(view: ViewId): void {
    // Leaving the dashboard marks everything on it as seen.
    if (this.view === "empire" && view !== "empire") {
      this.game.empire.markReviewed(this.game.clock.seconds);
    }
    this.view = view;
    this.applyRailState();
    for (const [id, node] of Object.entries(this.roots.views)) {
      node.classList.toggle("active", id === view);
    }
    this.syncViewTabs();
    this.renderActiveView();
    this.rail.render();
    if (view === "map") {
      this.renderer.resize();
      // First time the map is shown it finally has a size to frame against.
      if (!this.mapFramed) this.mapFramed = this.setSpan(this.systemSpan(this.game.viewSystem));
    }
  }

  /**
   * On a phone the view tabs belong at the bottom of the screen, as their own
   * grid row. A fixed footer disappears under the browser's own chrome when
   * the URL bar collapses, so the element is moved rather than positioned.
   */
  private placeTabs(): void {
    const tabs = this.roots.tabs;
    const app = document.getElementById("app");
    const header = document.querySelector(".topbar");
    if (!app || !header) return;

    if (this.narrow.matches) {
      if (tabs.parentElement !== app) app.append(tabs);
    } else if (tabs.parentElement !== header) {
      header.insertBefore(tabs, header.querySelector(".topbar-tools"));
    }
  }

  private foldRailEverywhere(): void {
    for (const key of Object.keys(this.railCollapsed) as ViewId[]) {
      this.railCollapsed[key] = true;
    }
  }

  private applyRailState(): void {
    this.rail.setCollapsed(this.railCollapsed[this.view]);
  }

  /** The rail steals width from the map, so the canvas has to be re-measured. */
  private onRailToggled(): void {
    this.railCollapsed[this.view] = this.rail.isCollapsed;
    if (this.view === "map") requestAnimationFrame(() => this.renderer.resize());
  }

  private openColony(bodyId: string): void {
    const body = this.game.galaxy.byId.get(bodyId);
    if (body) this.game.select(body);
    this.setView("colonies");
  }

  /** Jump to wherever an attention item is resolved. */
  private followIssue(issue: Issue): void {
    if (issue.action.bodyId) {
      const body = this.game.galaxy.byId.get(issue.action.bodyId);
      if (body) this.game.select(body);
    }
    this.setView(issue.action.view as ViewId);
    // The sheet covers the screen on a phone; get out of the way.
    if (this.narrow.matches) {
      this.railCollapsed[this.view] = true;
      this.applyRailState();
    }
  }

  private syncViewTabs(): void {
    for (const btn of Array.from(this.roots.tabs.querySelectorAll<HTMLElement>("[data-view]"))) {
      btn.classList.toggle("active", btn.dataset.view === this.view);
    }
    // On a phone a screen behind "More" lights the More button instead.
    const behindMore = !PRIMARY_VIEWS.includes(this.view);
    this.roots.tabs.querySelector(".more-tab")?.classList.toggle("active", behindMore);
  }

  private renderActiveView(): void {
    switch (this.view) {
      case "empire": this.empireView.render(); break;
      case "colonies": this.economy.render(); break;
      case "fleets": this.fleetsView.render(); break;
      case "design": this.designView.render(); break;
      case "research": this.research.render(); break;
      case "officers": this.officers.render(); break;
      case "galaxy": this.galaxyView.render(); break;
      case "map": break;
    }
    this.renderEmpireBar();
  }

  private renderEmpireBar(): void {
    const { empire } = this.game;
    const bar = this.roots.empireBar;
    bar.textContent = "";

    const add = (label: string, value: string, tone?: string) => {
      const item = el("div", "empire-stat");
      item.append(el("span", "empire-label", label));
      item.append(el("span", `empire-value${tone ? ` ${tone}` : ""}`, value));
      bar.append(item);
    };

    const net = empire.snapshot.income - empire.snapshot.expenses;
    add("Treasury", num(empire.treasury), empire.treasury < 0 ? "bad" : undefined);
    add("Net", `${net >= 0 ? "+" : ""}${num(net)}/yr`, net >= 0 ? "good" : "bad");
    add("Research", `${num(empire.snapshot.researchPoints)} RP`);
    add("Build", `${num(empire.snapshot.buildPoints)} BP`);
    if (this.game.catchingUp) add("", "catching up...", "warn");
  }

  // ------------------------------------------------------------- map tools

  /** Switch the map to the system the game is now viewing, and frame it. */
  private syncSystem(force = false): void {
    const system = this.game.viewSystem;
    if (!force && this.shownSystemId === system.id) {
      this.refreshSystemSelect();
      return;
    }
    this.shownSystemId = system.id;
    this.renderer.setSystem(system);
    this.game.follow = false;
    this.renderer.camera.centerOn(0, 0);
    this.setSpan(this.systemSpan(system));
    this.buildZoomButtons();
    this.refreshSystemSelect();
    this.tree.rebuild();
    this.syncToggles();
  }

  /** Half-width that shows a system's planets and any jump points found in it. */
  private systemSpan(system: StarSystem): number {
    if (system.id === "sol") return 2.6;
    const { empire } = this.game;
    let reach = 0;
    for (const body of system.bodies) {
      if (body.cls === "star" || body.cls === "moon") continue;
      if (body.cls === "jump-point" && !empire.knownJumpPoints.has(body.id)) continue;
      const a = body.def.orbit;
      if (a) reach = Math.max(reach, a.a * (1 + a.e));
    }
    return Math.max(0.05, reach * 1.2);
  }

  private buildZoomButtons(): void {
    const group = this.zoomGroup;
    group.textContent = "";
    group.append(el("span", "tool-label", "View"));
    const system = this.game.viewSystem;
    const add = (label: string, run: () => void) => {
      const btn = el("button", "tool-btn", label);
      btn.addEventListener("click", run);
      group.append(btn);
    };
    if (system.id === "sol") {
      for (const preset of ZOOM_PRESETS) {
        add(preset.label, () => {
          if (preset.center) {
            const body = this.game.galaxy.byId.get(preset.center);
            if (body) {
              this.game.select(body);
              this.game.follow = true;
              this.renderer.camera.centerOn(body.world.x, body.world.y);
            }
          } else {
            this.game.follow = false;
            this.renderer.camera.centerOn(0, 0);
          }
          this.setSpan(preset.spanAu);
          this.syncToggles();
        });
      }
      return;
    }
    const whole = this.systemSpan(system);
    const planets = system.bodies.filter((b) => b.cls === "planet");
    const planetReach = planets.reduce((m, b) => Math.max(m, (b.def.orbit?.a ?? 0) * (1 + (b.def.orbit?.e ?? 0))), 0) || whole / 2;
    for (const [label, span] of [["Whole system", whole], ["Planets", planetReach * 1.25], ["Inner", planetReach * 0.3]] as [string, number][]) {
      add(label, () => {
        this.game.follow = false;
        this.renderer.camera.centerOn(0, 0);
        this.setSpan(Math.max(span, 0.004));
        this.syncToggles();
      });
    }
  }

  private refreshSystemSelect(): void {
    const { empire, galaxy, viewSystem } = this.game;
    const known = galaxy.systems.filter((s) => empire.knownSystems.has(s.id));
    const signature = known.map((s) => s.id).join(",") + `|${viewSystem.id}`;
    if (this.systemSelect.dataset.signature === signature) return;
    this.systemSelect.dataset.signature = signature;
    this.systemSelect.textContent = "";
    for (const system of known) {
      const option = el("option", undefined, system.name);
      option.value = system.id;
      option.selected = system.id === viewSystem.id;
      this.systemSelect.append(option);
    }
  }

  private buildTools(root: HTMLElement): void {
    const systems = el("div", "tool-group");
    systems.append(el("span", "tool-label", "System"));
    this.systemSelect.setAttribute("aria-label", "System shown on the map");
    this.systemSelect.addEventListener("change", () => this.game.setViewSystem(this.systemSelect.value));
    systems.append(this.systemSelect);
    const galaxyButton = el("button", "tool-btn", "Galaxy");
    galaxyButton.title = "The neighbouring stars and the jump network";
    galaxyButton.addEventListener("click", () => this.setView("galaxy"));
    systems.append(galaxyButton);
    root.append(systems);
    this.refreshSystemSelect();

    this.buildZoomButtons();
    root.append(this.zoomGroup);

    // --- lenses: recolour the system by the question being asked
    const lenses = el("div", "tool-group lens-group");
    lenses.append(el("span", "tool-label", "Lens"));
    for (const lens of LENSES) {
      const btn = el("button", "tool-btn lens-btn", lens.label);
      btn.dataset.lens = lens.id;
      btn.title = lens.question;
      btn.addEventListener("click", () => {
        this.lens = lens.id;
        settings.lens = lens.id;
        saveSettings();
        this.syncLens();
      });
      lenses.append(btn);
    }
    root.append(lenses);
    const pane = this.canvas.parentElement;
    pane?.append(this.legend, this.hoverCard);
    this.syncLens();

    const toggles = el("div", "tool-group");
    toggles.append(el("span", "tool-label", "Show"));
    const entries: [keyof RenderOptions, string][] = [
      ["showOrbits", "Orbits"],
      ["showLabels", "Labels"],
      ["showBelts", "Belts"],
      ["showGrid", "Grid"],
      ["showFleets", "Fleets"],
    ];
    for (const [key, label] of entries) {
      const btn = el("button", "tool-btn toggle", label);
      btn.dataset.key = key;
      btn.addEventListener("click", () => {
        this.options[key] = !this.options[key];
        this.syncToggles();
      });
      toggles.append(btn);
    }
    const follow = el("button", "tool-btn toggle", "Follow");
    follow.dataset.key = "follow";
    follow.addEventListener("click", () => {
      this.game.follow = !this.game.follow;
      this.syncToggles();
    });
    toggles.append(follow);
    root.append(toggles);
    this.syncToggles();
  }

  private syncLens(): void {
    for (const btn of Array.from(document.querySelectorAll<HTMLElement>(".lens-btn"))) {
      btn.classList.toggle("active", btn.dataset.lens === this.lens);
    }
    const lens = LENS_BY_ID.get(this.lens)!;
    this.legend.textContent = "";
    this.legend.classList.toggle("on", lens.legend.length > 0);
    if (lens.legend.length) {
      this.legend.append(el("div", "legend-title", lens.question));
      for (const entry of lens.legend) {
        const row = el("div", "legend-row");
        const swatch = el("span", "legend-swatch");
        swatch.style.background = entry.color;
        row.append(swatch, el("span", undefined, entry.label));
        this.legend.append(row);
      }
    }
  }

  /** The card that follows the pointer, so a body's vitals need no click. */
  private updateHoverCard(): void {
    const body = this.hovered;
    if (!body || this.dragging || this.view !== "map") {
      this.hoverCard.classList.remove("on");
      return;
    }
    this.hoverCard.textContent = "";
    this.hoverCard.append(el("div", "hover-name", body.name));
    this.hoverCard.append(el("div", "hover-class", classLabel(body)));
    for (const line of hoverLines(body, this.game)) this.hoverCard.append(el("div", "hover-line", line));
    this.hoverCard.classList.add("on");

    const pane = this.canvas.parentElement;
    if (!pane) return;
    const w = this.hoverCard.offsetWidth;
    const h = this.hoverCard.offsetHeight;
    let x = this.pointer.x + 16;
    let y = this.pointer.y + 16;
    if (x + w > pane.clientWidth - 6) x = this.pointer.x - w - 16;
    if (y + h > pane.clientHeight - 30) y = this.pointer.y - h - 16;
    this.hoverCard.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`;
  }

  private lensColorFn(): ((body: Body) => string | null) | null {
    if (this.lens === "default") return null;
    const lens = LENS_BY_ID.get(this.lens)!;
    return (body) => lens.color(body, this.game);
  }

  private syncToggles(): void {
    for (const btn of Array.from(document.querySelectorAll<HTMLElement>(".tool-btn.toggle"))) {
      const key = btn.dataset.key as keyof RenderOptions | "follow";
      const on = key === "follow" ? this.game.follow : this.options[key];
      btn.classList.toggle("active", on);
    }
  }

  /**
   * Set the zoom so that `spanAu` is half the smaller screen dimension.
   * Returns false if the canvas has no size yet, in which case nothing is
   * applied - framing against a zero-sized canvas pins the camera at minimum
   * zoom.
   */
  private setSpan(spanAu: number): boolean {
    const { camera } = this.renderer;
    const smaller = Math.min(camera.width, camera.height);
    if (smaller <= 0) return false;
    camera.setScale(smaller / 2 / spanAu);
    return true;
  }

  private zoomTo(body: Body): void {
    this.setView("map");
    this.game.select(body);
    this.syncSystem();
    this.game.follow = true;
    const camera = this.renderer.camera;
    camera.centerOn(body.world.x, body.world.y);

    // Frame the satellite system if there is one, otherwise the body itself.
    const outer = body.children.reduce(
      (max, child) => Math.max(max, (child.def.orbit?.a ?? 0) * (1 + (child.def.orbit?.e ?? 0))),
      0,
    );
    const span = outer > 0 ? outer * 1.35 : (body.def.radiusKm / AU_KM) * 12;
    this.setSpan(Math.max(span, 5e-6));
    this.syncToggles();
  }

  // ----------------------------------------------------------------- input

  private bindCanvas(): void {
    const canvas = this.canvas;

    const local = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const capture = (e: PointerEvent) => {
      // Synthetic or already-released pointers throw here; the gesture still
      // works without capture, so a failure is not worth propagating.
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* no capture available for this pointer */
      }
    };

    canvas.addEventListener("pointerdown", (e) => {
      capture(e);
      this.pointers.set(e.pointerId, local(e));
      this.pointer = local(e);
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.dragMoved = 0;
      } else {
        // A second finger turns the gesture into a pinch, not a drag.
        this.dragging = false;
        this.pinchDistance = this.spanBetweenPointers();
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      const position = local(e);
      const previous = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, position);
      this.pointer = position;

      if (this.pointers.size >= 2) {
        const distance = this.spanBetweenPointers();
        if (this.pinchDistance && distance > 0) {
          const mid = this.midpointOfPointers();
          this.renderer.camera.zoomAt(mid.x, mid.y, distance / this.pinchDistance);
          this.game.follow = false;
          this.syncToggles();
        }
        this.pinchDistance = distance;
        return;
      }

      if (this.dragging && previous) {
        const dx = position.x - previous.x;
        const dy = position.y - previous.y;
        this.dragMoved += Math.abs(dx) + Math.abs(dy);
        this.renderer.camera.panByPixels(dx, dy);
        this.game.follow = false;
        this.syncToggles();
      } else if (!this.dragging && e.pointerType === "mouse") {
        this.hovered = this.renderer.pick(position.x, position.y);
        canvas.style.cursor = this.hovered ? "pointer" : "grab";
        this.updateHoverCard();
      }
    });

    const endPointer = (e: PointerEvent) => {
      const wasPinching = this.pointers.size >= 2;
      this.pointers.delete(e.pointerId);
      try {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      if (this.pointers.size < 2) this.pinchDistance = null;

      if (!this.dragging || wasPinching) {
        this.dragging = false;
        return;
      }
      this.dragging = false;
      // A tap, not a drag. Fleets sit on top of bodies for picking.
      if (this.dragMoved < 6) {
        const fleet = this.renderer.pickFleet(this.pointer.x, this.pointer.y);
        if (fleet) this.game.selectFleet(fleet);
        else this.game.select(this.renderer.pick(this.pointer.x, this.pointer.y));
      }
    };
    canvas.addEventListener("pointerleave", () => {
      this.hovered = null;
      this.hoverCard.classList.remove("on");
    });
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    canvas.addEventListener("dblclick", () => {
      const hit = this.renderer.pick(this.pointer.x, this.pointer.y);
      if (hit) this.zoomTo(hit);
    });

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = Math.pow(1.0016, -e.deltaY);
        this.renderer.camera.zoomAt(this.pointer.x, this.pointer.y, factor);
      },
      { passive: false },
    );

    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // Right-click a body to send the selected fleet there.
      const fleet = this.game.empire.fleets.get(this.game.selectedFleet ?? "");
      if (!fleet) return;
      const rect = canvas.getBoundingClientRect();
      const body = this.renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
      if (!body) return;
      fleet.orders.push({ kind: "move", bodyId: body.id });
      this.game.empire.addLog(
        this.game.clock.seconds,
        "fleet",
        `${fleet.name} ordered to ${body.name}.`,
      );
      this.game.emit();
    });
  }

  private spanBetweenPointers(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private midpointOfPointers(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return this.pointer;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      // The palette opens from anywhere - including from inside a text field.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.palette.toggle();
        return;
      }
      if (this.palette.isOpen || dialogOpen()) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "F5") {
        e.preventDefault();
        this.quickSave();
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        this.quickLoad();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this.openSaves();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        this.palette.open();
        return;
      }
      if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey) {
        this.nextEvent();
        return;
      }

      const tab = VIEW_TABS.find((t) => t.key === e.key);
      if (tab) {
        this.setView(tab.id);
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          this.game.clock.togglePause();
          this.game.pausedBy = null;
          break;
        case "g":
          this.game.follow = !this.game.follow;
          this.syncToggles();
          break;
        case "Escape":
          this.game.select(null);
          break;
        case "+": case "=":
          this.renderer.camera.zoomAt(this.pointer.x, this.pointer.y, 1.3);
          break;
        case "-": case "_":
          this.renderer.camera.zoomAt(this.pointer.x, this.pointer.y, 1 / 1.3);
          break;
        default:
          if (e.key >= "1" && e.key <= "6") {
            this.game.clock.setRate(Number(e.key));
            this.game.pausedBy = null;
          }
      }
      this.time.refresh();
    });
  }

  // ------------------------------------------------------------ frame loop

  private frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.game.tick(dt);

    if (this.view === "map") {
      this.syncSystem();
      if (this.game.follow && this.game.selected) {
        const target = this.game.selected;
        this.renderer.camera.centerOn(target.world.x, target.world.y);
      }
      this.renderer.draw(
        this.game.selected,
        this.hovered,
        this.options,
        this.fleetMarkers(),
        this.game.selectedFleet,
        this.lensColorFn(),
      );
      this.tree.refresh();
      this.updateOverlay();
    }
    this.time.refresh();

    requestAnimationFrame(this.frame);
  };

  /** The fleets as the renderer wants them: position, course, state. */
  private fleetMarkers(): FleetMarker[] {
    const markers: FleetMarker[] = [];
    for (const fleet of this.game.empire.fleets.values()) {
      if (fleet.systemId !== this.game.viewSystem.id) continue;
      const destinationId = destinationOf(fleet);
      const destination = destinationId
        ? this.game.galaxy.byId.get(destinationId)?.world ?? null
        : null;
      markers.push({
        id: fleet.id,
        name: fleet.name,
        position: fleet.position,
        destination,
        ships: fleet.shipIds.length,
        stranded: Boolean(fleet.note),
      });
    }
    return markers;
  }

  private updateOverlay(): void {
    const camera = this.renderer.camera;
    const parts: string[] = [];
    parts.push(`Scale ${formatAu(100 / camera.scale)} / 100px`);

    const wx = camera.screenToWorldX(this.pointer.x);
    const wy = camera.screenToWorldY(this.pointer.y);
    parts.push(`Cursor ${wx.toFixed(3)}, ${wy.toFixed(3)} AU`);

    const focus = this.hovered ?? this.game.selected;
    if (focus) {
      const root = this.game.viewSystem.root;
      if (focus !== root) {
        const fromStar = this.game.galaxy.distance(focus, root);
        parts.push(`${focus.name}: ${distance(fromStar)} from ${root.name}`);
      }
      const earth = this.game.galaxy.byId.get("earth");
      if (earth && earth !== focus && earth.systemId === focus.systemId) {
        const d = this.game.galaxy.distance(focus, earth);
        parts.push(`${distance(d)} from Earth (${lightTime(d)} light)`);
      }
    }
    this.roots.overlay.textContent = parts.join("   |   ");
  }
}
