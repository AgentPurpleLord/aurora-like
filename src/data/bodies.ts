/**
 * The Sol system.
 *
 * Planetary elements are the J2000 mean elements published by JPL
 * (Standish, "Keplerian Elements for Approximate Positions of the Major
 * Planets"), converted from (L, longitude of perihelion) to
 * (mean anomaly, argument of perihelion). Satellite elements are mean
 * elements referred to their primary's equator, expressed here in the
 * ecliptic frame by folding in the primary's axial tilt - close enough that
 * the Uranian system still draws side-on and Triton still runs retrograde.
 *
 * Physical data (radius, mass, rotation, mean surface temperature,
 * atmosphere) are observed values; the rest of the game derives gravity,
 * colony cost and mineral content from them.
 */

import { AU_KM, type OrbitalElements } from "../sim/orbit";
import type { Atmosphere } from "../sim/atmosphere";

export type BodyClass = "star" | "planet" | "dwarf" | "moon" | "asteroid" | "comet" | "jump-point";

export interface BodyDef {
  id: string;
  name: string;
  cls: BodyClass;
  /** Parent body id. Undefined for the star at the root. */
  parent?: string;
  radiusKm: number;
  massKg: number;
  /** Sidereal rotation period in days; negative is retrograde. */
  rotationDays?: number;
  /** Mean surface (or 1-bar level) temperature in kelvin. */
  tempK?: number;
  /**
   * Partial pressures by gas, in Earth atmospheres. Everything else about
   * the air - total pressure, composition, whether it can be breathed - is
   * derived from this, so terraforming has one thing to change.
   */
  atmosphere?: Atmosphere;
  /** Rendering tint. */
  color: string;
  /** Orbit about the parent, semi-major axis in AU. */
  orbit?: OrbitalElements;
  /** True for bodies carrying a visible ring system. */
  rings?: { innerKm: number; outerKm: number };
  notes?: string;
  /**
   * Generated worlds: what the mineral roll is seeded with (so a new campaign
   * differs), how rich the body is overall, and the minerals it is rich in.
   */
  mineralSeed?: string;
  richness?: number;
  favoured?: string[];
  /** Jump points only: the body id of the other end of the connection. */
  jumpTo?: string;
  /** A planet that has really been detected, not invented. */
  detected?: "confirmed" | "candidate";
}

/** Satellite distances are quoted in km; orbits are stored in AU throughout. */
const km = (v: number) => v / AU_KM;

/**
 * Satellite orbit helper. `inc`/`node` describe the primary's equatorial
 * plane in ecliptic coordinates, so a tilt of 97 degrees (Uranus) gives the
 * near-polar moon orbits actually observed.
 */
function moonOrbit(
  aKm: number,
  periodDays: number,
  e: number,
  inc: number,
  node: number,
  peri: number,
  m0: number,
): OrbitalElements {
  return { a: km(aKm), e, inc, node, peri, m0, periodDays };
}

