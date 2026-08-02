// store.js — scene model, keyframe interpolation, SVG (SMIL) serialization.

const ANIM_PROPS = ["x", "y", "rotation", "scale", "opacity"];

const PROP_COLORS = {
  x: "#f43f5e", y: "#10b981", rotation: "#a78bfa",
  scale: "#fb923c", opacity: "#38bdf8",
};

let ID_SEQ = 1;
function uid(prefix) {
  return (prefix || "el") + "-" + (ID_SEQ++).toString(36) + Math.floor(Math.random() * 1e5).toString(36);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function defaultLayer(type) {
  const base = {
    id: uid("layer"),
    type,
    name: typeName(type),
    visible: true,
    locked: false,
    x: 0, y: 0, width: 160, height: 100,
    rotation: 0,
    scale: 1,
    opacity: 1,
    fill: "#6366f1",
    stroke: "none",
    strokeWidth: 2,
    strokeLinejoin: "round",
    text: "Text",
    fontSize: 28,
    points: [],
    keys: {},
  };
  switch (type) {
    case "rect": base.width = 200; base.height = 140; base.fill = "#6366f1"; break;
    case "rounded": base.type = "rect"; base.rx = 24; base.fill = "#0ea5e9"; break;
    case "ellipse": base.width = 220; base.height = 150; base.fill = "#10b981"; break;
    case "line":
    case "arrow":
      base.width = 200; base.height = 0; base.fill = "none";
      base.stroke = "#e2e8f0"; base.strokeWidth = 4; break;
    case "poly":
      base.points = []; base.sides = 5; base.width = 200; base.height = 180; break;
    case "star":
      base.points = []; base.sides = 5; base.width = 200; base.height = 190;
      base.fill = "#f59e0b"; break;
    case "path":
    case "pen":
      base.points = [];
      base.fill = "none"; base.stroke = "#e2e8f0"; base.strokeWidth = 3;
      base.closed = false; break;
    case "text":
      base.fill = "#f8fafc"; base.width = 160; base.height = 40; break;
  }
  return base;
}

function typeName(type) {
  return { rect: "Rectangle", ellipse: "Ellipse", line: "Line", arrow: "Arrow",
    poly: "Polygon", star: "Star", pen: "Freehand", path: "Path", text: "Text" }[type] || type;
}

// ---- keyframe helpers ----------------------------------------------------

function sortedKeys(keys) {
  return keys.slice().sort((a, b) => a[0] - b[0]);
}

function getKeyValue(layer, prop, t) {
  const keys = sortedKeys(layer.keys[prop] || []);
  if (!keys.length) return layer[prop];
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const span = b[0] - a[0] || 1e-9;
      const f = (t - a[0]) / span;
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return layer[prop];
}

function setKeyframe(layer, prop, t, value) {
  if (!layer.keys[prop]) layer.keys[prop] = [];
  const arr = layer.keys[prop];
  const i = arr.findIndex((k) => Math.abs(k[0] - t) < 1e-4);
  if (i >= 0) arr[i] = [t, value];
  else arr.push([t, value]);
  arr.sort((a, b) => a[0] - b[0]);
}

function removeKeyframe(layer, prop, t) {
  const arr = layer.keys[prop];
  if (!arr) return false;
  const i = arr.findIndex((k) => Math.abs(k[0] - t) < 1e-4);
  if (i >= 0) { arr.splice(i, 1); return true; }
  return false;
}

function hasKeyframe(layer, prop, t) {
  return !!(layer.keys[prop] || []).some((k) => Math.abs(k[0] - t) < 1e-4);
}

function propertyAtTime(layer, prop, t) {
  return getKeyValue(layer, prop, t);
}

// ---- shape geometry (local points) --------------------------------------

function polygonPoints(cx, cy, sides, radius, rotation, starIn = 0) {
  const pts = [];
  const n = starIn ? sides * 2 : sides;
  for (let i = 0; i < n; i++) {
    const r = starIn && i % 2 === 1 ? starIn : radius;
    const a = -Math.PI / 2 + rotation + (Math.PI * 2 * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// Generate local shape geometry centered at (0,0) with the layer's size.
function shapeGeometry(layer) {
  const w = layer.width, h = layer.height;
  const cx = 0, cy = 0;
  switch (layer.type) {
    case "rect": {
      const x = -w / 2, y = -h / 2;
      const r = layer.rx ? Math.min(layer.rx, w / 2, h / 2) : 0;
      if (!r) return { kind: "rect", x, y, w, h, r: 0 };
      return { kind: "rounded", x, y, w, h, r };
    }
    case "ellipse":
      return { kind: "ellipse", cx, cy, rx: w / 2, ry: h / 2 };
    case "line":
    case "arrow":
      return { kind: "line", x1: -w / 2, y1: 0, x2: w / 2, y2: 0 };
    case "poly":
    case "star": {
      const sides = layer.sides || 5;
      const rOut = Math.min(w / 2, h / 2);
      const starIn = layer.type === "star" ? rOut * 0.5 : 0;
      return { kind: "polygon", points: polygonPoints(0, 0, sides, rOut, 0, starIn) };
    }
    case "pen":
    case "path":
      return { kind: "polyline", points: layer.points, closed: !!layer.closed };
    case "text":
      return { kind: "text" };
  }
  return { kind: "rect", x: -w / 2, y: -h / 2, w, h, r: 0 };
}

function layerBounds(layer) {
  const g = shapeGeometry(layer);
  let pts = [];
  if (g.kind === "rect" || g.kind === "rounded") {
    pts = [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]];
  } else if (g.kind === "ellipse") {
    pts = [[-g.rx, -g.ry], [g.rx, -g.ry], [g.rx, g.ry], [-g.rx, g.ry]];
  } else if (g.kind === "line") {
    pts = [[g.x1, g.y1], [g.x2, g.y2]];
  } else if (g.kind === "polygon" || g.kind === "polyline") {
    pts = g.points;
  } else if (g.kind === "text") {
    pts = [[-layer.width / 2, -layer.height / 2], [layer.width / 2, -layer.height / 2],
           [layer.width / 2, layer.height / 2], [-layer.width / 2, layer.height / 2]];
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!pts.length) { minX = minY = -40; maxX = maxY = 40; }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---- SVG serialization ---------------------------------------------------

function fmtNum(v) { return Math.round(v * 1000) / 1000; }

function svgColor(c) {
  if (!c || c === "none") return null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  if (/^rgb|^hsl/i.test(c)) return c;
  return c;
}

function keysToTimes(values, keys, duration) {
  // values + keyTimes built from keyframe times (seconds) scaled to duration
  const sorted = sortedKeys(keys);
  const vals = sorted.map((k) => k[1]);
  const times = sorted.length ? sorted.map((k) => fmtNum(duration ? k[0] / duration : k[0])) : [0];
  return { vals, times };
}

function animateAttr(layer, prop, duration, attrName, valueFn) {
  const keys = sortedKeys(layer.keys[prop] || []);
  if (!keys.length) return [];
  const times = keys.map((k) => fmtNum(duration ? k[0] / duration : k[0]));
  const vals = keys.map((k) => valueFn(k[1]));
  // dedupe consecutive equal keyTimes
  return [{
    attrName, times, vals,
  }];
}

function layerToSVG(layer, duration) {
  const g = shapeGeometry(layer);
  const parts = [];

  // --- shape element ---
  let shape;
  const fill = svgColor(layer.fill);
  const stroke = svgColor(layer.stroke);
  const styleAttrs = {
    fill: fill || "none",
    fillOpacity: fmtNum(clamp(layer.opacity, 0, 1)),
    stroke: stroke || "none",
    strokeWidth: fmtNum(layer.strokeWidth),
    strokeLinejoin: layer.strokeLinejoin || "round",
    strokeLinecap: "round",
  };
  if (g.kind === "rect" || g.kind === "rounded") {
    const r = g.r ? ` rx="${fmtNum(g.r)}"` : "";
    shape = `<rect x="${fmtNum(g.x)}" y="${fmtNum(g.y)}" width="${fmtNum(g.w)}" height="${fmtNum(g.h)}"${r} />`;
  } else if (g.kind === "ellipse") {
    shape = `<ellipse cx="0" cy="0" rx="${fmtNum(g.rx)}" ry="${fmtNum(g.ry)}" />`;
  } else if (g.kind === "line") {
    shape = `<line x1="${fmtNum(g.x1)}" y1="${fmtNum(g.y1)}" x2="${fmtNum(g.x2)}" y2="${fmtNum(g.y2)}" />`;
  } else if (g.kind === "arrow") {
    const pts = g.points;
  } else if (g.kind === "polygon") {
    const d = g.points.map(([x, y]) => `${fmtNum(x)},${fmtNum(y)}`).join(" ");
    shape = `<polygon points="${d}" />`;
  } else if (g.kind === "polyline") {
    const pts = g.points;
    let d = "";
    if (pts.length) {
      d = `M ${fmtNum(pts[0][0])} ${fmtNum(pts[0][1])}`;
      for (let i = 1; i < pts.length; i++) d += ` L ${fmtNum(pts[i][0])} ${fmtNum(pts[i][1])}`;
      if (layer.closed) d += " Z";
    }
    shape = `<path d="${d}" />`;
  } else if (g.kind === "text") {
    shape = `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="${fmtNum(layer.fontSize)}" font-family="'Segoe UI', system-ui, sans-serif">${escXML(layer.text || "")}</text>`;
  }
  if (g.kind === "arrow") {
    const x2 = g.x2;
    const a = Math.PI;
    const head = 16 + (layer.strokeWidth || 2) * 2;
    const bx = x2 - head;
    const d = `M ${fmtNum(g.x1)} ${fmtNum(g.y1)} L ${fmtNum(bx)} ${fmtNum(g.y2)} L ${fmtNum(bx - 8)} ${fmtNum(-head / 2)} L ${fmtNum(x2)} 0 L ${fmtNum(bx - 8)} ${fmtNum(head / 2)} Z`;
    shape = `<path d="${d}" />`;
  }

  const attrs = Object.entries(styleAttrs).map(([k, v]) => ` ${k}="${v}"`).join("");
  if (shape.endsWith("/>")) {
    shape = shape.slice(0, -2) + attrs + " />";
  } else {
    const i = shape.indexOf(">");
    shape = shape.slice(0, i) + attrs + shape.slice(i);
  }

  // --- transform groups + SMIL ---
  const hasX = !!layer.keys.x, hasY = !!layer.keys.y;
  const hasRot = !!layer.keys.rotation, hasScale = !!layer.keys.scale;

  let outer = `<g id="${layer.id}">`;
  if (hasX || hasY) {
    const ks = unionKeys(layer.keys.x, layer.keys.y);
    const times = ks.map((t) => fmtNum(duration ? t / duration : t));
    const vals = ks.map((t) => {
      const x = getKeyValue(layer, "x", t);
      const y = getKeyValue(layer, "y", t);
      return `${fmtNum(x)},${fmtNum(y)}`;
    });
    outer += `<g transform="translate(${fmtNum(layer.x)},${fmtNum(layer.y)})">`;
    outer += `<animateTransform attributeName="transform" type="translate" values="${vals.join(";")}" keyTimes="${times.join(";")}" dur="${fmtNum(duration)}s" repeatCount="1" fill="freeze" calcMode="linear"/>`;
  } else {
    outer += `<g transform="translate(${fmtNum(layer.x)},${fmtNum(layer.y)})">`;
  }

  if (hasRot || hasScale) {
    if (hasRot) {
      const ks = sortedKeys(layer.keys.rotation);
      const times = ks.map((k) => fmtNum(duration ? k[0] / duration : k[0]));
      const vals = ks.map((k) => `${fmtNum(k[1])}`);
      outer += `<g transform="rotate(${fmtNum(layer.rotation)})">`;
      outer += `<animateTransform attributeName="transform" type="rotate" values="${vals.join(";")}" keyTimes="${times.join(";")}" dur="${fmtNum(duration)}s" repeatCount="1" fill="freeze" calcMode="linear"/>`;
    } else {
      outer += `<g transform="rotate(${fmtNum(layer.rotation)})">`;
    }
    if (hasScale) {
      const ks = sortedKeys(layer.keys.scale);
      const times = ks.map((k) => fmtNum(duration ? k[0] / duration : k[0]));
      const vals = ks.map((k) => `${fmtNum(k[1])}`);
      outer += `<g transform="scale(${fmtNum(layer.scale)})">`;
      outer += `<animateTransform attributeName="transform" type="scale" values="${vals.join(";")}" keyTimes="${times.join(";")}" dur="${fmtNum(duration)}s" repeatCount="1" fill="freeze" calcMode="linear"/>`;
    } else {
      outer += `<g transform="scale(${fmtNum(layer.scale)})">`;
    }
  }

  if (layer.keys.opacity && layer.keys.opacity.length) {
    const ks = sortedKeys(layer.keys.opacity);
    const times = ks.map((k) => fmtNum(duration ? k[0] / duration : k[0]));
    const vals = ks.map((k) => fmtNum(clamp(k[1], 0, 1)));
    outer += `<g opacity="${fmtNum(layer.opacity)}"><animate attributeName="opacity" values="${vals.join(";")}" keyTimes="${times.join(";")}" dur="${fmtNum(duration)}s" repeatCount="1" fill="freeze" calcMode="linear"/>`;
  } else {
    outer += `<g opacity="${fmtNum(layer.opacity)}">`;
  }

  outer += shape;

  // close all groups: id + translate + rotate + scale + opacity
  const opens = 1 + 1 + (hasRot || hasScale ? 1 : 0) + (hasScale ? 1 : 0) + 1;
  outer += "</g>".repeat(opens);

  return outer;
}

function unionKeys(a, b) {
  const set = new Set();
  (a || []).forEach((k) => set.add(Math.round(k[0] * 1000)));
  (b || []).forEach((k) => set.add(Math.round(k[0] * 1000)));
  return Array.from(set).map((ms) => ms / 1000).sort((x, y) => x - y);
}

function escXML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function sceneToSVG(scene, opts = {}) {
  const dur = opts.duration || scene.duration || 2;
  const width = opts.width || scene.width;
  const height = opts.height || scene.height;
  const bg = scene.bgColor && scene.bgColor !== "transparent" && scene.bgColor !== "none"
    ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${scene.bgColor}"/>` : "";
  const defs = "";
  const layers = scene.layers.filter((l) => l.visible)
    .map((l) => layerToSVG(l, dur)).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `  ${bg}\n` + (defs) + `\n  ${layers}\n</svg>`;
}

function cloneLayer(layer) {
  const c = JSON.parse(JSON.stringify(layer));
  c.id = uid("layer");
  return c;
}

function exportJSON(scene) {
  return JSON.stringify({ app: "svgen", version: 1, scene }, null, 2);
}

function importJSON(text) {
  const data = JSON.parse(text);
  return data.scene || data;
}
