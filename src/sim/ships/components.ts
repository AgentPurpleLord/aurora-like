/**
 * Component designs.
 *
 * As in Aurora, a ship is not built from a fixed catalogue: you design each
 * component - choosing a type from what you have researched, a size, and
 * where the type allows it a trade-off such as an engine's power modifier -
 * save it under a name, and then put those designs into ship classes.
 *
 * A component design is just a kind plus parameters. Everything about it is
 * derived from those, and from current research, so nothing is stored twice.
 */

import { ENGINE_TYPES, REACTOR_TYPES, type EngineType, type ReactorType } from "./engines";
import type { MineralName } from "../minerals";

/** Tons in one hull space. Speed is quoted per hull space, as in Aurora. */
export const TONS_PER_HS = 50;

export type ComponentKind =
  | "engine"
  | "reactor"
  | "fuel-tank"
  | "crew-quarters"
  | "cargo-hold"
  | "colony-module"
  | "survey-sensor"
  | "jump-drive"
  | "gate-module";

/**
 * Specification of a powered component. Commercial parts are the civilian
 * pattern: cheap, thrifty, light on crew and gentle on maintenance. Military
 * parts are built to a harder specification - more power, more output - and
 * cost, crew and wear accordingly. Holds, tanks, berths and colony modules
 * have no military pattern; they are what they are.
 */
export type Grade = "commercial" | "military";

export interface GradeFactors {
  cost: number;
  crew: number;
  /** Wear multiplier: how fast the part uses itself up. */
  wear: number;
  /** Engine thrust per hull space. */
  power: number;
  /** Engine fuel per unit of power. */
  fuel: number;
  /** Sensor survey rate, jump capacity and gate rate. */
  output: number;
}

export const GRADE_FACTORS: Record<Grade, GradeFactors> = {
  commercial: { cost: 1, crew: 1, wear: 1, power: 1, fuel: 1, output: 1 },
  military: { cost: 1.7, crew: 1.5, wear: 2.2, power: 1.3, fuel: 1.15, output: 1.3 },
};

/** Technology that allows the military specification. */
export const MILITARY_TECH = "military-specification";

/** Kinds that come in both grades. */
export const GRADED_KINDS: ReadonlySet<string> = new Set(["engine", "survey-sensor", "jump-drive", "gate-module"]);

/** Wear of a part that does not move or fire: it hardly wears at all. */
export const PASSIVE_WEAR = 0.4;

export type ParamValue = number | string;
export type ParamSet = Record<string, ParamValue>;

export interface ComponentDesign {
  id: string;
  name: string;
  kind: ComponentKind;
  params: ParamSet;
  created: number;
  /** Superseded: stays on existing ships but is hidden from new designs. */
  obsolete?: boolean;
}

export interface ComponentStats {
  tons: number;
  hullSpaces: number;
  /** Build points. */
  cost: number;
  minerals: Partial<Record<MineralName, number>>;
  crew: number;

  power?: number;
  /** Litres per hour at full thrust. */
  fuelPerHour?: number;
  fuel?: number;
  berths?: number;
  cargo?: number;
  colonists?: number;
  survey?: { type: "geological" | "gravitational"; rate: number };
  /** Reactor power a part makes (reactors) or draws (electric engines). */
  output?: number;
  powerDraw?: number;
  /** Tons of ship a jump drive can carry through a jump point, itself included. */
  jump?: number;
  /** Gate construction points per day. */
  gate?: number;
  /** How hard the part wears under way, as a multiple of a plain commercial one. */
  wear: number;
  /** Specification: commercial or military. Passive parts are always commercial. */
  grade: Grade;

  /** Figures for the designer to show, in reading order. */
  lines: [string, string][];
  /** Reasons this design cannot be used. */
  problems: string[];
}

// ----------------------------------------------------------------- engines

export { ENGINE_TYPES, REACTOR_TYPES, type EngineType, type ReactorType };

export const ENGINE_BY_ID = new Map(ENGINE_TYPES.map((e) => [e.id, e]));
export const REACTOR_BY_ID = new Map(REACTOR_TYPES.map((r) => [r.id, r]));

