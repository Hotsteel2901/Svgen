//! Animated GIF encoder (median-cut quantization + LZW).
//!
//! The Python LZW+quantization was the last remaining Python-only hot path
//! (minutes for an animation); this native port encodes the same frames in
//! milliseconds.

use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Median-cut color quantization
// ---------------------------------------------------------------------------

fn quantize_palette(pixels: &[u8]) -> Vec<[u8; 3]> {
    // count unique colors
    let mut counts: HashMap<u32, u32> = HashMap::with_capacity(1 << 12);
    for px in pixels.chunks_exact(4) {
        if px[3] < 128 {
            continue; // transparent — not part of the palette
        }
        let key = ((px[0] as u32) << 16) | ((px[1] as u32) << 8) | (px[2] as u32);
        *counts.entry(key).or_insert(0) += 1;
    }
    if counts.is_empty() {
        return vec![[0, 0, 0]; 256];
    }
    let colors: Vec<(u32, (u8, u8, u8))> = counts
        .into_iter()
        .map(|(k, c)| (c, (((k >> 16) & 0xFF) as u8, ((k >> 8) & 0xFF) as u8, (k & 0xFF) as u8)))
        .collect();

    let mut buckets: Vec<Vec<(u32, (u8, u8, u8))>> = vec![colors];
    while buckets.len() < 256 {
        // pick the bucket with the most pixels
        let idx = (0..buckets.len())
            .max_by_key(|&i| buckets[i].iter().map(|c| c.0).sum::<u32>())
            .unwrap();
        let b = &mut buckets[idx];
        if b.len() < 2 {
            break;
        }
        // channel with largest range
        let (mut rmin, mut rmax) = (255u8, 0u8);
        let (mut gmin, mut gmax) = (255u8, 0u8);
        let (mut bmin, mut bmax) = (255u8, 0u8);
        for (_, (r, g, b)) in b.iter() {
            rmin = rmin.min(*r); rmax = rmax.max(*r);
            gmin = gmin.min(*g); gmax = gmax.max(*g);
            bmin = bmin.min(*b); bmax = bmax.max(*b);
        }
        let chan = if (rmax - rmin) >= (gmax - gmin) && (rmax - rmin) >= (bmax - bmin) { 0 }
        else if (gmax - gmin) >= (bmax - bmin) { 1 } else { 2 };
        b.sort_by_key(|(_, c)| match chan { 0 => c.0, 1 => c.1, _ => c.2 });
        let mid = b.len() / 2;
        let right = b.split_off(mid);
        buckets.push(right);
    }
    // average each bucket into a palette entry
    let mut palette: Vec<[u8; 3]> = Vec::with_capacity(256);
    for b in &buckets {
        let (mut r, mut g, mut bl) = (0u32, 0u32, 0u32);
        for (cnt, (cr, cg, cb)) in b.iter() {
            r += *cr as u32 * cnt;
            g += *cg as u32 * cnt;
            bl += *cb as u32 * cnt;
        }
        let total: u32 = b.iter().map(|c| c.0).sum::<u32>().max(1);
        palette.push([(r / total) as u8, (g / total) as u8, (bl / total) as u8]);
    }
    while palette.len() < 256 {
        palette.push([0, 0, 0]);
    }
    palette
}

fn nearest_index(palette: &[[u8; 3]], r: u8, g: u8, b: u8, cache: &mut HashMap<u16, u8>) -> u8 {
    let key = ((r >> 3) as u16) << 10 | ((g >> 3) as u16) << 5 | ((b >> 3) as u16);
    if let Some(&i) = cache.get(&key) {
        return i;
    }
    let mut best = 0u8;
    let mut bd = u32::MAX;
    for (i, p) in palette.iter().enumerate() {
        let dr = p[0] as i32 - r as i32;
        let dg = p[1] as i32 - g as i32;
        let db = p[2] as i32 - b as i32;
        let d = (dr * dr + dg * dg + db * db) as u32;
        if d < bd {
            bd = d;
            best = i as u8;
        }
    }
    cache.insert(key, best);
    best
}

// ---------------------------------------------------------------------------
// LZW (GIF flavor, LSb-first codes)
// ---------------------------------------------------------------------------

struct BitWriter {
    out: Vec<u8>,
    bitbuf: u32,
    bits: u8,
}

