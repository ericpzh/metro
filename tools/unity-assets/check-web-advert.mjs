import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 广告牌 (billboard) family. The scene holds all ten
// lightboxes in one 7.2 m-spaced row on the slate clear colour. The predicate
// requires the slate background, the light steel edge frames and bright printed
// panels, several distinct poster hue families (the landscape, portrait and
// square campaigns are different photographs, not one flat colour), a meaningful
// mid-tone count and many quantised colours.
//
// The posters are the whole point of the piece: if the poster texture did not
// survive the GLB -> glTFast -> Web pipeline the panels would render as flat
// white or magenta — or, if the shot faced the housing, as one dark grey slab —
// so the poster pixel count, the hue families and the quantised-colour count all
// collapse and this check fails. A blank frame or Unity's splash produces no
// slate background at all and cannot satisfy the predicate either.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
// The browser profile lives under the temp directory, not in the proof folder:
// a Chrome that has just been killed keeps a handle on its profile for a moment,
// and `prove-model.ps1` deletes the proof folder as soon as this check returns.
// A locked profile there turned that removal into a spurious failure.
const profile = join(tmpdir(), `advert-chrome-${process.pid}`)
async function dropProfile() {
  rmSync(`${profile}.log`, { force: true })
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      return
    } catch {
      await sleep(500)
    }
  }
}
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile,
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web advert review build' })
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
    let background = 0, light = 0, mid = 0, nearBlack = 0, model = 0, poster = 0;
    const colors = new Set();
    // Poster hue families. The three campaigns are a blue/red landscape, a mixed
    // portrait and an orange square, so flat white panels or one grey slab cannot
    // light up three families.
    const hues = { red: 0, orange: 0, green: 0, cyan: 0, blue: 0 };
    const column = new Uint32Array(width);   // model pixels per screen column
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        // The review camera clears to the same slate blue as the other families.
        const isBackground = b > r + 25 && b > g + 10 && b > 60 && b < 130 && r > 30 && r < 80 && g > 50 && g < 110;
        if (isBackground) { background++; continue; }
        model++;
        column[px]++;
        if (sum > 500) light++;
        else if (sum < 150) nearBlack++;
        else mid++;
        // A printed panel is a photograph: coloured and not the steel frame's
        // near-neutral grey. Classify its dominant hue family.
        if (spread > 45 && sum > 150 && sum < 700) {
          poster++;
          const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
          let h;
          if (max === r) h = ((g - b) / delta) % 6;
          else if (max === g) h = (b - r) / delta + 2;
          else h = (r - g) / delta + 4;
          h *= 60;
          if (h < 0) h += 360;
          if (h < 30 || h >= 330) hues.red++;
          else if (h < 75) hues.orange++;
          else if (h < 165) hues.green++;
          else if (h < 270) hues.cyan++;
          else hues.blue++;
        }
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
    // The ten lightboxes stand on 7.2 m centres at one depth, so they project to
    // ten equal-width bands across the row. The row's own model-pixel extent
    // defines the bands; every band must hold its billboard.
    let left = 0, right = width - 1;
    while (left < width && column[left] < 2) left++;
    while (right > left && column[right] < 2) right--;
    const bands = Array.from({ length: 10 }, () => 0);
    const bandWidth = Math.max(1, (right - left + 1) / bands.length);
    for (let px = left; px <= right; px++) {
      const index = Math.min(bands.length - 1, Math.floor((px - left) / bandWidth));
      bands[index] += column[px];
    }
    const families = Object.entries(hues).filter(([, count]) => count > 0).map(([name]) => name);
    const distinctHues = Object.values(hues).filter(count => count > 30).length;
    const dominantShare = poster > 0 ? Math.max(...Object.values(hues)) / poster : 1;
    return {
      sampled: width * height, width, height,
      background, light, mid, nearBlack, model, poster, hues, families, distinctHues, dominantShare,
      uniqueColors: colors.size,
      row: { left, right, width: right - left + 1 },
      bands,
    };
    })()`)
    // Slate background, a lit row, at least three poster hue families that no
    // single hue dominates, a meaningful mid-tone count and many quantised
    // colours. The splash is near-black with no slate background, so it cannot
    // satisfy this; flat or blank panels have no coloured pixels at all.
    return pixels.background > pixels.sampled * 0.45 && pixels.model > 5000 &&
      pixels.light > 1500 && pixels.mid > 1500 && pixels.poster > 1500 &&
      pixels.distinctHues >= 3 && pixels.dominantShare < 0.9 && pixels.uniqueColors > 60 &&
      pixels.bands.every(count => count > 20)
  }, '', { tries: 80, every: 500, what: 'advert pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'advert-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > pixels.sampled * 0.45, `Review scene background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.model > 5000, `The billboard row is missing or too small: ${pixels.model} model pixels`)
  assert.ok(pixels.light > 1500, `Too few lit panel/frame pixels: ${pixels.light}`)
  assert.ok(pixels.mid > 1500, `Model mid-tones missing: ${pixels.mid}`)
  assert.ok(pixels.poster > 1500, `Poster pixels missing: ${pixels.poster}`)
  assert.ok(pixels.distinctHues >= 3,
    `Only ${pixels.distinctHues} poster hue families (${Object.entries(pixels.hues).map(([name, count]) => `${name} ${count}`).join(', ')}) — the panels look flat or blank`)
  assert.ok(pixels.dominantShare < 0.9,
    `One hue takes ${(pixels.dominantShare * 100).toFixed(0)}% of the posters — the campaigns read as a flat colour`)
  assert.ok(pixels.uniqueColors > 60, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(pixels.bands.every(count => count > 20),
    `A billboard is missing from the row: ${pixels.bands.join(',')}`)
  console.log(`Unity Web rendered the ten-billboard row (${pixels.light} light, ${pixels.mid} mid, ` +
    `${pixels.poster} poster, ${pixels.distinctHues} hue families ` +
    `(${Object.entries(pixels.hues).filter(([, count]) => count > 30).map(([name, count]) => `${name} ${count}`).join(', ')}), ` +
    `${pixels.uniqueColors} colours; bands ${pixels.bands.join(',')}). See advert-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
  await dropProfile()
}
