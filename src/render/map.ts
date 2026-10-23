/**
 * Canvas renderer for the system map.
 *
 * Everything is drawn to true scale: a body's on-screen size is its real
 * radius until it falls below a legibility floor, and moons sit at their real
 * distance from their primary, so zooming in on Jupiter opens the Jovian
 * system the same way zooming out closes it into a single dot.
 */

import { AU_KM, DEG, type Vec3 } from "../sim/orbit";
import type { Body, StarSystem } from "../sim/system";
import { Camera } from "./camera";
import { toPhosphor } from "../ui/phosphor";

export interface RenderOptions {
  showOrbits: boolean;
  showLabels: boolean;
  showBelts: boolean;
  showGrid: boolean;
  showFleets: boolean;
}

/** A fleet as the map needs to know it: where it is and where it is going. */
export interface FleetMarker {
  id: string;
  name: string;
  position: Vec3;
  /** World position of the body it is heading for, if any. */
  destination: Vec3 | null;
  ships: number;
  stranded: boolean;
}

interface ScreenBody {
  body: Body;
  sx: number;
  sy: number;
  radius: number;
}

interface ScreenFleet {
  id: string;
  sx: number;
  sy: number;
}

const MIN_RADIUS: Record<string, number> = {
  star: 4,
  planet: 3.5,
  dwarf: 2.5,
  moon: 2,
  asteroid: 1.6,
  comet: 1.6,
  "jump-point": 4,
};

const ORBIT_COLOR: Record<string, string> = {
  planet: "rgba(120, 170, 235, 0.34)",
  dwarf: "rgba(150, 140, 190, 0.26)",
  moon: "rgba(150, 190, 200, 0.30)",
  asteroid: "rgba(150, 145, 130, 0.22)",
  comet: "rgba(110, 200, 210, 0.28)",
  star: "rgba(255, 255, 255, 0.2)",
};

