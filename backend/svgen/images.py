"""Image encoders: PNG, BMP, GIF (pure stdlib) plus JPEG/WebP via Pillow when
available. These are used both for still exports and for video frame assembly.
"""

import math
import struct
import zlib

# --------------------------------------------------------------------------
# PNG
# --------------------------------------------------------------------------


def write_png(width, height, rgba) -> bytes:
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        crc = zlib.crc32(typ + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


# --------------------------------------------------------------------------
# BMP
# --------------------------------------------------------------------------


def write_bmp(width, height, rgba) -> bytes:
    row_size = (width * 3 + 3) & ~3
    data_size = row_size * height
    header_size = 14 + 40
    file_size = header_size + data_size
    out = bytearray()
    out += struct.pack("<2sIHHI", b"BM", file_size, 0, 0, header_size)
    out += struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0, data_size,
                       2835, 2835, 0, 0)
    for y in range(height - 1, -1, -1):
        row = bytearray()
        for x in range(width):
            idx = (y * width + x) * 4
            row += bytes((rgba[idx + 2], rgba[idx + 1], rgba[idx]))
        out += row
        out += b"\x00" * (row_size - width * 3)
    return bytes(out)


# --------------------------------------------------------------------------
# GIF (palette quantization, animated support)
# --------------------------------------------------------------------------


