// The 指示牌 pixels — one flat wayfinding board, drawn from `sim/sign.ts`'s
// layout.
//
// This is the *only* drawing code for an overhead sign. The lit face on the drawn
// model (`models.ts`), the translucent hover ghost and the board editor's flat
// preview (`app/SignEditor.tsx`) all call `drawSignPanel` into a canvas of their
// own, so what the player composes in the editor is the board they build, pixel
// for pixel.
//
// Everything below is expressed in metres on the panel and converted through
// `PX_PER_METRE`, so the conversion is the same on a 1024-pixel texture and on a
// 400-pixel preview. The board's own size is an **input**, not a constant: a sign
// grows and shrinks with its content (`signPanelSize`), and the drawing simply
// fills whatever canvas it is handed — the caller sizes that canvas to the panel
// and to the plate resolution.
//
// The pictograms are vector art in the style of the reference photographs: pale
// marks on a near-black lit board, with the exit plate as the one coloured
// element (a green 出/EXIT tile, exactly the plate on the station wall).

import {
  PANEL_INSET,
  PX_PER_METRE,
  SIGN_LINE_FALLBACK_COLOUR,
  SIGN_SIZE,
  clampSignScale,
  estimateSignTextWidth,
  signContentBox,
  signLineEnglish,
  signPieces,
  signTextLineScale,
  signTextLines,
  type SignComponent,
  type SignFace,
  type SignIcon,
  type SignMeasure,
  type SignPanelSize,
  type SignPiece,
} from '../sim/sign.ts'
import type { LineDef } from '../sim/types.ts'

/** Narrow face; without it the Chinese labels fall back to a serif. */
const CJK = '"Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'
/** The Latin gloss on a line shield, which reads better in a condensed sans. */
const LATIN = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif'

/** Pale marks, exactly the reference board's ink. */
const INK = '#f4f7fa'
/** The unlit ground of the board. */
const BOARD = '#0d1116'
/** The panel's steel frame. */
const FRAME = '#3c434c'
/** The exit plate's green, matching the 出/EXIT tile on the wall. */
const EXIT_GREEN = '#1f9c5e'

/**
 * A board's pictograms: one decoded image per mark, ready for `drawImage`.
 *
 * The marks are bitmap art, and this file owns the *registry* rather than the
 * loading: `pictograms.ts` fetches and decodes the assets (it needs Vite and the
 * DOM) and hands them here with `setPictograms`, so this drawing code stays pure
 * enough to run in Node — which is what lets the sign tests paint a board and read
 * what it printed. A mark with no art prints nothing rather than a guess.
 */
export type SignIconArt = ReadonlyMap<SignIcon, CanvasImageSource>

let iconArt: SignIconArt = new Map()

/** The pictograms the board draws. Empty until `pictograms.ts` has loaded them. */
export function pictograms(): SignIconArt {
  return iconArt
}

/** Adopt a freshly decoded set of pictograms. Called by `pictograms.ts`. */
export function setPictograms(art: SignIconArt): void {
  iconArt = art
}

/**
 * Everything a face needs that is not the layout itself: the station's lines (a
 * shield shows a line's own name and colour, §6.3), the board's own size, and the
 * resolution to draw at. A shield bound to a line that no longer exists prints the
 * neutral steel plate rather than a stale colour.
 */
export interface SignFaceContext {
  /** The station's lines, in document order. */
  lines: readonly LineDef[]
  /** The line a component with no explicit id points at. Defaults to the first. */
  defaultLineId?: string
  /**
   * The board's size in metres. Every call site knows it — the model reads the
   * module's layout, the editor its own draft — so it is stated rather than
   * inferred from the canvas, because a canvas is allowed to be any resolution
   * and the frame's thickness must not follow the pixels.
   */
  panel: SignPanelSize
  /**
   * Pixels per metre to draw at. Defaults to the plate's own resolution; the
   * editor passes its CSS pixels per metre so a small preview is not drawn at
   * 512 px/m and scaled down.
   */
  ppm?: number
  /**
   * Whether to draw the steel frame around the printed area. On by default — it is
   * the border of the real panel, and the model's plate wears it.
   *
   * The editor's tiles turn it **off**: a tile is a patch of the board's own lit
   * face rather than the whole panel, so the frame it drew was a picture of the
   * sign's edge repeated once per mark, and the boxes round it were the editor's
   * furniture showing through between them. Without it a tile is the board's black
   * ground edge to edge, which is what lets a row of tiles read as one plate.
   */
  frame?: boolean
}

