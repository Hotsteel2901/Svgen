// tools.js — pointer interaction: drawing, selecting, moving, resizing.

class ToolController {
  constructor(app) {
    this.app = app;
    this.active = null;      // current gesture state
    this.tool = "select";
    this.handMode = false;   // space held -> pan/zoom wheel still on
  }

  get scene() { return this.app.scene; }
  get canvas() { return this.app.canvas; }

  toScene(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const app = this.app;
    return {
      x: (clientX - r.left) / app.view.zoom,
      y: (clientY - r.top) / app.view.zoom,
    };
  }

  // ---- pointer handlers --------------------------------------------------

  pointerDown(e) {
    const p = this.toScene(e.clientX, e.clientY);
    if (e.button === 1 || this.handMode) {
      this.active = { kind: "pan", last: p };
      e.preventDefault();
      return;
    }
    const t = this.scene.currentTime;
    if (this.tool === "select") return this._selectDown(e, p, t);
    if (this.tool === "pen" || this.tool === "path") return this._penDown(e, p);
    if (this.tool === "text") return this._textPlace(e, p);
    return this._shapeDown(e, p, this.tool);
  }

  pointerMove(e) {
    const p = this.toScene(e.clientX, e.clientY);
    const a = this.active;
    if (!a) return;
    const app = this.app;
    if (a.kind === "pan") {
      app.view.panX += p.x - a.last.x;
      app.view.panY += p.y - a.last.y;
      a.last = p;
      app.requestRender();
      return;
    }
    if (a.kind === "draw" || a.kind === "freehand") {
      if (a.kind === "draw") {
        a.end = p;
        this._updatePreview();
      } else {
        const d = Math.hypot(p.x - a.pts[a.pts.length - 1][0], p.y - a.pts[a.pts.length - 1][1]);
        if (d > 1.5) { a.pts.push([p.x, p.y]); this._updateFreehandPreview(); }
      }
      app.requestRender();
      return;
    }
    if (a.kind === "move") this._move(a, p);
    else if (a.kind === "resize") this._resize(a, p);
    else if (a.kind === "rotate") this._rotate(a, p);
  }

