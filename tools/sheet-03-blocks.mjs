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
import { C, MUL, T, leader, n, sheet, title } from './iso.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-block-cards.mjs` leaves its pixels and its index. */
const CARDS = resolve(repo, process.env.BLOCK_CARDS_DIR ?? join('.preview', 'block-cards'))

const W = 1600
const H = 1220

/** The three columns of the upper half, and the two of the lower. */
const AX = 60
const BX = 600
const CX = 1080
const DX = 60
const EX = 940

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

/**
 * The point on a placed picture that a face's own centre projects to — measured by
 * the camera that rendered it, so a leader lands on the surface and not near it.
 */
function mark(piece, rect, face) {
  const at = piece.anchors?.[face]
  if (!at) return null
  return [rect.x + at[0] * rect.w, rect.y + at[1] * rect.h]
}

/** The `<image>` for a placed picture. */
const draw = (piece, rect) =>
  `<image x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}" href="${piece.href}"/>`

/** A figure's own caption, centred under it. */
const caption = (rect, text, size = 12) => T(rect.x + rect.w / 2, rect.y + rect.h + 20, text, { size, fill: DIM, anchor: 'middle' })

/** A legend row: a colour chip and its line. */
const row = (x, y, col, text, size = 13) =>
  `<rect x="${n(x)}" y="${n(y - 11)}" width="14" height="14" rx="3.5" fill="${col}"/>` + T(x + 24, y, text, { size, fill: '#c3d0de', weight: 600 })

/**
 * One plan diagram: the cells a shape occupies in a 3 × 3 grid, with the faces that
 * are **open to the air** drawn in the accent.
 *
 * This is the whole of the join rule, and it is a rule about a *side*: a side with
 * a solid cell beside it is drawn as nothing at all — no wall — which is why a run of
 * blocks comes out as one flat plane with no seam down it. The faint strokes are only
 * the grid, so the reader can see where two cells meet and that nothing is drawn there.
 */
function plan(x, y, cells, label, o = {}) {
  const S = o.cell ?? 32
  const pad = 14
  const size = 3 * S + pad * 2
  const out = []
  const has = (cx, cy) => cells.some(([a, b]) => a === cx && b === cy)
  const gx = (cx) => x + pad + cx * S
  const gy = (cy) => y + pad + cy * S

  out.push(`<rect x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" rx="12" fill="#0f1620" stroke="#25303d"/>`)
  for (const [cx, cy] of cells) {
    out.push(
      `<rect x="${n(gx(cx))}" y="${n(gy(cy))}" width="${S}" height="${S}" fill="#243040" stroke="#33414f" stroke-width="1"/>`,
    )
  }
  // A face with nothing solid across it: this is what gets a wall.
  const edge = (x1, y1, x2, y2) =>
    `<path d="M${n(x1)},${n(y1)} L${n(x2)},${n(y2)}" stroke="${C.yellow}" stroke-width="3.4" stroke-linecap="round" fill="none"/>`
  for (const [cx, cy] of cells) {
    if (!has(cx, cy - 1)) out.push(edge(gx(cx), gy(cy), gx(cx + 1), gy(cy)))
    if (!has(cx + 1, cy)) out.push(edge(gx(cx + 1), gy(cy), gx(cx + 1), gy(cy + 1)))
    if (!has(cx, cy + 1)) out.push(edge(gx(cx), gy(cy + 1), gx(cx + 1), gy(cy + 1)))
    if (!has(cx - 1, cy)) out.push(edge(gx(cx), gy(cy), gx(cx), gy(cy + 1)))
  }
  out.push(T(x + size / 2, y - 10, label, { size: 12.5, fill: '#cdd8e4', anchor: 'middle', weight: 700 }))
  if (o.sub) out.push(T(x + size / 2, y + size + 18, o.sub, { size: 11.5, fill: DIM, anchor: 'middle' }))
  return { svg: out.join(''), size, y: y + size + (o.sub ? 34 : 18) }
}

/** One block, in the numbers the mesher works in. */
const CELL = 1