/** The line a shield prints: the bound one, else the station's first. */
function resolveLine(comp: Extract<SignComponent, { kind: 'line' }>, ctx: SignFaceContext): LineDef | undefined {
  const id = comp.lineId === '' ? (ctx.defaultLineId ?? '') : comp.lineId
  if (id === '') return ctx.lines[0]
  return ctx.lines.find((l) => l.id === id) ?? ctx.lines[0]
}

/**
 * The face's own `measureText`, wrapped so `sim/sign.ts` sizes a label the way
 * this canvas will actually set it. A canvas that cannot measure — a stub, or a
 * font that has not loaded — reports nothing, and the estimate stands in rather
 * than collapsing every label to zero width.
 */
function signMeasure(g: CanvasRenderingContext2D, family: string, ppm: number): SignMeasure {
  return (text: string, size: number): number => {
    if (typeof g.measureText !== 'function') return estimateSignTextWidth(text, size)
    g.font = `bold ${Math.max(4, size * ppm)}px ${family}`
    const w = g.measureText(text).width
    return w > 0.01 ? w / ppm : estimateSignTextWidth(text, size)
  }
}

/* ------------------------------------------------------------- primitives */

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
}

/** A path through `pts`, closed unless asked otherwise. Stroke or fill at the call site. */
function poly(g: CanvasRenderingContext2D, pts: ReadonlyArray<readonly [number, number]>, close = true): void {
  g.beginPath()
  pts.forEach((p, i) => (i === 0 ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1])))
  if (close) g.closePath()
}

function fitFont(g: CanvasRenderingContext2D, text: string, max: number, size: number, weight: string, family: string): number {
  let s = size
  for (let i = 0; i < 60 && s > 6; i++) {
    g.font = `${weight} ${s}px ${family}`
    if (g.measureText(text).width <= max) return s
    s -= 1
  }
  return s
}

/* ------------------------------------------------------------- pictograms */

/**
 * The green 出 / EXIT plate that stands in for the 出口 pictogram: the one mark
 * that is not bitmap art, because it is not a pictogram at all but a printed
 * plate — the 出 and EXIT every station's exit wears, in the station's own type
 * and the one green the board carries.
 */
function drawExitPlate(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = Math.min(w, h) * 0.1
  g.fillStyle = EXIT_GREEN
  roundRect(g, x, y, w, h, r)
  g.fill()
  g.fillStyle = INK
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `bold ${h * 0.46}px ${CJK}`
  g.fillText('出', x + w / 2, y + h * 0.34)
  g.font = `bold ${h * 0.2}px ${LATIN}`
  g.fillText('EXIT', x + w / 2, y + h * 0.76)
}

/**
 * One pictogram in the box `(x, y, w, h)`: bitmap art, printed as it is.
 *
 * Every mark but 出口 is a square asset, drawn into the mark's own square and
 * nothing else — a pictogram is a picture, so the board neither recolours it nor
 * draws a caption beside it. The art is white ink on a transparent ground, which is
 * why it composites straight onto the board's own near-black plate.
 *
 * A mark whose art this build does not have is left off the board rather than
 * invented: `pictograms.ts` reports the gap, and a plate missing one mark still
 * reads, where a plate carrying a guess would not.
 */
