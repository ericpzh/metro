// Isometric rolling stock: A / B / C type metro cars drawn as a rounded-roof
// cross-section extruded along the run. Shared by the 3D train sheet and by
// the two-line interchange sheet.
//
// A car runs along +x. The visible faces are the roof, the near (+y) side and
// the leading (+x) end, which is the same three-face convention boxSvg uses.
import { C, TW, TH, ZU, P, px, py, n, shade, poly, faceSvg, rng, carDoorCenters, group } from './iso.mjs';

/** z/x ratio of the projection's view ray: visibility is n.(1,1,VZ) > 0. */
const VZ = (2 * TH) / ZU;

/** Metro car cross-section, CCW in the (y,z) plane. y 0..w across, z 0..h up. */
export function carProfile(w, h, o = {}) {
  const R = Math.min(o.roof ?? 0.62, w / 2 - 0.02);
  const r = Math.min(o.corner ?? 0.13, h / 2 - 0.02);
  const p = [[r, 0], [w - r, 0], [w, r], [w, h - R]];
  const arc = (cy, cz, rad, a0, a1, steps = 5) => {
    for (let i = 0; i <= steps; i++) {
      const a = ((a0 + (a1 - a0) * (i / steps)) * Math.PI) / 180;
      p.push([cy + rad * Math.cos(a), cz + rad * Math.sin(a)]);
    }
  };
  arc(w - R, h - R, R, 0, 90);
  p.push([R, h]);
  arc(R, h - R, R, 90, 180);
  p.push([0, r]);
  return p;
}

/** Extrude a (y,z) profile along x. Faces are sorted back-to-front by their
 *  normal, so the hidden half of the tube is covered by the visible half. */
export function extrudeX(prof, x0, x1, col, o = {}) {
  const y0 = o.y ?? 0, z0 = o.z ?? 0, tone = o.tone ?? 1;
  const st = o.stroke === null ? null : (o.stroke ?? C.ink);
  const sw = o.sw ?? 0.7;
  const op = o.opacity ? ` opacity="${o.opacity}"` : '';
  const at = (i, x) => P(x, y0 + prof[i][0], z0 + prof[i][1]);
  const faces = [];
  for (let i = 0; i < prof.length; i++) {
    const a = prof[i], b = prof[(i + 1) % prof.length];
    const dy = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dz, dy) || 1;
    const uy = dz / L, uz = -dy / L;                       // outward normal
    faces.push({
      d: uy + VZ * uz,
      svg: poly([at(i, x0), at((i + 1) % prof.length, x0), at((i + 1) % prof.length, x1), at(i, x1)],
        shade(col, tone * (0.50 + 0.18 * uy + 0.46 * uz)), st, sw, op),
    });
  }
  faces.sort((a, b) => a.d - b.d);
  return faces.map((f) => f.svg).join('')
    + poly(prof.map((_, i) => at(i, x1)), shade(col, tone * (o.capTone ?? 0.86)), st, sw, op);
}

const circPts = (cx, at, cz, r, steps = 9) => {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(P(cx + r * Math.cos(a), at, cz + r * Math.sin(a)));
  }
  return out;
};

/* ------------------------------------------------------------------ car */
/** Draw one metro car. o = {x,y,z, len, w, h, col, doors, cab, panto, shoe,
 *  stripe, dest, roofCol, winCol, tone}. */
