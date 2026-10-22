/**
 * Scale benchmark.
 *
 * The question this answers is "where does the time actually go, and how far
 * is the current implementation from a frame budget", so that a decision
 * about rewriting in another language is made on numbers rather than nerves.
 *
 * Run with `npm run bench`.
 */

import { Game } from "../src/state/game";
import { CYCLE_DAYS, runCycle } from "../src/sim/economy/production";
import { updateFleets } from "../src/sim/ships/fleet";
import { designStats } from "../src/sim/ships/design";
import { deriveIssues } from "../src/sim/issues";
import { mineralLedger } from "../src/sim/economy/ledger";
import { SECONDS_PER_DAY } from "../src/sim/orbit";
import { positionAt } from "../src/sim/orbit";
import { DAYS_PER_YEAR } from "../src/sim/orbit";

declare const process: { exit(code: number): never; argv: string[] };

const results: { name: string; ms: number; per: string }[] = [];

function bench(name: string, iterations: number, unit: string, fn: () => void): number {
  fn(); // warm up
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = (performance.now() - start) / iterations;
  results.push({ name, ms, per: unit });
  return ms;
}

// --------------------------------------------------------------- fixtures

const game = new Game("bench");
const empire = game.empire;

// Colonise everything that can be colonised, and give each a busy queue.
for (const body of game.system.bodies) {
  if (body.cls === "star" || !Number.isFinite(body.colonyCost)) continue;
  if (!empire.colonies.has(body.id)) {
    const colony = empire.foundColony(body.id, game.clock.seconds);
    colony.population = 2;
    colony.installations = {
      "construction-factory": 40,
      mine: 20,
      "automated-mine": 30,
      infrastructure: 500,
    };
    for (const mineral of Object.keys(colony.stockpile)) {
      colony.stockpile[mineral as keyof typeof colony.stockpile] = 50_000;
    }
  }
  empire.surveyed.add(body.id);
  empire.queueBuild(body.id, "automated-mine", 50);
  empire.queueBuild(body.id, "infrastructure", 200);
  empire.queueBuild(body.id, "mine", 25);
}
const colonyCount = empire.colonies.size;

// A navy at a scale the current game cannot reach but a later one will.
empire.research("nuclear-thermal");
const design = empire.addDesign("Bench Hauler", [
  { componentId: "engine-nuclear-thermal", count: 2 },
  { componentId: "fuel-tank", count: 4 },
  { componentId: "cargo-hold", count: 4 },
  { componentId: "crew-quarters", count: 2 },
], 0);
const stats = designStats(design, empire.researched, empire.stats);

const FLEETS = Number(process.argv[2] ?? 1000);
const SHIPS_PER_FLEET = 5;
const bodies = game.system.bodies.filter((b) => b.cls !== "star");
for (let i = 0; i < FLEETS; i++) {
  const home = bodies[i % bodies.length];
  const fleet = empire.createFleet(`Task Group ${i}`, home.world, home.id);
  for (let s = 0; s < SHIPS_PER_FLEET; s++) {
    const ship = empire.commissionShip(design.id, fleet, `Hull ${i}-${s}`, 0);
    ship.fuel = stats.fuelCapacity;
  }
  // Half the navy is under way at any moment.
  if (i % 2 === 0) {
    fleet.orders.push({ kind: "move", bodyId: bodies[(i * 7) % bodies.length].id });
  }
}

console.log(
  `Fixture: ${colonyCount} colonies, ${empire.fleets.size} fleets, ` +
    `${empire.ships.size} ships, ${game.system.bodies.length} bodies, ` +
    `${game.system.motes.length} belt objects\n`,
);

// ------------------------------------------------------------ measurements

let t = game.clock.days;
bench("system.update (bodies + belt objects)", 200, "call", () => {
  t += 0.01;
  game.system.update(t);
});

bench("updateFleets (one frame at 1 day/s)", 200, "call", () => {
  updateFleets(empire, game.system, SECONDS_PER_DAY / 60);
});

bench("runCycle (one five-day production cycle)", 50, "call", () => {
  runCycle(empire, game.system, game.clock.seconds, CYCLE_DAYS);
});

bench("mineralLedger (empire-wide)", 100, "call", () => {
  mineralLedger(empire, game.system);
});

bench("deriveIssues (attention list)", 50, "call", () => {
  deriveIssues(empire, game.system);
});

bench("designStats (single class)", 20_000, "call", () => {
  designStats(design, empire.researched, empire.stats);
});

// Raw Kepler throughput, for comparison with anything that might replace it.
const orbit = game.system.byId.get("mars")!.def.orbit!;
const KEPLER_BATCH = 100_000;
const keplerMs = bench(`Kepler solve x${KEPLER_BATCH.toLocaleString()}`, 5, "batch", () => {
  for (let i = 0; i < KEPLER_BATCH; i++) positionAt(orbit, i * 0.01);
});

// ----------------------------------------------------------------- report

const width = Math.max(...results.map((r) => r.name.length));
console.log("Measurement".padEnd(width), "       ms", "   per second");
for (const result of results) {
  const perSecond = result.ms > 0 ? 1000 / result.ms : Infinity;
  console.log(
    result.name.padEnd(width),
    result.ms.toFixed(4).padStart(9),
    perSecond > 1e6
      ? `${(perSecond / 1e6).toFixed(1)}M`.padStart(12)
      : Math.round(perSecond).toLocaleString().padStart(12),
  );
}

const frame = results
  .filter((r) => r.name.startsWith("system.update") || r.name.startsWith("updateFleets"))
  .reduce((sum, r) => sum + r.ms, 0);
console.log(`\nPer-frame simulation cost: ${frame.toFixed(3)} ms of a 16.7 ms budget (${
  ((frame / 16.7) * 100).toFixed(1)
}%).`);
console.log(
  `Kepler throughput: ${Math.round((KEPLER_BATCH / keplerMs) * 1000).toLocaleString()} solves/second.`,
);
console.log(
  `A year of game time at 30 days/s is ${Math.round(DAYS_PER_YEAR / CYCLE_DAYS)} production cycles: ${
    ((results.find((r) => r.name.startsWith("runCycle"))?.ms ?? 0) * (DAYS_PER_YEAR / CYCLE_DAYS)).toFixed(1)
  } ms.`,
);

process.exit(0);
