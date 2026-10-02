# SVGen Studio — SVG Drawing & Animation Studio

> [中文文档](README_zh.md) · **English**

A complete SVG illustration and animation studio: **pure-Python backend, a native
Rust rasterizer, and a fully rewritten modular front-end**.

Draw vector artwork, animate it on a keyframe timeline, then export
**PNG / JPG / BMP / WebP / GIF / MP4 / WebM / SVG**.

```
┌──────────────── front-end (dependency-free ES modules) ────────────────┐
│  canvas editing  ·  keyframe timeline  ·  layers  ·  export            │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │  HTTP /api (sync stills, async jobs, SSE progress)
┌────────────────────────────────┴───────────────────────────────────────┐
│  Python orchestration: SVG parsing · SMIL baking · geometry · encoding │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │  compact binary paint-command stream (C ABI)
┌────────────────────────────────┴───────────────────────────────────────┐
│  Rust raster core: scanline fill · gradients · blending · GIF encoder  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Quick start

```bash
cd backend
python svgen.py serve --open      # opens http://localhost:8090
```

The backend also works completely standalone:

```bash
python svgen.py info                             # platform and tool detection
python svgen.py engines                          # render chain and formats
python svgen.py validate art.svg                 # validate + animation timeline
python svgen.py render art.svg -f png -o out.png
python svgen.py render art.svg -f mp4 --duration 2 --fps 30 -o out.mp4
python svgen.py render art.svg -f gif --width 640 --height 360 -o out.gif
cat art.svg | python svgen.py render - -f webp -o out.webp
python svgen.py build-rs                         # compile the native engine (needs cargo)
```

## Requirements

| Component | Needed? | Notes |
| --- | --- | --- |
| **Python 3.9+** | required | core rendering has no third-party dependencies |
| **cargo** | optional | one-time build of the native engine; falls back automatically |
| **ffmpeg** | optional | only for `mp4` / `webm` (`gif` does not need it) |
| **Chrome / Edge / Firefox** | optional | maximum fidelity (real fonts, CJK text, full SVG) |
| **Pillow** | optional | `jpg` / `webp` stills and test assertions |

`python svgen.py info` reports exactly what this machine can do.

---

## Front-end (rewritten from scratch)

ES modules, no framework, no build step, no third-party code. Eight global
scripts became 33 modules with a single clear responsibility each.

```
frontend/
├── index.html
├── css/
│   ├── tokens.css        design tokens: colour / type / space / motion / themes
│   ├── base.css          reset, typography, focus rings, scrollbars, a11y
│   ├── components.css    buttons, fields, sliders, swatches, menus, modals, toasts
│   ├── layout.css        app shell grid: topbar / rail / stage / dock / timeline
│   ├── panels.css        inspector, layers, export, about
│   └── timeline.css      transport, ruler, tracks, keyframes
└── js/
    ├── main.js           entry: assembles the shell, installs the key map
    ├── core/             —— engine, no DOM knowledge
    │   ├── scene.js        document model, selection, mutations, snapshots
    │   ├── history.js      undo/redo (snapshot based, merges continuous edits)
    │   ├── elements.js     element types, geometry, bounds, hit testing, paths
    │   ├── anim.js         keyframes, easing (cubic-bezier solver), sampling
    │   ├── transform.js    2-D affine helpers
    │   ├── render.js       canvas renderer (checkerboard, onion skin, handles)
    │   ├── svg-export.js   scene → SVG (SMIL, sampled to the backend contract)
    │   ├── svg-import.js   SVG → scene (transforms, styles, `<use>`)
    │   ├── svg-path.js     path parsing (M/L/H/V/C/S/Q/T/A/Z, arc expansion)
    │   ├── color.js        colour parsing and conversion
    │   ├── util.js         shared helpers
    │   └── emitter.js      tiny event emitter
    ├── ui/               —— panels and shell
    │   ├── app.js          the app object: document, history, playback, files, backend
    │   ├── stage.js        viewport, zoom, pan, render loop
    │   ├── dock.js         right-hand panel host
    │   ├── inspector.js    shape / transform / appearance / text / animation / arrange
    │   ├── layers.js       layer list (drag reorder, visibility, lock, rename)
    │   ├── exportpane.js   export (format, engine, progress, cancel)
    │   ├── infopane.js     about, backend status, font notice, shortcuts
    │   ├── timeline.js     transport, per-property tracks, keyframes, playhead
    │   ├── rail.js         left tool rail and paint swatches
    │   ├── topbar.js       document bar
    │   ├── controls.js     reusable controls (scrub fields, sliders, swatches…)
    │   ├── icons.js        inline SVG icon set (24×24, no emoji)
    │   └── shell.js        toasts, modals, menus, tooltips, theme
    ├── tools/index.js    interaction: select, transform, draw, curve, eyedropper
    ├── net/api.js        backend client (job queue + SSE + reconnect)
    └── i18n/index.js     Chinese + English (Chinese by default)
