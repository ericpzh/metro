// Concept sheets 05-08
import { C, T, MUL, title, sheet, legend, poly, shade, n, pstr, chart, rng, LINES } from './iso.mjs';

/* =================================================================== *
 * 05  TRAINS + TRACK
 * =================================================================== */
const TYPES = [
  {
    id: 'A', col: '#e5484d', w: 3.0, h: 3.8, len: 22.0, cars: '6 - 8', perCar: 310, rated: 250,
    power: 'catenary 1500 V DC or 25 kV AC  (viaduct)  |  some lines third rail',
    gauge: 1435, vmax: '80 - 100 km/h', doors: '5 doors / side, 1.4 m',
    note: 'Widest profile: trunk lines, 8-car consists. Over-ground lines usually run catenary, so the platform needs no ceiling clearance and the station can open to the sky.',
  },
  {
    id: 'B', col: '#2f7ef2', w: 2.8, h: 3.8, len: 19.5, cars: '4 - 6', perCar: 240, rated: 200,
    power: 'third rail 750 V DC  (tunnel)',
    gauge: 1435, vmax: '80 km/h', doors: '4 doors / side, 1.3 m',
    note: 'The workhorse of Chinese city metros. Third rail forces a tunnel or a covered box, which is exactly why B lines run behind platform screen doors at B2/B3.',
  },
  {
    id: 'C', col: '#f2b32c', w: 2.6, h: 3.6, len: 19.0, cars: '4 - 6', perCar: 200, rated: 170,
    power: 'third rail 750 V DC  /  linear-motor variants',
    gauge: 1435, vmax: '80 km/h', doors: '4 doors / side, 1.2 m',
    note: 'Lighter profile for lower-demand branches and automated lines. Narrower cars mean narrower platforms and cheaper stations - but the crush load arrives just as hard.',
  },
];

