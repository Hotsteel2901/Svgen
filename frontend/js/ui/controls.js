/**
 * Reusable panel controls: labelled rows, scrubbers, colour pickers, selects.
 *
 * Every control returns an element with `_sync(value)` so panels can refresh
 * without rebuilding the DOM — which keeps focus, keeps sliders mid-drag, and
 * stops the inspector flickering while you type.
 */

import { h, attachTooltip, menu, toast } from "./shell.js";
import { icon } from "./icons.js";
import { t } from "../i18n/index.js";
import { clamp, num } from "../core/util.js";
import { parseColor, toHex, toOpaqueHex, DEFAULT_SWATCHES } from "../core/color.js";

/* ---------------------------------------------------------------- rows */

export function section(title, { actions = [] } = {}) {
  const head = h("div", { class: "sec-head" }, [h("span", { class: "micro", text: title })]);
  if (actions.length) {
    const box = h("div", { class: "acts" });
    for (const a of actions) box.appendChild(a);
    head.appendChild(box);
  }
  const body = h("div");
  const sec = h("div", { class: "sec" }, [head, body]);
  return { el: sec, body, head };
}

/**
 * A labelled control row. `accent` tints the label with a property colour so
 * the inspector, the timeline tracks and the keyframe diamonds all agree.
 */
export function row(label, control, { accent = null, title = "" } = {}) {
  const labelEl = h("span", { class: "label", text: label });
  if (accent) {
    labelEl.classList.add("accented");
    labelEl.style.setProperty("--accent-prop", accent);
    labelEl.prepend(h("i", { class: "pdot" }));
  }
  if (title) attachTooltip(labelEl, title);
  return h("div", { class: "prop" }, [
    labelEl,
    h("div", { class: "ctl" }, Array.isArray(control) ? control : [control]),
  ]);
}

/* ---------------------------------------------------------------- number */

/**
 * A number field with drag-to-scrub, keyboard stepping and clamping.
 * `onInput(value, { live })` fires continuously while dragging or typing;
 * `onCommit(value)` fires once on release / blur / Enter.
 */
export function numberField({
  value = 0,
  min = -1e6,
  max = 1e6,
  step = 1,
  precision = 2,
  suffix = "",
  onInput,
  onCommit,
  width = null,
  title = "",
} = {}) {
  const input = h("input", {
    type: "text",
    inputmode: "decimal",
    value: num(value, precision),
    spellcheck: "false",
  });
  const wrap = h("span", { class: "field" }, [input]);
  if (width) wrap.style.width = width;
  if (title) attachTooltip(wrap, title);

  let current = value;
  let dragging = false;
  let startX = 0;
  let startValue = 0;
  let moved = false;

  const setValue = (v, { live = false, commit = false } = {}) => {
    const next = clamp(Number.isFinite(v) ? v : current, min, max);
    current = next;
    if (document.activeElement !== input) input.value = num(next, precision);
    if (live && onInput) onInput(next, { live: true });
    if (commit) {
      if (onInput) onInput(next, { live: false });
      if (onCommit) onCommit(next);
    }
  };

  input.addEventListener("focus", () => input.select());
  input.addEventListener("keydown", (evt) => {
    evt.stopPropagation();
    if (evt.key === "Enter") {
      const parsed = parseFloat(input.value);
      if (Number.isFinite(parsed)) setValue(parsed, { commit: true });
      else input.value = num(current, precision);
      input.blur();
    } else if (evt.key === "Escape") {
      input.value = num(current, precision);
      input.blur();
    } else if (evt.key === "ArrowUp" || evt.key === "ArrowDown") {
      evt.preventDefault();
      const mult = evt.shiftKey ? 10 : 1;
      const dir = evt.key === "ArrowUp" ? 1 : -1;
      setValue(current + dir * step * mult, { commit: true });
    }
  });
  input.addEventListener("blur", () => {
    const parsed = parseFloat(input.value);
    if (Number.isFinite(parsed) && parsed !== current) setValue(parsed, { commit: true });
    else input.value = num(current, precision);
  });

  // Scrub with the pointer over the label area of the field.
  wrap.addEventListener("pointerdown", (evt) => {
    if (evt.target === input && document.activeElement === input) return;
    if (evt.button !== 0) return;
    dragging = true;
    moved = false;
    startX = evt.clientX;
    startValue = current;
    wrap.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  });
  wrap.addEventListener("pointermove", (evt) => {
    if (!dragging) return;
    const dx = evt.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;
    moved = true;
    const fine = evt.shiftKey ? 0.1 : 1;
    const next = startValue + dx * step * fine;
    setValue(next, { live: true });
  });
  const endDrag = (evt) => {
    if (!dragging) return;
    dragging = false;
    wrap.releasePointerCapture?.(evt.pointerId);
    if (moved) setValue(current, { commit: true });
  };
  wrap.addEventListener("pointerup", endDrag);
  wrap.addEventListener("pointercancel", endDrag);

  return {
    el: wrap,
    input,
    get value() {
      return current;
    },
    set(v) {
      current = clamp(v, min, max);
      if (document.activeElement !== input) input.value = num(current, precision);
    },
    _sync(v) {
      this.set(v);
    },
  };
}

