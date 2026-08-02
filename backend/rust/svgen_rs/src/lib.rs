//! svgen_rs — native rasterization core for SVGen Studio.
//!
//! The heavy per-pixel work (scanline polygon filling, gradient sampling,
//! alpha blending, supersample downsampling) lives here in Rust. The Python
//! backend parses the SVG, computes geometry and paints specs, and streams a
//! compact binary command list through a C ABI.
//!
//! No external crates; pure `std` so it builds anywhere cargo exists.

#![allow(clippy::too_many_arguments)]

use std::ffi::c_void;
use std::panic;
use std::slice;

const MAGIC: u32 = 0x5356_4752; // "SVGR"
const VERSION: u32 = 1;
const OP_FILL_POLY: u8 = 1;
const OP_FILL_RECT: u8 = 2;

// ---------------------------------------------------------------------------
// Canvas / blending
// ---------------------------------------------------------------------------

struct Canvas {
    w: usize,
    h: usize,
    buf: Vec<u8>, // RGBA
}

impl Canvas {
    fn new(w: usize, h: usize) -> Canvas {
        Canvas { w, h, buf: vec![0u8; w * h * 4] }
    }

    #[inline]
    fn blend(&mut self, idx: usize, r: u8, g: u8, b: u8, a: u8) {
        if a >= 255 {
            self.buf[idx] = r;
            self.buf[idx + 1] = g;
            self.buf[idx + 2] = b;
            self.buf[idx + 3] = 255;
            return;
        }
        if a == 0 {
            return;
        }
        let da = a as f32 / 255.0;
        let sa = 1.0 - da;
        self.buf[idx] = (r as f32 * da + self.buf[idx] as f32 * sa) as u8;
        self.buf[idx + 1] = (g as f32 * da + self.buf[idx + 1] as f32 * sa) as u8;
        self.buf[idx + 2] = (b as f32 * da + self.buf[idx + 2] as f32 * sa) as u8;
        let na = (self.buf[idx + 3] as u32 + a as u32).min(255) as u8;
        self.buf[idx + 3] = na;
    }

    #[inline]
    fn paint_span(&mut self, y: i32, x0: f32, x1: f32, paint: &Paint) {
        if y < 0 || y >= self.h as i32 {
            return;
        }
        let x0i = (x0.floor().max(0.0)) as usize;
        let x1i = (x1.ceil().min(self.w as f32)) as usize;
        if x0i >= x1i {
            return;
        }
        let base = (y as usize) * self.w * 4;
        for x in x0i..x1i {
            if let Some((r, g, b, a)) = paint.sample(x as f32 + 0.5, y as f32 + 0.5) {
                self.blend(base + x * 4, r, g, b, a);
            }
        }
    }

    fn paint_rect(&mut self, x: f32, y: f32, w: f32, h: f32, paint: &Paint) {
        let y0 = (y.floor().max(0.0)) as i32;
        let y1 = ((y + h).ceil().min(self.h as f32)) as i32;
        for yy in y0..y1 {
            self.paint_span(yy, x, x + w, paint);
        }
    }
}

// ---------------------------------------------------------------------------
// Paints (flat color / linear / radial gradient)
// ---------------------------------------------------------------------------

enum Paint {
    Flat(u8, u8, u8, u8),
    Linear {
        spread: u8,
        ax: f32,
        ay: f32,
        dx: f32,
        dy: f32,
        len2: f32,
        stops: Vec<(f32, u8, u8, u8, u8)>,
    },
    Radial {
        spread: u8,
        ax: f32,
        ay: f32,
        r: f32,
        stops: Vec<(f32, u8, u8, u8, u8)>,
    },
}

impl Paint {
    #[inline]
    fn sample(&self, px: f32, py: f32) -> Option<(u8, u8, u8, u8)> {
        match self {
            Paint::Flat(r, g, b, a) => Some((*r, *g, *b, *a)),
            Paint::Linear { spread, ax, ay, dx, dy, len2, stops } => {
                let u = if *len2 == 0.0 {
                    0.0
                } else {
                    ((px - ax) * dx + (py - ay) * dy) / len2
                };
                sample_stops(stops, u, *spread)
            }
            Paint::Radial { spread, ax, ay, r, stops } => {
                let rr = if *r == 0.0 { 1.0 } else { *r };
                let u = (((px - ax) * (px - ax) + (py - ay) * (py - ay)).sqrt()) / rr;
                sample_stops(stops, u, *spread)
            }
        }
    }
}

