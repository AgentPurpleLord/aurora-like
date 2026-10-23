/** Top-level game state: the clock, the system, the empire, and the loop. */

import { GameClock } from "../sim/clock";
import { SECONDS_PER_DAY } from "../sim/orbit";
import type { Body, StarSystem } from "../sim/system";
import { Galaxy } from "../sim/galaxy";
import { Random } from "../sim/rng";
import { CYCLE_DAYS, computeSnapshot, runCycle } from "../sim/economy/production";
import { MINERALS } from "../sim/minerals";
import { updateFleets } from "../sim/ships/fleet";
import { Empire, type EmpireState, type LogEntry } from "./empire";
import { recomputeEnvironment } from "../sim/system";
import { emptyStockpile } from "./colony";
import { labCapacity, type Officer } from "../sim/people/officers";

export type Listener = () => void;

/** The saved form of a campaign. */
export interface GameState {
  seed: string;
  /** Simulation seconds since J2000. */
  seconds: number;
  lastCycle: number;
  selected: string | null;
  empire: EmpireState;
  /** Per-body state that play can change: the air and what is left to mine. */
  bodies: Record<string, { atmosphere: Record<string, number>; deposits: number[] }>;
}

const CYCLE_SECONDS = CYCLE_DAYS * SECONDS_PER_DAY;
/** Cycles processed in a single frame before we let the UI breathe. */
const MAX_CYCLES_PER_FRAME = 40;

export class Game {
  readonly galaxy: Galaxy;
  /** The system the map and body list are showing. */
  viewSystem: StarSystem;
  readonly clock = new GameClock();
  readonly empire: Empire;

  selected: Body | null = null;
  /** Fleet selected on the map or in the fleets view. */
  selectedFleet: string | null = null;
  /** Keep the camera locked to the selected body as it moves. */
  follow = false;

  /** Simulation time the last production cycle was run at. */
  private lastCycle: number;
  /** Newest log entry the pause logic has already looked at. */
  private pauseSeq = 0;
  /**
   * Decides whether an event should stop the clock. Supplied by the interface
   * so the simulation stays ignorant of the player's preferences.
   */
  autoPauseFilter: ((entry: LogEntry) => boolean) | null = null;
  /** The event that last paused the game, for the interface to explain. */
  pausedBy: LogEntry | null = null;
  private listeners = new Set<Listener>();

  constructor(
    readonly seed: string = "sol-1",
    save?: GameState,
  ) {
    this.galaxy = new Galaxy(seed);
    this.viewSystem = this.galaxy.sol;
    this.empire = new Empire(new Random(seed));
    this.galaxy.update(this.clock.days);
    this.lastCycle = this.clock.seconds;
    if (save) {
      this.restore(save);
    } else {
      this.setUpCampaign();
    }
    this.selected = this.galaxy.byId.get(save?.selected ?? "earth") ?? null;
    this.viewSystem = (this.selected && this.galaxy.systemById.get(this.selected.systemId)) || this.galaxy.sol;
  }

  /** Everything needed to carry on from here: plain data, safe for JSON. */
  exportState(): GameState {
    const bodies: GameState["bodies"] = {};
    for (const body of this.galaxy.bodies) {
      bodies[body.id] = {
        atmosphere: { ...body.atmosphere },
        deposits: body.minerals.map((d) => d.amount),
      };
    }
    return {
      seed: this.seed,
      seconds: this.clock.seconds,
      lastCycle: this.lastCycle,
      selected: this.selected?.id ?? null,
      empire: this.empire.exportState(),
      bodies,
    };
  }

  /** Load a saved campaign over a freshly built one. */
  private restore(save: GameState): void {
    this.clock.seconds = save.seconds;
    this.lastCycle = save.lastCycle;
    for (const body of this.galaxy.bodies) {
      const saved = save.bodies[body.id];
      if (!saved) continue;
      body.atmosphere = { ...saved.atmosphere };
      // Deposits are generated from the body, so they come back in the same order.
      body.minerals.forEach((deposit, i) => {
        if (typeof saved.deposits[i] === "number") deposit.amount = saved.deposits[i];
      });
      recomputeEnvironment(body);
    }
    this.galaxy.update(this.clock.days);
    this.empire.importState(save.empire);
    this.pauseSeq = this.empire.logSeq;
    this.clock.setRate(0);
  }

