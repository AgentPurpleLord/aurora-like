/**
 * A schematic of the ship being designed: a hull outline that fills with
 * coloured cells as parts are added, rear to front.
 *
 * It is not a different drawing for each class - one outline, longer for
 * heavier ships - but it answers the question "did that do anything?": every
 * part added is a cell that pops into the hull, and the legend counts them.
 */

import type { ComponentKind } from "../sim/ships/components";
import { KINDS } from "../sim/ships/components";
import { compact, el } from "./format";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Rear to front: where each kind of part sits in the hull. */
const ORDER: ComponentKind[] = [
  "engine", "reactor", "engineering", "maintenance-bay", "fuel-tank", "crew-quarters", "cargo-hold", "colony-module", "survey-sensor", "gate-module", "jump-drive",
];

export const KIND_COLOURS: Record<ComponentKind, string> = {
  "engine": "#ff9a4d",
  "reactor": "#ffe14d",
  "engineering": "#7fd1c2",
  "maintenance-bay": "#c2a3ff",
  "fuel-tank": "#4da6ff",
  "crew-quarters": "#9aa8b8",
  "cargo-hold": "#d6b36a",
  "colony-module": "#6fd68c",
  "survey-sensor": "#b28cff",
  "gate-module": "#4fd6c8",
  "jump-drive": "#ff6fb5",
};

export interface SchematicPart {
  kind: ComponentKind;
  name: string;
  count: number;
}

const MAX_CELLS = 48;
const ROWS = 3;
const CELL = 22;
const GAP = 3;

/** How many cells of each kind were drawn last time, so only new ones pop in. */
export type CellMemory = Map<ComponentKind, number>;