#[inline]
fn sample_stops(
    stops: &[(f32, u8, u8, u8, u8)],
    u: f32,
    spread: u8,
) -> Option<(u8, u8, u8, u8)> {
    if stops.is_empty() {
        return Some((0, 0, 0, 0));
    }
    if stops.len() == 1 {
        let s = stops[0];
        return Some((s.1, s.2, s.3, s.4));
    }
    let first = stops[0];
    let last = stops[stops.len() - 1];
    let uu = match spread {
        1 => u.abs(),                                  // reflect
        2 => {
            let span = last.0 - first.0;
            let span = if span == 0.0 { 1.0 } else { span };
            (u - first.0).rem_euclid(span) + first.0 // repeat
        }
        _ => u,                                        // pad
    };
    if uu <= first.0 {
        return Some((first.1, first.2, first.3, first.4));
    }
    if uu >= last.0 {
        return Some((last.1, last.2, last.3, last.4));
    }
    for i in 0..stops.len() - 1 {
        let a = stops[i];
        let b = stops[i + 1];
        if a.0 <= uu && uu <= b.0 {
            let span = b.0 - a.0;
            let t = if span == 0.0 { 0.0 } else { (uu - a.0) / span };
            let lrp = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t) as u8;
            return Some((lrp(a.1, b.1), lrp(a.2, b.2), lrp(a.3, b.3), lrp(a.4, b.4)));
        }
    }
    Some((first.1, first.2, first.3, first.4))
}

// ---------------------------------------------------------------------------
// Polygon filling (scanline, active edge table, even-odd / nonzero)
// ---------------------------------------------------------------------------

struct Edge {
    ymin: f32,
    ymax: f32,
    x: f32,
    dxdy: f32,
    w: f32,
}