/**
 * The block's section, drawn **square**: the walls run from the floor to the top face and
 * the rim is the cell's own edge. It used to draw the 12.5 cm top-rim chamfer the mesher cut
 * off every exposed top edge; that cut is gone (`render/chunkMesher.ts` `buildProfile`), so
 * what is left to read is one 1 × 1 m square. `ppx` is the scale, `base` the baseline.
 */
function profile(x, base, ppx) {
  const z = (m) => base - m * ppx
  const w = CELL * ppx
  const top = z(CELL)
  const out = []
  // One body, one fill: the walls and the top face are one mass of material, and the top
  // face carries the floor finish the picture's own block wears.
  out.push(`<path d="M${n(x)},${n(base)} L${n(x)},${n(top)} L${n(x + w)},${n(top)} L${n(x + w)},${n(base)} Z" fill="${C.floor}"/>`)
  // What the profile is *about*: two walls running the whole way up to the top face, and
  // the square corner where each of them meets it.
  out.push(`<path d="M${n(x)},${n(base)} L${n(x)},${n(top)} L${n(x + w)},${n(top)} L${n(x + w)},${n(base)}" fill="none" stroke="${C.yellow}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>`)
  // The floor line, which is the block's own base rather than an edge of the piece.
  out.push(`<path d="M${n(x)},${n(base)} L${n(x + w)},${n(base)}" fill="none" stroke="${DIM}" stroke-width="1.8" stroke-linecap="round"/>`)
  out.push(T(x + w / 2, top - 12, '顶面  =  地板', { size: 11.5, fill: DIM, anchor: 'middle' }))
  out.push(T(x + w / 2, z(CELL / 2) + 4, '1 × 1 米', { size: 12, fill: DIM, anchor: 'middle', mono: true }))
  const dim = (x1, y1, x2, y2, text, lx, ly) =>
    `<path d="M${n(x1)},${n(y1)} L${n(x2)},${n(y2)}" stroke="${C.yellow}" stroke-width="1.4" fill="none"/>` +
    `<path d="M${n(x1 - 5)},${n(y1)} L${n(x1 + 5)},${n(y1)} M${n(x2 - 5)},${n(y2)} L${n(x2 + 5)},${n(y2)}" stroke="${C.yellow}" stroke-width="1.4" fill="none"/>` +
    T(lx, ly, text, { size: 11.5, fill: C.yellow, anchor: 'middle', mono: true })
  out.push(dim(x, base + 26, x + w, base + 26, '1.0 m', x + w / 2, base + 44))
  // The height, dimensioned on the block's other side: the profile is a square, which is
  // the whole point of the drawing.
  out.push(
    `<path d="M${n(x - 26)},${n(base)} L${n(x - 26)},${n(top)}" stroke="${C.yellow}" stroke-width="1.4" fill="none"/>` +
      `<path d="M${n(x - 31)},${n(base)} L${n(x - 21)},${n(base)} M${n(x - 31)},${n(top)} L${n(x - 21)},${n(top)}" stroke="${C.yellow}" stroke-width="1.4" fill="none"/>` +
      T(x - 40, z(CELL / 2) + 4, '1.0 m', { size: 11.5, fill: C.yellow, anchor: 'middle', mono: true }),
  )
  return out.join('')
}

/* -------------------------------------------------------------------- sheet */

