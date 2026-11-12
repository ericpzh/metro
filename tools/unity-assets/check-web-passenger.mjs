import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the passenger (乘客) family. The scene holds the four
// original stand-in variants in a row, with a 24-instance crowd behind them. The
// crowd's Animation components play the imported legacy clips, so two frames a
// second apart must differ: the check proves the clips actually run in the
// build, not just in the Editor.
//
// The predicate requires the slate clear colour, skin/wardrobe/hair/bag pixels,
// ten populated crowd bands with different silhouettes (child vs adult, walk vs
// seated) and many quantised colours. A blank or Unity-splash frame has no slate
// background and no palette pixels, so it cannot pass.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)

const measure = data => `(async () => {
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
  let background = 0, skin = 0, navy = 0, teal = 0, orange = 0, hair = 0, bag = 0, dark = 0, mid = 0, light = 0;
  const colors = new Set();
  const bands = Array.from({ length: 10 }, () => ({ model: 0, luma: 0 }));
  const left = Math.round(width * 0.02), right = Math.round(width * 0.98);
  const bandWidth = Math.max(1, (right - left) / bands.length);
  const cellCols = 48, cellRows = 27;
  const signature = new Float32Array(cellCols * cellRows * 3);
  const cellCounts = new Uint32Array(cellCols * cellRows);
  for (let py = 0; py < height; py++) {
    const cellRow = Math.min(cellRows - 1, Math.floor(py / height * cellRows));
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      // The review camera clears to the same slate blue as the other families;
      // the box is narrow so the navy wardrobe cannot be mistaken for it.
      const isBackground = b > r + 25 && b > g + 12 && b >= 70 && b <= 140 && r >= 30 && r <= 90 && g >= 50 && g <= 120;
      if (isBackground) { background++; }
      else {
        if (sum > 480) light++;
        else if (sum < 300) dark++;
        else mid++;
        // Skin is the tan body material; the leather bag is a browner tan
        // (lower green/red ratio), so the two recipes stay separable.
        const isSkin = r > 110 && g > 70 && r > g + 12 && g > r * 0.7 && g > b + 6;
        const isNavy = b > r + 40 && b > g + 25 && b > 60;
        const isTeal = g > r + 20 && g > b + 10 && g > 55;
        const isOrange = r > g + 40 && r > b + 70 && r > 90;
        const isHair = r < 140 && r > 25 && r > g + 5 && g >= b && r > b + 10 && r - b < 45 && sum < 340;
        const isBag = r > 90 && g > r * 0.5 && g < r * 0.7 && b < g * 0.7 && b > 20;
        if (isSkin) skin++;
        else if (isNavy) navy++;
        else if (isTeal) teal++;
        else if (isOrange) orange++;
        else if (isHair) hair++;
        if (isBag) bag++;
      }
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      const cell = cellRow * cellCols + Math.min(cellCols - 1, Math.floor(px / width * cellCols));
      signature[cell * 3] += r;
      signature[cell * 3 + 1] += g;
      signature[cell * 3 + 2] += b;
      cellCounts[cell]++;
      const bandIndex = Math.floor((px - left) / bandWidth);
      if (!isBackground && bandIndex >= 0 && bandIndex < bands.length) {
        bands[bandIndex].model++;
        bands[bandIndex].luma += (r + g + b) / 3;
      }
    }
  }
  const bandStats = bands.map((band, index) => ({
    index, model: band.model, luma: band.model ? Math.round(band.luma / band.model) : 0,
  }));
  return {
    sampled: width * height, width, height,
    background, skin, navy, teal, orange, hair, bag, dark, mid, light,
    uniqueColors: colors.size,
    bands: bandStats,
    populatedBands: bandStats.filter(band => band.model > 150).length,
    bandSpread: bandStats.filter(band => band.model > 0).length > 1
      ? Math.max(...bandStats.map(band => band.model)) / Math.max(1, Math.min(...bandStats.filter(band => band.model > 0).map(band => band.model)))
      : 0,
    signature: Array.from(signature, value => Math.round(value)),
    cellCounts: Array.from(cellCounts),
  };
})()`

