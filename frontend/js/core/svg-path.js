/**
 * SVG path data → polyline subpaths.
 *
 * Full command coverage (M L H V C S Q T A Z, absolute and relative) with
 * arcs expanded through the endpoint→centre parameterisation from the SVG
 * spec's implementation notes. Curves are flattened adaptively so the result is
 * accurate at any zoom without producing millions of points.
 */

const NUMBER_RE = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
const COMMAND_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;

/** Split path data into [command, numberArgs] pairs. */
export function tokenizePath(d) {
  const out = [];
  if (!d) return out;
  COMMAND_RE.lastIndex = 0;
  let match;
  while ((match = COMMAND_RE.exec(d))) {
    NUMBER_RE.lastIndex = 0;
    const args = (match[2].match(NUMBER_RE) || []).map(Number);
    out.push([match[1], args]);
  }
  return out;
}

/**
 * Parse path data into subpaths of [x, y] points.
 * @returns {Array<Array<[number, number]>>}
 */
export function parsePathData(d, options = {}) {
  const tolerance = options.tolerance || 0.35;
  const tokens = tokenizePath(d);
  const subpaths = [];
  let current = null;

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCx = null;
  let lastCy = null;
  let lastQx = null;
  let lastQy = null;
  let prevCommand = "";

  const push = (px, py) => {
    if (!current) {
      current = [];
      subpaths.push(current);
    }
    const last = current[current.length - 1];
    if (last && Math.abs(last[0] - px) < 1e-9 && Math.abs(last[1] - py) < 1e-9) return;
    current.push([px, py]);
  };

  const closePath = () => {
    if (current && current.length) {
      const first = current[0];
      const last = current[current.length - 1];
      if (Math.abs(last[0] - first[0]) > 1e-9 || Math.abs(last[1] - first[1]) > 1e-9) {
        current.push([first[0], first[1]]);
      }
    }
    x = startX;
    y = startY;
  };

  for (const [rawCmd, args] of tokens) {
    const relative = rawCmd === rawCmd.toLowerCase() && rawCmd !== "Z" && rawCmd !== "z";
    let cmd = rawCmd.toUpperCase();

    if (cmd === "Z") {
      closePath();
      current = null;
      lastCx = lastCy = lastQx = lastQy = null;
      prevCommand = "Z";
      continue;
    }

    // Implicit repetition: `M` followed by extra pairs behaves as `L`.
    let i = 0;
    let first = true;
    do {
      if (cmd === "M") {
        const nx = relative ? x + args[i] : args[i];
        const ny = relative ? y + args[i + 1] : args[i + 1];
        if (first) {
          x = nx;
          y = ny;
          startX = nx;
          startY = ny;
          current = null;
          push(x, y);
        } else {
          x = nx;
          y = ny;
          push(x, y);
        }
        i += 2;
        if (first && i < args.length) cmd = "L";
        else if (first) break;
        first = false;
        continue;
      }
      first = false;

      switch (cmd) {
        case "L": {
          const nx = relative ? x + args[i] : args[i];
          const ny = relative ? y + args[i + 1] : args[i + 1];
          x = nx;
          y = ny;
          push(x, y);
          i += 2;
          break;
        }
        case "H": {
          x = relative ? x + args[i] : args[i];
          push(x, y);
          i += 1;
          break;
        }
        case "V": {
          y = relative ? y + args[i] : args[i];
          push(x, y);
          i += 1;
          break;
        }
        case "C": {
          const x1 = relative ? x + args[i] : args[i];
          const y1 = relative ? y + args[i + 1] : args[i + 1];
          const x2 = relative ? x + args[i + 2] : args[i + 2];
          const y2 = relative ? y + args[i + 3] : args[i + 3];
          const nx = relative ? x + args[i + 4] : args[i + 4];
          const ny = relative ? y + args[i + 5] : args[i + 5];
          flattenCubic(push, x, y, x1, y1, x2, y2, nx, ny, tolerance);
          lastCx = x2;
          lastCy = y2;
          x = nx;
          y = ny;
          i += 6;
          break;
        }
        case "S": {
          const hasPrev = prevCommand === "C" || prevCommand === "S";
          const x1 = hasPrev && lastCx !== null ? 2 * x - lastCx : x;
          const y1 = hasPrev && lastCy !== null ? 2 * y - lastCy : y;
          const x2 = relative ? x + args[i] : args[i];
          const y2 = relative ? y + args[i + 1] : args[i + 1];
          const nx = relative ? x + args[i + 2] : args[i + 2];
          const ny = relative ? y + args[i + 3] : args[i + 3];
          flattenCubic(push, x, y, x1, y1, x2, y2, nx, ny, tolerance);
          lastCx = x2;
          lastCy = y2;
          x = nx;
          y = ny;
          i += 4;
          break;
        }
        case "Q": {
          const qx = relative ? x + args[i] : args[i];
          const qy = relative ? y + args[i + 1] : args[i + 1];
          const nx = relative ? x + args[i + 2] : args[i + 2];
          const ny = relative ? y + args[i + 3] : args[i + 3];
          flattenQuadratic(push, x, y, qx, qy, nx, ny, tolerance);
          lastQx = qx;
          lastQy = qy;
          x = nx;
          y = ny;
          i += 4;
          break;
        }
        case "T": {
          const hasPrev = prevCommand === "Q" || prevCommand === "T";
          const qx = hasPrev && lastQx !== null ? 2 * x - lastQx : x;
          const qy = hasPrev && lastQy !== null ? 2 * y - lastQy : y;
          const nx = relative ? x + args[i] : args[i];
          const ny = relative ? y + args[i + 1] : args[i + 1];
          flattenQuadratic(push, x, y, qx, qy, nx, ny, tolerance);
          lastQx = qx;
          lastQy = qy;
          x = nx;
          y = ny;
          i += 2;
          break;
        }
        case "A": {
          const rx = Math.abs(args[i]);
          const ry = Math.abs(args[i + 1]);
          const rot = args[i + 2];
          const large = args[i + 3];
          const sweep = args[i + 4];
          const nx = relative ? x + args[i + 5] : args[i + 5];
          const ny = relative ? y + args[i + 6] : args[i + 6];
          flattenArc(push, x, y, rx, ry, rot, large, sweep, nx, ny, tolerance);
          x = nx;
          y = ny;
          i += 7;
          break;
        }
        default:
          return subpaths.filter((sp) => sp.length > 1);
      }

      lastCx = cmd === "C" || cmd === "S" ? lastCx : null;
      lastCy = cmd === "C" || cmd === "S" ? lastCy : null;
      prevCommand = cmd;
    } while (i < args.length);
  }

  return subpaths.filter((sp) => sp.length > 1);
}

