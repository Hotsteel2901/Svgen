"""Load the native Rust rasterization engine (`svgen_rs`) and render to RGBA.

Locates the compiled shared library for the current platform, exposes a
`render_to_pixels()` equivalent, and returns None when the library is absent so
callers can fall back to the pure-Python rasterizer.
"""

import ctypes
import os
import sys
import threading

from .logs import log
from .platform import fs
from . import rsops

_LOCK = threading.Lock()
_ENGINE = None  # (lib, render_fn, free_fn, version)


def _lib_filename():
    if sys.platform.startswith("win"):
        return "svgen_rs.dll"
    if sys.platform == "darwin":
        return "libsvgen_rs.dylib"
    return "libsvgen_rs.so"


def find_library_path():
    """Search platform-appropriate locations for the compiled Rust library."""
    candidates = []
    here = os.path.dirname(os.path.abspath(__file__))
    name = _lib_filename()
    env = os.environ.get("SVGEN_RS_LIB")
    if env:
        candidates.append(env)
    candidates += [
        os.path.join(here, "..", "..", "rust", "svgen_rs", "target", "release", name),
        os.path.join(here, "..", "rust", "svgen_rs", "target", "release", name),
        os.path.join(here, "..", "..", "rust", "svgen_rs", "target", "debug", name),
        os.path.join(here, "..", "bin", name),
        os.path.join(here, name),
    ]
    for cand in candidates:
        if cand and os.path.isfile(cand):
            return cand
    return None


def _load():
    global _ENGINE
    path = find_library_path()
    if not path:
        return None
    try:
        lib = ctypes.CDLL(path)
    except OSError as exc:
        log.warn("svgen_rs load failed (%s)" % exc)
        return None

    try:
        lib.svgen_render.argtypes = [
            ctypes.c_void_p, ctypes.c_size_t,     # ops ptr, len
            ctypes.c_uint32, ctypes.c_uint32,     # width, height
            ctypes.c_uint32,                      # supersample
            ctypes.c_void_p, ctypes.c_size_t,     # bg ptr, len
            ctypes.POINTER(ctypes.c_void_p),      # out_handle
            ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)),  # out_data
            ctypes.POINTER(ctypes.c_size_t),      # out_len
            ctypes.POINTER(ctypes.c_uint32),      # out_w
            ctypes.POINTER(ctypes.c_uint32),      # out_h
        ]
        lib.svgen_render.restype = ctypes.c_int

        lib.svgen_gif_encode.argtypes = [
            ctypes.POINTER(ctypes.c_void_p),      # frames array
            ctypes.c_uint32,                      # n_frames
            ctypes.c_uint32, ctypes.c_uint32,     # width, height
            ctypes.c_uint32,                      # delay_cs
            ctypes.c_uint32,                      # loop_forever
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)),
            ctypes.POINTER(ctypes.c_size_t),
        ]
        lib.svgen_gif_encode.restype = ctypes.c_int

        # svgen_free returns nothing — declaring c_int here would be UB.
        lib.svgen_free.argtypes = [ctypes.c_void_p]
        lib.svgen_free.restype = None

        lib.svgen_version.argtypes = []
        lib.svgen_version.restype = ctypes.c_uint32

        lib.svgen_last_error.argtypes = []
        lib.svgen_last_error.restype = ctypes.c_char_p

        version = lib.svgen_version()
    except AttributeError as exc:
        log.warn("svgen_rs is missing an expected symbol (%s) — falling back" % exc)
        return None

    _ENGINE = (lib, path)
    log.debug("svgen_rs native engine loaded: %s (v%d)" % (path, version))
    return _ENGINE


def last_error() -> str:
    """The engine's reason for the most recent failure on this thread."""
    eng = engine()
    if not eng:
        return ""
    try:
        raw = eng[0].svgen_last_error()
    except Exception:
        return ""
    if not raw:
        return ""
    try:
        return raw.decode("utf-8", "replace")
    except Exception:
        return ""


def _fail(what, rc):
    reason = last_error()
    return RuntimeError("%s failed (rc=%d)%s" % (what, rc, ": " + reason if reason else ""))


