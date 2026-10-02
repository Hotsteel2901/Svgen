/**
 * Interaction: selection, transform handles, shape drafting, freehand, curves,
 * text placement and the eyedropper.
 *
 * Resize maths runs in the element's own design space. The handle opposite the
 * one being dragged is the anchor; its world position is captured once at
 * gesture start and the element is re-placed after every size change so the
 * anchor never drifts — which is what makes resizing a *rotated* shape behave.
 */

import {
  createElement,
  hitTest,
  localBounds,
  measureText,
  polygonPoints,
  refitPath,
  sceneBounds,
  toLocal,
  toScene,
  FONT_STACK,
} from "../core/elements.js";
import { HANDLES, handlePoint, worldCorners } from "../core/render.js";
import { clamp } from "../core/util.js";
import { rotatePoint, inversePoint } from "../core/transform.js";

const HANDLE_CURSOR = {
  nw: "nwse-resize", se: "nwse-resize",
  ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize",
  e: "ew-resize", w: "ew-resize",
  rotate: "grab",
};

const SHAPE_TOOLS = new Set(["rect", "rounded", "ellipse", "line", "arrow", "polygon", "star"]);

export class ToolController {
  constructor(scene, stage, { onEvent } = {}) {
    this.scene = scene;
    this.stage = stage;
    this.app = null; // attached by main.js once the App exists
    this.onEvent = onEvent || (() => {});
    this.tool = "select";
    this.gesture = null;
    this.draft = null;
    this.penPoints = null;
    this.cursorOverride = null;
  }

  attachApp(app) {
    this.app = app;
  }

  /* ------------------------------------------------------------ tool state */

  setTool(id) {
    if (id === this.tool) return;
    this.cancelGesture();
    this.tool = id;
    this.updateCursor(this.stage.pointer);
    this.onEvent("tool", id);
  }

  updateCursor(p) {
    const canvas = this.stage.canvas;
    canvas.className = "stage-canvas";
    if (this.cursorOverride) {
      canvas.style.cursor = this.cursorOverride;
      return;
    }
    canvas.style.cursor = "";
    if (this.gesture) {
      if (this.gesture.kind === "rotate") canvas.style.cursor = "grabbing";
      else if (this.gesture.handle) canvas.style.cursor = HANDLE_CURSOR[this.gesture.handle];
      else if (this.gesture.kind === "move") canvas.style.cursor = "move";
      return;
    }
    if (this.app.spaceDown || this.tool === "hand") {
      canvas.classList.add("tool-pan");
      return;
    }
    if (SHAPE_TOOLS.has(this.tool) || this.tool === "pen") canvas.classList.add("tool-draw");
    else if (this.tool === "path") canvas.classList.add("tool-draw");
    else if (this.tool === "text") canvas.classList.add("tool-text");
    else if (this.tool === "eyedropper") canvas.style.cursor = "crosshair";
    else if (this.tool === "select" && p) {
      const handle = this.hoverHandle(p);
      if (handle) canvas.style.cursor = HANDLE_CURSOR[handle] || "default";
    }
  }

  /* ------------------------------------------------------------ helpers */

  snap(v) {
    const doc = this.scene.doc;
    if (!doc.snap) return v;
    const step = Math.max(1, doc.grid);
    return Math.round(v / step) * step;
  }

  /** All resize/rotate handles of the current single selection, in world space. */
  handlePoints() {
    const doc = this.scene.doc;
    if (doc.selection.length !== 1) return [];
    const el = this.scene.element(doc.selection[0]);
    if (!el || el.locked) return [];
    const r = this.stage.renderer.resolve(el, doc.time);
    const corners = worldCorners(r);
    const pts = HANDLES.map((id) => ({ id, p: handlePoint(r, id, corners) }));
    const topMid = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
    const rad = ((r.rotation || 0) * Math.PI) / 180;
    const up = [-Math.sin(rad), -Math.cos(rad)];
    const tol = 30 / this.stage.view.zoom;
    pts.push({ id: "rotate", p: [topMid[0] + up[0] * tol, topMid[1] + up[1] * tol] });
    return pts;
  }

