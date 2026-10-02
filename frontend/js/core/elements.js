/**
 * Element registry: defaults, local geometry, bounds, hit testing and the
 * inspector schema for every drawable type.
 *
 * Local space convention: an element's geometry is expressed around its own
 * origin (0,0). The scene transform (x, y, rotation, scaleX, scaleY) is applied
 * on top by the renderer / SVG writer, never baked into these points.
 */

import { clamp, uid, num } from "./util.js";
import { parseColor } from "./color.js";

export const ELEMENT_TYPES = [
  "rect", "ellipse", "polygon", "star", "line", "arrow", "path", "text",
];

export const ANIMATABLE = [
  "x", "y", "rotation", "scaleX", "scaleY", "opacity", "strokeWidth",
];

/* ---------------------------------------------------------------- text metrics */

let measureCtx = null;

/** Measure text with an offscreen 2D context. Cached by font+string. */
const metricCache = new Map();

export function measureText(text, fontSize, fontWeight = 600, family = FONT_STACK) {
  const key = `${fontWeight}|${fontSize}|${family}|${text}`;
  const hit = metricCache.get(key);
  if (hit) return hit;
  if (!measureCtx) {
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d");
  }
  const lines = String(text ?? "").split("\n");
  measureCtx.font = `${fontWeight} ${fontSize}px ${family}`;
  let width = 0;
  for (const line of lines) width = Math.max(width, measureCtx.measureText(line || " ").width);
  const height = lines.length * fontSize * 1.2;
  const box = { width, height, lines: lines.length };
  if (metricCache.size > 4000) metricCache.clear();
  metricCache.set(key, box);
  return box;
}

export function clearMetricCache() {
  metricCache.clear();
}

export const FONT_STACK =
  "'HarmonyOS Sans SC','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif";

export const FONT_FAMILIES = [
  { id: "harmony", label: "HarmonyOS Sans SC", css: FONT_STACK },
  { id: "sans", label: "Sans Serif", css: "system-ui, 'Segoe UI', sans-serif" },
  { id: "serif", label: "Serif", css: "Georgia, 'Times New Roman', serif" },
  { id: "mono", label: "Monospace", css: "'SF Mono', 'Cascadia Mono', ui-monospace, monospace" },
];

/* ---------------------------------------------------------------- factory */

/**
 * A paint object: colour string or null for "nothing".
 * Kept as a plain string so export/import round-trips losslessly.
 */
export function defaultPaint(fill, stroke) {
  return { fill, stroke, strokeWidth: 3, strokeCap: "round", strokeJoin: "round", dash: 0 };
}

export const TYPE_LABEL_KEY = {
  rect: "type.rect",
  ellipse: "type.ellipse",
  polygon: "type.polygon",
  star: "type.star",
  line: "type.line",
  arrow: "type.arrow",
  path: "type.path",
  text: "type.text",
};

export function createElement(type, overrides = {}) {
  const el = {
    id: uid(type),
    type,
    name: "",
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    w: 160,
    h: 120,
    rx: 0,
    sides: 5,
    innerRatio: 0.5,
    points: [],
    closed: false,
    smooth: false,
    text: "Text",
    fontSize: 48,
    fontWeight: 600,
    fontFamily: "harmony",
    align: "center",
    fill: "#cbff4d",
    stroke: null,
    strokeWidth: 3,
    strokeCap: "round",
    strokeJoin: "round",
    dash: 0,
    keys: {},
  };

  switch (type) {
    case "rect":
      el.w = 220;
      el.h = 160;
      el.fill = "#cbff4d";
      break;
    case "ellipse":
      el.w = 200;
      el.h = 200;
      el.fill = "#6fc7ff";
      break;
    case "polygon":
      el.w = 200;
      el.h = 200;
      el.sides = 6;
      el.fill = "#b79cff";
      break;
    case "star":
      el.w = 210;
      el.h = 210;
      el.sides = 5;
      el.innerRatio = 0.45;
      el.fill = "#ffcf5c";
      break;
    case "line":
      el.w = 240;
      el.h = 0;
      el.fill = null;
      el.stroke = "#edeff3";
      el.strokeWidth = 4;
      break;
    case "arrow":
      el.w = 240;
      el.h = 0;
      el.fill = null;
      el.stroke = "#edeff3";
      el.strokeWidth = 4;
      break;
    case "path":
      el.w = 200;
      el.h = 200;
      el.fill = null;
      el.stroke = "#cbff4d";
      el.strokeWidth = 6;
      el.points = [];
      break;
    case "text":
      el.w = 200;
      el.h = 60;
      el.text = "Text";
      el.fontSize = 64;
      el.fill = "#edeff3";
      break;
    default:
      break;
  }

  // A single canonical key ordering keeps snapshots/JSON diffs readable.
  const merged = { ...el, ...overrides };
  if (!merged.name) merged.name = "";
  return merged;
}