/** Litres of fuel in one hull space of tank, as in Aurora. */
export const FUEL_PER_HS = 50_000;

/** Overdriving an engine costs fuel with the square of the modifier. */
export const MODIFIER_FUEL_EXPONENT = 2;

/**
 * Technologies that improve parts, as ladders of [tech, value]: the highest
 * value among the researched techs applies, to every part - new and already
 * built - since part statistics are always derived from what is researched.
 */
export type Ladder = [techId: string, value: number][];

export function ladderValue(researched: ReadonlySet<string>, ladder: Ladder, base: number, pick: "max" | "min" = "max"): number {
  let value = base;
  for (const [tech, v] of ladder) {
    if (researched.has(tech)) value = pick === "max" ? Math.max(value, v) : Math.min(value, v);
  }
  return value;
}

export const POWER_MODIFIER_LADDER: Ladder = [
  ["engine-power-125", 1.25], ["engine-power-150", 1.5], ["engine-power-175", 1.75], ["engine-power-200", 2],
  ["engine-power-250", 2.5], ["engine-power-300", 3],
];
export const FUEL_USE_LADDER: Ladder = [
  ["fuel-efficiency-1", 0.9], ["fuel-efficiency-2", 0.8], ["fuel-efficiency-3", 0.7], ["fuel-efficiency-4", 0.6],
  ["fuel-efficiency-5", 0.5], ["fuel-efficiency-6", 0.4], ["fuel-efficiency-7", 0.3], ["fuel-efficiency-8", 0.25],
  ["fuel-efficiency-9", 0.2], ["fuel-efficiency-10", 0.15], ["fuel-efficiency-11", 0.125], ["fuel-efficiency-12", 0.1],
];
/** The largest single engine, in hull spaces; 20 until engine size research. */
export const ENGINE_SIZE_LADDER: Ladder = [
  ["engine-size-1", 40], ["engine-size-2", 60], ["engine-size-3", 100], ["engine-size-4", 160], ["engine-size-5", 250], ["engine-size-6", 400],
];
export const BASE_ENGINE_SIZE = 20;
/** What fraction of its hull space an engine takes for the same thrust. */
export const MINIATURE_LADDER: Ladder = [
  ["miniaturization-1", 0.4], ["miniaturization-2", 0.3], ["miniaturization-3", 0.25],
  ["miniaturization-4", 0.2], ["miniaturization-5", 0.15], ["miniaturization-6", 0.1],
];
export const TANK_LADDER: Ladder = [["tank-efficiency-1", 1.25], ["tank-efficiency-2", 1.5], ["tank-efficiency-3", 2]];
export const QUARTERS_LADDER: Ladder = [["compact-quarters-1", 1.25], ["compact-quarters-2", 1.5], ["compact-quarters-3", 2]];
export const CARGO_LADDER: Ladder = [["cargo-handling", 1.25], ["cargo-handling-2", 1.5], ["cargo-handling-3", 2]];
export const COLONIST_LADDER: Ladder = [["cryogenic-berths-1", 1.25], ["cryogenic-berths-2", 1.5], ["cryogenic-berths-3", 2]];
export const GEO_SURVEY_LADDER: Ladder = [["geo-survey-strength-1", 1.5], ["geo-survey-strength-2", 2], ["geo-survey-strength-3", 3]];
export const GRAV_SURVEY_LADDER: Ladder = [["grav-survey-strength-1", 1.5], ["grav-survey-strength-2", 2], ["grav-survey-strength-3", 3]];
export const JUMP_LADDER: Ladder = [["jump-efficiency-1", 1.25], ["jump-efficiency-2", 1.5], ["jump-efficiency-3", 2]];
export const GATE_LADDER: Ladder = [["gate-construction-2", 1.5], ["gate-construction-3", 2], ["gate-construction-4", 3]];

