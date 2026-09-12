/** Small DOM helpers shared by the panels and views. */

import { el } from "./format";

export function section(parent: HTMLElement, title: string, action?: HTMLElement): HTMLElement {
  const wrap = el("div", "section");
  const head = el("h3", undefined, title);
  if (action) {
    head.classList.add("with-action");
    head.append(action);
  }
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
  row.append(el("span", "stat-label", label));
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