function drawIcon(g: CanvasRenderingContext2D, icon: SignIcon, x: number, y: number, w: number, h: number): void {
  const s = Math.max(1, Math.min(w, h))
  const ox = x + (w - s) / 2
  const oy = y + (h - s) / 2
  if (icon === 'exit') {
    drawExitPlate(g, ox, oy, s, s)
    return
  }
  const art = iconArt.get(icon)
  if (art) g.drawImage(art, ox, oy, s, s)
}

/* ------------------------------------------------------------- components */

/** A component's box on the plate, in pixels, with y growing downward. */
interface PaintBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * An arrow pointing one of the **eight ways**, or one of the **two U-turns**.
 *
 * The eight are drawn once pointing right and turned about the box's centre — the same path for
 * all eight, so no diagonal can drift out of shape. The two U-turns are not in that family and
 * are not a rotation of it: a turn back is a shape of its own — a shaft up one side, a bend
 * over the top, and a head coming down the other — so they are drawn in *their own* frame, with
 * the direction passed in as the sign of the mirror (`f`). One path therefore serves both, and
 * neither can disagree with the other about how wide the bend is.
 *
 * Drawn with the two vertical runs and a semicircular bend, which is what a U-turn arrow is on
 * every wayfinding sign there is; a squared-off bend reads as a pipe, not a turn.
 */
function drawArrow(g: CanvasRenderingContext2D, dir: string, box: PaintBox): void {
  const angles: Record<string, number> = {
    right: 0,
    down: Math.PI / 2,
    left: Math.PI,
    up: -Math.PI / 2,
    'down-right': Math.PI / 4,
    'down-left': (3 * Math.PI) / 4,
    'up-left': (-3 * Math.PI) / 4,
    'up-right': -Math.PI / 4,
  }
  const { x, y, w, h } = box
  // A U-turn: `f` mirrors it, so `uturn-right` bends the head back down on the right.
  const f = dir === 'uturn-right' ? 1 : dir === 'uturn-left' ? -1 : 0
  if (f !== 0) {
    drawUturnArrow(g, box, f)
    return
  }
  g.save()
  g.translate(x + w / 2, y + h / 2)
  g.rotate(angles[dir] ?? 0)
  // Local frame: a `w`-long, `h`-tall right-pointing arrow, centred on 0,0.
  const hw = w / 2
  const hh = h / 2
  const shaft = h * 0.3
  const headStart = hw - h * 0.5
  g.fillStyle = INK
  poly(g, [
    [-hw, -shaft / 2],
    [headStart, -shaft / 2],
    [headStart, -hh],
    [hw, 0],
    [headStart, hh],
    [headStart, shaft / 2],
    [-hw, shaft / 2],
  ])
  g.fill()
  g.restore()
}

/**
 * The **turn back**, drawn as the plate's own geometry: a shaft rising on the left, a bend over
 * the top, and a head coming back down on the right. `f = -1` mirrors the whole drawing about
 * the box's centre rather than restating it, so the two hands cannot drift apart.
 *
 * **One centre line, stroked once.** The whole mark is a single path — up the tail, round the
 * bend, down the head — and the *line* is what makes it: `lineWidth` is constant along it, so
 * every part of the drawing is the same width by construction. The first version of this drew
 * the shape as an **outline**: an outer arc at `r + stroke/2` and an inner arc at `r − stroke/2`,
 * filled between them. That is a valid way to draw a wide bend and a wrong way to draw a *line*:
 * where the bend is tight the inner radius collapses toward zero (at a 4 px stroke and a 10 px
 * bend it is 1.6 px), so the inner edge necks down and the U prints with a thin crescent in it.
 * No amount of tuning fixes that — it is the geometry of concentric arcs — and a stroked centre
 * line has the property for free. The head stays **filled**, because an arrowhead is wider than
 * the line it caps.
 *
 * The proportions are the sign's own U-turn, read off the glyph every wayfinding system draws
 * (Material's `u_turn_right`: `M6 9v12h2V9c0-2.21 1.79-4 4-4s4 1.79 4 4v4.17…`): a stroke an
 * eighth of the mark's height, runs whose centres stand a bend-radius apart, a bend whose radius
 * is the run's own, and a head a little wider than the stroke whose base sits a head-length
 * above the foot. The two ends are therefore **not level** — the tail runs on to the foot, the
 * head stops short of it — which is the asymmetry that reads as a turn rather than a horseshoe.
 */
