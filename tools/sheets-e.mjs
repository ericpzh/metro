// Concept sheet 12 — platform doors, trains and passenger flow, animated.
//
// The trains here are the game's own: the plan in panel A is `buildTrain` seen from
// above, rendered with a cleared alpha so it composites over the platform this sheet
// draws, and panels B and D carry real side elevations. Both come out of the same pass
// as sheets 05 and 11 (`tools/render-train-cards.mjs`). The track under panel A's train
// is the game's `TrackModel` — two rails 1.44 m apart on sleepers, with the 第三轨's
// guarded conductor rail beside them — laid in the same box as the plan, so a metre is a
// metre in both and the consist sits on its own track rather than beside two drawn lines.
// It is one piece as long as the train (`trackPieceForLine`), which is why the track is
// only *seen* between trains: for the rest of the loop the consist is standing on it.
//
// **One list places everything that must line up**: `doorCentres()` in
// `game/src/sim/stock.ts`, which GAME-SPEC §1.13 makes authoritative. The doors on the
// car (they are the car's own, in the render), the screen doors, the queue lanes and the
// boarding paths are all put at those centres, so a screen door cannot drift off the
// door it exists to meet. The offsets `doorCentres` returns are measured from the
// **consist centre**, which is why panel A works in consist coordinates.
//
// The old version of this sheet computed its own door cadence from a formula local to
// `tools/iso.mjs` (an equal-gap rule), which put B's doors 4.16 m apart where the game
// puts them 4.63 m apart — so every door, screen and lane on the sheet was in the wrong
// place. It also had no L.
//
// The motion is CSS (keyframes injected by sheet()), so the sheet animates wherever it
// is shown — including inside an <img>, which is how the site and the README embed it.
// The loop is:
//   train enters -> docks -> PSD leaves open -> queues feed the doors, people
//   alight -> PSD closes -> train leaves -> repeat.
import {
  C, T, MUL, title, sheet, n, amT, mover, group, passT,
} from './iso.mjs'
import { STOCK, STOCK_CLASSES, DOOR_END_INSET, doorCentres } from '../game/src/sim/stock.ts'
import { carImage, trainCard } from './train-cards.mjs'

const car = trainCard

/* ------------------------------------------------------------ flat helpers */
const rect = (x, y, w, h, fill, o = {}) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${o.rx ? ` rx="${n(o.rx)}"` : ''} fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1.2}"` : ''}${o.opacity != null ? ` opacity="${o.opacity}"` : ''}/>`;
const circ = (x, y, r, fill, o = {}) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ''}${o.opacity != null ? ` opacity="${o.opacity}"` : ''}/>`;
const ln = (x1, y1, x2, y2, col, w = 1.4, dash) =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${col}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const arrowLine = (x1, y1, x2, y2, col, w = 2, marker = 'arwPF') =>
  `<path d="M${n(x1)},${n(y1)} L${n(x2)},${n(y2)}" stroke="${col}" stroke-width="${w}" fill="none" marker-end="url(#${marker})"/>`;
const dimH = (x1, x2, y, txt, col = C.yellow, above = true) =>
  ln(x1, y, x2, y, col, 1.2) +
  ln(x1, y - 4, x1, y + 4, col, 1.2) + ln(x2, y - 4, x2, y + 4, col, 1.2) +
  T((x1 + x2) / 2, above ? y - 7 : y + 15, txt, { size: 11.5, fill: col, anchor: 'middle', mono: true });
const panelBox = (g, x, y, w, h, t, sub) => {
  g.push(rect(x, y, w, h, '#111926', { rx: 14, stroke: '#243040' }));
  if (t) g.push(T(x + 22, y + 32, t, { size: 14, weight: 800, fill: C.yellow, ls: 1.3 }));
  if (sub) g.push(T(x + 22, y + 54, sub, { size: 12.5, fill: '#8fa0b3' }));
};
const AG = [C.red, C.blue, C.green, C.purple, C.pink, C.teal, C.orange, '#d7dde5', '#3f4a58'];
const upChevron = (x, y, col = '#5d6d80') =>
  `<path d="M${n(x - 9)},${n(y + 8)} L${n(x)},${n(y - 7)} L${n(x + 9)},${n(y + 8)}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * One car's door centres, in metres from **that car's** centre.
 *
 * Read off the middle car of a six-car consist rather than a car on its own, because
 * `doorCentres` rounds each offset to a decimetre *after* measuring it from the consist
 * centre — so a one-car consist rounds B's outer doors to ±7.0 and flattens the pitch to
 * 4.70, where the six-car list keeps them at ±6.95 and the pitch at the 4.60 the class
 * actually has (and which sheet 05 prints). Six cars is within every class's range.
 */
