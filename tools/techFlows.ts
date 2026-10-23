/**
 * Conversion between the tech tree as data (src/data/techs.json) and the Flyde
 * flows in flows/ that it is authored in. Pure functions; the CLI wrappers are
 * tools/techs-to-flyde.ts and tools/build-techs.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import type { Tech, TechEffect } from "../src/sim/research/techs";

export const NODE_IMPORT = "nodes/Tech.flyde.ts";
const COL = 340;
const ROW = 300;
const BRANCH_GAP = 120;

export function effectsToText(effects: TechEffect[] | undefined): string {
  return (effects ?? []).map((e) =>
    e.kind === "unlock" ? `unlock ${e.installation}` : `${e.stat} ${e.kind === "add" ? "+=" : "="} ${e.value}`,
  ).join("\n");
}

export function textToEffects(text: string): TechEffect[] {
  const out: TechEffect[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const unlock = /^unlock\s+(\S+)$/.exec(line);
    if (unlock) { out.push({ kind: "unlock", installation: unlock[1] }); continue; }
    const m = /^(\w+)\s*(\+=|=)\s*(-?[\d.]+(?:e-?\d+)?)$/.exec(line);
    if (!m) throw new Error(`bad effect line: "${line}"`);
    out.push({ kind: m[2] === "+=" ? "add" : "set", stat: m[1], value: Number(m[3]) } as TechEffect);
  }
  return out;
}

type Cfg = Record<string, { type: string; value: unknown }>;

function configFor(t: Tech): Cfg {
  const s = (value: string) => ({ type: "string", value });
  return {
    techId: s(t.id), name: s(t.name), field: s(t.field), branch: s(t.branch ?? "General"),
    cost: { type: "number", value: t.cost }, future: { type: "boolean", value: !!t.future },
    effects: s(effectsToText(t.effects)),
    extraPrereqs: s(""),
    description: s(t.description),
  };
}

/** One flow per field: nodes laid out in columns by depth, rows grouped by sub-field. */
export function techsToFlow(field: string, all: Tech[]): string {
  const mine = all.filter((t) => t.field === field);
  const ids = new Set(mine.map((t) => t.id));
  const byId = new Map(mine.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const depthOf = (t: Tech): number => {
    const known = depth.get(t.id);
    if (known !== undefined) return known;
    const d = Math.max(-1, ...t.prereqs.filter((p) => ids.has(p)).map((p) => depthOf(byId.get(p)!))) + 1;
    depth.set(t.id, d);
    return d;
  };
  mine.forEach(depthOf);
  const branches = [...new Set(mine.map((t) => t.branch))];
  let y = 0;
  const pos = new Map<string, { x: number; y: number }>();
  for (const b of branches) {
    const rows = new Map<number, number>();
    let used = 0;
    for (const t of mine.filter((x) => x.branch === b)) {
      const col = depth.get(t.id)!;
      const r = rows.get(col) ?? 0;
      rows.set(col, r + 1);
      used = Math.max(used, r + 1);
      pos.set(t.id, { x: col * COL, y: y + r * ROW });
    }
    y += used * ROW + BRANCH_GAP;
  }
  const instances = mine.map((t) => {
    const cfg = configFor(t);
    cfg.extraPrereqs.value = t.prereqs.filter((p) => !ids.has(p)).join(", ");
    return {
      id: t.id, type: "code", nodeId: "Tech", source: { type: "file", data: NODE_IMPORT },
      inputConfig: {}, visibleInputs: ["requires"], visibleOutputs: ["unlocks"], config: cfg, pos: pos.get(t.id)!, displayName: t.name,
    };
  });
  const connections = mine.flatMap((t) => t.prereqs.filter((p) => ids.has(p)).map((p) => ({
    from: { insId: p, pinId: "unlocks" }, to: { insId: t.id, pinId: "requires" },
  })));
  const doc = {
    node: {
      instances, connections, id: `tech-${field}`, inputs: {}, outputs: {},
      inputsPosition: {}, outputsPosition: {},
    },
  };
  return stringify(doc, { lineWidth: 0 });
}

/** Read flow files back into tech definitions. Order: field, then first appearance. */
export function flowToTechs(yamlText: string, file = "flow"): Tech[] {
  const doc = parse(yamlText);
  const node = doc?.node;
  if (!node) throw new Error(`${file}: no node`);
  const wires = new Map<string, string[]>();
  for (const c of node.connections ?? []) {
    if (c.to.insId === "__this" || c.from.insId === "__this") continue;
    if (c.to.pinId !== "requires" || c.from.pinId !== "unlocks") {
      throw new Error(`${file}: wire ${c.from.insId}.${c.from.pinId} -> ${c.to.insId}.${c.to.pinId} must go unlocks -> requires`);
    }
    wires.set(c.to.insId, [...(wires.get(c.to.insId) ?? []), c.from.insId]);
  }
  const idOf = new Map<string, string>();
  for (const ins of node.instances ?? []) idOf.set(ins.id, ins.config?.techId?.value ?? ins.id);
  const techs: Tech[] = [];
  for (const ins of node.instances ?? []) {
    const c = ins.config ?? {};
    const v = <T>(k: string, d: T): T => (c[k]?.value ?? d) as T;
    const extra = v("extraPrereqs", "").split(",").map((p: string) => p.trim()).filter(Boolean);
    const prereqs = [...(wires.get(ins.id) ?? []).map((i) => idOf.get(i) ?? i), ...extra];
    const effects = textToEffects(v("effects", ""));
    techs.push({
      id: v("techId", ins.id), name: v("name", ""), field: v("field", "construction") as Tech["field"],
      branch: v("branch", "General"), cost: v("cost", 0), prereqs,
      ...(effects.length ? { effects } : {}), ...(v("future", false) ? { future: true } : {}),
      description: v("description", ""),
    });
  }
  return techs;
}

export function loadFlowTechs(dir = "flows"): Tech[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".flyde")).sort();
  return files.flatMap((f) => flowToTechs(readFileSync(`${dir}/${f}`, "utf8"), f));
}
