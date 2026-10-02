/**
 * Canvas context menu.
 *
 * The studio captures the right-click itself — the browser's own menu never
 * appears — and shows actions for whatever is under the pointer: shape
 * operations on an element, canvas operations on empty space.
 */

import { menu, h, toast } from "./shell.js";
import { icon } from "./icons.js";
import { t } from "../i18n/index.js";

/**
 * @param {App}    app
 * @param {Event}  evt      the contextmenu event (for coordinates)
 * @param {object} pointer  { sceneX, sceneY } from the stage
 * @param {object} info     { hit } — the element under the pointer, if any
 */
export function openCanvasMenu(app, evt, pointer, info = {}) {
  const doc = app.scene.doc;
  const hit = info.hit || null;

  // Right-clicking an unselected shape selects it first, like every other
  // drawing tool does. Right-clicking empty canvas acts on the canvas, whether
  // or not something was selected before — otherwise the menu lies about what
  // you pointed at.
  if (hit && !doc.selection.includes(hit.id)) {
    app.scene.select(hit.id);
    app.onSelectionChanged();
  }
  const context = hit ? app.scene.selectedElements() : [];
  const onCanvas = !hit;

  const items = [];
  const has = context.length > 0;
  const multi = context.length > 1;

  if (has) {
    items.push({
      header: true,
      label: multi ? t("ctx.nShapes", { n: context.length }) : context[0].name || t(`type.${context[0].type}`),
    });
  } else {
    items.push({ header: true, label: t("ctx.canvas") });
  }

  items.push(
    { label: t("edit.undo"), icon: "undo", shortcut: "Ctrl+Z", disabled: !app.history.canUndo, onClick: () => app.undo() },
    { label: t("edit.redo"), icon: "redo", shortcut: "Ctrl+Shift+Z", disabled: !app.history.canRedo, onClick: () => app.redo() },
    { separator: true }
  );

  if (has) {
    items.push(
      { label: t("edit.copy"), icon: "copy", shortcut: "Ctrl+C", onClick: () => app.copySelection() },
      { label: t("edit.paste"), icon: "file", shortcut: "Ctrl+V", disabled: !app.hasClipboard(), onClick: () => app.paste() },
      { label: t("edit.duplicate"), icon: "duplicate", shortcut: "Ctrl+D", onClick: () => app.duplicateSelection() },
      {
        label: t("edit.delete"),
        icon: "trash",
        shortcut: "Del",
        danger: true,
        onClick: () => app.deleteSelection(),
      },
      { separator: true },
      { label: t("edit.bringFront"), icon: "bringFront", onClick: () => app.reorderSelection(Infinity) },
      { label: t("edit.raise"), icon: "chevronUp", onClick: () => app.reorderSelection(1) },
      { label: t("edit.lower"), icon: "chevronDown", onClick: () => app.reorderSelection(-1) },
      { label: t("edit.sendBack"), icon: "sendBack", onClick: () => app.reorderSelection(-Infinity) },
      { separator: true },
      { label: t("edit.flipH"), icon: "swap", onClick: () => app.flipSelection("x") },
      { label: t("edit.flipV"), icon: "refresh", onClick: () => app.flipSelection("y") }
    );

    if (multi) {
      items.push({ separator: true });
      items.push({ header: true, label: t("insp.align") });
      for (const [mode, key] of [
        ["left", "alignLeft"], ["center", "alignCenterH"], ["right", "alignRight"],
        ["top", "alignTop"], ["middle", "alignMiddleV"], ["bottom", "alignBottom"],
      ]) {
        items.push({
          label: t(`align.${mode}`),
          icon: key,
          onClick: () => app.alignSelection(mode),
        });
      }
    }

    if (context.length === 1) {
      const el = context[0];
      items.push({ separator: true });
      items.push({
        label: el.visible ? t("layers.hide") : t("layers.show"),
        icon: el.visible ? "eyeOff" : "eye",
        onClick: () => {
          app.scene.mutate("visibility", () => {
            el.visible = !el.visible;
          });
          app.requestRender();
          app.layers?.refresh(true);
          app.timeline?.refresh();
        },
      });
      items.push({
        label: el.locked ? t("layers.unlock") : t("layers.lock"),
        icon: el.locked ? "unlock" : "lock",
        onClick: () => {
          app.scene.mutate("lock", () => {
            el.locked = !el.locked;
          });
          app.layers?.refresh(true);
        },
      });
      if (el.type === "text") {
        items.push({
          label: t("insp.editText"),
          icon: "edit",
          onClick: () => app.focusText(),
        });
      }
      items.push({
        label: t("tl.addKey"),
        icon: "key",
        shortcut: "K",
        onClick: () => app.timeline?.toggleKeyAtPlayhead(),
      });
    }
  } else {
    items.push(
      { label: t("edit.paste"), icon: "file", shortcut: "Ctrl+V", disabled: !app.hasClipboard(), onClick: () => app.paste() },
      { label: t("edit.selectAll"), icon: "group", shortcut: "Ctrl+A", onClick: () => app.selectAll() },
      { label: t("edit.deselect"), icon: "x", onClick: () => app.scene.clearSelection() },
      { separator: true },
      {
        label: t("insp.addText"),
        icon: "text",
        onClick: () => {
          app.setTool("text");
        },
      }
    );
  }

  items.push({ separator: true });
  items.push({ header: true, label: t("ctx.view") });
  items.push({
    label: t("view.zoomFit"),
    icon: "fit",
    shortcut: "Shift+1",
    onClick: () => app.stage.fit(),
  });
  items.push({
    label: t("view.zoom100"),
    icon: "target",
    shortcut: "Ctrl+0",
    onClick: () => app.stage.setZoom(1),
  });
  items.push({
    label: t("view.grid"),
    icon: "grid",
    checked: !!doc.showGrid,
    onClick: () => app.toggleGrid(),
  });
  items.push({
    label: t("view.snap"),
    icon: "magnet",
    checked: !!doc.snap,
    onClick: () => {
      app.scene.mutate("snap", (d) => {
        d.snap = !d.snap;
      });
      app.topbar?.syncToggles();
      app.rail?.syncPaint();
    },
  });
  items.push({
    label: t("view.onion"),
    icon: "onion",
    checked: !!doc.onion,
    onClick: () => {
      app.scene.mutate("onion", (d) => {
        d.onion = !d.onion;
      });
      app.requestRender();
      app.timeline?.refresh();
    },
  });

  items.push({ separator: true });
  if (onCanvas) {
    items.push({
      label: t("doc.pickBackground"),
      icon: "palette",
      shortcut: "Shift+B",
      onClick: () => app.fillCanvas(),
    });
    items.push({
      label: t("doc.fillNone"),
      icon: "x",
      onClick: () => app.setCanvasBackground(null),
    });
  }
  items.push({
    label: t("ctx.canvasSettings"),
    icon: "sliders",
    onClick: () => {
      app.openDock("inspector");
    },
  });

  menu(items, { x: evt.clientX, y: evt.clientY });
}

