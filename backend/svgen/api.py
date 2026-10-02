"""HTTP API + static file server for the studio front-end.

Endpoints
---------
GET    /api/health              liveness probe (used by the front-end)
GET    /api/info                platform, capabilities and engine chain
GET    /api/engines             the render engine report on its own
GET    /api/logs                current logging state
POST   /api/logs                {enabled: bool, level: "quiet|info|debug"}
POST   /api/validate            {svg} -> animation timeline + warnings
POST   /api/render              {svg, format, ...} -> bytes (synchronous)
POST   /api/export              same, always with a download filename
POST   /api/jobs                {svg, format, ...} -> {id} (asynchronous)
GET    /api/jobs                list recent jobs
GET    /api/jobs/<id>           job status + progress
GET    /api/jobs/<id>/events    Server-Sent Events progress stream
GET    /api/jobs/<id>/result    the finished bytes
DELETE /api/jobs/<id>           cancel a job
GET    /                        the studio

The synchronous endpoints exist for small stills; anything animated should go
through /api/jobs so the UI can show progress and allow cancellation.
"""

import gzip
import json
import os
import re
import threading
import time
import urllib.parse

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import platform, jobs as jobs_mod, renderer, animate, __version__
from .logs import log
from .platform import fs

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".ico": "image/x-icon",
}

IMMUTABLE_EXT = (".woff2", ".woff", ".ttf", ".otf")

MAX_BODY = 32 * 1024 * 1024
SSE_INTERVAL = 0.35
SSE_HEARTBEAT = 10.0

_JOB_PATH = re.compile(r"^/api/jobs/([A-Za-z0-9_-]{1,64})(/events|/result)?$")


class ApiError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