  hoverHandle(p) {
    if (!p || this.tool !== "select") return null;
    const tol = 7 / this.stage.view.zoom;
    for (const { id, p: hp } of this.handlePoints()) {
      if (Math.hypot(p.sceneX - hp[0], p.sceneY - hp[1]) <= tol) return id;
    }
    return null;
  }

  hit(p) {
    const doc = this.scene.doc;
    const tol = 5 / this.stage.view.zoom;
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const el = doc.elements[i];
      if (!el.visible || el.locked) continue;
      const r = this.stage.renderer.resolve(el, doc.time);
      if (hitTest(r, p.sceneX, p.sceneY, tol)) return el;
    }
    return null;
  }

  draftElements() {
    const out = [];
    if (this.draft) out.push(this.draft);
    if (this.penPoints && this.penPoints.preview) out.push(this.penPoints.preview);
    return out;
  }

  /* ------------------------------------------------------------ pointer */

  pointerDown(p, stage) {
    if (p.ctrl) return; // ctrl-drag is reserved by the browser
    switch (this.tool) {
      case "select": return this._selectDown(p, stage);
      case "hand": return;
      case "eyedropper": return this._pickColor(p);
      case "pen": return this._freehandStart(p);
      case "path": return this._curveClick(p);
      case "text": return this._placeText(p);
      default:
        if (SHAPE_TOOLS.has(this.tool)) return this._shapeStart(p);
    }
  }

  pointerMove(p, stage) {
    if (!this.gesture) {
      if (this.tool === "select") {
        const overHandle = this.hoverHandle(p);
        stage.setHover(overHandle ? null : this.hit(p)?.id ?? null);
        this.updateCursor(p);
      }
      if (this.penPoints) this._curveHover(p);
      this.app.onPointerIdle?.(p);
      return;
    }
    const g = this.gesture;
    switch (g.kind) {
      case "move": return this._move(g, p);
      case "resize": return this._resize(g, p);
      case "rotate": return this._rotate(g, p);
      case "marquee": return this._marquee(g, p);
      case "draw": return this._shapeUpdate(g, p);
      case "freehand": return this._freehandUpdate(p);
      default: return undefined;
    }
  }

  pointerUp(p, stage) {
    const g = this.gesture;
    this.gesture = null;
    this.stage.marquee = null;
    if (!g) {
      this.updateCursor(p);
      return;
    }
    switch (g.kind) {
      case "move":
      case "resize":
      case "rotate":
        this.scene.commit(g.label);
        this.app.markDirty();
        break;
      case "marquee":
        this._marqueeCommit(g, p);
        break;
      case "draw":
        this._shapeCommit(g);
        break;
      case "freehand":
        this._freehandCommit(g);
        break;
      default:
        break;
    }
    void stage;
    this.app.requestRender();
    this.updateCursor(p);
  }

  cancelGesture() {
    if (this.gesture) {
      this.scene.cancel();
      this.gesture = null;
    }
    this.draft = null;
    this.penPoints = null;
    this.stage.marquee = null;
    this.app.requestRender();
  }

  /* ------------------------------------------------------------ select */

  _selectDown(p, stage) {
    const doc = this.scene.doc;
    const handle = this.hoverHandle(p);
    const selected = this.scene.selectedElements();

    if (handle && selected.length === 1) {
      const el = selected[0];
      const r = this.stage.renderer.resolve(el, doc.time);
      const bounds = localBounds(r);
      const base = {
        el,
        start: { x: p.sceneX, y: p.sceneY },
        rotation: r.rotation || 0,
        scaleX: r.scaleX ?? 1,
        scaleY: r.scaleY ?? 1,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        bounds,
        label: handle === "rotate" ? "rotate" : "resize",
      };
      if (handle === "rotate") {
        this.gesture = {
          ...base,
          kind: "rotate",
          startAngle: Math.atan2(p.sceneY - r.y, p.sceneX - r.x) * (180 / Math.PI),
          origRotation: el.rotation,
        };
      } else {
        // The anchor is the opposite corner / edge, in design space.
        const anchorLocal = anchorFor(handle, bounds);
        const anchorWorld = toScene(
          { ...r, rotation: r.rotation || 0, scaleX: r.scaleX ?? 1, scaleY: r.scaleY ?? 1 },
          anchorLocal[0],
          anchorLocal[1]
        );
        this.gesture = { ...base, kind: "resize", handle, anchorLocal, anchorWorld };
      }
      this.scene.live();
      return;
    }

    const hitEl = this.hit(p);

    if (!hitEl) {
      if (!p.shift) this.scene.clearSelection();
      this.gesture = {
        kind: "marquee",
        origin: { x: p.sceneX, y: p.sceneY },
        additive: !!p.shift,
        base: p.shift ? doc.selection.slice() : [],
      };
      return;
    }

    if (p.shift) {
      this.scene.select(hitEl.id, { toggle: true });
    } else if (!doc.selection.includes(hitEl.id)) {
      this.scene.select(hitEl.id);
    }
    this.app.onSelectionChanged();

    const movable = this.scene.selectedElements().filter((e) => !e.locked);
    if (!movable.length) return;

    this.gesture = {
      kind: "move",
      label: "move",
      start: { x: p.sceneX, y: p.sceneY },
      moved: false,
      items: movable.map((el) => {
        const r = this.stage.renderer.resolve(el, doc.time);
        return {
          el,
          x: r.x,
          y: r.y,
          keysX: el.keys.x ? el.keys.x.map((k) => ({ ...k })) : null,
          keysY: el.keys.y ? el.keys.y.map((k) => ({ ...k })) : null,
        };
      }),
    };
    this.scene.live();
    void stage;
  }

  _move(g, p) {
    const doc = this.scene.doc;
    let dx = p.sceneX - g.start.x;
    let dy = p.sceneY - g.start.y;
    if (p.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (!g.moved && Math.hypot(dx, dy) < 0.4) return;
    g.moved = true;

    this.scene.live(() => {
      for (const item of g.items) {
        const nx = this.snap(item.x + dx);
        const ny = this.snap(item.y + dy);
        applyTranslation(item.el, nx, ny, doc.time, item);
        item.el._rev = (item.el._rev | 0) + 1;
      }
    });
    this.app.requestRender();
  }

  _resize(g, p) {
    const el = g.el;
    const shift = p.shift;
    const alt = p.alt;

    // Pointer in the element's unrotated, unscaled design space.
    const local = inversePoint(
      { x: g.x, y: g.y, rotation: g.rotation, scaleX: g.scaleX, scaleY: g.scaleY },
      p.sceneX,
      p.sceneY
    );

    const [ax, ay] = g.anchorLocal;
    let w = Math.abs(local.x - ax);
    let h = Math.abs(local.y - ay);
    const horizontal = g.handle.includes("w") || g.handle.includes("e");
    const vertical = g.handle.includes("n") || g.handle.includes("s");

    if (!horizontal) w = g.bounds.w;
    if (!vertical) h = g.bounds.h;

    if (shift && horizontal && vertical && g.bounds.w > 0 && g.bounds.h > 0) {
      const ratio = g.bounds.h / g.bounds.w;
      const scaled = Math.max(w, h / ratio);
      w = scaled;
      h = scaled * ratio;
    }

    w = this.snap(Math.max(1, w));
    h = this.snap(Math.max(el.type === "line" || el.type === "arrow" ? 0 : 1, h));

    if (el.type === "path" && el.points.length) {
      // Paths keep their shape because applySize scales the stored points.
      const nw = Math.max(1, w);
      const nh = Math.max(1, h);
      const sx = nw / Math.max(1e-6, el.w);
      const sy = nh / Math.max(1e-6, el.h);
      this.scene.live(() => {
        for (const pt of el.points) {
          pt[0] *= sx;
          pt[1] *= sy;
        }
        el.w = nw;
        el.h = nh;
        el._rev = (el._rev | 0) + 1;
      });
    } else {
      this.scene.live(() => {
        el.w = w;
        el.h = el.type === "line" || el.type === "arrow" ? 0 : h;
        el._rev = (el._rev | 0) + 1;
      });
    }

    // Re-place so the anchor stays pinned in world space.
    const newBounds = localBounds(el);
    const newAnchorLocal = anchorFor(g.handle, newBounds);
    const sx = el.scaleX ?? 1;
    const sy = el.scaleY ?? 1;
    const rotated = rotatePoint(newAnchorLocal[0] * sx, newAnchorLocal[1] * sy, el.rotation || 0);
    const nx = g.anchorWorld[0] - rotated[0];
    const ny = g.anchorWorld[1] - rotated[1];

    this.scene.live(() => {
      setPosition(el, nx, ny, this.scene.doc.time);
      el._rev = (el._rev | 0) + 1;
    });

    this.app.requestRender();
  }

  _rotate(g, p) {
    const el = g.el;
    const angle = Math.atan2(p.sceneY - g.y, p.sceneX - g.x) * (180 / Math.PI);
    let next = g.origRotation + (angle - g.startAngle);
    if (p.shift) next = Math.round(next / 15) * 15;
    next = ((next % 360) + 360) % 360;
    this.scene.live(() => {
      setProperty(el, "rotation", Math.round(next * 100) / 100, this.scene.doc.time);
      el._rev = (el._rev | 0) + 1;
    });
    this.app.requestRender();
  }

  _marquee(g, p) {
    const x = Math.min(g.origin.x, p.sceneX);
    const y = Math.min(g.origin.y, p.sceneY);
    const w = Math.abs(p.sceneX - g.origin.x);
    const h = Math.abs(p.sceneY - g.origin.y);
    this.stage.marquee = { x, y, w, h };
    this.app.requestRender();
  }

  _marqueeCommit(g, p) {
    const box = {
      x: Math.min(g.origin.x, p.sceneX),
      y: Math.min(g.origin.y, p.sceneY),
      w: Math.abs(p.sceneX - g.origin.x),
      h: Math.abs(p.sceneY - g.origin.y),
    };
    if (box.w < 2 && box.h < 2) return;
    const doc = this.scene.doc;
    const ids = [];
    for (const el of doc.elements) {
      if (!el.visible || el.locked) continue;
      const r = this.stage.renderer.resolve(el, doc.time);
      const b = sceneBounds(r);
      const overlaps =
        b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
      if (overlaps) ids.push(el.id);
    }
    const next = g.additive ? Array.from(new Set([...g.base, ...ids])) : ids;
    this.scene.select(next);
    this.app.onSelectionChanged();
  }

  /* ------------------------------------------------------------ shapes */

  _shapeStart(p) {
    const type = this.tool === "rounded" ? "rect" : this.tool;
    const el = this.app.newElement(type);
    if (this.tool === "rounded") el.rx = 28;
    el.x = this.snap(p.sceneX);
    el.y = this.snap(p.sceneY);
    el.w = 1;
    el.h = 1;
    this.draft = el;
    this.gesture = {
      kind: "draw",
      origin: { x: el.x, y: el.y },
      el,
      type: this.tool,
    };
    this.app.requestRender();
  }

  _shapeUpdate(g, p) {
    const el = g.el;
    const dx = p.sceneX - g.origin.x;
    const dy = p.sceneY - g.origin.y;
    const alt = p.alt;
    const shift = p.shift;
    const isLine = g.type === "line" || g.type === "arrow";

    if (isLine) {
      let ex = p.sceneX;
      let ey = p.sceneY;
      if (shift) {
        const step = Math.PI / 4;
        const ang = Math.round(Math.atan2(dy, dx) / step) * step;
        const len = Math.hypot(dx, dy);
        ex = g.origin.x + Math.cos(ang) * len;
        ey = g.origin.y + Math.sin(ang) * len;
      }
      el.x = this.snap((g.origin.x + ex) / 2);
      el.y = this.snap((g.origin.y + ey) / 2);
      el.w = Math.max(1, Math.hypot(ex - g.origin.x, ey - g.origin.y));
      el.h = 0;
      el.rotation = (Math.atan2(ey - g.origin.y, ex - g.origin.x) * 180) / Math.PI;
      el._rev = (el._rev | 0) + 1;
      this.app.requestRender();
      return;
    }

    let w = Math.abs(dx);
    let h = Math.abs(dy);
    if (shift) {
      const m = Math.max(w, h);
      w = m;
      h = m;
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
    if (alt) {
      // Alt draws from the centre.
      el.x = this.snap(g.origin.x);
      el.y = this.snap(g.origin.y);
      el.w = this.snap(w * 2);
      el.h = this.snap(h * 2);
    } else {
      el.w = this.snap(w);
      el.h = this.snap(h);
      el.x = this.snap(g.origin.x + dx / 2);
      el.y = this.snap(g.origin.y + dy / 2);
    }
    el._rev = (el._rev | 0) + 1;
    this.app.requestRender();
  }

  _shapeCommit(g) {
    const el = g.el;
    this.draft = null;
    const min = 3;
    const isLine = g.type === "line" || g.type === "arrow";
    const big = isLine ? el.w >= min : el.w >= min || el.h >= min;
    if (!big) {
      this.app.requestRender();
      return;
    }
    el.name = "";
    this.scene.add(el, { label: "draw" });
    this.app.onSelectionChanged();
    this.app.markDirty();
    this.setTool("select");
  }

  /* ------------------------------------------------------------ freehand */

  _freehandStart(p) {
    const el = this.app.newElement("path");
    el.smooth = true;
    this.draft = el;
    this.gesture = {
      kind: "freehand",
      el,
      raw: [[p.sceneX, p.sceneY]],
      points: [[p.sceneX, p.sceneY]],
      // The stabiliser drags a lagging anchor toward the pointer, which is what
      // turns a shaky hand into a clean line.
      anchor: [p.sceneX, p.sceneY],
    };
    this._freehandUpdateLive();
    this.app.requestRender();
  }

  _freehandUpdate(p) {
    const g = this.gesture;
    const brush = this.app.brush;
    const pull = 1 - clamp(brush.stabiliser || 0, 0, 0.95) * 0.92;
    g.anchor[0] += (p.sceneX - g.anchor[0]) * pull;
    g.anchor[1] += (p.sceneY - g.anchor[1]) * pull;

    const last = g.raw[g.raw.length - 1];
    const minStep = Math.max(0.6, 1.4 / Math.max(0.2, this.stage.view.zoom));
    if (Math.hypot(g.anchor[0] - last[0], g.anchor[1] - last[1]) < minStep) return;

    g.raw.push([g.anchor[0], g.anchor[1]]);
    g.points = g.raw;
    this._freehandUpdateLive();
    this.app.requestRender();
  }

  _freehandUpdateLive() {
    const g = this.gesture;
    const el = g.el;
    el.points = g.points.map(([x, y]) => [x, y]);
    refitPath(el);
    el._rev = (el._rev | 0) + 1;
  }

  _freehandCommit(g) {
    this.draft = null;
    const el = g.el;
    const brush = this.app.brush;

    // Keep the visual smoothing that was already on screen while drawing.
    const smoothed = smoothPoints(g.raw, brush.smoothing);
    const simplified = simplifyPoints(smoothed, 0.35 + brush.smoothing * 1.8);
    if (simplified.length < 2 || (el.w < 2 && el.h < 2)) {
      this.app.requestRender();
      return;
    }
    el.points = simplified.map(([x, y]) => [x, y]);
    refitPath(el);
    el.smooth = true;
    el.strokeWidth = brush.size;
    el.opacity = brush.opacity;
    el.name = "";
    this.scene.add(el, { label: "draw" });
    this.app.onSelectionChanged();
    this.app.markDirty();
    this.app.requestRender();
    // A brush is meant to be used stroke after stroke, so the tool stays put.
  }

  /* ------------------------------------------------------------ curve tool */

  _curveClick(p) {
    if (!this.penPoints) {
      this.penPoints = { points: [[p.sceneX, p.sceneY]], preview: null };
      this._curveRefreshPreview(p);
      this.app.requestRender();
      return;
    }
    const pts = this.penPoints.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(p.sceneX - last[0], p.sceneY - last[1]) < 2) return;
    pts.push([p.sceneX, p.sceneY]);
    this._curveRefreshPreview(p);
    this.app.requestRender();
  }

  _curveHover(p) {
    this._curveRefreshPreview(p);
    this.app.requestRender();
  }

  _curveRefreshPreview(p) {
    const state = this.penPoints;
    if (!state) return;
    const pts = state.points.map(([x, y]) => [x, y]);
    if (p) pts.push([p.sceneX, p.sceneY]);
    if (pts.length < 2) return;
    const el = this.app.newElement("path");
    el.smooth = true;
    el.closed = false;
    el.points = pts;
    refitPath(el);
    el.opacity = 0.8;
    el.stroke = this.app.paint.stroke;
    el.strokeWidth = this.app.paint.strokeWidth;
    state.preview = el;
  }

  finishCurve() {
    const state = this.penPoints;
    this.penPoints = null;
    if (!state || state.points.length < 2) {
      this.app.requestRender();
      return false;
    }
    const el = this.app.newElement("path");
    el.smooth = true;
    el.points = state.points.map(([x, y]) => [x, y]);
    refitPath(el);
    this.scene.add(el, { label: "draw" });
    this.app.onSelectionChanged();
    this.app.markDirty();
    this.setTool("select");
    return true;
  }

  /* ------------------------------------------------------------ text */

  _placeText(p) {
    const el = this.app.newElement("text");
    el.text = "Text";
    el.x = this.snap(p.sceneX);
    el.y = this.snap(p.sceneY);
    const m = measureText(el.text, el.fontSize, el.fontWeight, FONT_STACK);
    el.w = m.width;
    el.h = m.height;
    this.scene.add(el, { label: "draw" });
    this.app.onSelectionChanged();
    this.app.markDirty();
    this.setTool("select");
    this.app.focusText();
  }

  /* ------------------------------------------------------------ dropper */

  _pickColor(p) {
    const doc = this.scene.doc;
    const off = this.stage.snapshot(doc.canvas.width, doc.canvas.height, doc.time);
    const x = clamp(Math.round(p.sceneX), 0, off.width - 1);
    const y = clamp(Math.round(p.sceneY), 0, off.height - 1);
    const data = off.getContext("2d").getImageData(x, y, 1, 1).data;
    if (data[3] === 0) return;
    const hex = `#${[data[0], data[1], data[2]]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")}`;
    if (p.alt) this.app.setStroke(hex);
    else this.app.setFill(hex);
    const selected = this.scene.selectedElements();
    if (selected.length) {
      this.scene.update(p.alt ? { stroke: hex } : { fill: hex }, { label: "style" });
      this.app.onSelectionChanged();
    }
    this.app.toastMessage(hex, "ok");
    this.app.requestRender();
  }

  onDoubleClick(evt) {
    if (this.tool === "path" && this.penPoints) {
      evt.preventDefault();
      this.finishCurve();
      return;
    }
    if (this.tool === "select") {
      const p = this.stage._pointerEvent(evt);
      const el = this.hit(p);
      if (el && el.type === "text") {
        this.scene.select(el.id);
        this.app.focusText();
      }
    }
  }
}

