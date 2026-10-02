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
    """RGBA -> PNG with the Sub (type 1) row filter on every row.

    Filter 0 shipped every pixel verbatim, so flat areas cost their full size.
    Sub turns those into runs of zero bytes; the bytes stay standard PNG, so
    Pillow and every browser decode them unchanged.
    """
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        crc = zlib.crc32(typ + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        row = rgba[y * stride:(y + 1) * stride]
        raw.append(1)  # filter type 1 (Sub): byte minus the byte 4 back
        raw += row[:4]
        raw += bytes([(b - row[i - 4]) & 0xFF for i, b in enumerate(row[4:], 4)])
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


# --------------------------------------------------------------------------
# BMP
# --------------------------------------------------------------------------


def write_bmp(width, height, rgba) -> bytes:
    """RGBA -> 24-bit BMP, compositing transparency onto white.

    BMP has no alpha channel here, so a transparent pixel used to contribute
    whatever sat in its RGB bytes (usually black, sometimes garbage).  Alpha
    is now mixed against white, which is what a transparent export should
    look like on a light page.
    """
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
            a = rgba[idx + 3]
            if a >= 255:
                r, g, b = rgba[idx], rgba[idx + 1], rgba[idx + 2]
            else:
                ia = 255 - a
                r = (rgba[idx] * a + 255 * ia) // 255
                g = (rgba[idx + 1] * a + 255 * ia) // 255
                b = (rgba[idx + 2] * a + 255 * ia) // 255
            row += bytes((b, g, r))
        out += row
        out += b"\x00" * (row_size - width * 3)
    return bytes(out)


# --------------------------------------------------------------------------
# GIF (palette quantization, animated support)
# --------------------------------------------------------------------------


_GIF_MAX_COLORS = 256
_HIST_BITS = 5


def _color_histogram(rgba):
    """Bucket RGBA bytes into a 5-bit-per-channel histogram.

    Every bucket holds [pixels, r sum, g sum, b sum] so buckets can be merged
    later without losing precision.  Transparent pixels (alpha < 128) share
    one bucket under key -1: their RGB is arbitrary, so it is folded to black
    and those frames render through the reserved transparent index instead.
    """
    hist = {}
    for i in range(0, len(rgba) - 3, 4):
        if rgba[i + 3] < 128:
            key = -1
            r = g = b = 0
        else:
            r = rgba[i]
            g = rgba[i + 1]
            b = rgba[i + 2]
            key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
        slot = hist.get(key)
        if slot is None:
            hist[key] = [1, r, g, b]
        else:
            slot[0] += 1
            slot[1] += r
            slot[2] += g
            slot[3] += b
    return hist


def _merge_histogram(hist, bits):
    """Fold a 5-bit histogram down to *bits* per channel.

    Coarser buckets are octree parents of the finer ones and the sums carry
    over, so a merged entry is still the exact average of its pixels.  Input
    is always a _color_histogram() result — a 4-bit key has a different layout
    and would unpack into the wrong channels.
    """
    shift = _HIST_BITS - bits
    merged = {}
    for key, slot in hist.items():
        if key < 0:
            mkey = -1
        else:
            r5 = (key >> 10) & 31
            g5 = (key >> 5) & 31
            b5 = key & 31
            mkey = ((r5 >> shift) << (2 * bits)) | ((g5 >> shift) << bits) | (b5 >> shift)
        slot2 = merged.get(mkey)
        if slot2 is None:
            merged[mkey] = list(slot)
        else:
            slot2[0] += slot[0]
            slot2[1] += slot[1]
            slot2[2] += slot[2]
            slot2[3] += slot[3]
    return merged


def _split_box(box):
    """Split one box of histogram entries in two along its widest channel.

    The cut sits at the population-weighted median, except when that would
    leave one side empty-ish — then it falls back to the middle entry, which
    keeps the recursive splitting balanced and therefore bounded.
    """
    chan = 0
    span = -1
    for c in range(3):
        lo = min(e[c + 1] for e in box)
        hi = max(e[c + 1] for e in box)
        if hi - lo > span:
            span = hi - lo
            chan = c
    if span <= 0:
        mid = len(box) // 2
    else:
        box.sort(key=lambda e: e[chan + 1])
        half = sum(e[0] for e in box) // 2
        mid = 1
        acc = box[0][0]
        while mid < len(box) - 1 and acc <= half:
            acc += box[mid][0]
            mid += 1
        if mid <= 1 or mid >= len(box) - 1:
            mid = len(box) // 2
    return box[:mid], box[mid:]


def _median_cut(entries, limit):
    """Reduce (count, r, g, b) entries to at most *limit* weighted averages."""
    boxes = [(sum(e[0] for e in entries), entries)]
    while len(boxes) < limit:
        pick = -1
        best = -1
        for i, (pop, box) in enumerate(boxes):
            if len(box) > 1 and pop > best:
                best = pop
                pick = i
        if pick < 0:
            break
        left, right = _split_box(boxes[pick][1])
        boxes[pick] = (sum(e[0] for e in left), left)
        boxes.append((sum(e[0] for e in right), right))
    out = []
    for _pop, box in boxes:
        n = 0
        r = g = b = 0
        for cnt, er, eg, eb in box:
            n += cnt
            r += er * cnt
            g += eg * cnt
            b += eb * cnt
        out.append((n, r // n, g // n, b // n))
    return out


def _octree_quantize(rgba):
    """Extract a palette of at most 256 colours from RGBA bytes.

    The 5-bit histogram is folded down the octree until few enough buckets
    survive, then finished with a population-weighted median cut.  Work is
    bounded (one pass plus a handful of merges), so a 640x360 frame lands in
    well under a second, and a frame whose pixels are all transparent still
    yields a usable palette instead of dividing by zero.
    """
    hist = _color_histogram(rgba)
    if not hist:
        return []
    base = hist
    bits = _HIST_BITS
    while len(hist) > 4 * _GIF_MAX_COLORS and bits > 0:
        bits -= 1
        hist = _merge_histogram(base, bits)
    entries = []
    for slot in hist.values():
        n = slot[0]
        entries.append((n, slot[1] // n, slot[2] // n, slot[3] // n))
    if len(entries) > _GIF_MAX_COLORS:
        entries = _median_cut(entries, _GIF_MAX_COLORS)
    entries.sort()
    return [(r, g, b) for (_n, r, g, b) in entries]


def _nearest(palette, r, g, b, first=0):
    """Index of the palette entry closest to (r, g, b), from *first* on."""
    best = first
    bd = 1 << 30
    for i in range(first, len(palette)):
        pr, pg, pb = palette[i]
        d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
        if d < bd:
            bd = d
            best = i
    return best


def _gif_encode(width, height, rgba, palette, transparency_idx=None):
    """Encode one frame as GIF-LZW (no interlace)."""
    # index image
    first = 0 if transparency_idx is None else transparency_idx + 1
    pixels = bytearray()
    seen = {}
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 4
            if rgba[i + 3] < 128:
                pixels.append(transparency_idx if transparency_idx is not None else 0)
                continue
            key = (rgba[i], rgba[i + 1], rgba[i + 2])
            idx = seen.get(key)
            if idx is None:
                idx = _nearest(palette, key[0], key[1], key[2], first)
                if len(seen) < (1 << 16):  # bounded memo: exact, but not huge
                    seen[key] = idx
            pixels.append(idx)

    # LZW compression (LSB-first codes)
    code_size = 8  # colour-index width; the minimum code size is always this
    clear = 1 << code_size
    eoi = clear + 1

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

    def fresh_table():
        return {(i,): i for i in range(clear)}

    table = fresh_table()
    dict_size = clear + 2
    nbits = code_size + 1
    emit(clear, nbits)
    if pixels:
        prefix = (pixels[0],)
        for px in pixels[1:]:
            nxt = prefix + (px,)
            if nxt in table:
                prefix = nxt
                continue
            emit(table[prefix], nbits)
            if dict_size >= 4096:
                # Dictionary full: hand the decoder a CLEAR and start over.
                # Without this the table kept handing out codes >= 4096 that
                # do not fit in the 12-bit field and the stream went corrupt.
                emit(clear, nbits)
                table = fresh_table()
                dict_size = clear + 2
                nbits = code_size + 1
            else:
                table[nxt] = dict_size
                dict_size += 1
                # One code later than the decoder's own counter: the decoder
                # cannot add an entry for the first code after a CLEAR, so it
                # lags by one and widens at the same emission we do.
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

    # image descriptor
    header = b""
    header += b"\x2c" + struct.pack("<HHHH", 0, 0, width, height)
    header += bytes([0x00])  # no local color table
    header += bytes([code_size])  # LZW minimum code size (constant)
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
    colors = _octree_quantize(allpx)
    if len(colors) > 255:
        colors = colors[:255]
    # Index 0 is reserved for transparency, so no opaque pixel can ever be
    # assigned it: the colour entries live at 1..255 and nearest() starts there.
    trans_idx = 0
    palette = [(0, 0, 0)] + list(colors)
    palette += [(0, 0, 0)] * (256 - len(palette))
    out = bytearray()
    out += b"GIF89a"
    out += struct.pack("<HH", width, height)
    out += bytes([0xF7])  # GCT present, 8-bit -> 256 entries below
    out += bytes([trans_idx])  # background colour index
    out += bytes([0])          # pixel aspect ratio
    for r, g, b in palette:
        out += bytes((r, g, b))
    out += bytes([0x21, 0xFF, 0x0B]) + b"NETSCAPE2.0" + bytes([0x03, 0x01])
    out += struct.pack("<H", 0 if loop else 1)
    out += bytes([0x00])
    # Graphic control extension: 8 bytes, exactly 4 data bytes —
    # packed, delay low/high, transparent colour index, block terminator.
    gce = bytes([0x21, 0xF9, 0x04,
                 ((disposal & 0x07) << 2) | 0x01,  # disposal + transparent flag
                 delay_cs & 0xFF, (delay_cs >> 8) & 0xFF,
                 trans_idx,
                 0x00])
    for frame in frames:
        out += gce
        out += _gif_encode(width, height, frame, palette, trans_idx)
    out += b"\x3b"
    return bytes(out)


# --------------------------------------------------------------------------
# JPEG / WebP / conversions via Pillow (optional)
# --------------------------------------------------------------------------


def _pil():
    from PIL import Image  # noqa
    return Image


def _flatten_on_white(img):
    """Composite an RGBA image onto white.

    Formats without an alpha channel (JPEG, 24-bit BMP) must not inherit the
    RGB of transparent pixels — those bytes are arbitrary and used to come out
    black.  Mixing against white gives the transparent export users expect.
    """
    pil = _pil()
    bg = pil.new("RGBA", img.size, (255, 255, 255, 255))
    bg.alpha_composite(img)
    return bg.convert("RGB")


def convert_pixels_to(rgba, width, height, fmt, quality=92):
    """Convert an RGBA bytearray to JPEG/WebP/PNG/BMP via Pillow."""
    import io
    img = _pil().frombytes("RGBA", (width, height), bytes(rgba))
    fmt = fmt.lower()
    out = io.BytesIO()
    if fmt in ("jpg", "jpeg"):
        _flatten_on_white(img).save(out, format="JPEG", quality=quality)
        return out.getvalue()
    if fmt == "webp":
        img.save(out, format="WEBP", quality=quality)
        return out.getvalue()
    if fmt == "png":
        img.save(out, format="PNG", compress_level=9)
        return out.getvalue()
    if fmt == "bmp":
        _flatten_on_white(img).save(out, format="BMP")
        return out.getvalue()
    raise ValueError("Unsupported format %s" % fmt)


def save_pixels_to_file(rgba, width, height, fmt, path, quality=92):
    data = convert_pixels_to(rgba, width, height, fmt, quality)
    with open(path, "wb") as fh:
        fh.write(data)
    return path
