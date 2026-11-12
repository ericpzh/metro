import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 监控 (CCTV) family. The scene shows all four
// variants in a row; the predicate requires the white/steel housings, the dark
// optical panels and a varied frame, so a uniform or splash-only capture fails.
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
  })()`, { what: 'Unity Web review build' })
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
    const x = (canvas.x + canvas.width * 0.05) * scale;
    const y = (canvas.y + canvas.height * 0.05) * scale;
    const w = canvas.width * 0.9 * scale;
    const h = canvas.height * 0.9 * scale;
    const data = ctx.getImageData(x, y, w, h).data;
    let light = 0, dark = 0, mid = 0, background = 0, optical = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      // The review camera clears to a slate blue (b - r about 41), while
      // Unity's built-in splash is neutral. Requiring this colour proves the
      // 3D scene replaced the splash, not just that the loading bar hid.
      if (b > r + 25 && b > g + 10 && b > 60 && r < 130) background++;
      // The 枪机's optical window is the one deliberately blue surface
      // (0x274b62); steel and the scene clear colour are far less saturated.
      if (b > r + 50 && g > r + 25 && sum < 320) optical++;
      if (sum > 500) light++;
      else if (sum < 150) dark++;
      else mid++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return { light, dark, mid, background, optical, uniqueColors: colors.size, sampled: data.length / 4 };
    })()`)
    // Four white/steel housings over the slate review background, dark optic
    // barrels/globes and the bullet's blue optical window; a mixed frame with
    // many quantised colours (never a uniform or splash-only frame).
    return pixels.background > 20000 && pixels.light > 4000 && pixels.dark > 200 &&
      pixels.optical > 20 && pixels.uniqueColors > 24
  }, '', { tries: 60, every: 500, what: 'CCTV pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'cctv-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.light > 4000, `Too few white/steel pixels: ${pixels.light}`)
  assert.ok(pixels.dark > 200, `Dark optical panels not visible: ${pixels.dark}`)
  assert.ok(pixels.optical > 20, `Bullet optical window not visible: ${pixels.optical}`)
  assert.ok(pixels.uniqueColors > 24, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(pixels.background > 20000, `Review scene background missing: ${pixels.background}`)
  assert.ok(pixels.mid > 500, `Model mid-tones missing: ${pixels.mid}`)
  console.log(`Unity Web rendered the CCTV row (${pixels.light} light, ${pixels.dark} dark, ${pixels.optical} optical, ${pixels.mid} mid, ${pixels.background} background, ${pixels.uniqueColors} colours). See cctv-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
