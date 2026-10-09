// Rasterise one art sheet, so a sheet can be **looked at** after it is generated.
//
//   node tools/sheet-png.mjs 03 [--out .preview/sheet-03/03.png] [--bg '#05070a'] [--at 8]
//
// The sheets are SVG because they are documents — one file, no external assets,
// crisp at any size. That is also why they are awkward to check: a diff of two
// SVG files says nothing about whether a label landed on top of a picture. This
// draws the sheet into a canvas in a headless browser and writes the PNG, which is
// the only way to see the composition the way the page will.
//
// An animated sheet is different every time it is looked at, which makes two runs
// incomparable and hides whether the train stands where the drawing says it does.
// `--at <seconds>` freezes every animation at that moment of its cycle: sheet 12's
// train is docked with its screen doors open from about 4 s to about 13 s.
//
// It reads `art/`, so run `node tools/gen-art.mjs` first.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveDir, withPage } from './browser-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const wanted = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!wanted) {
  console.error('usage: node tools/sheet-png.mjs <sheet number or file name> [--out FILE] [--bg COLOUR]')
  process.exit(1)
}

// `3` and `03-block-system.svg` both name the same sheet.
const files = readdirSync(join(repo, 'art')).filter((f) => f.endsWith('.svg'))
const num = String(Number(wanted.replace(/\.svg$/, '').split('-')[0]))
const file = files.find((f) => f === wanted) ?? files.find((f) => String(Number(f.split('-')[0])) === num)
if (!file) throw new Error(`no sheet matches ${wanted} — art/ holds:\n  ${files.join('\n  ')}`)

// The sheet's own size decides the window: a screenshot of the page is the
// composition as a browser lays it out, which is the thing worth checking.
const box = readFileSync(join(repo, 'art', file), 'utf8').match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
if (!box) throw new Error(`${file} has no viewBox`)
const sheetW = Math.round(Number(box[1]))
const sheetH = Math.round(Number(box[2]))

const out = resolve(repo, arg('out', join('.preview', 'sheets', file.replace(/\.svg$/, '.png'))))
const bg = arg('bg', '#05070a')
const at = arg('at', null)
const PORT = Number(arg('port', 4196))
const DEBUG_PORT = Number(arg('debug-port', 9338))

const server = await serveDir(join(repo, 'art'), PORT)
const session = await withPage({
  url: `http://127.0.0.1:${PORT}/${encodeURIComponent(file)}`,
  profile: join(repo, '.preview', `.chrome-sheet-png-${process.pid}`),
  debugPort: DEBUG_PORT,
  windowSize: `${sheetW},${sheetH}`,
  verbose: Boolean(process.env.SHEET_VERBOSE),
})

try {
  // Give the sheet a frame of ground so a dark sheet is not read as a blank shot,
  // pin the viewport to the sheet's own pixels, and take away the margin a browser
  // puts around a document it is handed — otherwise the capture is the sheet
  // shifted eight pixels into the corner of its own background.
  await session.evaluate(`(() => {
    document.documentElement.style.background = ${JSON.stringify(bg)}
    document.documentElement.style.margin = '0'
    document.documentElement.style.display = 'block'
    if (document.body) document.body.style.margin = '0'
    const root = document.documentElement
    root.setAttribute('width', String(${sheetW}))
    root.setAttribute('height', String(${sheetH}))
    return [root.clientWidth, root.clientHeight]
  })()`)
  // Freeze the loop at a chosen second. A negative delay advances every animation to
  // that moment and `paused` holds it there; the elements' own delays (the stagger on
  // a crowd) go with it, which is what "the sheet at 8 s" has to mean.
  if (at !== null) {
    await session.evaluate(`(() => {
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      style.textContent = '*{animation-play-state:paused !important;animation-delay:${-Number(at)}s !important}'
      document.documentElement.appendChild(style)
      for (const svg of [document.documentElement, ...document.querySelectorAll('svg')]) {
        if (typeof svg.pauseAnimations !== 'function') continue
        svg.pauseAnimations()
        svg.setCurrentTime(${Number(at)})
      }
      return ${JSON.stringify(String(at))}
    })()`)
  }
  // A sheet's pictures are embedded PNGs, and a screenshot taken before they decode
  // is a sheet with holes in it. Wait for every `<image>` the sheet declares.
  await session.evaluate(`(async () => {
    const images = Array.from(document.getElementsByTagName('image'))
    await Promise.all(images.map((el) => new Promise((ok) => {
      if (el.href && el.href.baseVal) {
        const probe = new Image()
        probe.onload = ok
        probe.onerror = ok
        probe.src = el.href.baseVal
        return
      }
      ok()
    })))
    await new Promise((ok) => setTimeout(ok, 250))
    return images.length
  })()`)
  const shot = await session.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: sheetW, height: sheetH, scale: 1 },
  })
  if (!shot?.data) throw new Error('no pixels came back')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`sheet-png: art/${file} -> ${out}  (${sheetW}×${sheetH})`)
} finally {
  await session.close()
  server.close()
}
