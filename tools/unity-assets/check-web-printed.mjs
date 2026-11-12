import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the printed-surface family. The scene holds all ten
// pieces in one row over a slate clear colour, seen from a 3/4 top-down camera:
// the two coloured courts with their white line work, the transparent floor
// vinyls (the waiting queue's safety yellow, the direction arrow's line red and
// the boarding strip's ink), the near-black wayfinding plates and the pale line
// network boards.
//
// The predicate requires every one of those inks, so a blank frame, a uniform
// clear or Unity's neutral splash cannot pass: the splash has no slate blue, no
// court colour and no printed face.
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
  })()`, { what: 'Unity Web printed review build' })
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
    let background = 0, courtGreen = 0, courtBlue = 0, kitchen = 0;
    let pale = 0, dark = 0, yellow = 0, red = 0, teal = 0, mid = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      // The review camera clears to a slate blue, while Unity's splash is neutral.
      if (b > r + 25 && b > g + 10 && b > 60 && r < 130) { background++; continue; }
      // The badminton court's green (#237d59) and the pickleball court's blue
      // (#235ba0) plus its pale cyan kitchen (#68afc3): the family's large fills.
      if (g > r + 20 && g > b + 5 && g > 70) courtGreen++;
      if (b > r + 30 && b > g + 10 && b > 90) courtBlue++;
      if (g > 110 && b > 130 && r < 140 && g > r + 20) kitchen++;
      // The painted line work and the line-map board's pale ground (#f4f5f1).
      if (r > 190 && g > 190 && b > 185) pale++;
      // The wayfinding plate's near-black ground (#0d1116) and painted ink. The
      // plates are 0.4 m tall in a 38 m row, so at this camera they are a few
      // hundred pixels even though each is fully on screen.
      if (sum < 140) dark++;
      else if (sum < 480) mid++;
      // The floor vinyls: the waiting queue's safety yellow (#f3cf19) and the
      // direction arrow's line red (#c8102e, the unbound default line 5).
      if (r > 120 && g > 90 && b < 110 && r > b + 50 && g > b + 40) yellow++;
      if (r > 100 && r > g + 40 && r > b + 35) red++;
      // The printed green queue arrow (#38bd77 / #21b58b), distinct from a
      // neutral slate: green above red with blue between them.
      if (g > 90 && g > r + 25 && b > r + 5) teal++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return {
      sampled: width * height, width, height,
      background, courtGreen, courtBlue, kitchen, pale, dark, yellow, red, teal, mid,
      uniqueColors: colors.size,
    };
    })()`)
    // The slate review background, both court fills and the kitchen, the printed
    // line work and pale map boards, the near-black sign plates and the three
    // vinyl inks, with a varied frame. A splash or a flat clear cannot reach this.
    return pixels.background > pixels.sampled * 0.10 && pixels.courtGreen > 3000 &&
      pixels.courtBlue > 2000 && pixels.kitchen > 100 && pixels.pale > 1500 &&
      pixels.dark > 100 && pixels.yellow > 40 && pixels.red > 80 &&
      pixels.teal > 200 && pixels.uniqueColors > 48
  }, '', { tries: 80, every: 500, what: 'printed pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'printed-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > pixels.sampled * 0.10, `Review scene background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.courtGreen > 3000, `Badminton court colour and line work missing: ${pixels.courtGreen} green pixels`)
  assert.ok(pixels.courtBlue > 2000, `Pickleball court colour missing: ${pixels.courtBlue} blue pixels`)
  assert.ok(pixels.kitchen > 100, `Pickleball kitchen fill missing: ${pixels.kitchen} cyan pixels`)
  assert.ok(pixels.pale > 1500, `Court lines / line-map boards missing: ${pixels.pale} pale pixels`)
  assert.ok(pixels.dark > 100, `Wayfinding sign plates missing: ${pixels.dark} near-black pixels`)
  assert.ok(pixels.yellow > 40, `Waiting queue vinyl missing: ${pixels.yellow} yellow pixels`)
  assert.ok(pixels.red > 80, `Direction arrow vinyl missing: ${pixels.red} red pixels`)
  assert.ok(pixels.teal > 200, `Printed vinyl green ink missing: ${pixels.teal} teal pixels`)
  assert.ok(pixels.uniqueColors > 48, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(`Unity Web rendered the printed row (${pixels.courtGreen} court green, ${pixels.courtBlue} court blue, ` +
    `${pixels.kitchen} kitchen, ${pixels.pale} pale ink, ${pixels.dark} sign plate, ${pixels.yellow} yellow, ` +
    `${pixels.red} red, ${pixels.teal} teal, ${pixels.mid} mid, ${pixels.background} background, ` +
    `${pixels.uniqueColors} colours). See printed-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
