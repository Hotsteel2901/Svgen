"""HTTP API server that the front-end uses to fully control the backend."""

import io
import json
import os
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import platform, __version__
from .logs import log
from . import renderer, animate
from .platform import fs

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
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
    ".ico": "image/x-icon",
    ".map": "application/json",
}

MAX_BODY = 16 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "SVGen/%s" % __version__
    protocol_version = "HTTP/1.1"

    # -- helpers ---------------------------------------------------------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, data, mime, filename=None, code=200):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", mime)
        if filename:
            self.send_header("Content-Disposition",
                             'attachment; filename="%s"' % filename)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > MAX_BODY:
            raise ValueError("body too large")
        body = self.rfile.read(length) if length else b"{}"
        return json.loads(body.decode("utf-8"))

    def _server(self):
        return self.server

    # -- routing ---------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/health":
            return self._json({"ok": True, "version": __version__,
                               "app": "svgen", "service": "svg-studio-backend"})
        if path == "/api/info":
            info = platform.detect()
            caps = platform.capabilities()
            return self._json({"ok": True, **info, "capabilities": caps})
        if path == "/api/logs":
            from .logs import log as logger
            return self._json({"ok": True, "enabled": logger.enabled,
                               "level": {0: "quiet", 1: "info", 2: "debug"}.get(logger.level, "info")})
        if path == "/api/capabilities":
            return self._json({"ok": True, **platform.capabilities()})
        if path.startswith("/api/"):
            return self._json({"ok": False, "error": "not found"}, 404)
        return self._serve_static(path)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/logs":
                from .logs import log as logger
                data = self._read_json()
                if "enabled" in data:
                    logger.set_enabled(bool(data["enabled"]))
                if "level" in data:
                    logger.set_level(data["level"])
                return self._json({"ok": True, "enabled": logger.enabled,
                                   "level": {0: "quiet", 1: "info", 2: "debug"}.get(logger.level, "info")})
            if path == "/api/validate":
                data = self._read_json()
                return self._json(self._validate(data.get("svg", "")))
            if path == "/api/render":
                return self._handle_render(self._read_json())
            if path == "/api/export":
                # same as render but always with attachment + returns meta
                return self._handle_render(self._read_json(), attachment=True)
        except ValueError as exc:
            log.warn("bad request: %s" % exc)
            return self._json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:  # noqa: BLE001
            import traceback
            tb = traceback.format_exc()
            log.error("server error: %s\n%s" % (exc, tb))
            return self._json({"ok": False, "error": str(exc), "trace": tb.splitlines()[-25:]}, 500)
        return self._json({"ok": False, "error": "not found"}, 404)

    # -- handlers ---------------------------------------------------------
    def _validate(self, svg_text):
        from .cli import _validate_svg
        return _validate_svg(svg_text)

    def _handle_render(self, data, attachment=False):
        svg_text = data.get("svg", "")
        if not svg_text:
            raise ValueError("missing svg")
        fmt = data.get("format", "png")
        width = data.get("width")
        height = data.get("height")
        duration = data.get("duration")
        fps = int(data.get("fps", 30) or 30)
        background = data.get("background")
        engine = data.get("engine", "auto")
        quality = data.get("quality")
        name = data.get("name", "export")
        if fmt in renderer.SUPPORTED_VIDEO:
            if duration is None:
                try:
                    dur = animate.timeline_info(svg_text).get("duration", 2.0)
                except Exception:
                    dur = 2.0
                duration = float(dur or 2.0)
        result = renderer.render(svg_text, fmt, width, height, duration, fps,
                                 background, engine, quality)
        safe = "".join(ch for ch in name if ch.isalnum() or ch in "_- ") or "export"
        filename = "%s.%s" % (safe, fmt)
        return self._bytes(result, MIME.get("." + fmt, "application/octet-stream"),
                           filename if attachment else None)

    # -- static ------------------------------------------------------------
    def _serve_static(self, path):
        root_dir = self.server.static_dir
        if path == "/" or path == "":
            path = "/index.html"
        rel = urllib.parse.unquote(path).lstrip("/")
        full = os.path.normpath(os.path.join(root_dir, rel))
        if not (full == root_dir or full.startswith(root_dir + os.sep)) or not os.path.isfile(full):
            # fallback to index for SPA-ish routing
            idx = os.path.join(root_dir, "index.html")
            if os.path.isfile(idx):
                return self._bytes(fs.read_bytes(idx), MIME[".html"])
            return self._json({"ok": False, "error": "static dir not found"}, 404)
        ext = os.path.splitext(full)[1].lower()
        body = fs.read_bytes(full)
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        if ext in (".woff2", ".woff", ".ttf", ".otf"):
            # fonts are immutable and large — cache aggressively
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def _default_static_dir():
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (os.path.join(here, "..", "..", "frontend"),
                 os.path.join(here, "..", "frontend"),
                 os.path.join(here, "frontend")):
        cand = os.path.abspath(cand)
        if os.path.isdir(cand) and os.path.isfile(os.path.join(cand, "index.html")):
            return cand
    return None


def make_server(host="127.0.0.1", port=8090, static_dir=None, bind=True):
    if static_dir is None:
        static_dir = _default_static_dir()
    if static_dir:
        static_dir = os.path.abspath(static_dir)
        log.info("serving front-end from %s" % static_dir)
    server = ThreadingHTTPServer((host, port), Handler)
    server.static_dir = static_dir
    server.host = host
    server.port = port
    return server
