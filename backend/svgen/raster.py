"""Pure-Python SVG rasterizer.

No third-party dependencies. Supports the shapes / gradients / transforms the
front-end produces (rect, circle, ellipse, line, polyline, polygon, path,
text with a built-in 5x7 font, linear/radial gradients, groups, opacity,
dashes and the full transform grammar). Used as a portable fallback renderer;
when a browser is available the higher-fidelity Chrome headless path is used
instead.
"""

import math
import re
import xml.etree.ElementTree as ET

from .escape import parse_color, strip_units, parse_float_list

SUPERSAMPLE = 2

# --------------------------------------------------------------------------
# Matrix
# --------------------------------------------------------------------------


class Mat:
    __slots__ = ("a", "b", "c", "d", "e", "f")

    def __init__(self, a=1.0, b=0.0, c=0.0, d=1.0, e=0.0, f=0.0):
        self.a, self.b, self.c, self.d, self.e, self.f = a, b, c, d, e, f

    @staticmethod
    def identity():
        return Mat()

    def mul(self, o):
        """self * o (apply o's transforms after self's)."""
        return Mat(
            self.a * o.a + self.c * o.b,
            self.b * o.a + self.d * o.b,
            self.a * o.c + self.c * o.d,
            self.b * o.c + self.d * o.d,
            self.a * o.e + self.c * o.f + self.e,
            self.b * o.e + self.d * o.f + self.f,
        )

    def xf(self, x, y):
        return (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)


def parse_transform(s, default=None):
    m = default if default else Mat()
    if not s:
        return m
    for match in re.finditer(r"([a-zA-Z]+)\s*\(([^)]*)\)", s):
        name = match.group(1).lower()
        nums = parse_float_list(match.group(2))
        if name == "matrix" and len(nums) >= 6:
            t = Mat(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5])
        elif name == "translate":
            x = nums[0] if nums else 0.0
            y = nums[1] if len(nums) > 1 else 0.0
            t = Mat(1, 0, 0, 1, x, y)
        elif name == "scale":
            x = nums[0] if nums else 1.0
            y = nums[1] if len(nums) > 1 else x
            t = Mat(x, 0, 0, y, 0, 0)
        elif name == "rotate":
            ang = math.radians(nums[0] if nums else 0.0)
            cx = nums[1] if len(nums) > 1 else 0.0
            cy = nums[2] if len(nums) > 2 else 0.0
            cos, sin = math.cos(ang), math.sin(ang)
            t = Mat(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy)
        elif name == "skewx":
            ang = math.radians(nums[0] if nums else 0.0)
            t = Mat(1, 0, math.tan(ang), 1, 0, 0)
        elif name == "skewy":
            ang = math.radians(nums[0] if nums else 0.0)
            t = Mat(1, math.tan(ang), 0, 1, 0, 0)
        else:
            continue
        m = m.mul(t)
    return m


# --------------------------------------------------------------------------
# Canvas (RGBA supersampled buffer)
# --------------------------------------------------------------------------


class Canvas:
    def __init__(self, w, h):
        self.w = w
        self.h = h
        self.buf = bytearray(w * h * 4)

    def _blend(self, idx, r, g, b, a):
        if a >= 255:
            self.buf[idx] = r
            self.buf[idx + 1] = g
            self.buf[idx + 2] = b
            self.buf[idx + 3] = 255
            return
        if a <= 0:
            return
        da = a / 255.0
        sa = 1.0 - da
        self.buf[idx] = int(r * da + self.buf[idx] * sa)
        self.buf[idx + 1] = int(g * da + self.buf[idx + 1] * sa)
        self.buf[idx + 2] = int(b * da + self.buf[idx + 2] * sa)
        self.buf[idx + 3] = min(255, self.buf[idx + 3] + a)

    def paint_span(self, y, x0, x1, painter):
        x0i = max(0, int(math.floor(x0)))
        x1i = min(self.w, int(math.ceil(x1)))
        if x0i >= x1i or y < 0 or y >= self.h:
            return
        base = y * self.w * 4
        for x in range(x0i, x1i):
            c = painter(x + 0.5, y + 0.5)
            if c is None:
                continue
            r, g, b, a = c
            if a <= 0:
                continue
            idx = base + x * 4
            self._blend(idx, r, g, b, a)

    def paint_rect(self, x, y, w, h, painter):
        for yy in range(int(math.floor(y)), int(math.ceil(y + h))):
            self.paint_span(yy, x, x + w, painter)


# --------------------------------------------------------------------------
# Path parsing & flattening
# --------------------------------------------------------------------------

_PATH_RE = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?)")


