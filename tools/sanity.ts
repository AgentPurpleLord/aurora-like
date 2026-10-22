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
import { designStats } from "../src/sim/ships/design";
import { cargoTons, distanceToBody, executeArrivalOrders } from "../src/sim/ships/fleet";

const num = (v: number) => Math.round(v).toLocaleString("en-US");

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

// ==========================================================================
// Economy, research and people
// ==========================================================================

console.log("");

const game = new Game("sanity");
const empire = game.empire;
const bodies = game.system;

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

// Mass drivers move Luna's output to the capital rather than stranding it.
const lunaColony = empire.colony("luna")!;
assert(
  "Luna ships its minerals to Earth",
  lunaColony.stockpile.Duranium < 500 && lunaColony.massDriverTarget === "earth",
);

// The opening research projects should complete within a decade and change
// the empire's working figures.
runYears(9);
assert("Construction Rate 12 BP researched", empire.researched.has("construction-12"));
check("construction rate after research", empire.stats.constructionRate, 12, 0);
assert("Mining Production 12 Tons researched", empire.researched.has("mining-12"));
check("mining rate after research", empire.stats.miningRate, 12, 0);

// Build queue: order automated mines on Mars and confirm they get built and
// that the minerals to build them were actually consumed.
const mars = empire.colony("mars")!;
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
assert("Mars was untouched by Earth's queue", (mars.installations["automated-mine"] ?? 0) === marsMines);

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
const ledger = mineralLedger(freshEmpire, fresh.system);
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
const output = colonyOutput(freshEmpire, fresh.system.byId.get("earth")!, freshEarth, freshEmpire.stats);
const demand = queueDemand(freshEmpire, freshEarth, output.buildPoints);
check("queue demand for Duranium (t/yr)", demand.Duranium ?? 0, Math.min(output.buildPoints, 2400) * 0.5, 1e-6);

const preview = previewOrder(freshEmpire, fresh.system, freshEarth, "research-lab", 4)!;
check("preview build points", preview.buildPoints, 3600, 1e-6);
check("preview queued ahead (BP)", preview.queuedAhead, 2400, 1e-6);
check(
  "preview completion accounts for the queue (years)",
  preview.years,
  (2400 + 3600) / output.buildPoints,
  1e-9,
);
assert("preview is affordable from Earth's stockpile", preview.affordable);

const unaffordable = previewOrder(freshEmpire, fresh.system, freshEarth, "research-lab", 400)!;
assert("preview flags an order the stockpile cannot cover", !unaffordable.affordable);
assert(
  "preview names the mineral that is short",
  unaffordable.minerals.some((m) => m.shortfall > 0),
);

// Triage: an empty queue on an industrial colony is worth saying out loud,
// and it stops being said once work is queued.
const freshLuna = freshEmpire.colony("luna")!;
freshLuna.installations["construction-factory"] = 500;
freshLuna.population = 30;
let issues = deriveIssues(freshEmpire, fresh.system);
assert(
  "idle industry is reported",
  issues.some((i) => i.id === "colony:idle-industry:luna"),
);
freshEmpire.queueBuild("luna", "automated-mine", 5);
issues = deriveIssues(freshEmpire, fresh.system);
assert(
  "idle industry stops being reported once work is queued",
  !issues.some((i) => i.id === "colony:idle-industry:luna"),
);

// A colony whose industry outruns its minerals reports a stall, at critical.
// Luna mines a few tons a cycle against 500 factories' appetite.
freshLuna.stockpile.Duranium = 0;
freshLuna.stockpile.Uridium = 0;
fresh.step(CYCLE_DAYS * SECONDS_PER_DAY);
issues = deriveIssues(freshEmpire, fresh.system);
const stall = issues.find((i) => i.id === "queue:stalled:luna:automated-mine");
assert("a stalled build queue is reported", stall !== undefined);
assert("a stalled build queue is critical", stall?.severity === "critical");
assert("the stall links to the colony that owns it", stall?.action.bodyId === "luna");

