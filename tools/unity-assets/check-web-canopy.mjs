import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the canopy family. The scene shows all eleven pieces
// in one row: four grey concrete/steel roofs hung overhead, the half-height PSD
// glass and its white cover course, two green 公交站 shelters with their printed
// canvases and the two signal heads. The predicate requires each of them, so a
// blank, splash-only or single-hue frame fails.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9700 + (process.pid % 400)
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
    // getImageData truncates its rectangle, so sample an integer rect and use
    // that width for the column arithmetic below.
    const x = Math.round((canvas.x + canvas.width * 0.04) * scale);
    const y = Math.round((canvas.y + canvas.height * 0.04) * scale);
    const w = Math.round(canvas.width * 0.92 * scale);
    const h = Math.round(canvas.height * 0.92 * scale);
    const data = ctx.getImageData(x, y, w, h).data;
    let background = 0, steel = 0, whitePanel = 0, glass = 0, shelter = 0, frame = 0, lensRed = 0, lensGreen = 0;
    let signalRed = 0, signalGreen = 0;
    let light = 0, dark = 0, mid = 0;
    const colors = new Set();
    // The traffic light and the rail signal close the row, so the last tenth of
    // the sampled frame is where the lit aspects can be seen on their own — the
    // shelters' poster artwork lies well to the left of it.
    const signalStart = Math.floor(w * 0.9);    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      // The review camera clears to slate (about 56/76/97), so a blue-shifted
      // dark field proves the 3D scene replaced the splash.
      const isBackground = b > r + 25 && b > g + 10 && b > 60 && r < 130;
      if (isBackground) background++;
      // Roof sheets are the concrete finish (0x8d9299) and the truss members are
      // steel (0xb7bdc4): near-neutral greys across the whole mid/bright range.
      if (max - min <= 18 && sum > 300 && sum < 690) steel++;
      // The PSD end cover course is the palette's white (0xeef1f4).
      if (sum > 640 && max - min <= 20) whitePanel++;
      // The half-height screen's fixed glass over the slate field: brighter and
      // bluer than the clear colour, but nowhere near the white course.
      if (b > r + 38 && sum > 300 && r > 70 && r < 190) glass++;
      // The 公交站 shelter roof and posts are a dark green (0x18574d).
      if (g > r + 16 && g >= b && sum < 330) shelter++;
      // Its dark-steel bases, braces and lightbox frames, the screen's black
      // fittings and the signal heads — any neutral structure darker than the
      // slate field.
      if (!isBackground && sum < 250 && max - min <= 45) frame++;
      // The signal aspects are lit, so they keep their full authored colour. At
      // the row's scale the 0.13 m rail-signal lens is only a few pixels, so the
      // predicate is tight against the shelter's orange strip (79 red over green)
      // and only asks that the lit aspect is actually present.
      if (r > g + 85 && r > b + 85) lensRed++;
      if (g > r + 40 && g > b + 15 && sum > 260) lensGreen++;
      const px = (i / 4) % w;
      if (px >= signalStart) {
        if (r > g + 60 && r > b + 60) signalRed++;
        if (g > r + 35 && g > b + 10 && sum > 220) signalGreen++;
      }
      if (sum > 500) light++;
      else if (sum < 150) dark++;
      else mid++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return { background, steel, whitePanel, glass, shelter, frame, lensRed, lensGreen, signalRed, signalGreen, light, dark, mid, uniqueColors: colors.size, sampled: data.length / 4, sample: { w, h, signalStart } };
    })()`)
    // Every family member must show: slate field, the grey roofs, the white PSD
    // course, the screen glass, the green shelter, its dark frame, both lit
    // signal aspects, over a frame with many quantised colours.
    return pixels.background > 12000 && pixels.steel > 2500 && pixels.whitePanel > 120 &&
      pixels.glass > 120 && pixels.shelter > 60 && pixels.frame > 100 &&
      pixels.signalRed > 0 && pixels.signalGreen > 0 && pixels.uniqueColors > 24
  }, '', { tries: 60, every: 500, what: 'canopy pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'canopy-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > 12000, `Review scene background missing: ${pixels.background}`)
  assert.ok(pixels.steel > 2500, `Roof / truss steel not visible: ${pixels.steel}`)
  assert.ok(pixels.whitePanel > 120, `White PSD panel not visible: ${pixels.whitePanel}`)
  assert.ok(pixels.glass > 120, `PSD glass not visible: ${pixels.glass}`)
  assert.ok(pixels.shelter > 60, `Bus-stop shelter not visible: ${pixels.shelter}`)
  assert.ok(pixels.frame > 100, `Bus-stop frame not visible: ${pixels.frame}`)
  assert.ok(pixels.signalRed > 0, `Signal red lens not visible: ${pixels.signalRed}`)
  assert.ok(pixels.signalGreen > 0, `Signal green lens not visible: ${pixels.signalGreen}`)
  assert.ok(pixels.uniqueColors > 24, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(pixels.mid > 500, `Model mid-tones missing: ${pixels.mid}`)
  console.log(`Unity Web rendered the canopy row (${pixels.steel} steel, ${pixels.whitePanel} white, ${pixels.glass} glass, ${pixels.shelter} shelter, ${pixels.frame} frame, ${pixels.signalRed} signal red, ${pixels.signalGreen} signal green, ${pixels.background} background, ${pixels.uniqueColors} colours). See canopy-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
