/**
 * Inventing a planetary system around a real star.
 *
 * The star is given. Any planets astronomers have actually detected keep their
 * measured orbital periods and minimum masses (the star's mass turns a period
 * into an orbit through Kepler's third law). Everything unknown - how many
 * more planets there are, where, what they are made of, whether they hold an
 * atmosphere and of what, how warm they are, what is buried in them - is
 * rolled from the campaign seed. The same seed always gives the same system;
 * a new campaign gives a different one.
 *
 * The physics is rough on purpose and tuned to look right: an equilibrium
 * temperature from luminosity and distance, atmospheres kept or lost by
 * comparing escape velocity with temperature, giants beyond the frost line.
 */

import type { BodyDef } from "../data/bodies";
import type { StarDef } from "../data/stars";
import { MINERALS } from "./minerals";
import { DAYS_PER_YEAR, AU_KM, type OrbitalElements } from "./orbit";
import { Random } from "./rng";
import { GREENHOUSE_MAX_K, GREENHOUSE_SCALE, greenhouseWarming, type Atmosphere } from "./atmosphere";

const EARTH_MASS_KG = 5.972e24;
const EARTH_RADIUS_KM = 6371;
const SOL_RADIUS_KM = 695_700;
const SOL_MASS_KG = 1.989e30;
const G = 6.674e-11;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

type PlanetKind = "rocky" | "gas" | "ice";

interface Slot {
  a: number;
  known?: StarDef["known"] extends (infer K)[] | undefined ? K : never;
}

