/** The settings popover: density, what stops the clock, and housekeeping. */

import type { LogCategory } from "../state/empire";
import { EVENT_FREQUENCY, applyDensity, saveSettings, settings, type Density, type EventRate } from "./settings";
import type { Game } from "../state/game";
import { el } from "./format";

const CATEGORY_LABELS: [LogCategory, string, string][] = [
  ["research", "Research completes", "A technology is finished."],
  ["fleet", "Fleet events", "A fleet arrives, runs dry, or a ship is built."],
  ["colony", "Colony events", "Colonists land, a deposit runs out, a world becomes breathable."],
  ["construction", "Construction completes", "Every finished installation. Noisy once you build a lot."],
  ["economy", "Treasury changes", "The treasury goes into or out of deficit."],
  ["people", "Officer news", "Promotions, retirements and new recruits."],
];

export class SettingsMenu {
  private panel = el("div", "settings-panel");
  private button = el("button", "icon-btn", "Settings");

  constructor(
    host: HTMLElement,
    private onChange: () => void,
    private game?: Game,
  ) {
    this.button.setAttribute("aria-label", "Settings");
    this.button.title = "Settings";
    this.button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggle();
    });
    this.panel.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", () => this.close());
    host.append(this.button, this.panel);
    this.build();
  }

  private toggle(): void {
    this.panel.classList.toggle("open");
    if (this.panel.classList.contains("open")) this.build();
  }

  close(): void {
    this.panel.classList.remove("open");
  }

  private build(): void {
    this.panel.textContent = "";

    // --- density
    this.panel.append(el("h4", undefined, "Density"));
    const density = el("div", "segmented");
    for (const [value, label] of [
      ["comfortable", "Comfortable"],
      ["compact", "Compact"],
    ] as [Density, string][]) {
      const btn = el("button", "seg-btn", label);
      btn.classList.toggle("active", settings.density === value);
      btn.addEventListener("click", () => {
        settings.density = value;
        applyDensity();
        saveSettings();
        this.build();
        this.onChange();
      });
      density.append(btn);
    }
    this.panel.append(density);
    this.panel.append(
      el("p", "muted small", "Compact fits more rows on screen; nothing is hidden."),
    );

    // --- random events
    this.panel.append(el("h4", undefined, "Random events"));
    const rate = el("div", "segmented");
    for (const [value, label] of [["off", "Off"], ["rare", "Rare"], ["normal", "Normal"], ["often", "Often"]] as [EventRate, string][]) {
      const btn = el("button", "seg-btn", label);
      btn.classList.toggle("active", settings.events === value);
      btn.addEventListener("click", () => {
        settings.events = value;
        if (this.game) this.game.empire.eventFrequency = EVENT_FREQUENCY[value];
        saveSettings();
        this.build();
        this.onChange();
      });
      rate.append(btn);
    }
    this.panel.append(rate);
    const popups = el("label", "check-row");
    const popupBox = el("input");
    popupBox.type = "checkbox";
    popupBox.checked = settings.eventPopups;
    popupBox.addEventListener("change", () => {
      settings.eventPopups = popupBox.checked;
      saveSettings();
    });
    const popupText = el("span");
    popupText.append(
      el("span", "check-label", "Popup for every event"),
      el("span", "muted small", "Decisions always open a popup and stop the clock. This adds one for good and bad news too."),
    );
    popups.append(popupBox, popupText);
    this.panel.append(popups);

    // --- what stops the clock
    this.panel.append(el("h4", undefined, "Pause the clock when..."));
    for (const [category, label, help] of CATEGORY_LABELS) {
      const row = el("label", "check-row");
      const box = el("input");
      box.type = "checkbox";
      box.checked = settings.autoPause[category];
      box.addEventListener("change", () => {
        settings.autoPause[category] = box.checked;
        saveSettings();
      });
      const text = el("span");
      text.append(el("span", "check-label", label), el("span", "muted small", help));
      row.append(box, text);
      this.panel.append(row);
    }

    // --- housekeeping
    this.panel.append(el("h4", undefined, "Interface"));
    const guide = el("label", "check-row");
    const guideBox = el("input");
    guideBox.type = "checkbox";
    guideBox.checked = settings.guide;
    guideBox.addEventListener("change", () => {
      settings.guide = guideBox.checked;
      saveSettings();
      this.onChange();
    });
    const guideText = el("span");
    guideText.append(
      el("span", "check-label", "Show next steps"),
      el("span", "muted small", "A short checklist on the Empire screen."),
    );
    guide.append(guideBox, guideText);
    this.panel.append(guide);

    const locked = el("label", "check-row");
    const lockedBox = el("input");
    lockedBox.type = "checkbox";
    lockedBox.checked = settings.showLocked;
    lockedBox.addEventListener("change", () => {
      settings.showLocked = lockedBox.checked;
      saveSettings();
      this.onChange();
    });
    const lockedText = el("span");
    lockedText.append(
      el("span", "check-label", "Show locked technology"),
      el("span", "muted small", "Research and parts you cannot use yet. Hidden by default."),
    );
    locked.append(lockedBox, lockedText);
    this.panel.append(locked);

    const reset = el("button", "ghost-btn", "Unfold every section");
    reset.addEventListener("click", () => {
      settings.collapsed = [];
      saveSettings();
      this.onChange();
    });
    this.panel.append(reset);
  }
}
