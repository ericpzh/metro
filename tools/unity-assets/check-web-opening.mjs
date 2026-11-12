import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review of the 开口 (opening) family. The scene lines up all ten
// models — six doors, two gates, two cubicles — against a slate clear colour, so
// the predicate can require each material family at once: pale steel/wood door
// frames, warm timber leaves, navy fare-gate heads, the glass leaves of the two
// glazed doors and the pale green-grey cubicle panels. A blank frame, a splash
// frame or a uniform clear colour fails every one of those.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-${process.pid}`),
    debugPort: 9300 + (process.pid % 400),
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web opening review build' })
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
    let light = 0, mid = 0, dark = 0, background = 0, wood = 0, navy = 0, glass = 0, partition = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sum = r + g + b;
      // The slate review clear colour (b - r about 41): a splash or a black frame
      // cannot satisfy it, so it proves the 3D scene is the thing on screen.
      if (b > r + 25 && b > g + 10 && b > 60 && r < 130) background++;
      // Pale steel frames (binSteel/steel) and the white cubicle ceramics.
      if (sum > 500) light++;
      else if (sum < 150) dark++;
      else mid++;
      // Warm timber: the walnut frame, the pale leaf and the dark pull.
      if (r > g + 12 && g > b + 6 && r > 70) wood++;
      // The 闸机's dark navy head and reader (0x28356a): blue-dominant, dark and
      // much less green than it is blue. The modern gate's line-blue belt
      // (0x1b6fd6) is far brighter, so the sum bound separates the two.
      if (b > r + 30 && b > g + 20 && sum < 340 && r < 110) navy++;
      // The glazed leaves: the glass palette colour renders as a pale cyan pane
      // (about 153,196,212) that is clearly greener and bluer than the neutral
      // steel frames, and far less saturated than the gate's line blue.
      if (b > r + 30 && g > r + 25 && b - g >= 5 && b - g < 40 && sum > 480) glass++;
      // The 厕所隔间 shell (0xc8d9d6). Facing the key light its painted face clips
      // to white like the steel frames, so its own tint survives on the shaded
      // side and back: pale green-grey with green >= blue, unlike any neutral.
      if (g > r + 4 && b > r + 2 && g >= b - 1 && sum > 180 && sum < 900) partition++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    return { light, mid, dark, background, wood, navy, glass, partition, uniqueColors: colors.size, sampled: data.length / 4 };
    })()`)
    // Ten models over the slate background: pale frames, warm timber, a navy gate
    // head, glass leaves and cubicle panels, with many quantised colours. A blank
    // or splash-only frame satisfies none of the material predicates. Thresholds
    // are about a quarter of a measured real capture (33k light, 11k wood, 8.5k
    // glass, 2.4k partition, 145 navy) so they are presence tests, not noise.
    return pixels.background > 8000 && pixels.light > 2000 && pixels.partition > 400 &&
      pixels.wood > 800 && pixels.navy > 40 && pixels.glass > 800 && pixels.uniqueColors > 30
  }, '', { tries: 60, every: 500, what: 'opening pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'opening-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })
  assert.ok(pixels.background > 8000, `Review scene background missing: ${pixels.background}`)
  assert.ok(pixels.light > 2000, `Too few pale steel/wood frame pixels: ${pixels.light}`)
  assert.ok(pixels.partition > 400, `Cubicle partitions not visible: ${pixels.partition}`)
  assert.ok(pixels.wood > 800, `Warm timber door leaves not visible: ${pixels.wood}`)
  assert.ok(pixels.navy > 40, `Fare-gate navy head not visible: ${pixels.navy}`)
  assert.ok(pixels.glass > 800, `Glass door leaves not visible: ${pixels.glass}`)
  assert.ok(pixels.uniqueColors > 30, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
  assert.ok(pixels.mid > 200, `Model mid-tones missing: ${pixels.mid}`)
  console.log(`Unity Web rendered the opening row (${pixels.light} light, ${pixels.wood} wood, ${pixels.navy} navy, ${pixels.glass} glass, ${pixels.partition} partition, ${pixels.dark} dark, ${pixels.mid} mid, ${pixels.background} background, ${pixels.uniqueColors} colours). See opening-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