def parse_path(d):
    cmds = []
    if not d:
        return cmds
    tokens = [(t, None) if t else (None, float(n)) for t, n in _PATH_RE.findall(d)]
    i = 0
    cur = None
    while i < len(tokens):
        kind, num = tokens[i]
        if kind:
            cur = kind
            i += 1
        else:
            if cur is None:
                i += 1
                continue
        prev_i = i
        if cur in "Mm":
            # repeatable
            first = True
            while i < len(tokens) and tokens[i][1] is not None:
                x, y = tokens[i][1], tokens[i + 1][1] if i + 1 < len(tokens) and tokens[i + 1][1] is not None else 0
                cmds.append((cur if first else ("l" if cur == "m" else "L"), x, y))
                first = False
                i += 2
            if i < len(tokens) and tokens[i][0]:
                continue
        elif cur in "LlTt":
            while i < len(tokens) and tokens[i][1] is not None:
                cmds.append((cur, tokens[i][1], tokens[i + 1][1] if i + 1 < len(tokens) and tokens[i + 1][1] is not None else 0))
                i += 2
            if i < len(tokens) and tokens[i][0]:
                continue
        elif cur in "HhVv":
            while i < len(tokens) and tokens[i][1] is not None:
                cmds.append((cur, tokens[i][1]))
                i += 1
        elif cur in "CcSs":
            if i + 5 < len(tokens) and tokens[i + 5][1] is not None:
                cmds.append((cur,) + tuple(tokens[i + k][1] for k in range(6)))
                i += 6
        elif cur in "Qq":
            if i + 3 < len(tokens) and tokens[i + 3][1] is not None:
                cmds.append((cur,) + tuple(tokens[i + k][1] for k in range(4)))
                i += 4
        elif cur in "Aa":
            if i + 6 < len(tokens) and tokens[i + 6][1] is not None:
                cmds.append((cur,) + tuple(tokens[i + k][1] for k in range(7)))
                i += 7
        elif cur == "Z" or cur == "z":
            cmds.append(("Z",))
            i += 1
            if i < len(tokens) and tokens[i][0]:
                continue
        if i == prev_i:
            i += 1
    return cmds


def _abs_cmds(cmds, start):
    x, y = start
    px, py = start
    out = []
    for c in cmds:
        k = c[0]
        if k == "M":
            x, y = c[1], c[2]
            out.append(("M", x, y))
        elif k == "m":
            x += c[1]; y += c[2]
            out.append(("M", x, y))
        elif k == "L":
            x, y = c[1], c[2]
            out.append(("L", x, y))
        elif k == "l":
            x += c[1]; y += c[2]
            out.append(("L", x, y))
        elif k == "H":
            x = c[1]
            out.append(("L", x, y))
        elif k == "h":
            x += c[1]
            out.append(("L", x, y))
        elif k == "V":
            y = c[1]
            out.append(("L", x, y))
        elif k == "v":
            y += c[1]
            out.append(("L", x, y))
        elif k == "C":
            out.append(("C", c[1], c[2], c[3], c[4], c[5], c[6]))
            px, py = c[3], c[4]
            x, y = c[5], c[6]
        elif k == "c":
            out.append(("C", x + c[1], y + c[2], x + c[3], y + c[4], x + c[5], y + c[6]))
            px, py = x + c[3], y + c[4]
            x, y = x + c[5], y + c[6]
        elif k == "S":
            cx, cy = (x + (x - px), y + (y - py)) if out and out[-1][0] == "C" else (x, y)
            out.append(("C", cx, cy, c[1], c[2], c[3], c[4]))
            px, py = c[1], c[2]
            x, y = c[3], c[4]
        elif k == "s":
            cx, cy = (x + (x - px), y + (y - py)) if out and out[-1][0] == "C" else (x, y)
            out.append(("C", cx, cy, x + c[1], y + c[2], x + c[3], y + c[4]))
            px, py = x + c[1], y + c[2]
            x, y = x + c[3], y + c[4]
        elif k == "Q":
            out.append(("Q", c[1], c[2], c[3], c[4]))
            px, py = c[1], c[2]
            x, y = c[3], c[4]
        elif k == "q":
            out.append(("Q", x + c[1], y + c[2], x + c[3], y + c[4]))
            px, py = x + c[1], y + c[2]
            x, y = x + c[3], y + c[4]
        elif k == "T":
            cx, cy = (x + (x - px), y + (y - py)) if out and out[-1][0] == "Q" else (x, y)
            out.append(("Q", cx, cy, c[1], c[2]))
            px, py = cx, cy
            x, y = c[1], c[2]
        elif k == "t":
            cx, cy = (x + (x - px), y + (y - py)) if out and out[-1][0] == "Q" else (x, y)
            out.append(("Q", cx, cy, x + c[1], y + c[2]))
            px, py = cx, cy
            x, y = x + c[1], y + c[2]
        elif k == "A":
            segs = arc_to_cubics(x, y, c[1], c[2], c[3], c[4], c[5], c[6], c[7])
            for seg in segs:
                out.append(("C",) + seg)
            px, py = x, y
            x, y = c[6], c[7]
        elif k == "a":
            segs = arc_to_cubics(x, y, c[1], c[2], c[3], c[4], c[5], x + c[6], y + c[7])
            for seg in segs:
                out.append(("C",) + seg)
            px, py = x, y
            x, y = x + c[6], y + c[7]
        elif k == "Z":
            out.append(("Z", x, y))
            x, y = start
    return out


