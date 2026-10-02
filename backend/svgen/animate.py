"""SMIL animation sampler ("baking").

The front-end exports SVG containing SMIL <animate> / <animateTransform>
elements. We cannot screen-record a browser per frame, so instead we *bake*:
for each frame time t we sample every animation, write the resulting attribute
value onto its target element, drop the <animate> nodes, and hand a plain static
SVG to whatever rasterizer is available.

Baking used to look animations up by their `id` attribute — but exported
<animate> nodes carry no id, so every spec was silently skipped and every frame
came out identical (a still image mislabelled as a video). Lookup is now done by
a marker attribute stamped on each node at collection time, which survives the
deep copy and costs one dict.

Frame times are `i / fps`, so a 2 s @ 30 fps clip yields exactly 60 distinct
frames with the last one at 1.967 s — not 61 with a duplicate at t = duration.
"""

import copy
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .escape import parse_float_list, parse_color, lerp_color, format_num

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
SVGEN_NS = "http://svgen.app"

# Emit a bare <svg> root instead of <ns0:svg> when re-serializing.
try:
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK_NS)
except ValueError:  # pragma: no cover - only if another import beat us to it
    pass

# Attribute stamped on every <animate*> node so its clone can be found after
# deepcopy without relying on document ids.
MARKER = "data-svgen-anim"

_ANIM_TAGS = ("animate", "animateTransform", "animateMotion", "animateColor")
_TRANSFORM_TYPES = ("translate", "scale", "rotate", "skewX", "skewY")


@dataclass
class AnimSpec:
    elem: ET.Element
    target: ET.Element
    attribute: str
    anim_type: str                     # 'animate' | 'animateTransform' | ...
    values: list = field(default_factory=list)      # value strings
    key_times: list = field(default_factory=list)   # floats 0..1
    dur: float = 1.0
    begin: float = 0.0
    repeat_count: float = 1.0          # float('inf') allowed
    fill: str = "remove"
    calc_mode: str = "linear"
    transform_type: str = "translate"
    namespace: str = ""
    marker: str = ""
    parent_id: str = ""                # data-svgen-parent, when present
    base_value: str = None             # the target's attribute before animating


def _local_name(tag):
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1]


def _namespace_of(tag):
    if isinstance(tag, str) and "}" in tag:
        return tag[: tag.rindex("}") + 1]
    return ""


def parse_duration(value, default=1.0) -> float:
    """'2s' / '500ms' / '1.5' -> seconds. Tolerates junk."""
    if value is None:
        return default
    text = str(value).strip().lower()
    if not text:
        return default
    mult = 1.0
    if text.endswith("ms"):
        text, mult = text[:-2], 0.001
    elif text.endswith("min"):
        text, mult = text[:-3], 60.0
    elif text.endswith("h"):
        text, mult = text[:-1], 3600.0
    elif text.endswith("s"):
        text = text[:-1]
    text = text.strip()
    try:
        return float(text) * mult
    except ValueError:
        return default


def _default_key_times(n_values):
    if n_values <= 1:
        return [0.0]
    return [i / (n_values - 1) for i in range(n_values)]


def _parent_map(root):
    """{child: parent} for the whole tree — avoids an O(n) walk per animation."""
    return {child: parent for parent in root.iter() for child in parent}


def _find_by_id(root, eid):
    if not eid:
        return None
    for el in root.iter():
        if el.get("id") == eid:
            return el
    return None


def _resolve_target(root, anim_elem, parents):
    href = anim_elem.get("href") or anim_elem.get("{%s}href" % XLINK_NS)
    if href and href.startswith("#"):
        found = _find_by_id(root, href[1:])
        if found is not None:
            return found
    return parents.get(anim_elem, anim_elem)