export const roundTo = (value: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** Semi-major axis in AU from a period in days around a star of the given mass. */
export function semiMajorFromPeriod(periodDays: number, starMassSol: number): number {
  const years = periodDays / DAYS_PER_YEAR;
  return Math.cbrt(starMassSol * years * years);
}

function periodFromSemiMajor(a: number, starMassSol: number): number {
  return DAYS_PER_YEAR * Math.sqrt((a * a * a) / starMassSol);
}

function orbitAround(
  rng: Random,
  a: number,
  periodDays: number,
  e: number,
  inc: number,
): OrbitalElements {
  return {
    a: roundTo(a, 5), e: roundTo(e, 4), inc: roundTo(inc, 2),
    node: roundTo(rng.float(0, 360), 2), peri: roundTo(rng.float(0, 360), 2),
    m0: roundTo(rng.float(0, 360), 2), periodDays: roundTo(periodDays, 4),
  };
}

/** Equilibrium temperature of a world of a given albedo, in kelvin. */
export function equilibriumTemperature(lumSol: number, aAu: number, albedo: number): number {
  return 278 * Math.pow(lumSol, 0.25) / Math.sqrt(aAu) * Math.pow((1 - albedo) / 0.7, 0.25);
}

export function generateSystem(star: StarDef, seed: string): BodyDef[] {
  const rng = new Random(`${seed}:system:${star.id}`);
  const defs: BodyDef[] = [];

  defs.push({
    id: star.id,
    name: star.name,
    cls: "star",
    radiusKm: star.radiusSol * SOL_RADIUS_KM,
    massKg: star.massSol * SOL_MASS_KG,
    rotationDays: roundTo(rng.float(5, 40), 1),
    tempK: star.tempK,
    color: star.color,
    notes: `${star.spectral}. ${star.blurb} ${star.distanceLy} light years from Sol.`,
  });

  // A star's "habitable distance", and the frost line beyond which ice survives.
  const aHz = Math.sqrt(star.lumSol);
  const frost = Math.max(0.05, 3.0 * aHz);
  const aMin = Math.max(0.012, 0.12 * aHz);
  const aMax = Math.min(60, Math.max(1.2, 32 * aHz));

  // ------------------------------------------------ choose where planets go
  const slots: Slot[] = (star.known ?? []).map((known) => ({
    a: semiMajorFromPeriod(known.periodDays, star.massSol),
    known,
  }));
  const [lo, hi] = star.extra ?? [2, 5];
  const extras = rng.int(lo, hi);
  for (let i = 0, tries = 0; i < extras && tries < 80; tries++) {
    const a = Math.exp(rng.float(Math.log(aMin), Math.log(aMax)));
    if (slots.some((s) => Math.abs(Math.log(s.a / a)) < 0.3)) continue;
    slots.push({ a });
    i++;
  }
  slots.sort((x, y) => x.a - y.a);

  // The unknown inner planets of a red dwarf are small; giants prefer the
  // frost line and beyond, and are rarer around dim stars.
  const giantOdds = star.massSol < 0.5 ? 0.3 : 1;
  let generated = 0;

  for (const slot of slots) {
    let kind: PlanetKind;
    let massEarth: number;
    if (slot.known) {
      massEarth = slot.known.earthMasses;
      kind = massEarth >= 50 ? "gas" : massEarth >= 10 ? "ice" : "rocky";
    } else if (slot.a < 0.5 * frost) {
      kind = "rocky";
      massEarth = Math.min(9, Math.max(0.03, Math.pow(10, rng.gaussian(-0.05, 0.42))));
    } else if (slot.a < 1.6 * frost) {
      const r = rng.float(0, 1);
      kind = r < 0.55 * giantOdds ? "gas" : r < 0.7 ? "ice" : "rocky";
      massEarth = kind === "gas" ? Math.exp(rng.float(Math.log(40), Math.log(700)))
        : kind === "ice" ? rng.float(8, 30)
        : Math.pow(10, rng.gaussian(-0.2, 0.4));
    } else {
      const r = rng.float(0, 1);
      kind = r < 0.35 * giantOdds ? "gas" : r < 0.75 ? "ice" : "rocky";
      massEarth = kind === "gas" ? Math.exp(rng.float(Math.log(30), Math.log(400)))
        : kind === "ice" ? rng.float(8, 25)
        : Math.pow(10, rng.gaussian(-0.9, 0.5));
    }
    massEarth = Math.max(0.02, massEarth);

    const id = `${star.id}-${slot.known ? slot.known.name.split(" ").pop()!.toLowerCase() : `p${++generated}`}`;
    const name = slot.known ? slot.known.name : `${star.name} ${ROMAN[generated - 1] ?? generated}`;
    const period = slot.known?.periodDays ?? periodFromSemiMajor(slot.a, star.massSol);
    const planet = makePlanet(rng, star, id, name, slot.a, period, massEarth, kind);
    if (slot.known) {
      planet.detected = slot.known.candidate ? "candidate" : "confirmed";
      planet.notes = `${slot.known.candidate ? "Candidate" : "Detected"} planet: a minimum mass of ${slot.known.earthMasses} Earth masses and a ${slot.known.periodDays}-day year are measured. Its surface, air and mineral content are not known to anyone; this is what the survey found. ${planet.notes ?? ""}`.trim();
    }
    defs.push(planet);

    defs.push(...makeMoons(rng, star, planet, kind, massEarth));
  }

  // ------------------------------------------------------------- asteroids
  if (star.massSol > 0.25 && rng.chance(0.55)) {
    const beltA = frost * rng.float(0.55, 0.95);
    if (!slots.some((s) => Math.abs(Math.log(s.a / beltA)) < 0.25)) {
      const n = rng.int(2, 5);
      for (let i = 0; i < n; i++) {
        const a = beltA * rng.float(0.9, 1.12);
        const radius = Math.exp(rng.float(Math.log(6), Math.log(i === 0 && rng.chance(0.5) ? 480 : 160)));
        const mass = (4 / 3) * Math.PI * Math.pow(radius * 1000, 3) * rng.float(1800, 3200);
        const id = `${star.id}-belt-${i + 1}`;
        defs.push({
          id, name: `${star.name} Belt ${ROMAN[i]}`,
          cls: radius > 300 ? "dwarf" : "asteroid", parent: star.id,
          radiusKm: roundTo(radius, 1), massKg: mass,
          rotationDays: roundTo(rng.float(0.1, 2), 3),
          tempK: roundTo(equilibriumTemperature(star.lumSol, a, 0.08), 0),
          color: rng.pick(["#8e8d86", "#9a8f80", "#7f7a74", "#a39a8c"]),
          orbit: orbitAround(rng, a, periodFromSemiMajor(a, star.massSol), rng.float(0.02, 0.22), rng.float(0, 18)),
          ...mineralProfile(rng, id, true),
        });
      }
    }
  }

  return defs;
}

// ------------------------------------------------------------------ planets

function mineralProfile(rng: Random, id: string, small: boolean): Pick<BodyDef, "mineralSeed" | "richness" | "favoured"> {
  const favourCount = rng.chance(small ? 0.7 : 0.55) ? rng.int(1, 3) : 0;
  const favoured: string[] = [];
  while (favoured.length < favourCount) {
    const m = rng.pick(MINERALS);
    if (!favoured.includes(m)) favoured.push(m);
  }
  return {
    // The seed carries the campaign seed through the id's prefix, so a new
    // campaign rolls new deposits on the same world.
    mineralSeed: `${id}:${rng.int(0, 1_000_000)}`,
    richness: roundTo(Math.pow(10, rng.gaussian(0, 0.25)), 2),
    favoured,
  };
}

function makePlanet(
  rng: Random,
  star: StarDef,
  id: string,
  name: string,
  a: number,
  periodDays: number,
  massEarth: number,
  kind: PlanetKind,
): BodyDef {
  const eccentricity = Math.min(0.35, Math.abs(rng.gaussian(0.04, 0.05)));
  const orbit = orbitAround(rng, a, periodDays, eccentricity, Math.abs(rng.gaussian(0, 1.5)));
  const lockedToStar = periodDays < 40 && star.massSol < 0.7;

  if (kind !== "rocky") {
    const radiusEarth = Math.min(kind === "gas" ? 12.5 : 6, 4 * Math.pow(massEarth / 17, 0.35));
    const albedo = kind === "gas" ? rng.float(0.3, 0.55) : rng.float(0.28, 0.4);
    const teq = equilibriumTemperature(star.lumSol, a, albedo);
    const total = kind === "gas" ? rng.float(300, 1100) : rng.float(120, 500);
    const atmosphere: Atmosphere = kind === "gas"
      ? { hydrogen: roundTo(total * 0.86, 1), helium: roundTo(total * 0.12, 1), methane: roundTo(total * 0.01, 2) }
      : { hydrogen: roundTo(total * 0.8, 1), helium: roundTo(total * 0.15, 1), methane: roundTo(total * 0.04, 2), ammonia: roundTo(total * 0.01, 2) };
    const hot = teq > 900;
    return {
      id, name, cls: "planet", parent: star.id,
      radiusKm: roundTo(radiusEarth * EARTH_RADIUS_KM, 0),
      massKg: massEarth * EARTH_MASS_KG,
      rotationDays: roundTo(lockedToStar ? periodDays : rng.float(0.3, 0.7), 3),
      tempK: roundTo(teq, 0),
      atmosphere,
      color: hot ? "#e0a070" : kind === "gas" ? rng.pick(["#d9a066", "#c9b28a", "#b8a58c", "#cbb68c"]) : rng.pick(["#7fb5d6", "#6fa0d0", "#88c0c8"]),
      orbit,
      rings: kind === "gas" && rng.chance(0.18)
        ? { innerKm: radiusEarth * EARTH_RADIUS_KM * 1.5, outerKm: radiusEarth * EARTH_RADIUS_KM * rng.float(2.0, 2.6) }
        : undefined,
      notes: `${hot ? "A hot " : ""}${kind === "gas" ? "gas giant" : "ice giant"}. No surface; value lies in its moons and in Sorium harvesting.`,
      ...mineralProfile(rng, id, false),
    };
  }

  // ---- rocky
  const radiusEarth = Math.pow(massEarth, massEarth < 3 ? 0.27 : 0.3);
  const radiusKm = radiusEarth * EARTH_RADIUS_KM;
  const gravityG = massEarth / (radiusEarth * radiusEarth);
  const vesc = 11.186 * Math.sqrt(massEarth / radiusEarth);

  const baseTeq = equilibriumTemperature(star.lumSol, a, 0.3);
  const retention = vesc / (0.35 * Math.sqrt(baseTeq));
  // Flaring red dwarfs strip the air from close-in worlds.
  const stripped = star.massSol < 0.6 && a < 3 * Math.sqrt(star.lumSol) && rng.chance(0.45);
  const atmosphere = rocky_atmosphere(rng, baseTeq, retention, stripped, gravityG);

  const pressure = Object.values(atmosphere).reduce((s, v) => s + v, 0);
  const albedo = pressure > 20 ? 0.7 : pressure > 0.05 ? 0.3 + rng.float(-0.05, 0.1) : 0.12;
  const teq = equilibriumTemperature(star.lumSol, a, albedo);
  const boost = pressure > 0.1 ? 33 * Math.sqrt(Math.min(1, pressure)) : 0;
  const tempK = Math.max(30, teq + boost + greenhouseWarming(atmosphere));

  const surface = tempK > 1200 ? "A molten, scorched world" : tempK > 600 ? "A furnace" : tempK < 100 ? "A frozen, airless-looking world" : "A rocky world";
  return {
    id, name, cls: "planet", parent: star.id,
    radiusKm: roundTo(radiusKm, 0),
    massKg: massEarth * EARTH_MASS_KG,
    rotationDays: roundTo(lockedToStar ? periodDays : rng.float(0.3, 60) * (rng.chance(0.15) ? -1 : 1), 3),
    tempK: roundTo(tempK, 0),
    atmosphere,
    color: tempK > 600 ? "#c98a5a" : tempK < 180 ? "#cfd8e0" : pressure > 0.3 ? rng.pick(["#8ab0a0", "#b8a07a", "#a0a8b8"]) : rng.pick(["#a39a8c", "#b09878"]),
    orbit,
    notes: `${surface}${lockedToStar ? ", tidally locked to its star" : ""}${stripped ? "; flares have stripped its air" : ""}.`,
    ...mineralProfile(rng, id, false),
  };
}

/**
 * The air of a rocky world, from how hot it is and whether it can hold on to
 * one. Most worlds are bleak; a thin slice of temperate ones are breathable.
 */
function rocky_atmosphere(
  rng: Random,
  teq: number,
  retention: number,
  stripped: boolean,
  gravityG: number,
): Atmosphere {
  if (stripped || retention < 0.85) return {};
  const scale = Math.pow(10, rng.gaussian(0.5 * (retention - 1), 0.6));
  const pressure = Math.min(120, Math.max(0.003, scale));
  const out: Atmosphere = {};
  const set = (gas: string, share: number, total: number) => {
    const v = roundTo(total * share, share * total < 0.01 ? 5 : 3);
    if (v > 0) out[gas] = v;
  };

  if (teq > 330) {
    // Hot: a Venus-like blanket of carbon dioxide, sometimes thinner.
    const total = rng.chance(0.7) ? pressure * 3 : pressure * 0.05;
    set("carbon-dioxide", 0.93, total);
    set("nitrogen", 0.05, total);
    if (total > 5) set("sulphur-dioxide", 0.01, total);
    return out;
  }
  if (teq < 160) {
    const total = Math.min(pressure, 3);
    set("nitrogen", 0.9, total);
    set("methane", 0.08, total);
    set("argon", 0.02, total);
    return out;
  }
  if (teq < 200) {
    const total = Math.min(pressure * 0.6, 4);
    set("nitrogen", 0.7, total);
    set("carbon-dioxide", 0.25, total);
    set("methane", 0.04, total);
    return out;
  }

  // Temperate band.
  const roll = rng.float(0, 1);
  if (roll < 0.2 && retention > 1.3 && gravityG > 0.5 && gravityG < 1.6) {
    // A garden world.
    const total = rng.float(0.7, 1.6);
    const oxygen = rng.float(0.13, 0.27);
    out["oxygen"] = roundTo(oxygen, 3);
    out["nitrogen"] = roundTo(total - oxygen - 0.012, 3);
    out["argon"] = 0.012;
    out["carbon-dioxide"] = 0.0004;
    out["water-vapour"] = roundTo(rng.float(0.005, 0.03), 4);
    return out;
  }
  if (roll < 0.4) {
    // Nitrogen and carbon dioxide, with the carbon dioxide chosen so the
    // greenhouse lands somewhere between frozen and merely warm.
    const warming = rng.float(5, 70);
    const co2 = -GREENHOUSE_SCALE * Math.log(1 - warming / GREENHOUSE_MAX_K);
    const total = Math.max(co2 * 1.2, Math.min(pressure * 2, 4));
    out["carbon-dioxide"] = roundTo(co2, 3);
    out["nitrogen"] = roundTo((total - co2) * 0.95, 3);
    out["argon"] = roundTo((total - co2) * 0.05, 3);
    return out;
  }
  if (roll < 0.55) {
    // Venus-like: thick, hot and crushing.
    const total = pressure * 4;
    set("carbon-dioxide", 0.95, total); set("nitrogen", 0.04, total); set("argon", 0.01, total);
    return out;
  }
  if (roll < 0.85) {
    const total = Math.min(pressure * 0.05, 0.15);
    set("carbon-dioxide", 0.95, total); set("nitrogen", 0.03, total); set("argon", 0.02, total);
    return out;
  }
  const total = Math.min(pressure * 1.5, 4);
  set("nitrogen", 0.86, total); set("methane", 0.03, total); set("ammonia", 0.01, total); set("argon", 0.1, total);
  return out;
}

// -------------------------------------------------------------------- moons

function makeMoons(
  rng: Random,
  star: StarDef,
  planet: BodyDef,
  kind: PlanetKind,
  massEarth: number,
): BodyDef[] {
  let count = 0;
  if (kind === "gas") count = massEarth > 100 ? rng.int(1, 5) : rng.int(0, 3);
  else if (kind === "ice") count = rng.int(0, 3);
  else if (massEarth > 0.3 && rng.chance(0.22)) count = 1;
  if (!planet.orbit) return [];

  const moons: BodyDef[] = [];
  const planetRadiusM = planet.radiusKm * 1000;
  let aMeters = planetRadiusM * rng.float(4, 9);
  const parentMu = G * planet.massKg;
  const parentTeq = equilibriumTemperature(star.lumSol, planet.orbit.a, 0.3);

  for (let i = 0; i < count; i++) {
    const heavy = kind !== "rocky" && i < 2 && rng.chance(0.4);
    const mass = heavy
      ? Math.exp(rng.float(Math.log(5e21), Math.log(1.6e23)))
      : Math.exp(rng.float(Math.log(1e17), Math.log(4e21)));
    const density = parentTeq < 200 ? rng.float(1200, 2200) : rng.float(2800, 3600);
    const radiusM = Math.cbrt((3 * mass) / (4 * Math.PI * density));
    aMeters *= rng.float(1.5, 2.4);
    // Keep moons well inside the region the planet can hold them in.
    const hill = planet.orbit.a * AU_KM * 1000 * Math.cbrt(planet.massKg / (3 * star.massSol * SOL_MASS_KG));
    if (aMeters > hill * 0.4) break;

    const periodDays = (2 * Math.PI * Math.sqrt(aMeters ** 3 / parentMu)) / 86_400;
    const aAu = aMeters / 1000 / AU_KM;
    const id = `${planet.id}-m${i + 1}`;

    const bigCold = mass > 4e22 && parentTeq < 190;
    const atmosphere: Atmosphere | undefined = bigCold
      ? { nitrogen: roundTo(rng.float(0.5, 1.6), 2), methane: roundTo(rng.float(0.01, 0.08), 3) }
      : undefined;
    moons.push({
      id, name: `${planet.name} ${ROMAN[i]}`,
      cls: "moon", parent: planet.id,
      radiusKm: roundTo(radiusM / 1000, 1), massKg: mass,
      rotationDays: roundTo(periodDays, 3),
      tempK: roundTo(Math.max(30, parentTeq + (atmosphere ? 30 : 0)), 0),
      atmosphere,
      color: parentTeq < 200 ? rng.pick(["#d8dde2", "#c8c0b4", "#e0d0b0"]) : rng.pick(["#9a948a", "#a8a096", "#8c8680"]),
      orbit: orbitAround(rng, aAu, periodDays, rng.float(0, 0.06), rng.float(0, 8)),
      ...mineralProfile(rng, id, false),
    });
  }
  return moons;
}

/** A jump point: a fixed marker, not a body, but treated as one so the map and orders can use it. */
export function jumpPointDef(
  rng: Random,
  star: StarDef,
  id: string,
  name: string,
  jumpTo: string,
): BodyDef {
  // Placed well clear of the planets so a survey has to go looking.
  const scale = Math.min(40, Math.max(0.35, 14 * Math.pow(star.lumSol, 0.4)));
  const a = scale * rng.float(0.2, 1);
  return {
    id, name, cls: "jump-point", parent: star.id,
    radiusKm: 1000, massKg: 1e12,
    color: "#7fe0ff",
    orbit: {
      a: roundTo(a, 3), e: 0, inc: roundTo(rng.float(-3, 3), 2),
      node: roundTo(rng.float(0, 360), 1), peri: 0, m0: roundTo(rng.float(0, 360), 1),
      // A period of a hundred million days: motionless for any campaign.
      periodDays: 1e8,
    },
    jumpTo,
    notes: "A point in space where the fabric of the universe is thin. Ships with jump drives can cross it; a stabilised jump gate lets any ship through.",
  };
}
