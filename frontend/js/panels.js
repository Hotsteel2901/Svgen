// panels.js — right sidebar: Properties / Layers / Export tabs.

class Panels {
  constructor(app) {
    this.app = app;
    this.tab = "properties";
    this.el = document.getElementById("panel-body");
    this.statusEl = document.getElementById("statusbar");
  }

  get scene() { return this.app.scene; }

  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll(".side-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    this.render();
  }

  render() {
    if (this.tab === "properties") this.renderProperties();
    else if (this.tab === "layers") this.renderLayers();
    else if (this.tab === "export") this.renderExport();
  }

  // ---- Properties ---------------------------------------------------------

  renderProperties() {
    const layer = this.scene.layers.find((l) => l.id === this.scene.selectedId);
    const el = this.el;
    if (!layer) {
      el.innerHTML = `<div class="panel-empty">${t("prop.empty")}</div>`;
      return;
    }
    const app = this.app;
    const commit = () => { app.pushHistory(); app.requestRender(); app.scheduleRebuild(); };
    const num = (label, prop, step = 1) => `
      <label class="prop-row"><span>${label}</span>
        <input type="number" step="${step}" value="${fmtNum(layer[prop])}" data-prop="${prop}"></label>`;

    let html = `<div class="prop-head"><input class="prop-name" value="${escXML(layer.name)}" data-name="1"></div>`;
    html += `<div class="prop-section">${t("prop.transform")}</div>`;
    html += num(t("prop.x"), "x", 1) + num(t("prop.y"), "y", 1);
    html += num(t("prop.width"), "width", 1) + num(t("prop.height"), "height", 1);
    html += num(t("prop.rotation"), "rotation", 0.5) + num(t("prop.scale"), "scale", 0.05) + num(t("prop.opacity"), "opacity", 0.01);
    html += `<div class="prop-section">${t("prop.appearance")}</div>`;
    html += `<label class="prop-row"><span>${t("prop.fill")}</span><span class="swatch"><input type="color" value="${svgOrBlack(layer.fill)}" data-fill="1"><button class="sw-none" data-none="fill" title="${t("prop.fill")}">∅</button></span></label>`;
    html += `<label class="prop-row"><span>${t("prop.stroke")}</span><span class="swatch"><input type="color" value="${svgOrBlack(layer.stroke)}" data-stroke="1"><button class="sw-none" data-none="stroke" title="${t("prop.stroke")}">∅</button></span></label>`;
    html += num(t("prop.strokeW"), "strokeWidth", 0.5);
    if (layer.type === "text") {
      html += `<div class="prop-section">${t("prop.text")}</div>`;
      html += `<label class="prop-row span2"><textarea rows="2" data-text="1">${escXML(layer.text || "")}</textarea></label>`;
      html += num(t("prop.fontSize"), "fontSize", 1);
    }
    if (layer.type === "poly" || layer.type === "star") {
      html += `<div class="prop-section">${t("prop.shape")}</div>`;
      html += num(t("prop.sides"), "sides", 1);
    }
    if (layer.type === "pen" || layer.type === "path") {
      html += `<div class="prop-row"><span>${t("prop.points")}</span><b>${layer.points.length}</b></div>`;
    }

    html += `<div class="prop-section">${t("prop.animation")} <small>(${ANIM_PROPS.map((p) => (layer.keys[p] || []).length + " " + p).join(" · ")})</small></div>`;
    html += `<button class="btn ghost full" id="clear-keys">${t("prop.clearKeys")}</button>`;
    html += `<button class="btn ghost full" id="del-layer">${t("prop.delete")}</button>`;

    el.innerHTML = html;

    el.querySelectorAll("input[data-prop]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const prop = inp.dataset.prop;
        layer[prop] = parseFloat(inp.value);
        if (prop === "opacity") layer[prop] = clamp(layer[prop], 0, 1);
        if (prop === "scale") layer[prop] = Math.max(0.01, layer[prop]);
        app.requestRender();
      });
      inp.addEventListener("change", commit);
    });
    const nameInput = el.querySelector("input[data-name]");
    if (nameInput) nameInput.addEventListener("change", (e) => { layer.name = e.target.value; commit(); });
    const fillInput = el.querySelector("input[data-fill]");
    if (fillInput) fillInput.addEventListener("input", (e) => { layer.fill = e.target.value; app.requestRender(); });
    const strokeInput = el.querySelector("input[data-stroke]");
    if (strokeInput) strokeInput.addEventListener("input", (e) => { layer.stroke = e.target.value; app.requestRender(); });
    el.querySelectorAll("button[data-none]").forEach((b) => b.addEventListener("click", () => {
      layer[b.dataset.none] = "none"; app.requestRender(); commit();
    }));
    const textInput = el.querySelector("textarea[data-text]");
    if (textInput) textInput.addEventListener("input", (e) => { layer.text = e.target.value; app.requestRender(); });
    const clearBtn = el.querySelector("#clear-keys");
    if (clearBtn) clearBtn.addEventListener("click", () => { layer.keys = {}; commit(); });
    const delBtn = el.querySelector("#del-layer");
    if (delBtn) delBtn.addEventListener("click", () => {
      this.scene.layers = this.scene.layers.filter((l) => l.id !== layer.id);
      this.scene.selectedId = null;
      commit();
    });
  }

  focusText() {
    const ta = this.el.querySelector("textarea[data-text]");
    if (ta) { ta.focus(); ta.select(); }
  }

  // ---- Layers --------------------------------------------------------------

  renderLayers() {
    const el = this.el;
    const app = this.app;
    const layers = this.scene.layers;
    let html = `<div class="layers-toolbar">
      <button class="btn ghost sm" id="layer-up" data-i18n-title="layer.up" title="${t("layer.up")}">▲</button>
      <button class="btn ghost sm" id="layer-down" data-i18n-title="layer.down" title="${t("layer.down")}">▼</button>
      <button class="btn ghost sm" id="layer-dup" data-i18n-title="layer.dup" title="${t("layer.dup")}">⧉</button>
      <button class="btn ghost sm danger" id="layer-del" data-i18n-title="layer.del" title="${t("layer.del")}">🗑</button>
    </div><div class="layer-list">`;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      html += `<div class="layer-row ${l.id === this.scene.selectedId ? "selected" : ""}" data-id="${l.id}">
        <button class="layer-eye" data-eye="${l.id}">${l.visible ? "◉" : "○"}</button>
        <button class="layer-lock" data-lock="${l.id}">${l.locked ? "🔒" : "🔓"}</button>
        <span class="layer-name" data-name="${l.id}">${escXML(l.name)}</span>
        <span class="layer-type">${typeName(l.type)}</span>
      </div>`;
    }
    html += `</div>`;
    el.innerHTML = html;

    el.querySelectorAll(".layer-row").forEach((row) => row.addEventListener("click", () => {
      app.selectLayer(row.dataset.id); app.requestRender();
    }));
    el.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const l = layers.find((x) => x.id === b.dataset.eye);
      if (l) { l.visible = !l.visible; app.requestRender(); this.renderLayers(); }
    }));
    el.querySelectorAll("[data-lock]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const l = layers.find((x) => x.id === b.dataset.lock);
      if (l) { l.locked = !l.locked; app.requestRender(); this.renderLayers(); }
    }));
    el.querySelectorAll("[data-name]").forEach((s) => s.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const l = layers.find((x) => x.id === s.dataset.name);
      const name = prompt(t("layer.rename"), l.name);
      if (name) { l.name = name; app.requestRender(); this.renderLayers(); }
    }));

    const move = (dir) => {
      const sel = layers.find((x) => x.id === this.scene.selectedId);
      if (!sel) return;
      const i = layers.indexOf(sel);
      const j = i + dir;
      if (j < 0 || j >= layers.length) return;
      const copy = layers.slice();
      copy.splice(i, 1);
      copy.splice(j, 0, sel);
      this.scene.layers = copy;
      app.requestRender(); app.scheduleRebuild(); this.renderLayers(); app.pushHistory();
    };
    document.getElementById("layer-up").addEventListener("click", () => move(-1));
    document.getElementById("layer-down").addEventListener("click", () => move(1));
    document.getElementById("layer-dup").addEventListener("click", () => {
      const sel = layers.find((x) => x.id === this.scene.selectedId);
      if (!sel) return;
      const c = cloneLayer(sel);
      c.x += 24; c.y += 24;
      this.scene.layers.push(c);
      this.scene.selectedId = c.id;
      app.requestRender(); app.scheduleRebuild(); this.renderLayers(); app.pushHistory();
    });
    document.getElementById("layer-del").addEventListener("click", () => {
      const sel = layers.find((x) => x.id === this.scene.selectedId);
      if (!sel) return;
      this.scene.layers = this.scene.layers.filter((x) => x.id !== sel.id);
      this.scene.selectedId = null;
      app.requestRender(); app.scheduleRebuild(); this.renderLayers(); app.pushHistory();
    });
  }

  // ---- Export ----------------------------------------------------------------

  renderExport() {
    const el = this.el;
    const app = this.app;
    const scene = this.scene;
    let html = `
      <div class="panel-empty exp-info" id="exp-info">${t("exp.checking")}</div>
      <div class="prop-section">${t("exp.canvas")}</div>
      ${this._numRow(t("exp.width"), "exp-w", scene.width, 1)}
      ${this._numRow(t("exp.height"), "exp-h", scene.height, 1)}
      <label class="prop-row"><span>${t("exp.background")}</span>
        <span class="swatch"><input type="color" id="exp-bg" value="${scene.bgColor && scene.bgColor !== "transparent" && scene.bgColor !== "none" ? scene.bgColor : "#ffffff"}">
        <button class="sw-none" id="exp-bg-none">∅</button></span></label>
      <div class="prop-section">${t("exp.output")}</div>
      <label class="prop-row"><span>${t("exp.format")}</span>
        <select id="exp-fmt">
          ${["svg","png","jpg","bmp","webp","gif","mp4","webm"].map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join("")}
        </select></label>
      <div id="exp-video-opts">
        ${this._numRow(t("exp.duration"), "exp-dur", scene.duration, 0.1)}
        ${this._numRow(t("exp.fps"), "exp-fps", scene.fps, 1)}
      </div>
      <div class="prop-section">${t("exp.engine")}</div>
      <label class="prop-row"><span>${t("exp.engine")}</span>
        <select id="exp-engine">
          <option value="auto">${t("exp.engine.auto")}</option>
          <option value="chrome">${t("exp.engine.chrome")}</option>
          <option value="firefox">${t("exp.engine.firefox")}</option>
          <option value="rust">${t("exp.engine.rust")}</option>
          <option value="raster">${t("exp.engine.raster")}</option>
        </select></label>
      <div class="export-actions">
        <button class="btn primary full" id="exp-go">${t("exp.go")}</button>
        <button class="btn ghost full" id="exp-svg">${t("exp.svg")}</button>
        <button class="btn ghost full" id="exp-copy">${t("exp.copy")}</button>
      </div>
      <div id="exp-progress" class="exp-progress hidden"></div>`;

    el.innerHTML = html;

    // engine availability info
    API.info().then((info) => {
      const el2 = document.getElementById("exp-info");
      if (el2) {
        const c = info.capabilities || {};
        el2.innerHTML = `<b>${info.os} · ${info.arch}</b> (${info.fs} filesystem)<br>
          Rust: ${c.rust ? "✓" : "✗"} &nbsp; browser: ${c.chrome ? "Chrome" : c.firefox ? "Firefox" : "✗"} &nbsp;
          ffmpeg: ${c.ffmpeg ? "✓" : "✗"} &nbsp; Pillow: ${c.pillow ? "✓" : "✗"}`;
      }
    }).catch(() => {
      const el2 = document.getElementById("exp-info");
      if (el2) el2.innerHTML = `<b>Backend offline.</b> Start it with <code>python svgen.py serve</code>`;
    });

    const fmtSelect = el.querySelector("#exp-fmt");
    const videoOpts = el.querySelector("#exp-video-opts");
    const updateVideoOpts = () => {
      const fmt = fmtSelect.value;
      videoOpts.style.display = ["gif", "mp4", "webm"].includes(fmt) ? "" : "none";
    };
    fmtSelect.addEventListener("change", updateVideoOpts);
    updateVideoOpts();

    const goBtn = el.querySelector("#exp-go");
    const syncOnline = (online) => {
      const offline = online === false;
      goBtn.disabled = offline;
      goBtn.textContent = offline ? t("exp.offline") : t("exp.go");
    };
    syncOnline(app.conn.online);
    app.conn.onChange((online) => syncOnline(online));

    goBtn.addEventListener("click", () => this.doExport());
    el.querySelector("#exp-svg").addEventListener("click", () => {
      const svg = sceneToSVG(scene);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "artwork.svg");
    });
    el.querySelector("#exp-copy").addEventListener("click", async () => {
      const svg = sceneToSVG(scene);
      try { await navigator.clipboard.writeText(svg); this.app.status(t("exp.copied")); }
      catch (e) { this.app.status(t("exp.copyFail")); }
    });
    el.querySelector("#exp-bg").addEventListener("input", (e) => { scene.bgColor = e.target.value; app.requestRender(); });
    el.querySelector("#exp-bg-none").addEventListener("click", () => { scene.bgColor = "transparent"; app.requestRender(); });
    const bindNum = (id, fn) => el.querySelector(id).addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) fn(v);
    });
    bindNum("#exp-w", (v) => { scene.width = Math.max(16, v); app.requestRender(); });
    bindNum("#exp-h", (v) => { scene.height = Math.max(16, v); app.requestRender(); });
  }

  _numRow(label, id, value, step) {
    return `<label class="prop-row"><span>${label}</span><input id="${id}" type="number" step="${step}" value="${value}"></label>`;
  }

  async doExport() {
    const app = this.app;
    const scene = this.scene;
    const fmt = document.getElementById("exp-fmt").value;
    const width = parseInt(document.getElementById("exp-w").value);
    const height = parseInt(document.getElementById("exp-h").value);
    const dur = parseFloat(document.getElementById("exp-dur")?.value || scene.duration);
    const fps = parseInt(document.getElementById("exp-fps")?.value || scene.fps);
    const engine = document.getElementById("exp-engine").value;
    const background = scene.bgColor && scene.bgColor !== "transparent" && scene.bgColor !== "none" ? scene.bgColor : null;

    const svg = sceneToSVG(scene, { width, height });
    const progress = document.getElementById("exp-progress");
    progress.classList.remove("hidden");
    progress.textContent = t("exp.validating");
    const goBtn = document.getElementById("exp-go");
    if (goBtn) goBtn.disabled = true;
    app.status(t("st.exporting", { fmt: fmt.toUpperCase(), w: width, h: height }));
    try {
      const val = await API.validate(svg);
      if (!val.ok) {
        progress.textContent = t("exp.invalid") + (val.error || "");
        app.toast(t("toast.validFail"), "err");
        return;
      }
      const isVideo = ["mp4", "webm", "gif"].includes(fmt);
      progress.textContent = isVideo
        ? t("exp.rendering", { fps, dur })
        : t("exp.render");
      const res = await API.renderBytes({
        svg, format: fmt, width, height,
        duration: isVideo ? dur : undefined,
        fps: isVideo ? fps : undefined,
        background,
        engine,
        name: "artwork",
      });
      await downloadBlob(res.blob, res.filename);
      progress.textContent = t("exp.done", { name: res.filename });
      app.toast(t("toast.exported", { name: res.filename }), "ok");
      app.status(t("st.exported", { name: res.filename }));
    } catch (err) {
      progress.textContent = t("exp.failed") + err.message;
      app.toast(t("toast.exportFail", { msg: err.message }), "err");
      app.status(t("st.exportFail"));
    } finally {
      if (goBtn) goBtn.disabled = app.conn.online === false;
    }
  }
}

function svgOrBlack(c) {
  return c && c !== "none" && c.startsWith("#") ? c : "#000000";
}
