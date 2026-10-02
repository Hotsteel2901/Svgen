/** Left tool rail: tools, paint swatches and the canvas reset. */

import { icon } from "./icons.js";
import { h, attachTooltip, menu, theme } from "./shell.js";
import { openBrushMenu } from "./contextmenu.js";
import { RAIL_GROUP_COLOR } from "./palette.js";
import { t } from "../i18n/index.js";
import { toHex, parseColor, toOpaqueHex } from "../core/color.js";

const TOOL_GROUPS = [
  {
    id: "select",
    tools: [
      { id: "select", icon: "cursor", key: "V" },
      { id: "hand", icon: "hand", key: "H" },
      { id: "eyedropper", icon: "eyedropper", key: "I" },
    ],
  },
  {
    id: "draw",
    tools: [
      { id: "pen", icon: "pen", key: "P" },
      { id: "path", icon: "path", key: "B" },
      { id: "text", icon: "text", key: "T" },
    ],
  },
  {
    id: "shape",
    tools: [
      { id: "rect", icon: "rect", key: "R" },
      { id: "rounded", icon: "rounded", key: "U" },
      { id: "ellipse", icon: "ellipse", key: "O" },
      { id: "line", icon: "line", key: "L" },
      { id: "arrow", icon: "arrow", key: "A" },
      { id: "polygon", icon: "polygon", key: "G" },
      { id: "star", icon: "star", key: "S" },
    ],
  },
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
      wrap.style.setProperty("--group-color", RAIL_GROUP_COLOR[group.id] || "var(--text-mute)");
      wrap.dataset.group = group.id;
      for (const tool of group.tools) {
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
    swatchGroup.style.setProperty("--group-color", RAIL_GROUP_COLOR.style);
    swatchGroup.dataset.group = "style";
    const stack = h("div", { class: "swatch-stack" });
    this.fillSwatch = this._swatch("fg", () => this.app.paint.fill, (c) => this.app.setFill(c));
    this.strokeSwatch = this._swatch("bg", () => this.app.paint.stroke, (c) => this.app.setStroke(c));
    const swap = h("button", { class: "swap", type: "button", html: icon("swap", 10) });
    attachTooltip(swap, t("tool.swapColors"), "X");
    swap.addEventListener("click", () => this.app.swapColors());
    stack.append(this.fillSwatch, this.strokeSwatch, swap);
    swatchGroup.appendChild(stack);

    const widthBtn = h("button", {
      class: "tool",
      type: "button",
      dataset: { tool: "brush" },
      html: icon("sliders", 16),
    });
    attachTooltip(widthBtn, t("brush.settings"), "B");
    widthBtn.addEventListener("click", (evt) => openBrushMenu(this.app, evt.currentTarget));
    swatchGroup.appendChild(widthBtn);

    this.root.appendChild(swatchGroup);

    // A dedicated freehand pen lives next to the brush settings so the two
    // read as one tool group.
    const paintGroup = h("div", { class: "rail-group" });
    paintGroup.style.setProperty("--group-color", RAIL_GROUP_COLOR.action);
    paintGroup.dataset.group = "action";
    const paintBtn = h("button", { class: "tool", type: "button", dataset: { tool: "paint" }, html: icon("brush", 16) });
    attachTooltip(paintBtn, t("doc.pickBackground"), "Shift+B");
    paintBtn.addEventListener("click", () => this.app.fillCanvas());
    paintGroup.appendChild(paintBtn);
    this.root.appendChild(paintGroup);

    this.root.appendChild(h("div", { class: "rail-spacer" }));

    const bottom = h("div", { class: "rail-group" });
    bottom.style.setProperty("--group-color", RAIL_GROUP_COLOR.action);
    bottom.dataset.group = "action";
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
}

export { theme };
