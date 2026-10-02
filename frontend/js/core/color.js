/**
 * Colour utilities. One canonical representation everywhere: RGBA 0-255 + alpha 0-1.
 */

/** The CSS/SVG named colours. Enough for real-world SVG import. */
export const NAMED = {
  transparent: [0, 0, 0, 0],
  none: null,
  black: [0, 0, 0, 1], silver: [192, 192, 192, 1], gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1], white: [255, 255, 255, 1], maroon: [128, 0, 0, 1],
  red: [255, 0, 0, 1], purple: [128, 0, 128, 1], fuchsia: [255, 0, 255, 1],
  green: [0, 128, 0, 1], lime: [0, 255, 0, 1], olive: [128, 128, 0, 1],
  yellow: [255, 255, 0, 1], navy: [0, 0, 128, 1], blue: [0, 0, 255, 1],
  teal: [0, 128, 128, 1], aqua: [0, 255, 255, 1], cyan: [0, 255, 255, 1],
  magenta: [255, 0, 255, 1], orange: [255, 165, 0, 1], pink: [255, 192, 203, 1],
  brown: [165, 42, 42, 1], gold: [255, 215, 0, 1], indigo: [75, 0, 130, 1],
  violet: [238, 130, 238, 1], turquoise: [64, 224, 208, 1], salmon: [250, 128, 114, 1],
  crimson: [220, 20, 60, 1], khaki: [240, 230, 140, 1], orchid: [218, 112, 214, 1],
  plum: [221, 160, 221, 1], tan: [210, 180, 140, 1], beige: [245, 245, 220, 1],
  ivory: [255, 255, 240, 1], azure: [240, 255, 255, 1], mintcream: [245, 255, 250, 1],
  snow: [255, 250, 250, 1], whitesmoke: [245, 245, 245, 1], gainsboro: [220, 220, 220, 1],
  lightgray: [211, 211, 211, 1], lightgrey: [211, 211, 211, 1], dimgray: [105, 105, 105, 1],
  dimgrey: [105, 105, 105, 1], slategray: [112, 128, 144, 1], slategrey: [112, 128, 144, 1],
  steelblue: [70, 130, 180, 1], royalblue: [65, 105, 225, 1], dodgerblue: [30, 144, 255, 1],
  skyblue: [135, 206, 235, 1], lightblue: [173, 216, 230, 1], deepskyblue: [0, 191, 255, 1],
  midnightblue: [25, 25, 112, 1], seagreen: [46, 139, 87, 1], forestgreen: [34, 139, 34, 1],
  limegreen: [50, 205, 50, 1], springgreen: [0, 255, 127, 1], mediumseagreen: [60, 179, 113, 1],
  darkgreen: [0, 100, 0, 1], darkred: [139, 0, 0, 1], firebrick: [178, 34, 34, 1],
  orangered: [255, 69, 0, 1], tomato: [255, 99, 71, 1], coral: [255, 127, 80, 1],
  darkorange: [255, 140, 0, 1], goldenrod: [218, 165, 32, 1], darkgoldenrod: [184, 134, 11, 1],
  chocolate: [210, 105, 30, 1], sienna: [160, 82, 45, 1], peru: [205, 133, 63, 1],
  wheat: [245, 222, 179, 1], darkviolet: [148, 0, 211, 1], blueviolet: [138, 43, 226, 1],
  mediumpurple: [147, 112, 219, 1], slateblue: [106, 90, 205, 1], darkorchid: [153, 50, 204, 1],
  hotpink: [255, 105, 180, 1], deeppink: [255, 20, 147, 1], palevioletred: [219, 112, 147, 1],
  lightpink: [255, 182, 193, 1], thistle: [216, 191, 216, 1], lavender: [230, 230, 250, 1],
  honeydew: [240, 255, 240, 1], aliceblue: [240, 248, 255, 1], ghostwhite: [248, 248, 255, 1],
  seashell: [255, 245, 238, 1], linen: [250, 240, 230, 1], oldlace: [253, 245, 230, 1],
  papayawhip: [255, 239, 213, 1], blanchedalmond: [255, 235, 205, 1], bisque: [255, 228, 196, 1],
  peachpuff: [255, 218, 185, 1], navajowhite: [255, 222, 173, 1], moccasin: [255, 228, 181, 1],
  cornsilk: [255, 248, 220, 1], lemonchiffon: [255, 250, 205, 1], lightyellow: [255, 255, 224, 1],
  lightgoldenrodyellow: [250, 250, 210, 1], palegreen: [152, 251, 152, 1], lightgreen: [144, 238, 144, 1],
  darkseagreen: [143, 188, 143, 1], paleturquoise: [175, 238, 238, 1], lightcyan: [224, 255, 255, 1],
  powderblue: [176, 224, 230, 1], lightsteelblue: [176, 196, 222, 1], cadetblue: [95, 158, 160, 1],
  darkcyan: [0, 139, 139, 1], darkturquoise: [0, 206, 209, 1], mediumturquoise: [72, 209, 204, 1],
  aquamarine: [127, 255, 212, 1], mediumaquamarine: [102, 205, 170, 1], darkolivegreen: [85, 107, 47, 1],
  olivedrab: [107, 142, 35, 1], yellowgreen: [154, 205, 50, 1], greenyellow: [173, 255, 47, 1],
  chartreuse: [127, 255, 0, 1], lawngreen: [124, 252, 0, 1], palegoldenrod: [238, 232, 170, 1],
  darkkhaki: [189, 183, 107, 1], rosybrown: [188, 143, 143, 1], indianred: [205, 92, 92, 1],
  darksalmon: [233, 150, 122, 1], lightsalmon: [255, 160, 122, 1], darkmagenta: [139, 0, 139, 1],
  mediumvioletred: [199, 21, 133, 1], rebeccapurple: [102, 51, 153, 1], darkslategray: [47, 79, 79, 1],
};

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN = /^rgba?\(([^)]+)\)$/i;
const HSL_FN = /^hsla?\(([^)]+)\)$/i;