/* ---------------------------------------------------------------- geometry */

export function polygonPoints(w, h, sides, innerRatio = 0, rotation = -Math.PI / 2) {
  const n = Math.max(3, Math.round(sides));
  const star = innerRatio > 0 && innerRatio < 1;
  const count = star ? n * 2 : n;
  const rx = w / 2;
  const ry = h / 2;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const k = star && i % 2 === 1 ? innerRatio : 1;
    const a = rotation + (Math.PI * 2 * i) / count;
    pts.push([rx * k * Math.cos(a), ry * k * Math.sin(a)]);
  }
  return pts;
}

/** Local-space outline points (closed shapes) or stroke points. */
export function localPoints(el) {
  switch (el.type) {
    case "rect": {
      const x = -el.w / 2;
      const y = -el.h / 2;
      return [[x, y], [x + el.w, y], [x + el.w, y + el.h], [x, y + el.h]];
    }
    case "ellipse": {
      const pts = [];
      const n = 48;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n;
        pts.push([(el.w / 2) * Math.cos(a), (el.h / 2) * Math.sin(a)]);
      }
      return pts;
    }
    case "polygon":
      return polygonPoints(el.w, el.h, el.sides, 0);
    case "star":
      return polygonPoints(el.w, el.h, el.sides, el.innerRatio);
    case "line":
    case "arrow":
      return [[-el.w / 2, 0], [el.w / 2, 0]];
    case "path":
      return el.points.map((p) => [p[0], p[1]]);
    case "text":
      return [];
    default:
      return [];
  }
}

const ARROW_HEAD_FACTOR = 3.2;

export function arrowHeadSize(el) {
  return clamp(8 + (el.strokeWidth || 2) * ARROW_HEAD_FACTOR, 8, 80);
}

/** The arrow outline, in local space, as a closed polygon (7 vertices). */
export function arrowOutline(el) {
  const tip = el.w / 2;
  const tail = -el.w / 2;
  const head = clamp(arrowHeadSize(el), 4, Math.max(4, el.w * 0.7));
  const shoulder = tip - head;
  const half = head * 0.42;
  const shaft = Math.max(1.5, el.strokeWidth || 2) / 2;
  return [
    [tail, -shaft],
    [shoulder, -shaft],
    [shoulder, -half],
    [tip, 0],
    [shoulder, half],
    [shoulder, shaft],
    [tail, shaft],
  ];
}

/** Bounding box of the local geometry, ignoring stroke width. */
export function localBounds(el) {
  if (el.type === "text") {
    const m = measureText(el.text, el.fontSize, el.fontWeight, familyCss(el.fontFamily));
    return { x: -m.width / 2, y: -m.height / 2, w: m.width, h: m.height };
  }
  const pts = el.type === "arrow" ? arrowOutline(el) : localPoints(el);
  if (!pts.length) return { x: -el.w / 2, y: -el.h / 2, w: el.w, h: el.h };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of pts) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function familyCss(id) {
  const f = FONT_FAMILIES.find((x) => x.id === id);
  return f ? f.css : FONT_STACK;
}

/* ---------------------------------------------------------------- transform */

export function rotationMatrix(deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c];
}

/** Local point → scene point using the element's static transform. */
export function toScene(el, lx, ly) {
  const [a, b, c, d] = rotationMatrix(el.rotation || 0);
  const sx = (el.scaleX ?? 1) * lx;
  const sy = (el.scaleY ?? 1) * ly;
  return [el.x + a * sx + c * sy, el.y + b * sx + d * sy];
}

