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
