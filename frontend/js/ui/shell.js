/**
 * Shell services: toasts, modals, context menus, tooltips, theme.
 * Every one of these is self-cleaning — no listener is left attached to
 * `document` after the thing it belongs to is gone.
 */

import { icon } from "./icons.js";
import { t } from "../i18n/index.js";
import { escapeXML, uid } from "../core/util.js";

/* ---------------------------------------------------------------- theme */

export const theme = {
  current: "dark",

  /** Dark by default — it is a drawing studio, not a document reader. The
   *  choice is remembered; the system preference is only a hint. */
  init() {
    const stored = safeGet("svgen.theme");
    this.current = stored === "light" ? "light" : "dark";
    this.apply();
    return this.current;
  },

  apply() {
    document.documentElement.setAttribute("data-theme", this.current);
  },

  set(next) {
    this.current = next === "light" ? "light" : "dark";
    safeSet("svgen.theme", this.current);
    this.apply();
    return this.current;
  },

  toggle() {
    return this.set(this.current === "dark" ? "light" : "dark");
  },
};

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- toasts */

const TOAST_ICON = { info: "info", ok: "check", err: "warning", warn: "warning" };

export function toast(message, { kind = "info", title = "", timeout = 4200 } = {}) {
  let host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "err" ? "alert" : "status");
  el.innerHTML =
    icon(TOAST_ICON[kind] || "info", 15) +
    `<div class="txt">${title ? `<b>${escapeXML(title)}</b>` : ""}<span>${escapeXML(message)}</span></div>` +
    `<button class="close" aria-label="${escapeXML(t("dlg.ok"))}">${icon("x", 12)}</button>`;
  host.appendChild(el);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector(".close").addEventListener("click", dismiss);
  if (timeout > 0) setTimeout(dismiss, timeout);

  // Newest on top, and never more than five.
  while (host.children.length > 5) host.firstElementChild.remove();
  return dismiss;
}

/* ---------------------------------------------------------------- modal */

/**
 * Show a modal built from `body` (an HTML string or an element).
 * Returns a promise resolving to the value passed to `close`, or null.
 */
export function modal({ title, body, actions, wide = false, onMount } = {}) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    const dialog = document.createElement("div");
    dialog.className = "modal" + (wide ? " wide" : "");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", title || "dialog");

    const bodyHtml = typeof body === "string" ? body : "";
    dialog.innerHTML =
      `<div class="modal-head"><h2>${escapeXML(title || "")}</h2>` +
      `<button class="btn icon" data-close aria-label="${escapeXML(t("dlg.cancel"))}">${icon("x", 15)}</button></div>` +
      `<div class="modal-body">${bodyHtml}</div>` +
      (actions === null ? "" : '<div class="modal-foot"></div>');

    if (typeof body !== "string" && body instanceof Node) {
      dialog.querySelector(".modal-body").appendChild(body);
    }

    const foot = dialog.querySelector(".modal-foot");
    const buttons = actions || [
      { label: t("dlg.cancel"), value: null, variant: "outline" },
      { label: t("dlg.confirm"), value: true, variant: "brand" },
    ];
    if (foot) {
      for (const action of buttons) {
        const btn = document.createElement("button");
        btn.className = `btn tall ${action.variant || "outline"}`;
        btn.textContent = action.label;
        btn.addEventListener("click", () => close(action.value));
        foot.appendChild(btn);
      }
    }

    scrim.appendChild(dialog);
    document.body.appendChild(scrim);

    let closed = false;
    function close(value) {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      scrim.remove();
      resolve(value);
    }

    function onKey(evt) {
      if (evt.key === "Escape") {
        evt.preventDefault();
        close(null);
      } else if (evt.key === "Enter" && evt.target.tagName !== "TEXTAREA") {
        const primary = actions ? actions[actions.length - 1].value : true;
        evt.preventDefault();
        close(primary);
      }
    }

    scrim.addEventListener("pointerdown", (evt) => {
      if (evt.target === scrim) close(null);
    });
    dialog.querySelector("[data-close]").addEventListener("click", () => close(null));
    document.addEventListener("keydown", onKey, true);

    const focusTarget = dialog.querySelector("[data-autofocus]") || dialog.querySelector("button, input, textarea");
    if (focusTarget) setTimeout(() => focusTarget.focus(), 30);
    if (onMount) onMount(dialog);
  });
}

export function confirmDialog({ title, body, danger = false, confirmLabel } = {}) {
  return modal({
    title,
    body: `<p class="info-block">${escapeXML(body || "")}</p>`,
    actions: [
      { label: t("dlg.cancel"), value: false, variant: "outline" },
      { label: confirmLabel || t("dlg.confirm"), value: true, variant: danger ? "solid" : "brand" },
    ],
  }).then((v) => v === true);
}

