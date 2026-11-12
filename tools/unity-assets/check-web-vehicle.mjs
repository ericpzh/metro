import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'

// Headless Web review for the vehicle family. The scene holds the six road
// vehicles in a 3/4 pose and the four city cab marks at the end of the row, on a
// slate clear colour. The predicate requires:
//
//  * the slate review background and a varied frame (never a uniform or
//    splash-only capture);
//  * every one of the ten rows rendered where the review camera puts it, sampled
//    from the same projection the Unity scene uses (the import check pins the
//    camera; this file repeats its numbers);
//  * the light/dark body palette of the road kit, the orange bus's pale livery
//    against the mosaic bus's mid-grey body, and the moped/bicycle frames;
//  * the four trains' mark colour families on their own cab plates: Guangzhou
//    red, Beijing white, Chongqing white/line-orange and Nanjing red/white.
//
// A blank frame, a missing asset or a splash-only capture cannot satisfy this.
const proof = resolve(process.argv[2])
const manifest = JSON.parse(await readFile(join(proof, 'export', 'manifest.json'), 'utf8'))

// Must match ReviewVehicle.BuildReviewScene; the Unity import asserts the saved
// scene's camera, so this is the projection the built Web scene renders with.
const CAMERA = { position: [55, 8, 32], target: [26, 2.4, 3], fov: 45 }
const VEHICLES = 6
const VEHICLE_PITCH = 13
const MARK_PITCH = 2.5
const MARK_GAP = 5
const VEHICLE_YAW = -30 * Math.PI / 180

/** Row positions, identical to ReviewVehicle.RowX. */
const rowX = index => index < VEHICLES
  ? (index - (VEHICLES - 1) / 2) * VEHICLE_PITCH
  : (VEHICLES / 2 - 0.5) * VEHICLE_PITCH + MARK_GAP + (index - VEHICLES) * MARK_PITCH

const sub = (a, b) => a.map((value, i) => value - b[i])
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = value => {
  const length = Math.hypot(...value)
  return value.map(entry => entry / length)
}
const forward = normalize(sub(CAMERA.target, CAMERA.position))
const right = normalize(cross([0, 1, 0], forward))
const up = cross(forward, right)
const tanHalf = Math.tan(CAMERA.fov * Math.PI / 360)

/** A world point in normalized canvas coordinates (0..1, y down). */
function project(point, aspect) {
  const delta = sub(point, CAMERA.position)
  const depth = dot(delta, forward)
  if (depth <= 0.05) return null
  const x = dot(delta, right)
  const y = dot(delta, up)
  return [0.5 + (x / (depth * tanHalf * aspect)) * 0.5, 0.5 - (y / (depth * tanHalf)) * 0.5]
}

/**
 * Each row's screen rectangle: the eight corners of its Unity-space bounding box
 * (vehicles turned by the row yaw), projected and enclosed. The manifest's bounds
 * are the exporter's measured source-space extents.
 */
function buildRects(aspect) {
  return manifest.assets.map((asset, index) => {
    const xs = [asset.min[0], asset.max[0]]
    const ys = [asset.min[2], asset.max[2]]
    const zs = [asset.min[1], asset.max[1]]
    let box = null
    for (const x of xs) for (const y of ys) for (const z of zs) {
      let worldX = x
      let worldZ = z
      if (asset.kind === 'vehicle') {
        worldX = x * Math.cos(VEHICLE_YAW) + z * Math.sin(VEHICLE_YAW)
        worldZ = -x * Math.sin(VEHICLE_YAW) + z * Math.cos(VEHICLE_YAW)
      }
      const point = project([worldX + rowX(index), y, worldZ], aspect)
      if (!point) return null
      box = box ? [Math.min(box[0], point[0]), Math.min(box[1], point[1]), Math.max(box[2], point[0]), Math.max(box[3], point[1])]
        : [point[0], point[1], point[0], point[1]]
    }
    // A few pixels of slack for antialiasing and the plate's own thickness.
    const padX = 4 / 1400
    const padY = 4 / 900
    return {
      id: asset.id,
      kind: asset.kind,
      box: [Math.max(0, box[0] - padX), Math.max(0, box[1] - padY), Math.min(1, box[2] + padX), Math.min(1, box[3] + padY)],
    }
  })
}