/* ---------------------------------------------------------------- maths */

/**
 * Moving-average relaxation. `amount` 0..1; each pass pulls interior points
 * toward the midpoint of their neighbours.
 */
function smoothPoints(points, amount) {
  if (!points || points.length < 3 || amount <= 0) return points || [];
  const passes = Math.max(1, Math.round(amount * 3));
  const strength = Math.min(0.6, amount * 0.55);
  let pts = points.map((p) => [p[0], p[1]]);
  for (let pass = 0; pass < passes; pass++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      out.push([
        b[0] + ((a[0] + c[0]) / 2 - b[0]) * strength,
        b[1] + ((a[1] + c[1]) / 2 - b[1]) * strength,
      ]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/**
 * Ramer–Douglas–Peucker. Removes the samples a smooth stroke does not need,
 * which keeps exported path data small without visibly changing the curve.
 */
function simplifyPoints(points, tolerance) {
  if (!points || points.length < 3 || tolerance <= 0) return points || [];
  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    if (last - first < 2) continue;
    let maxDist = -1;
    let index = -1;
    const ax = points[first][0];
    const ay = points[first][1];
    const bx = points[last][0];
    const by = points[last][1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const px = points[i][0];
      const py = points[i][1];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d2 = ex * ex + ey * ey;
      if (d2 > maxDist) {
        maxDist = d2;
        index = i;
      }
    }
    if (maxDist > tol2 && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function anchorFor(handle, bounds, alreadyCentred = false) {
  const left = bounds.x;
  const right = bounds.x + bounds.w;
  const top = bounds.y;
  const bottom = bounds.y + bounds.h;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  void alreadyCentred;
  switch (handle) {
    case "nw": return [right, bottom];
    case "ne": return [left, bottom];
    case "se": return [left, top];
    case "sw": return [right, top];
    case "n": return [midX, bottom];
    case "s": return [midX, top];
    case "e": return [left, midY];
    case "w": return [right, midY];
    default: return [midX, midY];
  }
}

/** Set x/y, honouring existing keyframes (shift keys or move the one at t). */
function applyTranslation(el, nx, ny, t, item) {
  const eps = 1e-3;
  if (el.keys.x && el.keys.x.length && item.keysX) {
    const k = el.keys.x.find((key) => Math.abs(key.t - t) < eps);
    if (k) k.v = nx;
    else {
      const delta = nx - item.x;
      el.keys.x = item.keysX.map((key) => ({ ...key, v: key.v + delta }));
    }
  } else {
    el.x = nx;
  }
  if (el.keys.y && el.keys.y.length && item.keysY) {
    const k = el.keys.y.find((key) => Math.abs(key.t - t) < eps);
    if (k) k.v = ny;
    else {
      const delta = ny - item.y;
      el.keys.y = item.keysY.map((key) => ({ ...key, v: key.v + delta }));
    }
  } else {
    el.y = ny;
  }
}

function setPosition(el, nx, ny, t) {
  const eps = 1e-3;
  const kx = el.keys.x && el.keys.x.find((k) => Math.abs(k.t - t) < eps);
  const ky = el.keys.y && el.keys.y.find((k) => Math.abs(k.t - t) < eps);
  if (kx) kx.v = nx;
  else el.x = nx;
  if (ky) ky.v = ny;
  else el.y = ny;
}

function setProperty(el, prop, value, t) {
  const eps = 1e-3;
  const track = el.keys[prop];
  const k = track && track.find((key) => Math.abs(key.t - t) < eps);
  if (k) k.v = value;
  else el[prop] = value;
}

export { createElement, polygonPoints, toLocal, localBounds };
