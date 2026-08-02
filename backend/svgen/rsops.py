"""Build a compact binary "paint command" stream from an SVG document.

Geometry, transforms and gradient resolution stay in Python (reusing raster.py
helpers); only the actual per-pixel rasterization is handed to the native Rust
engine. This keeps the feature set identical to the pure-Python rasterizer
while moving every hot loop (scanline fill, gradient sampling, blending,
downsampling) into native code.
"""

import math
import struct
import xml.etree.ElementTree as ET

from . import raster
from .escape import parse_color, parse_float_list, strip_units

MAGIC = 0x53564752
VERSION = 1
OP_FILL_POLY = 1
OP_FILL_RECT = 2

# paint modes
P_FLAT = 0
P_LINEAR = 1
P_RADIAL = 2

SPREAD = {"pad": 0, "reflect": 1, "repeat": 2}


def _xf(m, x, y):
    return (m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f)


def _attr(el, name, default=None):
    v = el.get(name)
    if v is None and el.get("style"):
        for part in el.get("style").split(";"):
            if ":" in part:
                k, val = part.split(":", 1)
                if k.strip() == name:
                    return val.strip()
    return default if v is None else v


def _num(el, name, default):
    v = _attr(el, name)
    return strip_units(v) if v is not None else default


def _visible(el):
    if _attr(el, "display") == "none":
        return False
    if _attr(el, "visibility") in ("hidden", "collapse"):
        return False
    return True


# --------------------------------------------------------------------------
# Gradients (shared resolver lives in raster.py)
# --------------------------------------------------------------------------


def _shape_paint(el, kind, bbox, mat, grads, op_mul):
    """Return (painter_spec, alpha_multiplier) for fill/stroke of a shape."""
    color_attr = _attr(el, kind, "black")
    op_attr = _attr(el, kind + "-opacity")
    op = 1.0 if op_attr is None else max(0.0, min(1.0, strip_units(op_attr)))
    if color_attr in (None, "none", ""):
        return None, 0.0
    if color_attr.startswith("url("):
        rid = color_attr[4:color_attr.rfind(")")].lstrip("#").rstrip(")")
        grad = grads.get(rid)
        if grad is not None:
            kind2, params, spread, stops = raster.resolve_gradient(grad, bbox, mat)
            return (kind2, params, spread, stops, op), op
    c = parse_color(color_attr)
    if c is None:
        return None, 0.0
    return ("flat", c, None, None, op), op


def _segment_quad(p0, p1, half):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return None
    nx, ny = -dy / length * half, dx / length * half
    return [(p0[0] + nx, p0[1] + ny), (p0[0] - nx, p0[1] - ny),
            (p1[0] - nx, p1[1] - ny), (p1[0] + nx, p1[1] + ny)]


def _stroke_solid_polys(pts, half, linecap, linejoin, closed):
    polys = []
    for i in range(len(pts) - 1):
        q = _segment_quad(pts[i], pts[i + 1], half)
        if q:
            polys.append(q)
    if closed and len(pts) > 2:
        q = _segment_quad(pts[-1], pts[0], half)
        if q:
            polys.append(q)
    if linecap == "round" or linejoin == "round":
        for p in pts:
            polys.append(raster._circle_poly(p[0], p[1], half, 20))
    if closed and linejoin == "round":
        polys.append(raster._circle_poly(pts[0][0], pts[0][1], half, 20))
    return polys


def _stroke_polys(pts, width, linecap, linejoin, closed, dasharray):
    """Return list of polygons covering the stroke (buffer space)."""
    if width <= 0 or len(pts) < 2:
        return []
    half = width / 2.0
    if dasharray and dasharray not in ("none",):
        return _stroke_dashed_polys(pts, half, dasharray)
    return _stroke_solid_polys(pts, half, linecap, linejoin, closed)


def _stroke_dashed_polys(pts, half, dasharray):
    pattern = parse_float_list(dasharray)
    pattern = [p for p in pattern if p > 0]
    if not pattern:
        return []
    total = sum(pattern)
    if total <= 0:
        return []
    runs = []
    run = [pts[0]]
    plen = 0.0
    pi = 0
    for i in range(1, len(pts)):
        dx = pts[i][0] - pts[i - 1][0]
        dy = pts[i][1] - pts[i - 1][1]
        seg = math.hypot(dx, dy)
        if seg == 0:
            continue
        while seg > 0:
            remaining = pattern[pi] - plen
            if seg < remaining:
                t = seg / math.hypot(dx, dy) if (dx or dy) else 0
                run.append((pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t))
                plen += seg
                seg = 0
            else:
                t = remaining / math.hypot(dx, dy) if (dx or dy) else 0
                newp = (pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t)
                run.append(newp)
                if pi % 2 == 0:
                    runs.append(run)
                run = [newp]
                plen = 0.0
                pi = (pi + 1) % len(pattern)
                seg -= remaining
                dx = pts[i][0] - newp[0]
                dy = pts[i][1] - newp[1]
                seg = math.hypot(dx, dy) if (pts[i][0] - newp[0] or pts[i][1] - newp[1]) else 0
    if pi % 2 == 0 and len(run) > 1:
        runs.append(run)
    polys = []
    for r in runs:
        polys.extend(_stroke_solid_polys(r, half, "round", "miter", False))
    return polys


