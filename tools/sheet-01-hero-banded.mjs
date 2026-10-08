// Sheet 01: an authored stack like sheet 13. Capture with:
// node tools/render-piece-views.mjs --hero --scale 4
// Edit PIECES and PLAN independently; equipment is never drawn as substitute boxes.
import { readFileSync } from 'node:fs';
import { C, PCOL, TW, TH, ZU, P, n, Scene, boxSvg, quadSvg, faceSvg,
  title, sheet, T, rng, bboxOf, fitToRect, callout, amT, group } from './iso.mjs';
import { trainCard } from './train-cards.mjs';
import { isoTrack } from './train-iso.mjs';
import { FINISH_LIST } from '../game/src/sim/finishes.ts';

const CONCRETE = '#' + FINISH_LIST.find(f => f.id === 'floor.concrete').tint.toString(16).padStart(6, '0');

// Front to back. Rear walls must paint before the equipment in front of them;
// unlike sheet 13's middle wall, these are the back of the entire cutaway.
// The draft's repeated lower crowd becomes rear and foreground groups.
export const HERO_LAYERS = ['decor', 'circulation', 'concourse',
  'train', 'screenNear', 'crowdFront', 'crowdRear', 'platform',
  'screenFar', 'trainFar', 'trackFar', 'track', 'walls'];
const L = Object.fromEntries(HERO_LAYERS.map((name, i) => [name, (HERO_LAYERS.length - i) * 200]));
const PLAN = { width: 28, upper: 5, lower: 1, hallEnd: 10, platformEnd: 22,
  trainX: 14, trainY: 23.7, rail: .18 };

// Equipment uses footprint centres; runs use the lower landing. Facing is
// authored as a real 3D rotation in the dedicated --hero capture.
const PIECES = [
  ['door-steel-2', 2.4, .2, 5],
  ...[5.2, 18].map(x => ['extinguisher', x, .35, 5]),
  ...[6.3, 12.6, 26.8].map(x => ['bin', x, .35, 5]),
  ...[7.5, 8.7, 9.9, 11.1].map(x => ['tvm', x, 1.2, 5]),
  ...[23.2, 24.4, 25.6].map(x => ['vending', x, 1.2, 5]),
  ...[19.5, 20.8, 22.1].map(x => ['shelf', x, .6, 5]),
  ['bench-steel-1', 6.8, 4.3, 5], ['bench-steel-1', 23.8, 6.8, 5],
  ['billboard-panorama', 15.7, .25, 6.3],
  // Six one-cell lanes touch; fence ends butt to the bank's machine edges.
  ...[9.5, 10.5, 11.5, 12.5, 13.5, 14.5].map(x => ['gate', x, 7, 5]),
  ...Array.from({ length: 9 }, (_, i) => ['fence', i + .5, 7, 5]),
  ...Array.from({ length: 13 }, (_, i) => ['fence', i + 15.5, 7, 5]),
  ['lift-shaft', 3.3, 11.8, 1], ['lift-car', 3.3, 11.8, 1],
  ['escalator', 12.5, 16, 1, 'circulation'],
  ['escalator', 14, 16, 1, 'circulation'],
  ['stair-straight', 16.6, 16, 1, 'circulation'],
];

