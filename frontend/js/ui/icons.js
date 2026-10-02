/**
 * Icon set. 24×24 grid, 1.7px stroke, round caps — drawn here so the studio
 * carries no icon font, no sprite request and no emoji.
 *
 * `icon(name, size)` returns an <svg> string; `iconEl(name, size)` returns a
 * live element for imperative use.
 */

export const ICONS = {
  /* ---- tools ---- */
  cursor: '<path d="M5 3.5 18.5 12l-5.6 1.6L10.6 19z"/>',
  pen: '<path d="M4 20l1.2-4.2L15.9 5.1a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M14.4 6.6l3 3"/>',
  brush: '<path d="M15.5 3.8 20.2 8.5 10 18.7l-4.7-4.7z"/><path d="M5.3 14l-1.1 5.8 5.8-1.1"/>',
  path: '<path d="M4 17c3-9 13-9 16 0"/><circle cx="4" cy="17" r="1.6"/><circle cx="20" cy="17" r="1.6"/>',
  text: '<path d="M5 6.5V5h14v1.5"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  rounded: '<rect x="4" y="6" width="16" height="12" rx="4"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  line: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
  arrow: '<path d="M4 12h13"/><path d="M13 8l4 4-4 4"/>',
  polygon: '<path d="M12 4l7.5 4.4v7.2L12 20l-7.5-4.4V8.4z"/>',
  star: '<path d="M12 3.6l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.9l6.1-.7z"/>',
  hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V5.5a1.5 1.5 0 0 1 3 0v5"/><path d="M14 10.5V7a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-2.5a1.5 1.5 0 0 1 3 0"/>',
  eyedropper: '<path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L17 11l-4-4z"/><path d="M15 8 6 17v3h3l9-9"/>',
  eraser: '<path d="M8 20h11"/><path d="M15.5 4.5 19.5 8.5 11 17H5.5l-1-1z"/>',
  zoom: '<circle cx="11" cy="11" r="6.2"/><path d="M15.5 15.5 20 20"/><path d="M11 8.6v4.8M8.6 11h4.8"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6.5 8v3M10.5 8v4M14.5 8v3M18.5 8v4"/>',
  vector: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="16" y="16" width="5" height="5" rx="1"/><path d="M8 5.5h5a4 4 0 0 1 4 4v6"/>',

  /* ---- view / navigation ---- */
  undo: '<path d="M4 9h9.5a4.5 4.5 0 0 1 0 9H9"/><path d="M7.5 5.5 4 9l3.5 3.5"/>',
  redo: '<path d="M20 9h-9.5a4.5 4.5 0 0 0 0 9H15"/><path d="M16.5 5.5 20 9l-3.5 3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  grid: '<path d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16"/><rect x="4" y="4" width="16" height="16" rx="1.5"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 9h4M14 9h4"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.5 6.4A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.3 3.8"/><path d="M6.6 8.1A17.4 17.4 0 0 0 2.5 12s3.5 6 9.5 6a9.5 9.5 0 0 0 3.4-.6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>',

  /* ---- editing ---- */
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l1 12.1A1.5 1.5 0 0 0 9 20.5h6a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5A2 2 0 0 0 13.5 4h-7a2.5 2.5 0 0 0-2.5 2.5v7a2 2 0 0 0 1.5 1.9"/>',
  duplicate: '<rect x="3.5" y="3.5" width="12" height="12" rx="2"/><path d="M8.5 20.5h9a3 3 0 0 0 3-3v-9"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/>',
  group: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ungroup: '<rect x="3.5" y="3.5" width="8" height="8" rx="1.5"/><rect x="12.5" y="12.5" width="8" height="8" rx="1.5"/>',
  bringFront: '<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M16 20H5a2 2 0 0 1-2-2V7"/>',
  sendBack: '<rect x="3" y="8" width="13" height="13" rx="2"/><path d="M8 4h11a2 2 0 0 1 2 2v11"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 6.5l3 3"/>',

  /* ---- timeline / transport ---- */
  play: '<path d="M7 4.5 19 12 7 19.5z"/>',
  pause: '<rect x="6.5" y="4.5" width="3.8" height="15" rx="1.2"/><rect x="13.7" y="4.5" width="3.8" height="15" rx="1.2"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
  skipBack: '<path d="M18.5 5v14L8 12z"/><path d="M5.5 5v14"/>',
  skipForward: '<path d="M5.5 5v14L16 12z"/><path d="M18.5 5v14"/>',
  toStart: '<path d="M19 5v14L8.5 12z"/><path d="M5 5v14"/>',
  toEnd: '<path d="M5 5v14L15.5 12z"/><path d="M19 5v14"/>',
  loop: '<path d="M4 9a5 5 0 0 1 5-5h7"/><path d="M20 15a5 5 0 0 1-5 5H8"/><path d="M13.5 1.5 16.5 4l-3 2.5"/><path d="M10.5 22.5 7.5 20l3-2.5"/>',
  onion: '<circle cx="9" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5" stroke-dasharray="2 2"/>',
  key: '<path d="M12 4.5 19 12l-7 7.5L5 12z"/>',
  diamond: '<path d="M12 4 20 12l-8 8-8-8z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  film: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7.5 4.5v15M16.5 4.5v15M3 12h18"/>',
  ease: '<path d="M4 19C10 19 14 5 20 5"/>',

  /* ---- files / system ---- */
  file: '<path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/>',
  filePlus: '<path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/><path d="M12 12v5M9.5 14.5h5"/>',
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
  save: '<path d="M5 3.5h11L20.5 8v12.5h-16z"/><path d="M8 3.5v6h7v-6"/><path d="M8 20.5v-6h8v6"/>',
  download: '<path d="M12 3.5v11"/><path d="M8 11l4 4 4-4"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 20V9"/><path d="M8 12.5 12 8.5l4 4"/><path d="M4.5 4.5h15"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4.5 17.5 10 12l4 4 2.5-2.5 3.5 3.5"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  power: '<path d="M12 4v8"/><path d="M7.5 6.6a7 7 0 1 0 9 0"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  zap: '<path d="M13.5 3 6 13.5h5L10.5 21 18 10.5h-5z"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 10l2.5 2.5L7 15"/><path d="M12 16h5"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.2 2.4 3.3 5 3.3 8S14.2 17.6 12 20c-2.2-2.4-3.3-5-3.3-8S9.8 6.4 12 4z"/>',

  /* ---- ui ---- */
  chevronDown: '<path d="M6 9.5 12 15.5 18 9.5"/>',
  chevronRight: '<path d="M9.5 6 15.5 12 9.5 18"/>',
  chevronUp: '<path d="M6 14.5 12 8.5 18 14.5"/>',
  chevronLeft: '<path d="M14.5 6 8.5 12 14.5 18"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5 9.5 17 19 7"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5.5M12 7.8v.2"/>',
  warning: '<path d="M12 4 21 19.5H3z"/><path d="M12 9.5v4.5M12 16.8v.2"/>',
  help: '<circle cx="12" cy="12" r="8"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6v.4"/><path d="M12 17.2v.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.1z"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8 0-.5-.2-.9-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6h1.6a3.3 3.3 0 0 0 3.3-3.3c0-4-3.4-7.9-7.5-7.9z"/><circle cx="8" cy="11" r="1.1"/><circle cx="12" cy="8" r="1.1"/><circle cx="16" cy="11" r="1.1"/>',
  layers: '<path d="M12 3.5 20.5 8 12 12.5 3.5 8z"/><path d="M3.5 12.5 12 17l8.5-4.5"/><path d="M3.5 16.5 12 21l8.5-4.5"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  swap: '<path d="M6 4.5 3 7.5l3 3"/><path d="M3 7.5h12a4 4 0 0 1 4 4"/><path d="M18 19.5l3-3-3-3"/><path d="M21 16.5H9a4 4 0 0 1-4-4"/>',
  grip: '<circle cx="9" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="17" r="1.2"/><circle cx="15" cy="17" r="1.2"/>',
  sparkle: '<path d="M12 3.5 13.8 9 19 10.8 13.8 12.6 12 18l-1.8-5.4L5 10.8 10.2 9z"/><path d="M19 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  box: '<path d="M12 3 20 7.4v9.2L12 21l-8-4.4V7.4z"/><path d="M4 7.4 12 12l8-4.6M12 12v9"/>',
  loader: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2 18 18M18 6l-2.8 2.8M8.8 15.2 6 18"/>',

  /* ---- alignment ---- */
  alignLeft: '<path d="M4 4v16"/><rect x="7" y="6.5" width="11" height="4" rx="1"/><rect x="7" y="13.5" width="7" height="4" rx="1"/>',
  alignCenterH: '<path d="M12 3v18"/><rect x="5" y="6.5" width="14" height="4" rx="1"/><rect x="8" y="13.5" width="8" height="4" rx="1"/>',
  alignRight: '<path d="M20 4v16"/><rect x="6" y="6.5" width="11" height="4" rx="1"/><rect x="10" y="13.5" width="7" height="4" rx="1"/>',
  alignTop: '<path d="M4 4h16"/><rect x="6.5" y="7" width="4" height="11" rx="1"/><rect x="13.5" y="7" width="4" height="7" rx="1"/>',
  alignMiddleV: '<path d="M3 12h18"/><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="8" width="4" height="8" rx="1"/>',
  alignBottom: '<path d="M4 20h16"/><rect x="6.5" y="6" width="4" height="11" rx="1"/><rect x="13.5" y="10" width="4" height="7" rx="1"/>',
  distributeH: '<path d="M4 4v16M20 4v16"/><rect x="9" y="7" width="6" height="10" rx="1"/>',
  distributeV: '<path d="M4 4h16M4 20h16"/><rect x="7" y="9" width="10" height="6" rx="1"/>',

  /* ---- rail extras ---- */
  shapes: '<rect x="3" y="3.5" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="16.5" r="4.5"/>',
  wand: '<path d="M4.5 19.5 15 9"/><path d="M17 3.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/><path d="M6.5 4.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4L4.6 6.4l1.4-.5z"/>',
};

/**
 * @param {string} name key of ICONS
 * @param {number} size pixel size (defaults to 16)
 * @param {object} opts { stroke, fill, width, className }
 */
export function icon(name, size = 16, opts = {}) {
  const body = ICONS[name];
  if (!body) {
    console.warn(`[icons] unknown icon "${name}"`);
    return "";
  }
  const stroke = opts.stroke || "currentColor";
  const fill = opts.fill || "none";
  const sw = opts.width ?? 1.7;
  const cls = opts.className ? ` class="${opts.className}"` : "";
  const extra = opts.extra ? " " + opts.extra : "";
  return (
    `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" ${extra}` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"` +
    ` stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

export function iconEl(name, size = 16, opts = {}) {
  const wrap = document.createElement("template");
  wrap.innerHTML = icon(name, size, opts).trim();
  return wrap.content.firstElementChild;
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}
