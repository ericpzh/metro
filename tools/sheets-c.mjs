// Concept sheet 09 - camera, projection and CAD-style navigation.
// Includes a tiny orthographic box renderer so the same station model can be
// shown from any azimuth/elevation, including the flat elevation views.
import { C, T, MUL, title, sheet, n, poly, shade, legend } from './iso.mjs';

/* ------------------------------------------------------------------ *
 * tiny orthographic renderer: boxes in, polygons out
 * ------------------------------------------------------------------ */
const LIGHT = (() => { const v = [0.36, 0.26, 0.9]; const m = Math.hypot(...v); return v.map((c) => c / m); })();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function render(boxes, az, el, s, ox, oy, ctr = [8, 6, -2.6]) {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
  const cam = [ca * ce, sa * ce, se];
  const proj = (x, y, z) => {
    const X = x - ctr[0], Y = y - ctr[1], Z = z - ctr[2];
    return [ox + (sa * X - ca * Y) * s, oy + (se * (ca * X + sa * Y) - ce * Z) * s];
  };
  const faces = [];
  for (const [x, y, z, w, d, h, col] of boxes) {
    const c = [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]];
    const ct = [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]];
    const defs = [
      [ct, [0, 0, 1]],                       // top
      [[c[0], c[1], ct[1], ct[0]], [-1, 0, 0]], // -x
      [[c[1], c[2], ct[2], ct[1]], [1, 0, 0]],  // +x
      [[c[2], c[3], ct[3], ct[2]], [0, 1, 0]],  // +y
      [[c[3], c[0], ct[0], ct[3]], [0, -1, 0]], // -y
      [[c[0], c[3], c[2], c[1]], [0, 0, -1]],   // bottom
    ];
    for (const [quad, nrm] of defs) {
      if (dot(nrm, cam) <= 0.001) continue;
      const cen = quad.reduce((acc, p) => [acc[0] + p[0] / 4, acc[1] + p[1] / 4, acc[2] + p[2] / 4], [0, 0, 0]);
      const sh = 0.5 + 0.52 * Math.max(0, dot(nrm, LIGHT));
      faces.push({ k: dot(cen, cam), pts: quad.map((p) => proj(...p)), fill: shade(col, sh) });
    }
  }
  return faces.sort((p, q) => p.k - q.k).map((f) => poly(f.pts, f.fill, '#0d1116', 0.9)).join('');
}

/* ------------------------------------------------------------------ *
 * the reference station used in every card
 * ------------------------------------------------------------------ */
const B = (x, y, z, w, d, h, col) => [x, y, z, w, d, h, col];
function station() {
  const o = [];
  // ---- ground level
  o.push(B(0, 0, 0, 16, 12, 0.45, C.floor));                     // concourse slab
  o.push(B(0, -0.5, 0.45, 16, 0.5, 3.4, C.tile));                // back wall
  o.push(B(-0.5, -0.5, 0.45, 0.5, 12.5, 3.4, C.tile2));          // side wall
  o.push(B(0, -0.5, 3.85, 16, 0.5, 0.35, C.ceil));               // wall cap
  o.push(B(0, 0, 3.9, 16, 5.5, 0.3, C.ceil));                    // partial ceiling
  for (let i = 0; i < 5; i++) o.push(B(2.4 + i * 1.35, 5.4, 0.45, 1.15, 2, 1.05, C.steel));   // fare gates
  for (let i = 0; i < 3; i++) o.push(B(2.0 + i * 1.25, 0.4, 0.45, 1.05, 0.95, 2.0, C.blueD)); // TVMs
  o.push(B(11.6, 1.0, 0.45, 3.6, 5.0, 3.0, C.wood));             // retail unit
  o.push(B(11.4, 0.8, 3.45, 4.0, 5.4, 0.35, C.lineE));           // retail fascia
  for (const cx of [4.5, 9.0, 13.5]) o.push(B(cx, 9.0, 0.45, 0.8, 0.8, 3.4, C.steel));        // columns
  // ---- vertical circulation down to B1
  for (let i = 0; i < 9; i++) o.push(B(12.6, 6.4 + i * 0.62, 0.45 - (i + 1) * 0.42, 2.2, 0.62, 0.42, C.concrete));
  for (const bx of [12.5, 14.8]) o.push(B(bx, 6.4, 0.0, 0.16, 5.6, 1.0, C.glass));             // stair rails
  for (let i = 0; i < 10; i++) o.push(B(7.0, 6.2 + i * 0.6, 0.45 - (i + 1) * 0.42, 1.2, 0.6, 0.42, C.steel)); // escalator
  // ---- B1
  o.push(B(0, 0, -5.6, 16, 12, 0.5, C.floor));                   // platform slab
  o.push(B(0, 0, -5.1, 16, 2.4, 0.5, C.maroon));                 // platform edge zone
  o.push(B(0, 2.6, -5.0, 16, 0.8, 0.12, C.tactile));             // tactile strip
  o.push(B(1.0, 3.4, -4.6, 13, 3.0, 3.7, '#d8dee6'));            // train body
  o.push(B(1.0, 3.3, -1.5, 13, 0.12, 1.0, '#22323f'));           // window band
  o.push(B(0.6, 0.2, -5.0, 14, 0.35, 3.6, C.glass));             // PSD line
  o.push(B(0.6, 0.2, -1.9, 14, 0.4, 0.55, C.lineB));             // PSD header
  o.push(B(0.6, 0.2, -5.0, 14, 0.4, 0.5, C.safety));             // warning band
  for (let i = 0; i < 3; i++) o.push(B(2 + i * 4.6, 0.6, -5.1, 0.9, 0.9, 3.6, C.steel));       // platform columns
  return o;
}
const MODEL = station();

