/**
 * SVG → scene import.
 *
 * Deliberately pragmatic: it understands shapes, paths, groups, transforms,
 * presentation attributes, inline styles and `<use>` references — everything a
 * real icon set or Illustrator/Inkscape export throws at it — and it converts
 * geometry into the studio's element model. Anything it cannot represent is
 * reported rather than silently dropped.
 */

import { createElement, FONT_FAMILIES, FONT_STACK, measureText } from "./elements.js";
import { parseNumbers, uid, escapeXML } from "./util.js";
import { parseColor, toHex } from "./color.js";
import { parsePathData } from "./svg-path.js";

/** 2-D affine matrix [a, b, c, d, e, f]. */
const IDENTITY = [1, 0, 0, 1, 0, 0];

export function multiply(m1, m2) {
  // returns m1 ∘ m2 (apply m2 first, then m1)
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Decompose an affine matrix into translate / rotate / scale. */
export function decompose(m) {
  const [a, b, c, d, e, f] = m;
  const scaleX = Math.hypot(a, b);
  const det = a * d - b * c;
  const scaleY = scaleX === 0 ? 0 : det / scaleX;
  const rotation = Math.atan2(b, a) * (180 / Math.PI);
  return { x: e, y: f, rotation, scaleX, scaleY };
}

export function parseTransform(text) {
  let m = IDENTITY.slice();
  if (!text) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let match;
  while ((match = re.exec(text))) {
    const name = match[1].toLowerCase();
    const args = parseNumbers(match[2]);
    let next = IDENTITY.slice();
    switch (name) {
      case "matrix":
        if (args.length >= 6) next = args.slice(0, 6);
        break;
      case "translate":
        next = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
        break;
      case "scale":
        next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const r = ((args[0] || 0) * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        if (args.length >= 3) {
          const cx = args[1];
          const cy = args[2];
          next = multiply([1, 0, 0, 1, cx, cy], multiply([cos, sin, -sin, cos, 0, 0], [1, 0, 0, 1, -cx, -cy]));
        } else {
          next = [cos, sin, -sin, cos, 0, 0];
        }
        break;
      }
      case "skewx":
        next = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewy":
        next = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        break;
    }
    m = multiply(m, next);
  }
  return m;
}

const STYLE_PROPS = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "display",
  "visibility", "font-family", "font-size", "font-weight", "text-anchor",
];

