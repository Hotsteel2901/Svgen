/**
 * Resize maths, as pure functions.
 *
 * Kept out of the tool controller on purpose: this is the part that is easy to
 * get subtly wrong (rotated shapes, anchors, degenerate sizes) and it is far
 * cheaper to prove correct in a unit test than to discover by dragging a handle
 * in a browser and watching the shape vanish.
 *
 * Transform convention, shared with the renderer and the SVG writer:
 *   world = rotate(rotation) · scale(scaleX, scaleY) · local + (x, y)
 */

import { rotatePoint } from "./transform.js";

/**
 * The local-space point that must stay pinned while `handle` is dragged: the
 * opposite corner, or the opposite edge's midpoint.
 */
export function anchorFor(handle, bounds) {
  const left = bounds.x;
  const right = bounds.x + bounds.w;
  const top = bounds.y;
  const bottom = bounds.y + bounds.h;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  switch (handle) {
    case "nw": return [right, bottom];
    case "ne": return [left, bottom];
    case "se": return [left, top];
    case "sw": return [right, top];
    case "n": return [midX, bottom];
    case "s": return [midX, top];
    case "e": return [left, midY];
    case "w": return [right, midY];
    default: return [midX, midY];
  }
}

/** A point in local space → world space, for a given transform. */
export function localToWorld(transform, lx, ly) {
  const [rx, ry] = rotatePoint(
    lx * (transform.scaleX ?? 1),
    ly * (transform.scaleY ?? 1),
    transform.rotation || 0
  );
  return [rx + transform.x, ry + transform.y];
}

/**
 * Convert a pointer position into the element's design space.
 * `origin` is the transform captured when the gesture started, because the
 * element's own position moves as the drag proceeds.
 *
 * Returns `[x, y]` — an array, not an object. Reading `.x` off it yields
 * undefined and poisons every number downstream, which is exactly how a drag
 * once turned a shape into NaN and made it vanish from the canvas.
 */
export function pointerToLocal(origin, pointer) {
  const [rx, ry] = rotatePoint(
    pointer.x - origin.x,
    pointer.y - origin.y,
    -(origin.rotation || 0)
  );
  const sx = origin.scaleX ?? 1;
  const sy = origin.scaleY ?? 1;
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return [0, 0];
  return [sx === 0 ? 0 : rx / sx, sy === 0 ? 0 : ry / sy];
}

/**
 * Build the gesture record for a resize drag.
 *
 * The tool and the unit tests both go through this, so the two can never drift
 * apart: an earlier version of the tool built its own object without an
 * `origin` field, the pure function read `origin.x`, and every drag threw — the
 * unit tests were green because they constructed the object by hand.
 *
 * @param {object} el        the element being resized
 * @param {object} resolved  its transform sampled at the current time
 * @param {string} handle    "nw" | "n" | … | "w"
 */
export function createResizeGesture(el, resolved, handle) {
  const origin = {
    x: resolved.x,
    y: resolved.y,
    rotation: resolved.rotation || 0,
    scaleX: resolved.scaleX ?? 1,
    scaleY: resolved.scaleY ?? 1,
  };
  const bounds = {
    x: -(resolved.w || 1) / 2,
    y: -((el.type === "line" || el.type === "arrow" ? 0 : resolved.h || 1) / 2),
    w: resolved.w || 1,
    h: el.type === "line" || el.type === "arrow" ? 0 : resolved.h || 1,
  };
  const anchorLocal = anchorFor(handle, bounds);
  const anchorWorld = localToWorld(origin, anchorLocal[0], anchorLocal[1]);
  return {
    kind: "resize",
    label: "resize",
    el,
    handle,
    origin,
    bounds,
    anchorLocal,
    anchorWorld,
    isLine: el.type === "line" || el.type === "arrow",
  };
}

/**
 * Compute the new size and position for a resize gesture.
 *
 * @param {object} g
 *   handle       — "nw" | "n" | … | "w"
 *   origin       — { x, y, rotation, scaleX, scaleY } captured at gesture start
 *   bounds       — local bounds captured at gesture start
 *   anchorLocal  — pinned point in local space (see `anchorFor`)
 *   anchorWorld  — that same point in world space, captured once
 *   isLine       — lines and arrows have no height
 * @param {object} pointer  — { x, y } in scene space
 * @param {object} opts     — { snap, proportional, minSize }
 * @returns {{ w: number, h: number, x: number, y: number }}
 */
export function computeResize(g, pointer, opts = {}) {
  const snap = opts.snap || ((v) => v);
  const minSize = opts.minSize ?? 1;

  const local = pointerToLocal(g.origin, pointer);
  const lx = local[0];
  const ly = local[1];
  const [ax, ay] = g.anchorLocal;

  const safe = { w: g.bounds.w, h: g.isLine ? 0 : g.bounds.h, x: g.origin.x, y: g.origin.y };
  if (![lx, ly, ax, ay].every(Number.isFinite)) return safe;

  let w = Math.abs(lx - ax);
  let h = Math.abs(ly - ay);

  const horizontal = g.handle.includes("w") || g.handle.includes("e");
  const vertical = g.handle.includes("n") || g.handle.includes("s");
  if (!horizontal) w = g.bounds.w;
  if (!vertical) h = g.bounds.h;

  if (opts.proportional && horizontal && vertical && g.bounds.w > 0 && g.bounds.h > 0) {
    const ratio = g.bounds.h / g.bounds.w;
    const scaled = Math.max(w, h / ratio);
    w = scaled;
    h = scaled * ratio;
  }

  w = snap(Math.max(minSize, w));
  h = snap(Math.max(g.isLine ? 0 : minSize, h));
  if (!Number.isFinite(w)) w = g.bounds.w;
  if (!Number.isFinite(h)) h = g.bounds.h;

  // Grow away from the pinned anchor: locate that same anchor in the NEW box
  // and place the element so it still lands on `anchorWorld`. Running
  // `anchorFor` on the new bounds — rather than mirroring the sign of the old
  // anchor — is what keeps edge handles ("n", "e", …) correct, because their
  // anchor sits on the centre of the axis that does not change.
  const height = g.isLine ? 0 : h;
  const newAnchorLocal = anchorFor(g.handle, { x: -w / 2, y: -height / 2, w, h: height });
  const [wx, wy] = localToWorld(
    { x: 0, y: 0, rotation: g.origin.rotation || 0, scaleX: g.origin.scaleX ?? 1, scaleY: g.origin.scaleY ?? 1 },
    newAnchorLocal[0],
    newAnchorLocal[1]
  );
  const x = g.anchorWorld[0] - wx;
  const y = g.anchorWorld[1] - wy;

  return {
    w,
    h: height,
    x: Number.isFinite(x) ? x : g.origin.x,
    y: Number.isFinite(y) ? y : g.origin.y,
  };
}
