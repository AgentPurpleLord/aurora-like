/** Small DOM helpers shared by the panels and views. */

import { el } from "./format";
import { hintFor } from "./glossary";
import { isCollapsed, toggleCollapsed } from "./settings";

/**
 * A titled block. Its header folds the contents away, and the choice is
 * remembered, so a panel can be trimmed to what you use without losing any
 * detail: it is one click to bring back.
 */
export function section(parent: HTMLElement, title: string, action?: HTMLElement): HTMLElement {
  const wrap = el("div", "section");
  const head = el("h3", "section-head", title);
  // "Colonies (3)" and "Colonies (4)" are the same section.
  const key = title.replace(/\s*\(\d+\)\s*$/, "");
  head.setAttribute("role", "button");
  // Named for what it does, so it is never mistaken for a button of the same
  // words elsewhere on the screen ("Start research" the heading and the action).
  head.setAttribute("aria-label", `Fold or unfold the ${key} section`);
  head.tabIndex = 0;
  head.setAttribute("aria-expanded", String(!isCollapsed(key)));
  head.title = "Click to fold or unfold";

  if (action) {
    head.classList.add("with-action");
    head.append(action);
  }
  const toggle = () => {
    const folded = toggleCollapsed(key);
    wrap.classList.toggle("collapsed", folded);
    head.setAttribute("aria-expanded", String(!folded));
  };
  head.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button, select, input")) return;
    toggle();
  });
  head.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
  wrap.classList.toggle("collapsed", isCollapsed(key));
  wrap.append(head);
  parent.append(wrap);
  return wrap;
}

export function stat(
  parent: HTMLElement,
  label: string,
  value: string,
  tone?: "good" | "bad" | "warn",
): HTMLElement {
  const row = el("div", "stat");
  const labelEl = el("span", "stat-label", label);
  const hint = hintFor(label);
  if (hint) {
    labelEl.title = hint;
    labelEl.classList.add("has-hint");
  }
  row.append(labelEl);
  const val = el("span", `stat-value${tone ? ` ${tone}` : ""}`, value);
  row.append(val);
  parent.append(row);
  return row;
}

export function button(
  label: string,
  onClick: () => void,
  className = "ghost-btn",
): HTMLButtonElement {
  const btn = el("button", className, label);
  btn.addEventListener("click", onClick);
  return btn;
}

/** A labelled progress bar, `fraction` in 0..1. */
export function progressBar(fraction: number, className = ""): HTMLElement {
  const wrap = el("span", `progress ${className}`.trim());
  const fill = el("span", "progress-fill");
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  wrap.append(fill);
  return wrap;
}

export function select(
  options: { value: string; label: string }[],
  value: string | null,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const node = el("select", "select");
  for (const option of options) {
    const opt = el("option", undefined, option.label);
    opt.value = option.value;
    node.append(opt);
  }
  if (value !== null) node.value = value;
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

/**
 * A number you can set with a thumb: a slider, - and + buttons, and the exact
 * box for when you do want to type. Short ranges slide in whole steps; wide
 * ones (tons, colonists) slide on a log scale and land on round numbers, so
 * the slider is usable from ten to ten million.
 */
export function numberInput(
  value: number,
  onChange: (value: number) => void,
  min = 1,
  max = 9999,
): HTMLElement {
  const wrap = el("div", "slider-field");
  const log = max / Math.max(1, min) > 150;
  const STEPS = 1000;

  const clamp = (v: number) => Math.max(min, Math.min(max, Number.isFinite(v) ? Math.round(v) : min));
  /** Two significant figures, so a log slider lands on 4,700 rather than 4,683. */
  const round = (v: number) => {
    if (v < 100) return Math.round(v);
    const digits = Math.floor(Math.log10(v)) - 1;
    return Math.round(v / 10 ** digits) * 10 ** digits;
  };
  // A log scale needs a positive floor; a minimum of 0 gets a notch of its own.
  const floor = Math.max(1, min);
  const toValue = (pos: number): number => {
    if (!log) return clamp(min + (pos / STEPS) * (max - min));
    if (pos <= 0) return min;
    return clamp(round(floor * Math.pow(max / floor, pos / STEPS)));
  };
  const toPos = (v: number): number => {
    if (!log) return max === min ? 0 : ((v - min) / (max - min)) * STEPS;
    if (v <= floor) return 0;
    return (Math.log(v / floor) / Math.log(max / floor)) * STEPS;
  };

  const slider = el("input", "slider");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(STEPS);
  slider.step = log ? "1" : String(STEPS / Math.max(1, max - min));
  slider.value = String(toPos(value));
  slider.setAttribute("aria-label", "Adjust amount");

  const input = el("input", "number-input");
  input.type = "number";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);

  const apply = (v: number, syncSlider: boolean) => {
    const clamped = clamp(v);
    input.value = String(clamped);
    if (syncSlider) slider.value = String(toPos(clamped));
    onChange(clamped);
  };

  // Dragging reports as it goes to the box, and commits when let go.
  slider.addEventListener("input", () => {
    input.value = String(toValue(Number(slider.value)));
  });
  slider.addEventListener("change", () => apply(toValue(Number(slider.value)), false));
  input.addEventListener("change", () => apply(Number(input.value), true));

  const nudge = (direction: 1 | -1) => {
    const now = clamp(Number(input.value));
    let next: number;
    if (!log) next = now + direction;
    else {
      // The next round number up or down on the same two-figure grid.
      const step = now < 100 ? 1 : 10 ** (Math.floor(Math.log10(now)) - 1);
      next = direction > 0 ? now + step : Math.max(min, now - (now % step === 0 ? step : now % step));
    }
    apply(next, true);
  };
  const minus = el("button", "step-btn", "-");
  const plus = el("button", "step-btn", "+");
  minus.setAttribute("aria-label", "Decrease");
  plus.setAttribute("aria-label", "Increase");
  minus.addEventListener("click", () => nudge(-1));
  plus.addEventListener("click", () => nudge(1));

  wrap.append(minus, slider, plus, input);
  return wrap;
}

export function emptyNote(parent: HTMLElement, text: string): void {
  parent.append(el("p", "muted", text));
}