class Handler(BaseHTTPRequestHandler):
    server_version = "SVGen/%s" % __version__
    protocol_version = "HTTP/1.1"
    # Silence the default per-request stderr noise; we log through `log`.
    disable_nagle_algorithm = True

    # -- plumbing --------------------------------------------------------
    def log_message(self, fmt, *args):  # noqa: A003 - stdlib signature
        log.debug("%s - %s" % (self.address_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, message, code=400, **extra):
        payload = {"ok": False, "error": str(message)}
        payload.update(extra)
        self._json(payload, code)

    def _bytes(self, data, mime, filename=None, code=200, cache="no-store"):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", mime)
        if filename:
            quoted = urllib.parse.quote(filename)
            self.send_header(
                "Content-Disposition",
                'attachment; filename="%s"; filename*=UTF-8\'\'%s' % (filename, quoted),
            )
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _read_body(self):
        raw_len = self.headers.get("Content-Length")
        try:
            length = int(raw_len) if raw_len else 0
        except ValueError:
            self.close_connection = True
            raise ApiError("bad Content-Length")
        if length < 0:
            # A negative length would make rfile.read() block until the client
            # hangs up, pinning a worker thread.
            self.close_connection = True
            raise ApiError("bad Content-Length")
        if length > MAX_BODY:
            self.close_connection = True
            raise ApiError("request body too large (limit %d bytes)" % MAX_BODY, 413)
        if not length:
            return {}
        data = self.rfile.read(length)
        if not data:
            return {}
        try:
            parsed = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError("invalid JSON body: %s" % exc)
        if not isinstance(parsed, dict):
            raise ApiError("JSON body must be an object")
        return parsed

    # -- verbs -----------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path.startswith("/api/"):
                return self._api_get(path)
            return self._serve_static(path)
        except ApiError as exc:
            return self._error(exc, exc.code)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:  # noqa: BLE001
            import traceback

            log.error("GET %s failed: %s\n%s" % (path, exc, traceback.format_exc()))
            return self._error("internal error: %s" % exc, 500)

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            match = _JOB_PATH.match(path)
            if match and not match.group(2):
                job = jobs_mod.manager().get(match.group(1))
                if not job:
                    return self._error("no such job", 404)
                jobs_mod.manager().cancel(job.id)
                return self._json({"ok": True, "job": job.to_dict()})
            return self._error("not found", 404)
        except Exception as exc:  # noqa: BLE001
            return self._error(str(exc), 500)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            data = self._read_body()
            return self._api_post(path, data)
        except ApiError as exc:
            log.warn("bad request %s: %s" % (path, exc))
            return self._error(exc, exc.code)
        except renderer.RenderError as exc:
            log.warn("render error: %s" % exc)
            return self._error(str(exc), 422)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:  # noqa: BLE001
            import traceback

            tb = traceback.format_exc()
            log.error("POST %s failed: %s\n%s" % (path, exc, tb))
            return self._error("internal error: %s" % exc, 500)

    # -- GET routes ------------------------------------------------------
    def _api_get(self, path):
        if path == "/api/health":
            return self._json({
                "ok": True,
                "version": __version__,
                "app": "svgen",
                "service": "svg-studio-backend",
                "time": time.time(),
            })
        if path == "/api/info":
            return self._json({"ok": True, **self._info()})
        if path == "/api/engines":
            return self._json({"ok": True, **renderer.engine_report()})
        if path == "/api/logs":
            return self._json({"ok": True, **self._log_state()})
        if path == "/api/jobs":
            return self._json({"ok": True, "jobs": jobs_mod.manager().list()})

        match = _JOB_PATH.match(path)
        if match:
            job_id, sub = match.group(1), match.group(2)
            job = jobs_mod.manager().get(job_id)
            if not job:
                return self._error("no such job", 404)
            if sub == "/events":
                return self._sse(job)
            if sub == "/result":
                payload = job.to_dict()
                if job.state != jobs_mod.DONE:
                    return self._error("job is %s" % job.state, 409, job=payload)
                return self._bytes(job.result or b"", job.mime, job.filename)
            return self._json({"ok": True, "job": job.to_dict(include_result=True)})

        return self._error("not found", 404)

    # -- POST routes -----------------------------------------------------
    def _api_post(self, path, data):
        if path == "/api/logs":
            from .logs import log as logger

            if "enabled" in data:
                logger.set_enabled(bool(data["enabled"]))
            if "level" in data:
                logger.set_level(data["level"])
            return self._json({"ok": True, **self._log_state()})

        if path == "/api/validate":
            return self._json(self._validate(data.get("svg", "")))

        if path in ("/api/render", "/api/export"):
            request = self._render_request(data)
            if path == "/api/export" and data.get("async"):
                job = jobs_mod.manager().submit(request)
                return self._json({"ok": True, "job": job.to_dict()}, 202)
            result = renderer.render(
                request["svg"], request["format"], request["width"], request["height"],
                request["duration"], request["fps"], request["background"],
                request["engine"], request["quality"],
            )
            mime = jobs_mod.MIME_BY_EXT.get(request["format"], "application/octet-stream")
            filename = "%s.%s" % (request["name"], request["format"])
            return self._bytes(result, mime, filename if path == "/api/export" else None)

        if path == "/api/jobs":
            request = self._render_request(data)
            job = jobs_mod.manager().submit(request)
            return self._json({"ok": True, "job": job.to_dict()}, 202)

        return self._error("not found", 404)

    # -- shared handlers -------------------------------------------------
    def _info(self):
        info = platform.detect()
        caps = platform.capabilities()
        return {
            **info,
            "backend": __version__,
            "capabilities": caps,
            "engines": renderer.engine_report(),
            "formats": {
                "still": list(renderer.SUPPORTED_STILL),
                "video": list(renderer.SUPPORTED_VIDEO),
            },
            "limits": {
                "max_body": MAX_BODY,
                "max_dimension": renderer.MAX_DIMENSION,
                "max_fps": 120,
            },
        }

    def _log_state(self):
        from .logs import log as logger

        return {
            "enabled": logger.enabled,
            "level": {0: "quiet", 1: "info", 2: "debug"}.get(logger.level, "info"),
        }

    def _validate(self, svg_text):
        if not svg_text:
            raise ApiError("missing svg")
        if not isinstance(svg_text, str):
            raise ApiError("svg must be a string")
        _guard_svg(svg_text)
        result = animate.timeline_info(svg_text)
        if not result.get("ok"):
            return result
        result["warnings"] = _svg_warnings(svg_text)
        return result

    def _render_request(self, data):
        svg_text = data.get("svg")
        if not svg_text or not isinstance(svg_text, str):
            raise ApiError("missing svg")
        _guard_svg(svg_text)
        fmt = str(data.get("format") or "png").lower().lstrip(".")
        if fmt not in renderer.SUPPORTED:
            raise ApiError("unsupported format %r" % fmt)
        fps = _int_or(data.get("fps"), 30, 1, 120)
        width = _opt_int(data.get("width"), 1, renderer.MAX_DIMENSION)
        height = _opt_int(data.get("height"), 1, renderer.MAX_DIMENSION)
        quality = _opt_int(data.get("quality"), 1, 100)
        duration = data.get("duration")
        if duration is not None:
            try:
                duration = float(duration)
            except (TypeError, ValueError):
                raise ApiError("duration must be a number")
            if duration <= 0 or duration > 600:
                raise ApiError("duration must be between 0 and 600 seconds")
        if fmt in renderer.SUPPORTED_VIDEO and duration is None:
            try:
                duration = float(animate.timeline_info(svg_text).get("duration") or 3.0)
            except Exception:
                duration = 3.0
            duration = max(0.05, min(600.0, duration))

        engine = str(data.get("engine") or "auto")
        if engine not in ("auto", "chrome", "firefox", "rust", "raster"):
            raise ApiError("unknown engine %r" % engine)

        background = data.get("background")
        if background in ("", "transparent", "none"):
            background = None
        elif background is not None:
            from .escape import parse_color

            if parse_color(background) is None:
                raise ApiError("background must be a CSS colour or null")

        name = _safe_name(data.get("name"))
        return {
            "svg": svg_text,
            "format": fmt,
            "width": width,
            "height": height,
            "duration": duration,
            "fps": fps,
            "quality": quality,
            "engine": engine,
            "background": background,
            "name": name,
        }

    # -- SSE -------------------------------------------------------------
    def _sse(self, job):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        done = threading.Event()
        state = {"payload": None}

        def on_change(j):
            state["payload"] = j.to_dict()
            if j.terminal:
                done.set()

        job.subscribe(on_change)
        state["payload"] = job.to_dict()
        if job.terminal:
            done.set()

        try:
            last_sent = None
            last_beat = time.time()
            while True:
                payload = state["payload"]
                if payload is not None and payload != last_sent:
                    self._chunk(b"data: " + json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n\n")
                    last_sent = payload
                    last_beat = time.time()
                if done.is_set() and payload == state["payload"]:
                    self._chunk(b"event: end\ndata: {}\n\n")
                    break
                if time.time() - last_beat > SSE_HEARTBEAT:
                    self._chunk(b": ping\n\n")
                    last_beat = time.time()
                done.wait(SSE_INTERVAL)
            self._chunk_end()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            job.unsubscribe(on_change)
            self.close_connection = True

    def _chunk(self, payload):
        self.wfile.write(b"%x\r\n" % len(payload) + payload + b"\r\n")
        self.wfile.flush()

    def _chunk_end(self):
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

    # -- static ----------------------------------------------------------
    def _serve_static(self, path):
        root_dir = getattr(self.server, "static_dir", None)
        if not root_dir:
            return self._error("front-end directory not found", 404)

        if path in ("/", ""):
            path = "/index.html"
        rel = urllib.parse.unquote(path).lstrip("/").replace("\\", "/")
        if ".." in rel.split("/"):
            return self._error("forbidden", 403)

        full = os.path.normpath(os.path.join(root_dir, rel))
        if not (full == root_dir or full.startswith(root_dir + os.sep)) or not os.path.isfile(full):
            # SPA-ish fallback, but never for asset-looking paths.
            if os.path.splitext(rel)[1]:
                return self._error("not found: %s" % rel, 404)
            index = os.path.join(root_dir, "index.html")
            if os.path.isfile(index):
                return self._bytes(fs.read_bytes(index), MIME[".html"])
            return self._error("front-end not built", 404)

        ext = os.path.splitext(full)[1].lower()
        body = fs.read_bytes(full)
        cache = "public, max-age=31536000, immutable" if ext in IMMUTABLE_EXT else "no-store"
        if self._send_gzip(body, ext):
            return
        self._bytes(body, MIME.get(ext, "application/octet-stream"), None, 200, cache)

    def _send_gzip(self, body, ext):
        """Compress text assets when the client accepts it.

        Must be the *gzip* container (magic 0x1f 0x8b) — `zlib.compress`
        produces a zlib stream, which browsers reject outright with
        ERR_CONTENT_DECODING_FAILED when labelled as gzip.
        """
        if ext not in (".html", ".css", ".js", ".mjs", ".json", ".svg", ".map", ".txt"):
            return False
        if len(body) < 1024:
            return False
        accept = self.headers.get("Accept-Encoding", "")
        if "gzip" not in accept.lower():
            return False
        packed = gzip.compress(body, 6)
        if len(packed) >= len(body):
            return False
        cache = "public, max-age=31536000, immutable" if ext in IMMUTABLE_EXT else "no-store"
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(packed)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(packed)
        return True


def _guard_svg(svg_text):
    """Reject documents that would make the parser do unreasonable work.

    Python's ElementTree expands internal DTD entities, so a few hundred bytes
    of nested entity definitions can balloon into hundreds of megabytes. There
    is no legitimate reason for a drawing to arrive with a DOCTYPE.
    """
    head = svg_text[:4096].lower()
    if "<!doctype" in head or "<!entity" in head:
        raise ApiError("DOCTYPE/ENTITY declarations are not accepted")
    if len(svg_text) > MAX_BODY:
        raise ApiError("svg too large")
    return svg_text


def _svg_warnings(svg_text):
    """Cheap sanity checks surfaced to the export panel."""
    out = []
    lowered = svg_text.lower()
    if "<svg" not in lowered:
        out.append("no <svg> root element")
    if "xmlns" not in lowered:
        out.append("missing xmlns — some renderers will reject this document")
    if "font-family" not in lowered and "text" in lowered:
        out.append("text is present without an explicit font-family")
    if "url(#" in lowered and "<defs" not in lowered and "gradient" not in lowered:
        out.append("a paint server is referenced but no <defs> found")
    return out


def _safe_name(name):
    text = "" if name is None else str(name)
    cleaned = "".join(ch for ch in text if ch.isalnum() or ch in "_- .")
    cleaned = cleaned.strip().strip(".")
    return cleaned[:80] or "artwork"


def _int_or(value, default, lo, hi):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _opt_int(value, lo, hi):
    if value is None or value == "":
        return None
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        raise ApiError("expected a number, got %r" % (value,))
    return max(lo, min(hi, n))


def _default_static_dir():
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (
        os.path.join(here, "..", "..", "frontend"),
        os.path.join(here, "..", "frontend"),
        os.path.join(here, "frontend"),
    ):
        cand = os.path.abspath(cand)
        if os.path.isdir(cand) and os.path.isfile(os.path.join(cand, "index.html")):
            return cand
    return None


class StudioServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def __init__(self, addr, handler, static_dir=None):
        super().__init__(addr, handler)
        self.static_dir = static_dir
        # server_address holds the *actual* bound address, which matters when
        # the caller asked for port 0.
        self.host, self.port = self.server_address[0], self.server_address[1]


def make_server(host="127.0.0.1", port=8090, static_dir=None, bind=True):
    if static_dir is None:
        static_dir = _default_static_dir()
    if static_dir:
        static_dir = os.path.abspath(static_dir)
        log.info("serving front-end from %s" % static_dir)
    else:
        log.warn("no front-end directory found — API only")

    last_error = None
    for candidate in range(port, port + 12):
        try:
            return StudioServer((host, candidate), Handler, static_dir)
        except OSError as exc:
            last_error = exc
            log.warn("port %d unavailable (%s)" % (candidate, exc))
    raise OSError("could not bind %s:%d-%d: %s" % (host, port, port + 11, last_error))