const server = await serveDir(join(proof, 'web'), 0)
const debugPort = 9300 + (process.pid % 400)
let page
try {
  page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile: join(proof, `chrome-vehicle-${process.pid}`),
    debugPort,
  })
  await waitFor(page.evaluate, `(() => {
    const bar = document.querySelector('#unity-loading-container');
    const canvas = document.querySelector('#unity-canvas');
    return bar?.style.display === 'none' && canvas?.width > 0;
  })()`, { what: 'Unity Web vehicle review build' })

  let data, pixels
  let rects = null
  let results = []
  // One source of truth for the pass/fail thresholds: the retry predicate and the
  // final assertions read the same list, so they cannot drift. The numbers are
  // measured against the family's 960 x 600 default Web template, where the row
  // spans about 1650 px of non-background pixels.
  const inspect = value => {
    if (!value) return []
    const rect = id => value.rects.find(entry => entry.id === id)
    const rows = [
      [`Review scene background missing: ${value.background}/${value.sampled}`, value.background > value.sampled * 0.40],
      [`Frame looks uniform or splash-only (${value.uniqueColors} colours)`, value.uniqueColors > 80],
      [`Too few light road-kit body pixels: ${value.light}`, value.light > 700],
      [`Too few mid-grey road-kit/plate pixels: ${value.mid}`, value.mid > 2000],
      [`Too few dark glass/tyre pixels: ${value.dark}`, value.dark > 1500],
      [`The two red train marks are missing: ${value.red} red pixels`, value.red > 300],
      [`The Chongqing line badge is missing: ${value.orange} orange pixels`, value.orange > 15],
      [`The white mark families are missing: ${value.white} white pixels`, value.white > 400],
    ]
    for (const asset of manifest.assets) {
      const sample = rect(asset.id)
      rows.push([
        `${asset.id} is missing from the review row (${sample.foreground} foreground pixels in ${JSON.stringify(sample.box)})`,
        sample.foreground > (asset.kind === 'mark' ? 200 : 100),
      ])
    }
    const orangeBus = rect('vehicle-bus-orange')
    const mosaicBus = rect('vehicle-bus-mosaic')
    rows.push(
      [`Orange bus livery is not the pale scheme (${orangeBus.light} light pixels)`, orangeBus.light > 250],
      [`Orange bus does not read lighter than the mosaic bus (${orangeBus.meanLuma} vs ${mosaicBus.meanLuma})`,
        orangeBus.meanLuma > mosaicBus.meanLuma + 5],
      [`Mosaic bus livery is not the mid-grey scheme (${mosaicBus.mid} mid pixels)`, mosaicBus.mid > 400],
    )
    for (const id of ['vehicle-moped', 'vehicle-bicycle']) {
      const sample = rect(id)
      rows.push(
        [`${id} frame is missing (${sample.mid} mid pixels)`, sample.mid > 40],
        [`${id} tyres are missing (${sample.dark} dark pixels)`, sample.dark > 30],
      )
    }
    const guangzhou = rect('city-guangzhou-train-mark')
    const beijing = rect('city-beijing-train-mark')
    const chongqing = rect('city-chongqing-train-mark')
    const nanjing = rect('city-nanjing-train-mark')
    rows.push(
      [`Guangzhou 羊 train mark is missing: ${guangzhou.red} red pixels`, guangzhou.red > 100],
      [`Beijing calligraphy train mark is missing: ${beijing.white} white pixels`, beijing.white > 45],
      [`Chongqing line badge is missing (${chongqing.orange} orange, ${chongqing.white} white pixels)`,
        chongqing.orange > 15 && chongqing.white > 45],
      [`Nanjing plum-blossom train mark is missing (${nanjing.red} red, ${nanjing.white} white pixels)`,
        nanjing.red > 250 && nanjing.white > 45],
    )
    return rows
  }

  for (let attempt = 0; attempt < 80; attempt++) {
    ({ data } = await page.send('Page.captureScreenshot', { format: 'png' }))
    const layout = await page.evaluate(`(() => {
      const canvas = document.querySelector('#unity-canvas').getBoundingClientRect();
      return { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height };
    })()`)
    rects = buildRects(layout.width / layout.height)
    if (rects.some(rect => rect === null)) throw new Error('An asset projects behind the review camera')
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
      // Screenshot pixels per CSS pixel; Unity's camera aspect and the canvas
      // CSS aspect are the same, so the normalized rects carry over unchanged.
      const scaleX = image.width / window.innerWidth;
      const scaleY = image.height / window.innerHeight;
      const x0 = Math.max(0, Math.round(canvas.x * scaleX));
      const y0 = Math.max(0, Math.round(canvas.y * scaleY));
      const width = Math.max(1, Math.min(sample.width - x0, Math.round(canvas.width * scaleX)));
      const height = Math.max(1, Math.min(sample.height - y0, Math.round(canvas.height * scaleY)));
      const data = ctx.getImageData(x0, y0, width, height).data;
      const rects = ${JSON.stringify(rects.map(rect => ({ id: rect.id, kind: rect.kind, box: rect.box })))}
        .map(rect => ({ ...rect, area: 0, foreground: 0, light: 0, mid: 0, dark: 0, red: 0, orange: 0, white: 0, luma: 0 }));
      let background = 0, light = 0, mid = 0, dark = 0, red = 0, orange = 0, white = 0, other = 0;
      const colors = new Set();
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const i = (py * width + px) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const sum = r + g + b;
          const spread = Math.max(r, g, b) - Math.min(r, g, b);
          // The review camera clears to the family's slate blue (about 56, 77, 97);
          // every road surface is translucent over it, so a covered pixel keeps a
          // much flatter blue-red split than the clear colour.
          const isBackground = b > r + 30 && b > g + 14 && b > 55 && b < 135 && r < 100 && g > 45 && g < 125;
          // Authored marks are unlit, so their ink reaches the authored sRGB value:
          // Guangzhou red #d8231c, Beijing white, Nanjing red #d82316, the
          // Chongqing badge's white ground and line-4 orange #dc8633.
          const isRed = r > 110 && r > g + 45 && r > b + 40;
          const isOrange = r > 120 && g > 50 && g < 190 && b < 120 && r > g + 30 && g > b + 15;
          const isWhite = r > 185 && g > 185 && b > 185 && spread < 30;
          let isLight = false, isMid = false, isDark = false;
          if (isBackground) background++;
          else {
            if (sum > 480 && spread < 45) { isLight = true; light++; }
            else if (sum > 230 && spread < 55) { isMid = true; mid++; }
            else if (sum <= 230 && spread < 55) { isDark = true; dark++; }
            else other++;
            // The badge's line orange (#dc8633) is also a "red" by the loose
            // r > g test, so the more specific family is classified first.
            if (isOrange) orange++;
            else if (isRed) red++;
            else if (isWhite) white++;
          }
          colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
          const nx = (px + 0.5) / width, ny = (py + 0.5) / height;
          for (const rect of rects) {
            const [x1, y1, x2, y2] = rect.box;
            if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
            rect.area++;
            if (!isBackground) {
              rect.foreground++;
              rect.luma += (r + g + b) / 3;
              if (isLight) rect.light++;
              if (isMid) rect.mid++;
              if (isDark) rect.dark++;
              if (isRed) rect.red++;
              if (isOrange) rect.orange++;
              if (isWhite) rect.white++;
            }
          }
        }
      }
      return {
        sampled: width * height, width, height,
        background, light, mid, dark, red, orange, white, other,
        uniqueColors: colors.size,
        rects: rects.map(rect => ({
          id: rect.id, kind: rect.kind, box: rect.box.map(value => +value.toFixed(4)), area: rect.area,
          foreground: rect.foreground, light: rect.light, mid: rect.mid, dark: rect.dark,
          red: rect.red, orange: rect.orange, white: rect.white,
          meanLuma: rect.foreground ? Math.round(rect.luma / rect.foreground) : 0,
        })),
      };
    })()`)
    results = inspect(pixels)
    if (results.length > 0 && results.every(([, ok]) => ok)) break
    await sleep(500)
  }
  await writeFile(join(proof, 'vehicle-web.png'), Buffer.from(data, 'base64'))
  await writeFile(join(proof, 'web-pixels.json'), JSON.stringify({ camera: CAMERA, ...pixels }, null, 2) + '\n')
  assert.ok(pixels, 'The Unity Web build produced no screenshot')
  for (const [message, ok] of results) assert.ok(ok, message)
  console.log(
    `Unity Web rendered the vehicle row (${pixels.light} light, ${pixels.mid} mid, ${pixels.dark} dark, ` +
    `${pixels.red} red, ${pixels.orange} orange, ${pixels.white} white; ${pixels.rects.map(entry => `${entry.id}=${entry.foreground}f`).join(' ')}; ` +
    `${pixels.background}/${pixels.sampled} background, ${pixels.uniqueColors} colours). See vehicle-web.png and web-pixels.json.`,
  )
} finally {
  await page?.close()
  server.close()
}
