// Render a 指示牌 panel to a PNG, outside the browser.
//
// The sibling of `render-tv-plate.mjs`, and for the same reason: `sim/sign.ts`
// owns the board's geometry and `render/signFace.ts` owns its pixels, and both
// draw with the Canvas 2D API, which Node does not have. Rather than reimplement
// the board (which would prove nothing about the shipping code), this supplies a
// *recording* 2D context that turns each call into SVG and lets `sharp` rasterise
// it — so the picture really is `drawSignPanel`'s output. The only approximation
// is text width.
//
// Two boards are drawn: the one a fresh palette click hangs, and a full-catalogue
// board that exercises every pictogram, both arrow kinds and a two-line caption.
//
// Usage (from `game/`): node ../tools/render-sign-panel.mjs [out.png]
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const HERE = dirname(fileURLToPath(import.meta.url))

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

/** `bold 15px "A", sans-serif` -> `font-weight="bold" font-size="15"`. */
function fontAttrs(font) {
  const m = /(italic\s+)?(bold\s+)?(\d+(?:\.\d+)?)px/.exec(font ?? '')
  const out = []
  if (m?.[1]) out.push('font-style="italic"')
  if (m?.[2]) out.push('font-weight="bold"')
  out.push(`font-size="${m ? m[3] : 16}"`)
  return out.join(' ')
}

function fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font ?? '')
  return m ? Number(m[1]) : 16
}

/**
 * A CanvasRenderingContext2D that records SVG. Only the calls the board makes are
 * implemented, and each one is a *transform-aware* record: the panel turns arrows
 * about their own centre, so ignoring `translate`/`rotate` would draw every
 * diagonal pointing right.
 */
