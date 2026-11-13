// Compare a TypeScript station capture with the Unity player's capture of the same view,
// the way plan 11's D4 comparison did — but for any pair of images and any crop, so the
// finish/lighting/glass work in plan 13 §2 can be measured instead of eyeballed.
//
//   node tools/unity-parity/compare-captures.mjs ts.png unity.png \
//     --crop 232,48,748,630 --min-iou 0.85 --out .preview/unity/parity-13/compare.json
//
// Both images are cropped to the same box, scaled to 640x480, and split into subject and
// background by the corner colour. Reported: background, subject coverage, bounding box,
// mean RGB of the subject, the bbox IoU between the engines and the brightness ratio.
// A low IoU means the cameras do not frame the same station, which makes the colour
// numbers meaningless, so the run fails on it.
//
// The PNGs are decoded in the browser the harness already launches: the repo has no Node
// image decoder and adding one for a measurement tool is not worth the dependency.
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { serveDir, withPage } from '../browser-harness.mjs'

const args = process.argv.slice(2)
const positional = args.filter(value => !value.startsWith('--') && !/^[-\d.,]+$/.test(value))
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const [tsPath, unityPath] = positional
if (!tsPath || !unityPath) {
  console.error('usage: node tools/unity-parity/compare-captures.mjs <ts.png> <unity.png> [--crop x,y,w,h] [--min-iou 0.85] [--out report.json]')
  process.exit(2)
}

const parseBox = () => {
  const raw = option('crop', null)
  if (!raw) return null
  const values = raw.split(',').map(value => Number(value.trim()))
  if (values.length !== 4 || values.some(value => !Number.isFinite(value))) {
    console.error('--crop needs four comma-separated numbers: x,y,width,height')
    process.exit(2)
  }
  return values
}

const crop = parseBox()
// Named rectangles in the *cropped* frame: `floor:10,40,60,30;wall:200,80,40,40`.
const parseSamples = () => {
  const raw = option('samples', null)
  if (!raw) return []
  return raw.split(';').filter(Boolean).map(entry => {
    const [name, box] = entry.split(':')
    const values = (box ?? '').split(',').map(value => Number(value.trim()))
    if (!name || values.length !== 4 || values.some(value => !Number.isFinite(value))) {
      console.error(`--samples entry '${entry}' needs name:x,y,width,height`)
      process.exit(2)
    }
    return { name, box: values }
  })
}
const samples = parseSamples()
const minIou = Number(option('min-iou', '0.85'))
const out = option('out', null)

const tsFile = resolve(tsPath)
const unityFile = resolve(unityPath)
const root = dirname(tsFile)
const tsUrl = '/' + basename(tsFile)
const unityUrl = '/' + basename(unityFile)
if (dirname(unityFile) !== root) {
  console.error('put both captures in one directory (the comparison serves that directory)')
  process.exit(2)
}

const server = await serveDir(root, 0)
const port = server.address().port
const page = await withPage({ url: `http://127.0.0.1:${port}/`, profile: resolve(`.preview/unity/compare-${process.pid}`), windowSize: '900,700' })
try {
  const report = await page.evaluate(`(async () => {
    const crop = ${JSON.stringify(crop)}
    const WIDTH = 640, HEIGHT = 480
    async function load(url) {
      const response = await fetch(url)
      const bitmap = await createImageBitmap(await response.blob())
      return bitmap
    }
    function draw(bitmap) {
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.imageSmoothingQuality = 'high'
      if (crop) context.drawImage(bitmap, crop[0], crop[1], crop[2], crop[3], 0, 0, WIDTH, HEIGHT)
      else context.drawImage(bitmap, 0, 0, WIDTH, HEIGHT)
      return context.getImageData(0, 0, WIDTH, HEIGHT).data
    }
    function measure(pixels) {
      const background = [pixels[0], pixels[1], pixels[2]]
      let minX = WIDTH, minY = HEIGHT, maxX = -1, maxY = -1, count = 0
      const sum = [0, 0, 0]
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const offset = (y * WIDTH + x) * 4
          const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2]
          if (Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) <= 36) continue
          count++
          sum[0] += r; sum[1] += g; sum[2] += b
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
      const bbox = count === 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      return { background, coverage: Math.round(count / (WIDTH * HEIGHT) * 10000) / 10000, bbox, mean: count === 0 ? [0, 0, 0] : sum.map(value => Math.round(value / count * 10) / 10) }
    }
    function iou(a, b) {
      const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y)
      const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height)
      if (x1 <= x0 || y1 <= y0) return 0
      return (x1 - x0) * (y1 - y0) / (a.width * a.height + b.width * b.height - (x1 - x0) * (y1 - y0))
    }
    const tsBitmap = await load(${JSON.stringify(tsUrl)})
    const unityBitmap = await load(${JSON.stringify(unityUrl)})
    function sample(pixels, box) {
      const [x, y, width, height] = box
      const sum = [0, 0, 0], sumSquares = [0, 0, 0]
      let count = 0
      for (let row = y; row < y + height; row++) {
        for (let column = x; column < x + width; column++) {
          if (row < 0 || row >= HEIGHT || column < 0 || column >= WIDTH) continue
          const offset = (row * WIDTH + column) * 4
          for (let channel = 0; channel < 3; channel++) {
            const value = pixels[offset + channel]
            sum[channel] += value
            sumSquares[channel] += value * value
          }
          count++
        }
      }
      if (!count) return { mean: [0, 0, 0], stddev: [0, 0, 0], count: 0 }
      const mean = sum.map(value => value / count)
      const stddev = sumSquares.map((value, channel) => Math.sqrt(Math.max(0, value / count - mean[channel] * mean[channel])))
      return { mean: mean.map(value => Math.round(value * 10) / 10), stddev: stddev.map(value => Math.round(value * 10) / 10), count }
    }
    const samples = ${JSON.stringify(samples.map(entry => ({ name: entry.name, box: entry.box })))}
    const tsPixels = draw(tsBitmap)
    const unityPixels = draw(unityBitmap)
    const sampleRows = samples.map(entry => ({ name: entry.name, box: entry.box, ts: sample(tsPixels, entry.box), unity: sample(unityPixels, entry.box) }))
    const ts = measure(tsPixels)
    const unity = measure(unityPixels)
    return {
      ts: { size: [tsBitmap.width, tsBitmap.height], ...ts },
      unity: { size: [unityBitmap.width, unityBitmap.height], ...unity },
      bboxIoU: Math.round(iou(ts.bbox, unity.bbox) * 1000) / 1000,
      brightnessRatio: ts.mean[0] > 0 ? Math.round(unity.mean[0] / ts.mean[0] * 100) / 100 : null,
      crop: crop ?? null,
      samples: sampleRows,
    }
  })()`)
  report.status = report.bboxIoU >= minIou ? 'passed' : 'failed'
  if (report.status !== 'passed') report.problem = `bbox IoU ${report.bboxIoU} is below ${minIou}: the cameras do not frame the same station`
  report.paths = { ts: tsPath, unity: unityPath }
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(resolve(out), JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify(report, null, 2))
  if (report.status !== 'passed') process.exitCode = 1
} finally {
  await page.close()
  await new Promise(done => server.close(done))
}
