// Pixel check for the hanger family review build.
//
//   node tools/unity-assets/check-web-hanger.mjs .preview/unity/hanger-<stamp>
//
// The review scene places the post variant on the left and the roof variant on
// the right, so the check looks for steel-grey pixels in each half: that proves
// both bars (and both mounts) rendered, rather than only that the Unity splash
// cleared. The screenshot is taken twice, half a second apart, so a splash-only
// frame cannot satisfy the predicate once and then fade to the real scene.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

const proof = resolve(process.argv[2] ?? '.')
const server = await serveDir(join(proof, 'web'), 0)
// Several agents run Chrome at once here; offset the debugging port by pid.
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

  const sample = async () => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    const colors = await page.evaluate(`(async () => {
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
      const sx = Math.round(canvas.x * scale);
      const sy = Math.round(canvas.y * scale);
      const sw = Math.floor(canvas.width * scale);
      const sh = Math.floor(canvas.height * scale);
      const pixels = ctx.getImageData(sx, sy, sw, sh).data;
      const mid = sx + sw / 2;
      let steel = 0, leftSteel = 0, rightSteel = 0, light = 0, pink = 0, background = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const high = Math.max(r, g, b), low = Math.min(r, g, b);
        // Satin stainless reads as a desaturated grey clearly above the
        // background; the background itself is a saturated navy.
        if (high > 90 && high - low < 28) {
          steel++;
          const x = sx + ((i / 4) % sw);
          if (x < mid) leftSteel++; else rightSteel++;
        }
        if (r > 145 && g > 145 && b > 145 && Math.abs(r - b) < 35) light++;
        if (r > 180 && b > 150 && g < 60) pink++;
        // The review camera clears to a dark navy, not the near-black Unity
        // splash: requiring this colour is what rejects a splash-only frame.
        if (high < 120 && b > g && g > r) background++;
      }
      return { steel, leftSteel, rightSteel, light, pink, background, width: image.width, height: image.height,
        canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height }, scale };
    })()`)
    return { data, colors }
  }

  const both = (colors) => colors.steel >= 3000 && colors.leftSteel >= 500 && colors.rightSteel >= 500
    && colors.background >= 100000
  let captured
  try {
    // The Unity splash draws a grey logo on near-black for a moment after the
    // loading bar goes away. Waiting for the review camera's navy background as
    // well as the steel pixels skips those frames: a splash-only frame cannot
    // satisfy the predicate.
    await waitFor(async () => {
      captured = await sample()
      return both(captured.colors) && captured.colors.pink === 0
    }, '', { tries: 90, every: 400, what: 'hanger steel pixels over the review background' })

    // A splash or a transient frame fades: the real scene must still satisfy the
    // check half a second later. Keep the second frame as the evidence image.
    await new Promise(done => setTimeout(done, 500))
    const confirmed = await sample()
    captured = confirmed
    assert.ok(both(confirmed.colors), `hanger steel pixels did not persist: ${JSON.stringify(confirmed.colors)}`)
    assert.equal(confirmed.colors.pink, 0, 'Unexpected magenta (missing shader) pixels')
  } finally {
    if (captured) {
      await writeFile(join(proof, 'hanger-web.png'), Buffer.from(captured.data, 'base64'))
      await writeFile(join(proof, 'web-pixels.json'), JSON.stringify({ ...captured.colors, stableFrames: 2, debugPort }, null, 2) + '\n')
    }
  }
  console.log(`Unity Web rendered both hanger variants (${captured.colors.leftSteel} left / ${captured.colors.rightSteel} right steel pixels). See hanger-web.png and web-pixels.json.`)
} finally {
  await page?.close()
  server.close()
}