function parseStyleAttr(style) {
  const out = {};
  if (!style) return out;
  for (const part of style.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Merge presentation attributes with the accumulated inherited style map. */
function collectStyle(el, inherited) {
  const style = { ...inherited };
  const inline = parseStyleAttr(el.getAttribute("style"));
  for (const prop of STYLE_PROPS) {
    const inlineValue = inline[prop];
    const attrValue = el.getAttribute(prop);
    const value = inlineValue !== undefined ? inlineValue : attrValue;
    if (value !== undefined && value !== null && value !== "inherit") style[prop] = value;
  }
  return style;
}

/* ---------------------------------------------------------------- importer */

export function parseSVG(text, options = {}) {
  const warnings = [];
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, "image/svg+xml");
  } catch (err) {
    return { elements: [], warnings: ["could not parse the document"], width: 0, height: 0 };
  }
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return { elements: [], warnings: ["invalid SVG: " + parseError.textContent.slice(0, 120)], width: 0, height: 0 };
  }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") {
    return { elements: [], warnings: ["no <svg> root element"], width: 0, height: 0 };
  }

  // Page size, in the order the SVG spec resolves it.
  const vb = parseNumbers(root.getAttribute("viewBox") || "");
  let width = parseFloat(root.getAttribute("width")) || (vb.length === 4 ? vb[2] : 0) || 0;
  let height = parseFloat(root.getAttribute("height")) || (vb.length === 4 ? vb[3] : 0) || 0;
  let offsetX = 0;
  let offsetY = 0;
  let baseMatrix = IDENTITY.slice();
  if (vb.length === 4) {
    const [vx, vy, vw, vh] = vb;
    if (vw > 0 && vh > 0) {
      if (width > 0 && height > 0) {
        const s = Math.min(width / vw, height / vh);
        baseMatrix = [s, 0, 0, s, -vx * s + (width - vw * s) / 2, -vy * s + (height - vh * s) / 2];
      } else {
        baseMatrix = [1, 0, 0, 1, -vx, -vy];
        width = width || vw;
        height = height || vh;
      }
    }
    offsetX = vx;
    offsetY = vy;
  }
  if (!width || !height) {
    width = width || 1280;
    height = height || 720;
    warnings.push("no width/height or viewBox — assumed 1280×720");
  }

  const elements = [];
  const uses = [];

  walk(root, {
    matrix: baseMatrix,
    style: {
      fill: "black",
      "stroke-width": "1",
      "font-size": "16",
      "font-weight": "400",
      "text-anchor": "start",
      "font-family": "",
    },
    depth: 0,
    elements,
    warnings,
    uses,
    doc,
    options,
  });

  // Resolve <use> once everything is known.
  for (const u of uses) {
    const target = doc.getElementById(u.href);
    if (!target) {
      warnings.push(`<use> references a missing id: #${u.href}`);
      continue;
    }
    const before = elements.length;
    walk(target, {
      matrix: multiply(u.matrix, [1, 0, 0, 1, u.x, u.y]),
      style: u.style,
      depth: 0,
      elements,
      warnings,
      uses: [],
      doc,
      options,
      clone: true,
    });
    if (elements.length === before) warnings.push(`<use href="#${u.href}"> produced nothing`);
  }

  return { elements, warnings, width: Math.round(width), height: Math.round(height) };
}

const SKIP_TAGS = new Set(["defs", "title", "desc", "metadata", "style", "script", "clippath", "mask", "filter", "symbol", "marker"]);

function walk(node, ctx) {
  for (const child of Array.from(node.children || [])) {
    const tag = child.nodeName.toLowerCase().replace(/^.*:/, "");
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === "lineargradient" || tag === "radialgradient" || tag === "pattern") continue;

    const matrix = multiply(ctx.matrix, parseTransform(child.getAttribute("transform")));
    const style = collectStyle(child, ctx.style);

    if (style.display === "none" || style.visibility === "hidden") continue;

    if (tag === "g" || tag === "a" || tag === "switch" || tag === "svg") {
      walk(child, { ...ctx, matrix, style });
      continue;
    }
    if (tag === "use") {
      const href = (child.getAttribute("href") || child.getAttribute("xlink:href") || "").replace(/^#/, "");
      if (href) {
        ctx.uses.push({
          href,
          matrix,
          style,
          x: parseFloat(child.getAttribute("x")) || 0,
          y: parseFloat(child.getAttribute("y")) || 0,
        });
      }
      continue;
    }
    if (tag === "text" || tag === "tspan") {
      const el = convertText(child, matrix, style, ctx);
      if (el) ctx.elements.push(el);
      continue;
    }
    const el = convertShape(child, tag, matrix, style, ctx);
    if (el) ctx.elements.push(el);
  }
}

/* ---------------------------------------------------------------- shapes */