export function promptDialog({ title, label, value = "", multiline = false } = {}) {
  let captured = value;
  const field = multiline
    ? `<textarea rows="3" data-autofocus>${escapeXML(value)}</textarea>`
    : `<input type="text" data-autofocus value="${escapeXML(value)}">`;
  return modal({
    title,
    body: `<label class="pair"><span>${escapeXML(label || "")}</span><span class="field">${field}</span></label>`,
    actions: [
      { label: t("dlg.cancel"), value: null, variant: "outline" },
      { label: t("dlg.ok"), value: "__ok__", variant: "brand" },
    ],
    onMount: (dialog) => {
      const input = dialog.querySelector("[data-autofocus]");
      input.focus();
      input.select();
      input.addEventListener("input", () => {
        captured = input.value;
      });
    },
  }).then((result) => (result === "__ok__" ? captured : null));
}

/* ---------------------------------------------------------------- menu */

let openMenu = null;

/**
 * items: [{ label, icon, shortcut, onClick, disabled, danger }] or
 *        { separator: true } or { label, header: true }
 */
export function menu(items, { x, y, align = "left" } = {}) {
  closeMenu();
  const el = document.createElement("div");
  el.className = "menu";
  el.setAttribute("role", "menu");

  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      el.appendChild(Object.assign(document.createElement("div"), { className: "menu-sep" }));
      continue;
    }
    if (item.header) {
      const h = document.createElement("div");
      h.className = "menu-label";
      h.textContent = item.label;
      el.appendChild(h);
      continue;
    }
    if (item.node) {
      el.appendChild(item.node);
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "menu-item" + (item.danger ? " danger" : "");
    btn.setAttribute("role", "menuitem");
    btn.disabled = !!item.disabled;
    btn.innerHTML =
      (item.icon ? icon(item.icon, 14) : "<span style='width:14px'></span>") +
      `<span>${escapeXML(item.label)}</span>` +
      (item.shortcut ? `<span class="k">${escapeXML(item.shortcut)}</span>` : "");
    btn.addEventListener("click", () => {
      closeMenu();
      if (item.onClick) item.onClick();
    });
    el.appendChild(btn);
  }

  document.body.appendChild(el);
  const rect = el.getBoundingClientRect();
  const px = align === "right" ? x - rect.width : x;
  el.style.left = `${Math.max(6, Math.min(px, window.innerWidth - rect.width - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, window.innerHeight - rect.height - 6))}px`;

  const onDown = (evt) => {
    if (!el.contains(evt.target)) closeMenu();
  };
  const onKey = (evt) => {
    if (evt.key === "Escape") closeMenu();
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);

  openMenu = {
    el,
    close() {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      el.remove();
    },
  };
  return openMenu;
}

export function closeMenu() {
  if (openMenu) {
    openMenu.close();
    openMenu = null;
  }
}

/* ---------------------------------------------------------------- tooltip */

let tipEl = null;
let tipTimer = 0;

export function attachTooltip(el, text, shortcut) {
  if (!text) return;
  const show = () => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      hideTooltip();
      tipEl = document.createElement("div");
      tipEl.className = "tip";
      tipEl.innerHTML = escapeXML(text) + (shortcut ? `<span class="k">${escapeXML(shortcut)}</span>` : "");
      document.body.appendChild(tipEl);
      const r = el.getBoundingClientRect();
      const tr = tipEl.getBoundingClientRect();
      let left = r.left + r.width / 2 - tr.width / 2;
      let top = r.bottom + 7;
      if (top + tr.height > window.innerHeight - 4) top = r.top - tr.height - 7;
      left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
      tipEl.style.left = `${left}px`;
      tipEl.style.top = `${top}px`;
    }, 420);
  };
  el.addEventListener("pointerenter", show);
  el.addEventListener("pointerleave", hideTooltip);
  el.addEventListener("pointerdown", hideTooltip);
  el.addEventListener("blur", hideTooltip);
}

export function hideTooltip() {
  clearTimeout(tipTimer);
  if (tipEl) {
    tipEl.remove();
    tipEl = null;
  }
}

/* ---------------------------------------------------------------- misc */

/** A small helper for building DOM without a framework. */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else if (key === "html") el.innerHTML = value;
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined && value !== false) {
      el.setAttribute(key, value === true ? "" : value);
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const uidDom = uid;

/** Copy text, with a graceful message when the clipboard is blocked. */
export async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage || t("st.copied"), { kind: "ok", timeout: 2200 });
    return true;
  } catch {
    toast(t("st.copyFailed"), { kind: "warn" });
    return false;
  }
}

export { icon };
