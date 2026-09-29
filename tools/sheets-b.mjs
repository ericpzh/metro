// Concept sheets 05 (rolling stock numbers), 06 (crowd demand) and 08 (software
// shape). Sheet 07, the interface, lives in sheet-07-ui.mjs because it is drawn
// in the shipping language, Simplified Chinese.
import { C, T, MUL, title, sheet, legend, poly, shade, n, pstr, chart, rng, LINES } from './iso.mjs';

/* =================================================================== *
 * 05  TRAINS + TRACK
 * =================================================================== */
const TYPES = [
  {
    id: 'A', col: '#e5484d', w: 3.0, h: 3.8, len: 22.0, cars: '6 - 8', perCar: 310, rated: 250,
    power: '接触网 1500 V 直流或 25 kV 交流（高架） | 部分线路为第三轨',
    gauge: 1435, vmax: '80 - 100 公里/时', doors: '每侧 5 门，门宽 1.4 米', n: 5,
    note: '最宽车体：用于干线、8 节编组。地面以上的线路通常采用接触网，站台无需顶棚净空，车站可以直接开敞。',
  },
  {
    id: 'B', col: '#2f7ef2', w: 2.8, h: 3.8, len: 19.5, cars: '4 - 6', perCar: 240, rated: 200,
    power: '第三轨 750 V 直流（隧道）',
    gauge: 1435, vmax: '80 公里/时', doors: '每侧 4 门，门宽 1.3 米', n: 4,
    note: '中国城市地铁的主力车型。第三轨要求隧道或加盖区间，这正是 B 型线路在 B2/B3 屏蔽门后运行的原因。',
  },
  {
    id: 'C', col: '#f2b32c', w: 2.6, h: 3.6, len: 19.0, cars: '4 - 6', perCar: 200, rated: 170,
    power: '第三轨 750 V 直流 / 直线电机版本',
    gauge: 1435, vmax: '80 公里/时', doors: '每侧 4 门，门宽 1.2 米', n: 4,
    note: '面向低需求支线和自动化线路的轻型车体。车体更窄意味着站台更窄、土建更省 —— 但拥挤时的客流压力一点不小。',
  },
];

