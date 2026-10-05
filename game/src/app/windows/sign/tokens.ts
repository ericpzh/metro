// 指示牌 board editor (§5.8) — pure model: sizes, the four groups, the faces, and the
// mark arithmetic the tiles, the bins and the drag all share. No JSX and no canvas, so
// the layout rules can be read (and imported) without the modal around them.

import {
  SIGN_BACK_MARK,
  SIGN_ICON_LABEL,
  SIGN_ICONS,
  SIGN_SIZE,
  SIGN_TEXT_EN_SCALE,
  estimateSignTextWidth,
  signTextLines,
  signTextSize,
  type SignArrow,
  type SignComponent,
  type SignFaceName,
  type SignIcon,
  type SignLayout,
} from '../../../sim/sign.ts'
import type { LineDef } from '../../../sim/types.ts'

/* ------------------------------------------------------------------- sizes */

/**
 * One tile's own raster: the CSS square (`.signPanel`'s `--tile`) is 60 px, so a tile is
 * drawn at the resolution it is shown at and the black plate inside it is a picture of one
 * metre of sign rather than a blur.
 */
export const TILE_ART = 60
/**
 * The carried mark is a **scaled-up bin**, not a differently-drawn one: the same 5 px of
 * padding and 1 px border, and the same picture on the plate, 1.5 × bigger. That is the
 * whole point — a drag carries the piece of sign the player is about to put down, so the
 * black plate *and* the mark printed on it have to grow together. A bigger plate around a
 * mark that stayed its old size reads as the content shrinking.
 *
 * Every number is derived from `--tile` (60, in `styles.css`) times `DRAG_SCALE`, so the
 * two sides cannot drift apart:
 *
 *   box:  60 × 1.5                        = 90 px   (`.dragGhost`)
 *   art:  (60 − 2 × 5 − 2 × 1) × 1.5      = 72 px   (`.dragGhostArt`, `DRAG_ART_PX`)
 *
 * `drawTileMark` is handed the art size as its `artPx`, which is what makes the mark inside
 * the plate grow with it: the plate is stated in metres, the conversion to pixels follows
 * `artPx`, so a picture drawn for 72 px is 1.5 × one drawn for 48 px.
 */
export const DRAG_SCALE = 1.5
export const DRAG_ART_PX = 48 * DRAG_SCALE
/** How far the pointer must travel before a press counts as a drag, in pixels. */
export const DRAG_SLOP = 4
/** How far outside the rail's bin a drag still counts as being over it, in pixels. */
export const TRASH_HIT = 16
/**
 * The id a mark carries while it is being dragged **out of the palette**: it is not on a
 * board yet, so it has nothing else to be called. A mark dragged off a board keeps its own
 * id, which is the difference the rail's bin cares about — only a mark that is on a board
 * can be thrown away.
 */
export const DRAG_MARK_ID = 'drag'

/* ---------------------------------------------------------------- the groups */

/** The four things a sign is made of. There is no fifth. */
export type SignGroupId = 'arrow' | 'icon' | 'line' | 'text'

export const SIGN_GROUPS: ReadonlyArray<{ id: SignGroupId; label: string }> = [
  { id: 'arrow', label: '箭头' },
  { id: 'icon', label: '图标' },
  { id: 'line', label: '线路' },
  { id: 'text', label: '文字' },
]

/**
 * The pictograms a board may print, and the name each one carries as its tooltip.
 * The names are `sim/sign.ts`'s own, so the palette, the printed mark and the
 * reference photographs are one list. An icon is a picture: the palette offers it as
 * the mark itself — 出口's green plate included, drawn by the renderer — and the
 * editor lets neither its glyph nor its wording be typed.
 */
export const SIGN_MARKS: ReadonlyArray<{ icon: SignIcon; label: string }> = SIGN_ICONS.map((icon) => ({
  icon,
  label: SIGN_ICON_LABEL[icon],
}))

/** A pictogram's own name, where a caller has only the icon. */
export const MARK_LABEL: Record<string, string> = Object.fromEntries(SIGN_MARKS.map((m) => [m.icon, m.label]))

/** The eight directions as one right-pointing mark, turned about the tile's centre. */
export const ARROW_ANGLE: Record<SignArrow, number> = {
  right: 0,
  'down-right': 45,
  down: 90,
  'down-left': 135,
  left: 180,
  'up-left': 225,
  up: 270,
  'up-right': 315,
}

/* ---------------------------------------------------------- tile pictures */

