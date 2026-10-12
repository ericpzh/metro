// Browser regression checks for the generated art, separate from the DOM-free
// game suite. Requires passenger captures and generated sheets (see metro-web).
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { serveDir, withPage, waitFor } from './browser-harness.mjs';
import { walkingSprite, walkingDefinitions } from './passenger-cards.mjs';

const repo = resolve(import.meta.dirname, '..');
const server = await serveDir(join(repo, 'art'), 4251);
let session;
try {
  for (const file of ['01-isometric-cutaway', '02-vertical-section', '12-platform-doors-flow', '13-two-line-interchange']
    .flatMap(file => [file, `${file}-en`])) {
    session = await withPage({ url: `http://127.0.0.1:4251/${file}.svg`,
      profile: join(repo, '.preview', `.chrome-gait-test-${process.pid}-${file}`), debugPort: 9386 });
    await waitFor(session.evaluate, "document.readyState === 'complete' && document.querySelector('[data-pose=animated-walk]')",
      { what: file });
    for (const seconds of [.37, 8, 13.7]) {
      const counts = await session.evaluate(`(() => {
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = ${seconds * 1000}; }
        return [...document.querySelectorAll('[data-pose=animated-walk]')].map(walker =>
          [...walker.children].filter(frame => getComputedStyle(frame).opacity === '1').length);
      })()`);
      assert.ok(counts.length > 0 && counts.every(count => count === 1),
        `${file} at ${seconds}s: every walker must show exactly one frame, not vanish or stack silhouettes`);
    }
    console.log(`PASS ${file}: one gait frame per walker at three times`);
    await session.close(); session = null;
  }
  session = await withPage({ url: 'about:blank',
    profile: join(repo, '.preview', `.chrome-gait-image-test-${process.pid}`), debugPort: 9386 });
  await waitFor(session.evaluate, '!!document.body');
  for (const view of ['iso', 'elevation', 'plan']) {
    const walker = walkingSprite(view, 'test-walker', 0, 0, 1.2, 110);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><defs>${walkingDefinitions()}</defs><g transform="translate(160 240)">${walker}</g></svg>`;
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const frames = await session.evaluate(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(src)};
      document.body.replaceChildren(image); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
      const ctx = canvas.getContext('2d'); const frames = [];
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 260));
        ctx.clearRect(0, 0, 320, 320); ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, 320, 320).data;
        frames.push({ png: canvas.toDataURL(), visible: pixels.some((value, index) => index % 4 === 3 && value > 0) });
      }
      return frames;
    })()`);
    assert.ok(frames.every(frame => frame.visible), `${view}: gait must not render blank`);
    assert.ok(new Set(frames.map(frame => frame.png)).size > 1,
      `${view}: arms and legs must change in an SVG image even with no position animation`);
    console.log(`PASS ${view}: SVG image changes gait without translation`);
  }
} finally {
  await session?.close(); server.close();
}