export function isoCar(S, o) {
  const { x, y, z, len, w, h, col } = o;
  const tone = o.tone ?? 1;
  const key = (dx, dy, dz) => (x + dx) + (y + dy) + (z + dz) * 0.9;
  // The car is accumulated into ONE composite and pushed with a single depth key.
  // If each face carried its own key, any near-side window or door behind the
  // car's centre would sort *behind* the body and vanish - which is why only the
  // front half of the car used to be filled with windows and doors.
  const parts = [];
  const put = (_k, svg) => parts.push(svg);
  const side = y + w;                                       // near (+y) plane
  const front = x + len;                                    // leading (+x) plane
  const winC = o.winCol ?? '#20303e';
  const roofC = o.roofCol ?? col;

  /* --- underframe + bogies: drawn FIRST (they sit behind and below the body) --- */
  put(key(len / 2, w / 2, -0.25), poly(
    [P(x + 0.5, y + 0.35, z - 0.42), P(front - 0.5, y + 0.35, z - 0.42),
      P(front - 0.5, y + 0.35, z - 0.02), P(x + 0.5, y + 0.35, z - 0.02)], shade('#3d454e', 1.0), C.ink, 0.6));
  put(key(len / 2, w / 2, -0.25), poly(
    [P(x + 0.5, y + 0.35, z - 0.42), P(front - 0.5, y + 0.35, z - 0.42),
      P(front - 0.5, y + w - 0.35, z - 0.42), P(x + 0.5, y + w - 0.35, z - 0.42)], shade('#4b545e', 1.0), C.ink, 0.6));
  for (const t of [0.19, 0.81]) {
    const bx = x + len * t;
    put(key(len * t, w / 2, -0.4), poly(
      [P(bx - 1.25, y + 0.45, z - 0.62), P(bx + 1.25, y + 0.45, z - 0.62),
        P(bx + 1.25, y + 0.45, z - 0.42), P(bx - 1.25, y + 0.45, z - 0.42)], shade('#2f353c', 1.0), C.ink, 0.6));
    put(key(len * t, w / 2, -0.4), poly(
      [P(bx - 1.25, y + 0.45, z - 0.62), P(bx + 1.25, y + 0.45, z - 0.62),
        P(bx + 1.25, y + w - 0.45, z - 0.62), P(bx - 1.25, y + w - 0.45, z - 0.62)], shade('#3a424a', 1.0), C.ink, 0.6));
    for (const wx of [bx - 0.72, bx + 0.72]) {
      put(key(wx - x, w, -0.5), poly(circPts(wx, side - 0.32, z - 0.52, 0.4, 10), '#22272e', C.ink, 0.5));
      put(key(wx - x, w, -0.5), poly(circPts(wx, side - 0.3, z - 0.52, 0.19, 8), '#59626c', C.ink, 0.4));
    }
    if (o.shoe) {
      put(key(len * t, w / 2, -0.5), poly(
        [P(bx + 1.3, y + w - 0.62, z - 0.52), P(bx + 1.7, y + w - 0.62, z - 0.52),
          P(bx + 1.7, y + w - 0.62, z - 0.62), P(bx + 1.3, y + w - 0.62, z - 0.62)], '#c9a227', C.ink, 0.5));
    }
  }

  /* --- body + roof tube --- */
  const prof = carProfile(w, h, { roof: o.roofR, corner: o.cornerR });
  put(key(len / 2, w / 2, h / 2), extrudeX(prof, x, front, col, { y, z, tone }));

  /* --- skirt: the dark lower body band, on the near side only --- */
  put(key(len / 2, w, h * 0.2), faceSvg('y', side + 0.012, x + 0.05, front - 0.05, z - 0.02, z + h * 0.16, '#5b6572', { tone: 1.0, sw: 0.4 }));

  /* --- window band: one dark ribbon interrupted by the door leaves --- */
  const doors = o.doors ?? 4;
  const doorW = o.doorW ?? 1.3;
  // Door centres use the shared cadence (equal end and between gaps) so the car
  // doors, the PSD openings and the queue lanes all sit on the same x.
  const bays = carDoorCenters(len, doors, doorW).map((o2) => [(len / 2 + o2) / len]);
  const zW0 = z + h * 0.46, zW1 = z + h * 0.80;
  const gap = (t) => t * len;                               // door centre along the car
  const cuts = bays.map(([t]) => [gap(t) - doorW / 2 - 0.12, gap(t) + doorW / 2 + 0.12]);
  let cur = 0.12;
  const winQ = [];
  for (const [c0, c1] of cuts) {
    if (c0 > cur) winQ.push([cur, c0]);
    cur = Math.max(cur, c1);
  }
  if (cur < len - 0.12) winQ.push([cur, len - 0.12]);
  for (const [a, b] of winQ) {
    // a light frame first, then the glass, so each window reads as glass in a wall
    put(key((a + b) / 2, w, h * 0.65), faceSvg('y', side + 0.014, x + a - 0.04, x + b + 0.04, zW0 - 0.05, zW1 + 0.04, '#c7d1da', { tone: 1.0, sw: 0.4 }));
    put(key((a + b) / 2, w, h * 0.65), faceSvg('y', side + 0.017, x + a, x + b, zW0, zW1, winC, { tone: 1.05, sw: 0.6 }));
  }
  /* --- livery band (drawn before the doors so the doors sit on top of it) --- */
  const sc = o.stripe ?? col;
  put(key(len / 2, w, h * 0.32), faceSvg('y', side + 0.018, x + 0.1, front - 0.1, z + h * 0.14, z + h * 0.36, sc, { tone: 1.08, sw: 0.5 }));
  put(key(len / 2, w, h * 0.32), faceSvg('y', side + 0.02, x + 0.1, front - 0.1, z + h * 0.36, z + h * 0.40, shade(sc, 0.62), { tone: 1.0, sw: 0 }));
  /* --- doors: recessed leaves with a thin bright frame --- */
  for (const [t] of bays) {
    const c = x + gap(t), d0 = c - doorW / 2, d1 = c + doorW / 2;
    put(key(gap(t), w, h * 0.36), faceSvg('y', side + 0.022, d0 - 0.05, d1 + 0.05, z + 0.02, z + h * 0.80, '#c7d1da', { tone: 1.0, sw: 0.4 }));
    put(key(gap(t), w, h * 0.36), faceSvg('y', side + 0.024, d0, d1, z + 0.03, z + h * 0.80, shade(winC, 1.16), { tone: 1.0, sw: 0.7 }));
    put(key(gap(t), w, h * 0.36), faceSvg('y', side + 0.028, c - 0.03, c + 0.03, z + 0.05, z + h * 0.78, '#6d7b88', { tone: 1.0, sw: 0 }));
    put(key(gap(t), w, h * 0.5), faceSvg('y', side + 0.028, d0 + 0.06, d1 - 0.06, z + h * 0.54, z + h * 0.77, shade(winC, 1.34), { tone: 1.0, sw: 0 }));
  }

  /* --- roof equipment --- */
  const rr = rng((x * 31 + y * 7 + len) | 0);
  for (const t of [0.28, 0.72]) {
    put(key(gap(t), w / 2, h), poly(
      [P(x + gap(t) - 0.85, y + 0.55, z + h - 0.02), P(x + gap(t) + 0.85, y + 0.55, z + h - 0.02),
        P(x + gap(t) + 0.85, y + w - 0.55, z + h - 0.02), P(x + gap(t) - 0.85, y + w - 0.55, z + h - 0.02)],
      shade(roofC, 0.72), C.ink, 0.6));
    put(key(gap(t), w / 2, h + 0.1), poly(
      [P(x + gap(t) - 0.85, y + 0.55, z + h + 0.16), P(x + gap(t) + 0.85, y + 0.55, z + h + 0.16),
        P(x + gap(t) + 0.85, y + w - 0.55, z + h + 0.16), P(x + gap(t) - 0.85, y + w - 0.55, z + h + 0.16)],
      shade('#9aa4ad', 1.15), C.ink, 0.6));
    put(key(gap(t), w / 2, h + 0.1), poly(
      [P(x + gap(t) + 0.85, y + 0.55, z + h - 0.02), P(x + gap(t) + 0.85, y + w - 0.55, z + h - 0.02),
        P(x + gap(t) + 0.85, y + w - 0.55, z + h + 0.16), P(x + gap(t) + 0.85, y + 0.55, z + h + 0.16)],
      shade('#9aa4ad', 0.8), C.ink, 0.5));
  }
  if (o.panto) {
    const px0 = x + len * 0.5;
    put(key(len / 2, w / 2, h + 0.4), poly(
      [P(px0 - 0.7, y + w * 0.3, z + h + 0.16), P(px0 + 0.7, y + w * 0.3, z + h + 0.16),
        P(px0 + 0.7, y + w * 0.7, z + h + 0.16), P(px0 - 0.7, y + w * 0.7, z + h + 0.16)],
      shade('#6d7b88', 0.9), C.ink, 0.6));
    put(key(len / 2, w / 2, h + 0.9), poly(
      [P(px0 - 0.5, y + w * 0.5, z + h + 0.16), P(px0 + 0.5, y + w * 0.5, z + h + 0.16),
        P(px0 + 0.15, y + w * 0.5, z + h + 1.05), P(px0 - 0.85, y + w * 0.5, z + h + 1.05)],
      shade('#7f8b96', 1.0), C.ink, 0.6));
    put(key(len / 2, w / 2, h + 1.1), poly(
      [P(px0 - 1.15, y + w * 0.5, z + h + 1.05), P(px0 + 0.45, y + w * 0.5, z + h + 1.05),
        P(px0 + 0.45, y + w * 0.5, z + h + 1.14), P(px0 - 1.15, y + w * 0.5, z + h + 1.14)],
      shade('#c8ced4', 1.0), C.ink, 0.6));
  }

  /* --- leading end: cab or gangway --- */
  if (o.cab) {
    put(key(len, w / 2, h * 0.6), faceSvg('x', front + 0.016, y + 0.28, y + w - 0.28, z + h * 0.46, z + h * 0.78, winC, { tone: 1.1, sw: 0.8 }));
    put(key(len, w / 2, h * 0.6), faceSvg('x', front + 0.018, y + w / 2 - 0.04, y + w / 2 + 0.04, z + h * 0.46, z + h * 0.78, shade(col, 0.62), { tone: 1.0, sw: 0 }));
    put(key(len, w / 2, h * 0.25), faceSvg('x', front + 0.016, y + 0.45, y + w - 0.45, z + h * 0.2, z + h * 0.44, shade(col, 0.72), { tone: 1.0, sw: 0.6 }));
    for (const lx of [y + 0.7, y + w - 1.35]) {
      put(key(len, w / 2, h * 0.24), faceSvg('x', front + 0.02, lx, lx + 0.65, z + h * 0.24, z + h * 0.4, '#ffe9a8', { tone: 1.0, sw: 0.5 }));
    }
    if (o.dest) {
      put(key(len, w / 2, h * 0.88), faceSvg('x', front + 0.018, y + 0.5, y + w - 0.5, z + h * 0.83, z + h * 0.96, '#141a20', { tone: 1.0, sw: 0.6 }));
      if (o.destText) {
        const X = px(front, y + w / 2), Y = py(front, y + w / 2, z + h * 0.875);
        put(key(len, w / 2, h * 0.9), `<text transform="matrix(${TW},${-TH},0,${ZU},${n(X)},${n(Y)})" text-anchor="middle" font-size="0.27" font-weight="700" fill="#ffd45e" letter-spacing="0.02">${o.destText}</text>`);
      }
    }
  } else {
    put(key(len, w / 2, h * 0.55), faceSvg('x', front + 0.016, y + 0.5, y + w - 0.5, z + h * 0.24, z + h * 0.8, shade('#3d454e', 1.0), { tone: 1.0, sw: 0.7 }));
  }
  // push the whole car once, at its centre depth
  const carKey = key(len / 2, w / 2, h / 2);
  S.fg.push([carKey, o.anim ? group(parts.join(''), o.anim) : parts.join('')]);
  return carKey;
}

