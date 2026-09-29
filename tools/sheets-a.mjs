// Concept sheets 01-04
import {
  C, PCOL, TW, TH, ZU, boxSvg, rboxSvg, quadSvg, faceSvg, rampSvg, Scene, px, py, P, pstr, poly,
  T, MUL, tag, legend, title, sheet, callout, leader, rng, shade, n,
} from './iso.mjs';

/* =================================================================== *
 * 02  VERTICAL SECTION
 * =================================================================== */
export function artSection() {
  const W = 1600, H = 1120;
  const g = [];
  const GY = 430;
  const B1f = 640, B2f = 820, B3f = 1000;
  const L1 = '#e5484d', L2 = '#2f7ef2', L3 = '#f2b32c';
  const CORE0 = 1140, CORE1 = 1500;

  g.push(`<rect x="0" y="0" width="${W}" height="${GY}" fill="#101825"/>`);
  g.push(`<rect x="0" y="0" width="${W}" height="${GY}" fill="url(#glow)"/>`);
  for (const [cx, cy, s] of [[240, 130, 1], [560, 210, .75], [1180, 300, .8]]) {
    g.push(`<g opacity=".09" fill="#9fc4ea" transform="translate(${cx},${cy}) scale(${s})"><ellipse cx="0" cy="0" rx="70" ry="24"/><ellipse cx="-50" cy="10" rx="45" ry="18"/><ellipse cx="45" cy="12" rx="40" ry="16"/></g>`);
  }
  g.push(`<rect x="0" y="${GY}" width="${W}" height="${H - GY}" fill="url(#soilHatch)"/>`);
  g.push(`<rect x="0" y="${GY}" width="${W}" height="9" fill="#2fb344" opacity=".5"/>`);
  g.push(title(48, 40, '概念 02 // 纵剖面', '一座车站，四个层'));

  /* ---- Line 1 on its viaduct ---- */
  g.push(`<rect x="180" y="266" width="800" height="26" fill="#8a939f" stroke="${C.ink}" stroke-width="2.5"/>`);
  for (let x = 250; x <= 900; x += 216) {
    g.push(`<rect x="${x}" y="292" width="34" height="${GY - 292}" fill="#6c757f" stroke="${C.ink}" stroke-width="2.5"/>`);
    g.push(`<rect x="${x - 14}" y="${GY - 14}" width="62" height="14" fill="#5b6570"/>`);
  }
  trainSide(g, 210, 150, 740, 3.9, L1, '1', 'catenary');
  g.push(`<rect x="174" y="306" width="356" height="42" rx="7" fill="#0b1119" opacity=".82"/>`);
  g.push(T(180, 322, '1 号线  —  A 型 6 节  —  接触网 1500 V 直流  —  无屏蔽门', { size: 13, fill: L1, weight: 700 }));
  g.push(T(180, 342, '地面以上：站台露天，直接受天气影响', { size: 12, fill: '#8fa0b3' }));

  const stationBox = (x0, y0, x1, y1) =>
    g.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#0d1219" stroke="#2a3542" stroke-width="2"/>`);

  const room = (x0, x1, yTop, yFloor, name, col, sub) => {
    g.push(`<rect x="${x0}" y="${yTop}" width="${x1 - x0}" height="${yFloor - yTop}" fill="#151d28"/>`);
    g.push(`<rect x="${x0}" y="${yTop}" width="${x1 - x0}" height="${yFloor - yTop}" fill="none" stroke="#39465a" stroke-width="2"/>`);
    g.push(`<rect x="${x0}" y="${yFloor - 18}" width="${x1 - x0}" height="18" fill="#5b6570"/>`);
    g.push(`<rect x="${x0}" y="${yFloor - 18}" width="${x1 - x0}" height="4" fill="#79848f"/>`);
    g.push(T(x0 + 18, yTop + 30, name, { size: 15, weight: 800, fill: col, ls: 1.2 }));
    if (sub) g.push(T(x0 + 18, yTop + 50, sub, { size: 11.5, fill: '#6f8299' }));
  };

  /* ---- the core first: it is a shaft in its own right ---- */
  stationBox(200, 470, 1140, 1000);
  stationBox(CORE0, 434, CORE1, 1000);
  room(200, 1140, 470, B1f, 'B1   站厅  —  闸机、商铺、服务', '#8fa3ba', '闸机以外为非付费区');
  room(200, 1140, 700, B2f, 'B2   2 号线站台', L2, 'B 型车、第三轨、站台屏蔽门');
  room(200, 1140, 880, B3f, 'B3   3 号线站台', L3, 'C 型车、第三轨、同台换乘');

  /* ---- surface: plaza, pavilion over the core, ad board ---- */
  g.push(T(600, 350, '地面   0.0 米', { size: 15, fill: '#cfe0f0', weight: 800, ls: 1.2 }));
  g.push(T(600, 372, '站前广场、公交与出租车停靠、两个出入口', { size: 12.5, fill: '#9fb3c8' }));
  g.push(`<rect x="690" y="${GY - 46}" width="96" height="46" fill="#3b4756" stroke="${C.ink}" stroke-width="2"/>`);
  g.push(T(738, GY - 18, '公交', { size: 12, fill: '#cfe0f0', anchor: 'middle' }));
  g.push(`<rect x="${CORE0 + 20}" y="262" width="${CORE1 - CORE0 - 40}" height="${GY - 262}" fill="#dfe4e8" stroke="${C.ink}" stroke-width="2.5"/>`);
  g.push(`<rect x="${CORE0}" y="240" width="${CORE1 - CORE0}" height="24" fill="${L1}" stroke="${C.ink}" stroke-width="2.5"/>`);
  g.push(T((CORE0 + CORE1) / 2, 342, '地铁', { size: 30, weight: 800, fill: '#18324d', anchor: 'middle', ls: 4 }));
  g.push(T((CORE0 + CORE1) / 2, 368, '1 号口', { size: 13, fill: '#4b5b6d', anchor: 'middle' }));
  g.push(`<rect x="${CORE0 + 80}" y="382" width="120" height="48" fill="#2b3a49" stroke="${C.ink}" stroke-width="2"/>`);
  g.push(`<rect x="1010" y="316" width="112" height="114" fill="#1a1f27" stroke="${C.teal}" stroke-width="2"/>`);
  g.push(T(1066, 384, '广告', { size: 22, weight: 800, fill: C.teal, anchor: 'middle', ls: 3 }));

  /* ---- vertical circulation inside the core ---- */
  const band = (x0, y0, x1, y1, t, col, label) => {
    g.push(`<polygon points="${x0},${y0} ${x1},${y1} ${x1},${y1 + t} ${x0},${y0 + t}" fill="${col}" opacity=".92" stroke="${C.ink}" stroke-width="2"/>`);
    g.push(`<path d="M${x0 + 8},${y0 + (y1 - y0) / 2 + 6} L${x1 - 8},${y1 + (y1 - y0) / 2 + 6}" stroke="#08111a" stroke-width="2" opacity=".3"/>`);
    if (label) g.push(T((x0 + x1) / 2, (y0 + y1) / 2 + 14, label, { size: 12.5, fill: '#08111a', anchor: 'middle', weight: 800 }));
  };
  band(1210, B1f, 1330, GY + 4, 26, C.asc, '扶梯');
  band(1210, B1f, 1330, B2f, 26, C.asc, '扶梯');
  band(1210, B2f, 1330, B3f, 26, C.asc, '扶梯');
  band(1360, B1f, 1480, B2f, 26, C.yellow, '楼梯');
  band(1360, B2f, 1480, B3f, 26, C.yellow, '楼梯');
  g.push(`<rect x="1150" y="${GY - 4}" width="42" height="${B3f - GY + 4}" fill="#1b2430" stroke="#98a4b1" stroke-width="2.5"/>`);
  g.push(`<rect x="1154" y="${GY + 4}" width="34" height="52" fill="#8ec9e6" opacity=".9" stroke="${C.ink}" stroke-width="2"/>`);
  g.push(`<rect x="1154" y="${B2f - 46}" width="34" height="46" fill="#8ec9e6" opacity=".9" stroke="${C.ink}" stroke-width="2"/>`);
  g.push(T(1171, GY - 14, '电梯', { size: 11.5, fill: '#9fb3c8', weight: 800, anchor: 'middle' }));
  g.push(T(CORE0 + 22, 1018, '竖向交通核', { size: 11.5, fill: C.asc, weight: 800, ls: 1.2 }));

  /* ---- B1 concourse contents ---- */
  for (let i = 0; i < 6; i++) g.push(`<rect x="${700 + i * 34}" y="${B1f - 62}" width="26" height="62" fill="#98a4b1" stroke="${C.ink}" stroke-width="2"/>`);
  g.push(`<rect x="696" y="${B1f - 70}" width="212" height="8" fill="${C.green}"/>`);
  g.push(T(696, B1f - 80, '闸机  —  每台闸机各自承担通过量', { size: 11.5, fill: C.green, weight: 700 }));
  for (let i = 0; i < 4; i++) g.push(`<rect x="${400 + i * 46}" y="${B1f - 72}" width="38" height="72" fill="${C.blueD}" stroke="${C.ink}" stroke-width="2"/>`);
  g.push(T(396, B1f - 82, '自动售票机', { size: 12, fill: C.blue, weight: 800 }));
  g.push(`<rect x="240" y="${B1f - 112}" width="110" height="112" fill="#a4703f" stroke="${C.ink}" stroke-width="2"/>`);
  g.push(T(295, B1f - 124, '商铺', { size: 12, fill: '#c99a63', anchor: 'middle', weight: 800 }));
  for (let i = 0; i < 3; i++) g.push(`<rect x="${950 + i * 44}" y="${B1f - 104}" width="36" height="104" fill="#14b8a6" stroke="${C.ink}" stroke-width="2"/>`);
  g.push(T(950, B1f - 114, '自动售货机', { size: 12, fill: C.teal, weight: 800 }));
  g.push(`<rect x="560" y="${B1f - 96}" width="110" height="96" fill="#1a1f27" stroke="${C.pink}" stroke-width="2"/>`);
  g.push(T(615, B1f - 46, '广告', { size: 20, weight: 800, fill: C.pink, anchor: 'middle', ls: 3 }));
  // queue + walk shapes
  for (let i = 0; i < 7; i++) {
    g.push(`<circle cx="${624 + i * 60}" cy="${B1f - 16}" r="6" fill="${C.yellow}" opacity=".8"/>`);
  }

  /* ---- trains on their platforms ---- */
  const plat = (fy, col, line, psd) => {
    const tx = 540, tw = 500;
    if (psd) g.push(`<rect x="${tx - 22}" y="${fy - 126}" width="${tw + 44}" height="112" fill="none" stroke="#8ec9e6" stroke-width="3" stroke-dasharray="12 7" opacity=".85"/>`);
    trainSide(g, tx, fy - 122, tw, 3.6, col, line, 'third rail');
    g.push(`<rect x="${tx - 34}" y="${fy - 24}" width="${tw + 68}" height="7" fill="${C.yellow}"/>`);
    if (psd) g.push(T(tx - 42, fy - 116, '屏蔽门', { size: 12, fill: '#8ec9e6', weight: 800, anchor: 'end' }));
    for (const ax of [tx + 70, tx + 240, tx + 410]) {
      g.push(`<path d="M${ax},${fy - 36} l0,12 m-6,-7 l6,7 l6,-7" stroke="${C.yellow}" stroke-width="2.5" fill="none"/>`);
      g.push(`<path d="M${ax + 24},${fy - 24} l0,-12 m-6,7 l6,-7 l6,7" stroke="#2fb344" stroke-width="2.5" fill="none"/>`);
    }
  };
  plat(B2f, L2, '2', true);
  plat(B3f, L3, '3', true);
  g.push(T(540, B2f + 34, '上车（绿色向下）/ 下车（黄色向上）——列车就是一条带时刻表的队列', { size: 11.5, fill: '#6f8299' }));

  /* ---- depth dimensions ---- */
  const dim = (y1, y2, txt) => {
    const x = 120;
    g.push(`<path d="M${x},${y1} L${x},${y2}" stroke="${C.yellow}" stroke-width="1.8"/>`);
    g.push(`<path d="M${x - 6},${y1 + 10} L${x},${y1} L${x + 6},${y1 + 10} M${x - 6},${y2 - 10} L${x},${y2} L${x + 6},${y2 - 10}" fill="none" stroke="${C.yellow}" stroke-width="1.8"/>`);
    g.push(T(x - 12, (y1 + y2) / 2 + 5, txt, { size: 13.5, fill: C.yellow, anchor: 'end', mono: true }));
  };
  dim(GY, B1f - 18, '-5.5 米'); dim(GY, B2f - 18, '-13 米'); dim(GY, B3f - 18, '-20 米');
  g.push(T(120, GY + 22, '0.0', { size: 13.5, fill: C.yellow, anchor: 'end', mono: true }));
  dim(GY, 262, '+6 米');

  /* ---- footnote strip ---- */
  g.push(`<rect x="48" y="1040" width="1504" height="66" rx="12" fill="#0f1620" stroke="#243040"/>`);
  const notes = [
    [C.lineA, '1 号线在地面以上：接触网受电，站台露天，无屏蔽门。'],
    [C.lineB, '2 号线位于 B2 屏蔽门后 —— 上车按门控流。'],
    [C.lineC, '3 号线在 B3，任何换乘都变成一次竖向行走，并在顶端排队。'],
    [C.asc, '扶梯、楼梯与电梯都是资产，各有各的运力和速度。'],
    [C.green, '换乘乘客是真实的个体：行走、排队、过闸、等候、上车。'],
    [C.yellow, '深度不是装饰。它等于步行时间、排队时间和站台密度。'],
  ];
  notes.forEach(([col, s], i) => {
    const cx = 70 + Math.floor(i / 3) * 740, cy = 1068 + (i % 3) * 18;
    g.push(`<rect x="${cx}" y="${cy - 9}" width="10" height="10" rx="2.5" fill="${col}"/>`);
    g.push(T(cx + 18, cy, s, { size: 11.5, fill: '#a9b8c8' }));
  });
  return sheet(W, H, g.join(''));
}

