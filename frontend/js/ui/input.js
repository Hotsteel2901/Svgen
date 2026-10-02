/**
 * Input capture.
 *
 * A browser is a document viewer: its right-click menu, its Ctrl+P/F/S/O
 * shortcuts, its Ctrl+wheel page zoom and its middle-click autoscroll all steal
 * input from an application that lives inside a tab. This module takes that
 * input back for the studio, so a right-click always opens *our* menu and a
 * keyboard shortcut always reaches *our* handler.
 *
 * Scope discipline: everything here only acts when the event originated inside
 * the app shell. Outside it, the browser behaves normally.
 */

import { menu, toast } from "./shell.js";
import { t } from "../i18n/index.js";
import { openCanvasMenu } from "./contextmenu.js";

/**
 * Browser shortcuts we take over. Ctrl+W / Ctrl+T / Ctrl+N are deliberately
 * absent — a page cannot reliably prevent those, and pretending otherwise
 * would be a lie in the docs.
 */
const BLOCKED_COMBOS = new Set([
  "p", // print
  "f", // find
  "g", // find next
  "h", // history
  "j", // downloads
  "u", // view source
  "b", // bookmarks bar — also our brush shortcut, so it must be ours
  "e", // search
  "k", // search
  "d", // bookmark; also duplicate
  "o", // open file (we handle it)
  "s", // save page (we handle it)
]);

const BLOCKED_BARE = new Set(["F3", "F7", "F10"]);

export function installInputCapture(app, shell) {
  const inside = (target) => !!target && shell.contains(target);

  /* ---------------------------------------------------------- right-click */

  // Capture phase: the native menu never appears inside the studio.
  document.addEventListener(
    "contextmenu",
    (evt) => {
      if (!inside(evt.target)) return;
      evt.preventDefault();
      evt.__svgenHandled = false;
    },
    true
  );

  // Bubble phase: whatever did not claim the event gets the app's own menu.
  document.addEventListener("contextmenu", (evt) => {
    if (!inside(evt.target)) return;
    if (evt.__svgenHandled) return;
    openAppMenu(app, evt);
  });

  /* ------------------------------------------------------------- keyboard */

  window.addEventListener(
    "keydown",
    (evt) => {
      const target = evt.target;
      const inApp =
        inside(target) || target === document.body || target === document.documentElement;
      if (!inApp) return;

      if (BLOCKED_BARE.has(evt.key)) {
        evt.preventDefault();
        return;
      }

      if (!(evt.ctrlKey || evt.metaKey) || evt.altKey) return;
      const lower = evt.key.toLowerCase();
      if (!BLOCKED_COMBOS.has(lower)) return;

      // Copy / paste / cut / select-all / save / open must go to a live text
      // field when one has focus — that is the browser doing its job, not
      // stealing input.
      const typing = isTextField(target);
      const clipboardish = lower === "c" || lower === "v" || lower === "x" || lower === "a";
      if (typing && (clipboardish || lower === "s" || lower === "o")) return;

      // Stop the browser's own UI (print, find, history, downloads, bookmarks,
      // view-source). The event still propagates, so the studio's own handler
      // for the same combination runs afterwards.
      evt.preventDefault();
    },
    true
  );

  /* ---------------------------------------------------------------- wheel */

  // Page zoom and horizontal-history swipe are browser features; inside the
  // studio the wheel belongs to the canvas.
  shell.addEventListener(
    "wheel",
    (evt) => {
      if (evt.ctrlKey) evt.preventDefault();
    },
    { passive: false, capture: true }
  );

  /* ------------------------------------------------------- middle click */

  // Middle-click autoscroll would fight the stage's pan gesture.
  shell.addEventListener("mousedown", (evt) => {
    if (evt.button === 1) evt.preventDefault();
  });
  shell.addEventListener("auxclick", (evt) => {
    if (evt.button === 1) evt.preventDefault();
  });

  /* ------------------------------------------------------ drag and drop */

  // Dropping an image or a link should import it, never navigate away.
  window.addEventListener("dragover", (evt) => {
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragstart", (evt) => {
    if (inside(evt.target) && !evt.target.closest("[draggable='true']")) evt.preventDefault();
  });

  /* ------------------------------------------------------------ gestures */

  for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(name, (evt) => {
      if (inside(evt.target)) evt.preventDefault();
    });
  }

  /* ---------------------------------------------------------------- focus */

  // Buttons keep focus after a click, which makes the arrow keys move focus
  // instead of nudging the selection. Hand focus back to the shell.
  shell.addEventListener("click", (evt) => {
    const el = evt.target.closest("button");
    if (el && !el.dataset.keepFocus) el.blur();
  });

  // The shell itself is the keyboard target, so tools work without clicking
  // the canvas first.
  shell.setAttribute("tabindex", "-1");
  shell.addEventListener("pointerdown", (evt) => {
    if (!isTextField(evt.target)) {
      const active = document.activeElement;
      if (active && active !== shell && isTextField(active)) active.blur();
    }
  });

  return {
    focusShell: () => shell.focus({ preventScroll: true }),
  };
}

