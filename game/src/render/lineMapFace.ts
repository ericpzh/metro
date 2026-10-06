// The 线网图's **placeholder** pixels — the station's own network drawn as a system
// map, for the frames before the supplied poster has decoded.
//
// The artwork a 线网图 really prints is the 广州地铁 线网示意图 itself, supplied as
// `src/assets/linemaps/network-map.jpg` and handed out by `render/lineMapArt.ts`. This
// module is what a map shows until those pixels are in hand (and if the asset were
// ever missing): a board drawn from the **station document**, so it still says
// something true — the station's own lines, one coloured band each, its stations
// ticked, its interchanges ringed — rather than a blank rectangle. It is also what a
// caller with no browser behind it (a unit test) draws, which is why it is pure.
//
// Everything below is expressed in **metres on the panel** and converted through
// `PX_PER_METRE`, so the same drawing serves the wall board and the totem, which share
// one panel (`sim/linemaps.ts`). The layout arithmetic is a separate, pure function
// (`lineMapPlaceholderLayout`) so a test can ask where a row, a tick or an interchange
// went without a canvas — the failure this exists to catch is silent: a band that
// prints off the panel, two rows folded onto each other, or every station label struck
// through its neighbour, all of which look like "a map" from across the room.
//
// The look follows the reference board (the 线网示意图 on a station wall): a pale
// ground, one coloured band per line, white ticks on the band for each station, a
// white interchange ring where two lines meet, and the line's own shield — the
// same shield a 指示牌 prints, printing 线路's own name — at the head of its band.

import type { LineDef } from '../sim/types.ts'

/** Narrow face; without it the Chinese labels fall back to a serif. */
const CJK = '"Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'
/** The Latin gloss under the title, which reads better in a condensed sans. */
const LATIN = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif'

/** The printed board: a pale plan, dark ink, and the frame round it. */
const GROUND = '#f4f5f1'
const INK = '#23262b'
const MUTED = '#6f757c'
const FRAME = '#2f343a'
/** The colour a line with none of its own prints in. */
export const LINE_COLOUR_FALLBACK = '#3c434c'

/** The plate's resolution: pixels per metre of panel. */
export const PX_PER_METRE = 420

/** The panel a map is drawn on, in metres. */
export interface LineMapPanelSize {
  w: number
  h: number
}

/** The texture an AABB-fit panel needs: `PX_PER_METRE` per metre, never below 64 px. */
export function lineMapPlaceholderPlate(panel: LineMapPanelSize): { width: number; height: number } {
  return {
    width: Math.max(64, Math.round(panel.w * PX_PER_METRE)),
    height: Math.max(64, Math.round(panel.h * PX_PER_METRE)),
  }
}

/* ------------------------------------------------------------------ layout */

/** One station on a band: where it sits, what it is called, whether lines meet there. */
export interface LineMapPlaceholderTick {
  name: string
  /** Its x, metres from the panel's left edge. */
  x: number
  /** True when another line calls at the same station (drawn as a ring). */
  interchange: boolean
  /** True when this tick's own name is printed (a crowded band prints every other). */
  labelled: boolean
}

/** One line's band: its shield, its run and the stations along it. */
export interface LineMapPlaceholderRow {
  lineId: string
  name: string
  colour: string
  /** The band's own centre line, metres from the panel's top edge. */
  y: number
  /** The shield's box, metres. */
  shield: { x: number; y: number; w: number; h: number }
  /** The band's run, metres from the panel's left edge. */
  band: { x0: number; x1: number }
  /** The band's drawn thickness, metres — the station labels sit under it. */
  weight: number
  /** The station label size, metres. */
  labelSize: number
  ticks: LineMapPlaceholderTick[]
  /** True when the band is too crowded to label every station. */
  sparse: boolean
}

export interface LineMapPlaceholderLayout {
  rows: LineMapPlaceholderRow[]
  /** The station names more than one line calls at, in row order. */
  interchanges: string[]
  /** Every station the drawn rows carry, counted once per line (a tick is a call). */
  calls: number
  /** The distinct stations the drawn rows call at. */
  stations: number
  /** Lines the panel was too short to draw at all. */
  hiddenLines: number
  /** The station's own name, as the title prints it (blank name → ''). */
  station: string
  /** The title block's baseline, metres; `-1` when there is no room for one. */
  titleY: number
  /** The footer's baseline, metres. */
  footerY: number
  /** The rows area's bounds, metres — what a test measures a row against. */
  area: { y0: number; y1: number }
}

