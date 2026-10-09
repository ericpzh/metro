// Sheet 13: an authored stack of street, elevated platform, B1 concourse and B2 island.
// Equipment uses the same real models, 3D facing and measured landing anchors as sheet 01.
// Capture: node tools/render-piece-views.mjs --hero --scale 4
// Regenerate: node tools/gen-art.mjs 13
//
// L states the paint order. Long floors, trains and screen walls stay in separate
// bands; depth only orders the occupants within a band. The concourse is above
// B2, its circulation paints over the main floor but under the landing apron,
// and the near train stays in front.
// Street equipment stands on uncut ground; the earth mass paints behind all layers.
import {
  C, TW, TH, ZU, P, n, poly, boxSvg, rboxSvg, quadSvg, faceSvg, Scene, title, sheet, callout, T, MUL,
  rng, amT, mover, group, bboxOf, fitToRect,
} from './iso.mjs';
import { isoTrack, catenary } from './train-iso.mjs';
import { trainCard } from './train-cards.mjs';
import { loadStationPieces, stationPieceImage } from './station-piece-images.mjs';
import { FINISH_LIST } from '../game/src/sim/finishes.ts';

/* ============================================================ the world, in metres
 * z = 0 is the street. The box is 40 m long (x), 20 m across (y) and 10.8 m deep, and it is
 * cut open towards +y and +x — towards the reader's lower left and lower right — so the
 * station inside it can be seen. `y = 2` is the wall behind the far road; `y = 22` is where
 * the cut leaves the ground. */
const X0 = 4, X1 = 44;                 // the box, end to end
const YB = 2, YF = 22;                 // the far wall, and the open cut
const ZB = -15.5;                      // the bottom of the block the box is cut into
const ZF = -10.8;                      // pit floor, which is also the track bed
const ZP = -9.5;                       // the island platform
const ZT = -0.5;                       // the walls stop at the underside of the ground slab
const ZR = ZF + 0.18;                  // rail top
const ZC = ZP + 4;                    // B1 concourse: one real model storey above B2
const CONCOURSE_END = 9.3;             // rear floor; the right apron reaches the upper landings
const LANDING_X = X1 - 6, RUN_X = LANDING_X - 6;
const RUN_Y = [10.4, 11.9];           // paired escalators across the island
const CONCRETE = '#' + FINISH_LIST.find(f => f.id === 'floor.concrete').tint.toString(16).padStart(6, '0');

const RW = 3.2;                        // a road
const RB = 3.0, RA = 17.2;             // the two road beds: y 3.0–6.2 and 17.2–20.4
const CYB = RB + RW / 2;               // the far road's centre line, 4.6
const CYA = RA + RW / 2;               // the near road's, 18.8
const PB0 = 7.2, PB1 = 16.0;           // the island platform between them

/* the viaduct: a deck on piers, a road and a platform on the deck, a canopy over it */
const DX0 = -2, DX1 = 48;
const DY0 = -7.4, DY1 = 1.2;           // the deck, across
const ZD = 10.4, ZK = 11.6;            // deck soffit, deck top
const ZRO = ZK + 0.18;                 // rail top up there
const PK = -7.0;                       // the overground road's bed, 3.2 wide
const CYC = PK + RW / 2;               // -5.4
const PP0 = -3.4;                      // the overground platform's own far edge
const PIER_X = [6, 17.3, 28.7, 40];
const PIER_Y = [-5.4, -1.0];

/* ============================================================ the layers
 * Descending, because 1 is nearest: the arrays below are painted in reverse order, `piers`
 * first, `trainA` last. `spacing` is 200 so a figure's own depth (see `depth`) can never
 * reach out of its band. */
const L = {
  hall: 3400, landing: 3300, runs: 3200, concourse: 3000,
  trainA: 2800, trackA: 2600, crowdU: 2400, platformU: 2000,
  trainB: 1800, trackB: 1600, wall: 1400, street: 1300,
  roof: 1200, crowdO: 1000, platformO: 800, trainC: 600, trackC: 400, pier: 200,
};