/** Scene point → local point. */
export function toLocal(el, px, py) {
  const [a, b, c, d] = rotationMatrix(el.rotation || 0);
  const dx = px - el.x;
  const dy = py - el.y;
  // inverse of [a c; b d] (orthonormal rotation ⇒ transpose)
  const lx = a * dx + b * dy;
  const ly = c * dx + d * dy;
  const sx = el.scaleX ?? 1;
  const sy = el.scaleY ?? 1;
  return [sx === 0 ? 0 : lx / sx, sy === 0 ? 0 : ly / sy];
}

/** Axis-aligned scene-space bounds including the full transform. */
export function sceneBounds(el) {
  const b = localBounds(el);
  const corners = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lx, ly] of corners) {
    const [sx, sy] = toScene(el, lx, ly);
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ---------------------------------------------------------------- hit test */

/**
 * Is a scene-space point inside the element?
 * Fill uses the shape path; unfilled shapes use a widened stroke test.
 */
export function hitTest(el, px, py, tolerance = 6) {
  if (el.type === "text") {
    const [lx, ly] = toLocal(el, px, py);
    const b = localBounds(el);
    return lx >= b.x - tolerance && lx <= b.x + b.w + tolerance && ly >= b.y - tolerance && ly <= b.y + b.h + tolerance;
  }

  const hasFill = !!parseColor(el.fill) && el.type !== "line" && el.type !== "arrow" && !(el.type === "path" && !el.closed);
  const hasStroke = !!parseColor(el.stroke);
  if (!hasFill && !hasStroke) return false;

  if (el.type === "line" || el.type === "arrow") {
    return distanceToSegment(el, px, py) <= Math.max(tolerance, (el.strokeWidth || 2) / 2 + tolerance * 0.5);
  }

  if (!hasFill) {
    // open path: stroke-only proximity test
    const [lx, ly] = toLocal(el, px, py);
    return nearPolyline(el.points, lx, ly, tolerance + (el.strokeWidth || 2) / 2);
  }

  const [lx, ly] = toLocal(el, px, py);
  // Expand the outline slightly so thin shapes stay clickable.
  const grow = tolerance;
  const outline = el.type === "ellipse"
    ? ellipseOutline(el, grow)
    : growPolygon(localPoints(el), el, grow);
  return pointInPolygon(lx, ly, outline);
}

function ellipseOutline(el, grow) {
  const rx = el.w / 2 + grow;
  const ry = el.h / 2 + grow;
  const pts = [];
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    pts.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  return pts;
}

function growPolygon(pts, el, grow) {
  if (!pts.length) return pts;
  if (grow <= 0) return pts;
  // Offset each vertex outward from the centroid — good enough for picking.
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  return pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * grow, y + (dy / len) * grow];
  });
}

