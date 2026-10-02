/**
 * Canvas renderer for the stage.
 *
 * Draws, in order: the artboard (checkerboard + background), the scene at the
 * current time, onion-skin ghosts, then the selection overlay. The overlay is
 * display-only and never ends up in an export — exports go through svg-export.
 */

import { toPath2D, localBounds, toScene, familyCss, arrowHeadSize } from "./elements.js";
import { sampleTrack, isAnimated } from "./anim.js";
import { clamp } from "./util.js";

/** Handle ids in a stable order, matching the CSS cursors in stage.js. */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const SELECTION_COLOR = "#cbff4d";
const SELECTION_ALT = "#ff5f6d";

export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this._pattern = null;
    this._patternKey = "";
  }

  /** Size the backing store to the CSS box; returns true when it changed. */
  resize(cssWidth, cssHeight, dpr) {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h || this.dpr !== dpr) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dpr = dpr;
      return true;
    }
    return false;
  }

  /**
   * @param {object} opts
   *  scene      — the Scene document
   *  time       — seconds
   *  view       — { zoom, panX, panY }
   *  theme      — { artboardShadow, checkerA, checkerB, grid, accent }
   *  selection  — array of element ids
   *  hoverId    — id under the cursor
   *  marquee    — {x,y,w,h} in scene space, or null
   *  editable   — false while playing back (hide handles)
   */
  draw(opts) {
    const ctx = this.ctx;
    const { scene, view } = opts;
    const doc = scene.doc || scene;
    const zoom = view.zoom;
    const dpr = this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // world transform: 1 scene unit = zoom * dpr device px
    const s = zoom * dpr;
    ctx.setTransform(s, 0, 0, s, view.panX * dpr, view.panY * dpr);

    this._drawArtboard(ctx, doc.canvas, opts.theme);
    if (doc.showGrid) this._drawGrid(ctx, doc.canvas, doc.grid, zoom);

    const time = opts.time;
    if (doc.onion && !opts.playing) {
      const step = 1 / (doc.canvas.fps || 30);
      for (const offset of [-step, step]) {
        const t = time + offset;
        if (t < 0 || t > doc.canvas.duration) continue;
        this._drawElements(ctx, doc.elements, t, 0.28);
      }
    }

    this._drawElements(ctx, doc.elements, time, 1);
    // Draft geometry (a shape being drawn, a path being laid out) — display
    // only, never part of the document.
    if (opts.extra && opts.extra.length) {
      this._drawElements(ctx, opts.extra, time, 1);
    }

    const selected = (opts.selection || [])
      .map((id) => doc.elements.find((e) => e.id === id))
      .filter(Boolean);

    if (opts.editable !== false && selected.length) {
      this._drawSelection(ctx, selected, time, zoom, selected.length === 1);
    }
    if (opts.hoverId && !selected.some((e) => e.id === opts.hoverId)) {
      const hovered = doc.elements.find((e) => e.id === opts.hoverId);
      if (hovered) this._drawHover(ctx, hovered, time, zoom);
    }
    if (opts.marquee) {
      ctx.save();
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeRect(opts.marquee.x, opts.marquee.y, opts.marquee.w, opts.marquee.h);
      ctx.fillStyle = "rgba(203,255,77,0.10)";
      ctx.fillRect(opts.marquee.x, opts.marquee.y, opts.marquee.w, opts.marquee.h);
      ctx.restore();
    }

    if (opts.cursor) this._drawBrushCursor(ctx, opts.cursor, zoom);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Brush footprint ring: a dark outline under a light one so it reads on any
   *  artwork, with a dot marking the exact point. */
  _drawBrushCursor(ctx, cursor, zoom) {
    const r = Math.max(cursor.r, 0.6);
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
    ctx.lineWidth = 2 / zoom;
    ctx.strokeStyle = "rgba(10,11,13,0.55)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
    if (r * zoom > 5) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 1 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ artboard */

  _drawArtboard(ctx, canvas, theme) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    // Checkerboard as a cached pattern in device space.
    const key = `${canvas.background || "none"}|${this.dpr}`;
    if (this._patternKey !== key || !this._pattern) {
      this._pattern = makeCheckerPattern(ctx, this.dpr, theme);
      this._patternKey = key;
    }
    ctx.fillStyle = this._pattern || "#ffffff";
    ctx.fillRect(0, 0, w, h);
    if (canvas.background) {
      ctx.fillStyle = canvas.background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  _drawGrid(ctx, canvas, step, zoom) {
    const s = Math.max(2, step || 20);
    ctx.save();
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = "rgba(120,130,150,0.20)";
    ctx.beginPath();
    for (let x = 0; x <= canvas.width + 0.01; x += s) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    for (let y = 0; y <= canvas.height + 0.01; y += s) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------ elements */

  _drawElements(ctx, elements, time, alphaMul) {
    for (const el of elements) {
      if (!el.visible) continue;
      this._paint(ctx, el, time, alphaMul);
    }
  }

  /** Resolve animated properties for one element at time t. */
  resolve(el, t) {
    const keys = el.keys;
    if (!keys) return el;
    let animated = false;
    for (const p in keys) {
      if (keys[p] && keys[p].length) {
        animated = true;
        break;
      }
    }
    if (!animated) return el;
    const out = Object.create(el);
    out.x = sampleTrack(keys.x, t, el.x);
    out.y = sampleTrack(keys.y, t, el.y);
    out.rotation = sampleTrack(keys.rotation, t, el.rotation);
    out.scaleX = sampleTrack(keys.scaleX, t, el.scaleX);
    out.scaleY = sampleTrack(keys.scaleY, t, el.scaleY);
    out.opacity = sampleTrack(keys.opacity, t, el.opacity);
    out.strokeWidth = sampleTrack(keys.strokeWidth, t, el.strokeWidth);
    return out;
  }

  _paint(ctx, el, time, alphaMul) {
    const r = isAnimated(el.keys) ? this.resolve(el, time) : el;
    const alpha = clamp((r.opacity ?? 1) * alphaMul, 0, 1);
    if (alpha <= 0.004) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(r.x, r.y);
    if (r.rotation) ctx.rotate((r.rotation * Math.PI) / 180);
    ctx.scale(r.scaleX ?? 1, r.scaleY ?? 1);

    if (r.type === "text") {
      this._paintText(ctx, r);
    } else {
      const path = toPath2D(el);
      if (path) {
        if (r.fill) {
          ctx.fillStyle = r.fill;
          ctx.fill(path);
        }
        if (r.stroke && r.strokeWidth > 0) {
          setupStroke(ctx, r);
          ctx.stroke(path);
        }
      }
    }
    ctx.restore();
  }

  _paintText(ctx, el) {
    if (!el.text) return;
    const lines = String(el.text).split("\n");
    const lh = el.fontSize * 1.2;
    ctx.font = `${el.fontWeight || 600} ${el.fontSize}px ${familyCss(el.fontFamily)}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = el.align === "left" ? "left" : el.align === "right" ? "right" : "center";
    const anchorX = el.align === "left" ? -el.w / 2 : el.align === "right" ? el.w / 2 : 0;
    const y0 = -((lines.length - 1) * lh) / 2;
    if (el.stroke && el.strokeWidth > 0) {
      setupStroke(ctx, el);
      lines.forEach((line, i) => ctx.strokeText(line, anchorX, y0 + i * lh));
    }
    if (el.fill) {
      ctx.fillStyle = el.fill;
      lines.forEach((line, i) => ctx.fillText(line, anchorX, y0 + i * lh));
    }
  }

  /* ------------------------------------------------------------ overlay */

  _drawHover(ctx, el, time, zoom) {
    const r = isAnimated(el.keys) ? this.resolve(el, time) : el;
    const pts = worldCorners(r);
    ctx.save();
    ctx.strokeStyle = "rgba(203,255,77,0.55)";
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  _drawSelection(ctx, elements, time, zoom, single) {
    const px = 1 / zoom;
    ctx.save();
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([]);

    if (single) {
      const el = elements[0];
      const r = isAnimated(el.keys) ? this.resolve(el, time) : el;
      const pts = worldCorners(r);
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.stroke();

      // rotation handle above the top edge
      const topMid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      const [ux, uy] = upVector(r.rotation || 0);
      const rot = [topMid[0] + ux * 30 * px, topMid[1] + uy * 30 * px];
      ctx.beginPath();
      ctx.moveTo(topMid[0], topMid[1]);
      ctx.lineTo(rot[0], rot[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rot[0], rot[1], 5 * px, 0, Math.PI * 2);
      ctx.fillStyle = SELECTION_COLOR;
      ctx.fill();
      ctx.strokeStyle = "rgba(10,11,13,0.85)";
      ctx.lineWidth = 1.2 * px;
      ctx.stroke();

      // eight resize handles, rotated with the element
      for (const id of HANDLES) {
        const p = handlePoint(r, id, pts);
        drawSquare(ctx, p[0], p[1], 8 * px);
      }
    } else {
      ctx.strokeStyle = SELECTION_ALT;
      for (const el of elements) {
        const r = isAnimated(el.keys) ? this.resolve(el, time) : el;
        const pts = worldCorners(r);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- helpers */

function setupStroke(ctx, el) {
  ctx.strokeStyle = el.stroke;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineJoin = el.strokeJoin || "round";
  ctx.lineCap = el.strokeCap || "round";
  if (el.dash > 0) {
    const d = el.strokeWidth * el.dash;
    ctx.setLineDash([d, d]);
  } else {
    ctx.setLineDash([]);
  }
}

function makeCheckerPattern(ctx, dpr, theme) {
  const size = Math.round(8 * dpr);
  const tile = document.createElement("canvas");
  tile.width = size * 2;
  tile.height = size * 2;
  const tctx = tile.getContext("2d");
  const a = (theme && theme.checkerA) || "#ffffff";
  const b = (theme && theme.checkerB) || "#e8eaee";
  tctx.fillStyle = a;
  tctx.fillRect(0, 0, size * 2, size * 2);
  tctx.fillStyle = b;
  tctx.fillRect(0, 0, size, size);
  tctx.fillRect(size, size, size, size);
  return ctx.createPattern(tile, "repeat");
}

/** Re-checker the pattern when the theme flips. */
export function invalidatePatterns(renderer) {
  renderer._pattern = null;
  renderer._patternKey = "";
}

export function upVector(deg) {
  const r = ((deg || 0) * Math.PI) / 180;
  return [-Math.sin(r), -Math.cos(r)];
}

function drawSquare(ctx, x, y, size) {
  const h = size / 2;
  ctx.beginPath();
  ctx.rect(x - h, y - h, size, size);
  ctx.fillStyle = "#0a0b0d";
  ctx.fill();
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** The four corners of an element's local bounds, in world space. */
export function worldCorners(el) {
  const b = localBounds(el);
  return [
    toScene(el, b.x, b.y),
    toScene(el, b.x + b.w, b.y),
    toScene(el, b.x + b.w, b.y + b.h),
    toScene(el, b.x, b.y + b.h),
  ].map(([x, y]) => [x, y]);
}

/**
 * World position of a named resize handle. Mid-edge handles slide to the
 * midpoint of the corresponding edge so they stay correct under rotation.
 */
export function handlePoint(el, id, corners) {
  const [nw, ne, se, sw] = corners || worldCorners(el);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  switch (id) {
    case "nw": return nw;
    case "ne": return ne;
    case "se": return se;
    case "sw": return sw;
    case "n": return mid(nw, ne);
    case "e": return mid(ne, se);
    case "s": return mid(se, sw);
    case "w": return mid(sw, nw);
    default: return mid(nw, se);
  }
}

export { SELECTION_COLOR, SELECTION_ALT, arrowHeadSize };
