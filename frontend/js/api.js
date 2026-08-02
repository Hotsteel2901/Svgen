// api.js — client for the SVGen backend HTTP API.
// Hardened: per-request timeout, offline detection, normalized errors.

const API = {
  base: "",
  _infoCache: null,

  async request(method, path, body, timeoutMs = 45000) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const ctrl = new AbortController();
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => ctrl.abort(), timeoutMs);
      opts.signal = ctrl.signal;
    }
    let res;
    try {
      res = await fetch(this.base + path, opts);
    } catch (err) {
      if (timer) clearTimeout(timer);
      const e = new Error("Cannot reach the backend. Start it with: python svgen.py serve");
      e.offline = true;
      throw e;
    }
    if (timer) clearTimeout(timer);
    if (res.status === 500) {
      let message = "Backend error";
      try { const j = await res.json(); message = j.error || message; } catch (e) {}
      const err = new Error(message);
      err.status = 500;
      throw err;
    }
    if (!res.ok) {
      const err = new Error("Request failed (" + res.status + ")");
      err.status = res.status;
      throw err;
    }
    return res;
  },

  async health() {
    const res = await this.request("GET", "/api/health", undefined, 5000);
    return res.json();
  },

  async info() {
    if (this._infoCache) return this._infoCache;
    const res = await this.request("GET", "/api/info", undefined, 8000);
    this._infoCache = await res.json();
    return this._infoCache;
  },

  async validate(svg) {
    const res = await this.request("POST", "/api/validate", { svg }, 20000);
    return res.json();
  },

  async logs(enabled) {
    const res = await this.request("POST", "/api/logs", { enabled });
    return res.json();
  },

  async renderBytes({ svg, format, width, height, duration, fps, background, engine, quality, name }) {
    const res = await this.request("POST", "/api/export", {
      svg, format, width, height, duration, fps, background, engine, quality, name,
    }, 0); // no client timeout — renders can be slow; AbortController without delay
    const blob = await res.blob();
    const header = res.headers.get("Content-Disposition") || "";
    let filename = `${name || "export"}.${format}`;
    const m = /filename="?([^";]+)"?/.exec(header);
    if (m) filename = m[1];
    return { blob, filename };
  },
};

// ---- lightweight connection manager -------------------------------------

const Conn = {
  online: null,
  _timer: null,
  _listeners: new Set(),

  start() {
    this.check();
    this._timer = setInterval(() => this.check(), 8000);
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  onChange(fn) {
    this._listeners.add(fn);
    if (this.online !== null) fn(this.online, false);
    return () => this._listeners.delete(fn);
  },

  async check() {
    let ok = false;
    try {
      const h = await API.health();
      ok = !!(h && h.ok);
    } catch (e) {
      ok = false;
    }
    if (ok === this.online) return;
    const wasNull = this.online === null;
    this.online = ok;
    this._listeners.forEach((fn) => fn(ok, wasNull));
  },
};

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