export function artTrains() {
  const W = 1600, H = 1780;
  const g = [];
  g.push(title(48, 62, 'CONCEPT 05 // ROLLING STOCK',
    'A / B / C type trains, and what they demand of a station',
    'Chinese metro classification. The car width sets the platform edge, the door count sets the boarding rate, the power pickup decides tunnel or viaduct.'));

  TYPES.forEach((t, i) => {
    const y0 = 200 + i * 322;
    g.push(`<rect x="48" y="${y0 - 34}" width="1504" height="300" rx="14" fill="#111926" stroke="#243040"/>`);
    g.push(`<rect x="48" y="${y0 - 34}" width="8" height="284" rx="4" fill="${t.col}"/>`);

    // label
    g.push(T(84, y0 + 26, `TYPE ${t.id}`, { size: 40, weight: 800, fill: t.col }));
    g.push(MUL(84, y0 + 60, [
      `${t.w.toFixed(1)} m wide`, `${t.len.toFixed(1)} m long`, `${t.h.toFixed(1)} m tall`,
      `consist ${t.cars} cars`,
    ], { size: 13.5, fill: '#a9b8c8', lh: 22 }));

    // cross-section
    const s = 30;                                     // px per metre
    const cw = t.w * s, chh = t.h * s, cx = 330, cy = y0 + 210;
    g.push(T(330, y0 + 6, 'CROSS-SECTION', { size: 12, fill: '#6f8299', ls: 1.4, weight: 700 }));
    g.push(`<path d="M${cx},${cy} l0,${-chh + 26} a40,40 0 0 1 40,-26 l${cw - 80},0 a40,40 0 0 1 40,26 l0,${chh - 26} z" fill="#e9eef4" stroke="${C.ink}" stroke-width="2.4"/>`);
    g.push(`<rect x="${cx + 4}" y="${cy - chh + 34}" width="${cw - 8}" height="${chh * 0.34}" rx="8" fill="#22323f"/>`);
    g.push(`<rect x="${cx - 12}" y="${cy - 22}" width="${cw + 24}" height="22" rx="6" fill="#6c757f" stroke="${C.ink}" stroke-width="2"/>`);
    for (const dx of [cx - 16, cx + cw + 16 - 12]) g.push(`<rect x="${dx}" y="${cy - 6}" width="12" height="16" rx="3" fill="#1a1f27"/>`);
    // crush passengers
    const rr = rng(4 + i);
    for (let k = 0; k < t.perCar / 12; k++) {
      g.push(`<circle cx="${(cx + 14 + rr() * (cw - 28)).toFixed(1)}" cy="${(cy - 14 - rr() * (chh - 70)).toFixed(1)}" r="3.4" fill="${t.col}" opacity=".8"/>`);
    }
    g.push(T(cx + cw / 2, cy + 26, `${t.w.toFixed(1)} m`, { size: 12, fill: '#8fa0b3', anchor: 'middle', mono: true }));
    g.push(`<path d="M${cx - 30},${cy} l0,${-chh}" stroke="#8fa0b3" stroke-width="1.2"/>`);
    g.push(T(cx - 38, cy - chh / 2, `${t.h.toFixed(1)} m`, { size: 12, fill: '#8fa0b3', anchor: 'end', mono: true }));

    // side elevation: 3 cars + cut
    g.push(T(560, y0 + 6, `SIDE ELEVATION  (3 cars, ${t.len.toFixed(1)} m each, consist repeats)`, { size: 12, fill: '#6f8299', ls: 1.4, weight: 700 }));
    const sc = 11, carW = t.len * sc, carH = t.h * sc;
    for (let c = 0; c < 3; c++) {
      const cxx = 560 + c * (carW + 12);
      g.push(`<rect x="${cxx}" y="${y0 + 30}" width="${carW}" height="${carH}" rx="9" fill="#e9eef4" stroke="${C.ink}" stroke-width="2.2"/>`);
      g.push(`<rect x="${cxx}" y="${y0 + 30 + carH - 11}" width="${carW}" height="11" fill="${t.col}"/>`);
      g.push(`<rect x="${cxx + 10}" y="${y0 + 42}" width="${carW - 20}" height="${carH * 0.34}" rx="4" fill="#22323f"/>`);
      const doors = parseInt(t.doors, 10) || 4;
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
      g.push(T(1548, y0 + 20, 'catenary', { size: 11.5, fill: '#f0c000', anchor: 'end' }));
    } else {
      g.push(`<rect x="556" y="${y0 + 30 + carH + 12}" width="${3 * (carW + 12)}" height="6" fill="#f0c000" stroke="${C.ink}" stroke-width="1.2"/>`);
      g.push(T(560, y0 + 30 + carH + 40, 'third rail at track level - collector shoe under the bogie', { size: 11.5, fill: '#f0c000' }));
    }

    // capacity + facts
    const bx = 1150;
    g.push(T(bx, y0 + 30, 'CRUSH CAPACITY / CAR', { size: 11.5, fill: '#6f8299', ls: 1.2, weight: 700 }));
    g.push(`<rect x="${bx}" y="${y0 + 42}" width="300" height="20" rx="5" fill="#1d2731"/>`);
    g.push(`<rect x="${bx}" y="${y0 + 42}" width="${(t.rated / 310) * 300}" height="20" rx="5" fill="${t.col}" opacity=".55"/>`);
    g.push(`<rect x="${bx}" y="${y0 + 42}" width="${(t.perCar / 310) * 300}" height="20" rx="5" fill="none" stroke="${t.col}" stroke-width="1.6"/>`);
    g.push(T(bx + 8, y0 + 57, `${t.perCar} crush`, { size: 12, fill: '#0b0e13', weight: 800 }));
    g.push(T(bx + 308, y0 + 57, `/ ${t.rated} rated`, { size: 12, fill: '#8fa0b3' }));
    g.push(MUL(bx, y0 + 92, [
      `consist ${t.cars} cars  ->  ${(t.perCar * 6).toLocaleString()} pax crush (6-car)`,
      `vmax ${t.vmax}    doors  ${t.doors}`,
      `track gauge ${t.gauge} mm`,
    ], { size: 12.5, fill: '#a9b8c8', lh: 22, mono: true }));
    // wrapped note
    const words = t.note.split(' '); const lines = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > 46) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
    lines.push(cur.trim());
    g.push(MUL(bx, y0 + 158, lines, { size: 12.5, fill: '#8fa0b3', lh: 18 }));
    g.push(`<rect x="1150" y="${y0 + 228}" width="300" height="26" rx="6" fill="${t.col}" opacity=".14" stroke="${t.col}" stroke-width="1.2"/>`);
    g.push(T(1160, y0 + 246, t.power.slice(0, 40), { size: 11.5, fill: t.col, mono: true }));
  });

  /* =================================================================== *
   * 05b/05c  ROLLING STOCK AS A GAME-PLAY CHOICE + PSD HEIGHT
   * =================================================================== */
  const bar = (x, y, w, h, fill, o = {}) =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${o.rx ? ` rx="${n(o.rx)}"` : ''} fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ''}${o.opacity != null ? ` opacity="${o.opacity}"` : ''}/>`;

  g.push(`<rect x="48" y="1180" width="1504" height="1" fill="#243040"/>`);
  g.push(T(48, 1210, '05b  ROLLING STOCK IS A CHOICE, NOT A DRAWING', { size: 14, weight: 800, fill: C.yellow, ls: 1.3 }));
  g.push(T(48, 1230, 'Five decisions name and shape the train. Type and consist set capacity; power, colour and name identify the line.', { size: 12.5, fill: '#8fa0b3' }));

  const cy0 = 1252, cw = 282, cgap = 16, ch = 176;
  const card = (i, title, sub) => {
    const x = 48 + i * (cw + cgap);
    g.push(`<rect x="${x}" y="${cy0}" width="${cw}" height="${ch}" rx="12" fill="#111926" stroke="#243040"/>`);
    g.push(T(x + 16, cy0 + 26, title, { size: 12.5, weight: 800, fill: C.yellow, ls: 1.2 }));
    g.push(T(x + 16, cy0 + 44, sub, { size: 11, fill: '#5d6d80' }));
    return x;
  };
  {
    const x = card(0, '1  CAR TYPE', 'passengers per car');
    [['A', 310, '#e5484d'], ['B', 240, C.lineB], ['C', 200, '#f2b32c']].forEach(([id, per, col], k) => {
      const yy = cy0 + 62 + k * 34;
      g.push(bar(x + 16, yy, 46, 28, col, { rx: 6, opacity: 0.18, stroke: col }));
      g.push(T(x + 39, yy + 19, id, { size: 15, weight: 800, fill: col, anchor: 'middle' }));
      g.push(T(x + 74, yy + 19, `${per} pax crush`, { size: 12.5, fill: '#c3d0de', mono: true }));
    });
  }
  {
    const x = card(1, '2  CONSIST LENGTH', 'cars per train  ·  total crush (B)');
    [4, 6, 8].forEach((cars, k) => {
      const yy = cy0 + 66 + k * 34;
      g.push(bar(x + 16, yy, 46, 28, C.lineB, { rx: 6, opacity: 0.16, stroke: C.lineB }));
      g.push(T(x + 39, yy + 19, String(cars), { size: 15, weight: 800, fill: C.lineB, anchor: 'middle' }));
      g.push(T(x + 74, yy + 19, `${(240 * cars).toLocaleString()} pax`, { size: 12.5, fill: '#c3d0de', mono: true }));
    });
  }
  {
    const x = card(2, '3  POWER', 'the pickup decides tunnel or viaduct');
    [['THIRD RAIL 750 V DC', 'tunnel / covered box only', C.lineB], ['CATENARY 1500 V DC', 'viaduct / open cut', C.lineA]].forEach(([t, s, col], k) => {
      const yy = cy0 + 64 + k * 50;
      g.push(bar(x + 16, yy, 250, 42, col, { rx: 8, opacity: 0.12, stroke: col }));
      g.push(T(x + 28, yy + 18, t, { size: 11.5, weight: 800, fill: col, mono: true }));
      g.push(T(x + 28, yy + 34, s, { size: 10.5, fill: '#8fa0b3' }));
    });
  }
  {
    const x = card(3, '4  LINE COLOUR', 'one colour per line paints the car');
    LINES.forEach(([id, col], k) => {
      const sx = x + 16 + (k % 3) * 84, sy = cy0 + 66 + Math.floor(k / 3) * 42;
      g.push(bar(sx, sy, 36, 28, col, { rx: 6 }));
      g.push(T(sx + 46, sy + 19, id, { size: 13, weight: 800, fill: '#eaf0f6', mono: true }));
    });
    g.push(T(x + 16, cy0 + 164, 'the stock type no longer paints the car', { size: 10.5, fill: '#7d8ea3' }));
  }
  {
    const x = card(4, '5  LINE NAME', 'what the destination board reads');
    g.push(bar(x + 16, cy0 + 64, 250, 46, '#141a20', { rx: 7, stroke: '#243040' }));
    g.push(T(x + 30, cy0 + 86, 'Line 2  ·  Wusi Square', { size: 12.5, weight: 700, fill: '#ffd45e', mono: true }));
    g.push(T(x + 30, cy0 + 103, '五丝广场', { size: 12, fill: '#c3d0de' }));
    g.push(T(x + 16, cy0 + 164, 'colour + name + stock = the line', { size: 10.5, fill: '#7d8ea3' }));
  }
  g.push(T(48, cy0 + ch + 26, 'A line is the unit you edit. Everything else - dwell, headway, boarding rate, where it can run - follows from these five.', { size: 12.5, fill: '#8fa0b3' }));

  /* ---- platform screen doors: full height or half height ---- */
  g.push(T(48, 1500, '05c  PLATFORM SCREEN DOORS: FULL HEIGHT OR HALF HEIGHT', { size: 14, weight: 800, fill: C.yellow, ls: 1.3 }));
  g.push(T(48, 1520, 'The same door cadence, two screens. Full height seals the platform; half height leaves the top open for smoke clearance and costs less.', { size: 12.5, fill: '#8fa0b3' }));

  const secY = 1560, secH = 150;
  const psdSection = (x, full) => {
    const yb = secY + secH;
    g.push(T(x, secY + 8, full ? 'FULL HEIGHT  2.35 m' : 'HALF HEIGHT  1.20 m', { size: 12, weight: 800, fill: full ? C.glass : C.yellow, mono: true }));
    g.push(bar(x, yb - 12, 214, 12, '#c9cdd2'));
    g.push(bar(x, yb - 12, 214, 4, C.tactile));
    g.push(bar(x + 196, yb - 14, 18, 14, C.maroon));
    const cxx = x + 232;
    g.push(bar(cxx, yb - 78, 150, 78, '#eef2f6', { stroke: C.ink, sw: 1.6 }));
    g.push(bar(cxx + 8, yb - 66, 134, 18, '#26333f', { rx: 3 }));
    g.push(bar(cxx + 52, yb - 72, 34, 72, '#41525f', { stroke: C.ink, sw: 1.2 }));
    g.push(`<line x1="${cxx + 69}" y1="${yb - 72}" x2="${cxx + 69}" y2="${yb}" stroke="#7d8ea3" stroke-width="1.2"/>`);
    g.push(T(cxx + 75, yb + 16, 'car door', { size: 10.5, fill: '#8fa0b3', anchor: 'middle' }));
    const px = x + 196;
    const top = full ? yb - 94 : yb - 48;
    g.push(bar(px, top, 8, yb - top - 2, C.glass, { stroke: C.ink, sw: 0.8, opacity: 0.65 }));
    g.push(bar(px - 8, top - (full ? 8 : 6), 24, full ? 10 : 8, C.steel, { stroke: C.ink, sw: 0.8 }));
    if (full) g.push(bar(px - 8, yb - 34, 24, 5, C.steelD));
    g.push(`<path d="M${px - 44},${top} L${px - 44},${yb - 2}" stroke="${C.yellow}" stroke-width="1.2"/>`);
    g.push(`<path d="M${px - 48},${top} L${px - 40},${top} M${px - 48},${yb - 2} L${px - 40},${yb - 2}" stroke="${C.yellow}" stroke-width="1.2"/>`);
    g.push(T(px - 54, (top + yb) / 2, full ? '2.35 m' : '1.20 m', { size: 11, fill: C.yellow, anchor: 'end', mono: true }));
    g.push(T(x, yb + 30, full ? 'sealed floor to soffit  ·  paid-area air control' : 'waist-high barrier  ·  open above for smoke', { size: 11, fill: '#8fa0b3' }));
  };
  psdSection(76, true);
  psdSection(470, false);

  {
    const tx = 960, ty = secY - 6, tw = 568, rh = 30;
    g.push(T(tx, ty, 'CRUSH CAPACITY BY TYPE × CONSIST', { size: 12, weight: 800, fill: C.yellow, ls: 1.1 }));
    ['type', 'per car', '4-car', '6-car', '8-car'].forEach((c, k) => g.push(T(tx + 8 + k * 112, ty + 34, c, { size: 11, fill: '#7d8ea3', mono: true, weight: 700 })));
    [['A', 310, '#e5484d'], ['B', 240, C.lineB], ['C', 200, '#f2b32c']].forEach(([id, per, col], r) => {
      const yy = ty + 46 + r * rh;
      g.push(bar(tx, yy, tw, rh - 6, col, { rx: 6, opacity: 0.1 }));
      g.push(T(tx + 8, yy + 18, id, { size: 13, weight: 800, fill: col, mono: true }));
      [per, per * 4, per * 6, per * 8].forEach((v, k) => g.push(T(tx + 8 + (k + 1) * 112, yy + 18, v.toLocaleString(), { size: 12, fill: '#dfe7f0', mono: true })));
    });
    g.push(T(tx, ty + 46 + 3 * rh + 18, 'crush load; rated is about 80% of crush. A train that cannot finish boarding leaves people behind - the core pressure readout.', { size: 11, fill: '#7d8ea3' }));
  }

  g.push(T(48, H - 24, 'Simulation contract: a line is {stock type, consist length, power, colour, name}. A train is {type, cars, doorsPerCar, doorWidth, dwellBase, maxLoad}. Boarding rate = f(doorWidth, crowding, alighting count). The PSD, full or half height, adds a fixed per-door transfer cost.', { size: 12.5, fill: '#7d8ea3' }));
  return sheet(W, H, g.join(''));
}

/* =================================================================== *
 * 06  DEMAND
 * =================================================================== */
export function artDemand() {
  const W = 1600, H = 1120;
  const g = [];
  g.push(title(48, 62, 'CONCEPT 06 // CROWD DEMAND',
    'Where the crowds come from, and when',
    'Every exit has an inlet rate, every platform has an outlet rate. Time of day, day of week and the calendar shape the waves. Lines exchange passengers through the concourse.'));

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
  g.push(T(76, 214, 'A.  ONE STATION, ONE WEEKDAY', { size: 15, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(T(76, 236, 'passengers entering per 5 minutes', { size: 12.5, fill: '#7d8ea3' }));
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
  g.push(T(200 + (8 / 23) * 820, 268, 'AM PEAK', { size: 11.5, fill: C.red, anchor: 'middle', weight: 800 }));
  g.push(T(200 + (18 / 23) * 820, 268, 'PM PEAK', { size: 11.5, fill: C.red, anchor: 'middle', weight: 800 }));
  g.push(legend(78, 540, [[C.yellow, 'weekday'], [C.pink, 'saturday'], [C.teal, 'sunday / holiday']], { size: 12.5, step: 22 }));

  /* --- B. calendar --- */
  g.push(`<rect x="1072" y="180" width="480" height="380" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(1096, 214, 'B.  CALENDAR', { size: 15, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(T(1096, 236, 'baseline multiplier per day type', { size: 12.5, fill: '#7d8ea3' }));
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
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
    'red  : public holiday - platform crush, no warning',
    'teal : event day at the stadium above the concourse',
    'Grey line: exits can be given a hard cap per hour,',
    'so a fire-marshal closure is just a number change.',
  ], { size: 12, fill: '#7d8ea3', lh: 18 }));

  /* --- C. transfer / OD --- */
  g.push(`<rect x="48" y="588" width="700" height="400" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(76, 622, 'C.  TRANSFER, ACROSS DEPTHS', { size: 15, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(T(76, 644, 'a transfer is a walk, a gate and a queue - not a teleport', { size: 12.5, fill: '#7d8ea3' }));
  const node = (x, y, txt, col, sub) => {
    g.push(`<rect x="${x}" y="${y}" width="150" height="54" rx="9" fill="${col}" opacity=".16" stroke="${col}" stroke-width="1.6"/>`);
    g.push(T(x + 75, y + 24, txt, { size: 13.5, fill: col, anchor: 'middle', weight: 700 }));
    if (sub) g.push(T(x + 75, y + 42, sub, { size: 11, fill: '#8fa0b3', anchor: 'middle' }));
  };
  node(90, 690, 'EXIT 1', C.green, 'in 900/h  out 1200/h');
  node(90, 800, 'EXIT 2', C.green, 'in 400/h  out 600/h');
  node(480, 690, 'LINE 1', C.lineA, 'viaduct  +12 m');
  node(480, 800, 'LINE 2', C.lineB, 'B2  -13 m');
  node(480, 910, 'LINE 3', C.lineC, 'B3  -20 m');
  node(300, 745, 'CONCOURSE', '#8fa3ba', 'B1  -5.5 m');
  const arrow = (x1, y1, x2, y2, col, dash) => `<path d="M${x1},${y1} L${x2},${y2}" stroke="${col}" stroke-width="2" fill="none" marker-end="url(#ah)"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity=".85"/>`;
  g.push(`<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#9fb3c8"/></marker></defs>`);
  g.push(arrow(240, 715, 300, 750, '#9fb3c8'));
  g.push(arrow(240, 822, 320, 780, '#9fb3c8'));
  g.push(arrow(450, 762, 480, 715, C.lineA));
  g.push(arrow(450, 775, 480, 810, C.lineB));
  g.push(arrow(440, 790, 480, 920, C.lineC));
  g.push(T(300, 700, 'entry', { size: 11, fill: '#7d8ea3' }));
  g.push(MUL(76, 970, [
    'Transfer time = queue at the escalator + 0.35 s per step + walk + gate. Depth difference is a',
    'real cost, so a deep line bleeds passengers into the concourse shops while they wait.',
  ], { size: 12, fill: '#8fa0b3', lh: 17 }));

  /* --- D. exit control + wave shape --- */
  g.push(`<rect x="776" y="588" width="776" height="400" rx="14" fill="#111926" stroke="#243040"/>`);
  g.push(T(804, 622, 'D.  WAVE SHAPER  +  EXIT FLOW CONTROL', { size: 15, weight: 800, fill: C.yellow, ls: 1.2 }));
  g.push(T(804, 644, 'sandbox: no ticket price, no staff - only rate, shape and mixing', { size: 12.5, fill: '#7d8ea3' }));
  const slider = (x, y, label, val, col) => {
    g.push(T(x, y - 8, label, { size: 12.5, fill: '#b7c4d2' }));
    g.push(`<rect x="${x}" y="${y}" width="330" height="10" rx="5" fill="#1d2731"/>`);
    g.push(`<rect x="${x}" y="${y}" width="${330 * val}" height="10" rx="5" fill="${col}"/>`);
    g.push(`<circle cx="${x + 330 * val}" cy="${y + 5}" r="11" fill="#eaf0f6" stroke="${C.ink}" stroke-width="2.4"/>`);
    g.push(T(x + 344, y + 11, `${Math.round(val * 100)}%`, { size: 12.5, fill: col, mono: true, weight: 700 }));
  };
  slider(820, 706, 'AM peak volume', 0.86, C.red);
  slider(820, 762, 'PM peak volume', 0.94, C.red);
  slider(820, 818, 'wave sharpness (sigma)', 0.35, C.yellow);
  slider(820, 874, 'event / holiday chance', 0.2, C.teal);
  g.push(T(804, 928, 'Per exit, per hour:', { size: 12.5, fill: '#b7c4d2', weight: 700 }));
  const excap = [['Exit 1 in', 0.75, C.green], ['Exit 1 out', 1.0, C.blue], ['Exit 2 in', 0.33, C.green], ['Exit 2 out', 0.5, C.blue]];
  excap.forEach(([lbl, v, col], i) => {
    const y = 946 + i * 14;
    g.push(T(804, y + 9, lbl, { size: 11.5, fill: '#8fa0b3', mono: true }));
    g.push(`<rect x="900" y="${y}" width="200" height="9" rx="4" fill="#1d2731"/>`);
    g.push(`<rect x="900" y="${y}" width="${200 * v}" height="9" rx="4" fill="${col}"/>`);
  });
  g.push(MUL(1120, 946, [
    'When a gate saturates it does not block:',
    'passengers re-route to the next free exit, and',
    'the queue backs into the concourse as density.',
  ], { size: 12, fill: '#7d8ea3', lh: 18 }));
  return sheet(W, H, g.join(''));
}

