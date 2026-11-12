import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the concourse family. The scene shows all ten assets in
// a row; the predicate requires the slate clear colour, the white counter and
// ceramic mass, the red 灭火器 cabinets with their dark plinths/handles, the
// 导向柱's printed plates (yellow logo collar and blue train-icon plate) and a
// varied, shaded frame. A blank, uniform or splash-only capture fails.
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
    let light = 0, dark = 0, subjectDark = 0, mid = 0, background = 0, subject = 0, subjectMid = 0;
    let red = 0, yellow = 0, blue = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      // The review camera clears to a slate blue (b - r about 42) while Unity's
      // built-in splash is neutral. Requiring this colour proves the 3D scene
      // replaced the splash, not just that the loading bar hid.
      const isBackground = b > r + 25 && b > g + 10 && b > 60 && r < 130;
      if (isBackground) background++; else subject++;
      // The white 收银台 counters and the porcelain basin/urinal are the light mass.
      if (sum > 500) light++;
      // Darker than the slate clear colour: the 灭火器 plinths, door frames,
      // handles and the 导向柱's dark steel base. Counted off the subject only,
      // because the clear colour itself can sit on either side of the threshold.
      else if (sum < 190) { dark++; if (!isBackground) subjectDark++; }
      else { mid++; if (!isBackground) subjectMid++; }
      // exitRed (0xc22f28) cabinets: the three 灭火器 and the 导向柱 column.
      if (r > 90 && r > g + 40 && r > b + 40) red++;
      // The 导向柱's printed plates: the yellow 地铁 logo collar and the blue
      // train-icon plate are unlit canvas maps, so they keep their authored hue.
      if (r > 140 && g > 110 && b < 120 && r - b > 60 && g - b > 40) yellow++;
      if (b > r + 70 && b > 110 && g < 170) blue++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return { light, dark, subjectDark, mid, background, subject, subjectMid, red, yellow, blue, uniqueColors: colors.size, sampled: data.length / 4 };
    })()`)
    // Ten pieces over the slate review background: a real subject mass with
    // shaded mid-tones, bright counters/ceramic, dark fittings, red cabinets and
    // the guidepost's printed plates, and many quantised colours (never a
    // uniform or splash-only frame).
    return pixels.background > 20000 && pixels.light > 2000 && pixels.subjectDark > 250 &&
      pixels.subject > 12000 && pixels.subjectMid > 1500 && pixels.red > 250 &&
      pixels.yellow > 20 && pixels.blue > 10 && pixels.uniqueColors > 32
  }, '', { tries: 60, every: 500, what: 'concourse pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'concourse-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > 20000, `Review scene background missing: ${pixels.background}`)
  assert.ok(pixels.light > 2000, `Too few white counter/ceramic pixels: ${pixels.light}`)
  assert.ok(pixels.subjectDark > 250, `Dark cabinet fittings not visible: ${pixels.subjectDark}`)
  assert.ok(pixels.subject > 12000, `Too little model coverage: ${pixels.subject}`)
  assert.ok(pixels.subjectMid > 1500, `Model mid-tones missing: ${pixels.subjectMid}`)
  assert.ok(pixels.red > 250, `Red extinguisher cabinets not visible: ${pixels.red}`)
  assert.ok(pixels.yellow > 20, `Guidepost yellow plate colour not visible: ${pixels.yellow}`)
  assert.ok(pixels.blue > 10, `Guidepost blue train-icon plate not visible: ${pixels.blue}`)
  assert.ok(pixels.uniqueColors > 32, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(
    `Unity Web rendered the concourse row (${pixels.light} light, ${pixels.subjectDark} dark, ${pixels.subjectMid} subject mid, ` +
      `${pixels.red} red, ${pixels.yellow} yellow, ${pixels.blue} blue, ${pixels.background} background, ` +
      `${pixels.uniqueColors} colours). See concourse-web.png and web-pixels.json.`,
  )
} finally {
  await page?.close()
  server.close()
}

