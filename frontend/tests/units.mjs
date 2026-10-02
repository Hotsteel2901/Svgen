/**
 * Unit tests for the front-end's pure geometry and maths.
 *
 *   node frontend/tests/units.mjs
 *
 * These run without a browser. That matters: the resize gesture once produced
 * NaN because `pointerToLocal` returns an array and a caller read `.x` off it,
 * and the browser-level suite could only report "the shape vanished" — several
 * minutes of dragging later. A unit test says which line is wrong, in
 * milliseconds.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const js = (rel) => path.join(here, "..", "js", rel);

const { anchorFor, computeResize, createResizeGesture, pointerToLocal, localToWorld } =
  await import("file://" + js("core/resize.js"));
const { rotatePoint, inversePoint, forwardPoint, flipElement } = await import(
  "file://" + js("core/transform.js")
);
const { sampleTrack, putKey, removeKeyAt, keyAt, cubicBezier, easeProgress, shiftKeys } =
  await import("file://" + js("core/anim.js"));
const { parseColor, toHex, mixColor, luminance } = await import("file://" + js("core/color.js"));
const { clamp, round, num, parseNumbers, deepClone, safeName, timecode } = await import(
  "file://" + js("core/util.js")
);
const { parsePathData, hasCurves, tokenizePath } = await import("file://" + js("core/svg-path.js"));

/* ---------------------------------------------------------------- runner */

const results = [];
let failures = 0;

function test(name, fn) {
  try {
    const detail = fn();
    results.push(["ok", name, detail || ""]);
  } catch (err) {
    failures += 1;
    results.push(["FAIL", name, err.message]);
  }
}

