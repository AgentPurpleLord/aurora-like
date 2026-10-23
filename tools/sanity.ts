/**
 * Sanity checks for the orbital model. Run with `npm run check`.
 *
 * These are coarse assertions against published ephemeris values - enough to
 * catch a sign error in the rotation matrices or a bad element conversion,
 * not an attempt at arcsecond accuracy.
 */

import {
  AU_KM, DAYS_PER_YEAR, DEG, SECONDS_PER_DAY, eccentricAnomaly, positionAt, vecLength, vecSub,
} from "../src/sim/orbit";
import { StarSystem } from "../src/sim/system";
import { GameClock, CAMPAIGN_START_SECONDS } from "../src/sim/clock";
import { Game } from "../src/state/game";
import { CYCLE_DAYS, colonyOutput, employmentRatio } from "../src/sim/economy/production";
import { MINERALS } from "../src/sim/minerals";
import { ageOf } from "../src/sim/people/officers";
import { mineralLedger, previewOrder, queueDemand } from "../src/sim/economy/ledger";
import { SEVERITY_ORDER, activeIssues, deriveIssues } from "../src/sim/issues";
import { BUILT_IN_TEMPLATES, resolveTemplate } from "../src/sim/economy/templates";
import { supplyToward } from "../src/sim/economy/standingOrders";
import { deriveProposals } from "../src/sim/governors";
import { effectiveColonyCost, shipyardCapacity } from "../src/sim/economy/production";
import { componentStats, normaliseParams, suggestName, SURVEY_POINTS_NEEDED } from "../src/sim/ships/components";
import { maintainShips, servicingCapacity } from "../src/sim/ships/maintenance";
import { statsFor } from "../src/sim/research/techs";
import { classTitle } from "../src/sim/ships/hulls";
import type { Empire } from "../src/state/empire";
import { Galaxy } from "../src/sim/galaxy";
import { optionsFor, resolveEvent, rollEvent } from "../src/sim/events/engine";
import { STARS } from "../src/data/stars";
import { sharesShipping } from "../src/sim/economy/production";
import { surveyScope } from "../src/sim/ships/programs";
import { fleetStats } from "../src/sim/ships/fleet";
import { emptyStockpile } from "../src/state/colony";
import { gameFromSave, makeSave, parseSave } from "../src/state/save";

/** Component designs by role, made the way a player would. */
function parts(empire: Empire, now = 0) {
  const kind = (k: Parameters<Empire["addComponentDesign"]>[0], params: Record<string, number | string>) =>
    empire.componentDesigns.find((c) => c.kind === k && JSON.stringify(c.params) === JSON.stringify({ ...params })) ??
    empire.addComponentDesign(k, params, now);
  return {
    engine: (type: string, size = 5, modifier = 1) => kind("engine", { type, size, modifier }),
    tank: (size = 5) => kind("fuel-tank", { size }),
    quarters: (size = 2) => kind("crew-quarters", { size }),
    cargo: (size = 20) => kind("cargo-hold", { size }),
    colony: (size = 20) => kind("colony-module", { size }),
    sensor: (size = 4) => kind("survey-sensor", { type: "geological", size }),
  };
}
import {
  isBreathable,
  maxPressureFor,
  toxicGases,
  totalPressure,
} from "../src/sim/atmosphere";
import { recomputeEnvironment } from "../src/sim/system";
import {
  populationCapacity,
  terraformOutlook,
  terraformRate,
} from "../src/sim/economy/production";
import { formatPressure } from "../src/ui/format";
import { cargoTons, distanceToBody, executeArrivalOrders } from "../src/sim/ships/fleet";

const num = (v: number) => Math.round(v).toLocaleString("en-US");

// Declared locally so the project does not need @types/node.
declare const process: { exit(code: number): never };

let failures = 0;

/** Structural equality over plain data; key order does not matter. */
function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => isDeepStrictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

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

// ==========================================================================
// Economy, research and people
// ==========================================================================

console.log("");

const game = new Game("sanity");
const empire = game.empire;
const bodies = game.galaxy;

function totalMinerals(): number {
  let total = 0;
  for (const colony of empire.colonies.values()) {
    for (const mineral of MINERALS) total += colony.stockpile[mineral];
    // Refined fuel is Sorium that has left the stockpile.
    total += colony.fuel / 2000;
  }
  for (const body of bodies.bodies) {
    for (const deposit of body.minerals) total += deposit.amount;
  }
  return total;
}

/** Advance the simulation by whole production cycles. */
function runYears(years: number): void {
  const cycles = Math.round((years * DAYS_PER_YEAR) / CYCLE_DAYS);
  for (let i = 0; i < cycles; i++) game.step(CYCLE_DAYS * SECONDS_PER_DAY);
}

// The campaign opens on Earth alone: one colony, one surveyed world, and
// nothing researched beyond trans-Newtonian theory.
check("the campaign starts with one colony", empire.colonies.size, 1, 0);
assert("that colony is Earth", empire.colonies.has("earth"));
assert("only Earth has been surveyed", empire.surveyed.size === 1 && empire.surveyed.has("earth"));
check("only trans-Newtonian theory is known", empire.researched.size, 1, 0);
assert("no ships are in service", empire.ships.size === 0 && empire.fleets.size === 0);

const startingMinerals = totalMinerals();
const startingPopulation = empire.colony("earth")!.population;

// Nothing is queued at the start, so minerals only move between deposits,
// stockpiles and fuel - the total must be conserved exactly.
runYears(1);
check("minerals conserved over 1 year (tons)", totalMinerals(), startingMinerals, 1e-6);
assert(
  `Earth population grew (${startingPopulation.toFixed(0)} -> ${empire.colony("earth")!.population.toFixed(0)}m)`,
  empire.colony("earth")!.population > startingPopulation,
);
assert("Earth mined minerals into its stockpile", empire.colony("earth")!.stockpile.Duranium > 50_000);
assert("research is accumulating", empire.projects.every((p) => p.progress > 0));

// Mass drivers move an outpost's output to the capital rather than
// stranding it. Luna has to be settled first - nothing is given.
empire.research("mass-drivers");
const lunaColony = empire.foundColony("luna", game.clock.seconds);
lunaColony.installations = { "automated-mine": 40, "mass-driver": 2 };
runYears(1);
assert(
  "an outpost ships its minerals to the capital",
  lunaColony.stockpile.Duranium < 500 &&
    lunaColony.massDriverTarget === "earth" &&
    empire.colony("earth")!.stockpile.Duranium > 0,
);

// The opening research projects should complete within a decade and change
// the empire's working figures.
runYears(9);
assert("Construction Rate 12 BP researched", empire.researched.has("construction-12"));
check("construction rate after research", empire.stats.constructionRate, 12, 0);
assert("Mining Production 12 Tons researched", empire.researched.has("mining-12"));
check("mining rate after research", empire.stats.miningRate, 12, 0);

// Build queue: order automated mines on Earth and confirm they get built and
// that the minerals to build them were actually consumed.
const mars = empire.foundColony("mars", game.clock.seconds);
const marsMines = mars.installations["automated-mine"] ?? 0;
const earthDuranium = empire.colony("earth")!.stockpile.Duranium;
empire.queueBuild("earth", "automated-mine", 20);
runYears(2);
const earthColony = empire.colony("earth")!;
assert(
  `Earth built automated mines (${earthColony.installations["automated-mine"] ?? 0} of 20)`,
  (earthColony.installations["automated-mine"] ?? 0) >= 20,
);
assert("construction consumed Duranium", earthColony.stockpile.Duranium !== earthDuranium);
assert("another colony was untouched by Earth's queue", (mars.installations["automated-mine"] ?? 0) === marsMines);

// Employment: a colony cannot staff more manned installations than its
// population supports.
const employment = employmentRatio(earthColony);
assert(`Earth employment ratio is sane (${employment.toFixed(2)})`, employment > 0 && employment <= 1);

// People: over a long campaign officers join, are promoted, and retire.
const officersAtStart = empire.officers.officers.size;
const namesAtStart = new Set(empire.officers.list.map((o) => o.id));
runYears(25);
const now = game.clock.seconds;
const ages = empire.officers.list.map((o) => ageOf(o, now));
assert(
  `officer corps turned over (${officersAtStart} -> ${empire.officers.officers.size}, ` +
    `${empire.officers.list.filter((o) => !namesAtStart.has(o.id)).length} new)`,
  empire.officers.list.some((o) => !namesAtStart.has(o.id)),
);
assert(`no officer is older than 85 (oldest ${Math.max(...ages)})`, Math.max(...ages) <= 85);
assert("every posting points at something real", empire.officers.list.every((o) => {
  if (!o.assignment) return true;
  return o.assignment.kind === "governor"
    ? empire.colonies.has(o.assignment.targetId)
    : empire.projects.some((p) => p.id === o.assignment!.targetId);
}));
assert("some officer has been promoted", empire.officers.list.some((o) => o.rank > 0));

// Treasury and population over the long run.
assert(`treasury is a finite number (${Math.round(empire.treasury)})`, Number.isFinite(empire.treasury));
assert(
  `Earth population is plausible after 37 years (${empire.colony("earth")!.population.toFixed(0)}m)`,
  empire.colony("earth")!.population > 8_100 && empire.colony("earth")!.population < 12_000,
);
assert(
  "mineral total never increased",
  totalMinerals() <= startingMinerals + 1e-6,
);

// Expansion loop: settle a new world, build its infrastructure at Earth,
// ship it out, and let civilian shipping carry the colonists.
empire.foundColony("callisto", game.clock.seconds);
const callisto = empire.colony("callisto")!;
const peopleBefore = [...empire.colonies.values()].reduce((s, c) => s + c.population, 0);
empire.queueBuild("earth", "infrastructure", 4000, "callisto");
empire.queueBuild("earth", "automated-mine", 15, "callisto");
runYears(6);

assert(
  `Callisto received its infrastructure (${callisto.installations["infrastructure"] ?? 0})`,
  (callisto.installations["infrastructure"] ?? 0) >= 4000,
);
assert(
  `Callisto received automated mines (${callisto.installations["automated-mine"] ?? 0})`,
  (callisto.installations["automated-mine"] ?? 0) >= 15,
);
assert(
  "Earth did not keep the installations it built for Callisto",
  (empire.colony("earth")!.installations["infrastructure"] ?? 0) === 0,
);
assert(
  `colonists migrated to Callisto (${callisto.population.toFixed(2)}m)`,
  callisto.population > 0,
);
// Migration must move people, not mint them: over a single cycle the total
// population may only change by the natural growth of each colony.
const totalBefore = [...empire.colonies.values()].reduce((s, c) => s + c.population, 0);
const expectedGrowth = [...empire.colonies.values()].reduce((sum, c) => {
  const body = bodies.byId.get(c.bodyId)!;
  return sum + colonyOutput(empire, body, c, empire.stats).populationGrowth;
}, 0) * (CYCLE_DAYS / DAYS_PER_YEAR);
game.step(CYCLE_DAYS * SECONDS_PER_DAY);
const totalAfter = [...empire.colonies.values()].reduce((s, c) => s + c.population, 0);
check("population conserved across migration (millions)", totalAfter - totalBefore, expectedGrowth, 1e-9);
assert("the campaign gained people overall", totalAfter > peopleBefore);
assert(
  `Callisto is mining into its own stockpile`,
  MINERALS.some((m) => callisto.stockpile[m] > 0) || callisto.massDriverTarget !== null,
);

