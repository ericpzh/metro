import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 玻璃板 (glass panel) family. The scene shows all
// eleven panels in a row. The predicate requires the slate review background,
// a meaningful amount of lit stainless frame pixels, the pale blue-green tint
// the transparent panes add over that background and many quantised colours, so
// a blank, uniformly coloured or splash-only capture fails.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
// Several agents run Chrome at once here; offset the debugging port by pid.
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web review build' })

  const sample = async () => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    const pixels = await page.evaluate(`(async () => {
      const canvas = document.querySelector('#unity-canvas').getBoundingClientRect();
      const image = new Image();
      image.src = 'data:image/png;base64,${data}';
      await image.decode();
      const sample = document.createElement('canvas');
      sample.width = image.width;
      sample.height = image.height;
      const ctx = sample.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const scale = devicePixelRatio;
      const sx = Math.round(canvas.x * scale);
      const sy = Math.round(canvas.y * scale);
      const sw = Math.floor(canvas.width * scale);
      const sh = Math.floor(canvas.height * scale);
      const data = ctx.getImageData(sx, sy, sw, sh).data;
      const total = data.length / 4;

      // The review camera clears to one constant colour, so the exact modal
      // pixel of a real frame *is* the clear colour. Taking it from the capture
      // (rather than hard-coding a conversion) keeps the check honest if the
      // project's colour space changes; a splash-only frame's mode is neutral
      // black and fails the slate test below.
      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let modeKey = 0, modeCount = -1;
      for (const [key, count] of counts) if (count > modeCount) { modeCount = count; modeKey = key; }
      const mr = modeKey >> 16, mg = (modeKey >> 8) & 255, mb = modeKey & 255;
      const modeSum = mr + mg + mb;

      let background = 0, steel = 0, glass = 0, dark = 0;
      const quantised = new Set();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        const high = Math.max(r, g, b), low = Math.min(r, g, b);
        quantised.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
        if (r === mr && g === mg && b === mb) { background++; continue; }
        // The panes are the only blue-green glass in the frame: brighter than
        // the slate clear colour (transparent blend over it) with green above
        // red and blue on top. Steel is desaturated, so the two never overlap.
        if (b > r + 12 && g > r + 4 && sum > modeSum + 30 && high < 240) glass++;
        // Lit satin stainless: bright and desaturated, well above the slate.
        if (high > 120 && high - low < 45) steel++;
        if (sum < 150) dark++;
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([key, count]) => ({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], count }));
      return {
        mode: [mr, mg, mb], modeCount, background, steel, glass, dark,
        uniqueColors: quantised.size, top, sampled: total,
        canvas: { width: sw, height: sh, scale },
      };
    })()`)
    return { data, pixels }
  }

  // Plausible frame: the clear colour must be the family's slate blue (not the
  // neutral Unity splash), it must not cover everything (a blank frame fails),
  // and the row itself must supply lit steel frames and pane tint.
  const enough = (p) => p.mode[2] > p.mode[0] + 20 && p.mode[2] >= 60
    && p.background > p.sampled * 0.5 && p.background < p.sampled * 0.97
    && p.steel > 2000 && p.glass > 8000 && p.uniqueColors > 40
  let captured
  try {
    await waitFor(async () => {
      captured = await sample()
      return enough(captured.pixels)
    }, '', { tries: 90, every: 400, what: 'glass panels over the review background' })

    // A splash or transient frame fades: the real scene must still satisfy the
    // check half a second later. Keep the second frame as the evidence image.
    await new Promise(done => setTimeout(done, 500))
    captured = await sample()
    const pixels = captured.pixels
    assert.ok(enough(pixels), `Glass row did not persist: ${JSON.stringify({ ...pixels, top: undefined })}`)
    assert.ok(pixels.glass > 8000, `Too few blue-green glass-tint pixels: ${pixels.glass}`)
    assert.ok(pixels.steel > 2000, `Too few lit steel frame pixels: ${pixels.steel}`)
    assert.ok(pixels.uniqueColors > 40, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
    assert.ok(pixels.background > pixels.sampled * 0.5,
      `Review scene background missing: ${pixels.background} of ${pixels.sampled}`)
  } finally {
    if (captured) {
      await writeFile(join(proof, 'glass-web.png'), Buffer.from(captured.data, 'base64'))
      await writeFile(join(proof, 'web-pixels.json'),
        JSON.stringify({ ...captured.pixels, stableFrames: 2, debugPort }, null, 2) + '\n')
    }
  }
  const p = captured.pixels
  console.log(`Unity Web rendered the glass row (mode rgb(${p.mode.join(',')}), ${p.background} background, `
    + `${p.steel} steel, ${p.glass} glass-tint, ${p.dark} dark, ${p.uniqueColors} colours of ${p.sampled} samples). `
    + 'See glass-web.png and web-pixels.json.')
} finally {
  await page?.close()
  server.close()
}
