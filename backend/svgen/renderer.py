"""Render orchestration.

Engine selection, in preference order:

  1. **headless browser** — Chrome/Edge (or Firefox/Gecko) for maximum fidelity:
     real fonts, CJK text, the full SVG feature set
  2. **native Rust rasterizer** — fast, no browser needed, same feature set as
     the pure-Python engine because geometry/transform/gradient work is shared
  3. **pure-Python rasterizer** — zero-dependency fallback, always available

Video (`mp4` / `webm` / `gif`) is produced by baking SMIL frames and streaming
them to ffmpeg (mp4/webm) or the GIF encoder (native Rust, Python fallback).

Everything long-running accepts `progress(stage, done, total)` and `cancel()`
callbacks so the HTTP layer can expose real job progress and cancellation.
"""

import os
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

from . import platform
from .logs import log
from . import animate
from . import images
from . import rslib
from .escape import parse_color
from .platform import fs

SUPPORTED_STILL = ("png", "jpg", "jpeg", "bmp", "webp")
SUPPORTED_VIDEO = ("mp4", "webm", "gif")
SUPPORTED = SUPPORTED_STILL + SUPPORTED_VIDEO

MAX_DIMENSION = 8192


class RenderError(Exception):
    """Anything that stops a render, with a message safe to show a user."""


class Cancelled(RenderError):
    """Raised when a cancellation callback asks us to stop."""


def _noop_progress(stage, done=0, total=0):
    pass


def _never_cancel():
    return False


# --------------------------------------------------------------------------
# SVG helpers
# --------------------------------------------------------------------------


def _parse_root(svg_text):
    if isinstance(svg_text, bytes):
        svg_text = svg_text.decode("utf-8", "replace")
    if not isinstance(svg_text, str) or not svg_text.strip():
        raise RenderError("empty SVG")
    try:
        return ET.fromstring(svg_text)
    except ET.ParseError as exc:
        raise RenderError("Invalid SVG: %s" % exc)


def _set_svg_size(svg_text, width, height):
    """Force absolute pixel dimensions on the root <svg>.

    If the document has a viewBox the geometry scales into the new box; if it has
    neither viewBox nor usable width/height we synthesise one from the original
    attributes so the artwork is not silently clipped to its natural size.
    """
    root = _parse_root(svg_text)
    orig_w = root.get("width")
    orig_h = root.get("height")
    root.set("width", "%dpx" % int(width))
    root.set("height", "%dpx" % int(height))
    if root.get("viewBox") is None and orig_w and orig_h:
        w = _unitless(orig_w)
        h = _unitless(orig_h)
        if w != "0" and h != "0":
            root.set("viewBox", "0 0 %s %s" % (w, h))
    return ET.tostring(root, encoding="unicode")


def _unitless(value):
    try:
        return str(int(float(str(value).replace("px", "").strip())))
    except (TypeError, ValueError):
        return "0"


def _composite_bg(svg_text, background, width, height):
    """Inject a background rectangle (for engines that cannot do transparency)."""
    try:
        root = _parse_root(svg_text)
    except RenderError:
        return svg_text
    ns = root.tag[: root.tag.rindex("}") + 1] if "}" in root.tag else ""
    bg = ET.Element(ns + "rect")
    bg.set("x", "0")
    bg.set("y", "0")
    bg.set("width", str(int(width)))
    bg.set("height", str(int(height)))
    bg.set("fill", background)
    root.insert(0, bg)
    return ET.tostring(root, encoding="unicode")


# --------------------------------------------------------------------------
# Headless browsers
# --------------------------------------------------------------------------


def _chrome_cmd(browser, svg_text, width, height, out_path, transparent):
    import tempfile

    handle = tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False, encoding="utf-8")
    try:
        handle.write(svg_text)
        handle.close()
        url = "file:///" + handle.name.replace("\\", "/")
        cmd = [
            browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--no-sandbox", "--disable-extensions", "--disable-dev-shm-usage",
            "--force-device-scale-factor=1",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=10000",
        ]
        if transparent:
            cmd.append("--default-background-color=00000000")
        cmd += [
            "--screenshot=%s" % out_path,
            "--window-size=%d,%d" % (width, height),
            url,
        ]
        return cmd, handle.name
    except Exception:
        try:
            handle.close()
        except Exception:
            pass
        fs.unlink(handle.name)
        raise


