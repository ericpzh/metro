// Sheet 01's capture convention: real 3D turns, measured floor/landing anchors,
// and one uniform metre scale. Used by the interchange's added station layers.
import { readFileSync } from 'node:fs';
import { TW, P, n } from './iso.mjs';

export function loadStationPieces() {
  const dir = new URL('../.preview/hero-piece-views/', import.meta.url);
  let index;
  try { index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')); }
  catch { throw new Error('capture station models: node tools/render-piece-views.mjs --hero --scale 4'); }
  return new Map(index.pieces.map(p => [p.id, { ...p,
    href: `data:image/png;base64,${readFileSync(new URL(p.file, dir)).toString('base64')}` }]));
}

export function stationPieceImage(pieces, id, x, y, z) {
  const p = pieces.get(id);
  if (!p?.anchor) throw new Error(`recapture ${id}: node tools/render-piece-views.mjs --hero --scale 4`);
  const w = p.metres * TW * Math.SQRT2, h = p.verticalMetres * TW * Math.SQRT2;
  const at = P(x, y, z);
  const left = at[0] - (1 - p.anchor[0]) * w, top = at[1] - p.anchor[1] * h;
  return `<g data-model="${id}"><image x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" href="${p.href}" transform="translate(${n(2 * left + w)},0) scale(-1,1)"/></g>`;
}
