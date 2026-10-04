// The 指示牌 panel — the layout model behind a sign's printed faces.
//
// A sign used to print one fixed wayfinding board for the whole station: every
// piece hung the same `wayfindingCanvas()`, so the player could not say *where*
// the toilets are, which line this concourse serves, or which way the exit is.
// This module makes the board a **document** instead: an ordered list of
// components (arrows, line badges, custom text, icon labels) laid out on the
// panel by metres, which the player drags in the board editor.
//
// It is pure: no DOM, no canvas, no three. `render/signFace.ts` owns the pixels
// and `app/SignEditor.tsx` owns the drag surface; both read the geometry here, so
// the flat preview in the editor, the hover ghost and the lit face on the drawn
// model are one layout drawn three times.
//
// A sign is **two boards**, front and back (`SignBoards`). A 指示牌 is read from
// both sides of the concourse and each side prints its own wayfinding, so the two
// are independent documents: the front is what an approaching passenger reads, the
// back is what someone coming the other way reads, and either may be empty — in
// which case that side is simply the unlit black plate, which is what the back of
// a fresh sign is. `side` on a component is the older, per-component way of saying
// the same thing; `signBoardsOf` folds it into the pair once, so a save written
// before a sign had two boards reads exactly like a new one.
//
// The board **sizes itself to what it carries**. `signPanelSize(layout)` gives the
// panel its metres — wider than `PANEL_MIN_W` when the components need the room,
// taller than `PANEL_MIN_H` when they stack — clamped to a ceiling so a sign
// never grows into a wall. Every component is placed in metres from the panel's
// bottom-left, so making the panel bigger moves nothing; the renderer scales
// `PX_PER_METRE` pixels per metre whatever the panel's own size is.

import type { LineDef, Module } from './types.ts'

/* ------------------------------------------------------------------ panel */

/**
 * The board's floor: the smallest panel a sign may be, set just above the standard
 * row's own length so the default board is exactly the floor rather than a hair
 * over it.
 */
export const PANEL_MIN_W = 2.1
export const PANEL_MIN_H = 0.7

/**
 * The board's ceiling. A sign that needs more room than this has too much on it:
 * the editor stops growing here and the layout is clamped inside, which is what
 * keeps a board from becoming a wall across the concourse.
 */
export const PANEL_MAX_W = 3.4
export const PANEL_MAX_H = 1.6

/**
 * The pad kept between the outermost mark and the board's own edge when the board
 * sizes itself, in metres. It is roughly the frame the renderer draws, so a grown
 * board has the same quiet margin at its edge as the floor board has.
 */
export const PANEL_PAD = 0.06

/**
 * The printed frame, as a fraction of each edge. The model draws a dark steel
 * border, and the lit face is inset inside it; this is that margin as a fraction
 * of the panel, and it is where the layout's quiet edge comes from —
 * `signContentBox` is the area the renderer and the clamp both work in.
 */
export const PANEL_INSET = 0.03

/** Pixels per metre on the face: 16 px/cm, at every panel size. */
export const PX_PER_METRE = 512

/** The panel's size in metres. */
export interface SignPanelSize {
  w: number
  h: number
}

/** The default board's metres — the floor, which is what a fresh sign is. */
export const PANEL_SIZE: SignPanelSize = { w: PANEL_MIN_W, h: PANEL_MIN_H }

/** The printed area inside the frame, in metres, for a panel of size `panel`. */
export function signContentBox(panel: SignPanelSize = PANEL_SIZE): { w: number; h: number } {
  return { w: panel.w * (1 - PANEL_INSET * 2), h: panel.h * (1 - PANEL_INSET * 2) }
}

/** The lit face's texture at a panel size: `PX_PER_METRE` pixels per metre. */
export function signPlate(panel: SignPanelSize): { width: number; height: number } {
  return {
    width: Math.max(64, Math.round(panel.w * PX_PER_METRE)),
    height: Math.max(64, Math.round(panel.h * PX_PER_METRE)),
  }
}

/**
 * The frame the renderer draws, in plate pixels. It is `PANEL_INSET` of the
 * *panel's own height*, so the border is proportionally the same on a tall board
 * as on a shallow one — the drawn frame and the layout's quiet edge agree.
 */
export function signFramePx(panel: SignPanelSize): number {
  const { height } = signPlate(panel)
  return Math.max(3, height * (PANEL_INSET / (1 - PANEL_INSET * 2)))
}

/**
 * The station facts the *layout* needs: only its lines, and only read. Both the
 * build model (which holds a whole document) and a caller with a bare array
 * satisfy this, so neither has to wrap the other.
 */
export interface SignLineSource {
  lines: ReadonlyArray<LineDef>
}

/* ------------------------------------------------------------- components */

/**
 * The wayfinding pictograms a component may wear, in the order the inspector
 * lists them. Each one is a **bitmap** — `render/signFace.ts` prints the asset
 * `prep-sign-icons.py` makes from the reference photographs — so a mark's look is
 * decided by the artwork and not by a drawing routine here, and the list is the
 * one place the catalogue and the files have to agree.
 */
export type SignIcon =
  | 'train'
  | 'lift'
  | 'accessible'
  | 'restroom'
  | 'escalator'
  | 'stairs'
  | 'exit'

export const SIGN_ICONS: readonly SignIcon[] = [
  'train',
  'lift',
  'accessible',
  'restroom',
  'escalator',
  'stairs',
  'exit',
]

/** What each pictogram is called, in the inspector's own words. */
export const SIGN_ICON_LABEL: Record<SignIcon, string> = {
  train: '列车',
  lift: '电梯',
  accessible: '无障碍',
  restroom: '卫生间',
  escalator: '扶梯',
  stairs: '楼梯',
  exit: '出口',
}

/** The shapes an arrow component can point. */
export type SignArrow = 'left' | 'right' | 'up' | 'down' | 'up-left' | 'up-right' | 'down-left' | 'down-right'

export const SIGN_ARROWS: readonly SignArrow[] = ['left', 'right', 'up', 'down', 'up-left', 'up-right', 'down-left', 'down-right']

/** The arrow's own short label, for the inspector's chips. */
export const SIGN_ARROW_LABEL: Record<SignArrow, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  'up-left': '↖',
  'up-right': '↗',
  'down-left': '↙',
  'down-right': '↘',
}

/**
 * Which face of the board a component prints on. A 指示牌 is double-sided, so the
 * default is both; a piece that belongs on one face only (an exit plate on the
 * approach side) may say so. The board is turned by the placement rotation, so
 * "left" and "right" are the panel's own two faces, not compass directions.
 */
export type SignSide = 'both' | 'left' | 'right'

