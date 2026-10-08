// Concept 03 — the block system.
//
// Every picture on this sheet is a PNG the **game** rendered: real cells through the
// game's own chunk mesher (`render/chunkMesher.ts`), wearing the game's own finish
// materials (`render/materials.ts`), captured by `tools/render-block-cards.mjs` into
// `.preview/block-cards/`. So the square rim, the seam-free floor and the speckled
// granite are the ones a player sees, rather than a drawing of them that has to be kept
// in step by hand.
//
// The material table is the game's too. The capture carries
// `finishPaletteGroups()` out of `sim/finishes.ts` — the very function the rail's
// 材质 folder builds its palette from — so a finish cannot be renamed, retuned or
// re-filed without this sheet following, and every number printed here is a number
// the simulation obeys.
//
// What is left for this file is the reading layer: the frame, the names, and the
// one diagram that says which faces the mesher draws. Where a label points at a
// picture it points at a point the **capture** projected through the camera that
// rendered it, so a leader cannot drift off the surface it names.
//
// Nothing here moves: the block system is a reference, and a picture that animated
// would read as a demo rather than as a specimen.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { C, T, n, sheet, title } from './iso.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-block-cards.mjs` leaves its pixels and its index. */
const CARDS = resolve(repo, process.env.BLOCK_CARDS_DIR ?? join('.preview', 'block-cards'))

const W = 1600
const DIM = '#7d8ea3'
const NOTE = '#93a1b3'

/**
 * The captured pictures, or a clear failure.
 *
 * The render needs a browser and the game's build, so it is a separate step by
 * design (`tools/render-block-cards.mjs`); a sheet that silently drew nothing would
 * be worse than one that stops.
 */
function loadBlocks() {
  const indexPath = join(CARDS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(
      `no rendered blocks in ${CARDS} — run:\n  npm run build:game\n  node tools/render-block-cards.mjs`,
    )
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const pieces = new Map()
  for (const piece of index.pieces) {
    const file = join(CARDS, piece.file)
    if (!existsSync(file)) throw new Error(`block image is missing: ${piece.file}`)
    pieces.set(piece.id, { ...piece, href: `data:image/png;base64,${readFileSync(file).toString('base64')}` })
  }
  return { pieces, finishes: index.finishes }
}

/* ------------------------------------------------------------------ helpers */

/**
 * Where a picture lands inside a box, keeping the shape of its own frame.
 *
 * The capture chooses the pixel size it needs; the sheet chooses the box it wants
 * the picture in. Neither is allowed to dictate the other, so a picture is fitted
 * into its box rather than stretched to it, and the layout below can be rearranged
 * without re-rendering anything.
 */
function place(piece, x, y, w, h) {
  const a = piece.width / piece.height
  const boxAspect = w / h
  const dw = boxAspect > a ? h * a : w
  const dh = boxAspect > a ? h : w / a
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh }
}

/** The `<image>` for a placed picture. */
const draw = (piece, rect) =>
  `<image x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}" href="${piece.href}"/>`

/** A figure's own caption, centred under it. */
const caption = (rect, text, size = 12) => T(rect.x + rect.w / 2, rect.y + rect.h + 20, text, { size, fill: DIM, anchor: 'middle' })

/* -------------------------------------------------------------------- sheet */

export function artBlocks() {
  const { pieces, finishes } = loadBlocks()
  const get = id => {
    const p = pieces.get(id)
    if (!p) throw new Error(`missing block capture: ${id}`)
    return p
  }
  const g = [title(48, 62, '用一米方块，搭出自己的车站', '拼出地板、墙和天花板，再用半墙、斜块与材质调整空间。')]
  const figures = [
    ['block', 48, '1  每个面，单独换材质', '顶面是地板，侧面是墙，底面是天花板。'],
    ['floor', 556, '2  连着铺，拼成整片地面', '相邻方块自动拼合，接缝处不会多出墙。'],
    ['room', 1064, '3  地板和墙，可以各有颜色', '搪瓷板支持调色，做出车站自己的风格。'],
  ]
  figures.forEach(([id, x, label, note]) => {
    const p = get(id), r = place(p, x, 152, 460, 280)
    g.push(draw(p, r), T(x, 485, label, { size: 21, weight: 800, fill: C.yellow }))
    g.push(T(x, 518, note, { size: 17, fill: NOTE }))
  })
  const shapes = [['half', '半墙'], ['tri-upper', '上三角块'], ['tri-lower', '下三角块']]
  shapes.forEach(([id, label], i) => {
    const p = get(id), r = place(p, 48 + i * 248, 590, 220, 170)
    g.push(draw(p, r), caption(r, label, 17))
  })
  g.push(T(48, 850, '半墙与斜块，让角落和边界更灵活。', { size: 18, fill: NOTE }))
  g.push(T(850, 605, '地面、墙面、天花板材质', { size: 21, weight: 800, fill: C.yellow }))
  finishes.forEach((f, i) => {
    const x = 850 + (i % 4) * 174, y = 642 + Math.floor(i / 4) * 86
    g.push(`<rect x="${x}" y="${y}" width="52" height="32" rx="5" fill="${f.tint}"/>`)
    g.push(T(x, y + 55, f.label, { size: 15, fill: '#dbe4ee' }))
  })
  g.push(T(850, 914, '轨道床和覆土不能通行，步行通路要铺可通行地面。', { size: 15, fill: NOTE }))
  return sheet(W, 950, g.join(''))
}
