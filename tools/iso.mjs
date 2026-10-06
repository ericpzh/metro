// The isometric drawing kit the concept sheets used to be built from.
//
// **Retired.** The sheets are photographs of the game now, taken by
// `tools/shots.mjs` from the built app; nothing generates artwork from this file
// any more, and `tools/gen-art.mjs` – the entry point that drove it – is gone.
//
// It is kept because the game's own look was first worked out here: the palette
// below is a stylised read of real Guangzhou Metro stations (white baffle
// ceilings, glossy enamel wall panels, speckled granite floors, stainless
// columns, full-height screen doors wearing their line's colour, tactile
// warning strips), and the renderer in `game/src/render/` still answers to it.
// Read it as the record of where the art direction came from, not as a tool.
//
// Its siblings – `sheets-a.mjs` … `sheets-e.mjs`, `sheet-01-hero.mjs`,
// `sheet-07-ui.mjs`, `sheet-11-trains3d.mjs`, `sheet-13-two-line.mjs`,
// `train-iso.mjs`, `zoom.mjs` – are the same: the drawing code for sheets that
// are no longer drawn. `tools/serve.mjs` is still useful on its own.
// Shared drawing library for the Metro Station Designer concept sheets.
// 2:1 isometric projection, 1 block = 1 m, z is height in metres.

export const C = {
  bg0: '#0c1017', soil: '#3b3229', soil2: '#4a4034',
  // ---- interiors are high key: light speckled stone, white panels, brushed metal.
  // Guangzhou Metro reference: white baffle ceilings, glossy coloured enamel wall
  // panels with visible seams, light granite floors with dark inlay bands,
  // stainless columns with a dark base, safety red + tactile yellow accents.
  floor: '#d3d7dc', floorInlay: '#8b939c', floorAlt: '#c2c7cd',
  concrete: '#c9cdd2', concreteD: '#a5abb2', slab: '#b6bcc2',
  tile: '#f1f3f5', tile2: '#e0e5ea', panel: '#fbfcfd',
  ceil: '#eceff2', ceilBaffle: '#dfe4e9', soffit: '#5c646d',
  wallB: '#2c333d',
  yellow: '#f2b32c', yellowD: '#c98f18',
  blue: '#2b6fd4', blueD: '#1d4f9c',
  green: '#2fa84f', red: '#d0342c', pink: '#e85c8a', purple: '#7b4fa8',
  teal: '#17a89a', orange: '#ef8c1e', wood: '#a4703f',
  glass: '#a8d8ea', steel: '#bcc3ca', steelD: '#8d959d', dark: '#2b323a',
  white: '#f7f9fb', psu: '#f0c000', ink: '#0d1116', asc: '#37c5e8',
  safety: '#e8452f', maroon: '#7a2c2c', tactile: '#f2b32c',
  lineA: '#f0b323', lineB: '#2b6fd4', lineC: '#ef8c1e', lineD: '#2fa84f',
  lineE: '#d0342c', lineF: '#7b4fa8',
};
export const LINES = [
  ['1', C.lineA], ['2', C.lineB], ['3', C.lineC],
  ['4', C.lineD], ['5', C.lineE], ['6', C.lineF],
];
export const PCOL = [C.red, C.blue, C.green, C.purple, C.pink, C.teal, C.orange, '#d7dde5', '#3f4a58', '#c98d63'];

/* Rolling stock, in metres. One source of truth: the car length and door count
 * give the door centres, and the platform screen doors, the queue lanes and the
 * boarding paths are all placed from the same list - so they cannot drift. */
export const STOCK = {
  A: { id: 'A', col: '#e5484d', len: 22.0, w: 3.0, h: 3.8, doors: 5, doorW: 1.4 },
  B: { id: 'B', col: '#2f7ef2', len: 19.5, w: 2.8, h: 3.8, doors: 4, doorW: 1.3 },
  C: { id: 'C', col: '#f2b32c', len: 19.0, w: 2.6, h: 3.6, doors: 4, doorW: 1.2 },
};

