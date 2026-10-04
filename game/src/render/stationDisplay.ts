// The 电视 passenger-information screen — the frame around the advertising.
//
// A real platform TV is not a poster: it is line-branded passenger information
// (本趟列车开往 / 下趟列车开往 with a countdown, plus a service strip) with a
// **window** in the middle where the network feed plays. That window is the only
// part that changes content, and it changes on its own cadence.
//
// This module owns the frame: the arithmetic of "what is the next train, and how
// long until it", and the pixels of the station plate. It is separate from
// `models.ts` because `models.ts` builds the *hardware* (bezel, rods, the two lit
// plates) while this owns what the screen prints, and separate from `adArt.ts`
// because that owns the poster JPEGs, which are only one of the two panes here.
//
// The frame is station information, so it is authored output: which line, which
// terminus and what headway all come from the station document, and the countdown
// advances because the simulation clock does. Nothing here calls `Math.random` —
// the content cadence is rolled by the scene and passed in.

import type { LineDef } from '../sim/types.ts'

/** Narrow face; without it the Chinese labels fall back to a serif. */
const CJK = '"Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'

/**
 * The least a train has to be for this screen: where it is. Deliberately not
 * `TrainPose` from `models.ts` — this module must not depend on the module
 * builder, or the TV model and the screen it prints would import each other.
 */
export interface DisplayTrain {
  x: number
  y: number
  /** The line this train runs, matched by the sim's own line id. */
  lineId?: string
}

/** One line's live service, as the frame prints it. */
export interface TvLineStatus {
  /** The line's display name, e.g. `2号线`. */
  name: string
  /** The line's sign colour, `#rrggbb`. */
  colour: string
  /** The destination of the next train. */
  terminus: string
  /** Minutes until that train, or null when nothing is running. */
  minutes: number | null
  /** True when a train is already in the platform area (本趟列车). */
  atPlatform: boolean
  /** Headway in minutes, for the trailing strip. */
  headway: number
}

/**
 * How far along its own run a train is. A train is long relative to a platform,
 * so the pose's leading end is a coarse-enough position for a countdown.
 */
function progressOf(pose: DisplayTrain, travelSign: number): number {
  return travelSign >= 0 ? pose.x : pose.y
}

/** Beyond this many metres a train is not "arriving" yet. */
const APPROACH_WINDOW_M = 220

/** How close to the mark counts as standing at the platform. */
const AT_PLATFORM_M = 16

/**
 * The next train on `line` and how long until it reaches `at`.
 *
 * The sim does not publish a per-train timetable to the renderer, so the countdown
 * is derived from the trains that actually exist: the nearest one still short of
 * the point, divided by a nominal line speed. When nothing is within the approach
 * window the sign falls back to the line's own headway, which is what a passenger
 * reads between services anyway.
 */
export function tvLineStatus(
  line: LineDef,
  trains: readonly DisplayTrain[],
  at: readonly [number, number],
): TvLineStatus {
  const terminus = line.direction === 'up' ? line.upTerminus : line.downTerminus
  const headway = line.headwayProfile.peak
  // The pose runs along the line's own travel axis; across it, a train on the
  // other track is a different platform's train and must not be counted here.
  const along = (p: DisplayTrain): number => progressOf(p, line.travelSign)
  const across = (p: DisplayTrain): number => (line.travelSign >= 0 ? p.y : p.x)
  const berth = line.travelSign >= 0 ? at[0] : at[1]
  const lane = line.travelSign >= 0 ? at[1] : at[0]

  let best: number | null = null
  let atPlatform = false
  for (const t of trains) {
    if (t.lineId !== undefined && t.lineId !== line.id) continue
    if (Math.abs(across(t) - lane) > 2.5) continue
    const gap = (berth - along(t)) * Math.sign(line.travelSign)
    // A consist is long, so "at the platform" is a band around the mark, not a
    // single point: a train drawing up to it is already the next service, and one
    // that has just pulled away still is not the one after.
    if (Math.abs(gap) <= AT_PLATFORM_M) {
      atPlatform = true
      continue
    }
    if (gap <= 0) continue // gone past: not this platform's next train
    if (gap > APPROACH_WINDOW_M) continue
    best = best === null ? gap : Math.min(best, gap)
  }

  // A nominal line speed, so the count cycles down as the train closes in.
  const NOMINAL_MPS = 13
  return {
    name: line.name,
    colour: line.colour,
    terminus: terminus === '' ? (line.direction === 'up' ? '上行' : '下行') : terminus,
    minutes: atPlatform ? 0 : best === null ? null : Math.max(1, Math.round(best / NOMINAL_MPS / 60)),
    atPlatform,
    headway,
  }
}

