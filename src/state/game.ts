/** Top-level game state and the actions the UI can take against it. */

import { GameClock } from "../sim/clock";
import { StarSystem, type Body, type Colony } from "../sim/system";

export type Listener = () => void;

export class Game {
  readonly system = new StarSystem();
  readonly clock = new GameClock();
  readonly colonies = new Map<string, Colony>();

  selected: Body | null = null;
  /** Keep the camera locked to the selected body as it moves. */
  follow = false;

  private listeners = new Set<Listener>();

  constructor() {
    this.system.update(this.clock.days);
    // The campaign opens with Earth settled and a foothold on Luna and Mars.
    this.foundColony("earth", 8_100, {
      "construction-factory": 1_200,
      "research-lab": 30,
      mine: 400,
      "fuel-refinery": 100,
      spaceport: 1,
    });
    this.foundColony("luna", 4.2, { infrastructure: 900, "automated-mine": 40, "mass-driver": 2 });
    this.foundColony("mars", 0.8, { infrastructure: 260, "automated-mine": 22 });
    this.selected = this.system.byId.get("earth") ?? null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  tick(realSeconds: number): void {
    this.clock.advance(realSeconds);
    this.system.update(this.clock.days);
  }

  step(seconds: number): void {
    this.clock.step(seconds);
    this.system.update(this.clock.days);
    this.emit();
  }

  select(body: Body | null): void {
    this.selected = body;
    this.emit();
  }

  colonyFor(body: Body): Colony | undefined {
    return this.colonies.get(body.id);
  }

  foundColony(bodyId: string, population = 0, installations: Record<string, number> = {}): Colony {
    const colony: Colony = {
      bodyId,
      population,
      installations: { ...installations },
      founded: this.clock.seconds,
    };
    this.colonies.set(bodyId, colony);
    return colony;
  }

  abandonColony(bodyId: string): void {
    this.colonies.delete(bodyId);
    this.emit();
  }

  addInstallation(bodyId: string, typeId: string, count: number): void {
    const colony = this.colonies.get(bodyId);
    if (!colony) return;
    const next = (colony.installations[typeId] ?? 0) + count;
    if (next <= 0) delete colony.installations[typeId];
    else colony.installations[typeId] = next;
    this.emit();
  }
}
