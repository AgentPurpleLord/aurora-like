/**
 * Deterministic pseudo-randomness.
 *
 * Every generated thing in the game - mineral deposits, officer names and
 * skills, promotion rolls - draws from a seeded stream, so a campaign replays
 * identically and a body always surveys the same way.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Random {
  private a: number;

  constructor(seed: number | string) {
    this.a = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;
  }

  /** The generator's whole state, so a saved campaign continues the same stream. */
  get state(): number {
    return this.a;
  }

  set state(value: number) {
    this.a = value >>> 0;
  }

  private next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Box-Muller, clamped to +/- 3 sigma so outliers stay plausible. */
  gaussian(mean: number, sigma: number): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + Math.max(-3, Math.min(3, z)) * sigma;
  }
}
