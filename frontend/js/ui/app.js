/**
 * The studio application object.
 *
 * Owns the document, the history stack, selection, playback, file I/O and the
 * connection to the backend. Panels read from it and listen to its events; it
 * never reaches into a panel's DOM.
 */

import { Emitter } from "../core/emitter.js";
import { toPlain } from "../core/scene.js";
import { createElement, sceneBounds } from "../core/elements.js";
import { sceneToSVG } from "../core/svg-export.js";
import { parseSVG } from "../core/svg-import.js";
import { flipElement } from "../core/transform.js";
import { clamp, debounce, deepClone, downloadBlob, readFileText, safeName, uid } from "../core/util.js";
import { api, Connection } from "../net/api.js";
import { t } from "../i18n/index.js";
import { confirmDialog, modal, toast } from "./shell.js";
import { openCanvasMenu } from "./contextmenu.js";

const AUTOSAVE_KEY = "svgen.scene.v2";
const AUTOSAVE_DELAY = 800;

export class App extends Emitter {
  constructor({ scene, history, stage, onEvent }) {
    super();
    this.scene = scene;
    this.history = history;
    this.stage = stage;
    this.onEvent = onEvent || (() => {});

    this.paint = { fill: "#cbff4d", stroke: "#edeff3", strokeWidth: 3 };
    /** Freehand brush. `size` drives stroke width; the rest shape the stroke. */
    this.brush = { size: 6, opacity: 1, smoothing: 0.55, stabiliser: 0.35 };
    this.dirty = false;
    this.playing = false;
    this.spaceDown = false;
    this._playRaf = 0;
    this._lastTick = 0;
    this._clipboard = null;
    this._persist = debounce(() => this.persist(), AUTOSAVE_DELAY);

    this.conn = new Connection({ interval: 8000 });
    this.conn.subscribe((online, meta) => this._onConnection(online, meta));
  }

  t(key, vars) {
    return t(key, vars);
  }

  get doc() {
    return this.scene.doc;
  }

  start() {
    this.conn.start();
    this.scene.on("change", () => {
      this.stage?.invalidate();
      this.emit("change");
    });
    this.scene.on("selection", () => {
      this.stage?.invalidate();
      this.emit("selection");
    });
    this.scene.on("time", () => {
      this.stage?.invalidate();
      this.emit("time");
    });
    this.scene.on("history", () => {
      this.emit("history");
    });
  }

  /** Panels register themselves here after construction. */
  attach(panels) {
    Object.assign(this, panels);
    this.topbar?.syncAll?.();
  }

  status(message) {
    this.emit("status", message);
    this.onEvent("status", message);
  }

  toastMessage(message, kind = "info") {
    toast(message, { kind });
  }

  markDirty() {
    this.dirty = true;
    this.emit("dirty");
    this._persist();
  }

  /* ------------------------------------------------------------ tools/paint */

  setTool(id) {
    this.tools.setTool(id);
    this.emit("tool", id);
  }

  setFill(color) {
    this.paint.fill = color;
    this.rail?.syncPaint();
    const sel = this.scene.selectedElements();
    if (sel.length) {
      this.scene.update({ fill: color }, { label: "style" });
      this.markDirty();
      this.dock?.refreshTab("inspector");
    }
  }

  setStroke(color) {
    this.paint.stroke = color;
    this.rail?.syncPaint();
    const sel = this.scene.selectedElements();
    if (sel.length) {
      this.scene.update({ stroke: color }, { label: "style" });
      this.markDirty();
      this.dock?.refreshTab("inspector");
    }
  }

  setStrokeWidth(width) {
    this.paint.strokeWidth = width;
    this.rail?.syncPaint();
    const sel = this.scene.selectedElements();
    if (sel.length) {
      this.scene.update({ strokeWidth: width }, { label: "style" });
      this.markDirty();
      this.dock?.refreshTab("inspector");
    }
  }

  swapColors() {
    const { fill, stroke } = this.paint;
    this.paint.fill = stroke;
    this.paint.stroke = fill;
    this.rail?.syncPaint();
    const sel = this.scene.selectedElements();
    if (sel.length) {
      this.scene.update({ fill: stroke, stroke: fill }, { label: "style" });
      this.markDirty();
      this.dock?.refreshTab("inspector");
    }
  }

  /* ------------------------------------------------------------ elements */

