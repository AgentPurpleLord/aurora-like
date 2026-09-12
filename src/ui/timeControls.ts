/** Date readout, continuous time rates, and Aurora-style jump increments. */

import type { Game } from "../state/game";
import { TIME_INCREMENTS, TIME_RATES } from "../sim/clock";
import { el } from "./format";

export class TimeControls {
  private dateEl: HTMLElement;
  private rateButtons: HTMLButtonElement[] = [];

  constructor(root: HTMLElement, private game: Game) {
    this.dateEl = el("div", "clock");
    root.append(this.dateEl);

    const rates = el("div", "rate-group");
    TIME_RATES.forEach((rate, index) => {
      const btn = el("button", "rate-btn", index === 0 ? "Pause" : rate.label);
      btn.addEventListener("click", () => {
        this.game.clock.setRate(index);
        this.refresh();
      });
      rates.append(btn);
      this.rateButtons.push(btn);
    });
    root.append(rates);

    const steps = el("div", "step-group");
    for (const inc of TIME_INCREMENTS) {
      const btn = el("button", "step-btn", inc.label);
      btn.title = `Advance ${inc.label.slice(1)}`;
      btn.addEventListener("click", () => this.game.step(inc.seconds));
      steps.append(btn);
    }
    root.append(steps);

    this.refresh();
  }

  /** Called every frame; the date changes continuously while running. */
  refresh(): void {
    this.dateEl.textContent = this.game.clock.format();
    const active = this.game.clock.rateIndex;
    this.rateButtons.forEach((btn, i) => btn.classList.toggle("active", i === active));
  }
}
