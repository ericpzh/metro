import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the retail family. The scene holds all ten shop
// fixtures in one row on 4.5 m centres (the café backbar family runs to 3.96 m)
// over the same slate clear colour as the other families.
//
// The row spans 45 m, so the browser window is 1920 x 1080: at the review
// camera's 44 degree lens that is ~33 px per metre, enough to see the stock
// chips but not to read labels. The predicate therefore does not sample fixed
// bands; it finds the ten model runs by contiguous columns and checks each one.
//
// The stock is exactly what the exporter's InstancedMesh expansion produces. If
// that expansion were skipped, every `shelfGoods_*` mesh would sit at the piece
// origin as a plain white box and the coloured stock would vanish: the
// non-timber chroma count and the quantised-colour count per fixture both
// collapse. Measured on the same ten GLBs rendered offline, stocked vs stockless
// is 632 vs 0 chroma pixels and 87..259 vs 16..52 colours per fixture, so the
// thresholds below separate them by more than 2x.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-retail-${process.pid}`),
    debugPort,
    windowSize: '1920,1080',
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web retail review build' })
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
    let background = 0, light = 0, mid = 0, nearBlack = 0, dark = 0, saturated = 0, stock = 0, other = 0;
    const colors = new Set();
    const columnModel = new Int32Array(width), columnStock = new Int32Array(width);
    const isSlate = (r, g, b) => b > r + 25 && b > g + 12 && b > 70 && b < 130 && r > 35 && r < 80 && g > 55 && g < 105;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        // The review camera clears to the same slate blue as the other families.
        if (isSlate(r, g, b)) { background++; continue; }
        columnModel[px]++;
        if (sum > 480) light++;
        else if (sum < 150) nearBlack++;
        else mid++;
        if (sum < 340 && spread < 50) dark++;
        // Strongly chromatic pixels are either the timber frame/wickwork or
        // merchandise. The palette's woods sit at 20..40 degrees of hue, so
        // everything outside that band is stock: red produce, green and yellow
        // fruit, teal bottles, navy garments and the pale package facings.
        const strong = spread > 60 && sum > 120 && sum < 700;
        let hue = 0;
        if (strong) {
          const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
          if (max === r) hue = 60 * (((g - b) / delta + 6) % 6);
          else if (max === g) hue = 60 * ((b - r) / delta + 2);
          else hue = 60 * ((r - g) / delta + 4);
        }
        const timber = strong && hue >= 15 && hue <= 48;
        if (strong) saturated++;
        if (strong && !timber) { stock++; columnStock[px]++; }
        else other++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
    // The ten fixtures sit on 4.5 m centres with at least 2 m between them, so
    // contiguous runs of model columns are exactly one fixture each. Gaps under
    // 20 px are antialiased silhouette edges, not aisles.
    const runs = [];
    let run = null;
    for (let px = 0; px < width; px++) {
      if (columnModel[px] > 6) {
        if (!run) { run = { x0: px, x1: px, model: 0, stock: 0, colors: new Set() }; runs.push(run); }
        run.x1 = px;
      } else if (run && px - run.x1 > 20) run = null;
    }
    for (const entry of runs) for (let px = entry.x0; px <= entry.x1; px++) {
      entry.model += columnModel[px];
      entry.stock += columnStock[px];
    }
    // Quantised colours inside each fixture: the stock chips are what lift a
    // piece from a dozen flat frame tones to hundreds of tones.
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (isSlate(r, g, b)) continue;
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        for (const entry of runs) if (px >= entry.x0 && px <= entry.x1) { entry.colors.add(key); break; }
      }
    }
    return {
      sampled: width * height, width, height,
      background, light, mid, nearBlack, dark, saturated, stock, other,
      uniqueColors: colors.size,
      runs: runs.filter(entry => entry.model > 200).map(entry => ({
        x0: entry.x0, x1: entry.x1, model: entry.model, stock: entry.stock, colors: entry.colors.size,
      })),
    };
    })()`)
    // Only the splash has to be gone here: the slate clear colour is the proof
    // that the 3D scene is drawing. Everything the scene must contain is
    // asserted below, so a missing fixture or a lost instancing bake fails with
    // a message that names the measurement.
    return pixels.background > pixels.sampled * 0.3 && (pixels.runs ?? []).length > 0
  }, '', { tries: 80, every: 500, what: 'retail pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'retail-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  const runs = pixels.runs ?? []
  const stocked = runs.filter(entry => entry.stock >= 2).length
  const varied = runs.filter(entry => entry.colors >= 60).length
  assert.ok(pixels.background > pixels.sampled * 0.45, `Review scene background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.light > 2500, `Too few light shelf-frame pixels: ${pixels.light}`)
  assert.ok(pixels.dark > 1500, `No dark-framed fixture visible: ${pixels.dark} dark pixels`)
  assert.ok(pixels.stock > 250, `Non-timber merchandise missing: ${pixels.stock} chroma pixels (was the InstancedMesh expansion skipped?)`)
  assert.equal(runs.length, 10, `Expected ten fixtures in the row, found ${runs.length}: ${runs.map(entry => entry.model).join(',')}`)
  assert.ok(runs.every(entry => entry.model > 250), `A fixture is missing from the row: ${runs.map(entry => entry.model).join(',')}`)
  assert.ok(stocked >= 7, `Merchandise is missing from some fixtures: ${stocked}/10 runs have stock`)
  assert.ok(varied >= 8, `Some fixtures render as bare frames (${varied}/10 runs have 60+ colours)`)
  assert.ok(pixels.saturated > 1200, `Too few saturated wood/stock pixels: ${pixels.saturated}`)
  assert.ok(pixels.uniqueColors > 100, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(`Unity Web rendered the ten-fixture retail row (${pixels.light} light, ${pixels.dark} dark, ` +
    `${pixels.saturated} saturated, ${pixels.stock} merchandise, ${pixels.uniqueColors} colours; ` +
    `${stocked}/10 stocked runs, ${varied}/10 varied runs). See retail-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
