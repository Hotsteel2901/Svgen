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
    lib.svgen_free.argtypes = [ctypes.c_void_p]
    lib.svgen_version.restype = ctypes.c_uint32

    _ENGINE = (lib, path)
    log.debug("svgen_rs native engine loaded: %s (v%d)" % (path, lib.svgen_version()))
    return _ENGINE


def available():
    with _LOCK:
        if _ENGINE is None:
            _load()
        return _ENGINE is not None


def info():
    with _LOCK:
        if _ENGINE is None:
            _load()
    if not _ENGINE:
        return None
    return {"path": _ENGINE[1], "version": _ENGINE[0].svgen_version(), "api": 1}


def render_to_pixels(svg_text, width=None, height=None, background=None):
    """Render via the Rust engine. Returns (width, height, RGBA bytearray).

    Raises RuntimeError if the native engine is not available.
    """
    with _LOCK:
        if _ENGINE is None:
            _load()
        if not _ENGINE:
            raise RuntimeError("svgen_rs native engine not available")

    width, height, ops = rsops.build_ops(svg_text, width, height, background)
    ss = rsops.raster.SUPERSAMPLE

    lib = _ENGINE[0]
    ops_bytes = ctypes.create_string_buffer(ops, len(ops))
    bg = b"\x00\x00\x00\x00"
    if background:
        from .escape import parse_color
        c = parse_color(background)
        if c:
            bg = bytes((c[0], c[1], c[2], c[3]))

    handle = ctypes.c_void_p()
    data = ctypes.POINTER(ctypes.c_ubyte)()
    out_len = ctypes.c_size_t()
    out_w = ctypes.c_uint32()
    out_h = ctypes.c_uint32()

    rc = lib.svgen_render(
        ctypes.cast(ops_bytes, ctypes.c_void_p), len(ops),
        width, height, ss,
        ctypes.cast(ctypes.create_string_buffer(bg, 4), ctypes.c_void_p), 4,
        ctypes.byref(handle), ctypes.byref(data), ctypes.byref(out_len),
        ctypes.byref(out_w), ctypes.byref(out_h),
    )
    if rc != 0 or not handle.value:
        raise RuntimeError("svgen_rs render failed (rc=%d)" % rc)
    try:
        raw = ctypes.string_at(data, out_len.value)
        return int(out_w.value), int(out_h.value), bytearray(raw)
    finally:
        lib.svgen_free(handle)