/** "#rrggbb" and an opacity to an rgba() string. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export class SystemMapRenderer {
  readonly camera = new Camera();
  private ctx: CanvasRenderingContext2D;
  private stars: { x: number; y: number; r: number; a: number }[] = [];
  private screenBodies: ScreenBody[] = [];
  private screenFleets: ScreenFleet[] = [];
  /** Hides bodies the player has not found (undiscovered jump points). */
  private isVisible: (body: Body) => boolean = () => true;
  /** How a jump point should look: unexplored, explored, or gated. */
  private jumpState: (body: Body) => "unexplored" | "explored" | "gate" = () => "unexplored";
  /** Recolours bodies for the active lens; null leaves them natural. */
  private lensColor: ((body: Body) => string | null) | null = null;
  private labelBoxes: { x: number; y: number; w: number; h: number }[] = [];
  private dpr = 1;
  private terminal = false;
  private tones = new Map<string, string>();

  constructor(
    private canvas: HTMLCanvasElement,
    private system: StarSystem,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  /** Draw a different system. The camera is the caller's to reframe. */
  setSystem(system: StarSystem): void {
    this.system = system;
    this.screenBodies = [];
    this.screenFleets = [];
  }

  /** The terminal theme redraws the map's own ink (not the worlds) in phosphor. */
  setTheme(theme: "classic" | "terminal"): void {
    this.terminal = theme === "terminal";
  }

  /** A map colour, in the current theme. */
  private c(color: string): string {
    if (!this.terminal) return color;
    let tone = this.tones.get(color);
    if (tone === undefined) {
      tone = toPhosphor(color);
      this.tones.set(color, tone);
    }
    return tone;
  }

  setKnowledge(
    isVisible: (body: Body) => boolean,
    jumpState: (body: Body) => "unexplored" | "explored" | "gate",
  ): void {
    this.isVisible = isVisible;
    this.jumpState = jumpState;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.camera.resize(rect.width, rect.height);
    this.seedStars(rect.width, rect.height);
  }

  private seedStars(w: number, h: number): void {
    this.stars = [];
    const count = Math.round((w * h) / 5200);
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() < 0.9 ? 0.6 : 1.1,
        a: 0.15 + Math.random() * 0.5,
      });
    }
  }

  /** Body nearest to a screen point, within a grab radius. */
  pick(sx: number, sy: number): Body | null {
    let best: Body | null = null;
    let bestDist = Infinity;
    for (const sb of this.screenBodies) {
      const d = Math.hypot(sb.sx - sx, sb.sy - sy);
      const grab = Math.max(sb.radius + 6, 10);
      if (d < grab && d < bestDist) {
        bestDist = d;
        best = sb.body;
      }
    }
    return best;
  }

  /** Fleet nearest a screen point, within a grab radius. */
  pickFleet(sx: number, sy: number): string | null {
    let best: string | null = null;
    let bestDist = 14;
    for (const fleet of this.screenFleets) {
      const d = Math.hypot(fleet.sx - sx, fleet.sy - sy);
      if (d < bestDist) {
        bestDist = d;
        best = fleet.id;
      }
    }
    return best;
  }

  draw(
    selected: Body | null,
    hovered: Body | null,
    opts: RenderOptions,
    fleets: FleetMarker[] = [],
    selectedFleet: string | null = null,
    lensColor: ((body: Body) => string | null) | null = null,
  ): void {
    this.lensColor = lensColor;
    const { ctx, camera } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.c("#05070d");
    ctx.fillRect(0, 0, camera.width, camera.height);

    this.drawStarfield();
    if (opts.showGrid) this.drawGrid();
    if (opts.showOrbits) this.drawOrbits(selected);
    if (opts.showBelts) this.drawMotes();
    this.drawBodies(selected, hovered, opts.showLabels);
    if (opts.showFleets) this.drawFleets(fleets, selectedFleet, opts.showLabels);
    else this.screenFleets = [];
    this.drawScaleBar();
  }

  private drawStarfield(): void {
    const { ctx } = this;
    ctx.fillStyle = this.terminal ? "#9dffbd" : "#ffffff";
    for (const s of this.stars) {
      ctx.globalAlpha = s.a;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  /** Decade rings centred on the star, labelled in AU. */
  private drawGrid(): void {
    const { ctx, camera } = this;
    const span = camera.halfSpanAu * 2;
    const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const cx = camera.worldToScreenX(0);
    const cy = camera.worldToScreenY(0);
    ctx.strokeStyle = this.c("rgba(80, 120, 160, 0.13)");
    ctx.fillStyle = this.c("rgba(120, 160, 200, 0.35)");
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 12; i++) {
      const r = i * step * camera.scale;
      if (r < 26) continue;
      if (r > Math.hypot(camera.width, camera.height)) break;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(formatAu(i * step), cx + r * 0.7071 + 3, cy - r * 0.7071 - 3);
    }
  }

  private drawOrbits(selected: Body | null): void {
    const { ctx, camera } = this;
    ctx.lineWidth = 1;
    for (const body of this.system.bodies) {
      const path = body.orbitPath;
      if (!path.length || !body.parent || body.cls === "jump-point") continue;

      const a = body.def.orbit!.a * camera.scale;
      if (a < 4) continue; // collapsed into its primary at this zoom

      const px = body.parent.world.x;
      const py = body.parent.world.y;
      if (!this.orbitMayBeVisible(body, px, py)) continue;

      const isSelected = selected === body || selected?.parent === body;
      ctx.strokeStyle = isSelected
        ? this.c("rgba(255, 214, 120, 0.85)")
        : this.c(ORBIT_COLOR[body.cls] ?? "rgba(255,255,255,0.2)");
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        const sx = camera.worldToScreenX(px + path[i].x);
        const sy = camera.worldToScreenY(py + path[i].y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }

  /** Cheap reject: is any part of this orbit's bounding box on screen? */
  private orbitMayBeVisible(body: Body, px: number, py: number): boolean {
    const orbit = body.def.orbit!;
    const reach = orbit.a * (1 + orbit.e);
    const left = this.camera.worldToScreenX(px - reach);
    const right = this.camera.worldToScreenX(px + reach);
    const top = this.camera.worldToScreenY(py + reach);
    const bottom = this.camera.worldToScreenY(py - reach);
    return right > 0 && left < this.camera.width && bottom > 0 && top < this.camera.height;
  }

  private drawMotes(): void {
    const { ctx, camera } = this;
    // Below this zoom the belts are a smear; above it they are too sparse.
    if (camera.scale > 4000) return;
    for (const mote of this.system.motes) {
      const sx = camera.worldToScreenX(mote.world.x);
      if (sx < -4 || sx > camera.width + 4) continue;
      const sy = camera.worldToScreenY(mote.world.y);
      if (sy < -4 || sy > camera.height + 4) continue;
      const shade = Math.round(mote.shade * 255);
      ctx.fillStyle = `rgb(${shade}, ${Math.round(shade * 0.95)}, ${Math.round(shade * 0.85)})`;
      ctx.fillRect(sx, sy, mote.size, mote.size);
    }
  }

  private drawBodies(selected: Body | null, hovered: Body | null, showLabels: boolean): void {
    const { camera } = this;
    this.screenBodies = [];
    this.labelBoxes = [];

    for (const body of this.system.bodies) {
      if (!this.isVisible(body)) continue;
      const sx = camera.worldToScreenX(body.world.x);
      const sy = camera.worldToScreenY(body.world.y);
      const trueRadius = (body.def.radiusKm / AU_KM) * camera.scale;
      const radius = Math.max(MIN_RADIUS[body.cls] ?? 2, trueRadius);

      const margin = radius + 60;
      const onScreen =
        sx > -margin && sx < camera.width + margin && sy > -margin && sy < camera.height + margin;
      if (!onScreen) continue;

      this.screenBodies.push({ body, sx, sy, radius });

      const tint = this.lensColor?.(body) ?? null;
      if (body.cls === "star") this.drawStar(sx, sy, radius, body.def.color);
      else if (body.cls === "jump-point") this.drawJumpPoint(sx, sy, this.jumpState(body));
      else this.drawWorld(body, sx, sy, radius, trueRadius, tint);

      // A ring keeps a small tinted body legible against the dark.
      if (tint && body.cls !== "star") {
        const { ctx } = this;
        ctx.strokeStyle = tint;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, radius + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (body.def.rings) this.drawRings(body, sx, sy);

      if (body === selected) this.drawSelection(sx, sy, radius, this.c("#ffd678"));
      else if (body === hovered) this.drawSelection(sx, sy, radius, this.c("rgba(255,255,255,0.55)"));

      if (showLabels && this.shouldLabel(body, selected, hovered, radius)) {
        this.drawLabel(body, sx, sy, radius, body === selected);
      }
    }
  }

  /** A diamond, hollow until it is explored, double-ringed once gated. */
  private drawJumpPoint(sx: number, sy: number, state: "unexplored" | "explored" | "gate"): void {
    const { ctx } = this;
    const r = 6;
    ctx.save();
    ctx.strokeStyle = this.c(state === "gate" ? "#8fffd0" : "#7fe0ff");
    ctx.fillStyle = this.c(state === "unexplored" ? "rgba(127, 224, 255, 0.08)" : "rgba(127, 224, 255, 0.35)");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.lineTo(sx + r, sy);
    ctx.lineTo(sx, sy + r);
    ctx.lineTo(sx - r, sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (state === "gate") {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawStar(sx: number, sy: number, radius: number, color = "#ffe9a8"): void {
    const { ctx } = this;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(radius * 6, 26));
    glow.addColorStop(0, withAlpha(color, 0.55));
    glow.addColorStop(0.35, withAlpha(color, 0.16));
    glow.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(radius * 6, 26), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawWorld(
    body: Body,
    sx: number,
    sy: number,
    radius: number,
    trueRadius: number,
    tint: string | null = null,
  ): void {
    const { ctx } = this;
    ctx.fillStyle = tint ?? body.def.color;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Once a world is more than a dot, shade the hemisphere facing away
    // from the star so the map reads as lit from Sol.
    if (trueRadius > 6) {
      const toStar = Math.atan2(-body.world.y, -body.world.x);
      const shade = ctx.createLinearGradient(
        sx + Math.cos(toStar) * radius,
        sy - Math.sin(toStar) * radius,
        sx - Math.cos(toStar) * radius,
        sy + Math.sin(toStar) * radius,
      );
      shade.addColorStop(0, "rgba(0, 0, 0, 0)");
      shade.addColorStop(1, "rgba(0, 0, 0, 0.72)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Rings lie in the primary's equatorial plane, which we take from the
   * innermost moon's orbit - so Saturn's rings open and close correctly and
   * Uranus's stand on edge.
   */
  private drawRings(body: Body, sx: number, sy: number): void {
    const rings = body.def.rings!;
    const outer = (rings.outerKm / AU_KM) * this.camera.scale;
    if (outer < 5) return;
    const inner = (rings.innerKm / AU_KM) * this.camera.scale;
    const plane = body.children[0]?.def.orbit;
    const inc = (plane?.inc ?? 0) * DEG;
    const node = (plane?.node ?? 0) * DEG;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(226, 214, 180, 0.45)";
    ctx.lineWidth = Math.max(1, outer - inner);
    ctx.beginPath();
    const mid = (outer + inner) / 2;
    ctx.ellipse(sx, sy, mid, mid * Math.abs(Math.cos(inc)), -node, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawSelection(sx: number, sy: number, radius: number, color: string): void {
    const { ctx } = this;
    const r = radius + 6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    // Corner ticks, Aurora-style.
    ctx.beginPath();
    for (const angle of [45, 135, 225, 315]) {
      const a = angle * DEG;
      ctx.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      ctx.lineTo(sx + Math.cos(a) * (r + 5), sy + Math.sin(a) * (r + 5));
    }
    ctx.stroke();
  }

  private shouldLabel(
    body: Body,
    selected: Body | null,
    hovered: Body | null,
    radius: number,
  ): boolean {
    if (body === selected || body === hovered) return true;
    if (body.cls === "star" || body.cls === "planet" || body.cls === "jump-point") return true;
    const orbitPx = (body.def.orbit?.a ?? 0) * this.camera.scale;
    if (body.cls === "dwarf") return orbitPx > 40;
    // Moons and small bodies only once they are clear of their primary.
    return orbitPx > 26 || radius > 6;
  }

  /**
   * Labels are laid out first-come-first-served in draw order - which runs
   * star, then planets, then satellites and small bodies - so at a crowded
   * zoom the important names survive and the clutter drops out.
   */
  private drawLabel(
    body: Body,
    sx: number,
    sy: number,
    radius: number,
    priority: boolean,
  ): void {
    const { ctx } = this;
    ctx.font = priority
      ? "600 12px ui-sans-serif, system-ui, sans-serif"
      : "11px ui-sans-serif, system-ui, sans-serif";
    const x = sx + radius + 5;
    const y = sy - radius - 4;
    const box = { x, y: y - 7, w: ctx.measureText(body.name).width, h: 14 };
    if (!priority && this.labelBoxes.some((b) => overlaps(b, box))) return;
    this.labelBoxes.push(box);

    ctx.fillStyle = this.c(priority ? "#ffd678" : "rgba(198, 216, 238, 0.9)");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(body.name, x, y);
  }

  /**
   * Fleets are drawn as chevrons pointing at where they are going, with a
   * dashed line to the destination so a glance tells you what is in transit.
   */
  private drawFleets(fleets: FleetMarker[], selectedId: string | null, showLabels: boolean): void {
    const { ctx, camera } = this;
    this.screenFleets = [];

    for (const fleet of fleets) {
      const sx = camera.worldToScreenX(fleet.position.x);
      const sy = camera.worldToScreenY(fleet.position.y);
      if (sx < -40 || sx > camera.width + 40 || sy < -40 || sy > camera.height + 40) continue;
      this.screenFleets.push({ id: fleet.id, sx, sy });

      const selected = fleet.id === selectedId;
      const colour = this.c(fleet.stranded ? "#e2725b" : selected ? "#ffd678" : "#7fe0d4");

      if (fleet.destination) {
        const dx = camera.worldToScreenX(fleet.destination.x);
        const dy = camera.worldToScreenY(fleet.destination.y);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = this.c(selected ? "rgba(255, 214, 120, 0.75)" : "rgba(127, 224, 212, 0.35)");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(dx, dy);
        ctx.stroke();
        ctx.restore();
      }

      // Point the chevron along the course, or north when holding station.
      let angle = -Math.PI / 2;
      if (fleet.destination) {
        angle = Math.atan2(
          -(fleet.destination.y - fleet.position.y),
          fleet.destination.x - fleet.position.x,
        );
      }

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angle);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-5, 4.5);
      ctx.lineTo(-2.5, 0);
      ctx.lineTo(-5, -4.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (selected) {
        ctx.strokeStyle = this.c("#ffd678");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, 11, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (showLabels) {
        ctx.font = selected
          ? "600 11px ui-sans-serif, system-ui, sans-serif"
          : "10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = this.c(selected ? "#ffd678" : "rgba(127, 224, 212, 0.85)");
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(
          fleet.ships > 1 ? `${fleet.name} (${fleet.ships})` : fleet.name,
          sx + 10,
          sy + 9,
        );
      }
    }
  }

  private drawScaleBar(): void {
    const { ctx, camera } = this;
    const targetPx = 140;
    const au = niceNumber(targetPx / camera.scale);
    const px = au * camera.scale;
    const x = 16;
    const y = camera.height - 40;

    ctx.strokeStyle = this.c("rgba(190, 214, 240, 0.75)");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.moveTo(x + px, y - 4);
    ctx.lineTo(x + px, y + 4);
    ctx.stroke();

    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = this.c("rgba(190, 214, 240, 0.85)");
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatAu(au), x, y - 6);
  }

  /** Screen position of a world point, for DOM overlays. */
  project(world: Vec3): { x: number; y: number } {
    return {
      x: this.camera.worldToScreenX(world.x),
      y: this.camera.worldToScreenY(world.y),
    };
  }
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 1, 2 or 5 times a power of ten. */
function niceNumber(v: number): number {
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const mult = f >= 5 ? 5 : f >= 2 ? 2 : 1;
  return mult * base;
}

export function formatAu(au: number): string {
  if (au >= 0.01) return `${trim(au)} AU`;
  const km = au * AU_KM;
  if (km >= 1e6) return `${trim(km / 1e6)}m km`;
  if (km >= 1000) return `${trim(km / 1000)}k km`;
  return `${trim(km)} km`;
}

function trim(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
