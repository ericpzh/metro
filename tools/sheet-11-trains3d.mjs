// Concept sheet 11 - the rolling stock in 3D. Cross-sections and side
// elevations live on sheet 05; this sheet is the isometric read of the same
// three cars, plus the consist, the platform interface and the two ways of
// getting power into the train.
import {
  C, TW, TH, ZU, P, px, py, n, shade, poly, faceSvg, boxSvg, rboxSvg, quadSvg,
  Scene, title, sheet, legend, callout, leader, T, MUL, rng, pstr, STOCK, carDoorCenters,
} from './iso.mjs';
import { isoCar, isoTrack, catenary } from './train-iso.mjs';

// Geometry comes from STOCK so the 3D car can never drift from the plan sheets.
const EXTRA = {
  A: {
    cars: '6 - 8', perCar: 310, pwr: '接触网  1500 V 直流 / 25 kV 交流', panto: true, cab: true,
    dest: '广州南站', lines: ['车体最宽', '跑干线 / 快线', '走高架，头顶是天空'],
  },
  B: {
    cars: '4 - 6', perCar: 240, pwr: '第三轨  750 V 直流', shoe: true, cab: true,
    dest: '五丝广场', lines: ['中国城市地铁的主力车型', '走隧道，配站台屏蔽门', 'B2 / B3 站台'],
  },
  C: {
    cars: '4 - 6', perCar: 200, pwr: '第三轨  750 V 直流 / 直线电机', shoe: true, cab: true,
    dest: '白云西', lines: ['轻车身，跑低需求支线', '自动化线路', '车更窄，土建更省'],
  },
};
const T3 = ['A', 'B', 'C'].map((id) => ({ ...STOCK[id], ...EXTRA[id] }));

/** Wrap a scene in a placement transform and return the world->sheet mapper. */
function place(S, o, pcx, pcy, k) {
  const cx = px(o.len / 2, o.w / 2);
  const cy = py(o.len / 2, o.w / 2, o.h / 2);
  const ox = pcx - cx * k, oy = pcy - cy * k;
  return {
    svg: `<g transform="translate(${n(ox)},${n(oy)}) scale(${k})">${S.out()}</g>`,
    at: (x, y, z) => [ox + px(x, y) * k, oy + py(x, y, z) * k],
  };
}