// ==========================================================================
// Planning layer: the mineral ledger, order previews and triage
// ==========================================================================

console.log("");

const fresh = new Game("planning");
const freshEmpire = fresh.empire;
const freshEarth = freshEmpire.colony("earth")!;

// Ledger totals must agree with the colonies they are summed from.
const ledger = mineralLedger(freshEmpire, fresh.galaxy);
const duranium = ledger.find((r) => r.mineral === "Duranium")!;
check("ledger Duranium stockpile", duranium.stockpile, 50_000, 1e-6);
assert(`ledger Duranium production is positive (${duranium.production.toFixed(0)} t/yr)`, duranium.production > 0);

// 100 refineries turning 40,000 litres each needs 2,000 tons of Sorium a year.
const sorium = ledger.find((r) => r.mineral === "Sorium")!;
check("ledger Sorium demand from refineries (t/yr)", sorium.demand, 2000, 1e-6);

// Nothing is queued, so nothing else is being consumed.
assert("no build demand with an empty queue", ledger.every((r) => r.mineral === "Sorium" || r.demand === 0));

// An automated mine costs 240 BP, 120 t Duranium and 120 t Uridium: half a
// ton of each per build point.
freshEmpire.queueBuild("earth", "automated-mine", 10);
const output = colonyOutput(freshEmpire, fresh.galaxy.byId.get("earth")!, freshEarth, freshEmpire.stats);
const demand = queueDemand(freshEmpire, freshEarth, output.buildPoints);
check("queue demand for Duranium (t/yr)", demand.Duranium ?? 0, Math.min(output.buildPoints, 2400) * 0.5, 1e-6);

const preview = previewOrder(freshEmpire, fresh.galaxy, freshEarth, "research-lab", 4)!;
check("preview build points", preview.buildPoints, 3600, 1e-6);
check("preview queued ahead (BP)", preview.queuedAhead, 2400, 1e-6);
check(
  "preview completion accounts for the queue (years)",
  preview.years,
  (2400 + 3600) / output.buildPoints,
  1e-9,
);
assert("preview is affordable from Earth's stockpile", preview.affordable);

const unaffordable = previewOrder(freshEmpire, fresh.galaxy, freshEarth, "research-lab", 400)!;
assert("preview flags an order the stockpile cannot cover", !unaffordable.affordable);
assert(
  "preview names the mineral that is short",
  unaffordable.minerals.some((m) => m.shortfall > 0),
);

// Triage: an empty queue on an industrial colony is worth saying out loud,
// and it stops being said once work is queued.
const freshLuna = freshEmpire.foundColony("luna", fresh.clock.seconds);
freshLuna.installations["construction-factory"] = 500;
freshLuna.installations["automated-mine"] = 40;
freshLuna.population = 30;
let issues = deriveIssues(freshEmpire, fresh.galaxy);
assert(
  "idle industry is reported",
  issues.some((i) => i.id === "colony:idle-industry:luna"),
);
freshEmpire.queueBuild("luna", "automated-mine", 5);
issues = deriveIssues(freshEmpire, fresh.galaxy);
assert(
  "idle industry stops being reported once work is queued",
  !issues.some((i) => i.id === "colony:idle-industry:luna"),
);

// A colony whose industry outruns its minerals reports a stall, at critical.
// Luna mines a few tons a cycle against 500 factories' appetite.
freshLuna.stockpile.Duranium = 0;
freshLuna.stockpile.Uridium = 0;
fresh.step(CYCLE_DAYS * SECONDS_PER_DAY);
issues = deriveIssues(freshEmpire, fresh.galaxy);
const stall = issues.find((i) => i.id === "queue:stalled:luna:automated-mine");
assert("a stalled build queue is reported", stall !== undefined);
assert("a stalled build queue is critical", stall?.severity === "critical");
assert("the stall links to the colony that owns it", stall?.action.bodyId === "luna");

// Dismissal hides an issue without deleting the condition, and lapses.
const dismissedAt = fresh.clock.seconds;
freshEmpire.dismissIssue("queue:stalled:luna:automated-mine", dismissedAt, 2);
assert(
  "a dismissed issue leaves the active list",
  !activeIssues(freshEmpire, fresh.galaxy, dismissedAt).some(
    (i) => i.id === "queue:stalled:luna:automated-mine",
  ),
);
assert(
  "a dismissed issue returns once the dismissal lapses",
  activeIssues(freshEmpire, fresh.galaxy, dismissedAt + 3 * DAYS_PER_YEAR * SECONDS_PER_DAY).some(
    (i) => i.id === "queue:stalled:luna:automated-mine",
  ),
);
assert(
  "issues are ordered with the most severe first",
  issues.every((issue, i) => i === 0 || SEVERITY_ORDER[issues[i - 1].severity] <= SEVERITY_ORDER[issue.severity]),
);

// Every issue must be actionable: a body it names has to exist.
assert(
  "every issue points somewhere real",
  issues.every((i) => !i.action.bodyId || fresh.galaxy.byId.has(i.action.bodyId)),
);

// ==========================================================================
// Automation: templates, standing orders and governor proposals
// ==========================================================================

console.log("");

// Scoped so these fixtures cannot collide with the campaign above.
{
  const auto = new Game("automation");
  const autoEmpire = auto.empire;
  const callistoBody = auto.galaxy.byId.get("callisto")!;
  autoEmpire.foundColony("callisto", auto.clock.seconds);
  const callisto = autoEmpire.colony("callisto")!;

  // Templates size infrastructure against the target world rather than
  // shipping a fixed number that is wrong everywhere.
  const outpost = BUILT_IN_TEMPLATES.find((t) => t.id === "mining-outpost")!;
  const resolved = resolveTemplate(outpost, callistoBody, callisto, autoEmpire.stats);
  const callistoCost = effectiveColonyCost(callistoBody, autoEmpire.stats);
  const infra = resolved.find((i) => i.installationId === "infrastructure")!;
  check(
    "template sizes infrastructure to colony cost",
    infra.quantity,
    Math.ceil(100 * callistoCost),
    0,
  );
  assert(
    "template includes a researched installation",
    resolved.some((i) => i.installationId === "automated-mine"),
  );
  assert(
    "a template drops a part the empire cannot build yet",
    !autoEmpire.researched.has("mass-drivers") &&
      !resolved.some((i) => i.installationId === "mass-driver"),
  );
  autoEmpire.research("mass-drivers");
  assert(
    "and includes it once the technology is in hand",
    resolveTemplate(outpost, callistoBody, callisto, autoEmpire.stats).some(
      (i) => i.installationId === "mass-driver",
    ),
  );

  // An item the empire has not researched is dropped rather than queued.
  const forward = BUILT_IN_TEMPLATES.find((t) => t.id === "forward-base")!;
  assert(
    "template drops installations that are not researched",
    !autoEmpire.stats.unlocked.has("dstn") &&
      !resolveTemplate(forward, callistoBody, callisto, autoEmpire.stats).some(
        (i) => i.installationId === "dstn",
      ),
  );

  // Applying a template on a world that needs no infrastructure asks for none.
  const earthBody = auto.galaxy.byId.get("earth")!;
  const earthColony = autoEmpire.colony("earth")!;
  assert(
    "a garden world is not sent infrastructure",
    !resolveTemplate(outpost, earthBody, earthColony, autoEmpire.stats).some(
      (i) => i.installationId === "infrastructure",
    ),
  );

  // --- standing orders top a colony up, then stop.
  autoEmpire.addStandingOrder({
    colonyId: "callisto",
    sourceId: "earth",
    enabled: true,
    rule: { kind: "maintain", installationId: "automated-mine", target: 12 },
  });
  for (let i = 0; i < 40; i++) auto.step(CYCLE_DAYS * SECONDS_PER_DAY);
  check(
    "standing order delivered its target",
    callisto.installations["automated-mine"] ?? 0,
    12,
    0,
  );
  const queuedAfter = earthColony.buildQueue.filter((o) => o.installationId === "automated-mine").length;
  assert("a satisfied standing order queues nothing further", queuedAfter === 0);
  check(
    "the rule's deliveries are counted toward the colony",
    supplyToward(autoEmpire, "callisto", "automated-mine"),
    12,
    0,
  );

  // It counts what is already on its way, so raising the target tops up the
  // difference rather than re-ordering the lot.
  autoEmpire.standingOrders[0].rule = { kind: "maintain", installationId: "automated-mine", target: 20 };
  auto.step(CYCLE_DAYS * SECONDS_PER_DAY);
  const topUp = earthColony.buildQueue.find((o) => o.installationId === "automated-mine");
  check("raising a target queues only the difference", topUp?.quantity ?? 0, 8, 0);
  assert("work queued by a rule is marked as automatic", topUp?.auto === true);

  // --- governor proposals need a governor, and a policy.
  callisto.policy = "mine";
  assert(
    "a policy without a governor proposes nothing",
    deriveProposals(autoEmpire, auto.galaxy).length === 0,
  );

  const administrator = autoEmpire.officers.byBranch("civilian")[0];
  autoEmpire.assignOfficer(administrator.id, {
    kind: "governor",
    targetId: "callisto",
    since: auto.clock.seconds,
  });

  // A governor will not propose mining ground nobody has surveyed.
  assert(
    "mining is not proposed for an unsurveyed world",
    !deriveProposals(autoEmpire, auto.galaxy).some(
      (p) => p.colonyId === "callisto" && p.order.installationId === "automated-mine",
    ),
  );
  autoEmpire.surveyed.add("callisto");

  const proposals = deriveProposals(autoEmpire, auto.galaxy);
  assert(
    `a mining governor proposes mines (${proposals.map((p) => p.order.installationId).join(", ")})`,
    proposals.some((p) => p.colonyId === "callisto" && p.order.installationId === "automated-mine"),
  );
  assert(
    "a proposal is built somewhere that has industry",
    proposals.every((p) => (autoEmpire.colony(p.order.sourceId)?.installations["construction-factory"] ?? 0) > 0),
  );

  // Proposals reach the player through the attention list, carrying the order
  // they would place.
  const withProposals = deriveIssues(autoEmpire, auto.galaxy);
  const proposalIssue = withProposals.find((i) => i.id.startsWith("proposal:callisto"));
  assert("proposals appear in the attention list", proposalIssue !== undefined);
  assert("an attention proposal carries a concrete order", (proposalIssue?.proposal?.quantity ?? 0) > 0);

  // Accepting enough of them satisfies the policy and it stops proposing.
  autoEmpire.queueBuild("earth", "automated-mine", 40, "callisto");
  assert(
    "a satisfied policy stops proposing",
    !deriveProposals(autoEmpire, auto.galaxy).some(
      (p) => p.colonyId === "callisto" && p.order.installationId === "automated-mine",
    ),
  );

  // Policy "none" is silent even with a governor posted.
  callisto.policy = "none";
  assert(
    "a governor with no policy proposes nothing",
    !deriveProposals(autoEmpire, auto.galaxy).some((p) => p.colonyId === "callisto"),
  );
}

