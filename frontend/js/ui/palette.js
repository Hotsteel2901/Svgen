/**
 * One colour language for the whole studio.
 *
 * A property has the same colour everywhere it appears — the inspector row, the
 * timeline track, the keyframe diamond — so you can look at a diamond and know
 * which field made it. Layers carry their own artwork colour, and the tool rail
 * groups are tinted by what they do. Nothing here is decoration: every hue is a
 * label you can learn once and then read at a glance.
 *
 * Values are CSS custom properties defined in tokens.css, so the light and dark
 * themes each get their own tuned set for free.
 */

export const PROP_COLOR = {
  x: "var(--c-x)",
  y: "var(--c-y)",
  rotation: "var(--c-rot)",
  scaleX: "var(--c-scale)",
  scaleY: "var(--c-scale)",
  opacity: "var(--c-opacity)",
  strokeWidth: "var(--c-ease)",
};

/** Fallback for a property that has no assigned hue yet. */
export const PROP_COLOR_FALLBACK = "var(--text-faint)";

export function propColor(prop) {
  return PROP_COLOR[prop] || PROP_COLOR_FALLBACK;
}

/**
 * The hue for a property, or null when it has none. A coloured dot means "this
 * can be keyframed and shows up on the timeline" — showing a grey diamond next
 * to a field that never appears there would be a lie.
 */
export function propColorOrNull(prop) {
  return Object.prototype.hasOwnProperty.call(PROP_COLOR, prop) ? PROP_COLOR[prop] : null;
}

/**
 * Rail groups. Selection utilities stay neutral on purpose — they are the
 * "no colour" tools, and keeping them grey makes the drawing groups pop.
 */
export const RAIL_GROUP_COLOR = {
  select: "var(--text-muted, var(--text-mute))",
  draw: "var(--c-opacity)",
  shape: "var(--c-scale)",
  style: "var(--brand)",
  action: "var(--text-mute)",
};

/** A short, human label for an element's paint, used in tooltips. */
export function paintLabel(el) {
  const fill = el.fill || "none";
  const stroke = el.stroke || "none";
  return `${fill} · ${stroke}`;
}

/**
 * The colour chip that represents an element: its fill, with a ring in the
 * stroke colour. Returns { fill, stroke } ready for CSS.
 */
export function elementColors(el) {
  return {
    fill: el.fill || "transparent",
    stroke: el.stroke || "transparent",
    hasFill: !!el.fill,
    hasStroke: !!el.stroke,
  };
}
