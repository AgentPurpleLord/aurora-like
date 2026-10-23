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
  "engine", "reactor", "fuel-tank", "crew-quarters", "cargo-hold", "colony-module", "survey-sensor", "gate-module", "jump-drive",
];

export const KIND_COLOURS: Record<ComponentKind, string> = {
  "engine": "#ff9a4d",
  "reactor": "#ffe14d",
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
  const height = 120;
  const root = svg("svg", { class: "schematic-svg", viewBox: `0 0 ${width + 40} ${height}`, role: "img", "aria-label": "Ship schematic" });

  // Hull outline: engine block at the back, a blunt nose at the front.
  const left = 20;
  const right = left + width;
  const mid = height / 2;
  const outline = svg("path", {
    class: `schematic-hull${total ? "" : " empty"}`,
    d: `M ${left} ${mid - 36} L ${left + 22} ${mid - 40} L ${right - 50} ${mid - 40} Q ${right - 8} ${mid - 30} ${right + 8} ${mid} Q ${right - 8} ${mid + 30} ${right - 50} ${mid + 40} L ${left + 22} ${mid + 40} L ${left} ${mid + 36} Z`,
  });
  root.append(outline);
  // Engine bells.
  for (const dy of [-22, 0, 22]) {
    root.append(svg("path", { class: "schematic-bell", d: `M ${left} ${mid + dy - 8} L ${left - 10} ${mid + dy - 11} L ${left - 10} ${mid + dy + 11} L ${left} ${mid + dy + 8} Z` }));
  }

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
