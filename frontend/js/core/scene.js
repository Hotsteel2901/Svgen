/**
 * The scene document and its store.
 *
 * One mutable document, one change event, one history stack. Everything the UI
 * does goes through `mutate()` (undoable) or `live()` + `commit()` (drag
 * gestures that collapse into a single undo step).
 */

import { Emitter } from "./emitter.js";
import { uid, deepClone, clamp } from "./util.js";
import { sampleTrack, putKey, removeKeyAt, keyAt, isAnimated, shiftKeys } from "./anim.js";
import { createElement, ANIMATABLE } from "./elements.js";

export const SCENE_FORMAT = "svgen.scene";
export const SCENE_VERSION = 2;

export class Scene extends Emitter {
  constructor(doc) {
    super();
    this.doc = doc ? normalizeDocument(doc) : blankDocument();
    this._liveSnapshot = null;
    this._liveDepth = 0;
  }

  /* ------------------------------------------------------------ access */

  get canvas() {
    return this.doc.canvas;
  }

  get elements() {
    return this.doc.elements;
  }

  get selection() {
    return this.doc.selection;
  }

  element(id) {
    if (!id) return null;
    return this.doc.elements.find((e) => e.id === id) || null;
  }

  selectedElements() {
    return this.doc.selection.map((id) => this.element(id)).filter(Boolean);
  }

  /** The element the inspector edits (first selected). */
  primary() {
    return this.element(this.doc.selection[0]);
  }

  indexOf(id) {
    return this.doc.elements.findIndex((e) => e.id === id);
  }

  /* ------------------------------------------------------------ time */

  get time() {
    return this.doc.time;
  }

  setTime(t, { emit = true } = {}) {
    const clamped = clamp(t, 0, this.doc.canvas.duration);
    if (clamped === this.doc.time) return false;
    this.doc.time = clamped;
    if (emit) this.emit("time", clamped);
    return true;
  }

  /* ------------------------------------------------------------ resolve */

  /**
   * Resolve every animatable property of an element at time t.
   * Returns a shallow overlay — callers must not mutate it.
   */
  resolve(el, t) {
    const keys = el.keys;
    if (!keys || !isAnimated(keys)) return el;
    const out = Object.create(el);
    for (const prop of ANIMATABLE) {
      const track = keys[prop];
      if (track && track.length) out[prop] = sampleTrack(track, t, el[prop]);
    }
    return out;
  }

  /* ------------------------------------------------------------ history */

  /**
   * Undoable change. `fn` may mutate freely; if the document actually changed,
   * one history entry labelled `label` is recorded.
   */
  mutate(label, fn) {
    const before = this.snapshot();
    const result = fn(this.doc);
    const after = this.snapshot();
    if (after === before) return result;
    this.emit("history", { label, doc: after, before });
    this.bump();
    this.emit("change", { label, kind: "mutate" });
    return result;
  }

  /**
   * Begin a live gesture (drag). No history entry yet; callers emit freely.
   * Nested calls are reference-counted so composite gestures work.
   */
  live(fn) {
    if (this._liveDepth === 0) this._liveSnapshot = this.snapshot();
    this._liveDepth += 1;
    try {
      const result = fn ? fn(this.doc) : undefined;
      this.bump();
      this.emit("change", { kind: "live" });
      return result;
    } finally {
      this._liveDepth -= 1;
    }
  }

  /** Close the gesture started by `live()`; records one undo step if changed. */
  commit(label) {
    if (this._liveDepth > 0) return false;
    const before = this._liveSnapshot;
    this._liveSnapshot = null;
    if (!before) return false;
    const after = this.snapshot();
    if (after === before) return false;
    this.emit("history", { label, doc: after, before });
    this.emit("change", { label, kind: "commit" });
    return true;
  }

  cancel() {
    const before = this._liveSnapshot;
    this._liveSnapshot = null;
    this._liveDepth = 0;
    if (before) {
      this.doc = JSON.parse(before);
      this.bump();
      this.emit("change", { kind: "cancel" });
    }
  }

  restore(doc) {
    this.doc = normalizeDocument(JSON.parse(doc));
    this.bump();
    this.emit("change", { kind: "restore" });
  }

  /** Compact, stable serialization used for history + dirty checks. */
  snapshot() {
    return JSON.stringify(this.doc, skipPrivate);
  }

  toJSON() {
    return JSON.parse(this.snapshot());
  }

  /** Invalidate caches that key off `_rev`. */
  bump() {
    this._rev = (this._rev || 0) + 1;
  }

  /* ------------------------------------------------------------ elements */

  add(el, { select = true, label = "add" } = {}) {
    const element = el.type ? el : createElement(el);
    this.mutate(label, (doc) => {
      doc.elements.push(element);
      if (select) doc.selection = [element.id];
    });
    return element;
  }

