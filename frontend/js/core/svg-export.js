/**
 * Scene → SVG.
 *
 * This is the contract with the backend's SMIL baker, so the shape matters:
 *
 *   <g id="G1" transform="translate(x,y)">        one group per transform
 *     <animateTransform id="A1" data-svgen-parent="G1" type="translate" … />
 *     <g id="G2" transform="rotate(r)"> …
 *
 * The baker REPLACES the named group's `transform` with the sampled value, and
 * `data-svgen-parent` makes that lookup explicit instead of relying on nesting.
 *
 * Interpolation is sampled here, densely and uniformly, using the real easing
 * curves from the timeline. Every renderer (Chrome, Firefox, Rust, pure Python)
 * then sees the identical motion, because none of them has to understand
 * keySplines — they only ever linearly interpolate between our samples.
 */

import { sampleTrack, isAnimated } from "./anim.js";
import { familyCss, measureText, pathData } from "./elements.js";
import { escapeXML, num, clamp } from "./util.js";
import { toHex } from "./color.js";

/** How many samples per animated component. Matches the video frame count
 *  when exporting video so baked frames land exactly on our samples. */
export function sampleCount(duration, fps, requested) {
  if (requested) return clamp(Math.round(requested), 2, 600);
  return clamp(Math.round((duration || 3) * (fps || 30)) + 1, 12, 600);
}

function sampleTimes(duration, n) {
  const out = new Array(n);
  const span = Math.max(1e-6, duration);
  for (let i = 0; i < n; i++) out[i] = (span * i) / (n - 1);
  return out;
}

function keyTimesAttr(n) {
  const parts = new Array(n);
  for (let i = 0; i < n; i++) parts[i] = num(i / (n - 1), 4);
  return parts.join(";");
}

/* ---------------------------------------------------------------- painters */

function paintAttrs(el) {
  const attrs = [];
  const sw = el.strokeWidth;
  attrs.push(`fill="${el.fill ? escapeXML(el.fill) : "none"}"`);
  if (el.stroke) {
    attrs.push(`stroke="${escapeXML(el.stroke)}"`);
    attrs.push(`stroke-width="${num(sw)}"`);
    if (el.strokeCap && el.strokeCap !== "butt") attrs.push(`stroke-linecap="${el.strokeCap}"`);
    if (el.strokeJoin && el.strokeJoin !== "miter") attrs.push(`stroke-linejoin="${el.strokeJoin}"`);
    if (el.dash > 0) {
      const d = num(sw * el.dash);
      attrs.push(`stroke-dasharray="${d} ${d}"`);
    }
  } else {
    attrs.push('stroke="none"');
  }
  return attrs.join(" ");
}

function escapedText(text) {
  return escapeXML(text).replace(/\n/g, "&#10;");
}

