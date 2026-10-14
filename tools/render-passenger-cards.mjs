// Refresh the clothed human figures in sheets 01, 02, 12 and 13.
// Requires game/dist. Run before gen-art.mjs after changing passengerModel.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { passengerCaptureBatches, validatePassengerCaptures } from './passenger-capture-plan.mjs';
import { resolve, join } from 'node:path';
import { serveDir, withPage, waitFor } from './browser-harness.mjs';

const repo = resolve(import.meta.dirname, '..');
const out = resolve(process.env.PASSENGER_CARDS_DIR ?? join(repo, '.preview/passenger-cards'));
const port = Number(process.env.PASSENGER_CAPTURE_PORT ?? 4243);
const debugPort = Number(process.env.PASSENGER_CAPTURE_DEBUG_PORT ?? 9385);
mkdirSync(out, { recursive: true });
const atlasBytes = readFileSync(join(repo, 'game/src/assets/passenger-approved.json'));
const atlas = JSON.parse(atlasBytes);
const batches = passengerCaptureBatches(atlas.variants.map((_,i)=>i));
const server = await serveDir(join(repo, 'game/dist'), port);
const session = await withPage({ url: `http://127.0.0.1:${port}/?capture-passengers`,
  profile: join(repo, '.preview', `.chrome-passengers-${process.pid}`), debugPort });
try {
  await waitFor(session.evaluate, '!!window.__passengerCardsReady', { what: 'passenger capture' });
  const save = images => images.map(({ png, ...item }) => {
    const file = `${item.id}.png`;
    writeFileSync(join(out, file), Buffer.from(png.split(',')[1], 'base64'));
    return { ...item, file };
  });
  // Still captures grow with both age pools too. Returning the complete library
  // in one call can exceed the browser timeout before walking captures begin.
  const index = [];
  for (const age of ['adult','child']) for (const cycleVariants of batches) {
    index.push(...save(await session.evaluate(`window.__passengerCards.capturePassengers(${JSON.stringify({age,cycleVariants})})`)));
    console.log(`still capture: ${age}, variants ${cycleVariants.join(',')}`);
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
  // Keep each CDP response bounded: returning every direction at once can exceed
  // the debugging connection's message limit and leave a capture waiting forever.
  const cycle = [];
  for (const age of ['adult','child']) for (const [view, headings] of [['iso', Array.from({ length: 8 }, (_, i) => i * Math.PI / 4)],
    ['elevation', [0, Math.PI]], ['plan', [0]]]) {
    for (const heading of headings) for (const cycleVariants of batches) {
      cycle.push(...save(await session.evaluate(`window.__passengerCards.capturePassengers(${JSON.stringify({
        age, walkCycles: true, cycleView: view, cycleHeading: heading, cycleVariants,
      })})`)));
      console.log(`walking capture: ${age}, ${view}, heading ${heading.toFixed(2)}, variants ${cycleVariants.join(',')}`);
    }
  }
  validatePassengerCaptures(index, cycle, atlas.library, atlas.walkFrames, true);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({atlasSha256:createHash('sha256').update(atlasBytes).digest('hex'), models:atlas.library.map(m=>({id:m.id,sourceSha256:m.sourceSha256})), standingSamples:index.length, walkingFrames:cycle.length},null,2));
  writeFileSync(join(out, 'walking-index.json'), JSON.stringify(cycle, null, 2));
  console.log(`walking captures: ${cycle.length} stride frames`);
  console.log(`passenger captures: ${index.length} outfit/pose/view combinations -> ${out}`);
} finally {
  await session.close();
  server.close();
}
