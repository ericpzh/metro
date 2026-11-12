// Headless Web check for the `light` family review scene.
//
//   node tools/unity-assets/check-web-light.mjs .preview/unity/light-<stamp>
//
// Waits for the Unity Web player to replace its splash with a drawn canvas, then
// screenshots the canvas and counts pixels. The review scene holds both ceiling
// lights on one camera, so the check looks for a large warm-white area on BOTH
// halves of the frame (the two emissive diffusers) plus the steel housing rim —
// not just a non-background frame that could be a stray splash remnant.
//
// The built-in "Made with Unity" splash draws into the same canvas on a near-black
// background and is itself mostly white, so a light-pixel count alone accepts it.
// The scene's camera clears to a mid blue-grey, so `dark` (near-black) pixels are
// the splash discriminator: the check waits until almost none are left.
//
// `debugPort` is process-specific because several agents run Chrome at once.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-light-${process.pid}`),
    debugPort: 9300 + (process.pid % 400),
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web light review build' })
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
    const scale = image.width / window.innerWidth;
    const x0 = Math.max(0, Math.round(canvas.x * scale));
    const y0 = Math.max(0, Math.round(canvas.y * scale));
    const width = Math.round(canvas.width * scale);
    const height = Math.round(canvas.height * scale);
    const pixels = ctx.getImageData(x0, y0, width, height).data;
    let light = 0, leftLight = 0, rightLight = 0, steel = 0, pink = 0, background = 0, dark = 0, total = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        total++;
        // The emissive diffuser face. The palette emission (#fff4d8 at 1.5) plus
        // the review key light clips the face to near-white; the steel housing rim
        // stays mid-tone. Requiring white-hot face pixels (not merely "brighter
        // than the background") keeps the Unity splash's white logo and a
        // half-faded first frame from satisfying the check.
        if (r > 240 && g > 235 && b > 225) {
          light++;
          if (px < width / 2) leftLight++;
          else rightLight++;
        }
        // The lit steel rim: neutral/cool mid-tone, above the flat background.
        else if (r > 60 && r < 238 && b >= r && b > 85 && Math.abs(r - b) < 70) steel++;
        // Shader-error magenta (URP missing shader) must never appear.
        if (r > 180 && b > 150 && g < 60) pink++;
        // The splash's near-black canvas; the review scene's clear colour is not.
        if (r < 40 && g < 40 && b < 40) dark++;
        // The scene's flat background colour is (0.22, 0.30, 0.38) -> ~(56, 76, 97).
        if (Math.abs(r - 56) < 8 && Math.abs(g - 76) < 8 && Math.abs(b - 97) < 8) background++;
      }
    }
    return { light, leftLight, rightLight, steel, pink, dark, background, total,
      rendered: total - background };
    })()`)
    return colors.light > 1500 && colors.leftLight > 200 && colors.rightLight > 200 &&
      colors.steel > 500 && colors.pink === 0 && colors.dark < colors.total * 0.02
  }, '', { tries: 40, every: 350, what: 'light pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'light-web.png'), Buffer.from(data, 'base64'))
    if (colors) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(colors, null, 2) + '\n')
  })
  assert.equal(colors.pink, 0, 'Unexpected magenta shader pixels')
  assert.ok(colors.dark < colors.total * 0.02,
    `${colors.dark} near-black pixels: this is the Unity splash, not the review scene`)
  assert.ok(colors.light > 1500, `Only ${colors.light} white-hot diffuser pixels: the luminous faces did not read bright`)
  assert.ok(colors.leftLight > 200 && colors.rightLight > 200,
    `Both diffusers must render: left ${colors.leftLight}, right ${colors.rightLight}`)
  assert.ok(colors.steel > 500, `Only ${colors.steel} steel pixels: the housings may not have rendered`)
  assert.ok(colors.rendered > 2500, `Only ${colors.rendered} non-background pixels: this looks like a splash-only frame`)
  console.log(`Unity Web rendered both ceiling lights. See light-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