/* ------------------------------------------------------------------ pixels */

/** Base plate resolution. The panel is roughly 40 × 19 units, so this is 16 px/unit. */
export const STATION_PLATE = { width: 640, height: 304 } as const

/**
 * The split between the station board and the content window, as fractions of the
 * screen.
 *
 * The window is **everything right of `x`, and full height**: the artwork fills its
 * whole half of the panel, top to bottom, with no margin. The board is everything
 * left of `x`, and its text sits in the upper part of that half so it never runs
 * under the window. The model reads these same fractions for its own meshes, so the
 * drawn split and the geometry cannot disagree — and because the two regions tile
 * the screen exactly (`x + w === 1`), there is nothing between them to leave a gap.
 */
export const TV_POSTER_RECT = { x: 0.42, w: 0.58 } as const

/**
 * How much of the board column's height its text may use, top-aligned. The window
 * is full height, so this is what keeps the stack clear of it; it is nearly the
 * whole column because the cards need room for their label and their terminus
 * without the two lines colliding.
 */
export const TV_BOARD_TEXT_H = 0.92

/** How far the text keeps off the panel's own edge, inside a card. */
export const CARD_INSET = 14

/** Every rectangle on the plate, in plate pixels. */
export interface StationDisplayLayout {
  header: { x: number; y: number; w: number; h: number }
  poster: { x: number; y: number; w: number; h: number }
  cards: Array<{ x: number; y: number; w: number; h: number }>
  strip: { x: number; y: number; w: number; h: number }
  /** The departure clock, inside the information column — never under the window. */
  clock: { x: number; y: number; w: number; h: number }
}

/**
 * Where everything on the plate goes, as plain numbers.
 *
 * The layout is separated from the drawing so the invariants that matter can be
 * checked without a canvas:
 *
 *  * **The two regions tile the screen exactly.** The board column runs from the
 *    plate's left edge to the split, the window from the split to the right edge,
 *    and `TV_POSTER_RECT.x + TV_POSTER_RECT.w === 1`. There is no padding on either
 *    side of the seam, because any slack there is bare backing between the
 *    information and the picture. The inset that keeps text off the panel edge is
 *    carried by the cards themselves (`CARD_INSET`), not by the column.
 *  * **The text never runs under the window.** It is top-aligned inside the top
 *    `TV_BOARD_TEXT_H` of the column, so the tallest board still clears the
 *    full-height window beside it.
 *
 * The clock belongs to the column rather than to a plate corner: a corner clock
 * would sit under the artwork and be painted over.
 */
