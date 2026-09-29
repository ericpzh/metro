// Concept sheet 01 - the isometric cutaway hero.
// Layout is planned on a strict 26 x 22 m grid with a single circulation void,
// and every object is checked against the floor plates it stands on.
import {
  C, PCOL, TW, TH, ZU, boxSvg, rboxSvg, quadSvg, faceSvg, Scene, px, py, P, pstr, poly,
  T, MUL, title, sheet, callout, rng, n, carDoorCenters, amT, dashFlow, mover, group,
} from './iso.mjs';

/* ------------------------------------------------------------------ *
 * plan (grid units are metres)
 *
 *   x 0..26   y 0..22      concourse at z = FZ
 *   void x 9..17  y 10..22  circulation opening down to the B2 platform
 *
 *   y 0..7.2     unpaid hall   (pavilion, TVMs, vending, retail, benches)
 *   y 7.2..9.3   fare line     (gate bank + glass screens)
 *   y 9.3..10    paid hall strip
 *   y 10..22     void, flanked by two paid walkways (x 0..9 and x 17..26)
 * ------------------------------------------------------------------ */
const FZ = 0.45, B2 = -2.9;
const NX = 26, NY = 22;
const V = { x0: 9, x1: 17, y0: 10, y1: 22 };
const TX = 700, TY = 214;