/**
 * Which panel is being composed: one of the board's two faces, or `'both'` for a
 * canvas that stands in for the whole board (the palette thumbnail, or a test
 * checking that every component is somewhere on the panel). A component bound to
 * one face is filtered out of the other, but never out of `'both'`.
 */
export type SignFace = 'both' | 'left' | 'right'

/** The fields every component shares: where it sits, how big, and its layer. */
export interface SignBase {
  /** Stable within its sign, so the editor can keep a selection across edits. */
  id: string
  /** Centre on the panel, 0…1 from the left and 0…1 from the bottom. */
  x: number
  y: number
  /** Multiplier on the kind's default size, 0.4…2. */
  scale: number
  /** Which face it prints on. */
  side: SignSide
}

/** An arrow pointing a way. */
export interface SignArrowComponent extends SignBase {
  kind: 'arrow'
  arrow: SignArrow
}

/**
 * A line badge: the line's own shield — a coloured plate printing the line's name
 * **exactly as 线路 spells it** (`5号线`), taken from the station document rather
 * than typed. `lineId` empty means the station's first line. `english` adds the
 * compact gloss under it (`Line 5`); nothing else is added, because the shield is
 * the line's own name and a second rendering of it would only be noise.
 */
export interface SignLineComponent extends SignBase {
  kind: 'line'
  lineId: string
  /** Draw the compact English gloss under the name. */
  english: boolean
}

/** A free-text label, at most two lines of `SIGN_TEXT_MAX` characters. */
export interface SignTextComponent extends SignBase {
  kind: 'text'
  text: string
}

/** A pictogram. An icon is a picture: it carries no caption and no wording. */
export interface SignIconComponent extends SignBase {
  kind: 'icon'
  icon: SignIcon
}

export type SignComponent = SignArrowComponent | SignLineComponent | SignTextComponent | SignIconComponent
export type SignComponentKind = SignComponent['kind']

/**
 * One component of a group that has no identity yet — a palette block's parts,
 * before the editor mints their ids. Distributive, so the union survives the
 * `Omit`: a plain `Omit<SignComponent, 'id'>` would collapse the four kinds into
 * their common fields and lose `icon`, `text`, `arrow` and `lineId`.
 */
export type SignComponentDraft = SignComponent extends infer T ? (T extends SignComponent ? Omit<T, 'id'> : never) : never
/** Everything a sign prints, in paint order — later components sit on top. */
export type SignLayout = SignComponent[]

/** The longest text a single label may carry, matching §5.8's 2 × 8 rule. */
export const SIGN_TEXT_MAX = 8

/** The most lines one label may print. */
export const SIGN_TEXT_LINES = 2

/**
 * How much smaller a label's **second** line prints than its first, so one text box
 * carries a sign's two languages in their own sizes: 中文 large on the first line,
 * English small under it. The ratio is one number for the model, the renderer and
 * the editor's tiles, so all three agree on how wide the label is. A label of one
 * line is unaffected.
 */
export const SIGN_TEXT_EN_SCALE = 0.62

/** The size multiplier of a label's line `i` (0-based): the first at full size. */
export function signTextLineScale(i: number): number {
  return i === 0 ? 1 : SIGN_TEXT_EN_SCALE
}

/** The most components one panel holds, so a sign cannot become a novel.
 *
 * Ten is also the number of **bins** the editor lays the row over, and the two are
 * the same limit on purpose: a board is a list of fixed places, and the tenth place
 * is the last one there is. */
export const SIGN_COMPONENT_MAX = 10

/** Base sizes in metres, before `scale`. One conversion drives both faces. */
export const SIGN_SIZE: Record<SignComponentKind, { w: number; h: number }> = {
  // An arrow is a long mark: a 1.6:1 shape pointing along the panel.
  arrow: { w: 0.48, h: 0.3 },
  // A line shield. Wide enough for 1号线 over Line 1, like the reference plates;
  // a shield printing only its number leaves the lower rows empty.
  line: { w: 0.42, h: 0.28 },
  // One line of type. The measured width is what actually matters, so this is
  // only the height the drawing uses.
  text: { w: 0, h: 0.16 },
  // A pictogram, printed from its own bitmap (`render/pictograms.ts`).
  icon: { w: 0.3, h: 0.3 },
}

/** The smallest and largest multiplier a component may be scaled by. */
export const SIGN_SCALE_MIN = 0.4
export const SIGN_SCALE_MAX = 2

/** A line badge whose line is unknown: a neutral steel shield, not a guess. */
export const SIGN_LINE_FALLBACK_COLOUR = '#3c434c'

/* ---------------------------------------------------------------- layout */

/**
 * One component's measured box, in metres, as its bottom-left corner relative to
 * the panel's bottom-left. This is the only geometry the renderer and the editor
 * both need — everything else (fills, fonts, strokes) belongs to the drawing.
 */
export interface SignPiece {
  id: string
  kind: SignComponentKind
  /** 0 = the left face's own view, 1 = the right face's. */
  side: SignSide
  /**
   * The box the component **occupies**, in metres, including `SIGN_PIECE_PAD`.
   * This is what the board makes room for, what the overlap rule separates and
   * what the editor hit-tests.
   */
  w: number
  h: number
  /** The ink the renderer draws, inside that box. */
  inkW: number
  inkH: number
  /** Bottom-left corner of the *box*, in metres from the panel's bottom-left. */
  left: number
  bottom: number
  /** The centre actually used, after the panel's clamp — `drawSignPanel` draws on
   * this, so the reported box and the painted marks are one geometry. */
  x: number
  y: number
  /** The scale actually used, after `clampSignScale`. */
  scale: number
}

/** Clamp a component's scale to the range the panel can carry. */
export function clampSignScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(SIGN_SCALE_MAX, Math.max(SIGN_SCALE_MIN, scale))
}

/**
 * How wide a label prints, in metres, at `size` metres of type.
 *
 * Text is measured when a canvas is available — `render/signFace.ts` passes the
 * real `measureText` — and estimated from a per-character table when it is not,
 * which is what the Node tests get. The estimate is deliberately a little
 * generous (a terminal `measureText` never comes out wider), and the panel's
 * clamp uses it, so a label can never be positioned by a width it does not have.
 */
export type SignMeasure = (text: string, size: number) => number

/** Rough advance widths, in ems, for the fallback measure. */
const EM_CJK = 1.0
const EM_UPPER = 0.68
const EM_LOWER = 0.55
const EM_DIGIT = 0.58
const EM_SPACE = 0.3
const EM_OTHER = 0.6

/**
 * The estimated width of `text` set in `size` metres of type: full-width CJK
 * counts as one em, Latin and digits by their own rough advances.
 */
