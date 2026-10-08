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
import { STOCK, STOCK_CLASSES, doorCentres, trainLength, trainRatedCapacity } from '../game/src/sim/stock.ts'
import { PSD_FULL_HEIGHT, PSD_HALF_HEIGHT } from '../game/src/sim/constants.ts'
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

/**
 * What each class is powered by and what it is for — **GAME-SPEC §6.1**, verbatim in
 * substance. The class table in `sim/stock.ts` carries only `power: 'catenary' |
 * 'third-rail'`, so the voltages and the roles are the spec's, kept here rather than
 * guessed at.
 */
const SPEC = {
  A: { power: '接触网供电', use: '干线。高架和敞口开挖，头顶是天空。' },
  B: { power: '第三轨供电', use: '隧道主力。中国城市地铁里最常见的一级。' },
  C: { power: '第三轨供电 · 可选直线电机', use: '支线和自动化线路：车窄、土建省。' },
  L: { power: '第三轨供电 · 直线电机', use: '直线电机线路：车短、每侧三门。' },
}

const W = 1600
/** The band each class is read in, and the two drawings' boxes inside it. */
const ROW_X = 48
const NUM_X = 60
const FRONT_X = 330
const FRONT_W = 160
/** Room for the height dimension between the two drawings. */
const DIM_X = FRONT_X + FRONT_W + 20
const SIDE_X = 600
const SIDE_W = 952
const BAND_H = 276

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
  const { pieces, livery, cabin } = loadCars()
  const paint = new Map(livery.map((l) => [l.cls, l]))
  const car = (id) => {
    const p = pieces.get(id)
    if (!p) throw new Error(`the capture has no \`${id}\` — re-run tools/render-train-cards.mjs`)
    return p
  }
  const image = (piece, x, y, w, h) =>
    animatedTrain(poses, piece.id, x, y, w, h)
      ?? `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${piece.href}"/>`
  const head = (x, y, text, col = G.accent) => T(x, y, text, { size: 12.5, weight: 800, fill: col, ls: 1.2 })

  const g = []
  g.push(
    title(
      48,
      62,
      '车多宽，站台就退到哪',
      '四个等级的尺寸、车门和定员一目了然。正对车头量宽高，正对车身看长度和门距。第 11 张给形状，这张给参数。',
    ),
  )

  // The two drawings share one scale across the four classes — the box each was framed
  // in is the same — so a wider car is drawn wider and a longer one longer.
  const frontMetres = car('front-A').metres
  const sideMetres = car('side-A').metres
  const frontPxPerM = FRONT_W / frontMetres
  const sidePxPerM = SIDE_W / sideMetres
  g.push(
    T(W - 48, 186, '四个等级画在同一个比例上 —— 车宽和车长可以直接比', {
      size: 11.5,
      fill: G.muted,
      anchor: 'end',
    }),
  )

  STOCK_CLASSES.forEach((cls, i) => {
    const s = STOCK[cls]
    const spec = SPEC[cls]
    const y = 210 + i * 280
    const l = paint.get(cls) ?? { line: '?', colour: G.muted }
    const centres = doorCentres({ stock: cls, cars: 6 })
    const pitch = centres.length > 1 ? Math.round((centres[1] - centres[0]) * 100) / 100 : null

    // The band carries the line's player-selected livery colour.
    g.push(`<rect x="${ROW_X}" y="${n(y - 26)}" width="1504" height="${BAND_H}" rx="12" fill="#111926" stroke="#243040"/>`)
    g.push(`<rect x="${ROW_X}" y="${n(y - 26)}" width="6" height="${BAND_H}" rx="3" fill="${l.colour}"/>`)

    /* the numbers */
    g.push(T(NUM_X, y + 24, `${cls} 型`, { size: 30, weight: 800, fill: G.text }))
    g.push(
      MUL(NUM_X, y + 74, [
        `长 ${s.length.toFixed(1)} 米`,
        `宽 ${s.width.toFixed(1)} 米`,
        `高 ${s.height.toFixed(1)} 米`,
        `每侧 ${s.doorsPerSide} 门 × ${s.doorWidth.toFixed(1)} 米`,
        `门距 ${pitch ?? '—'} 米`,
        `单节 ${s.ratedPerCar} / ${s.crushPerCar} 人`,
        `编组 ${s.consist[0]} – ${s.consist[1]} 节`,
      ], { size: 11.5, fill: '#c3d0de', lh: 18, mono: true }),
    )
    g.push(T(NUM_X, y + 216, spec.power, { size: 10.5, fill: l.colour, mono: true }))

    /* the frontal elevation, with the height dimension it is drawn to */
    const front = car(`front-${cls}`)
    const fh = (FRONT_W / front.px.width) * front.px.height
    g.push(T(FRONT_X, y, '正面', { size: 11, fill: G.muted, weight: 700 }))
    g.push(image(front, FRONT_X, y + 10, FRONT_W, fh))
    // z = 0 and z = height in the framed box, which is 4.05 m above the rail and 0.35
    // below it — so the car's own height is measured where it actually stands.
    const FRONT_TOP_M = 4.05
    const FRONT_SPAN_M = 4.4
    const zPx = (z) => y + 10 + ((FRONT_TOP_M - z) / FRONT_SPAN_M) * (FRONT_SPAN_M * frontPxPerM)
    g.push(
      `<path d="M${n(DIM_X)},${n(zPx(s.height))} L${n(DIM_X)},${n(zPx(0))}" stroke="${G.accent}" stroke-width="1.4" fill="none"/>` +
        `<path d="M${n(DIM_X - 5)},${n(zPx(s.height))} L${n(DIM_X + 5)},${n(zPx(s.height))} M${n(DIM_X - 5)},${n(zPx(0))} L${n(DIM_X + 5)},${n(zPx(0))}" stroke="${G.accent}" stroke-width="1.4" fill="none"/>` +
        T(DIM_X + 9, zPx(s.height) + 4, `${s.height.toFixed(1)} 米`, { size: 10.5, fill: G.accent, mono: true }) +
        T(DIM_X + 9, zPx(0) + 4, `${s.width.toFixed(1)} 米宽`, { size: 10.5, fill: G.muted, mono: true }),
    )

    /* the side elevation, with the length dimension */
    const side = car(`side-${cls}`)
    const sh = (SIDE_W / side.px.width) * side.px.height
    const sideY = y + 10
    g.push(T(SIDE_X, y, `侧面 · ${s.length.toFixed(1)} 米一级，编组就是重复`, { size: 11, fill: G.muted, weight: 700 }))
    g.push(image(side, SIDE_X, sideY, SIDE_W, sh))
    const midX = SIDE_X + SIDE_W / 2
    const halfPx = (s.length / 2) * sidePxPerM
    const dimY = sideY + sh + 14
    g.push(
      `<path d="M${n(midX - halfPx)},${n(dimY)} L${n(midX + halfPx)},${n(dimY)}" stroke="${l.colour}" stroke-width="1.4" fill="none"/>` +
        `<path d="M${n(midX - halfPx)},${n(dimY - 5)} L${n(midX - halfPx)},${n(dimY + 5)} M${n(midX + halfPx)},${n(dimY - 5)} L${n(midX + halfPx)},${n(dimY + 5)}" stroke="${l.colour}" stroke-width="1.4" fill="none"/>` +
        T(midX - halfPx, dimY + 18, `6 节 ${trainLength({ stock: cls, cars: 6 }).toFixed(1)} 米 · ${trainRatedCapacity({ stock: cls, cars: 6 })} 人`, {
          size: 10.5,
          fill: G.muted,
          anchor: 'start',
          mono: true,
        }),
    )
    g.push(T(midX + halfPx, dimY + 18, `${s.length.toFixed(1)} 米车体`, { size: 10.5, fill: l.colour, anchor: 'end', mono: true }))
    g.push(T(SIDE_X + SIDE_W, y + 244, spec.use, { size: 11, fill: G.muted, anchor: 'end' }))
  })

  /* ---------------- the line is the unit the player edits ---------------- */
  const bandY = 210 + 4 * 280 + 24
  g.push(head(48, bandY, '一条线路 = 一列车的全部设定'))
  g.push(T(340, bandY, '车、编组、供电、门、颜色、名字 —— 改哪一项都只改这条线，不动别的线。', { size: 12, fill: G.muted }))

  const cards = [
    {
      title: '车型',
      lines: STOCK_CLASSES.map((cls) => `${cls}  ${STOCK[cls].ratedPerCar} / ${STOCK[cls].crushPerCar} 人`),
      note: '单节座位数 / 最大载客量',
    },
    {
      title: '编组',
      lines: STOCK_CLASSES.map((cls) => `${cls}  ${STOCK[cls].consist[0]} – ${STOCK[cls].consist[1]} 节`),
      note: '可选编组范围',
    },
    {
      title: '供电',
      lines: ['第三轨  隧道 / 有盖', '接触网  高架 / 敞口', '第三轨要盖住，接触网要 5 米净空'],
      note: '轨道和供电方式要匹配',
    },
    {
      title: '屏蔽门',
      lines: [`全高  ${PSD_FULL_HEIGHT.toFixed(1)} 米`, `半高  ${PSD_HALF_HEIGHT.toFixed(1)} 米`, '只有隧道和有盖区间才装'],
      note: '全高或半高站台门',
    },
    {
      title: '颜色与名字',
      lines: ['一条线一个颜色，刷在车身上', '上下行终点印在目的地屏上', '名字 + 颜色 + 车型 = 一条线'],
      note: '每条线路可单独设置',
    },
  ]
  const cw = 286
  const cgap = 15
  cards.forEach((c, i) => {
    const x = 48 + i * (cw + cgap)
    g.push(`<rect x="${x}" y="${n(bandY + 24)}" width="${cw}" height="150" rx="12" fill="#111926" stroke="#243040"/>`)
    g.push(T(x + 16, bandY + 50, c.title, { size: 13, weight: 800, fill: G.yellow, ls: 1.2 }))
    g.push(MUL(x + 16, bandY + 74, c.lines, { size: 11.5, fill: '#c3d0de', lh: 19, mono: i < 2 }))
    g.push(T(x + 16, bandY + 166, c.note, { size: 10, fill: G.muted }))
  })

  /* ---------------- the screen doors' two heights ---------------- */
  const psdY = bandY + 250
  g.push(head(48, psdY, '站台屏蔽门：全高还是半高'))
  g.push(
    T(340, psdY, `门中心还是那份名单：门距和车门一样。门体两种 —— 全高 ${PSD_FULL_HEIGHT.toFixed(1)} 米把站台封起来，半高 ${PSD_HALF_HEIGHT.toFixed(1)} 米顶上留着排烟。`, {
      size: 12,
      fill: G.muted,
    }),
  )

  const PX_PER_M = 44
  /**
   * The consist origin rides the track bed, **half a metre under the platform**
   * (`sim/stock.ts`), which is what puts a door sill at `DOOR_SILL_Z` a hand's width
   * over the platform surface. The section is drawn on that datum, so the step the
   * crowd takes is the step the model has.
   */
  const ORIGIN_BELOW_PLATFORM = 0.5
  const PLAT_W = 120
  const PSD_AT = 120
  const CAR_GAP = 26
  /** The frontal render's own world box, and where its rail line sits inside it. */
  const front0 = car('front-L')
  const FRAME_W = front0.metres * PX_PER_M
  const FRAME_H = FRAME_W * (front0.frame.height / front0.frame.width)
  const Z0_FROM_TOP = front0.box.z[1] / (front0.box.z[1] - front0.box.z[0])

  const psd = (x, height, label, col, note) => {
    const base = psdY + 190
    const top = base - height * PX_PER_M
    const originY = base + ORIGIN_BELOW_PLATFORM * PX_PER_M
    // The car, seen **end-on** — which is what a cross-section of the platform edge
    // shows, and why the frontal elevation belongs here rather than a schematic box.
    const front = car('front-L')
    const carX = x + PSD_AT + CAR_GAP
    const carY = originY - Z0_FROM_TOP * FRAME_H
    g.push(
      `<rect x="${n(x)}" y="${n(base)}" width="${n(PLAT_W)}" height="${n(ORIGIN_BELOW_PLATFORM * PX_PER_M)}" fill="#c9cdd2"/>` +
        `<rect x="${n(x)}" y="${n(base)}" width="${n(PLAT_W)}" height="4" fill="${G.yellow}"/>` +
        `<rect x="${n(x)}" y="${n(originY)}" width="${n(PLAT_W + CAR_GAP + FRAME_W)}" height="3" fill="#4a5a6c"/>`,
    )
    g.push(image(front, carX, carY, FRAME_W, FRAME_H))
    // The step: the sill stands `DOOR_SILL_Z` over the origin, so over the platform it
    // is the difference — 7 cm, derived here rather than written down twice. The two
    // lines run on past the car so their labels sit clear of it, as a dimension chain.
    const step = cabin.doorSill - ORIGIN_BELOW_PLATFORM
    const labX = carX + FRAME_W + 8
    g.push(
      `<path d="M${n(x + PSD_AT)},${n(originY - cabin.doorSill * PX_PER_M)} L${n(labX - 4)},${n(originY - cabin.doorSill * PX_PER_M)}" stroke="${G.accent}" stroke-width="1.2" stroke-dasharray="4 4" fill="none"/>` +
        `<path d="M${n(x + PSD_AT)},${n(originY - cabin.doorHead * PX_PER_M)} L${n(labX - 4)},${n(originY - cabin.doorHead * PX_PER_M)}" stroke="${G.muted}" stroke-width="1" stroke-dasharray="4 4" fill="none"/>` +
        T(labX, originY - cabin.doorHead * PX_PER_M + 4, `门头 ${cabin.doorHead} 米`, { size: 10, fill: G.muted, mono: true }) +
        T(labX, originY - cabin.doorSill * PX_PER_M + 4, `门槛比站台高 ${(step * 100).toFixed(0)} 厘米`, { size: 10, fill: G.accent, mono: true }),
    )
    g.push(`<rect x="${n(x + PSD_AT)}" y="${n(top)}" width="7" height="${n(base - top)}" fill="#a8d8ea" stroke="#0d1116" stroke-width="0.8" opacity="0.75"/>`)
    g.push(`<rect x="${n(x + PSD_AT - 6)}" y="${n(top - 8)}" width="19" height="9" fill="#bcc3ca" stroke="#0d1116" stroke-width="0.8"/>`)
    g.push(T(x, psdY + 40, `${label}  ${height.toFixed(1)} 米`, { size: 13.5, weight: 800, fill: col, mono: true }))
    g.push(
      `<path d="M${n(x + PSD_AT - 20)},${n(top)} L${n(x + PSD_AT - 20)},${n(base)}" stroke="${col}" stroke-width="1.2" fill="none"/>` +
        `<path d="M${n(x + PSD_AT - 25)},${n(top)} L${n(x + PSD_AT - 15)},${n(top)} M${n(x + PSD_AT - 25)},${n(base)} L${n(x + PSD_AT - 15)},${n(base)}" stroke="${col}" stroke-width="1.2" fill="none"/>`,
    )
    g.push(T(x, base + ORIGIN_BELOW_PLATFORM * PX_PER_M + 26, note, { size: 11.5, fill: G.muted }))
    g.push(T(carX, carY - 10, 'L 型正面', { size: 10.5, fill: G.muted }))
  }
  psd(76, PSD_FULL_HEIGHT, '全高', G.ink, '从站台封到顶板：付费区和隧道隔开，气流也控得住。')
  psd(556, PSD_HALF_HEIGHT, '半高', G.warn, '齐腰的隔断：便宜，顶上是敞的，排烟走它。')

  const footY = psdY + 280
  g.push(`<rect x="48" y="${n(footY - 26)}" width="1504" height="1" fill="${G.line}"/>`)
  g.push(
    MUL(48, footY, [
      '每条线路可设置车型、编组、供电、站台门、颜色、名称和终点。列车总载客量随车厢节数增加。',
      '装不下的乘客留在站台上 —— 那是这套参数里最要命的读数，底栏的「滞留」就是它。',
    ], { size: 12, fill: G.muted, lh: 19 }),
  )

  return sheet(W, Math.ceil(footY + 46), g.join(''))
}