/** Margins and bands, metres. The quiet space the frame and the title sit in. */
const MARGIN = 0.09
const FRAME_W = 0.02
const TITLE_H = 0.36
const FOOTER_H = 0.24
/** The shortest a row may be drawn at before the next line is held back. */
const MIN_ROW = 0.17
/** The gap between the shield and the head of its band. */
const SHIELD_GAP = 0.08

/**
 * Where every band, station and label goes, in metres on a panel of this size.
 *
 * The panel is read as three bands: the title block, the rows, and the footer. Rows
 * are laid evenly through the rows area, and a line that cannot be given
 * `MIN_ROW` metres — a station with more lines than the board is tall — is not drawn
 * at all; the footer says how many were held back rather than pretending the
 * network is smaller than it is.
 *
 * A station whose name another line also carries is an **interchange** (the same
 * test `signLineNumber` reads a shield by, applied to the whole network), and is
 * drawn as a ring rather than a tick. Labels are printed for every station when the
 * band has room for them, and for every **other** one when it does not — the first
 * and last are always labelled, so a crowded band still says where it runs from and
 * where it ends, and two labels can never be struck through each other.
 */
export function lineMapPlaceholderLayout(panel: LineMapPanelSize, lines: readonly LineDef[], stationName = ''): LineMapPlaceholderLayout {
  const titleY = TITLE_H - 0.13
  const footerY = panel.h - 0.07
  const area = { y0: TITLE_H, y1: Math.max(TITLE_H, panel.h - FOOTER_H) }
  const available = Math.max(0, area.y1 - area.y0)
  const rows = Math.max(0, Math.floor(available / MIN_ROW))
  const drawn = lines.slice(0, rows)
  const hiddenLines = lines.length - drawn.length

  // Every station name the network calls at, so a tick knows whether it is shared.
  const calledOn = new Map<string, number>()
  for (const line of lines) for (const s of line.stations) calledOn.set(s, (calledOn.get(s) ?? 0) + 1)

  const pitch = drawn.length > 0 ? available / drawn.length : 0
  const shieldW = Math.min(0.42, Math.max(0.2, pitch * 0.72))
  const shieldH = Math.min(shieldW, Math.max(0.16, pitch * 0.6))
  const weight = Math.min(0.11, Math.max(0.05, pitch * 0.3))
  const labelSize = Math.min(0.11, Math.max(0.055, pitch * 0.3))
  const bandX0 = MARGIN + shieldW + SHIELD_GAP
  const bandX1 = Math.max(bandX0 + 0.05, panel.w - MARGIN)

  const out: LineMapPlaceholderRow[] = []
  const interchanges = new Set<string>()
  let calls = 0
  const stations = new Set<string>()

  drawn.forEach((line, i) => {
    const y = area.y0 + pitch * (i + 0.5)
    const names = line.stations
    const span = bandX1 - bandX0
    const step = names.length > 1 ? span / (names.length - 1) : 0
    // A label needs about its own width plus a breathing space. When the band cannot
    // give **every** station that, labels thin out to every `every`-th one — never a
    // rotation and never an overlap — and the first and last are always labelled, so a
    // crowded band still says where it runs from and where it ends. The last label is
    // dropped when it would land too close to the multiple before it.
    const want = labelSize * 1.35 + 0.03
    const every = names.length > 1 && step > 0 ? Math.max(1, Math.ceil(want / step)) : 1
    const sparse = every > 1
    const lastIndex = names.length - 1
    // The closing label is added only when its own slot is a label's width past the
    // last multiple: on a band where it would touch, the run's last named station is
    // the multiple before it.
    const remainder = lastIndex - Math.floor(lastIndex / Math.max(1, every)) * every
    const closeLabel = remainder > 0 && remainder * step >= want
    const ticks: LineMapPlaceholderTick[] = names.map((name, k) => {
      const x = names.length > 1 ? bandX0 + step * k : bandX0 + span / 2
      const interchange = (calledOn.get(name) ?? 0) > 1
      if (interchange) interchanges.add(name)
      stations.add(name)
      calls++
      const labelled = k % every === 0 || (k === lastIndex && closeLabel)
      return { name, x, interchange, labelled }
    })
    out.push({
      lineId: line.id,
      name: line.name,
      colour: line.colour || LINE_COLOUR_FALLBACK,
      y,
      shield: { x: MARGIN, y: y - shieldH / 2, w: shieldW, h: shieldH },
      band: { x0: bandX0, x1: bandX1 },
      weight,
      labelSize,
      ticks,
      sparse,
    })
  })

  return {
    rows: out,
    interchanges: [...interchanges],
    calls,
    stations: stations.size,
    hiddenLines,
    station: stationName.trim(),
    titleY,
    footerY,
    area,
  }
}

