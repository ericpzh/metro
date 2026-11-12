import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the formations family. The scene holds:
//   * ten short two-car evidence consists — every stock class (A/B/C/L/D)
//     in both third-rail and overhead wire;
//   * A's eight-car overhead consist;
//   * Zoo's exact Line 5: Type L, six cars, third rail, scale 0.98;
// all on parallel tracks with the near door bank open and a platform-edge lip
// and door-centre markers beside it.
//
// The predicate requires the slate yard, the white carbody, the five livery
// hues, the glazed window band, opened door leaves/doorways, running gear,
// roof detail, the platform slab and its bright edge lip, plus a heavily
// quantised frame. A splash or an empty frame cannot satisfy it.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9800 + (process.pid % 200)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-formations-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { tries: 300, every: 500, what: 'Unity Web formations review build' })
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
    const at = (x, y) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    let background = 0, body = 0, light = 0, mid = 0, dark = 0, nearBlack = 0;
    let saturated = 0, yellow = 0, red = 0, green = 0, greenLoose = 0, blue = 0, window = 0;
    let enclosedDark = 0, runningGear = 0, roofDetail = 0, platform = 0, edge = 0, other = 0;
    const colors = new Set();
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        const isBackground = b > r + 25 && b > g + 12 && b > 70 && b < 130 && r > 35 && r < 80 && g > 55 && g < 105;
        if (isBackground) { background++; continue; }
        // Painted aluminium body: near-white and desaturated.
        if (sum > 560 && spread < 45) body++;
        if (sum > 480) light++;
        else if (sum < 150) nearBlack++;
        else mid++;
        // Livery paint is saturated; A yellow, B/D blue, C green, L red.
        const isLivery = spread > 60 && sum > 100 && sum < 720;
        if (isLivery) saturated++;
        if (isLivery && r > 150 && g > 110 && b < 120) yellow++;
        else if (isLivery && r > 90 && g < r * 0.55 && b < r * 0.6) red++;
        else if (isLivery && g > 60 && g > r * 1.25 && g > b * 1.1) green++;
        else if (isLivery && b > 80 && b > r * 1.35 && b > g * 1.08) blue++;
        else if (isLivery) other++;
        // Type C's #01824a is dark; at review distance its thin band blends
        // with the body and loses saturation. Count the surviving green cast
        // separately so the evidence still proves the class is on the track.
        if (g > r + 10 && g > b + 6 && g > 45 && spread > 14 && sum < 720) greenLoose++;
        // Glazing: pale blue-cyan, not the slate clear and not the livery.
        if (!isLivery && b > r + 14 && b >= g && sum > 150 && sum < 730) window++;
        // A dark opening ringed above and below by body paint is a doorway.
        if (sum < 200) {
          dark++;
          const above = at(px, Math.max(0, py - 12));
          const below = at(px, Math.min(height - 1, py + 12));
          const aboveLight = above[0] + above[1] + above[2] > 560;
          const belowLight = below[0] + below[1] + below[2] > 560;
          if (aboveLight && belowLight) enclosedDark++;
          else if (aboveLight) runningGear++;
        }
        if (sum < 430 && spread < 55) {
          const below = at(px, Math.min(height - 1, py + 9));
          if (below[0] + below[1] + below[2] > 560) roofDetail++;
        }
        // Concrete platform slab: mid grey, desaturated, distinct from slate.
        if (sum > 260 && sum < 640 && spread < 32) platform++;
        // The platform lip and door markers wear the body aluminium.
        if (sum > 690 && spread < 28) edge++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
    return {
      sampled: width * height, width, height,
      background, body, light, mid, dark, nearBlack,
      saturated, yellow, red, green, greenLoose, blue, window, enclosedDark, runningGear, roofDetail,
      platform, edge, other,
      uniqueColors: colors.size,
      backgroundFraction: background / (width * height),
    };
    })()`)
    return pixels.backgroundFraction > 0.12 && pixels.body > 40000 && pixels.light > 50000 &&
      pixels.dark > 1000 && pixels.saturated > 1400 &&
      pixels.yellow > 150 && pixels.red > 250 && pixels.greenLoose > 120 && pixels.blue > 400 &&
      pixels.window > 8000 && pixels.enclosedDark > 300 && pixels.runningGear > 300 &&
      pixels.roofDetail > 200 && pixels.platform > 5000 && pixels.edge > 1000 &&
      pixels.uniqueColors > 150
  }, '', { tries: 200, every: 750, what: 'formations pixels after the Unity splash' }).finally(async () => {
    if (data) {
      await writeFile(join(proof, 'formations-web.png'), Buffer.from(data, 'base64'))
      if (process.env.METRO_FORMATIONS_SNAPSHOT) await writeFile(resolve(process.env.METRO_FORMATIONS_SNAPSHOT), Buffer.from(data, 'base64'))
    }
    if (pixels) {
      await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
      if (process.env.METRO_FORMATIONS_PIXELS) await writeFile(resolve(process.env.METRO_FORMATIONS_PIXELS), JSON.stringify(pixels, null, 2) + '\n')
    }
  })
  assert.ok(pixels.backgroundFraction > 0.12, `Slate yard background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.body > 40000, `Too few white carbody pixels: ${pixels.body}`)
  assert.ok(pixels.light > 50000, `The consists are not lit: ${pixels.light} light pixels`)
  assert.ok(pixels.dark > 1000, `Too few dark running-gear/opening pixels: ${pixels.dark}`)
  assert.ok(pixels.saturated > 1400, `Too few saturated livery pixels: ${pixels.saturated}`)
  assert.ok(pixels.yellow > 150, `Type A yellow livery missing: ${pixels.yellow}`)
  assert.ok(pixels.red > 250, `Type L/Zoo red livery missing: ${pixels.red}`)
  assert.ok(pixels.greenLoose > 120, `Type C green livery missing: ${pixels.greenLoose} (strict ${pixels.green})`)
  assert.ok(pixels.blue > 400, `Type B/D blue livery missing: ${pixels.blue}`)
  assert.ok(pixels.window > 8000, `Window band missing: ${pixels.window} glazed pixels`)
  assert.ok(pixels.enclosedDark > 300, `No opened door leaves/doorways: ${pixels.enclosedDark}`)
  assert.ok(pixels.runningGear > 300, `Bogies/underframe missing: ${pixels.runningGear}`)
  assert.ok(pixels.roofDetail > 200, `Roof detail missing: ${pixels.roofDetail}`)
  assert.ok(pixels.platform > 5000, `Platform slab missing: ${pixels.platform}`)
  assert.ok(pixels.edge > 1000, `Platform-edge lip missing: ${pixels.edge}`)
  assert.ok(pixels.uniqueColors > 150, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(`Unity Web rendered the formations yard (${pixels.body} body, ${pixels.window} glazed, ` +
    `${pixels.saturated} livery: ${pixels.yellow} yellow, ${pixels.red} red, ${pixels.greenLoose} green, ${pixels.blue} blue; ` +
    `${pixels.enclosedDark} doorway, ${pixels.runningGear} running gear, ${pixels.roofDetail} roof, ` +
    `${pixels.platform} platform, ${pixels.edge} edge; ${pixels.uniqueColors} colours; ` +
    `background ${(pixels.backgroundFraction * 100).toFixed(1)}%). See formations-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