  pointerUp(e) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const app = this.app;
    if (a.kind === "draw") this._commitDraw(a);
    else if (a.kind === "freehand") this._commitFreehand(a);
    else if (a.kind === "move" || a.kind === "resize" || a.kind === "rotate") app.pushHistory();
    app.requestRender();
  }

  // ---- select/move/resize ------------------------------------------------

  _selectDown(e, p, t) {
    const app = this.app;
    const hit = hitTestLayers(app.ctx, this.scene, p.x, p.y, t);
    if (!hit) {
      // empty area -> deselect
      app.selectLayer(null);
      app.pushHistory();
      app.requestRender();
      return;
    }
    app.selectLayer(hit.id);
    app.requestRender();
    // detect resize handle
    const handle = this._hitHandle(hit, p, t);
    if (handle === "move") {
      this.active = { kind: "move", layer: hit, start: p, origX: hit.x, origY: hit.y };
    } else if (handle === "rotate") {
      this.active = { kind: "rotate", layer: hit, start: p, origRot: hit.rotation };
    } else if (handle) {
      this.active = { kind: "resize", layer: hit, corner: handle, start: p,
        orig: { x: hit.x, y: hit.y, w: hit.width, h: hit.height } };
    } else {
      this.active = { kind: "move", layer: hit, start: p, origX: hit.x, origY: hit.y };
    }
    e.preventDefault();
  }

  _hitHandle(layer, p, t) {
    const app = this.app;
    const scale = app.view.zoom;
    const b = layerBounds(layer);
    const c = shapeGeometry(layer);
    const ctx = app.ctx;
    ctx.save();
    applyLayerTransform(ctx, layer, t);
    const tol = 10 / scale;
    const corners = { nw: [b.x, b.y], ne: [b.x + b.w, b.y], se: [b.x + b.w, b.y + b.h], sw: [b.x, b.y + b.h] };
    for (const [name, [hx, hy]] of Object.entries(corners)) {
      if (Math.hypot(p.x - hx, p.y - hy) <= tol * 1.6) { ctx.restore(); return name; }
    }
    // rotate handle
    const ry = b.y - 26 / scale;
    if (Math.hypot(p.x, p.y - ry) <= tol * 1.6) { ctx.restore(); return "rotate"; }
    ctx.restore();
    if (pointInLayer(ctx, layer, t, p.x, p.y)) return "move";
    return null;
  }

  _move(a, p) {
    const l = a.layer;
    const t = this.scene.currentTime;
    // if animated, keep relative offsets from current animated value
    const ax = getKeyValue(l, "x", t);
    const ay = getKeyValue(l, "y", t);
    let dx = p.x - a.start.x;
    let dy = p.y - a.start.y;
    if (this.app.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    const nx = a.origX + dx;
    const ny = a.origY + dy;
    if (l.keys.x && l.keys.x.length) {
      const base = getKeyValue(l, "x", t);
      for (const k of l.keys.x) k[1] += nx - base;
    } else {
      l.x = nx;
    }
    if (l.keys.y && l.keys.y.length) {
      const base = getKeyValue(l, "y", t);
      for (const k of l.keys.y) k[1] += ny - base;
    } else {
      l.y = ny;
    }
    this.app.requestRender();
  }

  _resize(a, p, t) {
    const l = a.layer;
    const dx = p.x - a.start.x;
    const dy = p.y - a.start.y;
    const shift = this.app.shiftKey;
    let w = a.orig.w, h = a.orig.h, x = a.orig.x, y = a.orig.y;
    if (a.corner.includes("e")) w = a.orig.w + dx;
    if (a.corner.includes("s")) h = a.orig.h + dy;
    if (a.corner.includes("w")) { w = a.orig.w - dx; x = a.orig.x + dx / 2; }
    if (a.corner.includes("n")) { h = a.orig.h - dy; y = a.orig.y + dy / 2; }
    if (shift) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = s * Math.sign(w || 1); h = s * Math.sign(h || 1);
    }
    l.width = Math.max(1, Math.abs(w));
    l.height = Math.max(1, Math.abs(h));
    if (l.type === "line" || l.type === "arrow") l.height = 0;
    if (a.corner.includes("w") || a.corner.includes("n")) {
      l.x = x;
      l.y = y;
    }
    this.app.requestRender();
  }

  _rotate(a, p) {
    const l = a.layer;
    const dx = p.x, dy = p.y;
    l.rotation = Math.atan2(dy, dx) * 180 / Math.PI;
    this.app.requestRender();
  }

  // ---- shape tools -------------------------------------------------------

  _shapeDown(e, p, tool) {
    this.active = { kind: "draw", tool, start: p, end: p, raw: [], committed: false };
    this._updatePreview();
    this.app.requestRender();
    e.preventDefault();
  }

  _updatePreview() {
    const a = this.active;
    if (a.kind !== "draw") return;
    const s = a.start, e2 = a.end;
    const tool = a.tool;
    let layer = defaultLayer(tool === "rect" ? "rect" : tool === "rounded" ? "rounded" : tool);
    if (tool === "rounded") layer.rx = 24;
    const dx = e2.x - s.x, dy = e2.y - s.y;
    const shift = this.app.shiftKey;
    let w = Math.abs(dx), h = Math.abs(dy);
    if (shift && tool !== "line" && tool !== "arrow") { const m = Math.max(w, h); w = m; h = m; }
    const cx = s.x + dx / 2, cy = s.y + dy / 2;
    if (tool === "line" || tool === "arrow") {
      const ang = shift ? Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4) : Math.atan2(dy, dx);
      layer.x = cx; layer.y = cy;
      layer.width = Math.max(8, Math.hypot(dx, dy));
      layer.height = 0;
      layer.rotation = (ang * 180) / Math.PI;
    } else {
      layer.x = cx; layer.y = cy;
      layer.width = Math.max(4, w); layer.height = Math.max(4, h);
      if (tool === "poly" || tool === "star") {
        layer.points = polygonPoints(0, 0, layer.sides, Math.min(w, h) / 2, 0, tool === "star" ? Math.min(w, h) / 4 : 0);
      }
    }
    if (a.preview) this.scene.layers = this.scene.layers.filter((l) => l.id !== a.preview.id);
    a.preview = layer;
    a.preview.id = "preview";
    this.scene.layers.push(a.preview);
  }

  _commitDraw(a) {
    if (a.preview) {
      this.scene.layers = this.scene.layers.filter((l) => l.id !== a.preview.id);
      if (a.preview.width > 4 || a.preview.height > 4 || a.preview.type === "line" || a.preview.type === "arrow") {
        const l = cloneLayer(a.preview);
        l.name = typeName(l.type);
        this.scene.layers.push(l);
        this.app.selectLayer(l.id);
        this.app.pushHistory();
      }
    }
  }

  // ---- freehand ----------------------------------------------------------

  _penDown(e, p) {
    this.active = { kind: "freehand", pts: [[p.x, p.y]], preview: null };
    this._updatePreview();
    this.app.requestRender();
    e.preventDefault();
  }

  _updateFreehandPreview() {
    const a = this.active;
    if (a.kind !== "freehand") return;
    let layer = defaultLayer("pen");
    const pts = a.pts;
    let cx = 0, cy = 0;
    for (const [x, y] of pts) { cx += x; cy += y; }
    cx /= pts.length; cy /= pts.length;
    layer.points = pts.map(([x, y]) => [x - cx, y - cy]);
    layer.x = cx; layer.y = cy;
    layer.fill = "none";
    if (a.preview) this.scene.layers = this.scene.layers.filter((l) => l.id !== a.preview.id);
    a.preview = layer;
    a.preview.id = "preview";
    this.scene.layers.push(a.preview);
  }

  _commitFreehand(a) {
    if (a.preview) {
      this.scene.layers = this.scene.layers.filter((l) => l.id !== a.preview.id);
      if (a.pts.length > 2) {
        const l = cloneLayer(a.preview);
        l.name = typeName("pen");
        this.scene.layers.push(l);
        this.app.selectLayer(l.id);
        this.app.pushHistory();
      }
    }
  }

  // ---- text --------------------------------------------------------------

  _textPlace(e, p) {
    const layer = defaultLayer("text");
    layer.x = p.x; layer.y = p.y;
    layer.text = "Text";
    this.scene.layers.push(layer);
    this.app.selectLayer(layer.id);
    this.app.pushHistory();
    this.app.requestRender();
    this.app.focusTextProperty();
  }
}