/* ---------------------------------------------------------------- drawing */

export interface LineMapPlaceholderOptions {
  /** The station's lines, in document order. */
  lines: readonly LineDef[]
  /** The station's own name, printed in the title's plate. */
  stationName: string
  /** The panel's size, metres. */
  panel: LineMapPanelSize
  /** Pixels per metre. Defaults to the plate's own resolution. */
  ppm?: number
  /** Whether to draw the printed frame round the board. On by default. */
  frame?: boolean
}

/** A rounded rectangle path, in pixels. */
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + rad, y)
  g.lineTo(x + w - rad, y)
  g.arcTo(x + w, y, x + w, y + rad, rad)
  g.lineTo(x + w, y + h - rad)
  g.arcTo(x + w, y + h, x + w - rad, y + h, rad)
  g.lineTo(x + rad, y + h)
  g.arcTo(x, y + h, x, y + h - rad, rad)
  g.lineTo(x, y + rad)
  g.arcTo(x, y, x + rad, y, rad)
  g.closePath()
}

/** A label shrunk to fit a box, never larger than `max`. */
function fitFont(g: CanvasRenderingContext2D, text: string, maxW: number, max: number, family: string): number {
  let size = max
  for (let i = 0; i < 12 && size > 4; i++) {
    g.font = `bold ${size}px ${family}`
    const w = g.measureText(text).width
    if (w <= maxW || w === 0) break
    size = (size * maxW) / w
  }
  return size
}

/**
 * Draw the placeholder board and hand back the layout it drew, so a caller can read
 * what the panel says without re-deriving it. `render/lineMapArt.ts` is what a placed
 * map prints once the supplied poster has decoded; this is the frame before that.
 *
 * The ground, the frame and the title block are the board; everything inside the
 * rows area is the station's own network. A station with no lines at all prints
 * the board and 尚未铺设线路 in the middle of it — the same words a 电视 with no
 * line uses — rather than an empty white rectangle, which is what a player would
 * otherwise see hanging on their wall until the first rail is laid.
 */