export function artTrains() {
  const W = 1600, H = 1780;
  const g = [];
  g.push(title(48, 62, '概念 05 // 列车与轨道',
    'A / B / C 型列车，以及对车站的要求',
    '中国地铁车型分类。车体宽度决定站台边缘，车门数量决定上车速率，受电方式决定隧道还是高架。'));

  TYPES.forEach((t, i) => {
    const y0 = 200 + i * 322;
    g.push(`<rect x="48" y="${y0 - 34}" width="1504" height="300" rx="14" fill="#111926" stroke="#243040"/>`);
    g.push(`<rect x="48" y="${y0 - 34}" width="8" height="284" rx="4" fill="${t.col}"/>`);

    // label
    g.push(T(84, y0 + 26, `${t.id} 型`, { size: 40, weight: 800, fill: t.col }));
    g.push(MUL(84, y0 + 60, [
      `宽 ${t.w.toFixed(1)} 米`, `长 ${t.len.toFixed(1)} 米`, `高 ${t.h.toFixed(1)} 米`,
      `编组 ${t.cars} 节`,
    ], { size: 13.5, fill: '#a9b8c8', lh: 22 }));

    // cross-section
    const s = 30;                                     // px per metre
    const cw = t.w * s, chh = t.h * s, cx = 330, cy = y0 + 210;
    g.push(T(330, y0 + 6, '横断面', { size: 12, fill: '#6f8299', ls: 1.4, weight: 700 }));
    g.push(`<path d="M${cx},${cy} l0,${-chh + 26} a40,40 0 0 1 40,-26 l${cw - 80},0 a40,40 0 0 1 40,26 l0,${chh - 26} z" fill="#e9eef4" stroke="${C.ink}" stroke-width="2.4"/>`);
    g.push(`<rect x="${cx + 4}" y="${cy - chh + 34}" width="${cw - 8}" height="${chh * 0.34}" rx="8" fill="#22323f"/>`);
    g.push(`<rect x="${cx - 12}" y="${cy - 22}" width="${cw + 24}" height="22" rx="6" fill="#6c757f" stroke="${C.ink}" stroke-width="2"/>`);
    for (const dx of [cx - 16, cx + cw + 16 - 12]) g.push(`<rect x="${dx}" y="${cy - 6}" width="12" height="16" rx="3" fill="#1a1f27"/>`);
    // crush passengers
    const rr = rng(4 + i);
    for (let k = 0; k < t.perCar / 12; k++) {
      g.push(`<circle cx="${(cx + 14 + rr() * (cw - 28)).toFixed(1)}" cy="${(cy - 14 - rr() * (chh - 70)).toFixed(1)}" r="3.4" fill="${t.col}" opacity=".8"/>`);
    }
    g.push(T(cx + cw / 2, cy + 26, `${t.w.toFixed(1)} 米`, { size: 12, fill: '#8fa0b3', anchor: 'middle', mono: true }));
    g.push(`<path d="M${cx - 30},${cy} l0,${-chh}" stroke="#8fa0b3" stroke-width="1.2"/>`);
    g.push(T(cx - 38, cy - chh / 2, `${t.h.toFixed(1)} 米`, { size: 12, fill: '#8fa0b3', anchor: 'end', mono: true }));

    // side elevation: 3 cars + cut
    g.push(T(560, y0 + 6, `侧立面（3 节，每节 ${t.len.toFixed(1)} 米，编组重复）`, { size: 12, fill: '#6f8299', ls: 1.4, weight: 700 }));
    const sc = 8.5, carW = t.len * sc, carH = t.h * sc;
    for (let c = 0; c < 3; c++) {
      const cxx = 560 + c * (carW + 12);
      g.push(`<rect x="${cxx}" y="${y0 + 30}" width="${carW}" height="${carH}" rx="9" fill="#e9eef4" stroke="${C.ink}" stroke-width="2.2"/>`);
      g.push(`<rect x="${cxx}" y="${y0 + 30 + carH - 11}" width="${carW}" height="11" fill="${t.col}"/>`);
      g.push(`<rect x="${cxx + 10}" y="${y0 + 42}" width="${carW - 20}" height="${carH * 0.34}" rx="4" fill="#22323f"/>`);
      const doors = t.n ?? 4;
      for (let d = 0; d < doors; d++) {
        const dx = cxx + 16 + d * ((carW - 40) / doors);
        g.push(`<rect x="${dx}" y="${y0 + 40}" width="17" height="${carH - 20}" rx="3" fill="#2b3a49" stroke="${C.ink}" stroke-width="1.3"/>`);
      }
      g.push(`<rect x="${cxx + 34}" y="${y0 + 30 + carH}" width="46" height="12" rx="4" fill="#1a1f27"/>`);
      g.push(`<rect x="${cxx + carW - 86}" y="${y0 + 30 + carH}" width="46" height="12" rx="4" fill="#1a1f27"/>`);
    }
    g.push(`<path d="M${560 + 3 * (carW + 12) + 4},${y0 + 40} l0,${carH - 20}" stroke="${t.col}" stroke-width="3" stroke-dasharray="8 6"/>`);
    g.push(T(560 + 3 * (carW + 12) + 14, y0 + carH / 2 + 40, '...', { size: 22, fill: '#6f8299' }));
    // power pickup drawing
    if (t.id === 'A') {
      g.push(`<path d="M540,${y0 + 16} L${1520},${y0 + 16}" stroke="#f0c000" stroke-width="3"/>`);
      g.push(`<path d="M${1000},${y0 + 16} l0,10 M990,${y0 + 26} l20,0" stroke="#f0c000" stroke-width="2.4"/>`);
      g.push(T(1548, y0 + 20, '接触网', { size: 11.5, fill: '#f0c000', anchor: 'end' }));
    } else {
      g.push(`<rect x="556" y="${y0 + 30 + carH + 12}" width="${3 * (carW + 12)}" height="6" fill="#f0c000" stroke="${C.ink}" stroke-width="1.2"/>`);
      g.push(T(560, y0 + 30 + carH + 40, '轨面第三轨 —— 集电靴位于转向架下方', { size: 11.5, fill: '#f0c000' }));
    }

    // capacity + facts
    const bx = 1210;
    g.push(T(bx, y0 + 30, '单节拥挤定员', { size: 11.5, fill: '#6f8299', ls: 1.2, weight: 700 }));
    g.push(`<rect x="${bx}" y="${y0 + 42}" width="250" height="20" rx="5" fill="#1d2731"/>`);
    g.push(`<rect x="${bx}" y="${y0 + 42}" width="${(t.rated / 310) * 250}" height="20" rx="5" fill="${t.col}" opacity=".55"/>`);
    g.push(`<rect x="${bx}" y="${y0 + 42}" width="${(t.perCar / 310) * 250}" height="20" rx="5" fill="none" stroke="${t.col}" stroke-width="1.6"/>`);
    g.push(T(bx + 8, y0 + 57, `${t.perCar} 人拥挤`, { size: 12, fill: '#0b0e13', weight: 800 }));
    g.push(T(bx + 258, y0 + 57, `/ 定员 ${t.rated}`, { size: 12, fill: '#8fa0b3' }));
    g.push(MUL(bx, y0 + 92, [
      `编组 ${t.cars} 节  →  6 节拥挤定员 ${(t.perCar * 6).toLocaleString()} 人`,
      `最高 ${t.vmax}    车门  ${t.doors}`,
      `轨距 ${t.gauge} 毫米`,
    ], { size: 12.5, fill: '#a9b8c8', lh: 22, mono: true }));
    // wrapped note
    const lines = []; let cur = '';
    for (const ch of t.note) { if (cur.length >= 26) { lines.push(cur); cur = ''; } cur += ch; }
    if (cur) lines.push(cur);
    // avoid a one-character orphan line (Chinese punctuation often lands alone)
    if (lines.length > 1 && lines[lines.length - 1].length < 4) {
      lines[lines.length - 2] += lines.pop();
    }
    g.push(MUL(bx, y0 + 158, lines, { size: 12.5, fill: '#8fa0b3', lh: 18 }));
    g.push(`<rect x="${bx}" y="${y0 + 228}" width="250" height="26" rx="6" fill="${t.col}" opacity=".14" stroke="${t.col}" stroke-width="1.2"/>`);
    g.push(T(bx + 10, y0 + 246, t.power.slice(0, 40), { size: 11.5, fill: t.col, mono: true }));
  });

  /* =================================================================== *
   * 05b/05c  ROLLING STOCK AS A GAME-PLAY CHOICE + PSD HEIGHT
   * =================================================================== */
  const bar = (x, y, w, h, fill, o = {}) =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${o.rx ? ` rx="${n(o.rx)}"` : ''} fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ''}${o.opacity != null ? ` opacity="${o.opacity}"` : ''}/>`;

  g.push(`<rect x="48" y="1180" width="1504" height="1" fill="#243040"/>`);
  g.push(T(48, 1210, '05b  车型是一组选择，而不是一张图', { size: 14, weight: 800, fill: C.yellow, ls: 1.3 }));
  g.push(T(48, 1230, '五个决定命名并塑造一列车。车型与编组决定运力；受电、颜色与名称标识线路。', { size: 12.5, fill: '#8fa0b3' }));

  const cy0 = 1252, cw = 282, cgap = 16, ch = 176;
  const card = (i, title, sub) => {
    const x = 48 + i * (cw + cgap);
    g.push(`<rect x="${x}" y="${cy0}" width="${cw}" height="${ch}" rx="12" fill="#111926" stroke="#243040"/>`);
    g.push(T(x + 16, cy0 + 26, title, { size: 12.5, weight: 800, fill: C.yellow, ls: 1.2 }));
    g.push(T(x + 16, cy0 + 44, sub, { size: 11, fill: '#5d6d80' }));
    return x;
  };
  {
    const x = card(0, '1  车型', '单节载客量');
    [['A', 310, '#e5484d'], ['B', 240, C.lineB], ['C', 200, '#f2b32c']].forEach(([id, per, col], k) => {
      const yy = cy0 + 62 + k * 34;
      g.push(bar(x + 16, yy, 46, 28, col, { rx: 6, opacity: 0.18, stroke: col }));
      g.push(T(x + 39, yy + 19, id, { size: 15, weight: 800, fill: col, anchor: 'middle' }));
      g.push(T(x + 74, yy + 19, `${per} 人拥挤`, { size: 12.5, fill: '#c3d0de', mono: true }));
    });
  }
  {
    const x = card(1, '2  编组长度', '每列节数 · 总拥挤定员（B 型）');
    [4, 6, 8].forEach((cars, k) => {
      const yy = cy0 + 66 + k * 34;
      g.push(bar(x + 16, yy, 46, 28, C.lineB, { rx: 6, opacity: 0.16, stroke: C.lineB }));
      g.push(T(x + 39, yy + 19, String(cars), { size: 15, weight: 800, fill: C.lineB, anchor: 'middle' }));
      g.push(T(x + 74, yy + 19, `${(240 * cars).toLocaleString()} 人`, { size: 12.5, fill: '#c3d0de', mono: true }));
    });
  }
  {
    const x = card(2, '3  受电方式', '受电方式决定隧道或高架');
    [['第三轨 750 V 直流', '仅限隧道 / 加盖区间', C.lineB], ['接触网 1500 V 直流', '高架 / 敞口开挖', C.lineA]].forEach(([t, s, col], k) => {
      const yy = cy0 + 64 + k * 50;
      g.push(bar(x + 16, yy, 250, 42, col, { rx: 8, opacity: 0.12, stroke: col }));
      g.push(T(x + 28, yy + 18, t, { size: 11.5, weight: 800, fill: col, mono: true }));
      g.push(T(x + 28, yy + 34, s, { size: 10.5, fill: '#8fa0b3' }));
    });
  }
  {
    const x = card(3, '4  线路颜色', '一条线一种颜色，涂在车身上');
    LINES.forEach(([id, col], k) => {
      const sx = x + 16 + (k % 3) * 84, sy = cy0 + 66 + Math.floor(k / 3) * 42;
      g.push(bar(sx, sy, 36, 28, col, { rx: 6 }));
      g.push(T(sx + 46, sy + 19, id, { size: 13, weight: 800, fill: '#eaf0f6', mono: true }));
    });
    g.push(T(x + 16, cy0 + 164, '车型不再决定车身涂装', { size: 10.5, fill: '#7d8ea3' }));
  }
  {
    const x = card(4, '5  线路名称', '目的地显示屏上的内容');
    g.push(bar(x + 16, cy0 + 64, 250, 46, '#141a20', { rx: 7, stroke: '#243040' }));
    g.push(T(x + 30, cy0 + 86, '2 号线  ·  五丝广场', { size: 12.5, weight: 700, fill: '#ffd45e', mono: true }));
    g.push(T(x + 30, cy0 + 103, '五丝广场', { size: 12, fill: '#c3d0de' }));
    g.push(T(x + 16, cy0 + 164, '颜色 + 名称 + 车型 = 一条线路', { size: 10.5, fill: '#7d8ea3' }));
  }
  g.push(T(48, cy0 + ch + 26, '线路是你编辑的单位。其余一切 —— 停站时间、行车间隔、上车速率、可运行的区间 —— 都由这五项推导。', { size: 12.5, fill: '#8fa0b3' }));

  /* ---- platform screen doors: full height or half height ---- */
  g.push(T(48, 1500, '05c  站台屏蔽门：全高还是半高', { size: 14, weight: 800, fill: C.yellow, ls: 1.3 }));
  g.push(T(48, 1520, '同一套车门间距，两种门体。全高把站台封闭起来；半高在顶部留出排烟开口，造价更低。', { size: 12.5, fill: '#8fa0b3' }));

  const secY = 1560, secH = 150;
  const psdSection = (x, full) => {
    const yb = secY + secH;
    g.push(T(x, secY + 8, full ? '全高  2.35 米' : '半高  1.20 米', { size: 12, weight: 800, fill: full ? C.glass : C.yellow, mono: true }));
    g.push(bar(x, yb - 12, 214, 12, '#c9cdd2'));
    g.push(bar(x, yb - 12, 214, 4, C.tactile));
    g.push(bar(x + 196, yb - 14, 18, 14, C.maroon));
    const cxx = x + 232;
    g.push(bar(cxx, yb - 78, 150, 78, '#eef2f6', { stroke: C.ink, sw: 1.6 }));
    g.push(bar(cxx + 8, yb - 66, 134, 18, '#26333f', { rx: 3 }));
    g.push(bar(cxx + 52, yb - 72, 34, 72, '#41525f', { stroke: C.ink, sw: 1.2 }));
    g.push(`<line x1="${cxx + 69}" y1="${yb - 72}" x2="${cxx + 69}" y2="${yb}" stroke="#7d8ea3" stroke-width="1.2"/>`);
    g.push(T(cxx + 75, yb + 16, '车门', { size: 10.5, fill: '#8fa0b3', anchor: 'middle' }));
    const px = x + 196;
    const top = full ? yb - 94 : yb - 48;
    g.push(bar(px, top, 8, yb - top - 2, C.glass, { stroke: C.ink, sw: 0.8, opacity: 0.65 }));
    g.push(bar(px - 8, top - (full ? 8 : 6), 24, full ? 10 : 8, C.steel, { stroke: C.ink, sw: 0.8 }));
    if (full) g.push(bar(px - 8, yb - 34, 24, 5, C.steelD));
    g.push(`<path d="M${px - 44},${top} L${px - 44},${yb - 2}" stroke="${C.yellow}" stroke-width="1.2"/>`);
    g.push(`<path d="M${px - 48},${top} L${px - 40},${top} M${px - 48},${yb - 2} L${px - 40},${yb - 2}" stroke="${C.yellow}" stroke-width="1.2"/>`);
    g.push(T(px - 54, (top + yb) / 2, full ? '2.35 米' : '1.20 米', { size: 11, fill: C.yellow, anchor: 'end', mono: true }));
    g.push(T(x, yb + 30, full ? '从地面封到顶板  ·  付费区气流控制' : '齐腰隔断  ·  上方开敞排烟', { size: 11, fill: '#8fa0b3' }));
  };
  psdSection(76, true);
  psdSection(470, false);

  {
    const tx = 960, ty = secY - 6, tw = 568, rh = 30;
    g.push(T(tx, ty, '各车型 × 编组的拥挤定员', { size: 12, weight: 800, fill: C.yellow, ls: 1.1 }));
    ['车型', '单节', '4 节', '6 节', '8 节'].forEach((c, k) => g.push(T(tx + 8 + k * 112, ty + 34, c, { size: 11, fill: '#7d8ea3', mono: true, weight: 700 })));
    [['A', 310, '#e5484d'], ['B', 240, C.lineB], ['C', 200, '#f2b32c']].forEach(([id, per, col], r) => {
      const yy = ty + 46 + r * rh;
      g.push(bar(tx, yy, tw, rh - 6, col, { rx: 6, opacity: 0.1 }));
      g.push(T(tx + 8, yy + 18, id, { size: 13, weight: 800, fill: col, mono: true }));
      [per, per * 4, per * 6, per * 8].forEach((v, k) => g.push(T(tx + 8 + (k + 1) * 112, yy + 18, v.toLocaleString(), { size: 12, fill: '#dfe7f0', mono: true })));
    });
    g.push(T(tx, ty + 46 + 3 * rh + 18, '拥挤定员；定员约为拥挤的 80%。一列装不完的列车会把乘客留在站台 —— 这是最核心的压力读数。', { size: 11, fill: '#7d8ea3' }));
  }

  g.push(T(48, H - 24, '仿真约定：一条线路 = {车型, 编组长度, 受电, 颜色, 名称}。一列车 = {type, cars, doorsPerCar, doorWidth, dwellBase, maxLoad}。上车速率 = f(门宽, 拥挤度, 下车人数)。屏蔽门（全高或半高）为每道门增加固定的换乘耗时。', { size: 12.5, fill: '#7d8ea3' }));
  return sheet(W, H, g.join(''));
}

/* =================================================================== *
 * 06  DEMAND
 * =================================================================== */
export function artDemand() {
  const W = 1600, H = 1120;
  const g = [];
  g.push(title(48, 62, '概念 06 // 客流需求',
    '人群从哪里来，什么时候来',
    '每个出口有进站速率，每个站台有出站速率。时段、星期与日历共同塑造客流波。线路之间通过站厅交换乘客。'));

  const mk = (peak) => {
    const v = [];
    for (let i = 0; i < 24; i++) {
      let x = 0;
      x += peak.am * Math.exp(-Math.pow((i - 8) / 1.5, 2));
      x += peak.pm * Math.exp(-Math.pow((i - 18) / 1.9, 2));
      x += peak.mid * Math.exp(-Math.pow((i - 13) / 3.2, 2));
      x += peak.night * Math.exp(-Math.pow((i - 22) / 2.0, 2));
      x += peak.base + (i > 5 && i < 23 ? 6 : 1);
      v.push(Math.round(x));
    }
    return v;
  };
  const wd = mk({ am: 92, pm: 96, mid: 34, night: 22, base: 5 });
  const sat = mk({ am: 26, pm: 42, mid: 62, night: 48, base: 12 });
  const sun = mk({ am: 14, pm: 30, mid: 50, night: 30, base: 9 });

  /* --- A. 24h curve --- */
  g.push(`<rect x="48" y="180" width="1000" height="380" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(76, 214, 'A.  一座车站，一个工作日', { size: 15, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(T(76, 236, '每 5 分钟进站人数', { size: 12.5, fill: '#7d8ea3' }));
  const cg = chart([
    { v: wd, col: C.yellow, area: true, w: 3 },
    { v: sat, col: C.pink, w: 2, dash: '6 5' },
    { v: sun, col: C.teal, w: 2, dash: '2 5' },
  ], 200, 260, 820, 230, { max: 110 });
  g.push(cg);
  for (let i = 0; i <= 24; i += 3) {
    g.push(T(200 + (i / 23) * 820, 512, `${String(i).padStart(2, '0')}`, { size: 12, fill: '#7d8ea3', anchor: 'middle', mono: true }));
  }
  g.push(`<rect x="${200 + (7 / 23) * 820}" y="250" width="${(2 / 23) * 820}" height="244" fill="${C.red}" opacity=".1"/>`);
  g.push(`<rect x="${200 + (17 / 23) * 820}" y="250" width="${(2 / 23) * 820}" height="244" fill="${C.red}" opacity=".1"/>`);
  g.push(T(200 + (8 / 23) * 820, 268, '早高峰', { size: 11.5, fill: C.red, anchor: 'middle', weight: 800 }));
  g.push(T(200 + (18 / 23) * 820, 268, '晚高峰', { size: 11.5, fill: C.red, anchor: 'middle', weight: 800 }));
  g.push(legend(78, 540, [[C.yellow, '工作日'], [C.pink, '周六'], [C.teal, '周日 / 节假日']], { size: 12.5, step: 22 }));

  /* --- B. calendar --- */
  g.push(`<rect x="1072" y="180" width="480" height="380" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(1096, 214, 'B.  日历', { size: 15, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(T(1096, 236, '按日类型的基准倍数', { size: 12.5, fill: '#7d8ea3' }));
  const days = ['一', '二', '三', '四', '五', '六', '日'];
  const rr2 = rng(9);
  for (let w = 0; w < 14; w++) {
    for (let d = 0; d < 7; d++) {
      const we = d >= 5;
      let a = we ? 0.22 + 0.12 * rr2() : 0.55 + 0.35 * rr2();
      if (w === 4 && d === 2) a = 1.0;                    // holiday spike
      if (w === 9 && d === 1) a = 0.85;                   // event spike
      const cellX = 1096 + d * 64, cellY = 258 + w * 20;
      g.push(`<rect x="${cellX}" y="${cellY}" width="58" height="16" rx="4" fill="${C.yellow}" opacity="${(0.1 + a * 0.85).toFixed(2)}"/>`);
      if (w === 4 && d === 2) g.push(`<rect x="${cellX}" y="${cellY}" width="58" height="16" rx="4" fill="none" stroke="${C.red}" stroke-width="1.6"/>`);
      if (w === 9 && d === 1) g.push(`<rect x="${cellX}" y="${cellY}" width="58" height="16" rx="4" fill="none" stroke="${C.teal}" stroke-width="1.6"/>`);
    }
  }
  for (let d = 0; d < 7; d++) g.push(T(1096 + d * 64 + 29, 252, days[d], { size: 12, fill: '#7d8ea3', anchor: 'middle' }));
  g.push(MUL(1096, 552, [
    '红：法定节假日 —— 站台拥挤，且毫无预警',
    '青：站厅上方体育场有活动的日子',
    '灰线：可以给每个出口设定每小时的硬上限，',
    '这样消防封站就只是改一个数字。',
  ], { size: 12, fill: '#7d8ea3', lh: 18 }));

  /* --- C. transfer / OD --- */
  g.push(`<rect x="48" y="588" width="700" height="400" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(76, 622, 'C.  跨深度的换乘', { size: 15, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(T(76, 644, '换乘是一段步行、一道闸机和一次排队 —— 不是瞬移', { size: 12.5, fill: '#7d8ea3' }));
  const node = (x, y, txt, col, sub) => {
    g.push(`<rect x="${x}" y="${y}" width="150" height="54" rx="9" fill="${col}" opacity=".16" stroke="${col}" stroke-width="1.6"/>`);
    g.push(T(x + 75, y + 24, txt, { size: 13.5, fill: col, anchor: 'middle', weight: 700 }));
    if (sub) g.push(T(x + 75, y + 42, sub, { size: 11, fill: '#8fa0b3', anchor: 'middle' }));
  };
  node(90, 690, '1 号口', C.green, '进 900/时  出 1200/时');
  node(90, 800, '2 号口', C.green, '进 400/时  出 600/时');
  node(480, 690, '1 号线', C.lineA, '高架  +12 米');
  node(480, 800, '2 号线', C.lineB, 'B2  -13 米');
  node(480, 910, '3 号线', C.lineC, 'B3  -20 米');
  node(300, 745, '站厅', '#8fa3ba', 'B1  -5.5 米');
  const arrow = (x1, y1, x2, y2, col, dash) => `<path d="M${x1},${y1} L${x2},${y2}" stroke="${col}" stroke-width="2" fill="none" marker-end="url(#ah)"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity=".85"/>`;
  g.push(`<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#9fb3c8"/></marker></defs>`);
  g.push(arrow(240, 715, 300, 750, '#9fb3c8'));
  g.push(arrow(240, 822, 320, 780, '#9fb3c8'));
  g.push(arrow(450, 762, 480, 715, C.lineA));
  g.push(arrow(450, 775, 480, 810, C.lineB));
  g.push(arrow(440, 790, 480, 920, C.lineC));
  g.push(T(300, 700, '进站', { size: 11, fill: '#7d8ea3' }));
  g.push(MUL(76, 970, [
    '换乘时间 = 扶梯排队 + 每级台阶 0.35 秒 + 步行 + 过闸。深度差是一项',
    '真实成本，所以深层线路会把候车的乘客漏进站厅商铺。',
  ], { size: 12, fill: '#8fa0b3', lh: 17 }));

  /* --- D. exit control + wave shape --- */
  g.push(`<rect x="776" y="588" width="776" height="400" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(804, 622, 'D.  客流波塑形 + 出口流量控制', { size: 15, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(T(804, 644, '沙盒：没有票价、没有员工 —— 只有速率、波形和混合', { size: 12.5, fill: '#7d8ea3' }));
  const slider = (x, y, label, val, col) => {
    g.push(T(x, y - 8, label, { size: 12.5, fill: '#b7c4d2' }));
    g.push(`<rect x="${x}" y="${y}" width="330" height="10" rx="5" fill="#1d2731"/>`);
    g.push(`<rect x="${x}" y="${y}" width="${330 * val}" height="10" rx="5" fill="${col}"/>`);
    g.push(`<circle cx="${x + 330 * val}" cy="${y + 5}" r="11" fill="#eaf0f6" stroke="${C.ink}" stroke-width="2.4"/>`);
    g.push(T(x + 344, y + 11, `${Math.round(val * 100)}%`, { size: 12.5, fill: col, mono: true, weight: 700 }));
  };
  slider(820, 706, '早高峰量', 0.86, C.red);
  slider(820, 762, '晚高峰量', 0.94, C.red);
  slider(820, 818, '波形陡峭度（sigma）', 0.35, C.yellow);
  slider(820, 874, '活动 / 节假日概率', 0.2, C.teal);
  g.push(T(804, 928, '每个出口，每小时：', { size: 12.5, fill: '#b7c4d2', weight: 700 }));
  const excap = [['1 号口 进', 0.75, C.green], ['1 号口 出', 1.0, C.blue], ['2 号口 进', 0.33, C.green], ['2 号口 出', 0.5, C.blue]];
  excap.forEach(([lbl, v, col], i) => {
    const y = 946 + i * 14;
    g.push(T(804, y + 9, lbl, { size: 11.5, fill: '#8fa0b3', mono: true }));
    g.push(`<rect x="900" y="${y}" width="200" height="9" rx="4" fill="#1d2731"/>`);
    g.push(`<rect x="900" y="${y}" width="${200 * v}" height="9" rx="4" fill="${col}"/>`);
  });
  g.push(MUL(1120, 946, [
    '闸机饱和时并不会阻断：',
    '乘客会改道去下一个空闲出口，',
    '队列则以密度的形式回溢到站厅。',
  ], { size: 12, fill: '#7d8ea3', lh: 18 }));
  return sheet(W, H, g.join(''));
}

/* =================================================================== *
 * 08  ARCHITECTURE
 * =================================================================== */
export function artArch() {
  const W = 1600, H = 1060;
  const g = [];
  g.push(title(48, 62, '概念 08 // 软件结构',
    'React + three.js，仿真跑在 Worker 里',
    '人群仿真从不阻塞画面。React 负责面板与状态，three.js 负责场景，Worker 负责 3000 个走向列车的个体。'));

  const box = (x, y, w, h, t, lines, col, o = {}) => {
    g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${o.fill ?? '#111926'}" stroke="${col}" stroke-width="${o.sw ?? 1.8}"/>`);
    g.push(T(x + 16, y + 28, t, { size: 14.5, weight: 800, fill: col }));
    if (lines) g.push(MUL(x + 16, y + 52, lines, { size: 11.5, fill: '#93a1b3', lh: 18, mono: true }));
  };
  const arrow = (x1, y1, x2, y2, col, label, dash) => {
    g.push(`<path d="M${x1},${y1} L${x2},${y2}" stroke="${col}" stroke-width="2" fill="none" marker-end="url(#ah2)"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity=".9"/>`);
    if (label) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const tw = label.length * 12.5 + 20;
      g.push(`<rect x="${mx - tw / 2}" y="${my - 20}" width="${tw}" height="20" rx="5" fill="#0b0f16" stroke="${col}" stroke-width="1" opacity=".95"/>`);
      g.push(T(mx, my - 6, label, { size: 11, fill: col, anchor: 'middle', mono: true }));
    }
  };
  g.push(`<defs><marker id="ah2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#9fb3c8"/></marker></defs>`);

  box(60, 190, 300, 170, 'React 19 + Vite + TS', [
    '面板、工具条、属性栏',
    '线路管理、小地图',
    'zustand 状态（建造 + 仿真 UI）',
    'immer 补丁 → 撤销栈',
  ], '#61dafb');
  box(60, 390, 300, 150, '建造工具', [
    '笔刷 / 框选 / 线拖拽',
    '虚影预览 + 合法性校验',
    '蓝图复制粘贴',
    '写入 BuildCommand[]',
  ], C.yellow);
  box(60, 570, 300, 170, '数据与资源', [
    'modules.json（a × b，速率）',
    'materials.json、lines.json',
    '存档 = 种子 + 指令',
    '资源：每个模块一个 GLB',
  ], C.wood);
  box(60, 770, 300, 170, '渲染：react-three-fiber', [
    '分块体素网格',
    'InstancedMesh：3 千个体',
    '楼层切片 + 剖切',
    '后处理：柔和 AO、辉光',
  ], C.green);

  box(640, 190, 460, 190, '仿真 Worker（5 Hz 步进）', [
    'agents[] 带状态机',
    '按需求曲线生成客流波',
    '楼层图上的三维流场 / A*',
    '闸机 + 扶梯 + 列车 运力队列',
    '列车时刻表、停站、上下车',
    '指标：服务水平、密度、等待时间',
  ], C.blue);
  box(640, 430, 460, 150, '车站图', [
    '节点：格、闸机、站台、出口、列车',
    '边：步行、楼梯、扶梯、电梯',
    '竖向边带有楼层高差',
    '建造时增量重建',
  ], C.purple);
  box(640, 620, 460, 150, '帧循环', [
    'rAF：插值个体位置',
    '{id, pos, state, anim} 缓冲',
    '可转移 ArrayBuffer，零拷贝',
    'UI 以 2 Hz 读取指标，而非 60',
  ], C.teal);
  box(640, 800, 460, 140, '确定性', [
    '种子 + 步进 → 每次运行人群一致',
    '可以 A/B 对比布局改动',
    '快进：无渲染步进，不绘图',
  ], C.orange);

  box(1190, 190, 350, 190, '目录结构', [
    'src/',
    '  ui/        面板、属性栏',
    '  build/     工具、指令、撤销',
    '  sim/       Worker + 图 + 个体',
    '  scene/     体素网格、个体',
    '  data/      模块、材质',
    '  state/     zustand 分片',
  ], '#8fa0b3');
  box(1190, 420, 350, 210, '性能预算', [
    '16.6 毫秒/帧，目标 60 fps',
    '体素重建：分块局部，<4 毫秒',
    '个体：3,000 个 @ 60 fps 实例化',
    '仿真步进 5 Hz，每步 <8 毫秒',
    '60×60 车站存档 < 2 MB',
  ], C.green);
  box(1190, 670, 350, 270, '里程碑', [
    'M0  三维网格 + 相机 + 放置',
    'M1  表面 + 模块 + 存档',
    'M2  线路、轨道、列车',
    'M3  个体 + 闸机 + 站台',
    'M4  客流波、出口、换乘',
    'M5  多线路、分析、分享',
    'M6  上架准备、模组',
  ], C.yellow);

  arrow(360, 275, 640, 275, '#61dafb', 'BuildCommand[]');
  arrow(360, 465, 640, 465, C.yellow, '放置 / 擦除');
  arrow(360, 655, 640, 655, C.wood, '模块定义');
  arrow(640, 690, 360, 845, C.teal, '实例缓冲', '7 6');
  arrow(360, 830, 640, 690, C.green, '相机 + 切片', '7 6');
  arrow(640, 380, 640, 430, C.blue, '');
  arrow(640, 580, 640, 620, C.purple, '');
  arrow(1100, 330, 1190, 285, '#8fa0b3', '读取');
  return sheet(W, H, g.join(''));
}