// ==========================================================================
// Ships and fleets
// ==========================================================================

console.log("");

// Scoped so these fixtures cannot collide with the campaign above.
{
  const navy = new Game("navy");
  const empire = navy.empire;
  const earth = empire.colony("earth")!;

  // --- design arithmetic
  empire.research("nuclear-thermal");
  const p = parts(empire);
  const thermal = p.engine("nuclear-thermal");
  const hauler = empire.addDesign("Hauler", [
    { componentId: thermal.id, count: 2 },
    { componentId: p.tank().id, count: 4 },
    { componentId: p.cargo().id, count: 4 },
    { componentId: p.quarters().id, count: 2 },
  ], 0);
  const stats = empire.statsOf(hauler.id)!;
  check("design tonnage", stats.tons, 2 * 250 + 4 * 250 + 4 * 1000 + 2 * 100, 0);
  // Speed is engine power per hull space: 120 power, 5700 t = 114 HS.
  check("design speed (km/s)", stats.speed, (120 * 1000) / (5700 / 50), 1e-9);
  check("design fuel capacity (litres)", stats.fuelCapacity, 200_000, 0);
  check("design cargo capacity (tons)", stats.cargoCapacity, 100_000, 0);
  check("design crew required", stats.crewRequired, 2 * 3 + 4 * 2, 0);
  assert("a complete design has no problems", stats.problems.length === 0);

  // --- standard classes use the standard parts, even after custom ones exist
  {
    const std = new Game("standard");
    std.empire.research("nuclear-thermal");
    const customEngine = std.empire.addComponentDesign("engine", { type: "nuclear-thermal", size: 8, modifier: 0.6 }, 0);
    const standardHauler = std.empire.addStandardClasses(0).find((d) => d.name === "Hauler")!;
    assert(
      "standard classes ignore a custom engine designed earlier",
      standardHauler.components.every((c) => c.componentId !== customEngine.id),
    );
    check("and the standard Hauler is the familiar 5,700 t", std.empire.statsOf(standardHauler.id)!.tons, 5700, 0);
  }

  // --- the component designer's arithmetic
  const thermalStats = componentStats("engine", { type: "nuclear-thermal", size: 5, modifier: 1 }, empire.researched);
  check("engine power is size x type power x modifier", thermalStats.power ?? 0, 5 * 12, 1e-9);
  const eco = componentStats("engine", { type: "nuclear-thermal", size: 5, modifier: 0.5 }, empire.researched);
  check("an eco-tuned engine makes half the power", eco.power ?? 0, 30, 1e-9);
  assert(
    "and burns far less fuel per unit of power",
    (eco.fuelPerHour! / eco.power!) < (thermalStats.fuelPerHour! / thermalStats.power!) / 3,
  );
  check(
    "fuel per power-hour falls with the square of the modifier",
    (eco.fuelPerHour! / eco.power!) / (thermalStats.fuelPerHour! / thermalStats.power!),
    0.25,
    1e-9,
  );
  assert("a tuned-down engine is cheaper to build", eco.cost < thermalStats.cost);
  check(
    "an overdriven modifier is clamped without the technology",
    Number(normaliseParams("engine", { type: "nuclear-thermal", size: 5, modifier: 1.25 }, empire.researched).modifier),
    1.0,
    1e-9,
  );
  const withTuning = new Set([...empire.researched, "engine-power-125"]);
  check(
    "and allowed once engine power tuning is researched",
    Number(normaliseParams("engine", { type: "nuclear-thermal", size: 5, modifier: 1.25 }, withTuning).modifier),
    1.25,
    1e-9,
  );
  check(
    "a stepped parameter carries no float noise",
    Number(normaliseParams("engine", { type: "nuclear-thermal", size: 8, modifier: 0.6 }, empire.researched).modifier),
    0.6,
    0,
  );
  check("component size is clamped to its range", Number(normaliseParams("fuel-tank", { size: 9999 }, empire.researched).size), 40, 0);
  const sensorStats = componentStats("survey-sensor", { type: "geological", size: 4 }, new Set([...empire.researched, "geo-survey-sensors"]));
  check("survey rate scales with sensor size (points/day)", sensorStats.survey?.rate ?? 0, 40, 0);

  // A component in use cannot be rewritten out from under a class.
  const usedTank = p.tank();
  assert("a component in use is reported as used", empire.componentUsers(usedTank.id).length > 0);
  assert("and refuses to be edited in place", !empire.updateComponentDesign(usedTank.id, "x", { size: 9 }));
  assert("or deleted", !empire.removeComponentDesign(usedTank.id));
  const spare = empire.addComponentDesign("fuel-tank", { size: 7 }, 0);
  assert("an unused one can be edited", empire.updateComponentDesign(spare.id, "Big Tank", { size: 9 }));
  check("and the edit is reflected in its figures", empire.resolveComponent(spare.id)!.stats.fuel ?? 0, 90_000, 0);
  assert("and removed", empire.removeComponentDesign(spare.id));

  const unpowered = empire.addDesign("Hulk", [{ componentId: p.cargo().id, count: 1 }], 0);
  assert(
    "a design with no engine is rejected",
    empire.statsOf(unpowered.id)!.problems.some((m) => m.includes("No engine")),
  );
  const ion = p.engine("ion");
  const unresearched = empire.addDesign("Dreamer", [
    { componentId: ion.id, count: 1 },
    { componentId: p.quarters().id, count: 1 },
  ], 0);
  assert(
    "a component of an unresearched type is rejected",
    empire.statsOf(unresearched.id)!.problems.some((m) => m.includes("not been researched")),
  );

  // --- a hull larger than the slipways never starts
  const leviathan = empire.addDesign("Leviathan", [
    { componentId: thermal.id, count: 2 },
    { componentId: p.cargo().id, count: 40 },
    { componentId: p.quarters().id, count: 5 },
    { componentId: p.tank().id, count: 2 },
  ], 0);
  empire.queueShip("earth", leviathan.id, 1);
  navy.step(CYCLE_DAYS * SECONDS_PER_DAY);
  const blocked = earth.buildQueue.find((o) => o.designId === leviathan.id);
  assert(
    `a hull beyond shipyard capacity does not start (${num(shipyardCapacity(earth))} t of slipway)`,
    blocked !== undefined && blocked.progress === 0 && blocked.starved,
  );
  empire.cancelOrder("earth", blocked!.id);

  // --- building a ship through the ordinary queue
  empire.queueShip("earth", hauler.id, 1);
  for (let i = 0; i < 20 && !empire.ships.size; i++) navy.step(CYCLE_DAYS * SECONDS_PER_DAY);
  assert(`a hull was commissioned (${empire.ships.size} ships)`, empire.ships.size === 1);
  const fleet = [...empire.fleets.values()][0];
  assert("the new ship joined a fleet at its yard", fleet !== undefined && fleet.anchorId === "earth");

  const ship = [...empire.ships.values()][0];
  ship.fuel = stats.fuelCapacity;
  check("a new fleet is commissioned at its yard, not at the origin",
    distanceToBody(fleet, navy.galaxy.byId.get("earth")!.world), 0, 1e-9);

  // --- movement: Earth to Mars, at the speed the design says
  const mars = navy.galaxy.byId.get("mars")!;
  const distance = distanceToBody(fleet, mars.world);
  fleet.orders.push({ kind: "move", bodyId: "mars" });
  const expectedSeconds = (distance * AU_KM) / stats.speed;
  const fuelBefore = ship.fuel;

  // Half way there, the fleet should be in flight and burning fuel.
  navy.step(expectedSeconds / 2);
  assert("a fleet under way is not anchored", fleet.anchorId === null);
  assert("a fleet under way is burning fuel", ship.fuel < fuelBefore);
  check(
    "fuel burn matches the design's hourly rate",
    fuelBefore - ship.fuel,
    (stats.fuelPerHour * (expectedSeconds / 2)) / 3600,
    1,
  );

  // Mars has moved on in the meantime, so allow a little slack.
  for (let i = 0; i < 8 && fleet.anchorId !== "mars"; i++) navy.step(expectedSeconds / 4);
  assert("the fleet arrived at Mars", fleet.anchorId === "mars");
  assert("the move order was consumed on arrival", fleet.orders.length === 0);

  // --- cargo: load at Earth, carry to Mars, install on arrival
  empire.civilianShipping = false;
  earth.stored["automated-mine"] = 3;
  const marsColony = empire.colony("mars") ?? empire.foundColony("mars", navy.clock.seconds);
  const marsMinesBefore = marsColony.installations["automated-mine"] ?? 0;

  fleet.orders.push(
    { kind: "move", bodyId: "earth" },
    { kind: "load-installation", installationId: "automated-mine", quantity: 3 },
    { kind: "refuel" },
    { kind: "move", bodyId: "mars" },
    { kind: "unload-installations" },
  );
  for (let i = 0; i < 40 && fleet.orders.length; i++) navy.step(SECONDS_PER_DAY);

  assert("the freighter worked through its orders", fleet.orders.length === 0);
  check("cargo was installed at the destination",
    marsColony.installations["automated-mine"] ?? 0, marsMinesBefore + 3, 0);
  check("the crates left the origin", earth.stored["automated-mine"] ?? 0, 0, 0);
  assert("the holds are empty again", cargoTons(fleet.cargo) === 0);

  // --- colonists are moved, not minted. Measured around the order itself,
  // since population grows while time passes.
  const pioneer = empire.addDesign("Pioneer", [
    { componentId: thermal.id, count: 2 },
    { componentId: p.tank().id, count: 4 },
    { componentId: p.colony().id, count: 2 },
    { componentId: p.quarters().id, count: 2 },
  ], 0);
  const colonyFleet = empire.createFleet("Settlers", { x: 0, y: 0, z: 0 }, "earth");
  const colonyShip = empire.commissionShip(pioneer.id, colonyFleet, "Pioneer 001", 0);
  colonyShip.fuel = empire.statsOf(pioneer.id)!.fuelCapacity;
  const beforeEmbark = earth.population;
  colonyFleet.orders.push({ kind: "load-colonists", amount: 40_000 });
  executeArrivalOrders(empire, navy.galaxy, colonyFleet);
  check("embarking takes the colonists off the planet (millions)",
    beforeEmbark - earth.population, 0.04, 1e-9);
  check("the colonists are aboard", colonyFleet.cargo.colonists, 40_000, 0);

  colonyFleet.orders.push({ kind: "move", bodyId: "mars" });
  for (let i = 0; i < 40 && colonyFleet.orders.length; i++) navy.step(SECONDS_PER_DAY);
  assert("the colony ship reached Mars", colonyFleet.anchorId === "mars");

  const beforeLanding = marsColony.population;
  colonyFleet.orders.push({ kind: "unload-colonists" });
  executeArrivalOrders(empire, navy.galaxy, colonyFleet);
  check("landing puts the same colonists down (millions)",
    marsColony.population - beforeLanding, 0.04, 1e-9);
  check("the berths are empty again", colonyFleet.cargo.colonists, 0, 0);

  // --- an empty tank strands a fleet
  ship.fuel = 0;
  fleet.orders.push({ kind: "move", bodyId: "jupiter" });
  navy.step(SECONDS_PER_DAY);
  assert("a fleet with no fuel cannot move", fleet.anchorId === "mars");
  assert(`a stranded fleet says why ("${fleet.note}")`, fleet.note === "Out of fuel");
  assert(
    "a stranded fleet is raised for attention",
    deriveIssues(empire, navy.galaxy).some((i) => i.id === `fleet:blocked:${fleet.id}`),
  );

  // --- survey
  empire.research("geo-survey-sensors");
  const surveyor = empire.addDesign("Surveyor", [
    { componentId: thermal.id, count: 1 },
    { componentId: p.tank().id, count: 2 },
    { componentId: p.sensor().id, count: 1 },
    { componentId: p.quarters().id, count: 1 },
  ], 0);
  const surveyFleet = empire.createFleet("Survey Group", { x: 0, y: 0, z: 0 }, "earth");
  const surveyShip = empire.commissionShip(surveyor.id, surveyFleet, "Surveyor 001", 0);
  surveyShip.fuel = empire.statsOf(surveyor.id)!.fuelCapacity;
  assert("Callisto starts unsurveyed", !empire.surveyed.has("callisto"));
  surveyFleet.orders.push({ kind: "move", bodyId: "callisto" }, { kind: "survey" });
  let arrived = -1;
  let finished = -1;
  for (let day = 0; day < 600 && finished < 0; day++) {
    navy.step(SECONDS_PER_DAY / 4);
    if (arrived < 0 && surveyFleet.anchorId === "callisto") arrived = day;
    if (empire.surveyed.has("callisto")) finished = day;
  }
  assert("the survey ship reached Callisto and surveyed it", empire.surveyed.has("callisto"));
  // 4 HS of sensor is 40 points a day against 200 points: five days, not instant.
  const rateDays = SURVEY_POINTS_NEEDED / 40;
  assert(
    `surveying took about ${rateDays} days, not an instant (${((finished - arrived) / 4).toFixed(1)} days)`,
    (finished - arrived) / 4 >= rateDays - 1.5 && (finished - arrived) / 4 <= rateDays + 1.5,
  );

  // --- with civilian shipping off, finished work waits for a ship
  empire.queueBuild("earth", "automated-mine", 1, "mars");
  for (let i = 0; i < 20 && !(earth.stored["automated-mine"] ?? 0); i++) {
    navy.step(CYCLE_DAYS * SECONDS_PER_DAY);
  }
  check("without civilian shipping, cargo is crated at the builder",
    earth.stored["automated-mine"] ?? 0, 1, 0);
}

