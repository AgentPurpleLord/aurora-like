/** The settings popover: density, what stops the clock, and housekeeping. */

import type { LogCategory } from "../state/empire";
import { applyDensity, saveSettings, settings, type Density } from "./settings";
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

    const reset = el("button", "ghost-btn", "Unfold every section");
    reset.addEventListener("click", () => {
      settings.collapsed = [];
      saveSettings();
      this.onChange();
    });
    this.panel.append(reset);
  }
}