/** What a part-improving tech does, in words, for the technology screen. */
export function partTechNote(techId: string): string | null {
  const notes: [Ladder, (v: number) => string][] = [
    [POWER_MODIFIER_LADDER, (v) => `Engine power modifier ceiling ${v}`],
    [FUEL_USE_LADDER, (v) => `Every engine burns fuel at ${v}x the rate, existing ships included`],
    [ENGINE_SIZE_LADDER, (v) => `A single engine may be up to ${v} hull spaces`],
    [MINIATURE_LADDER, (v) => `Engines take ${v}x the hull space for the same thrust, existing ships included`],
    [TANK_LADDER, (v) => `Fuel tanks hold ${v}x as much`],
    [QUARTERS_LADDER, (v) => `Crew quarters berth ${v}x as many`],
    [CARGO_LADDER, (v) => `Cargo holds carry ${v}x as much`],
    [COLONIST_LADDER, (v) => `Colony modules carry ${v}x as many colonists`],
    [GEO_SURVEY_LADDER, (v) => `Geological survey sensors work ${v}x as fast`],
    [GRAV_SURVEY_LADDER, (v) => `Gravitational survey sensors work ${v}x as fast`],
    [JUMP_LADDER, (v) => `Jump drives carry ${v}x the tonnage`],
    [GATE_LADDER, (v) => `Gate construction modules build ${v}x as fast`],
  ];
  for (const [ladder, text] of notes) {
    const hit = ladder.find(([id]) => id === techId);
    if (hit) return `${text(hit[1])} (applies to ships already built)`;
  }
  return null;
}

export function maxPowerModifier(researched: ReadonlySet<string>): number {
  return ladderValue(researched, POWER_MODIFIER_LADDER, 1.0);
}

export function maxEngineSize(researched: ReadonlySet<string>): number {
  return ladderValue(researched, ENGINE_SIZE_LADDER, BASE_ENGINE_SIZE);
}

export function engineMiniaturisation(researched: ReadonlySet<string>): number {
  return ladderValue(researched, MINIATURE_LADDER, 1, "min");
}

export const MIN_POWER_MODIFIER = 0.25;

export function fuelEfficiency(researched: ReadonlySet<string>): number {
  return ladderValue(researched, FUEL_USE_LADDER, 1, "min");
}

// ------------------------------------------------------- sensors and the rest

export interface SensorType {
  id: "geological" | "gravitational";
  name: string;
  tech: string;
  costPerHS: number;
  /** Survey points per hull space per day. */
  ratePerHS: number;
}

export const SENSOR_TYPES: SensorType[] = [
  { id: "geological", name: "Geological Survey", tech: "geo-survey-sensors", costPerHS: 7.5, ratePerHS: 10 },
  { id: "gravitational", name: "Gravitational Survey", tech: "grav-survey-sensors", costPerHS: 8.75, ratePerHS: 10 },
];

export const SENSOR_BY_ID = new Map(SENSOR_TYPES.map((s) => [s.id, s]));

/** Survey points a body needs before its deposits are known. */
export const SURVEY_POINTS_NEEDED = 200;
/** Gravitational survey points that find one jump point in a system. */
export const JUMP_SURVEY_POINTS = 1000;
/** Construction points a jump gate takes to build. */
export const GATE_POINTS_NEEDED = 6000;
/** Tons of ship each hull space of jump drive can carry through. */
export const JUMP_TONS_PER_HS = 200;
/** Gate construction points per hull space per day. */
export const GATE_POINTS_PER_HS = 8;

// ------------------------------------------------------------------ kinds

export interface ParamDef {
  id: string;
  label: string;
  type: "size" | "choice" | "number";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  help?: string;
}

export interface KindDef {
  kind: ComponentKind;
  name: string;
  blurb: string;
  /** Technology that has to exist before this kind can be designed at all. */
  available: (researched: ReadonlySet<string>) => boolean;
  lockedReason: string;
  params: ParamDef[];
}

const sizeParam = (max: number, help?: string): ParamDef => ({
  id: "size", label: "Size", type: "size", min: 1, max, step: 1, unit: "HS", help,
});