/* =================================================================== *
 * 07  UI
 * =================================================================== */
export function artUI() {
  const W = 1600, H = 1000;
  const g = [];
  g.push(title(48, 62, 'CONCEPT 07 // INTERFACE',
    'Building and watching, in one screen',
    'The camera is the level selector. Left rail builds, right panel tunes the selected thing, bottom rail owns lines, levels and overlays.'));
  // frames
  g.push(`<rect x="48" y="170" width="1504" height="790" rx="16" fill="#0b0f16" stroke="#243040"/>`);
  const panel = (x, y, w, h, t, sub) => {
    g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#131b26" stroke="#243040"/>`);
    if (t) g.push(T(x + 12, y + 22, t, { size: 12.5, weight: 800, fill: '#8fa0b3', ls: 1.2 }));
    if (sub) g.push(T(x + 12, y + 40, sub, { size: 11, fill: '#5d6d80' }));
  };
  // top bar
  panel(60, 182, 1480, 54);
  g.push(T(78, 216, 'Wusi Square  Interchange', { size: 17, weight: 800, fill: '#eaf0f6' }));
  g.push(T(310, 216, 'Mon 07:42  |  weekday  |  x4 speed', { size: 13, fill: '#8fa0b3', mono: true }));
  g.push(`<rect x="700" y="196" width="180" height="26" rx="7" fill="#1d2731"/>`);
  g.push(T(712, 214, '3,412 in station', { size: 12.5, fill: C.yellow, mono: true }));
  g.push(`<rect x="890" y="196" width="150" height="26" rx="7" fill="#1d2731"/>`);
  g.push(T(902, 214, 'worst LOS  D', { size: 12.5, fill: C.red, mono: true }));
  for (let i = 0; i < 5; i++) {
    g.push(`<rect x="${1220 + i * 62}" y="196" width="52" height="26" rx="7" fill="${i === 3 ? '#2f7ef2' : '#1d2731'}" stroke="#243040"/>`);
  }
  g.push(T(1246, 214, 'pause', { size: 11.5, fill: '#c3d0de', anchor: 'middle' }));
  g.push(T(1308, 214, '1x', { size: 11.5, fill: '#c3d0de', anchor: 'middle' }));
  g.push(T(1370, 214, '4x', { size: 11.5, fill: '#fff', anchor: 'middle' }));
  g.push(T(1432, 214, '16x', { size: 11.5, fill: '#c3d0de', anchor: 'middle' }));
  g.push(T(1494, 214, 'save', { size: 11.5, fill: '#c3d0de', anchor: 'middle' }));

  // left rail
  panel(60, 248, 196, 500, 'BUILD');
  const tools = ['Structure', 'Walls', 'Floors', 'Ceilings', 'Fare gates', 'Retail', 'Machines', 'Stairs', 'Escalators', 'Lifts', 'Tracks', 'Signage'];
  tools.forEach((t, i) => {
    const y = 282 + i * 38;
    const active = i === 4;
    g.push(`<rect x="70" y="${y}" width="176" height="32" rx="8" fill="${active ? '#1d3a66' : '#0f1620'}" stroke="${active ? '#2f7ef2' : '#1d2731'}"/>`);
    g.push(`<rect x="80" y="${y + 8}" width="16" height="16" rx="4" fill="${active ? C.blue : '#39465a'}"/>`);
    g.push(T(104, y + 21, t, { size: 12.5, fill: active ? '#eaf0f6' : '#a9b8c8' }));
    if (active) g.push(T(240, y + 21, '4', { size: 11, fill: C.blue, mono: true, anchor: 'end' }));
  });
  panel(60, 758, 196, 190, 'SNAP');
  g.push(MUL(72, 800, ['grid 1 x 1 m  ON', 'level snap  ON', 'auto-corner ON', 'blueprint x8', 'undo 14 / redo 0'], { size: 12, fill: '#a9b8c8', lh: 22, mono: true }));

  // centre viewport
  panel(268, 248, 900, 500, null);
  g.push(`<rect x="280" y="260" width="876" height="476" rx="8" fill="#0d141d"/>`);
  // fake iso block room
  const iso = [];
  const TW = 26, TH = 13, ZU = 22, ox = 700, oy = 520;
  const ip = (x, y, z) => [ox + (x - y) * TW, oy + (x + y) * TH - z * ZU];
  const iq = (x, y, z, w, d, col) => poly([ip(x, y, z), ip(x + w, y, z), ip(x + w, y + d, z), ip(x, y + d, z)], col, C.ink, 0.7);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    iso.push(iq(i, j, 0, 1, 1, (i + j) % 2 ? '#2c3a4a' : '#31404f'));
  }
  // ghost preview square
  iso.push(`<polygon points="${pstr([ip(7, 2, 0), ip(10, 2, 0), ip(10, 4, 0), ip(7, 4, 0)])}" fill="${C.blue}" opacity=".35" stroke="${C.blue}" stroke-width="2" stroke-dasharray="5 4"/>`);
  iso.push(iq(7, 2, 0.02, 3, 2, '#2f7ef2'));
  iso.push(`<polygon points="${pstr([ip(6, 6, 0), ip(10, 6, 0), ip(10, 6, 1), ip(6, 6, 1)])}" fill="#6e7885" stroke="${C.ink}" stroke-width="0.7"/>`);
  for (let i = 0; i < 8; i++) {
    const gx0 = 1.2 + i * 1.05;
    iso.push(poly([ip(gx0, 7, 0), ip(gx0 + 0.8, 7, 0), ip(gx0 + 0.8, 7, 1), ip(gx0, 7, 1)], '#98a4b1', C.ink, 0.7));
    iso.push(poly([ip(gx0 + 0.8, 7, 0), ip(gx0 + 0.8, 8.4, 0), ip(gx0 + 0.8, 8.4, 1), ip(gx0 + 0.8, 7, 1)], '#6e7885', C.ink, 0.7));
    iso.push(poly([ip(gx0, 7, 1), ip(gx0 + 0.8, 7, 1), ip(gx0 + 0.8, 7, 1.16), ip(gx0, 7, 1.16)], i % 2 ? C.green : C.green, C.ink, 0.6));
  }
  iso.push(poly([ip(3, 4.5, 0.02), ip(5, 4.5, 0.02), ip(5, 5.5, 0.02), ip(3, 5.5, 0.02)], C.blue, 'none', 0));
  g.push(`<g>${iso.join('')}</g>`);
  g.push(`<g><use href="#person" x="${n(ip(2, 3, 0)[0])}" y="${n(ip(2, 3, 0)[1])}" style="color:${C.red}"/><use href="#person" x="${n(ip(3.4, 3.6, 0)[0])}" y="${n(ip(3.4, 3.6, 0)[1])}" style="color:${C.teal}"/><use href="#person" x="${n(ip(4.6, 2.6, 0)[0])}" y="${n(ip(4.6, 2.6, 0)[1])}" style="color:${C.purple}"/><use href="#person" x="${n(ip(6.4, 8.6, 0)[0])}" y="${n(ip(6.4, 8.6, 0)[1])}" style="color:${C.orange}"/><use href="#person" x="${n(ip(8.2, 9.4, 0)[0])}" y="${n(ip(8.2, 9.4, 0)[1])}" style="color:${C.blue}"/></g>`);
  g.push(T(300, 288, 'viewport', { size: 12, fill: '#39465a', ls: 1.4, weight: 700, mono: true }));
  g.push(T(1140, 288, 'LMB build  |  RMB erase  |  MMB orbit  |  wheel zoom  |  Q/E level', { size: 11.5, fill: '#39465a', mono: true, anchor: 'end' }));
  // overlay legend floating
  panel(294, 636, 244, 88);
  g.push(T(306, 660, 'OVERLAY: crowd density', { size: 11.5, fill: C.yellow, weight: 700 }));
  for (let i = 0; i < 24; i++) {
    g.push(`<rect x="${306 + i * 9}" y="670" width="9" height="12" fill="${['#2fb344', '#f2b32c', '#f97316', '#e5484d'][Math.min(3, Math.floor(i / 6))]}"/>`);
  }
  g.push(T(306, 708, 'LOS A  ->  D  (crush)', { size: 11, fill: '#8fa0b3', mono: true }));
  // level slice slider
  panel(912, 626, 234, 98, null);
  g.push(T(924, 650, 'LEVEL SLICE', { size: 11.5, fill: '#8fa0b3', weight: 700, ls: 1.2 }));
  ['B4', 'B3', 'B2', 'B1', 'G', 'L1'].forEach((t, i) => {
    const x = 926 + i * 35;
    g.push(`<rect x="${x}" y="664" width="28" height="42" rx="6" fill="${i === 3 ? '#2f7ef2' : '#1d2731'}"/>`);
    g.push(T(x + 14, 690, t, { size: 11, fill: i === 3 ? '#fff' : '#8fa0b3', anchor: 'middle', mono: true }));
  });
  g.push(T(924, 716, 'viewing B1', { size: 11, fill: '#2f7ef2', mono: true }));

  // right inspector
  panel(1184, 248, 356, 500, 'INSPECTOR');
  g.push(T(1196, 286, 'Turnstile gate  x6', { size: 15, weight: 700, fill: '#eaf0f6' }));
  g.push(T(1196, 306, 'footprint 1 x 2  |  level B1  |  facing W', { size: 11.5, fill: '#7d8ea3', mono: true }));
  const fields = [
    ['Mode', 'bidirectional'], ['Throughput', '25 pax/min'], ['Queue anchor', 'south side'],
    ['Access', 'paid zone only'], ['Tags', 'fare, queue'], ['LOS at peak', 'C  (queue 4.1 m)'],
  ];
  fields.forEach(([k, v], i) => {
    const y = 336 + i * 36;
    g.push(`<rect x="1196" y="${y}" width="332" height="28" rx="7" fill="#0f1620" stroke="#1d2731"/>`);
    g.push(T(1208, y + 19, k, { size: 12, fill: '#8fa0b3' }));
    g.push(T(1516, y + 19, v, { size: 12, fill: '#dfe7f0', anchor: 'end', mono: true }));
  });
  g.push(`<rect x="1196" y="568" width="332" height="1" fill="#243040"/>`);
  g.push(T(1196, 592, 'CONNECTED TO', { size: 11.5, fill: '#8fa0b3', weight: 700, ls: 1.2 }));
  const conns = [['Concourse B1', C.blue], ['Exit 1  (up 900/h)', C.green], ['Line 2 platform B2', C.lineB], ['Line 1 via escalator', C.lineA]];
  conns.forEach(([t, col], i) => {
    const y = 608 + i * 32;
    g.push(`<rect x="1196" y="${y}" width="332" height="26" rx="7" fill="${col}" opacity=".12" stroke="${col}" stroke-width="1"/>`);
    g.push(`<circle cx="1212" cy="${y + 13}" r="5" fill="${col}"/>`);
    g.push(T(1228, y + 18, t, { size: 12, fill: '#c3d0de' }));
  });
  g.push(T(1196, 736, 'Line manager: add a line, pick A/B/C stock, then assign', { size: 11.5, fill: '#7d8ea3' }));

  // bottom rail
  panel(60, 766, 1480, 182, null);
  g.push(T(76, 794, 'LINE MANAGER', { size: 12, fill: '#8fa0b3', weight: 800, ls: 1.2 }));
  [['1', C.lineA, 'A / 6 cars', 'catenary', '2 min'], ['2', C.lineB, 'B / 6 cars', 'third rail', '2.5 min'], ['3', C.lineC, 'C / 4 cars', 'third rail', '3 min']].forEach(([id, col, stock, pwr, head], i) => {
    const x = 76 + i * 292, y = 808;
    g.push(`<rect x="${x}" y="${y}" width="276" height="120" rx="10" fill="#0f1620" stroke="#1d2731"/>`);
    g.push(`<circle cx="${x + 26}" cy="${y + 26}" r="14" fill="${col}"/>`);
    g.push(T(x + 26, y + 31, id, { size: 14, weight: 800, fill: '#0b0e13', anchor: 'middle' }));
    g.push(T(x + 50, y + 24, `Line ${id}`, { size: 13.5, weight: 700, fill: '#eaf0f6' }));
    g.push(T(x + 50, y + 42, `${stock}  -  ${pwr}`, { size: 11.5, fill: '#8fa0b3', mono: true }));
    g.push(T(x + 16, y + 70, `headway ${head}`, { size: 12, fill: '#c3d0de', mono: true }));
    g.push(`<rect x="${x + 16}" y="${y + 82}" width="244" height="10" rx="5" fill="#1d2731"/>`);
    g.push(`<rect x="${x + 16}" y="${y + 82}" width="${244 * (0.9 - i * 0.18)}" height="10" rx="5" fill="${col}"/>`);
    g.push(T(x + 16, y + 110, ['through-running', 'terminus + reverse', 'cross-platform xfer'][i], { size: 11.5, fill: '#7d8ea3' }));
  });
  panel(976, 808, 560, 120, null);
  g.push(T(992, 834, 'MINIMAP', { size: 12, fill: '#8fa0b3', weight: 800, ls: 1.2 }));
  g.push(`<rect x="992" y="844" width="200" height="70" rx="8" fill="#0d141d" stroke="#1d2731"/>`);
  g.push(`<path d="M1000,900 L1100,880 L1190,896" stroke="${C.lineA}" stroke-width="3" fill="none"/>`);
  g.push(`<path d="M1000,880 L1120,860 L1190,872" stroke="${C.lineB}" stroke-width="3" fill="none"/>`);
  g.push(`<circle cx="1100" cy="874" r="7" fill="${C.yellow}"/>`);
  g.push(MUL(1210, 864, [
    'Exits  3 built / 2 planned',
    'Gates  14 in  |  14 out',
    'Esc      6 up  |   4 down',
    'Lifts     2  (step-free path OK)',
  ], { size: 11.5, fill: '#a9b8c8', lh: 20, mono: true }));
  return sheet(W, H, g.join(''));
}

