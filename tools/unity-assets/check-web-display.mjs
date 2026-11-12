import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 显示 (display) family. The scene shows all six pieces in
// a row: the two clocks, the two screens, the TVM and the vending machine. The
// predicate requires the slate review background (so the 3D scene replaced Unity's
// splash), the white clock face and the light printed cabinets, the dark bezels and
// hands, the blue ground of the lit departure boards, the warm ink of the LED digits,
// the line shield and the drinks, and a varied frame — a blank or splash-only capture
// fails every one of those.
const proof = resolve(process.argv[2])
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
    const w = canvas.width * 0.9 * scale;
    const h = canvas.height * 0.9 * scale;
    const data = ctx.getImageData(x, y, w, h).data;
    let slate = 0, lit = 0, ink = 0, mid = 0, boardBlue = 0, warmInk = 0, ledRed = 0, glassGreen = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      // The review camera clears to a slate blue (b - r about 41), while Unity's
      // built-in splash is neutral. Requiring this colour proves the 3D scene
      // replaced the splash, not just that the loading bar hid. The band on b - r
      // keeps the departure board's far brighter blue out of the background.
      const isSlate = b > r + 25 && b > g + 10 && b > 60 && r < 130 && b < r + 70;
      if (isSlate) slate++;
      // The departure board's own ground (#258cdd): a bright saturated blue, and the
      // one large flat colour the lit screens put in the frame. The vending machine's
      // blue banner falls in the same band; the slate background cannot.
      if (b > 150 && g > 100 && b > r + 60 && g > r + 40) boardBlue++;
      // Warm ink: the red LED digits of the digital clock, the sample board's line
      // shield and the orange/gate-red drinks behind the vending glass.
      if (r > g + 40 && r > b + 40 && r > 90) warmInk++;
      if (r > 150 && g < 90 && b < 90) ledRed++;
      if (g > r + 20 && g > b + 20 && g > 80) glassGreen++;
      // Tones over the model row only: the slate background must not satisfy the
      // pale-clock-face / dark-bevel / mid-tone predicates by itself.
      if (!isSlate) {
        if (sum > 500) lit++;
        else if (sum < 150) ink++;
        else mid++;
      }
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return { slate, lit, ink, mid, boardBlue, warmInk, ledRed, glassGreen, uniqueColors: colors.size, sampled: data.length / 4 };
    })()`)
    // The row is six pieces over the slate background: a lit clock face and the pale
    // printed cabinets, dark bezels and hands, the blue departure boards and the warm
    // ink of the LEDs/shield/drinks. A mixed frame with many quantised colours.
    return pixels.slate > 15000 && pixels.lit > 3000 && pixels.ink > 300 && pixels.mid > 800 &&
      pixels.boardBlue > 300 && pixels.warmInk > 60 && pixels.uniqueColors > 40
  }, '', { tries: 60, every: 500, what: 'display pixels after the Unity splash' })
    .finally(async () => {
      if (data) await writeFile(join(proof, 'display-web.png'), Buffer.from(data, 'base64'))
      if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
    })
  console.log('Display pixels ' + JSON.stringify(pixels))
  assert.ok(pixels.slate > 15000, `Review scene background missing: ${pixels.slate}`)
  assert.ok(pixels.lit > 3000, `The clock face and printed cabinets are not visible: ${pixels.lit}`)
  assert.ok(pixels.ink > 300, `Dark bezels, hands and screens not visible: ${pixels.ink}`)
  assert.ok(pixels.mid > 800, `Model mid-tones missing: ${pixels.mid}`)
  assert.ok(pixels.boardBlue > 300, `Lit departure boards not visible: ${pixels.boardBlue}`)
  assert.ok(pixels.warmInk > 60, `Warm printed ink (LED digits, line shield, drinks) not visible: ${pixels.warmInk}`)
  assert.ok(pixels.uniqueColors > 40, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(
    `Unity Web rendered the display row (${pixels.slate} slate, ${pixels.lit} lit, ${pixels.ink} ink, ` +
    `${pixels.mid} mid, ${pixels.boardBlue} board, ${pixels.warmInk} warm, ${pixels.ledRed} LED, ` +
    `${pixels.glassGreen} green, ${pixels.uniqueColors} colours). See display-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
