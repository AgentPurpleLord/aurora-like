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

export function numberInput(
  value: number,
  onChange: (value: number) => void,
  min = 1,
  max = 9999,
): HTMLInputElement {
  const input = el("input", "number-input");
  input.type = "number";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.addEventListener("change", () => {
    const parsed = Math.round(Number(input.value));
    const clamped = Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : min));
    input.value = String(clamped);
    onChange(clamped);
  });
  return input;
}

export function emptyNote(parent: HTMLElement, text: string): void {
  parent.append(el("p", "muted", text));
}
