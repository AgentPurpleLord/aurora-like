/**
 * The clock: date, play/pause, speed, and ways to skip ahead.
 *
 * Twenty-odd buttons became four ideas. One play/pause toggle that resumes at
 * the speed you were using; a speed ladder; a few quick jumps; and "next
 * event", which runs the clock until something worth knowing about happens.
 */

import type { Game } from "../state/game";
import type { ReviewMark } from "../state/empire";
import { TIME_INCREMENTS, TIME_RATES } from "../sim/clock";
import { el } from "./format";

/** Short labels for the speed ladder; the full names are the accessible names. */
const SPEED_SHORT = ["", "1m", "1h", "6h", "1d", "5d", "30d"];
const QUICK_JUMPS = ["+8h", "+1d", "+5d", "+30d"];

export class TimeControls {
  private dateEl = el("div", "clock-date");
  private timeEl = el("div", "clock-time");
  private playButton: HTMLButtonElement;
  private speedButtons: HTMLButtonElement[] = [];
  private lastDate = "";
  private moreMenu: HTMLElement;

  constructor(
    root: HTMLElement,
    private game: Game,
    private onNextEvent: () => void,
    /** Told when a jump button has run its span, with the empire as it stood before. */
    private onJump: (before: ReviewMark, seconds: number) => void = () => {},
  ) {
    const clock = el("div", "clock");
    clock.append(this.dateEl, this.timeEl);
    root.append(clock);

    // --- play / pause
    this.playButton = el("button", "play-btn");
    this.playButton.addEventListener("click", () => {
      this.game.clock.togglePause();
      this.game.pausedBy = null;
      this.refresh(true);
    });
    root.append(this.playButton);

    // --- speed ladder
    const speeds = el("div", "speed-group");
    TIME_RATES.forEach((rate, index) => {
      if (index === 0) return;
      const btn = el("button", "speed-btn", SPEED_SHORT[index]);
      btn.setAttribute("aria-label", rate.label);
      btn.title = `Run at ${rate.label.replace("/s", " per second")}  (${index})`;
      btn.addEventListener("click", () => {
        this.game.clock.setRate(index);
        this.game.pausedBy = null;
        this.refresh(true);
      });
      speeds.append(btn);
      this.speedButtons[index] = btn;
    });
    root.append(speeds);

    // --- skip ahead
    const skip = el("div", "skip-group");
    for (const inc of TIME_INCREMENTS) {
      if (!QUICK_JUMPS.includes(inc.label)) continue;
      skip.append(this.jumpButton(inc.label, inc.seconds));
    }
    const more = el("button", "step-btn skip-more", "...");
    more.title = "More ways to skip";
    more.setAttribute("aria-label", "More jumps");
    this.moreMenu = el("div", "skip-menu");
    for (const inc of TIME_INCREMENTS) {
      if (QUICK_JUMPS.includes(inc.label)) continue;
      this.moreMenu.append(this.jumpButton(inc.label, inc.seconds));
    }
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      this.moreMenu.classList.toggle("open");
    });
    document.addEventListener("click", () => this.moreMenu.classList.remove("open"));
    skip.append(more, this.moreMenu);
    root.append(skip);

    const next = el("button", "next-btn", "Next event");
    next.title = "Run until something worth knowing about happens  (N)";
    next.setAttribute("aria-label", "Skip to next event");
    next.addEventListener("click", () => this.onNextEvent());
    root.append(next);

    this.refresh(true);
  }

  private jumpButton(label: string, seconds: number): HTMLButtonElement {
    const btn = el("button", "step-btn", label);
    btn.title = `Advance ${label.slice(1)}`;
    btn.addEventListener("click", () => {
      this.moreMenu.classList.remove("open");
      const before = this.game.empire.reviewSnapshot(this.game.clock.seconds);
      this.game.step(seconds);
      this.onJump(before, seconds);
    });
    return btn;
  }

  /** Called every frame; only touches the DOM when something changed. */
  refresh(force = false): void {
    const { clock } = this.game;
    const date = clock.formatDate();
    if (force || date !== this.lastDate) {
      this.lastDate = date;
      this.dateEl.textContent = date;
    }
    this.timeEl.textContent = clock.formatTime();

    const paused = clock.paused;
    this.playButton.textContent = paused ? "Play" : "Pause";
    this.playButton.setAttribute("aria-label", paused ? "Resume" : "Pause");
    this.playButton.classList.toggle("paused", paused);
    this.playButton.title = paused ? "Resume  (Space)" : "Pause  (Space)";
    this.speedButtons.forEach((btn, index) => {
      btn?.classList.toggle("active", !paused && index === clock.rateIndex);
      btn?.classList.toggle("dim", paused && index === clock.rateIndex);
    });
  }
}
