/**
 * The stage: viewport maths, pointer plumbing, zoom/pan and the render loop.
 *
 * Interaction *behaviour* lives in the tool controller; this class owns the
 * canvas, the screen↔scene transform, and a dirty-flag rAF loop so nothing
 * redraws more than once per frame.
 */

import { StageRenderer, invalidatePatterns } from "../core/render.js";
import { clamp } from "../core/util.js";
import { icon } from "./icons.js";
import { h, attachTooltip, theme } from "./shell.js";
import { t } from "../i18n/index.js";

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;

export class Stage {
  constructor(scene, host) {
    this.scene = scene;
    this.host = host;
    this.canvas = h("canvas", { class: "stage-canvas", id: "stage" });
    host.appendChild(this.canvas);
    this.renderer = new StageRenderer(this.canvas);

    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.pointer = { sceneX: 0, sceneY: 0, inside: false };
    this.hoverId = null;
    this.marquee = null;
    this.editable = true;
    this.tools = null;

    this._needsDraw = true;
    this._pan = null;
    this._buildHud();
    this._bind();
    this._observeResize();
    this._startLoop();
  }

  setTools(controller) {
    this.tools = controller;
  }

  /* ------------------------------------------------------------ HUD */

  _buildHud() {
    this.zoomLabel = h("b", { text: "100%" });
    this.coordLabel = h("span", { class: "coords", text: "0, 0" });
    const pill = h("div", { class: "hud-pill" }, [
      this.zoomLabel,
      h("span", { text: "·" }),
      this.coordLabel,
    ]);

    const zoomOut = h("button", { class: "btn icon sm", type: "button", html: icon("minus", 13) });
    const zoomIn = h("button", { class: "btn icon sm", type: "button", html: icon("plus", 13) });
    const zoomFit = h("button", { class: "btn icon sm", type: "button", html: icon("fit", 13) });
    attachTooltip(zoomOut, t("view.zoomOut"), "Ctrl+-");
    attachTooltip(zoomIn, t("view.zoomIn"), "Ctrl++");
    attachTooltip(zoomFit, t("view.zoomFit"), "Shift+1");
    zoomOut.addEventListener("click", () => this.zoomBy(1 / 1.25));
    zoomIn.addEventListener("click", () => this.zoomBy(1.25));
    zoomFit.addEventListener("click", () => this.fit());

    this.host.appendChild(
      h("div", { class: "hud br" }, [h("div", { class: "hud-pill" }, [zoomOut, pill, zoomIn, zoomFit])])
    );

    this.hint = h("div", { class: "hint-card" });
    this.hudHint = h("div", { class: "hud tl" }, [this.hint]);
    this.host.appendChild(this.hudHint);
    this.renderHint();
  }

  renderHint() {
    const show = this.scene.doc.elements.length === 0;
    this.hudHint.classList.toggle("hidden", !show);
    if (!show) return;
    this.hint.innerHTML =
      `<h3>${t("hint.title")}</h3><ul>` +
      `<li><kbd>R</kbd><span>${t("hint.1")}</span></li>` +
      `<li><kbd>K</kbd><span>${t("hint.2")}</span></li>` +
      `<li><kbd>⇧</kbd><span>${t("hint.3")}</span></li>` +
      `</ul>`;
  }

  syncHint() {
    this.renderHint();
  }

  /* ------------------------------------------------------------ geometry */