/* ---------------------------------------------------------------- menus */

function isTextField(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

function openAppMenu(app, evt) {
  const target = evt.target;

  if (target.closest("#stage-host")) {
    const rect = app.stage.host.getBoundingClientRect();
    const sceneX = (evt.clientX - rect.left - app.stage.view.panX) / app.stage.view.zoom;
    const sceneY = (evt.clientY - rect.top - app.stage.view.panY) / app.stage.view.zoom;
    openCanvasMenu(app, evt, { sceneX, sceneY }, { hit: app.tools?.hit({ sceneX, sceneY }) || null });
    return;
  }

  if (isTextField(target)) {
    openTextFieldMenu(target, evt);
    return;
  }

  openSurfaceMenu(app, evt);
}

/** Cut / copy / paste for a focused field, without the browser's menu. */
function openTextFieldMenu(field, evt) {
  const canEdit = !field.disabled && !field.readOnly;
  const selection = field.value !== undefined
    ? field.value.substring(field.selectionStart ?? 0, field.selectionEnd ?? 0)
    : "";

  const run = (command) => {
    field.focus();
    try {
      document.execCommand(command);
    } catch {
      /* the field may be read-only */
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      insertIntoField(field, text);
    } catch {
      toast(t("ctx.clipboardBlocked"), { kind: "warn" });
    }
  };

  menu(
    [
      { label: t("ctx.cut"), icon: "scissors", disabled: !canEdit || !selection, onClick: () => run("cut") },
      { label: t("ctx.copy"), icon: "copy", disabled: !selection, onClick: () => run("copy") },
      { label: t("ctx.paste"), icon: "file", disabled: !canEdit, onClick: paste },
      { separator: true },
      { label: t("ctx.selectAll"), icon: "group", onClick: () => run("selectAll") },
      {
        label: t("ctx.clear"),
        icon: "trash",
        danger: true,
        disabled: !canEdit || !field.value,
        onClick: () => {
          field.focus();
          field.select();
          document.execCommand("delete");
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
        },
      },
    ],
    { x: evt.clientX, y: evt.clientY }
  );
}

function insertIntoField(field, text) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  field.focus();
  const next = field.value.slice(0, start) + text + field.value.slice(end);
  field.value = next;
  const pos = start + text.length;
  field.setSelectionRange?.(pos, pos);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * The generic menu for panels that do not have a more specific one — the dock,
 * the timeline background, the rail.
 */
function openSurfaceMenu(app, evt) {
  const doc = app.scene.doc;
  menu(
    [
      { header: true, label: t("ctx.app") },
      { label: t("edit.undo"), icon: "undo", shortcut: "Ctrl+Z", disabled: !app.history.canUndo, onClick: () => app.undo() },
      { label: t("edit.redo"), icon: "redo", shortcut: "Ctrl+Shift+Z", disabled: !app.history.canRedo, onClick: () => app.redo() },
      { separator: true },
      { label: t("edit.copy"), icon: "copy", shortcut: "Ctrl+C", disabled: !doc.selection.length, onClick: () => app.copySelection() },
      { label: t("edit.paste"), icon: "file", shortcut: "Ctrl+V", disabled: !app.hasClipboard(), onClick: () => app.paste() },
      { label: t("edit.duplicate"), icon: "duplicate", shortcut: "Ctrl+D", disabled: !doc.selection.length, onClick: () => app.duplicateSelection() },
      { label: t("edit.delete"), icon: "trash", shortcut: "Del", danger: true, disabled: !doc.selection.length, onClick: () => app.deleteSelection() },
      { separator: true },
      { label: t("edit.selectAll"), icon: "group", shortcut: "Ctrl+A", onClick: () => app.selectAll() },
      { label: t("edit.deselect"), icon: "x", disabled: !doc.selection.length, onClick: () => app.scene.clearSelection() },
      { separator: true },
      { label: t("view.zoomFit"), icon: "fit", shortcut: "Shift+1", onClick: () => app.stage.fit() },
      { label: t("view.grid"), icon: "grid", checked: !!doc.showGrid, onClick: () => app.toggleGrid() },
      { label: t("view.onion"), icon: "onion", checked: !!doc.onion, onClick: () => {
        app.scene.mutate("onion", (d) => {
          d.onion = !d.onion;
        });
        app.requestRender();
        app.timeline?.refresh();
      } },
      { separator: true },
      { label: t("about.shortcuts"), icon: "help", shortcut: "?", onClick: () => app.openDock("about") },
    ],
    { x: evt.clientX, y: evt.clientY }
  );
}

export { closeMenu } from "./shell.js";
