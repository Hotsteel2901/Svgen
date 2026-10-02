/**
 * Timeline: transport, ruler, per-property keyframe tracks.
 *
 * Performance note: the DOM structure is rebuilt only when the document's shape
 * changes. Scrubbing and playback move a single transform on the playhead node,
 * which is what keeps dragging smooth on a large scene.
 */

import { icon } from "./icons.js";
import { h, attachTooltip, menu, confirmDialog, toast } from "./shell.js";
import { t } from "../i18n/index.js";
import { ANIMATABLE } from "../core/elements.js";
import { EASING_LABEL, EASINGS, keyAt, nextKeyTime, prevKeyTime } from "../core/anim.js";
import { clamp, timecode } from "../core/util.js";

const ROW_H = 26;
const SUB_H = 22;
const LABEL_PREFIX = "P";

export const PROP_COLOR = {
  x: "var(--c-x)",
  y: "var(--c-y)",
  rotation: "var(--c-rot)",
  scaleX: "var(--c-scale)",
  scaleY: "var(--c-scale)",
  opacity: "var(--c-opacity)",
  strokeWidth: "var(--c-ease)",
};

export class Timeline {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.expanded = new Set();
    this.selectedKeys = [];
    this._rowIndex = new Map();
    this._structure = "";
    this.render();
    app.on("change", () => this.refresh());
    app.on("selection", () => this.refresh());
    app.on("time", () => this.syncPlayhead());
    app.on("playing", () => this.syncTransport());
  }

  get scene() {
    return this.app.scene;
  }

  get doc() {
    return this.scene.doc;
  }

  /* ------------------------------------------------------------ shell */

  render() {
    this.root.innerHTML = "";
    this.root.appendChild(this._renderBar());

    this.labelWrap = h("div", { class: "tl-labels" });
    this.labelHead = h("div", { class: "tl-labels-head" }, [h("span", { text: t("dock.layers") })]);
    this.labelScroll = h("div", { class: "tl-labels-scroll" });
    this.labelInner = h("div", { class: "tl-labels-inner" });
    this.labelScroll.appendChild(this.labelInner);
    this.labelWrap.append(this.labelHead, this.labelScroll);

    this.ruler = h("canvas", { class: "tl-ruler" });
    this.rowsEl = h("div", { class: "tl-rows" });
    this.playhead = h("div", { class: "tl-playhead" });
    this.scroll = h("div", { class: "tl-scroll" }, [this.ruler, this.rowsEl, this.playhead]);

    this.root.appendChild(h("div", { class: "time-body" }, [this.labelWrap, this.scroll]));
    this.root.appendChild(h("div", { class: "time-grip", title: "resize" }));

    this._bindShell();
    this.refresh();
  }

  _renderBar() {
    const bar = h("div", { class: "time-bar" });

    this.playBtn = h("button", { class: "play", type: "button", html: icon("play", 13) });
    attachTooltip(this.playBtn, t("tl.play"), "Space");
    this.playBtn.addEventListener("click", () => this.app.togglePlay());

    const toStart = h("button", { type: "button", html: icon("toStart", 13) });
    const prev = h("button", { type: "button", html: icon("skipBack", 13) });
    const next = h("button", { type: "button", html: icon("skipForward", 13) });
    const toEnd = h("button", { type: "button", html: icon("toEnd", 13) });
    const stop = h("button", { type: "button", html: icon("stop", 12) });
    attachTooltip(toStart, t("tl.toStart"), "Home");
    attachTooltip(prev, t("tl.prevKey"), "[");
    attachTooltip(next, t("tl.nextKey"), "]");
    attachTooltip(toEnd, t("tl.toEnd"), "End");
    attachTooltip(stop, t("tl.stop"));
    toStart.addEventListener("click", () => this.app.setTime(0));
    prev.addEventListener("click", () => this.jumpKey(-1));
    next.addEventListener("click", () => this.jumpKey(1));
    toEnd.addEventListener("click", () => this.app.setTime(this.doc.canvas.duration));
    stop.addEventListener("click", () => this.app.stop());

    const transport = h("div", { class: "transport" }, [toStart, prev, this.playBtn, next, toEnd, stop]);
    bar.appendChild(transport);

    this.timeField = h("input", { type: "text", value: "0.00", spellcheck: "false" });
    this.timeField.addEventListener("change", () => {
      const v = parseFloat(this.timeField.value);
      if (Number.isFinite(v)) this.app.setTime(clamp(v, 0, this.doc.canvas.duration));
    });
    this.timeField.addEventListener("keydown", (e) => e.stopPropagation());

    this.durationField = h("input", { type: "number", min: "0.05", step: "0.1", value: String(this.doc.canvas.duration) });
    this.durationField.addEventListener("change", () => {
      const v = parseFloat(this.durationField.value);
      if (Number.isFinite(v) && v > 0.02) {
        this.scene.mutate("duration", (doc) => {
          doc.canvas.duration = Math.min(600, v);
          doc.time = Math.min(doc.time, doc.canvas.duration);
        });
        this.refresh();
      }
    });
    this.durationField.addEventListener("keydown", (e) => e.stopPropagation());

    this.fpsSelect = h("select", {});
    for (const fps of [12, 15, 24, 25, 30, 60]) {
      this.fpsSelect.appendChild(h("option", { value: String(fps), text: `${fps} fps` }));
    }
    this.fpsSelect.value = String(this.doc.canvas.fps);
    this.fpsSelect.addEventListener("change", () => {
      this.scene.mutate("fps", (doc) => {
        doc.canvas.fps = parseInt(this.fpsSelect.value, 10) || 30;
      });
    });

    bar.appendChild(
      h("div", { class: "timecode" }, [
        h("span", { class: "field" }, [this.timeField]),
        h("span", { class: "slash", text: "/" }),
        h("span", { class: "field dur" }, [this.durationField]),
        h("span", { class: "field dur" }, [this.fpsSelect]),
      ])
    );

    bar.appendChild(h("div", { class: "spacer" }));

    const tools = h("div", { class: "tools" });
    this.propSelect = h("select", {});
    for (const prop of ANIMATABLE) {
      this.propSelect.appendChild(h("option", { value: prop, text: t(`prop.${prop}`) }));
    }
    const propField = h("span", { class: "field" }, [this.propSelect]);
    attachTooltip(propField, t("tl.addKey"));
    tools.appendChild(propField);

    this.easeSelect = h("select", {});
    for (const ease of EASINGS) {
      this.easeSelect.appendChild(h("option", { value: ease, text: t(`ease.${ease}`) }));
    }
    this.easeSelect.addEventListener("change", () => this._applyEase(this.easeSelect.value));
    const easeField = h("span", { class: "field" }, [this.easeSelect]);
    attachTooltip(easeField, t("tl.easeFor"));
    tools.appendChild(easeField);

    const keyBtn = h("button", { class: "btn sm solid", type: "button" }, [
      h("span", { html: icon("key", 12) }),
      h("span", { text: t("tl.addKey") }),
    ]);
    attachTooltip(keyBtn, t("tl.addKey"), "K");
    keyBtn.addEventListener("click", () => this.toggleKeyAtPlayhead());
    tools.appendChild(keyBtn);

    this.onionBtn = h("button", { class: "btn sm icon", type: "button", html: icon("onion", 14) });
    attachTooltip(this.onionBtn, t("view.onion"), "Ctrl+Shift+O");
    this.onionBtn.addEventListener("click", () => {
      this.scene.mutate("onion", (doc) => {
        doc.onion = !doc.onion;
      });
      this.app.requestRender();
      this.refresh();
    });
    tools.appendChild(this.onionBtn);

    this.loopBtn = h("button", { class: "btn sm icon", type: "button", html: icon("loop", 14) });
    attachTooltip(this.loopBtn, t("tl.loop"), "Ctrl+L");
    this.loopBtn.addEventListener("click", () => {
      this.scene.mutate("loop", (doc) => {
        doc.loop = !doc.loop;
      });
      this.refresh();
    });
    tools.appendChild(this.loopBtn);

    bar.appendChild(tools);
    return bar;
  }

  _bindShell() {
    // Ruler scrub
    const scrub = (evt) => {
      const rect = this.ruler.getBoundingClientRect();
      const ratio = clamp((evt.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      this.app.setTime(ratio * this.doc.canvas.duration);
    };
    this.ruler.addEventListener("pointerdown", (evt) => {
      this.ruler.setPointerCapture(evt.pointerId);
      scrub(evt);
      const move = (e) => scrub(e);
      const up = (e) => {
        this.ruler.releasePointerCapture?.(e.pointerId);
        this.ruler.removeEventListener("pointermove", move);
        this.ruler.removeEventListener("pointerup", up);
      };
      this.ruler.addEventListener("pointermove", move);
      this.ruler.addEventListener("pointerup", up);
    });

    // Keep the label column aligned with the rows.
    this.scroll.addEventListener("scroll", () => {
      this.labelScroll.scrollTop = this.scroll.scrollTop;
    });

    // Panel resize
    const grip = this.root.querySelector(".time-grip");
    grip.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      const startY = evt.clientY;
      const startH = this.root.getBoundingClientRect().height;
      const move = (e) => {
        const next = clamp(startH - (e.clientY - startY), 0, window.innerHeight * 0.7);
        document.documentElement.style.setProperty("--h-timeline", `${next}px`);
        this.app.stage.invalidate();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.drawRuler();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  /* ------------------------------------------------------------ structure */

  _structureKey() {
    return this.doc.elements
      .map((el) => `${el.id}:${this.expanded.has(el.id) ? 1 : 0}:${Object.keys(el.keys).sort().join(",")}`)
      .join("|");
  }

  refresh() {
    const key = this._structureKey();
    if (key !== this._structure) {
      this._structure = key;
      this.rebuildRows();
    }
    this.syncLabels();
    this.syncKeys();
    this.drawRuler();
    this.syncPlayhead();
    this.syncTransport();
  }

  rebuildRows() {
    this.rowsEl.innerHTML = "";
    this.labelInner.innerHTML = "";
    this._rowIndex.clear();

    if (!this.doc.elements.length) {
      this.rowsEl.appendChild(h("div", { class: "tl-empty", text: t("tl.empty") }));
      return;
    }

    for (const el of this.doc.elements) {
      const expanded = this.expanded.has(el.id);
      const label = h("div", {
        class: `tl-label${el.id === this.doc.selection[0] ? " selected" : ""}${expanded ? " open" : ""}`,
        dataset: { id: el.id },
      });
      const tw = h("button", { class: "tw", type: "button", html: icon("chevronRight", 11) });
      tw.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.toggleExpand(el.id);
      });
      const eye = h("button", {
        class: `eye${el.visible ? "" : " off"}`,
        type: "button",
        html: icon(el.visible ? "eye" : "eyeOff", 12),
      });
      eye.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.scene.mutate("visibility", () => {
          el.visible = !el.visible;
        });
        this.app.requestRender();
        this.refresh();
      });
      const nm = h("span", { class: "nm truncate", text: el.name || el.type });
      label.append(tw, eye, nm);
      label.addEventListener("click", () => {
        this.scene.select(el.id);
        this.app.onSelectionChanged();
      });
      this.labelInner.appendChild(label);

      const row = h("div", { class: `tl-row${el.id === this.doc.selection[0] ? " selected" : ""}`, dataset: { id: el.id } });
      row.addEventListener("pointerdown", (evt) => {
        if (evt.button !== 0 || evt.target !== row) return;
        this.scene.select(el.id);
        this.app.onSelectionChanged();
        const rect = this.rowsEl.getBoundingClientRect();
        const ratio = clamp((evt.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        this.app.setTime(ratio * this.doc.canvas.duration);
        if (evt.altKey) this.toggleKeyAtPlayhead();
      });
      row.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.scene.select(el.id);
        this.app.onSelectionChanged();
        this._rowMenu(evt, el);
      });
      this.rowsEl.appendChild(row);
      this._rowIndex.set(el.id, { row, label, height: ROW_H });

      for (const prop of ANIMATABLE) {
        if (!expanded) break;
        const subLabel = h("div", { class: "tl-label sub" });
        const dot = h("span", { class: "pdot" });
        dot.style.background = PROP_COLOR[prop];
        subLabel.append(dot, h("span", { class: "nm truncate", text: t(`prop.${prop}`) }));
        const count = (el.keys[prop] || []).length;
        if (count) subLabel.appendChild(h("span", { class: "count", text: String(count) }));
        subLabel.addEventListener("click", () => {
          this.propSelect.value = prop;
          this.scene.select(el.id);
          this.app.onSelectionChanged();
        });
        this.labelInner.appendChild(subLabel);

        const subRow = h("div", { class: "tl-row sub", dataset: { id: el.id, prop } });
        subRow.addEventListener("pointerdown", (evt) => {
          if (evt.button !== 0 || evt.target !== subRow) return;
          this.scene.select(el.id);
          this.propSelect.value = prop;
          this.app.onSelectionChanged();
          const rect = this.rowsEl.getBoundingClientRect();
          const ratio = clamp((evt.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
          this.app.setTime(ratio * this.doc.canvas.duration);
        });
        this.rowsEl.appendChild(subRow);
        this._rowIndex.set(`${el.id}::${prop}`, { row: subRow, label: subLabel, height: SUB_H });
      }
    }
  }

  toggleExpand(id) {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this._structure = "";
    this.refresh();
  }

  /* ------------------------------------------------------------ keyframes */

  syncKeys() {
    const duration = Math.max(0.02, this.doc.canvas.duration);
    for (const el of this.doc.elements) {
      const entry = this._rowIndex.get(el.id);
      if (!entry) continue;
      entry.row.innerHTML = "";

      const summary = new Set();
      for (const prop of ANIMATABLE) {
        for (const k of el.keys[prop] || []) summary.add(k.t);
      }
      for (const time of Array.from(summary).sort((a, b) => a - b)) {
        const key = h("div", {
          class: "tl-key",
          dataset: { id: el.id, t: String(time) },
          title: `${time.toFixed(2)}s`,
        });
        key.style.left = `${(time / duration) * 100}%`;
        key.style.color = "var(--c-x)";
        key.addEventListener("pointerdown", (evt) => this._keyDrag(evt, el, null, time));
        entry.row.appendChild(key);
      }

      if (!this.expanded.has(el.id)) continue;

      for (const prop of ANIMATABLE) {
        const sub = this._rowIndex.get(`${el.id}::${prop}`);
        if (!sub) continue;
        sub.row.innerHTML = "";
        const keys = (el.keys[prop] || []).slice().sort((a, b) => a.t - b.t);
        if (keys.length > 1) {
          const bar = h("div", { class: "tl-bar" });
          bar.style.left = `${(keys[0].t / duration) * 100}%`;
          bar.style.width = `${((keys[keys.length - 1].t - keys[0].t) / duration) * 100}%`;
          bar.style.color = PROP_COLOR[prop];
          sub.row.appendChild(bar);
        }
        for (const k of keys) {
          const node = h("div", {
            class: `tl-key${k.e === "hold" ? " ease" : ""}${this._isKeySelected(el.id, prop, k.t) ? " sel" : ""}`,
            title: `${t(`prop.${prop}`)} @ ${k.t.toFixed(2)}s = ${Math.round(k.v * 1000) / 1000} · ${t(`ease.${k.e || "linear"}`)}`,
          });
          node.style.left = `${(k.t / duration) * 100}%`;
          node.style.color = PROP_COLOR[prop];
          node.addEventListener("pointerdown", (evt) => this._keyDrag(evt, el, prop, k.t));
          node.addEventListener("contextmenu", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            this._keyMenu(evt, el, prop, k.t);
          });
          sub.row.appendChild(node);
        }
      }
    }
  }

  _isKeySelected(id, prop, time) {
    return this.selectedKeys.some(
      (k) => k.id === id && k.prop === prop && Math.abs(k.t - time) < 1e-4
    );
  }

  _keyDrag(evt, el, prop, time) {
    evt.preventDefault();
    evt.stopPropagation();
    if (prop) this.selectedKeys = [{ id: el.id, prop, t: time }];
    this.scene.select(el.id);
    this.propSelect.value = prop || this.propSelect.value;
    this.app.onSelectionChanged();

    const rect = this.rowsEl.getBoundingClientRect();
    const duration = Math.max(0.02, this.doc.canvas.duration);
    const startX = evt.clientX;
    let moved = false;
    const targets = prop
      ? [{ el, prop, t: time }]
      : this._keysAtTime(el, time);

    const onMove = (e) => {
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      if (!moved) this.scene.live();
      moved = true;
      const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const target = this.app.scene.doc.snap
        ? Math.round(ratio * duration * this.doc.canvas.fps) / this.doc.canvas.fps
        : ratio * duration;
      this.scene.live(() => {
        for (const item of targets) {
          const live = this.scene.element(item.el.id);
          if (!live || !live.keys[item.prop]) continue;
          const key = keyAt(live.keys[item.prop], item.t);
          if (!key) continue;
          const clash = keyAt(live.keys[item.prop], target);
          if (clash && clash !== key) live.keys[item.prop].splice(live.keys[item.prop].indexOf(clash), 1);
          key.t = Math.round(clamp(target, 0, duration) * 1000) / 1000;
          live.keys[item.prop].sort((a, b) => a.t - b.t);
          item.t = key.t;
        }
      });
      this.app.setTime(clamp(target, 0, duration));
      this.syncKeys();
      this.syncPlayhead();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        this.scene.commit("key-move");
        this.app.markDirty();
        this._structure = "";
      } else {
        this.scene.cancel();
      }
      this.refresh();
      this.app.requestRender();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  _currentTime(item) {
    const el = this.scene.element(item.id);
    if (!el || !el.keys[item.prop]) return null;
    // The stored key object keeps its identity, so the dragged key is whichever
    // currently sits at our last known time.
    const found = keyAt(el.keys[item.prop], item.t);
    return found ? found.t : null;
  }

  _keysAtTime(el, time) {
    const out = [];
    for (const prop of ANIMATABLE) {
      if (keyAt(el.keys[prop], time)) out.push({ el, prop, t: time });
    }
    return out;
  }

  _keyMenu(evt, el, prop, time) {
    const key = keyAt(el.keys[prop], time);
    if (!key) return;
    menu(
      [
        { header: true, label: `${t(`prop.${prop}`)} @ ${time.toFixed(2)}s` },
        ...EASINGS.filter((e) => e !== "bezier").map((ease) => ({
          label: t(`ease.${ease}`),
          icon: key.e === ease ? "check" : "ease",
          onClick: () => {
            this.scene.setKeyEase(el.id, prop, time, ease);
            this.refresh();
            this.app.markDirty();
          },
        })),
        { separator: true },
        {
          label: t("tl.delKey"),
          icon: "trash",
          danger: true,
          onClick: () => {
            this.scene.removeKey(el.id, prop, time);
            this._structure = "";
            this.refresh();
            this.app.markDirty();
          },
        },
      ],
      { x: evt.clientX, y: evt.clientY }
    );
  }

  _rowMenu(evt, el) {
    const props = ANIMATABLE.filter((p) => (el.keys[p] || []).length);
    const items = [{ header: true, label: el.name || el.type }];
    items.push({
      label: t("insp.addKey"),
      icon: "key",
      onClick: () => {
        this.scene.select(el.id);
        this.toggleKeyAtPlayhead();
      },
    });
    if (props.length) {
      items.push({ separator: true });
      items.push({ header: true, label: t("insp.animation") });
      for (const prop of props) {
        items.push({
          label: `${t(`prop.${prop}`)} (${el.keys[prop].length})`,
          icon: "trash",
          danger: true,
          onClick: () => {
            this.scene.clearKeys(el.id, prop);
            this._structure = "";
            this.refresh();
            this.app.markDirty();
          },
        });
      }
    }
    menu(items, { x: evt.clientX, y: evt.clientY });
  }

  _applyEase(ease) {
    const sel = this.selectedKeys;
    const el = this.scene.primary();
    if (sel.length) {
      for (const k of sel) this.scene.setKeyEase(k.id, k.prop, k.t, ease);
    } else if (el) {
      const prop = this.propSelect.value;
      if (!(el.keys[prop] || []).length) {
        toast(t("tl.noKeys"), { kind: "warn" });
        return;
      }
      this.scene.setTrackEase(el.id, prop, ease);
    } else {
      toast(t("tl.selectFirst"), { kind: "warn" });
      return;
    }
    this.refresh();
    this.app.markDirty();
  }

  toggleKeyAtPlayhead() {
    const el = this.scene.primary();
    if (!el) {
      toast(t("tl.selectFirst"), { kind: "warn" });
      return;
    }
    const prop = this.propSelect.value;
    const t0 = this.doc.time;
    const added = this.scene.toggleKey(el.id, prop, t0);
    if (added && !this.expanded.has(el.id)) this.expanded.add(el.id);
    this._structure = "";
    this.refresh();
    this.app.markDirty();
    this.app.requestRender();
    toast(added ? t("tl.keyAdded") : t("tl.keyRemoved"), { kind: "ok", timeout: 1500 });
  }

  jumpKey(dir) {
    const el = this.scene.primary();
    const t0 = this.doc.time;
    if (el) {
      const next = dir > 0 ? nextKeyTime(el.keys, t0) : prevKeyTime(el.keys, t0);
      if (next !== null) {
        this.app.setTime(next);
        return;
      }
    }
    // Fall back to scene-wide key times.
    const all = new Set();
    for (const e of this.doc.elements) {
      for (const prop of ANIMATABLE) for (const k of e.keys[prop] || []) all.add(Math.round(k.t * 1000));
    }
    const times = Array.from(all).map((v) => v / 1000).sort((a, b) => a - b);
    if (!times.length) return;
    const target =
      dir > 0
        ? times.find((x) => x > t0 + 1e-4) ?? times[times.length - 1]
        : [...times].reverse().find((x) => x < t0 - 1e-4) ?? times[0];
    this.app.setTime(target);
  }

  /* ------------------------------------------------------------ sync */

  syncLabels() {
    const selected = this.doc.selection[0] || null;
    for (const el of this.doc.elements) {
      const entry = this._rowIndex.get(el.id);
      if (!entry) continue;
      entry.label.classList.toggle("selected", el.id === selected);
      entry.row.classList.toggle("selected", el.id === selected);
    }
  }

  syncPlayhead() {
    const duration = Math.max(0.02, this.doc.canvas.duration);
    const width = this.scroll.clientWidth || 1;
    const x = (this.doc.time / duration) * width;
    this.playhead.style.transform = `translateX(${x}px)`;
    if (document.activeElement !== this.timeField) {
      this.timeField.value = this.doc.time.toFixed(2);
    }
  }

  syncTransport() {
    const playing = this.app.playing;
    this.playBtn.innerHTML = icon(playing ? "pause" : "play", 13);
    this.playBtn.dataset.playing = String(playing);
    this.loopBtn.classList.toggle("is-active", !!this.doc.loop);
    this.onionBtn.classList.toggle("is-active", !!this.doc.onion);
    this.durationField.value = String(this.doc.canvas.duration);
    this.fpsSelect.value = String(this.doc.canvas.fps);
  }

  drawRuler() {
    const width = this.scroll.clientWidth;
    const height = 22;
    if (!width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (this.ruler.width !== Math.round(width * dpr) || this.ruler.height !== Math.round(height * dpr)) {
      this.ruler.width = Math.round(width * dpr);
      this.ruler.height = Math.round(height * dpr);
    }
    this.ruler.style.width = `${width}px`;
    this.ruler.style.height = `${height}px`;

    const ctx = this.ruler.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const line = styles.getPropertyValue("--line-strong").trim() || "#333";
    const text = styles.getPropertyValue("--text-mute").trim() || "#888";
    const accent = styles.getPropertyValue("--brand").trim() || "#cbff4d";

    const duration = Math.max(0.02, this.doc.canvas.duration);
    const pxPerSecond = width / duration;

    let step = 0.1;
    for (const candidate of [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 30, 60]) {
      if (candidate * pxPerSecond >= 64) {
        step = candidate;
        break;
      }
      step = candidate;
    }

    ctx.font = "10px " + (styles.getPropertyValue("--font-num").trim() || "monospace");
    ctx.textBaseline = "top";

    // frame ticks when they are far enough apart to read
    const frameStep = 1 / this.doc.canvas.fps;
    if (frameStep * pxPerSecond > 7) {
      ctx.strokeStyle = line;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      for (let t = 0; t <= duration + 1e-9; t += frameStep) {
        const x = Math.round(t * pxPerSecond) + 0.5;
        ctx.moveTo(x, height - 4);
        ctx.lineTo(x, height);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = line;
    ctx.fillStyle = text;
    ctx.beginPath();
    for (let t = 0; t <= duration + 1e-9; t += step) {
      const x = Math.round(t * pxPerSecond) + 0.5;
      ctx.moveTo(x, height - 8);
      ctx.lineTo(x, height);
      const label = step < 1 ? t.toFixed(2) : String(Math.round(t));
      ctx.fillText(label, x + 3, 3);
    }
    ctx.stroke();

    // playhead tick
    const x = Math.round((this.doc.time / duration) * width) + 0.5;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  onThemeChange() {
    this.drawRuler();
  }
}

export { confirmDialog };