/**
 * Brush settings popover, anchored to a rail button.
 * Size / opacity / smoothing / taper, with a live preview swatch.
 */
export function openBrushMenu(app, anchor) {
  const rect = anchor.getBoundingClientRect();
  const brush = app.brush;

  const wrap = h("div", { style: "padding:4px 10px 10px;width:236px" });

  const preview = h("div", {
    style:
      "height:52px;border-radius:8px;background:var(--surface-3);" +
      "border:1px solid var(--line);display:flex;align-items:center;" +
      "justify-content:center;margin-bottom:10px;overflow:hidden",
  });
  const previewSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  previewSvg.setAttribute("width", "212");
  previewSvg.setAttribute("height", "52");
  previewSvg.setAttribute("viewBox", "0 0 212 52");
  const strokePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  strokePath.setAttribute("fill", "none");
  strokePath.setAttribute("stroke-linecap", "round");
  strokePath.setAttribute("stroke-linejoin", "round");
  strokePath.setAttribute("d", "M 8 34 C 46 6, 76 48, 112 24 S 176 6, 204 32");
  previewSvg.appendChild(strokePath);
  preview.appendChild(previewSvg);

  const paintPreview = () => {
    strokePath.setAttribute("stroke", app.paint.stroke || "#edeff3");
    strokePath.setAttribute("stroke-width", String(Math.max(1, brush.size)));
    strokePath.setAttribute("opacity", String(brush.opacity));
  };

  const row = (label, control) =>
    h("div", { class: "prop" }, [
      h("span", { class: "label", text: label }),
      h("div", { class: "ctl" }, [control]),
    ]);

  const slider = (value, min, max, step, onInput) => {
    const input = h("input", { class: "slider", type: "range", min, max, step, value: String(value) });
    const readout = h("span", {
      class: "mono",
      style: "min-width:34px;text-align:right;font-size:11px;color:var(--text-mute)",
      text: String(value),
    });
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      readout.textContent = String(v);
      onInput(v);
      paintPreview();
    });
    return h("div", { class: "ctl", style: "flex:1;display:flex;gap:8px;align-items:center" }, [input, readout]);
  };

  wrap.append(
    preview,
    row(t("brush.size"), slider(brush.size, 1, 80, 1, (v) => {
      brush.size = v;
      app.setStrokeWidth(v);
      app.rail?.syncPaint();
      app.stage.invalidate();
    })),
    row(t("brush.opacity"), slider(brush.opacity, 0.05, 1, 0.05, (v) => {
      brush.opacity = v;
    })),
    row(t("brush.smooth"), slider(brush.smoothing, 0, 1, 0.05, (v) => {
      brush.smoothing = v;
    })),
    row(t("brush.stabiliser"), slider(brush.stabiliser, 0, 0.95, 0.05, (v) => {
      brush.stabiliser = v;
    }))
  );

  const fillRow = h("div", { class: "prop" }, [
    h("span", { class: "label", text: t("brush.colour") }),
    h("div", { class: "ctl", style: "gap:6px" }, [
      (() => {
        const chip = h("span", { class: "swatch" }, [h("i")]);
        const sync = () => {
          chip.querySelector("i").style.background = app.paint.stroke || "transparent";
        };
        sync();
        chip.addEventListener("click", () => {
          const input = h("input", { type: "color", value: app.paint.stroke || "#edeff3" });
          input.style.cssText = "position:fixed;left:-9999px";
          document.body.appendChild(input);
          input.addEventListener("input", () => {
            app.setStroke(input.value);
            sync();
            paintPreview();
            app.rail?.syncPaint();
          });
          input.addEventListener("change", () => input.remove());
          input.click();
        });
        return chip;
      })(),
      (() => {
        const b = h("button", { class: "btn sm outline", type: "button", text: t("brush.swap") });
        b.addEventListener("click", () => {
          app.swapColors();
          paintPreview();
          app.rail?.syncPaint();
        });
        return b;
      })(),
    ]),
  ]);
  wrap.appendChild(fillRow);

  paintPreview();

  const { el } = menu([{ header: true, label: t("brush.title") }, { node: wrap }], {
    x: rect.right + 8,
    y: rect.top,
  });
  // The menu is not created with a stable handle, so tag it for tests.
  el.setAttribute("data-menu", "brush");
  return el;
}

export { toast };
