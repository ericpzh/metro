import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the fit-out family. The scene holds the nine pieces in
// two rows under one orthographic camera: the interior pieces on the ground row
// and the street/panel cases on a raised row behind them. The camera is tilted
// 12 degrees so the painted street arrows (a horizontal plane) are visible.
//
// The camera is pinned in ReviewFitout.cs (position (0, 12, -34), rotation 12
// degrees, orthographic size 13). The predicate projects each piece's authored
// world box through the same camera, so the checks below name the piece they
// measure rather than sampling fixed screen bands.
const proof = resolve(process.argv[2])
const exportManifest = JSON.parse(await readFile(join(proof, 'export', 'manifest.json'), 'utf8'))
const CAMERA = { y: 12, z: -34, tilt: 12 * Math.PI / 180, size: 13 }
// Mirrors the slot layout in ReviewFitout.Fixtures.
const LAYOUT = {
  'shop-room': { slotX: -14, rowY: 0, rowZ: 0 },
  'retail-room': { slotX: -7, rowY: 0, rowZ: 0 },
  'ticket-booth': { slotX: -1, rowY: 0, rowZ: 0 },
  'shop-shelves': { slotX: 4, rowY: 0, rowZ: 0 },
  'shop-counter': { slotX: 6.5, rowY: 0, rowZ: 0 },
  'shop-stock': { slotX: -14, rowY: 8.5, rowZ: 12 },
  'street-arrow-markings': { slotX: -3, rowY: 8.5, rowZ: 12 },
  'street-decor': { slotX: 5, rowY: 8.5, rowZ: 12 },
  'dynamic-station-panels': { slotX: 14.5, rowY: 8.5, rowZ: 12 },
}

function worldBox(asset, localMin, localMax) {
  const slot = LAYOUT[asset.row]
  const centre = (asset.min[0] + asset.max[0]) / 2
  return {
    min: [slot.slotX - centre + localMin[0], slot.rowY + localMin[2], slot.rowZ + localMin[1]],
    max: [slot.slotX - centre + localMax[0], slot.rowY + localMax[2], slot.rowZ + localMax[1]],
  }
}

const regions = []
for (const asset of exportManifest.assets) {
  regions.push({ name: asset.row, ...worldBox(asset, asset.min, asset.max) })
  if (asset.row === 'shop-room' || asset.row === 'retail-room') {
    // The authored opening: the two south wall columns the document leaves open,
    // floor to 2.8 m, through which the enamel interior band is visible.
    regions.push({
      name: `${asset.row}-opening`,
      ...worldBox(asset, [asset.openingX0, 0.15, 0.2], [asset.openingX1, 0.6, 2.6]),
    })
  }
  if (asset.row === 'ticket-booth') {
    regions.push({
      name: 'ticket-booth-sign',
      ...worldBox(asset, [0.45, -0.1, 1.95], [3.55, 0.15, 2.42]),
    })
    regions.push({
      name: 'ticket-booth-glazing',
      ...worldBox(asset, [0.06, 0.02, 1.05], [3.94, 2.98, 2.06]),
    })
  }
}

