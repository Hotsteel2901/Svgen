/** Left tool rail: tools, paint swatches and the canvas reset. */

import { icon } from "./icons.js";
import { h, attachTooltip, menu, theme } from "./shell.js";
import { t } from "../i18n/index.js";
import { toHex, parseColor, toOpaqueHex } from "../core/color.js";

const TOOL_GROUPS = [
  [
    { id: "select", icon: "cursor", key: "V" },
    { id: "hand", icon: "hand", key: "H" },
    { id: "eyedropper", icon: "eyedropper", key: "I" },
  ],
  [
    { id: "pen", icon: "pen", key: "P" },
    { id: "path", icon: "path", key: "B" },
    { id: "text", icon: "text", key: "T" },
  ],
  [
    { id: "rect", icon: "rect", key: "R" },
    { id: "rounded", icon: "rounded", key: "U" },
    { id: "ellipse", icon: "ellipse", key: "O" },
    { id: "line", icon: "line", key: "L" },
    { id: "arrow", icon: "arrow", key: "A" },
    { id: "polygon", icon: "polygon", key: "G" },
    { id: "star", icon: "star", key: "S" },
  ],
];

export class Rail {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.buttons = new Map();
    this.render();
    app.on("tool", () => this.syncActive());
  }

  render() {
    this.root.innerHTML = "";

    for (const group of TOOL_GROUPS) {
      const wrap = h("div", { class: "rail-group" });
      for (const tool of group) {
        const btn = h("button", {
          class: "tool",
          type: "button",
          dataset: { tool: tool.id },
          "aria-pressed": String(this.app.tools.tool === tool.id),
          html: icon(tool.icon, 17),
        });
        attachTooltip(btn, t(`tool.${tool.id}`), tool.key);
        btn.addEventListener("click", () => this.app.setTool(tool.id));
        wrap.appendChild(btn);
        this.buttons.set(tool.id, btn);
      }
      this.root.appendChild(wrap);
    }

    // paint swatches
    const swatchGroup = h("div", { class: "rail-group" });
    const stack = h("div", { class: "swatch-stack" });
    this.fillSwatch = this._swatch("fg", () => this.app.paint.fill, (c) => this.app.setFill(c));
    this.strokeSwatch = this._swatch("bg", () => this.app.paint.stroke, (c) => this.app.setStroke(c));
    const swap = h("button", { class: "swap", type: "button", html: icon("swap", 10) });
    attachTooltip(swap, t("tool.swapColors"), "X");
    swap.addEventListener("click", () => this.app.swapColors());
    stack.append(this.fillSwatch, this.strokeSwatch, swap);
    swatchGroup.appendChild(stack);

    const widthBtn = h("button", { class: "tool", type: "button", html: icon("sliders", 16) });
    attachTooltip(widthBtn, t("tool.strokeWidth"));
    widthBtn.addEventListener("click", (evt) => this._strokeWidthMenu(evt));
    swatchGroup.appendChild(widthBtn);

    this.root.appendChild(swatchGroup);
    this.root.appendChild(h("div", { class: "rail-spacer" }));

    const bottom = h("div", { class: "rail-group" });
    const gridBtn = h("button", {
      class: "tool",
      type: "button",
      html: icon("grid", 16),
      "aria-pressed": String(!!this.app.scene.doc.showGrid),
    });
    attachTooltip(gridBtn, t("view.grid"), "Ctrl+'");
    gridBtn.addEventListener("click", () => {
      this.app.toggleGrid();
      gridBtn.setAttribute("aria-pressed", String(!!this.app.scene.doc.showGrid));
    });
    this.gridBtn = gridBtn;
    bottom.appendChild(gridBtn);

    const clearBtn = h("button", { class: "tool", type: "button", html: icon("trash", 16) });
    attachTooltip(clearBtn, t("edit.delete"));
    clearBtn.addEventListener("click", () => this.app.clearCanvas());
    bottom.appendChild(clearBtn);
    this.root.appendChild(bottom);

    this.syncPaint();
  }

  _swatch(kind, get, set) {
    const el = h("button", { class: `swatch ${kind}`, type: "button" }, [h("i")]);
    attachTooltip(el, kind === "fg" ? t("tool.fill") : t("tool.stroke"), kind === "fg" ? "" : "Shift+X");
    const input = h("input", { type: "color" });
    el.appendChild(input);
    el.addEventListener("click", (evt) => {
      evt.preventDefault();
      this._colorMenu(el, get(), (color) => set(color));
    });
    el._refresh = () => {
      const color = get();
      const rgba = parseColor(color);
      el.querySelector("i").style.background = rgba ? toHex(rgba, true) : "transparent";
      el.classList.toggle("none", !rgba);
    };
    return el;
  }

  syncPaint() {
    this.fillSwatch?._refresh?.();
    this.strokeSwatch?._refresh?.();
    if (this.gridBtn) this.gridBtn.setAttribute("aria-pressed", String(!!this.app.scene.doc.showGrid));
  }

  syncActive() {
    for (const [id, btn] of this.buttons) {
      btn.setAttribute("aria-pressed", String(id === this.app.tools.tool));
    }
    this.app.tools.updateCursor(this.app.stage.pointer);
  }

  _colorMenu(anchor, current, apply) {
    const rect = anchor.getBoundingClientRect();
    const items = [];
    items.push({ header: true, label: t("tool.fill") });
    for (const color of ["#0a0b0d", "#edeff3", "#cbff4d", "#6fc7ff", "#b79cff", "#ff8a5b", "#ff5f6d", "#58d68d", "#ffcf5c", "#ffffff"]) {
      items.push({
        label: color,
        icon: "box",
        onClick: () => apply(color),
      });
    }
    items.push({ separator: true });
    items.push({
      label: t("exp.transparent"),
      icon: "x",
      onClick: () => apply(null),
    });
    items.push({
      label: "…",
      icon: "palette",
      onClick: () => {
        const input = document.createElement("input");
        input.type = "color";
        input.value = toOpaqueHex(parseColor(current));
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.addEventListener("input", () => apply(input.value));
        input.addEventListener("change", () => {
          apply(input.value);
          input.remove();
        });
        input.click();
      },
    });
    menu(items, { x: rect.right + 8, y: rect.top });
  }

  _strokeWidthMenu(evt) {
    const rect = evt.currentTarget.getBoundingClientRect();
    const values = [1, 2, 3, 4, 6, 8, 12, 16, 24, 40];
    menu(
      values.map((v) => ({
        label: `${v} px`,
        icon: "sliders",
        onClick: () => this.app.setStrokeWidth(v),
      })),
      { x: rect.right + 8, y: rect.top }
    );
  }
}

export { theme };
