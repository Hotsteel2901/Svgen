/** Layers pane: reorderable list with visibility, lock and inline rename. */

import { h, attachTooltip, menu } from "./shell.js";
import { icon } from "./icons.js";
import { t } from "../i18n/index.js";
import { iconButton } from "./controls.js";

const TYPE_ICON = {
  rect: "rect",
  ellipse: "ellipse",
  polygon: "polygon",
  star: "star",
  line: "line",
  arrow: "arrow",
  path: "path",
  text: "text",
};

export class LayersPane {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.el = h("div", { class: "pane" });
    root.appendChild(this.el);
    this.build();
    app.on("change", () => this.refresh());
    app.on("selection", () => this.refresh());
  }

  get scene() {
    return this.app.scene;
  }

  build() {
    this.el.innerHTML = "";
    this.toolbar = h("div", { class: "layer-tools" }, [
      iconButton("chevronUp", t("layers.up"), () => this.app.reorderSelection(1)),
      iconButton("chevronDown", t("layers.down"), () => this.app.reorderSelection(-1)),
      iconButton("duplicate", t("layers.duplicate"), () => this.app.duplicateSelection()),
      h("div", { class: "grow" }),
      iconButton("trash", t("layers.delete"), () => this.app.deleteSelection(), { className: "btn icon sm ghost-danger" }),
    ]);
    this.list = h("div", { class: "layer-list" });
    this.el.append(this.toolbar, this.list);
    this.refresh(true);
  }

  refresh(force = false) {
    const elements = this.scene.doc.elements;
    const signature = elements.map((e) => `${e.id}:${e.visible}:${e.locked}:${e.name}`).join("|");
    if (!force && signature === this._signature) {
      this.syncSelection();
      return;
    }
    this._signature = signature;
    this.list.innerHTML = "";

    if (!elements.length) {
      this.list.appendChild(
        h("div", { class: "empty" }, [
          h("span", { html: icon("layers", 26) }),
          h("div", { text: t("layers.empty") }),
          h("div", { text: t("layers.emptyHint") }),
        ])
      );
      return;
    }

    // Top of the list is the topmost layer, so iterate in reverse.
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      const row = h("div", {
        class: "layer",
        dataset: { id: el.id },
        draggable: "false",
        role: "listitem",
        tabindex: "0",
      });

      const grip = h("span", { class: "grip", html: icon("grip", 10) });
      const ic = h("span", { class: "ic", html: icon(TYPE_ICON[el.type] || "box", 13) });
      const nm = h("span", { class: "nm truncate", text: el.name || el.type });

      const keyCount = Object.values(el.keys).reduce((sum, arr) => sum + (arr?.length || 0), 0);
      const kf = keyCount ? h("span", { class: "kfcount", text: String(keyCount) }) : null;

      const flags = h("span", { class: "flags" });
      const lockBtn = h("button", {
        class: `btn icon sm${el.locked ? " on" : ""}`,
        type: "button",
        html: icon(el.locked ? "lock" : "unlock", 13),
      });
      attachTooltip(lockBtn, el.locked ? t("layers.unlock") : t("layers.lock"));
      lockBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.scene.mutate("lock", () => {
          el.locked = !el.locked;
        });
        this.app.requestRender();
        this.refresh(true);
      });
      const eyeBtn = h("button", {
        class: `btn icon sm${el.visible ? " on" : ""}`,
        type: "button",
        html: icon(el.visible ? "eye" : "eyeOff", 13),
      });
      attachTooltip(eyeBtn, el.visible ? t("layers.hide") : t("layers.show"));
      eyeBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.scene.mutate("visibility", () => {
          el.visible = !el.visible;
        });
        this.app.requestRender();
        this.refresh(true);
      });
      flags.append(lockBtn, eyeBtn);

      row.append(grip, ic, nm);
      if (kf) row.appendChild(kf);
      row.appendChild(flags);

      row.addEventListener("pointerdown", (evt) => {
        if (evt.button !== 0) return;
        this.scene.select(el.id, { toggle: evt.shiftKey });
        this.app.onSelectionChanged();
      });
      row.addEventListener("dblclick", () => this._rename(el, nm));
      row.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.scene.select(el.id);
        this.app.onSelectionChanged();
        this._rowMenu(evt, el);
      });
      row.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") this._rename(el, nm);
        if (evt.key === "Delete") this.app.deleteSelection();
      });

      this._enableDrag(row, el);
      this.list.appendChild(row);
    }
    this.syncSelection();
  }

  syncSelection() {
    const selected = new Set(this.scene.doc.selection);
    for (const row of this.list.querySelectorAll(".layer")) {
      row.classList.toggle("selected", selected.has(row.dataset.id));
    }
  }

  _rename(el, node) {
    const input = h("input", { type: "text", value: el.name || "" });
    node.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const value = input.value.trim() || el.type;
      this.scene.updateElement(el.id, { name: value }, { label: "rename" });
      this.app.markDirty();
      this._signature = "";
      this.refresh(true);
      this.app.timeline?.refresh();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (evt) => {
      evt.stopPropagation();
      if (evt.key === "Enter") input.blur();
      if (evt.key === "Escape") {
        input.value = el.name || "";
        input.blur();
      }
    });
  }

  _rowMenu(evt, el) {
    menu(
      [
        { header: true, label: el.name || el.type },
        { label: t("layers.rename"), icon: "edit", onClick: () => {
          const row = this.list.querySelector(`.layer[data-id="${el.id}"]`);
          if (row) this._rename(el, row.querySelector(".nm"));
        } },
        { label: t("layers.duplicate"), icon: "duplicate", onClick: () => this.app.duplicateSelection() },
        { separator: true },
        { label: t("edit.bringFront"), icon: "bringFront", onClick: () => this.app.reorderSelection(Infinity) },
        { label: t("edit.raise"), icon: "chevronUp", onClick: () => this.app.reorderSelection(1) },
        { label: t("edit.lower"), icon: "chevronDown", onClick: () => this.app.reorderSelection(-1) },
        { label: t("edit.sendBack"), icon: "sendBack", onClick: () => this.app.reorderSelection(-Infinity) },
        { separator: true },
        {
          label: el.visible ? t("layers.hide") : t("layers.show"),
          icon: el.visible ? "eyeOff" : "eye",
          onClick: () => {
            this.scene.mutate("visibility", () => {
              el.visible = !el.visible;
            });
            this.app.requestRender();
            this.refresh(true);
          },
        },
        {
          label: el.locked ? t("layers.unlock") : t("layers.lock"),
          icon: el.locked ? "unlock" : "lock",
          onClick: () => {
            this.scene.mutate("lock", () => {
              el.locked = !el.locked;
            });
            this.refresh(true);
          },
        },
        { separator: true },
        {
          label: t("layers.delete"),
          icon: "trash",
          danger: true,
          onClick: () => {
            this.scene.select(el.id);
            this.app.deleteSelection();
          },
        },
      ],
      { x: evt.clientX, y: evt.clientY }
    );
  }

  /** Drag a row to restack it. */
  _enableDrag(row, el) {
    let dragging = false;
    let indicator = null;

    row.addEventListener("pointerdown", (evt) => {
      const grip = evt.target.closest(".grip");
      if (!grip) return;
      evt.preventDefault();
      dragging = true;
      row.classList.add("dragging");
      const onMove = (e) => {
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".layer");
        this.list.querySelectorAll(".layer").forEach((r) => r.classList.remove("drop-above", "drop-below"));
        indicator = null;
        if (!target || target === row) return;
        const rect = target.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        target.classList.add(above ? "drop-above" : "drop-below");
        indicator = { target, above };
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        row.classList.remove("dragging");
        if (!dragging) return;
        dragging = false;
        this.list.querySelectorAll(".layer").forEach((r) => r.classList.remove("drop-above", "drop-below"));
        if (!indicator) return;
        const targetId = indicator.target.dataset.id;
        const doc = this.scene.doc;
        const from = doc.elements.findIndex((e) => e.id === el.id);
        let to = doc.elements.findIndex((e) => e.id === targetId);
        if (from < 0 || to < 0) return;
        // The list is drawn top-down but the array is bottom-up.
        const targetIsAbove = indicator.above;
        if (from < to) to -= targetIsAbove ? 0 : 1;
        else to += targetIsAbove ? 1 : 0;
        this.scene.reorder(el.id, Math.max(0, Math.min(doc.elements.length - 1, to)), "reorder");
        this.app.markDirty();
        this.app.requestRender();
        this._signature = "";
        this.refresh(true);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
}