export function estimateSignTextWidth(text: string, size: number): number {
  let em = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x2e80) em += EM_CJK
    else if (ch === ' ') em += EM_SPACE
    else if (ch >= '0' && ch <= '9') em += EM_DIGIT
    else if (ch >= 'A' && ch <= 'Z') em += EM_UPPER
    else if (ch >= 'a' && ch <= 'z') em += EM_LOWER
    else em += EM_OTHER
  }
  return em * size
}

/** Split a label into at most `SIGN_TEXT_LINES` lines, each at most `SIGN_TEXT_MAX`. */
export function signTextLines(text: string): string[] {
  const rows = text
    .split(/\r?\n/)
    .map((r) => [...r].slice(0, SIGN_TEXT_MAX).join(''))
    .filter((r) => r.length > 0)
  return rows.slice(0, SIGN_TEXT_LINES)
}

/**
 * The font size one line of a label prints at. The line count does not change the
 * size — every row of a multi-line label is set at this size — so the caller only
 * has to know how many rows it is stacking.
 */
export function signTextSize(scale: number): number {
  return SIGN_SIZE.text.h * scale
}

/**
 * The pad a component keeps around itself, in metres, beyond its own drawn size.
 * It is what stops two marks on a board from touching: `signPieceSize` adds it on
 * both axes, so the box a component occupies — and therefore the box the row packs
 * around — is always slightly larger than the ink.
 */
export const SIGN_PIECE_PAD = 0.03

/**
 * A component's size in metres, **including** `SIGN_PIECE_PAD` on every side: the
 * box the board has to make room for.
 *
 * Text is measured rather than declared, and takes the number of printed lines
 * into account so a two-line label is twice as tall. An icon with a caption is the
 * same story: the box grows downward by the caption line the renderer prints under
 * the mark, because a box that did not know about the caption would let one hang
 * off the bottom of the board.
 */
export function signPieceSize(c: SignComponent, measure: SignMeasure = estimateSignTextWidth): { w: number; h: number } {
  const inner = signInkSize(c, measure)
  if (inner.w <= 0 || inner.h <= 0) return inner
  return { w: inner.w + SIGN_PIECE_PAD * 2, h: inner.h + SIGN_PIECE_PAD * 2 }
}

/**
 * The ink itself, without the pad: what the renderer draws. Only the drawing needs
 * this — the layout and the overlap rule both work in padded boxes.
 */
export function signInkSize(c: SignComponent, measure: SignMeasure = estimateSignTextWidth): { w: number; h: number } {
  const scale = clampSignScale(c.scale)
  switch (c.kind) {
    case 'arrow':
      return { w: SIGN_SIZE.arrow.w * scale, h: SIGN_SIZE.arrow.h * scale }
    case 'line':
      return { w: SIGN_SIZE.line.w * scale, h: SIGN_SIZE.line.h * scale }
    case 'icon':
      // An icon is a square mark and nothing else — no caption to make room for.
      return { w: SIGN_SIZE.icon.w * scale, h: SIGN_SIZE.icon.h * scale }
    case 'text': {
      const lines = signTextLines(c.text)
      if (lines.length === 0) return { w: 0, h: 0 }
      const size = signTextSize(scale)
      // Each row is measured at its own size (the gloss line is smaller), and the
      // box is as tall as the stack of rows at the first line's size.
      const w = Math.max(...lines.map((l, i) => measure(l, size * signTextLineScale(i))))
      return { w, h: size * 1.15 * lines.length }
    }
  }
}

/** How close to the board's edge a component may sit: a small quiet margin. */
const EDGE_PAD = 0.006

/**
 * Where a component's centre may sit, in metres from the panel's bottom-left.
 *
 * The board carries **one row** of content, so `y` is not a free axis: it is
 * pinned to the row's centre line and only `x` moves. A 指示牌 is a list read left
 * to right — marks do not stack up the face — and pinning `y` is what makes that
 * structural rather than a habit. The box is the whole panel less the piece's own
 * half-extent horizontally, so a board sized for a mark lets it sit exactly at the
 * edge.
 *
 * A component wider than the board — a long label, or one scaled right up — is
 * pinned on the centre rather than given an inverted range; `signPanelSize` is
 * what normally avoids that case by growing the board.
 */
export function signCentreRange(c: SignComponent, panel: SignPanelSize, measure?: SignMeasure): { x: [number, number]; y: [number, number] } {
  const { w } = signPieceSize(c, measure)
  const halfW = w / 2 + EDGE_PAD
  const x: [number, number] = halfW * 2 >= panel.w ? [panel.w / 2, panel.w / 2] : [halfW, panel.w - halfW]
  const row = panel.h / 2
  return { x, y: [row, row] }
}

/**
 * Fold an arbitrary centre into the range the panel allows. Positions are in
 * metres, so a board that grows keeps every component exactly where the player
 * put it — the clamp only ever pulls a piece back from over the frame.
 */
export function clampSignComponent(c: SignComponent, panel: SignPanelSize = PANEL_SIZE, measure?: SignMeasure): SignComponent {
  const range = signCentreRange(c, panel, measure)
  const x = Math.min(range.x[1], Math.max(range.x[0], c.x))
  const y = Math.min(range.y[1], Math.max(range.y[0], c.y))
  const scale = clampSignScale(c.scale)
  const id = c.id === '' ? 'c' : c.id
  if (x === c.x && y === c.y && scale === c.scale && id === c.id) return c
  return { ...c, id, x, y, scale }
}

/**
 * Lay the row out: place every component along the line, left to right, with no
 * two boxes sharing an area.
 *
 * This is a **pack, not a collision hunt**, and that is the whole point. A row is a
 * list, so it is built the way a list is, in three steps:
 *
 *  1. the row's **anchors** are laid first — the pieces the player is holding.
 *     `lockedIds` keeps its exact position (a board that shoved a block out from
 *     under the pointer would read as a bug), so a block dropped on top of two
 *     others inserts exactly where it was let go;
 *  2. everything else is taken in order of where it *wants* to be, and each piece
 *     goes into the first free gap at or after that point wide enough to hold it;
 *  3. the requested order is kept, so the roster and the board read the same way.
 *
 * Because a piece is only ever placed into room that is already free, no resolved
 * pair can create a new collision: one pass is exact. This replaced a separation
 * loop that oscillated between two collisions whenever a board's ends were both
 * against the frame — which, on a one-row board, is most of the time.
 *
 * Desired positions are read as written, so a block dropped past the end of the
 * board comes to rest past the end of it; the caller measures the result
 * (`signPanelSize`), and that is the sign's new length.
 */
