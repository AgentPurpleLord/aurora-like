/** Display formatting helpers shared by the UI panels. */

import { AU_KM } from "../sim/orbit";

export function num(v: number, digits = 0): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Compact tonnage / population figures. */
export function compact(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}b`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}m`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return num(v);
}

/** Partial pressures run from microbars to tens of atmospheres. */
export function formatPressure(atm: number): string {
  if (atm <= 0) return "0";
  if (atm >= 10) return atm.toFixed(0);
  if (atm >= 0.1) return atm.toFixed(3);
  if (atm >= 0.0001) return atm.toFixed(5);
  return atm.toExponential(1);
}

export function kelvinToCelsius(k: number): string {
  return `${(k - 273.15).toFixed(1)} C`;
}

export function distance(au: number): string {
  if (au >= 0.01) return `${au.toFixed(3)} AU`;
  const km = au * AU_KM;
  return `${num(km)} km`;
}

/** Light travel time - the number that decides how stale your sensor data is. */
export function lightTime(au: number): string {
  const seconds = (au * AU_KM) / 299_792.458;
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(2)} hr`;
}

/**
 * Population for a table column: always the same unit so a list of colonies
 * can be compared down the page.
 */
export function populationFixed(millions: number): string {
  if (millions <= 0) return "0";
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)}bn`;
  if (millions >= 10) return `${millions.toFixed(0)}m`;
  return `${millions.toFixed(2)}m`;
}

export function population(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)}bn`;
  if (millions >= 1) return `${millions.toFixed(1)}m`;
  return `${num(millions * 1e6)}`;
}

export function dayLength(rotationDays: number | undefined): string {
  if (rotationDays === undefined) return "-";
  const abs = Math.abs(rotationDays);
  const text = abs < 1 ? `${(abs * 24).toFixed(2)} hours` : `${abs.toFixed(2)} days`;
  return rotationDays < 0 ? `${text} (retrograde)` : text;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const EFFECT_NAMES: Record<string, string> = {
  industry: "Industry", mining: "Mining", fuel: "Fuel production", research: "Research", wealth: "Income", growth: "Population growth",
};

/** "Industry -30%, 3 months left" for a timed effect. */
export function describeEffect(effect: { kind: string; factor: number; until: number }, now: number): string {
  const change = Math.round((effect.factor - 1) * 100);
  const days = Math.max(0, Math.round((effect.until - now) / 86_400));
  const left = days >= 60 ? `${Math.round(days / 30)} months` : `${days} days`;
  return `${EFFECT_NAMES[effect.kind] ?? effect.kind} ${change >= 0 ? "+" : "-"}${Math.abs(change)}%, ${left} left`;
}

/**
 * Text that reads differently in the terminal theme: both are in the page and
 * the theme shows one. For headings only - "Attention" is "Threat board" on
 * the console. Anything a test or a screen reader depends on stays plain.
 */
export function themed(classic: string, terminal: string, className = ""): HTMLElement {
  const wrap = el("span", className);
  wrap.append(el("span", "th-c", classic), el("span", "th-t", terminal));
  return wrap;
}
