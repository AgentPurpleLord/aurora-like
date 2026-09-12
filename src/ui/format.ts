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