export function packSignRow(
  layout: readonly SignComponent[],
  lockedIds?: ReadonlySet<string>,
  measure: SignMeasure = estimateSignTextWidth,
): SignLayout {
  const isLocked = (id: string): boolean => lockedIds !== undefined && lockedIds.has(id)
  const items = layout
    .map((c, i) => ({ c, i, w: signPieceSize(c, measure).w }))
    .filter((p) => p.w > 0)
  const occupied: Array<[number, number]> = []
  const at = new Map<string, number>()

  // 1. The anchors: held pieces, exactly where they were put, left to right.
  for (const { c, w } of items.filter((p) => isLocked(p.c.id)).sort((a, b) => a.c.x - b.c.x || a.i - b.i)) {
    const centre = Math.max(EDGE_PAD + w / 2, c.x)
    at.set(c.id, centre)
    occupied.push([centre - w / 2, centre + w / 2])
  }
  // 2. Everything else, in order of where it wants to be, into the first room at or
  //    after that point that holds it.
  for (const { c, w } of items.filter((p) => !isLocked(p.c.id)).sort((a, b) => a.c.x - b.c.x || a.i - b.i)) {
    // The request is read as written, which is what lets a drop past the end of the
    // board move the end of the board. A request past the ceiling is folded back to
    // the last place a piece can sit, so a board that runs out of room piles its
    // last marks at the end rather than placing them off the sign.
    const want = Math.max(EDGE_PAD + w / 2, Math.min(c.x, PANEL_MAX_W - w / 2))
    let centre = want
    for (const [left, right] of [...occupied].sort((a, b) => a[0] - b[0])) {
      if (centre - w / 2 < right && centre + w / 2 > left) centre = right + w / 2
    }
    // No room left between here and the ceiling: the piece takes the middle of what
    // the row leaves, which is where a board that is genuinely over-full puts it.
    if (centre + w / 2 > PANEL_MAX_W) centre = Math.max(EDGE_PAD + w / 2, PANEL_MAX_W - w / 2)
    at.set(c.id, centre)
    occupied.push([centre - w / 2, centre + w / 2])
  }
  // 3. Back into the requested order, so the roster reads like the board.
  return layout.map((c) => (at.has(c.id) ? { ...c, x: at.get(c.id) as number, y: ROW_Y } : c))
}

/**
 * Every component's measured box for one face, in paint order, in metres from the
 * board's bottom-left.
 *
 * `side` filters the board: a component bound to one face is simply absent from the
 * other, which is what makes a one-way sign one-way. The renderer draws this list
 * and the editor hit-tests it, so neither can disagree with the other about where a
 * piece is — and both get the **clamped** box, so a layout written by hand (or by
 * an older build) cannot paint outside the board even though
 * `clampSignComponent` would have moved it.
 */
export function signPieces(
  layout: readonly SignComponent[],
  panel: SignPanelSize = PANEL_SIZE,
  face: SignFace = 'both',
  measure: SignMeasure = estimateSignTextWidth,
): SignPiece[] {
  const out: SignPiece[] = []
  for (const c of layout) {
    if (c.side !== 'both' && face !== 'both' && c.side !== face) continue
    const pad = signPieceSize(c, measure)
    const ink = signInkSize(c, measure)
    if (pad.w <= 0 || pad.h <= 0 || ink.w <= 0 || ink.h <= 0) continue
    const placed = clampSignComponent(c, panel, measure)
    out.push({
      id: placed.id,
      kind: placed.kind,
      side: placed.side,
      scale: clampSignScale(placed.scale),
      w: pad.w,
      h: pad.h,
      inkW: ink.w,
      inkH: ink.h,
      x: placed.x,
      y: placed.y,
      left: placed.x - pad.w / 2,
      bottom: placed.y - pad.h / 2,
    })
  }
  return out
}

/**
 * The topmost component under a point given in **metres** from the panel's
 * bottom-left, or null. Later components paint over earlier ones, so the hit test
 * walks the list backwards — a click picks what the player can see.
 */
export function hitSignComponent(
  layout: readonly SignComponent[],
  x: number,
  y: number,
  panel: SignPanelSize = PANEL_SIZE,
  face: SignFace = 'both',
  measure: SignMeasure = estimateSignTextWidth,
): SignComponent | null {
  const pieces = signPieces(layout, panel, face, measure)
  // A margin as wide as the frame's drawn border, so a slim mark is still easy to
  // grab on a big board.
  const slack = PANEL_INSET * panel.h
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]
    if (x >= p.left - slack && x <= p.left + p.w + slack && y >= p.bottom - slack && y <= p.bottom + p.h + slack) {
      const found = layout.find((c) => c.id === p.id)
      if (found) return found
    }
  }
  return null
}

/**
 * The component nearest `(x, y)`, in metres, whose box contains the point —
 * limited to a set of ids. This is the editor's **swap** rule: dropping a dragged
 * mark onto another hands the two their places, so a board can be rearranged
 * without dragging anything out of the way first.
 */
export function signComponentAt(
  layout: readonly SignComponent[],
  x: number,
  y: number,
  ids?: ReadonlySet<string>,
  panel: SignPanelSize = PANEL_SIZE,
  face: SignFace = 'both',
  measure: SignMeasure = estimateSignTextWidth,
): SignComponent | null {
  const pieces = signPieces(layout, panel, face, measure)
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]
    const inside = x >= p.left && x <= p.left + p.w && y >= p.bottom && y <= p.bottom + p.h
    if (inside && !(ids && ids.has(p.id))) {
      const found = layout.find((c) => c.id === p.id)
      if (found) return found
    }
  }
  return null
}

/* ---------------------------------------------------------- the bin order */

/**
 * One bin's width in metres, as a **default** for a board whose own width is not
 * known yet. A board is a list of content, so the editor shows it as a list of
 * **bins** — fixed places, one per item, all the same width — and a bin is a little
 * over the widest single mark a board can carry at scale 1. The editor lays its own
 * row out at the width its board actually has (`signLayoutInOrder` takes it), so a
 * mark sits in the middle of the bin it lives in rather than near it.
 */
export const SIGN_BIN_PITCH = 0.33

/**
 * The list with every component's `x` set from its place in the list, so the order
 * of the list is the only thing that decides where anything sits.
 *
 * `packSignRow` places a row by reading each component's desired `x` as written, so
 * a list written in order — one bin per place — is a row the pack confirms rather
 * than rearranges. That is what makes "drop it in bin 3" a statement about the
 * *list* and not about a millimetre on the board.
 */