function drawUturnArrow(g: CanvasRenderingContext2D, box: PaintBox, f: number): void {
  const { x, y, w, h } = box
  // The line's own width, and the bend's radius — the run's centre line, which is what both the
  // bend and the gap between the runs are measured on. The width is a **fifth of the mark**,
  // which is what puts it in the same family as the eight directions: a straight arrow's shaft is
  // 0.3 of its own height, so a hairline U beside them reads as a different kind of object.
  // The radius is what is left for the channel, and it is deliberately not much more than the
  // line: a U-turn's arms stand close together.
  const line = h * 0.2
  const r = Math.min(w * 0.28, h * 0.22)
  // The bend's centre: its top edge is the mark's top, the arc is a true semicircle, and its
  // springing points are where the two straight runs begin.
  const cx = x + w / 2
  const bendCy = y + line / 2 + r
  // The foot the tail runs to, and the head's base a head-length above it.
  const foot = y + h * 0.96
  const headL = line * 1.7
  const headW = line * 2.6
  const headTop = foot - headL
  // The runs: the tail on the left, the head on the right, one bend radius from the centre.
  const tailX = cx - r
  const headX = cx + r

  g.save()
  // One hand is the other, mirrored: the drawing below is always the right-hand turn.
  g.translate(cx, y + h / 2)
  g.scale(f, 1)
  g.translate(-cx, -(y + h / 2))
  g.strokeStyle = INK
  g.fillStyle = INK
  g.lineWidth = line
  g.lineCap = 'butt'
  g.lineJoin = 'round'
  // The run and the bend, in one path: `anticlockwise = false` runs π → 3π/2 → 2π, and `3π/2`
  // is the top of the circle on screen (y grows downward). Every point of this line is one
  // `lineWidth` wide — the bend included, which is the whole point.
  g.beginPath()
  g.moveTo(tailX, foot)
  g.lineTo(tailX, bendCy)
  g.arc(cx, bendCy, r, Math.PI, 0, false)
  g.lineTo(headX, headTop)
  g.stroke()
  // The head: a triangle on the same centre line, its base flush with the stroke's edges and its
  // point on the foot, so the arrow is the same width as the line that carries it.
  g.beginPath()
  g.moveTo(headX - headW / 2, headTop)
  g.lineTo(headX + headW / 2, headTop)
  g.lineTo(headX, foot)
  g.closePath()
  g.fill()
  g.restore()
}

/**
 * A line shield: the line's own colour, printing the line's name **exactly as
 * 线路 spells it** — `5号线` stays `5号线`, and an `APM线` stays `APM线`. Nothing is
 * derived, renumbered or re-stacked from it: the shield is the same name the
 * inspector shows, and `english` is the only addition (the compact gloss under
 * it). All of it comes from the station document, so renaming or recolouring a
 * line reprints every board that carries it (§6.3).
 */
function drawLineBadge(
  g: CanvasRenderingContext2D,
  ctx: SignFaceContext,
  comp: Extract<SignComponent, { kind: 'line' }>,
  box: PaintBox,
): void {
  const { x, y, w, h } = box
  const line = resolveLine(comp, ctx)
  g.fillStyle = line?.colour ?? SIGN_LINE_FALLBACK_COLOUR
  roundRect(g, x, y, w, h, Math.min(w, h) * 0.14)
  g.fill()

  const name = line?.name ?? '未配线路'
  const en = comp.english ? signLineEnglish(name) : ''

  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'top'

  // One row for the name, two when the gloss is under it. The name is never split
  // or shortened beyond what fits the shield.
  if (en === '') {
    const size = fitFont(g, name, w * 0.88, h * 0.6, 'bold', CJK)
    g.font = `bold ${size}px ${CJK}`
    g.fillText(name, x + w / 2, y + (h - size) / 2)
    return
  }
  const size = fitFont(g, name, w * 0.9, h * 0.52, 'bold', CJK)
  g.font = `bold ${size}px ${CJK}`
  g.fillText(name, x + w / 2, y + h * 0.09)
  const enSize = fitFont(g, en, w * 0.9, h * 0.26, '600', LATIN)
  g.font = `600 ${enSize}px ${LATIN}`
  g.fillText(en, x + w / 2, y + h - enSize - h * 0.08)
}

