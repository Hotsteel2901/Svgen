# SVGen Studio — SVG Drawing & Animation Maker

A full-stack SVG illustration and animation studio.

- **Backend** — pure-Python (stdlib only), standalone CLI + HTTP API, with toggle-able logging.
  Auto-detects the OS (`Windows` / `Linux` / `macOS`), architecture and chooses the platform-appropriate
  filesystem, temporary directories and console encoding. Converts animated SVG (SMIL) into
  **PNG / JPG / BMP / WebP / GIF / MP4 / WebM** using a built-in rasterizer, headless Chrome/Edge
  (when available) and ffmpeg.
- **Frontend** — dependency-free vanilla JS/HTML/CSS SPA. Full drawing tools, a keyframe timeline
  (like Adobe Animate), layers, onion skin, canvas + SMIL preview, and a one-click export panel
  that drives the backend.

```
├── backend/
│   ├── svgen.py            # CLI entry:  python svgen.py <command>
│   └── svgen/              # python package
│       ├── cli.py          #   subcommands: info | validate | render | serve | logs
│       ├── api.py          #   HTTP API + static file server
│       ├── renderer.py     #   engine selection (chrome ⇄ raster), video pipeline
│       ├── raster.py       #   dependency-free SVG rasterizer (scanline, beziers, arcs, gradients, text)
│       ├── animate.py      #   SMIL sampler — bakes <animate> into per-frame SVGs
│       ├── images.py       #   PNG / BMP / GIF encoders + Pillow JPEG/WebP bridge
│       ├── escape.py       #   XML escaping, colors, SVG DOM builder
│       ├── platform.py     #   OS/arch detection + per-OS filesystem helpers
│       └── logs.py         #   toggle-able logger
└── frontend/
    ├── index.html
    ├── css/style.css       # modern dark UI
    └── js/                 # store | draw | tools | timeline | panels | api | app
```

## Requirements

- **Python 3.9+** (no third-party modules needed for core rendering)
- **ffmpeg** — only required for `mp4` / `webm` export (fallback `gif` is pure-Python)
- **Chrome / Edge / Chromium** — optional; used automatically for maximum-fidelity rendering
  when present (falls back to the built-in rasterizer otherwise)
- **Pillow** — optional; used for `jpg` / `webp` stills

The backend reports what is available: `python svgen.py info`.

## Quick start

```bash
# start the studio (API + frontend), opens at http://localhost:8090
cd backend
python svgen.py serve --open

# or, use the backend completely standalone:
python svgen.py info
python svgen.py validate art.svg
python svgen.py render art.svg -f png -o out.png
python svgen.py render art.svg -f mp4 --duration 2 --fps 30 -o out.mp4
cat art.svg | python svgen.py render - -f webp -o out.webp
```

## Backend CLI

| Command | Description |
| --- | --- |
| `svgen info` | Show detected OS, architecture, filesystem mode and tool availability |
| `svgen validate <file.svg>` | Parse + report the SMIL animation timeline |
| `svgen render <file.svg> [-f FORMAT]` | Render to `png/jpg/bmp/webp/gif/mp4/webm`. Input `-` = stdin |
| `svgen serve [--port] [--host] [--static] [--open]` | Start the HTTP API + front-end server |
| `svgen logs on\|off` | Persist the global logging preference |
| `--quiet` / `--verbose` | Per-invocation logging control |

Render options: `--width`, `--height`, `--duration` (video, seconds), `--fps`, `--background`
(hex color), `--engine auto|chrome|raster`, `--quality`, `-o/--output`.

> **Logging:** `svgen serve --logs off` silences log output for a session; `svgen logs on|off`
> persists the choice in `~/.svgen/config.json`. The running server can also be toggled live
> with `POST /api/logs`.

## HTTP API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | heartbeat + version |
| GET | `/api/info` | OS/arch + renderer capabilities |
| GET/POST | `/api/logs` | read / toggle backend logging |
| POST | `/api/validate` | validate SVG + return its animation timeline |
| POST | `/api/export` | render SVG to any format, returns the file |
| GET | `/` | the front-end studio |

`POST /api/export` body: `{ svg, format, width, height, duration, fps, background, engine, quality, name }`.

Example:

```bash
curl -X POST http://localhost:8090/api/export \
  -H 'Content-Type: application/json' \
  -d '{"svg":"<svg xmlns=...>...</svg>","format":"png","width":800,"height":600,"name":"art"}' \
  -o art.png
```

## How animation → video works

1. The front-end stores shapes + keyframes (`x, y, rotation, scale, opacity`).
2. Export serializes them as SVG with SMIL `<animate>` / `<animateTransform>` elements.
3. The backend `animate.py` **bakes** each frame: it samples every animation at time *t*,
   injects the interpolated value into the target element and strips the `<animate>` nodes,
   yielding a static SVG per frame.
4. Frames are rasterized (Chrome/Edge for fidelity, or the built-in rasterizer) and piped to
   ffmpeg for `mp4`/`webm`, or encoded with the pure-Python GIF writer.

## Front-end features

- **Drawing tools** — select/move, freehand pen, smooth path, text, rectangle, rounded
  rectangle, ellipse, line, arrow, polygon, star; Shift constrains proportions; fill/stroke
  colors and stroke width; grid; zoom/pan; undo/redo (Ctrl+Z / Ctrl+Y).
- **Animation** — bottom timeline with time ruler, per-shape tracks, draggable/color-coded
  keyframes (X/Y/Rot/Scale/Opacity), play/stop/loop, onion skin, current-frame scrubbing,
  keyboard shortcut `K` to add a keyframe.
- **Layers** — reorder, rename, duplicate, delete, visibility and lock toggles.
- **Export** — format, size, background, duration, fps and render-engine controls; live
  backend capability readout; downloads the finished file. Also supports SVG import and
  scene save/load (`.svgen.json`).

## Notes

- Ports: the server binds `127.0.0.1:8090` by default.
- Pure-raster text uses a built-in 5×7 font; for real font rendering run with a browser
  engine available (automatic).