export function signLayoutInOrder(layout: readonly SignComponent[], pitch: number = SIGN_BIN_PITCH): SignLayout {
  const step = pitch > 0 ? pitch : SIGN_BIN_PITCH
  return layout.map((c, i) => ({ ...c, x: (i + 0.5) * step }))
}

/**
 * The list with `id` moved to `index` — the editor's whole drag rule. The dragged
 * mark takes that bin, and everything after it shuffles along: a board is reordered
 * by moving items between bins, and there is nowhere else for one to be put down.
 */
export function signLayoutMoved(layout: readonly SignComponent[], id: string, index: number, pitch: number = SIGN_BIN_PITCH): SignLayout {
  const from = layout.findIndex((c) => c.id === id)
  if (from < 0) return signLayoutInOrder(layout, pitch)
  const rest = layout.filter((c) => c.id !== id)
  const at = Math.max(0, Math.min(index, rest.length))
  return signLayoutInOrder([...rest.slice(0, at), layout[from], ...rest.slice(at)], pitch)
}

/** The list with `comp` inserted at `index`, which is what adding from the palette does. */
export function signLayoutInserted(layout: readonly SignComponent[], comp: SignComponent, index: number, pitch: number = SIGN_BIN_PITCH): SignLayout {
  const at = Math.max(0, Math.min(index, layout.length))
  return signLayoutInOrder([...layout.slice(0, at), comp, ...layout.slice(at)], pitch)
}

/* -------------------------------------------------------------- the board */

/**
 * The size a board takes for a layout: **one row**, as long as the content needs.
 *
 * A 指示牌 is a list read left to right, so the board has a fixed height (the
 * floor) and grows only along its length:
 *
 *   width = the last mark's right edge + a quiet margin
 *
 * `right` is the outermost `centre + half its size` on the row, which makes the
 * size a pure function of the layout — and therefore stable under repetition:
 * `settleSignLayout` packs the row and then measures it, and measuring the packed
 * row asks for the board the pack already fitted. Growth is clamped to
 * `PANEL_MAX_W`, past which the content is packed inside instead.
 */
export function signPanelSize(layout: readonly SignComponent[], measure: SignMeasure = estimateSignTextWidth): SignPanelSize {
  let right = 0
  for (const c of layout) {
    const { w } = signPieceSize(c, measure)
    if (w <= 0) continue
    right = Math.max(right, c.x + w / 2)
  }
  return {
    // The row is one mark tall, so the floor is always tall enough: the board never
    // grows vertically and no content ever flows onto a second row.
    w: clampPanel(PANEL_MIN_W, Math.max(PANEL_MIN_W, right + PANEL_PAD), PANEL_MAX_W),
    h: PANEL_MIN_H,
  }
}

/**
 * Whether a mark would still **fit** on a board, or whether the board is full.
 *
 * A board grows with its content only up to `PANEL_MAX_W`; past that the pack folds what it
 * is given back inside and the last marks end up sharing a place (`packSignRow`). So "full"
 * is not a count — it is this: lay the row out with the mark on it and ask whether the pack
 * had to **put it on top of** something that was already there. If it did, the mark would be
 * printed stacked on another one, and the board is full.
 *
 * The number of marks that fit therefore depends on **which** marks they are: six arrows are
 * 3.24 m of a 3.4 m board and ten pictograms are 3.6 m of it (and reach the ceiling). Asking
 * this per mark is what keeps the palette, the board's own size and the print honest about one
 * another, instead of a count that would be wrong for every kind but one.
 */
export function signMarkFits(
  layout: readonly SignComponent[],
  comp: SignComponent,
  measure: SignMeasure = estimateSignTextWidth,
): boolean {
  const packed = packSignRow([...layout, comp], undefined, measure)
  const added = packed[packed.length - 1]
  const w = signPieceSize(comp, measure).w
  if (w <= 0) return true
  return !packed
    .slice(0, -1)
    .some((c) => Math.abs(c.x - added.x) < (w + signPieceSize(c, measure).w) / 2 - 1e-9)
}

function clampPanel(min: number, want: number, max: number): number {
  // A 5 cm resolution: a board grows in visible steps rather than jittering on a
  // one-millimetre drag, and it rounds to the *nearest* step so a board that is
  // already a legal size stays exactly where it is.
  const step = 0.05
  const rounded = Math.round((want + 1e-9) / step) * step
  return Math.min(max, Math.max(min, Number(rounded.toFixed(3))))
}

/**
 * A board's layout at rest: the row packed, and the board sized to hold it. Use
 * this whenever a layout is read — a save, a stamp, a drag — so the board's length
 * and its content cannot disagree.
 *
 * Two steps, and they are independent: **pack** the row (`packSignRow`), then
 * **measure** it (`signPanelSize`). The pack reads desired positions as written,
 * which is what lets a block dropped past the end grow the board; the measure then
 * reports the length that pack needs. Neither can move a mark the other placed, so
 * this is a fixed point rather than the loop of measure-and-fold it replaced.
 *
 * `lockedIds` names the components the player is holding: they keep their exact
 * positions, and the row packs around them.
 */
export function settleSignLayout(
  layout: readonly SignComponent[],
  measure: SignMeasure = estimateSignTextWidth,
  lockedIds?: ReadonlySet<string>,
): { layout: SignLayout; panel: SignPanelSize } {
  const packed = packSignRow(layout, lockedIds, measure)
  return { layout: packed, panel: signPanelSize(packed, measure) }
}

/** The most bins a board shows room for: one per `SIGN_COMPONENT_MAX`, plus spare. */
export const SIGN_BIN_SPARE = 1

/**
 * A board, its layout, and the **bins** the editor puts it in — the one geometry the
 * board preview and the bin row are both drawn from.
 *
 * `signPanelSize` gives the board the length its own content needs; the editor's bins
 * add one empty place past the last item, so there is always somewhere to drop the
 * next one. The board is then asked for that extra place, and the places divide the
 * board's whole length **equally** — `width / count` — which is what makes every bin
 * the same width however wide its own mark is. The layout is written to that width
 * (`signLayoutInOrder`), so a mark sits in the middle of its bin rather than merely
 * somewhere inside the board, and the preview and the bins cannot drift apart.
 *
 * `maxW` is the ceiling the board may not pass (`PANEL_MAX_W` in the game): past it
 * the bins are narrower than one item's worth, the row packs inside the board, and
 * a board that is genuinely over-full reads as such instead of growing into a wall.
 */
