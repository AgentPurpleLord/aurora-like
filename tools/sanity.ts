/**
 * Sanity checks for the orbital model. Run with `npm run check`.
 *
 * These are coarse assertions against published ephemeris values - enough to
 * catch a sign error in the rotation matrices or a bad element conversion,
 * not an attempt at arcsecond accuracy.
 */

import { AU_KM, DEG, eccentricAnomaly, positionAt, vecLength, vecSub } from "../src/sim/orbit";
import { StarSystem } from "../src/sim/system";
import { GameClock, CAMPAIGN_START_SECONDS } from "../src/sim/clock";

// Declared locally so the project does not need @types/node.
declare const process: { exit(code: number): never };

let failures = 0;

function check(name: string, actual: number, expected: number, tolerance: number): void {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  const status = ok ? "PASS" : "FAIL";
  console.log(
    `${status}  ${name.padEnd(46)} ${actual.toFixed(5).padStart(14)}  ` +
      `(expected ${expected} +/- ${tolerance})`,
  );
}

function assert(name: string, ok: boolean): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

// Kepler's equation: E - e sin E must reproduce the mean anomaly we fed in.
for (const e of [0, 0.2, 0.5, 0.85, 0.967]) {
  for (const m of [0.1, 1.0, 2.5, 4.0, 6.0]) {
    const E = eccentricAnomaly(m, e);
    const back = E - e * Math.sin(E);
    const target = ((m + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (Math.abs(back - target) > 1e-9) {
      failures++;
      console.log(`FAIL  Kepler solver e=${e} M=${m} -> ${back} != ${target}`);
    }
  }
}
console.log("PASS  Kepler solver inverts for e up to 0.967");

const system = new StarSystem();
const clock = new GameClock();
clock.seconds = CAMPAIGN_START_SECONDS; // 2025-01-01 00:00 UTC
system.update(clock.days);

const sol = system.root;
const earth = system.byId.get("earth")!;
const luna = system.byId.get("luna")!;
const jupiter = system.byId.get("jupiter")!;

// Earth is three days from perihelion on 1 Jan 2025: 0.9833 AU from Sol,
// at a heliocentric ecliptic longitude just past 100 degrees.
const earthR = vecLength(vecSub(earth.world, sol.world));
check("Earth heliocentric distance (AU)", earthR, 0.9833, 0.002);
const earthLon = (Math.atan2(earth.world.y, earth.world.x) / DEG + 360) % 360;
check("Earth heliocentric longitude (deg)", earthLon, 100.4, 1.0);

// Luna stays between perigee and apogee.
const lunaR = vecLength(luna.local) * AU_KM;
assert(
  `Luna geocentric distance ${Math.round(lunaR)} km within 356000-407000`,
  lunaR > 356_000 && lunaR < 407_000,
);

// Every orbit must stay between its own periapsis and apoapsis, sampled
// across a century of game time.
for (const body of system.bodies) {
  const orbit = body.def.orbit;
  if (!orbit) continue;
  const peri = orbit.a * (1 - orbit.e);
  const apo = orbit.a * (1 + orbit.e);
  let worst = "";
  for (let day = 0; day < 36_525; day += 3) {
    const r = vecLength(positionAt(orbit, day));
    if (r < peri - 1e-9 || r > apo + 1e-9) {
      worst = `r=${r} outside [${peri}, ${apo}] on day ${day}`;
      break;
    }
  }
  if (worst) {
    failures++;
    console.log(`FAIL  ${body.name} radius bound: ${worst}`);
  }
}
console.log("PASS  all orbits stay within their periapsis/apoapsis over 100 years");

// A body returns to where it started after exactly one period.
system.update(0);
const j0 = { ...jupiter.local };
system.update(jupiter.def.orbit!.periodDays);
const drift = vecLength(vecSub(jupiter.local, j0));
check("Jupiter position drift after one period (AU)", drift, 0, 1e-9);

// Derived physical values.
check("Earth surface gravity (g)", earth.gravity, 1.0, 0.005);
check("Earth escape velocity (km/s)", earth.escapeVelocity, 11.18, 0.05);
check("Luna surface gravity (g)", luna.gravity, 0.1654, 0.002);
// 2.64 g at the mean radius; the familiar 2.53 g figure is quoted at
// Jupiter's equatorial radius, which is 1600 km larger.
check("Jupiter surface gravity (g)", jupiter.gravity, 2.64, 0.02);

// Colony cost: Earth is free, Mars and Luna are standard hostile worlds,
// gas giants cannot be colonised at all.
check("Earth colony cost", earth.colonyCost, 0, 1e-9);
check("Mars colony cost", system.byId.get("mars")!.colonyCost, 2.0, 0.01);
check("Titan colony cost", system.byId.get("titan")!.colonyCost, 3.61, 0.05);
assert("Jupiter is not colonisable", !Number.isFinite(jupiter.colonyCost));
assert("Venus colony cost is extreme", system.byId.get("venus")!.colonyCost > 5);

// The tree covers every body exactly once.
assert(`system tree lists all ${system.bodies.length} bodies`, system.tree().length === system.bodies.length);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
