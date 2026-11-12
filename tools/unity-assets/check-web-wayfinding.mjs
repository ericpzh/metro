import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the wayfinding family. The scene holds both rows: the
// eight 3 m doorway entrance panels in front and the eight 4 m 导向柱 guideposts
// behind them, one per city. The predicate requires the slate review background,
// each city's doorway header band, that city's guidepost surface above it, white
// and dark post pixels and a varied frame, so a blank, uniform or splash-only
// capture fails.
//
// Both rows stand parallel to the image plane on the same 4 m pitch, so a city's
// doorway band marks its column; the check finds that column from the band's own
// pixels and then looks for the guidepost surface directly above it. The horizon
// between the rows is found from the frame's own row histogram, so nothing here
// depends on the viewport size or the exact camera framing.
const proof = resolve(process.argv[2])

/**
 * The eight cities in CITY_STYLE_IDS order. `band` is the doorway header's printed
 * entrance colour (an unlit canvas, so it renders at its authored value) and
 * `guide` is the surface family the 导向柱 shows from the pavement — the posts are
 * lit and shaded, so they are matched by colour family, not by exact pixel.
 */
const CITIES = [
  { city: 'guangzhou', band: '#c22f28', guide: 'red' },
  { city: 'shenzhen', band: '#101b2b', guide: 'grey-green' },
  { city: 'shanghai', band: '#353b35', guide: 'light' },
  { city: 'beijing', band: '#073563', guide: 'blue' },
  { city: 'chengdu', band: '#343433', guide: 'cyan' },
  { city: 'chongqing', band: '#f2f0dd', guide: 'green' },
  { city: 'wuhan', band: '#183b70', guide: 'dark' },
  { city: 'nanjing', band: '#14213f', guide: 'light' },
]
/** Per-channel tolerance for a printed (unlit) band colour. */
const BAND_TOLERANCE = 14

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
    const cities = ${JSON.stringify(CITIES)};
    const bandTol = ${BAND_TOLERANCE};
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
    const w = Math.round(canvas.width * 0.9 * scale);
    const h = Math.round(canvas.height * 0.9 * scale);
    const data = ctx.getImageData(x, y, w, h).data;
    const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const bandColours = cities.map(entry => parse(entry.band));
    // The review camera clears to the slate blue (55, 75, 95 on the WebGL
    // framebuffer); a tight match keeps the dark navy header bands and columns
    // out of the background, and still fails Unity's neutral splash.
    const isBackground = (r, g, b) =>
      Math.abs(r - 55) <= 10 && Math.abs(g - 75) <= 10 && Math.abs(b - 95) <= 10;
    const BUCKETS = 24;
    const rowBuckets = new Array(BUCKETS).fill(0);
    let background = 0, light = 0, dark = 0, mid = 0, ink = 0;
    const colors = new Set();
    // Pass 1: the clearance, the frame statistics and the frame's row histogram.
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      if (isBackground(r, g, b)) {
        background++;
        continue;
      }
      const pixel = i / 4;
      rowBuckets[Math.min(BUCKETS - 1, Math.floor((pixel / w) / h * BUCKETS))]++;
      if (sum > 520) light++;
      else if (sum < 150) dark++;
      else mid++;
      if (sum > 690) ink++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    // The waist-high doorway row is the widest single band of colour in the
    // frame; everything above it belongs to the 4 m posts behind. Finding the
    // horizon here keeps the two rows' checks apart whatever the framing.
    let peak = 0;
    for (let bucket = 1; bucket < BUCKETS; bucket++) if (rowBuckets[bucket] > rowBuckets[peak]) peak = bucket;
    const split = Math.round(peak * h / BUCKETS);
    // Pass 2: each city's printed doorway band. Nearest-colour assignment keeps
    // the Shanghai/Chengdu and Beijing/Wuhan pairs apart: those header colours
    // are only a few units from each other.
    const bandCount = cities.map(() => 0);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isBackground(r, g, b)) continue;
      const pixel = i / 4;
      if (Math.floor(pixel / w) < split) continue;
      let best = -1, bestDistance = Infinity;
      for (let band = 0; band < bandColours.length; band++) {
        const [er, eg, eb] = bandColours[band];
        const distance = Math.max(Math.abs(r - er), Math.abs(g - eg), Math.abs(b - eb));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = band;
        }
      }
      if (best < 0 || bestDistance > bandTol) continue;
      bandCount[best]++;
    }
    // Pass 3: the guidepost surface above each band, inside that column's window.
    const matches = (family, r, g, b, sum) => {
      switch (family) {
        // Guangzhou: the red extruded 导向柱 column (#c22f28) and its head.
        case 'red': return r > 130 && r > g + 60 && r > b + 60;
        // Shenzhen: the pale grey-green pylon and its green crown ring.
        case 'grey-green': return (g >= r && g >= b - 6 && sum > 330 && sum < 660) || (g > 70 && g > r * 1.25 && g > b * 1.1);
        // Shanghai / Nanjing: the white 灯箱 / white pylon.
        case 'light': return sum > 600;
        // Beijing: the #143a5c blue column (lit, so only a blue cast survives).
        case 'blue': return b > r + 12 && b >= g - 6 && sum > 220;
        // Chengdu: the bright #00a0df logo collar.
        case 'cyan': return g > 100 && b > g + 20 && b > r + 80;
        // Chongqing: the #008547 curved CRT box.
        case 'green': return g > 60 && g > r * 1.15 && g > b * 1.05;
        // Wuhan: the dark #41494c shaft (neutral and far darker than the slate).
        case 'dark': return sum < 330 && Math.abs(r - g) < 20 && Math.abs(g - b) < 24;
        default: return false;
      }
    };
    // Pass 2: the 4 m posts' own columns, from the vertical projection of the
    // upper row. The two rows stand at different depths, so their screen pitches
    // differ; locating the posts themselves keeps each city's column exact.
    const BUCKET = 4;
    const projection = new Array(Math.ceil(w / BUCKET)).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isBackground(r, g, b)) continue;
      const pixel = i / 4;
      if (Math.floor(pixel / w) >= split) continue;
      projection[Math.min(projection.length - 1, Math.floor((pixel % w) / BUCKET))]++;
    }
    // Runs of occupied buckets, allowing a one-bucket gap so a thin post cannot
    // break its own projection in two.
    const runs = [];
    let start = -1;
    for (let bucket = 0; bucket < projection.length; bucket++) {
      if (projection[bucket] > 2) {
        if (start < 0) start = bucket;
        continue;
      }
      if (start < 0) continue;
      if (bucket + 1 < projection.length && projection[bucket + 1] > 2) continue;
      runs.push([start * BUCKET, bucket * BUCKET]);
      start = -1;
    }
    if (start >= 0) runs.push([start * BUCKET, projection.length * BUCKET]);
    // Pass 3: the guidepost colour inside its own column and the printed doorway
    // band of every city (nearest-colour assignment keeps the Shanghai/Chengdu
    // and Beijing/Wuhan pairs apart: those header colours are only a few units
    // from each other).
    const guides = cities.map(() => 0);
    const columnPixels = cities.map(() => 0);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isBackground(r, g, b)) continue;
      const pixel = i / 4;
      const px = pixel % w;
      if (Math.floor(pixel / w) >= split) {
        let best = -1, bestDistance = Infinity;
        for (let band = 0; band < bandColours.length; band++) {
          const [er, eg, eb] = bandColours[band];
          const distance = Math.max(Math.abs(r - er), Math.abs(g - eg), Math.abs(b - eb));
          if (distance < bestDistance) {
            bestDistance = distance;
            best = band;
          }
        }
        if (best >= 0 && bestDistance <= bandTol) bandCount[best]++;
        continue;
      }
      let column = -1;
      for (let run = 0; run < runs.length; run++)
        if (px >= runs[run][0] - 4 && px < runs[run][1] + 4) {
          column = run;
          break;
        }
      if (column < 0 || column >= cities.length) continue;
      columnPixels[column]++;
      if (matches(cities[column].guide, r, g, b, r + g + b)) guides[column]++;
    }
    return {
      width: w, height: h, sampled: data.length / 4, split, rowBuckets, runs,
      background, light, dark, mid, ink,
      uniqueColors: colors.size,
      bands: cities.map((entry, index) => ({ city: entry.city, pixels: bandCount[index] })),
      guides: cities.map((entry, index) => ({ city: entry.city, family: entry.guide, pixels: guides[index] })),
      columns: columnPixels,
    };
    })()`)
    // Eight post columns, every city's doorway band, every city's guidepost
    // surface in its own column, both rows present everywhere, several colour
    // families and a genuinely mixed frame; a uniform or splash-only capture
    // cannot satisfy these at once.
    return pixels.runs.length === CITIES.length &&
      pixels.background > 60000 && pixels.uniqueColors > 48 &&
      pixels.light > 3000 && pixels.dark > 800 && pixels.mid > 3000 &&
      pixels.bands.every(entry => entry.pixels >= 8) &&
      pixels.guides.every(entry => entry.pixels >= 30) &&
      pixels.columns.every(count => count >= 150)
  }, '', { tries: 90, every: 500, what: 'wayfinding pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'wayfinding-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.equal(pixels.runs.length, CITIES.length,
    `Expected ${CITIES.length} guidepost columns, found ${pixels.runs.length}: ${JSON.stringify(pixels.runs)}`)
  assert.ok(pixels.background > 60000, `Review scene background missing: ${pixels.background}`)
  assert.ok(pixels.uniqueColors > 48, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(pixels.light > 3000, `Too few white/steel post pixels: ${pixels.light}`)
  assert.ok(pixels.dark > 800, `Dark guidepost bodies not visible: ${pixels.dark}`)
  assert.ok(pixels.mid > 3000, `Model mid-tones missing: ${pixels.mid}`)
  const missingBands = pixels.bands.filter(entry => entry.pixels < 8)
  assert.equal(missingBands.length, 0,
    `Doorway header bands missing: ${missingBands.map(entry => entry.city).join(', ')}`)
  const missingGuides = pixels.guides.filter(entry => entry.pixels < 30)
  assert.equal(missingGuides.length, 0,
    `Guidepost city surfaces missing: ${missingGuides.map(entry => `${entry.city} (${entry.family}) ${entry.pixels}px`).join(', ')}`)
  assert.ok(pixels.columns.every(count => count >= 150),
    `Not every city column rendered: ${pixels.columns.join(', ')}`)
  console.log(`Unity Web rendered the wayfinding rows (` +
    `${pixels.bands.map(entry => `${entry.city} band ${entry.pixels}`).join(', ')}; ` +
    `${pixels.guides.map(entry => `${entry.city} ${entry.family} ${entry.pixels}`).join(', ')}; ` +
    `${pixels.light} light, ${pixels.dark} dark, ${pixels.ink} ink, ${pixels.background} background, ` +
    `${pixels.uniqueColors} colours). See wayfinding-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
