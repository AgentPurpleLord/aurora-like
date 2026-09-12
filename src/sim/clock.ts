/**
 * Game clock. Simulation time is tracked in seconds since J2000.0 so it can be
 * handed straight to the orbital code, and rendered as a civil date for the UI.
 */

import { SECONDS_PER_DAY } from "./orbit";

const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** The campaign opens on the eve of the first trans-Newtonian launches. */
export const CAMPAIGN_START_SECONDS =
  (Date.UTC(2025, 0, 1, 0, 0, 0) - J2000_UNIX_MS) / 1000;

export interface TimeRate {
  label: string;
  /** Simulated seconds per real second. 0 pauses the simulation. */
  secondsPerSecond: number;
}

export const TIME_RATES: TimeRate[] = [
  { label: "Paused", secondsPerSecond: 0 },
  { label: "1 min/s", secondsPerSecond: 60 },
  { label: "1 hour/s", secondsPerSecond: 3_600 },
  { label: "6 hours/s", secondsPerSecond: 21_600 },
  { label: "1 day/s", secondsPerSecond: SECONDS_PER_DAY },
  { label: "5 days/s", secondsPerSecond: 5 * SECONDS_PER_DAY },
  { label: "30 days/s", secondsPerSecond: 30 * SECONDS_PER_DAY },
];

/** Discrete jumps, in the spirit of Aurora's turn increments. */
export const TIME_INCREMENTS: { label: string; seconds: number }[] = [
  { label: "+5s", seconds: 5 },
  { label: "+30m", seconds: 1_800 },
  { label: "+1h", seconds: 3_600 },
  { label: "+8h", seconds: 28_800 },
  { label: "+1d", seconds: SECONDS_PER_DAY },
  { label: "+5d", seconds: 5 * SECONDS_PER_DAY },
  { label: "+30d", seconds: 30 * SECONDS_PER_DAY },
];

export class GameClock {
  /** Simulated seconds since J2000.0. */
  seconds = CAMPAIGN_START_SECONDS;
  rateIndex = 0;

  get rate(): TimeRate {
    return TIME_RATES[this.rateIndex];
  }

  get paused(): boolean {
    return this.rate.secondsPerSecond === 0;
  }

  /** Days since J2000.0 - the time argument used by the orbital code. */
  get days(): number {
    return this.seconds / SECONDS_PER_DAY;
  }

  advance(realSeconds: number): void {
    this.seconds += this.rate.secondsPerSecond * realSeconds;
  }

  step(seconds: number): void {
    this.seconds += seconds;
  }

  setRate(index: number): void {
    this.rateIndex = Math.max(0, Math.min(TIME_RATES.length - 1, index));
  }

  togglePause(): void {
    this.rateIndex = this.rateIndex === 0 ? 4 : 0;
  }

  toDate(): Date {
    return new Date(J2000_UNIX_MS + this.seconds * 1000);
  }

  /** "15th January 2025  04:32:10", close to Aurora's date line. */
  format(): string {
    const d = this.toDate();
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}  ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    );
  }
}
