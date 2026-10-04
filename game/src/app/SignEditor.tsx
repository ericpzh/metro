// The 指示牌 board editor (§5.8 custom text signage) — a modal, on demand.
//
// It is **two boards**, and they are shown as the two things they are:
//
//   1. **正面 and 背面** — a labelled row of bins each. A 指示牌 is read from both
//      sides of the concourse, so each side prints its own wayfinding: the front
//      is what an approaching passenger reads, the back is what someone coming the
//      other way reads, and they are independent lists. The 背面 row starts
//      **empty** — a one-sided sign is a real sign — and an empty row still has
//      its one place, so there is somewhere to drop the first mark.
//   2. **the four groups** — 箭头, 图标, 线路 or 文字, each a tile showing what it
//      makes, and one open at a time: opening a group folds the one before it, and the
//      palette that folds out does so **beside its own tile**, pushing the groups after
//      it along.
//   3. **the open group's palette** — every option it offers, one square each.
//      The palette is **shared**: the same tile drags onto either row, and the row
//      it lands in is the face it prints on. Nothing in it is unique — a mark may be
//      laid down as many times as the board has places.
//
// A bin is a **place in a list**, and the list it belongs to is the face whose row
// it is: an item may be dropped into a bin, from one bin into another **on the same
// face**, and nowhere else. Bin order is list order, all the way down to the model
// (`packSignRow`); dragging across the two rows would put a front board's mark on
// the back one, which is not a reorder but a different sign.
//
// There is no second view of either board, because a bin already *is* the board:
// every tile — a place, a group, a palette option, the mark in the air — is drawn
// with the *same* code as the sign (`render/signFace.ts` into a canvas, one metre to
// the tile), so a tile shows the black plate, the pictogram, the arrow or the shield
// that will be printed, and a row of bins is the board read left to right. No tile
// carries lettering: a name would be a second, worse picture of the thing.
//
// Two buttons, bottom right: ✕ throws the edit away and ✓ keeps it. Nothing reaches the
// station's undo stack until ✓ (`store.previewSignLayout` → `commitSignLayout`), so
// a half-arranged board is not an edit.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './store.ts'
import { Icon } from './LeftRail.tsx'
import { drawSignPanel, pictograms } from '../render/signFace.ts'
import { loadPictograms } from '../render/pictograms.ts'
import {
  SIGN_ARROWS,
  SIGN_BACK_MARK,
  SIGN_COMPONENT_MAX,
  SIGN_ICON_LABEL,
  SIGN_ICONS,
  SIGN_SIZE,
  SIGN_TEXT_EN_SCALE,
  SIGN_TEXT_MAX,
  estimateSignTextWidth,
  settleSignBins,
  signLayoutInserted,
  signLayoutMoved,
  signMarkFits,
  signTextLines,
  signTextSize,
  type SignArrow,
  type SignBoards,
  type SignComponent,
  type SignFaceName,
  type SignIcon,
  type SignLayout,
  type SignPanelSize,
} from '../sim/sign.ts'
import type { LineDef } from '../sim/types.ts'

/* ------------------------------------------------------------------- sizes */

/**
 * One tile's own raster: the CSS square (`.signPanel`'s `--tile`) is 60 px, so a tile is
 * drawn at the resolution it is shown at and the black plate inside it is a picture of one
 * metre of sign rather than a blur.
 */
const TILE_ART = 60
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
const DRAG_SCALE = 1.5
const DRAG_ART_PX = 48 * DRAG_SCALE
/** How far the pointer must travel before a press counts as a drag, in pixels. */
const DRAG_SLOP = 4
/** How far outside the rail's bin a drag still counts as being over it, in pixels. */
const TRASH_HIT = 16
/**
 * The id a mark carries while it is being dragged **out of the palette**: it is not on a
 * board yet, so it has nothing else to be called. A mark dragged off a board keeps its own
 * id, which is the difference the rail's bin cares about — only a mark that is on a board
 * can be thrown away.
 */
const DRAG_MARK_ID = 'drag'

/** The four things a sign is made of. There is no fifth. */
type SignGroupId = 'arrow' | 'icon' | 'line' | 'text'