/**
 * Parse any CSS/SVG colour into [r, g, b, a] (0-255, 0-1).
 * Returns null for `none`/invalid — callers treat null as "no paint".
 */
export function parseColor(input) {
  if (input == null) return null;
  if (Array.isArray(input)) return input.slice(0, 4);
  const s = String(input).trim().toLowerCase();
  if (!s || s === "none" || s === "currentcolor") return null;
  if (s in NAMED) {
    const v = NAMED[s];
    return v ? v.slice() : null;
  }
  let m = HEX8.exec(s);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), parseInt(m[4], 16) / 255];
  m = HEX6.exec(s);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1];
  m = HEX4.exec(s);
  if (m) {
    const d = (h) => parseInt(h + h, 16);
    return [d(m[1]), d(m[2]), d(m[3]), d(m[4]) / 255];
  }
  m = HEX3.exec(s);
  if (m) {
    const d = (h) => parseInt(h + h, 16);
    return [d(m[1]), d(m[2]), d(m[3]), 1];
  }
  m = RGB_FN.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const chan = (p) => {
      const v = parseFloat(p);
      if (!Number.isFinite(v)) return 0;
      return p.endsWith("%") ? Math.round((v / 100) * 255) : Math.round(v);
    };
    const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return [chan(parts[0]), chan(parts[1]), chan(parts[2]), Number.isFinite(a) ? a : 1];
  }
  m = HSL_FN.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = ((parseFloat(parts[0]) % 360) + 360) % 360 / 360;
    const sat = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return [...hslToRgb(h, sat, l), Number.isFinite(a) ? a : 1];
  }
  return null;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** [r,g,b,a] → "#rrggbb" (alpha dropped) or "#rrggbbaa" when a < 1. */
export function toHex(rgba, withAlpha = false) {
  if (!rgba) return "none";
  const [r, g, b, a = 1] = rgba;
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  if (!withAlpha || a >= 0.999) return base;
  return base + hex2(a * 255);
}

/** [r,g,b,a] → "rgb(...)" / "rgba(...)" for canvas. */
export function toCss(rgba) {
  if (!rgba) return "transparent";
  const r = Math.round(rgba[0]);
  const g = Math.round(rgba[1]);
  const b = Math.round(rgba[2]);
  const a = rgba.length > 3 && rgba[3] !== undefined ? rgba[3] : 1;
  return a >= 0.999
    ? `rgb(${r},${g},${b})`
    : `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
}

/** Opaque hex that can be fed to <input type=color> (which has no alpha). */
export function toOpaqueHex(rgba) {
  if (!rgba) return "#000000";
  return toHex([rgba[0], rgba[1], rgba[2], 1]);
}

export function mixColor(a, b, t) {
  const ca = parseColor(a) || [0, 0, 0, 0];
  const cb = parseColor(b) || [0, 0, 0, 0];
  return [
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
    ca[3] + (cb[3] - ca[3]) * t,
  ];
}

/** Relative luminance (WCAG). Used to pick readable overlays on swatches. */
export function luminance(rgba) {
  const c = rgba || [0, 0, 0, 1];
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

export function readableInk(rgba, light = "#ffffff", dark = "#101114") {
  return luminance(rgba) > 0.45 ? dark : light;
}

/** The studio's default swatch row — tuned to the Aperture palette. */
export const DEFAULT_SWATCHES = [
  "#0a0b0d", "#3a3f47", "#6d7686", "#a3abba", "#edeff3", "#ffffff",
  "#cbff4d", "#58d68d", "#6fc7ff", "#b79cff", "#ff8a5b", "#ff5f6d",
  "#ffcf5c", "#ff7ab8", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e",
];