/* ---------------------------------------------------------------- track */
/** Straight track bed with rails, sleepers and an optional third rail.
 *  Runs along +x. o = {x,y,z,len, third, catenary, bed}. */
export function isoTrack(S, o) {
  const { x, y, z, len } = o;
  const gauge = o.gauge ?? 1.435;
  const w = o.w ?? 3.2;
  const put = (k, svg) => S.fg.push([k, svg]);
  const mid = y + w / 2;
  const r0 = mid - gauge / 2, r1 = mid + gauge / 2;
  put(x + len / 2 + y + z * 0.9, poly(
    [P(x, y, z), P(x + len, y, z), P(x + len, y + w, z), P(x, y + w, z)], shade(C.dark, o.bed ?? 1.35), C.ink, 0.7));
  put(x + len / 2 + y + (z + 0.06) * 0.9, poly(
    [P(x, y + w / 2 - 0.9, z + 0.05), P(x + len, y + w / 2 - 0.9, z + 0.05),
      P(x + len, y + w / 2 + 0.9, z + 0.05), P(x, y + w / 2 + 0.9, z + 0.05)], shade(C.concreteD, 0.95), null, 0));
  for (let sx = x + 0.6; sx < x + len - 0.4; sx += 1.6) {
    put(sx + y + z * 0.9, poly(
      [P(sx, y + 0.4, z + 0.04), P(sx + 0.6, y + 0.4, z + 0.04),
        P(sx + 0.6, y + w - 0.4, z + 0.04), P(sx, y + w - 0.4, z + 0.04)], shade('#6b5a48', 1.05), null, 0));
  }
  for (const r of [r0, r1]) {
    put(x + len / 2 + r + (z + 0.2) * 0.9, poly(
      [P(x, r - 0.06, z + 0.18), P(x + len, r - 0.06, z + 0.18),
        P(x + len, r + 0.06, z + 0.18), P(x, r + 0.06, z + 0.18)], shade(C.steel, 1.15), C.ink, 0.5));
    put(x + len / 2 + r + (z + 0.12) * 0.9, poly(
      [P(x, r + 0.06, z + 0.08), P(x + len, r + 0.06, z + 0.08),
        P(x + len, r + 0.06, z + 0.18), P(x, r + 0.06, z + 0.18)], shade(C.steel, 0.8), C.ink, 0.5));
  }
  if (o.third) {
    const ty = mid + gauge / 2 + 0.55;
    put(x + len / 2 + ty + (z + 0.3) * 0.9, poly(
      [P(x, ty - 0.09, z + 0.28), P(x + len, ty - 0.09, z + 0.28),
        P(x + len, ty + 0.09, z + 0.28), P(x, ty + 0.09, z + 0.28)], shade(C.psu, 1.0), C.ink, 0.5));
    put(x + len / 2 + ty + (z + 0.18) * 0.9, poly(
      [P(x, ty + 0.09, z + 0.16), P(x + len, ty + 0.09, z + 0.16),
        P(x + len, ty + 0.09, z + 0.28), P(x, ty + 0.09, z + 0.28)], shade(C.psu, 0.72), C.ink, 0.5));
    put(x + len / 2 + ty + (z - 0.02) * 0.9, poly(
      [P(x, ty - 0.14, z - 0.02), P(x + len, ty - 0.14, z - 0.02),
        P(x + len, ty + 0.14, z - 0.02), P(x, ty + 0.14, z - 0.02)], shade('#5a5147', 1.0), null, 0));
  }
}

/** Overhead contact wire + droppers, for catenary lines. */
export function catenary(S, o) {
  const { x, y, z, len } = o;
  const put = (k, svg) => S.fg.push([k, svg]);
  put(x + len / 2 + y + (z + 0.3) * 0.9, poly(
    [P(x, y, z + 0.3), P(x + len, y, z + 0.3), P(x + len, y, z + 0.42), P(x, y, z + 0.42)], shade(C.psu, 1.15), null, 0));
  for (let cx = x + 4; cx < x + len; cx += 8) {
    put(cx + y + (z + 3.6) * 0.9, poly(
      [P(cx - 0.06, y, z + 0.42), P(cx + 0.06, y, z + 0.42), P(cx + 0.06, y, z + 3.6), P(cx - 0.06, y, z + 3.6)], shade(C.steelD, 0.9), null, 0));
    put(cx + y + (z + 3.7) * 0.9, poly(
      [P(cx - 0.12, y - 0.5, z + 3.55), P(cx + 0.12, y - 0.5, z + 3.55),
        P(cx + 0.12, y + 0.5, z + 3.55), P(cx - 0.12, y + 0.5, z + 3.55)], shade(C.steelD, 1.05), C.ink, 0.5));
  }
}

export { VZ };