  viewport() {
    const rect = this.host.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  toScene(clientX, clientY) {
    const rect = this.host.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.view.panX) / this.view.zoom,
      y: (clientY - rect.top - this.view.panY) / this.view.zoom,
    };
  }

  toScreen(sceneX, sceneY) {
    return {
      x: sceneX * this.view.zoom + this.view.panX,
      y: sceneY * this.view.zoom + this.view.panY,
    };
  }

  fit() {
    const canvas = this.scene.doc.canvas;
    const { w, h } = this.viewport();
    if (!w || !h) return;
    const pad = 72;
    const zoom = clamp(
      Math.min((w - pad * 2) / canvas.width, (h - pad * 2) / canvas.height),
      MIN_ZOOM,
      MAX_ZOOM
    );
    this.view.zoom = zoom;
    this.view.panX = (w - canvas.width * zoom) / 2;
    this.view.panY = (h - canvas.height * zoom) / 2;
    this.invalidate();
    this.app?.emit?.("zoom", zoom);
  }

  setZoom(zoom, anchor) {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const { w, h } = this.viewport();
    const focus = anchor || { x: w / 2, y: h / 2 };
    const before = {
      x: (focus.x - this.view.panX) / this.view.zoom,
      y: (focus.y - this.view.panY) / this.view.zoom,
    };
    this.view.zoom = next;
    this.view.panX = focus.x - before.x * next;
    this.view.panY = focus.y - before.y * next;
    this.invalidate();
    this.app?.emit?.("zoom", next);
  }

  zoomBy(factor, anchor) {
    this.setZoom(this.view.zoom * factor, anchor);
  }

  panBy(dx, dy) {
    this.view.panX += dx;
    this.view.panY += dy;
    this.invalidate();
  }

  /* ------------------------------------------------------------ events */

  _bind() {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (evt) => this._onDown(evt));
    canvas.addEventListener("pointermove", (evt) => this._onMove(evt));
    canvas.addEventListener("pointerup", (evt) => this._onUp(evt));
    canvas.addEventListener("pointercancel", (evt) => this._onUp(evt));
    canvas.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
      this.setHover(null);
    });
    canvas.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      // A right-click mid-gesture aborts it, like every other editor.
      if (this.tools?.gesture || this.tools?.penPoints) {
        this.tools.cancelGesture();
        evt.__svgenHandled = true;
        return;
      }
      // Claim the event: the input-capture layer must not open a second menu
      // for the same right-click, because a superseded menu leaves a stray
      // pointerdown listener behind that closes the live one.
      evt.__svgenHandled = true;
      this.app?.onContextMenu?.(evt, this._pointerEvent(evt));
    });
    canvas.addEventListener("dblclick", (evt) => this.tools?.onDoubleClick?.(evt, this));

    this.host.addEventListener(
      "wheel",
      (evt) => {
        evt.preventDefault();
        const rect = this.host.getBoundingClientRect();
        const focus = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
        if (evt.ctrlKey || evt.metaKey) {
          this.zoomBy(Math.exp(-evt.deltaY * 0.01), focus);
        } else if (evt.shiftKey) {
          this.panBy(-evt.deltaY, 0);
        } else {
          this.panBy(-evt.deltaX, -evt.deltaY);
        }
      },
      { passive: false }
    );
  }

  _observeResize() {
    if (typeof ResizeObserver === "function") {
      this._ro = new ResizeObserver(() => this.invalidate());
      this._ro.observe(this.host);
    } else {
      window.addEventListener("resize", () => this.invalidate());
    }
  }

  _pointerEvent(evt) {
    const p = this.toScene(evt.clientX, evt.clientY);
    return {
      clientX: evt.clientX,
      clientY: evt.clientY,
      sceneX: p.x,
      sceneY: p.y,
      button: evt.button,
      buttons: evt.buttons,
      shift: evt.shiftKey,
      alt: evt.altKey,
      ctrl: evt.ctrlKey || evt.metaKey,
      meta: evt.metaKey,
      pressure: evt.pressure || 0.5,
      pointerId: evt.pointerId,
      originalEvent: evt,
    };
  }

  _onDown(evt) {
    if (evt.button === 2) return;
    this.canvas.setPointerCapture?.(evt.pointerId);
    const p = this._pointerEvent(evt);
    this.pointer = { ...p, inside: true };
    const app = this.app;
    const wantsPan = evt.button === 1 || app?.spaceDown || this.tools?.tool === "hand";
    if (wantsPan) {
      this._pan = { x: evt.clientX, y: evt.clientY };
      this.canvas.classList.add("panning");
      evt.preventDefault();
      return;
    }
    this.tools?.pointerDown(p, this);
    evt.preventDefault();
  }

  _onMove(evt) {
    const p = this._pointerEvent(evt);
    this.pointer = { ...p, inside: true };
    this._syncHud();
    if (this._pan) {
      this.panBy(evt.clientX - this._pan.x, evt.clientY - this._pan.y);
      this._pan = { x: evt.clientX, y: evt.clientY };
      return;
    }
    this.tools?.pointerMove(p, this);
  }

  _onUp(evt) {
    if (this._pan) {
      this._pan = null;
      this.canvas.classList.remove("panning");
      return;
    }
    this.tools?.pointerUp(this._pointerEvent(evt), this);
  }

  setHover(id) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.invalidate();
  }

  _syncHud() {
    this.coordLabel.textContent = `${Math.round(this.pointer.sceneX)}, ${Math.round(this.pointer.sceneY)}`;
    this.zoomLabel.textContent = `${Math.round(this.view.zoom * 100)}%`;
  }

  onThemeChange() {
    invalidatePatterns(this.renderer);
    this.invalidate();
  }

  /* ------------------------------------------------------------ loop */

  invalidate() {
    this._needsDraw = true;
  }

  requestDraw() {
    this._needsDraw = true;
  }

  _startLoop() {
    const tick = () => {
      this._rafId = requestAnimationFrame(tick);
      if (!this._needsDraw) return;
      this._needsDraw = false;
      this.draw();
    };
    this._rafId = requestAnimationFrame(tick);
  }

  destroy() {
    cancelAnimationFrame(this._rafId);
    this._ro?.disconnect();
  }

  draw() {
    const rect = this.host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.renderer.resize(rect.width, rect.height, dpr);

    const light = theme.current === "light";
    this.renderer.draw({
      scene: this.scene,
      time: this.scene.doc.time,
      view: this.view,
      selection: this.scene.doc.selection,
      hoverId: this.editable ? this.hoverId : null,
      marquee: this.marquee,
      extra: this.tools?.draftElements?.() || [],
      cursor: this._brushCursor(),
      editable: this.editable,
      playing: this.app?.playing,
      theme: {
        checkerA: light ? "#ffffff" : "#2b2e34",
        checkerB: light ? "#e8eaee" : "#23262b",
      },
    });
    this._syncHud();
  }

  /**
   * A ring showing the brush footprint while a drawing tool is active, so the
   * size is visible before the stroke starts.
   */
  _brushCursor() {
    const tool = this.tools?.tool;
    if (tool !== "pen" || !this.pointer.inside) return null;
    const size = this.app?.brush?.size || 6;
    return {
      x: this.pointer.sceneX,
      y: this.pointer.sceneY,
      r: Math.max(0.5, size / 2),
      color: this.app?.paint?.stroke || "#edeff3",
    };
  }

  /** Render the scene into an offscreen canvas at a given pixel size. */
  snapshot(width, height, time) {
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(width));
    off.height = Math.max(1, Math.round(height));
    const renderer = new StageRenderer(off);
    renderer.resize(off.width, off.height, 1);
    const canvas = this.scene.doc.canvas;
    const zoom = off.width / canvas.width;
    renderer.draw({
      scene: this.scene,
      time: time ?? this.scene.doc.time,
      view: { zoom, panX: 0, panY: 0 },
      selection: [],
      editable: false,
      playing: false,
      theme: { checkerA: "#ffffff", checkerB: "#e8eaee" },
    });
    return off;
  }
}