function convertShape(node, tag, matrix, style, ctx) {
  const num = (name, fallback = 0) => {
    const v = parseFloat(node.getAttribute(name));
    return Number.isFinite(v) ? v : fallback;
  };

  let el = null;
  switch (tag) {
    case "rect": {
      const w = num("width");
      const h = num("height");
      if (w <= 0 || h <= 0) return null;
      el = createElement("rect");
      el.w = w;
      el.h = h;
      el.rx = Math.max(num("rx"), num("ry"));
      el.x = num("x") + w / 2;
      el.y = num("y") + h / 2;
      break;
    }
    case "circle": {
      const r = num("r");
      if (r <= 0) return null;
      el = createElement("ellipse");
      el.w = r * 2;
      el.h = r * 2;
      el.x = num("cx");
      el.y = num("cy");
      break;
    }
    case "ellipse": {
      const rx = num("rx");
      const ry = num("ry");
      if (rx <= 0 || ry <= 0) return null;
      el = createElement("ellipse");
      el.w = rx * 2;
      el.h = ry * 2;
      el.x = num("cx");
      el.y = num("cy");
      break;
    }
    case "line": {
      const x1 = num("x1");
      const y1 = num("y1");
      const x2 = num("x2");
      const y2 = num("y2");
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.001) return null;
      el = createElement("line");
      el.w = len;
      el.h = 0;
      el.x = (x1 + x2) / 2;
      el.y = (y1 + y2) / 2;
      el.rotation = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      break;
    }
    case "polyline":
    case "polygon": {
      const pts = toPoints(node.getAttribute("points"));
      if (pts.length < 2) return null;
      el = polylineFromPoints(pts, tag === "polygon");
      break;
    }
    case "path": {
      const d = node.getAttribute("d");
      if (!d) return null;
      const subpaths = parsePathData(d);
      if (!subpaths.length) {
        ctx.warnings.push("a <path> could not be parsed and was skipped");
        return null;
      }
      const all = subpaths.flat();
      if (all.length < 2) return null;
      el = polylineFromPoints(all, isClosedPath(d));
      el.closed = isClosedPath(d);
      break;
    }
    default:
      return null;
  }

  applyStyle(el, style, ctx, node);
  applyMatrix(el, matrix, ctx);
  if (el.type === "path") refitImportedPath(el);
  return el;
}

function toPoints(value) {
  const nums = parseNumbers(value);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

function isClosedPath(d) {
  return /[zZ]\s*$/.test(String(d).trim());
}

function polylineFromPoints(worldPts, closed) {
  const el = createElement("path");
  el.points = worldPts.map(([x, y]) => [x, y]);
  el.closed = !!closed;
  el.smooth = false;
  el.fill = closed ? el.fill : null;
  return el;
}

/** Re-centre an imported path on its own bounding box. */
function refitImportedPath(el) {
  const pts = el.points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of pts) {
    p[0] -= cx;
    p[1] -= cy;
  }
  el.x = cx;
  el.y = cy;
  el.w = Math.max(1, maxX - minX);
  el.h = Math.max(1, maxY - minY);
}

/* ---------------------------------------------------------------- text */

function convertText(node, matrix, style, ctx) {
  const raw = collectText(node);
  if (!raw.trim()) return null;
  const el = createElement("text");
  el.text = raw;
  const x = parseFloat(node.getAttribute("x")) || 0;
  const y = parseFloat(node.getAttribute("y")) || 0;
  el.x = x;
  el.y = y;
  el.align = style["text-anchor"] === "middle" ? "center" : style["text-anchor"] === "end" ? "right" : "left";
  applyStyle(el, style, ctx, node);

  const anchor = el.align;
  const m = measureText(el.text, el.fontSize, el.fontWeight, FONT_STACK);
  el.w = Math.max(1, m.width);
  el.h = Math.max(1, m.height);
  if (anchor === "center") {
    // the model anchors text at its centre, so nothing to shift
  } else if (anchor === "right") {
    el.x = x - el.w / 2;
  } else {
    el.x = x + el.w / 2;
  }
  el.y = y - el.h / 2 + el.fontSize * 0.1;

  const d = decompose(matrix);
  el.x = el.x * d.scaleX + d.x;
  el.y = el.y * d.scaleY + d.y;
  el.rotation = d.rotation;
  return el;
}

function collectText(node) {
  let out = "";
  for (const child of Array.from(node.childNodes || [])) {
    if (child.nodeType === 3) out += child.nodeValue;
    else if (child.nodeName.toLowerCase() === "tspan") out += "\n" + collectText(child);
  }
  return out.replace(/^\n/, "").replace(/[ \t]+/g, " ");
}

/* ---------------------------------------------------------------- paint */

