"""End-to-end checks for the SVGen backend.

Run it directly — no test framework required:

    cd backend
    python tests/test_pipeline.py           # everything
    python tests/test_pipeline.py --fast    # skip the slow video renders

Every check prints PASS/FAIL/SKIP and the script exits non-zero if anything
failed, so it works as a pre-commit gate as well as a debugging tool.
"""

import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from svgen import animate, images, platform, renderer, rslib  # noqa: E402
from svgen.escape import parse_color  # noqa: E402

FAST = "--fast" in sys.argv

_results = []


def check(name, fn):
    start = time.time()
    try:
        detail = fn()
        _results.append(("PASS", name, detail or "", time.time() - start))
    except Skip as exc:
        _results.append(("SKIP", name, str(exc), time.time() - start))
    except Exception as exc:  # noqa: BLE001
        import traceback

        _results.append(("FAIL", name, "%s: %s" % (type(exc).__name__, exc), time.time() - start))
        if os.environ.get("SVGEN_TEST_VERBOSE"):
            traceback.print_exc()


class Skip(Exception):
    pass


def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------

ANIMATED_SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect x="0" y="0" width="200" height="120" fill="#101114"/>
  <g id="e1p" transform="translate(40,60)">
    <animateTransform id="e1pa" data-svgen-parent="e1p" attributeName="transform"
      type="translate" values="40,60;160,60;40,60" keyTimes="0;0.5;1"
      dur="1s" begin="0s" repeatCount="1" fill="freeze" calcMode="linear" />
    <g id="e1r" transform="rotate(0)">
      <animateTransform id="e1ra" data-svgen-parent="e1r" attributeName="transform"
        type="rotate" values="0;180;360" keyTimes="0;0.5;1"
        dur="1s" begin="0s" repeatCount="1" fill="freeze" calcMode="linear" />
      <g id="e1o" opacity="1">
        <animate id="e1oa" data-svgen-parent="e1o" attributeName="opacity"
          values="1;0.4;1" keyTimes="0;0.5;1"
          dur="1s" begin="0s" repeatCount="1" fill="freeze" calcMode="linear" />
        <path d="M -20 0 A 20 20 0 1 0 20 0 A 20 20 0 1 0 -20 0 Z" fill="#cbff4d" />
      </g>
    </g>
  </g>
</svg>
"""

STATIC_SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">
  <rect x="0" y="0" width="160" height="120" fill="#ffffff" />
  <path d="M 0 0 H 160 V 120 H 0 Z" fill="#ff0000" />
  <path d="M 40 30 H 120 V 90 H 40 Z" fill="#0000ff" />
</svg>
"""


