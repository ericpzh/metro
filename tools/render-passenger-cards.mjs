// Refresh the clothed human figures in sheets 01, 02, 12 and 13.
// Requires game/dist. Run before gen-art.mjs after changing passengerModel.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { serveDir, withPage, waitFor } from './browser-harness.mjs';

const repo = resolve(import.meta.dirname, '..');
const out = join(repo, '.preview/passenger-cards');
mkdirSync(out, { recursive: true });
const server = await serveDir(join(repo, 'game/dist'), 4243);
const session = await withPage({ url: 'http://127.0.0.1:4243/?capture-passengers',
  profile: join(repo, '.preview', `.chrome-passengers-${process.pid}`), debugPort: 9385 });
try {
  await waitFor(session.evaluate, '!!window.__passengerCardsReady', { what: 'passenger capture' });
  const save = images => images.map(({ png, ...item }) => {
    const file = `${item.id}.png`;
    writeFileSync(join(out, file), Buffer.from(png.split(',')[1], 'base64'));
    return { ...item, file };
  });
  const images = await session.evaluate('window.__passengerCards.capturePassengers()');
  const index = save(images);
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
  // Keep each CDP response bounded: returning every direction at once can exceed
  // the debugging connection's message limit and leave a capture waiting forever.
  const cycle = [];
  for (const [view, headings] of [['iso', Array.from({ length: 8 }, (_, i) => i * Math.PI / 4)],
    ['elevation', [0, Math.PI]], ['plan', [0]]]) {
    for (const heading of headings) {
      cycle.push(...save(await session.evaluate(`window.__passengerCards.capturePassengers(${JSON.stringify({
        walkCycles: true, cycleView: view, cycleHeading: heading,
      })})`)));
      console.log(`walking capture: ${view}, heading ${heading.toFixed(2)}`);
    }
  }
  writeFileSync(join(out, 'walking-index.json'), JSON.stringify(cycle, null, 2));
  console.log(`walking captures: ${cycle.length} stride frames`);
  console.log(`passenger captures: ${index.length} outfit/pose/view combinations -> ${out}`);
} finally {
  await session.close();
  server.close();
}