export const KINDS: KindDef[] = [
  {
    kind: "engine",
    name: "Engine",
    blurb: "Thrust. Speed is total engine power per hull space of the whole ship.",
    available: (r) => ENGINE_TYPES.some((e) => r.has(e.tech)),
    lockedReason: "Research the Conventional Engine.",
    params: [
      { id: "type", label: "Engine type", type: "choice" },
      { id: "grade", label: "Specification", type: "choice", help: "Military engines push 30% harder and cost 70% more; they need more crew and wear faster." },
      sizeParam(400, "Bigger engines push harder but weigh more. The ceiling rises with engine size research."),
      {
        id: "modifier", label: "Power modifier", type: "number",
        min: MIN_POWER_MODIFIER, max: 1.25, step: 0.05, unit: "x",
        help: "Above 1.0 buys thrust at a steep fuel premium; below 1.0 saves fuel for range.",
      },
    ],
  },
  {
    kind: "reactor",
    name: "Reactor",
    blurb: "Power for shipboard systems. Nothing aboard needs it yet; weapons and shields will.",
    available: (r) => REACTOR_TYPES.some((t) => r.has(t.tech)),
    lockedReason: "Research a power system, starting with Chemical Power: Solid Fuel Cell.",
    params: [
      { id: "type", label: "Power system", type: "choice" },
      sizeParam(40, "Output is per hull space and rises with the power system's tier."),
    ],
  },
  {
    kind: "fuel-tank",
    name: "Fuel Tank",
    blurb: "Litres of refined Sorium. Range is fuel divided by burn, times speed.",
    available: (r) => r.has("trans-newtonian"),
    lockedReason: "Research Trans-Newtonian Technology.",
    params: [sizeParam(40)],
  },
  {
    kind: "crew-quarters",
    name: "Crew Quarters",
    blurb: "Berths for the crew every other component needs.",
    available: (r) => r.has("trans-newtonian"),
    lockedReason: "Research Trans-Newtonian Technology.",
    params: [sizeParam(20)],
  },
  {
    kind: "cargo-hold",
    name: "Cargo Hold",
    blurb: "Tons of minerals or crated installations.",
    available: (r) => r.has("trans-newtonian"),
    lockedReason: "Research Trans-Newtonian Technology.",
    params: [sizeParam(40)],
  },
  {
    kind: "colony-module",
    name: "Cryogenic Berths",
    blurb: "Colonists in cold sleep.",
    available: (r) => r.has("trans-newtonian"),
    lockedReason: "Research Trans-Newtonian Technology.",
    params: [sizeParam(40)],
  },
  {
    kind: "survey-sensor",
    name: "Survey Sensor",
    blurb: "Surveys a body's mineral deposits from orbit; bigger sensors finish sooner.",
    available: (r) => SENSOR_TYPES.some((s) => r.has(s.tech)),
    lockedReason: "Research Geological Survey Sensors.",
    params: [
      { id: "type", label: "Sensor type", type: "choice" },
      { id: "grade", label: "Specification", type: "choice", help: "Military sensors work 30% faster, at a higher price." },
      sizeParam(20),
    ],
  },
  {
    kind: "jump-drive",
    name: "Jump Drive",
    blurb: "Carries a ship (and any others in its fleet) through a jump point without a gate. Rated in tons of ship.",
    available: (r) => r.has("jump-point-theory"),
    lockedReason: "Research Jump Point Theory.",
    params: [
      { id: "grade", label: "Specification", type: "choice", help: "Military drives carry 25% more." },
      sizeParam(40, "Each hull space can carry 200 tons through."),
    ],
  },
  {
    kind: "gate-module",
    name: "Gate Construction Module",
    blurb: "Stabilises a jump point the fleet has crossed, so any ship can use it. Bigger modules finish sooner.",
    available: (r) => r.has("jump-gate-construction"),
    lockedReason: "Research Jump Gate Construction.",
    params: [
      { id: "grade", label: "Specification", type: "choice", help: "Military modules build gates 30% faster." },
      sizeParam(60, "Each hull space adds 8 construction points a day."),
    ],
  },
];

export const KIND_BY_ID = new Map(KINDS.map((k) => [k.kind, k]));