def collect_animations(svg_text):
    """Parse an SVG string. Returns (root, [AnimSpec], duration_seconds)."""
    root = ET.fromstring(svg_text)
    parents = _parent_map(root)
    anims = []
    seen_markers = set()

    for elem in root.iter():
        tag = _local_name(elem.tag)
        if tag not in _ANIM_TAGS:
            continue
        attribute = elem.get("attributeName", "")
        if not attribute:
            continue
        anim_type = tag if tag != "animateColor" else "animate"

        values = []
        raw_values = elem.get("values")
        if raw_values is not None:
            values = [v.strip() for v in raw_values.split(";")]

        target = _resolve_target(root, elem, parents)
        base_value = target.get(attribute)

        if not values:
            frm = elem.get("from")
            to = elem.get("to")
            by = elem.get("by")
            if frm is not None and to is not None:
                values = [frm, to]
            elif frm is not None and by is not None:
                a = parse_float_list(frm)
                b = parse_float_list(by)
                if a and b and len(a) == len(b):
                    values = [frm, " ".join(format_num(x + y) for x, y in zip(a, b))]
                else:
                    values = [frm]
            elif to is not None:
                # `to` alone animates from the element's current value.
                values = [base_value if base_value is not None else "", to]
            elif by is not None and base_value is not None:
                # `by` alone animates from the current value to current + by.
                a = parse_float_list(base_value)
                b = parse_float_list(by)
                if a and b and len(a) == len(b):
                    values = [base_value, " ".join(format_num(x + y) for x, y in zip(a, b))]
        if len(values) < 1:
            continue

        key_times = parse_float_list(elem.get("keyTimes", "")) or _default_key_times(len(values))
        while len(key_times) < len(values):
            key_times.append(1.0)
        key_times = key_times[: len(values)]

        dur = parse_duration(elem.get("dur"), 1.0)
        begin = parse_duration(elem.get("begin"), 0.0)
        repeat_raw = (elem.get("repeatCount") or "1").strip()
        if repeat_raw == "indefinite":
            repeat_count = float("inf")
        else:
            try:
                repeat_count = max(0.0, float(repeat_raw))
            except ValueError:
                repeat_count = 1.0

        marker = elem.get(MARKER)
        if not marker or marker in seen_markers:
            marker = "a%d" % len(seen_markers)
            elem.set(MARKER, marker)
        seen_markers.add(marker)

        anims.append(
            AnimSpec(
                elem=elem,
                target=target,
                attribute=attribute,
                anim_type=anim_type,
                values=values,
                key_times=key_times,
                dur=dur if dur > 0 else 1.0,
                begin=begin,
                repeat_count=repeat_count,
                fill=elem.get("fill", "remove"),
                calc_mode=elem.get("calcMode", "linear"),
                transform_type=(elem.get("type") or "translate").strip(),
                namespace=_namespace_of(elem.tag),
                marker=marker,
                parent_id=(elem.get("%sparent" % ("{%s}" % SVGEN_NS))
                           or elem.get("data-svgen-parent") or ""),
                base_value=base_value,
            )
        )

    duration = 0.0
    for a in anims:
        if a.repeat_count == float("inf"):
            end = a.begin + a.dur
        else:
            end = a.begin + a.dur * max(a.repeat_count, 1.0)
        duration = max(duration, end)
    return root, anims, duration


# --------------------------------------------------------------------------
# Interpolation
# --------------------------------------------------------------------------


def _looks_color(s):
    if not s:
        return False
    t = s.strip().lower()
    return t.startswith("#") or t.startswith("rgb") or t.startswith("hsl")


def _lerp_color_string(v0, v1, f):
    c0 = parse_color(v0)
    c1 = parse_color(v1)
    if c0 and c1:
        c = lerp_color(c0, c1, f)
        return "rgba(%d,%d,%d,%g)" % (c[0], c[1], c[2], c[3] / 255.0)
    return v1 if f >= 0.5 else v0


def _lerp_list_string(v0, v1, f):
    n0 = parse_float_list(v0)
    n1 = parse_float_list(v1)
    if n0 and n1 and len(n0) == len(n1):
        return " ".join(format_num(a + (b - a) * f) for a, b in zip(n0, n1))
    return v1 if f >= 0.5 else v0


def _lerp_transform(v0, v1, f, ttype):
    if ttype in _TRANSFORM_TYPES:
        return "%s(%s)" % (ttype, _lerp_list_string(v0, v1, f))
    return v1 if f >= 0.5 else v0


def _format_value(a, v0, v1, f):
    """Blend two value strings according to the animation's kind."""
    if v0 == "" and v1 != "":
        return v1
    if v1 == "" and v0 != "":
        return v0
    if a.anim_type == "animateTransform":
        return _lerp_transform(v0, v1, f, a.transform_type)
    if a.attribute.endswith("opacity"):
        # Opacity is a bare number, not a colour: interpolate it numerically or
        # a fade becomes a hard cut at the midpoint.
        return _lerp_list_string(v0, v1, f)
    if _looks_color(v0) or _looks_color(v1):
        return _lerp_color_string(v0, v1, f)
    return _lerp_list_string(v0, v1, f)


def _interpolate(a, local_t):
    """Interpolated *value string* for one animation at its local time."""
    if not a.values:
        return None
    n = len(a.values)
    if n == 1:
        # A single value still has to be wrapped/normalised for its kind.
        return _format_value(a, a.values[0], a.values[0], 0.0)

    kt = list(a.key_times)
    while len(kt) < n:
        kt.append(1.0)
    kt = kt[:n]
    # keyTimes must be non-decreasing; repair rather than crash.
    for i in range(1, n):
        if kt[i] < kt[i - 1]:
            kt[i] = kt[i - 1]

    t = max(0.0, min(local_t, a.dur))
    u = t / a.dur if a.dur > 0 else 1.0

    if a.calc_mode == "discrete":
        idx = 0
        for i in range(n):
            if u >= kt[i]:
                idx = i
        return _format_value(a, a.values[idx], a.values[idx], 0.0)

    # Clamp into the first/last segment instead of returning a raw value —
    # transform types must still be wrapped as `translate(...)` etc.
    if u <= kt[0]:
        seg, f = 0, 0.0
    elif u >= kt[-1]:
        seg, f = n - 2, 1.0
    else:
        seg = n - 2
        for i in range(n - 1):
            if kt[i] <= u <= kt[i + 1]:
                seg = i
                break
        span = kt[seg + 1] - kt[seg]
        f = 0.0 if span <= 1e-12 else (u - kt[seg]) / span

    return _format_value(a, a.values[seg], a.values[seg + 1], f)