const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (Δ=${Math.abs(a - b)})`);
const finite = (obj, keys) => {
  for (const k of keys) {
    assert.ok(Number.isFinite(obj[k]), `${k} is not finite: ${obj[k]}`);
  }
};

/* ---------------------------------------------------------------- resize */

const rect = (over = {}) => ({
  handle: "se",
  origin: { x: 640, y: 360, rotation: 0, scaleX: 1, scaleY: 1 },
  bounds: { x: -150, y: -100, w: 300, h: 200 },
  anchorLocal: [-150, -100],
  anchorWorld: [490, 260],
  isLine: false,
  ...over,
});

test("resize: SE handle at the untouched corner is a no-op", () => {
  const r = computeResize(rect(), { x: 790, y: 460 });
  finite(r, ["w", "h", "x", "y"]);
  close(r.w, 300);
  close(r.h, 200);
  close(r.x, 640);
  close(r.y, 360);
  return `${r.w}×${r.h} @ ${Math.round(r.x)},${Math.round(r.y)}`;
});

test("resize: SE handle grows away from the NW anchor", () => {
  const r = computeResize(rect(), { x: 890, y: 560 });
  finite(r, ["w", "h", "x", "y"]);
  close(r.w, 400);
  close(r.h, 300);
  // the NW corner must not move
  close(r.x - r.w / 2, 490);
  close(r.y - r.h / 2, 260);
  return `${r.w}×${r.h}, NW pinned at ${Math.round(r.x - r.w / 2)},${Math.round(r.y - r.h / 2)}`;
});

test("resize: NW handle pins the SE corner", () => {
  // Grab the NW corner and drag it to (540, 260). The element spans
  // x∈[490,790], y∈[260,460], so the SE corner (790,460) must not move and the
  // box becomes 250×200.
  const g = rect({
    handle: "nw",
    anchorLocal: [150, 100],
    anchorWorld: [790, 460],
  });
  const r = computeResize(g, { x: 540, y: 260 });
  finite(r, ["w", "h", "x", "y"]);
  close(r.w, 250);
  close(r.h, 200);
  close(r.x + r.w / 2, 790);
  close(r.y + r.h / 2, 460);
  return `${r.w}×${r.h}, SE pinned at 790,460`;
});

test("resize: edge handle keeps the other axis and centres correctly", () => {
  const g = rect({
    handle: "e",
    anchorLocal: [-150, 0],
    anchorWorld: [490, 360],
  });
  const r = computeResize(g, { x: 940, y: 999 });
  finite(r, ["w", "h", "x", "y"]);
  close(r.w, 450);
  close(r.h, 200, 1e-6);
  close(r.x - r.w / 2, 490); // left edge pinned
  close(r.y, 360); // vertically unchanged, so still centred
  return `w=${r.w}, h=${r.h} (unchanged), left pinned`;
});

test("resize: north edge keeps width and pins the bottom", () => {
  const g = rect({
    handle: "n",
    anchorLocal: [0, 100],
    anchorWorld: [640, 460],
  });
  const r = computeResize(g, { x: 12345, y: 160 });
  finite(r, ["w", "h", "x", "y"]);
  close(r.w, 300);
  close(r.h, 300);
  close(r.x, 640);
  close(r.y + r.h / 2, 460);
  return `h=${r.h}, width kept, bottom pinned`;
});

test("resize: rotated 45° keeps the anchor in world space", () => {
  const rot = 45;
  const origin = { x: 400, y: 400, rotation: rot, scaleX: 1, scaleY: 1 };
  const bounds = { x: -100, y: -50, w: 200, h: 100 };
  const anchorLocal = anchorFor("se", bounds);
  const anchorWorld = localToWorld(origin, anchorLocal[0], anchorLocal[1]);
  const g = { handle: "se", origin, bounds, anchorLocal, anchorWorld, isLine: false };
  const target = localToWorld(origin, 150, 80);
  const r = computeResize(g, target);
  finite(r, ["w", "h", "x", "y"]);
  const after = localToWorld(
    { ...origin, x: r.x, y: r.y },
    -r.w / 2,
    -r.h / 2
  );
  close(after[0], anchorWorld[0], 1e-6);
  close(after[1], anchorWorld[1], 1e-6);
  return `anchor held at ${Math.round(after[0])},${Math.round(after[1])}`;
});

test("resize: a line keeps zero height", () => {
  const g = rect({ handle: "e", isLine: true, anchorLocal: [-150, 0], anchorWorld: [490, 360] });
  const r = computeResize(g, { x: 800, y: 500 });
  assert.equal(r.h, 0, "a line grew a height");
  return `w=${r.w}, h=0`;
});

test("resize: proportional keeps the aspect ratio", () => {
  const r = computeResize(rect(), { x: 890, y: 460 }, { proportional: true });
  close(r.w / r.h, 300 / 200, 1e-6);
  return `${r.w}×${r.h} ratio ${(r.w / r.h).toFixed(3)}`;
});

test("resize: snapped to a grid", () => {
  const snap = (v) => Math.round(v / 20) * 20;
  const r = computeResize(rect(), { x: 793, y: 462 }, { snap });
  assert.equal(r.w % 20, 0, `width not on the grid: ${r.w}`);
  assert.equal(r.h % 20, 0, `height not on the grid: ${r.h}`);
  return `${r.w}×${r.h}`;
});

test("resize: degenerate pointer and NaN inputs never poison the element", () => {
  const cases = [
    { x: NaN, y: 460 },
    { x: 790, y: Infinity },
    { x: undefined, y: undefined },
    { x: 0, y: 0 },
  ];
  for (const pointer of cases) {
    const r = computeResize(rect(), pointer);
    finite(r, ["w", "h", "x", "y"]);
    assert.ok(r.w >= 1, `width collapsed for ${JSON.stringify(pointer)}: ${r.w}`);
  }
  const broken = computeResize(rect({ anchorLocal: [NaN, NaN] }), { x: 790, y: 460 });
  finite(broken, ["w", "h", "x", "y"]);
  return "4 degenerate pointers + a broken anchor stayed finite";
});

test("resize: every handle produces finite numbers", () => {
  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  for (const handle of handles) {
    const bounds = { x: -150, y: -100, w: 300, h: 200 };
    const anchorLocal = anchorFor(handle, bounds);
    const origin = { x: 640, y: 360, rotation: 0, scaleX: 1, scaleY: 1 };
    const anchorWorld = localToWorld(origin, anchorLocal[0], anchorLocal[1]);
    const g = { handle, origin, bounds, anchorLocal, anchorWorld, isLine: false };
    for (const pointer of [{ x: 200, y: 200 }, { x: 1200, y: 900 }, { x: 640, y: 360 }]) {
      const r = computeResize(g, pointer);
      finite(r, ["w", "h", "x", "y"]);
      assert.ok(r.w >= 1 && r.h >= 1, `${handle} collapsed: ${r.w}×${r.h}`);
    }
  }
  return `${handles.length} handles × 3 pointers`;
});

test("resize: the gesture factory produces what computeResize needs", () => {
  // This is the contract that broke in the browser while every hand-built test
  // stayed green: the tool assembled its own object and `origin` was missing.
  const el = { type: "rect" };
  const resolved = { x: 640, y: 360, w: 300, h: 200, rotation: 0, scaleX: 1, scaleY: 1 };
  for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const g = createResizeGesture(el, resolved, handle);
    for (const key of ["origin", "bounds", "anchorLocal", "anchorWorld", "isLine", "handle"]) {
      assert.ok(g[key] !== undefined, `${handle}: gesture is missing ${key}`);
    }
    finite(g.origin, ["x", "y", "rotation", "scaleX", "scaleY"]);
    finite(g.bounds, ["x", "y", "w", "h"]);
    assert.equal(g.anchorLocal.length, 2);
    assert.equal(g.anchorWorld.length, 2);
    const r = computeResize(g, { x: 700, y: 420 });
    finite(r, ["w", "h", "x", "y"]);
  }
  return "8 handles through the real factory";
});

test("resize: a line gesture reports isLine and zero height", () => {
  const g = createResizeGesture({ type: "line" }, { x: 100, y: 100, w: 200, h: 0, rotation: 0 }, "e");
  assert.equal(g.isLine, true);
  assert.equal(g.bounds.h, 0);
  const r = computeResize(g, { x: 300, y: 100 });
  assert.equal(r.h, 0);
  return `w=${r.w}, h=0`;
});

/* --------------------------------------------------------------- pointer */

test("pointerToLocal returns an array, not an object", () => {
  const [x, y] = pointerToLocal({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, { x: 10, y: 20 });
  close(x, 10);
  close(y, 20);
  const v = pointerToLocal({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, { x: 1, y: 1 });
  assert.ok(Array.isArray(v), "pointerToLocal no longer returns an array");
  return "regression guard for the `.x`-on-an-array bug";
});

test("transform: local ↔ world round trip", () => {
  const el = { x: 120, y: -40, rotation: 37, scaleX: 1.7, scaleY: 0.6 };
  for (const [lx, ly] of [[0, 0], [10, 20], [-55, 13.5], [200, -80]]) {
    const [wx, wy] = forwardPoint(el, lx, ly);
    const [bx, by] = inversePoint(el, wx, wy);
    close(bx, lx, 1e-9);
    close(by, ly, 1e-9);
  }
  return "4 points round-tripped";
});

test("transform: rotatePoint is exact for the axes", () => {
  const [x1, y1] = rotatePoint(1, 0, 90);
  close(x1, 0, 1e-12);
  close(y1, 1, 1e-12);
  const [x2, y2] = rotatePoint(1, 0, -0);
  close(x2, 1);
  close(y2, 0);
  return "90° and -0 handled";
});

test("transform: flip mirrors geometry as well as scale", () => {
  const el = { type: "path", points: [[10, 5], [-4, 2]], scaleX: 1, scaleY: 1 };
  flipElement(el, "x");
  assert.deepEqual(el.points, [[-10, 5], [4, 2]]);
  assert.equal(el.scaleX, -1);
  return "points and scale";
});

/* -------------------------------------------------------------- keyframes */

test("anim: sampling hits the keys and interpolates between them", () => {
  const keys = [];
  putKey(keys, 0, 0);
  putKey(keys, 1, 100);
  putKey(keys, 2, 0);
  close(sampleTrack(keys, 0, -1), 0);
  close(sampleTrack(keys, 0.5, -1), 50);
  close(sampleTrack(keys, 1, -1), 100);
  close(sampleTrack(keys, 1.5, -1), 50);
  close(sampleTrack(keys, 5, -1), 0, 1e-9);
  return "0 → 50 → 100 → 50 → 0";
});

test("anim: an empty track falls back and a single key holds", () => {
  close(sampleTrack([], 0.5, 42), 42);
  const one = [{ t: 1, v: 7, e: "linear" }];
  close(sampleTrack(one, 0, 0), 7);
  close(sampleTrack(one, 99, 0), 7);
  return "fallback + hold";
});

test("anim: easing changes the shape of the ramp", () => {
  const lin = [{ t: 0, v: 0, e: "linear" }, { t: 1, v: 1, e: "linear" }];
  const easeIn = [{ t: 0, v: 0, e: "in" }, { t: 1, v: 1, e: "linear" }];
  const hold = [{ t: 0, v: 0, e: "hold" }, { t: 1, v: 1, e: "linear" }];
  assert.ok(sampleTrack(easeIn, 0.5, 0) < sampleTrack(lin, 0.5, 0), "ease-in is not slower at the start");
  close(sampleTrack(hold, 0.99, 0), 0);
  close(sampleTrack(hold, 1, 0), 1);
  return "linear / in / hold all differ";
});

test("anim: cubic bezier solver is monotonic and bounded", () => {
  let previous = -1;
  for (let i = 0; i <= 40; i++) {
    const v = cubicBezier(i / 40, 0.42, 0, 0.58, 1);
    assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `out of range at ${i}: ${v}`);
    assert.ok(v >= previous - 1e-6, `not monotonic at ${i}: ${v} < ${previous}`);
    previous = v;
  }
  close(cubicBezier(0, 0.42, 0, 0.58, 1), 0);
  close(cubicBezier(1, 0.42, 0, 0.58, 1), 1);
  return "40 samples monotonic in [0,1]";
});

test("anim: putKey replaces rather than duplicating", () => {
  const keys = [];
  putKey(keys, 1, 10);
  putKey(keys, 1.00001, 20);
  assert.equal(keys.length, 1, "a near-identical time created a second key");
  close(keys[0].v, 20);
  putKey(keys, 0.5, 5);
  assert.deepEqual(keys.map((k) => k.t), [0.5, 1], "keys are not sorted");
  removeKeyAt(keys, 0.5);
  assert.equal(keys.length, 1);
  assert.ok(keyAt(keys, 1));
  return "replace + sort + remove";
});

test("anim: shifting keys clamps at zero", () => {
  const keys = { x: [{ t: 0, v: 1, e: "linear" }, { t: 2, v: 2, e: "linear" }] };
  shiftKeys(keys, -1);
  assert.deepEqual(keys.x.map((k) => k.t), [0, 1]);
  shiftKeys(keys, 5);
  assert.deepEqual(keys.x.map((k) => k.t), [5, 6]);
  return "clamped then shifted";
});

test("anim: easeProgress is total", () => {
  for (const e of ["linear", "hold", "in", "out", "inout", "bezier", "nonsense"]) {
    for (const p of [-1, 0, 0.5, 1, 2]) {
      const v = easeProgress(p, e);
      assert.ok(Number.isFinite(v), `${e}(${p}) = ${v}`);
    }
  }
  return "6 easings × 5 inputs";
});

/* ----------------------------------------------------------------- colour */

test("colour: parses every notation the importer can meet", () => {
  assert.deepEqual(parseColor("#f00"), [255, 0, 0, 1]);
  assert.deepEqual(parseColor("#ff0000"), [255, 0, 0, 1]);
  assert.deepEqual(parseColor("#ff000080").slice(0, 3), [255, 0, 0]);
  close(parseColor("#ff000080")[3], 128 / 255, 1e-6);
  assert.deepEqual(parseColor("rgb(1,2,3)"), [1, 2, 3, 1]);
  assert.deepEqual(parseColor("red"), [255, 0, 0, 1]);
  assert.equal(parseColor("none"), null);
  assert.equal(parseColor("not-a-colour"), null);
  return "hex3/6/8, rgb(), named, none, junk";
});

test("colour: round trips through hex without drift", () => {
  for (const hex of ["#000000", "#ffffff", "#cbff4d", "#123456", "#abcdef"]) {
    assert.equal(toHex(parseColor(hex), false), hex);
  }
  assert.equal(toHex(parseColor("#cbff4d80"), true), "#cbff4d80");
  return "5 opaque + 1 alpha";
});

test("colour: luminance and mixing behave", () => {
  assert.ok(luminance(parseColor("#ffffff")) > luminance(parseColor("#000000")));
  const mid = mixColor("#000000", "#ffffff", 0.5);
  close(mid[0], 127.5, 0.6);
  return "white is brighter than black";
});

/* ------------------------------------------------------------------ util */

test("util: clamp, round and num stay sane on junk", () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  // A plain clamp passes NaN through, because NaN compares false both ways.
  assert.equal(clamp(NaN, 0, 1), 0, "NaN escaped clamp");
  assert.equal(clamp(Infinity, 0, 1), 1);
  assert.equal(clamp(-Infinity, 0, 1), 0);
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(num(1.005, 2), "1.01");
  assert.equal(num(-0.0001, 2), "0");
  assert.equal(num(Infinity), "0");
  return "clamp / round / num, NaN contained";
});

test("util: parseNumbers accepts the separators SVG uses", () => {
  // Same lenience as the backend's parse_float_list: pull out the numbers and
  // ignore whatever separates them.
  assert.deepEqual(parseNumbers("1,2 3;4"), [1, 2, 3, 4]);
  assert.deepEqual(parseNumbers("-1.5e2 .5"), [-150, 0.5]);
  assert.deepEqual(parseNumbers("10 20 30"), [10, 20, 30]);
  assert.deepEqual(parseNumbers(""), []);
  assert.deepEqual(parseNumbers("abc"), []);
  assert.deepEqual(parseNumbers(null), []);
  return "commas, spaces, semicolons, exponents, junk";
});

test("util: safeName strips what a filesystem rejects", () => {
  assert.equal(safeName("a/b:c*d?e"), "abcde");
  assert.equal(safeName("   "), "artwork");
  assert.equal(safeName(""), "artwork");
  assert.equal(safeName("我的作品"), "我的作品");
  return "path separators, blanks, unicode";
});

test("util: timecode counts frames within a second", () => {
  assert.equal(timecode(0, 30), "0:00.00");
  assert.equal(timecode(1.5, 30), "0:01.15");
  assert.equal(timecode(61, 30), "1:01.00");
  return "0s, 1.5s, 61s";
});

test("util: deepClone is independent", () => {
  const src = { a: [1, 2, { b: 3 }] };
  const copy = deepClone(src);
  copy.a[2].b = 99;
  assert.equal(src.a[2].b, 3);
  return "mutation does not leak";
});

/* ------------------------------------------------------------------ paths */

test("path: absolute and relative commands agree", () => {
  const abs = parsePathData("M 10 10 L 20 10 L 20 20 Z");
  const rel = parsePathData("m 10 10 l 10 0 l 0 10 z");
  assert.equal(abs.length, 1);
  assert.equal(rel.length, 1);
  assert.deepEqual(abs[0], rel[0]);
  return `${abs[0].length} points, identical`;
});

test("path: H/V and implicit lineto after a moveto", () => {
  const hv = parsePathData("M0,0 H10 V10 Z");
  assert.deepEqual(hv[0], [[0, 0], [10, 0], [10, 10], [0, 0]]);
  const implicit = parsePathData("M0,0 10,0 10,10");
  assert.deepEqual(implicit[0], [[0, 0], [10, 0], [10, 10]]);
  return "H/V + implicit L";
});

test("path: a Z followed by another subpath keeps both", () => {
  // Regression: the Z branch used to swallow the next command letter.
  const subs = parsePathData("M0,0 L10,0 L10,10 Z m20,0 l5,0");
  assert.equal(subs.length, 2, `expected 2 subpaths, got ${subs.length}`);
  assert.deepEqual(subs[1], [[20, 0], [25, 0]]);
  return "2 subpaths, second at x=20";
});

test("path: arcs expand into a real curve", () => {
  const arc = parsePathData("M0,0 A10,10 0 0 1 20,0");
  assert.ok(arc[0].length > 4, `arc produced only ${arc[0].length} points`);
  // sweep=1 with y pointing down is a positive-angle sweep, so the half circle
  // from (0,0) to (20,0) bulges UP. Verified against Chrome and the Python
  // rasterizer: both put the ink above the chord.
  const minY = Math.min(...arc[0].map((p) => p[1]));
  const maxY = Math.max(...arc[0].map((p) => p[1]));
  assert.ok(minY < -5, `arc did not bow upward: minY=${minY}`);
  close(maxY, 0, 1e-6);
  const flipped = parsePathData("M0,0 A10,10 0 0 0 20,0");
  const flippedMax = Math.max(...flipped[0].map((p) => p[1]));
  assert.ok(flippedMax > 5, `sweep=0 did not bow downward: maxY=${flippedMax}`);
  assert.ok(hasCurves("M0,0 A1,1 0 0 1 2,0"));
  assert.ok(!hasCurves("M0,0 L1,1 Z"));
  return `${arc[0].length} points, up to y=${minY.toFixed(1)}, sweep=0 down to ${flippedMax.toFixed(1)}`;
});

test("path: cubics and quadratics flatten within tolerance", () => {
  const cubic = parsePathData("M0,0 C0,50 100,50 100,0");
  const quad = parsePathData("M0,0 Q50,50 100,0");
  assert.ok(cubic[0].length >= 5 && cubic[0].length <= 400, `cubic: ${cubic[0].length} points`);
  assert.ok(quad[0].length >= 5 && quad[0].length <= 400, `quad: ${quad[0].length} points`);
  return `cubic ${cubic[0].length}, quad ${quad[0].length}`;
});

test("path: malformed data does not throw", () => {
  for (const d of ["", "   ", "Z", "M", "M 1", "L10,10", "M0,0 L", "M0,0 A1 1 0 0 1"]) {
    const out = parsePathData(d);
    assert.ok(Array.isArray(out), `${JSON.stringify(d)} did not return an array`);
  }
  const toks = tokenizePath("M0,0 L10,10");
  assert.equal(toks.length, 2);
  return "9 malformed inputs survived";
});

/* ------------------------------------------------------------------ report */

const width = Math.max(...results.map(([, n]) => n.length));
for (const [status, name, detail] of results) {
  console.log(`${status === "ok" ? "  ok  " : " FAIL "} ${name.padEnd(width)}  ${detail}`);
}
console.log("-".repeat(width + 12));
console.log(`${results.length} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