function loadHeroPieces() {
  const dir = new URL('../.preview/hero-piece-views/', import.meta.url);
  let index;
  try { index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')); }
  catch { throw new Error('capture models first: node tools/render-piece-views.mjs --hero --scale 4'); }
  return new Map(index.pieces.map(p => [p.id, { ...p,
    href: `data:image/png;base64,${readFileSync(new URL(p.file, dir)).toString('base64')}` }]));
}

export function artHeroBanded() {
  const models = loadHeroPieces(), S = Scene(), rr = rng(101);
  const put = (layer, x, y, z, svg) => S.fg.push([L[layer] + (x + y + z * .9) * .2, svg]);
  const model = (id, x, y, z, layer = 'decor') => {
    const p = models.get(id);
    if (!p?.anchor) throw new Error(`recapture ${id}: missing floor anchor`);
    const w = p.metres * TW * Math.SQRT2, h = p.verticalMetres * TW * Math.SQRT2;
    const at = P(x, y, z);
    // Camera and drawing have opposite handedness; mirror picture AND anchor.
    const left = at[0] - (1 - p.anchor[0]) * w, top = at[1] - p.anchor[1] * h;
    put(layer, x, y, z, `<g data-model="${id}"><image x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" href="${p.href}" transform="translate(${n(2 * left + w)},0) scale(-1,1)"/></g>`);
  };
  const slab = (layer, x, y, z, w, d) => {
    const concrete = layer === 'concourse';
    put(layer, x + w / 2, y + d / 2, z,
      boxSvg(x, y, z - .4, w, d, .4, concrete ? CONCRETE : C.floor, { sw: .6 })
      + (concrete ? quadSvg(x, y, z + .005, w, d, CONCRETE,
        { fill: 'url(#hero-concrete-grain)', sw: 0 }) : ''));
  };

  // 9. Track, with actual gauge and third rail, behind the docked B car.
  isoTrack(S, { x: 1, y: 22.1, z: 0, len: 26, w: 3.2, third: true, key: L.track });
  // The island's far road sits behind the lift and all three runs.
  isoTrack(S, { x: 1, y: 6.6, z: 0, len: 26, w: 3.2, third: true, key: L.trackFar });
  const car = trainCard('iso-B1');
  const cw = car.metres * TW * Math.SQRT2, ch = car.verticalMetres * TW * Math.SQRT2;
  const train = (layer, y, direction, delay) => {
    const cp = P(PLAN.trainX, y, PLAN.rail);
    const cx = cp[0] - (1 - car.origin[0]) * cw, cy = cp[1] - car.origin[1] * ch;
    const dx = n(TW * .8 * direction), dy = n(TH * .8 * direction);
    put(layer, PLAN.trainX, y, PLAN.rail,
      group(`<g data-motion="train" data-direction="${direction}"><image x="${n(cx)}" y="${n(cy)}" width="${n(cw)}" height="${n(ch)}" href="${car.href}" transform="translate(${n(2 * cx + cw)},0) scale(-1,1)"/></g>`,
        amT(`0 0;0 0;${dx} ${dy};${dx} ${dy};0 0;0 0`, '', '18s', undefined, delay)));
  };
  // Opposite small translations with separate dwells, always within the roads.
  train('train', PLAN.trainY, 1, '0s');
  train('trainFar', 8.2, -1, '-5s');

  // Island floor, with continuous game-model screen walls on both full edges.
  slab('platform', 0, 10, PLAN.lower, PLAN.width, 12);
  for (let x = 1; x < 28; x += 2) put('platform', x, 16, 1,
    quadSvg(x, 10, 1.01, .025, 12, C.floorInlay, { sw: 0, opacity: .3 }));
  put('platform', 14, 21.3, 1.02, quadSvg(0, 20.9, 1.02, 28, .65, C.tactile, { sw: .3 }));
  put('platform', 14, 21.9, 1.02, quadSvg(0, 21.7, 1.02, 28, .22, C.maroon, { sw: .2 }));
  put('platform', 14, 10.7, 1.02, quadSvg(0, 10.5, 1.02, 28, .65, C.tactile, { sw: .3 }));
  put('platform', 14, 10.2, 1.02, quadSvg(0, 10.15, 1.02, 28, .22, C.maroon, { sw: .2 }));
  // From the track side we see the screen's back. Its own band covers both
  // lower-floor crowd groups, while the near train remains in front of it.
  model('platform-edge-far', 14, 21.85, 1, 'screenNear');
  model('platform-edge-far', 14, 10.15, 1, 'screenFar');
  // 6. Parallel circulation, a real 4 m storey, clear of the road.
  for (const [id, x, y, z, layer] of PIECES) if (layer === 'circulation') model(id, x, y, z, layer);
  const crowd = (layer, count, rect, z, clear = () => true) => {
    for (let i = 0; i < count; i++) {
      const x = rect[0] + rr() * rect[2], y = rect[1] + rr() * rect[3];
      if (!clear(x, y)) continue;
      S.sprite(x, y, z, i % 7 === 0 ? 'personBag' : 'person', {
        color: PCOL[i % PCOL.length], k: L[layer] + (x + y) * .2 });
      // Small staggered translations stay within the passenger's clear floor
      // patch. Animate a parent, retaining the sprite's own world placement.
      if (i % 3 === 0) {
        const entry = S.fg.at(-1);
        entry[1] = group(`<g data-motion="passenger">${entry[1]}</g>`,
          amT(`0 0;${n(TW * .2)} ${n(TH * .2)};0 0`, '', `${9 + i % 4}s`, undefined, `${-i * .4}s`));
      }
    }
  };
  crowd('crowdFront', 28, [5.5, 17.2, 20, 3.2], 1.03);

  // 4. Upper floor with an open front and short side aprons.
  slab('concourse', 0, 0, PLAN.upper, PLAN.width, PLAN.hallEnd);
  slab('concourse', 0, 10, 5, 5.5, 3);
  slab('concourse', 22.5, 10, 5, 5.5, 3);
  // 水泥 uses the game's finish tint and a fine grain, without granite inlays.
  const route = [[6, 5], [10.5, 5], [10.5, 8.5], [15, 8.5], [15, 9.8]];
  put('concourse', 12, 8, 5.04, `<path d="M${route.map(p => P(...p, 5.04).map(n).join(',')).join(' L')}" fill="none" stroke="${C.tactile}" stroke-width="5" stroke-linejoin="round"/>`);
  // 3. This crowd can be occluded by the upper-floor edge; the other cannot.
  crowd('crowdRear', 16, [6, 11.5, 20, 4.8], 1.03,
    (x, y) => !(x > 11.4 && x < 18 && y < 16.8));
  // 2. Hall equipment and passengers sort together by local position.
  for (const [id, x, y, z, layer] of PIECES) if (!layer) model(id, x, y, z);
  crowd('decor', 28, [6, 3.7, 16, 2.6], 5.03,
    (x, y) => !(x < 7.8 && y < 5));
  crowd('decor', 12, [6, 8, 16, 1.4], 5.03);
  // 1. Two rear walls only; no standalone pillars or fake shop shells.
  put('walls', 14, -.3, 5, boxSvg(0, -.4, 5, 28, .4, 3.4, C.tile, { sw: .7 }));
  put('walls', -.3, 5, 5, boxSvg(-.4, -.4, 5, .4, 10.4, 3.4, C.tile, { sw: .7 }));
  put('walls', 14, 0, 8, faceSvg('y', .01, 0, 28, 7.8, 8.15, C.lineA, { sw: .3 }));
  put('walls', 0, 5, 8, faceSvg('x', .01, 0, 10, 7.8, 8.15, C.lineA, { sw: .3 }));
  put('walls', 18, 0, 7.2, `<text transform="matrix(${TW},${TH},0,${ZU},${n(P(18, .02, 7.05)[0])},${n(P(18, .02, 7.05)[1])})" font-size=".52" font-weight="700" fill="#273443">动物园站</text>`);

  // Export real named groups; framing includes model rectangles as in sheet 13.
  const layers = HERO_LAYERS.slice().reverse().map(name => {
    const content = S.fg.filter(([k]) => k >= L[name] && k < L[name] + 200)
      .sort((a, b) => a[0] - b[0]).map(([, svg]) => svg).join('');
    return `<g id="hero-${name}" data-layer="${name}">${content}</g>`;
  }).join('');
  const fit = fitToRect(bboxOf(layers), { x: 65, y: 155, w: 1470, h: 805 });
  const notes = [
    [10, 7, 5.7, 1400, 230, '闸机与围栏：完整的付费区边界', C.yellow],
    [9, 1.2, 6, 175, 300, '售票机：正面朝向站厅', C.green],
    [21, .6, 6, 1400, 365, '靠墙货架与自动售货机', C.red],
    [17, 21.85, 2.6, 1400, 690, '双向列车与全长屏蔽门', C.blue],
    [14, 13, 3, 170, 750, '上下扶梯与楼梯', C.asc],
    [4.5, .3, 5.6, 175, 175, '墙边的门、灭火器与垃圾桶', C.steel],
    [15.7, .25, 7, 1400, 165, '墙面广告灯箱', C.pink],
    [15, 8.5, 5, 1400, 520, '盲道连接闸机与换层点', C.tactile],
    [3.3, 11.8, 3.5, 170, 540, '电梯井与轿厢', C.teal],
  ];
  const annotations = [];
  const grainRandom = rng(43);
  const concreteGrain = '<defs><pattern id="hero-concrete-grain" width="64" height="64" patternUnits="userSpaceOnUse">'
    + Array.from({ length: 90 }, (_, i) => `<circle cx="${n(grainRandom() * 64)}" cy="${n(grainRandom() * 64)}" r="${n(.2 + grainRandom() * .6)}" fill="${i % 2 ? '#fff' : '#000'}" opacity=".12"/>`).join('')
    + '</pattern></defs>';
  const key = notes.map(([x, y, z, lx, ly, text, col], i) => {
    callout(annotations, ...fit.place(...P(x, y, z)), lx, ly, i + 1, null);
    const tx = 65 + (i % 3) * 505, ty = 1030 + Math.floor(i / 3) * 34;
    return `<rect x="${tx}" y="${ty - 12}" width="12" height="12" rx="3" fill="${col}"/>`
      + T(tx + 23, ty, `${i + 1}  ${text}`, { size: 15, fill: '#c3d0de' });
  }).join('');
  return sheet(1600, 1180,
    title(48, 62, '地铁车站设计师', '动物园站 · B1 站厅 · B2 站台。逐层搭建，设备采用游戏中的真实模型，1 格 = 1 米。')
    + concreteGrain + fit.group(layers) + annotations.join('')
    + '<rect x="42" y="997" width="1516" height="122" rx="12" fill="#0b0f16" opacity=".9"/>' + key,
    { glow: true });
}