  /** A fresh element seeded with the current paint settings. */
  newElement(type) {
    const el = createElement(type);
    if (type === "path") {
      // Freehand geometry is described by the brush, not by shape defaults.
      el.fill = null;
      el.stroke = this.paint.stroke;
      el.strokeWidth = this.brush.size;
      el.opacity = this.brush.opacity;
      el.strokeCap = "round";
      el.strokeJoin = "round";
      el.smooth = true;
      return el;
    }
    const stroked = type === "line" || type === "arrow";
    if (stroked) {
      el.fill = null;
      el.stroke = this.paint.stroke;
      el.strokeWidth = this.paint.strokeWidth;
    } else {
      el.fill = this.paint.fill;
      if (type !== "text") {
        el.stroke = this.paint.stroke;
        el.strokeWidth = this.paint.strokeWidth;
      }
    }
    return el;
  }

  /* ------------------------------------------------------------ clipboard */

  hasClipboard() {
    return !!(this._clipboard && this._clipboard.length);
  }

  /* ------------------------------------------------------------ context menu */

  onContextMenu(evt, pointer) {
    const hit = this.tools?.hit(pointer) || null;
    openCanvasMenu(this, evt, pointer, { hit });
  }

  /** Fill the whole artboard with a colour (or clear it back to transparent). */
  setCanvasBackground(color) {
    this.scene.setCanvas({ background: color }, "canvas-background");
    this.markDirty();
    this.requestRender();
    this.dock?.refreshTab("export");
    this.dock?.refreshTab("inspector");
    toast(color ? t("doc.backgroundSet", { color }) : t("doc.fillNone"), { kind: "ok", timeout: 1800 });
  }

  /** One-click "fill the canvas with the current fill colour". */
  fillCanvas() {
    this.setCanvasBackground(this.canvasFillColor());
  }

  /** What "fill the canvas" uses when the paint fill is set to none. */
  canvasFillColor() {
    return this.paint.fill || "#12141a";
  }

  requestRender() {
    this.stage?.invalidate();
  }

  onSelectionChanged() {
    this.emit("selection");
    this.tools?.updateCursor?.(this.stage.pointer);
  }

  focusText() {
    this.dock?.open("inspector");
    this.dock?.panes?.get("inspector")?.focusText?.();
  }

  openDock(tab) {
    this.dock?.open(tab);
  }

  rebuildUI() {
    this.onEvent("rebuild");
  }

  /* ------------------------------------------------------------ time */

  setTime(time) {
    this.scene.setTime(clamp(time, 0, this.doc.canvas.duration));
  }

  togglePlay() {
    if (this.playing) this.stop();
    else this.play();
  }