const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-fitout-${process.pid}`),
    debugPort,
    windowSize: '1920,1080',
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web fit-out review build' })
  let data, pixels
  await waitFor(async () => {
    ({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
    pixels = await page.evaluate(`(async () => {
    const regions = ${JSON.stringify(regions)};
    const camera = ${JSON.stringify(CAMERA)};
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
    // The Unity orthographic camera: position (0, 12, -34), pitched 12 degrees
    // down about X, half-height 13 m. Pixels per metre is equal on both axes.
    const pxPerMetre = (height / 2) / camera.size;
    const cos = Math.cos(camera.tilt), sin = Math.sin(camera.tilt);
    const project = (x, y, z) => {
      const dy = y - camera.y, dz = z - camera.z;
      const viewY = cos * dy + sin * dz;
      return [width / 2 + x * pxPerMetre, height / 2 - viewY * pxPerMetre];
    };
    const screenRect = (region) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const x of [region.min[0], region.max[0]]) {
        for (const y of [region.min[1], region.max[1]]) {
          for (const z of [region.min[2], region.max[2]]) {
            const [sx, sy] = project(x, y, z);
            minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
            minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
          }
        }
      }
      return {
        x0: Math.max(0, Math.floor(minX)), x1: Math.min(width - 1, Math.ceil(maxX)),
        y0: Math.max(0, Math.floor(minY)), y1: Math.min(height - 1, Math.ceil(maxY)),
      };
    };
    const isSlate = (r, g, b) => b > r + 25 && b > g + 12 && b > 70 && b < 130 && r > 35 && r < 80 && g > 55 && g < 105;
    const measure = (region) => {
      const rect = screenRect(region);
      const counts = {
        name: region.name, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1,
        sampled: 0, slate: 0, white: 0, light: 0, dark: 0, blue: 0, cyan: 0, chroma: 0,
      };
      const colors = new Set();
      for (let py = rect.y0; py <= rect.y1; py++) {
        for (let px = rect.x0; px <= rect.x1; px++) {
          const i = (py * width + px) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          counts.sampled++;
          const spread = Math.max(r, g, b) - Math.min(r, g, b);
          const sum = r + g + b;
          if (isSlate(r, g, b)) { counts.slate++; continue; }
          if (r > 190 && g > 190 && b > 190) counts.white++;
          if (sum > 500) counts.light++;
          if (sum < 340) counts.dark++;
          if (b > r + 60 && b > g + 35 && b > 110) counts.blue++;
          else if (b > r + 10 && g > r + 6 && b > 120 && b - g < 45 && sum > 280) counts.cyan++;
          if (spread > 45 && sum > 120) counts.chroma++;
          colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
        }
      }
      counts.uniqueColors = colors.size;
      counts.rectWidth = rect.x1 - rect.x0 + 1;
      counts.rectHeight = rect.y1 - rect.y0 + 1;
      return counts;
    };
    let slate = 0, sampled = 0;
    for (let py = 0; py < height; py += 2) for (let px = 0; px < width; px += 2) {
      const i = (py * width + px) * 4;
      sampled++;
      if (isSlate(data[i], data[i + 1], data[i + 2])) slate++;
    }
    return {
      width, height, sampled, slate, background: slate / Math.max(1, sampled),
      regions: regions.map(measure),
    };
    })()`)
    return pixels.background > 0.3
  }, '', { tries: 80, every: 500, what: 'fit-out pixels after the Unity splash' }).finally(async () => {
    if (data) await writeFile(join(proof, 'fitout-web.png'), Buffer.from(data, 'base64'))
    if (pixels) await writeFile(join(proof, 'web-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
  })

  const region = (name) => {
    const found = pixels.regions.find(entry => entry.name === name)
    assert.ok(found, `No screen region for ${name}`)
    return found
  }
  const describe = (entry) =>
    `${entry.name} [${entry.x0},${entry.y0} ${entry.rectWidth}x${entry.rectHeight}] ` +
    `white=${entry.white} blue=${entry.blue} cyan=${entry.cyan} chroma=${entry.chroma} ` +
    `dark=${entry.dark} light=${entry.light} colors=${entry.uniqueColors} slate=${entry.slate}`

  assert.ok(pixels.background > 0.35, `Review scene background missing: ${(pixels.background * 100).toFixed(1)}% slate`)

  // Rooms: light plaster/steel walls, an enamel interior band visible through the
  // authored opening, and the opening's screen area reading blue rather than bare slate.
  for (const name of ['shop-room', 'retail-room']) {
    const room = region(name)
    assert.ok(room.sampled - room.slate > 3000, `Room walls missing on ${describe(room)}`)
    assert.ok(room.blue > 120, `Room interior band missing on ${describe(room)}`)
    const opening = region(`${name}-opening`)
    assert.ok(opening.blue > 80, `Authored room opening does not read as an interior on ${describe(opening)}`)
    assert.ok(opening.blue > opening.slate * 0.5, `Authored room opening reads as a hole on ${describe(opening)}`)
  }

  // Booth: glazed kiosk with a dark sign board carrying pale ink above it.
  const booth = region('ticket-booth')
  assert.ok(booth.cyan > 40, `Booth glazing missing on ${describe(booth)}`)
  const glazing = region('ticket-booth-glazing')
  assert.ok(glazing.cyan > 40, `Booth glazing band missing on ${describe(glazing)}`)
  const sign = region('ticket-booth-sign')
  assert.ok(sign.dark > 60, `Booth sign board missing on ${describe(sign)}`)
  assert.ok(sign.white > 3, `Booth sign ink missing on ${describe(sign)}`)

  // Shop furniture: stock chroma in the stocked shelf and in the stock sampler.
  const shelves = region('shop-shelves')
  assert.ok(shelves.chroma > 8, `Shelf stock missing on ${describe(shelves)}`)
  const counter = region('shop-counter')
  assert.ok(counter.sampled - counter.slate > 900, `Shop counter missing on ${describe(counter)}`)
  const stock = region('shop-stock')
  assert.ok(stock.chroma > 150, `Stock colours missing on ${describe(stock)}`)
  assert.ok(stock.uniqueColors > 30, `Stock sampler looks flat on ${describe(stock)}`)

  // Street paint: the asphalt band with white arrows on it.
  const arrows = region('street-arrow-markings')
  assert.ok(arrows.sampled - arrows.slate > 1200, `Asphalt sample missing on ${describe(arrows)}`)
  assert.ok(arrows.white > 40, `Street arrows missing on ${describe(arrows)}`)

  // Roadside decor: shelter paint, campaign posters and guidepost plates.
  const decor = region('street-decor')
  assert.ok(decor.chroma > 150, `Street posters/paint missing on ${describe(decor)}`)
  assert.ok(decor.light + decor.white > 500, `Guidepost faces missing on ${describe(decor)}`)
  assert.ok(decor.uniqueColors > 50, `Street decor looks flat on ${describe(decor)}`)

  // Panel artwork: four authored panels sharing one atlas page, visibly distinct.
  const panels = region('dynamic-station-panels')
  assert.ok(panels.uniqueColors > 45, `Panel artwork looks flat on ${describe(panels)}`)
  assert.ok(panels.chroma > 120, `Panel artwork colours missing on ${describe(panels)}`)
  assert.ok(panels.blue > 60, `Panel display blue missing on ${describe(panels)}`)
  assert.ok(panels.light > 150, `Panel map/display whites missing on ${describe(panels)}`)

  console.log('Unity Web rendered the nine-piece fit-out review:')
  for (const entry of pixels.regions) console.log(`  ${describe(entry)}`)
} finally {
  await page?.close()
  server.close()
}
