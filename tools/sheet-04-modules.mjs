// Concept 04 — the module catalogue.
//
// This sheet draws the game's own pieces, and it does not draw them: every image
// on it is a PNG the **game** rendered, through the same pass the build rail uses
// (`game/src/app/moduleThumbnails.ts`), captured by `tools/render-module-cards.mjs`
// into `.preview/module-cards/`. So a card is the tile a player clicks — the same
// geometry, the same camera, the same lights, tone mapping and canvas textures —
// and this file is only the reading layer: the frame, the name, the footprint and
// what the simulation does with the piece.
//
// That division is the point. Nothing here states what a piece looks like, what it
// is called, how big it is or what it does:
//
//   * the pictures come from the game's renderer;
//   * the labels, footprints and grouping come from the palette (`catalog.ts`) and
//     from the pieces' own dimensions, carried in the capture's `index.json`;
//   * the throughput lines come from `sim/constants.ts`, also via the capture.
//
// A piece the game gains appears here without an edit, and a card cannot drift from
// the piece it claims to be, because it is a photograph of it.
//
// Nothing here moves. The catalogue is a reference, and a piece that animated in
// its card would read as a demo rather than a specimen.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { C, T, title, sheet } from './iso.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-module-cards.mjs` leaves its pixels and its index. */
const CARDS = resolve(repo, process.env.MODULE_CARDS_DIR ?? join('.preview', 'module-cards'))

/** Cards per row, and the card's own frame. */
/**
 * The grid: six to a row, which is the shape this sheet has always had and the
 * roomiest one for the growing catalogue. The card's own frame lives here, and
 * the window a model is drawn into is the rest of it.
 */
const COLS = 6
const CW = 248
const CH = 268
const BOX_W = CW - 28
const BOX_H = 176

const X0 = 48
const Y0 = 196
const GAP_X = 8
const GAP_Y = 12

const W = X0 * 2 + COLS * CW + (COLS - 1) * GAP_X

/**
 * What a card carries, by what the piece is for. The capture marks every card with
 * the game's own answer (`decor`, from `isDecorType`), and that is the only division
 * this sheet draws: the grid is one list of pieces, so nothing else separates a
 * machine from a seat. Gear you route passengers through is blue; a piece that only
 * dresses the space is orange.
 */
const GEAR = C.blue
const DECOR = C.orange

/** Roughly how wide a caption is, in the sheet's own units: CJK a full em, latin a half. */
const textWidth = (s, size) => [...String(s)].reduce((w, ch) => w + (/[\u2e80-\uffef]/.test(ch) ? 1 : 0.55), 0) * size

/**
 * The captured cards, or a clear failure. The render needs a browser and the game's
 * build, so it is a separate step by design (`tools/render-module-cards.mjs`); a
 * sheet that silently drew nothing would be worse than one that stops.
 */
function loadCards() {
  const indexPath = join(CARDS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(
      `no rendered cards in ${CARDS} — run:\n  npm run build:game\n  node tools/render-module-cards.mjs`,
    )
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const cards = index.cards.map((card) => {
    const file = join(CARDS, card.file)
    if (!existsSync(file)) throw new Error(`card image is missing: ${card.file}`)
    return { ...card, href: `data:image/png;base64,${readFileSync(file).toString('base64')}` }
  })
  return { width: index.width, height: index.height, cards }
}

/* -------------------------------------------------------------------- sheet */

export function artModules() {
  const { width, height, cards } = loadCards()
  const g = []

  g.push(
    title(
      X0,
      62,
      '可以放进车站的东西',
      '用闸机、扶梯和电梯组织客流，再用家具与标识装点车站。',
    ),
  )

  // One flat grid in the capture's own order, with no heading over it: this one list
  // holds both of the rail's folders — the machines that move the crowd and the
  // seating, signage and shop furniture that dresses the space — so a single heading
  // could only misname what stands under it. What tells the two apart on the sheet is
  // each card's own strip (`GEAR` / `DECOR`).
  const gridY = Y0
  const rows = Math.ceil(cards.length / COLS)

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const accent = card.decor ? DECOR : GEAR
    const cx = X0 + (i % COLS) * (CW + GAP_X)
    const cy = gridY + Math.floor(i / COLS) * (CH + GAP_Y)

    g.push(`<rect x="${cx}" y="${cy}" width="${CW}" height="${CH}" rx="14" fill="#111926" stroke="#243040"/>`)
    g.push(`<rect x="${cx}" y="${cy}" width="${CW}" height="4" rx="2" fill="${accent}"/>`)
    g.push(`<rect x="${cx + 12}" y="${cy + 12}" width="${BOX_W}" height="${BOX_H}" rx="10" fill="#0d141d"/>`)

    // The piece, as the game rendered it. The capture paints each card at twice
    // the frame it was asked for — so the sheet embeds a 2× image in a 1× box and
    // the browser downsamples it, which is what keeps the edge of a cabinet and
    // the text on a 车票 marquee clean. The frame's nominal size, not the PNG's
    // pixel size, is what decides the layout.
    const ix = cx + 12 + Math.round((BOX_W - width) / 2)
    const iy = cy + 12 + Math.round((BOX_H - height) / 2)
    g.push(`<image x="${ix}" y="${iy}" width="${width}" height="${height}" href="${card.href}"/>`)

    g.push(T(cx + 18, cy + 218, fits(card.label, 16.5, CW - 36), { size: 16.5, weight: 700, fill: '#eaf0f6' }))
    if (card.footprint !== '1 × 1 格') g.push(T(cx + 18, cy + 240, card.footprint, { size: 12.5, fill: accent, mono: true }))
    g.push(T(cx + 18, cy + 258, fits(card.service.replace('装饰，无通行', '装点车站').replace('信息屏，无通行', '显示信息').replace('无服务，被动吸引', '吸引乘客停留'), 12, CW - 30), { size: 12, fill: '#8fa0b3' }))
  }

  const foot = gridY + rows * (CH + GAP_Y) + 30
  return sheet(W, Math.max(1220, foot + 12), g.join(''))
}

/**
 * A caption that fits its card. The palette's own labels run longer than the old
 * sheet's, and an overflowed caption would collide with the next card, so the
 * widest ones are trimmed with an ellipsis rather than allowed to run out.
 */
function fits(text, size, width) {
  const s = String(text)
  if (textWidth(s, size) <= width) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > width) break
    out += ch
  }
  return out + '…'
}