fn fill_poly(canvas: &mut Canvas, pts: &[f32], rule: u8, paint: &Paint) {
    let n = pts.len() / 2;
    if n < 3 {
        return;
    }
    let mut edges: Vec<Edge> = Vec::with_capacity(n);
    let mut y0 = f32::INFINITY;
    let mut y1 = f32::NEG_INFINITY;
    for i in 0..n {
        let x0 = pts[i * 2];
        let y0p = pts[i * 2 + 1];
        let j = (i + 1) % n;
        let x1 = pts[j * 2];
        let y1p = pts[j * 2 + 1];
        if y1p == y0p {
            continue;
        }
        y0 = y0.min(y0p.min(y1p));
        y1 = y1.max(y0p.max(y1p));
        if y0p < y1p {
            edges.push(Edge { ymin: y0p, ymax: y1p, x: x0, dxdy: (x1 - x0) / (y1p - y0p), w: 1.0 });
        } else {
            edges.push(Edge { ymin: y1p, ymax: y0p, x: x1, dxdy: (x0 - x1) / (y0p - y1p), w: -1.0 });
        }
    }
    if edges.is_empty() {
        return;
    }
    edges.sort_by(|a, b| a.ymin.partial_cmp(&b.ymin).unwrap().then(a.x.partial_cmp(&b.x).unwrap()));

    let sy0 = (y0.floor().max(0.0)) as i32;
    let sy1 = (y1.ceil().min(canvas.h as f32 - 1.0)) as i32;
    if sy0 > sy1 {
        return;
    }

    // active edge table entries: (x, ymax, dxdy, w)
    let mut aet: Vec<(f32, f32, f32, f32)> = Vec::new();
    let mut ei = 0usize;
    for y in sy0..=sy1 {
        let yy = y as f32 + 0.5;
        while ei < edges.len() && edges[ei].ymin <= yy {
            aet.push((edges[ei].x, edges[ei].ymax, edges[ei].dxdy, edges[ei].w));
            ei += 1;
        }
        aet.retain(|e| e.1 > yy);
        for e in aet.iter_mut() {
            e.0 += e.2;
        }
        aet.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

        if rule == 0 {
            // even-odd
            let mut inside = false;
            let mut start = 0.0f32;
            for e in &aet {
                if !inside {
                    start = e.0;
                }
                inside = !inside;
                if !inside {
                    canvas.paint_span(y, start, e.0, paint);
                }
            }
        } else {
            // non-zero winding
            let mut winding = 0.0f32;
            let mut start: Option<f32> = None;
            for e in &aet {
                let prev = winding;
                winding += e.3;
                if prev == 0.0 && winding != 0.0 {
                    start = Some(e.0);
                } else if prev != 0.0 && winding == 0.0 {
                    if let Some(s) = start {
                        canvas.paint_span(y, s, e.0, paint);
                    }
                    start = None;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Downsampling (box filter) + background composite
// ---------------------------------------------------------------------------

fn downsample(buf: &[u8], pw: usize, ph: usize, s: usize) -> Vec<u8> {
    let w = pw / s;
    let h = ph / s;
    let mut out = vec![0u8; w * h * 4];
    let cnt = (s * s) as u32;
    for oy in 0..h {
        for ox in 0..w {
            let mut r = 0u32;
            let mut g = 0u32;
            let mut b = 0u32;
            let mut a = 0u32;
            for sy in 0..s {
                for sx in 0..s {
                    let idx = ((oy * s + sy) * pw + (ox * s + sx)) * 4;
                    r += buf[idx] as u32;
                    g += buf[idx + 1] as u32;
                    b += buf[idx + 2] as u32;
                    a += buf[idx + 3] as u32;
                }
            }
            let idx = (oy * w + ox) * 4;
            out[idx] = (r / cnt) as u8;
            out[idx + 1] = (g / cnt) as u8;
            out[idx + 2] = (b / cnt) as u8;
            out[idx + 3] = (a / cnt) as u8;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Binary command-list parser
// ---------------------------------------------------------------------------

struct Reader<'a> {
    d: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn new(d: &'a [u8]) -> Reader<'a> {
        Reader { d, p: 0 }
    }
    fn u8(&mut self) -> Result<u8, &'static str> {
        if self.p >= self.d.len() {
            return Err("eof:u8");
        }
        let v = self.d[self.p];
        self.p += 1;
        Ok(v)
    }
    fn u16(&mut self) -> Result<u16, &'static str> {
        if self.p + 2 > self.d.len() {
            return Err("eof:u16");
        }
        let v = u16::from_le_bytes([self.d[self.p], self.d[self.p + 1]]);
        self.p += 2;
        Ok(v)
    }
    fn u32(&mut self) -> Result<u32, &'static str> {
        if self.p + 4 > self.d.len() {
            return Err("eof:u32");
        }
        let v = u32::from_le_bytes([self.d[self.p], self.d[self.p + 1], self.d[self.p + 2], self.d[self.p + 3]]);
        self.p += 4;
        Ok(v)
    }
    fn f32(&mut self) -> Result<f32, &'static str> {
        Ok(f32::from_bits(self.u32()?))
    }
    fn rgba(&mut self) -> Result<(u8, u8, u8, u8), &'static str> {
        Ok((self.u8()?, self.u8()?, self.u8()?, self.u8()?))
    }
}

fn read_stops(r: &mut Reader) -> Result<Vec<(f32, u8, u8, u8, u8)>, &'static str> {
    let n = r.u16()? as usize;
    let mut stops = Vec::with_capacity(n);
    for _ in 0..n {
        let off = r.f32()?;
        let (a, b, c, d) = r.rgba()?;
        stops.push((off, a, b, c, d));
    }
    Ok(stops)
}

fn read_paint(r: &mut Reader) -> Result<Paint, &'static str> {
    match r.u8()? {
        0 => {
            let (a, b, c, d) = r.rgba()?;
            Ok(Paint::Flat(a, b, c, d))
        }
        1 => {
            let spread = r.u8()?;
            let ax = r.f32()?;
            let ay = r.f32()?;
            let dx = r.f32()?;
            let dy = r.f32()?;
            let len2 = r.f32()?;
            let stops = read_stops(r)?;
            Ok(Paint::Linear { spread, ax, ay, dx, dy, len2, stops })
        }
        2 => {
            let spread = r.u8()?;
            let ax = r.f32()?;
            let ay = r.f32()?;
            let rr = r.f32()?;
            let stops = read_stops(r)?;
            Ok(Paint::Radial { spread, ax, ay, r: rr, stops })
        }
        _ => Err("bad paint mode"),
    }
}

fn run_ops(canvas: &mut Canvas, data: &[u8]) -> Result<(), &'static str> {
    let mut r = Reader::new(data);
    if r.u32()? != MAGIC {
        return Err("bad magic");
    }
    if r.u32()? != VERSION {
        return Err("bad version");
    }
    let _w = r.u32()?;
    let _h = r.u32()?;
    let _ss = r.u32()?;
    let _bg = r.rgba()?;
    let n_ops = r.u32()? as usize;
    for _ in 0..n_ops {
        match r.u8()? {
            OP_FILL_POLY => {
                let rule = r.u8()?;
                let n = r.u32()? as usize;
                let mut pts = Vec::with_capacity(n * 2);
                for _ in 0..n * 2 {
                    pts.push(r.f32()?);
                }
                let paint = read_paint(&mut r)?;
                fill_poly(canvas, &pts, rule, &paint);
            }
            OP_FILL_RECT => {
                let x = r.f32()?;
                let y = r.f32()?;
                let w = r.f32()?;
                let h = r.f32()?;
                let paint = read_paint(&mut r)?;
                canvas.paint_rect(x, y, w, h, &paint);
            }
            _ => return Err("bad op kind"),
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// C ABI
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn svgen_version() -> u32 {
    VERSION
}

/// Render a command-list buffer to RGBA pixels.
///
/// Returns 0 on success. On success `out_handle` owns a leaked Box<Vec<u8>>
/// that must be released with `svgen_free`; `out_data` points at its contents.
#[no_mangle]
pub extern "C" fn svgen_render(
    ops_ptr: *const u8,
    ops_len: usize,
    width: u32,
    height: u32,
    supersample: u32,
    bg_ptr: *const u8,
    bg_len: usize,
    out_handle: *mut *mut c_void,
    out_data: *mut *mut u8,
    out_len: *mut usize,
    out_w: *mut u32,
    out_h: *mut u32,
) -> i32 {
    let result = panic::catch_unwind(|| -> Result<Vec<u8>, &'static str> {
        let ss = supersample.max(1) as usize;
        let pw = (width as usize).saturating_mul(ss);
        let ph = (height as usize).saturating_mul(ss);
        if pw == 0 || ph == 0 || pw.checked_mul(ph).is_none() {
            return Err("bad size");
        }
        let ops = if ops_ptr.is_null() { &[] } else { unsafe { slice::from_raw_parts(ops_ptr, ops_len) } };
        let mut canvas = Canvas::new(pw, ph);
        run_ops(&mut canvas, ops)?;

        let mut out = downsample(&canvas.buf, pw, ph, ss);

        // background composite (same semantics as the Python rasterizer)
        if !bg_ptr.is_null() && bg_len >= 4 {
            let bg = unsafe { slice::from_raw_parts(bg_ptr, 4) };
            let ba = bg[3];
            if ba > 0 {
                let da = ba as f32 / 255.0;
                let sa = 1.0 - da;
                let (br, bgc, bb) = (bg[0] as f32, bg[1] as f32, bg[2] as f32);
                for px in out.chunks_exact_mut(4) {
                    px[0] = (br * da + px[0] as f32 * sa) as u8;
                    px[1] = (bgc * da + px[1] as f32 * sa) as u8;
                    px[2] = (bb * da + px[2] as f32 * sa) as u8;
                    px[3] = px[3].max(ba);
                }
            }
        }
        Ok(out)
    });

    unsafe {
        match result {
            Ok(Ok(data)) => {
                let len = data.len();
                let boxed = Box::new(data);
                *out_data = boxed.as_ptr() as *mut u8;
                *out_len = len;
                *out_w = width;
                *out_h = height;
                *out_handle = Box::into_raw(boxed) as *mut c_void;
                0
            }
            _ => {
                *out_handle = std::ptr::null_mut();
                *out_data = std::ptr::null_mut();
                *out_len = 0;
                *out_w = 0;
                *out_h = 0;
                1
            }
        }
    }
}

/// Free a buffer previously returned by `svgen_render`.
#[no_mangle]
pub extern "C" fn svgen_free(handle: *mut c_void) {
    if !handle.is_null() {
        unsafe {
            drop(Box::from_raw(handle as *mut Vec<u8>));
        }
    }
}
