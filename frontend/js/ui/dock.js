/** Right dock: tab host for the inspector, layers, export and about panes. */

import { h } from "./shell.js";
import { icon } from "./icons.js";
import { t } from "../i18n/index.js";
import { Inspector } from "./inspector.js";
import { LayersPane } from "./layers.js";
import { ExportPane } from "./exportpane.js";
import { InfoPane } from "./infopane.js";

const TABS = [
  { id: "inspector", icon: "sliders", label: "dock.inspector", Pane: Inspector },
  { id: "layers", icon: "layers", label: "dock.layers", Pane: LayersPane },
  { id: "export", icon: "download", label: "dock.export", Pane: ExportPane },
  { id: "about", icon: "info", label: "dock.about", Pane: InfoPane },
];

export class Dock {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.tab = "inspector";
    this.panes = new Map();
    this.render();
  }

  render() {
    this.root.innerHTML = "";
    if (!TABS.some((tab) => tab.id === this.tab)) this.tab = TABS[0].id;
    const tabsEl = h("div", { class: "dock-tabs", role: "tablist" });
    this.tabButtons = new Map();

    for (const tab of TABS) {
      const btn = h("button", {
        class: "dock-tab",
        type: "button",
        role: "tab",
        dataset: { tab: tab.id },
        "aria-selected": String(this.tab === tab.id),
      }, [h("span", { html: icon(tab.icon, 14) }), h("span", { text: t(tab.label) })]);
      btn.addEventListener("click", () => this.open(tab.id));
      tabsEl.appendChild(btn);
      this.tabButtons.set(tab.id, btn);
    }

    this.body = h("div", { class: "dock-body" });
    this.root.append(tabsEl, this.body);
    this.mount(this.tab);
  }

  open(id) {
    if (!TABS.some((tab) => tab.id === id)) return;
    for (const [key, btn] of this.tabButtons) {
      btn.setAttribute("aria-selected", String(key === id));
    }
    if (this.tab === id && this.panes.has(id)) return;
    this.tab = id;
    this.mount(id);
  }

  mount(id) {
    const def = TABS.find((tab) => tab.id === id);
    this.body.innerHTML = "";
    let pane = this.panes.get(id);
    if (!pane) {
      pane = new def.Pane(this.app, this.body);
      this.panes.set(id, pane);
    } else {
      this.body.appendChild(pane.el);
      pane.refresh?.();
    }
  }

  refresh() {
    const pane = this.panes.get(this.tab);
    pane?.refresh?.();
  }

  refreshTab(id) {
    this.panes.get(id)?.refresh?.();
  }

  rebuild() {
    const current = this.tab;
    this.panes.clear();
    this.tab = null;
    this.render();
    this.open(current);
  }
}