def arc_to_cubics(x1, y1, rx, ry, rot, large, sweep, x2, y2):
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return [(x1, y1, x2, y2, x2, y2)]
    phi = math.radians(rot)
    cos_p, sin_p = math.cos(phi), math.sin(phi)
    dx2 = (x1 - x2) / 2.0
    dy2 = (y1 - y2) / 2.0
    x1p = cos_p * dx2 + sin_p * dy2
    y1p = -sin_p * dx2 + cos_p * dy2
    rxs = rx * rx
    rys = ry * ry
    x1ps = x1p * x1p
    y1ps = y1p * y1p
    lam = x1ps / rxs + y1ps / rys
    if lam > 1.0:
        s = math.sqrt(lam)
        rx *= s
        ry *= s
        rxs = rx * rx
        rys = ry * ry
    num = rxs * rys - rxs * y1ps - rys * x1ps
    den = rxs * y1ps + rys * x1ps
    coef = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        coef = -coef
    cxp = coef * (rx * y1p / ry)
    cyp = coef * (-ry * x1p / rx)
    cx = cos_p * cxp - sin_p * cyp + (x1 + x2) / 2.0
    cy = sin_p * cxp + cos_p * cyp + (y1 + y2) / 2.0
    th1 = math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx)
    th2 = math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx)
    delta = th2 - th1
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    if sweep and delta < 0:
        delta += 2 * math.pi
    n = max(1, int(math.ceil(abs(delta) / (math.pi / 2))))
    dth = delta / n
    out = []
    t = th1
    for _ in range(n):
        t2 = t + dth
        out.append(cubic_arc_seg(cx, cy, rx, ry, phi, t, t2))
        t = t2
    return out


def cubic_arc_seg(cx, cy, rx, ry, phi, t1, t2):
    cos_p, sin_p = math.cos(phi), math.sin(phi)
    x1 = cx + rx * math.cos(t1) * cos_p - ry * math.sin(t1) * sin_p
    y1 = cy + rx * math.cos(t1) * sin_p + ry * math.sin(t1) * cos_p
    x2 = cx + rx * math.cos(t2) * cos_p - ry * math.sin(t2) * sin_p
    y2 = cy + rx * math.cos(t2) * sin_p + ry * math.sin(t2) * cos_p
    alpha = math.sin(t2 - t1) * (math.sqrt(4 + 3 * math.tan((t2 - t1) / 2) ** 2) - 1) / 3
    c1 = (x1 - alpha * rx * math.sin(t1) * cos_p - alpha * ry * math.cos(t1) * sin_p,
          y1 - alpha * rx * math.sin(t1) * sin_p + alpha * ry * math.cos(t1) * cos_p)
    c2 = (x2 + alpha * rx * math.sin(t2) * cos_p + alpha * ry * math.cos(t2) * sin_p,
          y2 + alpha * rx * math.sin(t2) * sin_p - alpha * ry * math.cos(t2) * cos_p)
    return (c1[0], c1[1], c2[0], c2[1], x2, y2)


def flatten(cmds, start, tol=0.4):
    """Flatten into a list of closed-or-open polylines."""
    pts = []
    subpaths = []
    x, y = start
    moved = False
    for c in cmds:
        k = c[0]
        if k == "M":
            if moved and pts:
                subpaths.append(pts)
            pts = [(c[1], c[2])]
            x, y = c[1], c[2]
            moved = True
        elif k == "L":
            pts.append((c[1], c[2]))
            x, y = c[1], c[2]
        elif k == "C":
            _flat_cubic(pts, (x, y), (c[1], c[2]), (c[3], c[4]), (c[5], c[6]), tol)
            x, y = c[5], c[6]
        elif k == "Q":
            _flat_quad(pts, (x, y), (c[1], c[2]), (c[3], c[4]), tol)
            x, y = c[3], c[4]
        elif k == "Z":
            if pts and pts[0] != pts[-1]:
                pts.append(pts[0])
            subpaths.append(pts)
            pts = []
            x, y = start
            moved = False
    if pts:
        subpaths.append(pts)
    return subpaths


def _flat_cubic(pts, p0, p1, p2, p3, tol):
    d = (abs(p3[0] - p0[0]) + abs(p3[1] - p0[1]) + abs(p1[0] - p0[0]) + abs(p1[1] - p0[1]) + abs(p2[0] - p3[0]) + abs(p2[1] - p3[1]))
    if d < tol * 4:
        pts.append(p3)
        return
    pm = _cubic_mid(p0, p1, p2, p3)
    _flat_cubic(pts, p0, _mid(p0, p1), _mid3(p0, p1, p2), pm, tol)
    _flat_cubic(pts, pm, _mid3(p1, p2, p3), _mid(p2, p3), p3, tol)


def _flat_quad(pts, p0, p1, p2, tol):
    d = (abs(p2[0] - p0[0]) + abs(p2[1] - p0[1]) + abs(p1[0] - p0[0]) + abs(p1[1] - p0[1]))
    if d < tol * 4:
        pts.append(p2)
        return
    l = _mid(p0, p1)
    r = _mid(p1, p2)
    m = _mid(l, r)
    _flat_quad(pts, p0, l, m, tol)
    _flat_quad(pts, m, r, p2, tol)


