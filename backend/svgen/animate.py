"""SMIL animation sampler.

The front-end exports SVG that contains SMIL <animate> / <animateTransform>
elements.  For video conversion we cannot record the browser; instead we *bake*
each frame: sample every animation at time t, inject the resulting attribute
value into the target element and strip the <animate> nodes, producing a static
SVG that any rasterizer can draw.
"""

import copy
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .escape import parse_float_list, parse_color, lerp_color, format_num

_SMIL_NS = {"xlink": "http://www.w3.org/1999/xlink"}


@dataclass
class AnimSpec:
    elem: ET.Element
    target: ET.Element
    attribute: str
    anim_type: str                 # 'animate' | 'animateTransform'
    values: list = field(default_factory=list)   # strings
    key_times: list = field(default_factory=list)  # floats 0..1
    dur: float = 1.0
    begin: float = 0.0
    repeat_count: float = 1.0      # float('inf') allowed
    fill: str = "remove"
    calc_mode: str = "linear"
    transform_type: str = "translate"
    namespace: str = ""            # e.g. '{http://www.w3.org/2000/svg}'


def _local_name(tag):
    return tag.rsplit("}", 1)[-1]


def parse_duration(value) -> float:
    if not value:
        return 1.0
    value = str(value).strip()
    m = 1.0
    if value.endswith("ms"):
        value = value[:-2]; m = 0.001
    elif value.endswith("s"):
        value = value[:-1]
    try:
        return float(value) * m
    except ValueError:
        return 1.0


def _find_target(root, elem, animate_elem):
    href = animate_elem.get("href") or animate_elem.get("{http://www.w3.org/1999/xlink}href")
    if href and href.startswith("#"):
        found = root.find(".//*[@id='%s']" % href[1:])
        if found is not None:
            return found
    # default: the parent element
    parent = None
    for p in root.iter():
        if p is not None and any(c is elem for c in list(p)):
            parent = p
            break
    return parent or elem


def _default_key_times(n_values):
    if n_values <= 1:
        return [0.0]
    return [i / (n_values - 1) for i in range(n_values)]


def collect_animations(svg_text) -> tuple:
    """Return (root, anims, duration)."""
    root = ET.fromstring(svg_text)
    anims = []
    for elem in root.iter():
        tag = _local_name(elem.tag)
        if tag not in ("animate", "animateTransform", "animateMotion"):
            continue
        if tag == "animateMotion":
            continue
        target = _find_target(root, elem, elem)
        attribute = elem.get("attributeName", "")
        if not attribute:
            continue
        anim_type = "animateTransform" if tag == "animateTransform" else "animate"
        transform_type = elem.get("type", "translate")
        values = []
        if elem.get("values") is not None:
            values = [v.strip() for v in elem.get("values").split(";")]
        else:
            frm = elem.get("from")
            to = elem.get("to")
            if frm is not None and to is not None:
                values = [frm, to]
            elif to is not None:
                values = ["", to]
        key_times = parse_float_list(elem.get("keyTimes", "")) or _default_key_times(len(values))
        if key_times and key_times[0] != 0.0:
            key_times = [0.0] + key_times
        dur = parse_duration(elem.get("dur", "1s"))
        begin = parse_duration(elem.get("begin", "0s"))
        if elem.get("repeatCount") == "indefinite":
            repeat_count = float("inf")
        else:
            try:
                repeat_count = float(elem.get("repeatCount", "1"))
            except ValueError:
                repeat_count = 1.0
        anims.append(AnimSpec(
            elem=elem, target=target, attribute=attribute, anim_type=anim_type,
            values=values, key_times=key_times, dur=dur, begin=begin,
            repeat_count=repeat_count, fill=elem.get("fill", "remove"),
            calc_mode=elem.get("calcMode", "linear"), transform_type=transform_type,
            namespace=elem.tag[:elem.tag.rindex("}") + 1] if "}" in elem.tag else "",
        ))
    duration = 0.0
    for a in anims:
        if a.repeat_count == float("inf"):
            end = a.begin + a.dur
        else:
            end = a.begin + a.dur * max(a.repeat_count, 1.0)
        duration = max(duration, end)
    return root, anims, duration