function trainSide(g, x, y, w, hM, col, line, power) {
  const h = hM * 26;
  g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#e9eef4" stroke="${C.ink}" stroke-width="2.5"/>`);
  g.push(`<rect x="${x}" y="${y + h - 15}" width="${w}" height="15" fill="${col}" opacity=".95" rx="4"/>`);
  g.push(`<rect x="${x + 16}" y="${y + 13}" width="${w - 32}" height="${h * 0.36}" fill="#22323f" opacity=".95" rx="6"/>`);
  for (let d = x + 46; d < x + w - 70; d += 96) {
    g.push(`<rect x="${d}" y="${y + 11}" width="46" height="${h - 26}" rx="5" fill="#2b3a49" stroke="${C.ink}" stroke-width="1.6"/>`);
    g.push(`<rect x="${d + 21}" y="${y + 11}" width="3" height="${h - 26}" fill="#0b0e13" opacity=".6"/>`);
  }
  for (let bx = x + 46; bx < x + w - 60; bx += 124) {
    g.push(`<rect x="${bx}" y="${y + h}" width="58" height="15" rx="5" fill="#1a1f27"/>`);
    g.push(`<circle cx="${bx + 14}" cy="${y + h + 8}" r="5" fill="#39414c"/>`);
    g.push(`<circle cx="${bx + 44}" cy="${y + h + 8}" r="5" fill="#39414c"/>`);
  }
  if (power === 'catenary') {
    g.push(`<path d="M${x - 30},${y - 48} L${x + w + 30},${y - 48}" stroke="#f0c000" stroke-width="3.5"/>`);
    g.push(`<path d="M${x + w / 2},${y - 48} L${x + w / 2},${y - 28}" stroke="#f0c000" stroke-width="2.5"/>`);
    g.push(`<polygon points="${x + w / 2 - 14},${y - 28} ${x + w / 2 + 14},${y - 28} ${x + w / 2},${y - 6}" fill="#98a4b1" stroke="${C.ink}" stroke-width="1.6"/>`);
  } else {
    g.push(`<rect x="${x + 10}" y="${y + h + 15}" width="${w - 20}" height="7" fill="#f0c000" stroke="${C.ink}" stroke-width="1.4"/>`);
    g.push(T(x + w - 8, y + h + 36, '第三轨 750 V 直流', { size: 11.5, fill: '#f0c000', anchor: 'end', weight: 700 }));
  }
  g.push(T(x + 10, y + h - 26, `${line} 号线`, { size: 15, fill: '#0b0e13', weight: 800, opacity: .0 }));
}