/**
 * How far a figure's own world position moves it inside its band.
 *
 * The kit draws more of `x + y + z` nearer the reader, so this is the projection's own depth
 * measure at a scale small enough that nothing leaves a 200-wide band. It orders a crowd
 * against itself, and the sleepers of a track, and the piers of one bent — nothing more. What
 * decides the sheet is the band, not this.
 */
const depth = (x, y, z) => (x + y + z * 0.9) * 0.2;

export function artTwoLine() {
  const W = 1600, H = 1220;
  /* Where the drawing goes, and the column the reading sits in. The framing is measured from
   * the geometry that was just built (`bboxOf`) and fitted into this rectangle, so no part of
   * the drawing — the far end of a consist, the last pier, the deepest corner of the box — can
   * leave the sheet, and the annotation is placed through the same transform. */
  const ART = { x: 24, y: 168, w: 1072, h: 992 };
  const AX = 1120;
  const g = [];
  g.push(title(48, 62, '一条在街上，一条在街下',
    '街面出入口、B1 站厅、B2 岛式站台，与高架线路叠在一起。'));

  const OV = [];
  const S = Scene();
  const pieces = loadStationPieces();
  const rr = rng(13);
  /** Push a shape into one of the bands, letting its own position order it within the band. */
  const put = (band, x, y, z, svg) => S.fg.push([band + depth(x, y, z), svg]);
  const model = (band, id, x, y, z) => put(band, x, y, z,
    stationPieceImage(pieces, id, x, y, z));

  /* ============================================================ the box
   * Painted raw, before the sort: it is the hole everything else sits in. Its top face is the
   * street, its two cut faces are where the ground was sliced, and the block left under the pit
   * floor is what the two roads and the island stand on. */
  S.raw(boxSvg(-10, -10, ZB, 14, 32, -ZB, C.soil, { tone: 1.0, sw: 0.8 }));                 // the side mass
  S.raw(boxSvg(X0, -10, ZB, X1 - X0, 12, -ZB, C.soil, { tone: 0.92, sw: 0.8 }));            // behind the wall
  S.raw(boxSvg(X0, YB, ZB, X1 - X0, YF - YB, ZF - ZB, C.soil2, { tone: 1.0, sw: 0.7 }));    // under the pit
  // strata, on the faces the cut left open: the side mass's front and the block's two
  for (const [zz, tone] of [[-13.4, 1.06], [-5.8, 0.94], [-1.8, 1.02]]) {
    S.raw(faceSvg('y', YF + 0.03, -10, X0, zz, zz + 0.7, C.soil, { tone, sw: 0 }));
    S.raw(faceSvg('x', X1 + 0.03, -10, YB, zz + 0.35, zz + 1.05, C.soil, { tone: tone * 0.94, sw: 0 }));
  }
  for (const zz of [-14.7, -12.5]) {
    S.raw(faceSvg('y', YF + 0.03, X0, X1, zz, zz + 0.6, C.soil, { tone: 1.05, sw: 0 }));
    S.raw(faceSvg('x', X1 + 0.03, YB, YF, zz, zz + 0.6, C.soil, { tone: 0.98, sw: 0 }));
  }
  // the street: the ground's own top, where the cut did not take it away
  S.raw(quadSvg(-10, -10, 0.02, 14, 32, C.floorAlt, { tone: 1.0, sw: 0 }));
  S.raw(quadSvg(X0, -10, 0.02, X1 - X0, 12, C.floorAlt, { tone: 0.97, sw: 0 }));

  // Street equipment stays on the uncut ground, clear of the bridge piers.
  model(L.street, 'exit-covered-1', -3.3, 8.5, 0);
  model(L.street, 'bin', -3.3, 14.2, .02);
  model(L.street, 'bench-steel-1', -6.3, 12.8, .02);
  model(L.street, 'guidepost', -1.5, 16.5, .02);
  model(L.street, 'busstop-short', -7.5, 18.5, .02);
  for (const [x, y] of [[-5.8, 9.2], [-2, 13], [-4.8, 15], [-7.4, 12]])
    S.sprite(x, y, .05, 'personBag', { color: C.teal, k: L.street + depth(x, y, 0) });

  // B1: a rear floor and side aprons leave B2 visible. The right apron meets
  // the +x upper landings of the bank that runs parallel to the train roads.
  const hallSlab = (x, y, w, d, band = L.concourse) => put(band, x + w / 2, y + d / 2, ZC,
    `<g data-layer="${band === L.landing ? 'escalator-landing' : 'concourse-floor'}">${boxSvg(x, y, ZC - .4, w, d, .4, CONCRETE, { sw: .6 })}`
      + quadSvg(x, y, ZC + .005, w, d, CONCRETE, { fill: 'url(#interchange-concrete-grain)', sw: 0 }) + '</g>');
  hallSlab(X0, YB, X1 - X0, CONCOURSE_END - YB);
  hallSlab(X0, CONCOURSE_END, 6, 3.2);
  // The projecting apron covers the escalator heads independently of the rear floor.
  hallSlab(LANDING_X, CONCOURSE_END, 6, 6, L.landing);

  const hallPieces = [
    ['door-steel-2', 6.1, 2.2], ['extinguisher', 9.3, 2.4],
    ['bin', 10.3, 2.4], ['bin', 17.8, 2.4], ['extinguisher', 35.6, 2.4],
    ...[11.5, 12.7, 13.9, 15.1, 16.3].map(x => ['tvm', x, 2.9]),
    ...[38.1, 39.3, 40.5].map(x => ['vending', x, 2.9]),
    ...[31.5, 32.8, 34.1].map(x => ['shelf', x, 2.6]),
    ['bench-steel-1', 9.5, 6.2], ['bench-steel-1', 36.3, 7.6],
    ...[18.5, 19.5, 20.5, 21.5, 22.5, 23.5].map(x => ['gate', x, 6.4]),
    ...Array.from({ length: 14 }, (_, i) => ['fence', X0 + i + .5, 6.4]),
    ...Array.from({ length: 20 }, (_, i) => ['fence', 24 + i + .5, 6.4]),
  ];
  for (const [id, x, y] of hallPieces) model(L.hall, id, x, y, ZC);
  model(L.hall, 'billboard-panorama', 26.7, 2.2, ZC + 1.3);
  // A real shaft spans both floors, with a separate cabin at its lower stop.
  model(L.hall, 'lift-shaft', 8.5, 10.7, ZP);
  model(L.hall, 'lift-car', 8.5, 10.7, ZP);
  const guidance = [[13, 4.8], [20.5, 4.8], [20.5, 8], [LANDING_X + 2, 8],
    [LANDING_X + 2, 11.9], [LANDING_X + .2, 11.9]];
  for (const [band, points] of [[L.concourse, guidance.slice(0, 4)], [L.landing, guidance.slice(3)]])
    put(band + 40, 20.5, 8, ZC + .02,
      `<path d="M${points.map(p => P(...p, ZC + .02).map(n).join(',')).join(' L')}" fill="none" stroke="${C.tactile}" stroke-width="5" stroke-linejoin="round"/>`);
  const hallCrowd = rng(131);
  for (let i = 0; i < 48; i++) {
    const x = 11 + hallCrowd() * 24, y = i < 32 ? 4.2 + hallCrowd() * 1.5 : 7.4 + hallCrowd() * 1.4;
    S.sprite(x, y, ZC + .03, i % 7 ? 'person' : 'personBag', {
      color: [C.red, C.blue, C.teal, C.purple, C.orange, C.pink, C.green][i % 7],
      k: L.hall + depth(x, y, ZC),
    });
    if (i % 3 === 0) {
      const entry = S.fg.at(-1);
      entry[1] = group(entry[1], amT('0 0;6 3.5;0 0', '', `${9 + i % 4}s`, undefined, `${-i * .4}s`));
    }
  }

  /* ============================================================ 14. the piers
   * Painted first of everything sorted, because the deck has to land on top of them. A pair per
   * bent, standing on the street with their heads at the deck's soffit — the deck is what hides
   * the heads, so they can stand anywhere under it. */
  for (const bx of PIER_X) {
    for (const by of PIER_Y) {
      put(L.pier, bx, by, 0, rboxSvg(bx - 0.15, by - 0.15, 0, 1.6, 1.6, 0.45, C.concreteD, { r: 0.16 }));
      put(L.pier, bx, by, 0.45, rboxSvg(bx, by, 0.45, 1.3, 1.3, ZD - 1.05, C.concrete, { r: 0.2 }));
      put(L.pier, bx, by, ZD - 0.6, rboxSvg(bx - 0.18, by - 0.18, ZD - 0.6, 1.66, 1.66, 0.6, C.concreteD, { r: 0.16 }));
    }
  }

  /* ============================================================ 13. the viaduct's road
   * The bridge deck and the road on it, in one band: the deck is the road's own support, and
   * painting them apart is how a track ends up drawn on top of the thing carrying it. */
  put(L.trackC, 23, -3.1, ZD + 0.6, boxSvg(DX0, DY0, ZD, DX1 - DX0, DY1 - DY0, 1.2, C.concrete, { tone: 1.0 }));
  put(L.trackC, 23, DY1 + 0.17, ZK + 0.3, boxSvg(DX0, DY1, ZK, DX1 - DX0, 0.35, 0.7, C.concreteD, { tone: 0.98 }));
  put(L.trackC, 23, DY0 - 0.17, ZK + 0.3, boxSvg(DX0, DY0 - 0.35, ZK, DX1 - DX0, 0.35, 0.7, C.concreteD, { tone: 0.98 }));
  isoTrack(S, { x: DX0, y: PK, z: ZK, len: DX1 - DX0, w: RW, third: false, key: L.trackC + 60 });
  catenary(S, { x: DX0, y: CYC, z: ZK, len: DX1 - DX0 }, L.trackC + 60);

  /* ============================================================ 12. the consist up there
   * The game's own A-type consist — the stock this line runs — photographed on this drawing's
   * axes. It is anchored by the point its **origin** landed on, which the capture reports: the
   * model is built centred on its origin and standing on it (`box.z[0]` is 0), so putting that
   * point on the rail top stands the whole train on the track rather than near it.
   *
   * The picture is **mirrored**, because the render is taken on the far side of the kit's
   * corner: without it the car faces the wrong way along its own rails. A mirror moves the
   * anchored point (it lands at `1 − origin[0]` of the element), so the left edge is placed
   * from the mirrored fraction. */
  const trainImage = (card, x, y, z, anim) => {
    const w = card.metres * TW * Math.SQRT2;
    const h = card.verticalMetres * TW * Math.SQRT2;
    const [ox, oy] = P(x, y, z);
    const fx = 1 - card.origin[0];
    const left = ox - fx * w;
    const top = oy - card.origin[1] * h;
    return group(
      `<image x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" href="${card.href}"` +
      ` transform="translate(${n(2 * left + w)},0) scale(-1,1)"/>`,
      anim,
    );
  };
  /** A consist easing along its road and settling back: the same shunt on every train. */
  const shunt = (begin, dur = '20s', dx = 44, dy = 25) =>
    amT(`0 0;0 0;${dx} ${dy};${dx} ${dy};0 0;0 0`, '0;0.2;0.5;0.7;1', dur,
      '0.4 0 0.6 1;0 0 1 1;0 0 1 1;0.4 0 0.6 1', begin);
  const isoA = trainCard('iso-A');
  // the model is centred on its origin, so the anchor is the point the consist is centred on
  S.fg.push([L.trainC + 60, trainImage(isoA, 23, CYC, ZRO, shunt('1.6s', '23s'))]);

  /* ============================================================ 11. the overground platform
   * The floor of the viaduct station, on the near half of the deck, with its warning strip and
   * its safety line along the road edge. It is painted after the train, which is what lets it
   * hide the train's own skirt behind its edge — the order the list asks for, and the order the
   * world has. */
  put(L.platformO, 23, (PP0 + DY1) / 2, ZK + 0.02, boxSvg(DX0, PP0, ZK, DX1 - DX0, DY1 - PP0, 0.08, C.floor, { tone: 1.0, sw: 0.5 }));
  put(L.platformO + 30, 23, PP0 + 0.45, ZK + 0.04, quadSvg(DX0, PP0 + 0.03, ZK + 0.06, DX1 - DX0, 0.88, C.tactile, { tone: 1.0, sw: 0.3 }));
  put(L.platformO + 32, 23, PP0 + 1.35, ZK + 0.04, quadSvg(DX0, PP0 + 0.91, ZK + 0.06, DX1 - DX0, 0.3, C.maroon, { tone: 1.0, sw: 0.3 }));
  // Wrap the exposed outer edge and both ends, leaving the boarding edge open.
  for (let x = DX0 + .5; x < DX1; x += 1)
    model(L.crowdO + 90, 'fence', x, DY1 - .15, ZK + .08);
  for (const x of [DX0 + .15, DX1 - .15])
    for (let y = PP0 + .5; y < DY1; y += 1)
      model(L.crowdO + 90, 'fence-end', x, y, ZK + .08);

  /* ============================================================ 10. the crowd up there */
  for (const x of [7, 17, 27, 37]) model(L.crowdO, 'bench-steel-1', x, .25, ZK + .1);
  for (const x of [3.5, 22.5, 43.5]) model(L.crowdO, 'bin', x, .45, ZK + .1);
  for (let i = 0; i < 24; i++) {
    const gx = 1 + rr() * 45;
    const gy = PP0 + 1.9 + rr() * (DY1 - PP0 - 2.3);
    S.sprite(gx, gy, ZK + 0.1, rr() > 0.86 ? 'personBag' : 'person', {
      color: [C.red, C.blue, C.teal, C.purple, C.orange, C.pink, C.green][(rr() * 7) | 0],
      k: L.crowdO + i,
    });
  }
  {
    const p0 = P(0, DY1 - 0.6, ZK + 0.12);
    const p1 = P(46, DY1 - 0.6, ZK + 0.12);
    S.fg.push([L.crowdO + 80, mover(`M ${n(p0[0])} ${n(p0[1])} L ${n(p1[0])} ${n(p1[1])}`, C.pink, '0.8s',
      { sprite: 'person', dur: '13s', f0: 0.02, f1: 0.1, f2: 0.88, f3: 0.96 })]);
  }

  /* ============================================================ 9. the canopy
   * Columns first, roof last: a column's head has to disappear into the slab, not through it.
   * The columns belong to the platform they stand on as much as to the roof, but they are part
   * of the roof's band here for the same reason the deck is part of the road's. */
  for (const bx of [0, 8, 16, 24, 32, 40, 46]) {
    model(L.roof + 20, 'pillar-slim', bx, PP0 + .55, ZK + .08);
    model(L.roof + 20, 'pillar-slim', bx, DY1 - .85, ZK + .08);
  }
  // The game's four-metre truss bays share a ridge along the platform.
  for (let x = DX0; x < DX1 - 2; x += 4)
    model(L.roof + 40, 'roof-truss', x + 2, PP0 + 2.3, ZK + 4 + .08);

  /* ============================================================ 8. the station's own walls
   * The face behind the far road and the face along the side: the two the cut left standing.
   * They take a band of their own rather than the box's, because a wall standing *inside* the
   * hole has to sort against what is in the hole — written raw, the trains came out behind
   * their own station. */
  // The same 水泥 tint and grain as the B1 floor, shaded for each wall face.
  put(L.wall, 24, YB, 0, faceSvg('y', YB, X0, X1, ZF, ZT, CONCRETE, { tone: 0.9 })
    + poly([P(X0, YB, ZF), P(X1, YB, ZF), P(X1, YB, ZT), P(X0, YB, ZT)],
      'url(#interchange-concrete-grain)', null, 0));
  put(L.wall + 40, 24, (YB + YF) / 2, 0, faceSvg('x', X0, YB, YF, ZF, ZT, CONCRETE, { tone: 0.94 })
    + poly([P(X0, YB, ZF), P(X0, YF, ZF), P(X0, YF, ZT), P(X0, YB, ZT)],
      'url(#interchange-concrete-grain)', null, 0));
  // a skirting band at the foot of each, so the walls read as walls rather than as paper
  put(L.wall + 60, 24, YB + 0.02, 0, faceSvg('y', YB + 0.02, X0, X1, ZF, ZF + 0.5, C.dark, { tone: 1.0, sw: 0 }));
  put(L.wall + 60, 24, 0, 0, faceSvg('x', X0 + 0.02, YB, YF, ZF, ZF + 0.5, C.dark, { tone: 1.0, sw: 0 }));

  /* ============================================================ 7. the far road */
  isoTrack(S, { x: X0, y: RB, z: ZF, len: X1 - X0, w: RW, third: true, key: L.trackB });

  /* ============================================================ 6. the consist on it
   * A B-type pair, the stock the underground line runs. It is a band above its own rails and
   * three bands *below* the island: the crowd, the 扶梯 and the platform all stand in front of
   * it, which is what the reader asked for and what the world looks like from this corner. */
  const isoB = trainCard('iso-B');
  S.fg.push([L.trainB + 60, trainImage(isoB, (X0 + X1) / 2, CYB, ZR, shunt('4.5s', '24s'))]);

  /* ============================================================ 5. the island platform
   * One block, 8.8 m across, from the pit floor to 9.5 m below the street, with a warning strip
   * at each road edge and the inlay band the floors wear in the rest of the drawings. */
  put(L.platformU, (X0 + X1) / 2, (PB0 + PB1) / 2, ZF, boxSvg(X0, PB0, ZF, X1 - X0, PB1 - PB0, ZP - ZF, C.slab, { tone: 1.0, sw: 0.6 }));
  put(L.platformU + 20, (X0 + X1) / 2, (PB0 + PB1) / 2, ZP + 0.02, quadSvg(X0, PB0, ZP + 0.02, X1 - X0, PB1 - PB0, C.floor, { tone: 1.0, sw: 0.5 }));
  for (const [yy, s] of [[PB0, 1], [PB1, -1]]) {
    const y0 = s > 0 ? yy + 0.04 : yy - 0.94;
    const y1 = s > 0 ? yy + 0.94 : yy - 0.04;
    put(L.platformU + 40, 24, yy, ZP + 0.05, quadSvg(X0, y0, ZP + 0.04, X1 - X0, 0.9, C.tactile, { tone: 1.0, sw: 0.3 }));
    put(L.platformU + 42, 24, yy, ZP + 0.05, quadSvg(X0, s > 0 ? y1 - 0.3 : y1, ZP + 0.04, X1 - X0, 0.3, C.maroon, { tone: 1.0, sw: 0.3 }));
    put(L.platformU + 44, 24, yy, ZP + 0.05, quadSvg(X0, s > 0 ? yy - 0.12 : yy, ZP + 0.04, X1 - X0, 0.12, C.white, { tone: 1.0, sw: 0.25 }));
  }
  model(L.platformU + 80, 'platform-edge-40', 24, PB1, ZP);
  model(L.platformU + 70, 'platform-edge-40-far', 24, PB0, ZP);
  for (const [id, x, y] of [['bench-steel-1', 12, 12], ['bench-steel-1', 25, 12],
    ['bin', 6, 12], ['bin', 41, 12]]) model(L.crowdU, id, x, y, ZP);

  // A real quarter-turn of the 3D models, not a rotated image. Both climb
  // along +x into the projecting right apron, one 4 m storey, parallel to the trains.
  model(L.runs, 'escalator-x', RUN_X, RUN_Y[0], ZP);
  model(L.runs, 'escalator-x', RUN_X, RUN_Y[1], ZP);

  /* ============================================================ 3. the crowd underground
   * Waiting passengers either side of the runs, and two walkers on the long axis, so the busiest
   * thing in the drawing is the thing the sheet is about. The longitudinal bank's
   * footprint stays clear, including their lower landings and balustrades. */
  for (let i = 0; i < 44; i++) {
    const gx = 5 + rr() * 38;
    const gy = PB0 + 0.5 + rr() * (PB1 - PB0 - 1.0);
    if (gx > RUN_X - 1.2 && gx < LANDING_X + .6 && gy > 9.6 && gy < 12.7) continue;
    if ((gx < 10 && gy > 9) || (Math.abs(gx - 12) < 1 && Math.abs(gy - 12) < 1)
      || (Math.abs(gx - 25) < 1 && Math.abs(gy - 12) < 1)) continue;
    S.sprite(gx, gy, ZP + 0.06, rr() > 0.85 ? 'personBag' : 'person', {
      color: [C.red, C.blue, C.teal, C.purple, C.orange, C.pink, C.green][(rr() * 7) | 0],
      k: L.crowdU + i,
    });
  }
  const walkU = (y, col, begin, dur) => {
    const p0 = P(6, y, ZP + 0.08);
    const p1 = P(42, y, ZP + 0.08);
    S.fg.push([L.crowdU + 80 + y, mover(`M ${n(p0[0])} ${n(p0[1])} L ${n(p1[0])} ${n(p1[1])}`, col, begin,
      { sprite: 'person', dur, f0: 0.03, f1: 0.12, f2: 0.86, f3: 0.95 })]);
  };
  walkU(8.0, C.red, '0s', '10s');
  walkU(15.3, C.green, '2.6s', '11s');

  /* ============================================================ 2. the near road */
  isoTrack(S, { x: X0, y: RA, z: ZF, len: X1 - X0, w: RW, third: true, key: L.trackA });

  /* ============================================================ 1. the near consist
   * The nearest thing in the picture and the last thing painted, so it covers the island, the
   * crowd, the runs and the far road alike. That is the whole point of the first line of the
   * list: from this corner the near train is between the reader and the station. */
  S.fg.push([L.trainA + 60, trainImage(isoB, (X0 + X1) / 2, CYA, ZR, shunt('0s', '21s'))]);

  /* ============================================================ framing
   * Measured from the finished geometry and fitted into the rectangle the reading column
   * leaves: the drawing is exactly as wide as it turned out to be, so nothing can run off the
   * edge — a cab sliced off flat by the margin is what a guessed frame buys. */
  const scene = S.out();
  const fit = fitToRect(bboxOf(scene), ART);
  /** A world point, on the sheet. */
  const at = (x, y, z) => fit.place(...P(x, y, z));

  /* ============================================================ the layer badges
   * Seven numbered balls on what the section is made of, hung off short leaders into the empty
   * margins. They are placed through the same framing as the drawing, so a ball lands on the
   * thing it names rather than near it. */
  const list = [];
  const co = (p, lx, ly, num) => {
    const [ax, ay] = at(p[0], p[1], p[2]);
    callout(list, ax, ay, lx, ly, num, null);
  };
  co([5, -1.9, ZK + 0.2], 104, 350, 1);
  co([27, 6.4, ZC + .7], 104, 730, 2);
  co([23, 12.0, ZP + 0.5], 392, 1176, 3);
  OV.push(list.join(''));

  g.push(T(AX + 12, 260, '换乘，要走过这些空间', { size: 24, weight: 800, fill: C.yellow }));
  const steps = [
    ['1  高架站台', '地面以上的 1 号线'],
    ['2  B1 站厅', '在这里分流，连接不同楼层'],
    ['3  B2 岛式站台', '地下的 2 号线'],
  ];
  steps.forEach(([name, note], i) => {
    const y = 330 + i * 142;
    g.push(T(AX + 24, y, name, { size: 23, weight: 700, fill: '#eaf0f6' }));
    g.push(T(AX + 24, y + 34, note, { size: 18, fill: '#a9b8c8' }));
    if (i < 2) g.push(T(AX + 32, y + 90, '↓  换层', { size: 20, fill: C.asc }));
  });
  g.push(MUL(AX + 24, 820, [
    '扶梯、楼梯与电梯的布局，',
    '决定换乘要走多远、等多久。',
    '观察换层口的队伍，再调整通路。',
  ], { size: 19, fill: '#a9b8c8', lh: 34 }));

  const grain = rng(43);
  const concreteGrain = '<defs><pattern id="interchange-concrete-grain" width="64" height="64" patternUnits="userSpaceOnUse">'
    + Array.from({ length: 90 }, (_, i) => `<circle cx="${n(grain() * 64)}" cy="${n(grain() * 64)}" r="${n(.2 + grain() * .6)}" fill="${i % 2 ? '#fff' : '#000'}" opacity=".12"/>`).join('')
    + '</pattern></defs>';
  return sheet(W, H, concreteGrain + fit.group(scene) + OV.join('') + g.join(''));
}