/**
 * A typed label: 中文 up to `SIGN_TEXT_MAX`, its English gloss up to
 * `SIGN_TEXT_EN_MAX` (§5.8 sizes the hanging sign 2 × 8; the gloss runs longer
 * because it sets smaller). The first line is the name (中文, large) and the
 * second the gloss under it (English, small) —
 * `SIGN_TEXT_EN_SCALE` is the one ratio the board, the tile preview and the
 * measurement all use, and it is read through `signTextLineScale`, which decides it
 * **per row from the row's own text**: a gloss is the line that prints small, and an
 * English-only label is a gloss too. Asking the same function the model measured with
 * is what keeps the printed ink inside the box the row was packed into — the two used
 * to disagree, and a row that measured one size while it printed another overran the
 * board it was laid out on.
 *
 * A label wider than the board is shrunk to the board rather
 * than clipped by it, and a label longer than its line limit is **truncated** by
 * `signTextLines` before it ever reaches here — the editor's `maxLength` enforces
 * the same limit, so only an imported save can carry an over-long row at all.
 *
 * `sizeM` is the **whole stack's** ink height, which is what `signInkSize` reports
 * for a label (one row's `signTextSize` × 1.15 per row). One row's own pitch is that
 * divided by the rows it holds, and one row's type is that pitch over the same 1.15:
 * a label set from the stack height would print `lines × ` too large, and a row pitch
 * left in metres inside a pixel box would stack the rows on the same baseline.
 */
function drawText(g: CanvasRenderingContext2D, comp: Extract<SignComponent, { kind: 'text' }>, box: PaintBox, sizeM: number, panelW: number, ppm: number): void {
  const lines = signTextLines(comp.text)
  if (lines.length === 0) return
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  // One row's band, in metres and then in pixels — the box is exactly `lines` of them.
  const rowM = sizeM / lines.length
  const size = rowM / 1.15
  const rowH = rowM * ppm
  for (const [i, line] of lines.entries()) {
    let font = size * signTextLineScale(i, line) * ppm
    g.font = `bold ${font}px ${CJK}`
    // The board, not the box: a label that outgrows its own piece shrinks until it
    // fits the panel it is printed on. This is the **drawn** width against the board
    // itself, so it is also the guard for the one thing the layout cannot see — the
    // font the browser really resolved. The model measured the row through
    // `measureText` too (`signMeasure`), so the two agree; where a font's advances come
    // out wider than the layout was told, the label shrinks rather than running off the
    // edge of the plate it is printed on.
    while (g.measureText(line).width > panelW * ppm && font > 6) {
      font -= 1
      g.font = `bold ${font}px ${CJK}`
    }
    // The row's own band, and inside it the line sits on its baseline: a smaller
    // gloss keeps the row's pitch and takes the empty space at its foot.
    const top = box.y + box.h - (lines.length - i) * rowH
    const baseY = top + font + (rowH - font) * 0.5
    let cursor = box.x
    // Nothing to dim past the limit: `signTextLines` (line 319) has already cut the
    // row to it, so every character left belongs on the board.
    g.fillStyle = INK
    for (const ch of line) {
      g.fillText(ch, cursor, baseY)
      cursor += g.measureText(ch).width
    }
  }
}

/**
 * A pictogram: the mark, and nothing else. An icon is a picture — it has no caption
 * to set and no wording to get wrong, which is what keeps a board's marks legible at
 * a glance and identical from one station to the next. A board that needs a word next
 * to a mark uses the 文字 block, which is a text component and prints both languages.
 */