def engine():
    """The loaded (lib, path) pair, loading it on first use. None if absent."""
    global _ENGINE
    if _ENGINE is None:
        with _LOCK:
            if _ENGINE is None:
                _load()
    return _ENGINE


def available():
    return engine() is not None


def info():
    eng = engine()
    if not eng:
        return None
    lib, path = eng
    try:
        version = lib.svgen_version()
    except Exception:
        version = 0
    return {"path": path, "version": version, "api": 1}


def encode_gif(frames, width, height, delay_cs=5, loop=True):
    """Encode RGBA frames into a GIF with the native Rust encoder.

    frames: list of bytes-like objects, each width*height*4.
    Returns GIF bytes. Raises RuntimeError if the native engine is absent.
    """
    eng = engine()
    if not eng:
        raise RuntimeError("svgen_rs native engine not available")
    lib = eng[0]

    expected = width * height * 4
    for i, f in enumerate(frames):
        if len(f) < expected:
            raise ValueError("frame %d has %d bytes, need %d for %dx%d"
                             % (i, len(f), expected, width, height))
    buffers = [ctypes.create_string_buffer(bytes(f), len(f)) for f in frames]
    n = len(buffers)
    if n == 0:
        raise ValueError("no frames")
    ptr_array = (ctypes.c_void_p * n)()
    for i, buf in enumerate(buffers):
        ptr_array[i] = ctypes.cast(buf, ctypes.c_void_p)

    handle = ctypes.c_void_p()
    data = ctypes.POINTER(ctypes.c_ubyte)()
    out_len = ctypes.c_size_t()
    rc = lib.svgen_gif_encode(
        ctypes.cast(ptr_array, ctypes.POINTER(ctypes.c_void_p)),
        n, width, height, delay_cs, 1 if loop else 0,
        ctypes.byref(handle), ctypes.byref(data), ctypes.byref(out_len),
    )
    if rc != 0 or not handle.value:
        raise _fail("svgen_rs gif encode", rc)
    try:
        return ctypes.string_at(data, out_len.value)
    finally:
        lib.svgen_free(handle)


def render_to_pixels(svg_text, width=None, height=None, background=None):
    """Render via the Rust engine. Returns (width, height, RGBA bytearray).

    Raises RuntimeError if the native engine is not available.
    """
    eng = engine()
    if not eng:
        raise RuntimeError("svgen_rs native engine not available")
    lib = eng[0]

    width, height, ops = rsops.build_ops(svg_text, width, height, background)
    ss = rsops.raster.SUPERSAMPLE

    ops_bytes = ctypes.create_string_buffer(ops, len(ops))
    bg = b"\x00\x00\x00\x00"
    if background:
        from .escape import parse_color

        c = parse_color(background)
        if c:
            bg = bytes((c[0], c[1], c[2], c[3]))
    # Bind the background buffer to a name so it cannot be collected mid-call.
    bg_bytes = ctypes.create_string_buffer(bg, 4)

    handle = ctypes.c_void_p()
    data = ctypes.POINTER(ctypes.c_ubyte)()
    out_len = ctypes.c_size_t()
    out_w = ctypes.c_uint32()
    out_h = ctypes.c_uint32()

    rc = lib.svgen_render(
        ctypes.cast(ops_bytes, ctypes.c_void_p), len(ops),
        width, height, ss,
        ctypes.cast(bg_bytes, ctypes.c_void_p), 4,
        ctypes.byref(handle), ctypes.byref(data), ctypes.byref(out_len),
        ctypes.byref(out_w), ctypes.byref(out_h),
    )
    if rc != 0 or not handle.value:
        raise _fail("svgen_rs render", rc)
    try:
        if out_len.value < out_w.value * out_h.value * 4:
            raise RuntimeError("svgen_rs returned a short buffer (%d bytes)" % out_len.value)
        raw = ctypes.string_at(data, out_len.value)
        return int(out_w.value), int(out_h.value), bytearray(raw)
    finally:
        lib.svgen_free(handle)