  addMany(elements, { select = true, label = "add-many" } = {}) {
    if (!elements.length) return [];
    this.mutate(label, (doc) => {
      doc.elements.push(...elements);
      if (select) doc.selection = elements.map((e) => e.id);
    });
    return elements;
  }

  remove(ids, label = "delete") {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    if (!set.size) return 0;
    let removed = 0;
    this.mutate(label, (doc) => {
      const before = doc.elements.length;
      doc.elements = doc.elements.filter((e) => !set.has(e.id));
      removed = before - doc.elements.length;
      doc.selection = doc.selection.filter((id) => !set.has(id));
    });
    return removed;
  }

  duplicate(ids) {
    const sources = (Array.isArray(ids) ? ids : [ids]).map((id) => this.element(id)).filter(Boolean);
    if (!sources.length) return [];
    const copies = sources.map((src) => {
      const copy = deepClone(toPlain(src));
      copy.id = uid(copy.type);
      copy.x += 24;
      copy.y += 24;
      copy.name = nextCopyName(this.doc.elements, src);
      return copy;
    });
    return this.addMany(copies, { label: "duplicate" });
  }

  /** Apply a patch to every selected element (or an explicit list). */
  update(patch, { ids = this.doc.selection, label = "update", live = false } = {}) {
    const apply = (doc) => {
      for (const id of ids) {
        const el = doc.elements.find((e) => e.id === id);
        if (!el || el.locked) continue;
        Object.assign(el, patch);
        el._rev = (el._rev | 0) + 1;
      }
    };
    if (live) return this.live(apply);
    return this.mutate(label, apply);
  }

  updateElement(id, patch, { label = "update", live = false } = {}) {
    return this.update(patch, { ids: [id], label, live });
  }

  /** Move an element within the z-order. */
  reorder(id, toIndex, label = "reorder") {
    this.mutate(label, (doc) => {
      const from = doc.elements.findIndex((e) => e.id === id);
      if (from < 0) return;
      const to = clamp(toIndex, 0, doc.elements.length - 1);
      if (from === to) return;
      const [el] = doc.elements.splice(from, 1);
      doc.elements.splice(to, 0, el);
    });
  }

  reorderMany(ids, delta, label = "reorder") {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    if (!set.size) return;
    this.mutate(label, (doc) => {
      if (delta > 0) {
        for (let i = doc.elements.length - 2; i >= 0; i--) {
          if (set.has(doc.elements[i].id) && !set.has(doc.elements[i + 1].id)) {
            [doc.elements[i], doc.elements[i + 1]] = [doc.elements[i + 1], doc.elements[i]];
          }
        }
      } else {
        for (let i = 1; i < doc.elements.length; i++) {
          if (set.has(doc.elements[i].id) && !set.has(doc.elements[i - 1].id)) {
            [doc.elements[i], doc.elements[i - 1]] = [doc.elements[i - 1], doc.elements[i]];
          }
        }
      }
    });
  }

  /* ------------------------------------------------------------ selection */

  select(ids, { additive = false, toggle = false } = {}) {
    const list = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
    let next;
    if (toggle) {
      const set = new Set(this.doc.selection);
      for (const id of list) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      next = Array.from(set);
    } else if (additive) {
      const set = new Set(this.doc.selection);
      for (const id of list) set.add(id);
      next = Array.from(set);
    } else {
      next = list.slice();
    }
    if (sameArray(next, this.doc.selection)) return false;
    this.doc.selection = next;
    this.emit("selection", next);
    return true;
  }

  selectAll() {
    this.select(this.doc.elements.filter((e) => !e.locked && e.visible).map((e) => e.id));
  }

  clearSelection() {
    return this.select([]);
  }

  /* ------------------------------------------------------------ keyframes */

  setKey(elementId, prop, t, value, ease = "linear", label = "keyframe") {
    const el = this.element(elementId);
    if (!el) return null;
    let key = null;
    this.mutate(label, () => {
      if (!el.keys[prop]) el.keys[prop] = [];
      key = putKey(el.keys[prop], round(t), value, ease);
    });
    return key;
  }

  /** Toggle a keyframe for `prop` at time t, seeding it with the live value. */
  toggleKey(elementId, prop, t) {
    const el = this.element(elementId);
    if (!el) return false;
    const existing = keyAt(el.keys[prop], t);
    if (existing) {
      this.mutate("keyframe-remove", () => removeKeyAt(el.keys[prop], t));
      return false;
    }
    const value = isAnimated(el.keys) ? sampleTrack(el.keys[prop], t, el[prop]) : el[prop];
    this.mutate("keyframe-add", () => {
      if (!el.keys[prop]) el.keys[prop] = [];
      putKey(el.keys[prop], round(t), value);
    });
    return true;
  }

