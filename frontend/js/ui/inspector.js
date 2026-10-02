/**
 * Inspector: geometry, appearance, text, animation and arrange controls for the
 * current selection (one element or many).
 *
 * The pane builds its DOM once per *shape* of selection and then only `_sync`s
 * values, so dragging a slider or typing in a field never loses focus.
 */

import {
  section,
  row,
  numberField,
  slider,
  colorField,
  selectField,
  toggle,
  textArea,
  textField,
  keyframeButton,
  iconButton,
} from "./controls.js";
import { h, attachTooltip, menu } from "./shell.js";
import { icon } from "./icons.js";
import { t } from "../i18n/index.js";
import { ANIMATABLE, FONT_FAMILIES, measureText, FONT_STACK } from "../core/elements.js";
import { keyAt, isAnimated } from "../core/anim.js";
import { clamp } from "../core/util.js";

export class Inspector {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.el = h("div", { class: "pane" });
    root.appendChild(this.el);
    this.controls = {};
    this.signature = "";
    this.build();
    app.on("selection", () => this.refresh());
    app.on("change", () => this.refresh());
    app.on("time", () => this.syncTimeDependent());
  }

  get scene() {
    return this.app.scene;
  }

  get doc() {
    return this.scene.doc;
  }

  selected() {
    return this.scene.selectedElements();
  }

  refresh() {
    const sel = this.selected();
    const sig = sel.length === 0 ? "empty" : sel.length > 1 ? "multi" : shapeSignature(sel[0]);
    if (sig !== this.signature) {
      this.signature = sig;
      this.build();
    } else {
      this.sync();
    }
  }

  /* ------------------------------------------------------------ build */

  build() {
    this.el.innerHTML = "";
    this.controls = {};
    const sel = this.selected();

    if (!sel.length) {
      this.el.appendChild(
        h("div", { class: "empty" }, [
          h("span", { html: icon("cursor", 26) }),
          h("div", { text: t("insp.empty") }),
          h("div", { text: t("insp.emptyHint") }),
        ])
      );
      return;
    }

    if (sel.length > 1) {
      this.el.appendChild(
        h("div", { class: "empty" }, [
          h("div", { text: t("insp.multi", { n: sel.length }) }),
          h("div", { text: t("insp.multiHint") }),
        ])
      );
    } else {
      this._buildName(sel[0]);
    }

    this._buildTransform();
    this._buildAppearance();
    if (sel.length === 1 && sel[0].type === "text") this._buildText(sel[0]);
    if (sel.length === 1 && (sel[0].type === "polygon" || sel[0].type === "star")) this._buildShape(sel[0]);
    if (sel.length === 1 && sel[0].type === "path") this._buildPath(sel[0]);
    this._buildArrange();
    if (sel.length === 1) this._buildAnimation(sel[0]);

    this.sync();
  }

  _apply(patch, label = "prop", { live = false } = {}) {
    this.scene.update(patch, { label, live });
    this.app.requestRender();
    if (!live) this.app.markDirty();
  }

  _commit(label = "prop") {
    this.scene.commit(label);
    this.app.markDirty();
    this.app.timeline?.refresh();
  }

  _buildName(el) {
    const { el: sec, body } = section(t("insp.shape"));
    const badge = h("span", { class: "type-badge", html: icon(typeIcon(el.type), 14) });
    const name = textField({
      value: el.name || el.type,
      onCommit: (v) => {
        this.scene.updateElement(el.id, { name: v }, { label: "rename" });
        this.app.markDirty();
      },
    });
    body.appendChild(
      h("div", { class: "insp-name" }, [
        badge,
        name.el,
        iconButton("copy", t("edit.duplicate"), () => this.app.duplicateSelection()),
      ])
    );
    this.controls.name = name;
    this.el.appendChild(sec);
  }

  _buildTransform() {
    const { el: sec, body } = section(t("insp.transform"));
    const multi = this.selected().length > 1;

    if (!multi) {
      const p = this._numRow(t("insp.x"), "x", { step: 1 });
      const q = this._numRow(t("insp.y"), "y", { step: 1 });
      body.appendChild(h("div", { class: "grid2" }, [p.wrap, q.wrap]));
      const w = this._numRow(t("insp.w"), "w", { step: 1, min: 0.5 });
      const hh = this._numRow(t("insp.h"), "h", { step: 1, min: 0 });
      body.appendChild(h("div", { class: "grid2" }, [w.wrap, hh.wrap]));
    }

    const rot = this._numRow(t("insp.rotation"), "rotation", { step: 1, suffix: "°" });
    const op = this._numRow(t("insp.opacity"), "opacity", {
      step: 0.01,
      min: 0,
      max: 1,
      precision: 2,
      withSlider: true,
    });
    body.appendChild(rot.wrap);
    body.appendChild(op.wrap);

    if (!multi) {
      const sx = this._numRow(t("insp.scaleX"), "scaleX", { step: 0.02, min: 0.02, max: 20 });
      const sy = this._numRow(t("insp.scaleY"), "scaleY", { step: 0.02, min: 0.02, max: 20 });
      body.appendChild(h("div", { class: "grid2" }, [sx.wrap, sy.wrap]));
    }

    this.el.appendChild(sec);
  }

  _buildAppearance() {
    const { el: sec, body } = section(t("insp.appearance"));
    const el = this.selected()[0];

    const fill = colorField({
      value: el.fill,
      label: t("tool.fill"),
      onInput: (v) => this._apply({ fill: v }, "style"),
      onCommit: (v) => {
        this.app.setFill(v);
        this.app.markDirty();
      },
    });
    const stroke = colorField({
      value: el.stroke,
      label: t("tool.stroke"),
      onInput: (v) => this._apply({ stroke: v }, "style"),
      onCommit: (v) => {
        this.app.setStroke(v);
        this.app.markDirty();
      },
    });

    body.appendChild(row(t("tool.fill"), [fill.el]));
    body.appendChild(row(t("tool.stroke"), [stroke.el]));

    const width = this._numRow(t("tool.strokeWidth"), "strokeWidth", {
      step: 0.5,
      min: 0,
      max: 400,
      withSlider: true,
      sliderMax: 60,
    });
    body.appendChild(width.wrap);

    const cap = selectField({
      value: el.strokeCap,
      options: [
        { value: "butt", label: t("opt.cap.butt") },
        { value: "round", label: t("opt.cap.round") },
        { value: "square", label: t("opt.cap.square") },
      ],
      onChange: (v) => this._apply({ strokeCap: v }, "style"),
      title: t("insp.cap"),
    });
    const join = selectField({
      value: el.strokeJoin,
      options: [
        { value: "miter", label: t("opt.join.miter") },
        { value: "round", label: t("opt.join.round") },
        { value: "bevel", label: t("opt.join.bevel") },
      ],
      onChange: (v) => this._apply({ strokeJoin: v }, "style"),
      title: t("insp.join"),
    });
    body.appendChild(row(t("insp.cap"), [cap.el]));
    body.appendChild(row(t("insp.join"), [join.el]));
    this.controls.fill = fill;
    this.controls.stroke = stroke;
    this.controls.cap = cap;
    this.controls.join = join;
    this.el.appendChild(sec);
  }

  _buildText(el) {
    const { el: sec, body } = section(t("insp.text"));
    const content = textArea({
      value: el.text || "",
      rows: 3,
      onInput: (v) => this._apply({ text: v }, "text", { live: true }),
      onCommit: (v) => {
        this.scene.updateElement(el.id, { text: v }, { label: "text" });
        // keep the box in sync with the glyphs
        const m = measureText(v, el.fontSize, el.fontWeight, FONT_STACK);
        this.scene.updateElement(el.id, { w: m.width, h: m.height }, { label: "text" });
        this.app.markDirty();
      },
    });
    body.appendChild(content.el);

    const size = this._numRow(t("insp.fontSize"), "fontSize", { step: 1, min: 4, max: 800, withSlider: true, sliderMax: 240 });
    body.appendChild(size.wrap);

    const family = selectField({
      value: el.fontFamily,
      options: FONT_FAMILIES.map((f) => ({ value: f.id, label: f.label })),
      onChange: (v) => this._apply({ fontFamily: v }, "style"),
      title: t("insp.fontFamily"),
    });
    body.appendChild(row(t("insp.fontFamily"), [family.el]));
    const weight = selectField({
      value: String(el.fontWeight),
      options: [300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) })),
      onChange: (v) => this._apply({ fontWeight: parseInt(v, 10) }, "style"),
      title: t("insp.fontWeight"),
    });
    const align = selectField({
      value: el.align,
      options: [
        { value: "left", label: t("opt.align.left") },
        { value: "center", label: t("opt.align.center") },
        { value: "right", label: t("opt.align.right") },
      ],
      onChange: (v) => this._apply({ align: v }, "style"),
    });
    body.appendChild(h("div", { class: "grid2" }, [row(t("insp.fontWeight"), [weight.el]), row(t("insp.align"), [align.el])]));

    this.controls.text = content;
    this.controls.fontSize = size;
    this.el.appendChild(sec);
  }

  _buildShape(el) {
    const { el: sec, body } = section(t("insp.shape"));
    const sides = this._numRow(t("insp.sides"), "sides", { step: 1, min: 3, max: 60, precision: 0 });
    body.appendChild(sides.wrap);
    if (el.type === "star") {
      const ratio = this._numRow(t("insp.innerRatio"), "innerRatio", {
        step: 0.01,
        min: 0.05,
        max: 0.95,
        withSlider: true,
      });
      body.appendChild(ratio.wrap);
    }
    this.el.appendChild(sec);
  }

  _buildPath(el) {
    const { el: sec, body } = section(t("insp.shape"));
    const closed = toggle({
      checked: !!el.closed,
      label: t("insp.closed"),
      onChange: (v) => this._apply({ closed: v }, "style"),
    });
    const smooth = toggle({
      checked: !!el.smooth,
      label: t("insp.smooth"),
      onChange: (v) => this._apply({ smooth: v }, "style"),
    });
    body.appendChild(h("div", { class: "row" }, [closed.el, smooth.el]));
    body.appendChild(h("div", { class: "prop" }, [h("span", { class: "label", text: t("insp.shape") }), h("b", { text: t("insp.points", { n: el.points.length }) })]));
    this.controls.closed = closed;
    this.controls.smooth = smooth;
    this.el.appendChild(sec);
  }

  _buildArrange() {
    const { el: sec, body } = section(t("insp.order"));
    const order = h("div", { class: "align-row" }, [
      iconButton("sendBack", t("edit.sendBack"), () => this.app.reorderSelection(-Infinity)),
      iconButton("chevronDown", t("edit.lower"), () => this.app.reorderSelection(-1)),
      iconButton("chevronUp", t("edit.raise"), () => this.app.reorderSelection(1)),
      iconButton("bringFront", t("edit.bringFront"), () => this.app.reorderSelection(Infinity)),
    ]);
    body.appendChild(order);

    const alignRow = h("div", { class: "align-row" }, [
      iconButton("alignLeft", "Align left", () => this.app.alignSelection("left")),
      iconButton("alignCenterH", "Align centres", () => this.app.alignSelection("center")),
      iconButton("alignRight", "Align right", () => this.app.alignSelection("right")),
      iconButton("alignTop", "Align top", () => this.app.alignSelection("top")),
      iconButton("alignMiddleV", "Align middles", () => this.app.alignSelection("middle")),
      iconButton("alignBottom", "Align bottom", () => this.app.alignSelection("bottom")),
    ]);
    body.appendChild(h("div", { class: "sec-head" }, [h("span", { class: "micro", text: t("insp.align") })]));
    body.appendChild(alignRow);

    const flipRow = h("div", { class: "align-row" }, [
      iconButton("swap", t("edit.flipH"), () => this.app.flipSelection("x")),
      iconButton("refresh", t("edit.flipV"), () => this.app.flipSelection("y")),
    ]);
    body.appendChild(flipRow);

    this.el.appendChild(sec);
  }

  _buildAnimation(el) {
    const { el: sec, body } = section(t("insp.animation"));
    const list = h("div", { class: "anim-list" });
    body.appendChild(list);

    for (const prop of ANIMATABLE) {
      const count = (el.keys[prop] || []).length;
      const line = h("div", { class: "prop" }, [
        h("span", { class: "label", text: t(`prop.${prop}`) }),
        h("div", { class: "ctl" }, [
          h("span", {
            class: "micro",
            style: "flex:1",
            text: count ? t("insp.keyCount", { n: count }) : "—",
          }),
        ]),
      ]);
      list.appendChild(line);
    }

    const addKey = h("button", { class: "btn solid block", type: "button" }, [
      h("span", { html: icon("key", 13) }),
      h("span", { text: t("insp.addKey") }),
    ]);
    addKey.addEventListener("click", () => this.app.timeline.toggleKeyAtPlayhead());
    const clearKeys = h("button", { class: "btn outline block", type: "button", text: t("insp.removeKeys") });
    clearKeys.addEventListener("click", () => {
      this.scene.clearKeys(el.id);
      this.app.markDirty();
      this.refresh();
      this.app.timeline?.refresh();
    });
    body.append(addKey, h("div", { style: "height:6px" }), clearKeys);
    this.el.appendChild(sec);
  }

  /* ------------------------------------------------------------ number row */

  _numRow(label, prop, opts = {}) {
    const app = this.app;
    const withKeys = opts.withKeys !== false;

    const field = numberField({
      value: 0,
      min: opts.min ?? -1e6,
      max: opts.max ?? 1e6,
      step: opts.step ?? 1,
      precision: opts.precision ?? 2,
      onInput: (v, { live }) => {
        if (live) {
          if (!this._dragging) {
            this._dragging = true;
            this.scene.live();
          }
          this._apply({ [prop]: v }, "prop", { live: true });
        } else {
          this._apply({ [prop]: v }, "prop");
        }
      },
      onCommit: (v) => {
        this._apply({ [prop]: v }, "prop");
        this._dragging = false;
        this.app.markDirty();
      },
    });

    const ctl = [field.el];
    if (opts.withSlider) {
      const s = slider({
        value: 0,
        min: opts.min ?? 0,
        max: opts.sliderMax ?? opts.max ?? 1,
        step: opts.step ?? 0.01,
        onInput: (v) => {
          if (!this._dragging) {
            this._dragging = true;
            this.scene.live();
          }
          this._apply({ [prop]: v }, "prop", { live: true });
        },
        onCommit: (v) => {
          this._apply({ [prop]: v }, "prop");
          this._dragging = false;
          this.app.markDirty();
        },
      });
      ctl.push(s.el);
      this.controls[`${prop}Slider`] = s;
    }

    let kf = null;
    if (withKeys) {
      kf = keyframeButton({
        onClick: () => {
          const el = this.scene.primary();
          if (!el) return;
          this.scene.toggleKey(el.id, prop, this.doc.time);
          this.app.timeline?.refresh();
          this.app.markDirty();
          this.sync();
        },
      });
      ctl.push(kf.el);
      this.controls[`${prop}Key`] = kf;
    }

    const wrap = row(label, ctl);
    this.controls[prop] = field;
    return { wrap, field, kf };
  }

  /* ------------------------------------------------------------ sync */

  syncTimeDependent() {
    this.sync();
  }

  sync() {
    const sel = this.selected();
    if (!sel.length) return;
    const el = sel.length === 1 ? sel[0] : null;
    const t0 = this.doc.time;
    const resolved = el ? this.app.stage.renderer.resolve(el, t0) : sel[0];

    for (const prop of ["x", "y", "w", "h", "rotation", "scaleX", "scaleY", "opacity", "strokeWidth", "fontSize", "sides", "innerRatio"]) {
      const field = this.controls[prop];
      if (!field) continue;
      let value;
      if (el) {
        value = keyAt(el.keys[prop], t0) ? keyAt(el.keys[prop], t0).v : resolved[prop];
      } else {
        value = sel[0][prop];
      }
      field._sync?.(value);
      const s = this.controls[`${prop}Slider`];
      if (s) s._sync?.(value);
      const kf = this.controls[`${prop}Key`];
      if (kf && el) {
        kf.set({
          onKey: !!keyAt(el.keys[prop], t0),
          animated: isAnimated(el.keys) && (el.keys[prop] || []).length > 0,
        });
      }
    }

    const el0 = el || sel[0];
    if (this.controls.fill) this.controls.fill._sync(el0.fill);
    if (this.controls.stroke) this.controls.stroke._sync(el0.stroke);
    if (this.controls.cap) this.controls.cap._sync(el0.strokeCap);
    if (this.controls.join) this.controls.join._sync(el0.strokeJoin);
    if (this.controls.name && el) this.controls.name._sync(el.name || el.type);
    if (this.controls.text && el) this.controls.text._sync(el.text || "");
    if (this.controls.closed && el) this.controls.closed._sync(!!el.closed);
    if (this.controls.smooth && el) this.controls.smooth._sync(!!el.smooth);
  }

  focusText() {
    this.controls.text?.focus();
  }
}

function typeIcon(type) {
  switch (type) {
    case "rect": return "rect";
    case "ellipse": return "ellipse";
    case "polygon": return "polygon";
    case "star": return "star";
    case "line": return "line";
    case "arrow": return "arrow";
    case "path": return "path";
    case "text": return "text";
    default: return "box";
  }
}

/** A cheap identity for the current build so we only rebuild when needed. */
function shapeSignature(el) {
  const controlProps = ["sides", "closed", "smooth", "fontFamily"];
  return [
    el.id,
    el.type,
    controlProps.map((p) => String(el[p])).join(","),
    Object.keys(el.keys).sort().join("+"),
  ].join("|");
}

export { clamp, attachTooltip, menu, measureText };