function drawIconComponent(
  g: CanvasRenderingContext2D,
  comp: Extract<SignComponent, { kind: 'icon' }>,
  box: PaintBox,
  ppm: number,
): void {
  const markPx = SIGN_SIZE.icon.w * clampSignScale(comp.scale) * ppm
  // The box is the mark's own square (`signInkSize`), so the whole of it is drawn.
  drawIcon(g, comp.icon, box.x, box.y, Math.min(box.w, markPx), Math.min(box.h, markPx))
}

/**
 * Draw one measured piece. `declared` is the size `signPieceSize` reported, which
 * is what a text component needs to know to stack its lines.
 */
function drawPiece(
  g: CanvasRenderingContext2D,
  ctx: SignFaceContext,
  comp: SignComponent,
  box: PaintBox,
  declared: { w: number; h: number },
  panelW: number,
  ppm: number,
): void {
  switch (comp.kind) {
    case 'arrow':
      drawArrow(g, comp.arrow, box)
      break
    case 'line':
      drawLineBadge(g, ctx, comp, box)
      break
    case 'text':
      drawText(g, comp, box, declared.h, panelW, ppm)
      break
    case 'icon':
      drawIconComponent(g, comp, box, ppm)
      break
  }
}

/* ------------------------------------------------------------------ face */

/**
 * The span the **printed ink** of a laid-out row covers, in metres from the panel's
 * left: from the first mark's ink's left edge to the last one's ink's right edge.
 *
 * The ink is what the row *is* to the viewer. A piece's box carries
 * `SIGN_PIECE_PAD` on every side, so the padded row spans a little more — and the two
 * come apart exactly where it matters, because a board that has reached its ceiling is
 * packed to the frame on one side and given the slack on the other. Laying the boxes on
 * the panel then leaves the marks themselves leaning; the report is that board: six
 * arrows printed with the last one against the frame and a black band down the left,
 * while the editor's preview — a face on a panel of its own size — was centred.
 */
function inkSpan(pieces: readonly SignPiece[]): { left: number; right: number } {
  return {
    left: Math.min(...pieces.map((p) => p.x - p.inkW / 2)),
    right: Math.max(...pieces.map((p) => p.x + p.inkW / 2)),
  }
}

/**
 * Draw one face of a board into `g`.
 *
 * The canvas must already be sized to `ctx.panel` at `ctx.ppm` pixels per metre
 * (the model's texture is `signPlate(panel)`, the editor's its own CSS box); the
 * drawing fills it and reads nothing back from it, so a full-size texture and a
 * small preview are the same picture. The board's *shape* therefore comes from
 * `ctx.panel`, never from the canvas: a canvas that disagrees with the panel
 * squashes the board rather than silently resizing it.
 *
 * `face` selects the components that print on that side, which is what makes a
 * one-way board one-way: a component bound to the left face is simply absent from
 * the right. Pass `'both'` for a canvas that stands in for the whole board (a
 * palette thumbnail, or a test).
 *
 * The face is **centred** on the panel it is handed, and it is the **ink** that is
 * centred — the marks a viewer sees, not the padded boxes they are packed in. The two
 * faces of a sign share one piece of steel (`signBoardsPanel` is the wider of the two),
 * so a face that is shorter than its partner has slack to spare; laid down as packed,
 * all of it landed on the face's right, and since each plate is turned to face its own
 * passenger the back face's slack came out as a wide black band down the *left* of the
 * board when read from that side. A face is a document of its own, so it is laid on the
 * panel the way a document is laid on a page: centred, with its own end margins equal,
 * whatever the row's own length is.
 */