# --------------------------------------------------------------------------
# Op stream builder
# --------------------------------------------------------------------------


class _Ops:
    def __init__(self, width, height, ss, background):
        self.width = width
        self.height = height
        self.ss = ss
        bg = (0, 0, 0, 0)
        if background:
            c = parse_color(background)
            if c:
                bg = c
        # header: magic u32, version u32, width u32, height u32, ss u32,
        #         bg rgba (4 bytes), n_ops u32 (patched later) = 28 bytes
        self.ops = bytearray(struct.pack("<IIIIIBBBBI", MAGIC, VERSION, width, height, ss, *bg, 0))
        self.n_ops = 0

    def _paint(self, painter_spec, op_mul):
        kind, params, spread, stops, alpha = painter_spec
        if kind == "flat":
            r, g, b, a = params
            a = int(min(255, a * op_mul))
            return struct.pack("<BBBBB", P_FLAT, r, g, b, a)
        if kind == "linear":
            ax, ay, dx, dy, len2 = params
            out = bytearray(struct.pack("<BBfffff", P_LINEAR, SPREAD.get(spread, 0), ax, ay, dx, dy, len2))
            out += self._stops(stops, op_mul)
            return bytes(out)
        if kind == "radial":
            ax, ay, r = params
            out = bytearray(struct.pack("<BBfff", P_RADIAL, SPREAD.get(spread, 0), ax, ay, r))
            out += self._stops(stops, op_mul)
            return bytes(out)
        return struct.pack("<BBBBB", P_FLAT, 0, 0, 0, 0)

    def _stops(self, stops, op_mul):
        out = bytearray(struct.pack("<H", len(stops)))
        for off, (r, g, b, a) in stops:
            out += struct.pack("<fBBBB", off, r, g, b, int(min(255, a * op_mul)))
        return bytes(out)

    def fill_poly(self, pts, rule, painter_spec, op_mul):
        self.ops += struct.pack("<BBI", OP_FILL_POLY, 0 if rule == "evenodd" else 1, len(pts))
        for x, y in pts:
            self.ops += struct.pack("<ff", x, y)
        self.ops += self._paint(painter_spec, op_mul)
        self.n_ops += 1

    def fill_rect(self, x, y, w, h, painter_spec, op_mul):
        self.ops += struct.pack("<Bffff", OP_FILL_RECT, x, y, w, h)
        self.ops += self._paint(painter_spec, op_mul)
        self.n_ops += 1

    def finalize(self):
        self.ops[24:28] = struct.pack("<I", self.n_ops)
        return bytes(self.ops)


def _flat_spec(color_str, alpha=1.0):
    c = parse_color(color_str)
    if c is None:
        return ("flat", (0, 0, 0, 0), None, None, 0.0)
    return ("flat", c, None, None, alpha)


def build_ops(svg_text, width=None, height=None, background=None):
    """Return (width, height, op_bytes)."""
    try:
        root = ET.fromstring(svg_text)
    except ET.ParseError as exc:
        raise ValueError("Invalid SVG: %s" % exc)
    if root.tag.rsplit("}", 1)[-1] != "svg":
        raise ValueError("not an svg element")

    sw = _attr(root, "width")
    sh = _attr(root, "height")
    vb = root.get("viewBox")
    vb_list = parse_float_list(vb) if vb else None
    if width is None:
        width = int(strip_units(sw) if sw else (vb_list[2] if vb_list else 800))
    if height is None:
        height = int(strip_units(sh) if sh else (vb_list[3] if vb_list else 600))
    width, height = int(width), int(height)
    if width <= 0 or height <= 0:
        raise ValueError("bad size")

    par = (root.get("preserveAspectRatio", "xMidYMid meet").strip())
    parts = par.split()
    align = parts[0] if parts else "xMidYMid"
    meet = "slice" in par or (len(parts) > 1 and parts[1] == "slice")

    if vb_list:
        vbx, vby, vbw, vbh = vb_list
        if vbw <= 0 or vbh <= 0:
            vbw, vbh = width, height
        sx = width / vbw
        sy = height / vbh
        s = min(sx, sy) if (align == "none" or meet) else max(sx, sy)
        ox = (width - vbw * s) / 2.0
        oy = (height - vbh * s) / 2.0
        base = raster.Mat(s, 0, 0, s, ox - vbx * s, oy - vby * s)
    else:
        base = raster.Mat(1, 0, 0, 1, 0, 0)

    ss = raster.SUPERSAMPLE
    # map user coordinates -> supersampled buffer space
    base = raster.Mat(base.a * ss, base.b * ss, base.c * ss, base.d * ss, base.e * ss, base.f * ss)

    ops = _Ops(width, height, ss, background)
    grads = raster._collect_defs(root)
    for child in list(root):
        _walk(child, grads, base, 1.0, ops, ss)
    return width, height, ops.finalize()


