/**
 * Entry point.
 *
 * Builds the shell, wires the panels to the app and installs the global
 * keyboard map. Everything of substance lives in a module behind this file.
 */

import { initI18n, t, applyI18n } from "./i18n/index.js";
import { Scene, blankDocument } from "./core/scene.js";
import { History } from "./core/history.js";
import { createElement } from "./core/elements.js";
import { setElementKey as setKeyframe } from "./core/anim.js";
import { Stage } from "./ui/stage.js";
import { ToolController } from "./tools/index.js";
import { App } from "./ui/app.js";
import { Rail } from "./ui/rail.js";
import { TopBar } from "./ui/topbar.js";
import { Timeline } from "./ui/timeline.js";
import { Dock } from "./ui/dock.js";
import { theme, closeMenu } from "./ui/shell.js";
import { installInputCapture } from "./ui/input.js";

const AUTOSAVE_KEY = "svgen.scene.v2";

let app = null;

/* ---------------------------------------------------------------- boot */

function boot() {
  initI18n();
  theme.init();

  const scene = new Scene(restoreDoc() || blankDocument());
  const history = new History(scene);

  const stage = new Stage(scene, document.getElementById("stage-host"));
  const tools = new ToolController(scene, stage);
  stage.setTools(tools);

  app = new App({
    scene,
    history,
    stage,
    onEvent: (name, payload) => {
      if (name === "rebuild") rebuild();
      else if (name === "status") setStatus(payload);
    },
  });
  tools.attachApp(app);
  app.tools = tools;
  stage.app = app;
  window.__svgen = app;

  app.attach({
    rail: new Rail(app, document.getElementById("rail")),
    topbar: new TopBar(app, document.getElementById("topbar")),
    timeline: new Timeline(app, document.getElementById("timeline")),
    dock: new Dock(app, document.getElementById("dock")),
  });
  app.start();

  applyI18n();
  document.getElementById("status-foot").textContent = t("about.fontShort");
  document.getElementById("app-version").textContent = "v2.0";

  bindKeyboard(app);
  bindGlobalUI(app);
  installInputCapture(app, document.getElementById("shell"));

  if (!scene.doc.elements.length) demoScene(app);

  app.on("playing", (playing) => {
    document.getElementById("shell").classList.toggle("is-playing", playing);
  });

  requestAnimationFrame(() => {
    app.stage.fit();
    app.stage.invalidate();
    app.stage.syncHint();
    app.timeline.refresh();
    app.dock.refresh();
    app.rail.syncPaint();
    app.topbar.syncAll();
  });

  function rebuild() {
    app.rail.render();
    app.topbar.render();
    app.timeline.render();
    app.dock.rebuild();
    applyI18n();
    document.getElementById("status-foot").textContent = t("about.fontShort");
    requestAnimationFrame(() => {
      app.stage.fit();
      app.stage.syncHint();
      app.topbar.syncAll();
    });
  }
}

function restoreDoc() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const doc = parsed.scene || parsed;
    if (!doc || !Array.isArray(doc.elements) || !doc.elements.length) return null;
    return doc;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- status */

function setStatus(message) {
  const el = document.getElementById("status-msg");
  if (!el) return;
  el.textContent = message || "";
  clearTimeout(setStatus._timer);
  if (message) setStatus._timer = setTimeout(() => {
    el.textContent = "";
  }, 7000);
}

/* ---------------------------------------------------------------- demo */