/* ------------------------------------------------------------------ *
 * card with a rendered viewport
 * ------------------------------------------------------------------ */
function card(g, x, y, w, h, label, sub, az, el, opt = {}) {
  g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(`<rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 74}" rx="9" fill="#0b1119"/>`);
  g.push(render(MODEL, az, el, opt.s ?? 9.5, x + w / 2 + (opt.dx ?? 0), y + (h - 62) / 2 + 12 + (opt.dy ?? 0)));
  g.push(T(x + 18, y + h - 44, label, { size: 16, weight: 700, fill: '#eaf0f6' }));
  g.push(T(x + 18, y + h - 24, sub, { size: 12.5, fill: '#8fa0b3' }));
  g.push(`<rect x="${x + w - 92}" y="${y + 20}" width="72" height="24" rx="6" fill="#1b2530" stroke="#2b3746"/>`);
  g.push(T(x + w - 56, y + 37, `az ${az}  el ${el}`, { size: 11, fill: '#7d8ea3', anchor: 'middle', mono: true }));
}

/* ------------------------------------------------------------------ *
 * navigation cube widget
 * ------------------------------------------------------------------ */
function navCube(g, cx, cy, s) {
  g.push(render([B(0, 0, 0, 1, 1, 1, '#2c3a4a')], 45, 30, s, cx, cy, [0.5, 0.5, 0.5]));
  const lab = (x, y, t) => g.push(T(x, y, t, { size: 12, weight: 800, fill: '#dbe6f2', anchor: 'middle', ls: 1.4 }));
  lab(cx, cy - s * 0.72, 'TOP');
  lab(cx - s * 0.86, cy + s * 0.3, 'FRONT');
  lab(cx + s * 0.86, cy + s * 0.26, 'RIGHT');
  g.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s * 1.5)}" fill="none" stroke="#2f7ef2" stroke-width="2" stroke-dasharray="7 6" opacity=".8"/>`);
  for (const a of [0, 90, 180, 270]) {
    const r = (a * Math.PI) / 180;
    g.push(`<circle cx="${n(cx + Math.cos(r) * s * 1.5)}" cy="${n(cy + Math.sin(r) * s * 1.5)}" r="5" fill="#2f7ef2"/>`);
  }
  g.push(`<path d="M${n(cx + s * 1.5 - 16)},${n(cy - 8)} a16,16 0 0 1 16,16" fill="none" stroke="#2f7ef2" stroke-width="3"/>`);
  g.push(T(cx, cy + s * 1.9, 'drag any face, edge or corner', { size: 11.5, fill: '#8fa0b3', anchor: 'middle' }));
}

/* =================================================================== *
 * 09  CAMERA AND VIEWS
 * =================================================================== */
