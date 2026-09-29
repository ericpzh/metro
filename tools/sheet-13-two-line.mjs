// Concept sheet 13 - the two-line interchange in isometric, one line over the
// street on a viaduct and one under it in a box, with the whole transfer stack
// between them. This is concept 02 (the vertical section) turned into a volume.
import {
  C, TW, TH, ZU, P, px, py, n, shade, poly, faceSvg, boxSvg, rboxSvg, quadSvg,
  Scene, title, sheet, legend, callout, leader, T, MUL, rng, pstr,
} from './iso.mjs';
import { isoCar, isoTrack, catenary } from './train-iso.mjs';

/* world plan, metres. z = 0 is the street.
 *   Line 1  viaduct   deck top +11.6   runs along x, over the back footway
 *   Line 2  box       platform -13.0   runs along x, under the street
 *   concourse B1 -5.5, station roof slab at 0, excavation open on +x / +y   */
const K = 0.40, CX = 560, CY = 650;
const OX = CX - px(18, 9) * K;
const OY = CY - py(18, 9, -1) * K;
const AT = (x, y, z) => [OX + px(x, y) * K, OY + py(x, y, z) * K];

export function artTwoLine() {
  const W = 1600, H = 1180;
  const g = [];
  g.push(title(48, 62, 'CONCEPT 13 // TWO LINES, TWO DEPTHS',
    'One line over the street, one under it',
    'The same interchange as concept 02, drawn as a volume. Everything the player builds sits in one of these two boxes, and the transfer between them is a real walk.'));
  const OV = [];
  const S = Scene();

  /* ---------------- excavation and street ---------------- */
  S.raw(boxSvg(-8, -8, -18, 12, 34, 18, C.soil, { tone: 1.0, sw: 0.8 }));      // left mass
  S.raw(boxSvg(4, -8, -18, 40, 10, 18, C.soil, { tone: 0.92, sw: 0.8 }));      // back mass
  S.raw(boxSvg(4, 2, -18.5, 40, 24, 0.6, C.soil2, { tone: 1.0, sw: 0.6 }));    // pit floor
  // strata on the two exposed cut faces
  for (const [zz, col] of [[-3.4, C.soil2], [-9.2, C.soil2], [-15.0, C.soil2]]) {
    S.raw(faceSvg('y', 2.02, 4, 44, zz, zz + 0.9, col, { tone: 1.0, sw: 0 }));
    S.raw(faceSvg('x', 4.02, 2, 26, zz, zz + 0.9, col, { tone: 0.94, sw: 0 }));
  }
  // street surface, outside the excavation only
  S.raw(boxSvg(-8, -8, -0.5, 12, 34, 0.5, C.concrete, { tone: 1.0, sw: 0.6 }));
  S.raw(boxSvg(4, -8, -0.5, 40, 10, 0.5, C.concrete, { tone: 0.95, sw: 0.6 }));
  S.raw(quadSvg(-8, -8, 0.02, 12, 34, C.floorAlt, { tone: 1.0, sw: 0 }));
  S.raw(quadSvg(4, -8, 0.02, 40, 10, C.floorAlt, { tone: 0.97, sw: 0 }));

  /* ---------------- Line 2, the underground box ---------------- */
  const zP = -13.0;                                       // platform surface
  const zR = -14.12;                                      // rail top
  S.raw(boxSvg(4, 2, zP - 0.7, 40, 16, 0.7, C.slab, { tone: 1.0, sw: 0.6 }));  // B2 slab
  S.raw(quadSvg(4, 2, zP + 0.02, 40, 16, C.floor, { tone: 1.0, sw: 0.5 }));
  S.raw(quadSvg(4, 5.6, zP + 0.04, 40, 5.6, C.floorAlt, { tone: 1.0, sw: 0.4 }));
  for (const py0 of [5.6, 11.2]) {
    S.raw(quadSvg(4, py0, zP + 0.06, 40, 1.0, C.tactile, { tone: 1.0, sw: 0.3 }));
    S.raw(quadSvg(4, py0 + 1.0, zP + 0.06, 40, 0.3, C.maroon, { tone: 1.0, sw: 0.3 }));
    S.raw(quadSvg(4, py0 - 1.3, zP + 0.06, 40, 1.0, C.tactile, { tone: 1.0, sw: 0.3 }));
    S.raw(quadSvg(4, py0 - 1.6, zP + 0.06, 40, 0.3, C.maroon, { tone: 1.0, sw: 0.3 }));
  }
  isoTrack(S, { x: 4, y: 2.4, z: zR - 0.18, len: 40, w: 3.2, third: true });
  isoTrack(S, { x: 4, y: 11.2, z: zR - 0.18, len: 40, w: 3.2, third: true });
  // station side wall (the far one) + the back wall
  S.fg.push([26 + 2.5 + (-9.25) * 0.9, boxSvg(4, 2, -16.6, 0.5, 16, 13.4, C.tile, { tone: 0.94 })]);
  S.fg.push([24 + 2.25 + (-9.25) * 0.9, boxSvg(4, 2, -16.6, 40, 0.5, 13.4, C.tile, { tone: 0.9 })]);
  // trains on both roads
  for (const [ty, col] of [[2.4, C.lineB], [11.4, C.lineB]]) {
    for (let c = 0; c < 2; c++) {
      isoCar(S, {
        x: 4.5 + c * 19.9, y: ty, z: zP - 0.18, len: 19.5, w: 2.8, h: 3.8, col: '#eef2f6',
        doors: 4, doorW: 1.3, cab: c === 0, stripe: col, dest: c === 0, destText: '五丝广场',
        roofCol: '#dfe4ea', winCol: '#20303e', shoe: true, tone: 0.98,
      });
    }
  }
  // platform crowd
  const rr = rng(31);
  for (let i = 0; i < 26; i++) {
    const gx = 5 + rr() * 38, gy = 6.4 + rr() * 4.4;
    S.sprite(gx, gy, zP + 0.04, rr() > 0.85 ? 'personBag' : 'person',
      { color: [C.red, C.blue, C.teal, C.purple, C.orange, C.pink][(rr() * 6) | 0] });
  }

  /* ---------------- B1 concourse ---------------- */
  const zC = -5.5;
  S.raw(boxSvg(4, 2, zC - 0.7, 40, 16, 0.7, C.slab, { tone: 0.96, sw: 0.6 }));
  S.raw(quadSvg(4, 2, zC + 0.02, 40, 5.0, C.floor, { tone: 1.0, sw: 0.4 }));      // back strip
  S.raw(quadSvg(20, 7, zC + 0.02, 24, 11.0, C.floor, { tone: 1.0, sw: 0.4 }));    // east block
  S.raw(quadSvg(4, 7, zC + 0.02, 4, 11.0, C.floor, { tone: 0.97, sw: 0.4 }));     // west block
  S.raw(quadSvg(4, 2, zC + 0.05, 40, 0.35, C.floorInlay, { tone: 1.0, sw: 0, opacity: 0.5 }));
  S.raw(quadSvg(4, 11.9, zC + 0.05, 40, 0.35, C.floorInlay, { tone: 1.0, sw: 0, opacity: 0.5 }));
  // gate bank across the east block
  for (let i = 0; i < 6; i++) {
    const gx = 24 + i * 1.35;
    S.rbox(gx, 12.2, zC, 1.15, 1.4, 0.95, C.steel, { r: 0.12, tone: 1.0, top: 1.2 });
    S.rbox(gx - 0.03, 11.9, zC, 1.21, 0.42, 1.05, C.steel, { r: 0.14, tone: 0.98 });
    S.rbox(gx - 0.03, 13.5, zC, 1.21, 0.42, 1.05, C.steel, { r: 0.14, tone: 0.98 });
    S.box(gx + 0.06, 13.44, zC + 1.05, 1.03, 0.5, 0.1, C.green, { tone: 1.25 });
    S.box(gx + 0.06, 12.1, zC + 1.05, 1.03, 0.5, 0.1, C.green, { tone: 1.25 });
  }
  S.rbox(22.0, 12.0, zC, 1.7, 1.8, 1.0, C.steel, { r: 0.14, tone: 1.02 });
  S.box(22.05, 13.6, zC + 1.1, 1.6, 0.5, 0.1, C.blue, { tone: 1.25 });
  // concourse columns, kept off the escalator well
  for (const [cx0, cy0] of [[24, 8.6], [32, 8.6], [40, 8.6], [24, 16.4], [32, 16.4], [40, 16.4], [6, 8.6], [6, 16.4], [14, 3.6], [30, 3.6]]) {
    S.rbox(cx0, cy0, zC + 0.1, 0.78, 0.78, 5.4, C.steel, { r: 0.16, tone: 1.0, top: 1.18 });
    S.rbox(cx0 - 0.05, cy0 - 0.05, zC, 0.88, 0.88, 0.2, C.dark, { r: 0.18, tone: 1.0 });
  }
  // concourse crowd
  for (let i = 0; i < 30; i++) {
    const gx = 4.6 + rr() * 38, gy = 8 + rr() * 9;
    if (gx > 20 && gx < 24 && gy > 12) continue;
    S.sprite(gx, gy, zC + 0.03, 'person', { color: [C.red, C.blue, C.teal, C.purple, C.orange, C.pink, C.green][(rr() * 7) | 0], bias: -0.4 });
  }

  /* ---------------- station roof / street slab over the box ---------------- */
  S.raw(boxSvg(4, 2, -0.5, 40, 4.0, 0.5, C.concrete, { tone: 1.02, sw: 0.6 }));
  S.raw(quadSvg(4, 2, 0.02, 40, 4.0, C.floorAlt, { tone: 1.0, sw: 0 }));
  S.raw(boxSvg(38, 6, -0.5, 6, 12, 0.5, C.concrete, { tone: 1.0, sw: 0.6 }));
  S.raw(quadSvg(38, 6, 0.02, 6, 12, C.floorAlt, { tone: 0.98, sw: 0 }));

  /* ---------------- vertical circulation ---------------- */
  // B2 -> B1, two escalators and a stair in one well
  const esc = (x0, z0, x1, z1, y, w, col) => {
    S.deck(x0, y, z0, x1, w, z1, col ?? C.steelD, { truss: 0.55, tone: 1.0 });
    S.handrailX(y - 0.02, x0, z0, x1, z1, 0.95, { panel: C.glass, panelTone: 1.28, capCol: C.dark });
    S.handrailX(y + w + 0.02, x0, z0, x1, z1, 0.95, { panel: C.glass, panelTone: 1.28, capCol: C.dark });
  };
  esc(8, zP, 20, zC, 6.4, 1.2);
  esc(8, zP, 20, zC, 7.8, 1.2);
  for (let i = 0; i < 16; i++) {
    S.rbox(8 + i * 0.75, 9.3, zP + i * 0.47, 0.75, 1.2, 0.47, C.concrete, { r: 0.06, tone: 1.0 });
  }
  S.handrailX(9.28, 8, zP, 20, zC, 0.9, { panel: C.glass, panelTone: 1.24, capCol: C.dark });
  S.handrailX(10.52, 8, zP, 20, zC, 0.9, { panel: C.glass, panelTone: 1.24, capCol: C.dark });
  // B1 -> street, one run emerging under the roof strip
  esc(20, zC, 32, -0.4, 3.0, 1.3);
  // street -> viaduct platform, two flights with a landing
  esc(18, 11.6, 27, 6.2, 2.3, 1.3);
  esc(29, 6.2, 38, 0.4, 2.3, 1.3);
  S.fg.push([27.5 + 2.9 + 3.3 * 0.9, boxSvg(27, 2.3, 6.0, 2.2, 1.6, 0.35, C.steel, { tone: 1.05 })]);

  /* ---------------- entrance head house ---------------- */
  S.box(9, -7.0, 0, 8.0, 8.0, 4.4, C.white, { tone: 1.02 });
  S.box(8.7, -7.3, 4.4, 8.6, 8.6, 0.5, C.lineA, { tone: 1.05 });
  S.face('y', 1.02, 9.5, 16.5, 0.3, 3.2, C.glass, { tone: 1.2, opacity: 0.9 });
  S.face('y', 1.02, 9.5, 16.5, 3.3, 4.2, '#18324d', { tone: 1.2, sw: 0.8 });
  S.face('x', 17.02, -6.5, -0.2, 0.3, 3.2, C.glass, { tone: 1.05, opacity: 0.9 });
  S.box(9.5, 1.0, 3.4, 3.0, 1.6, 0.3, C.glass, { tone: 1.25, opacity: 0.85 });

  /* ---------------- Line 1 viaduct ---------------- */
  const zD = 10.4;                                        // deck soffit
  // piers: two per bent, standing on the street slab
  for (const bx of [6, 20, 34, 46]) {
    for (const by of [-5.4, -1.4]) {
      S.rbox(bx, by, 0, 1.3, 1.3, zD, C.concrete, { r: 0.2, tone: 1.0 });
      S.rbox(bx - 0.15, by - 0.15, zD - 0.5, 1.6, 1.6, 0.6, C.concreteD, { r: 0.2, tone: 1.0 });
      S.rbox(bx - 0.2, by - 0.2, 0, 1.7, 1.7, 0.4, C.concreteD, { r: 0.2, tone: 1.0 });
    }
  }
  // deck
  S.box(-2, -7.4, zD, 50, 8.6, 1.2, C.concrete, { tone: 1.0 });
  S.box(-2, -7.4, zD + 1.2, 50, 0.35, 0.75, C.concreteD, { tone: 0.98 });
  S.box(-2, 0.85, zD + 1.2, 50, 0.35, 0.75, C.concreteD, { tone: 0.98 });
  isoTrack(S, { x: -2, y: -7.0, z: zD + 1.2, len: 50, w: 3.2, third: false });
  catenary(S, { x: -2, y: -5.4, z: zD + 1.2, len: 50 });
  // viaduct platform, on the near side of the deck
  S.raw(quadSvg(-2, -3.4, zD + 1.22, 50, 4.4, C.floor, { tone: 1.0, sw: 0.5 }));
  S.raw(quadSvg(-2, -3.4, zD + 1.24, 50, 0.9, C.tactile, { tone: 1.0, sw: 0.3 }));
  S.raw(quadSvg(-2, -2.5, zD + 1.24, 50, 0.3, C.maroon, { tone: 1.0, sw: 0.3 }));
  // canopy
  for (const bx of [4, 14, 24, 34, 44]) {
    S.rbox(bx, -3.2, zD + 1.2, 0.5, 0.5, 3.6, C.steel, { r: 0.12, tone: 1.0 });
    S.rbox(bx, 0.6, zD + 1.2, 0.5, 0.5, 3.6, C.steel, { r: 0.12, tone: 1.0 });
  }
  S.box(-2, -4.0, zD + 4.8, 50, 5.6, 0.4, C.panel, { tone: 1.05 });
  S.box(-2, -4.0, zD + 4.5, 50, 5.6, 0.3, C.ceilBaffle, { tone: 0.95 });
  // a train on the viaduct
  for (let c = 0; c < 2; c++) {
    isoCar(S, {
      x: 2 + c * 22.6, y: -7.0, z: zD + 1.2 + 0.92, len: 22.0, w: 3.0, h: 3.8, col: '#eef2f6',
      doors: 5, doorW: 1.4, cab: c === 0, stripe: C.lineA, dest: c === 0, destText: '广州南站',
      roofCol: '#dfe4ea', winCol: '#20303e', panto: true, tone: 1.0,
    });
  }
  for (let i = 0; i < 14; i++) {
    const gx = 2 + rr() * 44, gy = -3.0 + rr() * 3.6;
    S.sprite(gx, gy, zD + 1.22, 'person', { color: [C.red, C.blue, C.teal, C.purple, C.orange, C.pink][(rr() * 6) | 0] });
  }

  /* ---------------- callouts + annotation column ---------------- */
  const list = [];
  const co = (p, lx, ly, num) => {
    const [ax, ay] = AT(p[0], p[1], p[2]);
    callout(list, ax, ay, lx, ly, num, null);
  };
  co([26, -5.4, zD + 5.4], 300, 150, 1);
  co([10, -5.2, zD + 1.5], 210, 296, 2);
  co([30, 8.5, zC + 1.2], 500, 470, 3);
  co([14, 8.0, zP + 0.6], 300, 760, 4);
  co([14, 3.2, zC + 0.2], 690, 690, 5);
  co([24, 3.6, -0.1], 420, 350, 6);
  co([13, -3.0, 2.2], 176, 452, 7);
  co([12, 5.0, zP - 0.4], 132, 812, 8);
  OV.push(list.join(''));

  const ax0 = 1120;
  g.push(`<rect x="${ax0}" y="170" width="432" height="356" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(ax0 + 24, 206, 'THE TWO LINES', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  const rows = [
    ['1', C.lineA, 'Line 1', 'overground, viaduct deck +11.6 m', 'type A / catenary / 6-8 cars'],
    ['2', C.lineB, 'Line 2', 'underground, B2 platform -13.0 m', 'type B / third rail / 4-6 cars'],
  ];
  rows.forEach(([id, col, name, sub, stock], i) => {
    const y = 232 + i * 104;
    g.push(`<rect x="${ax0 + 24}" y="${y}" width="384" height="88" rx="10" fill="${col}" opacity=".1" stroke="${col}" stroke-width="1.4"/>`);
    g.push(`<circle cx="${ax0 + 52}" cy="${y + 30}" r="15" fill="${col}"/>`);
    g.push(T(ax0 + 52, y + 35, id, { size: 15, weight: 800, fill: '#0b0e13', anchor: 'middle' }));
    g.push(T(ax0 + 78, y + 28, name, { size: 14, weight: 700, fill: '#eaf0f6' }));
    g.push(T(ax0 + 78, y + 48, sub, { size: 11.5, fill: '#a9b8c8', mono: true }));
    g.push(T(ax0 + 78, y + 68, stock, { size: 11.5, fill: '#7d8ea3', mono: true }));
  });
  g.push(T(ax0 + 24, 456, 'Depth difference = 24.6 m. That is the whole point of the', { size: 12, fill: '#8fa0b3' }));
  g.push(T(ax0 + 24, 476, 'station: the transfer is a climb, and the climb is the crowd.', { size: 12, fill: '#8fa0b3' }));
  g.push(T(ax0 + 24, 500, 'Set the exit rates and the whole stack fills from one end.', { size: 12, fill: '#8fa0b3' }));

  g.push(`<rect x="${ax0}" y="546" width="432" height="602" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(ax0 + 24, 582, 'READING THE CUTAWAY', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  const items = [
    ['1', 'Line 1 canopy + platform, viaduct deck'],
    ['2', 'Type A train, catenary pickup'],
    ['3', 'B1 concourse: gates, shops, columns'],
    ['4', 'B2 island platform, both roads'],
    ['5', 'Escalator well: B2 -> B1, one open shaft'],
    ['6', 'Street-to-concourse run, under the roof slab'],
    ['7', 'Entrance head house on the street'],
    ['8', 'Third rail on the underground line'],
  ];
  items.forEach(([num, txt], i) => {
    const y = 616 + i * 38;
    g.push(`<circle cx="${ax0 + 40}" cy="${y}" r="12" fill="${C.yellow}"/>`);
    g.push(T(ax0 + 40, y + 5, num, { size: 13, weight: 800, fill: C.ink, anchor: 'middle' }));
    g.push(T(ax0 + 62, y + 5, txt, { size: 12.5, fill: '#c3d0de' }));
  });
  g.push(T(ax0 + 24, 954, 'WHY IT WORKS AS A LEVEL', { size: 12, weight: 800, fill: '#8fa0b3', ls: 1.2 }));
  g.push(MUL(ax0 + 24, 980, [
    'One excavation, two station boxes.',
    'The viaduct only needs piers: cheap, and it',
    'can be moved after the box is built.',
    'The transfer is a single shaft, so the player',
    'can measure it as one queue, not three.',
    'Cut the near quarter and you can still play:',
    'the camera is the level selector.',
  ], { size: 12, fill: '#7d8ea3', lh: 19 }));
  g.push(T(ax0 + 24, 1132, 'sandbox: no cost, no staff, no ticket price', { size: 11.5, fill: '#5d6d80' }));

  const body = `<g transform="translate(${n(OX)},${n(OY)}) scale(${K})">${S.out()}</g>` + OV.join('') + g.join('');
  return sheet(W, H, body);
}