def _headless_screenshot(browser, kind, svg_text, width, height, out_path, transparent,
                         background=None):
    """Run one headless screenshot. Returns out_path or raises RenderError.

    Background handling: when a background colour is requested it is baked into
    the SVG, because relying on the browser's default page colour silently
    ignores the choice (headless Chrome paints white). Gecko cannot produce an
    alpha channel at all, so a transparent request is flattened onto white.
    """
    fs.unlink(out_path)
    svg_text = _set_svg_size(svg_text, width, height)
    if background:
        svg_text = _composite_bg(svg_text, background, width, height)
        transparent = False
    elif transparent and kind == "firefox":
        svg_text = _composite_bg(svg_text, "#ffffff", width, height)
        transparent = False

    profile = None
    cmd = None
    svg_path = None

    if kind == "firefox":
        import tempfile

        handle = tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False, encoding="utf-8")
        handle.write(svg_text)
        handle.close()
        svg_path = handle.name
        profile = tempfile.mkdtemp(prefix="svgen-ff-")
        cmd = [
            browser, "--headless", "--profile", profile, "--no-remote",
            "--window-size", "%d,%d" % (width, height),
            "--screenshot", out_path,
            "file:///" + svg_path.replace("\\", "/"),
        ]
    else:
        cmd, svg_path = _chrome_cmd(browser, svg_text, width, height, out_path, transparent)

    try:
        log.debug("%s: %s" % (kind, " ".join(cmd)))
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=180)
            rc = proc.returncode
            stderr = proc.stderr.decode("utf-8", "replace")[-400:] if proc.stderr else ""
        except subprocess.TimeoutExpired:
            rc = None
            stderr = "timed out after 180s"

        deadline = time.time() + 45
        while time.time() < deadline:
            if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
                return out_path
            time.sleep(0.2)

        if rc not in (0, None):
            raise RenderError("%s render failed (rc=%s): %s" % (kind, rc, stderr.strip()))
        raise RenderError("%s produced no output file%s" % (
            kind, (": " + stderr.strip()) if stderr.strip() else ""))
    finally:
        if svg_path:
            fs.unlink(svg_path)
        if profile:
            shutil.rmtree(profile, ignore_errors=True)


def _pick_browser(engine):
    """('chrome'|'firefox', path) for the requested engine, or None."""
    if engine in ("auto", "chrome"):
        chrome = platform.find_chrome()
        if chrome:
            return ("chrome", chrome)
    if engine in ("auto", "firefox"):
        fx = platform.find_firefox()
        if fx:
            return ("firefox", fx)
    return None


def _browser_png(svg_text, width, height, kind, path, transparent, background=None):
    """Bytes of a PNG produced by the chosen browser."""
    out = fs.temp_file(".png")
    try:
        _headless_screenshot(path, kind, svg_text, width, height, out, transparent, background)
        return fs.read_bytes(out)
    finally:
        fs.unlink(out)


# --------------------------------------------------------------------------
# Size resolution
# --------------------------------------------------------------------------


def _resolve_size(svg_text, width=None, height=None):
    """Work out the output pixel size from the request and/or the SVG."""
    root = None
    try:
        root = _parse_root(svg_text)
    except RenderError:
        root = None

    vb = None
    if root is not None and root.get("viewBox"):
        parts = [float(x) for x in root.get("viewBox").replace(",", " ").split() if x.strip()]
        if len(parts) == 4 and parts[2] > 0 and parts[3] > 0:
            vb = parts

    def attr_size(name):
        if root is None:
            return None
        raw = root.get(name)
        if not raw:
            return None
        try:
            v = float(str(raw).replace("px", "").strip())
        except ValueError:
            return None
        return v if v > 0 else None

    if width is None and height is None:
        if vb:
            width, height = vb[2], vb[3]
        else:
            width = attr_size("width") or 800
            height = attr_size("height") or 600
    elif width is None:
        aspect = (vb[2] / vb[3]) if vb else ((attr_size("width") or 800) / (attr_size("height") or 600))
        width = height * aspect
    elif height is None:
        aspect = (vb[3] / vb[2]) if vb else ((attr_size("height") or 600) / (attr_size("width") or 800))
        height = width * aspect

    def clean(v, fallback):
        try:
            n = int(round(float(v)))
        except (TypeError, ValueError):
            n = fallback
        return max(1, min(MAX_DIMENSION, n))

    return clean(width, 800), clean(height, 600)


