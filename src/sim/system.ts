/**
 * Runtime model of a star system: the body tree, world positions at a given
 * time, and the derived figures the colony UI cares about.
 */

import { BODIES, type BodyDef, type BodyClass } from "../data/bodies";
import {
  AU_KM,
  DAYS_PER_YEAR,
  apoapsis,
  periapsis,
  positionAt,
  positionAtEccentricAnomaly,
  vecAdd,
  vecLength,
  vecSub,
  type OrbitalElements,
  type Vec3,
} from "./orbit";
import { mineralsFor, type MineralDeposit } from "./minerals";
import { mulberry32 } from "./rng";
import {
  PRESSURE_MAX_BREATHABLE,
  TEMP_MAX,
  TEMP_MIN,
  cloneAtmosphere,
  isBreathable,
  toxicGases,
  totalPressure,
  surfaceTemperature,
  type Atmosphere,
} from "./atmosphere";

const G = 6.674e-11;
const EARTH_G = 9.80665;

export interface Body {
  def: BodyDef;
  id: string;
  name: string;
  cls: BodyClass;
  parent: Body | null;
  children: Body[];
  /** Root-relative depth: the star is 0, planets 1, moons 2. */
  depth: number;

  /** Position relative to the parent, AU, updated every tick. */
  local: Vec3;
  /** Position relative to the system's star, AU, updated every tick. */
  world: Vec3;

  /** Surface gravity in Earth gravities. */
  gravity: number;
  /** Current atmosphere, in partial pressures. Terraforming changes it. */
  atmosphere: Atmosphere;
  /** Current surface temperature in kelvin, warmed by the atmosphere. */
  tempK: number;
  /** Escape velocity, km/s. */
  escapeVelocity: number;
  /** Orbital period in days, 0 for the star. */
  periodDays: number;
  /** Aurora-style colony cost; 0 means directly habitable. */
  colonyCost: number;
  minerals: MineralDeposit[];
  /** Cached orbit path in the parent's frame, AU. */
  orbitPath: Vec3[];
}

/** A dust-mote object: belt filler with an orbit but no detail panel. */
export interface Mote {
  orbit: OrbitalElements;
  world: Vec3;
  size: number;
  shade: number;
}

export class StarSystem {
  readonly name = "Sol";
  readonly bodies: Body[] = [];
  readonly byId = new Map<string, Body>();
  readonly root: Body;
  readonly motes: Mote[];

  constructor(defs: BodyDef[] = BODIES) {
    for (const def of defs) {
      const body = this.createBody(def);
      this.bodies.push(body);
      this.byId.set(body.id, body);
    }
    for (const body of this.bodies) {
      if (!body.def.parent) continue;
      const parent = this.byId.get(body.def.parent);
      if (!parent) throw new Error(`unknown parent ${body.def.parent} for ${body.id}`);
      body.parent = parent;
      parent.children.push(body);
    }
    for (const body of this.bodies) {
      body.depth = depthOf(body);
      body.orbitPath = tracePath(body.def.orbit);
    }
    const root = this.bodies.find((b) => b.parent === null);
    if (!root) throw new Error("system has no root body");
    this.root = root;
    this.motes = buildMotes();
    this.update(0);
  }

  private createBody(def: BodyDef): Body {
    const rMeters = def.radiusKm * 1000;
    const gravity = (G * def.massKg) / (rMeters * rMeters) / EARTH_G;
    const escapeVelocity = Math.sqrt((2 * G * def.massKg) / rMeters) / 1000;
    const body: Body = {
      def,
      id: def.id,
      name: def.name,
      cls: def.cls,
      parent: null,
      children: [],
      depth: 0,
      local: { x: 0, y: 0, z: 0 },
      world: { x: 0, y: 0, z: 0 },
      gravity,
      atmosphere: cloneAtmosphere(def.atmosphere ?? {}),
      tempK: def.tempK ?? 0,
      escapeVelocity,
      periodDays: def.orbit ? Math.abs(def.orbit.periodDays) : 0,
      colonyCost: Infinity,
      minerals: mineralsFor(def),
      orbitPath: [],
    };
    recomputeEnvironment(body);
    return body;
  }

  /** Recompute every position for time `t`, in days since J2000. */
  update(t: number): void {
    // `bodies` is in definition order, which is parent-before-child, so a
    // single pass is enough to accumulate world positions down the tree.
    for (const body of this.bodies) {
      if (body.def.orbit) {
        body.local = positionAt(body.def.orbit, t);
      }
      body.world = body.parent ? vecAdd(body.parent.world, body.local) : { x: 0, y: 0, z: 0 };
    }
    for (const mote of this.motes) {
      mote.world = positionAt(mote.orbit, t);
    }
  }

  /** Distance between two bodies in AU. */
  distance(a: Body, b: Body): number {
    return vecLength(vecSub(a.world, b.world));
  }

  /** Bodies in tree order, for the system list panel. */
  tree(): Body[] {
    const out: Body[] = [];
    const walk = (b: Body) => {
      out.push(b);
      const kids = [...b.children].sort(
        (x, y) => (x.def.orbit?.a ?? 0) - (y.def.orbit?.a ?? 0),
      );
      kids.forEach(walk);
    };
    walk(this.root);
    return out;
  }
}

function depthOf(body: Body): number {
  let d = 0;
  let cur = body.parent;
  while (cur) {
    d++;
    cur = cur.parent;
  }
  return d;
}

