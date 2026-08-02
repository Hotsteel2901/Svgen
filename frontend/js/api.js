// api.js — client for the SVGen backend HTTP API.

const API = {
  base: "",
  _infoCache: null,

  async request(method, path, body) {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(this.base + path, opts);
    if (res.status === 500) {
      let err = "Backend error";
      try { const j = await res.json(); err = j.error || err; } catch (e) {}
      throw new Error(err);
    }
    return res;
  },

  async health() {
    const res = await this.request("GET", "/api/health");
    return res.json();
  },

  async info() {
    if (this._infoCache) return this._infoCache;
    const res = await this.request("GET", "/api/info");
    this._infoCache = await res.json();
    return this._infoCache;
  },

  async validate(svg) {
    const res = await this.request("POST", "/api/validate", { svg });
    return res.json();
  },

  async logs(enabled) {
    const res = await this.request("POST", "/api/logs", { enabled });
    return res.json();
  },

  async renderBytes({ svg, format, width, height, duration, fps, background, engine, quality, name }) {
    const res = await this.request("POST", "/api/export", {
      svg, format, width, height, duration, fps, background, engine, quality, name,
    });
    const blob = await res.blob();
    const header = res.headers.get("Content-Disposition") || "";
    let filename = `${name || "export"}.${format}`;
    const m = /filename="?([^";]+)"?/.exec(header);
    if (m) filename = m[1];
    return { blob, filename };
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
