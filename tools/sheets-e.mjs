// Concept sheet 12 - platform doors, trains and passenger flow, animated.
//
// Everything here is placed from ONE piece of geometry: the car door centres
// (`carDoorCenters`). The car doors in the drawing, the PSD openings, the queue
// lanes and the boarding / alighting paths are all derived from it, so the
// screen doors can never drift away from the doors they are supposed to meet.
//
// The motion is CSS (keyframes injected by sheet()), so the sheet animates
// wherever it is shown - including inside an <img>, which is how the site and
// the README embed it. The loop is:
//   train enters -> docks -> PSD leaves open -> queues feed the doors, people
//   alight -> PSD closes -> train leaves -> repeat.
import {
  C, T, MUL, title, sheet, n, carDoorCenters, STOCK, amT, mover, group, passT,
} from './iso.mjs';

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

/* --------------------------------------------------------------- animation */
const DUR = '20s';                       // one full enter / dwell / leave cycle
const T_IN = 0.16, T_OUT = 0.70;         // train docked between these keyTimes
const P_OPEN0 = 0.19, P_OPEN1 = 0.24, P_CLOSE0 = 0.64, P_CLOSE1 = 0.69;

/* =================================================================== sheet */
export function artPlatformFlow() {
  const W = 1600, H = 1250;
  const g = [];

  g.push(title(48, 62, '概念 12 // 站台：车门与客流',
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
  const Y_TRK1 = 560;
  const Y_CAR0 = 472, Y_CAR1 = 554;

  const stock = STOCK.B;
  const CARLEN = stock.len, CARGAP = 1.0, CARSTART = 3.0, NCARS = 2;
  const dOff = carDoorCenters(CARLEN, stock.doors, stock.doorW);
  const doorsPx = [];
  for (let c = 0; c < NCARS; c++) {
    const centre = CARSTART + c * (CARLEN + CARGAP) + CARLEN / 2;
    for (const o of dOff) doorsPx.push(MX(centre + o));
  }
  const DOORW = stock.doorW * s;
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

  /* door alignment guides: car door -> PSD opening -> alight path */
  for (const dx of doorsPx) g.push(ln(dx, Y_BAND1 + 6, dx, Y_TRK1 - 6, C.yellow, 1, '4 5'));

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
  g.push(rect(PX0, Y_PEDGE - 2, platW, 2, stock.col, { opacity: 0.9 }));   // line-colour header
  g.push(...psd, ...leaves);

  /* track bed */
  g.push(rect(PX0, Y_PEDGE + 12, platW, Y_TRK1 - (Y_PEDGE + 12), '#232a33', { rx: 3 }));
  g.push(ln(PX0, 488, PX0 + platW, 488, '#4a545f', 2.5, '12 9'));
  g.push(ln(PX0, 542, PX0 + platW, 542, '#4a545f', 2.5, '12 9'));

  /* the train, drawn docked inside an animated group */
  const train = [];
  for (let c = 0; c < NCARS; c++) {
    const x0 = MX(CARSTART + c * (CARLEN + CARGAP));
    const w = CARLEN * s;
    train.push(rect(x0, Y_CAR0, w, Y_CAR1 - Y_CAR0, '#eef2f6', { rx: 10, stroke: C.ink, sw: 2 }));
    train.push(rect(x0 + 16, Y_CAR0 + 22, w - 32, 20, '#dbe2e9', { rx: 8 }));
    train.push(rect(x0, Y_CAR0, w, 12, '#c3ccd5', { rx: 5, stroke: C.ink, sw: 1 }));
    train.push(rect(x0, Y_CAR0 + 13, w, 5, stock.col, { opacity: 1 }));
    for (const dx of doorsPx) {
      if (dx > x0 + 10 && dx < x0 + w - 10) {
        train.push(rect(dx - HALF, Y_CAR0 - 1, DOORW, 18, '#2b3a49', { rx: 2, stroke: C.ink, sw: 1.4 }));
        train.push(ln(dx, Y_CAR0, dx, Y_CAR0 + 17, '#7d8ea3', 1.2));
      }
    }
  }
  const trainShift = Math.round((CARSTART + NCARS * (CARLEN + CARGAP) + 4) * s);
  g.push(group(train.join(''), passT(trainShift, DUR)));
  g.push(T(PX0 + 6, Y_TRK1 - 14, '2 号线  ·  B 型  ·  图示 2 节', { size: 11.5, fill: '#8fa0b3' }));

  /* passengers that move: board from the lane heads, alight down the middle */
  const movers = [];
  doorsPx.forEach((dx, i) => {
    const b = (i * 0.22).toFixed(2);
    for (const sgn of [-1, 1]) {
      const lx = dx + sgn * laneOff;
      const path = `M ${n(lx)} ${n(laneHead - 6)} L ${n(dx + sgn * 15)} ${n(Y_PEDGE + 4)} L ${n(dx + sgn * 6)} ${n(Y_CAR0 + 6)}`;
      movers.push(mover(path, AG[(i * 3 + (sgn > 0 ? 1 : 0)) % AG.length], `${b}s`));
    }
    const aPath = `M ${n(dx)} ${n(Y_CAR0 + 8)} L ${n(dx)} ${n(Y_PEDGE + 6)} L ${n(dx)} ${n(laneTop - 6)}`;
    movers.push(mover(aPath, AG[(i * 2 + 4) % AG.length], `${(i * 0.18).toFixed(2)}s`));
    movers.push(mover(aPath, AG[(i * 2 + 6) % AG.length], `${(0.5 + i * 0.18).toFixed(2)}s`));
  });
  g.push(...movers);

  /* labels + the one annotated door */
  g.push(T(PX0 + 8, Y_PTOP + 26, '站台', { size: 12.5, fill: '#5d6d80', weight: 700, ls: 0.6 }));
  g.push(T(PX0 + platW - 14, Y_PTOP + 26, '屏蔽门开口对齐车门中心', { size: 11.5, fill: '#8fa0b3', anchor: 'end' }));
  const d0 = doorsPx[2];
  g.push(arrowLine(d0 + 72, Y_CAR0 + 32, d0 + 14, Y_CAR0 + 6, C.white, 1.4));
  g.push(T(d0 + 78, Y_CAR0 + 36, '车门 1.3 米', { size: 11, fill: '#dfe7f0', weight: 700 }));
  g.push(ln(d0 - HALF, Y_PEDGE + 20, d0 - HALF - 58, Y_PEDGE + 44, C.glass, 1.2));
  g.push(T(d0 - HALF - 62, Y_PEDGE + 48, '屏蔽门门板', { size: 11, fill: C.glass, anchor: 'end', weight: 700 }));
  g.push(ln(d0 + laneOff, laneHead - 66, d0 + laneOff + 70, laneHead - 84, '#a8d8ea', 1.2));
  g.push(T(d0 + laneOff + 74, laneHead - 80, '排队通道', { size: 11, fill: '#a8d8ea', weight: 700 }));

  /* ======================================= B. alignment, in side elevation */
  const BX = 48, BY = 602, BW = 712, BH = 410;
  panelBox(g, BX, BY, BW, BH, 'B.  车门对得上（立面）',
    '车身侧面和屏蔽门线，画的是同一组车门中心。那些引导线就是约定。');

  const sB = 29;
  const cw = stock.len * sB;
  const cx0 = 110, cy0 = 690, chh = 116;
  const cx = cx0 + cw / 2;
  const dPx = dOff.map((o) => cx + o * sB);
  const dwPx = stock.doorW * sB;
  g.push(rect(cx0, cy0, cw, chh, '#eef2f6', { rx: 9, stroke: C.ink, sw: 2.2 }));
  g.push(rect(cx0 + 8, cy0 + 14, cw - 16, 22, '#26333f', { rx: 4 }));
  g.push(rect(cx0, cy0 + chh - 8, cw, 8, stock.col));
  for (const dx of dPx) {
    g.push(rect(dx - dwPx / 2, cy0 + 6, dwPx, chh - 14, '#41525f', { rx: 3, stroke: C.ink, sw: 1.4 }));
    g.push(rect(dx - dwPx / 2 + 3, cy0 + 16, dwPx - 6, 20, '#33424f', { rx: 2 }));
    g.push(ln(dx, cy0 + 6, dx, cy0 + chh - 8, '#7d8ea3', 1.2));
    g.push(rect(dx - dwPx / 2, cy0 + 6, dwPx, chh - 14, 'none', { rx: 3, stroke: stock.col, sw: 1 }));
  }
  g.push(T(cx0, cy0 - 12, '车身侧面  ·  B 型 19.5 米  ·  每侧 4 门', { size: 11.5, fill: '#8fa0b3' }));
  const py0 = cy0 + chh + 44;
  let ss = cx0;
  for (const dx of dPx) {
    if (dx - dwPx / 2 > ss) g.push(rect(ss, py0, dx - dwPx / 2 - ss, 10, '#cbd3dc', { stroke: C.ink, sw: 1 }));
    ss = dx + dwPx / 2;
  }
  g.push(rect(ss, py0, cx0 + cw - ss, 10, '#cbd3dc', { stroke: C.ink, sw: 1 }));
  for (const dx of dPx) {
    g.push(rect(dx - dwPx / 2, py0, dwPx, 10, '#7fb2d6', { stroke: C.ink, sw: 1 }));
    g.push(ln(dx - dwPx / 2, py0 + 5, dx + dwPx / 2, py0 + 5, '#eef2f6', 1));
    g.push(ln(dx, cy0 + chh, dx, py0, C.yellow, 1, '4 4'));
    g.push(ln(dx, py0 + 10, dx, py0 + 26, C.yellow, 1, '4 4'));
    g.push(circ(dx, py0 + 34, 5.5, C.yellow, { stroke: '#0d1116', sw: 1 }));
  }
  g.push(T(cx0, py0 + 60, '屏蔽门线  ·  开口在同一组中心  ·  门板左右滑动', { size: 11.5, fill: '#8fa0b3' }));
  const pitch = dOff[1] - dOff[0];
  g.push(dimH(dPx[0], dPx[0] + dwPx, py0 + 108, `门宽 ${stock.doorW} 米`));
  g.push(dimH(dPx[0], dPx[1], py0 + 84, `门距 ${pitch.toFixed(2)} 米`));
  g.push(T(cx0, py0 + 132, `距车中心的位置：${dOff.map((o) => (o >= 0 ? '+' : '') + o.toFixed(2)).join('  ')} 米`, { size: 12, fill: '#a9b8c8', mono: true }));
  g.push(T(cx0, py0 + 150, '建造网格是 1 米一格，开口只能往外取整，所以屏蔽门永远不比车门窄。', { size: 11, fill: '#7d8ea3' }));

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
        const x1 = Math.min(p.x, q.x) + bw, x2 = Math.max(p.x, q.x);
        g.push(arrowLine(x1 + 2, p.y + bh / 2, x2 - 3, p.y + bh / 2, '#5d6d80', 2));
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
    '就在站台上等。导向设施只改你做决定的耗时，不改这张图。',
  ], { size: 10.6, fill: '#a9b8c8', lh: 17 }));

  /* ========================================= D. the door cadence, per type */
  const DX0 = 48, DY = 1030, DW = 1504, DH = 192;
  panelBox(g, DX0, DY, DW, DH, 'D.  各车型的车门间距',
    '一个函数，三种答案。同一组中心，决定车身、屏蔽门和通道。');
  [STOCK.A, STOCK.B, STOCK.C].forEach((t, ti) => {
    const x = 76 + ti * 480;
    const sD = 16;
    const w = t.len * sD;
    const off = carDoorCenters(t.len, t.doors, t.doorW);
    const cc = x + w / 2;
    const y = 1112;
    g.push(T(x, y - 12, `${t.id} 型`, { size: 15, weight: 800, fill: t.col, ls: 0.6 }));
    g.push(rect(x, y, w, 40, '#eef2f6', { rx: 6, stroke: C.ink, sw: 1.6 }));
    g.push(rect(x + 6, y + 7, w - 12, 10, '#26333f', { rx: 3 }));
    g.push(rect(x, y + 34, w, 6, t.col));
    for (const o of off) {
      const dx = cc + o * sD;
      const dwo = t.doorW * sD;
      g.push(rect(dx - dwo / 2, y + 5, dwo, 30, '#41525f', { rx: 2, stroke: C.ink, sw: 1 }));
      g.push(ln(dx, y + 5, dx, y + 40, '#7d8ea3', 1.1));
    }
    const py = y + 56;
    let p0 = x;
    for (const o of off) {
      const dx = cc + o * sD;
      const dwo = t.doorW * sD;
      if (dx - dwo / 2 > p0) g.push(rect(p0, py, dx - dwo / 2 - p0, 8, '#cbd3dc', { stroke: C.ink, sw: 1 }));
      g.push(rect(dx - dwo / 2, py, dwo, 8, '#7fb2d6', { stroke: C.ink, sw: 1 }));
      g.push(ln(dx, y + 40, dx, py, C.yellow, 1, '3 4'));
      p0 = dx + dwo / 2;
    }
    g.push(rect(p0, py, x + w - p0, 8, '#cbd3dc', { stroke: C.ink, sw: 1 }));
    const pairs = off.filter((o) => o > 0).map((o) => o.toFixed(2)).join(' / ');
    g.push(T(x, y + 84, `${t.len} 米车体  ·  每侧 ${t.doors} 门  ·  门宽 ${t.doorW} 米`, { size: 11.5, fill: '#a9b8c8', mono: true }));
    g.push(T(x, y + 100, `中心距  ±${pairs} 米`, { size: 11.5, fill: C.yellow, mono: true }));
  });

  g.push(T(48, H - 14, '动画的约定：车门间距说了算，屏蔽门跟着它走，排队通道也钉在同一个 x 上。换个车型，三样一起挪。', { size: 12.5, fill: '#7d8ea3' }));
  return sheet(W, H, g.join(''));
}