def _even(n):
    """libx264 with yuv420p needs even dimensions."""
    n = int(n)
    return n if n % 2 == 0 else n + 1


# --------------------------------------------------------------------------
# Still images
# --------------------------------------------------------------------------


def _normalize_fmt(fmt):
    fmt = str(fmt or "png").lower().strip().lstrip(".")
    if fmt == "jpeg":
        fmt = "jpg"
    if fmt not in SUPPORTED:
        raise RenderError("Unsupported format: %s" % fmt)
    return fmt


# Public alias — other modules (jobs, cli) validate user input with this.
normalize_format = _normalize_fmt


def _png_to_rgba(png_bytes, width=None, height=None):
    """Decode a PNG into RGBA bytes. Pillow first, tiny stdlib decoder second."""
    try:
        import io

        from PIL import Image

        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        return img.size[0], img.size[1], img.tobytes()
    except ImportError:
        pass
    except Exception as exc:
        raise RenderError("Cannot decode rendered PNG: %s" % exc)
    return _decode_png_stdlib(png_bytes)


def _decode_png_stdlib(data):
    """Minimal PNG decoder: 8-bit, non-interlaced, colour types 0/2/4/6."""
    import struct
    import zlib

    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RenderError("not a PNG")
    pos = 8
    width = height = None
    bit_depth = colour_type = 0
    idat = bytearray()
    palette = None
    trns = None
    while pos + 8 <= len(data):
        (length,) = struct.unpack_from(">I", data, pos)
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, colour_type, comp, filt, interlace = struct.unpack(">IIBBBBB", body)
            if interlace:
                raise RenderError("interlaced PNG needs Pillow")
        elif ctype == b"PLTE":
            palette = body
        elif ctype == b"tRNS":
            trns = body
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    if width is None or bit_depth != 8 or colour_type not in (0, 2, 4, 6):
        raise RenderError("unsupported PNG (needs Pillow)")

    channels = {0: 1, 2: 3, 4: 2, 6: 4}[colour_type]
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(width * height * 4)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        ftype = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        prev = line
        base = y * width * 4
        for x in range(width):
            s = x * channels
            d = base + x * 4
            if colour_type == 6:
                out[d:d + 4] = line[s:s + 4]
            elif colour_type == 2:
                out[d:d + 3] = line[s:s + 3]
                out[d + 3] = 255
            elif colour_type == 4:
                g = line[s]
                out[d] = out[d + 1] = out[d + 2] = g
                out[d + 3] = line[s + 1]
            else:  # grayscale
                g = line[s]
                out[d] = out[d + 1] = out[d + 2] = g
                out[d + 3] = 255
    return width, height, bytes(out)


def _encode_rgba(rgba, width, height, fmt, quality=92):
    if fmt == "png":
        return images.write_png(width, height, rgba)
    if fmt == "bmp":
        return images.write_bmp(width, height, rgba)
    try:
        return images.convert_pixels_to(rgba, width, height, fmt, quality)
    except ImportError:
        raise RenderError("Format %s needs Pillow (pip install Pillow)" % fmt)
    except RenderError:
        raise
    except Exception as exc:
        raise RenderError("Encoding %s failed: %s" % (fmt, exc))