/* =================================================================== *
 * 08  ARCHITECTURE
 * =================================================================== */
export function artArch() {
  const W = 1600, H = 1060;
  const g = [];
  g.push(title(48, 62, 'CONCEPT 08 // SOFTWARE SHAPE',
    'React + three.js, simulation in a worker',
    'The crowd sim never blocks the frame. React owns panels and state, three.js owns the scene, the worker owns 3,000 agents walking to a train.'));

  const box = (x, y, w, h, t, lines, col, o = {}) => {
    g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${o.fill ?? '#111926'}" stroke="${col}" stroke-width="${o.sw ?? 1.8}"/>`);
    g.push(T(x + 16, y + 28, t, { size: 14.5, weight: 800, fill: col }));
    if (lines) g.push(MUL(x + 16, y + 52, lines, { size: 11.5, fill: '#93a1b3', lh: 18, mono: true }));
  };
  const arrow = (x1, y1, x2, y2, col, label, dash) => {
    g.push(`<path d="M${x1},${y1} L${x2},${y2}" stroke="${col}" stroke-width="2" fill="none" marker-end="url(#ah2)"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity=".9"/>`);
    if (label) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const tw = label.length * 6.4 + 14;
      g.push(`<rect x="${mx - tw / 2}" y="${my - 20}" width="${tw}" height="20" rx="5" fill="#0b0f16" stroke="${col}" stroke-width="1" opacity=".95"/>`);
      g.push(T(mx, my - 6, label, { size: 11, fill: col, anchor: 'middle', mono: true }));
    }
  };
  g.push(`<defs><marker id="ah2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#9fb3c8"/></marker></defs>`);

  box(60, 190, 300, 170, 'React 19 + Vite + TS', [
    'panels, tool rail, inspector',
    'line manager, minimap',
    'zustand store (build + sim UI)',
    'immer patches -> undo stack',
  ], '#61dafb');
  box(60, 390, 300, 150, 'Build tools', [
    'brush / box / line drag',
    'ghost preview + validity',
    'blueprint copy-paste',
    'writes BuildCommand[]',
  ], C.yellow);
  box(60, 570, 300, 170, 'Data + assets', [
    'modules.json (a x b, rate)',
    'materials.json, lines.json',
    'save = seed + commands',
    'assets: GLB per module',
  ], C.wood);
  box(60, 770, 300, 170, 'Render: react-three-fiber', [
    'chunked voxel meshes',
    'InstancedMesh: 3k agents',
    'level slicing + cutaway',
    'postfx: soft AO, bloom',
  ], C.green);

  box(640, 190, 460, 190, 'Simulation worker  (5 Hz tick)', [
    'agents[] with state machine',
    'spawn waves from demand curve',
    '3D flow-field / A* over level graph',
    'gate + escalator + train capacity queues',
    'train timetable, dwell, alight/board',
    'metrics: LOS, density, wait times',
  ], C.blue);
  box(640, 430, 460, 150, 'Station graph', [
    'nodes: cell, gate, platform, exit, train',
    'edges: walk, stair, escalator, lift',
    'vertical edges carry a level delta',
    'rebuilt on build (incremental)',
  ], C.purple);
  box(640, 620, 460, 150, 'Frame loop', [
    'rAF: interpolate agent positions',
    'buffer of {id, pos, state, anim}',
    'transferable ArrayBuffer, zero copy',
    'UI reads metrics at 2 Hz, not 60',
  ], C.teal);
  box(640, 800, 460, 140, 'Determinism', [
    'seed + tick -> same crowd every run',
    'enables A/B of a layout change',
    'fast-forward: headless ticks, no draw',
  ], C.orange);

  box(1190, 190, 350, 190, 'Folder shape', [
    'src/',
    '  ui/        panels, inspector',
    '  build/     tools, commands, undo',
    '  sim/       worker + graph + agents',
    '  scene/     voxel meshes, agents',
    '  data/      modules, materials',
    '  state/     zustand slices',
  ], '#8fa0b3');
  box(1190, 420, 350, 210, 'Perf budget', [
    '16.6 ms frame, 60 fps target',
    'voxel rebuild: chunk-local, <4 ms',
    'agents: 3,000 @ 60 fps instanced',
    'sim tick 5 Hz, <8 ms per tick',
    'save file < 2 MB for 60x60 station',
  ], C.green);
  box(1190, 670, 350, 270, 'Milestones', [
    'M0  3D grid + camera + place',
    'M1  surfaces + modules + save',
    'M2  lines, tracks, trains',
    'M3  agents + gates + platforms',
    'M4  waves, exits, transfers',
    'M5  multi-line, analytics, share',
    'M6  steam-readiness, mods',
  ], C.yellow);

  arrow(360, 275, 640, 275, '#61dafb', 'BuildCommand[]');
  arrow(360, 465, 640, 465, C.yellow, 'place / erase');
  arrow(360, 655, 640, 655, C.wood, 'module defs');
  arrow(640, 690, 360, 845, C.teal, 'instance buffer', '7 6');
  arrow(360, 830, 640, 690, C.green, 'camera + slice', '7 6');
  arrow(640, 380, 640, 430, C.blue, '');
  arrow(640, 580, 640, 620, C.purple, '');
  arrow(1100, 330, 1190, 285, '#8fa0b3', 'reads');
  return sheet(W, H, g.join(''));
}
