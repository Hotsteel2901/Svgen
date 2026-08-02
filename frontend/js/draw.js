// draw.js — renders the scene to a <canvas>, including interpolated animation
// state, onion skin ghosts and selection overlays.

const checkerCache = null;

function hexToRgba(hex, alpha = 1) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) h = h + "ff";
  const n = parseInt(h.slice(0, 8), 16);
  const r = (n >> 24) & 255, g = (n >> 16) & 255, b = (n >> 8) & 255, a = (n & 255) / 255;
  return `rgba(${r},${g},${b},${a * alpha})`;
}

function drawCheckerboard(ctx, width, height, cell = 10) {
  ctx.save();
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) % 2 === 0) ? "#ffffff" : "#e6e9ef";
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.restore();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function traceGeometry(ctx, geom) {
  ctx.beginPath();
  if (geom.kind === "rect") {
    ctx.rect(geom.x, geom.y, geom.w, geom.h);
  } else if (geom.kind === "rounded") {
    roundedRectPath(ctx, geom.x, geom.y, geom.w, geom.h, geom.r);
  } else if (geom.kind === "ellipse") {
    ctx.ellipse(geom.cx, geom.cy, Math.abs(geom.rx), Math.abs(geom.ry), 0, 0, Math.PI * 2);
  } else if (geom.kind === "line") {
    ctx.moveTo(geom.x1, geom.y1);
    ctx.lineTo(geom.x2, geom.y2);
  } else if (geom.kind === "arrow") {
    ctx.moveTo(geom.x1, geom.y1);
    ctx.lineTo(geom.x2, geom.y2);
  } else if (geom.kind === "polygon" || geom.kind === "polyline") {
    const pts = geom.points;
    if (!pts.length) return;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (geom.closed) ctx.closePath();
  } else if (geom.kind === "text") {
    // nothing to trace
  }
}

function drawArrowHead(ctx, x, y, dirX, dirY, size, style) {
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len, uy = dirY / len;
  const px = -uy, py = ux;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * size + px * size * 0.5, y - uy * size + py * size * 0.5);
  ctx.lineTo(x - ux * size - px * size * 0.5, y - uy * size - py * size * 0.5);
  ctx.closePath();
}

function applyLayerTransform(ctx, layer, t) {
  const x = getKeyValue(layer, "x", t);
  const y = getKeyValue(layer, "y", t);
  const rot = getKeyValue(layer, "rotation", t);
  const scale = getKeyValue(layer, "scale", t);
  ctx.translate(x, y);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(scale, scale);
}