/* ---------------------------------------------------------------- slider */

export function slider({ value = 0, min = 0, max = 1, step = 0.01, onInput, onCommit } = {}) {
  const input = h("input", { class: "slider", type: "range", min, max, step, value });
  let live = false;
  input.addEventListener("pointerdown", () => {
    live = true;
  });
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    if (onInput) onInput(v, { live: true });
  });
  input.addEventListener("change", () => {
    const v = parseFloat(input.value);
    if (onCommit) onCommit(v);
    live = false;
  });
  return {
    el: input,
    get value() {
      return parseFloat(input.value);
    },
    set(v) {
      if (!live) input.value = String(v);
    },
    _sync(v) {
      this.set(v);
    },
  };
}

/* ---------------------------------------------------------------- colour */

export function colorField({ value = "#000000", allowNone = true, onInput, onCommit, label = "" } = {}) {
  const chip = h("span", { class: "swatch" }, [h("i")]);
  const rowEl = h("div", { class: "swatch-row" }, [chip]);
  if (allowNone) {
    const none = h("button", { class: "btn icon sm", type: "button", html: icon("x", 12) });
    attachTooltip(none, t("exp.transparent"));
    none.addEventListener("click", () => {
      set(null);
      if (onCommit) onCommit(null);
    });
    rowEl.appendChild(none);
  }

  let current = value;
  const paint = () => {
    const rgba = parseColor(current);
    chip.querySelector("i").style.background = rgba ? toHex(rgba, true) : "transparent";
    chip.classList.toggle("none", !rgba);
  };

  function set(v) {
    current = v;
    paint();
  }

  /** Open the platform colour picker anchored to the chip. */
  function openPicker() {
    const input = h("input", { type: "color", value: toOpaqueHex(parseColor(current)) });
    input.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px";
    document.body.appendChild(input);
    let dirty = false;
    input.addEventListener("input", () => {
      dirty = true;
      set(input.value);
      if (onInput) onInput(input.value, { live: true });
    });
    const finish = () => {
      if (dirty && onCommit) onCommit(current);
      input.remove();
    };
    input.addEventListener("change", finish);
    input.addEventListener("blur", finish);
    input.click();
  }

  chip.addEventListener("click", (evt) => {
    evt.preventDefault();
    openPicker();
  });

  chip.addEventListener("contextmenu", (evt) => {
    evt.preventDefault();
    const rect = chip.getBoundingClientRect();
    const grid = h("div", {
      style:
        "display:grid;grid-template-columns:repeat(6,1fr);gap:5px;padding:6px;width:186px",
    });
    for (const color of DEFAULT_SWATCHES) {
      const b = h("button", { class: "swatch", type: "button", title: color, style: "width:100%;height:20px" });
      b.appendChild(h("i", { style: `background:${color}` }));
      b.addEventListener("click", () => {
        set(color);
        if (onInput) onInput(color, { live: false });
        if (onCommit) onCommit(color);
      });
      grid.appendChild(b);
    }
    menu(
      [
        { header: true, label: label || t("tool.fill") },
        { node: grid },
        { separator: true },
        { label: "…", icon: "palette", onClick: openPicker },
      ],
      { x: rect.left, y: rect.bottom + 6 }
    );
  });

  paint();
  return {
    el: rowEl,
    get value() {
      return current;
    },
    set,
    _sync(v) {
      if (document.activeElement?.closest?.(".menu")) return;
      set(v);
    },
  };
}