function carDoors(cls) {
  const doors = STOCK[cls].doorsPerSide
  const middle = 3
  const total = STOCK[cls].length * 6
  const carCentre = middle * STOCK[cls].length + STOCK[cls].length / 2 - total / 2
  return doorCentres({ stock: cls, cars: 6 })
    .slice(middle * doors, middle * doors + doors)
    .map((off) => off - carCentre)
}

/* --------------------------------------------------------------- animation */
const DUR = '20s';                       // one full enter / dwell / leave cycle
const T_IN = 0.16, T_OUT = 0.70;         // train docked between these keyTimes
const P_OPEN0 = 0.19, P_OPEN1 = 0.24, P_CLOSE0 = 0.64, P_CLOSE1 = 0.69;
/**
 * The stretch of the cycle a passenger may be on the platform for.
 *
 * It opens when the doors have finished opening — nobody boards a train that is still
 * rolling, and nobody boards a closed one — and it shuts a little before the doors
 * start closing, so that the last staggered walker is off the drawing while the train
 * is still standing. Every walker is delayed by at most `STAGGER_MAX`, and
 * `CROWD1 + STAGGER_MAX` is well inside `T_OUT`: the platform is empty before the train
 * moves, which is what a departure looks like.
 */
const CROWD0 = P_OPEN1;
const CROWD1 = P_CLOSE0 - 0.04;
const STAGGER_MAX = 1.2;