def _mid(p, q):
    return ((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0)


def _mid3(p, q, r):
    return ((p[0] + 2 * q[0] + r[0]) / 4.0, (p[1] + 2 * q[1] + r[1]) / 4.0)


def _cubic_mid(p0, p1, p2, p3):
    return _mid(_mid(_mid(p0, p1), _mid(p1, p2)), _mid(_mid(p1, p2), _mid(p2, p3)))


def path_to_polylines(d, start=(0.0, 0.0), tol=0.4):
    return flatten(_abs_cmds(parse_path(d), start), start, tol)


# --------------------------------------------------------------------------
# Scanline polygon fill
# --------------------------------------------------------------------------


def polygon_bounds(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _build_edges(pts):
    edges = []
    n = len(pts)
    for i in range(n):
        p0 = pts[i]
        p1 = pts[(i + 1) % n]
        if p1[1] == p0[1]:
            continue
        if p0[1] < p1[1]:
            e = (p0[1], p1[1], p0[0], (p1[0] - p0[0]) / (p1[1] - p0[1]), 1.0)
        else:
            e = (p1[1], p0[1], p1[0], (p0[0] - p1[0]) / (p0[1] - p1[1]), -1.0)
        edges.append(e)
    edges.sort(key=lambda e: (e[0], e[2]))
    return edges


def fill_polylines(canvas, subpaths, rule, painter):
    for pts in subpaths:
        if len(pts) < 3:
            continue
        _fill_one(canvas, pts, rule, painter)


def _fill_one(canvas, pts, rule, painter):
    edges = _build_edges(pts)
    if not edges:
        return
    xmin, ymin, xmax, ymax = polygon_bounds(pts)
    y0 = max(0, int(math.floor(ymin)))
    y1 = min(canvas.h - 1, int(math.ceil(ymax)))
    if y0 > y1:
        return
    aet = []
    ei = 0
    for y in range(y0, y1 + 1):
        yy = y + 0.5
        while ei < len(edges) and edges[ei][0] <= yy:
            aet.append([edges[ei][2], edges[ei][1], edges[ei][3], edges[ei][4]])
            ei += 1
        # prune finished
        aet = [e for e in aet if e[1] > yy]
        for e in aet:
            e[0] += e[2]
        aet.sort(key=lambda e: e[0])
        if rule == "evenodd":
            inside = False
            start = 0.0
            for e in aet:
                if not inside:
                    start = e[0]
                inside = not inside
                if not inside:
                    canvas.paint_span(y, start, e[0], painter)
        else:
            winding = 0.0
            start = None
            for e in aet:
                prev = winding
                winding += e[3]
                if prev == 0.0 and winding != 0.0:
                    start = e[0]
                elif prev != 0.0 and winding == 0.0:
                    canvas.paint_span(y, start, e[0], painter)
                    start = None


# --------------------------------------------------------------------------
# Stroke rendering (offset quads + round caps/joins)
# --------------------------------------------------------------------------


def stroke_polyline(canvas, pts, width, painter, linecap="butt", linejoin="miter", closed=False,
                    dasharray=None):
    if width <= 0 or len(pts) < 2:
        return
    half = width / 2.0
    if dasharray:
        _stroke_dashed(canvas, pts, width, half, painter, linecap, dasharray)
        return
    _stroke_solid(canvas, pts, half, painter, linecap, linejoin, closed)


def _stroke_solid(canvas, pts, half, painter, linecap, linejoin, closed):
    for i in range(len(pts) - 1):
        _stroke_segment(canvas, pts[i], pts[i + 1], half, painter)
    if closed and len(pts) > 2:
        _stroke_segment(canvas, pts[-1], pts[0], half, painter)
    # caps / joins
    if linecap == "round" or linejoin == "round":
        for p in pts:
            circle_path = _circle_poly(p[0], p[1], half, 20)
            fill_polylines(canvas, [circle_path], "nonzero", painter)
    elif linecap == "square":
        pass  # square caps approximated by round (minor)
    if closed:
        if linejoin == "round":
            circle_path = _circle_poly(pts[0][0], pts[0][1], half, 20)
            fill_polylines(canvas, [circle_path], "nonzero", painter)


def _stroke_segment(canvas, p0, p1, half, painter):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return
    nx, ny = -dy / length * half, dx / length * half
    quad = [(p0[0] + nx, p0[1] + ny), (p0[0] - nx, p0[1] - ny),
            (p1[0] - nx, p1[1] - ny), (p1[0] + nx, p1[1] + ny)]
    fill_polylines(canvas, [quad], "nonzero", painter)


def _stroke_dashed(canvas, pts, width, half, painter, linecap, dash):
    pattern = dash if isinstance(dash, list) else parse_float_list(dash)
    if not pattern:
        return
    pattern = [p for p in pattern if p > 0]
    if not pattern:
        return
    # split polyline into sub-polylines by dash pattern
    total = sum(pattern)
    if total <= 0:
        return
    runs = []
    run = [pts[0]]
    dist = 0.0
    pi = 0
    plen = 0.0
    for i in range(1, len(pts)):
        dx, dy = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        seg = math.hypot(dx, dy)
        if seg == 0:
            continue
        while seg > 0:
            remaining = pattern[pi] - plen
            if seg < remaining:
                t = seg / math.hypot(dx, dy) if dx or dy else 0
                newp = (pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t)
                run.append(newp)
                plen += seg
                dist += seg
                seg = 0
            else:
                t = remaining / math.hypot(dx, dy) if dx or dy else 0
                newp = (pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t)
                run.append(newp)
                if pi % 2 == 0:
                    runs.append(run)
                run = [newp]
                plen = 0.0
                pi = (pi + 1) % len(pattern)
                dist += remaining
                seg -= remaining
                if dx:
                    dx *= 0
                    dx = pts[i][0] - newp[0]
                else:
                    pass
                dx = pts[i][0] - newp[0]
                dy = pts[i][1] - newp[1]
                seg = math.hypot(dx, dy) if (pts[i][0] - newp[0] or pts[i][1] - newp[1]) else 0
    if pi % 2 == 0 and len(run) > 1:
        runs.append(run)
    for r in runs:
        _stroke_solid(canvas, r, half, painter, "round", "miter", False)


def _circle_poly(cx, cy, r, n):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# --------------------------------------------------------------------------
# Gradients
# --------------------------------------------------------------------------


class Stop:
    __slots__ = ("offset", "color")

    def __init__(self, offset, color):
        self.offset = offset
        self.color = color


def _stop_offset(s):
    return s.offset if hasattr(s, "offset") else s[0]


def _stop_color(s):
    return s.color if hasattr(s, "color") else s[1]


def _sample_stops(stops, u, spread="pad"):
    if not stops:
        return (0, 0, 0, 0)
    if len(stops) == 1:
        return _stop_color(stops[0])
    if spread == "pad":
        if u <= _stop_offset(stops[0]):
            return _stop_color(stops[0])
        if u >= _stop_offset(stops[-1]):
            return _stop_color(stops[-1])
    elif spread == "reflect":
        u = abs(u)
    elif spread == "repeat":
        span = _stop_offset(stops[-1]) - _stop_offset(stops[0]) or 1.0
        u = (u - _stop_offset(stops[0])) % span + _stop_offset(stops[0])
    for i in range(len(stops) - 1):
        s0, s1 = stops[i], stops[i + 1]
        o0, o1 = _stop_offset(s0), _stop_offset(s1)
        if o0 <= u <= o1:
            span = o1 - o0
            t = (u - o0) / span if span else 0.0
            c0, c1 = _stop_color(s0), _stop_color(s1)
            return tuple(int(ca + (cb - ca) * t) for ca, cb in zip(c0, c1))
    return _stop_color(stops[0]) if u < _stop_offset(stops[0]) else _stop_color(stops[-1])


def resolve_gradient(grad, bbox, mat):
    """Resolve a gradient definition to buffer-space parameters.

    Returns (kind, params, spread, stops) where params are already in the
    supersampled buffer coordinate space.
    """
    stops = [(s.offset, s.color) for s in grad["stops"]]
    gmat = grad["transform"]
    if grad["units"] == "objectBoundingBox":
        bx, by, bw, bh = bbox
        if bw <= 0:
            bw = 1.0
        if bh <= 0:
            bh = 1.0
        if grad["kind"] == "linear":
            x1, y1, x2, y2 = grad["params"]
            p1 = gmat.xf(bx + x1 * bw, by + y1 * bh)
            p2 = gmat.xf(bx + x2 * bw, by + y2 * bh)
        else:
            cx, cy, r = grad["params"]
            pc = gmat.xf(bx + cx * bw, by + cy * bh)
            rad = max(bw, bh) / 2.0 * r
            p1 = (pc[0], pc[1])
            p2 = (pc[0] + rad, pc[1])
    else:
        if grad["kind"] == "linear":
            x1, y1, x2, y2 = grad["params"]
            p1 = gmat.xf(x1, y1)
            p2 = gmat.xf(x2, y2)
        else:
            cx, cy, r = grad["params"]
            p1 = gmat.xf(cx, cy)
            p2 = gmat.xf(cx + r, cy)
    if grad["kind"] == "linear":
        ax, ay = mat.xf(p1[0], p1[1])
        bx2, by2 = mat.xf(p2[0], p2[1])
        dx, dy = bx2 - ax, by2 - ay
        len2 = dx * dx + dy * dy
        return ("linear", (ax, ay, dx, dy, len2), grad["spread"], stops)
    ax, ay = mat.xf(p1[0], p1[1])
    bx2, by2 = mat.xf(p2[0], p2[1])
    r = math.hypot(bx2 - ax, by2 - ay)
    return ("radial", (ax, ay, r), grad["spread"], stops)


def build_gradient_painter(kind, params, stops, spread="pad"):
    """Build a per-pixel painter from already buffer-space resolved params."""
    if kind == "linear":
        ax, ay, dx, dy, len2 = params

        def paint(px, py):
            if len2 == 0:
                u = 0.0
            else:
                u = ((px - ax) * dx + (py - ay) * dy) / len2
            return _sample_stops(stops, u, spread)
    else:  # radial
        ax, ay, r = params
        rr = r if r > 0 else 1.0

        def paint(px, py):
            u = math.hypot(px - ax, py - ay) / rr
            return _sample_stops(stops, u, spread)
    return paint


def _flat_painter(rgba):
    return lambda x, y: rgba


# --------------------------------------------------------------------------
# 5x7 built-in font
# --------------------------------------------------------------------------

_GLYPHS = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
    ",": ["00000", "00000", "00000", "00000", "00110", "00110", "00100"],
    "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
    "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
    ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
    ";": ["00000", "00110", "00110", "00000", "00110", "00110", "00100"],
    "'": ["00100", "00100", "00100", "00000", "00000", "00000", "00000"],
    '"': ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
    "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
    ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
    "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
    "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
    "{": ["00010", "00100", "00100", "01000", "00100", "00100", "00010"],
    "}": ["01000", "00100", "00100", "00010", "00100", "00100", "01000"],
    "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
    "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    "\\": ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
    "|": ["00100", "00100", "00100", "00100", "00100", "00100", "00100"],
    "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
    "#": ["01010", "11111", "01010", "01010", "11111", "01010", "00000"],
    "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
    "@": ["01110", "10001", "10001", "10111", "10110", "10000", "01110"],
    "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
    "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
    ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}

_GLYPH_ADV = 6


def text_width(text, font_size):
    scale = font_size / 7.0
    w = 0
    for ch in text:
        key = ch.upper() if ch.islower() else ch
        if key not in _GLYPHS:
            key = " "
        w += _GLYPH_ADV
    return w * scale


def draw_text(canvas, text, x, y, font_size, painter, anchor="start"):
    scale = font_size / 7.0
    w = 0
    for ch in text:
        key = ch.upper() if ch.islower() else ch
        if key not in _GLYPHS:
            key = " "
        w += _GLYPH_ADV
    w *= scale
    ox = x
    if anchor == "middle":
        ox = x - w / 2.0
    elif anchor == "end":
        ox = x - w
    cx = ox
    for ch in text:
        key = ch.upper() if ch.islower() else ch
        if key not in _GLYPHS:
            key = " "
        glyph = _GLYPHS[key]
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "1":
                    px = cx + gx * scale
                    py = y + gy * scale
                    canvas.paint_rect(px, py, scale, scale, painter)
        cx += _GLYPH_ADV * scale


# --------------------------------------------------------------------------
# Renderer
# --------------------------------------------------------------------------


def _attr(el, name, default=None):
    v = el.get(name)
    if v is None and el.get("style"):
        for part in el.get("style").split(";"):
            if ":" in part:
                k, val = part.split(":", 1)
                if k.strip() == name:
                    return val.strip()
    return default if v is None else v


def _number(el, name, default):
    v = _attr(el, name)
    return strip_units(v) if v is not None else default


def _visible(el):
    if _attr(el, "display") == "none":
        return False
    if _attr(el, "visibility") in ("hidden", "collapse"):
        return False
    return True


class _Renderer:
    def __init__(self, root, defs, width, height, scale, mat, opacity=1.0, canvas=None):
        self.root = root
        self.defs = defs
        self.width = width
        self.height = height
        self.scale = scale
        self.mat = mat
        self.opacity = opacity
        self.canvas = canvas

    def painter_for(self, el, fill_kind="fill", bbox=None):
        """Return painter + opacity multiplier for fill or stroke."""
        color_attr = _attr(el, fill_kind, "black")
        op_attr = _attr(el, fill_kind + "-opacity")
        op = 1.0 if op_attr is None else max(0.0, min(1.0, strip_units(op_attr)))
        op *= self.opacity
        if color_attr in (None, "none", ""):
            return None, 0
        g = None
        if color_attr.startswith("url("):
            rid = color_attr[4:color_attr.rfind(")")].lstrip("#").rstrip(")")
            g = self.defs.get(rid)
        if g is not None:
            kind, params, spread, stops = resolve_gradient(g, bbox, self.mat)
            painter = build_gradient_painter(kind, params, stops, spread)
        else:
            c = parse_color(color_attr)
            if c is None:
                return None, 0
            r, gg, b, a = c
            painter = _flat_painter((r, gg, b, a))
            op *= a / 255.0
        return painter, op

    def render(self, el):
        if not _visible(el):
            return
        tag = el.tag.rsplit("}", 1)[-1]
        op_attr = _attr(el, "opacity")
        sub_op = 1.0 if op_attr is None else max(0.0, min(1.0, strip_units(op_attr)))
        m = parse_transform(_attr(el, "transform"), self.mat)
        if tag == "g":
            child_renderer = _Renderer(self.root, self.defs, self.width, self.height,
                                       self.scale, m, self.opacity * sub_op, self.canvas)
            for child in list(el):
                child_renderer.render(child)
            return
        if tag in ("defs", "clipPath", "mask", "symbol", "title", "desc", "metadata", "style"):
            return
        if tag in ("linearGradient", "radialGradient"):
            return  # handled through defs map
        if tag in ("rect", "circle", "ellipse", "line", "polyline", "polygon", "path"):
            subpaths = shape_subpaths(el, tag)
            if not subpaths:
                return
            geom_bbox = None
            local_pts = []
            for sp in subpaths:
                local_pts.extend(sp)
            if local_pts:
                xs = [p[0] for p in local_pts]
                ys = [p[1] for p in local_pts]
                geom_bbox = (min(xs), min(ys), max(xs), max(ys))
            self._render_polys(el, subpaths, m, sub_op, geom_bbox)
        elif tag == "text":
            self._render_text(el, m, sub_op)

    def _render_polys(self, el, subpaths, mat, sub_op, geom_bbox):
        # transform local points
        tpaths = []
        for sp in subpaths:
            tpaths.append([mat.xf(px, py) for px, py in sp])
        # gradient resolution uses object bbox in user space -> build paintable
        saved = self.mat
        self.mat = mat
        painter, op = self.painter_for(el, "fill", geom_bbox)
        if painter is not None and op > 0:
            def mkfill(p):
                base_op = op * sub_op
                def pt(x, y):
                    c = p(x, y)
                    if c is None:
                        return None
                    return (c[0], c[1], c[2], int(min(255, c[3] * base_op)))
                return pt
            fill_polylines(self.canvas, tpaths, _attr(el, "fill-rule", "nonzero"), mkfill(painter))
        stroke_w = _number(el, "stroke-width", 0.0)
        if _attr(el, "stroke") not in (None, "none", "") and stroke_w > 0:
            sp, sop = self.painter_for(el, "stroke", geom_bbox)
            if sp is not None and sop > 0:
                dash = _attr(el, "stroke-dasharray")
                dash_list = None
                if dash and dash not in ("none",):
                    dash_list = parse_float_list(dash)
                base_op = sop * sub_op
                def mkstr(p):
                    def pt(x, y):
                        c = p(x, y)
                        if c is None:
                            return None
                        return (c[0], c[1], c[2], int(min(255, c[3] * base_op)))
                    return pt
                spp = mkstr(sp)
                for poly in tpaths:
                    stroke_polyline(self.canvas, poly, stroke_w * self.scale, spp,
                                    _attr(el, "stroke-linecap", "butt"),
                                    _attr(el, "stroke-linejoin", "miter"),
                                    _is_closed(el), dash_list)
        self.mat = saved

    def _render_text(self, el, mat, sub_op):
        text = (el.text or "")
        for ch in list(el):
            text += (ch.text or "")
        if not text.strip():
            return
        font_size = _number(el, "font-size", 16.0) * self.scale
        x = _number(el, "x", 0)
        y = _number(el, "y", 0)
        dx = _number(el, "dx", 0)
        anchor = _attr(el, "text-anchor", "start")
        painter, op = self.painter_for(el, "fill", None)
        if painter is None or op <= 0:
            return
        ax, ay = mat.xf(x + dx, y)
        def mk(p):
            base_op = op * sub_op
            def pt(xx, yy):
                c = p(xx, yy)
                if c is None:
                    return None
                return (c[0], c[1], c[2], int(min(255, c[3] * base_op)))
            return pt
        draw_text(self.canvas, text, ax, ay, font_size, mk(painter), anchor)


def _is_closed(el):
    tag = el.tag.rsplit("}", 1)[-1]
    if tag == "polygon":
        return True
    if tag == "path":
        d = el.get("d") or ""
        return d.rstrip().endswith("Z") or d.rstrip().endswith("z")
    if tag == "rect":
        return True
    return False


def _collect_defs(root):
    defs = {}
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag not in ("linearGradient", "radialGradient"):
            continue
        gid = el.get("id")
        if not gid:
            continue
        units = el.get("gradientUnits", "objectBoundingBox")
        transform = parse_transform(el.get("gradientTransform"))
        spread = el.get("spreadMethod", "pad")
        stops = []
        for stop in list(el):
            if stop.tag.rsplit("}", 1)[-1] != "stop":
                continue
            off = strip_units(stop.get("offset", "0")) / 100.0 if "%" in (stop.get("offset") or "") else strip_units(stop.get("offset", "0"))
            c = parse_color(_attr(stop, "stop-color", "black"))
            so = _attr(stop, "stop-opacity")
            if c is None:
                continue
            if so is not None:
                c = (c[0], c[1], c[2], int(255 * max(0, min(1, strip_units(so)))))
            stops.append(Stop(off, c))
        stops.sort(key=lambda s: s.offset)
        params = None
        if tag == "linearGradient":
            params = (strip_units(el.get("x1", "0%")), strip_units(el.get("y1", "0%")),
                      strip_units(el.get("x2", "100%")), strip_units(el.get("y2", "0%")))
        else:
            params = (strip_units(el.get("cx", "50%")), strip_units(el.get("cy", "50%")),
                      strip_units(el.get("r", "50%")))
        defs[gid] = {"kind": "linear" if tag == "linearGradient" else "radial",
                     "params": params, "stops": stops, "spread": spread,
                     "units": units, "transform": transform, "bbox": None}
    return defs


def _root_viewport(root):
    w = _attr(root, "width")
    h = _attr(root, "height")
    vb = root.get("viewBox")
    def parse_length(v):
        return strip_units(v) if v is not None else None
    return parse_length(w), parse_length(h), vb


def shape_subpaths(el, tag):
    """Geometry for a shape element -> list of local-space polylines."""
    if tag == "rect":
        x = _number(el, "x", 0); y = _number(el, "y", 0)
        w = _number(el, "width", 0); h = _number(el, "height", 0)
        rx = _number(el, "rx", 0); ry = _number(el, "ry", rx)
        if rx > 0 or ry > 0:
            rx = min(rx, w / 2); ry = min(ry, h / 2)
            d = ("M %.3f %.3f L %.3f %.3f A %.3f %.3f 0 0 1 %.3f %.3f L %.3f %.3f "
                 "A %.3f %.3f 0 0 1 %.3f %.3f L %.3f %.3f A %.3f %.3f 0 0 1 %.3f %.3f "
                 "L %.3f %.3f A %.3f %.3f 0 0 1 %.3f %.3f Z") % (
                x + rx, y, x + w - rx, y, rx, ry, x + w, y + ry,
                x + w, y + h - ry, rx, ry, x + w - rx, y + h,
                x + rx, y + h, rx, ry, x, y + h - ry,
                x, y + ry, rx, ry, x + rx, y)
            return path_to_polylines(d)
        return [[(x, y), (x + w, y), (x + w, y + h), (x, y + h)]]
    if tag == "circle":
        cx = _number(el, "cx", 0); cy = _number(el, "cy", 0); r = _number(el, "r", 0)
        return [_circle_poly(cx, cy, r, 64)]
    if tag == "ellipse":
        cx = _number(el, "cx", 0); cy = _number(el, "cy", 0)
        rx = _number(el, "rx", 0); ry = _number(el, "ry", 0)
        pts = []
        for i in range(64):
            a = 2 * math.pi * i / 64
            pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
        return [pts]
    if tag == "line":
        return [[(_number(el, "x1", 0), _number(el, "y1", 0)),
                 (_number(el, "x2", 0), _number(el, "y2", 0))]]
    if tag == "polyline" or tag == "polygon":
        pts = list(zip(parse_float_list(_attr(el, "points", ""))[0::2],
                       parse_float_list(_attr(el, "points", ""))[1::2]))
        if not pts:
            return []
        if tag == "polygon":
            pts.append(pts[0])
        return [pts]
    if tag == "path":
        return path_to_polylines(_attr(el, "d", ""))
    return []


def render_to_pixels(svg_text, width=None, height=None, background=None):
    """Render SVG to a supersampled RGBA buffer. Returns (pw, ph, bytearray RGBA).

    `width`/`height` are the output pixel size; None means derive from the SVG.
    """
    try:
        root = ET.fromstring(svg_text)
    except ET.ParseError as exc:
        raise ValueError("Invalid SVG: %s" % exc)

    if root.tag.rsplit("}", 1)[-1] != "svg":
        # allow fragment -> wrap
        root = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg",
                                  "viewBox": "0 0 800 600", "width": "800", "height": "600"})
        try:
            root = ET.fromstring(svg_text)
            if root.tag.rsplit("}", 1)[-1] != "svg":
                raise ValueError("not an svg element")
        except ET.ParseError:
            raise ValueError("Invalid SVG")

    sw, sh, vb = _root_viewport(root)
    vb_list = parse_float_list(vb) if vb else None
    if width is None:
        width = int(sw or (vb_list[2] if vb_list else 800))
    if height is None:
        height = int(sh or (vb_list[3] if vb_list else 600))
    if width <= 0 or height <= 0:
        raise ValueError("Invalid output size %dx%d" % (width, height))

    par = root.get("preserveAspectRatio", "xMidYMid meet").strip()
    parts = par.split()
    align = parts[0] if parts else "xMidYMid"
    meet = "slice" in par or (len(parts) > 1 and parts[1] == "slice")

    if vb_list:
        vbx, vby, vbw, vbh = vb_list
        if vbw <= 0 or vbh <= 0:
            vbw, vbh = width, height
        sx = width / vbw
        sy = height / vbh
        if align == "none":
            s = min(sx, sy)
        elif meet:
            s = min(sx, sy)
        else:
            s = max(sx, sy)
        ox = (width - vbw * s) / 2.0
        oy = (height - vbh * s) / 2.0
        base = Mat(s, 0, 0, s, ox - vbx * s, oy - vby * s)
    else:
        base = Mat(1, 0, 0, 1, 0, 0)

    S = SUPERSAMPLE
    # map user coordinates -> supersampled buffer space
    base = Mat(base.a * S, base.b * S, base.c * S, base.d * S, base.e * S, base.f * S)

    pw, ph = width * S, height * S
    canvas = Canvas(pw, ph)
    defs = _collect_defs(root)
    # bake gradient bboxes lazily via objectBoundingBox -> we approximate
    renderer = _Renderer(root, defs, width, height, S, base, 1.0, canvas)
    for child in list(root):
        renderer.render(child)

    # downsample
    out = bytearray(width * height * 4)
    buf = canvas.buf
    for oy in range(height):
        for ox in range(width):
            r = g = b = a = 0
            cnt = 0
            for sy in range(S):
                for sx in range(S):
                    idx = ((oy * S + sy) * pw + (ox * S + sx)) * 4
                    r += buf[idx]; g += buf[idx + 1]; b += buf[idx + 2]; a += buf[idx + 3]
                    cnt += 1
            idx = (oy * width + ox) * 4
            out[idx] = r // cnt
            out[idx + 1] = g // cnt
            out[idx + 2] = b // cnt
            out[idx + 3] = a // cnt

    if background:
        bg = parse_color(background)
        if bg:
            br, bg_, bb, ba = bg
            for i in range(width * height):
                idx = i * 4
                da = ba / 255.0
                out[idx] = int(br * da + out[idx] * (1 - da))
                out[idx + 1] = int(bg_ * da + out[idx + 1] * (1 - da))
                out[idx + 2] = int(bb * da + out[idx + 2] * (1 - da))
                out[idx + 3] = max(out[idx + 3], ba)
    return width, height, out