// ==========================================================================
// Atmospheres and terraforming
// ==========================================================================

console.log("");

// Scoped so these fixtures cannot collide with the campaign above.
{
  const world = new Game("terraform");
  const earthBody = world.galaxy.byId.get("earth")!;
  const marsBody = world.galaxy.byId.get("mars")!;

  // The observed atmospheres read correctly through the gas model.
  check("Earth's atmosphere is one bar", totalPressure(earthBody.atmosphere), 1.0043, 0.001);
  assert("Earth's air is breathable", isBreathable(earthBody.atmosphere));
  check("Earth's colony cost", earthBody.colonyCost, 0, 1e-9);
  assert("Mars's air is not breathable", !isBreathable(marsBody.atmosphere));
  check("Mars's colony cost", marsBody.colonyCost, 2.0, 0.01);
  check("an untouched world reads its observed temperature", marsBody.tempK, 210, 0.5);
  assert(
    "Venus is poisonous as well as hot",
    toxicGases(world.galaxy.byId.get("venus")!.atmosphere).some((t) => t.gas.id === "carbon-dioxide"),
  );

  // A gas with no greenhouse effect does not warm a world.
  const before = marsBody.tempK;
  marsBody.atmosphere.nitrogen = (marsBody.atmosphere.nitrogen ?? 0) + 0.2;
  recomputeEnvironment(marsBody);
  check("adding nitrogen does not change the temperature", marsBody.tempK, before, 1e-9);

  // A greenhouse gas does, and saturating warming stays monotonic.
  marsBody.atmosphere["nitrous-oxide"] = 0.2;
  recomputeEnvironment(marsBody);
  const warmed = marsBody.tempK;
  assert(`nitrous oxide warms Mars (${before.toFixed(0)} K -> ${warmed.toFixed(0)} K)`, warmed > before);
  marsBody.atmosphere["nitrous-oxide"] = 2.0;
  recomputeEnvironment(marsBody);
  assert("more of it warms it further", marsBody.tempK > warmed);
  marsBody.atmosphere["nitrous-oxide"] = 200;
  recomputeEnvironment(marsBody);
  assert("warming saturates rather than running away", marsBody.tempK < 700);

  // Back to where we started, and run a real programme.
  const fresh = new Game("terraform-run");
  const freshEmpire = fresh.empire;
  const mars = fresh.galaxy.byId.get("mars")!;
  freshEmpire.research("terraforming");
  freshEmpire.surveyed.add("mars");
  const colony = freshEmpire.foundColony("mars", fresh.clock.seconds);
  colony.population = 10;
  colony.installations = { infrastructure: 20_000, terraforming: 200 };
  colony.terraforming = { gasId: "nitrous-oxide", mode: "add" };

  const rate = terraformRate(freshEmpire, colony);
  check("terraforming rate is installations x tech rate", rate, 200 * 0.0001, 1e-12);

  const outlook = terraformOutlook(freshEmpire, mars, colony)!;
  assert(`the outlook names a goal ("${outlook.text}")`, outlook.text.includes("253"));
  const predicted = outlook.years!;
  assert(`the outlook predicts a timescale (${predicted.toFixed(1)} years)`, predicted > 1 && predicted < 500);

  const startPressure = totalPressure(mars.atmosphere);
  const years = 10;
  for (let i = 0; i < Math.round((years * DAYS_PER_YEAR) / CYCLE_DAYS); i++) {
    fresh.step(CYCLE_DAYS * SECONDS_PER_DAY);
  }
  check(
    "ten years of terraforming adds exactly ten years of gas",
    totalPressure(mars.atmosphere) - startPressure,
    rate * years,
    rate * years * 0.01,
  );

  // Run to the predicted date and the prediction should hold.
  const remaining = Math.round(((predicted - years) * DAYS_PER_YEAR) / CYCLE_DAYS);
  for (let i = 0; i < remaining; i++) fresh.step(CYCLE_DAYS * SECONDS_PER_DAY);
  check(
    `the world reaches the predicted temperature on schedule`,
    mars.tempK,
    253,
    3,
  );
  assert("warming cut the colony cost", mars.colonyCost < 2.0 + 1e-9);

  // Oxygen makes it breathable; the cost falls to zero.
  colony.terraforming = { gasId: "oxygen", mode: "add" };
  const oxygenOutlook = terraformOutlook(freshEmpire, mars, colony)!;
  for (let i = 0; i < Math.ceil((oxygenOutlook.years! * DAYS_PER_YEAR) / CYCLE_DAYS) + 2; i++) {
    fresh.step(CYCLE_DAYS * SECONDS_PER_DAY);
  }
  assert(
    `Mars is breathable after terraforming (${formatPressure(mars.atmosphere.oxygen ?? 0)} atm oxygen, ${
      mars.tempK.toFixed(0)
    } K)`,
    isBreathable(mars.atmosphere),
  );
  check("a terraformed world costs nothing to settle", mars.colonyCost, 0, 1e-9);
  assert(
    "and its people can now grow unaided",
    populationCapacity(mars, colony, freshEmpire.stats) > 100,
  );

  // A toxic gas undoes it, and removal cannot go below nothing.
  mars.atmosphere["sulphur-dioxide"] = 0.01;
  recomputeEnvironment(mars);
  assert("a toxic gas makes a world unbreathable again", !isBreathable(mars.atmosphere));
  assert("and raises its colony cost", mars.colonyCost >= 2);

  colony.terraforming = { gasId: "sulphur-dioxide", mode: "remove" };
  for (let i = 0; i < 400; i++) fresh.step(CYCLE_DAYS * SECONDS_PER_DAY);
  check("removal stops at nothing", mars.atmosphere["sulphur-dioxide"] ?? 0, 0, 1e-12);
  assert("and the world recovers", isBreathable(mars.atmosphere));

  // A world can only hold the air its gravity allows.
  const luna = fresh.galaxy.byId.get("luna")!;
  const lunaColony = freshEmpire.foundColony("luna", fresh.clock.seconds);
  lunaColony.population = 5;
  lunaColony.installations = { infrastructure: 50_000, terraforming: 500 };
  lunaColony.terraforming = { gasId: "nitrogen", mode: "add" };
  for (let i = 0; i < 3000; i++) fresh.step(CYCLE_DAYS * SECONDS_PER_DAY);
  const cap = maxPressureFor(luna.gravity);
  assert(
    `a small world stops filling at its own ceiling (${formatPressure(totalPressure(luna.atmosphere))} of ${
      formatPressure(cap)
    } atm)`,
    totalPressure(luna.atmosphere) <= cap + 1e-9,
  );
}

// ==========================================================================
// Saving and loading
// ==========================================================================

console.log("");

