// app.js 鈥?application bootstrap, canvas viewport, preview loop, shortcuts.

function createDefaultScene() {
  return {
    width: 1280,
    height: 720,
    fps: 30,
    duration: 2,
    bgColor: "transparent",
    loop: true,
    onion: false,
    currentTime: 0,
    playing: false,
    selectedId: null,
    layers: [],
  };
}

class App {
  constructor() {
    this.scene = createDefaultScene();
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.shiftKey = false;
    this.history = [];
    this.historyIdx = -1;
    this.rafId = null;
    this.lastFrame = 0;
    this.conn = Conn;
    this._saveT = null;

    this.canvas = document.getElementById("stage");
    this.ctx = this.canvas.getContext("2d");

    this.tool = new ToolController(this);
    this.timeline = new Timeline(this);
    this.panels = new Panels(this);

    this.bindToolbar();
    this.bindKeyboard();
    this.bindViewport();
    this.bindHelpModal();

    this.conn.onChange((online, first) => this.onConnectionChange(online, first));
    this.conn.start();

    this.pushHistory();
    this.timeline.build();
    this.panels.render();
    this.requestRender();
    if (!this.restoreAutosave()) {
      this.setupDemo();
    }
    this.updateHud();
  }

  // ---- toolbar ----------------------------------------------------------

  bindToolbar() {
    document.querySelectorAll(".tool-btn[data-tool]").forEach((b) => {
      b.addEventListener("click", () => {
        this.setTool(b.dataset.tool);
        this.status(t("st.tool", { name: b.title || b.dataset.tool }));
      });
    });

    const bind = (id, fn) => document.getElementById(id).addEventListener("click", fn);
    bind("undo", () => this.undo());
    bind("redo", () => this.redo());
    bind("zoom-in", () => this.setZoom(this.view.zoom * 1.25));
    bind("zoom-out", () => this.setZoom(this.view.zoom / 1.25));
    bind("zoom-fit", () => this.setZoom(1));
    bind("grid", () => this.toggleGrid());
    bind("new-file", () => this.newScene());
    bind("open-file", () => document.getElementById("file-open").click());
    bind("save-file", () => this.saveScene());
    bind("import-svg", () => document.getElementById("file-svg").click());
    bind("clear-all", () => this.clearAll());

    document.getElementById("file-open").addEventListener("change", (e) => this.openScene(e));
    document.getElementById("file-svg").addEventListener("change", (e) => this.importSVG(e));

    const langBtn = document.getElementById("lang-toggle");
    if (langBtn) langBtn.addEventListener("click", () => setLang(LANG === "zh" ? "en" : "zh"));

    // fill / stroke quick pickers in toolbar
    document.getElementById("t-fill").addEventListener("input", (e) => {
      this.paintStyle.fill = e.target.value;
      this.applyPaintStyleToSelection("fill");
    });
    document.getElementById("t-stroke").addEventListener("input", (e) => {
      this.paintStyle.stroke = e.target.value;
      this.applyPaintStyleToSelection("stroke");
    });
    document.getElementById("t-stroke-w").addEventListener("change", (e) => {
      this.paintStyle.strokeWidth = parseFloat(e.target.value);
      this.applyPaintStyleToSelection("strokeWidth");
    });
  }

  get paintStyle() {
    if (!this._paintStyle) this._paintStyle = { fill: "#6366f1", stroke: "#e2e8f0", strokeWidth: 3 };
    return this._paintStyle;
  }

  applyPaintStyleToSelection(prop) {
    const sel = this.scene.layers.find((l) => l.id === this.scene.selectedId);
    if (sel) {
      if (prop === "fill") sel.fill = this.paintStyle.fill;
      else if (prop === "stroke") sel.stroke = this.paintStyle.stroke;
      else if (prop === "strokeWidth") sel.strokeWidth = this.paintStyle.strokeWidth;
      this.pushHistory();
      this.requestRender();
      this.panels.render();
    }
  }