export function renderSchematic(
  parts: SchematicPart[],
  tons: number,
  hullName: string | undefined,
  memory: CellMemory,
): HTMLElement {
  const wrap = el("div", "schematic");
  const total = parts.reduce((s, p) => s + p.count, 0);

  // Heavier ships are longer, up to a point.
  const length = Math.max(0.55, Math.min(1, 0.55 + Math.log10(Math.max(1, tons) / 500) * 0.3));
  const width = 120 + 360 * length;
  const height = 160;
  const root = svg("svg", { class: "schematic-svg", viewBox: `0 0 ${width + 60} ${height}`, role: "img", "aria-label": "Ship schematic" });

  const left = 36;
  const right = left + width;
  const mid = height / 2;
  const at = (fraction: number) => left + width * fraction;
  const poly = (points: [number, number][], cls: string) =>
    svg("polygon", { class: cls, points: points.map(([x, y]) => `${x},${y}`).join(" ") });

  // Defs: a hull sheen and an exhaust glow.
  const defs = svg("defs");
  const sheen = svg("linearGradient", { id: "sch-sheen", x1: 0, y1: 0, x2: 0, y2: 1 });
  sheen.append(svg("stop", { offset: "0%", "stop-color": "#2a3f58" }), svg("stop", { offset: "45%", "stop-color": "#101e30" }), svg("stop", { offset: "100%", "stop-color": "#1b2d44" }));
  const glow = svg("linearGradient", { id: "sch-glow", x1: 1, y1: 0, x2: 0, y2: 0 });
  glow.append(svg("stop", { offset: "0%", "stop-color": "#fff3c4", "stop-opacity": 0.95 }), svg("stop", { offset: "45%", "stop-color": "#ff9a4d", "stop-opacity": 0.8 }), svg("stop", { offset: "100%", "stop-color": "#ff5a2d", "stop-opacity": 0 }));
  defs.append(sheen, glow);
  root.append(defs);

  // Exhaust flames behind the engine block, pulsing.
  for (const dy of [-26, 0, 26]) {
    const flame = poly([[left + 2, mid + dy - 9], [left - 30, mid + dy], [left + 2, mid + dy + 9]], "schematic-flame");
    flame.style.animationDelay = `${(dy + 26) * 8}ms`;
    root.append(flame);
  }

  // Swept stabiliser fins, above and below, with a wing-tip light each.
  for (const side of [-1, 1]) {
    root.append(
      poly([[at(0.3), mid + side * 44], [at(0.4), mid + side * 74], [at(0.62), mid + side * 74], [at(0.56), mid + side * 44]], "schematic-fin"),
    );
    root.append(poly([[at(0.4), mid + side * 74], [at(0.44), mid + side * 68], [at(0.6), mid + side * 68], [at(0.62), mid + side * 74]], "schematic-fin-edge"));
    const light = svg("circle", { class: `schematic-light ${side < 0 ? "port" : "starboard"}`, cx: at(0.62), cy: mid + side * 74, r: 2.6 });
    root.append(light);
  }

  // Engine block: a squared housing with three nozzle throats.
  root.append(poly([[left, mid - 40], [left + 14, mid - 46], [left + 40, mid - 46], [left + 40, mid + 46], [left + 14, mid + 46], [left, mid + 40]], "schematic-engine-block"));
  for (const dy of [-26, 0, 26]) {
    root.append(poly([[left, mid + dy - 11], [left + 12, mid + dy - 8], [left + 12, mid + dy + 8], [left, mid + dy + 11]], "schematic-bell"));
  }

  // The hull: faceted, tapering to a prow.
  root.append(
    poly(
      [[left + 38, mid - 46], [at(0.72), mid - 46], [at(0.86), mid - 30], [right + 14, mid - 6], [right + 14, mid + 6], [at(0.86), mid + 30], [at(0.72), mid + 46], [left + 38, mid + 46]],
      `schematic-hull${total ? "" : " empty"}`,
    ),
  );
  // Plating: seams, a dorsal spine, and a row of viewports toward the bow.
  for (const f of [0.2, 0.34, 0.48, 0.62]) {
    root.append(svg("line", { class: "schematic-seam", x1: at(f), y1: mid - 44, x2: at(f), y2: mid + 44 }));
  }
  root.append(svg("line", { class: "schematic-seam", x1: left + 40, y1: mid - 38, x2: at(0.8), y2: mid - 38 }));
  root.append(svg("line", { class: "schematic-seam", x1: left + 40, y1: mid + 38, x2: at(0.8), y2: mid + 38 }));
  for (let i = 0; i < 5; i++) {
    root.append(svg("rect", { class: "schematic-window", x: at(0.74) + i * 9, y: mid - 2, width: 5, height: 4, rx: 1 }));
  }
  // Bridge blister and a forward sensor mast.
  root.append(svg("ellipse", { class: "schematic-bridge", cx: at(0.8), cy: mid - 38, rx: 13, ry: 6 }));
  root.append(svg("line", { class: "schematic-mast", x1: right + 14, y1: mid, x2: right + 34, y2: mid }));
  root.append(svg("circle", { class: "schematic-light mast", cx: right + 34, cy: mid, r: 2 }));

  if (!total) {
    const hint = svg("text", { class: "schematic-hint", x: left + width / 2, y: mid + 4, "text-anchor": "middle" });
    hint.textContent = "Add parts below to fill the hull";
    root.append(hint);
  }

  // Cells: one per part, or one per several when the ship is big.
  const perCell = Math.max(1, Math.ceil(total / MAX_CELLS));
  const ordered = [...parts].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  let column = 0;
  let row = 0;
  const x0 = left + 14;
  const y0 = mid - ((ROWS * (CELL + GAP)) / 2) + GAP / 2;
  const seen = new Map<ComponentKind, number>();
  for (const part of ordered) {
    const cells = Math.max(1, Math.ceil(part.count / perCell));
    const earlier = memory.get(part.kind) ?? 0;
    const already = seen.get(part.kind) ?? 0;
    for (let i = 0; i < cells; i++) {
      const cell = svg("rect", {
        class: `schematic-cell${already + i >= earlier ? " new" : ""}`,
        x: x0 + column * (CELL + GAP),
        y: y0 + row * (CELL + GAP),
        width: CELL, height: CELL, rx: 2,
        fill: KIND_COLOURS[part.kind],
      });
      const title = svg("title");
      title.textContent = `${part.name}${perCell > 1 ? ` (about ${perCell} per cell)` : ""}`;
      cell.append(title);
      root.append(cell);
      row++;
      if (row >= ROWS) { row = 0; column++; }
    }
    seen.set(part.kind, already + cells);
  }
  memory.clear();
  for (const [kind, n] of seen) memory.set(kind, n);

  wrap.append(root);

  const caption = el("div", "muted small schematic-caption");
  caption.textContent = `${hullName ?? "Unclassed hull"} - ${compact(tons)} t${perCell > 1 ? ` - each cell is about ${perCell} parts` : ""}`;
  wrap.append(caption);

  const legend = el("div", "schematic-legend");
  const byKind = new Map<ComponentKind, number>();
  for (const p of parts) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + p.count);
  for (const kind of ORDER) {
    const n = byKind.get(kind);
    if (!n) continue;
    const item = el("span", "schematic-key");
    const swatch = el("span", "schematic-swatch");
    swatch.style.background = KIND_COLOURS[kind];
    item.append(swatch, `${n} x ${KINDS.find((k) => k.kind === kind)?.name ?? kind}`);
    legend.append(item);
  }
  wrap.append(legend);
  return wrap;
}
