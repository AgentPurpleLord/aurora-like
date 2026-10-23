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

import type { MineralName } from "../minerals";

/** Tons in one hull space. Speed is quoted per hull space, as in Aurora. */
export const TONS_PER_HS = 50;

export type ComponentKind =
  | "engine"
  | "fuel-tank"
  | "crew-quarters"
  | "cargo-hold"
  | "colony-module"
  | "survey-sensor"
  | "jump-drive"
  | "gate-module";

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
  /** Tons of ship a jump drive can carry through a jump point, itself included. */
  jump?: number;
  /** Gate construction points per day. */
  gate?: number;

  /** Figures for the designer to show, in reading order. */
  lines: [string, string][];
  /** Reasons this design cannot be used. */
  problems: string[];
}

// ----------------------------------------------------------------- engines

export interface EngineType {
  id: string;
  name: string;
  tech: string;
  /** Engine power per hull space at modifier 1.0. */
  powerPerHS: number;
  /** Litres per power-hour at modifier 1.0. */
  fuelPerPower: number;
  costPerHS: number;
  crewPerHS: number;
}

export const ENGINE_TYPES: EngineType[] = [
  { id: "nuclear-thermal", name: "Nuclear Thermal", tech: "nuclear-thermal", powerPerHS: 12, fuelPerPower: 5, costPerHS: 4, crewPerHS: 0.6 },
  { id: "nuclear-pulse", name: "Nuclear Pulse", tech: "nuclear-pulse", powerPerHS: 24, fuelPerPower: 4, costPerHS: 6.4, crewPerHS: 0.6 },
  { id: "ion", name: "Ion Drive", tech: "ion-drive", powerPerHS: 40, fuelPerPower: 3.5, costPerHS: 9.6, crewPerHS: 0.8 },
  { id: "magneto-plasma", name: "Magneto-Plasma", tech: "magneto-plasma", powerPerHS: 64, fuelPerPower: 3, costPerHS: 14, crewPerHS: 1 },
];

export const ENGINE_BY_ID = new Map(ENGINE_TYPES.map((e) => [e.id, e]));

/** Overdriving an engine costs fuel with the square of the modifier. */
export const MODIFIER_FUEL_EXPONENT = 2;

export function maxPowerModifier(researched: ReadonlySet<string>): number {
  return researched.has("engine-power-125") ? 1.25 : 1.0;
}

export const MIN_POWER_MODIFIER = 0.25;

export function fuelEfficiency(researched: ReadonlySet<string>): number {
  return researched.has("fuel-consumption-08") ? 0.8 : 1;
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
    lockedReason: "Research Nuclear Thermal Engine Technology.",
    params: [
      { id: "type", label: "Engine type", type: "choice" },
      sizeParam(50, "Bigger engines push harder but weigh more."),
      {
        id: "modifier", label: "Power modifier", type: "number",
        min: MIN_POWER_MODIFIER, max: 1.25, step: 0.05, unit: "x",
        help: "Above 1.0 buys thrust at a steep fuel premium; below 1.0 saves fuel for range.",
      },
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
      sizeParam(20),
    ],
  },
  {
    kind: "jump-drive",
    name: "Jump Drive",
    blurb: "Carries a ship (and any others in its fleet) through a jump point without a gate. Rated in tons of ship.",
    available: (r) => r.has("jump-point-theory"),
    lockedReason: "Research Jump Point Theory.",
    params: [sizeParam(40, "Each hull space can carry 200 tons through.")],
  },
  {
    kind: "gate-module",
    name: "Gate Construction Module",
    blurb: "Stabilises a jump point the fleet has crossed, so any ship can use it. Bigger modules finish sooner.",
    available: (r) => r.has("jump-gate-construction"),
    lockedReason: "Research Jump Gate Construction.",
    params: [sizeParam(60, "Each hull space adds 8 construction points a day.")],
  },
];

export const KIND_BY_ID = new Map(KINDS.map((k) => [k.kind, k]));

/** Options for a choice parameter, with the ones not yet researched marked. */
export function choiceOptions(
  kind: ComponentKind,
  paramId: string,
  researched: ReadonlySet<string>,
): { value: string; label: string; locked: boolean }[] {
  if (paramId !== "type") return [];
  if (kind === "engine") {
    return ENGINE_TYPES.map((e) => ({ value: e.id, label: e.name, locked: !researched.has(e.tech) }));
  }
  if (kind === "survey-sensor") {
    return SENSOR_TYPES.map((s) => ({ value: s.id, label: s.name, locked: !researched.has(s.tech) }));
  }
  return [];
}

