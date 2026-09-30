// dev helper: crop at an arbitrary zoom (zoom.mjs is fixed at 2x)
import { readFileSync, writeFileSync } from 'node:fs';
const [file, x, y, w, h, s, out] = process.argv.slice(2);
const svg = readFileSync(file, 'utf8');
const next = svg.replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/,
  `viewBox="${x} ${y} ${w} ${h}" width="${Math.round(+w * +s)}" height="${Math.round(+h * +s)}"`);
writeFileSync(out, next);
console.log('wrote', out);
