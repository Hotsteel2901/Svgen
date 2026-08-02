"""Render orchestration.

Chooses the best engine available on the detected platform:
  1. headless Chrome/Edge/Chromium — maximum fidelity (real text, full SVG)
  2. the built-in pure-Python rasterizer — zero dependencies, always works

Video (mp4/webm/gif) is produced by baking SMIL frames and feeding them to
ffmpeg (mp4/webm) or the built-in GIF writer.
"""

import os
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

from . import platform
from .logs import log
from . import animate
from . import raster
from . import images
from . import rslib


SUPPORTED_STILL = ("png", "jpg", "jpeg", "bmp", "webp")
SUPPORTED_VIDEO = ("mp4", "webm", "gif")


class RenderError(Exception):
    pass


# --------------------------------------------------------------------------
# Chrome headless helpers
# --------------------------------------------------------------------------


def _set_svg_size(svg_text, width, height):
    try:
        root = ET.fromstring(svg_text)
    except ET.ParseError as exc:
        raise RenderError("Invalid SVG: %s" % exc)
    root.set("width", "%dpx" % width)
    root.set("height", "%dpx" % height)
    return ET.tostring(root, encoding="unicode")


def chrome_screenshot(svg_text, width, height, out_path, transparent=False):
    """Render an SVG file to PNG with headless Chrome/Edge. Returns out_path."""
    browser = platform.find_chrome()
    if not browser:
        raise RenderError("No Chrome/Edge/Chromium executable found")
    return _headless_screenshot(browser, "chrome", svg_text, width, height, out_path, transparent)


def firefox_screenshot(svg_text, width, height, out_path, transparent=False, background=None):
    """Render an SVG file to PNG with headless Firefox/Gecko. Returns out_path."""
    browser = platform.find_firefox()
    if not browser:
        raise RenderError("No Firefox executable found")
    # Gecko's --screenshot cannot produce a transparent background, so when a
    # background is requested we bake it into the SVG; otherwise we fall back
    # to an opaque white background for stills.
    if transparent:
        if background:
            svg_text = _composite_bg(svg_text, background)
            transparent = False
    return _headless_screenshot(browser, "firefox", svg_text, width, height, out_path, transparent)


def _composite_bg(svg_text, background):
    """Inject a background rectangle into the SVG (for engines that cannot do
    transparent screenshots)."""
    try:
        root = ET.fromstring(svg_text)
    except ET.ParseError:
        return svg_text
    w = (root.get("width") or "800").replace("px", "")
    h = (root.get("height") or "600").replace("px", "")
    ns = root.tag[:root.tag.rindex("}") + 1] if "}" in root.tag else ""
    bg = ET.Element(ns + "rect")
    bg.set("x", "0")
    bg.set("y", "0")
    bg.set("width", w)
    bg.set("height", h)
    bg.set("fill", background)
    root.insert(0, bg)
    return ET.tostring(root, encoding="unicode")


def _headless_screenshot(browser, kind, svg_text, width, height, out_path, transparent):
    tmp_svg = platform.fs.temp_file(".svg")
    try:
        platform.fs.write_text(tmp_svg, _set_svg_size(svg_text, width, height))
        url = "file:///" + tmp_svg.replace("\\", "/")
        if kind == "firefox":
            profile = platform.fs.temp_file("") + "-profile"
            platform.fs.makedirs(profile, exist_ok=True)
            cmd = [browser, "--headless", "--profile", profile, "--no-remote",
                   "--window-size", "%d,%d" % (width, height),
                   "--screenshot", out_path, url]
        else:
            cmd = [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                   "--no-sandbox", "--force-device-scale-factor=1",
                   "--virtual-time-budget=1000"]
            if transparent:
                cmd.append("--default-background-color=00000000")
            cmd += ["--screenshot=%s" % out_path,
                    "--window-size=%d,%d" % (width, height), url]
        log.debug("%s: %s" % (kind, " ".join(cmd)))
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=180)
        except subprocess.TimeoutExpired:
            proc = None
        # Launchers can return before the child finishes writing the file, so
        # poll for the output.
        deadline = time.time() + 40
        while time.time() < deadline:
            if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
                return out_path
            time.sleep(0.25)
        if proc is not None and proc.returncode != 0:
            raise RenderError("%s render failed (rc=%s): %s" % (
                kind, proc.returncode, proc.stderr.decode(errors="replace")[-300:]))
        raise RenderError("%s render produced no output file" % kind)
    finally:
        platform.fs.unlink(tmp_svg)


def _pick_browser(engine):
    """Return ('chrome'|'firefox', path) for a requested engine, or None."""
    if engine in ("auto", "chrome"):
        chrome = platform.find_chrome()
        if chrome:
            return ("chrome", chrome)
    if engine in ("auto", "firefox"):
        fx = platform.find_firefox()
        if fx:
            return ("firefox", fx)
    return None


