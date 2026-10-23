/**
 * Re-colouring for the terminal theme.
 *
 * The interface is styled with hundreds of hard-coded colours, so rather than
 * maintain a second stylesheet by hand, the terminal theme is derived from the
 * first by moving every colour into a phosphor palette: blues, teals and greys
 * become green, ambers stay amber, reds stay red, and lightness and
 * transparency are kept - so contrast, hierarchy and the meaning of warning
 * colours survive the change. The same function re-colours the map canvas.
 *
 * Used by the theme generator (tools/make-theme.ts) and by the map renderer.
 */

interface Hsl { h: number; s: number; l: number; a: number }

function parseColor(text: string): Hsl | null {
  let r: number, g: number, b: number, a = 1;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (hex) {
    const v = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    r = parseInt(v.slice(0, 2), 16); g = parseInt(v.slice(2, 4), 16); b = parseInt(v.slice(4, 6), 16);
  } else {
    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(text.trim());
    if (!rgb) return null;
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
    if (rgb[4] !== undefined) a = rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : Number(rgb[4]);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d > 1e-9) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l, a };
}

function format({ h, s, l, a }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255);
  if (a >= 0.999) return `#${[to(r), to(g), to(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${to(r)}, ${to(g)}, ${to(b)}, ${Math.round(a * 1000) / 1000})`;
}

const GREEN = 140;
const AMBER = 40;

/** One colour into the phosphor palette. Anything unparseable comes back unchanged. */
export function toPhosphor(text: string): string {
  const c = parseColor(text);
  if (!c) return text;
  let { h, s } = c;
  const { l, a } = c;

  if (s < 0.1) {
    // Greys and near-whites pick up a faint green cast.
    h = GREEN;
    s = l < 0.95 && l > 0.03 ? 0.14 : s;
  } else if (h >= 150 && h < 270) {
    // The interface's blues, teals and cyans: the main phosphor.
    h = GREEN + (h - 210) * 0.04;
    s = Math.min(0.9, s * 0.95 + (l < 0.3 ? 0.08 : 0.2));
  } else if (h >= 70 && h < 150) {
    // Greens stay green, on the same hue as everything else.
    h = GREEN;
  } else if (h >= 15 && h < 70) {
    // Yellows and golds become amber.
    h = AMBER + (h - 45) * 0.15;
  } else if (h >= 270 && h < 345) {
    // Purples and pinks have no place in a terminal: amber.
    h = AMBER;
    s = Math.min(1, s + 0.1);
  }
  // Reds (345-15) are left alone: an alarm should look like one.
  return format({ h, s, l, a });
}

/** Does this text contain a colour literal toPhosphor knows how to move? */
export const COLOR_PATTERN = /#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)/g;

/** Re-colour every colour literal in a CSS value. */
export function phosphorValue(value: string): string {
  return value.replace(COLOR_PATTERN, (match) => toPhosphor(match));
}
