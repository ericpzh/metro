import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the barrier family. The scene shows ten pieces in a
// row: the four 1 m fences, the 3 m / 1.5 m / 0.74 m noise barriers and the
// three thin 盲道 tiles. The predicate requires the slate review background, the
// light steel rails and white noise-barrier panels, the dark grey-green tactile
// tiles and a varied frame, so a blank or splash-only capture fails.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
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
  })()`, { what: 'Unity Web barrier review build' })
  let data, pixels
  await waitFor(async () => {
    ({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
    pixels = await page.evaluate(`(async () => {
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
    const x = Math.max(0, Math.floor((canvas.x + canvas.width * 0.05) * scale));
    const y = Math.max(0, Math.floor((canvas.y + canvas.height * 0.05) * scale));
    const w = Math.min(sample.width - x, Math.floor(canvas.width * 0.9 * scale));
    const h = Math.min(sample.height - y, Math.floor(canvas.height * 0.9 * scale));
    const data = ctx.getImageData(x, y, w, h).data;
    let background = 0, light = 0, mid = 0, dark = 0, tactile = 0, panel = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      // The review camera clears to a slate blue (a linear 0.22/0.30/0.38 is
      // about 128/149/165 in sRGB), while Unity's built-in splash is neutral.
      // Requiring this colour proves the 3D scene replaced the splash.
      if (b > r + 25 && b > g + 10 && b > 60 && r < 140) background++;
      // White noise-barrier lower panels (0xeef1f4): the brightest large surface.
      if (r > 165 && g > 165 && b > 165) panel++;
      if (sum > 480) light++;
      else if (sum < 150) dark++;
      else mid++;
      // 盲道 tiles: dark grey-green 0x505b4b (80/91/75), never safety yellow.
      if (g > r + 3 && g > b + 8 && sum < 330 && sum > 50) tactile++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return { background, light, mid, dark, panel, tactile, uniqueColors: colors.size, sampled: data.length / 4 };
    })()`)
    // Slate backdrop, white barrier bodies and light rails over it, the dark
    // tactile tiles in the foreground and a mixed frame with many quantised
    // colours (never a uniform or splash-only frame).
    return pixels.background > 12000 && pixels.light > 3000 && pixels.panel > 1500 &&
      pixels.tactile > 200 && pixels.uniqueColors > 24
  }, '', { tries: 60, every: 500, what: 'barrier pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'barrier-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > 12000, `Review scene slate background missing: ${pixels.background}`)
  assert.ok(pixels.light > 3000, `Too few light steel/panel pixels: ${pixels.light}`)
  assert.ok(pixels.panel > 1500, `Noise-barrier bodies not visible: ${pixels.panel}`)
  assert.ok(pixels.tactile > 200, `Dark grey-green tactile tiles not visible: ${pixels.tactile}`)
  assert.ok(pixels.uniqueColors > 24, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(pixels.mid > 500, `Model mid-tones missing: ${pixels.mid}`)
  console.log(`Unity Web rendered the barrier/tactile row (${pixels.light} light, ${pixels.panel} panel, `
    + `${pixels.tactile} tactile, ${pixels.mid} mid, ${pixels.dark} dark, ${pixels.background} background, `
    + `${pixels.uniqueColors} colours). See barrier-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