def render_static(svg_text, fmt="png", width=None, height=None, background=None,
                  engine="auto", quality=None, progress=None, cancel=None) -> bytes:
    fmt = _normalize_fmt(fmt)
    if fmt in ("mp4", "webm"):
        raise RenderError("%s is a video format — use render_video" % fmt)
    if engine not in ("auto", "chrome", "firefox", "raster", "rust"):
        raise RenderError("Unknown engine %r" % engine)
    progress = progress or _noop_progress
    cancel = cancel or _never_cancel
    quality = 92 if quality is None else int(quality)

    width, height = _resolve_size(svg_text, width, height)

    # A single-frame GIF is a legitimate still; wrap the pixel encoder.
    def encode(rgba, w, h):
        if fmt == "gif":
            return images.write_gif([rgba], w, h, delay_cs=8, loop=False)
        return _encode_rgba(rgba, w, h, fmt, quality)

    # 1. headless browser
    if engine not in ("raster", "rust"):
        picked = _pick_browser(engine)
        if picked:
            kind, path = picked
            progress("browser", 0, 1)
            try:
                transparent = background is None and kind == "chrome"
                png = _browser_png(svg_text, width, height, kind, path, transparent, background)
                if fmt == "png" and transparent:
                    progress("browser", 1, 1)
                    return png
                w, h, rgba = _png_to_rgba(png)
                progress("encode", 0, 1)
                out = encode(rgba, w, h)
                progress("encode", 1, 1)
                return out
            except RenderError:
                if engine in ("chrome", "firefox"):
                    raise
                log.debug("%s engine unavailable, falling through" % kind)
            except Exception as exc:
                if engine in ("chrome", "firefox"):
                    raise RenderError("%s render failed: %s" % (kind, exc))
                log.debug("%s engine failed (%s), falling through" % (kind, exc))

    if cancel():
        raise Cancelled("cancelled")

    # 2. native Rust rasterizer
    # NOTE: the background is deliberately NOT handed to the rasterizers. They
    # composite it themselves and historically got it wrong (an opaque
    # background replaced the whole image). We flatten here, once, with correct
    # source-over maths, so every engine produces identical output.
    if engine in ("auto", "rust") and rslib.available():
        try:
            progress("raster", 0, 1)
            w, h, rgba = rslib.render_to_pixels(svg_text, width, height, None)
            rgba = _flatten(rgba, w, h, background)
            progress("raster", 1, 1)
            return encode(rgba, w, h)
        except RenderError:
            raise
        except Exception as exc:
            if engine == "rust":
                raise RenderError("Rust render failed: %s" % exc)
            log.debug("rust engine failed (%s), falling through" % exc)

    # 3. pure-Python rasterizer
    from . import raster

    progress("raster", 0, 1)
    try:
        width, height, rgba = raster.render_to_pixels(svg_text, width, height, None)
    except Exception as exc:
        raise RenderError("Rasterization failed: %s" % exc)
    rgba = _flatten(rgba, width, height, background)
    progress("raster", 1, 1)
    return encode(rgba, width, height)


# --------------------------------------------------------------------------
# Video
# --------------------------------------------------------------------------


def _frame_rgba(svg_text, width, height, engine, background=None):
    """RGBA bytes for one static (already baked) SVG frame.

    Returns (rgba, composited) — `composited` is True when the engine could not
    hand back transparency and already flattened the frame onto `background`.
    """
    if engine in ("auto", "chrome", "firefox"):
        picked = _pick_browser(engine)
        if picked:
            kind, path = picked
            try:
                if kind == "chrome":
                    png = _browser_png(svg_text, width, height, "chrome", path, True)
                    _, _, rgba = _png_to_rgba(png)
                    return rgba, False
                # Gecko cannot screenshot with alpha, so flatten onto the frame
                # background here and tell the caller not to composite again.
                bg = background or "#ffffff"
                png = _browser_png(svg_text, width, height, "firefox", path, False, bg)
                _, _, rgba = _png_to_rgba(png)
                return rgba, bool(background)
            except Exception as exc:
                if engine in ("chrome", "firefox"):
                    raise
                log.debug("%s frame failed (%s), falling through" % (kind, exc))
    if engine in ("auto", "rust") and rslib.available():
        try:
            _, _, rgba = rslib.render_to_pixels(svg_text, width, height, None)
            return rgba, False
        except Exception as exc:
            if engine == "rust":
                raise RenderError("Rust render failed: %s" % exc)
            log.debug("rust frame failed (%s), falling through" % exc)
    from . import raster

    _, _, rgba = raster.render_to_pixels(svg_text, width, height, None)
    return rgba, False