function shapeMarkup(el) {
  const attrs = paintAttrs(el);
  switch (el.type) {
    case "rect":
    case "ellipse":
    case "polygon":
    case "star":
    case "line":
    case "arrow":
    case "path":
      return `<path d="${pathData(el)}" ${attrs} />`;
    case "text": {
      const lines = String(el.text ?? "").split("\n");
      const m = measureText(el.text, el.fontSize, el.fontWeight, familyCss(el.fontFamily));
      const lh = el.fontSize * 1.2;
      const y0 = -m.height / 2 + lh / 2;
      const anchor = el.align === "left" ? "start" : el.align === "right" ? "end" : "middle";
      const x = el.align === "left" ? -m.width / 2 : el.align === "right" ? m.width / 2 : 0;
      const fam = familyCss(el.fontFamily).replace(/"/g, "'");
      const body = lines
        .map((line, i) => {
          const dy = i === 0 ? 0 : lh;
          return `<tspan x="${num(x)}" dy="${num(dy)}">${escapedText(line)}</tspan>`;
        })
        .join("");
      return (
        `<text x="${num(x)}" y="${num(y0)}" ${attrs} ` +
        `font-family="${escapeXML(fam)}" font-size="${num(el.fontSize)}" ` +
        `font-weight="${el.fontWeight}" text-anchor="${anchor}" ` +
        `dominant-baseline="middle">${body}</text>`
      );
    }
    default:
      return "";
  }
}

/* ---------------------------------------------------------------- element */

let idSeq = 0;

export function elementToSVG(el, ctx) {
  const { duration, samples } = ctx;
  if (!el.visible) return "";
  idSeq += 1;
  const tag = `e${idSeq}`;

  const keys = el.keys || {};
  const animated = isAnimated(keys);
  const times = animated ? sampleTimes(duration, samples) : null;

  const posAnimated = animated && ((keys.x && keys.x.length) || (keys.y && keys.y.length));
  const rotAnimated = animated && keys.rotation && keys.rotation.length;
  const scaleAnimated = animated && ((keys.scaleX && keys.scaleX.length) || (keys.scaleY && keys.scaleY.length));
  const opAnimated = animated && keys.opacity && keys.opacity.length;

  const x0 = posAnimated ? sampleTrack(keys.x, 0, el.x) : el.x;
  const y0 = posAnimated ? sampleTrack(keys.y, 0, el.y) : el.y;
  const r0 = rotAnimated ? sampleTrack(keys.rotation, 0, el.rotation) : el.rotation;
  const sx0 = scaleAnimated ? sampleTrack(keys.scaleX, 0, el.scaleX) : el.scaleX;
  const sy0 = scaleAnimated ? sampleTrack(keys.scaleY, 0, el.scaleY) : el.scaleY;
  const o0 = opAnimated ? sampleTrack(keys.opacity, 0, el.opacity) : el.opacity;

  const parts = [];
  const closes = [];

  const openGroup = (transform, opacity) => {
    const bits = [];
    if (transform) bits.push(`transform="${transform}"`);
    if (opacity != null) bits.push(`opacity="${num(opacity)}"`);
    parts.push(`<g ${bits.join(" ")}>`);
    closes.push("</g>");
  };

  const animTransform = (id, parent, type, values) => {
    parts.push(
      `<animateTransform id="${id}" data-svgen-parent="${parent}" ` +
      `attributeName="transform" type="${type}" ` +
      `values="${values}" keyTimes="${keyTimesAttr(samples)}" ` +
      `dur="${num(duration)}s" begin="0s" repeatCount="1" fill="freeze" calcMode="linear" />`
    );
  };

  const animAttr = (id, parent, name, values) => {
    parts.push(
      `<animate id="${id}" data-svgen-parent="${parent}" attributeName="${name}" ` +
      `values="${values}" keyTimes="${keyTimesAttr(samples)}" ` +
      `dur="${num(duration)}s" begin="0s" repeatCount="1" fill="freeze" calcMode="linear" />`
    );
  };

  // --- position ---------------------------------------------------------
  {
    const gid = `${tag}p`;
    openGroup(`translate(${num(x0)},${num(y0)})`);
    if (posAnimated) {
      const vals = times.map((t) => `${num(sampleTrack(keys.x, t, el.x))},${num(sampleTrack(keys.y, t, el.y))}`);
      animTransform(`${tag}pa`, gid, "translate", vals.join(";"));
    }
  }

  // --- rotation ---------------------------------------------------------
  {
    const gid = `${tag}r`;
    openGroup(`rotate(${num(r0)})`);
    if (rotAnimated) {
      const vals = times.map((t) => num(sampleTrack(keys.rotation, t, el.rotation)));
      animTransform(`${tag}ra`, gid, "rotate", vals.join(";"));
    }
  }

  // --- scale ------------------------------------------------------------
  {
    const gid = `${tag}s`;
    openGroup(`scale(${num(sx0)},${num(sy0)})`);
    if (scaleAnimated) {
      const vals = times.map(
        (t) => `${num(sampleTrack(keys.scaleX, t, el.scaleX))},${num(sampleTrack(keys.scaleY, t, el.scaleY))}`
      );
      animTransform(`${tag}sa`, gid, "scale", vals.join(";"));
    }
  }

  // --- opacity ----------------------------------------------------------
  {
    const gid = `${tag}o`;
    openGroup(null, o0);
    if (opAnimated) {
      const vals = times.map((t) => num(clamp(sampleTrack(keys.opacity, t, el.opacity), 0, 1)));
      animAttr(`${tag}oa`, gid, "opacity", vals.join(";"));
    }
  }

  parts.push(shapeMarkup(el));
  parts.push(...closes.reverse());

  return parts.join("");
}

/* ---------------------------------------------------------------- document */

export function sceneToSVG(scene, opts = {}) {
  idSeq = 0;
  const doc = scene.doc || scene;
  const canvas = doc.canvas;
  const width = Math.round(opts.width || canvas.width);
  const height = Math.round(opts.height || canvas.height);
  const duration = Math.max(0.01, opts.duration ?? canvas.duration);
  const background = opts.background !== undefined ? opts.background : canvas.background;
  const samples = sampleCount(duration, opts.fps || canvas.fps, opts.samples);

  const body = doc.elements
    .map((el) => elementToSVG(el, { duration, samples }))
    .filter(Boolean)
    .join("\n  ");

  const bgRect = background
    ? `\n  <rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXML(background)}" />`
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" version="1.1">` +
    bgRect +
    (body ? `\n  ${body}\n` : "\n") +
    `</svg>`
  );
}

/** Static frame: the same document sampled at one instant, no SMIL at all. */
export function sceneToStaticSVG(scene, time, opts = {}) {
  const doc = scene.doc || scene;
  const canvas = doc.canvas;
  const width = Math.round(opts.width || canvas.width);
  const height = Math.round(opts.height || canvas.height);
  const background = opts.background !== undefined ? opts.background : canvas.background;

  const body = doc.elements
    .map((el) => {
      if (!el.visible) return "";
      const r = resolveElement(el, time);
      return staticElementSVG(r);
    })
    .filter(Boolean)
    .join("\n  ");

  const bgRect = background
    ? `\n  <rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXML(background)}" />`
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" version="1.1">${bgRect}` +
    (body ? `\n  ${body}\n` : "\n") +
    `</svg>`
  );
}

function resolveElement(el, t) {
  const out = { ...el };
  for (const prop of ["x", "y", "rotation", "scaleX", "scaleY", "opacity", "strokeWidth"]) {
    const track = el.keys && el.keys[prop];
    if (track && track.length) out[prop] = sampleTrack(track, t, el[prop]);
  }
  return out;
}

function staticElementSVG(el) {
  const t = `translate(${num(el.x)},${num(el.y)}) rotate(${num(el.rotation)}) scale(${num(el.scaleX)},${num(el.scaleY)})`;
  return `<g transform="${t}" opacity="${num(el.opacity)}">${shapeMarkup(el)}</g>`;
}