/** A small scene so the canvas is never a mystery on first run. */
function demoScene(instance) {
  const doc = instance.scene.doc;
  const make = (type, overrides) => Object.assign(createElement(type), overrides);

  doc.canvas.background = "#12141a";

  const ground = make("rect", {
    x: doc.canvas.width / 2,
    y: doc.canvas.height - 72,
    w: doc.canvas.width - 160,
    h: 78,
    rx: 24,
    fill: "#20242c",
    stroke: "#343a44",
    strokeWidth: 2,
    name: t("demo.ground"),
  });

  const sun = make("ellipse", {
    x: doc.canvas.width - 230,
    y: 200,
    w: 180,
    h: 180,
    fill: "#ffcf5c",
    name: t("demo.sun"),
  });

  const star = make("star", {
    x: 280,
    y: 180,
    w: 96,
    h: 96,
    sides: 5,
    innerRatio: 0.45,
    fill: "#6fc7ff",
    name: t("demo.star"),
  });
  setKeyframe(sun, "rotation", 0, 0);
  setKeyframe(sun, "rotation", 2.4, 360);
  setKeyframe(star, "rotation", 0, 0);
  setKeyframe(star, "rotation", 2.4, -360);
  setKeyframe(star, "opacity", 0, 0);
  setKeyframe(star, "opacity", 0.6, 1);

  const ball = make("ellipse", {
    x: 240,
    y: 220,
    w: 112,
    h: 112,
    fill: "#cbff4d",
    name: t("demo.ball"),
  });
  setKeyframe(ball, "x", 0, 200);
  setKeyframe(ball, "x", 0.6, doc.canvas.width / 2);
  setKeyframe(ball, "x", 1.2, doc.canvas.width - 320);
  setKeyframe(ball, "x", 1.8, doc.canvas.width / 2);
  setKeyframe(ball, "x", 2.4, 200);
  setKeyframe(ball, "y", 0, 180);
  setKeyframe(ball, "y", 0.3, doc.canvas.height - 250);
  setKeyframe(ball, "y", 0.6, 180);
  setKeyframe(ball, "y", 0.9, doc.canvas.height - 250);
  setKeyframe(ball, "y", 1.2, 180);
  setKeyframe(ball, "y", 1.5, doc.canvas.height - 250);
  setKeyframe(ball, "y", 1.8, 180);
  setKeyframe(ball, "y", 2.1, doc.canvas.height - 250);
  setKeyframe(ball, "y", 2.4, 180);
  setKeyframe(ball, "rotation", 0, 0);
  setKeyframe(ball, "rotation", 2.4, 720);

  const title = make("text", {
    x: doc.canvas.width / 2,
    y: 118,
    text: t("demo.title"),
    fontSize: 92,
    fill: "#edeff3",
    stroke: null,
    name: t("demo.titleLayer"),
  });

  instance.scene.mutate("demo", (d) => {
    d.elements = [ground, sun, star, ball, title];
    d.selection = [];
  });
  instance.history.clear();
  instance.dirty = false;
  instance.emit("dirty");
}

/* ---------------------------------------------------------------- keyboard */