def _apply_bg(rgba, width, height, background):
    """Composite RGBA over a background colour using proper source-over.

    The source's own alpha is what decides coverage. (The original code scaled
    by the *background's* alpha instead, so an opaque background replaced every
    pixel with the background colour — a still exported with `--background
    "#fff"` came out blank white.)
    """
    bgc = parse_color(background)
    if not bgc:
        return rgba
    br, bg, bb, ba = bgc
    if ba <= 0:
        return rgba

    out = bytearray(rgba)
    n = width * height
    if ba >= 255:
        # Fast path: opaque background.
        for i in range(n):
            idx = i * 4
            a = out[idx + 3]
            if a == 255:
                continue
            inv = 255 - a
            out[idx] = (out[idx] * a + br * inv + 127) // 255
            out[idx + 1] = (out[idx + 1] * a + bg * inv + 127) // 255
            out[idx + 2] = (out[idx + 2] * a + bb * inv + 127) // 255
            out[idx + 3] = 255
        return bytes(out)

    da = ba / 255.0
    for i in range(n):
        idx = i * 4
        sa = out[idx + 3] / 255.0
        if sa >= 1.0:
            continue
        inv = 1.0 - sa
        out[idx] = int(out[idx] * sa + br * da * inv + 0.5)
        out[idx + 1] = int(out[idx + 1] * sa + bg * da * inv + 0.5)
        out[idx + 2] = int(out[idx + 2] * sa + bb * da * inv + 0.5)
        out[idx + 3] = int((sa + da * inv) * 255 + 0.5)
    return bytes(out)


def _flatten(rgba, width, height, background):
    """Composite only when there is something to composite onto."""
    if not background:
        return rgba
    if parse_color(background) is None:
        raise RenderError("background must be a CSS colour")
    return _apply_bg(rgba, width, height, background)


class _FFmpegPipe:
    """Streams PNG frames into ffmpeg and returns the encoded file."""

    def __init__(self, ffmpeg, out_path, fps, fmt, quality, width, height):
        self.out_path = out_path
        self.err_path = fs.temp_file(".log")
        args = self._codec_args(fmt, quality, width, height)
        self.cmd = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "image2pipe", "-vcodec", "png", "-r", str(fps), "-i", "-",
            *args, out_path,
        ]
        self._err = open(self.err_path, "w", encoding="utf-8", errors="replace")
        self.proc = subprocess.Popen(
            self.cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self._err
        )

    @staticmethod
    def _codec_args(fmt, quality, width, height):
        if fmt == "mp4":
            return [
                "-c:v", "libx264", "-preset", "medium", "-crf", str(quality),
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
            ]
        if fmt == "webm":
            return [
                "-c:v", "libvpx-vp9", "-crf", str(quality), "-b:v", "0",
                "-pix_fmt", "yuv420p", "-row-mt", "1", "-an",
            ]
        return ["-c:v", "libx264", "-crf", str(quality), "-pix_fmt", "yuv420p", "-an"]

    def write(self, rgba, width, height):
        png = images.write_png(width, height, rgba)
        try:
            self.proc.stdin.write(png)
        except (BrokenPipeError, ValueError) as exc:
            raise RenderError("ffmpeg stopped accepting frames: %s" % self._read_err())

    def finish(self):
        try:
            if self.proc.stdin and not self.proc.stdin.closed:
                self.proc.stdin.close()
        except (BrokenPipeError, ValueError):
            pass
        try:
            rc = self.proc.wait(timeout=900)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=10)
            raise RenderError("ffmpeg timed out")
        finally:
            self._close_err()
        if rc != 0 or not os.path.isfile(self.out_path) or os.path.getsize(self.out_path) == 0:
            raise RenderError("ffmpeg failed: %s" % self._read_err())
        return fs.read_bytes(self.out_path)

    def abort(self):
        try:
            if self.proc.stdin and not self.proc.stdin.closed:
                self.proc.stdin.close()
        except Exception:
            pass
        if self.proc.poll() is None:
            self.proc.kill()
            try:
                self.proc.wait(timeout=10)
            except Exception:
                pass
        self._close_err()

    def _close_err(self):
        try:
            self._err.close()
        except Exception:
            pass

    def _read_err(self):
        self._close_err()
        try:
            return fs.read_text(self.err_path).strip()[-600:]
        except Exception:
            return ""

    def cleanup(self):
        fs.unlink(self.out_path)
        fs.unlink(self.err_path)


