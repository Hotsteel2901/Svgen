"""SVG text escaping, color utilities and a small SVG DOM builder.

The backend is responsible for "escaping & composing" the SVG that the
front-end hands over — everything dangerous or fragile gets normalized here.
"""

import re

# --------------------------------------------------------------------------
# XML escaping
# --------------------------------------------------------------------------

_ATTR_ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"}
_TEXT_ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}


def esc_attr(value) -> str:
    if value is None:
        return ""
    return "".join(_ATTR_ESCAPES.get(ch, ch) for ch in str(value))


def esc_text(value) -> str:
    if value is None:
        return ""
    return "".join(_TEXT_ESCAPES.get(ch, ch) for ch in str(value))


# --------------------------------------------------------------------------
# Colors
# --------------------------------------------------------------------------

NAMED_COLORS = {
    "black": (0, 0, 0), "white": (255, 255, 255), "red": (255, 0, 0),
    "green": (0, 128, 0), "lime": (0, 255, 0), "blue": (0, 0, 255),
    "yellow": (255, 255, 0), "cyan": (0, 255, 255), "magenta": (255, 0, 255),
    "gray": (128, 128, 128), "grey": (128, 128, 128), "silver": (192, 192, 192),
    "maroon": (128, 0, 0), "olive": (128, 128, 0), "navy": (0, 0, 128),
    "purple": (128, 0, 128), "teal": (0, 128, 128), "orange": (255, 165, 0),
    "pink": (255, 192, 203), "brown": (165, 42, 42), "gold": (255, 215, 0),
    "skyblue": (135, 206, 235), "coral": (255, 127, 80), "transparent": (0, 0, 0, 0),
}


def parse_color(value):
    """Parse a CSS/SVG color into (r,g,b,a) with 0..255 channels.

    Returns None when the color cannot be parsed. Every channel is clamped:
    `rgb(300,0,0)` and `rgba(0,0,0,2)` are out-of-range but must not raise,
    because the result is fed straight into byte buffers.
    """
    if value is None:
        return None
    value = str(value).strip().lower()
    if value in ("none", ""):
        return None
    if value.startswith("#"):
        h = value[1:]
        try:
            if len(h) == 3:
                r, g, b = (int(c * 2, 16) for c in h)
                return (r, g, b, 255)
            if len(h) == 4:
                r, g, b, a = (int(c * 2, 16) for c in h)
                return (r, g, b, a)
            if len(h) == 6:
                r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
                return (r, g, b, 255)
            if len(h) == 8:
                r, g, b, a = (int(h[i:i + 2], 16) for i in (0, 2, 4, 6))
                return (r, g, b, a)
        except ValueError:
            return None
        return None
    if value in NAMED_COLORS:
        c = NAMED_COLORS[value]
        return c if len(c) == 4 else (c[0], c[1], c[2], 255)
    m = re.match(r"rgba?\(([^)]*)\)", value)
    if m:
        # Accepts `rgb(1,2,3)`, `rgb(1 2 3)`, `rgb(1 2 3 / .5)`, percentages.
        parts = [p for p in re.split(r"[\s,/]+", m.group(1).strip()) if p]
        if len(parts) < 3:
            return None
        try:
            def channel(p):
                v = float(p[:-1]) * 2.55 if p.endswith("%") else float(p)
                return clamp_byte(v)

            r, g, b = channel(parts[0]), channel(parts[1]), channel(parts[2])
            if len(parts) < 4:
                return (r, g, b, 255)
            raw = parts[3]
            av = float(raw[:-1]) / 100.0 if raw.endswith("%") else float(raw)
            return (r, g, b, clamp_byte(av * 255.0))
        except (ValueError, TypeError):
            return None
    return None


def clamp_byte(v) -> int:
    """Coerce anything numeric into an integer 0..255."""
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return 0
    return 0 if n < 0 else (255 if n > 255 else n)


def color_to_rgba(value, default=(0, 0, 0, 255)):
    c = parse_color(value)
    return c if c else default


def lerp_color(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def rgb_to_hex(rgba) -> str:
    r, g, b = rgba[0], rgba[1], rgba[2]
    return "#%02x%02x%02x" % (r, g, b)


# --------------------------------------------------------------------------
# Numbers / lengths
# --------------------------------------------------------------------------

_NUM_RE = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?")


def parse_number(value, default=0.0):
    try:
        return float(str(value).strip())
    except Exception:
        return default


def strip_units(value) -> float:
    """'12px'/'50%'/'1.5' -> float."""
    if value is None:
        return 0.0
    m = _NUM_RE.search(str(value))
    return float(m.group(0)) if m else 0.0


# --------------------------------------------------------------------------
# Minimal DOM builder used to re-serialize SVG.
# --------------------------------------------------------------------------


class Node:
    __slots__ = ("tag", "attrs", "children", "text")

    def __init__(self, tag, attrs=None, children=None, text=None):
        self.tag = tag
        self.attrs = dict(attrs) if attrs else {}
        self.children = children or []
        self.text = text

    def set(self, k, v):
        self.attrs[k] = v
        return self

    def get(self, k, default=None):
        return self.attrs.get(k, default)

    def append(self, node):
        self.children.append(node)
        return node

    def to_string(self, indent=0):
        pad = "  " * indent
        parts = ["%s<%s" % (pad, self.tag)]
        for k, v in self.attrs.items():
            if v is None:
                continue
            parts.append(' %s="%s"' % (k, esc_attr(v)))
        if not self.children and self.text is None:
            parts.append(" />")
            return "".join(parts)
        parts.append(">")
        if self.text is not None:
            parts.append(esc_text(self.text))
        else:
            for ch in self.children:
                parts.append("\n" + ch.to_string(indent + 1))
            parts.append("\n" + pad)
        parts.append("</%s>" % self.tag)
        return "".join(parts)


def parse_float_list(text) -> list:
    if not text:
        return []
    return [float(x) for x in _NUM_RE.findall(str(text))]


def format_num(x) -> str:
    if abs(x - round(x)) < 1e-9:
        return str(int(round(x)))
    return ("%g" % x)