function bindKeyboard(instance) {
  const TOOL_KEYS = {
    v: "select", h: "hand", i: "eyedropper",
    p: "pen", b: "path", t: "text",
    r: "rect", u: "rounded", o: "ellipse", l: "line", a: "arrow", g: "polygon", s: "star",
  };

  window.addEventListener("keydown", (evt) => {
    if (!instance.scene) return;
    const target = evt.target;
    const tag = (target?.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
    const mod = evt.ctrlKey || evt.metaKey;
    const key = evt.key;
    const lower = key.toLowerCase();

    if (key === "Escape") {
      closeMenu();
      if (instance.tools.penPoints) instance.tools.cancelGesture();
      else instance.tools.cancelGesture();
      if (typing) target.blur();
      return;
    }
    if (typing) return;

    /* --- history & files --- */
    if (mod && lower === "z") {
      evt.preventDefault();
      if (evt.shiftKey) instance.redo();
      else instance.undo();
      return;
    }
    if (mod && lower === "y") {
      evt.preventDefault();
      instance.redo();
      return;
    }
    if (mod && evt.shiftKey && lower === "s") {
      evt.preventDefault();
      instance.saveProject();
      return;
    }
    if (mod && lower === "s") {
      evt.preventDefault();
      instance.saveProject();
      return;
    }
    if (mod && evt.shiftKey && lower === "o") {
      evt.preventDefault();
      instance.importSvg();
      return;
    }
    if (mod && lower === "o") {
      evt.preventDefault();
      instance.openProject();
      return;
    }
    if (mod && lower === "e") {
      evt.preventDefault();
      instance.openDock("export");
      return;
    }
    if (mod && lower === "a") {
      evt.preventDefault();
      instance.selectAll();
      return;
    }
    if (mod && lower === "c") {
      evt.preventDefault();
      instance.copySelection();
      return;
    }
    if (mod && lower === "v") {
      evt.preventDefault();
      instance.paste();
      return;
    }
    if (mod && lower === "d") {
      evt.preventDefault();
      instance.duplicateSelection();
      return;
    }
    if (mod && lower === "l") {
      evt.preventDefault();
      instance.scene.mutate("loop", (doc) => {
        doc.loop = !doc.loop;
      });
      instance.timeline.refresh();
      return;
    }
    if (mod && lower === "0") {
      evt.preventDefault();
      instance.stage.setZoom(1);
      return;
    }
    if (mod && (key === "=" || key === "+")) {
      evt.preventDefault();
      instance.stage.zoomBy(1.25);
      return;
    }
    if (mod && key === "-") {
      evt.preventDefault();
      instance.stage.zoomBy(1 / 1.25);
      return;
    }
    if (mod && (key === "'" || key === '"')) {
      evt.preventDefault();
      instance.toggleGrid();
      return;
    }
    if (mod && evt.shiftKey && lower === "o") return;
    if (mod) return;

    /* --- playback & navigation --- */
    if (key === " ") {
      evt.preventDefault();
      if (evt.repeat) return;
      if (instance.tools.penPoints) {
        instance.tools.finishCurve();
        return;
      }
      instance.spaceDown = true;
      instance.stage.canvas.style.cursor = "grab";
      return;
    }
    if (evt.shiftKey && key === "!") {
      instance.stage.fit();
      return;
    }
    if (key === "[") {
      instance.timeline.jumpKey(-1);
      return;
    }
    if (key === "]") {
      instance.timeline.jumpKey(1);
      return;
    }
    if (key === "Home") {
      instance.setTime(0);
      return;
    }
    if (key === "End") {
      instance.setTime(instance.scene.doc.canvas.duration);
      return;
    }
    if (key === "Enter" && instance.tools.penPoints) {
      instance.tools.finishCurve();
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      evt.preventDefault();
      instance.deleteSelection();
      return;
    }
    if (key === "?" || key === "F1") {
      evt.preventDefault();
      instance.openDock("about");
      return;
    }

    /* --- arrows: nudge or scrub --- */
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      evt.preventDefault();
      const doc = instance.scene.doc;
      const step = evt.shiftKey ? 10 : doc.snap ? doc.grid : 1;
      const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      if (doc.selection.length) instance.nudgeSelection(dx, dy);
      else instance.setTime(doc.time + (dx !== 0 ? dx * 0.02 : dy * 0.02));
      return;
    }

    if (lower === "k") {
      evt.preventDefault();
      instance.timeline.toggleKeyAtPlayhead();
      return;
    }
    if (evt.shiftKey && lower === "b") {
      evt.preventDefault();
      instance.fillCanvas();
      return;
    }
    if (lower === "x") {
      instance.swapColors();
      return;
    }
    if (TOOL_KEYS[lower]) instance.setTool(TOOL_KEYS[lower]);
  });

  window.addEventListener("keyup", (evt) => {
    if (evt.key === " ") {
      instance.spaceDown = false;
      if (!instance.tools.gesture) instance.stage.canvas.style.cursor = "";
    }
  });
}

/* ---------------------------------------------------------------- global UI */

function bindGlobalUI(instance) {
  const helpBtn = document.getElementById("help-btn");
  if (helpBtn) helpBtn.addEventListener("click", () => instance.openDock("about"));

  window.addEventListener("dragover", (evt) => {
    if (evt.dataTransfer?.types?.includes("Files")) evt.preventDefault();
  });

  window.addEventListener("drop", async (evt) => {
    const file = evt.dataTransfer?.files?.[0];
    if (!file) return;
    evt.preventDefault();
    try {
      const text = await file.text();
      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        instance.loadDocument(parsed.scene || parsed, file.name);
      } else if (file.name.endsWith(".svg")) {
        instance.importSvgText(text, file.name);
      }
    } catch (err) {
      instance.toastMessage(err.message, "err");
    }
  });

  window.addEventListener("beforeunload", (evt) => {
    if (!instance.dirty) return undefined;
    evt.preventDefault();
    evt.returnValue = "";
    return "";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

export { boot };