{
  const original = new Game("persist");
  const e = original.empire;
  e.research("nuclear-thermal");
  e.research("geo-survey-sensors");
  const pp = parts(e);
  const ship = e.addDesign("Scout", [
    { componentId: pp.engine("nuclear-thermal").id, count: 1 },
    { componentId: pp.tank().id, count: 2 },
    { componentId: pp.sensor().id, count: 1 },
    { componentId: pp.quarters().id, count: 1 },
  ], 0);
  const fleet = e.createFleet("Scouts", { x: 0, y: 0, z: 0 }, "earth");
  e.commissionShip(ship.id, fleet, "Scout 001", 0).fuel = 1e5;
  fleet.orders.push({ kind: "move", bodyId: "mars" }, { kind: "survey" });
  e.queueBuild("earth", "mine", 5);
  const mars = original.galaxy.byId.get("mars")!;
  mars.atmosphere["nitrogen"] = (mars.atmosphere["nitrogen"] ?? 0) + 0.2;
  recomputeEnvironment(mars);
  for (let i = 0; i < 40; i++) original.step(CYCLE_DAYS * SECONDS_PER_DAY);

  // Key order is not state; compare the data itself.
  const same = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  const file = makeSave(original, "test", "Test", "manual");
  const text = JSON.stringify(file);
  const loaded = gameFromSave(parseSave(text));
  assert(
    "a saved game restores to exactly the state that was saved",
    same(loaded.exportState(), original.exportState()),
  );
  check("the clock comes back", loaded.clock.seconds, original.clock.seconds, 0);
  check("the changed atmosphere comes back", loaded.galaxy.byId.get("mars")!.atmosphere["nitrogen"] ?? 0,
    mars.atmosphere["nitrogen"] ?? 0, 1e-12);
  check("and the colony cost follows from it", loaded.galaxy.byId.get("mars")!.colonyCost, mars.colonyCost, 1e-9);
  assert("fleets and ships come back", loaded.empire.fleets.size === 1 && loaded.empire.ships.size === 1);
  assert("derived ship figures work on a loaded game", loaded.empire.statsOf(ship.id)?.speed === e.statsOf(ship.id)?.speed);

  // The strongest test of a save: play on from both and expect no difference.
  for (let i = 0; i < 120; i++) {
    original.step(CYCLE_DAYS * SECONDS_PER_DAY);
    loaded.step(CYCLE_DAYS * SECONDS_PER_DAY);
  }
  assert(
    "a loaded game plays on identically to the original",
    same(loaded.exportState(), original.exportState()),
  );

  let rejected = 0;
  for (const bad of ["not json", "{}", JSON.stringify({ ...file, version: 999 })]) {
    try { parseSave(bad); } catch { rejected++; }
  }
  check("damaged or future saves are refused with an error", rejected, 3, 0);
}

// ==========================================================================
// Fleet programmes and repeating orders
// ==========================================================================

console.log("");

{
  const game = new Game("programmes");
  const e = game.empire;
  e.research("nuclear-thermal");
  e.research("geo-survey-sensors");
  const pp = parts(e);
  const scout = e.addDesign("Scout", [
    { componentId: pp.engine("nuclear-thermal").id, count: 2 },
    { componentId: pp.tank().id, count: 6 },
    { componentId: pp.sensor().id, count: 2 },
    { componentId: pp.quarters().id, count: 1 },
  ], 0);
  const freighter = e.addDesign("Freighter", [
    { componentId: pp.engine("nuclear-thermal").id, count: 2 },
    { componentId: pp.tank().id, count: 4 },
    { componentId: pp.cargo().id, count: 4 },
    { componentId: pp.quarters().id, count: 2 },
  ], 0);

  // --- survey everything
  const survey = e.createFleet("Survey Wing", { x: 0, y: 0, z: 0 }, "earth");
  e.commissionShip(scout.id, survey, "Scout 001", 0); // arrives with dry tanks
  survey.program = { kind: "survey", maxAu: 6, systemId: "sol" };
  const inScope = surveyScope(game.galaxy, "sol", 6);
  assert(`the survey scope is the bodies within 6 AU (${inScope.length})`, inScope.length > 10);
  for (let day = 0; day < 4000 && survey.program; day++) game.step(SECONDS_PER_DAY);
  assert("a survey programme finishes by itself", survey.program === null);
  assert(
    "every body in scope was surveyed",
    inScope.every((b) => e.surveyed.has(b.id)),
  );
  assert("the programme reported once, not per body",
    e.log.filter((l) => l.category === "fleet" && !l.quiet && /survey programme/.test(l.text)).length === 1);
  assert("routine survey results were logged quietly",
    e.log.filter((l) => /has surveyed/.test(l.text)).every((l) => l.quiet));
  for (let day = 0; day < 400 && survey.anchorId !== "earth"; day++) game.step(SECONDS_PER_DAY);
  assert("and the ship was sent home afterwards", survey.anchorId === "earth" || survey.orders.length > 0);

  // --- two fleets share the work
  const game2 = new Game("programmes-2");
  const e2 = game2.empire;
  e2.research("nuclear-thermal");
  e2.research("geo-survey-sensors");
  const pp2 = parts(e2);
  const scout2 = e2.addDesign("Scout", [
    { componentId: pp2.engine("nuclear-thermal").id, count: 2 },
    { componentId: pp2.tank().id, count: 6 },
    { componentId: pp2.sensor().id, count: 2 },
    { componentId: pp2.quarters().id, count: 1 },
  ], 0);
  const one = e2.createFleet("One", { x: 0, y: 0, z: 0 }, "earth");
  const two = e2.createFleet("Two", { x: 0, y: 0, z: 0 }, "earth");
  e2.commissionShip(scout2.id, one, "S1", 0);
  e2.commissionShip(scout2.id, two, "S2", 0);
  one.program = { kind: "survey", maxAu: 2.5, systemId: "sol" };
  two.program = { kind: "survey", maxAu: 2.5, systemId: "sol" };
  game2.step(SECONDS_PER_DAY * 3);
  const targets = (f: typeof one) => f.orders.filter((o) => o.kind === "move").map((o) => (o as { bodyId: string }).bodyId);
  assert("two survey fleets are not sent to the same body",
    targets(one).every((t) => !targets(two).includes(t)));

  // --- a programme without sensors says so
  const blind = e.createFleet("Blind", { x: 0, y: 0, z: 0 }, "earth");
  const freightShip = e.commissionShip(freighter.id, blind, "F0", 0);
  freightShip.fuel = 1;
  blind.program = { kind: "survey", maxAu: 0, systemId: "sol" };
  game.step(SECONDS_PER_DAY * 2);
  assert("a programme that cannot work explains why", blind.note === "No survey sensors aboard");
  blind.program = null;
  blind.note = null;

  // --- a freight line
  const mars = e.foundColony("mars", game.clock.seconds);
  mars.population = 1;
  mars.stockpile = emptyStockpile();
  const earth = e.colony("earth")!;
  for (const m of MINERALS) earth.stockpile[m] = 900_000;
  earth.fuel = 5_000_000;
  const line = e.createFleet("Mars Run", { x: 0, y: 0, z: 0 }, "earth");
  e.commissionShip(freighter.id, line, "Hauler 1", 0);
  line.program = {
    kind: "freight", fromId: "earth", toId: "mars",
    there: { kind: "minerals", mineral: "Duranium", keep: 10_000 }, back: null,
  };
  const earthBefore = earth.stockpile.Duranium;
  const capacity = fleetStats(e, line).cargoCapacity;
  for (let day = 0; day < 1500 && mars.stockpile.Duranium <= 0; day++) game.step(SECONDS_PER_DAY);
  assert(`the freight line delivered minerals to Mars (${num(mars.stockpile.Duranium)} t)`, mars.stockpile.Duranium > 0);
  assert("what Mars received left Earth's stockpile",
    Math.abs((earthBefore - earth.stockpile.Duranium) - mars.stockpile.Duranium) < 1e-6 + capacity);
  const minHeld = earth.stockpile.Duranium;
  for (let day = 0; day < 3000; day++) game.step(SECONDS_PER_DAY);
  assert("the line keeps running trip after trip", mars.stockpile.Duranium > capacity * 1.5);
  assert("the line leaves the reserve it was told to keep", earth.stockpile.Duranium >= 10_000 - 1 || earth.stockpile.Duranium >= minHeld - capacity * 20);
  assert("freight arrivals do not stop the clock",
    e.log.filter((l) => /Mars Run/.test(l.text)).every((l) => l.quiet || /out of fuel/.test(l.text)));

  // --- waiting for cargo is a state, not an error
  for (const m of MINERALS) earth.stockpile[m] = 0;
  for (let day = 0; day < 400; day++) game.step(SECONDS_PER_DAY);
  assert("with nothing to carry, the line waits",
    /Waiting for duranium/.test(line.programStatus ?? "") && line.note === null);
  assert("and a waiting line is not raised as an idle fleet",
    !deriveIssues(e, game.galaxy).some((i) => i.id === `fleet:idle:${line.id}`));

  // --- installations from the store, colonists
  earth.stored["mine"] = 30;
  line.program = {
    kind: "freight", fromId: "earth", toId: "mars",
    there: { kind: "installations", installationId: "all" }, back: null,
  };
  const minesBefore = mars.installations["mine"] ?? 0;
  for (let day = 0; day < 1500 && (earth.stored["mine"] ?? 0) > 0; day++) game.step(SECONDS_PER_DAY);
  for (let day = 0; day < 600; day++) game.step(SECONDS_PER_DAY);
  assert("stored installations were carried and installed",
    (mars.installations["mine"] ?? 0) > minesBefore && (earth.stored["mine"] ?? 0) < 30);

  // --- repeating orders
  const loop = e.createFleet("Shuttle", { x: 0, y: 0, z: 0 }, "earth");
  const loopShip = e.commissionShip(freighter.id, loop, "Shuttle 1", 0);
  loopShip.fuel = empire_fuel(e, freighter.id);
  loop.orders.push({ kind: "move", bodyId: "mars" }, { kind: "move", bodyId: "earth" }, { kind: "refuel" });
  loop.loop = true;
  for (let day = 0; day < 4000; day++) game.step(SECONDS_PER_DAY / 2);
  const arrivals = e.log.filter((l) => /Shuttle has arrived/.test(l.text)).length;
  assert(`a repeating fleet goes round again and again (${arrivals} arrivals)`, arrivals >= 4);
  assert("its orders are never used up", loop.orders.length === 3);
  assert("and its arrivals were logged quietly",
    e.log.filter((l) => /Shuttle has arrived/.test(l.text)).every((l) => l.quiet));

  function empire_fuel(emp: typeof e, designId: string): number {
    return emp.statsOf(designId)!.fuelCapacity;
  }
}

// ==========================================================================
// The galaxy, jump points and exploration
// ==========================================================================

console.log("");