def _browser_png_bytes(svg_text, width, height, transparent, background=None):
    out = platform.fs.temp_file(".png")
    try:
        if platform.find_chrome():
            chrome_screenshot(svg_text, width, height, out, transparent)
        else:
            firefox_screenshot(svg_text, width, height, out, transparent, background)
        return platform.fs.read_bytes(out)
    finally:
        platform.fs.unlink(out)


def _chrome_png_bytes(svg_text, width, height, transparent=False) -> bytes:
    out = platform.fs.temp_file(".png")
    try:
        chrome_screenshot(svg_text, width, height, out, transparent)
        return platform.fs.read_bytes(out)
    finally:
        platform.fs.unlink(out)


# --------------------------------------------------------------------------
# Still images
# --------------------------------------------------------------------------


def _normalize_fmt(fmt):
    fmt = (fmt or "png").lower().strip(".")
    if fmt == "jpeg":
        fmt = "jpg"
    if fmt not in SUPPORTED_STILL + SUPPORTED_VIDEO:
        raise RenderError("Unsupported format: %s" % fmt)
    return fmt


def render_static(svg_text, fmt="png", width=None, height=None, background=None,
                  engine="auto", quality=92) -> bytes:
    fmt = _normalize_fmt(fmt)
    if quality is None:
        quality = 92
    width, height, _ = _resolve_size(svg_text, width, height)
    if engine not in ("auto", "chrome", "firefox", "raster", "rust"):
        raise RenderError("Unknown engine %r" % engine)

    # 1. headless browser — maximum fidelity (real fonts, full SVG)
    if engine not in ("raster", "rust"):
        browser = _pick_browser(engine)
        if browser:
            kind, _ = browser
            try:
                transparent = background is None and kind == "chrome"
                png = _browser_png_bytes(svg_text, width, height, transparent, background)
                if fmt == "png" and background is None and transparent:
                    return png
                try:
                    return images.convert_pixels_to(_png_to_rgba(png), width, height, fmt, quality)
                except Exception as exc:
                    raise RenderError("Browser render produced an unusable image: %s" % exc)
            except RenderError:
                if engine in ("chrome", "firefox"):
                    raise
                log.debug("%s engine unavailable, falling through" % kind)

    # 2. native Rust rasterizer — the default when no browser is present
    if engine in ("auto", "rust") and rslib.available():
        try:
            w, h, rgba = rslib.render_to_pixels(svg_text, width, height, background)
            return _encode_rgba(rgba, w, h, fmt, quality)
        except Exception as exc:
            if engine == "rust":
                raise RenderError("Rust render failed: %s" % exc)
            log.debug("rust engine failed (%s), falling through" % exc)

    # 3. pure-Python rasterizer — zero-dependency fallback
    try:
        width, height, rgba = raster.render_to_pixels(svg_text, width, height, background)
    except Exception as exc:
        raise RenderError("Rasterization failed: %s" % exc)
    return _encode_rgba(rgba, width, height, fmt, quality)


def _encode_rgba(rgba, width, height, fmt, quality=92):
    if fmt == "png":
        return images.write_png(width, height, rgba)
    if fmt == "bmp":
        return images.write_bmp(width, height, rgba)
    try:
        return images.convert_pixels_to(rgba, width, height, fmt, quality)
    except Exception as exc:
        raise RenderError("Format %s needs Pillow: %s" % (fmt, exc))


def _png_to_rgba(png_bytes):
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        return bytes(img.tobytes())
    except Exception:
        raise RenderError("Cannot decode Chrome PNG")


def _resolve_size(svg_text, width, height):
    if width is not None and height is not None:
        return int(width), int(height), None
    try:
        root = ET.fromstring(svg_text)
    except ET.ParseError:
        return int(width or 800), int(height or 600), None
    vb = root.get("viewBox")
    w = root.get("width")
    h = root.get("height")
    if width is None and height is None:
        try:
            if vb:
                parts = [float(x) for x in vb.replace(",", " ").split()]
                width = int(parts[2])
                height = int(parts[3])
            elif w and h:
                width = int(float(str(w).replace("px", "")))
                height = int(float(str(h).replace("px", "")))
            else:
                width, height = 800, 600
        except Exception:
            width, height = 800, 600
    elif width is None:
        try:
            width = int(float(str(w).replace("px", ""))) if w else 800
        except Exception:
            width = 800
    elif height is None:
        try:
            height = int(float(str(h).replace("px", ""))) if h else 600
        except Exception:
            height = 600
    return int(width), int(height), None


# --------------------------------------------------------------------------
# Video
# --------------------------------------------------------------------------


