import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the transit family. The scene lays the 31 m walkway
// first and then the other nine pieces in a ~95 m row: escalator and lift, the
// bridge, the road, the two pillars, the paved and grass tiles and the street
// ash. The predicate therefore requires the slate clear colour, the pale-blue
// glass balustrades/shaft next to bright stainless, the long band on the left,
// the road's dark asphalt with its white/yellow paint on the right, the tree's
// green canopy at the far end, and a frame with many quantised colours. A blank
// frame or a Unity splash capture fails every one of those.
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
    const x0 = (canvas.x + canvas.width * 0.05) * scale;
    const y0 = (canvas.y + canvas.height * 0.05) * scale;
    const w = Math.floor(canvas.width * 0.9 * scale);
    const h = Math.floor(canvas.height * 0.9 * scale);
    const data = ctx.getImageData(x0, y0, w, h).data;
    let background = 0, light = 0, glass = 0, dark = 0, mid = 0;
    let leftBand = 0, asphalt = 0, paint = 0, canopy = 0, rowMin = w, rowMax = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const px = (i / 4) % w;
      const fx = px / w;
      // The review camera clears to a slate blue (b - r about 40); Unity's
      // built-in splash is neutral, so this proves the 3D scene replaced it.
      const isBackground = b > r + 25 && b > g + 10 && b > 60 && r < 130;
      if (isBackground) background++;
      else {
        if (px < rowMin) rowMin = px;
        if (px > rowMax) rowMax = px;
      }
      // Bright neutral surfaces: the stainless balustrade/shaft/pillars and the
      // concrete bridge deck and pillar shaft.
      if (sum > 540 && b - r < 22 && r > 120) light++;
      // Pale-blue glass: the escalator/walkway balustrades and the lift's shaft
      // and car glazing. The slate background is darker and the steel neutral.
      if (b > r + 25 && b > g + 5 && sum > 470 && r < 200) glass++;
      // Road asphalt: a dark, almost neutral grey. The slate background is blue
      // enough (b - r > 25) to stay out of this bucket.
      if (sum < 400 && b - r < 22 && b - r > -12 && max - min < 45) {
        dark++;
        if (fx > 0.6) asphalt++;
      }
      // Lane paint: the white edge/lane dashes and the yellow centre pair.
      if ((r > 150 && g > 110 && b < 120 && r - b > 60) || (sum > 650 && max - min < 30)) {
        if (fx > 0.6) paint++;
      }
      if (sum >= 340 && sum <= 540) mid++;
      // The 31 m walkway occupies the left third of the row.
      if (fx < 0.36 && !isBackground) leftBand++;
      // Street ash foliage, at the far (right) end of the row; the lawn tile
      // just before it is the same green family.
      if (fx > 0.8 && g > r + 8 && g > b + 18 && g > 70) canopy++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return {
      background, light, glass, dark, mid, leftBand, asphalt, paint, canopy,
      rowSpan: rowMax > rowMin ? (rowMax - rowMin) / w : 0,
      uniqueColors: colors.size,
      sampled: data.length / 4,
      sample: { width: w, height: h },
    };
    })()`)
    // The row must actually be drawn: slate clear colour behind it, the long
    // left band, stainless and glass, asphalt and paint, and the green crown.
    return pixels.background > 60000 && pixels.rowSpan > 0.6 && pixels.leftBand > 900 &&
      pixels.light > 1500 && pixels.glass > 400 && pixels.asphalt > 700 &&
      pixels.paint > 200 && pixels.canopy > 250 && pixels.uniqueColors > 50
  }, '', { tries: 90, every: 500, what: 'transit pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'transit-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.light > 1500, `Too few stainless/concrete pixels: ${pixels.light}`)
  assert.ok(pixels.glass > 400, `Glass balustrade/shaft pixels not visible: ${pixels.glass}`)
  assert.ok(pixels.leftBand > 900, `The 31 m walkway band is missing: ${pixels.leftBand}`)
  assert.ok(pixels.rowSpan > 0.6, `The review row does not span the frame (${pixels.rowSpan.toFixed(2)})`)
  assert.ok(pixels.asphalt > 700, `Road asphalt not visible: ${pixels.asphalt}`)
  assert.ok(pixels.paint > 200, `Road paint not visible: ${pixels.paint}`)
  assert.ok(pixels.canopy > 250, `Green tree canopy not visible: ${pixels.canopy}`)
  assert.ok(pixels.mid > 2000, `Model mid-tones missing: ${pixels.mid}`)
  assert.ok(pixels.uniqueColors > 50, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(pixels.background > 60000, `Review scene background missing: ${pixels.background}`)
  console.log(`Unity Web rendered the transit row (${pixels.light} light, ${pixels.glass} glass, ${pixels.dark} dark, ${pixels.asphalt} asphalt, ${pixels.paint} paint, ${pixels.canopy} canopy, ${pixels.leftBand} walkway, span ${pixels.rowSpan.toFixed(2)}, ${pixels.uniqueColors} colours). See transit-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
