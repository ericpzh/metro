import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the wayside family. The scene lays the platform-edge
// run first, then the track kit and tunnel and the bridge on row A, with the
// housing/header/decal layers and the bridge sub-assemblies on rows B and C.
//
// The tunnel detail camera renders a bore-height view into a lower-left inset:
// the run camera sits above the corridor, where a horizontal tunnel would read
// as its roof only. The predicate requires the slate clear, pale screen glass,
// the white/blue printed header, steel and rail greys, warm concrete, and a
// tunnel inset that is actually filled by the shell's bore.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-wayside-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web wayside review build' })
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
    let background = 0, glass = 0, light = 0, white = 0, dark = 0, steel = 0, concrete = 0, blue = 0, other = 0;
    const colors = new Set();
    const band = { near: 0, far: 0, nearModel: 0, farModel: 0 };
    const split = Math.round(height * 0.55);
    // The tunnel detail camera renders into a 26% x 26% inset at the top-right.
    // Unity's rect origin is bottom-left; the screenshot's is top-left.
    const inset = {
      x0: Math.round(width * 0.72), y0: Math.round(height * 0.02),
      x1: Math.round(width * 0.98), y1: Math.round(height * 0.28),
    };
    let insetTotal = 0, insetModel = 0, insetDark = 0, insetConcrete = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sum = r + g + b;
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        // The review camera clears to the same slate blue as the other families.
        const isBackground = b > r + 22 && b > g + 10 && b > 68 && b < 138 && r > 30 && r < 92 && g > 50 && g < 112;
        const inInset = px >= inset.x0 && px < inset.x1 && py >= inset.y0 && py < inset.y1;
        if (py >= split) band.near++; else band.far++;
        if (inInset) insetTotal++;
        if (isBackground) { background++; continue; }
        if (py >= split) band.nearModel++; else band.farModel++;
        if (inInset) insetModel++;
        // Screen glazing: pale cyan over the slate clear.
        if (b >= g && b > r + 12 && g > r + 8 && b > 118 && sum > 300) glass++;
        // Printed header plates and the white housing/fascia.
        if (sum > 610 && spread < 42) { white++; light++; }
        else if (sum > 500 && spread < 30) light++;
        // Tunnel bore, black door frames and the dark rail web.
        if (sum < 175) { dark++; if (inInset) insetDark++; }
        const avg = sum / 3;
        if (sum >= 175 && spread <= 34 && avg >= 88 && avg <= 226 && sum <= 610) steel++;
        if (r >= g && g >= b && r - b >= 3 && spread <= 34 && avg >= 82 && avg <= 206) { concrete++; if (inInset) insetConcrete++; }
        if (b > r + 34 && b > g + 10 && b > 88) blue++;
        if (!(sum >= 175 && spread <= 34) && sum >= 175) other++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }
    return {
      sampled: width * height, width, height, background, glass, light, white, dark, steel, concrete, blue, other,
      uniqueColors: colors.size,
      nearModelFraction: band.nearModel / Math.max(1, band.near),
      farModelFraction: band.farModel / Math.max(1, band.far),
      insetTotal, insetModel, insetDark, insetConcrete,
      insetCoverage: insetModel / Math.max(1, insetTotal),
      insetConcreteFraction: insetConcrete / Math.max(1, insetTotal),
    };
    })()`)
    // Slate background, screen glazing and printed headers, steel and concrete,
    // a filled tunnel inset and model coverage on both scene rows. The splash is
    // near-black with no slate background, so it cannot satisfy this.
    return pixels.background > pixels.sampled * 0.15 && pixels.glass > 250 && pixels.white > 400 &&
      pixels.steel > 3000 && pixels.concrete > 2500 && pixels.blue > 60 &&
      pixels.uniqueColors > 50 && pixels.nearModelFraction > 0.02 && pixels.farModelFraction > 0.02 &&
      pixels.insetCoverage > 0.5 && pixels.insetConcreteFraction > 0.15
  }, '', { tries: 80, every: 500, what: 'wayside pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'wayside-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > pixels.sampled * 0.15, `Review scene background missing: ${pixels.background}/${pixels.sampled}`)
  assert.ok(pixels.glass > 250, `Screen glazing missing: ${pixels.glass} glass pixels`)
  assert.ok(pixels.white > 400, `Printed header/housing white missing: ${pixels.white}`)
  assert.ok(pixels.blue > 60, `Line-coloured header ink missing: ${pixels.blue}`)
  assert.ok(pixels.steel > 3000, `Rail/steel pixels missing: ${pixels.steel}`)
  assert.ok(pixels.concrete > 2500, `Concrete bed/bridge pixels missing: ${pixels.concrete}`)
  assert.ok(pixels.uniqueColors > 50, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(pixels.nearModelFraction > 0.02, `Near scene row is empty: ${(pixels.nearModelFraction * 100).toFixed(1)}% model pixels`)
  assert.ok(pixels.farModelFraction > 0.02, `Far scene row is empty: ${(pixels.farModelFraction * 100).toFixed(1)}% model pixels`)
  assert.ok(pixels.insetCoverage > 0.5, `Tunnel detail inset is not filled by the shell: ${(pixels.insetCoverage * 100).toFixed(1)}% coverage`)
  assert.ok(pixels.insetConcreteFraction > 0.15, `Tunnel inset shows no concrete shell: ${(pixels.insetConcreteFraction * 100).toFixed(1)}% concrete`)
  console.log(`Unity Web rendered the wayside rows (${pixels.glass} glass, ${pixels.white} white, ${pixels.blue} blue, ` +
    `${pixels.steel} steel, ${pixels.concrete} concrete, ${pixels.dark} dark; ` +
    `${(pixels.insetCoverage * 100).toFixed(1)}% tunnel inset, ${pixels.insetDark} inset dark; ` +
    `${(pixels.nearModelFraction * 100).toFixed(1)}% near / ${(pixels.farModelFraction * 100).toFixed(1)}% far model pixels; ` +
    `${pixels.uniqueColors} colours). See wayside-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}