  /**
   * The opening position: Earth industrialised, a mining base on Luna and a
   * foothold on Mars, with trans-Newtonian theory and mass drivers in hand.
   */
  private setUpCampaign(): void {
    const now = this.clock.seconds;
    const empire = this.empire;

    empire.research("trans-newtonian");
    empire.treasury = 50_000;

    // One world, one industry, and everything else still to be reached for.
    const earth = empire.foundColony("earth", now);
    earth.population = 8_100;
    earth.installations = {
      "construction-factory": 1_200,
      "research-lab": 30,
      mine: 400,
      "fuel-refinery": 100,
      "consumer-plant": 40,
      "luxury-workshop": 40,
      spaceport: 1,
      shipyard: 2,
    };
    earth.stockpile = emptyStockpile();
    for (const mineral of MINERALS) earth.stockpile[mineral] = 50_000;
    earth.fuel = 2_000_000;

    // Only the worlds already settled have been surveyed from the ground;
    // everything else needs a survey ship.
    empire.surveyed.add("earth");

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

    empire.addLog(
      now,
      "economy",
      "Trans-Newtonian industry comes online across Earth. No other world has been surveyed.",
    );
    empire.snapshot = computeSnapshot(empire, this.galaxy);
    empire.markReviewed(now);
    empire.recordHistory(now);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  tick(realSeconds: number): void {
    // Anything logged before this frame - including the player's own actions -
    // is not news; only what happens during the advance can pause the game.
    this.markEventsSeen();
    const before = this.clock.seconds;
    this.clock.advance(realSeconds);
    this.advanceWorld(this.clock.seconds - before);
    const ran = this.runCycles();
    // Fleets arrive between production cycles, so events are checked every
    // frame rather than only when a cycle ran.
    const paused = this.applyAutoPause();
    if (ran || paused) this.emit();
  }

  /** Stop the clock if something happened that the player wants to see. */
  private applyAutoPause(): boolean {
    const fresh = this.empire.logSince(this.pauseSeq);
    if (!fresh.length) return false;
    this.pauseSeq = this.empire.logSeq;
    if (this.clock.paused) return false;
    // A decision waiting on the player stops the clock whatever the settings.
    if (!this.autoPauseFilter && !fresh.some((e) => e.decision)) return false;
    const trigger = fresh.find((entry) => entry.decision || (!entry.quiet && this.autoPauseFilter?.(entry) === true));
    if (!trigger) return false;
    this.clock.setRate(0);
    this.pausedBy = trigger;
    return true;
  }

  /** Forget events up to now, so a manual jump does not trip auto-pause later. */
  private markEventsSeen(): void {
    this.pauseSeq = this.empire.logSeq;
  }

  /**
   * Advance a day at a time until something the player would want to know
   * about happens, or `maxDays` pass. Returns the event that stopped it.
   */
  runUntilEvent(
    isNotable: (entry: LogEntry) => boolean,
    maxDays = 365,
  ): LogEntry | null {
    const start = this.empire.logSeq;
    let found: LogEntry | null = null;
    for (let day = 0; day < maxDays && !found; day++) {
      this.clock.step(SECONDS_PER_DAY);
      this.advanceWorld(SECONDS_PER_DAY);
      this.runCycles();
      found = this.empire.logSince(start).find(isNotable) ?? null;
    }
    this.markEventsSeen();
    this.pausedBy = found;
    this.emit();
    return found;
  }

  step(seconds: number): void {
    this.clock.step(seconds);
    this.advanceWorld(seconds);
    this.runCycles();
    // A deliberate jump is the player's own choice; do not pause for it.
    this.markEventsSeen();
    this.emit();
  }

  /** Systems worth moving every frame: the one shown, and any with our people in. */
  private activeSystems(): Set<string> {
    const active = new Set([this.viewSystem.id]);
    for (const colony of this.empire.colonies.values()) {
      const system = this.galaxy.byId.get(colony.bodyId)?.systemId;
      if (system) active.add(system);
    }
    for (const fleet of this.empire.fleets.values()) active.add(fleet.systemId);
    return active;
  }

  /** Move the bodies, then the fleets that are chasing them. */
  private advanceWorld(elapsedSeconds: number): void {
    this.galaxy.update(this.clock.days, this.activeSystems());
    this.empire.lastTick = this.clock.seconds;
    updateFleets(this.empire, this.galaxy, elapsedSeconds);
  }

  /**
   * Run any production cycles the clock has passed. Large jumps are caught up
   * over several frames rather than all at once, so the UI never locks.
   */
  private runCycles(): boolean {
    let ran = 0;
    while (this.clock.seconds - this.lastCycle >= CYCLE_SECONDS && ran < MAX_CYCLES_PER_FRAME) {
      this.lastCycle += CYCLE_SECONDS;
      runCycle(this.empire, this.galaxy, this.lastCycle, CYCLE_DAYS);
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
    // Selecting something in another system brings that system into view.
    if (body && body.systemId !== this.viewSystem.id) {
      this.viewSystem = this.galaxy.systemById.get(body.systemId) ?? this.viewSystem;
    }
    this.emit();
  }

  /** Show a different system on the map. Only systems the empire knows. */
  setViewSystem(systemId: string): void {
    const system = this.galaxy.systemById.get(systemId);
    if (!system || system === this.viewSystem) return;
    this.viewSystem = system;
    if (this.selected && this.selected.systemId !== systemId) this.selected = null;
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
