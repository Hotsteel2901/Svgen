/**
 * Colour picker.
 *
 * The browser's own `<input type="color">` is invisible, inconsistent across
 * platforms and impossible to style, and handing the user a list of hex strings
 * is not a colour picker at all. This is the app's own: a saturation/value
 * square, a hue strip, an alpha slider, a hex field and a swatch grid — all
 * rendered with plain CSS gradients, so every colour is visible before you pick
 * it.
 */

import { h, closeMenu } from "./shell.js";
import { icon } from "./icons.js";
import { t } from "../i18n/index.js";
import { parseColor, toHex } from "../core/color.js";

const RECENT_LIMIT = 12;
let recents = [];

/** HSV (0-360, 0-1, 0-1) → RGB 0-255. */
function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** RGB 0-255 + alpha → HSV. */
function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === rn) hue = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) hue = 60 * ((bn - rn) / d + 2);
    else hue = 60 * ((rn - gn) / d + 4);
  }
  return [((hue % 360) + 360) % 360, max === 0 ? 0 : d / max, max];
}

const PRESETS = [
  "#0a0b0d", "#16181c", "#24282e", "#3a3f47", "#6d7686", "#a3abba",
  "#c6cdd9", "#edeff3", "#ffffff", "#cbff4d", "#58d68d", "#0ea5e9",
  "#6fc7ff", "#b79cff", "#7c3aed", "#ff7ab8", "#ff5f6d", "#ff8a5b",
  "#ffcf5c", "#f59e0b", "#8b5a2b", "#d6b98c", "#1d4ed8", "#065f46",
];

let openPopover = null;

export function closeColorPopover() {
  if (openPopover) {
    openPopover.close();
    openPopover = null;
  }
}

/**
 * @param {object} opts
 *   anchor   — the element to sit next to
 *   value    — current colour ("#rrggbb", "#rrggbbaa" or null)
 *   allowNone— show the "transparent" action
 *   title    — heading
 *   onInput  — (colour|null) => void, called continuously
 *   onCommit — (colour|null) => void, called when the popover closes
 */
