/** Wires the map, the views, the panels and input into a running application. */

import { SystemMapRenderer, formatAu, type RenderOptions } from "../render/map";
import { Game } from "../state/game";
import type { Body } from "../sim/system";
import { AU_KM } from "../sim/orbit";
import { BodyTreePanel } from "./bodyTree";
import { DetailPanel } from "./detailPanel";
import { TimeControls } from "./timeControls";
import { EconomyView } from "./views/economyView";
import { ResearchView } from "./views/researchView";
import { OfficersView } from "./views/officersView";
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

export type ViewId = "map" | "economy" | "research" | "officers";

const VIEW_TABS: { id: ViewId; label: string; key: string }[] = [
  { id: "map", label: "System Map", key: "m" },
  { id: "economy", label: "Economy", key: "e" },
  { id: "research", label: "Research", key: "r" },
  { id: "officers", label: "Officers", key: "o" },
];

export interface AppRoots {
  tree: HTMLElement;
  detail: HTMLElement;
  time: HTMLElement;
  tools: HTMLElement;
  overlay: HTMLElement;
  tabs: HTMLElement;
  empireBar: HTMLElement;
  views: Record<ViewId, HTMLElement>;
}

export class App {
  private game = new Game();
  private renderer: SystemMapRenderer;
  private tree: BodyTreePanel;
  private detail: DetailPanel;
  private time: TimeControls;
  private economy: EconomyView;
  private research: ResearchView;
  private officers: OfficersView;

  private view: ViewId = "map";
  private hovered: Body | null = null;
  private lastFrame = performance.now();
  private dragging = false;
  private dragMoved = 0;
  private pointer = { x: 0, y: 0 };

  private options: RenderOptions = {
    showOrbits: true,
    showLabels: true,
    showBelts: true,
    showGrid: true,
  };

  constructor(private canvas: HTMLCanvasElement, private roots: AppRoots) {
    this.renderer = new SystemMapRenderer(canvas, this.game.system);
    this.tree = new BodyTreePanel(roots.tree, this.game, (b) => this.zoomTo(b));
    this.detail = new DetailPanel(roots.detail, this.game, {
      zoomTo: (b) => this.zoomTo(b),
      openEconomy: () => this.setView("economy"),
    });
    this.time = new TimeControls(roots.time, this.game);
    this.economy = new EconomyView(roots.views.economy, this.game);
    this.research = new ResearchView(roots.views.research, this.game);
    this.officers = new OfficersView(roots.views.officers, this.game);

    this.buildViewTabs();
    this.buildTools(roots.tools);

    this.game.subscribe(() => {
      this.detail.render();
      this.tree.rebuild();
      this.renderActiveView();
    });

    this.bindCanvas();
    this.bindKeys();
    window.addEventListener("resize", () => this.renderer.resize());

    // Open on the inner system, framed on Sol.
    this.setSpan(2.6);
    this.renderActiveView();
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
    this.view = view;
    for (const [id, node] of Object.entries(this.roots.views)) {
      node.classList.toggle("active", id === view);
    }
    this.syncViewTabs();
    this.renderActiveView();
    if (view === "map") this.renderer.resize();
  }

  private syncViewTabs(): void {
    for (const btn of Array.from(this.roots.tabs.children) as HTMLElement[]) {
      btn.classList.toggle("active", btn.dataset.view === this.view);
    }
  }

  private renderActiveView(): void {
    switch (this.view) {
      case "economy": this.economy.render(); break;
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

  /** Set the zoom so that `spanAu` is half the smaller screen dimension. */
  private setSpan(spanAu: number): void {
    const { camera } = this.renderer;
    camera.setScale(Math.min(camera.width, camera.height) / 2 / spanAu);
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

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.dragMoved = 0;
    });

    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (this.dragging) {
        this.dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
        this.renderer.camera.panByPixels(e.movementX, e.movementY);
        this.game.follow = false;
        this.syncToggles();
      } else {
        this.hovered = this.renderer.pick(this.pointer.x, this.pointer.y);
        canvas.style.cursor = this.hovered ? "pointer" : "grab";
      }
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      // A click, not a drag.
      if (this.dragMoved < 4) {
        const hit = this.renderer.pick(this.pointer.x, this.pointer.y);
        this.game.select(hit);
      }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

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

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
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
        case "f":
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
      this.renderer.draw(this.game.selected, this.hovered, this.options);
      this.tree.refresh();
      this.updateOverlay();
    }
    this.time.refresh();

    requestAnimationFrame(this.frame);
  };

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