def render_video(svg_text, fmt="mp4", width=None, height=None, duration=None,
                 fps=30, background=None, engine="auto", quality=None,
                 progress=None, cancel=None) -> bytes:
    fmt = _normalize_fmt(fmt)
    if fmt not in SUPPORTED_VIDEO:
        raise RenderError("%s is not a video format" % fmt)
    progress = progress or _noop_progress
    cancel = cancel or _never_cancel
    quality = (28 if fmt == "mp4" else 36) if quality is None else int(quality)
    fps = max(1, min(120, int(fps or 30)))

    width, height = _resolve_size(svg_text, width, height)

    progress("bake", 0, 0)
    _root, frame_list, dur = animate.frames(svg_text, duration, fps)
    total = len(frame_list)
    if total == 0:
        raise RenderError("nothing to render")

    ffmpeg = None
    pipe = None
    if fmt in ("mp4", "webm"):
        ffmpeg = platform.find_ffmpeg()
        if not ffmpeg:
            raise RenderError(
                "Format %s requires ffmpeg. Install it, or export an animated GIF instead." % fmt
            )
        # libx264/yuv420p requires even dimensions.
        width, height = _even(width), _even(height)
        pipe = _FFmpegPipe(ffmpeg, fs.temp_file("." + fmt), fps, fmt, quality, width, height)

    log.info("rendering %s: %d frames at %d fps (%dx%d)" % (fmt, total, fps, width, height))

    gif_frames = [] if fmt == "gif" else None
    try:
        for i, (_t, frame_svg) in enumerate(frame_list):
            if cancel():
                raise Cancelled("cancelled")
            rgba, already = _frame_rgba(frame_svg, width, height, engine, background)
            if background and not already:
                rgba = _apply_bg(rgba, width, height, background)
            if gif_frames is not None:
                gif_frames.append(rgba)
            else:
                pipe.write(rgba, width, height)
            progress("frames", i + 1, total)

        if fmt == "gif":
            delay_cs = max(2, int(round(100.0 / fps)))
            progress("encode", 0, 1)
            data = images.write_gif(gif_frames, width, height, delay_cs, loop=True)
            progress("encode", 1, 1)
            return data

        progress("encode", 0, 1)
        data = pipe.finish()
        progress("encode", 1, 1)
        return data
    except BaseException:
        if pipe is not None:
            pipe.abort()
        raise
    finally:
        if pipe is not None:
            pipe.cleanup()


def render(svg_text, fmt, width=None, height=None, duration=None, fps=30,
           background=None, engine="auto", quality=None, progress=None, cancel=None) -> bytes:
    """Top-level dispatch by format."""
    fmt = _normalize_fmt(fmt)
    if fmt in SUPPORTED_VIDEO:
        return render_video(svg_text, fmt, width, height, duration, fps, background,
                            engine, quality, progress, cancel)
    return render_static(svg_text, fmt, width, height, background, engine, quality,
                         progress, cancel)


def engine_report():
    """What the backend can do right now — surfaced through /api/info."""
    caps = platform.capabilities()
    chain = []
    if caps.get("chrome"):
        chain.append("chrome")
    if caps.get("firefox"):
        chain.append("firefox")
    if caps.get("rust"):
        chain.append("rust")
    chain.append("raster")
    return {
        "default": caps.get("engine"),
        "chain": chain,
        "formats": {
            "still": list(SUPPORTED_STILL),
            "video": {
                "gif": True,
                "mp4": bool(caps.get("ffmpeg")),
                "webm": bool(caps.get("ffmpeg")),
            },
        },
        "tools": {
            "chrome": caps.get("chrome_path"),
            "firefox": caps.get("firefox_path"),
            "ffmpeg": caps.get("ffmpeg_path"),
            "rust": (caps.get("rust_info") or {}).get("path"),
            "pillow": caps.get("pillow"),
        },
    }
