/** Top bar: brand, document actions, history, zoom, theme, export entry. */

import { icon } from "./icons.js";
import { h, attachTooltip, menu, theme, toast } from "./shell.js";
import { t, lang, toggleLang } from "../i18n/index.js";

export class TopBar {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.render();
    app.on("dirty", () => this.syncDirty());
    app.on("history", () => this.syncHistory());
    app.on("zoom", () => this.syncZoom());
    app.on("title", () => this.syncTitle());
  }

  render() {
    const app = this.app;
    this.root.innerHTML = "";

    const mark = h("div", { class: "mark", html: icon("sparkle", 15) });
    const name = h("div", { class: "name" }, [
      h("b", { text: t("app.name") }),
      h("span", { text: t("app.tagline") }),
    ]);
    this.root.appendChild(h("div", { class: "brand" }, [mark, name]));
    this.root.appendChild(h("div", { class: "top-sep" }));

    // --- document ---
    const newBtn = this._btn("file", t("file.new"), () => app.newScene(), "Ctrl+N");
    const openBtn = this._btn("folder", t("file.open"), () => app.openProject(), "Ctrl+O");
    const saveBtn = this._btn("save", t("file.save"), () => app.saveProject(), "Ctrl+S");
    const importBtn = this._btn("upload", t("file.importSvg"), () => app.importSvg(), "Ctrl+Shift+O");
    for (const b of [newBtn, openBtn, saveBtn, importBtn]) this.root.appendChild(b);
    this.root.appendChild(h("div", { class: "top-sep" }));

    // --- document name ---
    this.titleInput = h("input", {
      type: "text",
      value: app.doc.name || t("file.untitled"),
      spellcheck: "false",
      placeholder: t("file.untitled"),
    });
    this.titleInput.addEventListener("change", () => {
      app.scene.mutate("rename-doc", (doc) => {
        doc.name = this.titleInput.value.trim();
      });
      app.markDirty();
    });
    this.titleInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") this.titleInput.blur();
      evt.stopPropagation();
    });
    this.dirtyDot = h("span", { class: "dirty-dot" });
    attachTooltip(this.dirtyDot, t("file.dirty"));
    this.root.appendChild(h("div", { class: "doc-name" }, [this.titleInput, this.dirtyDot]));
    this.root.appendChild(h("div", { class: "top-sep" }));

    // --- history ---
    this.undoBtn = this._iconBtn("undo", t("edit.undo"), () => app.undo(), "Ctrl+Z");
    this.redoBtn = this._iconBtn("redo", t("edit.redo"), () => app.redo(), "Ctrl+Shift+Z");
    this.root.appendChild(this.undoBtn);
    this.root.appendChild(this.redoBtn);

    this.root.appendChild(h("div", { class: "grow" }));

    // --- zoom ---
    const zoomOut = this._iconBtn("minus", t("view.zoomOut"), () => app.stage.zoomBy(1 / 1.25));
    const zoomIn = this._iconBtn("plus", t("view.zoomIn"), () => app.stage.zoomBy(1.25));
    this.zoomValue = h("button", { class: "val", type: "button", text: "100%" });
    this.zoomValue.addEventListener("click", (evt) => this._zoomMenu(evt));
    const fitBtn = this._iconBtn("fit", t("view.zoomFit"), () => app.stage.fit());
    this.root.appendChild(h("div", { class: "zoom-group" }, [zoomOut, this.zoomValue, zoomIn, fitBtn]));
    this.root.appendChild(h("div", { class: "top-sep" }));

    // --- view toggles ---
    this.gridBtn = this._iconBtn("grid", t("view.grid"), () => {
      app.toggleGrid();
      this.syncToggles();
    });
    this.snapBtn = this._iconBtn("magnet", t("view.snap"), () => {
      app.scene.mutate("snap", (doc) => {
        doc.snap = !doc.snap;
      });
      this.syncToggles();
    });
    this.onionBtn = this._iconBtn("onion", t("view.onion"), () => {
      app.scene.mutate("onion", (doc) => {
        doc.onion = !doc.onion;
      });
      app.requestRender();
      this.syncToggles();
    });
    for (const b of [this.gridBtn, this.snapBtn, this.onionBtn]) this.root.appendChild(b);

    // --- language + theme ---
    this.langBtn = h("button", {
      class: "btn",
      type: "button",
      dataset: { action: "lang" },
      text: lang() === "zh" ? "English" : "中文",
    });
    attachTooltip(this.langBtn, t("about.language"));
    this.langBtn.addEventListener("click", () => {
      toggleLang();
      app.rebuildUI();
    });
    this.root.appendChild(this.langBtn);

    this.themeBtn = h("button", {
      class: "btn icon",
      type: "button",
      dataset: { action: "theme" },
      html: icon(theme.current === "dark" ? "moon" : "sun", 15),
    });
    attachTooltip(this.themeBtn, t("view.theme"));
    this.themeBtn.addEventListener("click", () => {
      const next = theme.toggle();
      this.themeBtn.innerHTML = icon(next === "dark" ? "moon" : "sun", 15);
      app.stage.onThemeChange();
      app.timeline?.onThemeChange?.();
    });
    this.root.appendChild(this.themeBtn);

    // --- export ---
    const exportBtn = h("button", { class: "btn brand", type: "button" }, [
      h("span", { html: icon("download", 14) }),
      h("span", { text: t("dock.export") }),
    ]);
    exportBtn.addEventListener("click", () => app.openDock("export"));
    this.root.appendChild(exportBtn);

    this.syncToggles();
    this.syncHistory();
    this.syncZoom();
    this.syncTitle();
  }

  _btn(iconName, label, onClick, shortcut) {
    const btn = h("button", { class: "btn", type: "button" }, [
      h("span", { html: icon(iconName, 15) }),
      h("span", { text: label }),
    ]);
    attachTooltip(btn, label, shortcut);
    btn.addEventListener("click", onClick);
    return btn;
  }

  _iconBtn(iconName, label, onClick, shortcut) {
    const btn = h("button", { class: "btn icon", type: "button", html: icon(iconName, 15) });
    attachTooltip(btn, label, shortcut);
    btn.addEventListener("click", onClick);
    return btn;
  }

  _zoomMenu(evt) {
    const rect = evt.currentTarget.getBoundingClientRect();
    const stage = this.app.stage;
    menu(
      [
        { label: "25%", onClick: () => stage.setZoom(0.25) },
        { label: "50%", onClick: () => stage.setZoom(0.5) },
        { label: "100%", onClick: () => stage.setZoom(1) },
        { label: "200%", onClick: () => stage.setZoom(2) },
        { label: "400%", onClick: () => stage.setZoom(4) },
        { separator: true },
        { label: t("view.zoomFit"), icon: "fit", onClick: () => stage.fit() },
      ],
      { x: rect.left, y: rect.bottom + 6 }
    );
  }

  syncTitle() {
    if (this.titleInput && document.activeElement !== this.titleInput) {
      this.titleInput.value = this.app.doc.name || "";
      this.titleInput.placeholder = t("file.untitled");
    }
  }

  /** Refresh every piece of state this bar shows. */
  syncAll() {
    this.syncTitle();
    this.syncHistory();
    this.syncZoom();
    this.syncDirty();
    this.syncToggles();
  }

  syncDirty() {
    if (this.dirtyDot) this.dirtyDot.classList.toggle("on", this.app.dirty);
  }

  syncHistory() {
    if (this.undoBtn) this.undoBtn.disabled = !this.app.history.canUndo;
    if (this.redoBtn) this.redoBtn.disabled = !this.app.history.canRedo;
  }

  syncZoom() {
    if (this.zoomValue) this.zoomValue.textContent = `${Math.round(this.app.stage.view.zoom * 100)}%`;
  }

  syncToggles() {
    const doc = this.app.scene.doc;
    this.gridBtn?.classList.toggle("is-active", !!doc.showGrid);
    this.snapBtn?.classList.toggle("is-active", !!doc.snap);
    this.onionBtn?.classList.toggle("is-active", !!doc.onion);
  }
}

export { toast };
