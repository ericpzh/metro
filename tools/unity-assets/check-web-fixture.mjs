import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 固定设施 (fixture) family. The scene shows all ten
// pieces — six benches, the office chair, the desk, the chiller and the ceiling
// grille — in one row on the slate clear colour. The predicate requires that
// slate, the light steel/white frames, the dark plant-room details (grille slats,
// fan barrels, meter faces), a real mid-tone band for the brushed steel and the
// timber, and a varied quantised frame; a blank or splash-only capture has none of
// those and fails.
//
// The row is 3.4 m spacing over 33.6 m, so the camera stands 30 m back: the two
// halves of the canvas each hold several pieces, which is what proves the row
// rendered rather than one stray object.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-fixture-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web fixture review build' })
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
    const x0 = Math.max(0, Math.round(canvas.x * scale));
    const y0 = Math.max(0, Math.round(canvas.y * scale));
    const width = Math.max(1, Math.min(sample.width - x0, Math.round(canvas.width * scale)));
    const height = Math.max(1, Math.min(sample.height - y0, Math.round(canvas.height * scale)));
    const data = ctx.getImageData(x0, y0, width, height).data;
    let background = 0, model = 0, light = 0, mid = 0, dark = 0, warm = 0;
    let leftHalf = 0, rightHalf = 0;
    const colors = new Set();
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        // The review camera clears to the same slate blue as every other family
        // (0.22, 0.30, 0.38 -> 56, 77, 97 in this project's output space). The
        // Unity splash is neutral, so it cannot fill this band.
        const isBackground = b > r + 20 && b > g + 8 && b > 55 && b < 190 && r < 145 && g < 175;
        if (isBackground) { background++; continue; }
        model++;
        if (px < width / 2) leftHalf++; else rightHalf++;
        if (sum > 460) light++;
        else if (sum < 300) dark++;
        else mid++;
        // Warm pixels: the timber slats (wood / woodLight) and the switchboard's
        // orange status lamps are the only warm surfaces in the row.
        if (r > b + 18 && r > g + 8 && r > 60) warm++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
    return { sampled: width * height, width, height, background, model, light, mid, dark, warm, leftHalf, rightHalf, uniqueColors: colors.size };
    })()`)
    // Slate background, geometry across the whole row, light frames, dark
    // plant-room details, a broad mid band and many quantised colours. A blank
    // frame or the Unity splash fails at the background count first.
    return pixels.background > pixels.sampled * 0.15 && pixels.model > pixels.sampled * 0.015 &&
      pixels.light > 2500 && pixels.mid > 1200 && pixels.dark > 400 && pixels.warm > 150 &&
      pixels.leftHalf > 200 && pixels.rightHalf > 200 && pixels.uniqueColors > 40
  }, '', { tries: 80, every: 500, what: 'fixture pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'fixture-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > pixels.sampled * 0.15,
    `Review scene background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.model > pixels.sampled * 0.015, `Too few fixture pixels: ${pixels.model}/${pixels.sampled}`)
  assert.ok(pixels.light > 2500, `Light steel/white fixture pixels missing: ${pixels.light}`)
  assert.ok(pixels.mid > 1200, `Fixture mid-tones missing (brushed steel, timber): ${pixels.mid}`)
  assert.ok(pixels.dark > 400, `Dark plant-room details missing (grille, fans, meters): ${pixels.dark}`)
  assert.ok(pixels.warm > 150, `Timber/orange fixture pixels missing: ${pixels.warm}`)
  assert.ok(pixels.leftHalf > 200 && pixels.rightHalf > 200,
    `The row does not span the frame: ${pixels.leftHalf} left / ${pixels.rightHalf} right`)
  assert.ok(pixels.uniqueColors > 40, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(`Unity Web rendered the ten-fixture row (${pixels.background} slate, ${pixels.model} model, ` +
    `${pixels.light} light, ${pixels.mid} mid, ${pixels.dark} dark, ${pixels.warm} warm, ` +
    `${pixels.leftHalf}/${pixels.rightHalf} halves, ${pixels.uniqueColors} colours). ` +
    'See fixture-web.png and web-pixels.json.')
} finally {
  await page?.close()
  server.close()
}
