// dev helper: dump polygons matching a fill colour, with their raw points
import { readFileSync } from 'node:fs';
const [file, want] = process.argv.slice(2);
const s = readFileSync(file, 'utf8');
const polys = [...s.matchAll(/<polygon points="([^"]*)" fill="([^"]*)"/g)];
let n = 0;
for (const m of polys) {
  if (m[2] !== want) continue;
  n++;
  const pts = m[1].split(' ').map((p) => p.split(',').map(Number));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  console.log(`#${n} fill ${m[2]}`);
  console.log(`   points ${m[1]}`);
  console.log(`   bbox x ${Math.min(...xs)}..${Math.max(...xs)}  y ${Math.min(...ys)}..${Math.max(...ys)}`);
}
console.log(`${n} polygons with fill ${want}`);