/** Everything about a mark a picture of it depends on. */
export function markKey(comp: SignComponent): string {
  switch (comp.kind) {
    case 'arrow':
      return `arrow:${comp.arrow}`
    case 'line':
      return `line:${comp.lineId}:${comp.english}`
    case 'text':
      return `text:${comp.text}`
    case 'icon':
      return `icon:${comp.icon}`
  }
}

/* ------------------------------------------------------------- the faces */

/** The two faces, in the order the editor shows them, with the label each wears. */
export const SIGN_FACES: ReadonlyArray<SignFaceName> = ['front', 'back']

/** What each face is called on screen: the words over its row of bins. */
export const FACE_LABEL: Record<SignFaceName, string> = { front: '正面', back: '背面' }

/** A bin row's own aria-label: which face of the sign it is, and which way it reads. */
export const FACE_ROW_LABEL: Record<SignFaceName, string> = {
  front: '正面（从左到右）',
  back: '背面（从左到右）',
}

/**
 * One face's row as the row of places the editor lays out: the marks it holds, and
 * — for a face with none — the one stand-in place `SIGN_BACK_MARK` gives it.
 *
 * This is where "the back starts empty, and still has somewhere to drop the first
 * mark" is decided, and it is one line because the stand-in is a *model* constant:
 * `packSignRow` skips it (it draws nothing, so it measures zero wide), which is
 * what makes the row of bins the board's own geometry with one extra place on the
 * end rather than a second layout that has to be kept in step with the first.
 */
export function faceRowLayout(layout: readonly SignComponent[]): SignLayout {
  return layout.length > 0 ? (layout as SignLayout) : ([SIGN_BACK_MARK] as SignLayout)
}

/**
 * A mark's drawn size in metres at scale 1. The editor's own arithmetic — `sign.ts`
 * cannot state it without a measure for text — and it is used only to fill a tile with
 * its mark, never to place anything.
 */
export function markInk(mark: SignComponent): { w: number; h: number } {
  switch (mark.kind) {
    case 'arrow':
      return SIGN_SIZE.arrow
    case 'line':
      return SIGN_SIZE.line
    case 'icon':
      return SIGN_SIZE.icon
    case 'text': {
      const lines = signTextLines(mark.text)
      const size = signTextSize(1)
      // An empty box is one character's worth of ink rather than nothing: it is what
      // the player drags onto a bin, and a mark with no footprint could not be seen.
      if (lines.length === 0) return { w: size, h: size * 1.15 }
      const w = Math.max(0.01, ...lines.map((l, i) => estimateSignTextWidth(l, size * (i === 0 ? 1 : SIGN_TEXT_EN_SCALE))))
      return { w, h: Math.max(size, lines.length * size * 1.15) }
    }
  }
}

/* ---------------------------------------------------------------- palette */

/**
 * A mark as a tile offers it: the shape and the colour the sign will print, with no
 * place on a board yet. The tile that shows the mark and the drag that carries it are
 * the same object, so a 线路 shield in the palette is the shield that lands — nothing
 * about it is described in words.
 */
export function paletteMark(
  spec: { kind: 'arrow'; arrow: SignArrow } | { kind: 'icon'; icon: SignIcon } | { kind: 'line'; lineId: string } | { kind: 'text'; text: string },
): SignComponent {
  const base = { id: 'tile', x: 0.5, y: 0.5, scale: 1, side: 'both' } as const
  switch (spec.kind) {
    case 'arrow':
      return { ...base, kind: 'arrow', arrow: spec.arrow }
    case 'icon':
      return { ...base, kind: 'icon', icon: spec.icon }
    case 'line':
      return { ...base, kind: 'line', lineId: spec.lineId, english: true }
    case 'text':
      return { ...base, kind: 'text', text: spec.text }
  }
}

/**
 * What a **group's own tile** shows: the marks that group makes, drawn by the sign, so the
 * four things a sign is made of are four pictures rather than four words.
 *
 * A group that offers **more than one thing** shows *two* of them, side by side and split by
 * a diagonal — the 箭头 group is not one arrow but eight, and one arrow drawn on the tile
 * says it is the arrow, not that it opens a palette of them. 图标 shows two pictograms, and
 * 线路 shows two shields once the station has two lines to choose between. 文字 has nothing
 * to pair (its mark is typed, and its tile is the handle for the two boxes below it), and a
 * station with a single line has no second shield to draw, so both stay single.
 *
 * The pair is always the *first* of what the palette offers, in the palette's own order,
 * so the tile shows what opening it will put in front of the player.
 */
