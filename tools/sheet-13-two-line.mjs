// Concept sheet 13 — the two-line interchange, drawn as **fourteen flat layers**.
//
// This sheet is not a scene that happens to read well; it is a stack, and the stack is stated
// once, at the top, and obeyed by everything below it. The reader's list, from the front of the
// picture (the bottom of it) to the back (the top), is the order the layers are painted in —
// last painted is nearest, so it covers what is behind it:
//
//    1 地下 A 列车      the consist on the near road, in front of everything
//    2 地下 A 轨道      its rails, the first thing behind it
//    3 地下站台的人      the crowd waiting on the island
//    4 扶梯 / 楼梯      one set, in the middle of the island
//    5 地下站台          the island itself
//    6 地下 B 列车      the consist on the far road
//    7 地下 B 轨道      its rails
//    8 车站墙体          the wall behind the far road and the wall along the side
//    9 高架站台雨棚      the viaduct canopy, and the columns holding it
//   10 高架站台的人      the crowd up there
//   11 高架站台          the viaduct platform
//   12 高架列车          the A-type consist
//   13 高架轨道          its rails, and the bridge deck they lie on
//   14 桥墩              the piers, standing on the street under all of it
//
// Two things about that list are worth knowing before changing anything.
//
// **A band, not a position.** `Scene().out()` paints `fg` in ascending key, so a low key is far
// away and a high one is near, and which of two shapes covers the other is decided by nothing
// but which band its key falls in. A figure that spans the whole station — a 40 m consist, a
// 40 m track, a 40 m wall — cannot be sorted against anything by its own screen position, so
// each such figure is put in the band that says what it is. The bands are 200 apart and a
// figure's own position only orders it *inside* its band, which is why a consist is always on
// top of the rails it stands on and always behind the platform it stands beside.
//
// **The box is not a layer.** The ground the station is cut into is painted raw, before the
// sort at all (`S.raw`), because every face of it is behind everything: it is the hole, not one
// of the things in the hole.
//
// The pieces are the game's own throughout: the two consists and the viaduct's are
// `buildTrain` photographed on this drawing's axes (`tools/render-train-cards.mjs`), and the
// 扶梯 and 楼梯 are `EscalatorModel` and `StairModel` photographed the same way
// (`tools/render-piece-views.mjs`). Nothing here is a box pretending to be equipment.
import {
  C, TW, P, n, boxSvg, rboxSvg, quadSvg, faceSvg, Scene, title, sheet, callout, T, MUL,
  rng, amT, mover, group, bboxOf, fitToRect,
} from './iso.mjs';
import { isoTrack, catenary } from './train-iso.mjs';
import { trainCard } from './train-cards.mjs';
import { pieceView } from './piece-views.mjs';

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
  trainA: 2800, trackA: 2600, crowdU: 2400, runs: 2200, platformU: 2000,
  trainB: 1800, trackB: 1600, wall: 1400,
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
  const W = 1600, H = 1400;
  /* Where the drawing goes, and the column the reading sits in. The framing is measured from
   * the geometry that was just built (`bboxOf`) and fitted into this rectangle, so no part of
   * the drawing — the far end of a consist, the last pier, the deepest corner of the box — can
   * leave the sheet, and the annotation is placed through the same transform. */
  const ART = { x: 24, y: 168, w: 1072, h: 992 };
  const AX = 1120;
  const g = [];
  g.push(title(48, 62, '一条在街上，一条在街下',
    '还是第 02 张那个换乘站，这回画成体块：一条线在高架桥上，一条线在街面下的箱体里。'));

  const OV = [];
  const S = Scene();
  const rr = rng(13);
  /** Push a shape into one of the bands, letting its own position order it within the band. */
  const put = (band, x, y, z, svg) => S.fg.push([band + depth(x, y, z), svg]);

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

  /* ============================================================ 10. the crowd up there */
  for (let i = 0; i < 16; i++) {
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
  for (const bx of [1, 11, 21, 31, 41]) {
    put(L.roof + 20, bx, PP0 + 0.55, ZK, rboxSvg(bx, PP0 + 0.55, ZK, 0.42, 0.42, 4.5, C.steel, { r: 0.1 }));
    put(L.roof + 20, bx, DY1 - 0.9, ZK, rboxSvg(bx, DY1 - 0.9, ZK, 0.42, 0.42, 4.5, C.steel, { r: 0.1 }));
  }
  put(L.roof + 40, 23, -3.1, ZK + 4.35, boxSvg(DX0, DY0 + 0.2, ZK + 4.5, DX1 - DX0, DY1 - DY0 - 0.2, 0.3, C.ceilBaffle, { tone: 0.95 }));
  put(L.roof + 44, 23, -3.1, ZK + 4.8, boxSvg(DX0, DY0 + 0.2, ZK + 4.8, DX1 - DX0, DY1 - DY0 - 0.2, 0.45, C.panel, { tone: 1.05 }));

  /* ============================================================ 8. the station's own walls
   * The face behind the far road and the face along the side: the two the cut left standing.
   * They take a band of their own rather than the box's, because a wall standing *inside* the
   * hole has to sort against what is in the hole — written raw, the trains came out behind
   * their own station. */
  put(L.wall, 24, YB, 0, faceSvg('y', YB, X0, X1, ZF, ZT, C.tile, { tone: 0.9 }));
  put(L.wall + 40, 24, (YB + YF) / 2, 0, faceSvg('x', X0, YB, YF, ZF, ZT, C.tile, { tone: 0.94 }));
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

  /* ============================================================ 4. the way up
   * One set, in the middle of the island: a 扶梯 and a 楼梯 side by side, climbing out of the box.
   * Both are the game's own models, photographed on this drawing's axes by
   * `tools/render-piece-views.mjs` and placed at **one** scale for both axes, so what stands in
   * the drawing is the picture the game's renderer took: no stretch, and no second opinion about
   * what an escalator looks like.
   *
   * `RUN_S` is that scale, and it is the sheet's one stated number rather than a measurement. The
   * game builds a 扶梯 and a 楼梯 for one 4 m storey of its grid (`sim/constants.ts`) and this box
   * is 9.5 m deep, so the piece is drawn a little under twice its own size: big enough to read as
   * circulation, small enough that the pair is not the largest object in the station. Drawn at its
   * own size it would be a smudge; drawn to reach the street it draws a gradient the game does not
   * have and makes the balustrade the tallest thing in the box.
   *
   * Every run is placed by the point its **origin** landed on — the node the model was built
   * around, which the capture reports for exactly this — with the origin on the platform, so the
   * run stands on the floor rather than near it. The 扶梯 is photographed `iso-flip` because its
   * model's run points the other way along the cell from the 楼梯's, so its picture is mirrored to
   * stand beside the stair climbing the same way. Neither run is animated: these two are the only
   * figures in the drawing that are *placed* rather than *travelling*, and a bank that slides about
   * says the opposite. */
  const esc = pieceView('escalator');
  const stair = pieceView('stair-straight');
  /** The size the runs are drawn at — see above. */
  const RUN_S = 1.15;
  /**
   * One run: its foot on the platform at `x`,`y`, climbing away from the reader.
   *
   * The piece is stood on the floor by its **content's lower-left corner**, which is where both
   * runs' own feet are: for the 扶梯 that is its truss's near corner, for the 楼梯 the bottom of
   * its stringer. Not `origin` — that node sits inside the picture, and on this pair it is a
   * 扶梯's *upper* landing, so anchoring by it stands the escalator on its own head. Not the
   * piece's lowest drawn pixel either: on the 楼梯 that is a handrail post hanging below the head
   * of the run, and a whole flight placed by it lands a metre off its own foot.
   *
   * Both pictures climb the same way — to the right, which in this box is towards the far road —
   * so the bank stands square without mirroring either one.
   */
  const run = (piece, x, y, o = {}) => {
    const w = piece.metres * TW * Math.SQRT2 * RUN_S;
    const h = piece.verticalMetres * TW * Math.SQRT2 * RUN_S;
    const foot = P(x, y, ZP + (o.dz ?? 0));
    const [c0, , , c3] = piece.content;
    const left = foot[0] - c0 * w;
    const top = foot[1] - c3 * h;
    S.fg.push([L.runs + depth(x, y, ZP) + (o.d ?? 0), group(
      `<image x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" href="${piece.href}"/>`,
    )]);
  };
  run(esc, 19.6, 15.3);
  run(stair, 22.4, 15.3, { d: 1 });

  /* ============================================================ 3. the crowd underground
   * Waiting passengers either side of the runs, and two walkers on the long axis, so the busiest
   * thing in the drawing is the thing the sheet is about. Both runs cross the island broadside at
   * x 19–24, so that strip is left clear — a passenger standing inside an escalator reads as a
   * mistake, and the band order would draw them on top of it and hide the piece entirely. */
  for (let i = 0; i < 30; i++) {
    const gx = 5 + rr() * 38;
    const midRun = gx > 17.5 && gx < 25.5;
    const gy = midRun
      ? (rr() > 0.5 ? PB0 + 0.5 + rr() * 0.7 : 14.4 + rr() * 1.1)
      : PB0 + 0.5 + rr() * (PB1 - PB0 - 1.0);
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
  walkU(14.6, C.green, '2.6s', '11s');

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
  co([10, -3.2, ZK + 4.9], 104, 268, 1);               // the canopy over the viaduct
  co([27, CYC, ZRO + 1.5], 104, 392, 2);               // the consist up there
  co([5, -1.9, ZK + 0.2], 104, 516, 3);                // the viaduct platform
  co([28.7, -1.0, ZD - 3.0], 104, 640, 4);             // a pier
  co([36, CYB, ZR + 1.0], 132, 1104, 5);               // the consist on the far road
  co([23, 12.0, ZP + 0.5], 392, 1176, 6);              // the island platform and the crowd
  co([31, CYA, ZR + 1.1], 736, 1176, 7);               // the consist on the near road
  OV.push(list.join(''));

  /* ============================================================ the reading column */
  g.push(`<rect x="${AX}" y="196" width="432" height="330" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(AX + 24, 232, '两条线路', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  const rows = [
    ['1', C.lineA, '1 号线', '地面以上：高架桥面 +11.6 米', 'A 型 / 接触网 / 6-8 节'],
    ['2', C.lineB, '2 号线', '地下：B2 岛式站台 -9.5 米', 'B 型 / 第三轨 / 4-6 节'],
  ];
  rows.forEach(([id, col, name, sub, stock], i) => {
    const y = 252 + i * 82;
    g.push(`<rect x="${AX + 24}" y="${y}" width="384" height="72" rx="10" fill="${col}" opacity=".1" stroke="${col}" stroke-width="1.4"/>`);
    g.push(`<circle cx="${AX + 52}" cy="${y + 24}" r="14" fill="${col}"/>`);
    g.push(T(AX + 52, y + 29, id, { size: 14, weight: 800, fill: '#0b0e13', anchor: 'middle' }));
    g.push(T(AX + 78, y + 23, name, { size: 14, weight: 700, fill: '#eaf0f6' }));
    g.push(T(AX + 78, y + 42, sub, { size: 11.5, fill: '#a9b8c8', mono: true }));
    g.push(T(AX + 78, y + 60, stock, { size: 11.5, fill: '#7d8ea3', mono: true }));
  });
  g.push(T(AX + 24, 438, '落差 21.1 米：一次开挖，两个车站叠在一起。', { size: 12, fill: '#8fa0b3' }));
  g.push(T(AX + 24, 458, '换乘就是一次爬升，而爬升本身就是客流。', { size: 12, fill: '#8fa0b3' }));
  g.push(T(AX + 24, 478, '把各出口进出量定好，整座竖向叠层就从一头灌满。', { size: 12, fill: '#8fa0b3' }));

  g.push(`<rect x="${AX}" y="546" width="432" height="440" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(AX + 24, 582, '剖视图读法', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  g.push(T(AX + 24, 606, '从桥面读到坑底：这七样就是这座车站的全部。', { size: 11.5, fill: '#8fa0b3' }));
  const items = [
    ['1', '高架站台雨棚：顶板与立柱，遮住整条站台'],
    ['2', '高架列车：A 型两节，接触网供电'],
    ['3', '高架站台：桥面近侧的一半，1 号线'],
    ['4', '桥墩：立在街面上，垫着上面全部'],
    ['5', '地下 B 列车：远侧线路，B 型两节'],
    ['6', '地下岛式站台：8.8 米宽，扶梯与楼梯在正中间'],
    ['7', '地下 A 列车：近侧线路，第三轨供电'],
  ];
  items.forEach(([num, txt], i) => {
    const y = 648 + i * 44;
    g.push(`<circle cx="${AX + 40}" cy="${y - 4}" r="12.5" fill="${C.yellow}"/>`);
    g.push(T(AX + 40, y + 0.5, num, { size: 13, weight: 800, fill: C.ink, anchor: 'middle' }));
    g.push(T(AX + 64, y + 0.5, txt, { size: 12.5, fill: '#c3d0de' }));
  });
  g.push(T(AX + 24, 968, '两个盒体之间换乘，是一段真要走的路：', { size: 11.5, fill: '#5d6d80' }));

  g.push(`<rect x="${AX}" y="1004" width="432" height="176" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(AX + 24, 1040, '沙盒模式', { size: 12, weight: 800, fill: '#8fa0b3', ls: 1.2 }));
  g.push(MUL(AX + 24, 1066, [
    '不算成本、不雇员工、不收票价。',
    '盒体建好再调线也来得及；',
    '高架只要打桥墩，便宜。',
    '换乘只用这一组扶梯，队伍就能',
    '当成一条来量，而不是三条。',
    '相机就是楼层选择器。',
  ], { size: 12, fill: '#7d8ea3', lh: 18 }));

  return sheet(W, H, fit.group(scene) + OV.join('') + g.join(''));
}
