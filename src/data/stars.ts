/**
 * The neighbourhood: real stars near the Sun, with their measured properties.
 *
 * Mass, luminosity, radius, temperature, distance and sky position are real
 * (rounded catalogue values). Where planets have been detected, their orbital
 * periods and minimum masses are real too, and the star's mass fixes the orbit
 * through Kepler's third law. Everything else about those worlds - what they
 * are made of, what air they hold, how warm they are, what lies under the
 * ground - is rolled when a campaign begins, because nobody knows. Systems
 * with no known planets are filled in the same way from the star alone.
 *
 * Multiple-star systems are modelled around their primary; companions are
 * left out rather than half-simulated.
 */

export interface KnownPlanet {
  name: string;
  periodDays: number;
  /** Minimum mass, in Earth masses. */
  earthMasses: number;
  /** Detections that are not yet confirmed. */
  candidate?: boolean;
}

export interface StarDef {
  id: string;
  name: string;
  spectral: string;
  massSol: number;
  lumSol: number;
  radiusSol: number;
  tempK: number;
  distanceLy: number;
  /** Right ascension in hours, declination in degrees. */
  raHours: number;
  decDeg: number;
  color: string;
  blurb: string;
  known?: KnownPlanet[];
  /** Planets to invent beyond the known ones, as [min, max]. */
  extra?: [number, number];
}