/** Options for a choice parameter, with the ones not yet researched marked. */
export function choiceOptions(
  kind: ComponentKind,
  paramId: string,
  researched: ReadonlySet<string>,
): { value: string; label: string; locked: boolean }[] {
  if (paramId === "grade") {
    return [
      { value: "commercial", label: "Commercial", locked: false },
      { value: "military", label: "Military", locked: !researched.has(MILITARY_TECH) },
    ];
  }
  if (paramId !== "type") return [];
  if (kind === "engine") {
    return ENGINE_TYPES.map((e) => ({ value: e.id, label: e.name, locked: !researched.has(e.tech) }));
  }
  if (kind === "reactor") {
    return REACTOR_TYPES.map((t) => ({ value: t.id, label: t.name, locked: !researched.has(t.tech) }));
  }
  if (kind === "survey-sensor") {
    return SENSOR_TYPES.map((s) => ({ value: s.id, label: s.name, locked: !researched.has(s.tech) }));
  }
  return [];
}

/**
 * The strongest researched engine that needs no reactor, for standard
 * designs; ships built from the standard parts have no power system.
 */
export function bestSelfPoweredEngine(researched: ReadonlySet<string>): EngineType | undefined {
  return ENGINE_TYPES.filter((e) => e.powerDraw === 0 && researched.has(e.tech))
    .sort((a, b) => b.powerPerHS - a.powerPerHS || b.tier - a.tier)[0];
}

/** A sensible starting design for a kind, using the best thing researched. */
export function defaultParams(kind: ComponentKind, researched: ReadonlySet<string>): ParamSet {
  switch (kind) {
    case "engine": {
      const best = bestSelfPoweredEngine(researched) ?? ENGINE_TYPES[0];
      return { type: best.id, grade: "commercial", size: 5, modifier: 1 };
    }
    case "reactor": {
      const best = [...REACTOR_TYPES].reverse().find((t) => researched.has(t.tech)) ?? REACTOR_TYPES[0];
      return { type: best.id, size: 5 };
    }
    case "fuel-tank": return { size: 5 };
    case "crew-quarters": return { size: 2 };
    case "cargo-hold": return { size: 20 };
    case "colony-module": return { size: 20 };
    case "survey-sensor": {
      const best = SENSOR_TYPES.find((s) => researched.has(s.tech)) ?? SENSOR_TYPES[0];
      return { type: best.id, grade: "commercial", size: 4 };
    }
    case "jump-drive": return { grade: "commercial", size: 10 };
    case "gate-module": return { grade: "commercial", size: 20 };
  }
}

// ------------------------------------------------------------- derivation

/** Snap to a step without leaving float noise like 0.6000000000000001. */
const roundTo = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(6));

/** Clamp every parameter into its allowed range. */
export function normaliseParams(
  kind: ComponentKind,
  params: ParamSet,
  researched: ReadonlySet<string>,
): ParamSet {
  const def = KIND_BY_ID.get(kind);
  const base = defaultParams(kind, researched);
  const out: ParamSet = { ...base, ...params };
  if (!def) return out;

  for (const p of def.params) {
    if (p.type === "choice") continue;
    const raw = Number(out[p.id]);
    let max = p.max ?? Infinity;
    if (kind === "engine" && p.id === "modifier") max = maxPowerModifier(researched);
    if (kind === "engine" && p.id === "size") max = maxEngineSize(researched);
    const clamped = Math.min(max, Math.max(p.min ?? 0, Number.isFinite(raw) ? raw : Number(base[p.id])));
    out[p.id] = roundTo(clamped, p.step ?? 1);
  }
  return out;
}