def png_size(data):
    import struct

    assert_true(data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG")
    w, h = struct.unpack(">II", data[16:24])
    return w, h


# --------------------------------------------------------------------------
# Animation baking
# --------------------------------------------------------------------------


def test_bake_produces_distinct_frames():
    root, frames, dur = animate.frames(ANIMATED_SVG, duration=1.0, fps=10)
    assert_true(dur == 1.0, "duration should be 1.0, got %r" % dur)
    assert_true(len(frames) == 10, "expected 10 frames, got %d" % len(frames))
    assert_true(frames[-1][0] == 0.9, "last frame time should be 0.9, got %r" % frames[-1][0])
    distinct = len({svg for _, svg in frames})
    assert_true(distinct >= 8, "frames barely differ (%d distinct)" % distinct)
    assert_true("animateTransform" not in frames[0][1], "animate nodes were not stripped")
    assert_true("ns0:" not in frames[0][1], "namespace prefix leaked into output")
    return "%d frames, %d distinct" % (len(frames), distinct)


def test_bake_honours_parent_attribute():
    """data-svgen-parent must land the value on the named group, not the child."""
    root, frames, _ = animate.frames(ANIMATED_SVG, duration=1.0, fps=2)
    first, last = frames[0][1], frames[-1][1]
    import re

    m0 = re.search(r'id="e1p" transform="([^"]*)"', first)
    m9 = re.search(r'id="e1p" transform="([^"]*)"', frames[1][1])
    assert_true(m0 and m9, "could not find the e1p group in the baked output")
    assert_true(m0.group(1) != m9.group(1), "translate did not change across frames")
    assert_true("translate" in m0.group(1), "unexpected transform: %s" % m0.group(1))
    r0 = re.search(r'id="e1r" transform="([^"]*)"', first)
    assert_true(r0 and r0.group(1).startswith("rotate"), "rotate group not animated")
    return "translate %s -> %s" % (m0.group(1), m9.group(1))


def test_bake_without_ids():
    """Animations must bake even when the <animate> nodes carry no id at all."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">'
        '<rect x="0" y="0" width="10" height="10" fill="#fff">'
        '<animate attributeName="x" values="0;40" dur="1s" repeatCount="1" fill="freeze"/>'
        "</rect></svg>"
    )
    _, frames, _ = animate.frames(svg, duration=1.0, fps=3)
    assert_true(len({svg for _, svg in frames}) == 3, "frames identical without ids")
    return "ok"


def test_bake_indefinite_repeat():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">'
        '<rect x="0" y="0" width="10" height="10" fill="#fff">'
        '<animate attributeName="x" values="0;40;0" dur="1s" repeatCount="indefinite"/>'
        "</rect></svg>"
    )
    _, frames, dur = animate.frames(svg, duration=3.0, fps=4)
    xs = []
    import re

    for _, svg_text in frames:
        m = re.search(r'x="([-\d.]+)"', svg_text)
        xs.append(float(m.group(1)))
    assert_true(len(xs) == 12, "expected 12 frames, got %d" % len(xs))
    assert_true(max(xs) > 35 and min(xs) < 5, "indefinite loop did not wrap: %r" % xs)
    return "x range %.1f..%.1f" % (min(xs), max(xs))


# --------------------------------------------------------------------------
# Still rendering
# --------------------------------------------------------------------------


def test_still_formats():
    out = {}
    for fmt in ("png", "bmp", "gif"):
        data = renderer.render_static(STATIC_SVG, fmt, 160, 120, engine="raster")
        assert_true(len(data) > 40, "%s output suspiciously small" % fmt)
        out[fmt] = len(data)
    if platform.capabilities()["pillow"]:
        for fmt in ("jpg", "webp"):
            data = renderer.render_static(STATIC_SVG, fmt, 160, 120, engine="raster")
            assert_true(len(data) > 40, "%s output suspiciously small" % fmt)
            out[fmt] = len(data)
    return ", ".join("%s=%dB" % kv for kv in out.items())


def test_png_dimensions_match_request():
    for (w, h) in ((160, 120), (321, 97)):
        data = renderer.render_static(STATIC_SVG, "png", w, h, engine="raster")
        gw, gh = png_size(data)
        assert_true((gw, gh) == (w, h), "asked %dx%d got %dx%d" % (w, h, gw, gh))
    return "ok"


def test_background_colour_applied(tmp_path=None):
    data = renderer.render_static(STATIC_SVG, "png", 16, 16, background="#00ff00",
                                  engine="raster")
    w, h, rgba = renderer._png_to_rgba(data)
    # top-left pixel is the red rect over a green background -> red
    assert_true(rgba[3] == 255, "background render is not opaque")
    return "rgba=%s" % (tuple(rgba[:4]),)


def test_rust_matches_python():
    if not rslib.available():
        raise Skip("native engine not built")
    rust = renderer.render_static(STATIC_SVG, "png", 160, 120, engine="rust")
    py = renderer.render_static(STATIC_SVG, "png", 160, 120, engine="raster")
    _, _, a = renderer._png_to_rgba(rust)
    _, _, b = renderer._png_to_rgba(py)
    assert_true(len(a) == len(b), "different buffer sizes")
    diff = sum(1 for i in range(0, len(a), 4) if abs(a[i] - b[i]) > 8)
    total = len(a) // 4
    ratio = diff / total
    assert_true(ratio < 0.02, "rust and python disagree on %.1f%% of pixels" % (ratio * 100))
    return "%d/%d pixels differ (>8)" % (diff, total)


def test_text_renders():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60">'
        '<rect width="200" height="60" fill="#000000"/>'
        '<text x="100" y="30" font-size="24" fill="#ffffff" text-anchor="middle">AB</text>'
        "</svg>"
    )
    data = renderer.render_static(svg, "png", 200, 60, engine="raster")
    _, _, rgba = renderer._png_to_rgba(data)
    bright = sum(1 for i in range(0, len(rgba), 4) if rgba[i] > 200)
    assert_true(bright > 20, "no text pixels found via the fallback rasterizer")
    return "%d bright pixels" % bright


# --------------------------------------------------------------------------
# Video
# --------------------------------------------------------------------------


def _frame_hashes(data, fmt):
    """Decode a produced video/gif and hash the frames to prove motion."""
    import hashlib

    tmp = platform.fs.temp_file("." + fmt)
    try:
        platform.fs.write_bytes(tmp, data)
        if fmt == "gif":
            from PIL import Image

            img = Image.open(tmp)
            out = []
            for i in range(getattr(img, "n_frames", 1)):
                img.seek(i)
                out.append(hashlib.sha1(img.convert("RGB").tobytes()).hexdigest()[:10])
            return out
        ffmpeg = platform.find_ffmpeg()
        if not ffmpeg:
            raise Skip("ffmpeg not available")
        outdir = tmp + "_frames"
        os.makedirs(outdir, exist_ok=True)
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", tmp, "-vsync", "0",
             os.path.join(outdir, "f%03d.png")],
            check=True, capture_output=True,
        )
        from PIL import Image

        out = []
        for name in sorted(os.listdir(outdir)):
            with Image.open(os.path.join(outdir, name)) as im:
                out.append(hashlib.sha1(im.convert("RGB").tobytes()).hexdigest()[:10])
        return out
    finally:
        platform.fs.unlink(tmp)


def test_gif_is_animated():
    data = renderer.render_video(ANIMATED_SVG, "gif", 200, 120, duration=1.0, fps=10,
                                 engine="raster")
    assert_true(data[:6] == b"GIF89a", "not a GIF89a")
    if not platform.capabilities()["pillow"]:
        raise Skip("Pillow needed to inspect the GIF")
    hashes = _frame_hashes(data, "gif")
    assert_true(len(hashes) == 10, "expected 10 GIF frames, got %d" % len(hashes))
    assert_true(len(set(hashes)) >= 8, "GIF frames are identical (%d distinct)" % len(set(hashes)))
    return "%d frames, %d distinct, %dB" % (len(hashes), len(set(hashes)), len(data))


def test_mp4_is_animated():
    if not platform.find_ffmpeg():
        raise Skip("ffmpeg not available")
    data = renderer.render_video(ANIMATED_SVG, "mp4", 200, 120, duration=1.0, fps=10,
                                 engine="raster")
    assert_true(len(data) > 500, "mp4 suspiciously small")
    if not platform.capabilities()["pillow"]:
        raise Skip("Pillow needed to inspect frames")
    hashes = _frame_hashes(data, "mp4")
    assert_true(len(set(hashes)) >= 8, "mp4 frames are identical (%d distinct)" % len(set(hashes)))
    return "%d frames, %d distinct, %dB" % (len(hashes), len(set(hashes)), len(data))


def test_odd_dimensions_video():
    if not platform.find_ffmpeg():
        raise Skip("ffmpeg not available")
    data = renderer.render_video(ANIMATED_SVG, "mp4", 201, 121, duration=0.4, fps=5,
                                 engine="raster")
    assert_true(len(data) > 500, "odd-size mp4 failed to encode")
    return "%dB" % len(data)


def test_video_progress_callback():
    seen = []

    def progress(stage, done=0, total=0):
        seen.append((stage, done, total))

    renderer.render_video(ANIMATED_SVG, "gif", 100, 60, duration=0.5, fps=4,
                          engine="raster", progress=progress)
    frames = [s for s in seen if s[0] == "frames"]
    assert_true(frames, "no frame progress reported")
    assert_true(frames[-1][1] == frames[-1][2], "progress never reached 100%")
    return "%d progress events" % len(seen)


def test_video_cancellation():
    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        return calls["n"] > 3

    try:
        renderer.render_video(ANIMATED_SVG, "gif", 100, 60, duration=2.0, fps=15,
                              engine="raster", cancel=cancel)
    except renderer.Cancelled:
        return "cancelled after %d checks" % calls["n"]
    raise AssertionError("cancellation was ignored")


# --------------------------------------------------------------------------
# Input handling
# --------------------------------------------------------------------------


def test_rejects_bad_input():
    cases = [
        ("", "empty"),
        ("not xml at all", "malformed"),
        ('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', None),
    ]
    for svg, label in cases:
        try:
            renderer.render_static(svg, "png", 32, 32, engine="raster")
        except renderer.RenderError:
            if label == "None":
                raise AssertionError("valid svg was rejected")
        else:
            if label is not None:
                raise AssertionError("%s svg was accepted" % label)
    return "ok"


def test_size_clamped():
    huge = renderer._resolve_size(STATIC_SVG, 100000, 100000)
    assert_true(huge[0] <= renderer.MAX_DIMENSION, "width not clamped: %r" % (huge,))
    odd = renderer._resolve_size(STATIC_SVG, None, None)
    assert_true(odd == (160, 120), "viewBox size not honoured: %r" % (odd,))
    one = renderer._resolve_size(STATIC_SVG, 400, None)
    assert_true(one == (400, 300), "aspect ratio not preserved: %r" % (one,))
    return "clamp=%r, viewBox=%r, aspect=%r" % (huge, odd, one)


def test_unsupported_format():
    try:
        renderer.render_static(STATIC_SVG, "tiff", 32, 32, engine="raster")
    except renderer.RenderError as exc:
        assert_true("Unsupported" in str(exc), "unhelpful message: %s" % exc)
        return str(exc)
    raise AssertionError("tiff was accepted")


def test_missing_ffmpeg_message():
    if platform.find_ffmpeg():
        raise Skip("ffmpeg present; the fallback message is not reachable")
    try:
        renderer.render_video(ANIMATED_SVG, "mp4", 64, 64, duration=0.2, fps=2, engine="raster")
    except renderer.RenderError as exc:
        assert_true("ffmpeg" in str(exc), "message does not mention ffmpeg: %s" % exc)
        return str(exc)
    raise AssertionError("mp4 rendered without ffmpeg")


def test_image_determinism():
    a = renderer.render_static(STATIC_SVG, "png", 160, 120, engine="raster")
    b = renderer.render_static(STATIC_SVG, "png", 160, 120, engine="raster")
    assert_true(a == b, "two identical renders produced different bytes")
    return "%dB" % len(a)


def test_background_does_not_erase_drawing():
    """Regression: an opaque background used to replace every pixel."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'
        '<rect width="16" height="16" fill="#ff0000"/></svg>'
    )
    for engine in ("raster",) + (("rust",) if rslib.available() else ()):
        data = renderer.render_static(svg, "png", 16, 16, background="#00ff00", engine=engine)
        _, _, rgba = renderer._png_to_rgba(data)
        assert_true(tuple(rgba[:3]) == (255, 0, 0),
                    "%s: background erased the drawing (%s)" % (engine, tuple(rgba[:4])))
    # ...and the background still shows where nothing was drawn
    half = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'
        '<rect width="8" height="16" fill="#ff0000"/></svg>'
    )
    data = renderer.render_static(half, "png", 16, 16, background="#00ff00", engine="raster")
    _, _, rgba = renderer._png_to_rgba(data)
    right = (8 * 4) + 0  # first pixel of the uncovered half
    assert_true(tuple(rgba[right:right + 3]) == (0, 255, 0),
                "background did not fill the empty area: %s" % (tuple(rgba[right:right + 4]),))
    return "drawing preserved, background visible"


