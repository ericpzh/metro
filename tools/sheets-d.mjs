// Concept sheet 10 - queue management: lanes, rails, switchbacks, door queues.
import { C, T, MUL, title, sheet, n, rng, legend } from './iso.mjs';

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
  g.push(title(48, 62, 'CONCEPT 10 // QUEUE MANAGEMENT',
    'Making people line up',
    'A crowd that arrives as a blob blocks everything. The same crowd in single-file lanes is orderly, predictable and fits in a quarter of the floor. This is the cheapest capacity in the game.'));

  /* ---------------------------------------------------------------- A */
  panel(g, 48, 168, 748, 388, 'A.  THE SAME 36 PEOPLE, THE SAME 3 GATES', 'left: free-for-all. right: three single-file lanes.');
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
    const px = ax + 150 + Math.cos(a) * r * 1.25, py = ay + 76 + Math.sin(a) * r * 0.95;
    if (py < ay + 30) continue;
    g.push(agent(px, py, AG[(rr() * AG.length) | 0]));
  }
  g.push(T(ax, ay + 232, 'no lanes: 1.4 m2/pax, LOS D, the corridor is blocked', { size: 12, fill: C.red }));
  g.push(T(ax, ay + 250, 'front row shoves, late arrivals push sideways into the flow', { size: 11.5, fill: '#7d8ea3' }));
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
  }
  g.push(T(bx, by + 232, 'three lanes: 1.1 m2/pax, LOS B, 12 people stored per lane', { size: 12, fill: C.green }));
  g.push(T(bx, by + 250, 'first-in-first-out, no sideways spill, the walkway stays clear', { size: 11.5, fill: '#7d8ea3' }));

  /* ---------------------------------------------------------------- B */
  panel(g, 812, 168, 740, 388, 'B.  LANE ANATOMY', 'a lane is a server with storage: slots in the back, one head in the front.');
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
  // entry funnel + head
  g.push(`<polygon points="${n(lx + llen)},${n(ly - 26)} ${n(lx + llen + 74)},${n(ly - 26)} ${n(lx + llen + 74)},${n(ly + lw + 26)} ${n(lx + llen)},${n(ly + lw + 26)}" fill="${C.green}" opacity=".16"/>`);
  g.push(rect(lx + llen + 30, ly + 2, 16, lw - 4, '#bcc3ca', { rx: 3, stroke: '#0d1116' }));
  g.push(rect(lx + llen + 46, ly + 2, 5, lw - 4, C.green, { rx: 1.5 }));
  g.push(arrow(lx + llen - 10, ly + lw / 2, lx + llen + 74, ly + lw / 2, '#9fb3c8', 2));
  g.push(T(lx + llen + 82, ly + 26, 'head: the gate,', { size: 11.5, fill: C.green }));
  g.push(T(lx + llen + 82, ly + 42, 'door or machine', { size: 11.5, fill: C.green }));
  g.push(T(lx - 20, ly - 34, 'entry (agents join the back)', { size: 11.5, fill: '#9fb3c8' }));
  g.push(T(lx - 20, ly + lw + 58, 'slot = 0.80 m - a shoulder and a bit', { size: 11.5, fill: '#8fa0b3' }));
  g.push(dimH(lx, lx + llen, ly + lw + 40, 'lane length L'));
  g.push(MUL(1140, 452, [
    'capacity  =  floor(L / 0.80) + 1      (12 m lane -> 16 people)',
    'rate      ~  45 pax/min               (0.6 m/s shuffling, single file)',
    'wait      =  queue length / rate      (predictable, so it can be designed)',
  ], { size: 12, fill: '#a9b8c8', mono: true, lh: 22 }));
  g.push(T(1140, 522, 'A free-for-all crowd through the same 1 m width does ~60/min - but its front is', { size: 11.5, fill: '#7d8ea3' }));
  g.push(T(1140, 538, 'chaotic, it blocks side flows, and nobody can predict the wait. That is the trade.', { size: 11.5, fill: '#7d8ea3' }));

  /* ---------------------------------------------------------------- C */
  panel(g, 48, 574, 748, 360, 'C.  SWITCHBACK: FOLD THE QUEUE', 'four runs in a 2 m strip store 20 m of queue.');
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
  g.push(dimH(sx, sx + runLen, sy + 4 * gap + 22, '4 runs x 5 m = 20 m of queue'));
  g.push(T(sx + runLen + 40, sy + 11, 'in', { size: 11.5, fill: C.green }));
  g.push(T(sx - 16, sy + 3 * gap + 11, 'out', { size: 11.5, fill: C.red, anchor: 'end' }));
  g.push(MUL(110, 866, [
    'footprint 2 x 4 m per fold, 4 runs  ->  40 people stored in 8 m2 of floor',
    'the same 40 people standing loose need ~48 m2 and block the room they stand in',
  ], { size: 12, fill: '#a9b8c8', lh: 20 }));
  g.push(T(110, 910, 'Cost: a switchback is a trap if the head stalls - the whole queue is committed to one server.', { size: 11.5, fill: '#7d8ea3' }));

  /* ---------------------------------------------------------------- D */
  panel(g, 812, 574, 740, 360, 'D.  THE PATTERN THAT MATTERS: PLATFORM DOOR LANES', 'alight down the middle, queue on both sides. PSD openings sit on the car-door centres (sheet 12).');
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
  g.push(T(px + 8, py - 14, 'platform', { size: 11.5, fill: '#7d8ea3' }));
  g.push(T(px + pw - 8, py + ph + 46, 'train', { size: 11.5, fill: '#8fa0b3', anchor: 'end' }));
  doorX.forEach((dx, di) => {
    g.push(rect(dx - POFF, py + ph - 4, POFF * 2, 10, C.lineB, { rx: 2 }));  // PSD door
    g.push(T(dx, py + ph + 6, 'PSD', { size: 10.5, fill: C.lineB, anchor: 'middle' }));
    // alighting path down the middle of the pair
    g.push(rect(dx - 14, py + 30, 28, ph - 34, C.safety, { rx: 3, opacity: 0.16 }));
    g.push(arrow(dx, py + ph - 12, dx, py + 34, C.safety, 2.4));
    g.push(T(dx, py + 22, 'alight', { size: 10.5, fill: C.safety, anchor: 'middle', weight: 700 }));
    // two boarding lanes flanking it, each pointing at the door
    for (const sgn of [-1, 1]) {
      const lx0 = dx + sgn * 52 - 9;
      g.push(rect(lx0, py + 26, 18, ph - 30, '#a8d8ea', { rx: 2, opacity: 0.5 }));
      for (let s = 0; s < 7; s++) g.push(agent(lx0 + 9, py + 34 + s * 15, AG[(di + s) % AG.length], 5));
      g.push(arrow(dx + sgn * 60, py + 34, dx + sgn * 40, py + ph - 14, '#2f7ef2', 1.6));
      g.push(T(dx + sgn * 60, py + 20, 'queue', { size: 10.5, fill: '#2f7ef2', anchor: 'middle' }));
    }
  });
  g.push(MUL(856, 946, [
    'Two lanes per door at ~45/min = 90/min into a door that takes 72/min, so the door is the',
    'bottleneck - which is the correct answer, and the reason dwell time is a design variable.',
    'Painted lanes plus rails are how every Chinese metro platform actually does this.',
  ], { size: 12, fill: '#a9b8c8', lh: 20 }));

  /* ---------------------------------------------------------------- E */
  panel(g, 48, 956, 1504, 178, 'E.  THE OBJECTS', 'all five are ordinary modules: they take a footprint, they carry a rate, they go in the save file.');
  const mods = [
    ['Queue rail', '1 x 1 per m', 'physical channel. No overtaking, no sideways spill.', C.steel],
    ['Belt barrier', '1 x 1', 'retractable, toggle open/closed at runtime.', C.yellow],
    ['Queue lane, single file', '1 x 1 per m', 'painted. 16 pax per 12 m. ~45 pax/min.', C.asc],
    ['Queue lane, two abreast', '2 x 1 per m', 'double the rate, half the order.', C.blue],
    ['Switchback queue', '2 x 4 per fold', '40 pax in 8 m2. One committed server.', C.purple],
  ];
  mods.forEach(([name, size, note, col], i) => {
    const mx = 76 + i * 296;
    g.push(rect(mx, 1022, 280, 96, '#0f1620', { rx: 10, stroke: col, sw: 1.2 }));
    g.push(rect(mx, 1022, 280, 4, col, { rx: 2 }));
    g.push(T(mx + 16, 1050, name, { size: 13.5, weight: 700, fill: '#eaf0f6' }));
    g.push(T(mx + 16, 1070, size, { size: 11.5, fill: col, mono: true }));
    g.push(T(mx + 16, 1094, note.length > 40 ? note.slice(0, 40) : note, { size: 11, fill: '#8fa0b3' }));
    if (note.length > 40) g.push(T(mx + 16, 1108, note.slice(40), { size: 11, fill: '#8fa0b3' }));
  });
  return sheet(W, H, g.join(''));
}