```

### Design language

- **One accent**: lime `#cbff4d`, reserved for state and primary actions
- **Neutral graphite** surfaces so the artwork, not the chrome, is the subject
- **Hand-drawn line icons** on a 24×24 grid — no emoji, no icon font
- **Hairline separators** instead of heavy shadows; elevation only on overlays
- **Restrained motion**: 90–240 ms, fully disabled under `prefers-reduced-motion`
- **Dark and light themes**, token-driven, one click apart
- Proper `:focus-visible` rings and keyboard reachability throughout

### Features

**Drawing** — select / pan / eyedropper, freehand, curve (click-by-click), text,
rectangle, rounded rectangle, ellipse, line, arrow, polygon, star; `Shift`
constrains, `Alt` draws from the centre, grid snapping.

**Editing** — multi-select, marquee, drag-to-reorder, copy/paste, duplicate,
align (6 ways), flip, z-order, undo/redo with automatic coalescing, arrow-key
nudging.

**Transform handles** — eight resize handles plus a rotate handle. Resizing a
*rotated* shape keeps the opposite corner pinned: the maths runs in the
element's own unrotated, unscaled space.

**Layers** — drag to restack, show/hide, lock, double-click to rename, keyframe
counts, context menu.

**Timeline** — transport, ruler with frame and second ticks, collapsible
per-property tracks, colour-coded keyframe diamonds, drag to retime,
right-click for easing/delete, scrub, onion skin, loop, snap to frames.

**Export** — `SVG / PNG / JPG / WebP / BMP / GIF / MP4 / WebM`, canvas size and
presets, background colour or transparency, duration / fps / quality, engine
choice, live capability readout, and **real progress with a cancel button**
(video renders run as backend jobs).

**Input capture** — the studio takes the mouse and keyboard back from the
browser: the canvas, layers, timeline and text fields each have **their own
right-click menu** (delete, copy, paste, reorder, align…), `Ctrl+P` / `Ctrl+F` /
`Ctrl+S` / `F3` are intercepted, `Ctrl+wheel` belongs to the canvas, middle-drag
pans, and dropping a file imports it instead of navigating away.

**Brush & canvas** — the brush panel controls size, opacity, smoothing and a
stabiliser, with a footprint ring under the cursor; the pen **stays active
between strokes**; and the inspector's empty state is the canvas itself, with
one-click fill (`Shift+B`) or back to transparent.

**Colour as a language** — a property has the same colour in the inspector, on
its timeline track and on its keyframes; layer rows and timeline rows carry the
artwork's own colour; and the tool rail groups are colour-banded (select =
neutral, draw = cyan, shapes = amber, paint = lime). Nothing has to be
memorised.

**Project files** — save/open `.svgen.json`, drag-and-drop import, browser
autosave, SVG import.

**i18n** — Chinese (default) and English, one click in the top bar, remembered.

### Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `V` | Select | `R` / `U` | Rectangle / rounded |
| `P` | Freehand | `O` | Ellipse |
| `B` | Curve | `L` / `A` | Line / arrow |
| `T` | Text | `G` / `S` | Polygon / star |
| `H` | Pan | `I` | Eyedropper |
| `Space` | Play / pause | `K` | Keyframe at the playhead |
| `[` / `]` | Previous / next keyframe | `Home` / `End` | Start / end |
| `Ctrl+Z` | Undo | `Ctrl+Shift+Z` | Redo |
| `Ctrl+D` | Duplicate | `Delete` | Delete |
| `Ctrl+A` | Select all | `Ctrl+C/V` | Copy / paste |
| `Ctrl+S` | Save project | `Ctrl+O` | Open project |
| `Shift+1` | Fit to window | `Ctrl+0` | Actual size |
| `Ctrl+'` | Grid | `Ctrl+Shift+O` | Onion skin |
| `?` / `F1` | About & shortcuts | `Esc` | Cancel the current gesture |