export const BODIES: BodyDef[] = [
  {
    id: "sol",
    name: "Sol",
    cls: "star",
    radiusKm: 695_700,
    massKg: 1.989e30,
    rotationDays: 25.38,
    tempK: 5772,
    color: "#ffd257",
    notes: "G2V main sequence. Luminosity 1.0 Sol, age 4.6 billion years.",
  },

  // ---------------------------------------------------------------- planets
  {
    id: "mercury",
    name: "Mercury",
    cls: "planet",
    parent: "sol",
    radiusKm: 2439.7,
    massKg: 3.3011e23,
    rotationDays: 58.646,
    tempK: 440,
    color: "#9c8b7d",
    orbit: {
      a: 0.38709927, e: 0.20563593, inc: 7.00497902,
      node: 48.33077, peri: 29.12703, m0: 174.79252, periodDays: 87.9691,
    },
    notes: "Airless, tidally locked into a 3:2 spin-orbit resonance. Enormous day/night temperature swing.",
  },
  {
    id: "venus",
    name: "Venus",
    cls: "planet",
    parent: "sol",
    radiusKm: 6051.8,
    massKg: 4.8675e24,
    rotationDays: -243.025,
    tempK: 737,
    atmosphere: { "carbon-dioxide": 88.8, nitrogen: 3.2 },
    color: "#e8c88a",
    orbit: {
      a: 0.72333566, e: 0.00677672, inc: 3.39467605,
      node: 76.67984, peri: 54.92263, m0: 50.37663, periodDays: 224.7008,
    },
    notes: "Runaway greenhouse. Surface pressure and temperature exceed any practical colony without full terraforming.",
  },
  {
    id: "earth",
    name: "Earth",
    cls: "planet",
    parent: "sol",
    radiusKm: 6371.0,
    massKg: 5.97237e24,
    rotationDays: 0.99727,
    tempK: 288,
    atmosphere: { nitrogen: 0.781, oxygen: 0.209, argon: 0.0093, "water-vapour": 0.004, "carbon-dioxide": 0.0004 },
    color: "#4a8fd4",
    orbit: {
      a: 1.00000261, e: 0.01671123, inc: 0.00001531,
      node: 0.0, peri: 102.93768, m0: -2.47311, periodDays: 365.2564,
    },
    notes: "Homeworld. Seat of government and the only body in Sol with a naturally breathable atmosphere.",
  },
  {
    id: "mars",
    name: "Mars",
    cls: "planet",
    parent: "sol",
    radiusKm: 3389.5,
    massKg: 6.4171e23,
    rotationDays: 1.02595,
    tempK: 210,
    atmosphere: { "carbon-dioxide": 0.00566, nitrogen: 0.00016, argon: 0.00012 },
    color: "#c1553a",
    orbit: {
      a: 1.52371034, e: 0.09339410, inc: 1.84969142,
      node: 49.55954, peri: -73.50317, m0: 19.39020, periodDays: 686.9800,
    },
    notes: "Prime terraforming candidate. Low gravity and a trace atmosphere, but abundant surface water ice.",
  },
  {
    id: "jupiter",
    name: "Jupiter",
    cls: "planet",
    parent: "sol",
    radiusKm: 69_911,
    massKg: 1.8982e27,
    rotationDays: 0.41354,
    tempK: 165,
    atmosphere: { hydrogen: 890, helium: 100, methane: 10 },
    color: "#d9a066",
    rings: { innerKm: 122_500, outerKm: 129_000 },
    orbit: {
      a: 5.20288700, e: 0.04838624, inc: 1.30439695,
      node: 100.47391, peri: -85.74543, m0: 19.66796, periodDays: 4332.589,
    },
    notes: "Gas giant. No surface; value lies in its moon system and in Sorium harvesting from the upper atmosphere.",
  },
  {
    id: "saturn",
    name: "Saturn",
    cls: "planet",
    parent: "sol",
    radiusKm: 58_232,
    massKg: 5.6834e26,
    rotationDays: 0.44401,
    tempK: 134,
    atmosphere: { hydrogen: 960, helium: 30, methane: 10 },
    color: "#e3cd9b",
    rings: { innerKm: 74_500, outerKm: 140_220 },
    orbit: {
      a: 9.53667594, e: 0.05386179, inc: 2.48599187,
      node: 113.66242, peri: -21.06354, m0: -42.64463, periodDays: 10_759.22,
    },
    notes: "Gas giant with the richest ring system in Sol and the only moon with a thick atmosphere.",
  },
  {
    id: "uranus",
    name: "Uranus",
    cls: "planet",
    parent: "sol",
    radiusKm: 25_362,
    massKg: 8.6810e25,
    rotationDays: -0.71833,
    tempK: 76,
    atmosphere: { hydrogen: 830, helium: 150, methane: 20 },
    color: "#a8dce3",
    rings: { innerKm: 41_800, outerKm: 51_150 },
    orbit: {
      a: 19.18916464, e: 0.04725744, inc: 0.77263783,
      node: 74.01693, peri: 96.93735, m0: 142.28383, periodDays: 30_685.4,
    },
    notes: "Ice giant rolled onto its side; its entire satellite system orbits nearly perpendicular to the ecliptic.",
  },
  {
    id: "neptune",
    name: "Neptune",
    cls: "planet",
    parent: "sol",
    radiusKm: 24_622,
    massKg: 1.02413e26,
    rotationDays: 0.67125,
    tempK: 72,
    atmosphere: { hydrogen: 800, helium: 190, methane: 10 },
    color: "#5878d8",
    orbit: {
      a: 30.06992276, e: 0.00859048, inc: 1.77004347,
      node: 131.78423, peri: -86.81947, m0: -100.08479, periodDays: 60_189.0,
    },
    notes: "Outermost gas giant. Deep gravity well, long transit times, rich in volatiles.",
  },

  // -------------------------------------------------------------- the moons
  {
    id: "luna", name: "Luna", cls: "moon", parent: "earth",
    radiusKm: 1737.4, massKg: 7.342e22, rotationDays: 27.321582, tempK: 250,
    color: "#c9c6be",
    orbit: moonOrbit(384_400, 27.321582, 0.0549, 5.145, 125.08, 318.15, 135.27),
    notes: "First body colonised outside Earth. Low gravity, no atmosphere, extensive polar ice.",
  },
  {
    id: "phobos", name: "Phobos", cls: "moon", parent: "mars",
    radiusKm: 11.27, massKg: 1.0659e16, rotationDays: 0.31891, tempK: 233,
    color: "#8d7f74",
    orbit: moonOrbit(9376, 0.318910, 0.0151, 26.0, 82.0, 150.2, 91.0),
    notes: "Captured asteroid, barely 6000 km above the Martian surface. Negligible gravity.",
  },
  {
    id: "deimos", name: "Deimos", cls: "moon", parent: "mars",
    radiusKm: 6.2, massKg: 1.4762e15, rotationDays: 1.26244, tempK: 233,
    color: "#8d7f74",
    orbit: moonOrbit(23_463, 1.263, 0.00033, 26.5, 82.0, 260.7, 325.3),
  },
  {
    id: "io", name: "Io", cls: "moon", parent: "jupiter",
    radiusKm: 1821.6, massKg: 8.931938e22, rotationDays: 1.769138, tempK: 110,
    color: "#e8d16a",
    orbit: moonOrbit(421_700, 1.769138, 0.0041, 2.2, 337.0, 84.1, 342.0),
    notes: "The most volcanically active body in Sol. Lethal radiation environment inside Jupiter's magnetosphere.",
  },
  {
    id: "europa", name: "Europa", cls: "moon", parent: "jupiter",
    radiusKm: 1560.8, massKg: 4.799844e22, rotationDays: 3.551181, tempK: 102,
    color: "#cbb994",
    orbit: moonOrbit(671_034, 3.551181, 0.0094, 2.2, 337.0, 88.9, 171.0),
    notes: "Ice shell over a global liquid water ocean.",
  },
  {
    id: "ganymede", name: "Ganymede", cls: "moon", parent: "jupiter",
    radiusKm: 2634.1, massKg: 1.4819e23, rotationDays: 7.154553, tempK: 110,
    color: "#9c917f",
    orbit: moonOrbit(1_070_412, 7.154553, 0.0013, 2.2, 337.0, 192.4, 317.5),
    notes: "Largest moon in Sol - larger than Mercury - and the only one with an intrinsic magnetic field.",
  },
  {
    id: "callisto", name: "Callisto", cls: "moon", parent: "jupiter",
    radiusKm: 2410.3, massKg: 1.075938e23, rotationDays: 16.689018, tempK: 134,
    color: "#6f6459",
    orbit: moonOrbit(1_882_709, 16.689018, 0.0074, 2.0, 337.0, 52.6, 181.4),
    notes: "Outside the worst of Jupiter's radiation belts - the practical site for a Jovian base.",
  },
  {
    id: "amalthea", name: "Amalthea", cls: "moon", parent: "jupiter",
    radiusKm: 83.5, massKg: 2.08e18, rotationDays: 0.498179, tempK: 165,
    color: "#a05a45",
    orbit: moonOrbit(181_366, 0.498179, 0.0032, 2.6, 337.0, 155.9, 12.0),
  },
  {
    id: "himalia", name: "Himalia", cls: "moon", parent: "jupiter",
    radiusKm: 69.8, massKg: 6.7e18, rotationDays: 0.3194, tempK: 124,
    color: "#7b7168",
    orbit: moonOrbit(11_451_971, 250.56, 0.1513, 29.6, 337.0, 331.6, 65.0),
  },
  {
    id: "mimas", name: "Mimas", cls: "moon", parent: "saturn",
    radiusKm: 198.2, massKg: 3.7493e19, rotationDays: 0.942422, tempK: 64,
    color: "#b9b4ac",
    orbit: moonOrbit(185_539, 0.942422, 0.0196, 28.3, 169.5, 160.4, 255.3),
  },
  {
    id: "enceladus", name: "Enceladus", cls: "moon", parent: "saturn",
    radiusKm: 252.1, massKg: 1.08022e20, rotationDays: 1.370218, tempK: 75,
    color: "#e6f1f5",
    orbit: moonOrbit(237_948, 1.370218, 0.0047, 28.1, 169.5, 119.5, 197.0),
    notes: "Cryovolcanic plumes vent water vapour from a subsurface ocean.",
  },
  {
    id: "tethys", name: "Tethys", cls: "moon", parent: "saturn",
    radiusKm: 531.1, massKg: 6.17449e20, rotationDays: 1.887802, tempK: 86,
    color: "#d2cfc6",
    orbit: moonOrbit(294_619, 1.887802, 0.0001, 29.1, 169.5, 335.3, 25.0),
  },
  {
    id: "dione", name: "Dione", cls: "moon", parent: "saturn",
    radiusKm: 561.4, massKg: 1.095452e21, rotationDays: 2.736915, tempK: 87,
    color: "#c8c4bb",
    orbit: moonOrbit(377_396, 2.736915, 0.0022, 28.1, 169.5, 116.0, 300.0),
  },
  {
    id: "rhea", name: "Rhea", cls: "moon", parent: "saturn",
    radiusKm: 763.8, massKg: 2.306518e21, rotationDays: 4.518212, tempK: 76,
    color: "#bdb9b0",
    orbit: moonOrbit(527_108, 4.518212, 0.0013, 28.4, 169.5, 44.3, 100.0),
  },
  {
    id: "titan", name: "Titan", cls: "moon", parent: "saturn",
    radiusKm: 2574.7, massKg: 1.3452e23, rotationDays: 15.945, tempK: 94,
    atmosphere: { nitrogen: 1.4, methane: 0.05 },
    color: "#d99b4a",
    orbit: moonOrbit(1_221_870, 15.945, 0.0288, 27.7, 169.5, 78.3, 120.0),
    notes: "The only moon with a substantial atmosphere. Lakes of liquid methane; a natural Sorium source.",
  },
  {
    id: "hyperion", name: "Hyperion", cls: "moon", parent: "saturn",
    radiusKm: 135, massKg: 5.6199e18, rotationDays: 0.55, tempK: 93,
    color: "#a58f74",
    orbit: moonOrbit(1_481_009, 21.276, 0.1230, 27.7, 169.5, 145.0, 80.0),
    notes: "Chaotic rotation - no stable day length.",
  },
  {
    id: "iapetus", name: "Iapetus", cls: "moon", parent: "saturn",
    radiusKm: 734.5, massKg: 1.805635e21, rotationDays: 79.3215, tempK: 110,
    color: "#8f8577",
    orbit: moonOrbit(3_560_820, 79.3215, 0.0283, 17.3, 139.0, 271.6, 200.0),
    notes: "Two-tone surface; one hemisphere is among the darkest in Sol.",
  },
  {
    id: "phoebe", name: "Phoebe", cls: "moon", parent: "saturn",
    radiusKm: 106.5, massKg: 8.292e18, rotationDays: 0.3866, tempK: 75,
    color: "#5c5751",
    orbit: moonOrbit(12_947_780, -550.31, 0.1562, 175.3, 169.5, 342.0, 15.0),
    notes: "Retrograde captured Centaur.",
  },
  {
    id: "miranda", name: "Miranda", cls: "moon", parent: "uranus",
    radiusKm: 235.8, massKg: 6.59e19, rotationDays: 1.413479, tempK: 60,
    color: "#b7bfc2",
    orbit: moonOrbit(129_390, 1.413479, 0.0013, 97.8, 167.7, 155.6, 30.0),
  },
  {
    id: "ariel", name: "Ariel", cls: "moon", parent: "uranus",
    radiusKm: 578.9, massKg: 1.353e21, rotationDays: 2.520379, tempK: 60,
    color: "#c3cace",
    orbit: moonOrbit(190_900, 2.520379, 0.0012, 97.8, 167.7, 83.3, 110.0),
  },
  {
    id: "umbriel", name: "Umbriel", cls: "moon", parent: "uranus",
    radiusKm: 584.7, massKg: 1.172e21, rotationDays: 4.144177, tempK: 75,
    color: "#8b9095",
    orbit: moonOrbit(266_000, 4.144177, 0.0039, 97.8, 167.7, 157.5, 210.0),
  },
  {
    id: "titania", name: "Titania", cls: "moon", parent: "uranus",
    radiusKm: 788.4, massKg: 3.527e21, rotationDays: 8.705872, tempK: 70,
    color: "#b0aca6",
    orbit: moonOrbit(436_300, 8.705872, 0.0011, 97.8, 167.7, 202.0, 300.0),
  },
  {
    id: "oberon", name: "Oberon", cls: "moon", parent: "uranus",
    radiusKm: 761.4, massKg: 3.014e21, rotationDays: 13.463239, tempK: 70,
    color: "#9a938b",
    orbit: moonOrbit(583_519, 13.463239, 0.0014, 97.8, 167.7, 182.4, 45.0),
  },
  {
    id: "proteus", name: "Proteus", cls: "moon", parent: "neptune",
    radiusKm: 210, massKg: 4.4e19, rotationDays: 1.12231, tempK: 51,
    color: "#787471",
    orbit: moonOrbit(117_647, 1.12231, 0.00053, 28.8, 3.5, 100.0, 60.0),
  },
  {
    id: "triton", name: "Triton", cls: "moon", parent: "neptune",
    radiusKm: 1353.4, massKg: 2.1390e22, rotationDays: -5.876854, tempK: 38,
    atmosphere: { nitrogen: 0.000014 },
    color: "#d7c9c0",
    orbit: moonOrbit(354_759, -5.876854, 0.000016, 157.3, 3.5, 66.1, 150.0),
    notes: "Captured Kuiper belt object on a retrograde orbit. Nitrogen geysers; the coldest measured surface in Sol.",
  },
  {
    id: "nereid", name: "Nereid", cls: "moon", parent: "neptune",
    radiusKm: 170, massKg: 3.1e19, rotationDays: 0.48, tempK: 50,
    color: "#8d8a86",
    orbit: moonOrbit(5_513_818, 360.1362, 0.7507, 32.6, 3.5, 296.3, 250.0),
    notes: "One of the most eccentric satellite orbits known.",
  },

  // ------------------------------------------------- dwarf planets and belt
  {
    id: "ceres", name: "Ceres", cls: "dwarf", parent: "sol",
    radiusKm: 469.7, massKg: 9.3835e20, rotationDays: 0.3781, tempK: 168,
    color: "#9d9488",
    orbit: {
      a: 2.7658, e: 0.0785, inc: 10.5878,
      node: 80.3293, peri: 73.5977, m0: 95.9892, periodDays: 1681.63,
    },
    notes: "Largest body in the asteroid belt and a natural staging post for belt mining.",
  },
  {
    id: "pallas", name: "Pallas", cls: "asteroid", parent: "sol",
    radiusKm: 256, massKg: 2.04e20, rotationDays: 0.3256, tempK: 164,
    color: "#8e8d86",
    orbit: {
      a: 2.7720, e: 0.2299, inc: 34.836,
      node: 173.080, peri: 310.048, m0: 59.69, periodDays: 1686.3,
    },
  },
  {
    id: "juno", name: "Juno", cls: "asteroid", parent: "sol",
    radiusKm: 123, massKg: 2.67e19, rotationDays: 0.3004, tempK: 163,
    color: "#8e8d86",
    orbit: {
      a: 2.6690, e: 0.2563, inc: 12.991,
      node: 169.852, peri: 248.138, m0: 32.90, periodDays: 1593.5,
    },
  },
  {
    id: "vesta", name: "Vesta", cls: "asteroid", parent: "sol",
    radiusKm: 262.7, massKg: 2.589e20, rotationDays: 0.2226, tempK: 170,
    color: "#a39b8d",
    orbit: {
      a: 2.3617, e: 0.0889, inc: 7.1417,
      node: 103.851, peri: 151.199, m0: 169.35, periodDays: 1325.46,
    },
    notes: "Differentiated protoplanet; unusually high surface albedo and a metallic core.",
  },
  {
    id: "hygiea", name: "Hygiea", cls: "asteroid", parent: "sol",
    radiusKm: 216.5, massKg: 8.32e19, rotationDays: 0.5760, tempK: 152,
    color: "#79776f",
    orbit: {
      a: 3.1415, e: 0.1125, inc: 3.831,
      node: 283.202, peri: 312.324, m0: 152.18, periodDays: 2031.3,
    },
  },
  {
    id: "psyche", name: "Psyche", cls: "asteroid", parent: "sol",
    radiusKm: 111, massKg: 2.29e19, rotationDays: 0.1755, tempK: 160,
    color: "#b08a5a",
    orbit: {
      a: 2.9230, e: 0.1339, inc: 3.095,
      node: 150.190, peri: 229.132, m0: 147.10, periodDays: 1825.7,
    },
    notes: "M-type body, believed to be an exposed planetary core. Exceptional Duranium and Neutronium potential.",
  },
  {
    id: "eros", name: "Eros", cls: "asteroid", parent: "sol",
    radiusKm: 8.42, massKg: 6.687e15, rotationDays: 0.2196, tempK: 227,
    color: "#9c8464",
    orbit: {
      a: 1.4581, e: 0.2226, inc: 10.828,
      node: 304.301, peri: 178.870, m0: 320.20, periodDays: 643.22,
    },
    notes: "Near-Earth asteroid. Cheap to reach, trivial delta-v to depart.",
  },
  {
    id: "bennu", name: "Bennu", cls: "asteroid", parent: "sol",
    radiusKm: 0.245, massKg: 7.33e10, rotationDays: 0.1758, tempK: 262,
    color: "#6e6660",
    orbit: {
      a: 1.1264, e: 0.2037, inc: 6.035,
      node: 2.061, peri: 66.223, m0: 101.70, periodDays: 436.65,
    },
  },
  {
    id: "ryugu", name: "Ryugu", cls: "asteroid", parent: "sol",
    radiusKm: 0.448, massKg: 4.5e11, rotationDays: 0.3178, tempK: 255,
    color: "#6e6660",
    orbit: {
      a: 1.1896, e: 0.1902, inc: 5.884,
      node: 251.617, peri: 211.435, m0: 180.00, periodDays: 473.9,
    },
  },

  // --------------------------------------------------- trans-Neptunian belt
  {
    id: "pluto", name: "Pluto", cls: "dwarf", parent: "sol",
    radiusKm: 1188.3, massKg: 1.303e22, rotationDays: -6.387230, tempK: 44,
    atmosphere: { nitrogen: 0.00001, methane: 0.0000005 },
    color: "#c4a98f",
    orbit: {
      a: 39.48211675, e: 0.24882730, inc: 17.14001206,
      node: 110.30394, peri: 113.76498, m0: 14.86012, periodDays: 90_560.0,
    },
    notes: "In 3:2 resonance with Neptune; perihelion brings it inside Neptune's orbit.",
  },
  {
    id: "charon", name: "Charon", cls: "moon", parent: "pluto",
    radiusKm: 606, massKg: 1.586e21, rotationDays: 6.387230, tempK: 53,
    color: "#a49a92",
    orbit: moonOrbit(19_591, 6.387230, 0.0002, 112.8, 223.0, 0.0, 60.0),
    notes: "Mutually tidally locked with Pluto - the pair orbit a barycentre outside Pluto's surface.",
  },
  {
    id: "nix", name: "Nix", cls: "moon", parent: "pluto",
    radiusKm: 22.5, massKg: 4.5e16, rotationDays: 1.829, tempK: 50,
    color: "#9e9a95",
    orbit: moonOrbit(48_694, 24.8548, 0.0020, 112.8, 223.0, 30.0, 200.0),
  },
  {
    id: "hydra", name: "Hydra", cls: "moon", parent: "pluto",
    radiusKm: 30.5, massKg: 4.8e16, rotationDays: 0.4295, tempK: 50,
    color: "#9e9a95",
    orbit: moonOrbit(64_738, 38.2020, 0.0060, 112.8, 223.0, 60.0, 320.0),
  },
  {
    id: "haumea", name: "Haumea", cls: "dwarf", parent: "sol",
    radiusKm: 816, massKg: 4.006e21, rotationDays: 0.163, tempK: 32,
    color: "#ded7cf",
    orbit: {
      a: 43.130, e: 0.1912, inc: 28.214,
      node: 122.163, peri: 239.184, m0: 218.20, periodDays: 103_468.0,
    },
    notes: "Spins once every four hours, deformed into a triaxial ellipsoid.",
  },
  {
    id: "makemake", name: "Makemake", cls: "dwarf", parent: "sol",
    radiusKm: 715, massKg: 3.1e21, rotationDays: 0.9511, tempK: 32,
    color: "#c98f72",
    orbit: {
      a: 45.430, e: 0.1585, inc: 28.983,
      node: 79.382, peri: 294.834, m0: 160.80, periodDays: 111_845.0,
    },
  },
  {
    id: "eris", name: "Eris", cls: "dwarf", parent: "sol",
    radiusKm: 1163, massKg: 1.638e22, rotationDays: 15.786, tempK: 30,
    color: "#d9d9d2",
    orbit: {
      a: 67.781, e: 0.44068, inc: 44.040,
      node: 35.951, peri: 151.639, m0: 205.99, periodDays: 203_830.0,
    },
    notes: "Most massive known dwarf planet. Currently near aphelion, 96 AU from Sol.",
  },

  // ------------------------------------------------------------- the comets
  {
    id: "halley", name: "1P/Halley", cls: "comet", parent: "sol",
    radiusKm: 5.5, massKg: 2.2e14, rotationDays: 2.2, tempK: 130,
    color: "#8ad7e0",
    orbit: {
      a: 17.834, e: 0.96714, inc: 162.26,
      node: 58.42, peri: 111.33, m0: 66.40, periodDays: 27_510.0,
    },
    notes: "Retrograde short-period comet. Next perihelion passage in 2061.",
  },
  {
    id: "encke", name: "2P/Encke", cls: "comet", parent: "sol",
    radiusKm: 2.4, massKg: 1.0e13, rotationDays: 0.4604, tempK: 180,
    color: "#8ad7e0",
    orbit: {
      a: 2.2152, e: 0.84833, inc: 11.781,
      node: 334.568, peri: 186.542, m0: 285.00, periodDays: 1204.0,
    },
    notes: "Shortest known cometary period - a practical volatile source inside the belt.",
  },
];

export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));
