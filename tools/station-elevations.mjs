// Shared square-on game captures for authored station diagrams.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { n } from './iso.mjs';

export function loadStationElevations() {
  const dir = resolve(process.env.PIECE_ELEVATIONS_DIR ?? '.preview/piece-elevations');
  const data = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  return new Map(data.pieces.map(p => [p.id, {
    ...p, href: `data:image/png;base64,${readFileSync(join(dir, p.file)).toString('base64')}`,
  }]));
}

export function stationElevation(pieces, id, x, floorY, scale) {
  const p = pieces.get(id);
  if (!p) throw new Error(`Missing ${id}: run node tools/render-piece-elevations.mjs`);
  const w = p.metres * scale, h = p.verticalMetres * scale;
  return `<image data-model="${id}" x="${n(x)}" y="${n(floorY - h)}" width="${n(w)}" height="${n(h)}" href="${p.href}"/>`;
}