Mouse: middle-drag or hold `Space` to pan · `Ctrl+wheel` zooms at the cursor ·
drag on empty canvas to marquee · `Shift+click` adds to the selection.

---

## Backend

### Render chain

Tried in order, falling through on failure:

1. **Headless browser** (Chrome / Edge / Firefox) — maximum fidelity: real
   fonts, CJK, the full SVG feature set
2. **Native Rust engine** — no browser needed; geometry, transforms and gradient
   resolution are shared with the Python reference
3. **Pure-Python rasterizer** — zero-dependency fallback, always available

### CLI

| Command | Description |
| --- | --- |
| `svgen info` | OS, architecture, filesystem mode, tool availability |
| `svgen engines` | render chain, available formats, engine paths |
| `svgen validate <file.svg>` | parse and report the SMIL timeline |
| `svgen render <file.svg> [-f FORMAT]` | render to `png/jpg/bmp/webp/gif/mp4/webm`; `-` is stdin |
| `svgen serve [--port] [--host] [--static] [--open]` | HTTP API + front-end |
| `svgen logs on\|off` | persist the logging preference |
| `svgen build-rs [--debug]` | compile the native Rust engine |

Render options: `--width`, `--height`, `--duration`, `--fps`, `--background`,
`--engine auto|chrome|firefox|rust|raster`, `--quality`, `-o/--output`.

### HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness (the front-end polls this) |
| GET | `/api/info` | platform, capabilities, engine chain, limits |
| GET | `/api/engines` | engine report |
| GET/POST | `/api/logs` | read / toggle logging |
| POST | `/api/validate` | validate SVG, return the timeline and warnings |
| POST | `/api/render` | synchronous render, returns bytes |
| POST | `/api/export` | synchronous render with a download filename |
| POST | `/api/jobs` | **asynchronous render** → `{id}` |
| GET | `/api/jobs` | recent jobs |
| GET | `/api/jobs/<id>` | job status and progress |
| GET | `/api/jobs/<id>/events` | **Server-Sent Events progress stream** |
| GET | `/api/jobs/<id>/result` | fetch the finished bytes |
| DELETE | `/api/jobs/<id>` | cancel |
| GET | `/` | the studio |

`POST /api/jobs` body:
`{ svg, format, width, height, duration, fps, background, engine, quality, name }`

```bash
# synchronous still
curl -X POST http://localhost:8090/api/export \
  -H 'Content-Type: application/json' \
  -d '{"svg":"<svg xmlns=...>...</svg>","format":"png","width":800,"height":600,"name":"art"}' \
  -o art.png

# asynchronous video with progress
ID=$(curl -s -X POST http://localhost:8090/api/jobs \
  -H 'Content-Type: application/json' \
  -d @job.json | python -c "import sys,json;print(json.load(sys.stdin)['job']['id'])")
curl -N http://localhost:8090/api/jobs/$ID/events
curl -o out.mp4 http://localhost:8090/api/jobs/$ID/result
```

### How animation becomes video

1. The front-end stores shapes plus keyframes (`x, y, rotation, scaleX,
   scaleY, opacity, strokeWidth`).
2. Export serializes them as SVG: one `<g>` per transform component, one
   `<animateTransform>` per component, each naming its target through
   `data-svgen-parent`.
3. **Interpolation happens in the front-end**: the timeline is sampled uniformly
   at the export frame rate and the real easing curves are baked into the
   `values` lists. Chrome, Firefox, Rust and Python therefore see the identical
   motion — none of them has to understand `keySplines`.
4. The backend **bakes** each frame: sample every animation, write the value
   onto its target, strip the `<animate>` nodes, and hand a static SVG to the
   rasterizer.
5. Frames are rasterized and streamed into ffmpeg (`mp4` / `webm`) or the GIF
   encoder.

---

## Tests

```bash
cd backend
python tests/test_pipeline.py          # 34 backend checks (baking, engines, formats, edges, regressions)
python tests/test_pipeline.py --fast   # skips the slower video renders
python tests/test_studio_ui.py         # real browser end-to-end (needs playwright + a running server)

node frontend/tests/units.mjs          # 38 pure-function unit checks (no browser)
```

Three layers, and each one has caught something the others could not:

- **Units** (`frontend/tests/units.mjs`) run in milliseconds and name the exact
  function. Resize geometry, the bezier solver, path parsing and colour
  conversion are proved here.