export function openColorPopover({ anchor, value, allowNone = true, title = "", label = "", onInput, onCommit }) {
  closeMenu();
  closeColorPopover();

  const start = parseColor(value) || [203, 255, 77, 1];
  const [r0, g0, b0] = start;
  let [hue, sat, val] = rgbToHsv(r0, g0, b0);
  if (val === 0) val = 1;
  let alpha = start[3] === undefined ? 1 : start[3];
  let current = value;

  /* ------------------------------------------------------------- pieces */

  const swatchSquare = h("div", {
    class: "cp-square",
    style: `background:
      linear-gradient(to top, #000, rgba(0,0,0,0)),
      linear-gradient(to right, #fff, hsl(${Math.round(hue)} 100% 50%))`,
  });
  const squareCursor = h("i", { class: "cp-cursor" });
  swatchSquare.appendChild(squareCursor);

  const hueStrip = h("div", { class: "cp-hue" });
  const hueCursor = h("i", { class: "cp-cursor cp-bar-cursor" });
  hueStrip.appendChild(hueCursor);

  const alphaStrip = h("div", { class: "cp-alpha" });
  const alphaCursor = h("i", { class: "cp-cursor cp-bar-cursor" });
  alphaStrip.appendChild(alphaCursor);

  const preview = h("span", { class: "cp-preview" }, [h("i")]);
  const hexInput = h("input", {
    type: "text",
    spellcheck: "false",
    class: "cp-hex",
    maxlength: "9",
  });
  hexInput.addEventListener("keydown", (evt) => evt.stopPropagation());
  hexInput.addEventListener("change", () => {
    const parsed = parseColor(hexInput.value);
    if (!parsed) {
      syncControls();
      return;
    }
    [hue, sat, val] = rgbToHsv(parsed[0], parsed[1], parsed[2]);
    alpha = parsed[3];
    emit(true);
  });

  const grid = h("div", { class: "cp-grid" });
  for (const color of PRESETS) {
    const b = h("button", { class: "cp-swatch", type: "button", title: color, style: `background:${color}` });
    b.addEventListener("click", () => {
      const parsed = parseColor(color);
      [hue, sat, val] = rgbToHsv(parsed[0], parsed[1], parsed[2]);
      alpha = 1;
      emit(true);
    });
    grid.appendChild(b);
  }

  const recentGrid = h("div", { class: "cp-grid" });

  const panel = h("div", { class: "cp-panel" });
  panel.append(
    h("div", { class: "cp-head" }, [
      h("span", { class: "cp-title", text: title || t("color.title") }),
      (() => {
        const btn = h("button", { class: "btn icon sm", type: "button", html: icon("x", 12) });
        btn.addEventListener("click", close);
        return btn;
      })(),
    ])
  );

  const body = h("div", { class: "cp-body" });
  body.append(
    swatchSquare,
    h("div", { class: "cp-rows" }, [hueStrip, alphaStrip]),
    h("div", { class: "cp-fields" }, [preview, hexInput])
  );

  const presetsLabel = h("div", { class: "micro", text: t("color.presets") });
  body.append(presetsLabel, grid);
  const recentLabel = h("div", { class: "micro", text: t("color.recent") });
  body.append(recentLabel, recentGrid);

  const actions = h("div", { class: "cp-actions" });
  if (allowNone) {
    const none = h("button", { class: "btn outline", type: "button", text: t("doc.fillNone") });
    none.addEventListener("click", () => {
      current = null;
      commit(null);
    });
    actions.appendChild(none);
  }
  const done = h("button", { class: "btn brand", type: "button", text: t("dlg.ok") });
  done.addEventListener("click", () => commit(current));
  actions.appendChild(done);
  body.appendChild(actions);

  panel.appendChild(body);
  document.body.appendChild(panel);

  /* ------------------------------------------------------------ geometry */

  const rect = anchor.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  let left = rect.right + 10;
  if (left + pr.width > window.innerWidth - 8) left = Math.max(8, rect.left - pr.width - 10);
  let top = rect.top;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - pr.height - 8);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  /* -------------------------------------------------------------- state */

  function currentHex() {
    const [r, g, b] = hsvToRgb(hue, sat, val);
    return toHex([r, g, b, alpha], true);
  }

  function syncControls() {
    const [r, g, b] = hsvToRgb(hue, sat, val);
    swatchSquare.style.background =
      `linear-gradient(to top, #000, rgba(0,0,0,0)), ` +
      `linear-gradient(to right, #fff, hsl(${Math.round(hue)} 100% 50%))`;
    squareCursor.style.left = `${sat * 100}%`;
    squareCursor.style.top = `${(1 - val) * 100}%`;
    hueCursor.style.left = `${(hue / 360) * 100}%`;
    alphaCursor.style.left = `${alpha * 100}%`;
    alphaStrip.style.setProperty("--cp-hue", `hsl(${Math.round(hue)} 100% 50%)`);
    const hex = toHex([r, g, b, 1], false);
    if (document.activeElement !== hexInput) hexInput.value = hex;
    const rgba = `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`;
    preview.querySelector("i").style.background = rgba;
    preview.classList.toggle("none", alpha === 0);
  }

  function emit(live) {
    current = alpha >= 1 ? toHex(hsvToRgb(hue, sat, val), false) : currentHex();
    syncControls();
    if (onInput) onInput(alpha >= 1 ? current : `rgba(${hsvToRgb(hue, sat, val).join(",")},${alpha})`);
    if (live) renderRecents();
  }

  function renderRecents() {
    recentGrid.innerHTML = "";
    for (const color of recents.slice(0, RECENT_LIMIT)) {
      const b = h("button", { class: "cp-swatch", type: "button", title: color, style: `background:${color}` });
      b.addEventListener("click", () => {
        const parsed = parseColor(color);
        if (!parsed) return;
        [hue, sat, val] = rgbToHsv(parsed[0], parsed[1], parsed[2]);
        alpha = parsed[3];
        emit(true);
      });
      recentGrid.appendChild(b);
    }
    if (!recents.length) {
      recentGrid.appendChild(h("span", { class: "cp-empty", text: t("color.none") }));
    }
  }

  function remember(color) {
    if (!color) return;
    recents = [color, ...recents.filter((c) => c !== color)].slice(0, RECENT_LIMIT);
  }

  function commit(color) {
    remember(color);
    if (onInput) onInput(color);
    if (onCommit) onCommit(color);
    close();
  }

  /* ------------------------------------------------------------- pointer */

  function dragStrip(el, onMove) {
    el.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      el.setPointerCapture?.(evt.pointerId);
      const apply = (e) => {
        const r = el.getBoundingClientRect();
        onMove((e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height));
      };
      apply(evt);
      const move = (e) => apply(e);
      const up = (e) => {
        el.releasePointerCapture?.(e.pointerId);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }

  dragStrip(swatchSquare, (x, y) => {
    sat = Math.min(1, Math.max(0, x));
    val = Math.min(1, Math.max(0, 1 - y));
    emit(true);
  });
  dragStrip(hueStrip, (x) => {
    hue = Math.min(359.9, Math.max(0, x * 360));
    emit(true);
  });
  dragStrip(alphaStrip, (x) => {
    alpha = Math.min(1, Math.max(0, x));
    emit(true);
  });

  /* --------------------------------------------------------------- close */

  const onOutside = (evt) => {
    if (panel.contains(evt.target)) return;
    if (anchor.contains?.(evt.target)) return;
    commit(current);
  };
  const onKey = (evt) => {
    evt.stopPropagation();
    if (evt.key === "Escape") {
      evt.preventDefault();
      close();
    }
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside, true);
    panel.addEventListener("keydown", onKey, true);
  }, 0);

  function close() {
    document.removeEventListener("pointerdown", onOutside, true);
    panel.removeEventListener("keydown", onKey, true);
    panel.remove();
    if (openPopover === handle) openPopover = null;
  }

  syncControls();
  renderRecents();

  const handle = { panel, close, get value() { return current; } };
  openPopover = handle;
  return handle;
}
