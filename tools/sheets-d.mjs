// Concept sheet 10 - queue management: lanes, rails, switchbacks, door queues.
import { C, T, MUL, title, sheet, n, rng, legend, mover, sway, group, dashFlow, breathe } from './iso.mjs';

/* plan-view helpers -------------------------------------------------- */
const rect = (x, y, w, h, fill, o = {}) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${o.rx ? ` rx="${o.rx}"` : ''} fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1.2}"` : ''}${o.opacity ? ` opacity="${o.opacity}"` : ''}/>`;
const agent = (x, y, col, r = 6.5) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" fill="${col}" stroke="#0d1116" stroke-width="1"/>`;
const line = (x1, y1, x2, y2, col, w = 1.4, dash) =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${col}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const arrow = (x1, y1, x2, y2, col, w = 2) =>
  `<path d="M${n(x1)},${n(y1)} L${n(x2)},${n(y2)}" stroke="${col}" stroke-width="${w}" fill="none" marker-end="url(#arw)"/>`;
const dimH = (x1, x2, y, txt, col = C.yellow) =>
  `<path d="M${n(x1)},${n(y)} L${n(x2)},${n(y)}" stroke="${col}" stroke-width="1.2"/>` +
  `<path d="M${n(x1)},${n(y - 4)} L${n(x1)},${n(y + 4)} M${n(x2)},${n(y - 4)} L${n(x2)},${n(y + 4)}" stroke="${col}" stroke-width="1.2"/>` +
  T((x1 + x2) / 2, y - 7, txt, { size: 11.5, fill: col, anchor: 'middle', mono: true });
const panel = (g, x, y, w, h, t, sub) => {
  g.push(rect(x, y, w, h, '#111926', { rx: 14, stroke: '#243040' }));
  if (t) g.push(T(x + 22, y + 32, t, { size: 14, weight: 800, fill: C.yellow, ls: 1.3 }));
  if (sub) g.push(T(x + 22, y + 54, sub, { size: 12.5, fill: '#8fa0b3' }));
};
const AG = [C.red, C.blue, C.green, C.purple, C.pink, C.teal, C.orange, '#d7dde5', '#3f4a58'];

/* a gate bank drawn in plan: three 1 x 2 gates on a 1 m grid ------- */
function gateBank(g, x, y, s, nGates = 3) {
  for (let i = 0; i < nGates; i++) {
    const gx = x + i * 34 * s;
    g.push(rect(gx, y, 16 * s, 30 * s, '#bcc3ca', { rx: 3, stroke: '#0d1116' }));
    g.push(rect(gx + 16 * s, y, 4 * s, 30 * s, C.green, { rx: 1.5 }));
  }
}

/* =================================================================== *
 * 10  QUEUE MANAGEMENT
 * =================================================================== */