def _interpolate(a: AnimSpec, local_t: float):
    """Return the interpolated *value string* for an animation at its local time."""
    if not a.values:
        return None
    n = len(a.values)
    kt = a.key_times
    while len(kt) < n:
        kt = kt + [1.0]
    kt = kt[:n]
    # clamp local_t into [0, dur] (fill=freeze handled by caller persisting last)
    t = max(0.0, min(local_t, a.dur))
    u = 1.0
    if a.dur > 0:
        u = t / a.dur
    if a.calc_mode == "discrete":
        for i in range(n):
            if u <= kt[i]:
                return a.values[max(i - 1, 0)]
        return a.values[-1]
    # find segment
    seg = n - 2
    for i in range(n - 1):
        if kt[i] <= u <= kt[i + 1]:
            seg = i
            break
    k0, k1 = kt[seg], kt[seg + 1]
    span = (k1 - k0) or 1.0
    f = (u - k0) / span
    v0, v1 = a.values[seg], a.values[seg + 1]
    if v0 == "" and v1 != "":
        return v1
    if v1 == "" and v0 != "":
        return v0
    if a.attribute in ("opacity", "fill-opacity", "stroke-opacity") or _looks_color(v0) or _looks_color(v1):
        return _lerp_color_string(v0, v1, f)
    if a.anim_type == "animateTransform":
        return _lerp_transform(v0, v1, f, a.transform_type)
    return _lerp_list_string(v0, v1, f)


def _looks_color(s):
    if not s:
        return False
    s = s.strip().lower()
    return s.startswith("#") or s.startswith("rgb") or s in (
        "black", "white", "red", "green", "blue", "yellow", "cyan", "magenta")


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
        out = []
        for a, b in zip(n0, n1):
            v = a + (b - a) * f
            out.append("%s" % format_num(v))
        return " ".join(out)
    return v1 if f >= 0.5 else v0


def _lerp_transform(v0, v1, f, ttype):
    if ttype == "translate":
        return "translate(%s)" % _lerp_list_string(v0, v1, f)
    if ttype == "scale":
        return "scale(%s)" % _lerp_list_string(v0, v1, f)
    if ttype == "rotate":
        return "rotate(%s)" % _lerp_list_string(v0, v1, f)
    return v1 if f >= 0.5 else v0


def sample_at(root, anims, t: float) -> str:
    """Return a static SVG string at absolute time t (seconds)."""
    tree = copy.deepcopy(root)
    # map original anim specs to clones
    spec_map = []
    orig_elems = [a.elem for a in anims]
    for spec, oelem in zip(anims, orig_elems):
        clone = _find_clone(tree, oelem)
        if clone is None:
            continue
        spec_map.append((spec, clone))

    for spec, clone in spec_map:
        local = t - spec.begin
        if spec.repeat_count == float("inf") and spec.dur > 0:
            local = local % spec.dur
        elif local < 0:
            continue
        elif local > spec.dur * max(spec.repeat_count, 1.0):
            if spec.fill == "freeze":
                local = spec.dur
            else:
                continue
        value = _interpolate(spec, local)
        if value is None:
            continue
        spec.target_clone = clone
        target_clone = _find_target(tree, clone, clone)
        # For nested transforms produced by our front-end, the animate element
        # carries a data-svgen-parent attribute pointing at the <g> to animate.
        pid = clone.get("{http://svgen.app}parent") or clone.get("data-svgen-parent")
        if pid:
            node = _find_by_id(tree, pid)
            if node is not None:
                node.set(spec.attribute, value)
        else:
            target_clone.set(spec.attribute, value)
        # remove the animate node
        parent = _find_parent(tree, clone)
        if parent is not None:
            try:
                parent.remove(clone)
            except ValueError:
                pass

    return ET.tostring(tree, encoding="unicode")


def _find_by_id(root, eid):
    for el in root.iter():
        if el.get("id") == eid:
            return el
    return None


def _find_clone(root, original):
    """Locate the clone of `original` inside the deep-copied tree by id path."""
    pid = original.get("id")
    if pid:
        return _find_by_id(root, pid)
    return None


def _find_parent(root, elem):
    for p in root.iter():
        for c in list(p):
            if c is elem:
                return p
    return None


def timeline_info(svg_text) -> dict:
    """Human readable summary of the animation in an SVG document."""
    try:
        root, anims, duration = collect_animations(svg_text)
    except ET.ParseError as exc:
        return {"ok": False, "error": str(exc)}
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
    return {"ok": True, "animations": out, "duration": duration}


def frames(svg_text, duration=None, fps=30) -> tuple:
    """Yield (t, svg_string) frames for the animated SVG.

    Returns (root_tree, list_of_frames, computed_duration).
    """
    root, anims, computed = collect_animations(svg_text)
    if duration is None:
        duration = computed
    if duration <= 0:
        duration = 1.0
    count = max(2, int(round(duration * fps)))
    result = []
    for i in range(count):
        t = duration * i / (count - 1)
        result.append((t, sample_at(root, anims, t)))
    return root, result, duration