export function drawSignPanel(
  g: CanvasRenderingContext2D,
  layout: readonly SignComponent[],
  ctx: SignFaceContext,
  face: SignFace = 'both',
): void {
  const canvas = g.canvas as HTMLCanvasElement | undefined
  const ppm = ctx.ppm ?? PX_PER_METRE
  const W = canvas?.width ?? Math.round(ctx.panel.w * ppm)
  const H = canvas?.height ?? Math.round(ctx.panel.h * ppm)
  const { w: contentW, h: contentH } = signContentBox(ctx.panel)
  // The printed area's top-left corner on the canvas. The frame is the panel's
  // own inset all round, so a taller board has a proportionally thicker border.
  const padX = W * (PANEL_INSET / (1 - PANEL_INSET * 2))
  const padY = H * (PANEL_INSET / (1 - PANEL_INSET * 2))
  const frame = Math.max(3, Math.min(padX, padY))

  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, W, H)
  g.fillStyle = BOARD
  g.fillRect(0, 0, W, H)
  // The border is the panel's, not the board's: a caller drawing a **patch** of the
  // board rather than the whole panel (the editor's tiles) asks for the ground alone,
  // because a frame per patch would draw the sign's edge once per mark.
  if (ctx.frame !== false) {
    g.strokeStyle = FRAME
    g.lineWidth = Math.max(1, frame * 0.5)
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth)
  }

  const measure = signMeasure(g, CJK, ppm)
  // `signPieces` has already clamped every piece onto the printed area, so the
  // boxes drawn here are the ones the editor hit-tests — one geometry, two users.
  // Each box carries a `SIGN_PIECE_PAD` margin on every side; the **ink** is drawn
  // inside it, which is what keeps two marks on a board from touching.
  const pieces = signPieces(layout, ctx.panel, face, measure)
  // Where in canvas pixels this face's own row starts, so that its printed ink comes out
  // centred between the panel's two frame margins.
  //
  // A box is placed at `offX + x * ppm - ink/2`, so the leading mark's ink lands at
  // `ink.left * ppm + offX`. Setting that equal to the printed area's own left edge plus
  // the margin the ink leaves there — the margin being half of what the printed area has
  // left over, `((W - 2 * padX) - inkWidth * ppm) / 2` — gives
  //
  //     offX = padX + (W - 2 * padX - inkWidth * ppm) / 2 - ink.left * ppm
  //
  // The `padX` is the term the first cut of this missed. It shifted the row by
  // `(panel.w / 2 - centre) * ppm` alone, which is the row's move measured between two
  // **panel** positions while the box is placed from the **canvas** edge — so the leading
  // margin was spent twice and the whole row printed a margin's width to the right. A
  // board packed to its ceiling came out with its last mark against the frame and a black
  // band down its left — the report, "shifted right and not centring" — and it is also why
  // the 3D board disagreed with the editor's preview, which draws a face on a panel of its
  // own size and so showed it centred.
  //
  // The panel the caller passes is the **pair's** (`signBoardsPanel`, the wider of the two
  // faces), so a face carrying less than its partner has slack to spare and this is what
  // hands that slack to both ends evenly; a face that already fills the panel is centred
  // by the same statement rather than by a special case.
  const ink = pieces.length === 0 ? null : inkSpan(pieces)
  const offX = ink === null ? 0 : padX + (W - 2 * padX - (ink.right - ink.left) * ppm) / 2 - ink.left * ppm
  const byId = new Map(layout.map((c) => [c.id, c]))
  for (const piece of pieces) {
    const comp = byId.get(piece.id)
    if (!comp) continue
    const inkW = piece.inkW * ppm
    const inkH = piece.inkH * ppm
    const box: PaintBox = {
      x: offX + piece.x * ppm - inkW / 2,
      // The panel's origin is its bottom-left; the canvas grows downward, so the
      // printed area's *bottom* edge is where the panel's y = 0 sits.
      y: padY + (contentH - piece.y) * ppm - inkH / 2,
      w: inkW,
      h: inkH,
    }
    // The drawn scale is the piece's own, not the component's: a hand-written
    // layout may carry a scale the panel will not honour.
    drawPiece(g, ctx, { ...comp, scale: piece.scale } as SignComponent, box, { w: piece.inkW, h: piece.inkH }, contentW, ppm)
  }
}

export type { SignPiece }
