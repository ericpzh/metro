import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 站名 (calligraphy) family. The scene holds all twelve
// prefabs in one row on a pale 搪瓷板 wall over a slate clear colour: six hands in
// two axes, each a transparent ink plate whose strokes are the only thing the model
// adds — the wall is the paper.
//
// The predicate reads the picture the way the model is built, so a blank frame, a
// uniform clear or Unity's neutral splash cannot pass:
//
//   * the slate scene clear colour;
//   * the pale wall band, which is the only pale region in the frame;
//   * dark ink-stroke pixels *inside* that band, counted per panel — the panel's
//     screen position is projected from the review camera the scene saves, so all
//     twelve plates must be inked. A plate whose ink failed to blend is an empty
//     wall, and a frame with fewer than twelve populated panels is not the family;
//   * many quantised colours, so a flat clear cannot pass.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
const Panels = 12
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
  })()`, { what: 'Unity Web script review build' })
  // The template renders the scene into a 960 x 600 window, and a 61.6 m row of
  // 5 m panels across 960 px leaves each inscription about 13 px tall — thin brush
  // strokes that a 2560 px plate minified 39x would average into the wall. Render
  // the same scene at twice the device pixel ratio so the ink survives the row's
  // scale; the sampling below follows `devicePixelRatio`.
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 900, deviceScaleFactor: 2, mobile: false,
  })
  await new Promise((done) => setTimeout(done, 2000))
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
    const paleRow = new Int32Array(height);
    let background = 0, pale = 0, mid = 0;
    const colors = new Set();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
        // The review camera clears to a slate blue, while Unity's splash is neutral.
        if (b > r + 25 && b > g + 10 && b > 60 && r < 130) { background++; continue; }
        // The pale 搪瓷板 wall the inscriptions are painted on.
        if (r > 190 && g > 190 && b > 185) { pale++; paleRow[y]++; continue; }
        if (sum > 480) mid++;
      }
    }
    // The wall band: the rows the pale backdrop actually covers. Everything the ink
    // draws lives inside it, so the scan below cannot mistake the slate clear for a
    // stroke.
    let wallTop = -1, wallBottom = -1;
    for (let y = 0; y < height; y++) {
      if (paleRow[y] > width * 0.4) {
        if (wallTop < 0) wallTop = y;
        wallBottom = y;
      }
    }
    // Where each panel lands: the review scene's own camera (position, target and
    // 55 degree field of view) projected onto the canvas, so the twelve bands are
    // the twelve plates and not a guess at equal spacing.
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n] };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const camPos = [0, 2.1, 43.5], target = [0, 1.6, -0.5], pitch = 5.6;
    const panelCentre = [0, 1.7, -0.46];
    const fwd = norm(sub(target, camPos));
    const xcam = norm(cross([0, 1, 0], fwd));
    const focal = (height / 2) / Math.tan((55 / 2) * Math.PI / 180);
    const centres = [];
    let depth = 0, pitchPixels = 0;
    for (let i = 0; i < ${Panels}; i++) {
      const p = sub([ (i - (${Panels} - 1) / 2) * pitch, panelCentre[1], panelCentre[2] ], camPos);
      depth = dot(p, fwd);
      centres.push(width / 2 + (dot(p, xcam) / depth) * focal);
      if (i === 1) pitchPixels = pitch * focal / depth;
    }
    const half = pitchPixels * 0.45;
    const bands = new Array(${Panels}).fill(0);
    let ink = 0, darkInk = 0, bandPixels = 0;
    if (wallTop >= 0) {
      for (let i = 0; i < ${Panels}; i++) {
        const from = Math.max(0, Math.round(centres[i] - half));
        const to = Math.min(width - 1, Math.round(centres[i] + half));
        bandPixels = Math.max(bandPixels, (to - from + 1) * (wallBottom - wallTop + 1));
        for (let y = wallTop; y <= wallBottom; y++) {
          for (let x = from; x <= to; x++) {
            const i2 = (y * width + x) * 4;
            const r = data[i2], g = data[i2 + 1], b = data[i2 + 2];
            const sum = r + g + b;
            // Ink, not wall. The pale 搪瓷板 sums about 685, so 540 is a fifth
            // darker than the wall and 300 is a stroke's own near-black core: the
            // threshold catches the antialiased body of a 1-2 px brush line without
            // ever reading the wall itself.
            if (sum >= 540) continue;
            ink++;
            if (sum < 300) darkInk++;
            bands[i]++;
          }
        }
      }
    }
    return {
      sampled: width * height, width, height, scale,
      background, pale, mid, ink, darkInk,
      wallTop, wallBottom, wallRows: wallBottom - wallTop + 1,
      pitchPixels, halfBand: half, bandPixels,
      bands, populated: bands.filter(count => count >= 20).length,
      uniqueColors: colors.size,
    };
    })()`)
    // The slate clear, the pale wall band, ink strokes in all twelve panels, and a
    // varied frame: a splash, a blank clear or an unlinked ink plate cannot reach it.
    return pixels.background > pixels.sampled * 0.10 && pixels.pale > pixels.sampled * 0.04 &&
      pixels.wallRows > 50 && pixels.ink > pixels.sampled * 0.0006 && pixels.darkInk > 250 &&
      pixels.populated === Panels && pixels.uniqueColors > 24
  }, '', { tries: 90, every: 500, what: 'script pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'script-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > pixels.sampled * 0.10,
    `Review scene background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.pale > pixels.sampled * 0.04,
    `Pale wall band missing behind the row: ${pixels.pale}/${pixels.sampled}`)
  assert.ok(pixels.wallRows > 50, `Pale wall band is too thin: ${pixels.wallRows} rows`)
  assert.ok(pixels.ink > pixels.sampled * 0.0006, `Too few ink-stroke pixels: ${pixels.ink}/${pixels.sampled}`)
  assert.ok(pixels.darkInk > 250, `The ink strokes are not dark enough to read as brushwork: ${pixels.darkInk}`)
  assert.equal(pixels.populated, Panels, `Only ${pixels.populated}/${Panels} panels carry ink: ${pixels.bands.join(',')}`)
  assert.ok(pixels.uniqueColors > 24, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(`Unity Web rendered the calligraphy row (${pixels.ink} ink, ${pixels.darkInk} dark ink, ` +
    `${pixels.bands.join('/')} per panel, ${pixels.pale} pale wall, ${pixels.wallRows} wall rows, ` +
    `${pixels.mid} mid, ${pixels.background} background, ${pixels.uniqueColors} colours). ` +
    'See script-web.png and web-pixels.json.')
} finally {
  await page?.close()
  server.close()
}
