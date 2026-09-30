// dev helper: list polygons whose centre falls inside a crop region of the sheet.
// Sheet coords = polygon coords + the body group's translate (700, 214).
import { readFileSync } from 'node:fs';
const [file, x0, y0, x1, y1] = process.argv.slice(2);
const OX = 700, OY = 214;
const s = readFileSync(file, 'utf8');
const polys = [...s.matchAll(/<polygon points="([^"]*)" fill="([^"]*)"/g)];
const hits = [];
for (const m of polys) {
  const pts = m[1].split(' ').map((p) => p.split(',').map(Number));
  const xs = pts.map((p) => p[0] + OX);
  const ys = pts.map((p) => p[1] + OY);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  if (cx > +x0 && cx < +x1 && cy > +y0 && cy < +y1) {
    hits.push({ fill: m[2], x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] });
  }
}
console.log(`${hits.length} polygons centred in [${x0},${y0}]-[${x1},${y1}] (sheet coords)`);
for (const h of hits) {
  console.log(`  fill ${h.fill.padEnd(18)} x ${h.x[0].toFixed(0).padStart(5)}..${h.x[1].toFixed(0).padStart(5)}   y ${h.y[0].toFixed(0).padStart(5)}..${h.y[1].toFixed(0).padStart(5)}`);
}
