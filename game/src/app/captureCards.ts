// A rendering pass for the concept sheets, on demand from a page.
//
// The sheets draw the game's pieces, and the only honest way to draw a piece the
// way the game draws it is to let the game draw it: this exposes the pass the build
// rail uses (`app/moduleThumbnails.ts`) so a tool can photograph it at the size a
// sheet needs.
//
// Why a page and not Node: the pass ends in `WebGLRenderer.render`, and a piece's
// face is a canvas the game paints at runtime — the green arrow on a 闸机's display,
// a 车票 marquee, an ad poster, a 站名 inscription, a 线网图 board. Nothing outside a
// browser has those pixels, and re-drawing the geometry in Node means
// re-implementing the camera, the light rig and the tone mapping as well. Every
// drift between a sheet and the game so far came from exactly that copy.
//
// `tools/render-module-cards.mjs` drives this headlessly: it boots the built game
// at `?capture-cards`, asks for the catalogue's frames, and embeds what comes back
// in `art/04-module-catalogue.svg`. It ships in the game's own bundle, so it is
// guarded — nothing happens unless the query flag is present and the caller asks.

import { renderModuleThumbnails, type ThumbnailSize } from './moduleThumbnails.ts'
import { MODULE_OPTIONS, isDecorType, moduleLabel } from './store/catalog.ts'
// The pieces' real footprints, read from the builders that place them — a palette
// row's `w`/`h` is a tile's size, and for a 楼梯, a 扶梯, a 电梯 or an 出入口 it was
// never the ground the piece covers.
import { footprintCellsOf } from '../build/model/Equipment.ts'

// The simulation's own numbers, read straight from the game, so a card's
// throughput line is the number the crowd actually obeys and cannot drift from it.
import {
  GATE_RATE,
  TVM_RATE,
  ESCALATOR_RATE,
  STAIR_RATE_UP,
  STAIR_RATE_DOWN,
  LIFT_BATCH,
} from '../sim/constants.ts'

export interface CardFrame {
  /** The palette id to draw. */
  id: string
  width: number
  height: number
  /** Painted behind the piece; the sheet's cards are opaque. */
  background?: string
}

export interface CatalogueCard {
  /** The palette id the piece is drawn from. */
  id: string
  /**
   * The piece's **category** name — `门`, `楼梯`, `站名` — not the palette row's own
   * variant label (`门 单开 不锈钢`, `左双跑楼梯`). A reader looking for "the door" finds
   * 门; which leaf the folder happens to open on is a sub-menu detail.
   */
  label: string
  /** `1 × 2 格` — the footprint the piece occupies. */
  footprint: string
  /** What the simulation reads off the piece. */
  service: string
  /** True for a piece that only decorates. */
  decor: boolean
}

export interface CapturedCard {
  id: string
  width: number
  height: number
  png: string
}

/** True when this document was loaded to render cards (`?capture-cards`). */
export function isCardCapture(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('capture-cards')
}

/**
 * The footprint a card prints: `1 × 7 格`, the **bounding box of the cells the
 * piece covers**, read from its own builder rather than from the palette row. A
 * straight 楼梯 and an 扶梯 are seven cells of run and one wide; an 电梯 is a 2 × 2
 * shaft; a 有盖单向 出入口 lays a 3 × 8 head-house. A palette row's `w`/`h` is a tile's
 * size on the rail — every one of those four reads 1 × 1 there, which is why the
 * cards used to say the same.
 *
 * The box is taken, not the cell list: a run's two landings bound the ground it
 * stands on, and the reader wants the plan it occupies, not the shape of it.
 */
function footprintOf(id: string): string {
  const cells = footprintCellsOf(id)
  const xs = cells.map(([x]) => x)
  const ys = cells.map(([, y]) => y)
  const w = Math.max(...xs) - Math.min(...xs) + 1
  const h = Math.max(...ys) - Math.min(...ys) + 1
  return `${w} × ${h} 格`
}

/**
 * The pieces the catalogue holds, in the order they are read.
 *
 * This is editorial: the sheet shows a selection of families, including the
 * station's maintenance equipment, surveillance, wayfinding and shop furniture.
 * Variants share a single card so the catalogue stays readable as it grows.
 *
 * One flat list rather than the blocks it used to be cut into. The rail's own
 * divisions are 设备 and 装饰, and this list holds both — the machines of the first
 * and the seating, signage and shop furniture of the second — so a heading drawn over
 * it could only misname what is under it. Membership is by **family**, so a piece the
 * palette gains inside a named family still arrives here without an edit.
 */
