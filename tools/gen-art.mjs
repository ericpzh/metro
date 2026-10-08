// Generates the concept-art sheets for the Metro Station Designer spec.
//
//   node tools/gen-art.mjs            every sheet
//   node tools/gen-art.mjs 01 13      only those, by leading number or by file name
//   node tools/gen-art.mjs --en       every sheet, plus the English sidecar
//   node tools/gen-art.mjs 02 --en    only sheet 02, plus English
//
// `--en` writes `<name>-en.svg` beside each sheet by swapping the Chinese
// strings in the built SVG (see `tools/sheet-i18n.mjs`). The English files are
// what the site's /en/ route shows; the embedded game captures stay Chinese.
// The filter is here because a sheet is regenerated one at a time far more often than all
// eleven are, and this script otherwise rewrites every `art/*.svg` on every run — which is
// eleven files of churn while someone else is working in the same tree.
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artSection } from './sheets-a.mjs';
import { artHeroBanded as artHero } from './sheet-01-hero-banded.mjs';
// 05 is the rolling stock's parameters: a frontal and a side elevation per class,
// rendered square-on by the same pass that draws sheet 11, with the numbers read out of
// `sim/stock.ts` and `sim/constants.ts`.
import { artTrains } from './sheet-05-trains.mjs';
// 06 is the game's own 时刻 · 客流 window, photographed in the four day types the
// calendar derives, and its numbers are `sim/demand.ts` and `sim/clock.ts` verbatim —
// imported, not copied, so a retuned knob moves the sheet's text too.
import { artDemand } from './sheet-06-demand.mjs';
// 07 is the game's own interface, photographed region by region by
// `tools/render-ui-shots.mjs` into `.preview/ui-shots/` — same division as 03 and 04:
// the pictures are the game's, and the sheet is only the numbered key and the reading.
import { artInterface } from './sheet-07-interface.mjs';
import { artViews } from './sheets-c.mjs';
import { artPlatformFlow } from './sheets-e.mjs';
// 11 is the game's own consist: `buildTrain` and the model kit, captured by
// `tools/render-train-cards.mjs` into `.preview/train-cards/`, with the stock table
// read out of `sim/stock.ts` rather than transcribed.
import { artTrains3D } from './sheet-11-trains3d.mjs';
import { artTwoLine } from './sheet-13-two-line.mjs';
// 04 draws the game's own module models: its cards are PNGs the **game** rendered,
// captured ahead of time by `tools/render-module-cards.mjs` (which needs a browser,
// because a piece's display, marquee, poster and inscription are canvases the game
// paints at render time). So this builds like every other sheet — synchronously —
// and simply embeds what that capture left in `.preview/module-cards/`.
import { artModules } from './sheet-04-modules.mjs';
// 03 draws the game's own blocks, the same way: its pictures are PNGs the **game**
// rendered from the real chunk mesher, captured ahead of time by
// `tools/render-block-cards.mjs` into `.preview/block-cards/`, and its material
// table is the rail's own (`sim/finishes.ts`), carried out with them.
import { artBlocks } from './sheet-03-blocks.mjs';
import { toEnglish } from './sheet-i18n.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'art');
mkdirSync(OUT, { recursive: true });

const SHEETS = [
  ['01-isometric-cutaway.svg', artHero],
  ['02-vertical-section.svg', artSection],
  ['03-block-system.svg', artBlocks],
  ['04-module-catalogue.svg', artModules],
  ['05-trains-and-track.svg', artTrains],
  ['06-crowd-demand.svg', artDemand],
  ['07-interface.svg', artInterface],
  ['09-camera-and-views.svg', artViews],
  ['11-rolling-stock-3d.svg', artTrains3D],
  ['12-platform-doors-flow.svg', artPlatformFlow],
  ['13-two-line-interchange.svg', artTwoLine],
];

let fail = 0;
// `01` and `01-isometric-cutaway.svg` both name the same sheet, the way `sheet-png.mjs` reads
// them: by leading number, which is what the sheets' own file names are numbered for.
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const wantEn = process.argv.includes('--en');
const num = (file) => String(Number(file.split('-')[0]));
const chosen = wanted.length
  ? SHEETS.filter(([file]) => wanted.some((w) => w === file || num(w) === num(file)))
  : SHEETS;
if (!chosen.length) {
  console.error(`no sheet matches ${wanted.join(', ')} — art/ holds:\n  ${SHEETS.map((s) => s[0]).join('\n  ')}`);
  process.exit(1);
}
for (const [file, fn] of chosen) {
  try {
    // A sheet builds synchronously and returns its SVG; the two that need a
    // browser (03's blocks, 04's cards) are captured into `.preview/` before this
    // runs, not here.
    const svg = await fn();
    if (!svg || !svg.startsWith('<svg')) throw new Error('no svg returned');
    writeFileSync(join(OUT, file), svg, 'utf8');
    const kb = (statSync(join(OUT, file)).size / 1024).toFixed(0);
    console.log(`ok    art/${file.padEnd(28)} ${String(kb).padStart(5)} KB`);
    if (wantEn) {
      const enFile = file.replace(/\.svg$/, '-en.svg');
      const { svg: enSvg, missing } = toEnglish(svg);
      if (missing.length) {
        fail++;
        console.error(`FAIL  art/${enFile}: no English for\n  ${missing.join('\n  ')}`);
        continue;
      }
      // A bare & (or <) outside an entity breaks the whole document in a
      // browser — the sheet renders nothing past the error. Fail here instead.
      // Script bodies live in CDATA and may use && and < freely; skip them.
      const markup = enSvg.replace(/<script[\s\S]*?<\/script>/g, '<script/>');
      const bad = markup.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)|<(?!\/|!|\?|[a-zA-Z/])/);
      if (bad) {
        fail++;
        const at = bad.index ?? 0;
        console.error(`FAIL  art/${enFile}: unescaped markup near “…${enSvg.slice(Math.max(0, at - 40), at + 40)}…”`);
        continue;
      }
      writeFileSync(join(OUT, enFile), enSvg, 'utf8');
      const enKb = (statSync(join(OUT, enFile)).size / 1024).toFixed(0);
      console.log(`ok    art/${enFile.padEnd(28)} ${String(enKb).padStart(5)} KB`);
    }
  } catch (e) {
    fail++;
    console.error(`FAIL  art/${file}: ${e.message}`);
  }
}
process.exit(fail ? 1 : 0);