/* =================================================================== *
 * 03  BLOCK SYSTEM
 * =================================================================== */
export function artBlocks() {
  const W = 1600, H = 1080;
  const g = [];
  g.push(title(48, 62, '概念 03 // 方块系统',
    '圆角方块',
    '1 × 1 × 1 米的方体块，顶边倒角，转角自动拼接。表面按格、按面涂装：地板、天花板和四个墙面。'));

  /* --- A. the cell --- */
  g.push(T(60, 190, 'A.  一个方块 = 一个格', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  const S = Scene();
  S.box(0, 0, 0, 1, 1, 1, C.floor, { tone: 1.0 });
  const bevel = `<polygon points="${pstr([P(0.13, 0, 1), P(0.87, 0, 1), P(1, 0.13, 1), P(1, 0.87, 1), P(0.87, 1, 1), P(0.13, 1, 1), P(0, 0.87, 1), P(0, 0.13, 1)])}" fill="${shade(C.floor, 1.2)}" stroke="#0b0e13" stroke-width="0.8"/>`;
  g.push(`<g transform="translate(250,480) scale(2.1)">${S.out()}${bevel}</g>`);
  // face labels
  const fl = (x, y, t, col) => g.push(T(x, y, t, { size: 13.5, fill: col, weight: 700 }));
  fl(150, 586, '顶面  →  地板', C.yellow);
  fl(150, 610, '底面  →  天花板', C.teal);
  fl(150, 634, '4 个侧面  →  墙体', C.pink);
  g.push(leader(238, 578, 292, 486, C.yellow));
  g.push(leader(238, 602, 262, 500, C.teal));
  g.push(leader(238, 626, 248, 524, C.pink));
  g.push(MUL(150, 668, [
    '一个格知道自己的六个面。每个面可以带一种',
    '材质和一组标记（可行走、气密、',
    '承载标识）。仅此而已。游戏里',
    '呈现的一切都由它推导。',
  ], { size: 12.5, fill: '#93a1b3', lh: 19 }));

  /* --- B. corner autotiling --- */
  g.push(T(560, 190, 'B.  转角自动拼接', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  g.push(T(560, 214, '8 邻域位掩码 → 外角变圆，内角倒角。', { size: 12.5, fill: '#93a1b3' }));
  const cellDraw = (ox, oy, s, mask, fill) => {
    let out = '';
    for (let i = 0; i < 4; i++) {
      const side = (mask >> i) & 1;
      const dx = [0, 1, 0, -1][i], dy = [-1, 0, 1, 0][i];
      if (!side) continue;
      out += `<rect x="${ox + dx * s}" y="${oy + dy * s}" width="${s}" height="${s}" rx="${s * 0.22}" fill="${fill}" stroke="#0b0e13" stroke-width="1.4"/>`;
    }
    for (let i = 0; i < 4; i++) {
      const diag = (mask >> (4 + i)) & 1;
      const dx = [1, 1, -1, -1][i], dy = [-1, 1, 1, -1][i];
      if (!diag) continue;
      out += `<rect x="${ox + dx * s}" y="${oy + dy * s}" width="${s}" height="${s}" rx="${s * 0.22}" fill="${fill}" opacity=".45" stroke="none"/>`;
    }
    return out;
  };
  const masks = [
    [0, '孤立'], [1, '北'], [3, '北+东'], [7, '北+东+南'],
    [15, '十字'], [31, '对角'], [255, '满格'], [10, '南北向'],
  ];
  masks.forEach(([m, lbl], i) => {
    const cx = 600 + (i % 4) * 130, cy = 290 + Math.floor(i / 4) * 160;
    g.push(`<rect x="${cx - 60}" y="${cy - 60}" width="120" height="120" rx="10" fill="#0f1620" stroke="#25303d"/>`);
    g.push(cellDraw(cx, cy, 24, m, C.floor));
    g.push(`<rect x="${cx - 24}" y="${cy - 24}" width="48" height="48" rx="8" fill="${C.yellow}" stroke="#0b0e13" stroke-width="2"/>`);
    g.push(T(cx, cy + 22, String(m), { size: 12, fill: '#0b0e13', anchor: 'middle', weight: 800, mono: true }));
    g.push(T(cx, cy + 90, lbl, { size: 12, fill: '#93a1b3', anchor: 'middle' }));
  });
  g.push(`<rect x="560" y="560" width="470" height="1" fill="#25303d"/>`);
  g.push(T(560, 590, '圆角外缘按掩码只建一次，而不是每次摆放都建，然后', { size: 12.5, fill: '#7d8ea3' }));
  g.push(T(560, 610, '合并进分块网格。倒角深度 = 一个方块的 12.5%（12.5 厘米）。', { size: 12.5, fill: '#7d8ea3' }));

  /* --- C. what you can stack --- */
  g.push(T(1080, 190, 'C.  表面叠层', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  const st2 = Scene();
  st2.box(0, 0, 0, 4, 4, 0.25, C.floor, { tone: 1.0 });          // structural slab
  st2.box(0, 0, 0.25, 4, 4, 0.12, C.tile2, { tone: 1.05 });      // floor finish, top face
  st2.box(0, 0, -0.12, 4, 4, 0.12, C.ceil, { tone: 1.0 });       // ceiling finish, underside
  st2.box(0, 0, 0.37, 0.3, 4, 2.6, C.tile, { tone: 1.0 });       // wall, west side only
  st2.box(0.3, 0, 0.37, 3.7, 0.3, 2.6, C.tile, { tone: 0.9 });   // wall, north side only
  st2.box(0, 0, 3.4, 4, 4, 0.24, C.ceil, { tone: 1.05 });        // ceiling plate, floated up
  st2.box(1.2, 1.2, 3.64, 1.6, 1.6, 0.3, '#fff3cf', { tone: 1.0, sw: 0 });   // light fitting
  for (const [lx, ly] of [[0.6, 0.6], [3.4, 0.6], [3.4, 3.4], [0.6, 3.4]]) {
    st2.box(lx, ly, 2.97, 0.16, 0.16, 0.43, C.steelD, { tone: 1.0 });          // ceiling hangers
  }
  g.push(`<g transform="translate(1290,570) scale(1.4)">${st2.out()}</g>`);
  g.push(MUL(1080, 766, [
    'stack(地面饰面, 格体, 顶面饰面, 北墙, 西墙)  —  每一层',
    '表面都是可选的，各有自己的材质编号与美术变体。',
    '这里把顶板抬高以便看清内部；实际游戏中，',
    '墙体按边独立，一个房间可以只砌北墙。',
  ], { size: 12.5, fill: '#93a1b3', lh: 20 }));

  /* --- D. materials --- */
  g.push(T(60, 760, 'D.  材质色板（贴近 Overcrowd 的配色）', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  const mats = [
    [C.tile, '釉面砖'], [C.concrete, '混凝土'], [C.concreteD, '现浇'], [C.floor, '水磨石'],
    [C.steel, '不锈钢'], [C.glass, '玻璃 / 屏蔽门'], [C.yellow, '盲道黄'], [C.red, '点缀色 A'],
    [C.blue, '点缀色 B'], [C.green, '出口绿'], [C.wood, '商铺木'], [C.dark, '深色收边'],
  ];
  mats.forEach(([col, name], i) => {
    const mx = 60 + (i % 6) * 128, my = 800 + Math.floor(i / 6) * 92;
    g.push(`<rect x="${mx}" y="${my}" width="76" height="46" rx="9" fill="${col}" stroke="#0b0e13" stroke-width="2"/>`);
    g.push(`<rect x="${mx}" y="${my}" width="76" height="10" rx="5" fill="${shade(col, 1.18)}"/>`);
    g.push(T(mx + 38, my + 68, name, { size: 12, fill: '#b7c4d2', anchor: 'middle' }));
  });
  /* --- E. edge profile --- */
  g.push(T(820, 760, 'E.  倒角剖面', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
  const bx = 830, by = 900;
  g.push(`<path d="M${bx},${by} l0,-60 a14,14 0 0 1 14,-14 l120,0 a14,14 0 0 1 14,14 l0,60 z" fill="${C.floor}" stroke="#0b0e13" stroke-width="2.4"/>`);
  g.push(`<path d="M${bx},${by} l0,-60 a14,14 0 0 1 14,-14 l120,0 a14,14 0 0 1 14,14 l0,60" fill="none" stroke="${C.yellow}" stroke-width="2.4"/>`);
  g.push(`<rect x="${bx + 6}" y="${by - 46}" width="146" height="30" rx="4" fill="${C.slab}"/>`);
  g.push(T(bx + 160, by - 34, '可见棱边 = 12.5 厘米圆角', { size: 12.5, fill: '#b7c4d2' }));
  g.push(T(bx + 160, by - 14, '方块体积 = 1.0 × 1.0 × 1.0 米', { size: 12.5, fill: '#7d8ea3' }));
  g.push(`<path d="M${bx + 40},${by - 86} l0,-16" stroke="${C.yellow}" stroke-width="2"/>`);
  g.push(T(bx + 46, by - 92, '轮廓保持方正，只有转角变柔', { size: 12, fill: '#7d8ea3' }));
  g.push(`<rect x="1150" y="880" width="380" height="120" rx="12" fill="#0f1620" stroke="#25303d"/>`);
  g.push(MUL(1170, 910, [
    '渲染说明：方块按分块合并成一个',
    'BufferGeometry。地面贴图、盲道带和',
    '标识是独立的透明四边形，',
    '绘制在其上，因此不会破坏合并。',
  ], { size: 12.5, fill: '#93a1b3', lh: 20 }));
  return sheet(W, H, g.join(''));
}

/* =================================================================== *
 * 04  MODULE CATALOGUE
 * =================================================================== */
export function artModules() {
  const W = 1600, H = 1220;
  const g = [];
  g.push(title(48, 62, '概念 04 // 可放置模块',
    '可以放进车站的东西',
    '每个模块都是 a × b 的占地，并带一个仿真真正会用的通过量。沙盒模式：不计成本，只承担后果。'));

  const mods = [
    ['turnstile', '闸机', '1 × 2 格', '进 25 / 出 25 人/分', C.green, (S) => {
      for (const dx of [-0.9, 0.9]) {
        S.rbox(dx - 0.26, -1, 0, 0.52, 2, 1.05, C.steel, { r: 0.12, tone: 1.02, top: 1.2 });
      }
      S.rbox(-1.15, -1.06, 0, 2.3, 0.44, 1.1, C.steel, { r: 0.14, tone: 0.98 });
      S.rbox(-1.15, 0.62, 0, 2.3, 0.44, 1.1, C.steel, { r: 0.14, tone: 0.98 });
      S.box(-0.9, 0.68, 1.1, 1.8, 0.32, 0.1, C.green, { tone: 1.25 });
      S.box(-0.9, -0.94, 1.1, 1.8, 0.32, 0.1, C.green, { tone: 1.25 });
    }],
    ['tvm', '自动售票机', '1 × 1 格', '1.5 张/分 —— 真实的排队源头', C.blue, (S) => {
      S.rbox(-0.5, -0.5, 0, 1, 1, 2.1, C.blueD, { r: 0.16, tone: 1.02 });
      S.face('y', 0.51, -0.32, 0.34, 1.15, 1.9, C.glass, { tone: 1.35, sw: 0.5 });
      S.face('y', 0.51, -0.32, 0.34, 0.55, 1.0, '#dbe6f2', { tone: 1.1, sw: 0.5 });
    }],
    ['vending', '自动售货机', '1 × 1 格', '无服务，被动吸引', C.pink, (S) => {
      S.rbox(-0.5, -0.5, 0, 1, 1, 1.95, C.pink, { r: 0.16, tone: 1.02 });
      S.face('y', 0.51, -0.34, 0.34, 1.0, 1.8, C.glass, { tone: 1.4, sw: 0.5 });
      S.box(-0.34, -0.44, 0.2, 0.3, 0.4, 0.3, C.dark);
    }],
    ['store', '商铺 / 便利店', '4 × 6 格', '5 名店员，吸引并释放客流', C.wood, (S) => {
      S.box(-2, -3, 0, 0.25, 6, 3, C.tile2, { tone: 1.02 });
      S.box(-2, -3, 0, 4, 0.25, 3, C.tile2, { tone: 1.0 });
      S.box(1.75, -3, 0, 0.25, 6, 3, C.tile2, { tone: 1.06 });
      S.box(-2, 2.75, 0, 4, 0.25, 3, C.tile2, { tone: 0.96 });
      for (let i = 0; i < 2; i++) {
        S.box(-1.6, -1.4 + i * 1.8, 0, 3, 0.6, 1.4, C.steel, { tone: 0.95 });
        for (let j = 0; j < 5; j++) S.box(-1.5 + j * 0.58, -1.3 + i * 1.8, 1.4, 0.44, 0.4, 0.4, [C.orange, C.teal, C.pink, C.yellow][j % 4]);
      }
      S.box(-0.4, 2.3, 0, 1.2, 0.9, 1, C.dark);
    }],
    ['kiosk', '咖啡亭', '3 × 3 格', '增加停留时间，聚集人群', C.orange, (S) => {
      S.box(-1.5, -1.2, 0, 3, 2.4, 2.2, C.wood, { tone: 1.02 });
      S.box(-1.8, -1.5, 2.2, 3.6, 3, 0.26, C.red, { tone: 1.1 });
      S.face('y', 1.21, -1.3, 1.3, 0.85, 1.45, '#f6efe4', { tone: 1.05, sw: 0.5 });
      S.box(1.3, -0.5, 0, 0.8, 0.8, 0.9, C.steel);
    }],
    ['psd', '站台屏蔽门', '每对 2 × 1 格', '每道门 1.2 人/秒', C.glass, (S) => {
      S.rbox(-2, -0.22, 0, 4, 0.44, 0.2, C.steelD, { r: 0.08, tone: 1.0 });
      for (let i = 0; i < 3; i++) {
        S.face('y', 0.22, -1.7 + i * 1.3, -0.75 + i * 1.3, 0.2, 2.6, C.glass, { tone: 1.3, opacity: 0.9 });
        S.rbox(-1.78 + i * 1.3, -0.24, 0.2, 0.26, 0.48, 2.6, C.steel, { r: 0.08, tone: 1.05 });
      }
      S.rbox(-2, -0.24, 2.8, 4, 0.48, 0.32, C.lineB, { r: 0.08, tone: 1.05 });
      S.rbox(-2, -0.24, 0.3, 4, 0.48, 0.16, C.safety, { r: 0.06, tone: 1.05 });
    }],
    ['door', '门（单开）', '1 × 1 格', '1.2 人/秒，关闭时阻断', C.green, (S) => {
      S.rbox(-0.5, -0.6, 0, 0.26, 0.52, 2.5, C.tile, { r: 0.08, tone: 1.0 });
      S.rbox(0.24, -0.6, 0, 0.26, 0.52, 2.5, C.tile, { r: 0.08, tone: 1.0 });
      S.rbox(-0.2, -0.3, 0, 0.4, 0.36, 2.4, C.green, { r: 0.1, tone: 1.1 });
      S.rbox(-0.5, -0.62, 2.5, 1, 0.56, 0.2, C.ceil, { r: 0.06, tone: 1.05 });
    }],
    ['exit', '车站出口 / 上行楼梯', '2 × 6 格', '每个出口单独设定流量', C.green, (S) => {
      for (let i = 0; i < 8; i++) S.rbox(-1, -3 + i * 0.62, i * 0.4, 2, 0.62, 0.4, C.concrete, { r: 0.08, tone: 1.0 });
      S.handrailY(-1.12, -3, 0.06, 1.96, 3.26, 0.95, { panel: C.glass, panelTone: 1.25, capCol: C.dark });
      S.handrailY(1.12, -3, 0.06, 1.96, 3.26, 0.95, { panel: C.glass, panelTone: 1.25, capCol: C.dark });
      S.rbox(-1.4, 1.9, 3.4, 2.8, 0.4, 0.7, C.green, { r: 0.12, tone: 1.15 });
      S.rbox(-1.1, 2.35, 0, 2.2, 0.3, 3.9, C.tile, { r: 0.1, tone: 1.0 });
    }],
    ['stairs', '楼梯', '3 × 6 格', '每米每分钟上 25 / 下 33 人', C.yellow, (S) => {
      for (let i = 0; i < 9; i++) S.rbox(-1.5, -3 + i * 0.62, -i * 0.34, 3, 0.62, 0.34, C.concrete, { r: 0.08, tone: 1.0 });
      S.handrailY(-1.62, -3, 0.06, 2.58, -3.0, 0.95, { panel: C.glass, panelTone: 1.25, capCol: C.dark });
      S.handrailY(1.62, -3, 0.06, 2.58, -3.0, 0.95, { panel: C.glass, panelTone: 1.25, capCol: C.dark });
    }],
    ['escalator', '自动扶梯', '1 × 8 格', '单向，75 人/分', C.asc, (S) => {
      S.ramp(-0.6, -4, 2.4, 1.2, 8, -1.2, C.steelD, { tone: 1.0, truss: 0.8 });
      S.handrailY(-0.78, -4, 2.4, 4, -1.2, 1.0, { panel: C.glass, panelTone: 1.3, capCol: C.dark });
      S.handrailY(0.48, -4, 2.4, 4, -1.2, 1.0, { panel: C.glass, panelTone: 1.3, capCol: C.dark });
      S.rbox(-0.7, -4.2, 2.4, 1.4, 0.24, 0.22, C.steel, { r: 0.08 });
    }],
    ['lift', '电梯', '2 × 2 格', '无障碍，每趟 15 人', C.blue, (S) => {
      S.rbox(-1, -1, -3.2, 2, 2, 6.4, C.glass, { r: 0.28, tone: 1.25, opacity: 0.9 });
      S.rbox(-0.5, -0.5, -3.15, 1, 1, 6.3, C.steelD, { r: 0.16, tone: 1.0 });
      S.rbox(-1.1, -1.1, 3.2, 2.2, 2.2, 0.24, C.steel, { r: 0.28, tone: 1.05 });
      S.face('y', 1.0, -0.8, 0.8, 3.2, 3.44, C.blue, { tone: 1.1, sw: 0.5 });
    }],
    ['billboard', '广告灯箱', '4 × 1 格', '诱导：提高商铺停留', C.pink, (S) => {
      S.rbox(-2, -0.2, 0, 4, 0.4, 2.4, C.dark, { r: 0.1, tone: 1.0 });
      S.face('y', 0.22, -1.85, 1.85, 0.4, 2.1, C.pink, { tone: 1.12, sw: 0.6 });
      S.face('y', 0.22, -1.6, 1.0, 0.7, 1.8, '#ffd9e6', { tone: 1.05, sw: 0.4 });
      S.rbox(-1.6, -0.3, 2.4, 0.4, 0.6, 0.3, C.steel, { r: 0.08 });
      S.rbox(1.2, -0.3, 2.4, 0.4, 0.6, 0.3, C.steel, { r: 0.08 });
    }],
    ['sticker', '地贴导向 / 平面图', '2 × 2 格', '盲切路径，缩短排队时间', C.blue, (S) => {
      S.quad(-1, -1, 0.02, 2, 2, C.blue, { tone: 1.12, sw: 0.6 });
      S.quad(-0.7, -0.7, 0.03, 1.4, 1.4, C.white, { tone: 1.0, sw: 0.4 });
      S.quad(-0.45, -0.45, 0.04, 0.9, 0.24, C.dark, { tone: 1.0, sw: 0.3 });
      S.quad(-0.45, -0.1, 0.04, 0.55, 0.24, C.dark, { tone: 1.0, sw: 0.3 });
      S.quad(-0.45, 0.25, 0.04, 0.9, 0.24, C.dark, { tone: 1.0, sw: 0.3 });
    }],
    ['bench', '长椅 / 座椅', '1 × 4 格', '舒适度，可坐 6 人', C.wood, (S) => {
      S.rbox(-0.4, -2, 0.35, 0.8, 4, 0.14, C.wood, { r: 0.07, tone: 1.05 });
      S.rbox(-0.4, -2, 0.1, 0.8, 4, 0.25, C.steelD, { r: 0.07, tone: 0.95 });
      for (const yy of [-1.8, 1.6]) {
        S.rbox(-0.32, yy, 0, 0.64, 0.24, 0.4, C.steel, { r: 0.1 });
      }
    }],
    ['info', '信息柱 / 立牌', '1 × 1 格', '导向半径 +8 米', C.teal, (S) => {
      S.rbox(-0.4, -0.4, 0, 0.8, 0.8, 2.8, C.dark, { r: 0.2, tone: 1.0 });
      S.face('y', 0.41, -0.3, 0.3, 1.0, 2.5, C.teal, { tone: 1.12, sw: 0.5 });
      S.face('x', 0.41, -0.3, 0.3, 1.0, 2.5, C.blue, { tone: 1.0, sw: 0.5 });
      S.rbox(-0.45, -0.45, 2.8, 0.9, 0.9, 0.18, C.steel, { r: 0.2 });
    }],
    ['qrail', '排队栏杆', '每米 1 × 1 格', '成渠：不能超越、不会外溢', C.steel, (S) => {
      for (let i = 0; i < 3; i++) {
        const x = -1.6 + i * 1.6;
        S.rbox(x - 0.07, -0.07, 0, 0.14, 0.14, 1.02, C.steel, { r: 0.06, tone: 1.0, top: 1.2 });
        S.rbox(x - 0.13, -0.13, 0, 0.26, 0.26, 0.07, C.dark, { r: 0.08 });
        if (i < 2) {
          S.rbox(x + 0.07, -0.05, 0.92, 1.46, 0.1, 0.09, C.steelD, { r: 0.04 });
          S.rbox(x + 0.07, -0.05, 0.56, 1.46, 0.09, 0.08, C.steelD, { r: 0.04 });
        }
      }
    }],
    ['belt', '伸缩隔离带', '1 × 1 格', '可伸缩，可开关', C.yellow, (S) => {
      S.rbox(-0.13, -0.13, 0, 0.26, 0.26, 1.06, C.steel, { r: 0.09, tone: 1.0, top: 1.2 });
      S.rbox(-0.2, -0.2, 0, 0.4, 0.4, 0.08, C.dark, { r: 0.12 });
      S.rbox(-0.06, 0.13, 0.9, 0.12, 1.9, 0.13, C.yellow, { r: 0.05, tone: 1.1 });
      S.rbox(-0.06, 0.13, 0.58, 0.12, 1.9, 0.1, C.dark, { r: 0.04 });
      S.rbox(1.84, 0.13, 0, 0.2, 0.2, 1.02, C.steel, { r: 0.07, tone: 0.95 });
    }],
    ['lane1', '排队通道 —— 单列', '每米 1 × 1 格', '有序，约 45 人/分', C.asc, (S) => {
      S.quad(-0.5, -3, 0.02, 1, 6, C.asc, { tone: 1.05, sw: 0.5 });
      S.quad(-0.44, -3, 0.03, 0.88, 6, C.asc, { tone: 0.6, sw: 0, opacity: 0.35 });
      for (let i = 0; i < 7; i++) S.quad(-0.4, -2.85 + i * 0.82, 0.04, 0.8, 0.1, C.white, { tone: 1.0, sw: 0.2 });
      for (const bx of [-0.5, 0.42]) S.rbox(bx, -3, 0, 0.08, 6, 0.06, C.steelD, { r: 0.03 });
      S.sprite(0, -0.5, 0.04, 'person', { color: C.pink });
      S.sprite(0, 0.6, 0.04, 'person', { color: C.blue });
      S.sprite(0, 1.7, 0.04, 'person', { color: C.green });
    }],
    ['lane2', '排队通道 —— 并排两人', '每米 2 × 1 格', '运力翻倍，秩序减半', C.blue, (S) => {
      S.quad(-1, -3, 0.02, 2, 6, C.blue, { tone: 1.05, sw: 0.5 });
      for (const ox of [-0.5, 0.5]) {
        S.quad(ox - 0.45, -3, 0.03, 0.9, 6, C.blue, { tone: 0.6, sw: 0, opacity: 0.3 });
        for (let i = 0; i < 7; i++) S.quad(ox - 0.4, -2.85 + i * 0.82, 0.04, 0.8, 0.1, C.white, { tone: 1.0, sw: 0.2 });
      }
      for (const bx of [-1, 0.92]) S.rbox(bx, -3, 0, 0.08, 6, 0.06, C.steelD, { r: 0.03 });
      S.sprite(-0.5, -0.6, 0.04, 'person', { color: C.orange });
      S.sprite(0.5, -0.2, 0.04, 'person', { color: C.teal });
      S.sprite(-0.5, 0.6, 0.04, 'person', { color: C.purple });
      S.sprite(0.5, 1.1, 0.04, 'person', { color: C.red });
    }],
    ['switchback', '折返排队', '每折 2 × 4 格', '8 平方米地面容纳 40 人', C.purple, (S) => {
      const runX = 4, xs = -2;
      for (let i = 0; i < 4; i++) {
        const y = -1.5 + i * 1.0;
        S.rbox(xs - 0.06, y - 0.06, 0, runX + 0.12, 0.12, 0.98, C.steel, { r: 0.05, tone: 1.0 });
        S.rbox(xs, y - 0.05, 0.55, runX, 0.1, 0.09, C.steelD, { r: 0.04 });
        S.quad(xs + 0.3, y - 0.16, 0.02, runX - 0.6, 0.22, C.purple, { tone: 1.1, sw: 0.3, opacity: 0.8 });
      }
      for (const [x, y] of [[xs, -1.5], [xs + runX, -0.5], [xs, 0.5], [xs + runX, 1.5]]) {
        S.rbox(x - 0.06, y - 0.06, 0, 0.12, 1.0, 0.98, C.steel, { r: 0.05, tone: 0.95 });
      }
      S.sprite(-1.2, -1.5, 0.03, 'person', { color: C.teal });
      S.sprite(1.4, -0.5, 0.03, 'person', { color: C.pink });
      S.sprite(-1.0, 0.5, 0.03, 'person', { color: C.orange });
      S.sprite(1.6, 1.5, 0.03, 'person', { color: C.blue });
    }],
  ];
  const cols = 5, cw = 296, ch = 320, x0 = 48, y0 = 178;
  mods.forEach(([id, name, size, spec, col, fn], i) => {
    const cx = x0 + (i % cols) * (cw + 8), cy = y0 + Math.floor(i / cols) * (ch + 10);
    g.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="14" fill="#111926" stroke="#243040"/>`);
    g.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="4" rx="2" fill="${col}"/>`);
    g.push(`<rect x="${cx + 12}" y="${cy + 12}" width="${cw - 24}" height="196" rx="10" fill="#0d141d"/>`);
    const S = Scene();
    fn(S);
    const scale = id === 'psd' || id === 'stairs' ? 0.62 : id === 'escalator' ? 0.5 : id === 'store' ? 0.66 : id === 'lift' ? 0.5 : 0.78;
    g.push(`<g transform="translate(${cx + cw / 2},${cy + 152 + (id === 'lift' ? 30 : id === 'stairs' ? 20 : 0)}) scale(${scale})">${S.out()}</g>`);
    g.push(T(cx + 18, cy + 240, name, { size: 16.5, weight: 700, fill: '#eaf0f6' }));
    g.push(T(cx + 18, cy + 264, size, { size: 12.5, fill: col, mono: true }));
    g.push(T(cx + 18, cy + 288, spec, { size: 12.5, fill: '#8fa0b3' }));
  });
  const rows = Math.ceil(mods.length / cols);
  const foot = y0 + rows * (ch + 10) + 4;
  g.push(T(48, foot, '未列出：垃圾桶、消防点、失物招领、服务台、卫生间、售票窗口 —— 同一套约定：占地 + 通过量 + 标签。', { size: 13, fill: '#7d8ea3' }));
  g.push(T(48, foot + 24, '每个模块还声明：是否阻挡行人（是/否）、排队锚点（在哪一侧排队），以及随拥挤度衰减的运力曲线。', { size: 13, fill: '#7d8ea3' }));
  return sheet(W, Math.max(H, foot + 60), g.join(''));
}
