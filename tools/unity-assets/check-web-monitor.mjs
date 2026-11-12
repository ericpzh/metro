import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Chrome review of the monitor family. Both cabinets share the scene:
// the 3 x 2 m wall board on the left and the 0.96 x 0.72 m ceiling cabinet on
// the right. The predicates require the dark steel housings and the bright
// cyan/teal ink artwork, so a splash or a uniform clear frame fails.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-${process.pid}`),
    // Several families may run Chrome at once.
    debugPort: 9300 + (process.pid % 400),
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web monitor review build' })
  let data, colors
  await waitFor(async () => {
    ({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
    colors = await page.evaluate(`(async () => {
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
    const x = Math.max(0, Math.floor(canvas.x * scale));
    const y = Math.max(0, Math.floor(canvas.y * scale));
    const w = Math.min(sample.width - x, Math.floor(canvas.width * scale));
    const h = Math.min(sample.height - y, Math.floor(canvas.height * scale));
    const pixels = ctx.getImageData(x, y, w, h).data;
    let light = 0, dark = 0, cyan = 0;
    const buckets = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      // The light slate review background.
      if (r > 150 && g > 150 && b > 150) light++;
      // The dark steel cabinet housing (0x3c434c) under the review lights.
      if (r < 110 && g < 115 && b < 125) dark++;
      // The bright cyan/teal ink: rail 0x8bd4dc, wall ink 0x729994.
      if (g > 120 && b > 110 && g > r + 25 && b > r + 20) cyan++;
      buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return { light, dark, cyan, distinct: buckets.size, sampled: (w * h) };
    })()`)
    // Both housings plus the inked panes; distinct buckets reject a flat clear.
    return colors.dark > 1500 && colors.cyan > 150 && colors.distinct > 12 && colors.light > 500
  }, '', { tries: 60, every: 400, what: 'monitor pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'monitor-web.png'), Buffer.from(data, 'base64'))
    if (colors) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(colors, null, 2) + '\n')
  })
  assert.ok(colors.dark > 1500, `Only ${colors.dark} dark cabinet pixels; the cabinets did not render`)
  assert.ok(colors.cyan > 150, `Only ${colors.cyan} cyan/teal ink pixels; the dashboard panes did not render`)
  assert.ok(colors.distinct > 12, 'The canvas is a flat/uniform frame')
  console.log(`Unity Web rendered both monitor cabinets. See monitor-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