export function settleSignBins(
  layout: readonly SignComponent[],
  maxW: number = PANEL_MAX_W,
  measure: SignMeasure = estimateSignTextWidth,
): { layout: SignLayout; panel: SignPanelSize; room: number; bins: number; pitch: number } {
  const bins = Math.min(SIGN_COMPONENT_MAX, layout.length + SIGN_BIN_SPARE)
  const bare = settleSignLayout(layout, measure)
  // One place per mark: the board is asked for as many bins as it has marks (and one
  // spare), each at least `SIGN_BIN_PITCH` wide and never narrower than its own mark,
  // so a place on the screen is a place on the sign. Past the ceiling the bins are
  // narrower than that and the row simply packs tighter — a board that is genuinely
  // over-full reads as such rather than growing into a wall.
  const widest = layout.reduce((w, c) => Math.max(w, signPieceSize(c, measure).w), 0)
  const perBin = Math.max(SIGN_BIN_PITCH, widest)
  const room = Math.max(bare.panel.w + PANEL_PAD, Math.min(maxW, perBin * bins))
  const pitch = room / bins
  return { layout: signLayoutInOrder(layout, pitch), panel: bare.panel, room, bins, pitch }
}

/* ------------------------------------------------------------------ icons */

/**
 * The colour a shield prints: the bound line's own, the station's first line's,
 * or the neutral plate when the station has no line at all. The editor uses it
 * for its swatch, so the swatch and the printed shield cannot disagree.
 */
export function signLineColour(lineId: string, lines: ReadonlyArray<LineDef>): string {
  const line = lineId === '' ? lines[0] : (lines.find((l) => l.id === lineId) ?? lines[0])
  return line?.colour ?? SIGN_LINE_FALLBACK_COLOUR
}

/**
 * The short label a line shield prints: the number, not the 号线 suffix, because
 * the shield has room for one glyph — and the number is what the board's own
 * number is. `2号线` prints `2`, `APM线` prints `APM`, `14号线` prints `14`.
 */
export function signLineNumber(name: string): string {
  // `号线` (2号线), or a bare `线` on a named service (APM线).
  return name.replace(/号线$/, '').replace(/线$/, '').trim() || name
}

/** The English gloss a shield prints under the number. */
export function signLineEnglish(name: string): string {
  const digits = signLineNumber(name)
  if (digits.includes('APM')) return 'APM'
  return /^[0-9]+$/.test(digits) ? `Line ${digits}` : digits
}

/* -------------------------------------------------------------- defaults */

/**
 * The row's centre line, in metres from the board's bottom edge. The board carries
 * one row of content, so this is the `y` of every component — the model pins it
 * (`signCentreRange`) and the editor does not offer to move it.
 */
export function signRowY(panel: SignPanelSize = PANEL_SIZE): number {
  return panel.h / 2
}

/**
 * The panel a freshly placed sign hangs with: an exit arrow each side, the
 * station's own line between them, and the green 出口 plate — **one row**, read
 * left to right.
 *
 * Positions are metres on a `PANEL_MIN_W × PANEL_MIN_H` board, on the row's own
 * centre line, and the layout is settled on the way out (`settleSignLayout`), so a
 * fresh board is a legal layout at a legal size by construction. This is also the
 * shape a sign saved before the board became a document is backfilled with, so an
 * old station's signs read exactly like a new one's.
 */
export function defaultSignLayout(station?: SignLineSource | null): SignLayout {
  const line = station?.lines[0]
  const out: SignLayout = [
    { id: 'c1', kind: 'arrow', arrow: 'left', x: 0.32, y: ROW_Y, scale: 1, side: 'both' },
    { id: 'c2', kind: 'line', lineId: line?.id ?? '', english: true, x: 0.8, y: ROW_Y, scale: 1, side: 'both' },
    { id: 'c3', kind: 'icon', icon: 'exit', x: 1.2, y: ROW_Y, scale: 1, side: 'both' },
    { id: 'c4', kind: 'arrow', arrow: 'right', x: 1.6, y: ROW_Y, scale: 1, side: 'both' },
  ]
  // A station with no line yet prints no shield: an empty one would claim a line
  // the station does not have.
  return settleSignLayout(line ? out : out.filter((c) => c.kind !== 'line')).layout
}

/**
 * The centre line every component sits on, in metres. It is stated as a constant
 * rather than read from a board, because the *palette* and the defaults both need
 * it before a board exists — and the board's height is the floor, so the two can
 * never disagree.
 */
const ROW_Y = PANEL_MIN_H / 2

/** The id a newly added component takes, so ids stay unique within a sign. */
export function nextSignComponentId(layout: readonly SignComponent[]): string {
  let n = layout.length + 1
  const used = new Set(layout.map((c) => c.id))
  while (used.has(`c${n}`)) n++
  return `c${n}`
}


/** The scale a component dropped from the palette gets, so it fits the board. */
export const SIGN_DROP_SCALE = 0.85

/**
 * A component of `kind` as the palette creates it, on the row's centre line and at
 * the origin of the length. The caller places and settles it: `stampSignBlock` is
 * what the editor and the store both use, because a block is dropped at a point
 * along the row rather than appended to a list.
 */
export function makeSignComponent(kind: SignComponentKind, id: string, lineId = ''): SignComponent {
  const base: SignBase = { id, x: 0, y: ROW_Y, scale: 1, side: 'both' }
  switch (kind) {
    case 'arrow':
      return { ...base, kind: 'arrow', arrow: 'right' }
    case 'line':
      return { ...base, kind: 'line', lineId, english: true }
    case 'text':
      return { ...base, kind: 'text', text: '出站' }
    case 'icon':
      return { ...base, kind: 'icon', icon: 'restroom' }
  }
}

/**
 * The blocks the palette offers — content, not marks, because that is what a board
 * carries. A "厕所" is a pictogram with its caption already under it; the editor
 * stamps the whole group where it was dropped, so the player never has to assemble
 * a sign by hand before it reads.
 */
export interface SignBlockSpec {
  id: string
  /** The name the palette tile wears. */
  label: string
  /** The kind of the block's own mark, for the tile's category line. */
  kind: SignComponentKind
  /** How many components the block stamps, for the tile's badge. */
  count: number
}

export const SIGN_BLOCKS: readonly SignBlockSpec[] = [
  { id: 'train', label: '列车', kind: 'icon', count: 1 },
  { id: 'lift', label: '电梯', kind: 'icon', count: 1 },
  { id: 'accessible', label: '无障碍', kind: 'icon', count: 1 },
  { id: 'restroom', label: '卫生间', kind: 'icon', count: 1 },
  { id: 'escalator', label: '扶梯', kind: 'icon', count: 1 },
  { id: 'stairs', label: '楼梯', kind: 'icon', count: 1 },
  { id: 'exit', label: '出口', kind: 'icon', count: 1 },
  { id: 'exit-text', label: '出站 + 出口', kind: 'text', count: 2 },
  { id: 'line', label: '线路牌', kind: 'line', count: 1 },
  { id: 'text', label: '文字', kind: 'text', count: 1 },
  { id: 'arrow', label: '箭头', kind: 'arrow', count: 1 },
  { id: 'exit-arrow', label: '箭头 + 出口', kind: 'arrow', count: 2 },
]

