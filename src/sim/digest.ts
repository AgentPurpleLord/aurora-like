/**
 * The return digest: what happened while you were not looking.
 *
 * Fast-forwarding at thirty days a second can skip years. The digest turns
 * the event log since the player last reviewed the empire into a short
 * report: the changes that matter in numbers, the events grouped by kind,
 * and whatever is wanting a decision now. Nothing is stored - it is read off
 * the log and the empire's current state.
 */

import type { Empire, LogCategory, LogEntry } from "../state/empire";
import type { Galaxy } from "./galaxy";
import { activeIssues, type Issue } from "./issues";

export interface DigestGroup {
  category: LogCategory;
  label: string;
  entries: LogEntry[];
}

export interface Digest {
  fromTime: number;
  toTime: number;
  days: number;
  /** True when the log has been trimmed and older events are gone. */
  truncated: boolean;
  deltas: {
    treasury: number;
    population: number;
    techs: number;
    colonies: number;
    ships: number;
  };
  groups: DigestGroup[];
  /** Routine automated-fleet events, counted rather than listed. */
  routine: number;
  attention: Issue[];
}

const GROUPS: [LogCategory, string][] = [
  ["research", "Research"],
  ["colony", "Colonies"],
  ["fleet", "Fleets"],
  ["construction", "Construction"],
  ["economy", "Economy"],
  ["people", "People"],
];

export function buildDigest(empire: Empire, system: Galaxy, now: number): Digest {
  const mark = empire.reviewMark;
  // Newest first in the log; the report reads oldest first.
  const fresh = empire.logSince(mark.seq);
  const oldest = empire.log[empire.log.length - 1];
  const truncated = empire.logSeq - mark.seq > empire.log.length || (oldest !== undefined && oldest.seq > mark.seq + 1 && mark.seq > 0);

  const groups: DigestGroup[] = [];
  let routine = 0;
  for (const [category, label] of GROUPS) {
    const entries = fresh.filter((e) => e.category === category && !e.quiet);
    if (entries.length) groups.push({ category, label, entries });
  }
  routine = fresh.filter((e) => e.quiet).length;

  const population = [...empire.colonies.values()].reduce((sum, c) => sum + c.population, 0);
  return {
    fromTime: mark.time,
    toTime: now,
    days: Math.max(0, (now - mark.time) / 86_400),
    truncated,
    deltas: {
      treasury: empire.treasury - mark.treasury,
      population: population - mark.population,
      techs: empire.researched.size - mark.techs,
      colonies: empire.colonies.size - mark.colonies,
      ships: empire.ships.size - mark.ships,
    },
    groups,
    routine,
    attention: activeIssues(empire, system, now).filter((i) => i.severity !== "info").slice(0, 6),
  };
}

/** Enough time and enough news that interrupting the player is justified. */
export function worthShowing(digest: Digest): boolean {
  const events = digest.groups.reduce((sum, g) => sum + g.entries.length, 0);
  return digest.days >= 30 && events >= 3;
}
