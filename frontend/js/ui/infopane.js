/** About pane: version, backend status, the font notice, and the shortcut list. */

import { h } from "./shell.js";
import { icon } from "./icons.js";
import { t, LANGS, lang, setLang } from "../i18n/index.js";
import { section, selectField, row } from "./controls.js";
import { api } from "../net/api.js";
import { SCENE_VERSION } from "../core/scene.js";

const SHORTCUTS = [
  ["help.tools", [
    ["V", "tool.select"], ["P", "tool.pen"], ["B", "tool.path"], ["T", "tool.text"],
    ["R", "tool.rect"], ["U", "tool.rounded"], ["O", "tool.ellipse"], ["L", "tool.line"],
    ["A", "tool.arrow"], ["G", "tool.polygon"], ["S", "tool.star"], ["H", "tool.hand"],
    ["I", "tool.eyedropper"], ["X", "tool.swapColors"],
  ]],
  ["help.editing", [
    ["Ctrl+Z", "edit.undo"], ["Ctrl+Shift+Z", "edit.redo"], ["Ctrl+D", "edit.duplicate"],
    ["Del", "edit.delete"], ["Ctrl+A", "edit.selectAll"], ["K", "insp.addKey"],
    ["Ctrl+S", "file.save"], ["Ctrl+O", "file.open"],
  ]],
  ["help.playback", [
    ["Space", "tl.play"], ["Home", "tl.toStart"], ["End", "tl.toEnd"],
    ["[", "tl.prevKey"], ["]", "tl.nextKey"],
  ]],
  ["help.view", [
    ["Shift+1", "view.zoomFit"], ["Ctrl+0", "view.zoom100"],
    ["Ctrl+'", "view.grid"], ["Ctrl+Shift+O", "view.onion"],
  ]],
];

const MOUSE = [
  ["help.pan", "Middle drag · Space drag"],
  ["help.zoom", "Ctrl + wheel"],
  ["help.marquee", "Drag on empty canvas"],
  ["help.multi", "Shift + click"],
  ["help.constrain", "Shift while drawing"],
  ["help.fromCenter", "Alt while drawing"],
  ["help.nudge", "Arrow keys"],
  ["help.nudgeBig", "Shift + arrows"],
];

export class InfoPane {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.el = h("div", { class: "pane" });
    root.appendChild(this.el);
    this.build();
  }

  build() {
    this.el.innerHTML = "";

    /* about */
    const about = section(t("dock.about"));
    about.body.appendChild(
      h("div", { class: "info-block" }, [
        h("div", { html: `<b>${t("app.name")} ${t("app.tagline")}</b>` }),
        h("div", { text: `${t("about.version")} 2.0 · scene v${SCENE_VERSION}` }),
      ])
    );

    const langField = selectField({
      value: lang(),
      options: LANGS.map((l) => ({ value: l.id, label: l.label })),
      onChange: (v) => {
        setLang(v);
        this.app.rebuildUI();
      },
    });
    about.body.appendChild(row(t("about.language"), [langField.el]));
    this.el.appendChild(about.el);

    /* backend */
    const backend = section(t("about.backend"));
    this.backendBox = h("div", { class: "info-block" }, [h("div", { text: "…" })]);
    backend.body.appendChild(this.backendBox);
    this.el.appendChild(backend.el);
    this.loadBackend();

    /* fonts (license compliance) */
    const fonts = section(t("about.fonts"));
    fonts.body.appendChild(h("div", { class: "info-block", text: t("about.fontNotice") }));
    fonts.body.appendChild(h("div", { class: "info-block" }, [h("b", { text: t("about.fontShort") })]));
    fonts.body.appendChild(h("div", { class: "info-block", text: t("about.trademark") }));
    this.el.appendChild(fonts.el);

    /* storage */
    const storage = section(t("about.storage"));
    storage.body.appendChild(h("div", { class: "info-block", text: t("about.storageNote") }));
    const clear = h("button", { class: "btn outline block", type: "button", text: t("about.clearStorage"), style: "margin-top:8px" });
    clear.addEventListener("click", () => {
      this.app.clearAutosave();
      this.app.toastMessage(t("about.cleared"), "ok");
    });
    storage.body.appendChild(clear);
    this.el.appendChild(storage.el);

    /* shortcuts */
    const keys = section(t("about.shortcuts"));
    for (const [groupKey, list] of SHORTCUTS) {
      keys.body.appendChild(h("div", { class: "micro", text: t(groupKey), style: "margin:8px 0 4px" }));
      const table = h("table", { class: "shortcut-table" });
      for (const [key, label] of list) {
        table.appendChild(
          h("tr", {}, [h("td", {}, [h("kbd", { text: key })]), h("td", { text: t(label) })])
        );
      }
      keys.body.appendChild(table);
    }
    keys.body.appendChild(h("div", { class: "micro", text: t("about.mouse"), style: "margin:12px 0 4px" }));
    const mtable = h("table", { class: "shortcut-table" });
    for (const [label, gesture] of MOUSE) {
      mtable.appendChild(h("tr", {}, [h("td", { text: t(label) }), h("td", {}, [h("kbd", { text: gesture })])]));
    }
    keys.body.appendChild(mtable);
    this.el.appendChild(keys.el);
  }

  async loadBackend() {
    try {
      const info = await api.info({ refresh: true });
      const caps = info.capabilities || {};
      const engines = info.engines || {};
      this.backendBox.innerHTML = "";
      const video = Object.entries(engines.formats?.video || {})
        .map(([k, v]) => `${k.toUpperCase()}${v ? "" : ` (${t("about.notAvailable")})`}`)
        .join(" · ");
      const lines = [
        [t("st.online"), `${info.os} · ${info.arch} · Python ${info.python}`],
        [t("about.chain"), (engines.chain || []).join(" → ") || "—"],
        [t("about.formats"), (info.formats?.still || []).join(" · ")],
        [t("about.videoFormats"), video],
        [t("about.ffmpeg"), caps.ffmpeg ? "✓" : t("about.notAvailable")],
      ];
      for (const [label, value] of lines) {
        this.backendBox.appendChild(
          h("div", { class: "row" }, [
            h("span", { html: icon("check", 12), class: "ok" }),
            h("span", { text: label }),
            h("span", { class: "grow" }),
            h("span", { text: value, style: "color:var(--text-dim);text-align:right" }),
          ])
        );
      }
    } catch {
      this.backendBox.innerHTML = "";
      this.backendBox.appendChild(
        h("div", { class: "row" }, [
          h("span", { html: icon("warning", 12), class: "no" }),
          h("span", { text: t("exp.offlineHint") }),
        ])
      );
    }
  }

  refresh() {
    this.loadBackend();
  }
}
