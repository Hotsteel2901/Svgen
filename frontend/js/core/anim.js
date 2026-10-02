/**
 * Keyframe model, easing and sampling.
 *
 * A property track is an array of keys sorted by time:
 *   { t: seconds, v: number, e: easingName, b?: [x1,y1,x2,y2] }
 * `e` describes how the segment *leaving* this key interpolates toward the next.
 */

export const EASINGS = ["linear", "hold", "in", "out", "inout", "bezier"];

export const EASING_LABEL = {
  linear: "Linear",
  hold: "Hold",
  in: "Ease In",
  out: "Ease Out",
  inout: "Ease In-Out",
  bezier: "Custom",
};

/* -------------------------------------------------------------- cubic bezier */

function bezA(a1, a2) {
  return 1 - 3 * a2 + 3 * a1;
}
function bezB(a1, a2) {
  return 3 * a2 - 6 * a1;
}
function bezC(a1) {
  return 3 * a1;
}

function bezSolve(t, a1, a2) {
  // Newton-Raphson, then bisection if it wanders.
  let x = t;
  for (let i = 0; i < 8; i++) {
    const x2 = x * x;
    const x3 = x2 * x;
    const cur = bezA(a1, a2) * x3 + bezB(a1, a2) * x2 + bezC(a1) * x;
    const d = cur - t;
    if (Math.abs(d) < 1e-6) return x;
    const dx = 3 * bezA(a1, a2) * x2 + 2 * bezB(a1, a2) * x + bezC(a1);
    if (Math.abs(dx) < 1e-7) break;
    x -= d / dx;
  }
  let lo = 0;
  let hi = 1;
  x = t;
  for (let i = 0; i < 24; i++) {
    const x2 = x * x;
    const cur = bezA(a1, a2) * x2 * x + bezB(a1, a2) * x2 + bezC(a1) * x;
    if (Math.abs(cur - t) < 1e-6) break;
    if (cur < t) lo = x;
    else hi = x;
    x = (lo + hi) / 2;
  }
  return x;
}

/** Evaluate a cubic-bezier timing function at progress p ∈ [0,1]. */
export function cubicBezier(p, x1, y1, x2, y2) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const t = bezSolve(p, x1, x2);
  const t2 = t * t;
  return bezA(y1, y2) * t2 * t + bezB(y1, y2) * t2 + bezC(y1) * t;
}

export function easeProgress(p, ease = "linear", bez) {
  switch (ease) {
    case "hold":
      return 0;
    case "in":
      return p * p;
    case "out":
      return 1 - (1 - p) * (1 - p);
    case "inout":
      return p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
    case "bezier": {
      const b = bez || [0.4, 0, 0.2, 1];
      return cubicBezier(p, b[0], b[1], b[2], b[3]);
    }
    default:
      return p;
  }
}

/* -------------------------------------------------------------- tracks */

/** Sorted copy of a track (keys are kept sorted in the model, so this is cheap). */
export function sorted(keys) {
  if (!keys || keys.length < 2) return keys || [];
  let ordered = true;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i - 1].t > keys[i].t) {
      ordered = false;
      break;
    }
  }
  return ordered ? keys : keys.slice().sort((a, b) => a.t - b.t);
}

/** Sample a track at time t. `fallback` is used when the track is empty. */
export function sampleTrack(keys, t, fallback) {
  if (!keys || keys.length === 0) return fallback;
  if (keys.length === 1) return keys[0].v;
  const list = sorted(keys);
  if (t <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (t >= last.t) return last.v;
  // binary search for the segment
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = list[lo];
  const b = list[hi];
  const span = b.t - a.t;
  if (span <= 1e-9) return b.v;
  const p = (t - a.t) / span;
  return a.v + (b.v - a.v) * easeProgress(p, a.e, a.b);
}

/** Insert-or-replace a key at time t. Returns the key object. */
export function putKey(keys, t, v, ease = "linear") {
  const list = keys || [];
  const EPS = 1e-4;
  for (const k of list) {
    if (Math.abs(k.t - t) < EPS) {
      k.v = v;
      return k;
    }
  }
  const key = { t, v, e: ease };
  list.push(key);
  list.sort((a, b) => a.t - b.t);
  return key;
}

export function removeKeyAt(keys, t, eps = 1e-4) {
  if (!keys) return false;
  const i = keys.findIndex((k) => Math.abs(k.t - t) < eps);
  if (i < 0) return false;
  keys.splice(i, 1);
  return true;
}

/** Alias for `putKey`, named for the "add a keyframe here" call site. */
export const setKeyframe = putKey;

/** Insert a key on an *element* (creates the track when needed). */
export function setElementKey(el, prop, t, v, ease = "linear") {
  if (!el.keys[prop]) el.keys[prop] = [];
  return putKey(el.keys[prop], t, v, ease);
}

export function keyAt(keys, t, eps = 1e-4) {
  if (!keys) return null;
  return keys.find((k) => Math.abs(k.t - t) < eps) || null;
}

/** Distinct key times across every track of an element, sorted. */
export function keyTimes(keysByProp) {
  const set = new Set();
  for (const prop of Object.keys(keysByProp || {})) {
    for (const k of keysByProp[prop]) set.add(Math.round(k.t * 1000));
  }
  return Array.from(set).map((ms) => ms / 1000).sort((a, b) => a - b);
}

export function nextKeyTime(keysByProp, t) {
  const times = keyTimes(keysByProp);
  return times.find((x) => x > t + 1e-4) ?? null;
}

export function prevKeyTime(keysByProp, t) {
  const times = keyTimes(keysByProp);
  for (let i = times.length - 1; i >= 0; i--) if (times[i] < t - 1e-4) return times[i];
  return null;
}

/** Shift every key in every track by dt seconds, clamped at 0. */
export function shiftKeys(keysByProp, dt) {
  for (const prop of Object.keys(keysByProp || {})) {
    for (const k of keysByProp[prop]) k.t = Math.max(0, k.t + dt);
    keysByProp[prop].sort((a, b) => a.t - b.t);
  }
}

/** Fast lookup of whether an element animates anything at all. */
export function isAnimated(keysByProp) {
  if (!keysByProp) return false;
  for (const p of Object.keys(keysByProp)) {
    if (keysByProp[p] && keysByProp[p].length > 0) return true;
  }
  return false;
}