/** A sensible starting design for a kind, using the best thing researched. */
export function defaultParams(kind: ComponentKind, researched: ReadonlySet<string>): ParamSet {
  switch (kind) {
    case "engine": {
      const best = [...ENGINE_TYPES].reverse().find((e) => researched.has(e.tech)) ?? ENGINE_TYPES[0];
      return { type: best.id, size: 5, modifier: 1 };
    }
    case "fuel-tank": return { size: 5 };
    case "crew-quarters": return { size: 2 };
    case "cargo-hold": return { size: 20 };
    case "colony-module": return { size: 20 };
    case "survey-sensor": {
      const best = SENSOR_TYPES.find((s) => researched.has(s.tech)) ?? SENSOR_TYPES[0];
      return { type: best.id, size: 4 };
    }
    case "jump-drive": return { size: 10 };
    case "gate-module": return { size: 20 };
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

  const result: ComponentStats = {
    tons,
    hullSpaces: size,
    cost: 0,
    minerals: {},
    crew: 0,
    lines: [],
    problems,
  };
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
      result.power = size * type.powerPerHS * modifier;
      result.fuelPerHour =
        result.power * type.fuelPerPower * Math.pow(modifier, MODIFIER_FUEL_EXPONENT) * fuelEfficiency(researched);
      result.cost = Math.round(size * type.costPerHS * modifier * 10) / 10;
      result.crew = Math.ceil(size * type.crewPerHS);
      mineral("Gallicite", 0.5);
      result.lines.push(
        ["Power", fmt(result.power, 1)],
        ["Fuel burn", `${fmt(result.fuelPerHour)} l/hour`],
        ["Fuel per power-hour", fmt(result.fuelPerHour / result.power, 2)],
        ["Power per ton", fmt(result.power / tons, 2)],
      );
      break;
    }
    case "fuel-tank": {
      result.fuel = size * 10_000;
      result.cost = size * 1;
      mineral("Duranium", 0.6);
      result.lines.push(["Capacity", `${fmt(result.fuel)} l`]);
      break;
    }
    case "crew-quarters": {
      result.berths = size * 10;
      result.cost = size * 2.5;
      mineral("Duranium", 0.6);
      result.lines.push(["Berths", fmt(result.berths)]);
      break;
    }
    case "cargo-hold": {
      result.cargo = size * 1250;
      result.cost = size * 1.25;
      result.crew = Math.ceil(size * 0.1);
      mineral("Duranium", 0.8);
      result.lines.push(["Capacity", `${fmt(result.cargo)} t`]);
      break;
    }
    case "colony-module": {
      result.colonists = size * 2500;
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
      const rate = size * type.ratePerHS;
      result.survey = { type: type.id, rate };
      result.cost = size * type.costPerHS;
      result.crew = Math.ceil(size * 1);
      mineral("Uridium", 0.5);
      result.lines.push(
        ["Survey rate", `${fmt(rate)} points/day`],
        ["Time per body", `${fmt(SURVEY_POINTS_NEEDED / rate, 1)} days`],
      );
      break;
    }
    case "jump-drive": {
      result.jump = size * JUMP_TONS_PER_HS;
      result.cost = size * 15;
      result.crew = Math.ceil(size * 0.8);
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
      result.gate = size * GATE_POINTS_PER_HS;
      result.cost = size * 12;
      result.crew = Math.ceil(size * 0.5);
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
  if (result.crew > 0) result.lines.push(["Crew", fmt(result.crew)]);
  return result;
}

/** A name that says what the component is. */
export function suggestName(kind: ComponentKind, rawParams: ParamSet, researched: ReadonlySet<string>): string {
  const params = normaliseParams(kind, rawParams, researched);
  const size = `${params.size}HS`;
  switch (kind) {
    case "engine": {
      const type = ENGINE_BY_ID.get(String(params.type));
      const modifier = Number(params.modifier);
      const tuned = Math.abs(modifier - 1) > 0.001 ? ` x${modifier.toFixed(2)}` : "";
      return `${type?.name ?? "Engine"} ${size}${tuned}`;
    }
    case "fuel-tank": return `Fuel Tank ${size}`;
    case "crew-quarters": return `Crew Quarters ${size}`;
    case "cargo-hold": return `Cargo Hold ${size}`;
    case "colony-module": return `Cryogenic Berths ${size}`;
    case "survey-sensor": {
      const type = SENSOR_BY_ID.get(String(params.type) as "geological");
      return `${type?.name ?? "Survey"} Sensor ${size}`;
    }
    case "jump-drive": return `Jump Drive ${size}`;
    case "gate-module": return `Gate Construction Module ${size}`;
  }
}

export function designStatsFor(design: ComponentDesign, researched: ReadonlySet<string>): ComponentStats {
  return componentStats(design.kind, design.params, researched);
}
