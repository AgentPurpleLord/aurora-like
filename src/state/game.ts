/** Top-level game state: the clock, the system, the empire, and the loop. */

import { GameClock } from "../sim/clock";
import { SECONDS_PER_DAY } from "../sim/orbit";
import { StarSystem, type Body } from "../sim/system";
import { Random } from "../sim/rng";
import { CYCLE_DAYS, computeSnapshot, runCycle } from "../sim/economy/production";
import { MINERALS } from "../sim/minerals";
import { updateFleets } from "../sim/ships/fleet";
import { Empire } from "./empire";
import { emptyStockpile } from "./colony";
import { labCapacity, type Officer } from "../sim/people/officers";

export type Listener = () => void;

const CYCLE_SECONDS = CYCLE_DAYS * SECONDS_PER_DAY;
/** Cycles processed in a single frame before we let the UI breathe. */
const MAX_CYCLES_PER_FRAME = 40;

export class Game {
  readonly system = new StarSystem();
  readonly clock = new GameClock();
  readonly empire: Empire;

  selected: Body | null = null;
  /** Fleet selected on the map or in the fleets view. */
  selectedFleet: string | null = null;
  /** Keep the camera locked to the selected body as it moves. */
  follow = false;

  /** Simulation time the last production cycle was run at. */
  private lastCycle: number;
  private listeners = new Set<Listener>();

  constructor(seed: string = "sol-1") {
    this.empire = new Empire(new Random(seed));
    this.system.update(this.clock.days);
    this.lastCycle = this.clock.seconds;
    this.setUpCampaign();
    this.selected = this.system.byId.get("earth") ?? null;
  }

  /**
   * The opening position: Earth industrialised, a mining base on Luna and a
   * foothold on Mars, with trans-Newtonian theory and mass drivers in hand.
   */
  private setUpCampaign(): void {
    const now = this.clock.seconds;
    const empire = this.empire;

    empire.research("trans-newtonian");
    empire.research("mass-drivers");
    empire.treasury = 50_000;

    const earth = empire.foundColony("earth", now);
    earth.population = 8_100;
    earth.installations = {
      "construction-factory": 1_200,
      "research-lab": 30,
      mine: 400,
      "fuel-refinery": 100,
      spaceport: 1,
      shipyard: 2,
    };
    earth.stockpile = emptyStockpile();
    for (const mineral of MINERALS) earth.stockpile[mineral] = 50_000;
    earth.fuel = 2_000_000;

    const luna = empire.foundColony("luna", now);
    luna.population = 4.2;
    luna.installations = { infrastructure: 900, "automated-mine": 40, "mass-driver": 2 };

    const mars = empire.foundColony("mars", now);
    mars.population = 0.8;
    mars.installations = { infrastructure: 260, "automated-mine": 22, "mass-driver": 1 };

    // Only the worlds already settled have been surveyed from the ground;
    // everything else needs a survey ship.
    for (const bodyId of ["earth", "luna", "mars"]) empire.surveyed.add(bodyId);

    empire.seedOfficers({ science: 8, civilian: 8, navy: 12, ground: 5 }, now);

    // Post the strongest administrator to Earth and put the two best
    // scientists to work, so the campaign opens already in motion.
    const governor = bestBy(empire.officers.byBranch("civilian"), (o) => o.skills.production ?? 0);
    if (governor) {
      empire.assignOfficer(governor.id, { kind: "governor", targetId: "earth", since: now });
    }

    // Put the two best-suited scientists to work, splitting Earth's labs
    // between them and respecting what each can personally direct.
    const labsOnEarth = earth.installations["research-lab"] ?? 0;
    const candidates = [...empire.officers.byBranch("science")].sort(
      (a, b) =>
        (b.skills.research ?? 0) + (b.specialty === "construction" ? 100 : 0) -
        ((a.skills.research ?? 0) + (a.specialty === "construction" ? 100 : 0)),
    );
    let labsLeft = labsOnEarth;
    for (const [i, techId] of ["construction-12", "mining-12"].entries()) {
      const scientist = candidates[i];
      if (!scientist || labsLeft <= 0) break;
      const labs = Math.min(labCapacity(scientist), Math.ceil(labsOnEarth / 2), labsLeft);
      empire.startProject(techId, "earth", scientist.id, labs);
      labsLeft -= labs;
    }

    empire.addLog(now, "economy", "Trans-Newtonian industry comes online across Earth.");
    empire.snapshot = computeSnapshot(empire, this.system);
    empire.markReviewed(now);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  tick(realSeconds: number): void {
    const before = this.clock.seconds;
    this.clock.advance(realSeconds);
    this.advanceWorld(this.clock.seconds - before);
    if (this.runCycles()) this.emit();
  }

  step(seconds: number): void {
    this.clock.step(seconds);
    this.advanceWorld(seconds);
    this.runCycles();
    this.emit();
  }

  /** Move the bodies, then the fleets that are chasing them. */
  private advanceWorld(elapsedSeconds: number): void {
    this.system.update(this.clock.days);
    this.empire.lastTick = this.clock.seconds;
    updateFleets(this.empire, this.system, elapsedSeconds);
  }

  /**
   * Run any production cycles the clock has passed. Large jumps are caught up
   * over several frames rather than all at once, so the UI never locks.
   */
  private runCycles(): boolean {
    let ran = 0;
    while (this.clock.seconds - this.lastCycle >= CYCLE_SECONDS && ran < MAX_CYCLES_PER_FRAME) {
      this.lastCycle += CYCLE_SECONDS;
      runCycle(this.empire, this.system, this.lastCycle, CYCLE_DAYS);
      ran++;
    }
    return ran > 0;
  }

  /** True while the economy is still catching up with the clock. */
  get catchingUp(): boolean {
    return this.clock.seconds - this.lastCycle >= CYCLE_SECONDS * 2;
  }

  select(body: Body | null): void {
    this.selected = body;
    this.emit();
  }

  selectFleet(fleetId: string | null): void {
    this.selectedFleet = fleetId;
    this.emit();
  }
}

function bestBy<T>(items: T[], score: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const item of items) {
    const value = score(item);
    if (value > bestScore) {
      bestScore = value;
      best = item;
    }
  }
  return best;
}

export type { Officer };