- **End-to-end** (`test_studio_ui.py`) drives **real mouse events**: draw,
  keyframe, drag a resize handle, click Copy/Duplicate/Delete in the context
  menu, export PNG/GIF/SVG. It asserts on **canvas pixels** and on **zero
  browser-console errors**.
- **Backend** (`test_pipeline.py`) covers baking, engine agreement, formats and
  input validation.

Three real lessons, each now a regression test: counting elements instead of
pixels hides a stroke drawn thirty thousand units off-canvas; `element.click()`
instead of a real mouse hides a stray listener that dismisses a menu before
mouseup; hand-built test data instead of the real constructor hides a gesture
record missing a field.

Regressions covered: SMIL frames actually differ, `fill="remove"` restores the
base value, a finite `repeatCount` loops, opacity fades instead of cutting, an
opaque background no longer erases the drawing, `stroke-dasharray` no longer
hangs, Rust and Python agree pixel-for-pixel on antialiased edges, an oversized
canvas returns an error instead of aborting the process, and NaN coordinates no
longer kill the engine.

---

## HarmonyOS Sans font compliance

The HarmonyOS Sans Fonts License Agreement (© 2021 Huawei Device Co., Ltd.,
full text in `frontend/fonts/Huawei_HarmonyOS_Sans_License.txt`) grants a
royalty-free, worldwide license to *use, copy, merge, embed, bundle,
redistribute and/or sell **unmodified** copies … with any software except for
fonts software*, subject to conditions we satisfy as follows:

| Agreement condition | How it is met |
| --- | --- |
| **Prominent notice that HarmonyOS Sans Fonts are used** | Persistent notice in the status bar; full notice + license reference in the About panel (`?` / F1); `NOTICE` file in the repo; section in both READMEs |
| **No modifications to the fonts** | The bundled TTFs are the official files, byte-for-byte (SHA-256 verified). No conversion (no WOFF2), no subsetting, no edits |
| **No stand-alone redistribution / sale** | Fonts are bundled only inside this software; never sold or distributed standalone |
| **Retain the copyright notice and the Agreement** | The verbatim, complete Agreement ships beside the fonts; the © 2021 Huawei copyright notice is retained |

Bundled font checksums (SHA-256, matching the officially distributed files):

```
frontend/fonts/HarmonyOS_SansSC_Regular.ttf   984CF609545ACEE8EF060780FB70FC3099B058C0553416331B6E863FDF7C26FA
frontend/fonts/HarmonyOS_SansSC_Bold.ttf      C215D8AB1CB6709FEC2E063F8213E9AF86D7587D345B56325E36B67D6B947D98
frontend/fonts/Huawei_HarmonyOS_Sans_License.txt  (identical to the official Agreement text)
```

*HarmonyOS is a trademark of Huawei Device Co., Ltd.*

---

## Performance

The native engine takes the real hot loops: scanline polygon filling, gradient
sampling, alpha blending, supersample downsampling, and the animated-GIF encoder
(median-cut quantization + LZW).

| Workload | pure Python | Rust engine | speedup |
| --- | --- | --- | --- |
| Still PNG 800×600 (gradient + 30 circles + path) | 3.94 s | 0.047 s | **83×** |
| Video 24 fps × 1 s @ 640×360 | 54.91 s | 0.752 s | **73×** |
| Animated GIF 320×240 × 12 frames | unusable | 0.023 s | **>18 000×** |

Geometry extraction and SMIL baking measure at ~10 ms / ~5 ms per frame —
negligible — so they stay in Python.

---

## Known limitations

- The built-in Python and Rust rasterizers draw text with a 7×7 bitmap font:
  ASCII works, **CJK comes out blank**. Use the browser engine when you need
  Chinese text (the default `auto` prefers it when installed).
- Those two engines also do not support cross-subpath holes (even-odd),
  `clip-path`, `mask` or `<image>`.
- Gradients are approximated by the midpoint of their end stops on import —
  the front-end model currently stores solid fills only.
- Dashed strokes on paths are measured in buffer space, so they render at
  roughly `1/SUPERSAMPLE` of their nominal length.

## License

[MIT](LICENSE) — text fetched from the canonical
[Open Source Initiative](https://opensource.org/license/mit) /
[SPDX MIT](https://spdx.org/licenses/MIT.html) sources.
Copyright (c) 2026 SVGen Studio contributors.

---

**[中文文档](README_zh.md) · English**
