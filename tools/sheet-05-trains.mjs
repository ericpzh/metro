// Concept sheet 05 — the rolling stock's numbers, and what they ask of a station.
//
// Sheet 11 is the shape; this is the parametric read, and its two drawings per class are
// the game's own car: a **frontal** and a **side elevation**, rendered square-on by
// `tools/render-train-cards.mjs` through `buildTrain`. Square-on matters — the pass is
// orthographic and every class is framed in one fixed box, so pixel distances are
// metres and the four cars compare at one scale. That is what lets the dimension lines
// below land where the dimensions are.
//
// Train and screen-door numbers come from the simulation's stock and constants modules.
// Power and typical use are summarized from GAME-SPEC §6.1 because they are not stored
// in the simulation's class table.
//
// The real door leaves and headlights cycle; the body, camera and dimensions stay fixed.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { T, MUL, n, sheet, title } from './iso.mjs'
import { STOCK, STOCK_CLASSES, trainLength, trainRatedCapacity } from '../game/src/sim/stock.ts'
import { loadTrainAnimation, animatedTrain } from './train-animation.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-train-cards.mjs` leaves its pixels and its index. */
const CARDS = resolve(repo, process.env.TRAIN_CARDS_DIR ?? join('.preview', 'train-cards'))

/** The game's own palette, from the custom properties in `game/src/styles.css`. */
const G = {
  line: '#1d3b58',
  text: '#d6e7f7',
  muted: '#7ea6c9',
  accent: '#55b6ff',
  ink: '#8fc4ee',
  warn: '#ffc861',
  yellow: '#f2b32c',
}

const W = 1600
/** A PNG's pixel size, straight out of its IHDR. */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24)
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

function loadCars() {
  const indexPath = join(CARDS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(
      `no rendered rolling stock in ${CARDS} — run:\n  npm run build:game\n  node tools/render-train-cards.mjs`,
    )
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const pieces = new Map()
  for (const piece of index.pieces) {
    const file = join(CARDS, piece.file)
    if (!existsSync(file)) throw new Error(`train image is missing: ${piece.file}`)
    pieces.set(piece.id, {
      ...piece,
      px: pngSize(file),
      href: `data:image/png;base64,${readFileSync(file).toString('base64')}`,
    })
  }
  return { pieces, livery: index.livery, cabin: index.cabin }
}

/* -------------------------------------------------------------------- sheet */

export function artTrains() {
  const poses = loadTrainAnimation()
  const { pieces, livery } = loadCars()
  const paint = new Map(livery.map(l => [l.cls, l]))
  const image = (piece, x, y, w) => {
    const h = w * piece.px.height / piece.px.width
    return animatedTrain(poses, piece.id, x, y, w, h)
      ?? `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${piece.href}"/>`
  }
  const g = [title(48, 62, '选列车，也在选站台的规模', '四种车型按同一比例展示。编组越长，载客越多，也需要更长的站台。')]
  STOCK_CLASSES.forEach((cls, i) => {
    const s = STOCK[cls], y = 152 + i * 212
    const col = paint.get(cls)?.colour ?? G.accent
    g.push(`<rect x="48" y="${y}" width="1504" height="196" rx="12" fill="#111926" stroke="#243040"/>`)
    g.push(T(72, y + 40, `${cls} 型`, { size: 27, weight: 800, fill: col }))
    g.push(MUL(72, y + 78, [
      `编组 ${s.consist[0]}–${s.consist[1]} 节`,
      `6 节额定载客 ${trainRatedCapacity({ stock: cls, cars: 6 })} 人`,
      `6 节总长 ${trainLength({ stock: cls, cars: 6 }).toFixed(1)} 米`,
    ], { size: 17, fill: G.text, lh: 29 }))
    g.push(image(pieces.get(`front-${cls}`), 388, y + 26, 128))
    g.push(image(pieces.get(`side-${cls}`), 580, y + 28, 940))
  })
  g.push(T(48, 1054, '装不下的乘客会留在站台。看「滞留」，再调整车型或编组。', { size: 22, weight: 700, fill: G.warn }))
  g.push(T(48, 1094, '每条线路可单独设置供电、站台门、颜色和终点。', { size: 18, fill: G.muted }))
  return sheet(W, 1140, g.join(''))
}
