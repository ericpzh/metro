import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the 出入口 (exit) family. The scene holds all eleven
// wrapper prefabs in one 8.6 m-pitch row on a slate clear colour: three covered
// head-houses, four 地面 doorway headers, three open railing exits and the 虚拟
// marker. The predicate requires the slate background, the red canopy/frame
// pixels, the blue-green glass tint, the deep red printed sign plates, the
// doorway header bands and the marker's yellow collar, plus many quantised
// colours. Each of the eleven row slots is checked on its own, so a missing
// model, a blank frame or a splash-only capture fails.
//
// The row is framed symmetrically by a camera at (0, 8, -62) looking at the row
// plane; slot i sits at x = (i - 5) * 8.6 m, so the band edges are those world
// x values projected through the camera's 60-degree vertical field of view.
const proof = resolve(process.argv[2])
const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-exit-${process.pid}`),
    debugPort,
    // More device pixels per metre of row: the doorway headers are 0.78 m tall
    // and the 虚拟 marker 0.16 m wide, so the extra resolution matters.
    windowSize: '1600,1000',
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web exit review build' })

  const sample = async () => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    const pixels = await page.evaluate(`(async () => {
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
      const data = ctx.getImageData(sx, sy, sw, sh).data;
      const total = data.length / 4;

      // The camera clears to one constant colour, so the modal pixel of a real
      // frame is the clear colour. A splash-only frame's mode is neutral black
      // and fails the slate test below.
      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let modeKey = 0, modeCount = -1;
      for (const [key, count] of counts) if (count > modeCount) { modeCount = count; modeKey = key; }
      const mr = modeKey >> 16, mg = (modeKey >> 8) & 255, mb = modeKey & 255;
      const modeSum = mr + mg + mb;

      // The eleven row slots: x = (i - 5) * 8.6 m at the row plane, projected
      // through the camera's vertical half-angle (30 degrees) and the canvas
      // aspect. Band edges are the midpoints between neighbouring slots.
      const aspect = sw / sh;
      const halfVertical = 62 * Math.tan(Math.PI / 6);
      const halfHorizontal = halfVertical * aspect;
      const slot = (x) => 0.5 + x / (2 * halfHorizontal);
      const bandLeft = slot(-47.3) * sw;
      const bandRight = slot(47.3) * sw;
      const bandWidth = (bandRight - bandLeft) / 11;
      const bands = Array.from({ length: 11 }, () => ({ model: 0, glass: 0, red: 0, sign: 0, yellow: 0, white: 0 }));

      let background = 0, glass = 0, red = 0, sign = 0, yellow = 0, white = 0, dark = 0;
      const quantised = new Set();
      for (let py = 0; py < sh; py++) {
        for (let px = 0; px < sw; px++) {
          const i = (py * sw + px) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const sum = r + g + b;
          const high = Math.max(r, g, b), low = Math.min(r, g, b);
          quantised.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
          const bandIndex = Math.floor((px - bandLeft) / bandWidth);
          const band = bandIndex >= 0 && bandIndex < 11 ? bands[bandIndex] : null;
          if (r === mr && g === mg && b === mb) { background++; continue; }
          if (band) band.model++;
          // The glass sides and the open exits' railing panes are the only
          // surfaces that tint the slate brighter with green above red: the
          // transparent panes blend their pale blue-green into the backdrop.
          if (b > r + 12 && g > r + 4 && sum > modeSum + 15 && high < 245) { glass++; if (band) band.glass++; }
          // The red canopy frame, the open exits' printed board and the 虚拟
          // column: saturated red well clear of the slate.
          if (r > g + 35 && r > b + 35 && r > 70) { red++; if (band) band.red++; }
          // The printed 出入口 header plates are unlit (MeshBasicMaterial) and
          // keep the authored deep red, #c22f28, that the frame's shading only
          // rarely matches: this is the lit sign ink.
          if (r >= 150 && g <= 95 && b <= 95 && r - g >= 80) { sign++; if (band) band.sign++; }
          // The 导向柱 marker's warning-yellow logo collar.
          if (r > 140 && g > 100 && b < 90 && r > b + 60 && g > b + 50) { yellow++; if (band) band.yellow++; }
          // Printed white ink: the header lettering, the marker's plates and the
          // lit under-canopy strips.
          if (sum > 600 && high - low < 60) { white++; if (band) band.white++; }
          if (sum < 150) dark++;
        }
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([key, count]) => ({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], count }));
      return {
        mode: [mr, mg, mb], modeCount, background, glass, red, sign, yellow, white, dark,
        uniqueColors: quantised.size, top, sampled: total, bands,
        canvas: { width: sw, height: sh, scale },
      };
    })()`)
    return { data, pixels }
  }

  // Slot order: 0-2 covered head-houses, 3-6 doorway headers, 7-9 open exits,
  // 10 the 虚拟 marker. Plausible frame: the clear colour is the family's slate
  // blue, the row itself supplies the canopy reds, the glass tint, the printed
  // sign ink and the marker's yellow, and every slot carries its model. The row
  // is 95 m long, so most of the frame is the clear colour: a blank frame would
  // be 100% background and fail the upper bound and the per-slot checks.
  const enough = (p) => p.mode[2] > p.mode[0] + 20 && p.mode[2] >= 60
    && p.background > p.sampled * 0.45 && p.background < p.sampled * 0.995
    && p.red > 300 && p.glass > 600 && p.sign > 40 && p.white > 80 && p.yellow > 4
    && p.uniqueColors > 40
    && p.bands.every((band) => band.model > 40)
    && p.bands.slice(0, 3).every((band) => band.red > 15 && band.glass > 80)
    && p.bands.slice(7, 10).every((band) => band.red > 8 && band.glass > 20)
    && p.bands.slice(3, 7).every((band) => band.red > 6)
    && p.bands[10].yellow >= 2 && p.bands[10].model > 40
  let captured
  try {
    await waitFor(async () => {
      captured = await sample()
      return enough(captured.pixels)
    }, '', { tries: 90, every: 400, what: 'the eleven exit models over the review background' })

    // A splash or transient frame fades: the real scene must still satisfy the
    // check half a second later. Keep the second frame as the evidence image.
    await new Promise(done => setTimeout(done, 500))
    captured = await sample()
    const pixels = captured.pixels
    assert.ok(enough(pixels), `Exit row did not persist: ${JSON.stringify({ ...pixels, top: undefined })}`)
    assert.ok(pixels.background > pixels.sampled * 0.45,
      `Review scene background missing: ${pixels.background} of ${pixels.sampled}`)
    assert.ok(pixels.red > 300, `Too few red canopy/frame pixels: ${pixels.red}`)
    assert.ok(pixels.glass > 600, `Too few blue-green glass pixels: ${pixels.glass}`)
    assert.ok(pixels.sign > 40, `Printed sign plates missing (${pixels.sign} deep-red pixels)`)
    assert.ok(pixels.white > 80, `Sign lettering missing (${pixels.white} white pixels)`)
    assert.ok(pixels.yellow > 4, `The 虚拟 marker's yellow collar is missing: ${pixels.yellow}`)
    assert.ok(pixels.uniqueColors > 40, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
    assert.ok(pixels.bands.every((band) => band.model > 40),
      `A row slot is empty: ${pixels.bands.map((band) => band.model).join(',')}`)
    assert.ok(pixels.bands.slice(0, 3).every((band) => band.red > 15 && band.glass > 80),
      `A covered head-house is missing its red frame or glass: ${pixels.bands.slice(0, 3).map((band) => `${band.red}/${band.glass}`).join(' ')}`)
    assert.ok(pixels.bands.slice(7, 10).every((band) => band.red > 8 && band.glass > 20),
      `An open exit is missing its rail glass or printed board: ${pixels.bands.slice(7, 10).map((band) => `${band.red}/${band.glass}`).join(' ')}`)
    assert.ok(pixels.bands.slice(3, 7).every((band) => band.red > 6),
      `A doorway header band is missing: ${pixels.bands.slice(3, 7).map((band) => band.red).join(',')}`)
    assert.ok(pixels.bands[10].yellow >= 2, `The 虚拟 marker is missing its yellow collar: ${pixels.bands[10].yellow}`)
  } finally {
    if (captured) {
      await writeFile(join(proof, 'exit-web.png'), Buffer.from(captured.data, 'base64'))
      await writeFile(join(proof, 'web-pixels.json'),
        JSON.stringify({ ...captured.pixels, stableFrames: 2, debugPort }, null, 2) + '\n')
    }
  }
  const p = captured.pixels
  console.log(`Unity Web rendered the exit row (mode rgb(${p.mode.join(',')}), ${p.background} background, `
    + `${p.red} red, ${p.glass} glass, ${p.sign} sign ink, ${p.white} white, ${p.yellow} yellow, `
    + `${p.uniqueColors} colours of ${p.sampled} samples; slots ${p.bands.map((band) => `${band.model}/${band.red}/${band.glass}`).join(' ')}). `
    + 'See exit-web.png and web-pixels.json.')
} finally {
  await page?.close()
  server.close()
}