  removeKey(elementId, prop, t) {
    const el = this.element(elementId);
    if (!el) return;
    this.mutate("keyframe-remove", () => removeKeyAt(el.keys[prop], t));
  }

  moveKey(elementId, prop, fromT, toT, label = "keyframe-move") {
    const el = this.element(elementId);
    if (!el || !el.keys[prop]) return;
    this.mutate(label, () => {
      const k = keyAt(el.keys[prop], fromT);
      if (!k) return;
      const clash = keyAt(el.keys[prop], toT);
      if (clash && clash !== k) removeKeyAt(el.keys[prop], toT);
      k.t = round(clamp(toT, 0, this.doc.canvas.duration));
      el.keys[prop].sort((a, b) => a.t - b.t);
    });
  }

  setKeyValue(elementId, prop, t, value, label = "keyframe-value") {
    const el = this.element(elementId);
    if (!el) return;
    this.mutate(label, () => {
      const k = keyAt(el.keys[prop], t);
      if (k) k.v = value;
      else putKey(el.keys[prop] || (el.keys[prop] = []), t, value);
    });
  }

  setKeyEase(elementId, prop, t, ease, bez) {
    const el = this.element(elementId);
    if (!el) return;
    this.mutate("keyframe-ease", () => {
      const k = keyAt(el.keys[prop], t);
      if (!k) return;
      k.e = ease;
      if (bez) k.b = bez;
      else if (ease !== "bezier") delete k.b;
    });
  }

  setTrackEase(elementId, prop, ease) {
    const el = this.element(elementId);
    if (!el || !el.keys[prop]) return;
    this.mutate("track-ease", () => {
      for (const k of el.keys[prop]) {
        k.e = ease;
        if (ease !== "bezier") delete k.b;
      }
    });
  }

  clearKeys(elementId, prop) {
    const el = this.element(elementId);
    if (!el) return;
    this.mutate("keys-clear", () => {
      if (prop) delete el.keys[prop];
      else el.keys = {};
    });
  }

  /** Remove a whole property track including the keyframe times. */
  removeTrack(elementId, prop) {
    this.clearKeys(elementId, prop);
  }

  shiftAllKeys(dt) {
    this.mutate("keys-shift", (doc) => {
      for (const el of doc.elements) shiftKeys(el.keys, dt);
    });
  }

  /* ------------------------------------------------------------ canvas */

  setCanvas(patch, label = "canvas") {
    this.mutate(label, (doc) => Object.assign(doc.canvas, patch));
  }

  /* ------------------------------------------------------------ document */

  replaceDocument(doc, { label = "replace" } = {}) {
    this.mutate(label, () => {
      this.doc = normalizeDocument(doc);
    });
    this.emit("selection", this.doc.selection);
  }

  reset() {
    this.doc = blankDocument();
    this.bump();
    this.emit("selection", this.doc.selection);
    this.emit("change", { kind: "reset" });
  }

  bounds() {
    return { w: this.doc.canvas.width, h: this.doc.canvas.height };
  }
}

/* ---------------------------------------------------------------- helpers */

const round = (v) => Math.round(v * 1000) / 1000;

function sameArray(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** JSON replacer that drops internal `_`-prefixed bookkeeping fields. */
function skipPrivate(key, value) {
  if (key.startsWith("_")) return undefined;
  return value;
}

export function toPlain(el) {
  return JSON.parse(JSON.stringify(el, skipPrivate));
}

function nextCopyName(elements, src) {
  const base = (src.name || src.type).replace(/\s+\d+$/, "");
  let n = 2;
  const taken = new Set(elements.map((e) => e.name));
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function blankDocument() {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: "",
    canvas: {
      width: 1280,
      height: 720,
      background: null,
      fps: 30,
      duration: 3,
    },
    elements: [],
    selection: [],
    time: 0,
    loop: true,
    onion: false,
    snap: true,
    grid: 20,
    showGrid: false,
  };
}

/** Coerce any historical / partial document into the v2 shape. */
export function normalizeDocument(raw) {
  const base = blankDocument();
  if (!raw || typeof raw !== "object") return base;

  const doc = { ...base };
  doc.name = typeof raw.name === "string" ? raw.name : base.name;

  const canvas = raw.canvas || {};
  doc.canvas = {
    width: positive(canvas.width, raw.width, 1280),
    height: positive(canvas.height, raw.height, 720),
    background: normalizeBackground(canvas.background ?? raw.bgColor ?? null),
    fps: clamp(Math.round(canvas.fps ?? raw.fps ?? 30) || 30, 1, 120),
    duration: Math.max(0.05, Number(canvas.duration ?? raw.duration ?? 3) || 3),
  };

  doc.loop = raw.loop !== false;
  doc.onion = !!raw.onion;
  doc.snap = raw.snap !== false;
  doc.grid = clamp(Number(raw.grid) || 20, 1, 500);
  doc.showGrid = !!raw.showGrid;
  doc.time = clamp(Number(raw.time) || 0, 0, doc.canvas.duration);

  const source = Array.isArray(raw.elements) ? raw.elements : Array.isArray(raw.layers) ? raw.layers : [];
  doc.elements = source.map((e) => normalizeElement(e)).filter(Boolean);

  const ids = new Set(doc.elements.map((e) => e.id));
  const selection = Array.isArray(raw.selection) ? raw.selection : raw.selectedId ? [raw.selectedId] : [];
  doc.selection = selection.filter((id) => ids.has(id));

  return doc;
}

function positive(...candidates) {
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.min(20000, Math.round(n));
  }
  return 1280;
}