impl BitWriter {
    fn new() -> Self {
        BitWriter { out: Vec::new(), bitbuf: 0, bits: 0 }
    }
    fn write(&mut self, code: u16, size: u8) {
        self.bitbuf |= (code as u32) << self.bits;
        self.bits += size;
        while self.bits >= 8 {
            self.out.push((self.bitbuf & 0xFF) as u8);
            self.bitbuf >>= 8;
            self.bits -= 8;
        }
    }
    fn flush(&mut self) {
        if self.bits > 0 {
            self.out.push((self.bitbuf & 0xFF) as u8);
            self.bitbuf = 0;
            self.bits = 0;
        }
    }
}

fn lzw_compress(pixels: &[u8]) -> Vec<u8> {
    let min_size: u8 = 8;
    let clear: u16 = 1 << min_size; // 256
    let eoi: u16 = clear + 1; // 257
    let mut next: u16 = eoi + 1; // 258
    let mut nbits: u8 = min_size + 1; // 9
    let mut dict: HashMap<(u16, u8), u16> = HashMap::with_capacity(4096);
    let mut bw = BitWriter::new();
    bw.write(clear, nbits);
    let mut prefix: u16 = pixels[0] as u16;
    for &px in &pixels[1..] {
        let key = (prefix, px);
        if let Some(&code) = dict.get(&key) {
            prefix = code;
        } else {
            bw.write(prefix, nbits);
            dict.insert(key, next);
            next += 1;
            if next > (1u16 << nbits) && nbits < 12 {
                nbits += 1;
            }
            if next >= 4096 {
                bw.write(clear, nbits);
                dict.clear();
                next = eoi + 1;
                nbits = min_size + 1;
            }
            prefix = px as u16;
        }
    }
    bw.write(prefix, nbits);
    bw.write(eoi, nbits);
    bw.flush();
    bw.out
}

fn sub_blocks(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + data.len() / 255 + 1);
    let mut i = 0;
    while i < data.len() {
        let n = (data.len() - i).min(255);
        out.push(n as u8);
        out.extend_from_slice(&data[i..i + n]);
        i += n;
    }
    out.push(0);
    out
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

pub fn encode_gif(
    frames: &[&[u8]],
    width: usize,
    height: usize,
    delay_cs: u16,
    loop_forever: bool,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(width * height * frames.len() / 2 + 1024);

    // global palette from all frames
    let all: Vec<u8> = frames.iter().flat_map(|f| f.iter().copied()).collect();
    let palette = quantize_palette(&all);

    out.extend_from_slice(b"GIF89a");
    out.extend_from_slice(&(width as u16).to_le_bytes());
    out.extend_from_slice(&(height as u16).to_le_bytes());
    out.push(0xF7); // global color table present, 8-bit
    out.push(0x00); // background
    out.push(0x00); // aspect
    for p in &palette {
        out.extend_from_slice(p);
    }
    // NETSCAPE looping extension
    out.extend_from_slice(&[0x21, 0xFF, 0x0B]);
    out.extend_from_slice(b"NETSCAPE2.0");
    out.extend_from_slice(&[0x03, 0x01]);
    out.extend_from_slice(&(if loop_forever { 0u16 } else { 1u16 }).to_le_bytes());
    out.push(0x00);

    let mut cache: HashMap<u16, u8> = HashMap::with_capacity(4096);
    for frame in frames {
        // graphic control extension: disposal 2, no transparency
        out.extend_from_slice(&[0x21, 0xF9, 0x04, 2 << 2, 0x00, 0x00]);
        out.extend_from_slice(&delay_cs.to_le_bytes());
        out.push(0x00);

        // image descriptor
        out.extend_from_slice(&[0x2C, 0x00, 0x00, 0x00, 0x00]);
        out.extend_from_slice(&(width as u16).to_le_bytes());
        out.extend_from_slice(&(height as u16).to_le_bytes());
        out.push(0x00); // no local color table

        let mut pixels = Vec::with_capacity(width * height);
        for px in frame.chunks_exact(4) {
            if px[3] < 128 {
                pixels.push(0);
            } else {
                pixels.push(nearest_index(&palette, px[0], px[1], px[2], &mut cache));
            }
        }
        out.push(8); // LZW min code size
        let comp = lzw_compress(&pixels);
        out.extend_from_slice(&sub_blocks(&comp));
    }
    out.push(0x3B);
    out
}