export function drawLineMapPlaceholder(g: CanvasRenderingContext2D, opts: LineMapPlaceholderOptions): LineMapPlaceholderLayout {
  const { lines, stationName, panel } = opts
  const ppm = opts.ppm ?? PX_PER_METRE
  const W = panel.w * ppm
  const H = panel.h * ppm
  const layout = lineMapPlaceholderLayout(panel, lines, stationName)

  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.lineJoin = 'round'
  g.lineCap = 'butt'

  // The board: a pale ground with a dark edge, the frame the whole piece hangs in.
  g.fillStyle = GROUND
  g.fillRect(0, 0, W, H)
  if (opts.frame !== false) {
    g.strokeStyle = FRAME
    g.lineWidth = FRAME_W * ppm
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth)
  }

  // Title block: 线网示意图 over its English, and the station's own name in a plate.
  const titleSize = Math.min(0.24, Math.max(0.1, panel.h * 0.13))
  g.fillStyle = INK
  g.font = `bold ${titleSize * ppm}px ${CJK}`
  g.fillText('线网示意图', MARGIN * ppm, (0.03 + titleSize) * ppm)
  g.fillStyle = MUTED
  g.font = `${titleSize * 0.38 * ppm}px ${LATIN}`
  g.fillText('Transport System Map', MARGIN * ppm, (layout.titleY + titleSize * 0.42) * ppm)

  if (layout.station !== '') {
    const plate = layout.station.endsWith('站') ? layout.station : `${layout.station}站`
    const size = Math.min(0.13, Math.max(0.07, panel.h * 0.075))
    const pad = size * 0.4
    g.font = `bold ${size * ppm}px ${CJK}`
    const textW = g.measureText(plate).width
    const boxW = textW + pad * 2 * ppm
    const boxH = size * 1.6 * ppm
    const boxX = W - MARGIN * ppm - boxW
    const boxY = 0.045 * ppm
    g.fillStyle = INK
    roundRect(g, boxX, boxY, boxW, boxH, boxH * 0.16)
    g.fill()
    g.fillStyle = '#ffffff'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(plate, boxX + boxW / 2, boxY + boxH / 2)
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
  }

  // The rows area's own rule, so the bands are visibly the plan and not the board.
  g.strokeStyle = MUTED
  g.lineWidth = Math.max(1, 0.006 * ppm)
  g.globalAlpha = 0.5
  g.beginPath()
  g.moveTo(MARGIN * ppm, (layout.area.y0 - 0.02) * ppm)
  g.lineTo(W - MARGIN * ppm, (layout.area.y0 - 0.02) * ppm)
  g.stroke()
  g.globalAlpha = 1

  if (layout.rows.length === 0) {
    g.fillStyle = MUTED
    const size = Math.min(0.16, Math.max(0.09, panel.h * 0.1))
    g.font = `bold ${size * ppm}px ${CJK}`
    g.textAlign = 'center'
    g.fillText('尚未铺设线路', W / 2, ((layout.area.y0 + layout.area.y1) / 2) * ppm)
    g.font = `${size * 0.5 * ppm}px ${LATIN}`
    g.fillText('no lines yet', W / 2, ((layout.area.y0 + layout.area.y1) / 2 + size * 1.3) * ppm)
    g.textAlign = 'left'
  }

  for (const row of layout.rows) {
    const y = row.y * ppm
    // The band: one thick stroke in the line's own colour, rounded at both ends.
    g.strokeStyle = row.colour
    g.lineWidth = row.weight * ppm
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(row.band.x0 * ppm, y)
    g.lineTo(row.band.x1 * ppm, y)
    g.stroke()
    g.lineCap = 'butt'

    // The shield: the line's own name, exactly as 线路 spells it.
    const sx = row.shield.x * ppm
    const sy = row.shield.y * ppm
    const sw = row.shield.w * ppm
    const sh = row.shield.h * ppm
    g.fillStyle = row.colour
    roundRect(g, sx, sy, sw, sh, Math.min(sw, sh) * 0.2)
    g.fill()
    const label = row.name.trim() === '' ? '—' : row.name
    g.fillStyle = '#ffffff'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const size = fitFont(g, label, sw * 0.86, sh * 0.62, CJK)
    g.font = `bold ${size}px ${CJK}`
    g.fillText(label, sx + sw / 2, sy + sh / 2)
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'

    // The stations: a white tick on the band, or a ring where lines meet.
    for (const tick of row.ticks) {
      const tx = tick.x * ppm
      if (tick.interchange) {
        g.fillStyle = '#ffffff'
        g.beginPath()
        g.arc(tx, y, row.weight * 0.62 * ppm, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = INK
        g.lineWidth = Math.max(1, row.weight * 0.18 * ppm)
        g.beginPath()
        g.arc(tx, y, row.weight * 0.62 * ppm, 0, Math.PI * 2)
        g.stroke()
      } else {
        g.fillStyle = '#ffffff'
        g.beginPath()
        g.arc(tx, y, row.weight * 0.34 * ppm, 0, Math.PI * 2)
        g.fill()
      }
    }

    // The names, under the band, centred on their own tick.
    g.fillStyle = INK
    for (const tick of row.ticks) {
      if (!tick.labelled) continue
      const size = fitFont(g, tick.name, Math.max(0.2, row.band.x1 - row.band.x0) * ppm, row.labelSize * ppm, CJK)
      g.font = `${size}px ${CJK}`
      g.textAlign = 'center'
      g.fillText(tick.name, tick.x * ppm, y + row.weight * 0.6 * ppm + row.labelSize * 0.92 * ppm)
      g.textAlign = 'left'
    }
  }

  // Footer: what the board holds, and what it could not.
  const footSize = Math.min(0.09, Math.max(0.055, panel.h * 0.05))
  g.fillStyle = MUTED
  g.font = `${footSize * ppm}px ${CJK}`
  g.fillText(`共 ${lines.length} 条线路 · ${layout.stations} 座车站`, MARGIN * ppm, layout.footerY * ppm)
  g.textAlign = 'right'
  g.font = `${footSize * ppm}px ${LATIN}`
  g.fillText(layout.hiddenLines > 0 ? `+${layout.hiddenLines} more lines` : 'Guangzhou Metro', W - MARGIN * ppm, layout.footerY * ppm)
  g.textAlign = 'left'

  return layout
}