/**
 * The components a palette block stamps, laid along the row. Every `y` is the
 * row's centre line, because a block is a run of the list, not a shape on the
 * face — the block is placed by `stampSignBlock`, which lays a multi-part group
 * out side by side. A test can read the group without a board; ids are the
 * caller's, because a block dropped twice must make two independent groups.
 */
export function signBlockComponents(blockId: string, lineId = ''): SignComponentDraft[] {
  const scale = SIGN_DROP_SCALE
  const row = ROW_Y
  const ink = (kind: SignComponentKind, patch: Record<string, unknown> = {}): SignComponentDraft =>
    ({ kind, x: 0, y: row, scale, side: 'both', ...patch }) as SignComponentDraft
  switch (blockId) {
    case 'exit':
      return [ink('icon', { icon: 'exit' })]
    // A caption beside its pictogram: the palette's 「出站 + 出口」 is the block that
    // carries a word with its mark, stamped as two components because that is what
    // the renderer draws.
    case 'exit-text':
      return [ink('text', { text: '出站' }), ink('icon', { icon: 'exit' })]
    case 'line':
      return [ink('line', { lineId, english: true })]
    case 'text':
      return [ink('text', { text: '出站' })]
    case 'arrow':
      return [ink('arrow', { arrow: 'right' })]
    case 'exit-arrow':
      return [ink('arrow', { arrow: 'right' }), ink('icon', { icon: 'exit' })]
    default:
      // Every remaining block is one pictogram, and its block id is the icon's
      // own name, so the palette and the printed mark cannot drift apart.
      return isSignIcon(blockId) ? [ink('icon', { icon: blockId })] : []
  }
}

/** True for a block id that names one of the palette's pictograms. */
export function isSignIcon(id: string): id is SignIcon {
  return (SIGN_ICONS as readonly string[]).includes(id)
}

/**
 * A palette block stamped onto a layout, at `at.x` along the row. Ids are minted
 * here, so a block dropped twice makes two independent groups.
 *
 * `at.y` is ignored: the board is one row, so a drop is a place *along* the sign.
 * The block is the thing that keeps its place — what it landed on is pushed along
 * to make room, which is what makes a drop read as inserting into the list, and a
 * block dropped past the end of the board simply ends up past the end of it, which
 * is what makes the sign grow.
 */
export function stampSignBlock(
  layout: readonly SignComponent[],
  blockId: string,
  at: { x: number; y?: number },
  lineId = '',
  measure: SignMeasure = estimateSignTextWidth,
): SignLayout {
  const parts = signBlockComponents(blockId, lineId)
  if (parts.length === 0) return [...layout]
  const stamped: SignLayout = []
  // A multi-component block is stamped as a run: each part after the first sits to
  // the right of the one before it, so a group lands side by side rather than on
  // top of itself.
  let cursor = at.x
  for (const part of parts) {
    const id = nextSignComponentId([...layout, ...stamped])
    const { w } = signPieceSize({ ...part, id } as SignComponent, measure)
    const x = parts.length === 1 ? at.x : cursor + w / 2
    stamped.push({ ...part, id, x } as SignComponent)
    cursor = x + w / 2 + 0.02
  }
  const raw = [...layout, ...stamped]
  // Pack the row with the stamped block held: it inserts exactly where it was let
  // go, and what it landed on is pushed along to make room. Packing reads desired
  // positions as written, so a block dropped past the end of the board ends up past
  // the end of the board — which is what `signPanelSize` then reports as a longer
  // sign.
  return packSignRow(raw, new Set(stamped.map((c) => c.id)), measure)
}

/**
 * A saved sign's layout, with anything the document cannot honour repaired: ids
 * made unique, scales and positions clamped, too many components dropped, and an
 * empty layout (an old save, or a board the player cleared) replaced by
 * `defaultSignLayout`.
 *
 * No station document is needed to repair a layout — a component that names a
 * missing line simply prints the neutral shield until a line exists — so this is
 * safe to call from `toState`, which is the one place every load path passes
 * through.
 */
export function normalizeSignLayout(layout: readonly SignComponent[] | undefined, station?: SignLineSource | null): SignLayout {
  if (!layout || layout.length === 0) return defaultSignLayout(station)
  const seen = new Set<string>()
  const out: SignLayout = []
  for (const c of layout.slice(0, SIGN_COMPONENT_MAX)) {
    let id = c.id === '' ? `c${out.length + 1}` : c.id
    while (seen.has(id)) id = `${id}_`
    seen.add(id)
    out.push({ ...c, id })
  }
  // The pack reads positions as written, so a saved layout keeps its order and its
  // length. The clamp after it is what repairs a scale, or a mark the board cannot
  // hold — and because the pack is idempotent and the clamp is too, the pair is a
  // fixed point: `toState` can repair an old save without rewriting it every load.
  const packed = packSignRow(out)
  return packed.map((c) => clampSignComponent(c, signPanelSize(packed)))
}

/** The sign type name, so callers do not spell it out. */
export const SIGN_TYPE = 'sign'

/** True for a module that is an overhead wayfinding board. */
export function isSignModule(mod: Module): mod is Extract<Module, { type: 'sign' }> {
  return mod.type === SIGN_TYPE
}

/**
 * A sign module's two boards, repaired — the shorthand for a caller that holds a module
 * rather than a config. `signBoardsOf` does the work; this only unpacks the one field it
 * needs, so a caller never has to know that a sign's boards live in its `cfg`.
 */
export function signModuleBoards(mod: Extract<Module, { type: 'sign' }>, station?: SignLineSource | null): SignBoards {
  return signBoardsOf(mod.cfg, station)
}

/* ------------------------------------------------------- the two boards */

/**
 * Which of a board's two faces is being composed. The editor shows one row of bins
 * per face under a 正面 / 背面 label, and every mark it lays down goes on the face
 * whose row it was dropped in.
 *
 * This names a **logical** face. The older `SignFace` (`'both' | 'left' | 'right'`)
 * names the same two faces geometry-first, because the renderer is handed a plane
 * and a yaw; `SIGN_FACE_OF` is the one place the two spellings are related.
 */
export type SignFaceName = 'front' | 'back'