/** 180 sample points around the ellipse, in the parent's frame. */
function tracePath(orbit: OrbitalElements | undefined): Vec3[] {
  if (!orbit) return [];
  const steps = 180;
  const path: Vec3[] = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    path[i] = positionAtEccentricAnomaly(orbit, (i / steps) * Math.PI * 2);
  }
  return path;
}

/**
 * Recompute everything that follows from a body's atmosphere. Called when a
 * world is created and whenever terraforming changes the air.
 */
export function recomputeEnvironment(body: Body): void {
  body.tempK = surfaceTemperature(
    body.def.tempK ?? 0,
    body.def.atmosphere ?? {},
    body.atmosphere,
  );
  body.colonyCost = colonyCostOf(body);
}

/**
 * Colony cost: the worst of what is wrong with a world. 0.0 is a garden
 * world, 2.0 is the floor for anything whose air cannot be breathed, and
 * anything above about 3 is a serious infrastructure commitment.
 *
 * Every term reads the body's *current* state, so terraforming moves it.
 */
export function colonyCostOf(body: Body): number {
  if (body.cls === "star") return Infinity;
  // Gas giants have no surface to build on.
  if (body.cls === "planet" && body.def.massKg > 5e25) return Infinity;

  const breathable = isBreathable(body.atmosphere);
  let cost = breathable ? 0 : 2;

  // Gravity: 0.1 g to 1.9 g is tolerable for the base species.
  if (body.gravity < 0.1) cost = Math.max(cost, (0.1 - body.gravity) * 10);
  else if (body.gravity > 1.9) cost = Math.max(cost, (body.gravity - 1.9) * 10);

  // Temperature: comfortable between 253 K and 313 K, then one point of
  // colony cost for every 44 K beyond that band.
  if (body.tempK < TEMP_MIN) cost = Math.max(cost, (TEMP_MIN - body.tempK) / 44);
  else if (body.tempK > TEMP_MAX) cost = Math.max(cost, (body.tempK - TEMP_MAX) / 44);

  // A crushing atmosphere is its own problem, whatever it is made of.
  const pressure = totalPressure(body.atmosphere);
  if (!breathable && pressure > PRESSURE_MAX_BREATHABLE) {
    cost = Math.max(cost, pressure / 25);
  }

  // So is a poisonous one, in proportion to how far past safe it is.
  for (const toxic of toxicGases(body.atmosphere)) {
    const excess = toxic.pressure / (toxic.gas.toxicAbove ?? 1);
    cost = Math.max(cost, 2 + Math.log10(1 + excess) * 0.5);
  }

  return Math.round(cost * 100) / 100;
}

// --------------------------------------------------------------------------

/**
 * Background populations: the main belt, both Jupiter Trojan camps and the
 * classical Kuiper belt. These are scenery, not selectable bodies.
 */
function buildMotes(): Mote[] {
  const rng = mulberry32(0xa5704a);
  const motes: Mote[] = [];

  const push = (a: number, e: number, inc: number, m0: number, size: number, shade: number) => {
    motes.push({
      orbit: {
        a, e, inc,
        node: rng() * 360,
        peri: rng() * 360,
        m0,
        periodDays: Math.pow(a, 1.5) * DAYS_PER_YEAR,
      },
      world: { x: 0, y: 0, z: 0 },
      size,
      shade,
    });
  };

  // Main belt, with the Kirkwood gaps at the 3:1, 5:2 and 2:1 resonances.
  const gaps = [2.50, 2.82, 3.27];
  for (let i = 0; i < 900; i++) {
    const a = 2.06 + rng() * 1.24;
    if (gaps.some((g) => Math.abs(a - g) < 0.02 + rng() * 0.02)) continue;
    push(a, rng() * 0.18, (rng() - 0.5) * 24, rng() * 360, 0.9, 0.35 + rng() * 0.35);
  }

  // Trojans, librating about Jupiter's L4 and L5 points.
  const jupiterA = 5.2029;
  const jupiterL = 34.396; // mean longitude at J2000
  for (const lead of [60, -60]) {
    for (let i = 0; i < 140; i++) {
      const spread = (rng() - 0.5) * 40;
      push(
        jupiterA + (rng() - 0.5) * 0.3,
        rng() * 0.09,
        (rng() - 0.5) * 30,
        jupiterL + lead + spread,
        0.9,
        0.3 + rng() * 0.3,
      );
    }
  }

  // Classical Kuiper belt.
  for (let i = 0; i < 500; i++) {
    push(38 + rng() * 12, rng() * 0.12, (rng() - 0.5) * 20, rng() * 360, 0.8, 0.25 + rng() * 0.3);
  }

  return motes;
}

// ------------------------------------------------------------- presentation

export function classLabel(body: Body): string {
  switch (body.cls) {
    case "star": return "Star";
    case "planet": return body.def.massKg > 5e25 ? "Gas Giant" : "Terrestrial Planet";
    case "dwarf": return "Dwarf Planet";
    case "moon": return "Moon";
    case "asteroid": return "Asteroid";
    case "comet": return "Comet";
  }
}

export function orbitSummary(body: Body): {
  semiMajorAu: number;
  periapsisAu: number;
  apoapsisAu: number;
  periodText: string;
} | null {
  const orbit = body.def.orbit;
  if (!orbit) return null;
  const days = Math.abs(orbit.periodDays);
  return {
    semiMajorAu: orbit.a,
    periapsisAu: periapsis(orbit),
    apoapsisAu: apoapsis(orbit),
    periodText:
      days >= DAYS_PER_YEAR
        ? `${(days / DAYS_PER_YEAR).toFixed(2)} years`
        : `${days.toFixed(2)} days`,
  };
}

export function auToKm(au: number): number {
  return au * AU_KM;
}
