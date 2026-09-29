// dev probe: outline the roof (blue) and the near-side wall (red) over the car.
import { writeFileSync } from 'node:fs';
import { Scene, sheet, C, px, py, n, P, poly } from './iso.mjs';
import { isoCar } from './train-iso.mjs';
import { STOCK } from './iso.mjs';

const W = 1500, H = 780;
const t = STOCK.B;
const S = Scene();
isoCar(S, { x: 0, y: 0, z: 0.92, len: t.len, w: t.w, h: t.h, col: '#eef2f6', doors: t.doors, doorW: t.doorW, cab: true, stripe: C.lineB, dest: true, destText: 'WUSI', roofCol: '#dfe4ea', winCol: '#20303e' });
const z0 = 0.92, z1 = 0.92 + t.h;
void z0; void z1; void poly;
const k = 1.0;
const ox = 750 - px(t.len / 2, t.w / 2) * k;
const oy = 400 - py(t.len / 2, t.w / 2, t.h / 2) * k;
const body = `<g transform="translate(${n(ox)},${n(oy)}) scale(${k})">${S.out()}</g>`;
writeFileSync('art/_probe-car.svg', sheet(W, H, body, {}), 'utf8');
console.log('wrote');
