// timeline.js — bottom panel: time ruler, layer tracks, keyframe editor.

class Timeline {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById("timeline");
    this.ruler = document.getElementById("ruler");
    this.tracksEl = document.getElementById("tracks");
    this.playhead = document.getElementById("playhead");
    this.rulerCtx = null;
    this.rulerCanvas = null;
    this.propChips = document.getElementById("prop-chips");
    this.activeProp = "x";
    this.building = false;
  }

  get scene() { return this.app.scene; }

  build() {
    const app = this.app;
    this.el.innerHTML = "";
    const top = document.createElement("div");
    top.className = "tl-top";
    top.innerHTML = `
      <div class="tl-transport">
        <button class="tl-btn" id="btn-prev" title="Previous keyframe">⏮</button>
        <button class="tl-btn" id="btn-play" title="Play / Pause">▶</button>
        <button class="tl-btn" id="btn-next" title="Next keyframe">⏭</button>
        <button class="tl-btn" id="btn-stop" title="Stop">⏹</button>
        <button class="tl-btn" id="btn-loop" title="Loop">🔁</button>
      </div>
      <div class="tl-time">
        <input id="tl-time" type="text" title="Current time (s)">
        <span>/</span>
        <input id="tl-duration" type="number" min="0.1" step="0.1" title="Duration (s)">
        <select id="tl-fps" title="Frames per second">
          ${[15, 24, 30, 60].map((f) => `<option value="${f}">${f} fps</option>`).join("")}
        </select>
      </div>
      <div class="tl-props" id="prop-chips"></div>
      <div class="tl-extras">
        <button class="tl-btn" id="btn-key" title="Toggle keyframe at playhead (K)">◆ Add key</button>
        <button class="tl-btn" id="btn-onion" title="Onion skin">Onion</button>
      </div>`;
    this.el.appendChild(top);

    const body = document.createElement("div");
    body.className = "tl-body";
    body.innerHTML = `
      <div class="tl-labels" id="tl-labels"></div>
      <div class="tl-grid-wrap">
        <canvas id="ruler"></canvas>
        <div id="tracks"></div>
        <div id="playhead"></div>
      </div>`;
    this.el.appendChild(body);

    this.rulerCanvas = document.getElementById("ruler");
    this.ruler = this.rulerCanvas;
    this.tracksEl = document.getElementById("tracks");
    this.playhead = document.getElementById("playhead");
    this.rulerCtx = this.rulerCanvas.getContext("2d");

    this.propChips = document.getElementById("prop-chips");
    this.buildPropChips();
    this.bindEvents();
    this.refresh();
  }

  buildPropChips() {
    this.propChips.innerHTML = "";
    const props = [{ id: "x", label: "X" }, { id: "y", label: "Y" },
      { id: "rotation", label: "Rot" }, { id: "scale", label: "Scale" },
      { id: "opacity", label: "Opacity" }];
    for (const p of props) {
      const chip = document.createElement("button");
      chip.className = "prop-chip" + (p.id === this.activeProp ? " active" : "");
      chip.dataset.prop = p.id;
      chip.textContent = p.label;
      chip.style.setProperty("--pc", PROP_COLORS[p.id]);
      chip.addEventListener("click", () => {
        this.activeProp = p.id;
        this.buildPropChips();
      });
      this.propChips.appendChild(chip);
    }
  }

  bindEvents() {
    const $ = (id) => document.getElementById(id);
    $("btn-play").addEventListener("click", () => this.app.togglePlay());
    $("btn-stop").addEventListener("click", () => this.app.stop());
    $("btn-loop").addEventListener("click", () => {
      this.app.scene.loop = !this.app.scene.loop;
      $("btn-loop").classList.toggle("active", this.app.scene.loop);
    });
    $("btn-prev").addEventListener("click", () => this.jumpKey(-1));
    $("btn-next").addEventListener("click", () => this.jumpKey(1));
    $("btn-key").addEventListener("click", () => this.toggleKeyAtPlayhead());
    $("btn-onion").addEventListener("click", () => {
      this.app.scene.onion = !this.app.scene.onion;
      $("btn-onion").classList.toggle("active", this.app.scene.onion);
      this.app.requestRender();
    });
    $("tl-time").addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) { this.app.setTime(clamp(v, 0, this.scene.duration)); this.app.requestRender(); }
    });
    $("tl-duration").addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (v >= 0.1) { this.scene.duration = v; this.app.scheduleRebuild(); }
    });
    $("tl-fps").addEventListener("change", (e) => {
      this.scene.fps = parseInt(e.target.value);
      this.app.scheduleRebuild();
    });

    // playhead drag
    const ph = $("playhead");
    ph.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const move = (ev) => this._setTimeFromX(ev.clientX);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      move(e);
    });
  }

  _setTimeFromX(clientX) {
    const wrap = this.tracksEl.parentElement;
    const r = wrap.getBoundingClientRect();
    const x = clientX - r.left;
    const t = (x / wrap.clientWidth) * this.scene.duration;
    this.app.setTime(clamp(t, 0, this.scene.duration));
    this.app.requestRender();
  }

  pxPerSec() {
    const wrap = this.tracksEl.parentElement;
    return wrap.clientWidth / Math.max(0.1, this.scene.duration);
  }

  refresh() {
    if (this.building) return;
    const app = this.app;
    const scene = this.scene;
    // labels + tracks
    this.tracksEl.innerHTML = "";
    const labelsEl = document.getElementById("tl-labels");
    labelsEl.innerHTML = "";
    for (const layer of scene.layers) {
      const label = document.createElement("div");
      label.className = "tl-label";
      label.innerHTML = `<span class="tl-eye">${layer.visible ? "◉" : "○"}</span><span class="tl-name">${escXML(layer.name)}</span>`;
      label.addEventListener("click", () => app.selectLayer(layer.id));
      labelsEl.appendChild(label);

      const track = document.createElement("div");
      track.className = "tl-track" + (layer.id === scene.selectedId ? " selected" : "");
      track.dataset.layer = layer.id;
      track.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        app.selectLayer(layer.id);
        app.requestRender();
        this._setTimeFromX(e.clientX);
      });
      // keyframe diamonds
      for (const prop of ANIM_PROPS) {
        const keys = layer.keys[prop] || [];
        for (const [t, v] of keys) {
          const k = document.createElement("div");
          k.className = "tl-key";
          k.style.left = ((t / Math.max(0.1, scene.duration)) * 100) + "%";
          k.style.background = PROP_COLORS[prop];
          k.title = `${prop} @ ${t.toFixed(2)}s = ${Math.round(v * 100) / 100}`;
          k.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            app.selectLayer(layer.id);
            app.requestRender();
            const move = (ev) => {
              const wrap = this.tracksEl.parentElement;
              const r = wrap.getBoundingClientRect();
              const t2 = clamp(((ev.clientX - r.left) / wrap.clientWidth) * scene.duration, 0, scene.duration);
              this._moveKey(layer, prop, t, t2);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          });
          k.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            removeKeyframe(layer, prop, t);
            app.requestRender();
            this.refresh();
          });
          track.appendChild(k);
        }
      }
      track.addEventListener("dblclick", (e) => {
        // add keyframe at playhead for active prop
        this.toggleKeyAtPlayhead();
      });
      this.tracksEl.appendChild(track);
    }

    // ruler
    this.drawRuler();

    // playhead + time fields
    const t = scene.currentTime;
    document.getElementById("tl-time").value = t.toFixed(2);
    document.getElementById("tl-duration").value = scene.duration;
    document.getElementById("tl-fps").value = scene.fps;
    this.positionPlayhead();
    // transport state
    document.getElementById("btn-play").textContent = scene.playing ? "⏸" : "▶";
    document.getElementById("btn-loop").classList.toggle("active", !!scene.loop);
    document.getElementById("btn-onion").classList.toggle("active", !!scene.onion);
  }

  positionPlayhead() {
    const wrap = this.tracksEl.parentElement;
    const x = (this.scene.currentTime / Math.max(0.1, this.scene.duration)) * wrap.clientWidth;
    this.playhead.style.left = x + "px";
  }

  drawRuler() {
    const canvas = this.rulerCanvas;
    const wrap = this.tracksEl.parentElement;
    canvas.width = Math.max(1, wrap.clientWidth) * devicePixelRatio;
    canvas.height = 24 * devicePixelRatio;
    canvas.style.width = wrap.clientWidth + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#10131c";
    ctx.fillRect(0, 0, wrap.clientWidth, 24);
    const dur = Math.max(0.1, this.scene.duration);
    ctx.strokeStyle = "#2b3142";
    ctx.fillStyle = "#8b93a7";
    ctx.font = "10px system-ui";
    // choose nice tick spacing
    let step = 0.5;
    const pxPerS = wrap.clientWidth / dur;
    for (const cand of [0.1, 0.2, 0.5, 1, 2, 5]) {
      if (cand * pxPerS >= 55) { step = cand; break; }
      step = cand;
    }
    ctx.beginPath();
    for (let t = 0; t <= dur + 1e-6; t += step) {
      const x = (t / dur) * wrap.clientWidth;
      ctx.moveTo(x, 22);
      ctx.lineTo(x, 24);
      ctx.fillText(t.toFixed(step < 1 ? 1 : 0) + "s", x + 3, 11);
    }
    ctx.stroke();
  }

  _moveKey(layer, prop, fromT, toT) {
    const arr = layer.keys[prop] || [];
    const i = arr.findIndex((k) => Math.abs(k[0] - fromT) < 1e-4);
    if (i < 0) return;
    arr[i][0] = toT;
    arr.sort((a, b) => a[0] - b[0]);
    this.app.setTime(toT);
    this.app.requestRender();
    this.refresh();
  }

  toggleKeyAtPlayhead() {
    const layer = this.scene.layers.find((l) => l.id === this.scene.selectedId);
    const t = this.scene.currentTime;
    if (!layer) { this.app.status("Select a shape first"); return; }
    const prop = this.activeProp;
    const current = getKeyValue(layer, prop, t);
    if (hasKeyframe(layer, prop, t)) {
      removeKeyframe(layer, prop, t);
    } else {
      setKeyframe(layer, prop, t, Math.round(current * 1000) / 1000);
    }
    this.app.pushHistory();
    this.app.requestRender();
    this.refresh();
  }

  jumpKey(dir) {
    const layer = this.scene.layers.find((l) => l.id === this.scene.selectedId);
    const t = this.scene.currentTime;
    if (!layer) return;
    let times = [];
    for (const prop of ANIM_PROPS) {
      for (const [kt] of layer.keys[prop] || []) times.push(kt);
    }
    times = Array.from(new Set(times.map((x) => Math.round(x * 1000)))).map((x) => x / 1000).sort((a, b) => a - b);
    if (!times.length) return;
    let target = times[0];
    if (dir > 0) target = times.find((x) => x > t + 1e-4) ?? times[times.length - 1];
    else target = [...times].reverse().find((x) => x < t - 1e-4) ?? times[0];
    this.app.setTime(target);
    this.app.requestRender();
  }

  rebuild() {
    this.building = true;
    this.build();
    this.building = false;
    this.refresh();
  }
}