/** Door centres measured from the car centre, in metres. Doors are spread so the
 *  gaps between the doors, and to both car ends, are equal - which is how real
 *  cars are laid out, and why the door pitch is not simply len/doors. */
export function carDoorCenters(len, doors, doorW) {
  const gap = (len - doors * doorW) / (doors + 1);
  const out = [];
  for (let i = 0; i < doors; i++) out.push(-len / 2 + gap * (i + 1) + doorW * (i + 0.5));
  return out;
}

/** Convenience: door centres for a consist, in metres from the first car's nose. */
export function consistDoorCenters(stock, cars = 2, carGap = 1.0) {
  const off = carDoorCenters(stock.len, stock.doors, stock.doorW);
  const out = [];
  for (let c = 0; c < cars; c++) {
    const nose = c * (stock.len + carGap);
    for (const o of off) out.push(nose + stock.len / 2 + o);
  }
  return { doors: out, carNoses: Array.from({ length: cars }, (_, c) => c * (stock.len + carGap)) };
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const n = (v) => (Math.round(v * 10) / 10).toString();

export function hx(hex) {
  const s = String(hex).trim();
  if (s.startsWith('rgb')) {
    const m = s.match(/-?\d+(\.\d+)?/g) || [0, 0, 0];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  const h = s.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function shade(hex, f) {
  const [r, g, b] = hx(hex);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/* ---------------------------------------------------------------- iso */
export const TW = 30, TH = 15, ZU = 26;
export const px = (x, y) => (x - y) * TW;
export const py = (x, y, z) => (x + y) * TH - z * ZU;
export const P = (x, y, z) => [px(x, y), py(x, y, z)];
export const pstr = (a) => a.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');

export const poly = (pts, fill, stroke = C.ink, sw = 0.8, extra = '') =>
  `<polygon points="${pstr(pts)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"` : ''}${extra ? ` ${extra}` : ''}/>`;

export function boxSvg(x, y, z, w, d, h, col, o = {}) {
  const tone = o.tone ?? 1;
  const st = o.stroke === null ? null : (o.stroke ?? C.ink);
  const sw = o.sw ?? 0.8;
  const op = o.opacity ? ` opacity="${o.opacity}"` : '';
  const t = shade(col, tone * (o.top ?? 1.13));
  const r = shade(col, tone * (o.right ?? 0.80));
  const f = shade(col, tone * (o.left ?? 0.58));
  let s = poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], t, st, sw, op);
  if (!o.noRight) {
    s += poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], r, st, sw, op);
  }
  if (!o.noFront) {
    s += poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], f, st, sw, op);
  }
  return s;
}

export function quadSvg(x, y, z, w, d, col, o = {}) {
  return poly([P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)],
    o.fill ?? shade(col, o.tone ?? 1), o.stroke ?? C.ink, o.sw ?? 0.6,
    o.opacity ? `opacity="${o.opacity}"` : '');
}

/** rounded-corner box: octagonal top, trapezoid sides, chamfered front edge.
 *  This is the look for machines, columns, gates and blocks: blocky, but soft. */
export function rboxSvg(x, y, z, w, d, h, col, o = {}) {
  const r = Math.min(o.r ?? 0.14, w / 2 - 0.001, d / 2 - 0.001);
  const tone = o.tone ?? 1;
  const st = o.stroke === null ? null : (o.stroke ?? C.ink);
  const sw = o.sw ?? 0.8;
  const op = o.opacity ? ` opacity="${o.opacity}"` : '';
  const t = shade(col, tone * (o.top ?? 1.13));
  const rgt = shade(col, tone * (o.right ?? 0.80));
  const fnt = shade(col, tone * (o.left ?? 0.58));
  const cha = shade(col, tone * (o.left ?? 0.58) * 1.14);
  const zt = z + h;
  let s = poly([
    P(x + r, y, zt), P(x + w - r, y, zt), P(x + w, y + r, zt), P(x + w, y + d - r, zt),
    P(x + w - r, y + d, zt), P(x + r, y + d, zt), P(x, y + d - r, zt), P(x, y + r, zt),
  ], t, st, sw, op);
  if (!o.noRight) {
    s += poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d - r, zt), P(x + w, y + r, zt)], rgt, st, sw, op);
  }
  if (!o.noFront) {
    s += poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w - r, y + d, zt), P(x, y + d, zt)], fnt, st, sw, op);
    s += poly([P(x + w - r, y + d, z), P(x + w, y + d - r, z), P(x + w, y + d - r, zt), P(x + w - r, y + d, zt)], cha, st, sw, op);
  }
  return s;
}

/** vertical quad. axis 'y' -> plane facing +y at y=at, spans x=a0..a1. axis 'x' -> faces +x. */
export function faceSvg(axis, at, a0, a1, z0, z1, col, o = {}) {
  const col2 = shade(col, o.tone ?? 1);
  const pts = axis === 'y'
    ? [P(a0, at, z0), P(a1, at, z0), P(a1, at, z1), P(a0, at, z1)]
    : [P(at, a0, z0), P(at, a1, z0), P(at, a1, z1), P(at, a0, z1)];
  return poly(pts, col2, o.stroke ?? C.ink, o.sw ?? 0.8, o.opacity ? `opacity="${o.opacity}"` : '');
}

/** Sloped band that runs along +y, dropping from z0 to z1 (escalator truss, ramp,
 *  handrail, roof plane). Every face is parallel to the run - no horizontal edges. */
export function rampSvg(x, y, z0, w, d, z1, col, o = {}) {
  const tone = o.tone ?? 1;
  const t = o.truss ?? 0.7;                                  // depth of the truss below the deck
  const st = o.stroke === null ? null : (o.stroke ?? C.ink);
  const sw = o.sw ?? 0.8;
  const op = o.opacity ? ` opacity="${o.opacity}"` : '';
  const deck = shade(col, tone * (o.top ?? 1.15));
  const side = shade(col, tone * (o.right ?? 0.80));
  const cap = shade(col, tone * (o.left ?? 0.58));
  const A = P(x, y, z0), B = P(x + w, y, z0), Cc = P(x + w, y + d, z1), D = P(x, y + d, z1);
  return poly([A, B, Cc, D], deck, st, sw, op)                                             // deck
    + poly([B, Cc, P(x + w, y + d, z1 - t), P(x + w, y, z0 - t)], side, st, sw, op)         // +x skirt, parallel to run
    + poly([D, Cc, P(x + w, y + d, z1 - t), P(x, y + d, z1 - t)], cap, st, sw, op);         // near end cap
}

/** accumulative iso scene: flat quads first, then depth-sorted 3d shapes */
export function Scene() {
  const bg = [], fg = [];
  const push = (k, s) => fg.push([k, s]);
  return {
    bg, fg,
    raw: (s) => bg.push(s),
    quad: (x, y, z, w, d, c, o) => bg.push(quadSvg(x, y, z, w, d, c, o)),
    box(x, y, z, w, d, h, c, o = {}) {
      push(o.k ?? ((x + w / 2) + (y + d / 2) + (z + h / 2) * 0.9), boxSvg(x, y, z, w, d, h, c, o));
    },
    face(ax, at, a0, a1, z0, z1, c, o = {}) {
      const base = ax === 'y' ? (a0 + a1) / 2 + at : at + (a0 + a1) / 2;
      push(o.k ?? (base + ((z0 + z1) / 2) * 0.9), faceSvg(ax, at, a0, a1, z0, z1, c, o));
    },
    ramp(x, y, z0, w, d, z1, c, o = {}) {
      push(o.k ?? ((x + w / 2) + (y + d / 2) + ((z0 + z1) / 2) * 0.9), rampSvg(x, y, z0, w, d, z1, c, o));
    },
    /** deck that runs along -x: from (x0,z0) down to (x1,z1), w wide in y */
    deck(x0, y, z0, x1, w, z1, c, o = {}) {
      const k = o.k ?? ((x0 + x1) / 2 + (y + w / 2) + ((z0 + z1) / 2) * 0.9);
      const t = o.truss ?? 0.7;
      let s = poly([P(x0, y, z0), P(x1, y, z1), P(x1, y + w, z1), P(x0, y + w, z0)], shade(c, 1.14), C.ink, 0.8);
      s += poly([P(x0, y + w, z0), P(x1, y + w, z1), P(x1, y + w, z1 - t), P(x0, y + w, z0 - t)], shade(c, 0.6), C.ink, 0.8);
      s += poly([P(x0, y, z0), P(x1, y, z1), P(x1, y, z1 - t), P(x0, y, z0 - t)], shade(c, 0.86), C.ink, 0.8);
      push(k, s);
    },
    /** vertical band that follows a slope in the plane x=at (for stairs that run along y) */
    slopeY(at, y0, z0, y1, z1, h, c, o = {}) {
      const k = o.k ?? (at + (y0 + y1) / 2 + ((z0 + z1) / 2 + h) * 0.9);
      push(k, poly([P(at, y0, z0), P(at, y1, z1), P(at, y1, z1 + h), P(at, y0, z0 + h)],
        shade(c, o.tone ?? 1), o.stroke === null ? null : C.ink, o.sw ?? 0.7,
        o.opacity ? `opacity="${o.opacity}"` : ''));
    },
    /** a handrail that actually follows the run: glass/steel panel + dark cap rail */
    handrailY(at, y0, z0, y1, z1, h, o = {}) {
      this.slopeY(at, y0, z0, y1, z1, h, o.panel ?? C.glass, { tone: o.panelTone ?? 1.2, opacity: o.opacity ?? 0.85, sw: 0.6 });
      this.slopeY(at, y0, z0 + h, y1, z1 + h, o.cap ?? 0.09, o.capCol ?? C.steelD, { tone: 1.0, sw: 0.5 });
    },
    /** same, for runs along x */
    handrailX(at, x0, z0, x1, z1, h, o = {}) {
      const k = o.k ?? ((x0 + x1) / 2 + at + ((z0 + z1) / 2 + h) * 0.9);
      push(k, poly([P(x0, at, z0), P(x1, at, z1), P(x1, at, z1 + h), P(x0, at, z0 + h)],
        shade(o.panel ?? C.glass, o.panelTone ?? 1.2), C.ink, 0.6, o.opacity ? `opacity="${o.opacity}"` : 'opacity="0.85"'));
      push(k + 0.01, poly([P(x0, at, z0 + h), P(x1, at, z1 + h), P(x1, at, z1 + h + 0.09), P(x0, at, z0 + h + 0.09)],
        shade(o.capCol ?? C.steelD, 1.0), C.ink, 0.5));
    },
    /** rounded-corner box in the scene's depth order */
    rbox(x, y, z, w, d, h, c, o = {}) {
      push(o.k ?? ((x + w / 2) + (y + d / 2) + (z + h / 2) * 0.9), rboxSvg(x, y, z, w, d, h, c, o));
    },
    /** vertical band that follows a slope in the plane y=at, raised by h above the deck line */
    slope(at, x0, z0, x1, z1, h, c, o = {}) {
      const k = o.k ?? ((x0 + x1) / 2 + at + ((z0 + z1) / 2 + h) * 0.9);
      push(k, poly([P(x0, at, z0), P(x1, at, z1), P(x1, at, z1 + h), P(x0, at, z0 + h)],
        shade(c, o.tone ?? 1), o.stroke === null ? null : C.ink, o.sw ?? 0.7,
        o.opacity ? `opacity="${o.opacity}"` : ''));
    },
    sprite(x, y, z, sprite, o = {}) {
      const t = o.scale && o.scale !== 1
        ? `transform="translate(${n(px(x, y))},${n(py(x, y, z))}) scale(${o.scale})"`
        : `x="${n(px(x, y))}" y="${n(py(x, y, z))}"`;
      push(o.k ?? (x + y + z * 0.9 + (o.bias ?? 0)),
        `<use href="#${sprite}" ${t}${o.color ? ` style="color:${o.color}"` : ''}/>`);
    },
    out() { return bg.join('') + fg.sort((a, b) => a[0] - b[0]).map((v) => v[1]).join(''); },
  };
}

/* ------------------------------------------------------------ sprites */
export const SPRITES = `
<g id="person">
  <ellipse cx="0" cy="1" rx="11" ry="5" fill="#000" opacity=".32"/>
  <rect x="-7.5" y="-30" width="15" height="31" rx="6.5" fill="currentColor"/>
  <rect x="-7.5" y="-30" width="15" height="31" rx="6.5" fill="#000" opacity=".16"/>
  <circle cx="0" cy="-36" r="7.4" fill="#c98d63"/>
  <path d="M-7.6 -38 a7.6 7.6 0 0 1 15.2 0 z" fill="#22272f"/>
</g>
<g id="personBag">
  <use href="#person"/>
  <rect x="9" y="-21" width="12" height="16" rx="3" fill="#f2b32c" stroke="#0b0e13" stroke-width="1.2"/>
</g>
<g id="personSeat">
  <ellipse cx="0" cy="1" rx="11" ry="5" fill="#000" opacity=".3"/>
  <rect x="-8" y="-21" width="16" height="22" rx="7" fill="currentColor"/>
  <rect x="-8" y="-21" width="16" height="22" rx="7" fill="#000" opacity=".2"/>
  <circle cx="0" cy="-27" r="7.4" fill="#c98d63"/>
  <path d="M-7.6 -29 a7.6 7.6 0 0 1 15.2 0 z" fill="#22272f"/>
</g>
<pattern id="soilHatch" width="18" height="18" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
  <rect width="18" height="18" fill="#3b3229"/>
  <line x1="0" y1="0" x2="0" y2="18" stroke="#4a4034" stroke-width="4"/>
</pattern>
<linearGradient id="sheetBg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#151d29"/><stop offset="1" stop-color="#0a0d13"/>
</linearGradient>
<radialGradient id="glow" cx=".5" cy=".42" r=".62">
  <stop offset="0" stop-color="#2b3a52" stop-opacity=".8"/><stop offset="1" stop-color="#0c1017" stop-opacity="0"/>
</radialGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="blur6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
`;

/* --------------------------------------------------------------- text */
export const T = (x, y, s, o = {}) =>
  `<text x="${n(x)}" y="${n(y)}" fill="${o.fill ?? '#e8eef6'}" font-size="${o.size ?? 17}"${
    o.weight ? ` font-weight="${o.weight}"` : ''}${o.mono ? ' font-family="ui-monospace,Consolas,monospace"' : ''}${
    o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}${
    o.opacity ? ` opacity="${o.opacity}"` : ''}>${esc(s)}</text>`;

export const MUL = (x, y, lines, o = {}) =>
  lines.map((l, i) => T(x, y + i * (o.lh ?? 22), l, o)).join('');

export function tag(x, y, s, col, o = {}) {
  const size = o.size ?? 14;
  const w = o.w ?? (s.length * size * 0.6 + 22);
  const h = o.h ?? 28;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${h}" rx="7" fill="${col}" opacity=".16" stroke="${col}" stroke-width="1.2" stroke-opacity=".8"/>`
    + T(x + 11, y + h - 9, s, { size, fill: col, mono: true, weight: 700 });
}
export function leader(x1, y1, x2, y2, col = C.yellow) {
  return `<path d="M${n(x1)},${n(y1)} L${n(x2)},${n(y2)}" stroke="${col}" stroke-width="1.6" stroke-dasharray="7 5" opacity=".9" fill="none"/>`
    + `<circle cx="${n(x2)}" cy="${n(y2)}" r="4.5" fill="${col}"/>`;
}
/** numbered callout ball + dashed leader + label */
export function callout(list, x, y, lx, ly, num, text, o = {}) {
  const col = o.col ?? C.yellow;
  list.push(leader(x, y, lx, ly, col));
  list.push(`<circle cx="${n(lx)}" cy="${n(ly)}" r="13" fill="${col}" stroke="${C.ink}" stroke-width="2.2"/>`
    + T(lx, ly + 5.5, String(num), { size: 15, weight: 800, fill: C.ink, anchor: 'middle' }));
  if (text) list.push(T(lx + (o.dx ?? 21), ly + 5.5, text, { size: o.size ?? 14.5, fill: o.fill ?? '#dfe7f0', weight: 600, anchor: o.anchor }));
}
export function title(x, y, kicker, head, sub) {
  return T(x, y, kicker, { size: 13, fill: C.yellow, ls: 2.6, weight: 700 })
    + T(x, y + 40, head, { size: 36, weight: 800, fill: '#f2f6fb' })
    + (sub ? T(x, y + 68, sub, { size: 15, fill: '#93a1b3' }) : '');
}
export function legend(x, y, items, o = {}) {
  const out = [];
  items.forEach(([col, txt], i) => {
    const ly = y + i * (o.step ?? 30);
    out.push(`<rect x="${n(x)}" y="${n(ly - 11)}" width="14" height="14" rx="3.5" fill="${col}"/>`);
    out.push(T(x + 24, ly, txt, { size: o.size ?? 13.5, fill: '#c3d0de' }));
  });
  return out.join('');
}
export function sheet(w, h, body, o = {}) {
  // fold in the per-mover keyframes the helpers buffered while drawing
  const css = MOTION_CSS.replace('</style>', `${_kf.join('')}</style>`);
  _kf.length = 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter,'Noto Sans SC','Source Han Sans SC','Microsoft YaHei','PingFang SC','Hiragino Sans GB',Segoe UI,Helvetica,Arial,sans-serif">
<defs>${SPRITES}</defs>
${css}
<rect width="${w}" height="${h}" fill="url(#sheetBg)"/>
${o.glow ? `<rect width="${w}" height="${h}" fill="url(#glow)"/>` : ''}
${body}
</svg>`;
}
/** draw a plan-view rect with a label helper used by the plan sheets */
export function chart(series, x, y, w, h, o = {}) {
  const max = o.max ?? Math.max(...series.flatMap((s) => s.v));
  const g = [];
  const px0 = (i, len) => x + (i / (len - 1)) * w;
  const py0 = (v) => y + h - (v / max) * h;
  for (let i = 0; i <= 4; i++) {
    const gy = y + (h / 4) * i;
    g.push(`<line x1="${n(x)}" y1="${n(gy)}" x2="${n(x + w)}" y2="${n(gy)}" stroke="#2a3542" stroke-width="1"${i === 4 ? ' stroke-opacity=".4"' : ''}/>`);
    g.push(T(x - 10, gy + 5, String(Math.round(max * (1 - i / 4))), { size: 11.5, fill: '#7d8ea3', anchor: 'end', mono: true }));
  }
  for (const s of series) {
    if (s.area) {
      g.push(`<path d="M${n(px0(0, s.v.length))},${n(y + h)} ${s.v.map((v, i) => `L${n(px0(i, s.v.length))},${n(py0(v))}`).join(' ')} L${n(x + w)},${n(y + h)} Z" fill="${s.col}" opacity=".16"/>`);
    }
    g.push(`<path d="${s.v.map((v, i) => `${i ? 'L' : 'M'}${n(px0(i, s.v.length))},${n(py0(v))}`).join(' ')}" fill="none" stroke="${s.col}" stroke-width="${s.w ?? 2.6}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
  }
  return g.join('');
}

/* ================================================================== *
 * motion: shared CSS helpers
 *
 * A concept sheet has to keep moving wherever it is shown, and the site
 * (like GitHub, and every markdown viewer) shows it through an <img>.
 * That rules out SMIL: browsers freeze <animate*> inside an SVG image.
 * CSS animations do run there, so every helper below emits a class plus
 * CSS custom properties, and `sheet()` injects the keyframe library that
 * consumes them. Nothing needs scripting, so the sheets also animate when
 * opened on their own.
 * ================================================================== */
export const MOTION_CSS = `<style>
@media (prefers-reduced-motion:reduce){.a-sway,.a-move,.a-doors,.a-spin,.a-breathe,.a-dash,.a-grow,.a-pulsew,.a-pass,.mvr{animation:none!important}}
@keyframes mSway{to{transform:translate(0,var(--ay,0px))}}
@keyframes mMove{0%,18%{transform:translate(0,0)}52%,68%{transform:translate(var(--ax,0px),var(--ay,0px))}100%{transform:translate(0,0)}}
@keyframes mDoors{0%,30%{transform:translate(0,0)}42%,72%{transform:translate(var(--ax,0px),var(--ay,0px))}84%,100%{transform:translate(0,0)}}
@keyframes mSpin{to{transform:rotate(360deg)}}
@keyframes mBreathe{to{opacity:var(--to,.3)}}
@keyframes mDash{to{stroke-dashoffset:var(--dash,-20px)}}
@keyframes mFade{0%,4%{opacity:0}12%,90%{opacity:1}96%,100%{opacity:0}}
@keyframes mGrow{0%,12%{width:0px}50%,86%{width:var(--w)}100%{width:0px}}
@keyframes mPulseW{0%,100%{width:var(--w)}50%{width:var(--w2)}}
@keyframes mPass{0%{transform:translate(calc(-1 * var(--s,-100px)),0)}16%{transform:translate(0,0)}70%{transform:translate(0,0)}86%,100%{transform:translate(var(--s,-100px),0)}}
.a-sway{animation-name:mSway;animation-duration:var(--dur,5s);animation-timing-function:ease-in-out;animation-delay:var(--delay,0s);animation-iteration-count:infinite;animation-direction:alternate}
.a-move{animation-name:mMove;animation-duration:var(--dur,16s);animation-timing-function:ease-in-out;animation-delay:var(--delay,0s);animation-iteration-count:infinite}
.a-doors{animation-name:mDoors;animation-duration:var(--dur,9s);animation-timing-function:ease-in-out;animation-delay:var(--delay,0s);animation-iteration-count:infinite}
.a-spin{animation-name:mSpin;animation-duration:var(--dur,18s);animation-timing-function:linear;animation-delay:var(--delay,0s);animation-iteration-count:infinite;transform-box:fill-box;transform-origin:center}
.a-breathe{animation-name:mBreathe;animation-duration:var(--dur,4s);animation-timing-function:ease-in-out;animation-delay:var(--delay,0s);animation-iteration-count:infinite;animation-direction:alternate}
.a-dash{animation-name:mDash;animation-duration:var(--dur,1.6s);animation-timing-function:linear;animation-delay:var(--delay,0s);animation-iteration-count:infinite}
.a-grow{animation-name:mGrow;animation-duration:var(--dur,10s);animation-timing-function:ease-in-out;animation-delay:var(--delay,0s);animation-iteration-count:infinite}
.a-pulsew{animation-name:mPulseW;animation-duration:var(--dur,4s);animation-timing-function:ease-in-out;animation-delay:var(--delay,0s);animation-iteration-count:infinite}
.a-pass{animation-name:mPass;animation-duration:var(--dur,20s);animation-timing-function:ease-in-out;animation-delay:var(--delay,0s);animation-iteration-count:infinite}
</style>`;

export const D_LOOP = '16s';

/** translate: a "move out and settle back" slide. `values` are "x y" pairs,
 *  as SMIL used to take them; only the displaced pair matters now. */
export const amT = (values, keyTimes, dur = D_LOOP, splines, begin = 0) => {
  const pairs = String(values).split(';');
  let ax = 0, ay = 0;
  for (const p of pairs) {
    const [x, y] = p.trim().split(/\s+/).map(Number);
    if (x || y) { ax = x; ay = y; }
  }
  const cls = pairs.length >= 6 ? 'a-doors' : 'a-move';
  return `class="${cls}" style="--ax:${n(ax)}px;--ay:${n(ay)}px;--dur:${dur};--delay:${begin}"`;
};

/** a gentle vertical bob around rest, in user units. */
export const sway = (amp = 3, dur = '5s', begin = 0) =>
  `class="a-sway" style="--ay:${n(-amp)}px;--dur:${dur};--delay:${begin}"`;

/** opacity pulse; `to` is the low point of the breath. */
export const breathe = (to = 0.35, dur = '4s', begin = 0) =>
  `class="a-breathe" style="--to:${n(to)};--dur:${dur};--delay:${begin}"`;

/** continuous rotation about the element's own centre. */
export const spin = (dur = '18s', begin = 0) =>
  `class="a-spin" style="--dur:${dur};--delay:${begin}"`;

/** marching dashes: the pattern travels by `len` units per loop, i.e. it flows. */
export const dashFlow = (len, dur = '1.6s', begin = 0, forward = true) =>
  `class="a-dash" style="--dash:${n(forward ? -len : len)}px;--dur:${dur};--delay:${begin}"`;

/** a whole group that moves: pass the inner markup and the attribute strings
 *  the motion helpers return. */
export const group = (inner, ...attrs) => `<g ${attrs.filter(Boolean).join(' ')}>${inner}</g>`;

/** A passenger that walks one path, fading in as it starts and out as it
 *  arrives. `begin` staggers it; `dur` is one traversal of the loop. Pass
 *  `o.sprite` to walk a <use> sprite (a person) instead of a dot,
 *  `o.noFade` for a marker that loops forever (a camera orbit).
 *
 *  Paths are compiled to translate keyframes rather than left to
 *  `animateMotion`/`offset-path`: browsers suspend both of those inside an
 *  SVG used as an image, which is exactly how the site and README show the
 *  sheets. Plain transforms keep working there. */
let _kfSeq = 0;
const _kf = [];
export const mover = (path, col, begin = 0, o = {}) => {
  const dur = o.dur ?? D_LOOP;
  const pts = [];
  const re = /[ML]\s*([-0-9.]+)[\s,]+([-0-9.]+)/gi;
  let m;
  while ((m = re.exec(path))) pts.push([+m[1], +m[2]]);
  if (pts.length < 2) pts.push([pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0]);
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(l); total += l;
  }
  let acc = 0;
  const steps = pts.map((p, i) => {
    if (i > 0) acc += seg[i - 1];
    const at = total ? (acc / total) * 100 : 0;
    return `${at.toFixed(3)}%{transform:translate(${n(p[0])}px,${n(p[1])}px)}`;
  });
  const name = `kf${++_kfSeq}`;
  _kf.push(`@keyframes ${name}{${steps.join('')}}`);
  const body = o.sprite
    ? `<use href="#${o.sprite}" x="0" y="0" style="color:${col}"/>`
    : `<circle cx="0" cy="0" r="${n(o.r ?? 6.5)}" fill="${col}" stroke="#0d1116" stroke-width="1"/>`;
  const names = o.noFade ? name : `${name},mFade`;
  const durs = o.noFade ? dur : `${dur},${dur}`;
  const delays = o.noFade ? `${begin}` : `${begin},${begin}`;
  return `<g class="mvr" style="animation-name:${names};animation-duration:${durs};animation-delay:${delays};animation-timing-function:linear;animation-iteration-count:infinite">${body}</g>`;
};

/** a bar that fills, holds and empties - a queue, a load, a timetable gap. */
export const growBar = (w, dur = '10s', begin = 0) =>
  `class="a-grow" style="--w:${n(w)}px;--dur:${dur};--delay:${begin}"`;

/** a bar that breathes between two widths. */
export const pulseBar = (w, w2, dur = '4s', begin = 0) =>
  `class="a-pulsew" style="--w:${n(w)}px;--w2:${n(w2)}px;--dur:${dur};--delay:${begin}"`;

/** a train that passes: enters from one side, dwells, exits the other. */
export const passT = (shift, dur = '20s', begin = 0) =>
  `class="a-pass" style="--s:${n(shift)}px;--dur:${dur};--delay:${begin}"`;