export function artTrains3D() {
  const W = 1600, H = 1240;
  const g = [];
  g.push(title(48, 62, '概念 11 // 列车三维图',
    'A / B / C 型车，按游戏里的建法画',
    '每节车厢，都是把圆角顶棚的断面沿车长拽出来。第 05 张给的是参数，这张给的是玩家真正看到的形状。'));
  const OV = [];                                              // overlay callouts

  T3.forEach((t, i) => {
    const px0 = 48, pw = 992, py0 = 170 + i * 352, ph = 336;
    g.push(`<rect x="${px0}" y="${py0}" width="${pw}" height="${ph}" rx="14" fill="#111926" stroke="#243040"/>`);
    g.push(`<rect x="${px0}" y="${py0}" width="8" height="${ph}" rx="4" fill="${t.col}"/>`);
    g.push(T(px0 + 34, py0 + 54, `${t.id} 型`, { size: 44, weight: 800, fill: t.col }));
    g.push(MUL(px0 + 36, py0 + 88, [
      `宽 ${t.w.toFixed(1)} 米  ×  高 ${t.h.toFixed(1)} 米  ×  长 ${t.len.toFixed(1)} 米`,
      `编组 ${t.cars} 节   |   每侧 ${t.doors} 门，门宽 ${t.doorW.toFixed(1)} 米`,
      `单节拥挤定员 ${t.perCar} 人`,
    ], { size: 12.5, fill: '#a9b8c8', lh: 21, mono: true }));
    g.push(MUL(px0 + 36, py0 + 176, t.lines, { size: 12, fill: '#7d8ea3', lh: 20 }));
    g.push(`<rect x="${px0 + 34}" y="${py0 + 238}" width="${t.pwr.length * 12 + 26}" height="26" rx="7" fill="${t.col}" opacity=".14" stroke="${t.col}" stroke-width="1.2"/>`);
    g.push(T(px0 + 46, py0 + 256, t.pwr, { size: 12, fill: t.col, mono: true }));

    /* the car itself */
    const S = Scene();
    isoCar(S, {
      x: 0, y: 0, z: 0.92, len: t.len, w: t.w, h: t.h, col: '#eef2f6',
      doors: t.doors, doorW: t.doorW, cab: t.cab, panto: t.panto, shoe: t.shoe,
      stripe: t.col, dest: t.cab, destText: t.dest, roofCol: '#dfe4ea', winCol: '#20303e',
    });
    const pl = place(S, { len: t.len, w: t.w, h: t.h }, px0 + 548, py0 + 186, 0.5);
    g.push(pl.svg);

    /* numbered read of the same car */
    const list = [];
    const co = (p, lx, ly, num, txt) => {
      const [ax, ay] = pl.at(p[0], p[1], p[2]);
      callout(list, ax, ay, lx, ly, num, txt, { col: t.col, dx: 20, size: 12.5 });
    };
    co([t.len * 0.5, t.w * 0.5, t.h + 0.16], px0 + 830, py0 + 60, 1, '车顶 + 空调机组');
    co([t.len * 0.62, t.w, t.h * 0.64], px0 + 856, py0 + 96, 2, '车窗带');
    co([t.len * 0.5, t.w, t.h * 0.35], px0 + 862, py0 + 134, 3, '涂装色带，走线路色');
    co([t.len * 0.72, t.w, t.h * 0.2], px0 + 858, py0 + 172, 4, '车门门板与门框');
    co([t.len * 0.19, t.w * 0.5, 0.0], px0 + 838, py0 + 216, 5, '转向架、2 组车轮、集电靴');
    co([t.len + 0.1, t.w * 0.5, t.h * 0.62], px0 + 856, py0 + 258, 6, '司机室 + 目的地显示屏');
    if (t.panto) co([t.len * 0.5, t.w * 0.5, t.h + 1.05], px0 + 828, py0 + 296, 7, '受电弓：接触网线路');
    if (t.shoe) co([t.len * 0.81, t.w * 0.62, -0.6], px0 + 846, py0 + 296, 7, '集电靴：第三轨线路');
    OV.push(list.join(''));
  });

  /* ---------------- right column: consist ---------------- */
  {
    const px0 = 1064, pw = 488, py0 = 170, ph = 384;
    g.push(`<rect x="${px0}" y="${py0}" width="${pw}" height="${ph}" rx="14" fill="#111926" stroke="#243040"/>`);
    g.push(T(px0 + 24, py0 + 34, '列车编组', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
    g.push(T(px0 + 24, py0 + 54, '完整 6 节编组，两头都带司机室', { size: 11.5, fill: '#7d8ea3' }));
    const S = Scene();
    const gap = 0.55, cars = 6, CL = 19.5, CW = 2.8, CH = 3.8;
    for (let c = 0; c < cars; c++) {
      const xx = c * (CL + gap);
      isoCar(S, {
        x: xx, y: 0, z: 0.92, len: CL, w: CW, h: CH, col: '#eef2f6',
        doors: 4, doorW: 1.3, cab: c === 0 || c === cars - 1, stripe: C.lineB, dest: c === 0, destText: '五丝广场',
        roofCol: '#dfe4ea', winCol: '#20303e',
      });
      if (c > 0) {
        S.fg.push([xx + 3.0, poly(
          [P(xx - 0.45, 1.0, 1.1), P(xx - 0.1, 1.0, 1.1),
            P(xx - 0.1, 1.8, 1.1), P(xx - 0.45, 1.8, 1.1)],
          shade('#3d454e', 1.0), C.ink, 0.5)]);
      }
    }
    isoTrack(S, { x: -0.6, y: -0.2, z: -0.18, len: cars * (CL + gap) + 1, w: 3.2, third: true });
    const pl = place(S, { len: cars * (CL + gap), w: CW, h: CH }, px0 + 244, py0 + 214, 0.115);
    g.push(pl.svg);
    g.push(MUL(px0 + 24, py0 + 344, [
      '6 × 19.5 米，加上 5 处车钩间隙 = 列车全长 119.8 米。',
      '站台至少得有这个长度，还得再留出停车余量。',
    ], { size: 11, fill: '#7d8ea3', lh: 15 }));
  }

  /* ---------------- right column: platform interface ---------------- */
  {
    const px0 = 1064, pw = 488, py0 = 574, ph = 320;
    g.push(`<rect x="${px0}" y="${py0}" width="${pw}" height="${ph}" rx="14" fill="#111926" stroke="#243040"/>`);
    g.push(T(px0 + 24, py0 + 34, '站台衔接', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
    g.push(T(px0 + 24, py0 + 54, '列车停靠站台，屏蔽门关着，第三轨带着电', { size: 11.5, fill: '#7d8ea3' }));
    const S = Scene();
    const L = 11.0, w = 2.8, h = 3.8, zf = 0.92;
    // tunnel shell behind the track
    S.raw(boxSvg(0, -3.0, -1.1, L + 2, 0.5, 6.6, C.soffit, { tone: 1.0 }));
    S.raw(boxSvg(-0.5, -3.0, 4.9, L + 3, 9, 0.5, C.soffit, { tone: 0.95 }));
    S.raw(quadSvg(0, 2.75, zf, L + 1, 5.0, C.floor, { tone: 1.0 }));
    S.raw(quadSvg(0, 2.75, zf + 0.01, L + 1, 0.95, C.tactile, { tone: 1.0 }));
    S.raw(quadSvg(0, 2.75, zf + 0.02, L + 1, 0.3, C.maroon, { tone: 1.0 }));
    isoTrack(S, { x: -0.5, y: -0.9, z: -0.18, len: L + 1.5, w: 3.2, third: true });
    // PSD: glass panels with an opening where the car door lands. Vertical, so
    // it must sort against the car rather than sit in the flat layer.
    const psd = (a, b) => {
      const kk = (a + b) / 2 + 2.78 + (zf + 1.2) * 0.9;
      S.fg.push([kk, faceSvg('y', 2.78, a, b, zf, zf + 2.35, C.glass, { tone: 1.34, opacity: 0.4, sw: 0.6 })]);
      for (const ex of [a, b]) S.fg.push([kk + 0.01, boxSvg(ex - 0.08, 2.72, zf, 0.16, 0.16, 2.35, C.steel, { tone: 1.05 })]);
      S.fg.push([kk + 0.02, boxSvg(a, 2.7, zf + 2.35, b - a, 0.2, 0.12, C.steel, { tone: 1.05 })]);
    };
    // PSD panels are built around the car-door centres, so every opening lands
    // exactly under a door leaf on the car (same cadence as sheets 05 and 12).
    const doorC = carDoorCenters(L, 3, 1.3).map((o) => L / 2 + o);
    const psdPanels = [];
    let p0 = 0.1;
    for (const d of doorC) {
      if (d - 0.65 - 0.12 > p0) psdPanels.push([p0, d - 0.65 - 0.12]);
      p0 = d + 0.65 + 0.12;
    }
    if (p0 < L) psdPanels.push([p0, L]);
    for (const [a, b] of psdPanels) psd(a, b);
    S.fg.push([5.6 + 2.72 + (zf + 1.0) * 0.9, boxSvg(0.1, 2.72, zf + 1.0, 10.9, 0.16, 0.2, C.steelD, { tone: 1.0 })]);
    isoCar(S, {
      x: 0, y: -0.55, z: zf, len: L, w, h, col: '#eef2f6', doors: 3, doorW: 1.3,
      stripe: C.lineB, roofCol: '#dfe4ea', winCol: '#20303e', tone: 0.96,
    });
    // platform crowd
    const rr = rng(77);
    for (let i = 0; i < 9; i++) {
      const gx = 0.6 + rr() * (L - 1.2), gy = 3.9 + rr() * 3.4;
      S.sprite(gx, gy, zf, 'person', { color: [C.red, C.blue, C.teal, C.purple, C.orange, C.pink][(rr() * 6) | 0] });
    }
    const pl = place(S, { len: L, w, h }, px0 + 250, py0 + 176, 0.52);
    g.push(pl.svg);
    const list = [];
    const co = (p, lx, ly, num, txt) => {
      const [ax, ay] = pl.at(p[0], p[1], p[2]);
      callout(list, ax, ay, lx, ly, num, txt, { col: C.lineB, dx: 18, size: 11.5 });
    };
    co([3.9, 2.9, 2.4], px0 + 392, py0 + 78, 1, '站台屏蔽门');
    co([5.0, 1.0, 0.35], px0 + 408, py0 + 118, 2, '第三轨 + 集电靴');
    co([2.0, 2.9, 1.1], px0 + 400, py0 + 158, 3, '站台边缘');
    co([8.5, 1.2, 2.2], px0 + 392, py0 + 200, 4, '地板与站台齐平');
    co([0.4, -2.7, 3.4], px0 + 396, py0 + 244, 5, '隧道顶板');
    g.push(list.join(''));
    g.push(MUL(px0 + 24, py0 + 282, [
      '屏蔽门会给每道门加一笔固定的耗时：',
      '上车要过门板、过门槛两个动作，变成两次。',
    ], { size: 11, fill: '#7d8ea3', lh: 15 }));
  }

  /* ---------------- right column: power pickup ---------------- */
  {
    const px0 = 1064, pw = 488, py0 = 918, ph = 266;
    g.push(`<rect x="${px0}" y="${py0}" width="${pw}" height="${ph}" rx="14" fill="#111926" stroke="#243040"/>`);
    g.push(T(px0 + 24, py0 + 34, '受电方式', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }));
    g.push(T(px0 + 24, py0 + 54, '怎么选，决定走隧道还是走高架', { size: 11.5, fill: '#7d8ea3' }));
    const mini = (ox, oy, kind) => {
      const S = Scene();
      const L = 8.5;
      S.raw(quadSvg(0, 0, -0.6, L + 1.5, 3.4, C.soil, { tone: 1.0, sw: 0.5 }));
      isoTrack(S, { x: -0.5, y: 0, z: -0.18, len: L + 1.5, w: 3.2, third: kind === 'third' });
      if (kind === 'catenary') catenary(S, { x: -0.5, y: 1.6, z: 0, len: L + 1.5 });
      isoCar(S, {
        x: 0, y: 0.2, z: 0.92, len: L, w: 2.8, h: 3.8, col: '#eef2f6', doors: 3, doorW: 1.3,
        stripe: kind === 'catenary' ? C.lineA : C.lineB, panto: kind === 'catenary', shoe: kind === 'third',
        roofCol: '#dfe4ea', winCol: '#20303e',
      });
      const pl = place(S, { len: L, w: 2.8, h: 3.8 }, ox, oy, 0.3);
      g.push(pl.svg);
    };
    mini(px0 + 130, py0 + 108, 'catenary');
    mini(px0 + 356, py0 + 108, 'third');
    g.push(T(px0 + 74, py0 + 176, '接触网 — A 型', { size: 11.5, weight: 700, fill: C.lineA, mono: true }));
    g.push(T(px0 + 74, py0 + 194, '高架、露天、净空高', { size: 10.5, fill: '#7d8ea3' }));
    g.push(T(px0 + 300, py0 + 176, '第三轨 — B / C 型', { size: 11.5, weight: 700, fill: C.lineB, mono: true }));
    g.push(T(px0 + 300, py0 + 194, '仅限隧道或加盖区间', { size: 10.5, fill: '#7d8ea3' }));
    g.push(MUL(px0 + 24, py0 + 222, [
      '你可以在街道上方架一段接触网高架，',
      '同一座车站的地下，又能跑第三轨线路。',
    ], { size: 11, fill: '#7d8ea3', lh: 15 }));
  }

  return sheet(W, H, g.join('') + OV.join(''));
}
