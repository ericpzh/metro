// Render the 电视 station plate to a PNG, outside the browser.
//
// `render/stationDisplay.ts` draws with the Canvas 2D API, which Node does not
// have. Rather than reimplement the plate (which would prove nothing about the
// real code), this supplies a *recording* 2D context that turns each call into
// SVG, then lets `sharp` rasterise it. So the picture really is the shipping
// draw function's output — the only approximation is text width.
//
// Usage (from `game/`): node ../tools/render-tv-plate.mjs out.png
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
/** The plate lives in the game app, next to this repo's `tools/`. */
const HERE = dirname(fileURLToPath(import.meta.url))

/** Escape the five characters that matter inside an SVG text node. */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

/** `bold 15px "A", sans-serif` -> `font-weight="bold" font-size="15"`. */
function fontAttrs(font) {
  const m = /(italic\s+)?(bold\s+)?(\d+(?:\.\d+)?)px/.exec(font ?? '')
  const out = []
  if (m?.[1]) out.push('font-style="italic"')
  if (m?.[2]) out.push('font-weight="bold"')
  // A deliberately over-generous default: a missing metric must not hide text.
  out.push(`font-size="${m ? m[3] : 16}"`)
  return out.join(' ')
}

function fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font ?? '')
  return m ? Number(m[1]) : 16
}

/**
 * A CanvasRenderingContext2D that records SVG. Only the calls the plate makes are
 * implemented; anything else throws, so a new drawing trick cannot silently
 * produce a preview that is not what the browser would paint.
 */
function recordingContext(width, height) {
  const parts = []
  let path = []
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '16px sans-serif', textAlign: 'start', textBaseline: 'alphabetic' }
  const anchor = () =>
    state.textAlign === 'center' ? 'middle' : state.textAlign === 'right' || state.textAlign === 'end' ? 'end' : 'start'
  const baseline = () =>
    state.textBaseline === 'top'
      ? 'hanging'
      : state.textBaseline === 'middle'
        ? 'central'
        : state.textBaseline === 'bottom'
          ? 'text-after-edge'
          : 'alphabetic'

  return {
    get fillStyle() {
      return state.fillStyle
    },
    set fillStyle(v) {
      state.fillStyle = v
    },
    get strokeStyle() {
      return state.strokeStyle
    },
    set strokeStyle(v) {
      state.strokeStyle = v
    },
    get lineWidth() {
      return state.lineWidth
    },
    set lineWidth(v) {
      state.lineWidth = v
    },
    get font() {
      return state.font
    },
    set font(v) {
      state.font = v
    },
    get textAlign() {
      return state.textAlign
    },
    set textAlign(v) {
      state.textAlign = v
    },
    get textBaseline() {
      return state.textBaseline
    },
    set textBaseline(v) {
      state.textBaseline = v
    },

    clearRect() {},
    fillRect(x, y, w, h) {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${state.fillStyle}"/>`)
    },
    beginPath() {
      path = []
    },
    roundRect(x, y, w, h, r) {
      path.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}"/>`)
    },
    fill() {
      for (const d of path) parts.push(d.replace('/>', ` fill="${state.fillStyle}"/>`))
      path = []
    },
    stroke() {
      for (const d of path) parts.push(d.replace('/>', ` fill="none" stroke="${state.strokeStyle}" stroke-width="${state.lineWidth}"/>`))
      path = []
    },
    fillText(text, x, y) {
      parts.push(
        `<text x="${x}" y="${y}" ${fontAttrs(state.font)} fill="${state.fillStyle}" text-anchor="${anchor()}" dominant-baseline="${baseline()}">${esc(text)}</text>`,
      )
    },
    // Rough per-glyph metric: CJK takes a full em, Latin about 0.55. Only
    // `fitText` and the label offsets read this, so an estimate is enough to
    // prove the plate is laid out — not to prove kerning.
    measureText(text) {
      const px = fontPx(state.font)
      let w = 0
      for (const ch of String(text)) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? px : px * 0.55
      return { width: w }
    },
    toSvg() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
    },
  }
}

const out = process.argv[2] ?? 'tv-plate.png'
const plateUrl = pathToFileURL(resolve(HERE, '../game/src/render/stationDisplay.ts')).href
const mod = await import(plateUrl)

const { STATION_PLATE, drawStationDisplay, stationDisplayLayout } = mod

/**
 * `--layout` paints the raw rectangles instead of the artwork: the board column in
 * blue and the content window in green. It is the quickest way to see whether the
 * two panes tile the plate or leave a strip between them, because the gap would be
 * plate-coloured and obvious against the fills.
 */
const layoutMode = process.argv.includes('--layout')
if (layoutMode) {
  const g = recordingContext(STATION_PLATE.width, STATION_PLATE.height)
  const L = stationDisplayLayout()
  const rect = (r, fill, label) => {
    g.fillStyle = fill
    g.fillRect(r.x, r.y, r.w, r.h)
    g.fillStyle = '#000'
    g.font = 'bold 12px sans-serif'
    g.textAlign = 'left'
    g.textBaseline = 'top'
    g.fillText(label, r.x + 4, r.y + 4)
  }
  rect(L.poster, '#1f9c63', 'WINDOW')
  rect(L.header, '#1b6fd6', 'header')
  L.cards.forEach((c, i) => rect(c, '#1b6fd6', `card${i}`))
  rect(L.strip, '#1b6fd6', 'strip')
  rect(L.clock, '#1b6fd6', 'clock')
  const svg = g.toSvg()
  await sharp(Buffer.from(svg)).png().toFile(out)
  const gap = L.poster.x - (L.cards[0].x + L.cards[0].w)
  console.log(`wrote ${out} (layout diagram). Column ends at ${(L.cards[0].x + L.cards[0].w).toFixed(2)}, window starts at ${L.poster.x.toFixed(2)} -> gap ${gap.toFixed(2)}px`)
  process.exit(0)
}

const g = recordingContext(STATION_PLATE.width, STATION_PLATE.height)

// A representative service, so the plate prints real countdowns.
const status = {
  name: '5号线',
  colour: '#c8102e',
  terminus: '番禺广场',
  minutes: 2,
  atPlatform: false,
  headway: 4,
}
drawStationDisplay(g, status, '动物园', '08:31')

const svg = g.toSvg()
await sharp(Buffer.from(svg)).png().toFile(out)
console.log(`wrote ${out} (${STATION_PLATE.width}x${STATION_PLATE.height})`)