export function artBlocks() {
  const { pieces, finishes } = loadBlocks()
  const get = (id) => {
    const p = pieces.get(id)
    if (!p) throw new Error(`the capture has no \`${id}\` — re-run tools/render-block-cards.mjs`)
    return p
  }
  const g = []

  g.push(
    title(
      48,
      62,
      '六面方块',
      '一米见方的一格，六个面各带一种材质，每条边都是直角。和实心邻居贴着的面什么都不画，顶面就拼成一整片。',
    ),
  )

  /* ---------------- A. one cell, six faces ---------------- */
  g.push(T(AX, 190, 'A.  一个格 = 六个面', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }))
  g.push(T(AX, 214, '1 × 1 × 1 米。面是材质挂的地方：顶面当地板，底面当天花，四面当墙。', { size: 13, fill: NOTE }))

  const block = get('block')
  const blockBelow = get('block-below')
  const rb = place(block, AX, 244, 250, 216)
  const rd = place(blockBelow, AX, 500, 250, 216)
  g.push(draw(block, rb))
  g.push(draw(blockBelow, rd))
  g.push(caption(rb, '从上面看：顶面和两个侧面'))
  g.push(caption(rd, '从下面看：同一格，底面'))

  // The three roles a face can take, each leader landing on the face it names.
  const LX = AX + 268
  const roles = [
    ['top', C.yellow, '顶面  →  地板', '盲道和分区铺在顶面。'],
    ['east', C.pink, '4 个侧面  →  墙体', '可以贴墙面装饰。'],
    ['bottom', C.teal, '底面  →  天花板', '可以铺设天花板。'],
  ]
  for (const [face, col, text, sub] of roles) {
    const piece = face === 'bottom' ? blockBelow : block
    const rect = face === 'bottom' ? rd : rb
    const at = mark(piece, rect, face)
    const ly = face === 'bottom' ? 640 : face === 'top' ? 300 : 372
    g.push(leader(LX - 8, ly - 4, at[0], at[1], col))
    g.push(row(LX, ly, col, text))
    g.push(T(LX + 24, ly + 20, sub, { size: 11.5, fill: DIM }))
  }
  g.push(
    MUL(LX, 452, [
      '每个面都能单独选择材质。',
      '顶面铺地板，底面铺天花板，',
      '四个侧面组成墙。',
    ], { size: 12.5, fill: NOTE, lh: 20 }),
  )

  /* ---------------- B. a shared side is not drawn ---------------- */
  g.push(T(BX, 190, 'B.  相邻的面就没了', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }))
  g.push(T(BX, 214, '相邻方块会自动拼合，接缝处不会多出内墙。', { size: 13, fill: NOTE }))

  const p1 = plan(BX, 254, [[1, 1]], '一个方块', { sub: '四面都暴露' })
  const p2 = plan(BX + 144, 254, [[1, 1], [2, 1], [1, 2], [2, 2]], '2 × 2', { sub: '只有外圈' })
  const p3 = plan(BX + 288, 254, [[1, 1], [2, 1], [1, 2]], 'L 形', { sub: '凹角也一样' })
  g.push(p1.svg, p2.svg, p3.svg)
  g.push(T(BX, 428, '黄线 = 会画墙的暴露面；灰线只是格子边界。', { size: 11.5, fill: DIM }))

  const floor = get('floor')
  const rf = place(floor, BX, 452, 296, 170)
  g.push(draw(floor, rf))
  g.push(
    MUL(BX, 648, [
      '地面连续铺开，墙只沿外圈升起，',
      '转角保持方正。',
    ], { size: 12.5, fill: NOTE, lh: 20 }),
  )

  /* ---------------- C. what one cell can be cut into ---------------- */
  g.push(T(CX, 190, 'C.  一格可以切成什么', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }))
  g.push(T(CX, 214, '还有半墙和上下三角块。', { size: 13, fill: NOTE }))

  const half = get('half')
  const triUp = get('tri-upper')
  const triLo = get('tri-lower')
  const rh = place(half, CX, 252, 240, 176)
  g.push(draw(half, rh))
  g.push(caption(rh, '半墙：同一米高，半个格厚'))
  const ru = place(triUp, CX, 500, 188, 168)
  const rl = place(triLo, CX + 204, 500, 188, 168)
  g.push(draw(triUp, ru), draw(triLo, rl))
  g.push(caption(ru, '上三角块：平面留在地上'))
  g.push(caption(rl, '下三角块：平面贴在天花上'))
  g.push(
    MUL(CX, 712, [
      '三个都是方块工具的一格，不是新形状：半墙把格切掉一半，',
      '三角块按 45° 锯开。楼梯和扶梯还会把底下的方块掏空，',
      '空隙用运行自己的钢板补上，接缝看不出来。',
    ], { size: 12.5, fill: NOTE, lh: 20 }),
  )

  /* ---------------- D. the finishes, as the game files them ---------------- */
  g.push(T(DX, 790, 'D.  材质 —— 游戏里的 12 种', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }))
  g.push(T(DX, 814, '按道具栏 材质 文件夹自己的分组和顺序。色块就是货架上那一格的底色。', { size: 13, fill: NOTE }))

  // The rail's own three blocks, in its own order, read from the capture.
  const groups = []
  for (const f of finishes) {
    if (!groups.length || groups[groups.length - 1].name !== f.group) groups.push({ name: f.group, items: [] })
    groups[groups.length - 1].items.push(f)
  }
  const CELLS = 5
  const PITCH = 146
  const CHIP = 58
  const CHIP_H = 42
  let gy = 862
  for (const grp of groups) {
    g.push(T(DX, gy + 26, grp.name, { size: 12.5, weight: 800, fill: C.teal, ls: 0.6 }))
    grp.items.forEach((f, i) => {
      const cx = DX + 110 + i * PITCH
      const px0 = cx + (PITCH - CHIP) / 2 - 36
      g.push(`<rect x="${n(px0)}" y="${n(gy)}" width="${CHIP}" height="${CHIP_H}" rx="8" fill="${f.tint}" stroke="#0b0e13" stroke-width="2"/>`)
      g.push(`<rect x="${n(px0)}" y="${n(gy)}" width="${CHIP}" height="9" rx="4" fill="${shadeOf(f.tint)}"/>`)
      g.push(T(cx, gy + CHIP_H + 17, f.label, { size: 12, fill: '#dbe4ee', anchor: 'middle', weight: 600 }))
      const use = valueOf(f)
      if (use) g.push(T(cx, gy + CHIP_H + 33, use, { size: 10.5, fill: DIM, anchor: 'middle', mono: true }))
    })
    gy += 112
  }
  g.push(
    T(DX, 1196, `材质里只有搪瓷板带子菜单：它能刷成任意颜色，其余 ${finishes.length - 1} 种都穿固定的底色。`, { size: 11.5, fill: DIM }),
  )

  /* ---------------- E. the profile, and what merges ---------------- */
  g.push(T(EX, 790, 'E.  方块剖面', { size: 15, weight: 800, fill: C.yellow, ls: 1.4 }))
  g.push(profile(EX + 30, 1010, 180))

  const NX = EX + 240
  g.push(
    MUL(NX, 826, [
      '一格的剖面就是一个 1 × 1 米的正方形：',
      '墙从地面砌到顶面，四个角都是直角，没有',
      '倒角，也没有圆角。顶面铺的是地板那份材质，',
      '墙和地面在格子边上直接相交。',
    ], { size: 12.5, fill: NOTE, lh: 20 }),
  )
  g.push(
    MUL(NX, 918, [
      '相邻方块贴合后，共用的内墙会隐藏，',
      '地面连成一片。盲道、标识和分区',
      '会显示在地面上，帮助乘客认路。',
    ], { size: 12.5, fill: DIM, lh: 20 }),
  )

  const room = get('room')
  const rr = place(room, NX, 1024, 240, 150)
  g.push(draw(room, rr))
  g.push(caption(rr, '花岗岩地面、涂料墙、搪瓷板墙，三种材质同处一格'))

  return sheet(W, H, g.join(''))
}

/** The lit rim on a swatch, so a flat tint still reads as a surface. */
function shadeOf(hex) {
  const v = hex.replace('#', '')
  const c = (i) => Math.min(255, Math.round(Number.parseInt(v.slice(i, i + 2), 16) * 1.18))
  return `rgb(${c(0)},${c(2)},${c(4)})`
}

/**
 * What the simulation reads off a finish, in one line — computed from the row's own
 * numbers rather than written here, so a retuned walk speed or a re-covered ceiling
 * changes this line by itself.
 */
function valueOf(f) {
  if (f.family === 'wall') return f.id === 'wall.enamel' ? '可调色' : ''
  if (f.family === 'ceiling') return ''
  if (f.speed === 0) return '不可通行'
  return '可通行'
}