export function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(el, px, py) {
  const [ax, ay] = toScene(el, -el.w / 2, 0);
  const [bx, by] = toScene(el, el.w / 2, 0);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function nearPolyline(points, px, py, tol) {
  if (points.length === 0) return false;
  if (points.length === 1) return Math.hypot(px - points[0][0], py - points[0][1]) <= tol;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    if (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= tol) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- path data */

/**
 * SVG path data for an element in local space.
 * `smooth` paths use quadratic segments through midpoints, which keeps the
 * output compact and identical between canvas and every render engine.
 */
export function pathData(el) {
  switch (el.type) {
    case "rect": {
      const x = -el.w / 2;
      const y = -el.h / 2;
      const r = clamp(el.rx || 0, 0, Math.min(el.w, el.h) / 2);
      if (r <= 0.01) {
        return `M ${num(x)} ${num(y)} H ${num(x + el.w)} V ${num(y + el.h)} H ${num(x)} Z`;
      }
      return [
        `M ${num(x + r)} ${num(y)}`,
        `H ${num(x + el.w - r)}`,
        `A ${num(r)} ${num(r)} 0 0 1 ${num(x + el.w)} ${num(y + r)}`,
        `V ${num(y + el.h - r)}`,
        `A ${num(r)} ${num(r)} 0 0 1 ${num(x + el.w - r)} ${num(y + el.h)}`,
        `H ${num(x + r)}`,
        `A ${num(r)} ${num(r)} 0 0 1 ${num(x)} ${num(y + el.h - r)}`,
        `V ${num(y + r)}`,
        `A ${num(r)} ${num(r)} 0 0 1 ${num(x + r)} ${num(y)}`,
        "Z",
      ].join(" ");
    }
    case "ellipse":
      return ellipsePath(el.w / 2, el.h / 2);
    case "polygon":
    case "star": {
      const pts = polygonPoints(el.w, el.h, el.sides, el.type === "star" ? el.innerRatio : 0);
      return polylinePath(pts, true, false);
    }
    case "line":
      return `M ${num(-el.w / 2)} 0 L ${num(el.w / 2)} 0`;
    case "arrow":
      return polylinePath(arrowOutline(el), true, false);
    case "path":
      return polylinePath(el.points, el.closed, el.smooth);
    default:
      return "";
  }
}

export function ellipsePath(rx, ry) {
  // Two arcs — exact and accepted by every engine, including the Rust one.
  return [
    `M ${num(-rx)} 0`,
    `A ${num(rx)} ${num(ry)} 0 1 0 ${num(rx)} 0`,
    `A ${num(rx)} ${num(ry)} 0 1 0 ${num(-rx)} 0`,
    "Z",
  ].join(" ");
}

export function polylinePath(points, closed = false, smooth = false) {
  if (!points || points.length === 0) return "";
  const p = points;
  if (p.length === 1) return `M ${num(p[0][0])} ${num(p[0][1])}`;
  if (!smooth || p.length < 3) {
    let d = `M ${num(p[0][0])} ${num(p[0][1])}`;
    for (let i = 1; i < p.length; i++) d += ` L ${num(p[i][0])} ${num(p[i][1])}`;
    return closed ? d + " Z" : d;
  }
  // Quadratic smoothing through segment midpoints.
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = closed ? mid(p[p.length - 1], p[0]) : p[0];
  let d = `M ${num(first[0])} ${num(first[1])}`;
  const n = p.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const cur = p[i];
    const nxt = p[(i + 1) % n];
    const m = mid(cur, nxt);
    d += ` Q ${num(cur[0])} ${num(cur[1])} ${num(m[0])} ${num(m[1])}`;
  }
  if (closed) d += " Z";
  else {
    const last = p[n - 1];
    d += ` L ${num(last[0])} ${num(last[1])}`;
  }
  return d;
}

/** Cached Path2D for an element's outline (local space). */
const path2dCache = new WeakMap();

export function toPath2D(el) {
  const cached = path2dCache.get(el);
  if (cached && cached.d === pathSignature(el)) return cached.path;
  const d = pathData(el);
  if (!d) return null;
  const path = new Path2D(d);
  path2dCache.set(el, { d: pathSignature(el), path });
  return path;
}

/** Cheap signature: any geometry change invalidates a cached path.
 *  `_rev` is bumped by the scene store on every mutation; the point checksum
 *  catches raw point edits that bypass it. */
function pathSignature(el) {
  let sum = 0;
  if (el.type === "path") {
    const pts = el.points;
    for (let i = 0; i < pts.length; i++) sum += pts[i][0] * 31 + pts[i][1] * 17 + i;
  }
  return [
    el._rev | 0, el.type, el.w, el.h, el.rx, el.sides, el.innerRatio,
    el.closed ? 1 : 0, el.smooth ? 1 : 0, el.points.length, el.strokeWidth, sum,
  ].join("|");
}

/* ---------------------------------------------------------------- resizing */

/**
 * Resize an element to a new design size, transforming geometry that is stored
 * as explicit points (paths) so the artwork keeps its shape.
 */
export function applySize(el, w, h) {
  const nw = Math.max(1, w);
  const nh = Math.max(1, h);
  if (el.type === "path" && el.points.length) {
    const sx = nw / Math.max(1e-6, el.w);
    const sy = nh / Math.max(1e-6, el.h);
    for (const p of el.points) {
      p[0] *= sx;
      p[1] *= sy;
    }
  }
  el.w = nw;
  el.h = el.type === "line" || el.type === "arrow" ? 0 : nh;
}

/** Recompute w/h from the points of a path element (after free drawing). */
export function refitPath(el) {
  if (el.type !== "path" || !el.points.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of el.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of el.points) {
    p[0] -= cx;
    p[1] -= cy;
  }
  el.x += cx;
  el.y += cy;
  el.w = Math.max(1, maxX - minX);
  el.h = Math.max(1, maxY - minY);
}