const PICK_IDS: readonly string[] = [
  'gate',
  'fence',
  'tvm',
  'vending',
  'exit',
  'escalator',
  'lift',
  'stair',
  'bench',
  'shelf',
  'checkout',
  'bin',
  'guidepost',
  'busstop',
  'extinguisher',
  'clock',
  'cctv',
  'billboard',
  'tv',
  'sign',
  'linemap',
  'ac-unit',
  'electrical-cabinet',
  'desk',
]

/** The family a pick-list entry names, for matching against the palette. */
const PICK_FAMILY: Record<string, string> = { pillar: 'pillar', exit: 'exit', stair: 'stair', bench: 'bench' }

/**
 * The catalogue's cards: the picked families, in the rail's own order, with the text
 * each card wears.
 *
 * A family is a palette row with a sub-menu — the rail shows one tile, its first
 * entry, and folds the rest out under it — so a card is drawn from that first entry
 * too, and the ids come from the rail rather than from a hand-written list.
 */
export function catalogueCards(width: number, height: number, background = '#0d141d'): { frames: CardFrame[]; cards: CatalogueCard[] } {
  // family -> the palette row the rail would show for it, in catalogue order
  const rowForFamily = new Map<string, (typeof MODULE_OPTIONS)[number]>()
  for (const opt of MODULE_OPTIONS) {
    const family = familyOf(opt.id)
    if (!rowForFamily.has(family)) rowForFamily.set(family, opt)
  }

  const cards: CatalogueCard[] = []
  const frames: CardFrame[] = []
  for (const name of PICK_IDS) {
    const family = PICK_FAMILY[name] ?? name
    const opt = rowForFamily.get(family)
    if (!opt) continue
    cards.push({
      id: opt.id,
      // The category the piece belongs to, named by the game (`catalog.ts`), so the
      // card says 门 and 楼梯 rather than the folder's own variant label.
      label: moduleLabel(opt.type),
      footprint: footprintOf(opt.id),
      service: serviceOf(opt.id),
      decor: isDecorType(opt.id),
    })
    frames.push({ id: opt.id, width, height, background })
  }
  return { frames, cards }
}

/**
 * One PNG per requested frame, in the order asked.
 *
 * The pass renders **every** palette entry at one size — a `WebGLRenderer` and its
 * materials are expensive to mint, and the game's own pass already draws the whole
 * catalogue in one go — so frames are grouped by size and each group is one pass.
 */
export async function captureModuleCards(frames: CardFrame[], onProgress?: (done: number, total: number) => void): Promise<CapturedCard[]> {
  const bySize = new Map<string, CardFrame[]>()
  for (const frame of frames) {
    const key = `${frame.width}x${frame.height}|${frame.background ?? 'alpha'}`
    const list = bySize.get(key)
    if (list) list.push(frame)
    else bySize.set(key, [frame])
  }

  const out: CapturedCard[] = []
  let done = 0
  for (const group of bySize.values()) {
    const { width, height, background } = group[0]
    const size: ThumbnailSize = { width, height }
    const rendered = await renderModuleThumbnails(size)
    for (const frame of group) {
      const png = rendered[frame.id] ?? rendered[railRowFor(frame.id)] ?? null
      if (!png) continue
      if (background) {
        const painted = await flatten(png, width, height, background)
        out.push({ id: frame.id, width: painted.width, height: painted.height, png: painted.png })
      } else {
        out.push({ id: frame.id, width, height, png })
      }
      onProgress?.(++done, frames.length)
    }
  }
  return out
}

/**
 * The family a palette row belongs to, matching the rail's own sub-menus. A family
 * drawn once is what makes the catalogue a catalogue rather than a parts list.
 */
function familyOf(id: string): string {
  if (id === 'cctv' || id.startsWith('cctv-')) return 'cctv'
  if (id === 'shelf' || id.startsWith('shelf-')) return 'shelf'
  if (id.startsWith('pillar')) return 'pillar'
  if (id.startsWith('busstop')) return 'busstop'
  if (id.startsWith('light-')) return 'light'
  if (id === 'bench' || id.startsWith('bench-')) return 'bench'
  if (id.startsWith('billboard')) return 'billboard'
  if (id.startsWith('glass')) return 'glass'
  if (id.startsWith('door')) return 'door'
  if (id.startsWith('calligraphy')) return 'calligraphy'
  if (id.startsWith('linemap')) return 'linemap'
  if (id.startsWith('sign')) return 'sign'
  if (id.startsWith('exit')) return 'exit'
  if (id.startsWith('stair')) return 'stair'
  return id
}

/** A family id as the pass's own row id: `bench` is the first 座椅 the rail offers. */
function railRowFor(id: string): string {
  if (MODULE_OPTIONS.some((m) => m.id === id)) return id
  return MODULE_OPTIONS.find((m) => m.id === id || m.type === id)?.id ?? id
}