// Dismissal hides an issue without deleting the condition, and lapses.
const dismissedAt = fresh.clock.seconds;
freshEmpire.dismissIssue("queue:stalled:luna:automated-mine", dismissedAt, 2);
assert(
  "a dismissed issue leaves the active list",
  !activeIssues(freshEmpire, fresh.system, dismissedAt).some(
    (i) => i.id === "queue:stalled:luna:automated-mine",
  ),
);
assert(
  "a dismissed issue returns once the dismissal lapses",
  activeIssues(freshEmpire, fresh.system, dismissedAt + 3 * DAYS_PER_YEAR * SECONDS_PER_DAY).some(
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
  issues.every((i) => !i.action.bodyId || fresh.system.byId.has(i.action.bodyId)),
);

// ==========================================================================
// Automation: templates, standing orders and governor proposals
// ==========================================================================

console.log("");

// Scoped so these fixtures cannot collide with the campaign above.
{
  const auto = new Game("automation");
  const autoEmpire = auto.empire;
  const callistoBody = auto.system.byId.get("callisto")!;
  autoEmpire.foundColony("callisto", auto.clock.seconds);
  const callisto = autoEmpire.colony("callisto")!;

  // Templates size infrastructure against the target world rather than
  // shipping a fixed number that is wrong everywhere.
  const outpost = BUILT_IN_TEMPLATES.find((t) => t.id === "mining-outpost")!;
  const resolved = resolveTemplate(outpost, callistoBody, callisto, autoEmpire.stats);
  const callistoCost = effectiveColonyCost(callistoBody, callisto, autoEmpire.stats);
  const infra = resolved.find((i) => i.installationId === "infrastructure")!;
  check(
    "template sizes infrastructure to colony cost",
    infra.quantity,
    Math.ceil(100 * callistoCost),
    0,
  );
  assert("template includes a researched installation", resolved.some((i) => i.installationId === "mass-driver"));

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
  const earthBody = auto.system.byId.get("earth")!;
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
    deriveProposals(autoEmpire, auto.system).length === 0,
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
    !deriveProposals(autoEmpire, auto.system).some(
      (p) => p.colonyId === "callisto" && p.order.installationId === "automated-mine",
    ),
  );
  autoEmpire.surveyed.add("callisto");

  const proposals = deriveProposals(autoEmpire, auto.system);
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
  const withProposals = deriveIssues(autoEmpire, auto.system);
  const proposalIssue = withProposals.find((i) => i.id.startsWith("proposal:callisto"));
  assert("proposals appear in the attention list", proposalIssue !== undefined);
  assert("an attention proposal carries a concrete order", (proposalIssue?.proposal?.quantity ?? 0) > 0);

  // Accepting enough of them satisfies the policy and it stops proposing.
  autoEmpire.queueBuild("earth", "automated-mine", 40, "callisto");
  assert(
    "a satisfied policy stops proposing",
    !deriveProposals(autoEmpire, auto.system).some(
      (p) => p.colonyId === "callisto" && p.order.installationId === "automated-mine",
    ),
  );

  // Policy "none" is silent even with a governor posted.
  callisto.policy = "none";
  assert(
    "a governor with no policy proposes nothing",
    !deriveProposals(autoEmpire, auto.system).some((p) => p.colonyId === "callisto"),
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
  const hauler = empire.addDesign("Hauler", [
    { componentId: "engine-nuclear-thermal", count: 2 },
    { componentId: "fuel-tank", count: 4 },
    { componentId: "cargo-hold", count: 4 },
    { componentId: "crew-quarters", count: 2 },
  ], 0);
  const stats = designStats(hauler, empire.researched, empire.stats);
  check("design tonnage", stats.tons, 2 * 250 + 4 * 250 + 4 * 1000 + 2 * 100, 0);
  // Speed is engine power per hull space: 120 power, 5700 t = 114 HS.
  check("design speed (km/s)", stats.speed, (120 * 1000) / (5700 / 50), 1e-9);
  check("design fuel capacity (litres)", stats.fuelCapacity, 200_000, 0);
  check("design cargo capacity (tons)", stats.cargoCapacity, 100_000, 0);
  check("design crew required", stats.crewRequired, 2 * 3 + 4 * 2, 0);
  assert("a complete design has no problems", stats.problems.length === 0);

  const unpowered = empire.addDesign("Hulk", [{ componentId: "cargo-hold", count: 1 }], 0);
  assert(
    "a design with no engine is rejected",
    designStats(unpowered, empire.researched, empire.stats).problems.some((p) => p.includes("No engine")),
  );
  const unresearched = empire.addDesign("Dreamer", [
    { componentId: "engine-ion", count: 1 },
    { componentId: "crew-quarters", count: 1 },
  ], 0);
  assert(
    "a design using unresearched components is rejected",
    designStats(unresearched, empire.researched, empire.stats).problems.length > 0,
  );

  // --- a hull larger than the slipways never starts
  const leviathan = empire.addDesign("Leviathan", [
    { componentId: "engine-nuclear-thermal", count: 2 },
    { componentId: "cargo-hold", count: 40 },
    { componentId: "crew-quarters", count: 5 },
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
    distanceToBody(fleet, navy.system.byId.get("earth")!.world), 0, 1e-9);

  // --- movement: Earth to Mars, at the speed the design says
  const mars = navy.system.byId.get("mars")!;
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
  const marsColony = empire.colony("mars")!;
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
    { componentId: "engine-nuclear-thermal", count: 2 },
    { componentId: "fuel-tank", count: 4 },
    { componentId: "cryogenic-berths", count: 2 },
    { componentId: "crew-quarters", count: 2 },
  ], 0);
  const colonyFleet = empire.createFleet("Settlers", { x: 0, y: 0, z: 0 }, "earth");
  const colonyShip = empire.commissionShip(pioneer.id, colonyFleet, "Pioneer 001", 0);
  colonyShip.fuel = designStats(pioneer, empire.researched, empire.stats).fuelCapacity;
  const beforeEmbark = earth.population;
  colonyFleet.orders.push({ kind: "load-colonists", amount: 40_000 });
  executeArrivalOrders(empire, navy.system, colonyFleet);
  check("embarking takes the colonists off the planet (millions)",
    beforeEmbark - earth.population, 0.04, 1e-9);
  check("the colonists are aboard", colonyFleet.cargo.colonists, 40_000, 0);

  colonyFleet.orders.push({ kind: "move", bodyId: "mars" });
  for (let i = 0; i < 40 && colonyFleet.orders.length; i++) navy.step(SECONDS_PER_DAY);
  assert("the colony ship reached Mars", colonyFleet.anchorId === "mars");

  const beforeLanding = marsColony.population;
  colonyFleet.orders.push({ kind: "unload-colonists" });
  executeArrivalOrders(empire, navy.system, colonyFleet);
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
    deriveIssues(empire, navy.system).some((i) => i.id === `fleet:blocked:${fleet.id}`),
  );

  // --- survey
  const surveyor = empire.addDesign("Surveyor", [
    { componentId: "engine-nuclear-thermal", count: 1 },
    { componentId: "fuel-tank", count: 2 },
    { componentId: "geo-survey-sensor", count: 1 },
    { componentId: "crew-quarters", count: 1 },
  ], 0);
  assert("survey sensors need their own technology", !empire.researched.has("geo-survey-sensors"));
  empire.research("geo-survey-sensors");
  const surveyFleet = empire.createFleet("Survey Group", { x: 0, y: 0, z: 0 }, "earth");
  const surveyShip = empire.commissionShip(surveyor.id, surveyFleet, "Surveyor 001", 0);
  surveyShip.fuel = designStats(surveyor, empire.researched, empire.stats).fuelCapacity;
  assert("Callisto starts unsurveyed", !empire.surveyed.has("callisto"));
  surveyFleet.orders.push({ kind: "move", bodyId: "callisto" }, { kind: "survey" });
  for (let i = 0; i < 400 && surveyFleet.orders.length; i++) navy.step(SECONDS_PER_DAY);
  assert("the survey ship reached Callisto and surveyed it", empire.surveyed.has("callisto"));

  // --- with civilian shipping off, finished work waits for a ship
  empire.queueBuild("earth", "automated-mine", 1, "mars");
  for (let i = 0; i < 20 && !(earth.stored["automated-mine"] ?? 0); i++) {
    navy.step(CYCLE_DAYS * SECONDS_PER_DAY);
  }
  check("without civilian shipping, cargo is crated at the builder",
    earth.stored["automated-mine"] ?? 0, 1, 0);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
