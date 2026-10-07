// Concept sheet 11 — the rolling stock in 3D.
//
// Sheet 05 gives the numbers; this sheet is the shape, and the shape is the game's:
// every picture is `buildTrain` — the consist the game runs down a platform — built
// with the model kit's own materials and captured by `tools/render-train-cards.mjs`
// into `.preview/train-cards/`. So the rounded body, the glazing band, the livery
// broken at every doorway, the sliding leaves, the lining behind the seats and the two
// bogies are the ones a player watches a crowd board.
//
// The **table** is the simulation's, not a transcription: the capture carries
// `stockTable()` and `cabinFacts()` out of `sim/stock.ts`, so a retuned car — a longer
// body, another door, a different capacity — arrives on this sheet by itself, and a
// dimension printed here is one the spawn, the screen doors and the timetable read.
//
// Nothing on this sheet draws a train. Where it points at one, it points with a
// leader at a part of the picture rather than at a shape of its own.
//
// It does not move: a rolling-stock sheet is a reference, and a car that animated
// would read as a demo rather than as the stock.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUL, T, n, sheet, title } from './iso.mjs'

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
}

const W = 1600

/** The four class specimens, across the top. */
const CAR_W = 360
const CAR_PITCH = 372
const CAR_X = 48

/** A PNG's pixel size, straight out of its IHDR. */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24)
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

/**
 * The pictures and the table, or a clear failure.
 *
 * The render needs a browser and the game's build, so it is a separate step by design
 * (`tools/render-train-cards.mjs`); a sheet that silently drew nothing would be worse
 * than one that stops.
 */
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
      // The capture supersamples at 2×, so a picture's own pixels are twice the size
      // it is drawn at; the crop a wide frame carries is already in those pixels.
      px: pngSize(file),
      href: `data:image/png;base64,${readFileSync(file).toString('base64')}`,
    })
  }
  return { pieces, stock: index.stock, cabin: index.cabin, livery: index.livery }
}

/* -------------------------------------------------------------------- sheet */

