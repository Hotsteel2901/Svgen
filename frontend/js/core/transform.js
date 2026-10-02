/**
 * Small 2-D transform helpers shared by the tools and the importer.
 *
 * An element's world transform is `rotate(rotation) · scale(sx, sy) · local +
 * (x, y)`. Everything here assumes that same order.
 */

export function rotatePoint(x, y, deg) {
  if (!deg) return [x, y];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/** Scene point → the element's design space (translation removed, rotation
 *  undone, scale divided out). */
export function inversePoint(el, px, py) {
  const [rx, ry] = rotatePoint(px - el.x, py - el.y, -(el.rotation || 0));
  const sx = el.scaleX ?? 1;
  const sy = el.scaleY ?? 1;
  return [sx === 0 ? 0 : rx / sx, sy === 0 ? 0 : ry / sy];
}

/** Design point → scene space. */
export function forwardPoint(el, lx, ly) {
  const [rx, ry] = rotatePoint(lx * (el.scaleX ?? 1), ly * (el.scaleY ?? 1), el.rotation || 0);
  return [rx + el.x, ry + el.y];
}

/** Build a DOMMatrix-compatible array [a,b,c,d,e,f]. */
export function toMatrix(el) {
  const r = ((el.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const sx = el.scaleX ?? 1;
  const sy = el.scaleY ?? 1;
  return [c * sx, s * sx, -s * sy, c * sy, el.x, el.y];
}

export function multiplyMatrices(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function invertMatrix(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, 0, 0];
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function applyMatrixToPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Flip an element horizontally / vertically about its own centre. */
export function flipElement(el, axis) {
  if (axis === "x") {
    el.scaleX = -(el.scaleX ?? 1);
    if (el.type === "path") {
      for (const p of el.points) p[0] = -p[0];
    }
  } else {
    el.scaleY = -(el.scaleY ?? 1);
    if (el.type === "path") {
      for (const p of el.points) p[1] = -p[1];
    }
  }
  el._rev = (el._rev | 0) + 1;
}
