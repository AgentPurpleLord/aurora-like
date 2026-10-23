/**
 * Random events.
 *
 * An event definition knows how to find something to happen to (`build`),
 * how to describe it (`describe`) and what the player can do about it
 * (`options`). What is *stored* is only the definition's id and a handful of
 * plain parameters - the colony, the amount - so a pending decision survives
 * a save, and the text and choices are rebuilt from current state when shown.
 */

import type { Empire, LogLink } from "../../state/empire";
import type { Galaxy } from "../galaxy";
import type { Random } from "../rng";

export type EventTone = "good" | "bad" | "neutral";

export type EventParams = Record<string, string | number>;

export interface EventContext {
  empire: Empire;
  galaxy: Galaxy;
  now: number;
  rng: Random;
  /** The event being resolved, so a follow-up can say what it follows. */
  eventId?: string;
  eventTitle?: string;
}

export interface EventOption {
  id: string;
  label: string;
  /** What it costs or risks, stated before the choice is made. */
  detail: string;
  /** Set when the option cannot be taken now, with the reason. */
  disabled?: string;
  /** Carry it out; returns a sentence saying what happened. */
  apply(ctx: EventContext): string;
}

export interface EventDescription {
  title: string;
  text: string;
  link?: LogLink;
}

export interface EventDef {
  id: string;
  tone: EventTone;
  /** Relative likelihood given the current state; 0 or less means not now. */
  weight(ctx: EventContext): number;
  /** Pick what the event is about, or null if there is nothing suitable. */
  build(ctx: EventContext): EventParams | null;
  describe(params: EventParams, ctx: EventContext): EventDescription;
  /**
   * The choices. An event with none resolves by itself using the single
   * "auto" option, so it still reports what happened.
   */
  options(params: EventParams, ctx: EventContext): EventOption[];
  /** Whether the player is asked. Events with one option are just news. */
  decision?: boolean;
  /** The option taken if nobody decides in time. */
  fallback?: string;
  /**
   * For follow-ups: is the situation still what it was when this was
   * scheduled? If not, the chain simply ends.
   */
  valid?(params: EventParams, ctx: EventContext): boolean;
}

export type EventStatus = "pending" | "resolved" | "expired";

/** One event as the empire remembers it. */
export interface GameEvent {
  id: string;
  defId: string;
  params: EventParams;
  tone: EventTone;
  /** Simulation seconds when it happened. */
  time: number;
  title: string;
  text: string;
  decision: boolean;
  status: EventStatus;
  /** Decisions lapse into the fallback after this time. */
  expires?: number;
  chosen?: string;
  outcome?: string;
  resolvedAt?: number;
  link?: LogLink;
  /** Title of the event this one follows, for a chain. */
  follows?: string;
}