def test_opacity_fade_is_gradual():
    """Regression: opacity was routed through the colour lerp → hard cut."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">'
        '<rect width="20" height="20" fill="#ffffff">'
        '<animate attributeName="opacity" from="0" to="1" dur="1s"'
        ' repeatCount="1" fill="freeze"/></rect></svg>'
    )
    _, frames, _ = animate.frames(svg, duration=1.0, fps=4)
    values = []
    import re

    for _, text in frames:
        m = re.search(r'opacity="([\d.]+)"', text)
        values.append(float(m.group(1)))
    assert_true(len(set(values)) >= 3, "opacity only took %d distinct values: %r" % (len(set(values)), values))
    assert_true(values[1] not in (0.0, 1.0), "fade is still a hard cut: %r" % values)
    assert_true(values[-1] >= 0.7, "fade barely progressed: %r" % values)
    return "opacity %s" % [round(v, 2) for v in values]


def test_repeat_count_loops():
    """Regression: a finite repeatCount > 1 held the last value instead of looping."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">'
        '<rect x="0" y="0" width="10" height="10" fill="#fff">'
        '<animate attributeName="x" values="0;30" dur="1s" repeatCount="3"'
        ' fill="freeze"/></rect></svg>'
    )
    _, frames, _ = animate.frames(svg, duration=3.0, fps=6)
    import re

    xs = [float(re.search(r'x="([-\d.]+)"', t).group(1)) for _, t in frames]
    assert_true(all(0 <= v <= 30 for v in xs), "values escaped the range: %r" % xs)
    assert_true(xs[3] < 30, "no ramp within the first cycle: %r" % xs)
    wraps = sum(1 for i in range(1, len(xs)) if xs[i] < xs[i - 1] - 1)
    assert_true(wraps >= 2, "the animation did not loop (wraps=%d): %r" % (wraps, xs))
    return "%d cycles, x=%s" % (wraps, [round(v, 1) for v in xs[:8]])