export function artTrains3D() {
  const { pieces, stock, cabin, livery } = loadCars()
  const paint = new Map(livery.map((l) => [l.cls, l]))
  const car = (id) => {
    const p = pieces.get(id)
    if (!p) throw new Error(`the capture has no \`${id}\` — re-run tools/render-train-cards.mjs`)
    return p
  }
  const image = (piece, x, y, w = piece.px.width / 2, h = piece.px.height / 2) =>
    `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${piece.href}"/>`
  const head = (x, y, text, col = G.accent) => T(x, y, text, { size: 12.5, weight: 800, fill: col, ls: 1.2 })

  const g = []
  g.push(
    title(
      48,
      62,
      '四个等级，四种车体',
      '圆角车体、玻璃带、在门口断开的涂装、两扇滑门、车里的座椅，和两条转向架。第 05 张给参数，这张给形状。',
    ),
  )

  /* ---------------- the four classes ---------------- */
  g.push(head(48, 186, '四个等级'))
  stock.forEach((s, i) => {
    const x = CAR_X + i * CAR_PITCH
    const piece = car(`car-${s.cls}`)
    const l = paint.get(s.cls) ?? { line: '?', colour: G.muted }
    g.push(T(x, 220, `${s.cls} 型`, { size: 22, weight: 800, fill: G.text }))
    g.push(
      T(x + 72, 220, `${s.length.toFixed(1)} × ${s.width.toFixed(1)} × ${s.height.toFixed(1)} 米`, {
        size: 12,
        fill: G.muted,
        mono: true,
      }),
    )
    g.push(image(piece, x, 234, CAR_W, (CAR_W / piece.px.width) * piece.px.height))
    // The livery, named as the line whose sign colour it is, so a reader can check it
    // against the game's own table rather than take the swatch on trust.
    g.push(`<rect x="${n(x)}" y="${n(404)}" width="22" height="9" rx="2" fill="${l.colour}" stroke="#0b0e13" stroke-width="1"/>`)
    g.push(T(x + 30, 412, `${l.line} 号线标志色 ${l.colour.toUpperCase()}`, { size: 11.5, fill: G.muted, mono: true }))
    g.push(
      T(x, 430, `每侧 ${s.doorsPerSide} 门 · 门宽 ${s.doorWidth.toFixed(1)} 米 · 门距 ${s.doorPitch ?? '—'} 米`, {
        size: 11.5,
        fill: G.muted,
        mono: true,
      }),
    )
  })

  /* ---------------- the table the simulation reads ---------------- */
  const COLS = [
    ['等级', 48, 60],
    ['车体  长 × 宽 × 高', 130, 240],
    ['每侧门', 390, 110],
    ['单节定员  座 / 拥挤', 520, 210],
    ['编组', 750, 90],
    ['受电', 860, 90],
    ['6 节  长 / 定员', 970, 240],
    ['门中心距端头', 1230, 150],
  ]
  let ty = 486
  g.push(`<rect x="48" y="${n(ty - 18)}" width="1404" height="1" fill="${G.line}"/>`)
  for (const [label, x] of COLS) g.push(T(x, ty, label, { size: 11, fill: G.muted, weight: 700 }))
  ty += 10
  g.push(`<rect x="48" y="${n(ty)}" width="1404" height="1" fill="${G.line}"/>`)
  stock.forEach((s) => {
    ty += 24
    const l = paint.get(s.cls) ?? { line: '?', colour: G.muted }
    g.push(`<rect x="48" y="${n(ty - 9)}" width="22" height="9" rx="2" fill="${l.colour}" stroke="#0b0e13" stroke-width="1"/>`)
    const cells = [
      [`${s.cls} 型`, G.text, 1],
      [`${s.length.toFixed(1)} × ${s.width.toFixed(1)} × ${s.height.toFixed(1)} 米`, G.muted, 0],
      [`${s.doorsPerSide} 门 × ${s.doorWidth.toFixed(1)} 米`, G.muted, 0],
      [`${s.ratedPerCar} / ${s.crushPerCar} 人`, G.muted, 0],
      [`${s.consist[0]} – ${s.consist[1]} 节`, G.muted, 0],
      [s.power, s.power === '接触网' ? G.warn : G.ink, 0],
      [`${s.sixCarLength.toFixed(1)} 米 / ${s.sixCarRated} 人`, G.muted, 0],
      [`${cabin.endInset} 米`, G.muted, 0],
    ]
    cells.forEach(([text, col, bold], i) => {
      const x = COLS[i][1]
      g.push(
        T(i === 0 ? x + 30 : x, ty, String(text), {
          size: 12.5,
          fill: String(col),
          mono: i !== 0,
          weight: bold ? 800 : 0,
        }),
      )
    })
  })
  ty += 12
  g.push(`<rect x="48" y="${n(ty)}" width="1404" height="1" fill="${G.line}"/>`)
  g.push(
    T(48, ty + 20, '涂装只是把四个等级分开：一条线用哪个颜色由玩家挑，和车型没有绑定。这四种都是广州地铁的标志色。', {
      size: 11.5,
      fill: G.muted,
    }),
  )

  /* ---------------- the whole consist ---------------- */
  const consist = car('consist')
  const demo = stock.find((s) => s.cls === 'L') ?? stock[stock.length - 1]
  const bandY = ty + 46
  g.push(head(48, bandY, '整列车'))
  g.push(
    T(
      180,
      bandY,
      `动物园自己跑的那一列：${demo.cls} 型 6 节，5 号线涂装 —— 一列 ${demo.sixCarLength.toFixed(1)} 米。`,
      { size: 12, fill: G.muted },
    ),
  )
  const cw = 1440
  const cx = 48 + (1504 - cw) / 2
  const ch = (cw / consist.px.width) * consist.px.height
  const cy = bandY + 16
  g.push(image(consist, cx, cy, cw, ch))
  // The cab is the far end of the picture, and the only place the model shows one. The
  // label goes in the empty dark under the train's diagonal rather than on the cars.
  const cabX = cx + cw * 0.95
  const cabY = cy + ch * 0.88
  const labX = cx + cw * 0.66
  const labY = cy + ch * 0.96
  g.push(
    `<path d="M${n(labX - 6)},${n(labY - 5)} L${n(cabX)},${n(cabY)}" stroke="${G.warn}" stroke-width="1.6" stroke-dasharray="7 5" fill="none"/>` +
      `<circle cx="${n(cabX)}" cy="${n(cabY)}" r="4.5" fill="${G.warn}"/>` +
      T(labX - 14, labY, '车头，只有灯不同', { size: 12, fill: G.warn, weight: 800, anchor: 'end' }),
  )
  const afterConsist = cy + ch + 18

  /* ---------------- two details ---------------- */
  const detailY = afterConsist + 46
  g.push(head(48, detailY, '开着门'))
  g.push(head(640, detailY, '车头'))
  const open = car('open')
  const nose = car('nose')
  const ow = 520
  g.push(image(open, 48, detailY + 16, ow, (ow / open.px.width) * open.px.height))
  const nw = 460
  g.push(image(nose, 640, detailY + 16, nw, (nw / nose.px.width) * nose.px.height))
  const detailBottom = detailY + 16 + Math.max((ow / open.px.width) * open.px.height, (nw / nose.px.width) * nose.px.height)

  /* ---------------- the cabin both the model and the sim use ---------------- */
  g.push(head(1160, detailY, '车厢里能站人'))
  g.push(
    MUL(1160, detailY + 28, [
      `地板在 ${cabin.floor} 米，门口净高 ${cabin.doorClear} 米`,
      `（${cabin.doorSill} – ${cabin.doorHead}），内壁半宽 ${cabin.halfWidth} 米。`,
      '',
      `仿真把人按 ${cabin.rowPitch} 米一排塞进这个盒子，`,
      `一排两个，最多 ${cabin.maxRows} 排 —— 所以能看见`,
      '乘客坐在车里，而不是在车旁边凭空出现。',
      '',
      `门中心离车厢端头 ${cabin.endInset} 米，屏蔽门就是`,
      '照这份名单开洞的：车门的节奏和站台门一样。',
    ], { size: 11.5, fill: G.muted, lh: 18 }),
  )

  return sheet(W, Math.ceil(Math.max(detailBottom, detailY + 200) + 40), g.join(''))
}
