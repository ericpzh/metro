import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { n } from './iso.mjs';

export function loadTrainAnimation() {
  const dir = resolve(import.meta.dirname, '../.preview/train-animation');
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  return new Map(index.map(p => [p.id, `data:image/png;base64,${readFileSync(join(dir, p.file)).toString('base64')}`]));
}

/** Discrete real 3D poses keep cameras and dimension lines fixed as leaves slide. */
export function animatedTrain(poses, id, x, y, w, h) {
  if (id === 'open') id = 'car-B';
  const lamp = id.startsWith('front-');
  if (!id.startsWith('car-') && !id.startsWith('side-') && !lamp) return null;
  const sequence = lamp ? [0, 1] : [0, 0, 0, 1, 2, 3, 4, 4, 4, 4, 4, 3, 2, 1, 0, 0];
  const count = lamp ? 2 : 5;
  // Each stock class has its own phase; every leaf in a captured pose moves together.
  const cls = id.split('-').at(-1);
  const delay = -2 * ['A', 'B', 'C', 'L'].indexOf(cls);
  const style = Array.from({ length: count }, (_, i) => {
    const stops = sequence.map((pose, step) => `${n(step * 100 / sequence.length)}%{opacity:${pose === i ? 1 : 0}}`).join('');
    return `@keyframes ${id}-pose-${i}{${stops}100%{opacity:${i === sequence[0] ? 1 : 0}}}`;
  }).join('');
  return `<g data-animation="${lamp ? 'headlights' : 'sliding-doors'}" data-stock="${cls}"><style>${style}</style>`
    + Array.from({ length: count }, (_, i) => {
      const href = poses.get(`${id}-pose-${i}`);
      if (!href) throw new Error(`Missing animated ${id}; run node tools/render-train-animation.mjs`);
      return `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${href}" style="opacity:${i === 0 ? 1 : 0};animation:${id}-pose-${i} 8s steps(1,end) ${delay}s infinite"/>`;
    }).join('') + '</g>';
}