function paintLayer(ctx, layer, t, opacityMul = 1) {
  const geom = shapeGeometry(layer);
  const op = getKeyValue(layer, "opacity", t) * opacityMul;
  if (op <= 0.004) return;

  ctx.save();
  applyLayerTransform(ctx, layer, t);
  ctx.globalAlpha = Math.max(0, Math.min(1, op));

  const fill = layer.fill && layer.fill !== "none";
  const stroke = layer.stroke && layer.stroke !== "none";

  if (geom.kind === "line" || geom.kind === "arrow") {
    // strokes only
    ctx.strokeStyle = stroke ? layer.stroke : "#e2e8f0";
    ctx.lineWidth = layer.strokeWidth || 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(geom.x1, geom.y1);
    ctx.lineTo(geom.x2, geom.y2);
    ctx.stroke();
    if (geom.kind === "arrow") {
      ctx.fillStyle = ctx.strokeStyle;
      drawArrowHead(ctx, geom.x2, geom.y2, geom.x2 - geom.x1, geom.y2 - geom.y1,
        16 + (layer.strokeWidth || 2) * 2, "arrow");
      ctx.fill();
    }
  } else if (geom.kind === "text") {
    ctx.fillStyle = fill ? layer.fill : "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${layer.fontSize}px 'HarmonyOS Sans SC', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif`;
    ctx.fillText(layer.text || "", 0, 0);
  } else {
    traceGeometry(ctx, geom);
    if (fill) {
      ctx.fillStyle = layer.fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.strokeWidth || 2;
      ctx.lineJoin = layer.strokeLinejoin || "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }
  ctx.restore();
}

function renderScene(ctx, scene, opts = {}) {
  const w = opts.width || scene.width;
  const h = opts.height || scene.height;
  const t = opts.time != null ? opts.time : scene.currentTime;

  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // checkerboard background (transparent canvas)
  if (opts.checker !== false) {
    drawCheckerboard(ctx, w, h, Math.max(6, Math.round(12 * (opts.scale || 1))));
  }
  if (scene.bgColor && scene.bgColor !== "transparent" && scene.bgColor !== "none") {
    ctx.fillStyle = scene.bgColor;
    ctx.fillRect(0, 0, w, h);
  }

  // onion skin ghosts
  if (opts.onion && opts.onionT != null && scene.playing !== true) {
    for (const back of opts.onionT) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      for (const layer of scene.layers) {
        if (!layer.visible || layer.locked) continue;
        paintLayer(ctx, layer, back, 0.4);
      }
      ctx.restore();
    }
  }

  for (const layer of scene.layers) {
    if (!layer.visible || layer.locked) continue;
    paintLayer(ctx, layer, t);
  }
  ctx.restore();
}

// ---- selection overlay ---------------------------------------------------

function renderSelection(ctx, scene, opts = {}) {
  const t = opts.time != null ? opts.time : scene.currentTime;
  const sel = scene.layers.find((l) => l.id === scene.selectedId);
  if (!sel || !sel.visible) return;
  const b = layerBounds(sel);
  const c = shapeGeometry(sel);

  ctx.save();
  applyLayerTransform(ctx, sel, t);
  const scale = opts.scale || 1;
  ctx.lineWidth = 1.2 / Math.max(0.1, scale);
  ctx.strokeStyle = "#38bdf8";
  ctx.setLineDash([5 / scale, 4 / scale]);
  ctx.strokeRect(b.x - 6 / scale, b.y - 6 / scale, b.w + 12 / scale, b.h + 12 / scale);
  ctx.setLineDash([]);
  ctx.fillStyle = "#0ea5e9";

  // corner handles
  const hs = 8 / scale;
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  for (const [hx, hy] of corners) {
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  }
  // rotate handle
  const rotY = b.y - 26 / scale;
  ctx.beginPath();
  ctx.moveTo(0, b.y);
  ctx.lineTo(0, rotY + 8 / scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, rotY, 7 / scale, 0, Math.PI * 2);
  ctx.fillStyle = "#a78bfa";
  ctx.fill();
  ctx.restore();
}

// ---- hit testing ---------------------------------------------------------

function pointInLayer(ctx, layer, t, px, py) {
  const geom = shapeGeometry(layer);
  ctx.save();
  applyLayerTransform(ctx, layer, t);
  ctx.beginPath();
  if (geom.kind === "rect") ctx.rect(geom.x, geom.y, geom.w, geom.h);
  else if (geom.kind === "rounded") roundedRectPath(ctx, geom.x, geom.y, geom.w, geom.h, geom.r);
  else if (geom.kind === "ellipse") ctx.ellipse(0, 0, Math.abs(geom.rx), Math.abs(geom.ry), 0, 0, Math.PI * 2);
  else if (geom.kind === "line" || geom.kind === "arrow") {
    ctx.moveTo(geom.x1, geom.y1); ctx.lineTo(geom.x2, geom.y2);
    ctx.lineWidth = Math.max(8, (layer.strokeWidth || 2) + 4);
    const hit = ctx.isPointInStroke(px, py);
    ctx.restore();
    return hit;
  } else if (geom.kind === "polygon" || geom.kind === "polyline") {
    const pts = geom.points;
    if (pts.length) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (geom.closed) ctx.closePath();
    }
    if (geom.kind === "polyline") {
      ctx.lineWidth = Math.max(8, (layer.strokeWidth || 2) + 4);
      const hit = ctx.isPointInStroke(px, py);
      ctx.restore();
      return hit;
    }
  } else if (geom.kind === "text") {
    const b = layerBounds(layer);
    ctx.restore();
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }
  const inside = ctx.isPointInPath(px, py);
  ctx.restore();
  return inside;
}

function hitTestLayers(ctx, scene, px, py, t) {
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const l = scene.layers[i];
    if (!l.visible || l.locked) continue;
    if (pointInLayer(ctx, l, t, px, py)) return l;
  }
  return null;
}