export function groupMarks(id: SignGroupId, lines: readonly LineDef[]): { marks: readonly SignComponent[]; split: boolean } {
  switch (id) {
    case 'arrow':
      return {
        marks: [paletteMark({ kind: 'arrow', arrow: 'right' }), paletteMark({ kind: 'arrow', arrow: 'up-left' })],
        split: true,
      }
    case 'icon':
      return {
        marks: [paletteMark({ kind: 'icon', icon: 'exit' }), paletteMark({ kind: 'icon', icon: 'restroom' })],
        split: true,
      }
    case 'line': {
      const marks = lines.slice(0, 2).map((l) => paletteMark({ kind: 'line', lineId: l.id }))
      return { marks: marks.length > 0 ? marks : [paletteMark({ kind: 'line', lineId: '' })], split: marks.length > 1 }
    }
    case 'text':
      return { marks: [paletteMark({ kind: 'text', text: '文字\nText' })], split: false }
  }
}

/* ------------------------------------------------------------------ bins */

/** The next free component id on a board. */
export function nextId(layout: readonly SignComponent[]): string {
  let n = layout.length + 1
  const used = new Set(layout.map((c) => c.id))
  while (used.has(`c${n}`)) n++
  return `c${n}`
}

/**
 * The mark a palette tile offers, as a component with no id yet: what the drag
 * carries, what the floating preview is drawn from, and what a drop lands on the
 * board.
 *
 * **Nothing here is unique.** All four groups repeat as freely as the board has
 * places for them: a second 出口, a second text box, the same pictogram twice, and a
 * 线路 shield as many times as the station has lines. The board's only ceiling is its
 * own ten places (`SIGN_COMPONENT_MAX`), which is asked before a tile is even armed
 * (`full`), so a tile the board cannot take costs nothing but a drag rather than the
 * press. What a **click** on a tile does is a different question, and `pickExisting`
 * answers it.
 *
 * A mark is offered for **one face**: a drag is armed on the focused board and lands
 * on the one the pointer is over, which is what the two faces are for.
 */
export function markFor(payload: string): SignComponent | null {
  if (payload.startsWith('icon:')) {
    return { id: DRAG_MARK_ID, kind: 'icon', icon: payload.slice(5) as SignIcon, x: 0, y: 0, scale: 1, side: 'both' }
  }
  if (payload.startsWith('arrow:')) {
    return { id: DRAG_MARK_ID, kind: 'arrow', arrow: payload.slice(6) as SignArrow, x: 0, y: 0, scale: 1, side: 'both' }
  }
  // 线路 is a mark like any other: this shield, wherever it is dropped, however many
  // are already up.
  if (payload.startsWith('line:')) {
    return { id: DRAG_MARK_ID, kind: 'line', lineId: payload.slice(5), english: true, x: 0, y: 0, scale: 1, side: 'both' }
  }
  // 文字 drags on as the two rows the boxes hold. Empty boxes drag the placeholder a
  // fresh label starts as: a mark with no text has no size at all, and the row would
  // not make room for the place it lands in.
  if (payload.startsWith('text:')) {
    const text = payload.slice(5)
    return { id: DRAG_MARK_ID, kind: 'text', text: text.trim() === '' ? '文字' : text, x: 0, y: 0, scale: 1, side: 'both' }
  }
  return null
}

/**
 * The board as it looks **while a mark is being dragged in**: the mark sits in the
 * drop bin and everything from there on shifts along, so the player watches the row
 * make room rather than finding out where it went after letting go.
 *
 * Only a mark coming from the **palette** is added here, and `DRAG_MARK_ID` is what says
 * so: it is a mark that is on no board yet. One dragged out of a bin is already in the
 * row — the pointer's own move has kept it under the pointer, on whichever board it is
 * over — so its position *is* the preview, and inserting a second copy here would draw it
 * twice.
 */
export function withHover(layout: readonly SignComponent[], mark: SignComponent | null, index: number | null): readonly SignComponent[] {
  if (index === null || !mark || mark.id !== DRAG_MARK_ID) return layout
  const at = Math.max(0, Math.min(index, layout.length))
  return [...layout.slice(0, at), mark, ...layout.slice(at)]
}

/** What a component is, in one word, for a bin's own label. */
export function componentName(comp: SignComponent): string {
  switch (comp.kind) {
    case 'arrow':
      return `箭头 ${ARROW_ANGLE[comp.arrow]}°`
    case 'line':
      return '线路牌'
    case 'text':
      return signTextLines(comp.text)[0] ?? '文字'
    case 'icon':
      return MARK_LABEL[comp.icon] ?? '图标'
  }
}
