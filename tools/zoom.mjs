// dev helper: crop a sheet so a detail can be inspected at scale
//   node tools/zoom.mjs art/01-isometric-cutaway.svg 380 470 760 470
import { readFileSync, writeFileSync } from 'node:fs';
const [file, x, y, w, h] = process.argv.slice(2);
const svg = readFileSync(file, 'utf8');
const out = svg.replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/,
  `viewBox="${x} ${y} ${w} ${h}" width="${Math.round(w * 2)}" height="${Math.round(h * 2)}"`);
writeFileSync(file.replace(/\.svg$/, '-zoom.svg'), out);
console.log('wrote', file.replace(/\.svg$/, '-zoom.svg'));
