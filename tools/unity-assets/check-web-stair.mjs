import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 楼梯 (stair) family. The scene shows all nine
// variants in one ~80 m row, each turned a quarter so its run lies along the row.
// The predicate requires the slate review background, light concrete treads and
// risers, dark steel stringers and handrails, and the tinted glass balustrade
// infill, plus a varied frame: a blank, sky-only or splash-only capture fails.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9700 + (process.pid % 300)
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
    const x = (canvas.x + canvas.width * 0.02) * scale;
    const y = (canvas.y + canvas.height * 0.02) * scale;
    const w = canvas.width * 0.96 * scale;
    const h = canvas.height * 0.96 * scale;
    const data = ctx.getImageData(x, y, w, h).data;
    let light = 0, dark = 0, mid = 0, background = 0, glass = 0, glassLoose = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      const slate = b > r + 25 && b > g + 10 && b > 60 && r < 130;
      // The review camera clears to a slate blue (b - r about 37), while Unity's
      // built-in splash is neutral. This also proves the 3D scene replaced it.
      if (slate) { background++; continue; }
      // The glass balustrade is the one blue-tinted surface: tinted panes blended
      // over the slate read brighter and bluer than both the clear colour and any
      // opaque steel or concrete. The glassLoose counter records the same test
      // one step wider so a borderline capture can be diagnosed, not guessed at.
      if (b > r + 28 && b > 105 && sum > 290) glass++;
      if (b > r + 18 && b > 90 && sum > 250) glassLoose++;
      // Dark steel stringers and rubber handrails render as *neutral* dark grey;
      // the slate clear colour is distinctly blue (b - r about 37). Testing the
      // neutral dark band therefore proves the steel frame rather than counting
      // the background.
      const neutralDark = b - r < 30 && sum < 330;
      if (neutralDark) dark++;
      if (sum > 450) light++;
      else if (!neutralDark) mid++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return { light, dark, mid, model: light + dark + mid, background, glass, glassLoose, uniqueColors: colors.size, sampled: data.length / 4 };
    })()`)
    // Nine staircases over the slate review background: light tread/riser bands,
    // dark stringers/handrails, blue-tinted glass, and a mixed frame with many
    // quantised colours (never a uniform, blank or splash-only frame).
    return pixels.background > 250000 && pixels.light > 5000 && pixels.dark > 1200 &&
      pixels.glass > 600 && pixels.model > 6000 && pixels.uniqueColors > 48
  }, '', { tries: 60, every: 500, what: 'stair pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'stair-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > 250000, `Slate review background missing: ${pixels.background}`)
  assert.ok(pixels.light > 5000, `Too few light tread/rail pixels: ${pixels.light}`)
  assert.ok(pixels.dark > 1200, `Too few dark stringer/handrail pixels: ${pixels.dark}`)
  assert.ok(pixels.glass > 600, `Glass balustrade not visible: ${pixels.glass}`)
  assert.ok(pixels.model > 6000, `Too few model pixels: ${pixels.model} (blank or splash-only frame?)`)
  assert.ok(pixels.uniqueColors > 48, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  console.log(`Unity Web rendered the stair row (${pixels.model} model px: ${pixels.light} light, ${pixels.dark} dark, ${pixels.glass} glass/${pixels.glassLoose} loose; ${pixels.background} background, ${pixels.uniqueColors} colours). See stair-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