function normalizeBackground(bg) {
  if (!bg || bg === "transparent" || bg === "none") return null;
  return String(bg);
}

const LEGACY_TYPE = {
  rounded: "rect",
  pen: "path",
  poly: "polygon",
};

function normalizeElement(raw) {
  if (!raw || typeof raw !== "object") return null;
  const legacyType = LEGACY_TYPE[raw.type] || raw.type;
  const type = ["rect", "ellipse", "polygon", "star", "line", "arrow", "path", "text"].includes(legacyType)
    ? legacyType
    : "rect";

  const el = createElement(type);
  el.id = typeof raw.id === "string" && raw.id ? raw.id : uid(type);
  el.name = typeof raw.name === "string" ? raw.name : "";
  el.visible = raw.visible !== false;
  el.locked = !!raw.locked;

  el.x = finite(raw.x, 0);
  el.y = finite(raw.y, 0);
  el.rotation = finite(raw.rotation, 0);
  el.scaleX = finite(raw.scaleX, finite(raw.scale, 1));
  el.scaleY = finite(raw.scaleY, finite(raw.scale, 1));
  el.opacity = clamp(finite(raw.opacity, 1), 0, 1);

  el.w = Math.max(1, finite(raw.w, finite(raw.width, el.w)));
  el.h = Math.max(0, finite(raw.h, finite(raw.height, el.h)));
  if (type === "rect" && raw.type === "rounded" && !raw.rx) el.rx = 24;
  el.rx = Math.max(0, finite(raw.rx, el.rx));
  el.sides = clamp(Math.round(finite(raw.sides, el.sides)), 3, 60);
  el.innerRatio = clamp(finite(raw.innerRatio, el.innerRatio), 0.05, 0.95);

  if (Array.isArray(raw.points)) {
    el.points = raw.points
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]);
  }
  el.closed = !!raw.closed;
  el.smooth = !!raw.smooth;

  el.text = typeof raw.text === "string" ? raw.text : el.text;
  el.fontSize = Math.max(4, finite(raw.fontSize, el.fontSize));
  el.fontWeight = clamp(Math.round(finite(raw.fontWeight, el.fontWeight) / 100) * 100, 100, 900);
  el.fontFamily = typeof raw.fontFamily === "string" ? raw.fontFamily : el.fontFamily;
  el.align = ["left", "center", "right"].includes(raw.align) ? raw.align : el.align;

  el.fill = normalizePaintString(raw.fill, el.fill);
  el.stroke = normalizePaintString(raw.stroke, el.stroke);
  el.strokeWidth = Math.max(0, finite(raw.strokeWidth, el.strokeWidth));
  el.strokeCap = ["butt", "round", "square"].includes(raw.strokeCap) ? raw.strokeCap : el.strokeCap;
  el.strokeJoin = ["miter", "round", "bevel"].includes(raw.strokeJoin) ? raw.strokeJoin : el.strokeJoin;
  el.dash = Math.max(0, finite(raw.dash, 0));

  el.keys = normalizeKeys(raw.keys);

  return el;
}

function normalizePaintString(value, fallback) {
  if (value === null || value === "none") return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function normalizeKeys(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const prop of Object.keys(raw)) {
    const list = raw[prop];
    if (!Array.isArray(list)) continue;
    const keys = [];
    for (const entry of list) {
      let t;
      let v;
      let e = "linear";
      let b;
      if (Array.isArray(entry)) {
        t = Number(entry[0]);
        v = Number(entry[1]);
      } else if (entry && typeof entry === "object") {
        t = Number(entry.t);
        v = Number(entry.v);
        if (typeof entry.e === "string") e = entry.e;
        if (Array.isArray(entry.b) && entry.b.length === 4) b = entry.b.map(Number);
      }
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      const key = { t: Math.max(0, t), v, e };
      if (b) key.b = b;
      keys.push(key);
    }
    keys.sort((a, c) => a.t - c.t);
    if (keys.length) out[prop] = keys;
  }
  return out;
}

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
