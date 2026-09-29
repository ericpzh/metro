// Generates the concept-art sheets for the Metro Station Designer spec.
//   node tools/gen-art.mjs
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artSection, artBlocks, artModules } from './sheets-a.mjs';
import { artHero } from './sheet-01-hero.mjs';
import { artTrains, artDemand, artArch } from './sheets-b.mjs';
import { artUI } from './sheet-07-ui.mjs';
import { artViews } from './sheets-c.mjs';
import { artQueues } from './sheets-d.mjs';
import { artPlatformFlow } from './sheets-e.mjs';
import { artTrains3D } from './sheet-11-trains3d.mjs';
import { artTwoLine } from './sheet-13-two-line.mjs';

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
  ['07-interface.svg', artUI],
  ['08-architecture.svg', artArch],
  ['09-camera-and-views.svg', artViews],
  ['10-queue-management.svg', artQueues],
  ['11-rolling-stock-3d.svg', artTrains3D],
  ['12-platform-doors-flow.svg', artPlatformFlow],
  ['13-two-line-interchange.svg', artTwoLine],
];

let fail = 0;
for (const [file, fn] of SHEETS) {
  try {
    const svg = fn();
    if (!svg || !svg.startsWith('<svg')) throw new Error('no svg returned');
    writeFileSync(join(OUT, file), svg, 'utf8');
    const kb = (statSync(join(OUT, file)).size / 1024).toFixed(0);
    console.log(`ok    art/${file.padEnd(28)} ${String(kb).padStart(5)} KB`);
  } catch (e) {
    fail++;
    console.error(`FAIL  art/${file}: ${e.message}`);
  }
}
process.exit(fail ? 1 : 0);