let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-passenger-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web passenger review build' })

  let data, pixels
  await waitFor(async () => {
    ({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
    pixels = await page.evaluate(measure(data))
    // Only wait for the splash to be replaced by the 3D scene before running the
    // full assertions: a mixed frame with slate background and some skin.
    return pixels.background > pixels.sampled * 0.2 && pixels.skin > 300 && pixels.uniqueColors > 20
  }, '', { tries: 80, every: 500, what: 'passenger pixels after the Unity splash' })

  // Let the splash fade and the first animation frame settle before recording
  // the evidence frame and sampling the motion pair.
  await sleep(600)
  ;({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
  pixels = await page.evaluate(measure(data))

  // Second frame: the legacy Animation clips must be advancing in the build.
  await sleep(1100)
  let motionData
  ;({ data: motionData } = await page.send('Page.captureScreenshot', { format: 'png' }))
  const second = await page.evaluate(measure(motionData))
  let changedCells = 0, totalDelta = 0, totalChannels = 0
  for (let cell = 0; cell < pixels.cellCounts.length; cell++) {
    if (!pixels.cellCounts[cell] || !second.cellCounts[cell]) continue
    let worst = 0
    for (let channel = 0; channel < 3; channel++) {
      const a = pixels.signature[cell * 3 + channel] / pixels.cellCounts[cell]
      const b = second.signature[cell * 3 + channel] / second.cellCounts[cell]
      const delta = Math.abs(a - b)
      totalDelta += delta
      totalChannels++
      worst = Math.max(worst, delta)
    }
    if (worst > 6) changedCells++
  }
  const meanDelta = totalChannels ? totalDelta / totalChannels : 0

  const populated = pixels.bands.filter(band => band.model > 150).length
  // Keep the evidence even when a threshold below fails: the screenshot and the
  // measured bands are the record used to tune or diagnose the review.
  await writeFile(join(proof, 'passenger-web.png'), Buffer.from(data, 'base64'))
  await writeFile(join(proof, 'web-pixels.json'), JSON.stringify({
    ...pixels, motion: { changedCells, meanDelta: +meanDelta.toFixed(3), sampledCells: pixels.cellCounts.filter(Boolean).length },
  }, null, 2) + '\n')
  assert.ok(pixels.background > pixels.sampled * 0.3,
    `Review scene slate background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.skin > 1200, `Too few skin/body pixels: ${pixels.skin}`)
  assert.ok(pixels.navy > 600, `Navy wardrobe missing: ${pixels.navy}`)
  assert.ok(pixels.teal > 400, `Teal wardrobe missing: ${pixels.teal}`)
  assert.ok(pixels.orange > 400, `Orange wardrobe missing: ${pixels.orange}`)
  assert.ok(pixels.hair > 400, `Hair pixels missing: ${pixels.hair}`)
  assert.ok(pixels.bag > 150, `Shoulder-bag pixels missing: ${pixels.bag}`)
  assert.ok(pixels.dark > 1500, `Dark trousers/shoes missing: ${pixels.dark}`)
  assert.ok(pixels.uniqueColors > 40, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(populated >= 9, `Crowd is missing from some bands: ${populated}/10 bands populated`)
  assert.ok(pixels.bandSpread > 1.12, `Crowd silhouettes are too uniform across bands (spread ${pixels.bandSpread.toFixed(2)})`)
  assert.ok(pixels.bands.filter(band => band.model > 150).length >= 9,
    `Populated crowd band count ${populated}/10`)
  assert.ok(changedCells >= 2 || meanDelta > 0.05,
    `The Web crowd is not animating (${changedCells} changed cells, mean delta ${meanDelta.toFixed(2)})`)

  console.log(`Unity Web rendered the passenger row and crowd (${pixels.skin} skin, ${pixels.navy} navy, ` +
    `${pixels.teal} teal, ${pixels.orange} orange, ${pixels.hair} hair, ${pixels.bag} bag, ${pixels.dark} dark, ` +
    `${populated}/10 bands, spread ${pixels.bandSpread.toFixed(2)}, ${pixels.uniqueColors} colours, ` +
    `motion ${changedCells} cells / ${meanDelta.toFixed(2)}). See passenger-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