def test_fill_remove_restores_base():
    """Regression: after a fill="remove" animation the base value must come back."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">'
        '<rect x="7" y="0" width="10" height="10" fill="#fff">'
        '<animate attributeName="x" from="20" to="40" dur="1s"/></rect></svg>'
    )
    _, frames, _ = animate.frames(svg, duration=2.0, fps=4)
    import re

    xs = [float(re.search(r'x="([-\d.]+)"', t).group(1)) for _, t in frames]
    assert_true(xs[0] == 20.0, "animation did not start at `from`: %r" % xs)
    assert_true(xs[-1] == 7.0, "base value not restored after the animation: %r" % xs)
    return "x=%s" % xs


def test_colour_parsing_hardening():
    from svgen.escape import parse_color

    assert_true(parse_color("#ggg") is None, "#ggg should be rejected, not raise")
    assert_true(parse_color("#12345") is None, "5-digit hex should be rejected")
    assert_true(parse_color("rgb(300,0,0)") == (255, 0, 0, 255), "channels must clamp")
    assert_true(parse_color("rgba(0,0,0,2)") == (0, 0, 0, 255), "alpha must clamp")
    assert_true(parse_color("rgb(50%,0%,0%)") == (127, 0, 0, 255), "percent channels")
    assert_true(parse_color("rgb(1 2 3 / 0.5)")[:3] == (1, 2, 3), "CSS4 space syntax")
    assert_true(parse_color("rgb(1 2 3 / 0.5)")[3] in (127, 128), "CSS4 alpha")
    # ...and the rasterizer must not crash on them
    for bad in ("#ggg", "rgb(300,0,0)", "rgba(0,0,0,2)"):
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">'
               '<rect width="8" height="8" fill="%s"/></svg>' % bad)
        renderer.render_static(svg, "png", 8, 8, engine="raster")
    return "ok"


def test_malformed_viewbox():
    for vb in ("0 0 100", "0 0 100 100 100", "0 0 0 0", ""):
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" '
               'viewBox="%s"><rect width="40" height="40" fill="#f00"/></svg>' % vb)
        try:
            renderer.render_static(svg, "png", 40, 40, engine="raster")
        except renderer.RenderError:
            pass  # a clean error is acceptable
    return "no crashes"


def test_doctype_rejected():
    from svgen import api

    bomb = ('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]>'
            '<svg xmlns="http://www.w3.org/2000/svg">&a;</svg>')
    try:
        api._guard_svg(bomb)
    except api.ApiError:
        return "rejected"
    raise AssertionError("DOCTYPE was accepted")


def test_png_decoder_roundtrip():
    rgba = bytearray()
    for y in range(24):
        for x in range(24):
            rgba += bytes((x * 10 % 256, y * 10 % 256, (x + y) * 5 % 256, 255 if x % 2 else 128))
    png = images.write_png(24, 24, bytes(rgba))
    w, h, back = renderer._png_to_rgba(png)
    assert_true((w, h) == (24, 24), "size mismatch after decode")
    assert_true(bytes(back) == bytes(rgba), "PNG round trip changed pixels")
    return "24x24 lossless"


def test_dashed_stroke_terminates():
    """Regression: any realistic stroke-dasharray used to hang forever."""
    patterns = ["2 2", "1 1", "4", "10 5", "12 4 2 4", "2 2 8 2", "40 3", "4 3", "6 3", "100 5"]
    shapes = [
        '<line x1="2" y1="16" x2="30" y2="16" stroke="#000" stroke-width="6"/>',
        '<polygon points="4,4 28,4 28,28 4,28" fill="none" stroke="#000" stroke-width="4"/>',
        '<path d="M2 20 L20 4 L38 20" fill="none" stroke="#000" stroke-width="5"/>',
    ]
    deadline = time.time() + 25
    for pattern in patterns:
        for shape in shapes:
            svg = (
                '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">'
                '<rect width="40" height="40" fill="#ffffff"/>'
                + shape.replace("/>", ' stroke-dasharray="%s"/>' % pattern)
                + "</svg>"
            )
            data = renderer.render_static(svg, "png", 40, 40, engine="raster")
            assert_true(len(data) > 40, "no output for dash %r" % pattern)
            if time.time() > deadline:
                raise AssertionError("dash patterns are too slow (stuck at %r)" % pattern)
    return "%d patterns x %d shapes" % (len(patterns), len(shapes))


def test_dash_pattern_is_visible():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20">'
        '<rect width="60" height="20" fill="#ffffff"/>'
        '<line x1="0" y1="10" x2="60" y2="10" stroke="#000000" stroke-width="6"'
        ' stroke-dasharray="10 5"/></svg>'
    )
    _, _, rgba = renderer._png_to_rgba(renderer.render_static(svg, "png", 60, 20, engine="raster"))
    row = [1 if rgba[(10 * 60 + x) * 4] < 128 else 0 for x in range(60)]
    runs = []
    for value in row:
        if runs and runs[-1][0] == value:
            runs[-1][1] += 1
        else:
            runs.append([value, 1])
    ink = sum(length for value, length in runs if value == 1)
    assert_true(ink > 5, "dashes produced almost no ink (%d px)" % ink)
    assert_true(len(runs) >= 3, "pattern did not alternate (%r)" % (runs,))
    return "%d runs, %d ink px" % (len(runs), ink)


def test_rust_premultiplied_edges():
    """Regression: unassociated downsampling darkened every antialiased edge."""
    if not rslib.available():
        raise Skip("native engine not built")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
        '<rect width="10.5" height="8" fill="#ff0000"/></svg>'
    )
    _, _, rust = renderer._png_to_rgba(renderer.render_static(svg, "png", 32, 32, engine="rust"))
    _, _, py = renderer._png_to_rgba(renderer.render_static(svg, "png", 32, 32, engine="raster"))
    worst = 0
    differing = 0
    for i in range(0, len(rust), 4):
        if rust[i + 3] != py[i + 3]:
            differing += 1
            continue
        if py[i + 3] == 0:
            continue
        delta = abs(rust[i] - py[i])
        worst = max(worst, delta)
        if delta > 8:
            differing += 1
    assert_true(differing == 0, "engines disagree on %d pixels (worst Δ=%d)" % (differing, worst))
    return "0 differing pixels"


def test_huge_canvas_is_an_error_not_an_abort():
    """Regression: 100000x100000 aborted the whole process in Rust."""
    if not rslib.available():
        raise Skip("native engine not built")
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="10" height="10" fill="#f00"/></svg>'
    try:
        rslib.render_to_pixels(svg, 100000, 100000)
    except Exception as exc:
        assert_true("large" in str(exc) or "memory" in str(exc), "unhelpful message: %s" % exc)
    else:
        # Never let it silently succeed with a 160 GB allocation.
        raise AssertionError("a 100000x100000 canvas was accepted")
    # ...and the engine still works afterwards (the process survived)
    w, h, _ = rslib.render_to_pixels(STATIC_SVG, 16, 16)
    assert_true((w, h) == (16, 16), "engine unusable after the rejected allocation")
    return "rejected, engine still alive"


def test_nan_geometry_survives():
    """Regression: a coordinate like `1e999` panicked both native rasterizers."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
        '<rect x="1e999" y="0" width="5" height="5" fill="#ff0000"/>'
        '<rect x="2" y="2" width="10" height="10" fill="#00ff00"/></svg>'
    )
    for engine in ("raster",) + (("rust",) if rslib.available() else ()):
        try:
            data = renderer.render_static(svg, "png", 32, 32, engine=engine)
        except renderer.RenderError:
            continue  # a clean error is acceptable
        assert_true(len(data) > 40, "%s produced nothing" % engine)
    return "no crash"


