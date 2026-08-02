# SVGen Studio — SVG Drawing & Animation Maker

> **English** · [中文文档](README_zh.md)

A full-stack SVG illustration and animation studio.

- **Backend** — pure-Python (stdlib only) orchestration with a **native Rust rasterization engine**,
  a standalone CLI + HTTP API, and toggle-able logging.
  Auto-detects the OS (`Windows` / `Linux` / `macOS`), architecture and chooses the platform-appropriate
  filesystem, temporary directories and console encoding. Converts animated SVG (SMIL) into
   **PNG / JPG / BMP / WebP / GIF / MP4 / WebM** using three interchangeable renderers:
   1. **Rust** — the native raster engine (fastest, no browser needed)
   2. **Chrome / Edge / Firefox headless** — maximum fidelity (real fonts, full SVG, CJK text)
   3. **pure-Python rasterizer** — zero-dependency fallback
- **Frontend** — dependency-free vanilla JS/HTML/CSS SPA. Full drawing tools, a keyframe timeline
  (like Adobe Animate), layers, onion skin, canvas + SMIL preview, and a one-click export panel
  that drives the backend.

```
├── backend/
│   ├── svgen.py            # CLI entry:  python svgen.py <command>
│   ├── rust/
│   │   └── svgen_rs/       # native Rust engine (crate → cdylib): raster + GIF
│   └── svgen/              # python package
│       ├── cli.py          #   subcommands: info | validate | render | serve | logs | build-rs
│       ├── api.py          #   HTTP API + static file server
│       ├── renderer.py     #   engine selection (chrome ⇄ rust ⇄ raster), video pipeline
│       ├── rsops.py        #   SVG → binary paint-command stream (geometry in Python)
│       ├── rslib.py        #   loads the Rust engine via ctypes
│       ├── raster.py       #   dependency-free SVG rasterizer (fallback)
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

## Why Rust for rendering

The per-pixel hot loops (scanline polygon filling, gradient sampling, alpha blending,
supersample downsampling) and the animated-GIF encoder (median-cut quantization + LZW)
run in a native Rust `cdylib`. The Python side keeps the parts that are cheap and already
tested — XML parsing, transforms, bezier/arc flattening, SMIL sampling, PNG/JPEG framing —
and streams a compact binary command list to Rust through a C ABI.

Benchmarked on this machine (Windows 11, AMD64):

| Workload | pure Python | Rust engine | speedup |
| --- | --- | --- | --- |
| Still PNG 800×600 (gradient + 30 circles + path) | 3.94 s | 0.047 s | **83×** |
| Video frames 24 fps × 1 s @ 640×360 | 54.91 s | 0.752 s | **73×** |
| Animated GIF 320×240 × 12 frames | >420 s (unusable) | 0.023 s | **>18 000×** |

Geometry extraction and SMIL animation baking are measured at ~10 ms / ~5 ms per frame —
negligible — so they stay in Python. The GIF encoder's Python port was abandoned after
measurement showed a quadratic octree reduction that could not finish a small animation;
the Rust rewrite is the primary GIF path with Python as fallback.

## Requirements

- **Python 3.9+** (no third-party modules needed for core rendering)
- **Rust toolchain (cargo)** — only needed to build the native engine once:
  `python svgen.py build-rs` (or `cargo build --release` in `backend/rust/svgen_rs`).
  Without it the backend transparently falls back to the pure-Python rasterizer.
- **ffmpeg** — only required for `mp4` / `webm` export (fallback `gif` is pure-Python)
- **Chrome / Edge / Firefox (Gecko)** — optional; used for maximum-fidelity rendering
  when present (Firefox detected on Windows/macOS/Linux). The front-end works in any
  modern browser (vanilla JS + Canvas2D + Pointer Events, no SMIL dependency).
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
| `svgen build-rs [--debug]` | Compile the native Rust renderer (requires cargo) |
| `--quiet` / `--verbose` | Per-invocation logging control |

Render options: `--width`, `--height`, `--duration` (video, seconds), `--fps`, `--background`
(hex color), `--engine auto|chrome|firefox|rust|raster`, `--quality`, `-o/--output`.
Engine `auto` prefers Chrome/Edge for fidelity, then Firefox, then Rust, then the Python fallback.

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
4. Frames are rasterized — Rust engine, headless browser, or the built-in rasterizer — and
   piped to ffmpeg for `mp4`/`webm`, or encoded with the pure-Python GIF writer.

## License

[MIT](LICENSE) — fetched from the canonical [Open Source Initiative](https://opensource.org/license/mit)
/ [SPDX MIT](https://spdx.org/licenses/MIT.html) text. Copyright (c) 2026 SVGen Studio contributors.

## Front-end features

- **Drawing tools** — select/move, freehand pen, smooth path, text, rectangle, rounded
  rectangle, ellipse, line, arrow, polygon, star; Shift constrains proportions; fill/stroke
  colors and stroke width; grid; zoom/pan; undo/redo (Ctrl+Z / Ctrl+Y).
- **Animation** — bottom timeline with time ruler, per-shape tracks, draggable/color-coded
  keyframes (X/Y/Rot/Scale/Opacity), play/stop/loop, onion skin, current-frame scrubbing,
  keyboard shortcut `K` to add a keyframe.
- **Layers** — reorder, rename, duplicate, delete, visibility and lock toggles.
- **Export** — format, size, background, duration, fps and render-engine controls (Auto /
  Chrome / Firefox / Rust / Python); live backend capability readout; downloads the finished file.
  Also supports SVG import and scene save/load (`.svgen.json`).
- **Resilience & UX** — live backend health polling with automatic reconnect (export button is
  disabled while offline, toasts on reconnect), auto-save of the scene to `localStorage`
  (restored on reload), toast notifications, a `?` keyboard-shortcuts panel, live zoom readout,
  and an empty-canvas hint.
- **i18n** — the UI ships in **English and 中文** (auto-detects the browser language; toggle in
  the top bar). Text rendered on canvas and in exports uses the **embedded HarmonyOS Sans SC**
  font, bundled as the **original, unmodified TTF files** under `frontend/fonts/`.
  See the [font compliance](#harmonyos-sans-font-compliance) section below.

### HarmonyOS Sans Font Compliance

The HarmonyOS Sans Fonts License Agreement (© 2021 Huawei Device Co., Ltd., full text in
`frontend/fonts/Huawei_HarmonyOS_Sans_License.txt`) grants a royalty-free, worldwide license to
*use, copy, merge, embed, bundle, redistribute and/or sell **unmodified** copies … with any software
except for fonts software*, subject to conditions we satisfy as follows:

| Agreement condition | How it is met |
| --- | --- |
| **Prominent notice that HarmonyOS Sans Fonts are used** | Persistent notice in the app footer; full notice + license reference in the About panel (`?` / F1); `NOTICE` file in the repo; section in both READMEs. |
| **No modifications to the fonts** | The bundled TTFs are the official files, byte-for-byte (SHA-256 verified, see below). No conversion (no WOFF2), no subsetting, no edits. |
| **No stand-alone redistribution / sale** | Fonts are bundled only inside this software; never sold or distributed standalone. |
| **Retain the copyright notice and the Agreement** | The verbatim, complete Agreement (SHA-256-verified against the official text) ships beside the fonts in `frontend/fonts/`; the © 2021 Huawei copyright notice is retained. |

Bundled font checksums (SHA-256, match the officially distributed files):

```
frontend/fonts/HarmonyOS_SansSC_Regular.ttf   984CF609545ACEE8EF060780FB70FC3099B058C0553416331B6E863FDF7C26FA
frontend/fonts/HarmonyOS_SansSC_Bold.ttf      C215D8AB1CB6709FEC2E063F8213E9AF86D7587D345B56325E36B67D6B947D98
frontend/fonts/Huawei_HarmonyOS_Sans_License.txt  (identical to the official Agreement text)
```

*HarmonyOS is a trademark of Huawei Device Co., Ltd.*

---

**[中文文档](README_zh.md) · English**