/* ---------------------------------------------------------------- select */

export function selectField({ value, options, onChange, title = "" } = {}) {
  const sel = h("select");
  for (const opt of options) {
    sel.appendChild(h("option", { value: String(opt.value), text: opt.label }));
  }
  sel.value = String(value);
  sel.addEventListener("change", () => onChange(sel.value));
  const wrap = h("span", { class: "field" }, [sel]);
  if (title) attachTooltip(wrap, title);
  return {
    el: wrap,
    get value() {
      return sel.value;
    },
    set(v) {
      sel.value = String(v);
    },
    _sync(v) {
      this.set(v);
    },
  };
}

export function toggle({ checked = false, onChange, label = "" } = {}) {
  const btn = h("button", {
    class: `btn sm${checked ? " is-active" : ""}`,
    type: "button",
    text: label,
  });
  btn.setAttribute("aria-pressed", String(checked));
  btn.addEventListener("click", () => {
    const next = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(next));
    btn.classList.toggle("is-active", next);
    onChange(next);
  });
  return {
    el: btn,
    get value() {
      return btn.getAttribute("aria-pressed") === "true";
    },
    set(v) {
      btn.setAttribute("aria-pressed", String(v));
      btn.classList.toggle("is-active", v);
    },
    _sync(v) {
      this.set(v);
    },
  };
}

export function iconButton(name, title, onClick, { shortcut = "", className = "btn icon sm" } = {}) {
  const btn = h("button", { class: className, type: "button", html: icon(name, 13) });
  attachTooltip(btn, title, shortcut);
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

export function textArea({ value = "", rows = 3, onInput, onCommit, placeholder = "" } = {}) {
  const input = h("textarea", { rows: String(rows), placeholder, spellcheck: "false" });
  input.value = value;
  input.addEventListener("input", () => {
    if (onInput) onInput(input.value, { live: true });
  });
  input.addEventListener("blur", () => {
    if (onCommit) onCommit(input.value);
  });
  input.addEventListener("keydown", (evt) => evt.stopPropagation());
  const wrap = h("span", { class: "field" }, [input]);
  wrap.style.height = "auto";
  wrap.style.padding = "5px 7px";
  return {
    el: wrap,
    input,
    get value() {
      return input.value;
    },
    set(v) {
      if (document.activeElement !== input) input.value = v;
    },
    _sync(v) {
      this.set(v);
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}

export function textField({ value = "", onInput, onCommit, placeholder = "" } = {}) {
  const input = h("input", { type: "text", value, spellcheck: "false", placeholder });
  input.addEventListener("input", () => {
    if (onInput) onInput(input.value, { live: true });
  });
  input.addEventListener("change", () => {
    if (onCommit) onCommit(input.value);
  });
  input.addEventListener("blur", () => {
    if (onCommit) onCommit(input.value);
  });
  input.addEventListener("keydown", (evt) => evt.stopPropagation());
  const wrap = h("span", { class: "field" }, [input]);
  return {
    el: wrap,
    input,
    get value() {
      return input.value;
    },
    set(v) {
      if (document.activeElement !== input) input.value = v;
    },
    _sync(v) {
      this.set(v);
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}

/* ---------------------------------------------------------------- misc */

export function keyframeButton({ animated = false, onKey = false, onClick, title = "" } = {}) {
  const btn = h("button", {
    class: `kf-btn${onKey ? " on" : ""}${animated ? " animated" : ""}`,
    type: "button",
    html: icon("diamond", 9),
  });
  attachTooltip(btn, title || t("insp.addKey"), "K");
  btn.addEventListener("click", onClick);
  return {
    el: btn,
    set({ onKey: on, animated: anim }) {
      if (on !== undefined) btn.classList.toggle("on", on);
      if (anim !== undefined) btn.classList.toggle("animated", anim);
    },
  };
}

export function warn(message) {
  toast(message, { kind: "warn" });
}

export { icon, h, menu };