export function artHero() {
  const S = Scene();
  const rnd = rng(20260928);
  const R = (s) => S.raw(s);
  const person = (x, y, z, sp, col) =>
    `<use href="#${sp}" x="${n(px(x, y))}" y="${n(py(x, y, z))}" style="color:${col}"/>`;
  const PCOL2 = (r) => PCOL[(r() * PCOL.length) | 0];

  /* ================= B2 platform, seen through the void =================
     Painted in explicit order: long shapes must not fight the depth sort. */
  const T0 = B2 - 0.55;
  R(quadSvg(2, 10.4, T0, 24, 4.6, C.dark, { tone: 1.5, sw: 0.5 }));
  for (const ry of [11.2, 14.2]) R(boxSvg(2, ry, T0, 24, 0.55, 0.55, C.steel, { tone: 0.8 }));
  R(boxSvg(2, 10.7, T0 - 0.1, 24, 0.55, 0.8, C.psu, { tone: 0.85 }));
  /* Train and screen doors share ONE door cadence, so every PSD opening lands
   * under a car door. Same helper the platform-flow sheet uses. */
  const CARLEN = 6.2, CARGAP = 0.4, CARSTART = 1.4, NCARS = 4, DOORS = 3, DOORW = 1.45;
  const dRel = carDoorCenters(CARLEN, DOORS, DOORW);
  const carDoors = [];
  const trainCars = [];
  for (let i = 0; i < NCARS; i++) {
    const tx = CARSTART + i * (CARLEN + CARGAP);
    for (const o of dRel) carDoors.push(tx + CARLEN / 2 + o);
    trainCars.push(boxSvg(tx, 11.0, T0 + 0.55, CARLEN, 3.1, 3.7, '#d8dee6', { tone: 1.0 }));
    trainCars.push(boxSvg(tx, 11.0, T0 + 4.25, CARLEN, 3.1, 0.14, '#98a2ac', { tone: 1.0 }));
    trainCars.push(boxSvg(tx + 0.9, 11.5, T0 + 4.39, 1.7, 2.1, 0.3, '#8b949e', { tone: 1.0 }));
    trainCars.push(boxSvg(tx + 3.5, 11.5, T0 + 4.39, 1.2, 2.1, 0.22, '#8b949e', { tone: 1.0 }));
    trainCars.push(faceSvg('y', 14.12, tx + 0.45, tx + CARLEN - 0.45, T0 + 2.55, T0 + 3.55, '#22323f', { tone: 1.2, sw: 0.6 }));
    for (const o of dRel) {
      const dc = tx + CARLEN / 2 + o;
      trainCars.push(faceSvg('y', 14.14, dc - DOORW / 2, dc + DOORW / 2, T0 + 0.65, T0 + 3.3, '#2b3846', { tone: 1.05, sw: 0.5 }));
      trainCars.push(faceSvg('y', 14.16, dc - 0.03, dc + 0.03, T0 + 0.65, T0 + 3.3, '#0d1116', { tone: 1.0, sw: 0 }));
    }
    trainCars.push(faceSvg('y', 14.14, tx, tx + CARLEN, T0 + 0.5, T0 + 0.62, C.lineB, { tone: 1.1, sw: 0.4 }));
  }
  // the train arrives, dwells against the screen doors, then pulls out
  R(group(trainCars.join(''), amT('0 0;0 0;26 13;26 13;0 0;0 0', '0;0.22;0.5;0.68;0.86;1', '18s',
    '0.4 0 0.2 1;0 0 1 1;0 0 1 1;0.4 0 0.2 1;0 0 1 1')));
  // screen doors along the platform edge: an opening under every car door, with a
  // gap at x 12.9..17.9 where the escalators and stair cross the edge.
  const PSD_X0 = 2.4, PSD_X1 = 26.0;
  const openings = carDoors.filter((d) => d > PSD_X0 + 0.6 && d < PSD_X1 - 0.6 && !(d > 12.9 && d < 17.9));
  const psdSegs = [];
  let psdCur = PSD_X0;
  for (const d of openings) {
    if (d - DOORW / 2 > psdCur) psdSegs.push([psdCur, d - DOORW / 2]);
    psdCur = d + DOORW / 2;
  }
  if (psdCur < PSD_X1) psdSegs.push([psdCur, PSD_X1]);
  for (const [a, b] of psdSegs) {
    R(faceSvg('y', 15.5, a, b, T0 - 0.2, FZ - 0.15, C.glass, { tone: 1.34, opacity: 0.42, sw: 0.6 }));
    R(boxSvg(a, 15.42, T0 - 0.2, 0.22, 0.28, 4.2, C.steel, { tone: 1.0 }));
  }
  R(boxSvg(PSD_X0, 15.42, T0 - 0.2, 0.22, 0.28, 4.2, C.steel, { tone: 1.0 }));
  R(boxSvg(PSD_X0, 15.38, FZ - 1.05, PSD_X1 - PSD_X0, 0.34, 0.55, C.lineB, { tone: 1.05 }));
  R(boxSvg(PSD_X0, 15.38, FZ - 0.5, PSD_X1 - PSD_X0, 0.34, 0.18, C.safety, { tone: 1.05 }));
  R(boxSvg(PSD_X0, 15.38, T0 + 0.5, PSD_X1 - PSD_X0, 0.34, 0.5, C.safety, { tone: 0.95 }));
  R(boxSvg(PSD_X0, 15.38, T0 - 0.2, PSD_X1 - PSD_X0, 0.34, 0.3, C.steelD, { tone: 0.9 }));
  // platform surface
  R(quadSvg(2, 15.7, T0 + 0.3, 24, 6.3, C.floor, { tone: 1.0, sw: 0.5 }));
  R(quadSvg(2, 15.7, T0 + 0.34, 24, 1.15, C.maroon, { tone: 1.0, sw: 0.4 }));
  R(quadSvg(2, 16.85, T0 + 0.36, 24, 0.75, C.tactile, { tone: 1.0, sw: 0.4 }));
  R(quadSvg(2, 19.6, T0 + 0.36, 24, 0.4, C.floorInlay, { tone: 1.0, sw: 0.3, opacity: 0.5 }));
  const pw = [];
  for (let i = 0; i < 16; i++) pw.push([9.4 + rnd() * 3.4, 17.2 + rnd() * 4.2]);
  for (let i = 0; i < 5; i++) pw.push([17.4 + rnd() * 1.8, 17.2 + rnd() * 4.2]);
  pw.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  for (const [gx, gy] of pw) R(person(gx, gy, T0 + 0.34, rnd() > 0.6 ? 'personBag' : 'person', PCOL2(rnd)));

  /* ================= concourse floor plates ================= */
  const slab = (x, y, w, d, o = {}) => {
    S.bg.push(quadSvg(x, y, FZ, w, d, C.floor, { sw: 0.5 }));
    S.raw(boxSvg(x, y, FZ - 0.45, w, d, 0.45, C.slab, { sw: 0.7, ...o }));
  };
  slab(0, 0, V.x0, V.y0, { noRight: true, noFront: true });
  slab(V.x1, 0, NX - V.x1, NY);
  slab(V.x0, 0, V.x1 - V.x0, V.y0, { noRight: true });
  slab(0, V.y0, V.x0, NY - V.y0);
  // granite inlay bands, drawn only on the two walkways
  const inlay = (x, y, w, d) => S.bg.push(quadSvg(x, y, FZ + 0.02, w, d, C.floorInlay, { sw: 0.3, opacity: 0.45 }));
  inlay(0, 3.4, NX, 0.4); inlay(0, 6.0, NX, 0.4);
  inlay(1.4, 10.4, 0.4, 11.6); inlay(18.2, 10.4, 0.4, 11.6);

  /* ================= shell: walls, screens, lights ================= */
  const WH = 4.3;
  R(boxSvg(0, -0.5, FZ, NX, 0.5, WH, C.tile, { sw: 0.8 }));
  R(boxSvg(-0.5, -0.5, FZ, 0.5, NY + 0.5, WH, C.tile, { sw: 0.8, tone: 0.9 }));
  R(boxSvg(0, -0.5, FZ + WH, NX, 0.5, 0.35, C.ceil, { sw: 0.8 }));
  R(boxSvg(-0.5, -0.5, FZ + WH, 0.5, NY + 0.5, 0.35, C.ceil, { sw: 0.8, tone: 0.94 }));
  for (let i = 3.2; i < NX; i += 5.2) R(boxSvg(i, -0.5, FZ, 0.5, 0.62, WH, C.tile2, { sw: 0.8 }));
  // theming enamel panel on the left wall, with the station name set into it
  R(faceSvg('x', 0.02, 2.0, 12.0, FZ + 0.5, FZ + 3.35, C.lineA, { tone: 1.02, sw: 1 }));
  R(faceSvg('x', 0.015, 2.4, 11.6, FZ + 1.0, FZ + 2.85, C.lineA, { tone: 1.07, sw: 0.4 }));
  for (let yy = 3.0; yy < 12; yy += 1.0) R(faceSvg('x', 0.03, yy, yy + 0.035, FZ + 0.5, FZ + 3.35, C.ink, { tone: 1, sw: 0, opacity: 0.16 }));
  R(`<text transform="matrix(${TW},${-TH},0,${ZU},${n(px(0, 11.6))},${n(py(0, 11.6, FZ + 2.35))})" font-size="0.82" font-weight="800" fill="#1b2733" letter-spacing="0.06">五丝广场站</text>`);
  R(`<text transform="matrix(${TW},${-TH},0,${ZU},${n(px(0, 11.6))},${n(py(0, 11.6, FZ + 1.15))})" font-size="0.5" font-weight="600" fill="#1b2733" opacity="0.7" letter-spacing="0.08">地铁 1 号线 · 2 号线</text>`);
  // line-colour band along the top of both walls
  R(faceSvg('y', 0.03, 0, NX, FZ + WH - 0.85, FZ + WH - 0.35, C.lineA, { tone: 1.0, sw: 0.5 }));
  R(faceSvg('x', 0.03, 0, NY, FZ + WH - 0.85, FZ + WH - 0.35, C.lineA, { tone: 0.94, sw: 0.5 }));
  // wall-wash strip lights
  R(boxSvg(0, -0.42, FZ + WH - 0.58, NX, 0.4, 0.18, '#fff3cf', { sw: 0, opacity: 0.95 }));
  R(boxSvg(-0.42, 0, FZ + WH - 0.58, 0.4, NY, 0.18, '#fff3cf', { sw: 0, opacity: 0.95 }));
  for (let i = 2; i < NX; i += 4.4) {
    S.raw(`<ellipse cx="${n(px(i, 4))}" cy="${n(py(i, 4, FZ + 0.05))}" rx="66" ry="34" fill="#ffe9b0" opacity=".07" filter="url(#blur6)"/>`);
  }

  /* ================= fare line: gate bank + glass screens ================= */
  const GL = FZ + 2.4;
  R(faceSvg('y', 7.2, 0, 5.0, FZ, GL, C.glass, { tone: 1.3, opacity: 0.5, sw: 0.7 }));
  R(faceSvg('y', 7.2, 14.25, NX, FZ, GL, C.glass, { tone: 1.3, opacity: 0.5, sw: 0.7 }));
  R(boxSvg(0, 7.1, GL, 5.0, 0.3, 0.22, C.steel, { tone: 1.05 }));
  R(boxSvg(14.25, 7.1, GL, NX - 14.25, 0.3, 0.22, C.steel, { tone: 1.05 }));
  for (const gx of [0.1, 2.6, 5.0, 14.25, 19.8, 25.9]) R(boxSvg(gx, 7.05, FZ, 0.22, 0.4, GL - FZ, C.steel, { tone: 1.0 }));
  const gates = [];
  for (let i = 0; i < 5; i++) gates.push([5.0 + i * 1.35, 7.5, 1.15]);
  gates.push([12.5, 7.5, 1.75]);
  for (const [gx, gy, gw] of gates) {
    S.rbox(gx, gy + 0.35, FZ, gw, 1.4, 0.95, C.steel, { r: 0.12, tone: 1.0, top: 1.2 });
    S.rbox(gx - 0.03, gy, FZ, gw + 0.06, 0.42, 1.05, C.steel, { r: 0.14, tone: 0.98 });
    S.rbox(gx - 0.03, gy + 1.68, FZ, gw + 0.06, 0.42, 1.05, C.steel, { r: 0.14, tone: 0.98 });
    S.box(gx + 0.06, gy + 1.62, FZ + 1.05, gw - 0.12, 0.5, 0.1, gw > 1.5 ? C.blue : C.green, { tone: 1.25 });
    S.box(gx + 0.06, gy + 0.3, FZ + 1.05, gw - 0.12, 0.5, 0.1, gw > 1.5 ? C.blue : C.green, { tone: 1.25 });
  }

  /* ================= unpaid hall: service + retail ================= */
  // surface entrance pavilion, back-left corner, clear of everything
  const pv = { x: 0.7, y: -0.4, w: 5.4, d: 5.2, h: 5.0 };
  S.box(pv.x, pv.y, FZ, pv.w, pv.d, pv.h, C.white, { tone: 1.02 });
  S.box(pv.x - 0.3, pv.y - 0.3, FZ + pv.h, pv.w + 0.6, pv.d + 0.6, 0.5, C.lineA, { tone: 1.05 });
  S.face('y', pv.y + pv.d, pv.x + 0.4, pv.x + 5.0, FZ + 2.7, FZ + 4.3, '#18324d', { tone: 1.2, sw: 0.9 });
  S.face('y', pv.y + pv.d + 0.02, pv.x + 0.4, pv.x + 5.0, FZ + 0.15, FZ + 2.5, C.glass, { tone: 1.2, opacity: 0.92 });
  S.face('x', pv.x + pv.w, pv.y + 0.4, pv.y + 4.8, FZ + 2.7, FZ + 4.3, '#18324d', { tone: 1.0, sw: 0.9 });
  S.face('x', pv.x + pv.w + 0.02, pv.y + 0.4, pv.y + 4.8, FZ + 0.15, FZ + 2.5, C.glass, { tone: 1.0, opacity: 0.92 });
  S.box(pv.x + 1.5, pv.y + pv.d, FZ + 3.5, 2.4, 1.6, 0.25, C.glass, { tone: 1.25, opacity: 0.85 });
  // ticket machines against the back wall
  for (let i = 0; i < 4; i++) {
    const mx = 3.0 + i * 1.25;
    S.rbox(mx, 0.5, FZ, 1.05, 1.0, 2.0, C.blueD, { r: 0.16, tone: 1.02 });
    S.face('y', 1.51, mx + 0.2, mx + 0.86, FZ + 1.15, FZ + 1.85, C.glass, { tone: 1.35, sw: 0.5 });
    S.face('y', 1.51, mx + 0.2, mx + 0.86, FZ + 0.55, FZ + 1.0, '#dbe6f2', { tone: 1.1, sw: 0.5 });
  }
  // ad lightboxes on the back wall (above machine height)
  for (const ax of [9.5, 14.2]) {
    S.face('y', 0.03, ax, ax + 3.6, FZ + 1.3, FZ + 3.5, '#39c0ff', { tone: 1.0, sw: 1 });
    S.face('y', 0.02, ax + 0.25, ax + 1.8, FZ + 1.65, FZ + 3.15, '#ffe9a8', { tone: 1.1, sw: 0.4 });
    S.face('y', 0.02, ax + 2.1, ax + 3.0, FZ + 1.7, FZ + 3.1, '#ff6fae', { tone: 1.05, sw: 0.4 });
  }
  // vending machines
  ['#d0342c', '#e85c8a', '#17a89a'].forEach((col, i) => {
    const mx = 18.4 + i * 1.2;
    S.rbox(mx, 0.5, FZ, 1.0, 0.95, 1.95, col, { r: 0.16, tone: 1.02 });
    S.face('y', 1.46, mx + 0.14, mx + 0.86, FZ + 1.0, FZ + 1.8, C.glass, { tone: 1.4, sw: 0.5 });
  });
  // retail unit, unpaid side, right of the gates. Roof removed.
  const st = { x: 20.0, y: 1.6, w: 5.8, d: 5.2, h: 3.1 };
  S.box(st.x, st.y, FZ, 0.26, st.d, st.h, C.tile2, { tone: 1.02 });
  S.box(st.x, st.y, FZ, st.w, 0.26, st.h, C.tile2, { tone: 1.0 });
  S.box(st.x + st.w - 0.26, st.y, FZ, 0.26, st.d, st.h, C.tile2, { tone: 1.06 });
  S.box(st.x, st.y + st.d - 0.26, FZ, st.w, 0.26, st.h, C.tile2, { tone: 0.96 });
  S.box(st.x - 0.15, st.y + 0.6, FZ + st.h, st.w + 0.3, 2.6, 0.8, C.red, { tone: 1.08 });
  for (let i = 0; i < 2; i++) {
    const sy = st.y + 1.5 + i * 1.7;
    S.box(st.x + 0.7, sy, FZ, 3.6, 0.6, 1.4, C.steel, { tone: 0.95 });
    for (let j = 0; j < 6; j++) {
      S.box(st.x + 0.85 + j * 0.58, sy + 0.08, FZ + 1.4, 0.46, 0.44, 0.42,
        [C.orange, C.teal, C.pink, C.yellow, C.blue, C.green][(rnd() * 6) | 0], { tone: 1.0, sw: 0.5 });
    }
  }
  S.box(st.x + 3.9, st.y + 4.2, FZ, 1.6, 0.9, 1.0, C.dark, { tone: 1.0 });
  // benches + totem, all clear of the gate bank
  for (const [bx, by] of [[2.2, 3.5], [15.0, 4.6]]) {
    S.rbox(bx, by, FZ + 0.12, 0.85, 3.2, 0.24, C.wood, { r: 0.07, tone: 1.06 });
    S.rbox(bx + 0.05, by + 0.15, FZ, 0.75, 2.9, 0.14, C.steelD, { r: 0.07, tone: 0.95 });
  }
  S.rbox(12.5, 4.0, FZ, 0.8, 0.8, 2.8, C.dark, { r: 0.2, tone: 1.0 });
  S.face('y', 4.81, 12.6, 13.2, FZ + 1.0, FZ + 2.5, C.teal, { tone: 1.12, sw: 0.5 });
  S.face('x', 13.31, 4.1, 4.7, FZ + 1.0, FZ + 2.5, C.blue, { tone: 1.0, sw: 0.5 });

  /* ================= paid side: kiosk, lift, columns ================= */
  S.box(1.0, 12.5, FZ, 3.6, 2.6, 2.3, C.wood, { tone: 1.02 });
  S.box(0.65, 12.15, FZ + 2.3, 4.3, 3.3, 0.28, C.red, { tone: 1.1 });
  S.face('y', 15.11, 1.2, 4.4, FZ + 0.85, FZ + 1.5, '#f6efe4', { tone: 1.05, sw: 0.5 });
  const lf = { x: 3.6, y: 16.6, w: 2.5, d: 2.5 };
  S.rbox(lf.x, lf.y, B2 - 0.5, lf.w, lf.d, FZ - B2 + 4.3, C.glass, { r: 0.3, tone: 1.25, opacity: 0.92 });
  S.rbox(lf.x + 0.95, lf.y + 0.95, B2 - 0.45, 0.6, 0.6, FZ - B2 + 4.2, C.steelD, { r: 0.2, tone: 1.0 });
  S.rbox(lf.x - 0.12, lf.y - 0.12, FZ + 4.3, lf.w + 0.24, lf.d + 0.24, 0.28, C.steel, { r: 0.24, tone: 1.05 });
  // columns: every one verified to stand fully on a floor plate
  for (const [cx, cy] of [[7.5, 3.2], [11.0, 3.2], [16.8, 3.2], [18.6, 4.0], [16.5, 8.8],
    [6.5, 13.0], [6.5, 20.0], [18.0, 13.0], [18.0, 20.0], [24.0, 13.0]]) {
    S.rbox(cx, cy, FZ + 0.18, 0.78, 0.78, WH - 0.5, C.steel, { r: 0.16, tone: 1.0, top: 1.18 });
    S.rbox(cx - 0.05, cy - 0.05, FZ, 0.88, 0.88, 0.2, C.dark, { r: 0.18, tone: 1.0 });
  }

  /* ================= guidance: short, and routed on clear floor ================= */
  const walk = (pts, col, w) => `<path d="M${pts.map(([x, y]) => `${n(px(x, y))},${n(py(x, y, FZ + 0.03))}`).join(' L')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`;
  const walkPath = (pts) => `M${pts.map(([x, y]) => `${n(px(x, y))},${n(py(x, y, FZ + 0.03))}`).join(' L')}`;
  // a passenger actually walks the guidance route, from one end to the other
  const route = (pts, col, begin, o = {}) => {
    const k = pts.reduce((a, [x, y]) => a + x + y, 0) / pts.length;
    S.fg.push([k, mover(walkPath(pts), col, begin, { sprite: 'person', dur: '9s', ...o })]);
  };
  S.raw(walk([[3.3, 5.0], [3.3, 2.6], [4.6, 1.9]], C.yellow, 6));                 // entrance -> TVMs
  S.raw(walk([[6.6, 1.9], [6.6, 4.2], [7.0, 6.9]], C.yellow, 6));                 // TVMs -> gates
  S.raw(walk([[8.4, 9.6], [14.6, 9.6]], C.yellow, 6));                            // gates -> circulation
  S.raw(walk([[8.2, 10.6], [8.2, 21.0]], C.yellow, 5));                           // paid walkway, west
  S.raw(walk([[17.8, 10.6], [17.8, 21.0]], C.yellow, 5));                         // paid walkway, east
  S.raw(walk([[20.0, 7.0], [15.2, 7.0], [13.6, 7.3]], C.yellow, 5));              // retail -> gates
  route([[3.3, 5.0], [3.3, 2.6], [4.6, 1.9]], PCOL[3], '0s');
  route([[6.6, 1.9], [6.6, 4.2], [7.0, 6.9]], PCOL[1], '2.2s');
  route([[8.4, 9.6], [14.6, 9.6]], PCOL[5], '1.1s');
  route([[8.2, 10.6], [8.2, 21.0]], PCOL[0], '0.6s');
  route([[17.8, 10.6], [17.8, 21.0]], PCOL[4], '3.3s');
  route([[20.0, 7.0], [15.2, 7.0], [13.6, 7.3]], PCOL[6], '2.8s');
  S.raw(quadSvg(4.6, 2.4, FZ + 0.03, 2.6, 2.6, C.blue, { tone: 1.1, sw: 0.7 }));
  S.raw(quadSvg(5.2, 3.0, FZ + 0.04, 1.4, 1.4, C.white, { tone: 1.0, sw: 0.5 }));
  S.raw(quadSvg(18.4, 8.6, FZ + 0.03, 2.2, 2.2, C.green, { tone: 1.15, sw: 0.7 }));

  /* ================= circulation down to B2 ================= */
  const run = (x, w, yTop, yBot) => {
    S.ramp(x, yTop, FZ, w, yBot - yTop, B2 + 0.1, C.steelD, { tone: 1.0, truss: 0.85 });
    for (const bx of [x - 0.18, x + w - 0.14]) {
      S.handrailY(bx, yTop, FZ, yBot, B2 + 0.1, 1.0, { panel: C.glass, panelTone: 1.3, capCol: C.dark });
    }
    // the escalator tread runs: dashes march down the incline
    const c0 = P(x + w / 2, yTop + 0.4, FZ - 0.06), c1 = P(x + w / 2, yBot - 0.4, B2 + 0.16);
    S.fg.push([80, `<path d="M${n(c0[0])},${n(c0[1])} L${n(c1[0])},${n(c1[1])}" stroke="#0d1116" stroke-width="4" stroke-dasharray="10 14" opacity="0.3" fill="none" ${dashFlow(24, '1.5s')}/>`]);
  };
  run(13.2, 1.2, 10.0, 16.2);
  run(14.5, 1.2, 10.0, 16.2);
  for (let i = 0; i < 10; i++) {
    S.rbox(15.8, 10.0 + i * 0.6, FZ - (i + 1) * 0.33, 1.2, 0.6, 0.33, C.concrete, { r: 0.06, tone: 1.0 });
  }
  {
    const c0 = P(16.4, 10.3, FZ - 0.2), c1 = P(16.4, 15.9, B2 + 0.12);
    S.fg.push([80, `<path d="M${n(c0[0])},${n(c0[1])} L${n(c1[0])},${n(c1[1])}" stroke="#0d1116" stroke-width="4" stroke-dasharray="9 12" opacity="0.28" fill="none" ${dashFlow(21, '1.6s')}/>`]);
  }
  S.handrailY(15.74, 10.0, FZ + 0.05, 16.0, B2 + 0.05, 0.95, { panel: C.glass, panelTone: 1.25, capCol: C.dark });
  S.handrailY(17.06, 10.0, FZ + 0.05, 16.0, B2 + 0.05, 0.95, { panel: C.glass, panelTone: 1.25, capCol: C.dark });

  /* ================= crowd ================= */
  const inVoid = (x, y) => x > V.x0 - 0.6 && x < V.x1 + 0.6 && y > V.y0 - 0.6;
  const clear = (x, y) => {
    if (inVoid(x, y)) return false;
    if (x > st.x - 0.5 && x < st.x + st.w + 0.5 && y > st.y - 0.5 && y < st.y + st.d + 0.5) return false;
    if (x > pv.x - 0.5 && x < pv.x + pv.w + 0.5 && y < pv.y + pv.d + 0.5) return false;
    if (x > 0.8 && x < 4.8 && y > 12.3 && y < 15.3) return false;                 // kiosk
    if (x > 3.4 && x < 6.3 && y > 16.4 && y < 19.3) return false;                 // lift
    if (x > 2.9 && x < 8.3 && y > 0.3 && y < 1.7) return false;                   // TVMs
    if (x > 18.2 && x < 21.9 && y > 0.3 && y < 1.7) return false;                 // vending
    if (x > 2.0 && x < 3.3 && y > 3.3 && y < 6.9) return false;                   // bench
    if (x > 14.8 && x < 16.1 && y > 4.4 && y < 8.0) return false;                 // bench
    if (x > 12.3 && x < 13.5 && y > 3.8 && y < 5.0) return false;                 // totem
    if (y > 7.1 && y < 9.4 && x > 4.8 && x < 14.3) return false;                  // gate bank
    for (const [cx, cy] of [[7.5, 3.2], [11.0, 3.2], [16.8, 3.2], [18.6, 4.0], [16.5, 8.8],
      [6.5, 13.0], [6.5, 20.0], [18.0, 13.0], [18.0, 20.0], [24.0, 13.0]]) {
      if (x > cx - 0.5 && x < cx + 1.3 && y > cy - 0.5 && y < cy + 1.3) return false;
    }
    return true;
  };
  // gate queue (unpaid side)
  for (let i = 0; i < 20; i++) {
    const gx = 4.6 + rnd() * 9.6, gy = 5.4 + rnd() * 1.5;
    if (clear(gx, gy)) S.sprite(gx, gy, FZ, 'person', { color: PCOL2(rnd) });
  }
  // unpaid hall wanderers
  for (let i = 0; i < 26; i++) {
    const gx = 0.8 + rnd() * 25, gy = 1.0 + rnd() * 6.2;
    if (clear(gx, gy)) S.sprite(gx, gy, FZ, rnd() > 0.85 ? 'personSeat' : 'person', { color: PCOL2(rnd), bias: -0.6 });
  }
  // paid hall strip + the two walkways beside the void
  for (let i = 0; i < 40; i++) {
    const gx = 0.8 + rnd() * 25, gy = 9.4 + rnd() * 11.6;
    if (clear(gx, gy)) S.sprite(gx, gy, FZ, 'person', { color: PCOL2(rnd), bias: -0.6 });
  }

  /* ================= callouts ================= */
  const A = [];
  const sc = (x, y, z) => [px(x, y) + TX, py(x, y, z) + TY];
  const co = (x, y, z, lx, ly, num) => {
    const [ax, ay] = sc(x, y, z);
    callout(A, ax, ay, lx, ly, num, null);
  };
  co(9.6, 8.4, FZ + 1.1, 520, 1046, 1);
  co(5.4, 1.2, FZ + 1.6, 250, 690, 2);
  co(22.9, 4.2, FZ + 3.5, 1400, 520, 3);
  co(11.0, 19.5, T0 + 0.9, 700, 1082, 4);
  co(14.6, 13.5, B2 + 1.5, 962, 946, 5);
  co(3.4, 2.4, FZ + 5.3, 210, 190, 6);
  co(12.9, 4.6, FZ + 2.6, 1370, 300, 7);
  co(12.6, 9.7, FZ, 430, 950, 8);
  co(4.8, 17.9, FZ + 3.2, 230, 830, 9);
  const items = [
    [C.yellow, '1  闸机 + 玻璃隔断：进付费区唯一的正门'],
    [C.blue, '2  自动售票机、地贴指引、导向标识'],
    [C.red, '3  商铺：开在非付费区，屋顶已摘掉'],
    [C.lineB, '4  B2 站台：屏蔽门、第三轨、B 型列车'],
    [C.asc, '5  同一个竖井里的上下扶梯和楼梯'],
    [C.white, '6  地面出入口（两个出口，流量都能调）'],
    [C.pink, '7  数字广告屏 + 墙面灯箱'],
    [C.green, '8  盲道带 + 闸机前排队用的通道'],
    [C.teal, '9  电梯：每一层都能无障碍到达'],
  ];
  const lg = items.map(([col, txt], i) => {
    const cx = 60 + (i % 2) * 700, cy = 1000 + Math.floor(i / 2) * 30;
    return `<rect x="${cx}" y="${cy - 12}" width="14" height="14" rx="3.5" fill="${col}"/>` + T(cx + 26, cy, txt, { size: 14, fill: '#c3d0de' });
  }).join('');
  // legibility panel behind the legend: the cutaway runs to the bottom edge
  const legendBg = `<rect x="40" y="978" width="1520" height="150" rx="12" fill="#0b0f16" opacity="0.87"/>`;

  const body = `<g transform="translate(${TX},${TY})">
    <ellipse cx="${n(px(13, 11))}" cy="${n(py(13, 11, -1.6))}" rx="800" ry="360" fill="#000" opacity=".35" filter="url(#soft)"/>
    ${S.out()}
  </g>${legendBg}${A.join('')}${lg}`
    + title(48, 62, '概念 01 // 等轴测剖视图', '地铁车站设计师',
      'B1 站厅摘了顶板，顺着竖井往下，能看见 B2 站台。1 格 = 1 米。');
  return sheet(1600, 1180, body, { glow: true });
}