export const STARS: StarDef[] = [
  {
    id: "alpha-centauri", name: "Alpha Centauri", spectral: "G2V", massSol: 1.1, lumSol: 1.52,
    radiusSol: 1.22, tempK: 5790, distanceLy: 4.37, raHours: 14.66, decDeg: -60.83, color: "#ffe9a8",
    blurb: "The nearest sunlike star. Its orange companion, Alpha Centauri B, is not modelled.",
    extra: [4, 7],
  },
  {
    id: "proxima-centauri", name: "Proxima Centauri", spectral: "M5.5V", massSol: 0.122, lumSol: 0.0017,
    radiusSol: 0.154, tempK: 3042, distanceLy: 4.24, raHours: 14.5, decDeg: -62.68, color: "#ff8a5c",
    blurb: "The closest star of all: a flaring red dwarf with at least two small planets.",
    known: [
      { name: "Proxima b", periodDays: 11.19, earthMasses: 1.07 },
      { name: "Proxima d", periodDays: 5.12, earthMasses: 0.26, candidate: true },
      { name: "Proxima c", periodDays: 1928, earthMasses: 7, candidate: true },
    ],
    extra: [0, 1],
  },
  {
    id: "barnards-star", name: "Barnard's Star", spectral: "M4V", massSol: 0.162, lumSol: 0.0035,
    radiusSol: 0.187, tempK: 3134, distanceLy: 5.96, raHours: 17.96, decDeg: 4.69, color: "#ff9a66",
    blurb: "An old red dwarf with four tiny, scorched planets.",
    known: [
      { name: "Barnard's Star d", periodDays: 2.34, earthMasses: 0.26 },
      { name: "Barnard's Star b", periodDays: 3.15, earthMasses: 0.37 },
      { name: "Barnard's Star c", periodDays: 4.12, earthMasses: 0.34, candidate: true },
      { name: "Barnard's Star e", periodDays: 6.74, earthMasses: 0.19, candidate: true },
    ],
    extra: [0, 2],
  },
  {
    id: "wolf-359", name: "Wolf 359", spectral: "M6V", massSol: 0.11, lumSol: 0.001,
    radiusSol: 0.144, tempK: 2749, distanceLy: 7.86, raHours: 10.94, decDeg: 7.01, color: "#ff7a4d",
    blurb: "A faint, flaring red dwarf.",
    known: [{ name: "Wolf 359 b", periodDays: 2.69, earthMasses: 1.9, candidate: true }],
    extra: [1, 3],
  },
  {
    id: "lalande-21185", name: "Lalande 21185", spectral: "M2V", massSol: 0.39, lumSol: 0.02,
    radiusSol: 0.393, tempK: 3601, distanceLy: 8.31, raHours: 11.05, decDeg: 35.97, color: "#ffb27a",
    blurb: "A red dwarf in Ursa Major, bright enough to see in binoculars.",
    known: [{ name: "Lalande 21185 b", periodDays: 12.95, earthMasses: 2.69 }],
    extra: [2, 4],
  },
  {
    id: "sirius", name: "Sirius", spectral: "A1V", massSol: 2.06, lumSol: 25.4,
    radiusSol: 1.71, tempK: 9940, distanceLy: 8.6, raHours: 6.75, decDeg: -16.72, color: "#cfe0ff",
    blurb: "The brightest star in the sky. Its white-dwarf companion is not modelled.",
    extra: [3, 6],
  },
  {
    id: "epsilon-eridani", name: "Epsilon Eridani", spectral: "K2V", massSol: 0.82, lumSol: 0.34,
    radiusSol: 0.74, tempK: 5084, distanceLy: 10.47, raHours: 3.55, decDeg: -9.46, color: "#ffc98a",
    blurb: "A young orange dwarf ringed by dust, with a Jovian planet and the debris of a belt.",
    known: [{ name: "Epsilon Eridani b", periodDays: 2690, earthMasses: 207 }],
    extra: [3, 5],
  },
  {
    id: "ross-128", name: "Ross 128", spectral: "M4V", massSol: 0.168, lumSol: 0.00362,
    radiusSol: 0.197, tempK: 3192, distanceLy: 11.0, raHours: 11.79, decDeg: 0.8, color: "#ff9a66",
    blurb: "A quiet red dwarf, calmer than most of its kind.",
    known: [{ name: "Ross 128 b", periodDays: 9.866, earthMasses: 1.4 }],
    extra: [1, 3],
  },
  {
    id: "tau-ceti", name: "Tau Ceti", spectral: "G8V", massSol: 0.78, lumSol: 0.52,
    radiusSol: 0.79, tempK: 5344, distanceLy: 11.9, raHours: 1.73, decDeg: -15.94, color: "#ffdc9a",
    blurb: "A sunlike star with a thick debris disc and several candidate super-Earths.",
    known: [
      { name: "Tau Ceti g", periodDays: 20.0, earthMasses: 1.75, candidate: true },
      { name: "Tau Ceti h", periodDays: 49.4, earthMasses: 1.83, candidate: true },
      { name: "Tau Ceti e", periodDays: 162.9, earthMasses: 3.93, candidate: true },
      { name: "Tau Ceti f", periodDays: 636, earthMasses: 3.93, candidate: true },
    ],
    extra: [1, 3],
  },
  {
    id: "procyon", name: "Procyon", spectral: "F5IV", massSol: 1.5, lumSol: 6.9,
    radiusSol: 2.05, tempK: 6530, distanceLy: 11.46, raHours: 7.65, decDeg: 5.22, color: "#fff4d6",
    blurb: "A hot, evolving star whose habitable zone lies far out.",
    extra: [3, 6],
  },
  {
    id: "61-cygni", name: "61 Cygni", spectral: "K5V", massSol: 0.7, lumSol: 0.153,
    radiusSol: 0.665, tempK: 4526, distanceLy: 11.4, raHours: 21.12, decDeg: 38.75, color: "#ffb870",
    blurb: "The first star whose distance was ever measured.",
    extra: [3, 6],
  },
  {
    id: "gliese-1061", name: "Gliese 1061", spectral: "M5.5V", massSol: 0.125, lumSol: 0.0016,
    radiusSol: 0.156, tempK: 2953, distanceLy: 12.0, raHours: 3.59, decDeg: -44.51, color: "#ff8a5c",
    blurb: "A red dwarf with three planets, one near the edge of the habitable zone.",
    known: [
      { name: "Gliese 1061 b", periodDays: 3.204, earthMasses: 1.37 },
      { name: "Gliese 1061 c", periodDays: 6.689, earthMasses: 1.74 },
      { name: "Gliese 1061 d", periodDays: 13.03, earthMasses: 1.64 },
    ],
    extra: [0, 2],
  },
  {
    id: "luytens-star", name: "Luyten's Star", spectral: "M3.5V", massSol: 0.29, lumSol: 0.0088,
    radiusSol: 0.293, tempK: 3382, distanceLy: 12.35, raHours: 7.45, decDeg: 5.23, color: "#ffa070",
    blurb: "A red dwarf with a super-Earth in its habitable zone.",
    known: [
      { name: "Luyten's Star c", periodDays: 4.723, earthMasses: 1.18, candidate: true },
      { name: "Luyten's Star b", periodDays: 18.65, earthMasses: 2.89 },
    ],
    extra: [1, 3],
  },
  {
    id: "teegardens-star", name: "Teegarden's Star", spectral: "M7V", massSol: 0.093, lumSol: 0.00073,
    radiusSol: 0.12, tempK: 2904, distanceLy: 12.5, raHours: 2.89, decDeg: 16.88, color: "#ff7a4d",
    blurb: "A tiny red dwarf, found only in 2003 for being so faint.",
    known: [
      { name: "Teegarden's Star b", periodDays: 4.91, earthMasses: 1.16 },
      { name: "Teegarden's Star c", periodDays: 11.41, earthMasses: 1.05 },
      { name: "Teegarden's Star d", periodDays: 26.1, earthMasses: 0.82, candidate: true },
    ],
    extra: [0, 2],
  },
  {
    id: "trappist-1", name: "TRAPPIST-1", spectral: "M8V", massSol: 0.0898, lumSol: 0.000553,
    radiusSol: 0.1192, tempK: 2566, distanceLy: 40.7, raHours: 23.1, decDeg: -5.04, color: "#ff6a3d",
    blurb: "An ultracool dwarf with seven Earth-sized planets packed closer than Mercury is to the Sun.",
    known: [
      { name: "TRAPPIST-1 b", periodDays: 1.51, earthMasses: 1.37 },
      { name: "TRAPPIST-1 c", periodDays: 2.422, earthMasses: 1.31 },
      { name: "TRAPPIST-1 d", periodDays: 4.05, earthMasses: 0.39 },
      { name: "TRAPPIST-1 e", periodDays: 6.099, earthMasses: 0.69 },
      { name: "TRAPPIST-1 f", periodDays: 9.207, earthMasses: 1.04 },
      { name: "TRAPPIST-1 g", periodDays: 12.353, earthMasses: 1.32 },
      { name: "TRAPPIST-1 h", periodDays: 18.767, earthMasses: 0.33 },
    ],
    extra: [0, 0],
  },
];

/** Sol, for the galaxy map: the Sun is at the origin of the sky. */
export const SOL_STAR = {
  id: "sol", name: "Sol", spectral: "G2V", lumSol: 1, color: "#ffd257",
};
