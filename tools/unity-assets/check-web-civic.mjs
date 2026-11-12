import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the civic family: the eight city 出入口 head-houses in
// one 8.6 m-pitch row on the slate clear colour, each carrying its city canopy
// and its city's printed header fascia. The predicate requires the slate
// background, the red Guangzhou frame and the grey/silver frames of the seven
// authored canopies, the tinted glass, and — per row slot — real pixels of that
// city's own printed fascia ground, so a blank, splash-only or single-city frame
// fails. It also proves the eight fascias read as several distinct header hues.
//
// The exported manifest supplies each slot's recorded header ground colour (the
// Unity review has already checked that ground is the city's authored entrance
// colour and that its canvas carries printed ink), so the pixel check compares
// against exported data instead of a second copy of the city palette.
//
// Row geometry matches ReviewCivic.cs: eight slots at x = (i - 3.5) * 8.6 m, a
// 60-degree vertical field of view and a camera at (0, 5, -46) looking at
// (0, 2.2, 0) — low enough to read the printed fascia under each canopy
// overhang. The page is emulated at deviceScaleFactor 2, which makes Unity size
// its WebGL render target to twice the 960 x 600 canvas template: the printed
// fascia is only 0.5 m tall, so the extra device pixels are what makes its
// colour sampleable.
const proof = resolve(process.argv[2])
const manifest = JSON.parse(await readFile(join(proof, 'export', 'manifest.json'), 'utf8'))
assert.equal(manifest.assets.length, 8, 'the civic manifest does not hold eight city assets')
const grounds = manifest.assets.map(asset => ({
  city: asset.city,
  hex: asset.header.groundHex,
  rgb: [1, 3, 5].map(at => parseInt(asset.header.groundHex.slice(at, at + 2), 16)),
}))

const CAMERA = { eye: [0, 5, -46], target: [0, 2.2, 0], fieldOfView: 60 }
const SLOTS = 8
const SPACING = 8.6
const bandEdge = SPACING * (SLOTS - 1) / 2 + SPACING / 2

