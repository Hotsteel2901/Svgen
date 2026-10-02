/**
 * Backend client.
 *
 * Still renders go through the synchronous endpoints (they finish in well under
 * a second); anything animated goes through the job queue so the UI can show
 * real progress and offer a cancel button.
 */

const DEFAULT_TIMEOUT = 30000;

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false, body = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.offline = offline;
    this.body = body;
  }
}

async function request(method, path, { body, timeout = DEFAULT_TIMEOUT, signal } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let timer = null;
  const ctrl = new AbortController();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  if (timeout > 0) {
    timer = setTimeout(() => ctrl.abort(), timeout);
    opts.signal = ctrl.signal;
  } else {
    opts.signal = ctrl.signal;
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (signal && signal.aborted) throw new ApiError("cancelled", { status: 0 });
    throw new ApiError("Cannot reach the backend.", { offline: true });
  }
  if (timer) clearTimeout(timer);

  if (!res.ok) {
    let payload = null;
    let message = `Request failed (${res.status})`;
    try {
      payload = await res.json();
      if (payload && payload.error) message = payload.error;
    } catch {
      /* not JSON — keep the generic message */
    }
    throw new ApiError(message, { status: res.status, body: payload });
  }
  return res;
}

async function requestJson(method, path, opts) {
  const res = await request(method, path, opts);
  try {
    return await res.json();
  } catch {
    throw new ApiError("Backend returned a malformed response", { status: res.status });
  }
}

export const api = {
  base: "",

  health(timeout = 4000) {
    return requestJson("GET", "/api/health", { timeout });
  },

  info({ refresh = false } = {}) {
    if (!refresh && this._info) return Promise.resolve(this._info);
    return requestJson("GET", "/api/info", { timeout: 10000 }).then((data) => {
      this._info = data;
      return data;
    });
  },

  engines() {
    return requestJson("GET", "/api/engines", { timeout: 8000 });
  },

  logs(state) {
    if (state === undefined) return requestJson("GET", "/api/logs");
    return requestJson("POST", "/api/logs", { body: state });
  },

  validate(svg, { signal } = {}) {
    return requestJson("POST", "/api/validate", { body: { svg }, timeout: 20000, signal });
  },

  /** Asynchronous render. Returns the created job record. */
  startJob(payload, { signal } = {}) {
    return requestJson("POST", "/api/jobs", { body: payload, timeout: 30000, signal });
  },

  job(id) {
    return requestJson("GET", `/api/jobs/${encodeURIComponent(id)}`, { timeout: 10000 });
  },

  jobs() {
    return requestJson("GET", "/api/jobs", { timeout: 10000 });
  },

  cancelJob(id) {
    return requestJson("DELETE", `/api/jobs/${encodeURIComponent(id)}`, { timeout: 10000 });
  },

  jobResultUrl(id) {
    return `/api/jobs/${encodeURIComponent(id)}/result`;
  },

  async jobResult(id) {
    const res = await request("GET", this.jobResultUrl(id), { timeout: 120000 });
    return res.blob();
  },

  /** Synchronous render, for stills. Returns { blob, filename }. */
  async renderBytes(payload, { signal } = {}) {
    const res = await request("POST", "/api/export", { body: payload, timeout: 0, signal });
    const blob = await res.blob();
    return { blob, filename: filenameFrom(res, payload) };
  },

  async renderRaw(payload, { signal } = {}) {
    const res = await request("POST", "/api/render", { body: payload, timeout: 0, signal });
    return res.blob();
  },

  /**
   * Follow a job to completion.
   * Prefers Server-Sent Events; falls back to polling if the stream fails or
   * the browser does not deliver events promptly.
   */
  followJob(id, { onUpdate, signal } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let source = null;
      let pollTimer = 0;
      let lastState = null;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (source) source.close();
        clearTimeout(pollTimer);
        if (signal) signal.removeEventListener("abort", onAbort);
        fn(value);
      };

      const apply = (job) => {
        if (!job || settled) return;
        lastState = job;
        if (onUpdate) onUpdate(job);
        if (job.state === "done") finish(resolve, job);
        else if (job.state === "error") finish(reject, new ApiError(job.error || "render failed"));
        else if (job.state === "cancelled") finish(reject, new ApiError("cancelled"));
      };

      const onAbort = () => {
        api.cancelJob(id).catch(() => {});
        finish(reject, new ApiError("cancelled"));
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const poll = async () => {
        if (settled) return;
        try {
          const data = await api.job(id);
          apply(data.job);
        } catch (err) {
          if (err.status === 404) return finish(reject, err);
        }
        if (!settled) pollTimer = setTimeout(poll, 600);
      };

      if (typeof EventSource === "function") {
        try {
          source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
          source.onmessage = (evt) => {
            try {
              apply(JSON.parse(evt.data));
            } catch {
              /* ignore malformed frames */
            }
          };
          source.onerror = () => {
            if (settled) return;
            if (source) source.close();
            source = null;
            if (!pollTimer) poll();
          };
          // Belt and braces: if SSE never delivers anything, start polling.
          setTimeout(() => {
            if (!settled && lastState === null && !pollTimer) poll();
          }, 2500);
          return;
        } catch {
          /* fall through to polling */
        }
      }
      poll();
    });
  },
};

function filenameFrom(res, payload) {
  const header = res.headers.get("Content-Disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  if (plain) return plain[1];
  const fmt = payload.format === "jpeg" ? "jpg" : payload.format || "png";
  return `${payload.name || "artwork"}.${fmt}`;
}

/* ---------------------------------------------------------------- liveness */

/**
 * Backend watchdog. Polls /api/health, exposes `online` and emits changes.
 * Backs off while offline so a closed laptop does not spam the console.
 */
export class Connection {
  constructor({ interval = 8000, onchange } = {}) {
    this.online = null;
    this.info = null;
    this._interval = interval;
    this._timer = 0;
    this._listeners = new Set();
    this._failures = 0;
    this._stopped = false;
    if (onchange) this.subscribe(onchange);
  }

  subscribe(fn) {
    this._listeners.add(fn);
    if (this.online !== null) {
      try {
        fn(this.online, { first: true, info: this.info });
      } catch (err) {
        console.error(err);
      }
    }
    return () => this._listeners.delete(fn);
  }

  start() {
    this._stopped = false;
    this.check();
    return this;
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._timer);
  }

  async check() {
    if (this._stopped) return;
    let ok = false;
    let info = null;
    try {
      const health = await api.health();
      ok = !!(health && health.ok);
      if (ok && !this.info) {
        try {
          info = await api.info();
        } catch {
          info = null;
        }
      }
    } catch {
      ok = false;
    }
    this._failures = ok ? 0 : this._failures + 1;

    let changed = false;
    if (ok !== this.online) {
      this.online = ok;
      changed = true;
    }
    if (info && !this.info) {
      this.info = info;
      changed = true;
    }
    if (changed) {
      for (const fn of Array.from(this._listeners)) {
        try {
          fn(ok, { first: false, info: this.info });
        } catch (err) {
          console.error(err);
        }
      }
    }
    const delay = ok ? this._interval : Math.min(30000, this._interval * (this._failures + 1));
    this._timer = setTimeout(() => this.check(), delay);
  }
}
