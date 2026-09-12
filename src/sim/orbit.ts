/**
 * Keplerian orbital mechanics.
 *
 * Everything heliocentric is expressed in the J2000 ecliptic frame:
 *   +x towards the vernal equinox, +z towards ecliptic north.
 * Distances are in AU, angles in degrees on the data side and radians internally.
 */

export const AU_KM = 149_597_870.7;
export const DEG = Math.PI / 180;

/** Julian date of the J2000.0 epoch (2000-01-01 12:00 TT). */
export const J2000 = 2451545.0;

export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_YEAR = 365.25;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Classical orbital elements. `epochDays` is days since J2000 at which the
 * mean anomaly `m0` was measured; all angles are in degrees.
 */
export interface OrbitalElements {
  /** Semi-major axis, in AU for heliocentric orbits, in km for satellites. */
  a: number;
  /** Eccentricity (0 = circular). */
  e: number;
  /** Inclination to the reference plane. */
  inc: number;
  /** Longitude of the ascending node. */
  node: number;
  /** Argument of periapsis. */
  peri: number;
  /** Mean anomaly at epoch. */
  m0: number;
  /** Orbital period in days. Negative for retrograde motion. */
  periodDays: number;
  /** Days since J2000 at which `m0` applies. Defaults to 0. */
  epochDays?: number;
}

/**
 * Solve Kepler's equation M = E - e sin E for the eccentric anomaly.
 *
 * Newton-Raphson alone diverges near apoapsis on a high-eccentricity orbit
 * such as Halley's, where the derivative collapses, so the iteration is
 * bracketed: E is known to lie within e radians of M, and any Newton step
 * that leaves that bracket is replaced by a bisection step.
 */
export function eccentricAnomaly(meanAnomaly: number, e: number): number {
  const m = normalizeAngle(meanAnomaly);
  let lo = m - e - 1e-12;
  let hi = m + e + 1e-12;
  let eA = m + e * Math.sin(m);

  for (let i = 0; i < 60; i++) {
    const f = eA - e * Math.sin(eA) - m;
    if (f > 0) hi = eA;
    else lo = eA;

    const fp = 1 - e * Math.cos(eA);
    let next = fp > 1e-12 ? eA - f / fp : (lo + hi) / 2;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;

    const delta = next - eA;
    eA = next;
    if (Math.abs(delta) < 1e-13) break;
  }
  return eA;
}

/** Wrap an angle in radians into [-PI, PI). */
export function normalizeAngle(radians: number): number {
  const twoPi = Math.PI * 2;
  let a = radians % twoPi;
  if (a >= Math.PI) a -= twoPi;
  if (a < -Math.PI) a += twoPi;
  return a;
}

/** Mean anomaly, in radians, of an orbit at `t` (days since J2000). */
export function meanAnomalyAt(el: OrbitalElements, t: number): number {
  const dt = t - (el.epochDays ?? 0);
  return el.m0 * DEG + (2 * Math.PI * dt) / el.periodDays;
}

/**
 * Position relative to the parent body at time `t` (days since J2000).
 * Units match `el.a`.
 */
export function positionAt(el: OrbitalElements, t: number): Vec3 {
  return positionAtEccentricAnomaly(el, eccentricAnomaly(meanAnomalyAt(el, t), el.e));
}

/** Position for a given eccentric anomaly - the path-tracing entry point. */
export function positionAtEccentricAnomaly(el: OrbitalElements, eA: number): Vec3 {
  // Position in the orbital plane, periapsis along +x.
  const xp = el.a * (Math.cos(eA) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(eA);

  const w = el.peri * DEG;
  const o = el.node * DEG;
  const i = el.inc * DEG;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const co = Math.cos(o);
  const so = Math.sin(o);
  const ci = Math.cos(i);
  const si = Math.sin(i);

  return {
    x: (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
    y: (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
    z: sw * si * xp + cw * si * yp,
  };
}

/** Periapsis distance, in the units of `el.a`. */
export function periapsis(el: OrbitalElements): number {
  return el.a * (1 - el.e);
}

/** Apoapsis distance, in the units of `el.a`. */
export function apoapsis(el: OrbitalElements): number {
  return el.a * (1 + el.e);
}

/**
 * Orbital period in days for a body orbiting a primary of `massKg`
 * at semi-major axis `aKm`.
 */
export function periodFromMass(aKm: number, massKg: number): number {
  const G = 6.674e-20; // km^3 kg^-1 s^-2
  return (2 * Math.PI * Math.sqrt(aKm ** 3 / (G * massKg))) / SECONDS_PER_DAY;
}

export function vecLength(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vecScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