def _emit_shape(el, subpaths, mat, sub_op, ops, grads):
    if not subpaths:
        return
    local = [p for sp in subpaths for p in sp]
    if not local:
        return
    xs = [p[0] for p in local]
    ys = [p[1] for p in local]
    bbox = (min(xs), min(ys), max(xs), max(ys))
    tpaths = [[_xf(mat, px, py) for px, py in sp] for sp in subpaths]

    # fill
    spec, op = _shape_paint(el, "fill", bbox, mat, grads, sub_op)
    if spec is not None and op > 0:
        rule = _attr(el, "fill-rule", "nonzero")
        mul = op * sub_op
        for sp in tpaths:
            ops.fill_poly(sp, rule, spec, mul)

    # stroke
    stroke_w = _num(el, "stroke-width", 0.0)
    if _attr(el, "stroke") not in (None, "none", "") and stroke_w > 0:
        spec2, op2 = _shape_paint(el, "stroke", bbox, mat, grads, sub_op)
        if spec2 is not None and op2 > 0:
            dash = _attr(el, "stroke-dasharray")
            cap = _attr(el, "stroke-linecap", "butt")
            join = _attr(el, "stroke-linejoin", "miter")
            closed = raster._is_closed(el)
            sw = stroke_w * ops.ss
            mul = op2 * sub_op
            for sp in tpaths:
                for poly in _stroke_polys(sp, sw, cap, join, closed, dash):
                    ops.fill_poly(poly, "nonzero", spec2, mul)


def _emit_text(el, mat, sub_op, ops):
    text = (el.text or "") + "".join((ch.text or "") for ch in list(el))
    if not text.strip():
        return
    font_size = _num(el, "font-size", 16.0) * ops.ss
    x = _num(el, "x", 0)
    y = _num(el, "y", 0)
    dx = _num(el, "dx", 0)
    anchor = _attr(el, "text-anchor", "start")
    spec, op = _shape_paint(el, "fill", None, mat, {}, sub_op)
    if spec is None or op <= 0:
        return
    ax, ay = _xf(mat, x + dx, y)

    # measure
    w = 0
    for ch in text:
        key = ch.upper() if ch.islower() else ch
        if key not in raster._GLYPHS:
            key = " "
        w += raster._GLYPH_ADV
    w *= font_size / 7.0
    ox = ax
    if anchor == "middle":
        ox = ax - w / 2.0
    elif anchor == "end":
        ox = ax - w
    cx = ox
    scale = font_size / 7.0
    mul = op * sub_op
    for ch in text:
        key = ch.upper() if ch.islower() else ch
        if key not in raster._GLYPHS:
            key = " "
        glyph = raster._GLYPHS[key]
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "1":
                    ops.fill_rect(cx + gx * scale, ay + gy * scale, scale, scale, spec, mul)
        cx += raster._GLYPH_ADV * scale


def _walk(el, grads, mat, op, ops, ss):
    if not _visible(el):
        return
    tag = el.tag.rsplit("}", 1)[-1]
    op_attr = _attr(el, "opacity")
    sub_op = 1.0 if op_attr is None else max(0.0, min(1.0, strip_units(op_attr)))
    m = raster.parse_transform(_attr(el, "transform"), mat)
    child_op = op * sub_op
    if tag == "g":
        for child in list(el):
            _walk(child, grads, m, child_op, ops, ss)
        return
    if tag in ("defs", "clipPath", "mask", "symbol", "title", "desc", "metadata", "style",
               "linearGradient", "radialGradient"):
        return
    if tag in ("rect", "circle", "ellipse", "line", "polyline", "polygon", "path"):
        _emit_shape(el, raster.shape_subpaths(el, tag), m, child_op, ops, grads)
    elif tag == "text":
        _emit_text(el, m, child_op, ops)
