/**
 * Export pane.
 *
 * Stills go through the synchronous endpoint; anything animated is submitted as
 * a job and followed with live progress, so the UI stays responsive and the
 * render can be cancelled.
 */

import { h, attachTooltip, toast, menu } from "./shell.js";
import { icon } from "./icons.js";
import { t } from "../i18n/index.js";
import { numberField, selectField, colorField, row, section, iconButton } from "./controls.js";
import { sceneToSVG } from "../core/svg-export.js";
import { api, ApiError } from "../net/api.js";
import { downloadBlob, safeName, num } from "../core/util.js";

const STILL = ["svg", "png", "jpg", "webp", "bmp"];
const VIDEO = ["gif", "mp4", "webm"];

export class ExportPane {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.el = h("div", { class: "pane" });
    root.appendChild(this.el);
    this.format = "png";
    this.engine = "auto";
    this.job = null;
    this.abort = null;
    app.on("change", () => this.syncSizes());
    this.build();
    this.loadCapabilities();
  }

  get scene() {
    return this.app.scene;
  }

  get doc() {
    return this.scene.doc;
  }

  /* ------------------------------------------------------------ build */

  build() {
    this.el.innerHTML = "";

    /* canvas */
    const canvasSec = section(t("exp.canvas"));
    this.widthField = numberField({
      value: this.doc.canvas.width,
      min: 1,
      max: 8192,
      step: 1,
      precision: 0,
      onCommit: (v) => this._setCanvas({ width: Math.round(v) }),
    });
    this.heightField = numberField({
      value: this.doc.canvas.height,
      min: 1,
      max: 8192,
      step: 1,
      precision: 0,
      onCommit: (v) => this._setCanvas({ height: Math.round(v) }),
    });
    canvasSec.body.appendChild(
      h("div", { class: "grid2" }, [
        h("label", { class: "pair" }, [h("span", { text: t("exp.width") }), this.widthField.el]),
        h("label", { class: "pair" }, [h("span", { text: t("exp.height") }), this.heightField.el]),
      ])
    );

    this.bgField = colorField({
      value: this.doc.canvas.background,
      label: t("exp.background"),
      onCommit: (v) => this._setCanvas({ background: v }),
    });
    canvasSec.body.appendChild(row(t("exp.background"), [this.bgField.el]));

    this.presetSelect = selectField({
      value: "",
      options: [
        { value: "", label: "—" },
        { value: "1920x1080", label: "1920 × 1080" },
        { value: "1280x720", label: "1280 × 720" },
        { value: "1080x1080", label: "1080 × 1080" },
        { value: "1080x1350", label: "1080 × 1350" },
        { value: "800x600", label: "800 × 600" },
        { value: "512x512", label: "512 × 512" },
      ],
      onChange: (v) => {
        if (!v) return;
        const [w, hh] = v.split("x").map(Number);
        this._setCanvas({ width: w, height: hh });
      },
    });
    canvasSec.body.appendChild(row(t("opt.preset"), [this.presetSelect.el]));
    this.el.appendChild(canvasSec.el);

    /* output */
    const outSec = section(t("exp.output"));
    this.formatGrid = h("div", { class: "fmt-grid" });
    this.formatButtons = new Map();
    for (const fmt of [...STILL, ...VIDEO]) {
      const btn = h("button", { class: "fmt", type: "button", text: fmt.toUpperCase(), "aria-pressed": String(fmt === this.format) });
      btn.dataset.format = fmt;
      btn.addEventListener("click", () => this.setFormat(fmt));
      this.formatGrid.appendChild(btn);
      this.formatButtons.set(fmt, btn);
    }
    outSec.body.appendChild(this.formatGrid);
    outSec.body.appendChild(h("div", { style: "height:8px" }));

    this.durationField = numberField({
      value: this.doc.canvas.duration,
      min: 0.05,
      max: 600,
      step: 0.1,
      onCommit: (v) => this._setCanvas({ duration: v }),
    });
    this.fpsField = numberField({
      value: this.doc.canvas.fps,
      min: 1,
      max: 120,
      step: 1,
      precision: 0,
      onCommit: (v) => this._setCanvas({ fps: Math.round(v) }),
    });
    this.videoOpts = h("div", {}, [
      h("div", { class: "grid2" }, [
        h("label", { class: "pair" }, [h("span", { text: t("exp.duration") }), this.durationField.el]),
        h("label", { class: "pair" }, [h("span", { text: t("exp.fps") }), this.fpsField.el]),
      ]),
    ]);
    outSec.body.appendChild(this.videoOpts);

    this.qualityField = numberField({
      value: 92,
      min: 1,
      max: 100,
      step: 1,
      precision: 0,
      onCommit: () => {},
    });
    this.qualityRow = row(t("exp.quality"), [this.qualityField.el]);
    outSec.body.appendChild(this.qualityRow);
    this.el.appendChild(outSec.el);

    /* engine */
    const engineSec = section(t("exp.engine"));
    this.engineSelect = selectField({
      value: this.engine,
      options: [
        { value: "auto", label: t("exp.engine.auto") },
        { value: "chrome", label: t("exp.engine.chrome") },
        { value: "firefox", label: t("exp.engine.firefox") },
        { value: "rust", label: t("exp.engine.rust") },
        { value: "raster", label: t("exp.engine.raster") },
      ],
      onChange: (v) => {
        this.engine = v;
      },
    });
    engineSec.body.appendChild(this.engineSelect.el);
    this.capsBox = h("div", { class: "caps" }, [h("div", { class: "cap", text: t("exp.ready") })]);
    engineSec.body.appendChild(h("div", { style: "height:8px" }));
    engineSec.body.appendChild(this.capsBox);
    this.el.appendChild(engineSec.el);

    /* actions */
    const actions = section(t("exp.title"));
    this.goBtn = h("button", { class: "btn brand tall block", type: "button" }, [
      h("span", { html: icon("download", 15) }),
      h("span", { text: t("exp.go") }),
    ]);
    this.goBtn.addEventListener("click", () => this.run());
    actions.body.appendChild(this.goBtn);

    const svgRow = h("div", { class: "row", style: "margin-top:8px;display:flex;gap:6px" }, [
      this._smallButton("file", t("exp.downloadSvg"), () => this.downloadSVG()),
      this._smallButton("copy", t("exp.copySvg"), () => this.copySVG()),
      this._smallButton("image", t("exp.snapshot"), () => this.snapshot()),
    ]);
    actions.body.appendChild(svgRow);

    this.progressBox = h("div", { class: "job hidden" });
    actions.body.appendChild(this.progressBox);
    this.el.appendChild(actions.el);

    this.setFormat(this.format);
    this.refresh();
  }

  _smallButton(iconName, label, onClick) {
    const btn = h("button", { class: "btn outline", type: "button", style: "flex:1" }, [
      h("span", { html: icon(iconName, 13) }),
      h("span", { text: label }),
    ]);
    btn.addEventListener("click", onClick);
    return btn;
  }

  /* ------------------------------------------------------------ state */

  _setCanvas(patch) {
    this.scene.setCanvas(patch, "canvas");
    this.app.requestRender();
    this.app.markDirty();
    this.refresh();
  }

  setFormat(fmt) {
    this.format = fmt;
    for (const [key, btn] of this.formatButtons) {
      btn.setAttribute("aria-pressed", String(key === fmt));
    }
    const video = VIDEO.includes(fmt);
    this.videoOpts.classList.toggle("hidden", !video);
    this.qualityRow.classList.toggle("hidden", !["jpg", "webp", "mp4", "webm"].includes(fmt));
    this.syncFormatAvailability();
  }

  syncFormatAvailability() {
    const caps = this.app.conn?.info?.engines;
    const ffmpeg = caps ? caps.formats?.video?.mp4 !== false : true;
    for (const [fmt, btn] of this.formatButtons) {
      if (fmt === "mp4" || fmt === "webm") {
        btn.disabled = !ffmpeg;
        attachTooltip(btn, ffmpeg ? fmt.toUpperCase() : t("exp.videoNeedsFfmpeg", { fmt: fmt.toUpperCase() }));
      }
    }
  }

  async loadCapabilities() {
    try {
      const info = await api.info({ refresh: true });
      this.renderCapabilities(info);
      this.app.conn.info = info;
      this.syncFormatAvailability();
    } catch {
      this.renderOffline();
    }
  }

  renderCapabilities(info) {
    const caps = info.capabilities || {};
    const engines = info.engines || {};
    const rows = [
      ["Chrome / Edge", caps.chrome, caps.chrome_path],
      ["Firefox", caps.firefox, caps.firefox_path],
      ["ffmpeg", caps.ffmpeg, caps.ffmpeg_path],
      [t("exp.engine.rust"), caps.rust, (caps.rust_info || {}).path],
      ["Pillow", caps.pillow, caps.pillow ? "" : t("about.notAvailable")],
    ];
    this.capsBox.innerHTML = "";
    this.capsBox.appendChild(
      h("div", { class: "cap" }, [
        h("span", { html: icon("monitor", 12) }),
        h("span", { text: `${info.os} · ${info.arch}` }),
        h("span", { class: "v", text: `Python ${info.python}` }),
      ])
    );
    for (const [label, ok, detail] of rows) {
      this.capsBox.appendChild(
        h("div", { class: "cap" }, [
          h("span", { html: icon(ok ? "check" : "x", 12), class: ok ? "ok" : "no" }),
          h("span", { text: label }),
          h("span", { class: "v", text: ok ? shortPath(detail) || "✓" : t("about.notAvailable"), title: detail || "" }),
        ])
      );
    }
    if (engines.chain) {
      this.capsBox.appendChild(
        h("div", { class: "cap" }, [
          h("span", { html: icon("zap", 12) }),
          h("span", { text: t("about.chain") }),
          h("span", { class: "v", text: engines.chain.join(" → ") }),
        ])
      );
    }
  }

  renderOffline() {
    this.capsBox.innerHTML = "";
    this.capsBox.appendChild(
      h("div", { class: "cap" }, [
        h("span", { html: icon("warning", 12), class: "no" }),
        h("span", { text: t("exp.offlineHint") }),
      ])
    );
  }

  syncSizes() {
    this.widthField?._sync(this.doc.canvas.width);
    this.heightField?._sync(this.doc.canvas.height);
    this.durationField?._sync(this.doc.canvas.duration);
    this.fpsField?._sync(this.doc.canvas.fps);
    this.bgField?._sync(this.doc.canvas.background);
  }

  refresh() {
    this.syncSizes();
    const online = this.app.conn?.online;
    this.goBtn.disabled = online === false || !!this.job;
    if (online === false) {
      this.goBtn.querySelector("span:last-child").textContent = t("exp.offline");
    } else {
      this.goBtn.querySelector("span:last-child").textContent = t("exp.go");
    }
  }

  /* ------------------------------------------------------------ export */

  payload(overrides = {}) {
    const video = VIDEO.includes(this.format);
    return {
      svg: sceneToSVG(this.scene, {
        width: this.doc.canvas.width,
        height: this.doc.canvas.height,
        duration: this.doc.canvas.duration,
        fps: this.doc.canvas.fps,
      }),
      format: this.format,
      width: this.doc.canvas.width,
      height: this.doc.canvas.height,
      duration: video ? this.doc.canvas.duration : undefined,
      fps: video ? this.doc.canvas.fps : undefined,
      background: this.doc.canvas.background || null,
      engine: this.engine,
      quality: this.qualityField.value,
      name: safeName(this.doc.name, "artwork"),
      ...overrides,
    };
  }

  async run() {
    if (this.job) return;
    const fmt = this.format;
    this.goBtn.disabled = true;

    if (fmt === "svg") {
      this.downloadSVG();
      this.goBtn.disabled = false;
      return;
    }

    const payload = this.payload();
    const video = VIDEO.includes(fmt);

    try {
      if (!video) {
        this.showProgress({ stage: "raster", percent: null, message: t("exp.stage.raster") });
        const { blob, filename } = await api.renderBytes(payload);
        downloadBlob(blob, filename);
        this.finishProgress(t("exp.done", { name: filename }));
        toast(t("exp.done", { name: filename }), { kind: "ok" });
        return;
      }

      const frames = Math.max(1, Math.round(this.doc.canvas.duration * this.doc.canvas.fps));
      this.showProgress({ stage: "starting", percent: 0, message: t("exp.estimate", { n: frames }) });
      const started = await api.startJob(payload);
      this.job = started.job.id;
      this.abort = new AbortController();

      const done = await api.followJob(this.job, {
        signal: this.abort.signal,
        onUpdate: (job) => this.showProgress(job),
      });
      const blob = await api.jobResult(done.id);
      downloadBlob(blob, done.filename);
      this.finishProgress(t("exp.done", { name: done.filename }));
      toast(t("exp.done", { name: done.filename }), { kind: "ok" });
    } catch (err) {
      if (err instanceof ApiError && err.message === "cancelled") {
        this.finishProgress(t("exp.cancelled"), "warn");
      } else {
        this.finishProgress(`${t("exp.failed")}: ${err.message}`, "err");
        toast(err.message || t("exp.failed"), { kind: "err" });
      }
    } finally {
      this.job = null;
      this.abort = null;
      this.goBtn.disabled = this.app.conn?.online === false;
    }
  }

  showProgress(job) {
    this.progressBox.classList.remove("hidden");
    const percent = job.percent;
    const stageLabel = t(`exp.stage.${job.stage}`) === `exp.stage.${job.stage}` ? job.stage : t(`exp.stage.${job.stage}`);
    this.progressBox.innerHTML = "";
    const cancelled = job.state === "cancelled";

    this.progressBox.appendChild(
      h("div", { class: "top" }, [
        h("span", { class: "stage-name", text: cancelled ? t("exp.cancelled") : stageLabel }),
        h("span", { class: "pct", text: percent === null || percent === undefined ? "…" : `${percent}%` }),
        this.job
          ? (() => {
              const btn = h("button", { class: "btn icon sm ghost-danger", type: "button", html: icon("x", 12) });
              attachTooltip(btn, t("exp.cancel"));
              btn.addEventListener("click", () => this.abort?.abort());
              return btn;
            })()
          : null,
      ])
    );

    const bar = h("div", { class: `progress${percent === null || percent === undefined ? " indeterminate" : ""}` }, [h("i")]);
    if (percent !== null && percent !== undefined) bar.firstChild.style.width = `${percent}%`;
    this.progressBox.appendChild(bar);

    if (job.total) {
      this.progressBox.appendChild(
        h("div", { class: "note", text: `${job.done} / ${job.total} · ${num(job.elapsed || 0, 1)}s` })
      );
    } else if (job.message) {
      this.progressBox.appendChild(h("div", { class: "note", text: job.message }));
    }
  }

  finishProgress(message, kind = "ok") {
    if (!this.progressBox) return;
    this.progressBox.innerHTML = "";
    this.progressBox.classList.remove("hidden");
    this.progressBox.appendChild(
      h("div", { class: "top" }, [
        h("span", { html: icon(kind === "err" ? "warning" : kind === "warn" ? "info" : "check", 13), class: kind }),
        h("span", { class: "stage-name", text: message }),
      ])
    );
    setTimeout(() => this.progressBox?.classList.add("hidden"), 6000);
  }

  /* ------------------------------------------------------------ svg helpers */

  svgText() {
    return sceneToSVG(this.scene, {
      width: this.doc.canvas.width,
      height: this.doc.canvas.height,
      duration: this.doc.canvas.duration,
      fps: this.doc.canvas.fps,
    });
  }

  downloadSVG() {
    const name = `${safeName(this.doc.name, "artwork")}.svg`;
    downloadBlob(new Blob([this.svgText()], { type: "image/svg+xml" }), name);
    toast(t("exp.done", { name }), { kind: "ok" });
  }

  async copySVG() {
    const svg = this.svgText();
    try {
      await navigator.clipboard.writeText(svg);
      toast(t("st.copied"), { kind: "ok" });
    } catch {
      toast(t("st.copyFailed"), { kind: "warn" });
    }
  }

  /** Save the current frame as a PNG without leaving the studio. */
  snapshot() {
    const { canvas } = this.app.stage.snapshot(this.doc.canvas.width, this.doc.canvas.height, this.doc.time);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const name = `${safeName(this.doc.name, "artwork")}-${this.doc.time.toFixed(2)}s.png`;
      downloadBlob(blob, name);
      toast(t("exp.done", { name }), { kind: "ok" });
    }, "image/png");
  }

  showMenu(evt) {
    menu(
      [
        { label: t("exp.downloadSvg"), icon: "file", onClick: () => this.downloadSVG() },
        { label: t("exp.copySvg"), icon: "copy", onClick: () => this.copySVG() },
        { label: t("exp.snapshot"), icon: "image", onClick: () => this.snapshot() },
      ],
      { x: evt.clientX, y: evt.clientY }
    );
  }
}

function shortPath(path) {
  if (!path) return "";
  const parts = String(path).split(/[\\/]/);
  return parts.length <= 2 ? path : `…${parts.slice(-2).join("/")}`;
}

export { iconButton };