export function artViews() {
  const W = 1600, H = 1240;
  const g = [];
  g.push(title(48, 62, 'CONCEPT 09 // CAMERA AND VIEWS',
    'Any angle, and the flat ones too',
    'Full 360° orbit like a CAD viewport, plus true orthographic elevations. The same station model, six ways of looking at it.'));

  const cw = 480, chh = 350, x0 = 48, y0 = 172, gapx = 16, gapy = 16;
  card(g, x0, y0, cw, chh, '1.  Isometric build view', 'the default: 2:1 dimetric, 45° yaw, 30° tilt', 45, 30);
  card(g, x0 + (cw + gapx), y0, cw, chh, '2.  Free orbit', 'drag to any custom yaw and tilt - 15° yaw, 18° tilt', 15, 18);
  card(g, x0 + 2 * (cw + gapx), y0, cw, chh, '3.  Plan / top', 'straight down: lay out the grid, read the flow', 0, 90, { s: 10.5, dy: 10 });

  card(g, x0, y0 + chh + gapy, cw, chh, '4.  Flat X-Z elevation', 'orthographic front view - the section, no perspective', 90, 0, { s: 12, dy: 8 });
  card(g, x0 + (cw + gapx), y0 + chh + gapy, cw, chh, '5.  Flat Y-Z elevation', 'orthographic side view - depth and level stacking', 0, 0, { s: 10.5, dy: 8 });
  card(g, x0 + 2 * (cw + gapx), y0 + chh + gapy, cw, chh, '6.  Nav cube + presets', 'keys 1-5 snap the view, O toggles ortho, F frames selection', 45, 30, { s: 6.5, dx: 118, dy: 4 });
  navCube(g, x0 + 2 * (cw + gapx) + 116, y0 + chh + gapy + 168, 46);

  /* ---- control legend ---- */
  const ly = y0 + 2 * chh + 2 * gapy + 6;
  g.push(`<rect x="48" y="${ly}" width="1504" height="184" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(72, ly + 34, 'VIEWPORT CONTROLS', { size: 14, weight: 800, fill: C.yellow, ls: 1.4 }));
  const ctrls = [
    ['MMB drag', 'orbit 360° - yaw and tilt, no limits'],
    ['Shift + MMB', 'pan the view'],
    ['wheel', 'zoom (dolly in ortho)'],
    ['Shift + wheel', 'change tilt only'],
    ['1 / 2 / 3', 'snap to iso / plan / last custom angle'],
    ['4 / 5', 'flat X-Z elevation / flat Y-Z elevation'],
    ['O', 'toggle orthographic <-> perspective'],
    ['F', 'frame the selection or the level'],
    ['Q / E', 'slice one level up / down'],
    ['X', 'x-ray: other levels become ghosts'],
    ['C', 'cutaway: hide the near quarter'],
    ['Space', 'pause / run the simulation'],
  ];
  ctrls.forEach(([k, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 72 + col * 500, y = ly + 66 + row * 26;
    g.push(`<rect x="${x}" y="${y - 15}" width="150" height="21" rx="5" fill="#0f1620" stroke="#243040"/>`);
    g.push(T(x + 8, y, k, { size: 11.5, fill: '#9fd7ee', mono: true, weight: 700 }));
    g.push(T(x + 160, y, v, { size: 12, fill: '#a9b8c8' }));
  });
  g.push(T(1072, ly + 66, 'WHY THIS MATTERS FOR A STATION BUILDER', { size: 12, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(MUL(1072, ly + 92, [
    'Orbit tells you whether the room feels right; the flat elevations tell you',
    'whether it works. Vertical circulation, headroom, level stacking and the',
    'depth of every shaft are only honest in the X-Z view - so a station builder',
    'needs both, on the same model, with no export step.',
  ], { size: 12, fill: '#a9b8c8', lh: 20 }));
  g.push(T(1072, ly + 172, 'Ortho view = the drawing. Perspective view = the place.', { size: 12, fill: '#7d8ea3' }));

  /* ---- a note on the renderer ---- */
  g.push(T(48, H - 22, 'All six cards are the same box list rendered with one orthographic projection: screen = f(azimuth, elevation, scale). The game uses the same maths, with the 2:1 ratio baked in for the build view.', { size: 12.5, fill: '#7d8ea3' }));
  return sheet(W, H, g.join(''));
}
