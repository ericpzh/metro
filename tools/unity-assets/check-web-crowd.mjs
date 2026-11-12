import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the soft-human crowd (客流) family. The scene holds
// eight representative bake recipes in a row with a 24-instance crowd behind
// them; the crowd's legacy Animation clips advance in the build.
//
// The predicate requires the slate clear colour, the soft-human palette (pale
// head/hands, commuter green, formal navy, skirt mauve, tan bags, dark shoes),
// ten populated crowd bands with different silhouettes and many quantised
// colours. A blank or Unity-splash frame has no slate background and no palette
// pixels, so it cannot pass. Two frames a second apart must differ.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9400 + (process.pid % 400)

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
  let background = 0, pale = 0, green = 0, navy = 0, mauve = 0, tan = 0, dark = 0, mid = 0;
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
      // Same slate clear as the other review families; the box is narrow so the
      // navy suit and the teal crowd cannot be mistaken for the background.
      const isBackground = b > r + 25 && b > g + 12 && b >= 70 && b <= 140 && r >= 30 && r <= 90 && g >= 50 && g <= 120;
      if (isBackground) {
        background++;
      } else {
        if (sum > 480) mid++;
        const isPale = sum > 520 && spread < 55;
        const isGreen = g > r + 10 && g > b + 2 && g > 50 && sum < 480;
        const isNavy = b > r + 26 && b > g + 12 && b > 55 && sum < 430;
        const isMauve = r > g + 7 && b > g + 3 && r > 62 && b > 55;
        const isTan = r > g + 12 && g > b + 14 && r > 82 && sum < 470;
        if (isPale) pale++;
        else if (isGreen) green++;
        else if (isNavy) navy++;
        else if (isMauve) mauve++;
        else if (isTan) tan++;
        if (sum < 290) dark++;
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
    background, pale, green, navy, mauve, tan, dark, mid,
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
    profile: join(proof, `chrome-crowd-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web crowd review build' })

  let data, pixels
  await waitFor(async () => {
    ({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
    pixels = await page.evaluate(measure(data))
    return pixels.background > pixels.sampled * 0.2 && pixels.pale > 300 && pixels.uniqueColors > 20
  }, '', { tries: 80, every: 500, what: 'crowd pixels after the Unity splash' })

  await sleep(700)
  ;({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
  pixels = await page.evaluate(measure(data))

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

  await writeFile(join(proof, 'crowd-web.png'), Buffer.from(data, 'base64'))
  await writeFile(join(proof, 'web-pixels.json'), JSON.stringify({
    ...pixels, motion: { changedCells, meanDelta: +meanDelta.toFixed(3), sampledCells: pixels.cellCounts.filter(Boolean).length },
  }, null, 2) + '\n')

  assert.ok(pixels.background > pixels.sampled * 0.3,
    `Review scene slate background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.pale > 900, `Too few pale soft-human head/hand pixels: ${pixels.pale}`)
  assert.ok(pixels.green > 500, `Commuter green wardrobe missing: ${pixels.green}`)
  assert.ok(pixels.navy > 350, `Formal navy wardrobe missing: ${pixels.navy}`)
  assert.ok(pixels.mauve > 200, `Skirt/blouse wardrobe missing: ${pixels.mauve}`)
  assert.ok(pixels.tan > 150, `Bag/strap tan pixels missing: ${pixels.tan}`)
  assert.ok(pixels.dark > 1200, `Dark shoes/accessories missing: ${pixels.dark}`)
  assert.ok(pixels.uniqueColors > 40, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(populated >= 9, `Crowd is missing from some bands: ${populated}/10 bands populated`)
  assert.ok(pixels.bandSpread > 1.1, `Crowd silhouettes are too uniform across bands (spread ${pixels.bandSpread.toFixed(2)})`)
  assert.ok(changedCells >= 2 || meanDelta > 0.05,
    `The Web crowd is not animating (${changedCells} changed cells, mean delta ${meanDelta.toFixed(2)})`)

  console.log(`Unity Web rendered the soft-human row and crowd (${pixels.pale} pale, ${pixels.green} green, ` +
    `${pixels.navy} navy, ${pixels.mauve} mauve, ${pixels.tan} tan, ${pixels.dark} dark, ` +
    `${populated}/10 bands, spread ${pixels.bandSpread.toFixed(2)}, ${pixels.uniqueColors} colours, ` +
    `motion ${changedCells} cells / ${meanDelta.toFixed(2)}). See crowd-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