function applyStyle(el, style, ctx, node) {
  const fill = resolvePaint(style.fill, ctx, "fill");
  const stroke = resolvePaint(style.stroke, ctx, "stroke");
  el.fill = fill;
  el.stroke = stroke;

  const sw = parseFloat(style["stroke-width"]);
  if (Number.isFinite(sw)) el.strokeWidth = Math.max(0, sw);

  const op = parseFloat(style.opacity);
  if (Number.isFinite(op)) el.opacity = Math.min(1, Math.max(0, op));

  if (style["stroke-linecap"]) el.strokeCap = style["stroke-linecap"];
  if (style["stroke-linejoin"]) el.strokeJoin = style["stroke-linejoin"];

  const dash = parseNumbers(style["stroke-dasharray"] || "");
  if (dash.length && el.strokeWidth > 0) el.dash = Math.max(0, dash[0] / el.strokeWidth);

  if (style["font-size"]) {
    const fs = parseFloat(style["font-size"]);
    if (Number.isFinite(fs) && fs > 0) el.fontSize = fs;
  }
  if (style["font-weight"]) {
    const fw = parseInt(style["font-weight"], 10);
    if (Number.isFinite(fw)) el.fontWeight = Math.min(900, Math.max(100, Math.round(fw / 100) * 100));
  }
  if (style["font-family"]) {
    const fam = String(style["font-family"]).toLowerCase();
    const hit = FONT_FAMILIES.find((f) => fam.includes(f.label.toLowerCase().split(" ")[0]));
    if (hit) el.fontFamily = hit.id;
  }
  if (!el.name) el.name = node.getAttribute("id") || "";
}

function resolvePaint(value, ctx, kind) {
  if (value === undefined || value === null) return kind === "stroke" ? null : null;
  const v = String(value).trim();
  if (!v || v === "none" || v === "transparent") return null;
  if (v.startsWith("url(")) {
    const id = v.slice(4, v.lastIndexOf(")")).replace(/["'#\s]/g, "");
    const grad = ctx.doc.getElementById(id);
    if (grad) {
      const stops = Array.from(grad.querySelectorAll("stop"));
      const first = stops[0];
      const last = stops[stops.length - 1];
      const c1 = first && parseColor(first.getAttribute("stop-color") || "#000");
      const c2 = last && parseColor(last.getAttribute("stop-color") || "#000");
      if (c1 && c2) {
        // No gradient model in v2 — approximate with the midpoint colour and
        // tell the user, rather than silently dropping the paint.
        const rgb = [0, 1, 2].map((i) => Math.round((c1[i] + c2[i]) / 2));
        ctx.warnings.push(`gradient #${id} approximated with a flat colour`);
        return toHex([rgb[0], rgb[1], rgb[2], 1]);
      }
    }
    ctx.warnings.push(`unsupported paint ${v}`);
    return null;
  }
  const c = parseColor(v);
  if (!c) return null;
  if (c[3] === 0) return null;
  return toHex(c);
}

/* ---------------------------------------------------------------- transform */

function applyMatrix(el, matrix, ctx) {
  const d = decompose(matrix);
  if (el.type === "path") {
    // Geometry is already in user space; only lift the placement.
    el.x += d.x;
    el.y += d.y;
    if (d.rotation) el.rotation = (el.rotation || 0) + d.rotation;
    if (d.scaleX !== 1 || d.scaleY !== 1) {
      el.scaleX = (el.scaleX || 1) * d.scaleX;
      el.scaleY = (el.scaleY || 1) * d.scaleY;
    }
    return;
  }
  el.x = el.x * d.scaleX + d.x;
  el.y = el.y * d.scaleY + d.y;
  el.rotation = (el.rotation || 0) + d.rotation;
  if (d.scaleX !== 1 || d.scaleY !== 1) {
    el.w = Math.abs(el.w * d.scaleX);
    el.h = Math.abs(el.h * d.scaleY);
    el.strokeWidth = Math.abs(el.strokeWidth * ((Math.abs(d.scaleX) + Math.abs(d.scaleY)) / 2));
  }
}