const fmt = (value: number, digits = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function componentStats(
  kind: ComponentKind,
  rawParams: ParamSet,
  researched: ReadonlySet<string>,
): ComponentStats {
  const params = normaliseParams(kind, rawParams, researched);
  const size = Number(params.size);
  const tons = size * TONS_PER_HS;
  const problems: string[] = [];

  const graded = GRADED_KINDS.has(kind);
  const grade: Grade = graded && params.grade === "military" ? "military" : "commercial";
  const g = GRADE_FACTORS[grade];
  const result: ComponentStats = {
    tons,
    hullSpaces: size,
    cost: 0,
    minerals: {},
    crew: 0,
    wear: graded ? g.wear : PASSIVE_WEAR,
    grade,
    lines: [],
    problems,
  };
  if (grade === "military" && !researched.has(MILITARY_TECH)) {
    problems.push("The military specification has not been researched.");
  }
  const mineral = (name: MineralName, share: number) => {
    result.minerals[name] = Math.round(result.cost * share * 10) / 10;
  };

  switch (kind) {
    case "engine": {
      const type = ENGINE_BY_ID.get(String(params.type));
      if (!type) {
        problems.push("Choose an engine type.");
        break;
      }
      if (!researched.has(type.tech)) problems.push(`${type.name} has not been researched.`);
      const modifier = Number(params.modifier);
      const mini = engineMiniaturisation(researched);
      result.power = size * type.powerPerHS * modifier * g.power;
      result.fuelPerHour =
        result.power * type.fuelPerPower * g.fuel * Math.pow(modifier, MODIFIER_FUEL_EXPONENT) * fuelEfficiency(researched);
      result.cost = Math.round(size * type.costPerHS * modifier * g.cost * 10) / 10;
      result.crew = Math.ceil(size * type.crewPerHS * g.crew);
      // Miniaturisation shrinks the engine, not its thrust.
      result.tons = tons * mini;
      result.hullSpaces = size * mini;
      if (type.powerDraw > 0) result.powerDraw = size * type.powerDraw * modifier;
      mineral("Gallicite", 0.5);
      result.lines.push(
        ["Power", fmt(result.power, 1)],
        ["Fuel burn", `${fmt(result.fuelPerHour)} l/hour`],
        ["Fuel per power-hour", fmt(result.fuelPerHour / result.power, 2)],
        ["Power per ton", fmt(result.power / result.tons, 2)],
      );
      if (mini < 1) result.lines.push(["Miniaturisation", `${mini}x the hull space`]);
      if (result.powerDraw) result.lines.push(["Reactor power drawn", fmt(result.powerDraw, 1)]);
      break;
    }
    case "reactor": {
      const type = REACTOR_BY_ID.get(String(params.type));
      if (!type) {
        problems.push("Choose a power system.");
        break;
      }
      if (!researched.has(type.tech)) problems.push(`${type.name} has not been researched.`);
      result.output = size * type.output;
      result.cost = Math.round(size * type.costPerHS * 10) / 10;
      result.crew = Math.ceil(size * type.crewPerHS);
      mineral("Corbomite", 0.5);
      mineral("Duranium", 0.3);
      result.lines.push(["Power output", fmt(result.output, 1)], ["Output per hull space", fmt(type.output, 1)]);
      break;
    }
    case "fuel-tank": {
      result.fuel = size * FUEL_PER_HS * ladderValue(researched, TANK_LADDER, 1);
      result.cost = size * 1;
      mineral("Duranium", 0.6);
      result.lines.push(["Capacity", `${fmt(result.fuel)} l`]);
      break;
    }
    case "crew-quarters": {
      result.berths = size * 10 * ladderValue(researched, QUARTERS_LADDER, 1);
      result.cost = size * 2.5;
      mineral("Duranium", 0.6);
      result.lines.push(["Berths", fmt(result.berths)]);
      break;
    }
    case "cargo-hold": {
      result.cargo = size * 1250 * ladderValue(researched, CARGO_LADDER, 1);
      result.cost = size * 1.25;
      result.crew = Math.ceil(size * 0.1);
      mineral("Duranium", 0.8);
      result.lines.push(["Capacity", `${fmt(result.cargo)} t`]);
      break;
    }
    case "colony-module": {
      result.colonists = size * 2500 * ladderValue(researched, COLONIST_LADDER, 1);
      result.cost = size * 1.5;
      result.crew = Math.ceil(size * 0.2);
      mineral("Duranium", 0.5);
      mineral("Mercassium", 0.33);
      result.lines.push(["Colonists", fmt(result.colonists)]);
      break;
    }
    case "survey-sensor": {
      const type = SENSOR_BY_ID.get(String(params.type) as "geological");
      if (!type) {
        problems.push("Choose a sensor type.");
        break;
      }
      if (!researched.has(type.tech)) problems.push(`${type.name} Sensors have not been researched.`);
      const rate = size * type.ratePerHS * g.output *
        ladderValue(researched, type.id === "geological" ? GEO_SURVEY_LADDER : GRAV_SURVEY_LADDER, 1);
      result.survey = { type: type.id, rate };
      result.cost = size * type.costPerHS * g.cost;
      result.crew = Math.ceil(size * 1 * g.crew);
      mineral("Uridium", 0.5);
      result.lines.push(
        ["Survey rate", `${fmt(rate)} points/day`],
        ["Time per body", `${fmt(SURVEY_POINTS_NEEDED / rate, 1)} days`],
      );
      break;
    }
    case "jump-drive": {
      result.jump = size * JUMP_TONS_PER_HS * g.output * ladderValue(researched, JUMP_LADDER, 1);
      result.cost = size * 15 * g.cost;
      result.crew = Math.ceil(size * 0.8 * g.crew);
      mineral("Corbomite", 0.5);
      mineral("Gallicite", 0.2);
      result.lines.push(
        ["Jump capacity", `${fmt(result.jump)} t`],
        ["Carries itself?", result.jump >= tons ? "Yes" : "No - too heavy for itself"],
      );
      if (result.jump < tons) problems.push("The drive is too heavy to jump itself.");
      break;
    }
    case "gate-module": {
      result.gate = size * GATE_POINTS_PER_HS * g.output * ladderValue(researched, GATE_LADDER, 1);
      result.cost = size * 12 * g.cost;
      result.crew = Math.ceil(size * 0.5 * g.crew);
      mineral("Tritanium", 0.4);
      mineral("Duranium", 0.3);
      result.lines.push(
        ["Gate points", `${fmt(result.gate)} /day`],
        ["Time per gate", `${fmt(GATE_POINTS_NEEDED / result.gate, 0)} days`],
      );
      break;
    }
  }

  result.lines.unshift(
    ["Size", `${fmt(size)} HS  (${fmt(tons)} t)`],
    ["Build cost", `${fmt(result.cost, 1)} BP`],
  );
  if (graded) result.lines.splice(1, 0, ["Specification", grade === "military" ? "Military" : "Commercial"]);
  result.lines.push(["Wear", `${fmt(result.wear, 1)}x ${result.wear <= 0.5 ? "(hardly wears)" : result.wear > 1.5 ? "(hard on maintenance)" : ""}`.trim()]);
  if (result.crew > 0) result.lines.push(["Crew", fmt(result.crew)]);
  return result;
}

/** A name that says what the component is. */
export function suggestName(kind: ComponentKind, rawParams: ParamSet, researched: ReadonlySet<string>): string {
  const params = normaliseParams(kind, rawParams, researched);
  const size = `${params.size}HS`;
  const military = GRADED_KINDS.has(kind) && params.grade === "military" ? "Military " : "";
  switch (kind) {
    case "engine": {
      const type = ENGINE_BY_ID.get(String(params.type));
      const modifier = Number(params.modifier);
      const tuned = Math.abs(modifier - 1) > 0.001 ? ` x${modifier.toFixed(2)}` : "";
      return `${military}${type?.name ?? "Engine"} ${size}${tuned}`;
    }
    case "reactor": {
      const type = REACTOR_BY_ID.get(String(params.type));
      return `${type?.name ?? "Reactor"} Reactor ${size}`;
    }
    case "fuel-tank": return `Fuel Tank ${size}`;
    case "crew-quarters": return `Crew Quarters ${size}`;
    case "cargo-hold": return `Cargo Hold ${size}`;
    case "colony-module": return `Cryogenic Berths ${size}`;
    case "survey-sensor": {
      const type = SENSOR_BY_ID.get(String(params.type) as "geological");
      return `${military}${type?.name ?? "Survey"} Sensor ${size}`;
    }
    case "jump-drive": return `${military}Jump Drive ${size}`;
    case "gate-module": return `${military}Gate Construction Module ${size}`;
  }
}

export function designStatsFor(design: ComponentDesign, researched: ReadonlySet<string>): ComponentStats {
  return componentStats(design.kind, design.params, researched);
}