/** The `SignFace` a logical face prints as: the front is the panel's left face. */
export const SIGN_FACE_OF: Record<SignFaceName, 'left' | 'right'> = { front: 'left', back: 'right' }

/**
 * A sign's two boards, in the order the editor shows them: 正面 first, 背面 under
 * it. Both are ordinary layouts — the panel, the bin row, the drawing code and the
 * per-face filter treat the back exactly like the front — and **either may be
 * empty**. An empty face is not an error and not a blank board: it is a face with
 * no plate mounted at all, so the piece shows its own black lightbox from that
 * side, which is what the back of a single-sided sign is.
 */
export interface SignBoards {
  /** 正面 — the board's left face, read by someone standing in front of it. */
  front: SignLayout
  /** 背面 — the board's right face. A fresh sign's is empty. */
  back: SignLayout
}

/** Everything a sign's boards are, before they are settled. */
export type SignBoardsDraft = { front: readonly SignComponent[]; back: readonly SignComponent[] }

/** A sign's boards with **both** faces empty: the blank a fresh pair starts from. */
export function emptySignBoards(): SignBoards {
  return { front: [], back: [] }
}

/**
 * The off-board mark the editor keeps at the **back** row's own end, so an empty
 * back still has a place to drop the first mark in.
 *
 * A row of bins is one bin per mark (`settleSignBins`), so a face with no marks on
 * it would have no bin at all — nothing to aim at, and nowhere for the first drop
 * to land. The front never has that problem: it always carries something. The back
 * is *supposed* to start empty, so it needs the one place the empty row is missing,
 * and this is that place.
 *
 * It is a label with **no text**, which is the one mark that draws and measures as
 * nothing at all (`signInkSize` of an empty label is zero on both axes). That is
 * what makes it a place and not a mark: it is dropped from the pack and from the
 * board's own length by the same zero, so the row of bins is still the board's
 * geometry with one spare place on the end, and the editor never writes it into a
 * sign. The empty back it stands in for is therefore the *same* empty back the
 * model stores and the renderer skips.
 */
export const SIGN_BACK_MARK = { id: '__back', kind: 'text', text: '', x: 0, y: 0, scale: 1, side: 'both' } satisfies SignComponent

/** The layout one face of a sign prints. An absent board is an empty one. */
export function signFaceLayout(boards: SignBoards | null | undefined, face: SignFaceName): SignLayout {
  return boards?.[face] ?? []
}

/**
 * Fold a component's own `side` into the pair of boards.
 *
 * A component bound to one face belongs to **that** face's board; everything else
 * belongs to the front. This is the whole of the migration from the per-component
 * binding to the two-board document, and it is a pure function of the list, so a
 * save, a stamp and the editor all read it the same way. Applied to a board whose
 * components are all `'both'` it is the identity, which is what makes it safe to
 * run on every load.
 */
export function splitSignBoards(layout: readonly SignComponent[]): SignBoards {
  return {
    front: layout.filter((c) => c.side !== 'right'),
    back: layout.filter((c) => c.side === 'right'),
  }
}

/**
 * The two boards a sign's config holds, repaired on the way in.
 *
 * Three shapes arrive here, and all three come out as a settled pair:
 *
 *  1. a sign that already carries `front`/`back` — read as written, each face it has
 *     normalised on its own (`normalizeSignLayout`), and a face it does not have left
 *     **empty** rather than filled in with the default;
 *  2. a sign written before a board was a document (`cfg: {}`, or no `components`
 *     at all) — the station's default board on the front, and an **empty back**,
 *     which is the one behaviour change: such a sign used to print the same board
 *     on both sides and now prints it on the front only, because a back that
 *     nobody composed is not a back that should claim one;
 *  3. a sign from the per-component era — `components` with each mark's `side`
 *     folded in by `splitSignBoards`.
 *
 * The **default board belongs to the front alone**, and only on the legacy branch: a
 * sign with no front at all is unreadable from everywhere, which is the case the
 * default exists for. An empty back is a decision rather than a gap — it is the black
 * plate a one-sided sign shows from behind — so it is never filled in.
 * `settleSignBoards`, which is what the editor and every write path go through, holds
 * the same line.
 */
export function signBoardsOf(cfg: { components?: SignLayout; front?: SignLayout; back?: SignLayout }, station?: SignLineSource | null): SignBoards {
  // Repair each face it has, and leave a face it does not have **empty**. The default
  // board belongs to a sign with no front at all, which is the legacy branch below;
  // an explicitly empty face is a decision the document is entitled to make, and
  // `normalizeSignLayout` would quietly overturn it by filling the blank in.
  const fixed = (face: SignLayout | undefined): SignLayout => (face && face.length > 0 ? normalizeSignLayout(face, station) : [])
  if (cfg.front !== undefined || cfg.back !== undefined) {
    return { front: fixed(cfg.front), back: fixed(cfg.back) }
  }
  const legacy = splitSignBoards(cfg.components ?? [])
  return { front: normalizeSignLayout(legacy.front, station), back: fixed(legacy.back) }
}

/**
 * A freshly hung sign's boards: the composed front (or the station's default board
 * when the player has composed none) and an empty back.
 */
export function makeSignBoards(front: readonly SignComponent[] | undefined, station?: SignLineSource | null): SignBoards {
  return {
    front: front && front.length > 0 ? normalizeSignLayout(front, station) : defaultSignLayout(station),
    back: [],
  }
}

/**
 * A pair of boards at rest: **both** faces packed and normalised, and each face a
 * legal board of its own. An empty face stays empty — that is a face nothing prints
 * on, not a face with a blank plate.
 */
export function settleSignBoards(boards: SignBoardsDraft, station?: SignLineSource | null): SignBoards {
  const front = normalizeSignLayout(settleSignBins(boards.front).layout, station)
  const back = boards.back.length > 0 ? normalizeSignLayout(settleSignBins(boards.back).layout, station) : []
  return { front, back }
}

/**
 * The panel both of a sign's faces print on: the wider of the two, so neither
 * plate is cut short of the face it carries. An absent board contributes nothing.
 */
export function signBoardsPanel(boards: SignBoards): SignPanelSize {
  const front = signPanelSize(boards.front)
  const back = signPanelSize(boards.back)
  return { w: Math.max(front.w, back.w), h: Math.max(front.h, back.h) }
}

/**
 * True when a pair of boards has anything printable on either face — which is what
 * decides whether a sign mounts a lit plate at all. A face with nothing on it is
 * left as the model's own black panel (`render/models.ts`), so this is asked once
 * per face, and once of the pair for the panel's own size.
 */
export function signBoardsHaveInk(boards: SignBoards): boolean {
  return boards.front.length > 0 || boards.back.length > 0
}