def _octree_quantize(rgba):
    """Extract a 256-color palette via an octree of leaf colors."""
    class Node:
        __slots__ = ("children", "count", "r", "g", "b", "leaf")

        def __init__(self):
            self.children = {}
            self.count = 0
            self.r = self.g = self.b = 0
            self.leaf = False

    root = Node()

    def add(node, depth, r, g, b, a):
        if a < 128:
            r = g = b = 0
        node.count += 1
        node.r += r; node.g += g; node.b += b
        if depth == 8:
            node.leaf = True
            return
        idx = ((r >> (7 - depth)) & 1) << 2 | ((g >> (7 - depth)) & 1) << 1 | ((b >> (7 - depth)) & 1)
        if idx not in node.children:
            node.children[idx] = Node()
        add(node.children[idx], depth + 1, r, g, b, a)

    for i in range(0, len(rgba), 4):
        add(root, 0, rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])

    # collect leaves
    leaves = []

    def walk(node, force=False):
        if node.leaf or (not node.children):
            leaves.append(node)
            return
        if force:
            node.r = max(1, node.r // max(1, node.count))
            node.g = max(1, node.g // max(1, node.count))
            node.b = max(1, node.b // max(1, node.count))
            node.leaf = True
            leaves.append(node)
            return
        for c in node.children.values():
            walk(c)

    walk(root)
    # reduce to <=256 leaves by merging deepest groups
    while len(leaves) > 256:
        # pick the leaf with fewest samples and merge it into its sibling
        leaves.sort(key=lambda n: n.count)
        victim = leaves.pop(0)
        victim.r = max(1, victim.r // max(1, victim.count))
        victim.g = max(1, victim.g // max(1, victim.count))
        victim.b = max(1, victim.b // max(1, victim.count))
        victim.leaf = True
        victim.children = {}
        leaves.append(victim)
    palette = []
    for l in leaves:
        palette.append((max(0, min(255, l.r // max(1, l.count))),
                        max(0, min(255, l.g // max(1, l.count))),
                        max(0, min(255, l.b // max(1, l.count)))))
    return palette


def _nearest(palette, r, g, b):
    best = 0
    bd = 1 << 30
    for i, (pr, pg, pb) in enumerate(palette):
        d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
        if d < bd:
            bd = d
            best = i
    return best


def _gif_encode(frame_index, width, height, rgba, palette, transparency_idx=None):
    """Encode one frame as GIF-LZW (no interlace)."""
    # index image
    pixels = bytearray()
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 4
            if rgba[i + 3] < 128:
                pixels.append(transparency_idx if transparency_idx is not None else 0)
            else:
                pixels.append(_nearest(palette, rgba[i], rgba[i + 1], rgba[i + 2]))

    # LZW compression
    out = bytearray()
    code_size = 8
    clear = 1 << code_size
    eoi = clear + 1
    def write_code(codes, cur, bit_count):
        for c in codes:
            cur = (cur << bit_count) | c
            out.append(0)
        return cur

    bit_buf = 0
    bit_count = 0
    out_bytes = bytearray()
    def emit(code, size):
        nonlocal bit_buf, bit_count
        bit_buf |= code << bit_count
        bit_count += size
        while bit_count >= 8:
            out_bytes.append(bit_buf & 0xFF)
            bit_buf >>= 8
            bit_count -= 8

    dict_size = clear + 2
    table = {}
    for i in range(clear):
        table[(i,)] = i
    nbits = code_size + 1
    emit(clear, nbits)
    prefix = (pixels[0],)
    for px in pixels[1:]:
        nxt = prefix + (px,)
        if nxt in table:
            prefix = nxt
        else:
            emit(table[prefix], nbits)
            table[nxt] = dict_size
            dict_size += 1
            if dict_size > (1 << nbits) and nbits < 12:
                nbits += 1
            prefix = (px,)
    emit(table[prefix], nbits)
    emit(eoi, nbits)
    if bit_count > 0:
        out_bytes.append(bit_buf & 0xFF)

    # sub-blocks
    blocks = bytearray()
    for i in range(0, len(out_bytes), 255):
        chunk = out_bytes[i:i + 255]
        blocks.append(len(chunk))
        blocks.extend(chunk)
    blocks.append(0)

    header = b""
    # image descriptor
    header += b"\x2c" + struct.pack("<HHHH", 0, 0, width, height)
    header += bytes([0x00])  # no local color table
    header += bytes([nbits - 1])  # LZW min code size
    return bytes(header) + bytes(blocks)


def write_gif(frames, width, height, delay_cs=5, loop=True, disposal=2):
    """frames: list of (rgba bytes).

    Prefers the native Rust GIF encoder (median-cut + LZW); falls back to the
    pure-Python encoder when the native engine is unavailable.
    """
    if not frames:
        raise ValueError("no frames")
    try:
        from . import rslib
        if rslib.available():
            return rslib.encode_gif(list(frames), width, height, delay_cs, loop)
    except Exception:
        pass
    return _py_write_gif(frames, width, height, delay_cs, loop, disposal)


def _py_write_gif(frames, width, height, delay_cs=5, loop=True, disposal=2):
    # build unified palette from all frames
    allpx = bytearray()
    for f in frames:
        allpx.extend(f)
    palette = _octree_quantize(allpx)
    if len(palette) < 256:
        palette += [(0, 0, 0)] * (256 - len(palette))
    trans_idx = 0
    # ensure transparency entry
    out = bytearray()
    out += b"GIF89a"
    out += struct.pack("<HH", width, height)
    out += bytes([0xF7])  # GCT present, 8-bit
    out += bytes([0])     # bg color
    out += bytes([0])
    for r, g, b in palette:
        out += bytes((r, g, b))
    out += bytes([0x21, 0xFF, 0x0B]) + b"NETSCAPE2.0" + bytes([0x03, 0x01])
    out += struct.pack("<H", 0 if loop else 1)
    out += bytes([0x00])
    for i, frame in enumerate(frames):
        out += bytes([0x21, 0xF9, 0x04, disposal << 2, 0x00, 0x00, delay_cs & 0xFF, (delay_cs >> 8) & 0xFF, 0x00])
        out += _gif_encode(i, width, height, frame, palette, trans_idx)
    out += b"\x3b"
    return bytes(out)


# --------------------------------------------------------------------------
# JPEG / WebP / conversions via Pillow (optional)
# --------------------------------------------------------------------------


def _pil():
    from PIL import Image  # noqa
    return Image


def convert_pixels_to(rgba, width, height, fmt, quality=92):
    """Convert an RGBA bytearray to JPEG/WebP/PNG/BMP via Pillow."""
    import io
    img = _pil().frombytes("RGBA", (width, height), bytes(rgba))
    fmt = fmt.lower()
    out = io.BytesIO()
    if fmt in ("jpg", "jpeg"):
        rgb = img.convert("RGB")
        rgb.save(out, format="JPEG", quality=quality)
        return out.getvalue()
    if fmt == "webp":
        img.save(out, format="WEBP", quality=quality)
        return out.getvalue()
    if fmt == "png":
        img.save(out, format="PNG", compress_level=9)
        return out.getvalue()
    if fmt == "bmp":
        img.save(out, format="BMP")
        return out.getvalue()
    raise ValueError("Unsupported format %s" % fmt)


def save_pixels_to_file(rgba, width, height, fmt, path, quality=92):
    data = convert_pixels_to(rgba, width, height, fmt, quality)
    with open(path, "wb") as fh:
        fh.write(data)
    return path
