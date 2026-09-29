// Dev helper: list every <text> string in the rendered sheets, so the Chinese
// translation table can be built against real output.
//   node tools/_strings.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'art');
const seen = new Map();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()) {
  const svg = readFileSync(join(dir, f), 'utf8');
  for (const m of svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)) {
    const s = m[1];
    if (!s.trim()) continue;
    if (!seen.has(s)) seen.set(s, []);
    if (!seen.get(s).includes(f)) seen.get(s).push(f);
  }
}
const latin = [...seen.keys()].filter((s) => /[A-Za-z]/.test(s));
const lines = [`total text strings: ${seen.size}   containing latin: ${latin.length}`, ''];
for (const s of latin.sort()) {
  lines.push(`${s}\t\t${seen.get(s).map((f) => f.slice(0, 2)).join(',')}`);
}
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '_strings.out.txt'), lines.join('\n'), 'utf8');
console.log(`wrote ${latin.length} latin strings`);