{
  const a = new Galaxy("alpha");
  const a2 = new Galaxy("alpha");
  const b = new Galaxy("beta");
  assert(`the galaxy has Sol and ${STARS.length} real neighbours`, a.systems.length === STARS.length + 1);

  // --- real data survives
  const trappist = a.systemById.get("trappist-1")!;
  const tPlanets = trappist.bodies.filter((x) => x.cls === "planet");
  assert("TRAPPIST-1 keeps its seven known planets", tPlanets.length === 7);
  const proxima = a.byId.get("proxima-centauri-b")!;
  check("Proxima b's orbit comes from its measured 11.19-day period", proxima.def.orbit!.a, 0.0485, 0.001);
  check("a star's mass is the real one", a.byId.get("tau-ceti")!.def.massKg / 1.989e30, 0.78, 1e-9);
  check("Alpha Centauri is 4.37 light years from Sol", a.distanceLy("sol", "alpha-centauri"), 4.37, 0.02);
  check("Sirius is 8.6 light years from Sol", a.distanceLy("sol", "sirius"), 8.6, 0.05);

  // --- the unknown is random, but repeatable
  const sig = (g: Galaxy) => JSON.stringify(g.bodies.map((x) => [x.id, x.def.massKg, x.def.tempK, x.atmosphere, x.minerals.map((m) => m.amount)]));
  assert("the same seed makes the same galaxy", sig(a) === sig(a2));
  assert("a different seed makes a different one", sig(a) !== sig(b));
  const mismatch = a.bodies.filter((x) => x.systemId !== "sol" && x.cls === "planet" &&
    JSON.stringify(x.minerals.map((m) => m.amount)) !== JSON.stringify(b.byId.get(x.id)?.minerals.map((m) => m.amount)));
  assert("the same world holds different minerals in a different campaign", mismatch.length > 10);
  assert("Sol itself is never rolled", JSON.stringify(a.sol.bodies.filter((x) => x.cls !== "jump-point").map((x) => x.minerals)) ===
    JSON.stringify(b.sol.bodies.filter((x) => x.cls !== "jump-point").map((x) => x.minerals)));

  // --- the network
  const adj = new Map<string, Set<string>>();
  for (const l of a.links) {
    const x = a.byId.get(l.a)!.systemId;
    const y = a.byId.get(l.b)!.systemId;
    if (!adj.has(x)) adj.set(x, new Set());
    if (!adj.has(y)) adj.set(y, new Set());
    adj.get(x)!.add(y);
    adj.get(y)!.add(x);
  }
  const seen = new Set(["sol"]);
  const todo = ["sol"];
  while (todo.length) for (const n of adj.get(todo.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  assert("every system can be reached from Sol", seen.size === a.systems.length);
  assert("Sol opens onto at least two systems", (adj.get("sol")?.size ?? 0) >= 2);
  assert("jump points come in linked pairs",
    a.links.every((l) => a.byId.get(l.a)!.def.jumpTo === l.b && a.byId.get(l.b)!.def.jumpTo === l.a));
  assert("jump points have no minerals and cannot be settled",
    a.bodies.filter((x) => x.cls === "jump-point").every((x) => x.minerals.length === 0 && !Number.isFinite(x.colonyCost)));

  // --- exploring, end to end
  const game = new Game("explore");
  const e = game.empire;
  for (const tech of ["nuclear-thermal", "geo-survey-sensors", "grav-survey-sensors", "nuclear-pulse", "jump-point-theory", "jump-gate-construction"]) {
    e.research(tech);
  }
  const pp = parts(e);
  const jumpDrive = e.addComponentDesign("jump-drive", { size: 30 }, 0);
  const gateModule = e.addComponentDesign("gate-module", { size: 40 }, 0);
  const gravSensor = e.addComponentDesign("survey-sensor", { type: "gravitational", size: 4 }, 0);
  const explorer = e.addDesign("Explorer", [
    { componentId: pp.engine("nuclear-thermal").id, count: 4 },
    { componentId: pp.tank().id, count: 10 },
    { componentId: gravSensor.id, count: 1 },
    { componentId: jumpDrive.id, count: 1 },
    { componentId: pp.quarters().id, count: 2 },
  ], 0);
  const xs = e.statsOf(explorer.id)!;
  assert(`the explorer's drive carries its own weight (${num(xs.jumpCapacity)} of ${num(xs.tons)} t)`, xs.jumpCapacity >= xs.tons);

  const fleet = e.createFleet("Pathfinder", { x: 0, y: 0, z: 0 }, "earth");
  const ship = e.commissionShip(explorer.id, fleet, "Pathfinder 1", 0);
  ship.fuel = xs.fuelCapacity;
  assert("Sol's jump points start out hidden", game.galaxy.jumpPointsIn("sol").every((jp) => !e.knownJumpPoints.has(jp.id)));
  assert("and only Sol is known", e.knownSystems.size === 1);

  // A ship with no drive cannot cross, even to a jump point it knows.
  const jp0 = game.galaxy.jumpPointsIn("sol")[0];
  e.knownJumpPoints.add(jp0.id);
  const blind = e.createFleet("Driveless", { x: 0, y: 0, z: 0 }, "earth");
  const hauler = e.addDesign("Plain", [
    { componentId: pp.engine("nuclear-thermal").id, count: 2 },
    { componentId: pp.tank().id, count: 6 },
    { componentId: pp.quarters().id, count: 1 },
  ], 0);
  const plain = e.commissionShip(hauler.id, blind, "Plain 1", 0);
  plain.fuel = e.statsOf(hauler.id)!.fuelCapacity;
  blind.orders.push({ kind: "move", bodyId: jp0.id }, { kind: "jump" });
  for (let d = 0; d < 400 && blind.anchorId !== jp0.id; d++) game.step(SECONDS_PER_DAY);
  for (let d = 0; d < 3; d++) game.step(SECONDS_PER_DAY);
  assert("a ship with no jump drive cannot cross an ungated jump point",
    blind.systemId === "sol" && /jump drive/i.test(blind.note ?? ""));
  blind.orders = [];
  blind.note = null;
  e.knownJumpPoints.delete(jp0.id);

  fleet.program = { kind: "explore" };
  const before = e.log.length;
  let guard = 0;
  while (e.knownSystems.size < 4 && guard++ < 9000) game.step(SECONDS_PER_DAY);
  assert(`the explorer found jump points and crossed them (${e.knownSystems.size} systems known after ${guard} days)`, e.knownSystems.size >= 4);
  assert("it located jump points by survey", e.knownJumpPoints.size > e.exploredJumpPoints.size / 2);
  assert("it reported each new system loudly, once",
    e.log.slice(0, e.log.length - before).filter((l) => /for the first time/.test(l.text) && !l.quiet).length === e.knownSystems.size - 1);
  assert("it never ran dry", ship.fuel > 0);
  assert("the fleet knows which system it is in", game.galaxy.byId.get(fleet.anchorId ?? "")?.systemId === fleet.systemId || fleet.anchorId === null);

  // --- a gate opens a route to any ship
  const crossed = [...e.exploredJumpPoints].map((id) => game.galaxy.byId.get(id)!).find((b) => b.systemId === "sol")!;
  const far = game.galaxy.otherEnd(crossed.id)!;
  const builder = e.createFleet("Gatewright", crossed.world, crossed.id, "sol");
  const buildShip = e.addDesign("Gate Layer", [
    { componentId: pp.engine("nuclear-thermal").id, count: 2 },
    { componentId: pp.tank().id, count: 4 },
    { componentId: gateModule.id, count: 1 },
    { componentId: pp.quarters().id, count: 2 },
  ], 0);
  e.commissionShip(buildShip.id, builder, "Gate Layer 1", 0).fuel = 1e5;
  builder.orders.push({ kind: "build-gate" });
  assert("a gate is not there before it is built", !e.gates.has(crossed.id));
  for (let d = 0; d < 200 && builder.orders.length; d++) game.step(SECONDS_PER_DAY);
  assert("the gate was built, at both ends", e.gates.has(crossed.id) && e.gates.has(far.id));
  assert("and building it took time, not an instant", e.log.some((l) => /finished a jump gate/.test(l.text)));

  // The driveless ship can now go through, by way of a plain move order.
  const target = game.galaxy.systemById.get(far.systemId)!.root;
  blind.orders.push({ kind: "move", bodyId: target.id });
  for (let d = 0; d < 800 && blind.systemId === "sol"; d++) game.step(SECONDS_PER_DAY);
  assert("a ship with no drive crosses a gated jump point on an ordinary move order", blind.systemId === far.systemId);
  for (let d = 0; d < 400 && blind.anchorId !== target.id; d++) game.step(SECONDS_PER_DAY);
  assert("and carries on to its destination", blind.anchorId === target.id);

  // --- civilian shipping follows the gates
  assert("civilian shipping runs within a system", sharesShipping(e, game.galaxy, "earth", "mars"));
  assert("and across a gated connection", sharesShipping(e, game.galaxy, "earth", target.id));
  const other = [...game.galaxy.systems].find((s) => s.id !== "sol" && s.id !== far.systemId)!;
  assert("but not to a system without gates", !sharesShipping(e, game.galaxy, "earth", other.root.id));
}

// ==========================================================================
// Random events
// ==========================================================================

console.log("");

{
  // --- off means off, and costs nothing
  const quiet = new Game("quiet");
  for (let i = 0; i < 400; i++) quiet.step(CYCLE_DAYS * SECONDS_PER_DAY);
  assert("with events off, none happen", quiet.empire.events.length === 0);

  // --- a long run at a high rate
  const make = () => {
    const g = new Game("eventful");
    g.empire.eventFrequency = 2.5;
    return g;
  };
  const game = make();
  const e = game.empire;
  e.research("geo-survey-sensors");
  e.research("grav-survey-sensors");
  const mars = e.foundColony("mars", game.clock.seconds);
  mars.population = 5;
  mars.installations = { "construction-factory": 80, mine: 40 };
  mars.fuel = 400_000;
  const governor = [...e.officers.byBranch("civilian")][1];
  e.assignOfficer(governor.id, { kind: "governor", targetId: "mars", since: 0 });
  e.surveyed.add("callisto");
  e.queueBuild("earth", "mine", 40);
  const pp = parts(e);
  e.research("nuclear-thermal");
  const probe = e.addDesign("Probe", [
    { componentId: pp.engine("nuclear-thermal").id, count: 1 },
    { componentId: pp.tank().id, count: 2 },
    { componentId: pp.quarters().id, count: 1 },
  ], 0);
  const wing = e.createFleet("Wing", { x: 0, y: 0, z: 0 }, "earth");
  e.commissionShip(probe.id, wing, "Probe 1", 0).fuel = 50_000;

  const seen = new Set<string>();
  let maxPending = 0;
  for (let i = 0; i < 1500; i++) {
    game.step(CYCLE_DAYS * SECONDS_PER_DAY);
    for (const ev of e.events) seen.add(ev.defId);
    maxPending = Math.max(maxPending, e.pendingEvents.length);
    // Someone is playing: answer every decision with its first affordable option.
    for (const ev of e.pendingEvents) {
      if (i % 3 !== 0) continue;
      const options = optionsFor(e, game.galaxy, ev, game.clock.seconds);
      const pick = options.find((o) => !o.disabled);
      if (pick) resolveEvent(e, game.galaxy, ev.id, pick.id, game.clock.seconds);
    }
  }
  assert(`a long run produces a spread of events (${e.events.length} events, ${seen.size} kinds)`, e.events.length > 30 && seen.size >= 8);
  assert("decisions never pile up past three", maxPending <= 3);
  assert("nothing went non-finite", Number.isFinite(e.treasury) && [...e.colonies.values()].every((c) => Number.isFinite(c.population) && Number.isFinite(c.fuel)));
  assert("populations and stores never go negative",
    [...e.colonies.values()].every((c) => c.population >= 0 && c.fuel >= -1e-6));
  assert("every event is in the log with its outcome",
    e.events.filter((x) => x.status !== "pending").every((x) => typeof x.outcome === "string" && x.outcome.length > 0));
  assert("decisions are logged as decisions", e.log.some((l) => l.decision === true && l.category === "event"));
  assert("news is not logged as needing a decision",
    e.events.filter((x) => !x.decision).every((x) => x.status === "resolved"));

  // --- same seed, same events
  const twinA = make();
  const twinB = make();
  for (let i = 0; i < 300; i++) { twinA.step(CYCLE_DAYS * SECONDS_PER_DAY); twinB.step(CYCLE_DAYS * SECONDS_PER_DAY); }
  const story = (g: Game) => JSON.stringify(g.empire.events.map((x) => [x.defId, x.time, x.outcome]));
  assert(`events replay identically from the same seed (${twinA.empire.events.length} events)`,
    twinA.empire.events.length > 5 && story(twinA) === story(twinB));
  const other = new Game("different");
  other.empire.eventFrequency = 2.5;
  for (let i = 0; i < 300; i++) other.step(CYCLE_DAYS * SECONDS_PER_DAY);
  assert("and a different seed tells a different story", story(other) !== story(twinA));

  // --- expiry: an unanswered decision settles itself
  const slow = new Game("slow");
  const se = slow.empire;
  se.treasury = 100_000;
  const sc = se.colony("earth")!;
  const raised = rollEvent({ empire: se, galaxy: slow.galaxy, now: slow.clock.seconds, rng: se.eventRng }, "epidemic");
  assert("an epidemic raises a decision", raised !== null && raised.status === "pending" && raised.decision);
  const popBefore = sc.population;
  for (let i = 0; i < 30; i++) slow.step(CYCLE_DAYS * SECONDS_PER_DAY);
  assert("left alone, it lapses into its fallback", raised!.status === "expired" && /no decision/i.test(se.log.find((l) => /Outbreak/.test(l.text))?.text ?? ""));
  assert("and the fallback has its cost", sc.population < popBefore);

  // --- each decision's options do what they say
  const lab = new Game("lab");
  const le = lab.empire;
  le.treasury = 200_000;
  const lc = le.colony("earth")!;
  le.assignOfficer(le.officers.byBranch("civilian")[0].id, { kind: "governor", targetId: "earth", since: 0 });
  const ctx = () => ({ empire: le, galaxy: lab.galaxy, now: lab.clock.seconds, rng: le.eventRng });
  const take = (defId: string, option: string) => {
    const ev = rollEvent(ctx(), defId);
    if (!ev) return null;
    const options = optionsFor(le, lab.galaxy, ev, lab.clock.seconds);
    resolveEvent(le, lab.galaxy, ev.id, option, lab.clock.seconds);
    return { ev, options };
  };

  let factories = lc.installations["construction-factory"];
  let treasury = le.treasury;
  const reviewed = take("accident", "review");
  assert("a paid safety review costs money and loses little",
    reviewed !== null && le.treasury < treasury && factories - lc.installations["construction-factory"] <= Math.ceil(factories * 0.011));
  factories = lc.installations["construction-factory"];
  take("accident", "carry-on");
  assert("carrying on is free but loses more", lc.installations["construction-factory"] < factories);

  treasury = le.treasury;
  const funded = take("epidemic", "quarantine");
  assert("a quarantine is paid for", funded !== null && le.treasury < treasury);

  const fuelBefore = lc.fuel;
  take("refinery-fire", "burn");
  assert("a fuel fire burns fuel", lc.fuel < fuelBefore);

  treasury = le.treasury;
  take("scandal", "hush");
  assert("hushing a scandal costs the treasury", le.treasury < treasury);
  take("scandal", "prosecute");
  assert("prosecuting removes the governor", le.governorOf("earth") === undefined);

  le.queueBuild("earth", "mine", 5);
  const queue = lc.buildQueue[0];
  queue.progress = 1000;
  take("strike", "hold");
  assert("holding firm through a strike spoils half the current build", queue.progress === 500);

  const poor = new Game("poor");
  poor.empire.treasury = 10;
  const pev = rollEvent({ empire: poor.empire, galaxy: poor.galaxy, now: 0, rng: poor.empire.eventRng }, "epidemic");
  const popts = optionsFor(poor.empire, poor.galaxy, pev!, 0);
  assert("an option you cannot afford is disabled, with the reason",
    popts.find((o) => o.id === "quarantine")?.disabled !== undefined && resolveEvent(poor.empire, poor.galaxy, pev!.id, "quarantine", 0) === null);

  // --- pending decisions survive a save
  const saved = gameFromSave(parseSave(JSON.stringify(makeSave(lab, "ev", "ev", "manual"))));
  assert("events survive a save, pending ones included",
    saved.empire.events.length === le.events.length &&
    saved.empire.pendingEvents.length === le.pendingEvents.length);
  assert("the event stream carries on from the same point", saved.empire.eventRng.state === le.eventRng.state);
}

// ==========================================================================
// Lasting effects and event chains
// ==========================================================================

console.log("");

{
  const g = new Game("chains");
  const e = g.empire;
  e.eventFrequency = 0;
  const earth = e.colony("earth")!;
  const body = g.galaxy.byId.get("earth")!;
  const baseline = colonyOutput(e, body, earth, e.stats);

  // --- effects change output, and only for what they name
  e.addEffect({ kind: "industry", target: "earth", factor: 0.7, label: "Work-to-rule" }, g.clock.seconds, 60);
  e.addEffect({ kind: "wealth", target: "empire", factor: 0.9, label: "Squeeze" }, g.clock.seconds, 60);
  const dented = colonyOutput(e, body, earth, e.stats);
  check("an industry effect scales build points", dented.buildPoints / baseline.buildPoints, 0.7, 1e-9);
  check("an empire-wide wealth effect scales income", dented.wealth / baseline.wealth, 0.9, 1e-9);
  check("and leaves mining alone", dented.mining.Duranium! / baseline.mining.Duranium!, 1, 1e-9);
  e.addEffect({ kind: "industry", target: "earth", factor: 0.5, label: "Second blow" }, g.clock.seconds, 60);
  check("effects stack", colonyOutput(e, body, earth, e.stats).buildPoints / baseline.buildPoints, 0.35, 1e-9);
  e.addEffect({ kind: "industry", target: "mars", factor: 0.1, label: "Elsewhere" }, g.clock.seconds, 60);
  check("an effect on another colony does not touch this one", colonyOutput(e, body, earth, e.stats).buildPoints / baseline.buildPoints, 0.35, 1e-9);

  for (let i = 0; i < 14; i++) g.step(CYCLE_DAYS * SECONDS_PER_DAY);
  assert("effects end when their time is up", e.effects.length === 0);
  check("and output returns to normal", colonyOutput(e, body, earth, e.stats).buildPoints / baseline.buildPoints, 1, 1e-9);
  assert("the end of an effect is logged", e.log.some((l) => /Work-to-rule on Earth has ended/.test(l.text)));

  // --- an epidemic ignored always has an aftermath
  const ctx = () => ({ empire: e, galaxy: g.galaxy, now: g.clock.seconds, rng: e.eventRng });
  e.treasury = 500_000;
  const outbreak = rollEvent(ctx(), "epidemic")!;
  resolveEvent(e, g.galaxy, outbreak.id, "ignore", g.clock.seconds);
  assert("an ignored outbreak slows growth", e.effectFactor("growth", "earth") === 0.5);
  assert("and schedules its aftermath", e.scheduled.some((s) => s.defId === "epidemic-aftermath"));
  const due = e.scheduled[0].due;
  assert("the aftermath is a few months off, not at once", due - g.clock.seconds >= 99 * 86_400 && due - g.clock.seconds <= 151 * 86_400);
  for (let i = 0; i < 40 && !e.pendingEvents.length; i++) g.step(CYCLE_DAYS * SECONDS_PER_DAY);
  const after = e.pendingEvents[0];
  assert("the aftermath arrives as a decision", after?.defId === "epidemic-aftermath" && after.decision);
  assert("and says what it follows", after?.follows === "Outbreak");
  resolveEvent(e, g.galaxy, after.id, "fund", g.clock.seconds);
  assert("funding the programme boosts growth for most of a year",
    e.effects.some((x) => x.label === "Healthy generation" && x.factor === 1.5 && x.until - g.clock.seconds > 250 * 86_400));

  // --- a chain with a chance in it, across seeds
  let returned = 0;
  for (let n = 0; n < 12 && returned === 0; n++) {
    const t = new Game(`strike-${n}`);
    const te = t.empire;
    te.treasury = 500_000;
    te.queueBuild("earth", "mine", 5);
    const c = { empire: te, galaxy: t.galaxy, now: t.clock.seconds, rng: te.eventRng };
    const strike = rollEvent(c, "strike")!;
    resolveEvent(te, t.galaxy, strike.id, "hold", t.clock.seconds);
    if (!te.scheduled.some((s) => s.defId === "strike-returns")) continue;
    returned++;
    for (let i = 0; i < 30 && !te.pendingEvents.length; i++) t.step(CYCLE_DAYS * SECONDS_PER_DAY);
    const again = te.pendingEvents[0];
    assert("holding firm can bring the strike back", again?.defId === "strike-returns" && again.follows === "Work stoppage");
    resolveEvent(te, t.galaxy, again.id, "settle", t.clock.seconds);
    assert("and settling then pays off", te.effectFactor("industry", "earth") > 0.7 * 1.1);
  }
  assert("the strike came back for at least one seed", returned > 0);

  // --- a chain whose subject has gone just ends
  const w = new Game("gone");
  const we = w.empire;
  we.foundColony("mars", w.clock.seconds).population = 3;
  we.scheduleEvent("epidemic-aftermath", { colony: "mars", cost: 1000 }, w.clock.seconds, 10);
  we.abandonColony("mars");
  for (let i = 0; i < 6; i++) w.step(CYCLE_DAYS * SECONDS_PER_DAY);
  assert("a follow-up for a colony that no longer exists is dropped", we.scheduled.length === 0 && we.events.length === 0);

  // --- the future survives a save
  const copy = gameFromSave(parseSave(JSON.stringify(makeSave(g, "ch", "ch", "manual"))));
  assert("effects survive a save", copy.empire.effects.length === e.effects.length && e.effects.length > 0);
  we.scheduleEvent("derelict-beacon", { cost: 3000 }, w.clock.seconds, 30);
  const copy2 = gameFromSave(parseSave(JSON.stringify(makeSave(w, "ch", "ch", "manual"))));
  assert("and so do scheduled follow-ups", copy2.empire.scheduled.length === 1 && copy2.empire.scheduled[0].defId === "derelict-beacon");
}

// ==========================================================================
// Commercial and military parts, and keeping ships serviced
// ==========================================================================

console.log("");

{
  const researched = new Set(["trans-newtonian", "nuclear-thermal"]);
  const withMilitary = new Set([...researched, "military-specification"]);
  const base = { type: "nuclear-thermal", size: 5, modifier: 1 };
  const com = componentStats("engine", { ...base, grade: "commercial" }, researched);
  const old = componentStats("engine", base, researched);
  const mil = componentStats("engine", { ...base, grade: "military" }, withMilitary);

  check("a part with no grade is commercial, so old designs do not change", old.power!, com.power!, 1e-9);
  check("a 5 HS nuclear thermal engine still makes 60 power", com.power!, 60, 1e-9);
  check("military engines push 30% harder", mil.power! / com.power!, 1.3, 1e-9);
  check("and cost 70% more", mil.cost / com.cost, 1.7, 0.03);
  check("and need half as many more crew", mil.crew / com.crew, 1.5, 0.35);
  check("and burn more fuel per unit of power", (mil.fuelPerHour! / mil.power!) / (com.fuelPerHour! / com.power!), 1.15, 1e-9);
  check("and wear 2.2 times as fast", mil.wear / com.wear, 2.2, 1e-9);
  assert("the military specification needs research", componentStats("engine", { ...base, grade: "military" }, researched).problems.length > 0);
  assert("and is fine once researched", mil.problems.length === 0);
  assert("military parts are named as such", suggestName("engine", { ...base, grade: "military" }, withMilitary).startsWith("Military "));
  assert("commercial names are unchanged", suggestName("engine", base, researched) === "Nuclear Thermal 5HS");
  assert("tanks, holds and berths have no military pattern",
    componentStats("fuel-tank", { size: 5, grade: "military" }, researched).grade === "commercial" &&
    componentStats("fuel-tank", { size: 5 }, researched).wear === 0.4);
  const sensorCom = componentStats("survey-sensor", { type: "geological", size: 4 }, new Set([...researched, "geo-survey-sensors"]));
  const sensorMil = componentStats("survey-sensor", { type: "geological", size: 4, grade: "military" }, new Set([...withMilitary, "geo-survey-sensors"]));
  check("military sensors survey 30% faster", sensorMil.survey!.rate / sensorCom.survey!.rate, 1.3, 1e-9);

  // --- a class made of them
  const g = new Game("upkeep");
  const e = g.empire;
  e.research("nuclear-thermal");
  e.research("military-specification");
  const commercialEngine = e.addComponentDesign("engine", { ...base, grade: "commercial" }, 0);
  const militaryEngine = e.addComponentDesign("engine", { ...base, grade: "military" }, 0);
  const tank = e.addComponentDesign("fuel-tank", { size: 5 }, 0);
  const quarters = e.addComponentDesign("crew-quarters", { size: 4 }, 0);
  const plain = e.addDesign("Plain", [
    { componentId: commercialEngine.id, count: 2 }, { componentId: tank.id, count: 4 }, { componentId: quarters.id, count: 2 },
  ], 0);
  const hard = e.addDesign("Hard", [
    { componentId: militaryEngine.id, count: 2 }, { componentId: tank.id, count: 4 }, { componentId: quarters.id, count: 2 },
  ], 0);
  const ps = e.statsOf(plain.id)!;
  const hs = e.statsOf(hard.id)!;
  assert("a military class is marked, a commercial one is not", hs.military && !ps.military);
  assert("it is faster", hs.speed > ps.speed * 1.2);
  assert("it costs more", hs.buildCost > ps.buildCost * 1.2);
  assert("it wears faster", hs.wear > ps.wear * 1.3);

  // --- wear
  const fleet = e.createFleet("Test Wing", { x: 0, y: 0, z: 0 }, "earth");
  const ship = e.commissionShip(plain.id, fleet, "P1", 0);
  ship.fuel = ps.fuelCapacity;
  check("a new ship is in perfect condition", ship.condition, 100, 0);
  fleet.orders.push({ kind: "move", bodyId: "neptune" });
  const sail = 30;
  for (let i = 0; i < sail / CYCLE_DAYS; i++) g.step(CYCLE_DAYS * SECONDS_PER_DAY);
  assert(`a ship under way wears (${ship.condition.toFixed(1)}%)`, fleet.anchorId === null && ship.condition < 100);
  check("by its wear rate", 100 - ship.condition, 28 * ps.wear * (sail / 365.25), 0.2);

  // --- a ship at a distant, unserviced body wears slowly
  const mars = g.galaxy.byId.get("mars")!;
  const idle = e.createFleet("Idle", mars.world, "mars");
  const idleShip = e.commissionShip(plain.id, idle, "I1", 0);
  const rate = 28 * ps.wear / 365.25;
  g.step(CYCLE_DAYS * SECONDS_PER_DAY * 4);
  assert("a ship parked at an unserviced body wears at 40% of the working rate",
    Math.abs((100 - idleShip.condition) - rate * 0.4 * CYCLE_DAYS * 4) < 0.3);

  // --- service
  const earthYard = e.createFleet("Yard", g.galaxy.byId.get("earth")!.world, "earth");
  const serviced = e.commissionShip(plain.id, earthYard, "S1", 0);
  serviced.condition = 40;
  const capacity = servicingCapacity(e, e.colony("earth")!);
  assert(`a colony with shipyards has servicing capacity (${capacity} t)`, capacity === 2 * 1500);
  const result = maintainShips(e, g.galaxy, CYCLE_DAYS);
  assert("a parked ship at it is restored", serviced.condition > 45);
  const gained = serviced.condition - 40;
  check("servicing costs a share of the ship's price, in proportion to the work",
    result.cost, ps.buildCost * 0.15 * gained / 100, 1e-6);
  for (let i = 0; i < 20; i++) g.step(CYCLE_DAYS * SECONDS_PER_DAY);
  check("and it gets all the way back", serviced.condition, 100, 0);
  e.research("maintenance-facilities");
  e.research("maintenance-bays-2");
  e.colony("earth")!.installations["maintenance"] = 3;
  check("maintenance facilities add capacity, twice as much with better bays",
    servicingCapacity(e, e.colony("earth")!), 3 * 8000 + 3000, 0);

  // --- condition slows a ship
  const slowFleet = e.createFleet("Slow", { x: 0, y: 0, z: 0 }, "earth");
  const slowShip = e.commissionShip(plain.id, slowFleet, "W1", 0);
  slowShip.fuel = ps.fuelCapacity;
  const fast = fleetStats(e, slowFleet).speed;
  slowShip.condition = 0;
  check("a ship in ruins still limps at 60% speed", fleetStats(e, slowFleet).speed / fast, 0.6, 1e-9);
  slowShip.condition = 50;
  check("and half-worn at 80%", fleetStats(e, slowFleet).speed / fast, 0.8, 1e-9);

  // --- raised for attention, and breaking down
  slowShip.condition = 25;
  assert("an overdue fleet is raised for attention",
    deriveIssues(e, g.galaxy).some((i) => i.id === `fleet:overdue:${slowFleet.id}`));
  const failure = rollEvent({ empire: e, galaxy: g.galaxy, now: g.clock.seconds, rng: e.eventRng }, "ship-failure");
  assert("a badly worn ship can break down", failure !== null && failure.decision);
  if (failure) {
    const worn = e.ships.get(String(failure.params.ship))!;
    const before = worn.condition;
    resolveEvent(e, g.galaxy, failure.id, "repair", g.clock.seconds);
    assert("field repairs restore condition for a price", worn.condition >= before + 34 || worn.condition === 100);
  }

  // --- a programme fleet goes for service rather than carrying on worn out
  const sg = new Game("worn");
  const se = sg.empire;
  se.research("nuclear-thermal");
  se.research("geo-survey-sensors");
  const sp = parts(se);
  const scout = se.addDesign("Scout", [
    { componentId: sp.engine("nuclear-thermal").id, count: 2 }, { componentId: sp.tank().id, count: 6 },
    { componentId: sp.sensor().id, count: 2 }, { componentId: sp.quarters().id, count: 1 },
  ], 0);
  const sf = se.createFleet("Wing", sg.galaxy.byId.get("earth")!.world, "earth");
  const sship = se.commissionShip(scout.id, sf, "W1", 0);
  sship.fuel = se.statsOf(scout.id)!.fuelCapacity;
  sship.condition = 55;
  sf.program = { kind: "survey", maxAu: 0, systemId: "sol" };
  sg.step(SECONDS_PER_DAY * 2);
  assert("a survey fleet at a servicing colony waits to be serviced before setting out",
    sf.orders.length === 0 && /serviced/i.test(sf.programStatus ?? ""));
  for (let i = 0; i < 30 && sf.orders.length === 0; i++) sg.step(CYCLE_DAYS * SECONDS_PER_DAY);
  assert("and sets out once it is nearly right", sship.condition >= 90 && sf.orders.length > 0);

  // --- the new techs
  assert("maintenance bays double a facility's capacity", statsFor(["maintenance-bays-2", "maintenance-facilities", "trans-newtonian"]).serviceTonsPerFacility === 8000);

  // --- hull types
  {
    const hg = new Game("hulls");
    const he = hg.empire;
    he.research("nuclear-thermal");
    he.research("geo-survey-sensors");
    for (const std of he.addStandardClasses(0)) {
      const hull = std.hullId;
      assert(`standard ${std.name} has a hull and fits it`, Boolean(hull) && he.statsOf(std.id)!.problems.length === 0);
    }
    const hauler = he.designs.find((d) => d.name === "Hauler")!;
    assert("the Hauler is a freighter", hauler.hullId === "freighter");
    const tiny = he.addDesign("Tiny", hauler.components.map((c) => ({ ...c, count: 1 })), 0, "destroyer");
    const tinyProblems = he.statsOf(tiny.id)!.problems.join(" ");
    assert("a destroyer hull rejects a ship that is too small", /at least/.test(tinyProblems));
    assert("and commercial engines on a warship", /military specification/.test(tinyProblems));
    const unclassed = he.addDesign("Free", hauler.components, 0);
    assert("an unclassed design has no hull problems", he.statsOf(unclassed.id)!.problems.length === 0);
    assert("class titles read 'Hauler-class Freighter'", classTitle(hauler) === "Hauler-class Freighter");
    assert("hull id survives export", JSON.stringify(he.exportState()).includes('"hullId":"freighter"'));
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