const SIGN_GROUPS: ReadonlyArray<{ id: SignGroupId; label: string }> = [
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
const SIGN_MARKS: ReadonlyArray<{ icon: SignIcon; label: string }> = SIGN_ICONS.map((icon) => ({
  icon,
  label: SIGN_ICON_LABEL[icon],
}))

/** A pictogram's own name, where a caller has only the icon. */
const MARK_LABEL: Record<string, string> = Object.fromEntries(SIGN_MARKS.map((m) => [m.icon, m.label]))

/** The eight directions as one right-pointing mark, turned about the tile's centre. */
const ARROW_ANGLE: Record<SignArrow, number> = {
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
function markKey(comp: SignComponent): string {
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
const SIGN_FACES: ReadonlyArray<SignFaceName> = ['front', 'back']

/** What each face is called on screen: the words over its row of bins. */
const FACE_LABEL: Record<SignFaceName, string> = { front: '正面', back: '背面' }

/** A bin row's own aria-label: which face of the sign it is, and which way it reads. */
const FACE_ROW_LABEL: Record<SignFaceName, string> = {
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
function faceRowLayout(layout: readonly SignComponent[]): SignLayout {
  return layout.length > 0 ? (layout as SignLayout) : ([SIGN_BACK_MARK] as SignLayout)
}

/**
 * True once the pictograms are decoded. A tile's picture is a **bitmap** of the
 * mark (`render/pictograms.ts`), so a tile drawn before the art exists shows a
 * board with nothing on it — and the tile is cached by its own key, so it would
 * stay empty. The flag is what makes every tile redraw the moment the art lands.
 */
function usePictogramsReady(): boolean {
  const [ready, setReady] = useState(() => pictograms().size > 0)
  useEffect(() => {
    if (ready) return
    let live = true
    void loadPictograms().then(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
  }, [ready])
  return ready
}

/**
 * One mark's own picture: a square canvas drawn by `drawSignPanel` with the canvas'
 * own size as the plate — **one metre of board per tile**, however many device
 * pixels that tile is. Matching the two is the whole trick: a tile that hands the
 * drawing different metres and pixels from the canvas it owns prints at the wrong
 * scale, which is what turned every tile into a speck. The board's own near-black
 * ground fills the tile, so a tile is a piece of the sign — the plate and the mark
 * on it — rather than a glyph on the panel's blue.
 */
function useTileArt(mark: SignComponent, lines: readonly LineDef[], ready: boolean): string {
  const key = `${markKey(mark)}:${lines.map((l) => l.colour).join()}`
  const [url, setUrl] = useState('')
  useEffect(() => {
    const canvas = document.createElement('canvas')
    const px = Math.round(TILE_ART * Math.min(2, window.devicePixelRatio || 1))
    canvas.width = px
    canvas.height = px
    const g = canvas.getContext('2d')
    if (!g) return
    drawTileMark(g, mark, 1, lines, px)
    setUrl(canvas.toDataURL('image/png'))
    // `key` names everything the drawing depends on — a line's colour, an arrow's
    // direction, a pictogram, a typed label — so a changed tile redraws and an
    // unchanged one does not, however fresh the mark around it is. `ready` is the
    // one thing outside the mark: the art arriving reprints every tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready])
  return url
}

/** One mark, as the picture a tile shows. */
function MarkArt({ mark, lines, ready }: { mark: SignComponent; lines: readonly LineDef[]; ready: boolean }): React.ReactElement | null {
  const url = useTileArt(mark, lines, ready)
  return url ? <img src={url} alt="" draggable={false} /> : null
}

/**
 * One mark on a **square canvas**, drawn to fill it: the board's own black ground, and the
 * mark centred on it at the size that fills the square.
 *
 * `size` is the canvas's own side in the drawing's units and `artPx` the side it will be
 * *shown* at, in CSS pixels. They are two different things on purpose: the panel the board
 * is stated in is `size × size` and the conversion to pixels is `artPx / size`, so a caller
 * that wants a bigger picture passes a bigger `artPx` and the mark inside it grows in step
 * — which is exactly what the carried mark in a drag needs, and what it did not do while the
 * two were the same number (`TILE_ART`): the ghost was a bigger box around a picture drawn
 * for the tile, so the content looked like it shrank.
 */
function drawTileMark(
  g: CanvasRenderingContext2D,
  mark: SignComponent,
  size: number,
  lines: readonly LineDef[],
  artPx = TILE_ART,
  frame = false,
): void {
  const panel: SignPanelSize = { w: size, h: size }
  const ppm = artPx / size
  // The mark is **scaled to the tile** rather than drawn at its board size: a tile is
  // a picture of the mark, so a 0.3 m pictogram and a 0.5 m arrow both fill it.
  const ink = markInk(mark)
  const fit = Math.min(panel.w / Math.max(0.01, ink.w), panel.h / Math.max(0.01, ink.h)) * 0.82
  // `frame: false` by default: a tile is a patch of the board's lit face, so it prints
  // the board's own black ground with the mark on it and no border — the border belongs
  // to the panel's edge, and a tile is not the panel's edge.
  drawSignPanel(g, [{ ...mark, x: panel.w / 2, y: panel.h / 2, scale: fit }], { lines: [...lines], panel, ppm, frame }, 'both')
}

/**
 * A mark's drawn size in metres at scale 1. The editor's own arithmetic — `sign.ts`
 * cannot state it without a measure for text — and it is used only to fill a tile with
 * its mark, never to place anything.
 */
function markInk(mark: SignComponent): { w: number; h: number } {
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
function paletteMark(
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
function groupMarks(id: SignGroupId, lines: readonly LineDef[]): { marks: readonly SignComponent[]; split: boolean } {
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

/**
 * A **group's** tile: the marks `groupMarks` gives it, opened by its own press and click.
 *
 * It is here rather than inside `MarkTile` because a group is a different object from an
 * option: an option carries one mark out to a board, and a group's tile carries nothing —
 * it is the lid on a palette. The two look alike and behave alike (press opens, keyboard
 * opens, `aria-expanded` says which), so they share every class and the same slots for what
 * they hold; what they do not share is how many marks they hold.
 */
function GroupTile({
  id,
  lines,
  ready,
  active,
  title,
  onToggle,
}: {
  id: SignGroupId
  lines: readonly LineDef[]
  ready: boolean
  active: boolean
  title: string
  onToggle: () => void
}): React.ReactElement {
  const { marks, split } = groupMarks(id, lines)
  return (
    <button
      type="button"
      className={split ? 'tile group split' : 'tile group'}
      title={title}
      aria-label={title}
      // A group's tile is a disclosure, and `aria-expanded` is what says which it is.
      aria-expanded={active}
      onPointerDown={onToggle}
      // The press has already opened it, so the click that follows must not shut it again.
      // A **pointer** click carries a `detail` (its click count) and the one a keyboard fires
      // on Enter or Space carries none, so this drops the first and keeps the second —
      // without it, opening on the press would mean giving up the keyboard.
      onClick={(e: React.MouseEvent) => {
        if (e.detail > 0) return
        onToggle()
      }}
    >
      {marks.map((mark, i) => (
        // The diagonal goes *between* the two marks, and is a child of the row rather than a
        // background on it, so it sits in the gap the two plates leave rather than under them.
        <Fragment key={i}>
          {i > 0 && split ? <span className="tileSplit" aria-hidden="true" /> : null}
          <MarkArt mark={mark} lines={lines} ready={ready} />
        </Fragment>
      ))}
    </button>
  )
}

/**
 * One option, as the square blueprint tile that offers it. The tile is furniture —
 * flat navy with the rail's own dashed technical frame — and everything inside it is
 * the mark, drawn by the sign's own code. No tile carries lettering: the name is its
 * tooltip and nothing else, because a picture of the thing beats a word for it.
 */
function MarkTile({
  mark,
  lines,
  ready = false,
  active,
  title,
  onPointerDown,
  onClick,
}: {
  mark: SignComponent
  lines: readonly LineDef[]
  /** Whether the pictograms are decoded. A text or shield tile has no use for it. */
  ready?: boolean
  active: boolean
  title: string
  /** The press that arms a drag. Absent for a tile that is only ever clicked. */
  onPointerDown?: (e: React.PointerEvent) => void
  onClick?: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      // `grab` only where the gesture is a drag: a 线路 tile is clicked, and the cursor is
      // the one thing that says which of the two a tile is.
      className={['tile', active ? 'on' : '', onPointerDown ? 'grab' : ''].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <MarkArt mark={mark} lines={lines} ready={ready} />
    </button>
  )
}

/* ------------------------------------------------------------------ bins */

/** The next free component id on a board. */
function nextId(layout: readonly SignComponent[]): string {
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
function markFor(payload: string): SignComponent | null {
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
function withHover(layout: readonly SignComponent[], mark: SignComponent | null, index: number | null): readonly SignComponent[] {
  if (index === null || !mark || mark.id !== DRAG_MARK_ID) return layout
  const at = Math.max(0, Math.min(index, layout.length))
  return [...layout.slice(0, at), mark, ...layout.slice(at)]
}

/**
 * The floating mark the pointer carries: a small canvas of the real mark, drawn by
 * the same code as the board, lifted above the modal and moved with the pointer.
 *
 * It is a plain DOM node rather than React state on purpose: a drag reports a pointer
 * position dozens of times a second, and moving an element through the store or a
 * component's state would re-render the whole editor for every one of them.
 */
function makeDragGhost(comp: SignComponent, lines: readonly LineDef[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'dragGhost'
  const canvas = document.createElement('canvas')
  // Drawn at the size it is shown at (`.dragGhostArt`, `DRAG_ART_PX`), at the display's own
  // density, and told the panel is a **tile** — so the picture is a tile's, and everything
  // printed on it, mark included, is scaled up by `DRAG_ART_PX / TILE_ART`. The box grows
  // and the content grows with it, which is what the eye reads as "picked up".
  const px = Math.round(DRAG_ART_PX * Math.min(2, window.devicePixelRatio || 1))
  canvas.width = px
  canvas.height = px
  canvas.className = 'dragGhostArt'
  const g = canvas.getContext('2d')
  if (g) drawTileMark(g, comp, 1, lines, px)
  el.appendChild(canvas)
  document.body.appendChild(el)
  return el
}

function moveDragGhost(el: HTMLElement, x: number, y: number): void {
  el.style.transform = `translate3d(${x}px, ${y}px, 0)`
}

/** What a component is, in one word, for a bin's own label. */
function componentName(comp: SignComponent): string {
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

/**
 * The row of **places**: one square per mark on the board, and nothing else.
 *
 * A bin is not a measuring stick, it is a place in a list — the mark's position in the
 * list is its position on the board, and a drag puts one down *between* two others as
 * easily as at either end (the pointer's own x decides that, in `placeAt`). There is
 * therefore no spare slot trailing the row: a place nobody has filled is not a mark, and
 * a row with a `＋` on the end would say the only way to add one is there. (The **back**
 * row is the one exception, and it is not a spare slot either: `faceRowLayout` gives an
 * empty face the stand-in place it needs to be dropped into at all.)
 *
 * Every bin is the same square and shows nothing but the mark: the place in the list is
 * where it is on screen, so a number in the corner would only repeat the row's own order,
 * and the mark's name is its tooltip rather than a caption the tile has to carry. What is
 * left in a bin is the piece of sign that will stand there.
 *
 * The stand-in place carries nothing — no art, no delete button, no tooltip — because it
 * is not a mark: it is the absence of one, and the row it sits in is where the next mark
 * goes.
 */
function BinStrip({
  face,
  layout,
  selectedId,
  dropping,
  onPickStart,
  lineDefs,
  ready,
  label,
}: {
  /**
   * **Which board this row is.** It is written onto the row as `data-face`, because the
   * row is what a drag hovers: `placeAt` reads the face off the element under the
   * pointer (`elementFromPoint`) and this attribute is the only thing that tells the two
   * rows apart once they are in the DOM. Without it every drop resolves to 正面 — which
   * is exactly what it did.
   */
  face: SignFaceName
  layout: readonly SignComponent[]
  selectedId: string | null
  /** A mark is in the air over the row, so the well shows it would take it. */
  dropping: boolean
  /** The pointer went down on a bin: how a move between places starts. */
  onPickStart: (id: string, e: React.PointerEvent) => void
  lineDefs: readonly LineDef[]
  ready: boolean
  /** Which face's row this is, for the row's own label. */
  label: string
}): React.ReactElement {
  return (
    <div className={dropping ? 'bins drop' : 'bins'} data-face={face} role="list" aria-label={label}>
      {layout.map((comp) => {
        // An empty face's one place: a well, drawn and measured as nothing, so the row
        // has somewhere to take the first mark and nothing else about it changes.
        if (comp.id === SIGN_BACK_MARK.id) return <div key={comp.id} className="bin empty" role="listitem" aria-label="空" />
        // A mark carries **no ✕**: a bin is dragged out to the rail's bin to delete it, so
        // the square holds nothing but the piece of sign that will stand there, and the
        // corner of a small canvas is not a target the player has to find.
        return (
          <div
            key={comp.id}
            className={comp.id === selectedId ? 'bin on' : 'bin'}
            role="listitem"
            title={`${componentName(comp)} · 拖到别处换位置，拖出面板删除`}
            // The press only arms a possible drag: the window listeners in the editor
            // decide whether it became one, so a click still selects.
            onPointerDown={(e) => onPickStart(comp.id, e)}
          >
            <MarkArt mark={comp} lines={lineDefs} ready={ready} />
          </div>
        )
      })}
    </div>
  )
}

/* --------------------------------------------------------------- the modal */

/**
 * One group's palette, folding out **to the right** of the group bar.
 *
 * The build rail's `InlineExpand` is the same idea vertically: a `0fr → 1fr` track
 * that animates, a child that clips it, and the row keeps rendering even while it is
 * shut so the animation has something to slide.
 *
 * Here the track is a *column* — `grid-template-columns: 0fr → 1fr` — so the palette
 * grows out of the tile that opened it, and the four rows can be mounted together with
 * one open: switching group slides the old row away while the new one slides in, which
 * is what makes the swap one movement instead of two pictures.
 *
 * Closed rows stay in the DOM (`inert`, so nothing inside can take a press or a tab)
 * because an unmounted row cannot animate out. What keeps a closed row from being
 * *seen* is the inner `overflow: hidden` clipping it to the zero-width track.
 *
 * **The children are always the current ones.** A shut row is clipped, not frozen: its
 * tiles are built from the editor's live state on every render, so a tile in a row that
 * is about to fold open already means what it will mean when it does. Keeping a
 * *retained copy* of the last open children instead is the trap — those elements carry
 * the props and the handlers of the render that made them, so a palette shut since
 * before the player switched to 背面 would still add its mark to 正面, and its `selected`
 * highlight would be the selection of a board the player has left. `aria-hidden` and
 * `inert` are what make a clipped row inert; React's own state is what keeps it honest.
 */
function PaletteRow({ open, children }: { open: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <div className={open ? 'signRow open' : 'signRow'} aria-hidden={!open} inert={!open}>
      <div className="signRowInner">
        <div className="signRowPad">{children}</div>
      </div>
    </div>
  )
}

/**
 * The 指示牌 board editor. Mounted once at the app root and shown while the store has
 * an editing session: `signEditorFor !== null` (a placed sign) or `signComposing` (the
 * current boards alone), so it never competes with the viewport for a click.
 *
 * The **current boards** are deliberately not part of that test. They are what every
 * new sign is hung with, so they outlive the modal — and an open test of "are boards
 * set" left the editor up with its own ✕ unable to close it.
 */
export function SignEditor(): React.ReactElement | null {
  // Every tile in the modal is a picture of the mark it makes, and a pictogram's
  // picture is a bitmap, so the modal waits on the art — however it was opened.
  const ready = usePictogramsReady()
  const open = useStore((s) => s.signEditorFor !== null || s.signComposing)
  const target = useStore((s) => s.signEditorFor)
  const station = useStore((s) => s.station)
  const currentBoards = useStore((s) => s.currentBoards)
  const previewSignLayout = useStore((s) => s.previewSignLayout)
  const commitSignLayout = useStore((s) => s.commitSignLayout)
  const restoreSignLayout = useStore((s) => s.restoreSignLayout)
  const closeSignEditor = useStore((s) => s.closeSignEditor)
  const setNotice = useStore((s) => s.setNotice)

  const module = target === null ? undefined : station.modules.find((m) => m.id === target)
  // The boards being edited: the module's own when the editor was opened from a placed
  // sign, else the store's **current boards** — a session always opens on one of them,
  // and `openSignEditor` has already put the module's there.
  const stored: SignBoards = module?.type === 'sign' ? { front: module.cfg.front ?? currentBoards.front, back: module.cfg.back ?? [] } : currentBoards

  // The editor's own boards: taken once, when the editor opens, and written back on
  // ✓. `opened` is what a ✕ goes back to.
  const [boards, setBoards] = useState<SignBoards>(stored)
  const [group, setGroup] = useState<SignGroupId | null>(null)
  // The face whose row the palette is currently working on: the one last touched, and
  // the one a mark added by a **click** lands on. A drag re-reads the row under the
  // pointer (`trackDrag`), so a tile let go over 背面 is a back mark without the player
  // having to point at the face first.
  const [focusedFace, setFocusedFace] = useState<SignFaceName>('front')
  // The mark picked out of a row: which board it is on, and its id. A sign is two boards,
  // so the face travels with the id — see `selected` below.
  const [selection, setSelection] = useState<{ face: SignFaceName; id: string } | null>(null)
  // The drag in flight: the mark being carried, the row it would be put down in, and the
  // place in that row. All three are null when nothing is being dragged.
  const [dragMark, setDragMark] = useState<SignComponent | null>(null)
  const [insertAt, setInsertAt] = useState<number | null>(null)
  const [hoverFace, setHoverFace] = useState<SignFaceName | null>(null)
  const opened = useRef<SignBoards>(stored)

  useEffect(() => {
    if (!open) return
    // A modal opens on its own boards: the group that was open and the mark that was
    // picked both belong to the boards that were just closed.
    opened.current = stored
    setBoards(stored)
    setSelection(null)
    setGroup(null)
    setFocusedFace('front')
    setDragMark(null)
    setInsertAt(null)
    setHoverFace(null)
    // Deliberately keyed on the session, not on `stored`: an edit writes the current
    // boards as the player works, and re-seeding on every write would fight the edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target])

  /**
   * The one place a board is written: the editor's own two lists, the bins, the hover
   * ghost and the module are all this call.
   *
   * Both faces are settled together (`previewSignLayout` → `settleSignBoards`) because
   * the two plates share one panel: a mark added to the front can lengthen the steel the
   * back is printed on, so writing one face without the other would leave the pair
   * disagreeing about the sign they hang on.
   */
  const apply = useCallback(
    (next: SignBoards) => {
      const trimmed: SignBoards = {
        front: next.front.slice(0, SIGN_COMPONENT_MAX),
        back: next.back.slice(0, SIGN_COMPONENT_MAX),
      }
      setBoards(trimmed)
      previewSignLayout(trimmed)
    },
    [previewSignLayout],
  )

  const cancel = useCallback((): void => {
    restoreSignLayout(opened.current)
    closeSignEditor()
  }, [restoreSignLayout, closeSignEditor])

  const confirm = useCallback((): void => {
    commitSignLayout(boards)
    closeSignEditor()
  }, [commitSignLayout, closeSignEditor, boards])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') confirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, cancel, confirm])

  /* ------------------------------------------------------------ the drag */

  /**
   * One gesture, used by both drags: an item comes from the palette or from the row,
   * floats above the panel under the pointer, and lands wherever the pointer is on the
   * row. The row makes room while it hovers, so the drop is never a surprise.
   *
   * The pointer position never becomes React state — a drag reports one dozens of
   * times a second and re-rendering the editor for each would stutter. The floating
   * mark is a DOM node moved by `transform`, and state changes only when the **place**
   * under the pointer changes, which is the only thing the row's own layout depends on.
   */
  const drag = useRef<{
    /**
     * The id of the mark being carried, as it stands in the board it is currently on. A
     * move renumbers it (the settle mints ids from the list's order), so this is
     * reassigned on every move rather than being the id the drag started with.
     */
    id: string | null
    payload: string
    /**
     * **The board the mark is on**, which is the board it was lifted from until a move
     * takes it to the other one, and the board it lands on afterwards. It is where a
     * cancel or a throw away has to look for the mark.
     */
    remove: { face: SignFaceName | null; id: string }
    ghost: HTMLElement | null
    /** The pointer is over the bin, so the mark is about to be thrown away. */
    overTrash: boolean
  } | null>(null)
  const armed = useRef<{ id: string; payload: string; face: SignFaceName; x: number; y: number } | null>(null)
  const placeRef = useRef<{ face: SignFaceName; index: number } | null>(null)
  // The bin in the rail's corner, and whether the mark in the air is over it: the one
  // place a drag can end that is not a place on a board.
  const trashRef = useRef<HTMLButtonElement | null>(null)
  const [overTrash, setOverTrash] = useState(false)
  // The newest boards, the newest writer and the newest lines, read through refs so the
  // window listeners are bound once per session rather than once per keystroke.
  const boardsRef = useRef(boards)
  boardsRef.current = boards
  const applyRef = useRef(apply)
  applyRef.current = apply
  // Taking a mark off a board, as the listeners see it (see `remove`): the way a drag
  // that ends on the rail's bin deletes.
  const removeRef = useRef<(face: SignFaceName, id: string) => void>(() => {})
  // The editor's own toast, as the listeners see it. A drop that is refused has to say so,
  // and it is refused inside a window listener (`endDrag`, `trackDrag`) that was bound once.
  const noticeRef = useRef<(text: string) => void>(() => {})
  const linesRef = useRef(station.lines)
  linesRef.current = station.lines
  // The mark being carried, as the listeners see it: the same value as `dragMark`, but
  // readable inside a window listener that was bound once and must not go stale.
  const dragMarkRef = useRef<SignComponent | null>(null)

  /**
   * The place a pointer at `x, y` would put a mark down: **which row** it is over, and
   * its index in that row — or null when the pointer is off both rows entirely.
   *
   * The row is a list of equal squares, so the place is read off the pointer's own x:
   * every square whose centre is left of it counts. That puts a mark **before** the
   * square under the pointer on the pointer's left half and **after** it on the right,
   * and past the last square's centre it is the end of the list — which is how a mark is
   * appended (the row carries no spare place) and how it is prepended at the other end
   * (left of the first centre).
   *
   * The **row** is what makes 正面 and 背面 two boards rather than one board printed
   * twice: the row under the pointer names the face, and that face is the board the mark
   * belongs to. Each row carries its own face as `data-face` (`BinStrip`), and the bins
   * are read from *that* row, so the index counts its squares and not the other row's.
   *
   * A row with no readable face is treated as no row at all rather than as 正面. That is
   * deliberate: the fallback is what made every drop land on the front board when the
   * attribute was missing, and a drop that quietly goes somewhere other than where the
   * player aimed is worse than a drop that does not happen.
   */
  const placeAt = (x: number, y: number): { face: SignFaceName; index: number } | null => {
    const el = document.elementFromPoint(x, y)
    const hit = el?.closest?.('.bins') as HTMLElement | null
    // A hit on the row is taken as read. Anything else falls back to the nearest row
    // **within a bin's height of the pointer**, because the rows are separated by a
    // caption and a gap, and `elementFromPoint` in that band answers with the row's own
    // container: a drag aimed at the top edge of 背面 would otherwise find no row at all
    // and go nowhere. The band is what keeps that from swallowing a pointer that is
    // genuinely somewhere else on the panel.
    let row = hit
    if (!row) {
      let best = Infinity
      for (const candidate of document.querySelectorAll<HTMLElement>('.bins[data-face]')) {
        const r = candidate.getBoundingClientRect()
        const slack = r.height || 1
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
        if (dy <= slack && dx <= slack) {
          // Ties go to the row the pointer is vertically nearer, then to 正面, so the
          // band between two rows belongs to the one being aimed at rather than to
          // whichever the document happens to list first.
          const distance = dy * 1000 + dx
          if (distance < best) {
            best = distance
            row = candidate
          }
        }
      }
    }
    if (!row) return null
    const face = row.dataset.face
    if (face !== 'front' && face !== 'back') return null
    let index = 0
    for (const bin of row.querySelectorAll('.bin')) {
      const r = bin.getBoundingClientRect()
      if (x <= r.left + r.width / 2) break
      index++
    }
    return { face, index }
  }

  /**
   * True when the pointer is over the corner bin. The bin's own box is small and it sits
   * beside two buttons, so the hit area is grown by `TRASH_HIT` on every side — a drag
   * aimed at "the corner" should not have to be aimed at the glyph.
   *
   * The box is read as its **layout** size, not its painted one: the bin grows while a
   * mark is over it (`.signAct.trash.over` scales it), and a hit test that grew with the
   * button would be chasing its own state — the pointer would have to leave a bigger and
   * bigger box to shed the highlight. `offsetWidth` / `offsetHeight` are the size before
   * the transform, so what "over the bin" means does not move while the highlight is on.
   */
  const overBin = (x: number, y: number): boolean => {
    const el = trashRef.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    const halfW = el.offsetWidth / 2
    const halfH = el.offsetHeight / 2
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    return (
      x >= cx - halfW - TRASH_HIT &&
      x <= cx + halfW + TRASH_HIT &&
      y >= cy - halfH - TRASH_HIT &&
      y <= cy + halfH + TRASH_HIT
    )
  }

  /** Move the drag to the place under the pointer, if it changed. */
  const trackDrag = (x: number, y: number, mark: SignComponent): void => {
    const d = drag.current
    if (!d) return
    // The mark in the air, made once and then moved by transform for the rest of the
    // drag: re-drawing it per pointer move would be a canvas fill per frame.
    if (!d.ghost) d.ghost = makeDragGhost(mark, linesRef.current)
    moveDragGhost(d.ghost, x, y)
    // Over the bin: the pointer is over no *place*, so the row is left exactly as it was
    // — nothing is inserted, nothing is reordered, and a mark dragged out of a bin is
    // still in it (a drag that wanders onto the bin and back off must not have moved it).
    const over = overBin(x, y)
    if (over !== d.overTrash) {
      d.overTrash = over
      setOverTrash(over)
    }
    const place = over ? null : placeAt(x, y)
    if (place?.face === placeRef.current?.face && place?.index === placeRef.current?.index) return
    placeRef.current = place
    setInsertAt(place === null ? null : place.index)
    setHoverFace(place === null ? null : place.face)
    // A move reorders **as it is dragged**, so the place being hovered really does hold
    // the mark by the time the pointer is released. A drag that ends off the rows changes
    // nothing.
    if (d.id === null || place === null) return
    const held = d.remove
    if (held.face === null) return
    const list = boardsRef.current[held.face]
    const at = list.findIndex((c) => c.id === d.id)
    if (at < 0) return
    const comp = list[at]
    const sameFace = held.face === place.face
    // Nothing to do when the place is already the mark's own: it holds the place it is
    // being dragged to, and re-laying the row on every pointer move would be churn.
    if (sameFace && at === place.index) return
    // **Across the two rows is a move between boards**, not a reorder: the mark leaves the
    // board it was on and joins the one it is over. Both faces are written in the one call,
    // so the pair is never left holding the same mark twice — and because the editor *draws*
    // what it stores, the mark travels with the pointer from one row to the other as it is
    // carried. A drag that wanders back before it is let go simply puts it back, because
    // this is the same statement run the other way.
    //
    // The mark is taken **out of** the target list before it goes back in. Across the rows
    // that filter is a no-op (the mark is not there); within a row it is the removal that
    // turns an insert into a move, and without it a reorder inserted a *second* copy of the
    // mark — the duplicate a settle renames to `c3_` — into a row that already had it.
    if (!sameFace) {
      // The target board has to have room for it — asked **here**, at the moment the mark
      // would change boards, and never before: a press blocks nothing (a drag may be going
      // anywhere, including to the bin, or to the other face and back), so the refusal can
      // only be about a board that is actually being committed to.
      if (!signMarkFits(boardsRef.current[place.face], comp)) {
        noticeRef.current('这块牌子放不下了 — 先删掉一些内容')
        return
      }
      const next = signLayoutInserted(
        boardsRef.current[place.face].filter((c) => c.id !== comp.id),
        comp,
        place.index,
      )
      // The mark was renumbered by that re-lay (`signLayoutInOrder` mints ids from the
      // list's order), so the drag follows the id it now has — otherwise the next pointer
      // move would look for the old one and stop finding it.
      const moved = next.find((c) => c.id === comp.id) ?? next[Math.min(place.index, next.length - 1)]
      d.id = moved ? moved.id : d.id
      d.remove = { face: place.face, id: d.id }
      applyRef.current({ ...boardsRef.current, [held.face]: list.filter((c) => c.id !== comp.id), [place.face]: next })
      return
    }
    // A move along a row is the model's own reorder (`signLayoutMoved`), which re-states
    // every mark's place along the row: the row the player watches shifting is the row that
    // will be there when they let go. The insert-and-filter form above is for crossing
    // *between* boards — applying it within a row re-pitched the row to its bin centres and
    // lost the place the pointer had aimed at.
    applyRef.current({ ...boardsRef.current, [held.face]: signLayoutMoved(list, comp.id, place.index) })
  }

  const endDrag = (commitDrop: boolean): void => {
    const d = drag.current
    drag.current = null
    armed.current = null
    if (d?.ghost) d.ghost.remove()
    const place = placeRef.current
    placeRef.current = null
    dragMarkRef.current = null
    setInsertAt(null)
    setHoverFace(null)
    setDragMark(null)
    setOverTrash(false)
    if (!commitDrop || !d) return
    // A mark that was **on a board** is thrown away when it is let go over the rail's bin,
    // and by nothing else. Letting go anywhere else that is not a place on a row puts it
    // back where it was — a drag that wanders off the panel and comes back, or ends on the
    // scrim, is a drag the player changed their mind about, and a gesture that quietly
    // deletes a mark for being released a few pixels too far is not one anybody can use.
    // This is the only way a mark leaves a board, now that a bin carries no ✕.
    //
    // `d.remove` names the board the mark is on **now**, which is where a move across the
    // rows last put it — not the board it was lifted from. `d.id` is read from it rather
    // than remembered, because a move renumbers the mark (`trackDrag`).
    if (d.id !== null && d.overTrash) {
      if (d.remove.face !== null) removeRef.current(d.remove.face, d.id)
      return
    }
    // A drop from the palette is an insert into the row it was let go over, and its own
    // drag never had a mark to throw away: let go off the rows it simply ends, and the tile
    // stays in the palette. A drop of a board mark onto a row has already been made, place
    // by place, as the pointer moved — including the refusal above, which is why a mark that
    // could not cross is still on the board it started on.
    if (d.id === null && place !== null) {
      const list = boardsRef.current[place.face]
      const comp = markFor(d.payload)
      // **On the drop, not on the drag**: the tile armed and carried (it may have been aimed
      // at the other face, or at the bin), and it is only here, with the row it was let go
      // over in hand, that "does this board have room" is a question about anything.
      if (comp && signMarkFits(list, comp)) {
        applyRef.current({ ...boardsRef.current, [place.face]: signLayoutInserted(list, { ...comp, id: nextId(list) }, place.index) })
      } else if (comp) {
        noticeRef.current('这块牌子放不下了 — 先删掉一些内容')
      }
    }
  }

  useEffect(() => {
    if (!open) return
    const onMove = (e: PointerEvent): void => {
      const a = armed.current
      if (!a) {
        // Already dragging: the carried mark travels with the pointer.
        if (drag.current) {
          const held = dragMarkRef.current
          if (held) trackDrag(e.clientX, e.clientY, held)
        }
        return
      }
      if (Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) < DRAG_SLOP) return
      // The press became a drag: the mark leaves its tile (or its place in the row) and floats.
      armed.current = null
      const mark = a.id === '' ? markFor(a.payload) : (boardsRef.current[a.face].find((c) => c.id === a.id) ?? null)
      if (!mark) return
      drag.current = {
        id: a.id === '' ? null : a.id,
        payload: a.payload,
        // Where the mark is **now**: the row it was lifted from, and the row `trackDrag`
        // files it on again after each move across. It is what a drop off the rows reads to
        // know which board to take the mark off; a palette tile has no board yet (`null`),
        // which is what makes it undeletable.
        remove: { face: a.id === '' ? null : a.face, id: a.id },
        ghost: null,
        overTrash: false,
      }
      dragMarkRef.current = mark
      setDragMark(mark)
      trackDrag(e.clientX, e.clientY, mark)
    }
    const onUp = (): void => {
      // Letting go: a drop if a drag is in flight, otherwise the press was a click and
      // the mark it landed on has already been selected.
      if (drag.current) endDrag(true)
      armed.current = null
    }
    const onCancel = (): void => {
      armed.current = null
      if (drag.current) endDrag(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [open])

  /* ------------------------------------------------------------- editing */

  // The face the palette is working on, and the board it writes to. `focusedFace` is
  // where a mark added without a drag goes: the row the player last touched, which is
  // what makes "click 线路 twice" and "drop this arrow" both mean the board on screen.
  const layout = boards[focusedFace]
  // The picked mark, as **which** board it is on and its id. A sign is two boards, so an
  // id alone would let a pick on one row light up a mark on the other simply because the
  // two hands minted the same `c1`.
  const selected = selection?.face === focusedFace ? layout.find((c) => c.id === selection.id) : undefined
  // Where a mark added from the palette goes when nothing is dragged: the bin after
  // the picked one, else the end of the row.
  const insertIndex = selected ? layout.findIndex((c) => c.id === selected.id) + 1 : layout.length
  // What a bin lights up with: the picked mark's id, but only on the board that holds it.
  const selectedId = (face: SignFaceName): string | null => (selection?.face === face ? selection.id : null)

  /**
   * Point the palette at a face. The pick is dropped when it belongs to the other board,
   * because it was a pick **on that board**: the other row cannot show it, and keeping the
   * id would light up whatever mark happened to share it.
   */
  const focusFace = (face: SignFaceName): void => {
    setFocusedFace(face)
    setSelection((cur) => (cur !== null && cur.face !== face ? null : cur))
  }

  /**
   * Whether one more mark of this kind would still fit on the focused board, **saying so**
   * when it will not.
   *
   * **Room is measured, not counted.** A board grows to `PANEL_MAX_W` and then stops, so how
   * many marks fit depends on how wide they are: six arrows fill it, nine pictograms come
   * close, and a board of arrows has no room for a seventh. Asking the model per mark
   * (`signMarkFits`) is what keeps the palette, the board's own length and what actually gets
   * printed saying the same thing — a count here would be wrong for every kind but one, and
   * was: the palette used to hand out marks the print then stacked on top of each other.
   *
   * **Nothing calls this on a press or on a pointer move.** A drag is not a commitment: one
   * carrying a palette tile may be aimed at either face or at the bin, and one carrying a
   * board mark may be crossing between the boards. So the question is asked where a mark is
   * actually put down — `trackDrag` when a mark crosses rows, `endDrag` when a tile is let go
   * — and this is only the wording of the refusal.
   */
  const noticeFull = (comp: SignComponent): boolean => {
    if (layout.length >= SIGN_COMPONENT_MAX) {
      setNotice(`一块指示牌最多放 ${SIGN_COMPONENT_MAX} 格内容`)
      return true
    }
    if (signMarkFits(layout, comp)) return false
    setNotice('这块牌子放不下了 — 先删掉一些内容')
    return true
  }

  /** True when the bin has something it could be given: a mark, on either face. */
  const populated = boards.front.length > 0 || boards.back.length > 0

  /**
   * Open a group, or shut the one that is open. One group at a time: opening another folds
   * the first, which is what makes the row a set of four rather than four drawers left out.
   *
   * It is called from a group tile's **press** and from its keyboard click alike (see
   * `GroupTile`), so the group is there the moment the pointer goes down.
   */
  const toggleGroup = (id: SignGroupId): void => {
    setGroup((cur) => (cur === id ? null : id))
  }

  /**
   * The bin's other gesture: **clicked with nothing in hand, it empties both boards**. A
   * drag onto it deletes the one mark being carried (see `endDrag`); a click deletes all of
   * them, on 正面 and 背面 alike, which is the only way to start a board over in one go.
   *
   * It is one step, not two: the whole clear goes through `apply`, so ✓ makes it the board
   * and ✕ puts the old one back like any other edit. The selection goes with it — the
   * palette's text boxes would otherwise go on editing a mark that is no longer there.
   */
  const clearAll = (): void => {
    if (!populated) return
    setSelection(null)
    setGroup(null)
    apply({ front: [], back: [] })
  }

  /**
   * 线路 **adds** a shield bound to that line: nothing limits it but the board's own length,
   * so a sign may carry 5号线 five times. The new shield lands after the selected mark, which
   * is what makes clicking one line twice lay the two shields side by side.
   */
  const setLine = (lineId: string): void => {
    const comp: SignComponent = { id: nextId(layout), kind: 'line', lineId, english: true, x: 0, y: 0, scale: 1, side: 'both' }
    if (noticeFull(comp)) return
    apply({ ...boards, [focusedFace]: signLayoutInserted(layout, comp, insertIndex) })
    setSelection({ face: focusedFace, id: comp.id })
  }

  /**
   * A label is put on a board by **dragging its tile into a bin**, and by nothing else:
   * this patches a label that is already up and never inserts one, so typing is an edit
   * of what is up rather than a way to add it. (Inserting on the first keystroke dropped
   * a mark into the row at a place nobody had chosen, and every letter after it wrote the
   * board again.)
   *
   * Which label it patches is the **selected** one — the same component the text boxes
   * are showing (`TextFields` reads `selected`, not the first label it can find). Labels
   * repeat freely now, so "the first text box on the board" would mean typing into one
   * label rewrote another; a selection is what the player has actually pointed the boxes
   * at, and with nothing selected there is nothing to edit.
   */
  const setText = (text: string): void => {
    if (selected?.kind !== 'text') return
    apply({ ...boards, [focusedFace]: layout.map((c) => (c.id === selected.id ? ({ ...c, text } as SignComponent) : c)) })
  }

  /**
   * Take a mark off **one** face. Which list it came out of is read from the argument
   * rather than from the focused face, because the rail's bin is not on a row and the
   * player may have touched the other one since. Clearing the selection is part of it: a
   * mark that is gone cannot stay picked, and the palette's boxes would go on editing it.
   */
  const remove = (face: SignFaceName, id: string): void => {
    setSelection((cur) => (cur?.face === face && cur.id === id ? null : cur))
    apply({ ...boards, [face]: boards[face].filter((c) => c.id !== id) })
  }
  removeRef.current = remove
  noticeRef.current = setNotice

  /**
   * A palette tile is picked up, not clicked: pressing one **arms** a drag (`payload`,
   * no id) and only a move that clears the slop starts it.
   *
   * Every tile arms, and every tile lands: marks repeat, so there is no tile the board
   * can already have too many of — the only refusal is a board with all ten places full
   * (`full`), asked here so a tile the board cannot take costs nothing but a press.
   * Letting go without moving is a click, which is what `pickExisting` answers.
   *
   * The face it arms is the **focused** one — the row the player last touched — and
   * `trackDrag` re-reads that from whichever row the pointer is actually over, so a tile
   * dropped in 背面 is armed on the front and let go on the back.
   *
   * A press **on the bin** arms nothing, whichever tile it came from: the bin is the one
   * place a mark is not put down, and arming there would have the drag's own move handler
   * pick the press up and carry a mark the player was never carrying. It is what leaves the
   * bin free to be clicked on its own — which is how a board is emptied (see `clearAll`).
   */
  const armPaletteDrag = (payload: string, e: React.PointerEvent): void => {
    // **Nothing is refused here.** A press arms a drag and says nothing about whether the
    // mark will land: it may be aimed at either face, at the other row, or at the bin, and a
    // board that is full is no reason to stop the player picking a tile up. Whether there is
    // room is asked where the mark is put down (`trackDrag` for a crossing, `endDrag` for the
    // drop) — see `noticeFull`.
    //
    // The exception is the bin itself: a press *on* the bin arms nothing, because it is the
    // one place a mark is not put down, and arming there would have the drag's own move
    // handler pick the press up and carry a mark the player was never carrying.
    if (overBin(e.clientX, e.clientY)) return
    armed.current = { id: '', payload, face: focusedFace, x: e.clientX, y: e.clientY }
  }

  /**
   * What a click on a tile means, now that a mark is not unique: **select a label**.
   *
   * Marks repeat, so a click has no "the one already there" to fall back on, and adding
   * is what the drag is for. The one click that does real work is the text box's: a label
   * is the only mark whose palette *is* an editor for it, so a click on the 文字 tile picks
   * the focused board's first label if it has one — which is the label whose text the
   * boxes then show and edit (`TextFields`, `setText`). With no label up, the click does
   * nothing and the boxes drag a new one in.
   */
  const pickExisting = (): void => {
    const found = layout.find((c) => c.kind === 'text')
    if (found && selection?.id !== found.id) setSelection({ face: focusedFace, id: found.id })
  }

  if (!open) return null

  const lines = station.lines
  // Each face's own geometry, for the two things a row of tiles needs from it: the
  // settled order and the marks on it. A tile is a fixed square rather than a slice of
  // the panel, but the row is still the board: one square per mark, in order. The back
  // row is laid over `faceRowLayout`, which is what gives an empty back its one place.
  const rows = SIGN_FACES.map((face) => {
    const board = settleSignBins(faceRowLayout(boards[face]))
    // What is drawn **while a mark is in the air**: it takes the place the pointer is
    // over and the row shifts along, so the row shows the drop that is about to happen
    // rather than the one that already did. Only the row under the pointer is drawn with
    // the mark in it: the other row is a different board and never takes a mark the
    // pointer is not over.
    const shown = withHover(board.layout, hoverFace === face ? dragMark : null, hoverFace === face ? insertAt : null)
    return { face, layout: shown === board.layout ? board.layout : settleSignBins(shown).layout }
  })
  return (
    <div className="signModal" role="dialog" aria-modal="true" aria-label="指示牌编辑器">
      <div className="signPanel">
        {/* 1. the two boards — 正面 and 背面, each a labelled row of places drawn the way
            the sign prints it. They are two independent boards, so each has its own row,
            its own order and its own (possibly empty) content. */}
        <div className="signBoards">
          {rows.map((row) => (
            <div key={row.face} className={focusedFace === row.face ? 'signFaceRow on' : 'signFaceRow'}>
              <button
                type="button"
                className="signFaceLabel"
                aria-pressed={focusedFace === row.face}
                title={`在${FACE_LABEL[row.face]}上放新的内容`}
                onClick={() => focusFace(row.face)}
              >
                {FACE_LABEL[row.face]}
              </button>
              <BinStrip
                face={row.face}
                layout={row.layout}
                selectedId={selectedId(row.face)}
                dropping={hoverFace === row.face && insertAt !== null}
                onPickStart={(id, e) => {
                  // Pressing a bin is also how the palette is pointed at that face. The
                  // selection survives a press on a **different** face, because the press
                  // itself is about to select there: `focusFace` runs first and would
                  // otherwise drop the pick the player is in the middle of making.
                  if (focusedFace !== row.face) setFocusedFace(row.face)
                  setSelection({ face: row.face, id })
                  // Armed, not started: a press that never moves is a selection.
                  armed.current = { id, payload: '', face: row.face, x: e.clientX, y: e.clientY }
                }}
                lineDefs={lines}
                ready={ready}
                label={`${FACE_LABEL[row.face]} · ${FACE_ROW_LABEL[row.face]}`}
              />
            </div>
          ))}
        </div>

        {/* 2. the four groups, each its own tile, and the open group's options folding
            out **beside its own tile** — so opening one pushes the tiles to its right
            along, the way the build rail's tiles are pushed down by a sub-menu. The tile
            and its palette are one item of this row (`.signGroup`), which is what keeps
            the palette attached to the group it belongs to rather than to the end of the
            row. All four palettes stay mounted and one is open: `PaletteRow` clips the
            others to nothing, so switching group is the old palette folding away while
            the new one folds out, in one movement. */}
        <div className="signPalette">
          {SIGN_GROUPS.map((g) => (
            <div className="signGroup" key={g.id}>
              <GroupTile
                id={g.id}
                lines={lines}
                ready={ready}
                active={group === g.id}
                title={group === g.id ? `${g.label} — 收起这一组` : `${g.label} — 展开这一组`}
                onToggle={() => toggleGroup(g.id)}
              />

              <PaletteRow open={group === 'arrow' && g.id === 'arrow'}>
                {SIGN_ARROWS.map((a) => (
                  <MarkTile
                    key={a}
                    mark={paletteMark({ kind: 'arrow', arrow: a })}
                    lines={lines}
                    active={selected?.kind === 'arrow' && selected.arrow === a}
                    title={`箭头 ${ARROW_ANGLE[a]}° — 拖到格位上`}
                    onPointerDown={(e) => armPaletteDrag(`arrow:${a}`, e)}
                  />
                ))}
              </PaletteRow>

              <PaletteRow open={group === 'icon' && g.id === 'icon'}>
                {SIGN_MARKS.map((m) => (
                  <MarkTile
                    key={m.icon}
                    mark={paletteMark({ kind: 'icon', icon: m.icon })}
                    lines={lines}
                    ready={ready}
                    active={selected?.kind === 'icon' && selected.icon === m.icon}
                    title={`${m.label} — 拖到格位上`}
                    onPointerDown={(e) => armPaletteDrag(`icon:${m.icon}`, e)}
                  />
                ))}
              </PaletteRow>

              {/* 线路 is a mark, not a setting: a shield is dropped wherever the pointer lets
                  it go and may be laid down as many times as the board has places, so the same
                  line can stand five times on one sign. A click adds one after the selection. */}
              <PaletteRow open={group === 'line' && g.id === 'line'}>
                {lines.map((l) => {
                  const active = selected?.kind === 'line' && (selected.lineId === l.id || (selected.lineId === '' && lines[0]?.id === l.id))
                  return (
                    <MarkTile
                      key={l.id}
                      mark={paletteMark({ kind: 'line', lineId: l.id })}
                      lines={lines}
                      active={active}
                      title={`${l.name} — 拖到格位上，可以放多个`}
                      onPointerDown={(e) => armPaletteDrag(`line:${l.id}`, e)}
                      onClick={() => setLine(l.id)}
                    />
                  )
                })}
              </PaletteRow>

              <PaletteRow open={group === 'text' && g.id === 'text'}>
                <TextFields
                  comp={selected?.kind === 'text' ? selected : undefined}
                  lines={lines}
                  onCommit={setText}
                  onArmDrag={(text, e) => armPaletteDrag(`text:${text}`, e)}
                  onPick={pickExisting}
                />
              </PaletteRow>
            </div>
          ))}
        </div>

        {/* 4. the rail's corner, bottom right: the bin, then the two acts — throw the edit
            away, or keep it. They are the last thing in the panel because that is where the
            gesture ends: the board is arranged above them, the way out is under it, and the
            bin sits where a mark being carried to it comes to rest. */}
        <div className="signRail">
          <button
            type="button"
            ref={trashRef}
            className={[
              'signAct',
              'trash',
              // The bin is **always there**, and red: it is a button with a press of its
              // own (click it to empty both boards), so hiding it until a drag started would
              // hide half of what it does. A full board tints its plate (`overTrash`), see
              // `.signAct.trash.over`.
              overTrash && dragMark?.id !== DRAG_MARK_ID && populated ? 'over' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title="拖到这里删除一个；点一下清空正反面"
            aria-label="删除拖入的内容，或点击清空正反面"
            // A **click** on a bin that is holding nothing: the whole board goes. A press
            // that became a drag never gets here — the browser withholds the click once the
            // pointer has moved, and the drag's own end (`endDrag`) has already deleted the
            // one mark it was carrying.
            onClick={clearAll}
          >
            <Icon name="delete" />
          </button>
          <button type="button" className="signAct cancel" title="放弃修改 (Esc)" aria-label="放弃修改" onClick={cancel}>
            ✕
          </button>
          <button type="button" className="signAct ok" title="完成 (Enter)" aria-label="完成" onClick={confirm}>
            ✓
          </button>
        </div>
      </div>
      <button className="signModalScrim" aria-label="关闭编辑器" onClick={cancel} />
    </div>
  )
}

/**
 * The one text box: 中文 on the first line, English on the second — and, to the left of
 * them, the **label they add up to**, drawn by the sign like every other tile's mark.
 *
 * That tile is the group's drag handle, and it is the only one: the boxes are text
 * fields, so a press inside one has to mean "put the caret here" (or "select this
 * word"), never "lift this mark" — dragging a selection out of an input used to start a
 * drag and lay down a label nobody asked for. The tile is rebuilt from the two rows as
 * they are typed, so what the pointer picks up is what the board would print.
 */
function TextFields({
  comp,
  lines: stationLines,
  onCommit,
  onArmDrag,
  onPick,
}: {
  comp: Extract<SignComponent, { kind: 'text' }> | undefined
  /** The station's lines, so the tile is drawn by the same call as every other tile. */
  lines: readonly LineDef[]
  onCommit: (text: string) => void
  /** The tile was pressed: the rows it shows are what the drag carries. */
  onArmDrag: (text: string, e: React.PointerEvent) => void
  /** And a press that never moved is a click, which picks the label already up. */
  onPick: () => void
}): React.ReactElement {
  const rows = comp ? signTextLines(comp.text) : []
  const [zh, setZh] = useState(rows[0] ?? '')
  const [en, setEn] = useState(rows[1] ?? '')
  // The boxes are re-seeded only when a **different** text box is picked: an edit
  // writes the board back through the store, so re-seeding on every write would
  // overwrite what is being typed with the text that typing just produced.
  const forId = useRef<string | null>(null)
  useEffect(() => {
    const id = comp?.id ?? null
    if (forId.current === id) return
    forId.current = id
    const next = comp ? signTextLines(comp.text) : []
    setZh(next[0] ?? '')
    setEn(next[1] ?? '')
  }, [comp])
  const push = (a: string, b: string): void => {
    onCommit([a, b].map((r) => [...r].slice(0, SIGN_TEXT_MAX).join('')).filter((r) => r.trim() !== '').join('\n'))
  }
  // The two rows as one label: 中文 over its gloss, empty rows dropped, which is what
  // `signTextLines` reads back out of a component.
  const text = [zh, en].map((r) => r.trim()).filter((r) => r !== '').join('\n')
  return (
    <>
      <MarkTile
        mark={paletteMark({ kind: 'text', text: text === '' ? '文字' : text })}
        lines={stationLines}
        active={comp !== undefined}
        title={`${text === '' ? '文字' : text.replace('\n', ' / ')} — 拖到格位上`}
        onPointerDown={(e) => onArmDrag(text, e)}
        onClick={onPick}
      />
      <input
        className="signText"
        value={zh}
        maxLength={SIGN_TEXT_MAX}
        placeholder={'中文'}
        aria-label="中文"
        onChange={(e) => {
          setZh(e.target.value)
          push(e.target.value, en)
        }}
      />
      <input
        className="signCaption"
        value={en}
        maxLength={SIGN_TEXT_MAX}
        placeholder="English"
        aria-label="English"
        onChange={(e) => {
          setEn(e.target.value)
          push(zh, e.target.value)
        }}
      />
    </>
  )
}

