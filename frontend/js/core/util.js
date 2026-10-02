/** Small, dependency-free helpers shared across the studio. */

/**
 * Clamp, with a NaN guard.
 *
 * `NaN < lo` and `NaN > hi` are both false, so a plain clamp passes NaN
 * straight through and poisons whatever it touches — which is exactly how a
 * bad gesture once turned a shape into NaN and made it vanish. A non-finite
 * input now yields the lower bound, which is the safe end for every caller
 * here (sizes, opacity, zoom).
 */
export const clamp = (v, lo, hi) => {
  // NaN compares false both ways, so a plain clamp lets it straight through.
  if (Number.isNaN(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
};

export const lerp = (a, b, t) => a + (b - a) * t;

export function round(v, dp = 3) {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** dp;
  const scaled = v * f;
  // Binary floats cannot hold most decimal halves exactly (1.005 * 100 is
  // 100.49999999999999), so nudge by a relative epsilon before rounding. Without
  // it a field showing "1" for a value of 1.005 would commit 1 on blur.
  const nudged = scaled + Math.sign(scaled) * Math.abs(scaled) * Number.EPSILON;
  return Math.round(nudged) / f;
}

/** Compact number formatting: 4 · 4.5 · -12.25 — never exponent soup. */
export function num(v, dp = 2) {
  if (!Number.isFinite(v)) return "0";
  const r = round(v, dp);
  return String(Object.is(r, -0) ? 0 : r);
}

export const uid = (() => {
  let seq = 0;
  return (prefix = "el") => {
    seq += 1;
    const rand = Math.random().toString(36).slice(2, 7);
    return `${prefix}_${seq.toString(36)}${rand}`;
  };
})();

/** Run `fn` at most once per animation frame, with the latest arguments. */
export function rafThrottle(fn) {
  let handle = 0;
  let lastArgs = null;
  const tick = () => {
    handle = 0;
    const args = lastArgs;
    lastArgs = null;
    fn(...args);
  };
  return (...args) => {
    lastArgs = args;
    if (!handle) handle = requestAnimationFrame(tick);
  };
}

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Trailing-edge throttle that always fires the final call. */
export function throttle(fn, ms) {
  let last = 0;
  let timer = 0;
  let pending = null;
  const invoke = () => {
    last = performance.now();
    timer = 0;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };
  return (...args) => {
    pending = args;
    const now = performance.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      clearTimeout(timer);
      invoke();
    } else if (!timer) {
      timer = setTimeout(invoke, wait);
    }
  };
}

export function deepClone(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* falls through to JSON for exotic values */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function escapeXML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Pull every number out of a string, the way the backend's `parse_float_list`
 * does. Commas, whitespace, semicolons and stray junk are all tolerated, so an
 * SVG that the Python side accepts is never rejected by the front-end.
 */
export function parseNumbers(str) {
  if (str === null || str === undefined) return [];
  const matches = String(str).match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g);
  if (!matches) return [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error || new Error("read failed"));
    fr.readAsText(file);
  });
}

export function readFileArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error("read failed"));
    fr.readAsArrayBuffer(file);
  });
}

/** Filesystem-safe filename stem. */
export function safeName(name, fallback = "artwork") {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

/** Deep-ish equality, good enough for scene snapshots. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/** Monotonic clock, ms. */
export const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/** Format seconds for the timeline as 0:00.00 style timecode. */
export function timecode(seconds, fps = 30) {
  const s = Math.max(0, seconds || 0);
  const frames = Math.round(s * fps) % Math.max(1, Math.round(fps));
  const secs = Math.floor(s);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${mm}:${String(ss).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
}