export function stationDisplayLayout(
  width = STATION_PLATE.width,
  height = STATION_PLATE.height,
): StationDisplayLayout {
  const gap = 7
  const clockH = 24
  const stripH = 32
  const posterX = width * TV_POSTER_RECT.x
  const poster = { x: posterX, y: 0, w: width * TV_POSTER_RECT.w, h: height }
  // The column is the whole left region: from the plate's left edge to the split.
  const colX = 0
  const colW = posterX
  const textH = height * TV_BOARD_TEXT_H
  const clockY = textH - clockH
  const stripY = clockY - gap - stripH
  const cardsTop = CARD_INSET + 40
  // Three cards share whatever the header, strip and clock leave behind.
  const cardH = (stripY - gap - cardsTop - gap * 2) / 3
  return {
    header: { x: colX, y: CARD_INSET, w: colW, h: 34 },
    poster,
    cards: [0, 1, 2].map((i) => ({ x: colX, y: cardsTop + (cardH + gap) * i, w: colW, h: cardH })),
    strip: { x: colX, y: stripY, w: colW, h: stripH },
    clock: { x: colX, y: clockY, w: colW, h: clockH },
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

/** Fit `text` inside `max` px, shrinking the font until it does. */
function fitText(g: CanvasRenderingContext2D, text: string, max: number, start: number, weight: string): number {
  let size = start
  for (;;) {
    g.font = `${weight} ${size}px ${CJK}`
    if (g.measureText(text).width <= max || size <= 8) return size
    size -= 1
  }
}

/**
 * One white destination card: a small label line over the terminus. This is the
 * shape the reference photo repeats three times.
 */
function destinationCard(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  labelZh: string,
  labelEn: string,
  value: string,
  valueColour: string,
): void {
  g.fillStyle = '#ffffff'
  roundRect(g, x, y, w, h, 5)
  g.fill()
  g.strokeStyle = '#c3ccd6'
  g.lineWidth = 1.5
  g.stroke()

  const pad = 8
  const inner = w - pad * 2
  g.textAlign = 'left'
  g.textBaseline = 'top'
  // The Chinese label is what a passenger reads, so it gets a fixed share of the
  // card; the English gloss sits in the remainder, right-aligned, and is simply
  // dropped if it cannot fit. Both are measured against their *own* box, so no
  // font-metric surprise can make them overlap.
  const zhBox = inner * 0.6
  const enBox = inner - zhBox - 6
  const labelSize = fitText(g, labelZh, zhBox, 13, 'bold')
  g.fillStyle = '#2a3340'
  g.fillText(labelZh, x + pad, y + 6)
  if (enBox > 40) {
    fitText(g, labelEn, enBox, 9, 'italic')
    g.textAlign = 'right'
    g.fillStyle = '#8d99a6'
    g.fillText(labelEn, x + w - pad, y + 7 + labelSize - 10)
    g.textAlign = 'left'
  }

  const valueSize = fitText(g, value, inner, 22, 'bold')
  g.fillStyle = valueColour
  g.fillText(value, x + pad, y + h - valueSize - 7)
}

/**
 * Draw the whole lit plate. The line's status, the station name and the clock are
 * the only inputs: everything else is derived here, so the plate is static unless
 * one of those actually changed.
 */
export function drawStationDisplay(
  g: CanvasRenderingContext2D,
  status: TvLineStatus | null,
  stationName: string,
  clock: string,
): void {
  const { width: W, height: H } = STATION_PLATE
  g.clearRect(0, 0, W, H)

  // Screen ground: a dark panel with a thin bezel inside the model's frame.
  g.fillStyle = '#0b0e13'
  g.fillRect(0, 0, W, H)

  if (!status) {
    // No line bound anywhere: print the station, not a broken countdown.
    g.fillStyle = '#3d4855'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `bold 34px ${CJK}`
    g.fillText(stationName, W / 2, H / 2 - 16)
    g.font = `16px ${CJK}`
    g.fillStyle = '#5c6a7a'
    g.fillText('尚未铺设线路', W / 2, H / 2 + 26)
    return
  }

  const colour = status.colour
  // The text inset and the column width come from the layout, so the drawn board
  // and the tested rectangles cannot drift apart.
  const pad = CARD_INSET
  const colW = W * TV_POSTER_RECT.x

  // ---- header: line shield + station name ---------------------------------
  const shieldW = 62
  g.fillStyle = colour
  roundRect(g, pad, pad, shieldW, 30, 6)
  g.fill()
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const shieldLabel = status.name.replace(/号线$/, '')
  g.font = `bold 20px ${CJK}`
  g.fillStyle = '#ffffff'
  g.fillText(shieldLabel, pad + shieldW / 2, pad + 16)

  g.textAlign = 'left'
  // `fitText` leaves the chosen size as the context's current font.
  fitText(g, stationName, colW - shieldW - 12, 22, 'bold')
  g.fillStyle = '#e8eef6'
  g.fillText(stationName, pad + shieldW + 10, pad + 16)

  // ---- the three destination cards ---------------------------------------
  // The card geometry comes from `stationDisplayLayout`, so the drawn cards and
  // the tested layout can never drift apart.
  const { cards, strip, clock: clockBox } = stationDisplayLayout(W, H)
  const [card0, card1, card2] = cards
  const cardW = card0.w
  const cardH = card0.h

  // Card 1: this train. A train already at the platform reads 列车进站.
  const thisValue = status.atPlatform || status.minutes === 0 ? '列车进站' : '即将进站'
  destinationCard(g, card0.x, card0.y, cardW, cardH, '本趟列车开往', 'The First Train', status.terminus, '#101418')
  // The 进站 / 即将进站 strap rides on the card's own bottom edge.
  g.textAlign = 'right'
  g.textBaseline = 'alphabetic'
  g.font = `bold 17px ${CJK}`
  g.fillStyle = status.atPlatform ? '#c0392b' : '#1f7a4d'
  g.fillText(thisValue, card0.x + cardW - 8, card0.y + cardH - 8)

  // Cards 2 and 3: the next two services, spaced by the line's headway.
  const headway = Math.max(1, Math.round(status.headway))
  const next = status.minutes === null ? headway : status.minutes + headway
  const third = next + headway
  destinationCard(g, card1.x, card1.y, cardW, cardH, '下趟列车开往', 'The Next Train', status.terminus, '#101418')
  g.textAlign = 'right'
  g.textBaseline = 'alphabetic'
  g.font = `bold 20px ${CJK}`
  g.fillStyle = '#2a3340'
  g.fillText(`${next} 分钟`, card1.x + cardW - 8, card1.y + cardH - 8)

  destinationCard(g, card2.x, card2.y, cardW, cardH, '第三趟列车开往', 'The Third Train', status.terminus, '#101418')
  g.textAlign = 'right'
  g.textBaseline = 'alphabetic'
  g.font = `bold 20px ${CJK}`
  g.fillStyle = '#2a3340'
  g.fillText(`${third} 分钟`, card2.x + cardW - 8, card2.y + cardH - 8)

  // ---- service strip ------------------------------------------------------
  g.fillStyle = '#0a1d3a'
  roundRect(g, strip.x, strip.y, strip.w, strip.h, 4)
  g.fill()
  g.textAlign = 'left'
  g.textBaseline = 'middle'
  g.font = `italic bold 16px ${CJK}`
  g.fillStyle = '#1f6fd6'
  g.fillText('乘', strip.x + 8, strip.y + strip.h / 2)
  g.font = `13px ${CJK}`
  g.fillStyle = '#9fb6d4'
  g.fillText('车站提醒：请注意脚下安全', strip.x + 32, strip.y + strip.h / 2)

  // ---- departure clock, inside the column ---------------------------------
  // Right-aligned to the column so it reads as part of the board. It must not
  // stray past `poster.x`: that region belongs to the artwork.
  g.textAlign = 'right'
  g.textBaseline = 'middle'
  g.font = `18px ${CJK}`
  g.fillStyle = '#6b7787'
  g.fillText('发车时间', clockBox.x + clockBox.w, clockBox.y + clockBox.h / 2)
  const doneW = g.measureText('发车时间').width
  g.font = `bold 22px ${CJK}`
  g.fillStyle = '#e8eef6'
  g.fillText(clock, clockBox.x + clockBox.w - doneW - 12, clockBox.y + clockBox.h / 2)
}
