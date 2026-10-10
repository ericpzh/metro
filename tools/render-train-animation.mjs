// Photograph real model poses without changing the static train-card captures.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { serveDir, withPage, waitFor } from './browser-harness.mjs';

const repo = resolve(import.meta.dirname, '..');
const out = join(repo, '.preview/train-animation');
const server = await serveDir(join(repo, 'game/dist'), 4226);
const session = await withPage({ url: 'http://127.0.0.1:4226/?capture-trains',
  profile: join(repo, '.preview', `.chrome-train-animation-${process.pid}`), debugPort: 9362 });
try {
  await waitFor(session.evaluate, '!!window.__trainCardsReady', { what: 'train animation captures' });
  const frames = await session.evaluate(`(() => {
    const { trainPieces } = window.__trainCards;
    const base = trainPieces('#0d141d').frames;
    const frames = [];
    for (const cls of ['A', 'B', 'C', 'L']) {
      for (const id of ['car-' + cls, 'side-' + cls]) {
        const f = base.find(f => f.id === id);
        for (let i = 0; i <= 4; i++) frames.push({ ...f, id: id + '-pose-' + i, baseId: id, doorProgress: i / 4 });
      }
      const id = 'front-' + cls, f = base.find(f => f.id === id);
      for (let i = 0; i < 2; i++) frames.push({ ...f, id: id + '-pose-' + i, baseId: id, headlights: i === 0 });
    }
    return frames;
  })()`);
  mkdirSync(out, { recursive: true });
  const index = [];
  // Return each pose separately so a full set of base64 PNGs never occupies
  // the browser and CDP response at once.
  for (const frame of frames) {
    const [shot] = await session.evaluate(`window.__trainCards.captureTrains(${JSON.stringify([frame])})`);
    if (!shot?.png) throw new Error(`No animation pixels for ${frame.id}`);
    const file = `${shot.id}.png`;
    writeFileSync(join(out, file), Buffer.from(shot.png.split(',')[1], 'base64'));
    index.push({ id: shot.id, file, width: shot.width, height: shot.height });
    console.log(`  ${shot.id}`);
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`train animation: ${index.length} real model poses captured`);
} finally { await session.close(); server.close(); }
