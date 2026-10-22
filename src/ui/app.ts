/** Wires the map, the views, the panels and input into a running application. */

import { SystemMapRenderer, formatAu, type FleetMarker, type RenderOptions } from "../render/map";
import { destinationOf } from "../sim/ships/fleet";
import { Game } from "../state/game";
import type { Body } from "../sim/system";
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
import { distance, el, lightTime, num } from "./format";

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

export type ViewId = "empire" | "map" | "colonies" | "fleets" | "research" | "officers";

const VIEW_TABS: { id: ViewId; label: string; key: string }[] = [
  { id: "empire", label: "Empire", key: "e" },
  { id: "map", label: "Map", key: "m" },
  { id: "colonies", label: "Colonies", key: "c" },
  { id: "fleets", label: "Fleets", key: "f" },
  { id: "research", label: "Research", key: "r" },
  { id: "officers", label: "Officers", key: "o" },
];

/** The rail costs real estate the map wants, so it starts folded there. */
const RAIL_COLLAPSED_BY_DEFAULT: Record<ViewId, boolean> = {
  empire: false,
  map: true,
  colonies: false,
  fleets: false,
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
  views: Record<ViewId, HTMLElement>;
}

export class App {
  private game = new Game();
  private renderer: SystemMapRenderer;
  private tree: BodyTreePanel;
  private detail: DetailPanel;
  private time: TimeControls;
  private empireView: EmpireView;
  private economy: EconomyView;
  private research: ResearchView;
  private officers: OfficersView;
  private fleetsView: FleetsView;
  private rail: TriageRail;

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

  constructor(private canvas: HTMLCanvasElement, private roots: AppRoots) {
    this.renderer = new SystemMapRenderer(canvas, this.game.system);
    this.tree = new BodyTreePanel(roots.tree, this.game, (b) => this.zoomTo(b));
    this.detail = new DetailPanel(roots.detail, this.game, {
      zoomTo: (b) => this.zoomTo(b),
      openEconomy: () => this.setView("colonies"),
      openFleets: () => this.setView("fleets"),
    });
    this.time = new TimeControls(roots.time, this.game);
    this.economy = new EconomyView(roots.views.colonies, this.game);
    this.research = new ResearchView(roots.views.research, this.game);
    this.officers = new OfficersView(roots.views.officers, this.game);
    this.empireView = new EmpireView(roots.views.empire, this.game, (bodyId) =>
      this.openColony(bodyId),
    );
    this.fleetsView = new FleetsView(roots.views.fleets, this.game);
    this.rail = new TriageRail(
      roots.rail,
      this.game,
      (issue) => this.followIssue(issue),
      () => this.onRailToggled(),
    );

    this.buildViewTabs();
    this.buildTools(roots.tools);

    this.game.subscribe(() => {
      this.detail.render();
      this.tree.rebuild();
      this.renderActiveView();
      this.rail.render();
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
    this.frame();
  }

  // ----------------------------------------------------------------- views

  private buildViewTabs(): void {
    for (const tab of VIEW_TABS) {
      const btn = el("button", "view-tab", tab.label);
      btn.dataset.view = tab.id;
      btn.title = `${tab.label}  (${tab.key.toUpperCase()})`;
      btn.addEventListener("click", () => this.setView(tab.id));
      this.roots.tabs.append(btn);
    }
    this.syncViewTabs();
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
      if (!this.mapFramed) this.mapFramed = this.setSpan(2.6);
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
      header.insertBefore(tabs, this.roots.time);
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
    const body = this.game.system.byId.get(bodyId);
    if (body) this.game.select(body);
    this.setView("colonies");
  }

  /** Jump to wherever an attention item is resolved. */
  private followIssue(issue: Issue): void {
    if (issue.action.bodyId) {
      const body = this.game.system.byId.get(issue.action.bodyId);
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
    for (const btn of Array.from(this.roots.tabs.children) as HTMLElement[]) {
      btn.classList.toggle("active", btn.dataset.view === this.view);
    }
  }

  private renderActiveView(): void {
    switch (this.view) {
      case "empire": this.empireView.render(); break;
      case "colonies": this.economy.render(); break;
      case "fleets": this.fleetsView.render(); break;
      case "research": this.research.render(); break;
      case "officers": this.officers.render(); break;
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

  private buildTools(root: HTMLElement): void {
    const zooms = el("div", "tool-group");
    zooms.append(el("span", "tool-label", "View"));
    for (const preset of ZOOM_PRESETS) {
      const btn = el("button", "tool-btn", preset.label);
      btn.addEventListener("click", () => {
        if (preset.center) {
          const body = this.game.system.byId.get(preset.center);
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
      zooms.append(btn);
    }
    root.append(zooms);

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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      const tab = VIEW_TABS.find((t) => t.key === e.key);
      if (tab) {
        this.setView(tab.id);
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          this.game.clock.togglePause();
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
          if (e.key >= "1" && e.key <= "7") {
            this.game.clock.setRate(Number(e.key) - 1);
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
      const destinationId = destinationOf(fleet);
      const destination = destinationId
        ? this.game.system.byId.get(destinationId)?.world ?? null
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
      const fromStar = this.game.system.distance(focus, this.game.system.root);
      parts.push(`${focus.name}: ${distance(fromStar)} from Sol`);
      const earth = this.game.system.byId.get("earth");
      if (earth && earth !== focus) {
        const d = this.game.system.distance(focus, earth);
        parts.push(`${distance(d)} from Earth (${lightTime(d)} light)`);
      }
    }
    this.roots.overlay.textContent = parts.join("   |   ");
  }
}
