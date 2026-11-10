import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

const proof = resolve(process.argv[2])
const asset = process.argv[3] ?? 'bench'
const server = await serveDir(join(proof, 'web'), 0)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-${process.pid}`),
    debugPort: 9341,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web review build' })
  let data, colors
  await waitFor(async () => {
    ({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
    colors = await page.evaluate(`(async () => {
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
    const pixels = ctx.getImageData(
      (canvas.x + canvas.width / 4) * scale, (canvas.y + canvas.height / 4) * scale,
      canvas.width * scale / 2, canvas.height * scale / 2).data;
    let light = 0, blue = 0, pink = 0, red = 0, green = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (r > 145 && g > 145 && b > 145 && Math.abs(r - b) < 35) light++;
      if (r > 60 && b > 100 && b > r + 20 && b > g + 8 && g > r + 8) blue++;
      if (r > 180 && b > 150 && g < 60) pink++;
      if (r > 75 && r > g * 1.5 && r > b * 1.5) red++;
      if (g > 60 && g > r * 1.4 && g > b * 1.1) green++;
    }
    return { light, blue, pink, red, green };
    })()`)
    const rendered = asset === 'train' ? colors.red > 150 : asset === 'bin' ? colors.light > 4000 && colors.green > 20 : colors.blue > 500
    return colors.light > 500 && rendered
  }, '', { tries: 30, every: 350, what: `${asset} pixels after the Unity splash` }).finally(async () => {
    if (data) await writeFile(join(proof, `${asset}-web.png`), Buffer.from(data, 'base64'))
    if (colors) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(colors, null, 2) + '\n')
  })
  assert.equal(colors.pink, 0, 'Unexpected pink shader pixels')
  console.log(`Unity Web rendered the ${asset}. See ${asset}-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