/* =================================================================== sheet */
export function artPlatformFlow() {
  const W = 1600, H = 1380;
  const g = [];

  g.push(title(48, 62,
    '对齐的车门、自然形成的队列、来去的列车',
    '车门间距只算一次，其余全由它定位：屏蔽门开哪、队伍怎么排、上下车走哪条路。列车、车门和人群 20 秒一轮循环播放。'));

  g.push(`<defs>
    <marker id="arwPF" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#9fb3c8"/></marker>
    <marker id="arwY" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${C.yellow}"/></marker>
  </defs>`);

  /* ============================================== A. the boarding sequence */
  const AX = 48, AY = 150, AW = 1504, AH = 436;
  panelBox(g, AX, AY, AW, AH, 'A.  上车时序（平面）',
    '列车进站停稳，屏蔽门滑开，两条队伍各自喂给一道门，乘客从中间下车，屏蔽门合上，列车出站。');

  const s = 31;                                   // px per metre
  const PX0 = 76;
  const PLATLEN = 46;
  const platW = PLATLEN * s;
  const MX = (m) => PX0 + m * s;
  const Y_BAND0 = 214, Y_BAND1 = 250;
  const Y_PTOP = 262, Y_PEDGE = 450;
  /** The track centreline: both rails straddle it, and so does the consist. */
  const Y_TRACK = 515;
  const BED_W = 3;                                 // the game's own bed: RAIL_BED_DEPTH
  const Y_TRK1 = Y_TRACK + (BED_W * s) / 2;

  const stock = STOCK.B;
  const NCARS = 2;
  const CARSTART = 3.0;
  const total = stock.length * NCARS;
  /** The consist centre in the sheet's own metres — `doorCentres` measures from here. */
  const CONSIST_MID = CARSTART + total / 2;
  const doorsM = doorCentres({ stock: 'B', cars: NCARS });
  const doorsPx = doorsM.map((off) => MX(CONSIST_MID + off));
  const DOORW = stock.doorWidth * s;
  const HALF = DOORW / 2;

  /* platform floor + edge treatment */
  g.push(rect(PX0, Y_PTOP, platW, Y_PEDGE - Y_PTOP, '#cfd3d8', { rx: 3 }));
  g.push(rect(PX0 + 4, Y_PTOP + 52, platW - 8, 3, C.floorInlay, { opacity: 0.32 }));
  g.push(rect(PX0, Y_PEDGE - 26, platW, 12, C.maroon, { opacity: 0.9 }));
  g.push(rect(PX0, Y_PEDGE - 14, platW, 7, C.tactile, { opacity: 0.95 }));

  /* concourse / vertical circulation band across the top */
  g.push(rect(PX0, Y_BAND0, platW, Y_BAND1 - Y_BAND0, '#161e2b', { rx: 6, stroke: '#243040' }));
  for (let cvx = PX0 + 60; cvx < PX0 + platW - 26; cvx += 66) g.push(upChevron(cvx, (Y_BAND0 + Y_BAND1) / 2));
  g.push(T(PX0 + 14, Y_BAND0 + 26, '↑ 通往站厅   扶梯 + 楼梯 + 电梯   （出站走这边）', { size: 12.5, fill: C.yellow, weight: 700 }));

  /* track bed, then the game's own track on it: one module as long as the train, its two
     rails 1.44 m apart and its sleepers — the thing the consist actually stands on. */
  g.push(rect(PX0, Y_TRACK - (BED_W * s) / 2, platW, BED_W * s, '#232a33', { rx: 3 }));
  const track = car('plan-track-B');
  g.push(carImage(track, MX(CONSIST_MID), Y_TRACK, s).svg);

  /* the train, from above: the game's own car, sliding in and out. Placed on the
     consist centre and at this panel's own scale, so its doors sit where the list says. */
  const plan = car('plan-B');
  const planImg = carImage(plan, MX(CONSIST_MID), Y_TRACK, s)
  const trainShift = Math.round((CARSTART + total + 4) * s);
  g.push(group(planImg.svg, passT(trainShift, DUR)));

  /* door alignment guides: car door -> PSD opening -> alight path. Drawn over the
     train, because a door is under the roof in plan — a concealed element, dashed. */
  for (const dx of doorsPx) g.push(ln(dx, Y_BAND1 + 6, dx, Y_TRK1 - 6, C.yellow, 1, '4 5'));
  // The doorway itself, marked where the roof hides it.
  for (const dx of doorsPx) g.push(rect(dx - HALF, Y_TRACK - 46, DOORW, 92, C.yellow, { opacity: 0.1 }));

  /* queue lanes: two per door, plus one alight path down the middle */
  const laneOff = 1.15 * s;
  const laneW = 0.84 * s;
  const laneTop = 306, laneHead = 438;
  doorsPx.forEach((dx, i) => {
    g.push(rect(dx - 9, laneTop - 12, 18, laneHead - laneTop + 20, C.safety, { rx: 3, opacity: 0.14 }));
    g.push(arrowLine(dx, laneHead + 10, dx, laneTop - 4, C.safety, 2, 'arwPF'));
    if (i === 1 || i === 4) g.push(T(dx, laneTop - 18, '下车', { size: 10.5, fill: C.safety, anchor: 'middle', weight: 700 }));
    for (const sgn of [-1, 1]) {
      const lx = dx + sgn * laneOff;
      g.push(rect(lx - laneW / 2, laneTop, laneW, laneHead - laneTop, '#a8d8ea', { rx: 2, opacity: 0.45 }));
      g.push(ln(lx - laneW / 2, laneTop, lx - laneW / 2, laneHead, C.steelD, 1.2));
      g.push(ln(lx + laneW / 2, laneTop, lx + laneW / 2, laneHead, C.steelD, 1.2));
      for (let k = 0; k < 5; k++) {
        const sy = laneHead - 4 - k * 25;
        g.push(ln(lx - laneW / 2 + 2, sy, lx + laneW / 2 - 2, sy, '#ffffff', 1, '2 3'));
        g.push(circ(lx, sy + 8, 6.2, AG[(i * 3 + k + (sgn > 0 ? 1 : 0)) % AG.length], { stroke: '#0d1116', sw: 1 }));
      }
      g.push(arrowLine(lx, laneTop + 2, lx, laneHead - 46, '#2f7ef2', 1.6));
    }
  });

  /* PSD line: solid panels between the doors, a pair of leaves per door */
  let segStart = PX0;
  const psd = [];
  for (const dx of doorsPx) {
    if (dx - HALF > segStart) psd.push(rect(segStart, Y_PEDGE + 2, dx - HALF - segStart, 10, '#cbd3dc', { stroke: C.ink, sw: 1 }));
    segStart = dx + HALF;
  }
  psd.push(rect(segStart, Y_PEDGE + 2, PX0 + platW - segStart, 10, '#cbd3dc', { stroke: C.ink, sw: 1 }));
  const pSpline = '0 0 1 1;0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1;0 0 1 1';
  const pKT = `0;${P_OPEN0};${P_OPEN1};${P_CLOSE0};${P_CLOSE1};1`;
  const leaves = [];
  for (const dx of doorsPx) {
    psd.push(rect(dx - HALF - 3, Y_PEDGE, 3, 15, C.steelD, { rx: 1 }));
    psd.push(rect(dx + HALF, Y_PEDGE, 3, 15, C.steelD, { rx: 1 }));
    leaves.push(group(rect(dx - HALF, Y_PEDGE + 4, HALF, 7, C.glass, { stroke: C.ink, sw: 0.8, opacity: 0.92 }), amT('0 0;0 0;-16 0;-16 0;0 0;0 0', pKT, DUR, pSpline)));
    leaves.push(group(rect(dx, Y_PEDGE + 4, HALF, 7, C.glass, { stroke: C.ink, sw: 0.8, opacity: 0.92 }), amT('0 0;0 0;16 0;16 0;0 0;0 0', pKT, DUR, pSpline)));
  }
  g.push(rect(PX0, Y_PEDGE - 2, platW, 2, '#c70541', { opacity: 0.9 }));   // 5 号线 header
  g.push(...psd, ...leaves);

  /* passengers that move: board from the lane heads, alight down the middle.
     Every walker runs on the **train's** clock and only inside the doors-open window,
     so the crowd arrives with the train and is gone before it pulls out. */
  const movers = [];
  const walk = { dur: DUR, win: [CROWD0, CROWD1] };
  doorsPx.forEach((dx, i) => {
    const b = (i * 0.14).toFixed(2);
    for (const sgn of [-1, 1]) {
      const lx = dx + sgn * laneOff;
      const path = `M ${n(lx)} ${n(laneHead - 6)} L ${n(dx + sgn * 15)} ${n(Y_PEDGE + 4)} L ${n(dx + sgn * 6)} ${n(Y_TRACK + 6)}`;
      movers.push(mover(path, AG[(i * 3 + (sgn > 0 ? 1 : 0)) % AG.length], `${b}s`, walk));
    }
    const aPath = `M ${n(dx)} ${n(Y_TRACK + 8)} L ${n(dx)} ${n(Y_PEDGE + 6)} L ${n(dx)} ${n(laneTop - 6)}`;
    movers.push(mover(aPath, AG[(i * 2 + 4) % AG.length], `${(i * 0.12).toFixed(2)}s`, walk));
    movers.push(mover(aPath, AG[(i * 2 + 6) % AG.length], `${(0.3 + i * 0.12).toFixed(2)}s`, walk));
  });
  g.push(...movers);

  /* labels + the one annotated door */
  g.push(T(PX0 + 8, Y_PTOP + 26, '站台', { size: 12.5, fill: '#5d6d80', weight: 700, ls: 0.6 }));
  g.push(T(PX0 + platW - 14, Y_PTOP + 26, '屏蔽门开口对齐车门中心', { size: 11.5, fill: '#8fa0b3', anchor: 'end' }));
  const d0 = doorsPx[2];
  g.push(arrowLine(d0 + 72, Y_TRACK + 32, d0 + 14, Y_TRACK + 6, C.white, 1.4));
  g.push(T(d0 + 78, Y_TRACK + 36, `车门 ${stock.doorWidth} 米`, { size: 11, fill: '#dfe7f0', weight: 700 }));
  g.push(ln(d0 - HALF, Y_PEDGE + 20, d0 - HALF - 58, Y_PEDGE + 44, C.glass, 1.2));
  g.push(T(d0 - HALF - 62, Y_PEDGE + 48, '屏蔽门门板', { size: 11, fill: C.glass, anchor: 'end', weight: 700 }));
  g.push(ln(d0 + laneOff, laneHead - 66, d0 + laneOff + 70, laneHead - 84, '#a8d8ea', 1.2));
  g.push(T(d0 + laneOff + 74, laneHead - 80, '排队通道', { size: 11, fill: '#a8d8ea', weight: 700 }));
  g.push(T(PX0 + 6, Y_TRK1 - 14, `5 号线  ·  B 型  ·  图示 2 节  ·  一列 ${total.toFixed(1)} 米`, { size: 11.5, fill: '#8fa0b3' }));

  /* ======================================= B. alignment, in side elevation */
  const BX = 48, BY = 602, BW = 712, BH = 410;
  panelBox(g, BX, BY, BW, BH, 'B.  车门对得上（立面）',
    '屏蔽门线画在同一组车门中心上。车门、屏蔽门和排队通道，钉的是同一张表。');

  const sB = 28;
  const cx = BX + BW / 2;
  const railY = 792;
  const sideB = car('side-B');
  const sideImg = carImage(sideB, cx, railY, sB);
  g.push(sideImg.svg);
  const offB = carDoors('B');
  const dPx = offB.map((o) => cx + o * sB);
  const dwPx = STOCK.B.doorWidth * sB;
  g.push(T(sideImg.x, sideImg.y - 8, '车身侧面  ·  B 型 19.5 米  ·  每侧 4 门', { size: 11.5, fill: '#8fa0b3' }));
  const py0 = railY + 44;
  let ss = sideImg.x;
  for (const dx of dPx) {
    if (dx - dwPx / 2 > ss) g.push(rect(ss, py0, dx - dwPx / 2 - ss, 10, '#cbd3dc', { stroke: C.ink, sw: 1 }));
    ss = dx + dwPx / 2;
  }
  g.push(rect(ss, py0, sideImg.x + sideImg.w - ss, 10, '#cbd3dc', { stroke: C.ink, sw: 1 }));
  for (const dx of dPx) {
    g.push(rect(dx - dwPx / 2, py0, dwPx, 10, '#7fb2d6', { stroke: C.ink, sw: 1 }));
    g.push(ln(dx - dwPx / 2, py0 + 5, dx + dwPx / 2, py0 + 5, '#eef2f6', 1));
    g.push(ln(dx, railY, dx, py0, C.yellow, 1, '4 4'));
    g.push(ln(dx, py0 + 10, dx, py0 + 26, C.yellow, 1, '4 4'));
    g.push(circ(dx, py0 + 34, 5.5, C.yellow, { stroke: '#0d1116', sw: 1 }));
  }
  g.push(T(sideImg.x, py0 + 60, '屏蔽门线  ·  开口在同一组中心  ·  门板左右滑动', { size: 11.5, fill: '#8fa0b3' }));
  g.push(dimH(dPx[0], dPx[1], py0 + 88, `门距 ${(offB[1] - offB[0]).toFixed(2)} 米`));
  g.push(dimH(dPx[1], dPx[1] + dwPx, py0 + 116, `门宽 ${STOCK.B.doorWidth} 米`, C.glass));
  g.push(T(sideImg.x, py0 + 142, `距车中心的位置：${offB.map((o) => (o >= 0 ? '+' : '') + o.toFixed(2)).join('  ')} 米`, { size: 12, fill: '#a9b8c8', mono: true }));
  g.push(T(sideImg.x, py0 + 160, '建造网格是 1 米一格，开口只能往外取整，所以屏蔽门永远不比车门窄。', { size: 11, fill: '#7d8ea3' }));

  /* =========================================== C. auto-wayfinding / routing */
  const CX = 776, CY = 602, CW = 772, CH = 410;
  panelBox(g, CX, CY, CW, CH, 'C.  乘客自己找路',
    '没人会对某个人说「你去 2 号口」。它只能看自己当下的状态，一个点一个点地找。');

  const nodes = [
    ['车门', '下车', C.safety, '让开门口'],
    ['站台', '步行', C.white, '走下车路径'],
    ['导向', '读取', C.yellow, '立牌 8 米 · 地贴 −15 秒'],
    ['竖向', '选择', C.asc, '扶梯 / 楼梯 / 电梯'],
    ['站厅', '步行', C.lineB, '跟着黄色导向带'],
    ['闸机', '排队', C.green, '从队尾加入通道'],
    ['出口', '离开', '#d7dde5', '地面出口，进出可设'],
    ['完成', '消失', '#5d6d80', '离开仿真'],
  ];
  const bx = [800, 980, 1160, 1340], by1 = 692, by2 = 824, bw = 160, bh = 56;
  const place = (i) => ({ x: bx[i < 4 ? i : 7 - i], y: i < 4 ? by1 : by2 });
  for (let i = 0; i < nodes.length; i++) {
    const p = place(i);
    g.push(rect(p.x, p.y, bw, bh, '#0f1620', { rx: 10, stroke: nodes[i][2], sw: 1.4 }));
    g.push(rect(p.x, p.y, bw, 4, nodes[i][2], { rx: 2 }));
    g.push(T(p.x + 12, p.y + 24, nodes[i][0], { size: 12.5, fill: nodes[i][2], weight: 800, ls: 0.4 }));
    g.push(T(p.x + 12, p.y + 42, nodes[i][3], { size: 9.6, fill: '#8fa0b3' }));
    g.push(T(p.x + bw - 10, p.y + 42, nodes[i][1], { size: 10, fill: '#5d6d80', anchor: 'end', mono: true }));
    if (i < nodes.length - 1) {
      const q = place(i + 1);
      if (p.y === q.y) {
        // Point along the flow, not along the page: the bottom row runs right to left
        // (站厅 → 闸机 → 出口 → 完成), so its arrows have to lean that way too.
        const rightwards = p.x < q.x;
        const from = rightwards ? p.x + bw + 2 : p.x - 2;
        const to = rightwards ? q.x - 3 : q.x + bw + 3;
        g.push(arrowLine(from, p.y + bh / 2, to, p.y + bh / 2, '#5d6d80', 2));
      } else {
        g.push(arrowLine(p.x + bw / 2, p.y + bh + 2, q.x + bw / 2, q.y - 3, '#5d6d80', 2));
      }
    }
  }
  const routePath = `M ${bx[0] + bw / 2} ${by1 + bh / 2} L ${bx[3] + bw / 2} ${by1 + bh / 2} L ${bx[3] + bw / 2} ${by2 + bh / 2} L ${bx[0] + bw / 2} ${by2 + bh / 2}`;
  g.push(`<path d="${routePath}" fill="none" stroke="${C.yellow}" stroke-width="2" stroke-dasharray="1 9" stroke-linecap="round" opacity="0.7"/>`);
  g.push(mover(routePath, C.yellow, '0s', { r: 7, dur: '11s', noFade: true }));
  g.push(mover(routePath, C.teal, '1.4s', { r: 5, dur: '11s', noFade: true }));
  g.push(mover(routePath, C.red, '2.8s', { r: 5, dur: '11s', noFade: true }));
  g.push(MUL(796, 908, [
    '规则一句话：挑预期等待还在你耐心内、代价又最低的那条路。哪条队等超过耐心，',
    '就改道——闸机、扶梯、车门，用的都是同一条规则。坐轮椅的人，只考虑电梯和坡道。',
    '上车也一样：挑一道愿意接纳你的队伍；要坐的线路没进站，',
    '就在站台上等。导向设施只改你做决定的耗时，不改这几条规则。',
  ], { size: 10.6, fill: '#a9b8c8', lh: 17 }));

  /* ========================================= D. the door cadence, per type */
  const DX0 = 48, DY = 1034, DW = 1504, DH = 300;
  panelBox(g, DX0, DY, DW, DH, 'D.  各车型的车门间距',
    '一个函数，四种答案。同一组中心，决定车身、屏蔽门和通道。');

  const sD = 16;
  const railD = 1210;
  /** Half a 22 m frame at 16 px/m: every class is drawn in the same box, so it shares this. */
  const CAR_HALF_PX = 176;
  STOCK_CLASSES.forEach((cls, ti) => {
    const t = STOCK[cls];
    const x = 76 + ti * 372;
    const centre = x + CAR_HALF_PX;
    const side = car(`side-${cls}`);
    const img = carImage(side, centre, railD, sD);
    g.push(T(x, railD - 88, `${cls} 型`, { size: 15, weight: 800, fill: C.white, ls: 0.6 }));
    g.push(img.svg);
    const offs = carDoors(cls);
    const dwo = t.doorWidth * sD;
    const py = railD + 22;
    let p0 = img.x;
    for (const o of offs) {
      // From the picture's **centre**, which is the car's centre — not from its left
      // edge, which for a 22 m class is the car's nose and for a 16.8 m one is 2.6 m of
      // empty frame. Reading the door positions off the wrong end put every guide line
      // and every screen-door opening up to 176 px away from the door above it.
      const dx = centre + o * sD;
      if (dx - dwo / 2 > p0) g.push(rect(p0, py, dx - dwo / 2 - p0, 8, '#cbd3dc', { stroke: C.ink, sw: 1 }));
      g.push(rect(dx - dwo / 2, py, dwo, 8, '#7fb2d6', { stroke: C.ink, sw: 1 }));
      g.push(ln(dx, railD, dx, py, C.yellow, 1, '3 4'));
      p0 = dx + dwo / 2;
    }
    g.push(rect(p0, py, img.x + img.w - p0, 8, '#cbd3dc', { stroke: C.ink, sw: 1 }));
    const pairs = offs
      .filter((o) => o > 0.001)
      .map((o) => o.toFixed(2))
      .join(' / ');
    g.push(T(x, py + 30, `${t.length} 米车体  ·  每侧 ${t.doorsPerSide} 门  ·  门宽 ${t.doorWidth} 米`, { size: 11, fill: '#a9b8c8', mono: true }));
    g.push(T(x, py + 46, `门距 ${(offs[1] - offs[0]).toFixed(2)} 米  ·  中心距 ±${pairs} 米`, { size: 11, fill: C.yellow, mono: true }));
  });
  // L is the class whose cadence runs unbroken across a car boundary: three doors on a
  // 5.6 m pitch leave the last door and the next car's first exactly one pitch apart.
  const lOff = carDoors('L');
  const lPitch = lOff[1] - lOff[0];
  const lLastFromStart = STOCK.L.length / 2 + lOff[lOff.length - 1];
  const lBoundary = STOCK.L.length - lLastFromStart + DOOR_END_INSET;
  g.push(T(76, DY + DH - 22, `L 型只有 3 门，间距正好 ${lPitch.toFixed(1)} 米 —— 跨过车厢接缝也不断：末门到下一节首门 ${lBoundary.toFixed(1)} 米，还是同一个间距。`, { size: 11.5, fill: '#7d8ea3' }));

  g.push(T(48, H - 16, '动画的约定：车门间距说了算，屏蔽门跟着它走，排队通道也钉在同一个 x 上。换个车型，三样一起挪。', { size: 12.5, fill: '#7d8ea3' }));
  return sheet(W, H, g.join(''));
}
