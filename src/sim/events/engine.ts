/**
 * Rolling, describing and resolving events.
 *
 * Once per production cycle the engine decides whether something happens. The
 * chance scales with the frequency setting and is held down by a cooldown and
 * by how many decisions are already waiting, so events arrive as an occasional
 * interruption rather than a barrage. What happens is a weighted draw over the
 * definitions whose conditions the empire currently meets.
 */

import type { Empire } from "../../state/empire";
import type { Galaxy } from "../galaxy";
import { EVENTS, EVENT_BY_ID } from "./catalogue";
import type { EventContext, EventOption, GameEvent } from "./types";

/** Mean days between events at the normal setting. */
const MEAN_INTERVAL_DAYS = 110;
/** No new event within this many days of the last. */
const COOLDOWN_DAYS = 18;
/** Stop raising decisions while this many wait. */
const MAX_PENDING = 3;
/** A decision nobody makes lapses into its fallback after this long. */
const EXPIRY_DAYS = 90;
const MAX_KEPT = 300;
const DAY = 86_400;

const context = (empire: Empire, galaxy: Galaxy, now: number): EventContext => ({
  empire, galaxy, now, rng: empire.eventRng,
});

/** Called once per production cycle. */
export function runEvents(empire: Empire, galaxy: Galaxy, now: number, cycleDays: number): void {
  expireDecisions(empire, galaxy, now);
  if (empire.eventFrequency <= 0) return;
  if (now - empire.lastEventTime < COOLDOWN_DAYS * DAY) return;

  const ctx = context(empire, galaxy, now);
  const chance = (cycleDays / MEAN_INTERVAL_DAYS) * empire.eventFrequency;
  if (!ctx.rng.chance(chance)) return;
  rollEvent(ctx);
}

/** Choose and raise one event now, regardless of the dice. Returns it, or null if nothing fits. */
export function rollEvent(ctx: EventContext, onlyId?: string): GameEvent | null {
  const { empire } = ctx;
  const waiting = empire.pendingEvents.length;
  const candidates = EVENTS
    .filter((def) => !onlyId || def.id === onlyId)
    .filter((def) => !(def.decision && waiting >= MAX_PENDING))
    .map((def) => ({ def, weight: def.weight(ctx) }))
    .filter((c) => c.weight > 0);
  if (!candidates.length) return null;

  // Weighted draw; a definition that finds nothing to happen to is dropped
  // and the draw repeated.
  const pool = [...candidates];
  while (pool.length) {
    const total = pool.reduce((sum, c) => sum + c.weight, 0);
    let roll = ctx.rng.float(0, total);
    let index = 0;
    for (; index < pool.length - 1; index++) {
      roll -= pool[index].weight;
      if (roll <= 0) break;
    }
    const { def } = pool.splice(index, 1)[0];
    const params = def.build(ctx);
    if (!params) continue;
    return raise(ctx, def.id, params);
  }
  return null;
}

function raise(ctx: EventContext, defId: string, params: GameEvent["params"]): GameEvent {
  const { empire, now } = ctx;
  const def = EVENT_BY_ID.get(defId)!;
  const description = def.describe(params, ctx);
  const event: GameEvent = {
    id: empire.newEventId(),
    defId,
    params,
    tone: def.tone,
    time: now,
    title: description.title,
    text: description.text,
    decision: def.decision === true,
    status: "pending",
    link: description.link,
  };
  empire.events.unshift(event);
  if (empire.events.length > MAX_KEPT) empire.events.length = MAX_KEPT;
  empire.lastEventTime = now;

  if (event.decision) {
    event.expires = now + EXPIRY_DAYS * DAY;
    empire.addLog(now, "event", `${event.title}: a decision is needed. ${event.text}`, { view: "events" }, false, true);
  } else {
    // News resolves at once, and says what it did.
    resolveEvent(empire, ctx.galaxy, event.id, "auto", now);
  }
  return event;
}

/** The choices for an event as things stand now (costs and availability). */
export function optionsFor(empire: Empire, galaxy: Galaxy, event: GameEvent, now: number): EventOption[] {
  const def = EVENT_BY_ID.get(event.defId);
  return def ? def.options(event.params, context(empire, galaxy, now)) : [];
}

/** Carry out a choice. Returns the outcome text, or null if it could not be taken. */
export function resolveEvent(
  empire: Empire,
  galaxy: Galaxy,
  eventId: string,
  optionId: string,
  now: number,
  status: "resolved" | "expired" = "resolved",
): string | null {
  const event = empire.events.find((e) => e.id === eventId);
  if (!event || event.status !== "pending") return null;
  const ctx = context(empire, galaxy, now);
  const option = optionsFor(empire, galaxy, event, now).find((o) => o.id === optionId);
  if (!option || option.disabled) return null;

  const outcome = option.apply(ctx);
  event.status = status;
  event.chosen = event.decision ? option.label : undefined;
  event.outcome = outcome;
  event.resolvedAt = now;
  event.expires = undefined;
  empire.addLog(
    now,
    "event",
    event.decision
      ? `${event.title}${status === "expired" ? " (no decision was made)" : ""}: ${option.label}. ${outcome}`
      : `${event.title}. ${outcome}`,
    event.link ?? { view: "events" },
  );
  return outcome;
}

/** Decisions left too long are settled by their fallback. */
export function expireDecisions(empire: Empire, galaxy: Galaxy, now: number): void {
  for (const event of empire.pendingEvents) {
    if (event.expires === undefined || now < event.expires) continue;
    const fallback = EVENT_BY_ID.get(event.defId)?.fallback;
    const options = optionsFor(empire, galaxy, event, now);
    const choice = options.find((o) => o.id === fallback && !o.disabled)
      ?? options.find((o) => !o.disabled);
    if (choice) resolveEvent(empire, galaxy, event.id, choice.id, now, "expired");
  }
}