/* ---------------------------------------------------------------- flattening */

/** Adaptive subdivision: recurse until the curve is flat enough. */
function flattenCubic(push, x0, y0, x1, y1, x2, y2, x3, y3, tol) {
  const depth = 0;
  subdivideCubic(push, x0, y0, x1, y1, x2, y2, x3, y3, tol, depth);
  push(x3, y3);
}

function subdivideCubic(push, x0, y0, x1, y1, x2, y2, x3, y3, tol, depth) {
  const d1 = flatness(x0, y0, x1, y1, x2, y2, x3, y3);
  if (d1 <= tol || depth >= 16) {
    push(x3, y3);
    return;
  }
  const x01 = (x0 + x1) / 2;
  const y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2;
  const y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2;
  const y23 = (y2 + y3) / 2;
  const x012 = (x01 + x12) / 2;
  const y012 = (y01 + y12) / 2;
  const x123 = (x12 + x23) / 2;
  const y123 = (y12 + y23) / 2;
  const mx = (x012 + x123) / 2;
  const my = (y012 + y123) / 2;
  subdivideCubic(push, x0, y0, x01, y01, x012, y012, mx, my, tol, depth + 1);
  subdivideCubic(push, mx, my, x123, y123, x23, y23, x3, y3, tol, depth + 1);
}

function flatness(x0, y0, x1, y1, x2, y2, x3, y3) {
  const ux = 3 * x1 - 2 * x0 - x3;
  const uy = 3 * y1 - 2 * y0 - y3;
  const vx = 3 * x2 - 2 * x3 - x0;
  const vy = 3 * y2 - 2 * y3 - y0;
  return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
}

function flattenQuadratic(push, x0, y0, cx, cy, x1, y1, tol) {
  // Elevate to a cubic and reuse the same machinery.
  const c1x = x0 + (2 / 3) * (cx - x0);
  const c1y = y0 + (2 / 3) * (cy - y0);
  const c2x = x1 + (2 / 3) * (cx - x1);
  const c2y = y1 + (2 / 3) * (cy - y1);
  flattenCubic(push, x0, y0, c1x, c1y, c2x, c2y, x1, y1, tol);
}

/**
 * Elliptical arc → polyline, following the SVG spec's conversion from
 * endpoint parameterisation to centre parameterisation (F.6.5).
 */
export function flattenArc(push, x0, y0, rx, ry, rotationDeg, largeArc, sweep, x1, y1, tol = 0.35) {
  if (rx === 0 || ry === 0) {
    push(x1, y1);
    return;
  }
  if (Math.abs(x0 - x1) < 1e-12 && Math.abs(y0 - y1) < 1e-12) return;

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  let rxs = rx * rx;
  let rys = ry * ry;
  const lambda = (x1p * x1p) / rxs + (y1p * y1p) / rys;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
    rxs = rx * rx;
    rys = ry * ry;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rxs * rys - rxs * y1p * y1p - rys * x1p * x1p;
  const denominator = rxs * y1p * y1p + rys * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, numerator / (denominator || 1e-12)));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;

  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1e-12))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  else if (sweep && delta < 0) delta += Math.PI * 2;

  // Step count from the arc length so the tolerance is respected.
  const radius = Math.max(rx, ry);
  const steps = Math.max(2, Math.min(720, Math.ceil((Math.abs(delta) * radius) / Math.max(0.5, tol * 6))));
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (delta * i) / steps;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    push(
      cx + rx * cosT * cosPhi - ry * sinT * sinPhi,
      cy + rx * cosT * sinPhi + ry * sinT * cosPhi
    );
  }
}

/** True when the path data contains any curve or arc command. */
export function hasCurves(d) {
  return /[CcSsQqTtAa]/.test(String(d || ""));
}