export function artQueues() {
  const W = 1600, H = 1180;
  const g = [];
  const rr = rng(4711);
  g.push(`<defs><marker id="arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#9fb3c8"/></marker></defs>`);
  g.push(title(48, 62, '概念 10 // 排队管理',
    '让人排成队',
    '人一窝蜂涌上来，什么都堵死。排成单列，就有序、好算，占地只剩四分之一。这是游戏里最便宜的运力。'));

  /* ---------------------------------------------------------------- A */
  panel(g, 48, 168, 748, 388, 'A.  同样 36 个人，同样 3 台闸机', '左边：一窝蜂地挤。右边：排成三条单列通道。');
  // --- left: blob
  const ax = 90, ay = 300;
  g.push(rect(ax - 10, ay - 12, 300, 232, '#0d141d', { rx: 8 }));
  g.push(rect(ax, ay, 300, 210, '#cfd3d8', { rx: 4 }));
  g.push(rect(ax, ay, 300, 34, '#b9bec4', { rx: 4 }));                       // corridor wall
  g.push(`<ellipse cx="${ax + 150}" cy="${ay + 150}" rx="96" ry="70" fill="${C.red}" opacity=".22"/>`);
  g.push(`<ellipse cx="${ax + 150}" cy="${ay + 150}" rx="60" ry="42" fill="${C.red}" opacity=".22"/>`);
  gateBank(g, ax + 92, ay - 6, 0.9);
  for (let i = 0; i < 36; i++) {
    const a = rr() * Math.PI * 2, r = 6 + rr() * rr() * 76;
    const cxp = ax + 150 + Math.cos(a) * r * 1.25, cyp = ay + 76 + Math.sin(a) * r * 0.95;
    if (cyp < ay + 30) continue;
    // the unruly blob only jostles; nobody holds a place
    g.push(group(agent(cxp, cyp, AG[(rr() * AG.length) | 0]), sway(2.6, '2.2s', `${(rr() * 2.2).toFixed(2)}s`)));
  }
  g.push(T(ax, ay + 232, '没通道：每人 1.4 平方米，服务水平 D，整个堵死', { size: 12, fill: C.red }));
  g.push(T(ax, ay + 250, '前面的互相挤，后来的从侧面往队伍里钻', { size: 11.5, fill: '#7d8ea3' }));
  // --- right: lanes
  const bx = 430, by = 300;
  g.push(rect(bx - 10, by - 12, 336, 232, '#0d141d', { rx: 8 }));
  g.push(rect(bx, by, 336, 210, '#cfd3d8', { rx: 4 }));
  g.push(rect(bx, by, 336, 34, '#b9bec4', { rx: 4 }));
  gateBank(g, bx + 60, by - 6, 0.9);
  for (let lane = 0; lane < 3; lane++) {
    const lx = bx + 66 + lane * 30.6;
    g.push(rect(lx, by + 40, 20, 168, '#a8d8ea', { rx: 2, opacity: 0.5 }));
    g.push(line(lx, by + 40, lx, by + 208, '#8d959d', 1.4));
    g.push(line(lx + 20, by + 40, lx + 20, by + 208, '#8d959d', 1.4));
    for (let s = 0; s < 12; s++) {
      const sy = by + 46 + s * 13.6;
      g.push(line(lx + 2, sy, lx + 18, sy, '#ffffff', 1, '2 3'));
      g.push(agent(lx + 10, sy + 4, AG[(lane * 5 + s) % AG.length], 6));
    }
    // the lane advances toward the gate: one orderly step at a time
    const lanePath = `M ${n(lx + 10)} ${n(by + 206)} L ${n(lx + 10)} ${n(by + 44)}`;
    for (let k = 0; k < 3; k++) {
      g.push(mover(lanePath, AG[(lane * 4 + k) % AG.length], `${(lane * 0.5 + k * 1.1).toFixed(2)}s`, { r: 6, dur: '3.6s', f0: 0.02, f1: 0.06, f2: 0.9, f3: 0.94 }));
    }
  }
  g.push(T(bx, by + 232, '三条道：每人 1.1 平方米，服务水平 B，每条存 12 人', { size: 12, fill: C.green }));
  g.push(T(bx, by + 250, '先到先得，不外溢，队伍一直通', { size: 11.5, fill: '#7d8ea3' }));

  /* ---------------------------------------------------------------- B */
  panel(g, 812, 168, 740, 388, 'B.  一条通道拆开看', '像带仓库的服务台：后面是格位，前端只有一个服务口。');
  const lx = 900, ly = 300, lw = 40, llen = 470, slot = llen / 13;
  g.push(rect(lx - 26, ly - 22, llen + 120, 250, '#0d141d', { rx: 8 }));
  g.push(rect(lx, ly, llen, lw, '#a8d8ea', { rx: 3, opacity: 0.45 }));
  g.push(line(lx, ly - 4, lx + llen, ly - 4, C.steel, 2));
  g.push(line(lx, ly + lw + 4, lx + llen, ly + lw + 4, C.steel, 2));
  for (let i = 0; i < 13; i++) {
    const sx = lx + i * slot;
    g.push(line(sx, ly, sx, ly + lw, '#ffffff', 1.1, '3 4'));
    if (i < 11) g.push(agent(sx + slot * 0.55, ly + lw / 2, AG[i % AG.length]));
  }
  {
    const lanePath = `M ${n(lx + 6)} ${n(ly + lw / 2)} L ${n(lx + llen + 60)} ${n(ly + lw / 2)}`;
    for (let k = 0; k < 3; k++) {
      g.push(mover(lanePath, AG[k % AG.length], `${(k * 1.2).toFixed(2)}s`, { r: 6, dur: '4.2s', f0: 0.02, f1: 0.06, f2: 0.9, f3: 0.94 }));
    }
  }
  // entry funnel + head
  g.push(`<polygon points="${n(lx + llen)},${n(ly - 26)} ${n(lx + llen + 74)},${n(ly - 26)} ${n(lx + llen + 74)},${n(ly + lw + 26)} ${n(lx + llen)},${n(ly + lw + 26)}" fill="${C.green}" opacity=".16"/>`);
  g.push(rect(lx + llen + 30, ly + 2, 16, lw - 4, '#bcc3ca', { rx: 3, stroke: '#0d1116' }));
  g.push(rect(lx + llen + 46, ly + 2, 5, lw - 4, C.green, { rx: 1.5 }));
  g.push(arrow(lx + llen - 10, ly + lw / 2, lx + llen + 74, ly + lw / 2, '#9fb3c8', 2));
  g.push(T(lx + llen + 82, ly + 26, '服务口：闸机、', { size: 11.5, fill: C.green }));
  g.push(T(lx + llen + 82, ly + 42, '门或设备', { size: 11.5, fill: C.green }));
  g.push(T(lx - 20, ly - 34, '入口（从队尾加入）', { size: 11.5, fill: '#9fb3c8' }));
  g.push(T(lx - 20, ly + lw + 58, '格位 = 0.80 米 —— 比一个肩宽多一点', { size: 11.5, fill: '#8fa0b3' }));
  g.push(dimH(lx, lx + llen, ly + lw + 40, '通道长度 L'));
  g.push(MUL(1140, 452, [
    '容量  =  floor(L / 0.80) + 1      （12 米通道 → 16 人）',
    '速率  ~  45 人/分                 （0.6 米/秒 挪步，单列）',
    '等待  =  队长 / 速率              （可预测，才好设计）',
  ], { size: 12, fill: '#a9b8c8', mono: true, lh: 22 }));
  g.push(T(1140, 522, '同样 1 米宽，一窝蜂也能过约 60 人/分——但前锋乱，', { size: 11.5, fill: '#7d8ea3' }));
  g.push(T(1140, 538, '会堵住旁边的流线，还没人算得出等多久。这就是代价。', { size: 11.5, fill: '#7d8ea3' }));

  /* ---------------------------------------------------------------- C */
  panel(g, 48, 574, 748, 360, 'C.  折返：把队列叠起来', '2 米宽的带子里折四段，存下 20 米长的队。');
  const sx = 110, sy = 700, runLen = 300, gap = 30;
  g.push(rect(sx - 20, sy - 46, runLen + 130, 214, '#0d141d', { rx: 8 }));
  for (let i = 0; i < 4; i++) {
    const yy = sy + i * gap;
    g.push(rect(sx, yy, runLen, 22, '#a8d8ea', { rx: 2, opacity: 0.4 }));
    g.push(line(sx, yy - 3, sx + runLen, yy - 3, C.steel, 2));
    g.push(line(sx, yy + 25, sx + runLen, yy + 25, C.steel, 2));
    for (let s = 0; s < 10; s++) g.push(agent(sx + 16 + s * 28, yy + 11, AG[(i * 3 + s) % AG.length], 5.5));
    g.push(i % 2 === 0 ? arrow(sx + 20, yy + 11, sx + runLen - 20, yy + 11, '#2f7ef2', 1.8)
      : arrow(sx + runLen - 20, yy + 11, sx + 20, yy + 11, '#2f7ef2', 1.8));
  }
  g.push(line(sx + runLen, sy + 11, sx + runLen, sy + gap + 11, C.steel, 2));
  g.push(line(sx, sy + gap + 11, sx, sy + 2 * gap + 11, C.steel, 2));
  g.push(line(sx + runLen, sy + 2 * gap + 11, sx + runLen, sy + 3 * gap + 11, C.steel, 2));
  {
    const snake = `M ${n(sx + 20)} ${n(sy + 11)} L ${n(sx + runLen - 20)} ${n(sy + 11)} L ${n(sx + runLen - 20)} ${n(sy + gap + 11)} L ${n(sx + 20)} ${n(sy + gap + 11)} L ${n(sx + 20)} ${n(sy + 2 * gap + 11)} L ${n(sx + runLen - 20)} ${n(sy + 2 * gap + 11)} L ${n(sx + runLen - 20)} ${n(sy + 3 * gap + 11)} L ${n(sx + 20)} ${n(sy + 3 * gap + 11)}`;
    for (let k = 0; k < 4; k++) {
      g.push(mover(snake, AG[k % AG.length], `${(k * 1.5).toFixed(2)}s`, { r: 6, dur: '11s', f0: 0.02, f1: 0.08, f2: 0.9, f3: 0.96 }));
    }
  }
  g.push(dimH(sx, sx + runLen, sy + 4 * gap + 22, '4 段 × 5 米 = 20 米队列'));
  g.push(T(sx + runLen + 40, sy + 11, '入', { size: 11.5, fill: C.green }));
  g.push(T(sx - 16, sy + 3 * gap + 11, '出', { size: 11.5, fill: C.red, anchor: 'end' }));
  g.push(MUL(110, 866, [
    '每折占 2 × 4 米，折四回  →  8 平方米就存下 40 人',
    '同样这 40 人要是散着站，得占约 48 平方米，还把整个房间堵住',
  ], { size: 12, fill: '#a9b8c8', lh: 20 }));
  g.push(T(110, 910, '代价：服务口一卡，折返就成了陷阱 —— 整条队全拴在那一个口上。', { size: 11.5, fill: '#7d8ea3' }));

  /* ---------------------------------------------------------------- D */
  panel(g, 812, 574, 740, 360, 'D.  最要紧的一种：站台门口怎么排', '中间下车，两侧排队。屏蔽门正对车门中心（见第 12 张）。');
  const px = 856, py = 700, pw = 650, ph = 150;
  g.push(rect(px - 16, py - 40, pw + 32, ph + 96, '#0d141d', { rx: 8 }));
  g.push(rect(px, py, pw, ph, '#cfd3d8', { rx: 4 }));                      // platform
  g.push(rect(px, py + ph, pw, 22, C.maroon, { rx: 3 }));                  // platform edge zone
  g.push(rect(px, py + ph + 22, pw, 30, '#2b323a', { rx: 3 }));            // track
  // one door cadence drives both the screen and the car: the PSD opening and the
  // door mark on the train sit on the same x, with a guide tying them together.
  const doorX = [0.18, 0.5, 0.82].map((f) => px + pw * f);
  const POFF = 15;
  g.push(rect(px + 40, py + ph + 24, pw - 80, 26, '#d8dee6', { rx: 4 }));  // train
  for (const dx of doorX) {
    g.push(rect(dx - POFF, py + ph + 24, POFF * 2, 26, '#2b3a49', { stroke: '#0d1116', sw: 1 }));
    g.push(line(dx, py + ph + 4, dx, py + ph + 22, C.yellow, 1.2, '3 3'));
  }
  g.push(T(px + 8, py - 14, '站台', { size: 11.5, fill: '#7d8ea3' }));
  g.push(T(px + pw - 8, py + ph + 46, '列车', { size: 11.5, fill: '#8fa0b3', anchor: 'end' }));
  doorX.forEach((dx, di) => {
    g.push(rect(dx - POFF, py + ph - 4, POFF * 2, 10, C.lineB, { rx: 2 }));  // PSD door
    g.push(T(dx, py + ph + 6, '屏蔽门', { size: 10.5, fill: C.lineB, anchor: 'middle' }));
    // alighting path down the middle of the pair
    g.push(rect(dx - 14, py + 30, 28, ph - 34, C.safety, { rx: 3, opacity: 0.16 }));
    g.push(arrow(dx, py + ph - 12, dx, py + 34, C.safety, 2.4));
    g.push(mover(`M ${n(dx)} ${n(py + ph - 16)} L ${n(dx)} ${n(py + 32)}`, C.safety, `${(di * 0.4).toFixed(2)}s`, { r: 5.5, dur: '3.4s', f0: 0.02, f1: 0.08, f2: 0.86, f3: 0.94 }));
    g.push(T(dx, py + 22, '下车', { size: 10.5, fill: C.safety, anchor: 'middle', weight: 700 }));
    // two boarding lanes flanking it, each pointing at the door
    for (const sgn of [-1, 1]) {
      const lx0 = dx + sgn * 52 - 9;
      g.push(rect(lx0, py + 26, 18, ph - 30, '#a8d8ea', { rx: 2, opacity: 0.5 }));
      for (let s = 0; s < 7; s++) g.push(agent(lx0 + 9, py + 34 + s * 15, AG[(di + s) % AG.length], 5));
      g.push(arrow(dx + sgn * 60, py + 34, dx + sgn * 40, py + ph - 14, '#2f7ef2', 1.6));
      g.push(mover(`M ${n(dx + sgn * 58)} ${n(py + 36)} L ${n(dx + sgn * 42)} ${n(py + ph - 16)}`, '#2f7ef2', `${(di * 0.35 + (sgn > 0 ? 0.7 : 0)).toFixed(2)}s`, { r: 5.5, dur: '3.4s', f0: 0.02, f1: 0.08, f2: 0.86, f3: 0.94 }));
      g.push(T(dx + sgn * 60, py + 20, '排队', { size: 10.5, fill: '#2f7ef2', anchor: 'middle' }));
    }
  });
  g.push(MUL(856, 946, [
    '每道门配两条道，各约 45 人/分 = 90 人/分，可门只过得去 72 人/分，瓶颈就在门上——',
    '这才是正确答案，也是停站时间会成为设计变量的原因。',
    '用涂装划通道、再加栏杆，正是中国地铁每个站台的日常。',
  ], { size: 12, fill: '#a9b8c8', lh: 20 }));

  /* ---------------------------------------------------------------- E */
  panel(g, 48, 956, 1504, 178, 'E.  就是这五样', '五个都是普通模块：占一块地、带一个速率，能写进存档。');
  const mods = [
    ['排队栏杆', '每米 1 × 1 格', '实体通道。不能插队，不会外溢。', C.steel],
    ['伸缩隔离带', '1 × 1 格', '可伸缩，运行时开关。', C.yellow],
    ['排队通道，单列', '每米 1 × 1 格', '每 12 米 16 人，约 45 人/分。', C.asc],
    ['排队通道，并排两人', '每米 2 × 1 格', '运力翻倍，秩序减半。', C.blue],
    ['折返排队', '每折 2 × 4 格', '8 平方米 40 人。只服务一个出口。', C.purple],
  ];
  mods.forEach(([name, size, note, col], i) => {
    const mx = 76 + i * 296;
    g.push(rect(mx, 1022, 280, 96, '#0f1620', { rx: 10, stroke: col, sw: 1.2 }));
    g.push(rect(mx, 1022, 280, 4, col, { rx: 2 }));
    g.push(T(mx + 16, 1050, name, { size: 13.5, weight: 700, fill: '#eaf0f6' }));
    g.push(T(mx + 16, 1070, size, { size: 11.5, fill: col, mono: true }));
    g.push(T(mx + 16, 1094, note.length > 22 ? note.slice(0, 22) : note, { size: 11, fill: '#8fa0b3' }));
    if (note.length > 22) g.push(T(mx + 16, 1108, note.slice(22, 44), { size: 11, fill: '#8fa0b3' }));
  });
  return sheet(W, H, g.join(''));
}