function recordingContext(width, height) {
  const parts = []
  let path = ''
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '16px sans-serif', textAlign: 'start', textBaseline: 'alphabetic' }
  const stack = []
  let m = [1, 0, 0, 1, 0, 0]
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
  const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
  const xy = (x, y) => {
    const [a, b] = pt(x, y)
    return `${a.toFixed(2)} ${b.toFixed(2)}`
  }
  const anchor = () => (state.textAlign === 'center' ? 'middle' : state.textAlign === 'right' || state.textAlign === 'end' ? 'end' : 'start')
  const baseline = () => (state.textBaseline === 'top' ? 'hanging' : state.textBaseline === 'middle' ? 'central' : 'alphabetic')

  const g = {
    canvas: { width, height },
    setTransform(a, b, c, d, e, f) {
      m = [a, b, c, d, e, f]
    },
    save() {
      stack.push({ m: [...m], ...state })
    },
    restore() {
      const s = stack.pop()
      if (!s) return
      m = s.m
      Object.assign(state, { fillStyle: s.fillStyle, strokeStyle: s.strokeStyle, lineWidth: s.lineWidth, font: s.font, textAlign: s.textAlign, textBaseline: s.textBaseline })
    },
    translate(x, y) {
      m = mul(m, [1, 0, 0, 1, x, y])
    },
    rotate(a) {
      const c = Math.cos(a)
      const s = Math.sin(a)
      m = mul(m, [c, s, -s, c, 0, 0])
    },
    clearRect() {},
    fillRect(x, y, w, h) {
      parts.push(`<rect x="${xy(x, y).split(' ')[0]}" y="${xy(x, y).split(' ')[1]}" width="${w * m[0]}" height="${h * m[3]}" fill="${state.fillStyle}"/>`)
    },
    strokeRect(x, y, w, h) {
      const [a, b] = pt(x, y)
      parts.push(`<rect x="${a}" y="${b}" width="${w * m[0]}" height="${h * m[3]}" fill="none" stroke="${state.strokeStyle}" stroke-width="${state.lineWidth}"/>`)
    },
    beginPath() {
      path = ''
    },
    closePath() {
      path += 'Z'
    },
    moveTo(x, y) {
      path += `M${xy(x, y)}`
    },
    lineTo(x, y) {
      path += `L${xy(x, y)}`
    },
    rect(x, y, w, h) {
      const [a, b] = pt(x, y)
      const [c, d] = pt(x + w, y + h)
      path += `M${a.toFixed(2)} ${b.toFixed(2)}L${c.toFixed(2)} ${b.toFixed(2)}L${c.toFixed(2)} ${d.toFixed(2)}L${a.toFixed(2)} ${d.toFixed(2)}Z`
    },
    roundRect(x, y, w, h, r) {
      const [a, b] = pt(x, y)
      const rr = Math.max(0, Math.min(r, w / 2, h / 2)) * m[0]
      parts.push(`<rect x="${a}" y="${b}" width="${w * m[0]}" height="${h * m[3]}" rx="${rr}" ry="${rr}" fill="${state.fillStyle}"/>`)
    },
    arc(cx, cy, r, a0, a1) {
      const steps = 64
      for (let i = 0; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps
        path += `${i === 0 ? 'M' : 'L'}${xy(cx + Math.cos(a) * r, cy + Math.sin(a) * r)}`
      }
    },
    fill() {
      if (path) parts.push(`<path d="${path}" fill="${state.fillStyle}"/>`)
      path = ''
    },
    stroke() {
      if (path) {
        parts.push(
          `<path d="${path}" fill="none" stroke="${state.strokeStyle}" stroke-width="${state.lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
        )
      }
      path = ''
    },
    fillText(text, x, y) {
      // A real canvas paints a newline as nothing; an SVG `<text>` would fold it
      // into a space and print the whole label on one line. The board's own
      // multi-line labels are stacked by *separate* `fillText` calls, so a newline
      // reaching here never happens in the browser — dropping it keeps the
      // recording honest instead of inventing a wide label.
      const value = String(text).replace(/[\r\n]/g, '')
      if (value === '') return
      parts.push(
        `<text x="${xy(x, y).split(' ')[0]}" y="${xy(x, y).split(' ')[1]}" ${fontAttrs(state.font)} fill="${state.fillStyle}" text-anchor="${anchor()}" dominant-baseline="${baseline()}">${esc(value)}</text>`,
      )
    },
    // The same em table `sim/sign.ts` falls back to, so a label is measured the
    // way the layout expects it to be.
    measureText(text) {
      const px = fontPx(state.font)
      let em = 0
      for (const ch of String(text)) {
        const c = ch.codePointAt(0)
        if (c >= 0x2e80) em += 1
        else if (ch === ' ') em += 0.3
        else if (c >= 48 && c <= 57) em += 0.58
        else if (c >= 65 && c <= 90) em += 0.68
        else if (c >= 97 && c <= 122) em += 0.55
        else em += 0.6
      }
      return { width: em * px }
    },
    toSvg() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
    },
    // A pictogram is bitmap art and the board prints it with `drawImage`, so the
    // recorded SVG has to carry the image itself. The box is filled exactly as a
    // canvas would fill it, which for a square mark in a square box is the whole of
    // the picture — `preserveAspectRatio="none"` says so rather than leaving an
    // SVG's default letterboxing to disagree with the canvas.
    drawImage(image, x, y, w, h) {
      const href = typeof image === 'string' ? image : image?.__svgHref
      if (typeof href !== 'string' || !href.startsWith('data:')) return
      const [a, b] = pt(x, y)
      parts.push(
        `<image x="${a.toFixed(2)}" y="${b.toFixed(2)}" width="${w}" height="${h}" preserveAspectRatio="none" href="${href}"/>`,
      )
    },
  }
  // The style properties are plain accessors on the record, so a `g.font = …`
  // reaches the SVG text exactly as it reaches a real canvas.
  for (const key of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin']) {
    Object.defineProperty(g, key, {
      get: () => state[key],
      set: (v) => {
        state[key] = v
      },
    })
  }
  return g
}

const layoutUrl = pathToFileURL(resolve(HERE, '../game/src/sim/sign.ts')).href
const faceUrl = pathToFileURL(resolve(HERE, '../game/src/render/signFace.ts')).href
const { defaultSignLayout, makeSignComponent, nextSignComponentId, signPanelSize, signPlate } = await import(layoutUrl)
const { drawSignPanel, setPictograms } = await import(faceUrl)

const line = (id, name, colour) => ({
  id,
  name,
  colour,
  stock: 'B',
  cars: 6,
  power: 'third-rail',
  headwayProfile: { peak: 150, offpeak: 240, late: 480 },
  alightPerTrain: 420,
  terminus: 'through',
  direction: 'up',
  upTerminus: '',
  downTerminus: '',
  travelSign: 1,
  stations: [],
})
const LINES = [line('1', '1号线', '#0f8a4a'), line('2', '2号线', '#00679e')]

/** The board a fresh palette click hangs, from the station's own first line. */
const fresh = defaultSignLayout({ lines: LINES })

/** Every pictogram, both arrow families and a two-line label, one board. */
let catalogue = defaultSignLayout({ lines: LINES })
for (const [kind, patch] of [
  ['icon', { icon: 'train' }],
  ['icon', { icon: 'lift' }],
  ['icon', { icon: 'accessible' }],
  ['icon', { icon: 'restroom' }],
  ['icon', { icon: 'escalator' }],
  ['icon', { icon: 'stairs' }],
  ['text', { text: '换乘二号线\n请往前走' }],
  ['arrow', { arrow: 'up-left' }],
  ['arrow', { arrow: 'down-right' }],
]) {
  catalogue = [...catalogue, { ...makeSignComponent(kind, nextSignComponentId(catalogue), '2'), ...patch }]
}
// The whole catalogue on one board (which is what makes it the biggest of the
// four), laid out as two rows of small marks.
catalogue = catalogue.map((c, i) => ({ ...c, x: 0.1 + (i % 7) * 0.5, y: i < 7 ? 0.62 : 0.2, scale: 0.5 }))
const tall = [
  ...fresh,
  { id: 't1', kind: 'text', text: '换乘二号线', x: 1.0, y: 0.95, scale: 1, side: 'both' },
  { id: 't2', kind: 'text', text: '请往前走', x: 1.0, y: 0.72, scale: 1, side: 'both' },
]
const wide = [
  { id: 'w0', kind: 'arrow', arrow: 'left', x: 0.32, y: 0.35, scale: 1, side: 'both' },
  { id: 'w1', kind: 'text', text: '3号线', x: 1.0, y: 0.35, scale: 1.3, side: 'both' },
  { id: 'w2', kind: 'icon', icon: 'restroom', x: 1.75, y: 0.35, scale: 1, side: 'both' },
  { id: 'w3', kind: 'icon', icon: 'escalator', x: 2.3, y: 0.35, scale: 1, side: 'both' },
  { id: 'w4', kind: 'arrow', arrow: 'right', x: 3.1, y: 0.35, scale: 1, side: 'both' },
]

/**
 * The pictograms, as `drawImage` sources: each asset as a data URL the recorded
 * SVG can carry. The marks are white ink on a transparent ground, and the board's
 * own near-black plate shows through — exactly what the canvas does.
 */
const icons = new Map()
for (const name of ['train', 'lift', 'accessible', 'restroom', 'escalator', 'stairs']) {
  const png = readFileSync(resolve(HERE, `../game/src/assets/pictograms/${name}.png`))
  icons.set(name, { __svgHref: `data:image/png;base64,${png.toString('base64')}` })
}
setPictograms(icons)

const rows = [
  ['a fresh 指示牌 (the floor)', fresh],
  ['grown taller by two lines', tall],
  ['grown wider by a run of marks', wide],
  ['the whole catalogue on one board', catalogue],
]
const out = process.argv[2] ?? 'sign-panel.png'
const tiles = []
let sheetH = 0
for (const [, layout] of rows) {
  const panel = signPanelSize(layout)
  const plate = signPlate(panel)
  const g = recordingContext(plate.width, plate.height)
  drawSignPanel(g, layout, { lines: LINES, panel, icons }, 'both')
  tiles.push({ svg: g.toSvg(), y: sheetH, h: plate.height })
  sheetH += plate.height + 8
}
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${sheetH}" viewBox="0 0 1024 ${sheetH}">${tiles
  .map(({ svg, y }) => svg.replace('<svg ', `<svg y="${y}" `).replace(/width="\d+" height="\d+" viewBox="[^"]*"/, ''))
  .join('')}</svg>`

await sharp(Buffer.from(sheet)).png().toFile(out)
console.log(`wrote ${out} (1024x${sheetH}) — ${rows.map((r) => r[0]).join(' / ')}`)