def _render_frame(svg_text, width, height, engine) -> bytes:
    """Return RGBA bytes for a static SVG frame (picks engine)."""
    if engine in ("auto", "chrome", "firefox"):
        browser = _pick_browser(engine)
        if browser:
            kind, _ = browser
            try:
                # frames must be transparent for background compositing; Gecko
                # cannot produce transparent screenshots so it is only used
                # when a background is baked in.
                if kind == "chrome":
                    png = _chrome_png_bytes(svg_text, width, height, True)
                    return _png_to_rgba(png)
            except Exception:
                pass
    if engine in ("auto", "rust") and rslib.available():
        try:
            _, _, rgba = rslib.render_to_pixels(svg_text, width, height, None)
            return rgba
        except Exception:
            pass
    _, _, rgba = raster.render_to_pixels(svg_text, width, height, None)
    return rgba


def render_video(svg_text, fmt="mp4", width=None, height=None, duration=None,
                 fps=30, background=None, engine="auto", quality=28) -> bytes:
    fmt = _normalize_fmt(fmt)
    if fmt not in SUPPORTED_VIDEO:
        raise RenderError("%s is not a video format" % fmt)
    width, height, _ = _resolve_size(svg_text, width, height)
    fps = max(1, min(120, int(fps)))
    root, frame_list, dur = animate.frames(svg_text, duration, fps)
    log.info("rendering video: %d frames at %dfps (%s)" % (len(frame_list), fps, fmt))

    frames = []
    for i, (t, frame_svg) in enumerate(frame_list):
        rgba = _render_frame(frame_svg, width, height, engine)
        if background:
            rgba = _apply_bg(rgba, width, height, background)
        frames.append(rgba)
        log.debug("frame %d/%d" % (i + 1, len(frame_list)))

    if fmt == "gif":
        delay_cs = max(1, int(round(100.0 / fps)))
        return images.write_gif(frames, width, height, delay_cs, loop=True)

    ffmpeg = platform.find_ffmpeg()
    if not ffmpeg:
        raise RenderError("Video format %s requires ffmpeg (not found on this system)" % fmt)
    return _ffmpeg_encode(frames, width, height, fps, fmt, quality)


def _apply_bg(rgba, width, height, background):
    from .escape import parse_color
    bg = parse_color(background)
    if not bg:
        return rgba
    br, bg_, bb, ba = bg
    out = bytearray(rgba)
    da = ba / 255.0
    for i in range(width * height):
        idx = i * 4
        out[idx] = int(br * da + out[idx] * (1 - da))
        out[idx + 1] = int(bg_ * da + out[idx + 1] * (1 - da))
        out[idx + 2] = int(bb * da + out[idx + 2] * (1 - da))
        out[idx + 3] = max(out[idx + 3], ba)
    return bytes(out)


def _ffmpeg_encode(frames, width, height, fps, fmt, quality=None) -> bytes:
    ffmpeg = platform.find_ffmpeg()
    if quality is None:
        quality = 28
    if fmt == "mp4":
        args = ["-c:v", "libx264", "-preset", "medium", "-crf", str(quality),
                "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    elif fmt == "webm":
        args = ["-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-pix_fmt", "yuva420p"]
    else:
        args = ["-c:v", "libx264", "-crf", str(quality)]

    out_path = platform.fs.temp_file("." + fmt)
    err_path = platform.fs.temp_file(".log")
    cmd = [ffmpeg, "-y", "-f", "image2pipe", "-vcodec", "png", "-r", str(fps),
           "-i", "-"] + args + [out_path]
    try:
        with open(err_path, "w", encoding="utf-8", errors="replace") as err_fh:
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                    stderr=err_fh)
            for rgba in frames:
                proc.stdin.write(images.write_png(width, height, rgba))
            proc.stdin.close()
            proc.wait(timeout=600)
        if proc.returncode != 0 or not os.path.isfile(out_path) or os.path.getsize(out_path) == 0:
            err = ""
            try:
                err = platform.fs.read_text(err_path)
            except Exception:
                pass
            raise RenderError("ffmpeg failed: %s" % err[-500:])
        return platform.fs.read_bytes(out_path)
    finally:
        platform.fs.unlink(out_path)
        platform.fs.unlink(err_path)


def render(svg_text, fmt, width=None, height=None, duration=None, fps=30,
           background=None, engine="auto", quality=None) -> bytes:
    """Top-level render dispatch by format."""
    fmt = _normalize_fmt(fmt)
    if fmt in SUPPORTED_VIDEO:
        q = 28 if quality is None else quality
        return render_video(svg_text, fmt, width, height, duration, fps, background, engine, q)
    q = 92 if quality is None else quality
    return render_static(svg_text, fmt, width, height, background, engine, q)
