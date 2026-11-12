import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the rolling-stock family. The scene holds all five
// three-car consists (A/B/C/L/D) on parallel tracks, near-side doors open, under
// a raised slate-clearing three-quarter camera.
//
// The predicate requires the slate yard background, the white carbody, the four
// distinct livery hues the five classes wear (yellow A, blue B, green C, red L,
// royal-blue D), the glazed window band, opened door leaves/doorways and the
// dark running gear under the body, plus a heavily quantised frame. The Unity
// splash is near-black and cannot satisfy the slate, body or livery counts; a
// frame with only the sky fails the body/livery/window/door metrics.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-rolling-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { tries: 240, every: 500, what: 'Unity Web rolling review build' })
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
    let saturated = 0, yellow = 0, red = 0, green = 0, blue = 0, window = 0;
    let enclosedDark = 0, runningGear = 0, roofDetail = 0, other = 0;
    const colors = new Set();
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        // The review camera clears to the same slate blue as the other families.
        const isBackground = b > r + 25 && b > g + 12 && b > 70 && b < 130 && r > 35 && r < 80 && g > 55 && g < 105;
        if (isBackground) { background++; continue; }
        // Painted aluminium body: near-white and desaturated.
        if (sum > 560 && spread < 45) body++;
        if (sum > 480) light++;
        else if (sum < 150) nearBlack++;
        else mid++;
        // Livery paint is saturated; the four classes wear yellow/blue/green/red
        // (D's royal blue reads as a second blue). Exclude glass, which is pale.
        const isLivery = spread > 60 && sum > 100 && sum < 720;
        if (isLivery) saturated++;
        if (isLivery && r > 150 && g > 110 && b < 120) yellow++;
        else if (isLivery && r > 90 && g < r * 0.55 && b < r * 0.6) red++;
        else if (isLivery && g > 60 && g > r * 1.25 && g > b * 1.1) green++;
        else if (isLivery && b > 80 && b > r * 1.35 && b > g * 1.08) blue++;
        else if (isLivery) other++;
        // The glazed window band: pale blue-cyan, not the slate clear and not the
        // saturated livery paint.
        if (!isLivery && b > r + 14 && b >= g && sum > 150 && sum < 730) window++;
        // A dark opening still ringed by body paint above and below is a doorway
        // (the near bank is posed open through OpenPlus); a dark band with body
        // above and background below is running gear.
        if (sum < 200) {
          dark++;
          const above = at(px, Math.max(0, py - 12));
          const below = at(px, Math.min(height - 1, py + 12));
          const aboveLight = above[0] + above[1] + above[2] > 560;
          const belowLight = below[0] + below[1] + below[2] > 560;
          if (aboveLight && belowLight) enclosedDark++;
          else if (aboveLight) runningGear++;
        }
        // Roof equipment sits over the body: a non-body band just above the white.
        if (sum < 430 && spread < 55) {
          const below = at(px, Math.min(height - 1, py + 9));
          if (below[0] + below[1] + below[2] > 560) roofDetail++;
        }
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
    return {
      sampled: width * height, width, height,
      background, body, light, mid, dark, nearBlack,
      saturated, yellow, red, green, blue, window, enclosedDark, runningGear, roofDetail, other,
      uniqueColors: colors.size,
      backgroundFraction: background / (width * height),
    };
    })()`)
    // A splash or a blank frame has no slate yard, no white body, no livery
    // bands and no window band, so it cannot satisfy this.
    return pixels.backgroundFraction > 0.2 && pixels.body > 20000 && pixels.light > 25000 &&
      pixels.dark > 1200 && pixels.saturated > 4000 &&
      pixels.yellow > 250 && pixels.red > 300 && pixels.green > 400 && pixels.blue > 600 &&
      pixels.window > 3000 && pixels.enclosedDark > 400 && pixels.runningGear > 400 &&
      pixels.roofDetail > 200 && pixels.uniqueColors > 120
  }, '', { tries: 160, every: 750, what: 'rolling pixels after the Unity splash' }).finally(async () => {
    if (data) {
      await writeFile(join(proof, 'rolling-web.png'), Buffer.from(data, 'base64'))
      if (process.env.METRO_ROLLING_SNAPSHOT) await writeFile(resolve(process.env.METRO_ROLLING_SNAPSHOT), Buffer.from(data, 'base64'))
    }
    if (pixels) {
      await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
      if (process.env.METRO_ROLLING_PIXELS) await writeFile(resolve(process.env.METRO_ROLLING_PIXELS), JSON.stringify(pixels, null, 2) + '\n')
    }
  })
  assert.ok(pixels.backgroundFraction > 0.2, `Slate yard background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.body > 20000, `Too few white carbody pixels: ${pixels.body}`)
  assert.ok(pixels.light > 25000, `The consists are not lit: ${pixels.light} light pixels`)
  assert.ok(pixels.dark > 1200, `Too few dark running-gear/opening pixels: ${pixels.dark}`)
  assert.ok(pixels.saturated > 4000, `Too few saturated livery pixels: ${pixels.saturated}`)
  assert.ok(pixels.yellow > 250, `Type A yellow livery missing: ${pixels.yellow}`)
  assert.ok(pixels.red > 300, `Type L red livery missing: ${pixels.red}`)
  assert.ok(pixels.green > 400, `Type C green livery missing: ${pixels.green}`)
  assert.ok(pixels.blue > 600, `Type B/D blue livery missing: ${pixels.blue}`)
  assert.ok(pixels.window > 3000, `Window band missing: ${pixels.window} glazed pixels`)
  assert.ok(pixels.enclosedDark > 400, `No opened door leaves/doorways: ${pixels.enclosedDark}`)
  assert.ok(pixels.runningGear > 400, `Bogies/underframe missing: ${pixels.runningGear}`)
  assert.ok(pixels.roofDetail > 200, `Roof detail missing: ${pixels.roofDetail}`)
  assert.ok(pixels.uniqueColors > 120, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(`Unity Web rendered the five-consist rolling yard (${pixels.body} body, ${pixels.window} glazed, ` +
    `${pixels.saturated} livery: ${pixels.yellow} yellow, ${pixels.red} red, ${pixels.green} green, ${pixels.blue} blue; ` +
    `${pixels.enclosedDark} doorway, ${pixels.runningGear} running gear, ${pixels.roofDetail} roof; ` +
    `${pixels.uniqueColors} colours; background ${(pixels.backgroundFraction * 100).toFixed(1)}%). See rolling-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