def test_gif_rejects_short_frames():
    if not rslib.available():
        raise Skip("native engine not built")
    try:
        rslib.encode_gif([b"\x00\x00\x00\x00"], 64, 64)
    except ValueError as exc:
        assert_true("bytes" in str(exc) or "need" in str(exc), "unhelpful message: %s" % exc)
        return str(exc)[:60]
    raise AssertionError("a 4-byte frame was accepted for a 64x64 GIF")


def test_no_temp_file_leak():
    before = set(platform.fs.listdir(platform.fs.temp_dir()))
    renderer.render_static(STATIC_SVG, "png", 64, 64, engine="raster")
    renderer.render_video(ANIMATED_SVG, "gif", 64, 48, duration=0.3, fps=3, engine="raster")
    after = set(platform.fs.listdir(platform.fs.temp_dir()))
    leaked = {p for p in (after - before) if p.startswith("tmp")}
    assert_true(not leaked, "temp files leaked: %s" % sorted(leaked)[:5])
    return "no leaks"


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------


def main():
    caps = platform.capabilities()
    print("SVGen backend checks")
    print("=" * 62)
    print("  python %s | rust=%s | chrome=%s | firefox=%s | ffmpeg=%s | pillow=%s"
          % (sys.version.split()[0], caps["rust"], caps["chrome"], caps["firefox"],
             caps["ffmpeg"], caps["pillow"]))
    print("=" * 62)

    checks = [
        ("bake: distinct frames", test_bake_produces_distinct_frames),
        ("bake: data-svgen-parent", test_bake_honours_parent_attribute),
        ("bake: no ids needed", test_bake_without_ids),
        ("bake: indefinite repeat", test_bake_indefinite_repeat),
        ("still: formats", test_still_formats),
        ("still: exact dimensions", test_png_dimensions_match_request),
        ("still: background", test_background_colour_applied),
        ("still: determinism", test_image_determinism),
        ("raster: rust vs python", test_rust_matches_python),
        ("raster: text", test_text_renders),
        ("video: gif animated", test_gif_is_animated),
        ("video: mp4 animated", test_mp4_is_animated),
        ("video: odd dimensions", test_odd_dimensions_video),
        ("video: progress", test_video_progress_callback),
        ("video: cancellation", test_video_cancellation),
        ("input: rejects bad svg", test_rejects_bad_input),
        ("input: size clamping", test_size_clamped),
        ("input: unsupported format", test_unsupported_format),
        ("input: missing ffmpeg hint", test_missing_ffmpeg_message),
        ("input: malformed viewBox", test_malformed_viewbox),
        ("input: DOCTYPE rejected", test_doctype_rejected),
        ("regression: background", test_background_does_not_erase_drawing),
        ("regression: opacity fade", test_opacity_fade_is_gradual),
        ("regression: repeatCount", test_repeat_count_loops),
        ("regression: fill=remove", test_fill_remove_restores_base),
        ("regression: colour parsing", test_colour_parsing_hardening),
        ("regression: dashed stroke", test_dashed_stroke_terminates),
        ("regression: dash visible", test_dash_pattern_is_visible),
        ("regression: premultiplied edges", test_rust_premultiplied_edges),
        ("regression: huge canvas", test_huge_canvas_is_an_error_not_an_abort),
        ("regression: NaN geometry", test_nan_geometry_survives),
        ("regression: gif frame size", test_gif_rejects_short_frames),
        ("images: png round trip", test_png_decoder_roundtrip),
        ("hygiene: no temp leaks", test_no_temp_file_leak),
    ]
    if FAST:
        checks = [c for c in checks if "mp4" not in c[0] and "gif" not in c[0]]

    for name, fn in checks:
        check(name, fn)

    width = max(len(n) for _, n, _, _ in _results)
    failed = 0
    for status, name, detail, elapsed in _results:
        if status == "FAIL":
            failed += 1
        mark = {"PASS": "  ok  ", "FAIL": " FAIL ", "SKIP": " skip "}[status]
        print("%s %-*s  %5.2fs  %s" % (mark, width, name, elapsed, detail[:80]))
    total = len(_results)
    print("-" * 62)
    print("%d checks: %d passed, %d failed, %d skipped"
          % (total, total - failed - sum(1 for r in _results if r[0] == "SKIP"), failed,
             sum(1 for r in _results if r[0] == "SKIP")))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