  play() {
    if (this.playing) return;
    if (this.doc.time >= this.doc.canvas.duration - 1e-4) this.scene.setTime(0);
    this.playing = true;
    this.stage.editable = false;
    this._lastTick = performance.now();
    this.emit("playing", true);
    const tick = () => {
      if (!this.playing) return;
      const now = performance.now();
      const dt = Math.min(0.2, (now - this._lastTick) / 1000);
      this._lastTick = now;
      let next = this.doc.time + dt;
      if (next >= this.doc.canvas.duration) {
        if (this.doc.loop) next -= this.doc.canvas.duration;
        else {
          this.scene.setTime(this.doc.canvas.duration);
          this.stop();
          return;
        }
      }
      this.scene.setTime(next);
      this._playRaf = requestAnimationFrame(tick);
    };
    this._playRaf = requestAnimationFrame(tick);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this._playRaf);
    this.stage.editable = true;
    this.emit("playing", false);
    this.stage.invalidate();
  }

  /* ------------------------------------------------------------ history */

  undo() {
    if (!this.history.canUndo) {
      this.status(t("st.nothingToUndo"));
      return;
    }
    const label = this.history.undo();
    this.markDirty();
    this.status(t("st.undo", { label: label || "" }));
    this.timeline?.refresh();
    this.dock?.refresh();
    this.stage.invalidate();
  }

  redo() {
    if (!this.history.canRedo) {
      this.status(t("st.nothingToRedo"));
      return;
    }
    const label = this.history.redo();
    this.markDirty();
    this.status(t("st.redo", { label: label || "" }));
    this.timeline?.refresh();
    this.dock?.refresh();
    this.stage.invalidate();
  }

  /* ------------------------------------------------------------ selection */

  async deleteSelection() {
    const ids = this.doc.selection.slice();
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: t("dlg.deleteTitle", { n: ids.length }),
      body: t("dlg.deleteBody"),
      danger: true,
      confirmLabel: t("edit.delete"),
    });
    if (!ok) return;
    this.scene.remove(ids);
    this.markDirty();
    this.status(t("st.deleted"));
    this.timeline?.refresh();
    this.dock?.refresh();
  }

  duplicateSelection() {
    const copies = this.scene.duplicate(this.doc.selection);
    if (!copies.length) return;
    this.markDirty();
    this.status(t("st.duplicated"));
    this.timeline?.refresh();
    this.dock?.refresh();
  }

  copySelection() {
    const sel = this.scene.selectedElements();
    if (!sel.length) return false;
    this._clipboard = sel.map((el) => toPlain(el));
    return true;
  }

  paste() {
    if (!this._clipboard || !this._clipboard.length) return;
    const copies = this._clipboard.map((src) => {
      const copy = deepClone(src);
      copy.id = uid(src.type);
      copy.x += 24;
      copy.y += 24;
      return copy;
    });
    this.scene.addMany(copies);
    this.markDirty();
    this.timeline?.refresh();
    this.dock?.refresh();
  }

  selectAll() {
    this.scene.selectAll();
    this.timeline?.refresh();
    this.dock?.refresh();
  }

  reorderSelection(direction) {
    const ids = this.doc.selection.slice();
    if (!ids.length) return;
    if (direction === Infinity) {
      for (const id of ids) this.scene.reorder(id, this.doc.elements.length - 1, "reorder");
    } else if (direction === -Infinity) {
      for (const id of ids) this.scene.reorder(id, 0, "reorder");
    } else {
      this.scene.reorderMany(ids, direction, "reorder");
    }
    this.markDirty();
    this.timeline?.refresh();
    this.dock?.refreshTab("layers");
    this.dock?.refresh();
  }

  alignSelection(mode) {
    const sel = this.scene.selectedElements();
    if (sel.length < 2) return;
    const boxes = sel.map((el) => ({
      el,
      b: sceneBounds(this.stage.renderer.resolve(el, this.doc.time)),
    }));
    const minX = Math.min(...boxes.map((x) => x.b.x));
    const maxX = Math.max(...boxes.map((x) => x.b.x + x.b.w));
    const minY = Math.min(...boxes.map((x) => x.b.y));
    const maxY = Math.max(...boxes.map((x) => x.b.y + x.b.h));
    this.scene.live(() => {
      for (const { el, b } of boxes) {
        let dx = 0;
        let dy = 0;
        if (mode === "left") dx = minX - b.x;
        else if (mode === "right") dx = maxX - (b.x + b.w);
        else if (mode === "center") dx = (minX + maxX) / 2 - (b.x + b.w / 2);
        else if (mode === "top") dy = minY - b.y;
        else if (mode === "bottom") dy = maxY - (b.y + b.h);
        else if (mode === "middle") dy = (minY + maxY) / 2 - (b.y + b.h / 2);
        el.x += dx;
        el.y += dy;
        el._rev = (el._rev | 0) + 1;
      }
    });
    this.scene.commit("align");
    this.markDirty();
    this.requestRender();
  }

  flipSelection(axis) {
    const sel = this.scene.selectedElements();
    if (!sel.length) return;
    this.scene.live(() => {
      for (const el of sel) flipElement(el, axis);
    });
    this.scene.commit("flip");
    this.markDirty();
    this.requestRender();
  }

  nudgeSelection(dx, dy) {
    const sel = this.scene.selectedElements().filter((e) => !e.locked);
    if (!sel.length) return;
    this.scene.mutate("nudge", () => {
      for (const el of sel) {
        el.x += dx;
        el.y += dy;
        el._rev = (el._rev | 0) + 1;
      }
    });
    this.markDirty();
    this.requestRender();
  }

  /* ------------------------------------------------------------ canvas */

  toggleGrid() {
    this.scene.mutate("grid", (doc) => {
      doc.showGrid = !doc.showGrid;
    });
    this.topbar?.syncToggles();
    this.rail?.syncPaint();
    this.requestRender();
  }

  async clearCanvas() {
    if (!this.doc.elements.length) return;
    const ok = await confirmDialog({
      title: t("dlg.clearTitle"),
      body: t("dlg.clearBody"),
      danger: true,
      confirmLabel: t("edit.delete"),
    });
    if (!ok) return;
    this.scene.mutate("clear", (doc) => {
      doc.elements = [];
      doc.selection = [];
    });
    this.markDirty();
    this.status(t("st.cleared"));
    this.timeline?.refresh();
    this.dock?.refresh();
  }

  /* ------------------------------------------------------------ files */

  async newScene() {
    if (this.doc.elements.length) {
      const ok = await confirmDialog({
        title: t("dlg.newTitle"),
        body: t("dlg.newBody"),
        confirmLabel: t("file.new"),
      });
      if (!ok) return;
    }
    this.scene.reset();
    this.history.clear();
    this.dirty = false;
    this.emit("dirty");
    this.emit("history");
    this.status(t("st.newScene"));
    this.stage.fit();
    this.timeline?.refresh();
    this.dock?.refresh();
  }

  saveProject() {
    const payload = {
      format: "svgen.scene",
      version: 2,
      app: "SVGen Studio",
      saved: new Date().toISOString(),
      scene: this.scene.toJSON(),
    };
    const name = `${safeName(this.doc.name, "scene")}.svgen.json`;
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), name);
    this.status(t("st.saved"));
    this.dirty = false;
    this.emit("dirty");
    toast(t("st.saved"), { kind: "ok" });
  }

  async openProject() {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      const text = await readFileText(file);
      const parsed = JSON.parse(text);
      this.loadDocument(parsed.scene || parsed, file.name);
    } catch (err) {
      toast(`${t("exp.failed")}: ${err.message}`, { kind: "err" });
    }
  }

  loadDocument(doc, name) {
    this.scene.replaceDocument(doc, { label: "open" });
    this.history.clear();
    this.dirty = false;
    this.emit("dirty");
    this.emit("history");
    this.stage.fit();
    this.timeline?.refresh();
    this.dock?.refresh();
    this.dock?.refreshTab("layers");
    this.topbar?.syncTitle();
    this.status(t("st.loaded", { name: name || this.doc.name }));
  }

  async importSvg() {
    const file = await pickFile(".svg,image/svg+xml");
    if (!file) return;
    try {
      const text = await readFileText(file);
      this.importSvgText(text, file.name);
    } catch (err) {
      toast(`${t("exp.failed")}: ${err.message}`, { kind: "err" });
    }
  }

  importSvgText(text, name) {
    const result = parseSVG(text, {
      width: this.doc.canvas.width,
      height: this.doc.canvas.height,
    });
    if (!result.elements.length) {
      toast(t("st.importNone"), { kind: "warn" });
      if (result.warnings.length) this._showImportNotes(result.warnings);
      return;
    }
    this.scene.addMany(result.elements, { label: "import" });
    this.markDirty();
    this.status(t("st.imported", { n: result.elements.length }));
    this.timeline?.refresh();
    this.dock?.refresh();
    this.dock?.refreshTab("layers");
    this.stage.fit();
    void name;
    if (result.warnings.length) this._showImportNotes(result.warnings);
  }

  _showImportNotes(warnings) {
    const items = warnings
      .slice(0, 30)
      .map((w) => `<li>${escapeHTML(w)}</li>`)
      .join("");
    modal({
      title: t("st.importWarn", { n: warnings.length }),
      body: `<ul style="padding-left:18px;line-height:1.75;font-size:12px;color:var(--text-mute)">${items}</ul>`,
      actions: [{ label: t("dlg.ok"), value: true, variant: "brand" }],
    });
  }

  exportSvgDocument() {
    const svg = sceneToSVG(this.scene);
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${safeName(this.doc.name, "artwork")}.svg`);
  }

  async copySvgDocument() {
    const svg = sceneToSVG(this.scene);
    try {
      await navigator.clipboard.writeText(svg);
      toast(t("st.copied"), { kind: "ok" });
    } catch {
      toast(t("st.copyFailed"), { kind: "warn" });
    }
  }

  /* ------------------------------------------------------------ autosave */

  persist() {
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({ version: 2, saved: Date.now(), scene: this.scene.toJSON() })
      );
    } catch {
      /* storage unavailable or full */
    }
  }

  clearAutosave() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------ backend */

  _onConnection(online, meta) {
    if (meta?.info && !this.conn.info) this.conn.info = meta.info;
    this.emit("connection", { online, info: this.conn.info });
    if (meta?.first) {
      this.status(online ? t("st.online") : t("st.offline"));
      return;
    }
    toast(online ? t("st.reconnected") : t("st.lost"), { kind: online ? "ok" : "err" });
  }

  refreshCapabilities() {
    return api
      .info({ refresh: true })
      .then((info) => {
        this.conn.info = info;
        this.emit("connection", { online: true, info });
        return info;
      })
      .catch(() => null);
  }
}

/* ---------------------------------------------------------------- helpers */

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(input);
    const done = (value) => {
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => done(input.files?.[0] || null));
    input.addEventListener("cancel", () => done(null));
    input.click();
  });
}

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