  setTool(tool) {
    this.tool.tool = tool;
    document.querySelectorAll(".tool-btn[data-tool]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === tool);
    });
    this.canvas.style.cursor = tool === "select" ? "default" : "crosshair";
  }

  // ---- canvas / viewport --------------------------------------------------

  bindViewport() {
    const wrap = document.getElementById("stage-wrap");
    const dpr = window.devicePixelRatio || 1;
    const layout = () => {
      const z = this.view.zoom;
      const px = this.scene.width * z, py = this.scene.height * z;
      this.canvas.style.width = px + "px";
      this.canvas.style.height = py + "px";
      this.canvas.width = Math.max(1, Math.round(px * dpr));
      this.canvas.height = Math.max(1, Math.round(py * dpr));
      this.ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
    };
    layout();
    window.addEventListener("resize", layout);

    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        this.setZoom(clamp(this.view.zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.05, 32));
      } else {
        this.view.panX -= e.deltaX;
        this.view.panY -= e.deltaY;
        this.requestRender();
      }
    }, { passive: false });

    wrap.addEventListener("contextmenu", (e) => e.preventDefault());

    // pointer events
    const down = (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.tool.pointerDown(e);
    };
    const move = (e) => this.tool.pointerMove(e);
    const up = (e) => this.tool.pointerUp(e);
    this.canvas.addEventListener("pointerdown", down);
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  bindHelpModal() {
    const modal = document.getElementById("help-modal");
    const toggle = (show) => {
      modal.classList.toggle("hidden", !show);
      if (show) this.fillAbout();
    };
    document.getElementById("help-close").addEventListener("click", () => toggle(false));
    modal.addEventListener("click", (e) => { if (e.target === modal) toggle(false); });
    this._toggleHelp = () => {
      const hidden = modal.classList.contains("hidden");
      toggle(hidden);
      return hidden;
    };
  }

  fillAbout() {
    const modal = document.getElementById("help-modal");
    if (!modal) return;
    modal.querySelector(".about-head").textContent = t("about.title") + " — SVGen Studio";
    modal.querySelector(".about-text").textContent = t("font.notice");
    modal.querySelector(".about-tm").textContent = t("font.trademark");
  }

  setZoom(z) {
    this.view.zoom = clamp(z, 0.05, 32);
    this.updateZoomLabel();
    this.requestRender();
  }

  updateZoomLabel() {
    const el = document.getElementById("zoom-label");
    if (el) el.textContent = Math.round(this.view.zoom * 100) + "%";
  }

  // ---- toast notifications -------------------------------------------------

  toast(msg, type = "info", duration = 3200) {
    const wrap = document.getElementById("toasts");
    if (!wrap) return;
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.innerHTML = `<span class="t-dot"></span><span>${escXML(msg)}</span>`;
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .3s";
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 320);
    }, duration);
  }

  // ---- backend connection ---------------------------------------------------

  onConnectionChange(online, first) {
    const pill = document.getElementById("engine-pill");
    if (pill) {
      pill.textContent = online ? "鈼?backend online" : "鈼?backend offline";
      pill.classList.toggle("ok", online);
      pill.classList.toggle("bad", !online);
    }
    this.panels.render(); // export controls reflect online state
    if (!first) {
      this.toast(online ? t("toast.reconnected") : t("toast.lost"), online ? "ok" : "err");
    }
  }

  toggleGrid() {
    this.scene.grid = !this.scene.grid;
    document.getElementById("grid").classList.toggle("active", !!this.scene.grid);
    this.requestRender();
  }

  // ---- render loop ---------------------------------------------------------

  requestRender() {
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.render();
      });
    }
  }

  render() {
    const scene = this.scene;
    const ctx = this.ctx;
    // pan offset
    ctx.save();
    ctx.translate(this.view.panX, this.view.panY);
    if (scene.grid) this.drawGrid();
    renderScene(ctx, scene, {
      time: scene.currentTime,
      onion: scene.onion,
      onionT: [scene.currentTime - 1 / scene.fps, scene.currentTime + 1 / scene.fps],
      scale: this.view.zoom,
      checker: true,
    });
    renderSelection(ctx, scene, { time: scene.currentTime, scale: this.view.zoom });
    ctx.restore();
    this.timeline.positionPlayhead();
    this.timeline.refresh();
    this.updateHud();
  }

  updateHud() {
    const hint = document.getElementById("hint-pill");
    if (hint) hint.classList.toggle("hidden", this.scene.layers.length > 0);
    const z = document.getElementById("zoom-label");
    if (z && z.textContent !== Math.round(this.view.zoom * 100) + "%") this.updateZoomLabel();
    const sel = this.scene.layers.find((l) => l.id === this.scene.selectedId);
    const sb = document.getElementById("status-text");
    if (sb) {
      const count = this.scene.layers.length;
      const name = sel ? ` 路 ${sel.name}` : "";
      if (this._statusMsg) {
        sb.textContent = this._statusMsg + ` 鈥?${count} layer${count === 1 ? "" : "s"}${name}`;
      } else {
        sb.textContent = `${count} layer${count === 1 ? "" : "s"}${name}`;
      }
    }
  }

  status(msg) {
    this._statusMsg = msg;
    const el = document.getElementById("status-text");
    if (el && !msg) el.textContent = "";
    this.updateHud();
  }

  // ---- autosave -------------------------------------------------------------

  _autosaveKey() { return "svgen-scene-v1"; }

  autosave() {
    if (this._saveT) clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try {
        localStorage.setItem(this._autosaveKey(), exportJSON(this.scene));
      } catch (e) { /* storage full / unavailable 鈥?ignore */ }
    }, 600);
  }

  restoreAutosave() {
    try {
      const raw = localStorage.getItem(this._autosaveKey());
      if (!raw) return false;
      const saved = importJSON(raw);
      if (!saved || !Array.isArray(saved.layers)) return false;
      this.scene = saved;
      this.pushHistory();
      this.status(t("st.restored"));
      return true;
    } catch (e) {
      return false;
    }
  }

  clearAutosave() {
    try { localStorage.removeItem(this._autosaveKey()); } catch (e) {}
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x <= this.scene.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.scene.height); ctx.stroke();
    }
    for (let y = 0; y <= this.scene.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.scene.width, y); ctx.stroke();
    }
    ctx.restore();
  }

  // ---- time & playback ------------------------------------------------------

  setTime(t) {
    this.scene.currentTime = clamp(t, 0, this.scene.duration);
  }

  togglePlay() {
    this.scene.playing = !this.scene.playing;
    if (this.scene.playing) {
      if (this.scene.currentTime >= this.scene.duration - 1e-4) this.scene.currentTime = 0;
      this.lastFrame = performance.now();
      this._tick();
    } else {
      cancelAnimationFrame(this._tickRaf);
    }
    this.timeline.refresh();
  }

  _tick() {
    if (!this.scene.playing) return;
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    this.scene.currentTime += dt;
    if (this.scene.currentTime >= this.scene.duration) {
      if (this.scene.loop) this.scene.currentTime -= this.scene.duration;
      else { this.scene.currentTime = this.scene.duration; this.stop(); return; }
    }
    this.requestRender();
    this._tickRaf = requestAnimationFrame(() => this._tick());
  }

  stop() {
    this.scene.playing = false;
    cancelAnimationFrame(this._tickRaf);
    this.timeline.refresh();
  }

  // ---- history ---------------------------------------------------------------

  snapshot() { return JSON.stringify(this.scene); }

  pushHistory() {
    this.historyIdx++;
    this.history = this.history.slice(0, this.historyIdx);
    this.history.push(this.snapshot());
    if (this.history.length > 200) { this.history.shift(); this.historyIdx--; }
    this.updateHistoryButtons();
    this.autosave();
  }

  undo() {
    if (this.historyIdx <= 0) return;
    this.historyIdx--;
    this.scene = JSON.parse(this.history[this.historyIdx]);
    this.updateHistoryButtons();
    this.requestRender();
    this.scheduleRebuild();
  }

  redo() {
    if (this.historyIdx >= this.history.length - 1) return;
    this.historyIdx++;
    this.scene = JSON.parse(this.history[this.historyIdx]);
    this.updateHistoryButtons();
    this.requestRender();
    this.scheduleRebuild();
  }

  updateHistoryButtons() {
    document.getElementById("undo").disabled = this.historyIdx <= 0;
    document.getElementById("redo").disabled = this.historyIdx >= this.history.length - 1;
  }

  scheduleRebuild() {
    if (this._rebuildT) clearTimeout(this._rebuildT);
    this._rebuildT = setTimeout(() => { this.timeline.rebuild(); this.panels.render(); }, 120);
  }

  // ---- selection ----------------------------------------------------------------

  selectLayer(id) {
    this.scene.selectedId = id;
    this.panels.render();
    this.timeline.refresh();
  }

  focusTextProperty() {
    this.panels.focusText();
  }

  status(msg) {
    document.getElementById("status-text").textContent = msg;
  }

  // ---- keyboard ------------------------------------------------------------------

  bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); this.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); this.saveScene(); return; }
      if (k === " ") { this.tool.handMode = true; this.canvas.style.cursor = "grab"; }
      if (e.shiftKey) this.shiftKey = true;
      const tools = { v: "select", p: "pen", l: "line", a: "arrow", r: "rect",
        o: "ellipse", s: "star", g: "poly", t: "text", b: "path" };
      if (tools[k]) { this.setTool(tools[k]); this.status(t("st.tool", { name: tools[k] })); }
      if (k === "delete" || k === "backspace") this.deleteSelected();
      if (k === "k") this.timeline.toggleKeyAtPlayhead();
      if (k === "?" || (e.key === "F1")) this._toggleHelp();
      if (k === " ") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === " ") { this.tool.handMode = false; this.canvas.style.cursor = ""; }
      if (e.key === "Shift") this.shiftKey = false;
    });
  }

  deleteSelected() {
    const sel = this.scene.layers.find((l) => l.id === this.scene.selectedId);
    if (!sel) return;
    this.scene.layers = this.scene.layers.filter((l) => l.id !== sel.id);
    this.scene.selectedId = null;
    this.pushHistory();
    this.requestRender();
    this.scheduleRebuild();
  }

  // ---- files --------------------------------------------------------------------------

  newScene() {
    if (this.scene.layers.length && !confirm("Start a new canvas? Current work will be lost.")) return;
    this.scene = createDefaultScene();
    this.pushHistory();
    this.clearAutosave();
    this.timeline.rebuild();
    this.panels.render();
    this.requestRender();
    this.status("");
    this.toast(t("toast.newScene"), "info");
  }

  saveScene() {
    const json = exportJSON(this.scene);
    downloadBlob(new Blob([json], { type: "application/json" }), "scene.svgen.json");
  }

  openScene(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.scene = importJSON(reader.result);
        this.pushHistory();
        this.timeline.rebuild();
        this.panels.render();
        this.requestRender();
        this.status(t("exp.sceneLoaded"));
      } catch (err) { this.status(t("exp.loadFailed") + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  importSVG(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const svgText = reader.result;
        const layers = parseSimpleSVG(svgText);
        if (layers.length) {
          this.scene.layers.push(...layers);
          this.pushHistory();
          this.timeline.rebuild();
          this.panels.render();
          this.requestRender();
          this.status(t("exp.imported", { n: layers.length }));
        } else {
          this.status(t("exp.importNone"));
        }
      } catch (err) { this.status(t("exp.failed") + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  clearAll() {
    if (this.scene.layers.length && !confirm("Delete all shapes?")) return;
    this.scene.layers = [];
    this.scene.selectedId = null;
    this.pushHistory();
    this.timeline.rebuild();
    this.panels.render();
    this.requestRender();
  }

  // ---- demo / prefs -----------------------------------------------------------------------

  setupDemo() {
    const s = this.scene;
    const mk = (type, x, y, w, h, fill) => {
      const l = defaultLayer(type);
      l.x = x; l.y = y; l.width = w; l.height = h; l.fill = fill;
      return l;
    };
    // simple demo: sun + bouncing ball
    const sun = mk("circle" === "ellipse" ? "ellipse" : "ellipse", s.width / 2, 90, 120, 120, "#fbbf24");
    sun.name = "Sun";
    sun.stroke = "#f59e0b"; sun.strokeWidth = 6;
    const ball = defaultLayer("ellipse");
    ball.x = s.width / 2; ball.y = 220; ball.width = 90; ball.height = 90; ball.fill = "#f43f5e";
    ball.name = "Ball";
    setKeyframe(ball, "x", 0, 240);
    setKeyframe(ball, "x", 1, s.width - 240);
    setKeyframe(ball, "y", 0, 200);
    setKeyframe(ball, "y", 1, s.height - 140);
    setKeyframe(ball, "scale", 0.5, 1.35);
    setKeyframe(ball, "scale", 1, 0.7);
    setKeyframe(ball, "rotation", 0, 0);
    setKeyframe(ball, "rotation", 1, 360);
    const ground = mk("rect", s.width / 2, s.height - 60, s.width - 120, 60, "#0f172a");
    ground.name = "Ground"; ground.rx = 14;
    const label = defaultLayer("text");
    label.x = s.width / 2; label.y = 40; label.text = "SVGen Studio"; label.fontSize = 44;
    label.fill = "#f8fafc"; label.name = "Title";
    s.layers = [ground, sun, ball, label];
    s.selectedId = ball.id;
  }

  loadPreferences() {
    // connection state is managed by Conn (health polling)
  }
}

// ---- lightweight SVG shape importer --------------------------------------------

function parseSimpleSVG(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const out = [];
  const svg = doc.querySelector("svg");
  if (svg && svg.getAttribute("viewBox")) {
    const vb = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
    if (vb.length === 4) { window._importVB = vb; }
  }
  const parseAttrs = (el, layer) => {
    const fill = el.getAttribute("fill");
    if (fill && fill !== "none") layer.fill = fill;
    else layer.fill = "none";
    const stroke = el.getAttribute("stroke");
    if (stroke && stroke !== "none") layer.stroke = stroke;
    const sw = el.getAttribute("stroke-width");
    if (sw) layer.strokeWidth = parseFloat(sw) || 2;
    const op = el.getAttribute("opacity");
    if (op) layer.opacity = parseFloat(op) || 1;
    const tf = el.getAttribute("transform");
    if (tf) {
      const m = /translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\)/.exec(tf);
      if (m) { layer.x = parseFloat(m[1]); layer.y = parseFloat(m[2]); }
    }
  };
  const centerFromVB = (x, y) => {
    const vb = window._importVB;
    return { x: (x - vb[0]), y: (y - vb[1]) };
  };
  doc.querySelectorAll("rect, ellipse, circle, line, polygon").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    let layer;
    if (tag === "rect") {
      layer = defaultLayer("rect");
      const x = parseFloat(el.getAttribute("x") || 0) + (parseFloat(el.getAttribute("width")) || 0) / 2;
      const y = parseFloat(el.getAttribute("y") || 0) + (parseFloat(el.getAttribute("height")) || 0) / 2;
      const c = centerFromVB(x, y);
      layer.x = c.x; layer.y = c.y;
      layer.width = parseFloat(el.getAttribute("width")) || 100;
      layer.height = parseFloat(el.getAttribute("height")) || 100;
      const rx = el.getAttribute("rx");
      if (rx) layer.rx = parseFloat(rx);
    } else if (tag === "ellipse" || tag === "circle") {
      layer = defaultLayer("ellipse");
      const r = tag === "circle" ? parseFloat(el.getAttribute("r") || 0) : null;
      const rx = r || parseFloat(el.getAttribute("rx") || 0);
      const ry = r || parseFloat(el.getAttribute("ry") || 0);
      const c = centerFromVB(parseFloat(el.getAttribute("cx") || 0), parseFloat(el.getAttribute("cy") || 0));
      layer.x = c.x; layer.y = c.y;
      layer.width = rx * 2; layer.height = ry * 2;
    } else if (tag === "line") {
      layer = defaultLayer("line");
      const x1 = parseFloat(el.getAttribute("x1") || 0), y1 = parseFloat(el.getAttribute("y1") || 0);
      const x2 = parseFloat(el.getAttribute("x2") || 0), y2 = parseFloat(el.getAttribute("y2") || 0);
      const c = centerFromVB((x1 + x2) / 2, (y1 + y2) / 2);
      layer.x = c.x; layer.y = c.y;
      layer.width = Math.max(8, Math.hypot(x2 - x1, y2 - y1));
      layer.rotation = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    } else if (tag === "polygon") {
      layer = defaultLayer("poly");
      const pts = (el.getAttribute("points") || "").trim().split(/\s+/).map(Number);
      const arr = [];
      for (let i = 0; i < pts.length; i += 2) arr.push([pts[i], pts[i + 1]]);
      let cx = 0, cy = 0;
      for (const [x, y] of arr) { cx += x; cy += y; }
      cx /= arr.length; cy /= arr.length;
      const c = centerFromVB(cx, cy);
      layer.x = c.x; layer.y = c.y;
      layer.width = layer.height = 160;
      layer.points = arr.map(([x, y]) => [x - cx, y - cy]);
      layer.closed = true;
    }
    if (layer) {
      parseAttrs(el, layer);
      layer.name = typeName(layer.type);
      out.push(layer);
    }
  });
  return out;
}

window.addEventListener("DOMContentLoaded", () => {
  window.app = new App();
  applyI18n();
});
