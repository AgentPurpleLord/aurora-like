/**
 * The galaxy: Sol, the real stars around it, and the jump network between
 * them.
 *
 * Every system exists from the first day - generated from the campaign seed -
 * but the player only knows about the ones they have been to. The network is
 * not geography: jump points join systems that need not be neighbours, so
 * exploring is the only way to learn what connects to what.
 */

import { BODIES, type BodyDef } from "../data/bodies";
import { STARS, type StarDef } from "../data/stars";
import { generateSystem, jumpPointDef } from "./generate";
import { Random } from "./rng";
import { StarSystem, SOL_META, type Body, type SystemMeta } from "./system";
import { vecLength, vecSub, type Vec3 } from "./orbit";

export interface JumpLink {
  /** Body ids of the two jump points that make up the connection. */
  a: string;
  b: string;
}

const DEG = Math.PI / 180;

/** Equatorial sky position and distance to a Cartesian position in light years. */
export function skyPosition(raHours: number, decDeg: number, distanceLy: number): Vec3 {
  const ra = raHours * 15 * DEG;
  const dec = decDeg * DEG;
  return {
    x: distanceLy * Math.cos(dec) * Math.cos(ra),
    y: distanceLy * Math.cos(dec) * Math.sin(ra),
    z: distanceLy * Math.sin(dec),
  };
}

export class Galaxy {
  readonly systems: StarSystem[] = [];
  readonly systemById = new Map<string, StarSystem>();
  /** Every body in every system. */
  readonly bodies: Body[] = [];
  readonly byId = new Map<string, Body>();
  readonly links: JumpLink[] = [];

  constructor(readonly seed: string) {
    const entries: { meta: SystemMeta; defs: BodyDef[]; star: StarDef | null }[] = [];

    entries.push({ meta: SOL_META, defs: [...BODIES], star: null });
    for (const star of STARS) {
      entries.push({
        meta: {
          id: star.id,
          name: star.name,
          position: skyPosition(star.raHours, star.decDeg, star.distanceLy),
          spectral: star.spectral,
          massSol: star.massSol,
          lumSol: star.lumSol,
          distanceLy: star.distanceLy,
          color: star.color,
          blurb: star.blurb,
        },
        defs: generateSystem(star, seed),
        star,
      });
    }

    this.wire(entries);

    for (const { meta, defs } of entries) {
      const system = new StarSystem(defs, meta);
      this.systems.push(system);
      this.systemById.set(meta.id, system);
      for (const body of system.bodies) {
        this.bodies.push(body);
        this.byId.set(body.id, body);
      }
    }
  }

  /** Decide which systems connect, and add the jump points that do it. */
  private wire(entries: { meta: SystemMeta; defs: BodyDef[]; star: StarDef | null }[]): void {
    const rng = new Random(`${this.seed}:network`);
    const dist = (a: SystemMeta, b: SystemMeta) => {
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      const dz = a.position.z - b.position.z;
      return Math.hypot(dx, dy, dz);
    };
    const edges: [number, number][] = [];
    const has = (i: number, j: number) => edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
    const degree = (i: number) => edges.filter(([a, b]) => a === i || b === i).length;

    // A tree first, so every system can be reached from Sol: each system joins
    // one of the two nearest systems already in the network.
    const order = entries.map((_, i) => i).sort((x, y) => dist(entries[0].meta, entries[x].meta) - dist(entries[0].meta, entries[y].meta));
    const joined = [order[0]];
    for (const i of order.slice(1)) {
      const nearest = [...joined].sort((x, y) => dist(entries[i].meta, entries[x].meta) - dist(entries[i].meta, entries[y].meta));
      const pick = nearest.length > 1 && rng.chance(0.3) ? nearest[1] : nearest[0];
      edges.push([i, pick]);
      joined.push(i);
    }
    // Then cross-links, so the network has loops and choices.
    for (const i of order) {
      if (!rng.chance(0.4)) continue;
      const near = order.filter((j) => j !== i && !has(i, j))
        .sort((x, y) => dist(entries[i].meta, entries[x].meta) - dist(entries[i].meta, entries[y].meta));
      if (near[0] !== undefined) edges.push([i, near[0]]);
    }
    // And a couple of long ones: jump space does not respect the map.
    for (let k = 0; k < 2; k++) {
      const i = rng.int(0, entries.length - 1);
      const j = rng.int(0, entries.length - 1);
      if (i !== j && !has(i, j)) edges.push([i, j]);
    }
    // Sol should open onto at least two systems, or the first jump is a forced one.
    while (degree(0) < 2) {
      const j = order.find((x) => x !== 0 && !has(0, x));
      if (j === undefined) break;
      edges.push([0, j]);
    }

    const counter = new Map<number, number>();
    const next = (i: number) => {
      const n = (counter.get(i) ?? 0) + 1;
      counter.set(i, n);
      return n;
    };
    for (const [i, j] of edges) {
      const a = entries[i];
      const b = entries[j];
      const aId = `${a.meta.id}-jp-${next(i)}`;
      const bId = `${b.meta.id}-jp-${next(j)}`;
      const starA = a.star ?? ({ lumSol: 1 } as StarDef);
      const starB = b.star ?? ({ lumSol: 1 } as StarDef);
      a.defs.push(jumpPointDef(rng, starA, aId, `${a.meta.name} Jump Point ${counter.get(i)}`, bId));
      b.defs.push(jumpPointDef(rng, starB, bId, `${b.meta.name} Jump Point ${counter.get(j)}`, aId));
      this.links.push({ a: aId, b: bId });
    }
  }

  get sol(): StarSystem {
    return this.systemById.get("sol")!;
  }

  private lastUpdate = new Map<string, number>();

  /**
   * Move every body to its place at `days`. Systems in `active` (the one on
   * screen, and any with colonies or fleets) move every call; the rest are
   * only brought up to date once a game day has passed, since nothing is
   * looking at them and a day's drift is invisible in an unobserved system.
   */
  update(days: number, active?: ReadonlySet<string>): void {
    for (const system of this.systems) {
      const last = this.lastUpdate.get(system.id);
      if (active && !active.has(system.id) && last !== undefined && Math.abs(days - last) < 1) continue;
      this.lastUpdate.set(system.id, days);
      system.update(days);
    }
  }

  systemOf(bodyId: string): StarSystem | undefined {
    const body = this.byId.get(bodyId);
    return body ? this.systemById.get(body.systemId) : undefined;
  }

  jumpPointsIn(systemId: string): Body[] {
    return this.systemById.get(systemId)?.bodies.filter((b) => b.cls === "jump-point") ?? [];
  }

  /** The jump point at the other end of this one. */
  otherEnd(bodyId: string): Body | undefined {
    const target = this.byId.get(bodyId)?.def.jumpTo;
    return target ? this.byId.get(target) : undefined;
  }

  /** Distance in AU between two bodies of the same system; infinite across systems. */
  distance(a: Body, b: Body): number {
    return a.systemId === b.systemId ? vecLength(vecSub(a.world, b.world)) : Infinity;
  }

  /** Straight-line distance between two systems, in light years. */
  distanceLy(aId: string, bId: string): number {
    const a = this.systemById.get(aId)?.meta.position;
    const b = this.systemById.get(bId)?.meta.position;
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
}

export function buildGalaxy(seed: string): Galaxy {
  return new Galaxy(seed);
}