/**
 * A percentage-and-seconds note as the sheets' own "人/分" line. The old sheet's
 * throughput lines were written per minute and the simulation's constants are per
 * second, so that conversion is the only arithmetic here.
 */
const perMin = (perSecond: number): number => Math.round(perSecond * 60)

const STAIR_RATE = `上 ${perMin(STAIR_RATE_UP)} / 下 ${perMin(STAIR_RATE_DOWN)} 人/分`

/**
 * What the simulation reads off a piece, keyed by palette id.
 *
 * Only pieces that *do* something to the crowd carry a line; a 垃圾桶 is a
 * decoration and says so. Everything with a number in it comes from `sim/` where
 * the game has one, so these read as the simulation's own summary rather than as
 * art notes.
 */
const SERVICE: Record<string, string> = {
  gate: `进出各 ${perMin(GATE_RATE)} 人/分`,
  fence: '不通行，只围边界',
  tvm: `${(TVM_RATE * 60).toFixed(1)} 张/分，队伍排这儿`,
  vending: '无服务，被动吸引',
  'bench-steel-1': '舒适度，可坐 1 人',
  'bench-steel-2': '舒适度，可坐 2 人',
  'bench-seat-1': '舒适度，可坐 1 人',
  'bench-seat-2': '舒适度，可坐 2 人',
  shelf: '商铺货架，聚人',
  desk: '办公位，吸引职员',
  cubicle: '卫生间设施',
  sink: '卫生间设施',
  bin: '装饰，无通行',
  extinguisher: '装饰，无通行',
  clock: '全站时间参照',
  cctv: '监控，无通行',
  tv: '信息屏，无通行',
  'sign-ceiling': '导向，吊在头顶',
  'sign-wall': '导向，贴在墙上',
  escalator: `单向，${perMin(ESCALATOR_RATE)} 人/分`,
  lift: `无障碍，每趟 ${LIFT_BATCH} 人`,
  'stair-straight': STAIR_RATE,
  'stair-left90': STAIR_RATE,
  'stair-right90': STAIR_RATE,
  'stair-left180': STAIR_RATE,
  'stair-right180': STAIR_RATE,
}

/** The line under a card's footprint: the simulation's own note, or a family note. */
function serviceOf(id: string): string {
  if (id.startsWith('pillar')) return 'Tab 切换每次加高 2 / 4 m'
  if (id === 'roof') return '薄顶棚，材质可涂刷'
  if (id.startsWith('roof-truss')) return '纵向桁架顶棚，4/8/12 m，可涂刷'
  if (id.startsWith('roof-shell')) return '无桁架双坡屋顶，4/8/12 m，可涂刷'
  if (id.startsWith('roof-tapered')) return '收束桁架顶棚，单根底梁，可涂刷'
  if (id === 'bridge') return '开放轨道桥，延伸线路'
  if (SERVICE[id]) return SERVICE[id]
  if (id.startsWith('exit')) return '每个出口单独设流量'
  if (id.startsWith('billboard')) return '把人往商铺那边引'
  if (id === 'curtain-wall' || id.startsWith('glass')) return '隔断，看得见走不过'
  if (id.startsWith('door')) return '1.2 人/秒，关上挡路'
  if (id.startsWith('calligraphy')) return '站名，挂在墙上'
  if (id.startsWith('linemap')) return '线网图，指路'
  if (id.startsWith('shelf-')) return SERVICE.shelf
  return '装饰，无通行'
}

/**
 * A card the sheet embeds wants an opaque ground: the pass renders with alpha, and
 * the sheet's own card colour would otherwise show through the model's edges as a
 * halo. Painted on a canvas here, because this is the browser that owns the pixels.
 *
 * Painted at **twice** the requested size and reported as such. The pass draws at
 * `devicePixelRatio`, so its own output size depends on the machine; going through
 * a canvas of a known size instead makes the PNG a caller can rely on — and a sheet
 * that embeds a 392-pixel image into a 196-pixel box gets a crisp print if it is
 * ever scaled up.
 */
async function flatten(dataUrl: string, width: number, height: number, background: string): Promise<{ png: string; width: number; height: number }> {
  const image = new Image()
  await new Promise<void>((ok, bad) => {
    image.onload = () => ok()
    image.onerror = () => bad(new Error('a captured card would not decode'))
    image.src = dataUrl
  })
  const w = Math.max(1, Math.round(width * 2))
  const h = Math.max(1, Math.round(height * 2))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (!g) return { png: dataUrl, width, height }
  g.fillStyle = background
  g.fillRect(0, 0, w, h)
  g.drawImage(image, 0, 0, w, h)
  return { png: canvas.toDataURL('image/png'), width: w, height: h }
}
