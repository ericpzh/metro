import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 货架 (shelf) family. The scene holds all ten
// stocked fixtures in one row on a slate clear colour. The predicate requires
// the light retail frames, a dark-framed gondola, saturated stock across the
// greens/oranges/reds/blues and stock in essentially every shelf band.
//
// The stock is exactly what the exporter's InstancedMesh expansion produces. If
// that expansion were skipped, every `shelfGoods_*` mesh would sit at the row
// origin and the shelves would render bare: the saturated-colour counts and the
// per-band stock presence would both collapse, so the check fails.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-shelf-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web shelf review build' })
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
    let background = 0, light = 0, mid = 0, nearBlack = 0, dark = 0, green = 0, orange = 0, red = 0, blue = 0, saturated = 0, other = 0;
    const colors = new Set();
    // The ten shelves sit on 1.3 m centres, so ten equal bands across the row
    // each contain one fixture. Bands are computed after the row crops out to
    // 12%..88% of the canvas: the camera frames the row symmetrically.
    const bands = Array.from({ length: 10 }, () => ({ model: 0, stock: 0, dark: 0, luma: 0 }));
    const left = Math.round(width * 0.12), right = Math.round(width * 0.88);
    const bandWidth = Math.max(1, (right - left) / bands.length);
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        // The review camera clears to the same slate blue as the other families.
        const isBackground = b > r + 25 && b > g + 12 && b > 70 && b < 130 && r > 35 && r < 80 && g > 55 && g < 105;
        if (isBackground) { background++; continue; }
        if (sum > 480) light++;
        else if (sum < 150) nearBlack++;
        else mid++;
        // Stock tints: the palette's bottles, packages, produce, bread and
        // ice-cream boxes are the only saturated surfaces in the row. Classify by
        // the dominant channel: red product facings sit well below half their red
        // in green, while orange/bread facings sit above it.
        const isStock = spread > 55 && sum > 90 && sum < 690;
        if (isStock) saturated++;
        const max = Math.max(r, g, b);
        if (isStock && max === r && g < r * 0.62 && b < r * 0.62) red++;
        else if (isStock && max === g && r < g * 0.85 && b < g * 0.95) green++;
        else if (isStock && max === b && r < b * 0.8 && g < b * 0.9) blue++;
        else if (isStock && max === r && g >= r * 0.5 && g < r * 0.8 && b < r * 0.6) orange++;
        else other++;
        // Dark neutral frame pixels (darkSteel/rubber), excluding the slate clear.
        if (sum < 340 && spread < 50) dark++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
        const bandIndex = Math.floor((px - left) / bandWidth);
        if (bandIndex >= 0 && bandIndex < bands.length) {
          const band = bands[bandIndex];
          band.model++;
          band.luma += (r + g + b) / 3;
          if (isStock) band.stock++;
          if (sum < 340 && spread < 50) band.dark++;
        }
      }
    }
    // Per-band mean brightness of the model pixels: the dark-framed tall gondola
    // (band 0) must read darker than the white tall shelf beside it (band 1).
    const bandLuma = bands.map(band => band.model ? Math.round(band.luma / band.model) : 0);
    return {
      sampled: width * height, width, height,
      background, light, mid, nearBlack, dark, green, orange, red, blue, saturated, other,
      uniqueColors: colors.size,
      bands: bands.map((band, index) => ({ index, model: band.model, stock: band.stock, dark: band.dark, luma: bandLuma[index] })),
    };
    })()`)
    // Slate background, light frames, a dark-framed gondola, saturated stock on
    // every shelf band and a varied frame. The splash is near-black and has no
    // slate background, so it cannot satisfy this.
    const stockBands = pixels.bands.filter(band => band.stock > 120).length
    return pixels.background > pixels.sampled * 0.45 && pixels.light > 3000 && pixels.dark > 1200 &&
      pixels.saturated > 4000 && pixels.green > 400 && pixels.orange > 300 &&
      pixels.red > 300 && pixels.blue > 250 && pixels.uniqueColors > 60 &&
      pixels.bands.every(band => band.model > 200) && stockBands >= 9 &&
      pixels.bands[0].luma + 9 < pixels.bands[1].luma
  }, '', { tries: 80, every: 500, what: 'shelf pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'shelf-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  const stockBands = pixels.bands.filter(band => band.stock > 120).length
  assert.ok(pixels.background > pixels.sampled * 0.45, `Review scene background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.light > 3000, `Too few light shelf-frame pixels: ${pixels.light}`)
  assert.ok(pixels.dark > 1200, `No dark-framed shelf visible: ${pixels.dark} dark pixels`)
  assert.ok(pixels.bands[0].luma + 9 < pixels.bands[1].luma,
    `Dark gondola frame did not read darker than the white shelf: ${pixels.bands[0].luma} vs ${pixels.bands[1].luma}`)
  assert.ok(pixels.saturated > 4000, `Too few saturated stock pixels: ${pixels.saturated}`)
  assert.ok(pixels.green > 400, `Green stock missing: ${pixels.green} (was the InstancedMesh expansion skipped?)`)
  assert.ok(pixels.orange > 300, `Orange stock missing: ${pixels.orange}`)
  assert.ok(pixels.red > 300, `Red stock missing: ${pixels.red}`)
  assert.ok(pixels.blue > 250, `Blue stock missing: ${pixels.blue}`)
  assert.ok(stockBands >= 9, `Stock is missing from some shelves: ${stockBands}/10 bands have stock`)
  assert.ok(pixels.bands.every(band => band.model > 200), `A shelf is missing from the row: ${pixels.bands.map(band => band.model).join(',')}`)
  assert.ok(pixels.uniqueColors > 60, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(`Unity Web rendered the ten-shelf row (${pixels.light} light, ${pixels.dark} dark, ${pixels.saturated} saturated: ` +
    `${pixels.green} green, ${pixels.orange} orange, ${pixels.red} red, ${pixels.blue} blue; ${stockBands}/10 stocked bands; ` +
    `${pixels.uniqueColors} colours). See shelf-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