const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: 'about:blank',
    profile: join(proof, `chrome-civic-${process.pid}`),
    debugPort,
    windowSize: '1600,1000',
  })
  // Supersample before the Unity loader reads devicePixelRatio: a 2x device pixel
  // ratio doubles the canvas render target, so each 0.5 m fascia band is ~10 px
  // tall instead of 5 and its authored colour survives minification.
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1568, height: 900, deviceScaleFactor: 2, mobile: false,
  })
  await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web civic review build' })

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
      const grounds = ${JSON.stringify(grounds)};

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

      // The eight row slots, projected through the camera's vertical half-angle
      // (30 degrees) and the canvas aspect. Band edges are the midpoints between
      // neighbouring slots, so each band holds one city and nothing else.
      const aspect = sw / sh;
      const distance = ${Math.abs(CAMERA.eye[2] - CAMERA.target[2])};
      const halfVertical = distance * Math.tan(${CAMERA.fieldOfView} / 2 * Math.PI / 180);
      const halfHorizontal = halfVertical * aspect;
      const slot = (x) => 0.5 + x / (2 * halfHorizontal);
      const bandLeft = slot(${-bandEdge}) * sw;
      const bandRight = slot(${bandEdge}) * sw;
      const bandWidth = (bandRight - bandLeft) / ${SLOTS};
      const bands = grounds.map(() => ({ model: 0, glass: 0, red: 0, grey: 0, header: 0, white: 0 }));
      const headerColours = grounds.map(() => new Map());

      let background = 0, glass = 0, red = 0, grey = 0, white = 0, dark = 0, header = 0;
      const quantised = new Set();
      for (let py = 0; py < sh; py++) {
        for (let px = 0; px < sw; px++) {
          const i = (py * sw + px) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const sum = r + g + b;
          const high = Math.max(r, g, b), low = Math.min(r, g, b);
          quantised.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
          if (r === mr && g === mg && b === mb) { background++; continue; }
          const bandIndex = Math.floor((px - bandLeft) / bandWidth);
          const band = bandIndex >= 0 && bandIndex < bands.length ? bands[bandIndex] : null;
          if (band) band.model++;
          // The glass sides tint the slate brighter with green above red: the
          // transparent panes blend their pale blue-green into the backdrop.
          if (b > r + 12 && g > r + 4 && sum > modeSum + 15 && high < 245) {
            glass++; if (band) band.glass++;
          }
          // The Guangzhou canopy keeps the palette's red steel frame (and its red
          // printed fascia); the seven city canopies use silver/charcoal metal.
          if (r > g + 35 && r > b + 35 && r > 70) { red++; if (band) band.red++; }
          else if (high - low < 22 && sum > 260 && sum < 620) { grey++; if (band) band.grey++; }
          // Printed white ink: the fascia lettering and the under-canopy strips.
          if (sum > 600 && high - low < 60) { white++; if (band) band.white++; }
          if (sum < 150) dark++;
          // The printed fascia: the city's own recorded ground colour, matched
          // tightly enough that the slate backdrop, a shadow or a neighbouring
          // city's plate cannot stand in.
          if (band) {
            const ground = grounds[bandIndex].rgb;
            if (Math.abs(r - ground[0]) + Math.abs(g - ground[1]) + Math.abs(b - ground[2]) < 30) {
              header++; band.header++;
              const key = (r << 16) | (g << 8) | b;
              const tally = headerColours[bandIndex];
              tally.set(key, (tally.get(key) ?? 0) + 1);
            }
          }
        }
      }
      // Each slot's fascia foreground: the modal colour of the pixels that
      // matched that slot's own printed ground, and how far it sits from it.
      const headerDominant = headerColours.map((tally, index) => {
        let key = 0, count = -1;
        for (const [colour, hits] of tally) if (hits > count) { count = hits; key = colour }
        const rgb = count > 0 ? [(key >> 16) & 255, (key >> 8) & 255, key & 255] : null;
        const ground = grounds[index].rgb;
        const offset = rgb ? Math.abs(rgb[0] - ground[0]) + Math.abs(rgb[1] - ground[1]) + Math.abs(rgb[2] - ground[2]) : 999;
        return { city: grounds[index].city, ground: grounds[index].hex, count, rgb, offset };
      });
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([key, count]) => ({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], count }));
      return {
        mode: [mr, mg, mb], modeCount, background, glass, red, grey, white, dark, header,
        uniqueColors: quantised.size, top, sampled: total, bands, headerDominant,
        canvas: { width: sw, height: sh, scale, bandLeft, bandRight, bandWidth },
      };
    })()`)
    return { data, pixels }
  }

  // Slots are the eight cities in checklist order. A plausible frame: the clear
  // colour is the family's slate blue, the row supplies the Guangzhou red, the
  // seven silver/charcoal frames, the glass tint, the printed white ink and, in
  // every slot, that city's own fascia ground with its own fascia colour as the
  // modal match. A blank frame is 100% background; a splash-only frame has a
  // neutral mode and no fascia ground at all.
  const distinctHues = new Set(grounds.map(ground => ((ground.rgb[0] >> 4) << 8) | ((ground.rgb[1] >> 4) << 4) | (ground.rgb[2] >> 4)))
  const enough = (p) => p.mode[2] > p.mode[0] + 20 && p.mode[2] >= 60
    && p.background > p.sampled * 0.4 && p.background < p.sampled * 0.995
    && p.red > 800 && p.grey > 6000 && p.glass > 1000 && p.white > 2000
    && p.uniqueColors > 80
    && p.bands.every((band) => band.model > 1500)
    && p.bands.every((band) => band.header > 20)
    && p.bands.every((band) => band.glass > 200)
    && p.bands[0].red > 250
    && p.headerDominant.every((entry) => entry.offset < 32)
  let captured
  try {
    await waitFor(async () => {
      captured = await sample()
      return enough(captured.pixels)
    }, '', { tries: 90, every: 600, what: 'the eight city canopies over the review background' })

    // A splash or transient frame fades: the real scene must still satisfy the
    // check half a second later. Keep the second frame as the evidence image.
    await new Promise(done => setTimeout(done, 500))
    captured = await sample()
    const pixels = captured.pixels
    assert.ok(enough(pixels), `Civic row did not persist: ${JSON.stringify({ ...pixels, top: undefined })}`)
    assert.ok(pixels.background > pixels.sampled * 0.4,
      `Review scene background missing: ${pixels.background} of ${pixels.sampled}`)
    assert.ok(pixels.background < pixels.sampled * 0.995,
      `The frame is blank (${pixels.background} of ${pixels.sampled} background)`)
    assert.ok(pixels.red > 800, `The Guangzhou red canopy frame is missing: ${pixels.red}`)
    assert.ok(pixels.grey > 6000, `The seven silver/charcoal city frames are missing: ${pixels.grey}`)
    assert.ok(pixels.glass > 1000, `Too few blue-green glass pixels: ${pixels.glass}`)
    assert.ok(pixels.white > 2000, `Printed sign lettering missing (${pixels.white} white pixels)`)
    assert.ok(pixels.uniqueColors > 80, `Frame looks uniform or splash-only (${pixels.uniqueColors} colours)`)
    assert.ok(pixels.bands.every((band) => band.model > 1500),
      `A city slot is empty: ${pixels.bands.map((band) => band.model).join(',')}`)
    assert.ok(pixels.bands.every((band) => band.glass > 200),
      `A city canopy is missing its glass: ${pixels.bands.map((band) => band.glass).join(',')}`)
    assert.ok(pixels.bands.every((band) => band.header > 20),
      `A printed header fascia is missing: ${pixels.bands.map((band) => band.header).join(',')}`)
    assert.ok(pixels.headerDominant.every((entry) => entry.offset < 32),
      `A fascia's modal colour is not its recorded ground: ${pixels.headerDominant.map((entry) => `${entry.city}:${entry.offset}`).join(' ')}`)
    assert.ok(distinctHues.size >= 5,
      `The eight headers only read as ${distinctHues.size} hues`)
    assert.ok(pixels.bands[0].red > 250,
      `The Guangzhou slot lost its red frame and fascia: ${pixels.bands[0].red}`)
    // The two extreme fascias: Guangzhou's red entrance plate and Chongqing's
    // cream plate, both of which only their own city can paint.
    const guangzhou = pixels.headerDominant[0]
    assert.ok(guangzhou.rgb && guangzhou.rgb[0] > guangzhou.rgb[1] + 60 && guangzhou.rgb[0] > guangzhou.rgb[2] + 60,
      `The Guangzhou fascia is not the red entrance plate: ${JSON.stringify(guangzhou)}`)
    const chongqing = pixels.headerDominant[5]
    assert.ok(chongqing.rgb && chongqing.rgb.reduce((sum, value) => sum + value, 0) > 600,
      `The Chongqing fascia is not the bright cream plate: ${JSON.stringify(chongqing)}`)
  } finally {
    if (captured) {
      await writeFile(join(proof, 'civic-web.png'), Buffer.from(captured.data, 'base64'))
      await writeFile(join(proof, 'web-pixels.json'),
        JSON.stringify({ ...captured.pixels, distinctHeaderHues: [...distinctHues].length, stableFrames: 2, debugPort }, null, 2) + '\n')
    }
  }
  const p = captured.pixels
  console.log(`Unity Web rendered the civic row at ${p.canvas.width}x${p.canvas.height} (mode rgb(${p.mode.join(',')}), `
    + `${p.background} background, ${p.red} red, ${p.grey} grey, ${p.glass} glass, ${p.header} header, ${p.white} white, `
    + `${p.uniqueColors} colours of ${p.sampled} samples; hues ${distinctHues.size}; slots `
    + `${p.bands.map((band, index) => `${grounds[index].city}:${band.model}/${band.header}/${band.glass}`).join(' ')}). `
    + 'See civic-web.png and web-pixels.json.')
} finally {
  await page?.close()
  server.close()
}