# --------------------------------------------------------------------------
# Baking
# --------------------------------------------------------------------------


class _Baked:
    """A parsed animation prepared for repeated sampling against one tree."""

    __slots__ = ("spec", "node", "parent", "host", "had_attr")

    def __init__(self, spec, node, parent, host, had_attr):
        self.spec = spec
        self.node = node        # the <animate*> clone we will strip
        self.parent = parent    # its parent, for stripping
        self.host = host        # the element whose attribute we write
        self.had_attr = had_attr


def _prepare(root, anims):
    """Deep copy once, resolve every clone, and strip the animation nodes."""
    tree = copy.deepcopy(root)
    parents = _parent_map(tree)
    by_marker = {}
    for el in tree.iter():
        marker = el.get(MARKER)
        if marker is not None:
            by_marker[marker] = el

    baked = []
    for spec in anims:
        node = by_marker.get(spec.marker)
        if node is None:
            continue
        parent = parents.get(node)
        # SMIL targets the animation element's parent; `data-svgen-parent`
        # (written by the front-end) names it explicitly when groups are nested.
        host = _find_by_id(tree, spec.parent_id) if spec.parent_id else None
        if host is None:
            host = parent
        if host is None:
            host = node
        baked.append(_Baked(spec, node, parent, host, host.get(spec.attribute) is not None))

    for b in baked:
        if b.parent is not None:
            try:
                b.parent.remove(b.node)
            except ValueError:
                pass
        else:
            try:
                tree.remove(b.node)
            except ValueError:
                pass
    return tree, baked


def _sample_into(baked, t):
    for b in baked:
        spec = b.spec
        dur = spec.dur if spec.dur > 0 else 1.0
        local = t - spec.begin
        active = True

        if local < 0:
            # Before `begin` the animation is not in effect.
            active = False
            local = 0.0
        else:
            cycles = local / dur
            if spec.repeat_count == float("inf"):
                local = local % dur
            elif cycles >= max(spec.repeat_count, 0.0):
                active = False
                local = dur
            else:
                # Finite repeat: wrap so cycles 2..n actually replay.
                local = local % dur

        if not active:
            if spec.fill == "freeze":
                value = _interpolate(spec, local)
                if value is not None:
                    b.host.set(spec.attribute, value)
            elif b.had_attr and spec.base_value is not None:
                # fill="remove" (the default) restores the pre-animation value.
                b.host.set(spec.attribute, spec.base_value)
            elif not b.had_attr:
                b.host.attrib.pop(spec.attribute, None)
            continue

        value = _interpolate(spec, local)
        if value is not None:
            b.host.set(spec.attribute, value)


def sample_at(root, anims, t):
    """Return a static SVG string at absolute time t (seconds)."""
    tree, baked = _prepare(root, anims)
    _sample_into(baked, t)
    return ET.tostring(tree, encoding="unicode")


def frames(svg_text, duration=None, fps=30):
    """Bake a frame sequence.

    Returns (root, [(t, svg_string), ...], duration). Frame times are i / fps so
    no two frames duplicate unless the animation genuinely holds still.
    """
    root, anims, computed = collect_animations(svg_text)
    if duration is None or duration <= 0:
        duration = computed if computed > 0 else 1.0
    fps = max(1, min(240, int(fps)))
    count = max(1, int(round(duration * fps)))

    tree, baked = _prepare(root, anims)
    out = []
    for i in range(count):
        t = i / fps
        _sample_into(baked, t)
        out.append((t, ET.tostring(tree, encoding="unicode")))
    return root, out, duration


def timeline_info(svg_text):
    """Human readable summary of the animation in an SVG document."""
    try:
        root, anims, duration = collect_animations(svg_text)
    except ET.ParseError as exc:
        return {"ok": False, "error": "Invalid SVG: %s" % exc}
    out = []
    for a in anims:
        out.append({
            "attribute": a.attribute,
            "type": a.anim_type,
            "transformType": a.transform_type,
            "values": a.values,
            "keyTimes": a.key_times,
            "begin": a.begin,
            "dur": a.dur,
            "repeat": "indefinite" if a.repeat_count == float("inf") else a.repeat_count,
        })
    animated_elements = len({id(a.target) for a in anims})
    return {
        "ok": True,
        "animations": out,
        "duration": duration,
        "elements": len(list(root.iter())),
        "animated": animated_elements,
    }
