// What a 指示牌 actually prints (`render/signFace.ts`).
//
// The board is the one place a player sees their own composition, and its failure
// mode is silent: a plate with nothing on it renders exactly like the lightbox it is
// mounted on — a black rectangle in the station — with no error anywhere. So these
// tests drive the real drawing code through a recording 2D context and assert that a
// board carries ink: fills, strokes and the words on its shields and labels.
//
// They also pin the two sizes that have to agree for a sign to look right at all: the
// **panel** the geometry is stated in (`signPanelSize`) and the **plate** it is
// rasterised to (`signPlate`), which the model cuts its mesh to.
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawSignPanel, setPictograms } from '../src/render/signFace.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { trackingCanvas } from './support/tracking-canvas.mjs'
import { pictogramArt, pictogramNames, readPictogram } from './support/pictograms.mjs'
import { createModule, toState } from '../src/build/model.ts'
import { settleSignBins, settleSignBoards, defaultSignLayout, isUturnArrow, signIconIsDrawn, signInkSize, SIGN_BACK_MARK, signBoardsPanel, signPanelSize, signPieces, signPlate, PX_PER_METRE, SIGN_ICONS, SIGN_SIZE, SIGN_TEXT_EN_SCALE } from '../src/sim/sign.ts'

// The marks a board prints are the shipped PNG assets, decoded off disk. A board
// drawn without them prints no pictogram at all — which is exactly what this file
// is here to catch — so the art is installed once, the way `pictograms.ts` does it
// in the browser.
setPictograms(pictogramArt())

const LINE = {
  id: '5',
  name: '5号线',
  colour: '#a6224a',
  stock: 'B',
  cars: 6,
  power: 'third-rail',
  headwayProfile: { peak: 150, offpeak: 240, late: 480 },
  alightPerTrain: 420,
  terminus: 'through',
  direction: 'up',
  upTerminus: '',
  downTerminus: '',
  travelSign: 1,
  stations: [],
}

/** Draw one board at the resolution the model's own texture uses. */
function paint(layout, lines = [LINE], face = 'left') {
  const panel = signPanelSize(layout)
  const plate = signPlate(panel)
  const { g, ops } = stubCanvas(plate.width, plate.height)
  drawSignPanel(g, layout, { lines, panel }, face)
  return { ops, panel, plate }
}

test('a fresh sign prints marks, not a black panel', () => {
  const mod = createModule('sign', 2, 3, 0, 'sign-1', 0, undefined, 'up', 'right', [LINE])
  assert.equal(mod.type, 'sign')
  const layout = mod.cfg.front
  assert.ok(layout.length > 0, 'a fresh sign carries a board')
  // A fresh sign is **one-sided**: the front is composed for it and the back is not, so
  // there is no second board to print rather than a second copy of the first.
  assert.deepEqual(mod.cfg.back, [], 'and an empty back')

  for (const face of ['left', 'right']) {
    const { ops, panel, plate } = paint(layout, [LINE], face)
    // The plate matches the panel it states, at the one conversion.
    assert.ok(Math.abs(plate.width / panel.w - PX_PER_METRE) < 1, `${plate.width} for ${panel.w} m`)
    assert.ok(Math.abs(plate.height / panel.h - PX_PER_METRE) < 1)
    // The ground, the frame, and then the marks: a face that printed only its ground
    // would leave the lightbox black, which is exactly how a broken board looks.
    assert.ok(ops.filled.includes('#0d1116'), `${face}: the board ground is missing`)
    assert.ok(ops.stroked.includes('#3c434c'), `${face}: the frame is missing`)
    assert.ok(ops.filled.includes('#f4f7fa'), `${face}: no ink — the board is black`)
  }

  // The default board is an arrow, the station's own shield, the 出口 plate and an
  // arrow — so the shield's name and the plate's 出/EXIT are printed words.
  const { ops } = paint(layout, [LINE], 'left')
  assert.ok(ops.texts.includes('5号线'), `the shield prints its line: ${JSON.stringify(ops.texts)}`)
  assert.ok(ops.texts.includes('出'), 'the exit plate prints 出')
  assert.ok(ops.texts.includes('EXIT'), 'the exit plate prints EXIT')
})

test('a face shorter than its partner is centred on the steel, not packed to one end', () => {  // The two faces of a sign share **one piece of steel**: `signBoardsPanel` is the wider
  // of the two, so a face that carries less than its partner has slack to spare. Packed
  // from the printed area's left edge, all of that slack landed on the face's right — and
  // because each plate is turned to face its own passenger, the back face's slack came out
  // as a wide black band down the *left* of the board when read from that side. That is
  // the report: the editor's preview draws a face on its **own** panel (no slack, nothing
  // to centre) while the model draws it on the shared one, so the two disagreed and the 3D
  // board read as shoved along the steel.
  //
  // The drawing centres a face by shifting the whole row so its own midpoint sits on the
  // panel's midpoint (`render/signFace.ts`). This is that shift read back: come in from
  // each end of the printed area and the two gaps match.
  const long = [
    { id: 'l1', kind: 'arrow', arrow: 'left', x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'l2', kind: 'text', text: '滘口方向\nTowards Jiaokou', x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'l3', kind: 'line', lineId: '5', english: true, x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'l4', kind: 'text', text: '文冲方向\nTowards Wenchong', x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'l5', kind: 'arrow', arrow: 'down', x: 0, y: 0.35, scale: 1, side: 'both' },
  ]
  const short = [
    { id: 's1', kind: 'icon', icon: 'lift', x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 's2', kind: 'text', text: '电梯', x: 0, y: 0.35, scale: 1, side: 'both' },
  ]
  const boards = settleSignBoards({ front: long, back: short })
  const panel = signBoardsPanel(boards)
  // The pair really does differ, or this test would be asking nothing.
  assert.ok(signPanelSize(boards.front).w > signPanelSize(boards.back).w + 0.4, 'the front face is the longer one')

  /** The two end gaps a face leaves when it is centred on the shared panel. */
  const ends = (layout, face) => {
    const pieces = signPieces(layout, panel, face)
    assert.ok(pieces.length > 0, `${face}: no pieces`)
    const left = Math.min(...pieces.map((p) => p.left))
    const right = Math.max(...pieces.map((p) => p.left + p.w))
    // The drawing's own shift: the row's midpoint on to the panel's.
    const off = panel.w / 2 - (Math.min(...pieces.map((p) => p.x - p.w / 2)) + Math.max(...pieces.map((p) => p.x + p.w / 2))) / 2
    return { left: left + off, right: panel.w - right - off, off }
  }

  for (const [name, layout, face] of [['front', boards.front, 'left'], ['back', boards.back, 'right']]) {
    const e = ends(layout, face)
    // The two black ends match, which is the whole of "centred": there is no side of the
    // board that this face's ink leans towards. (A face left as packed leaves its right
    // end out by the whole slack — 0.6 m on the back face of this pair — which is orders
    // of magnitude outside this tolerance.)
    assert.ok(Math.abs(e.left - e.right) < 0.02, `${name} face is centred: ends ${e.left.toFixed(3)} / ${e.right.toFixed(3)} m`)
    assert.ok(e.left > 0.05, `${name} face keeps its end margin: ${e.left.toFixed(3)} m`)
    // A face that **fills** the panel is already sitting on it: the shift is nothing
    // beyond the panel's own 5 cm size step, so this cannot move what the player
    // composed on the editor's preview (which draws a face on its own panel).
    if (signPanelSize(layout).w >= panel.w - 1e-9) {
      assert.ok(Math.abs(e.off) < 0.03, `${name} fills the panel: shift within the size step (${e.off.toFixed(4)})`)
    } else {
      assert.ok(e.off > 0.05, `${name} carries less than the steel: it is shifted (${e.off.toFixed(4)})`)
    }
  }

  // The one-sided sign of the report: the back face is packed at the page's left edge and
  // carries a metre of dead steel. The front face here fills the panel exactly.
  const front = signPanelSize(boards.front).w
  assert.ok(Math.abs(front - panel.w) < 1e-9, `the longer face defines the panel: ${front} vs ${panel.w}`)
  const back = ends(boards.back, 'right')
  assert.ok(back.off > 0.5, `the shorter face is shifted by the slack: ${back.off.toFixed(3)} m`)
  assert.ok(Math.abs(back.left - back.right) < 0.02, `and lands centred: ${back.left.toFixed(3)} / ${back.right.toFixed(3)} m`)
  assert.ok(!(Math.abs(back.left - 0.19) < 0.02 && back.right > 1.5), 'not left as packed (which left 1.6 m of steel bare)')
})

test('the printed ink of a full board is centred, end pads and all', () => {
  // The report: a board packed right up to the panel's ceiling — the test case is six
  // arrows, three pointing each way — printed **shifted right**, with the last mark
  // jammed against the frame and a black band down the left of the board. The editor's
  // preview was centred, so the 3D board was the one that disagreed.
  //
  // The centring is a property of the **pixels**, not of the layout numbers, so it is
  // asked of the drawing itself: paint the board and measure the box the ink covers.
  // Reading `signPieces` instead would have missed this — the pieces' own boxes were
  // centred while the mark inside each box was not, so the geometry "agreed" while the
  // board printed off to one side.
  const arrows = ['left', 'left', 'left', 'right', 'right', 'right'].map((arrow, i) => ({
    id: `c${i + 1}`,
    kind: 'arrow',
    arrow,
    x: (i + 0.5) * 0.33,
    y: 0.35,
    scale: 1,
    side: 'both',
  }))
  const boards = settleSignBoards({ front: arrows, back: [] })
  const panel = signBoardsPanel(boards)
  const plate = signPlate(panel)

  for (const face of ['left', 'right']) {
    const { g, inkSpan } = trackingCanvas(plate.width, plate.height)
    drawSignPanel(g, boards.front, { lines: [LINE], panel }, face)
    const span = inkSpan()
    assert.ok(span, `${face}: no ink printed`)
    // The plate is the panel at `PX_PER_METRE`, so a pixel is a metre/512.
    const leftGap = span.left / PX_PER_METRE
    const rightGap = panel.w - span.right / PX_PER_METRE
    // The two black ends of the board match: within a centimetre, which is a whole
    // margin's worth of daylight on a board that was out by a third of a pad.
    assert.ok(
      Math.abs(leftGap - rightGap) < 0.01,
      `${face}: ink centred — left ${leftGap.toFixed(4)} m vs right ${rightGap.toFixed(4)} m`,
    )
    assert.ok(leftGap > 0.04, `${face}: the leading end keeps its margin (${leftGap.toFixed(4)} m)`)
  }
})

test('the two faces are two boards: each prints only its own', () => {
  // The 3D render mounts one plate per composed face and hands each its **own** board.
  // This is that pair drawn: the front is an exit sign, the back says where the lift is,
  // and neither prints a word of the other. Anything else — a back that is a copy of the
  // front, or a face that prints both lists — is the bug the split exists to prevent.
  const front = [
    { id: 'f1', kind: 'arrow', arrow: 'right', x: 0.4, y: 0.35, scale: 1, side: 'both' },
    { id: 'f2', kind: 'icon', icon: 'exit', x: 1.1, y: 0.35, scale: 1, side: 'both' },
  ]
  const back = [
    { id: 'b1', kind: 'icon', icon: 'lift', x: 0.4, y: 0.35, scale: 1, side: 'both' },
    { id: 'b2', kind: 'text', text: '电梯\nLift', x: 1.1, y: 0.35, scale: 1, side: 'both' },
  ]
  const boards = settleSignBoards({ front, back })
  // The pair shares one panel, and each face is drawn on it — so the two plates are the
  // same size and neither is cut short.
  const panel = signBoardsPanel(boards)
  const a = paint(boards.front, [LINE], 'left')
  const b = paint(boards.back, [LINE], 'right')
  assert.equal(a.panel.w, panel.w)
  assert.equal(b.panel.w, panel.w)
  assert.equal(signPlate(panel).width, signPlate(a.panel).width)

  assert.ok(a.ops.texts.includes('出'), 'the front prints the 出口 plate')
  assert.ok(!a.ops.texts.includes('电'), 'and none of the back’s label')
  assert.ok(a.ops.filled.includes('#1f9c5e'), 'the front prints the exit green')
  assert.ok(!b.ops.filled.includes('#1f9c5e'), 'the back does not')
  assert.ok(b.ops.texts.includes('电'), `the back prints its own label: ${JSON.stringify(b.ops.texts)}`)
  // The lift is a **picture**, so the back proves itself by drawing one.
  assert.equal(b.ops.drawn.length, 1, 'the back draws its own pictogram')
  assert.deepEqual(a.ops.drawn, [], 'and the front draws none')
})

test('the empty face’s stand-in place prints nothing', () => {
  // An empty 背面 still shows one dashed well so the first mark has somewhere to go, and
  // the editor lays its bins over `SIGN_BACK_MARK` to get it. That stand-in is a **place**,
  // not a mark: if it printed anything the empty face would carry a phantom mark the model
  // does not know about, and it is what the tile beside it would be a picture of. An empty
  // label measures zero (asserted in `sign.test.mjs`), so the board draws its ground and
  // stops — no ink, no words, no pictures.
  const { ops } = paint([SIGN_BACK_MARK], [LINE], 'back')
  assert.deepEqual(ops.texts, [], 'the stand-in prints no words')
  assert.deepEqual(ops.drawn, [], 'and no pictures')
  assert.deepEqual(ops.filled, ['#0d1116'], `and nothing but the board’s own ground: ${JSON.stringify(ops.filled)}`)
  assert.deepEqual(ops.stroked, ['#3c434c'], 'with the panel’s frame, which is the plate’s own border')
})

test('a board with nothing on it is the only one that prints nothing', () => {
  // A face with no board is left as the model's own black panel rather than given a
  // blank lit plate (`render/models.ts`), so an empty layout must be recognised as empty
  // — that is what `signFaceHasInk` asks. The front is never empty in the document
  // (`signBoardsOf` fills it with the default), so an empty layout is drawn here
  // directly, as the one shape that really does print nothing.
  const empty = paint([], [LINE], 'left')
  assert.ok(empty.ops.fills > 0, 'the ground is still painted')
  assert.deepEqual(empty.ops.texts, [], 'and no words are printed')
  // Nothing but the ground: no mark was drawn on it, and the frame is a stroke.
  assert.deepEqual(empty.ops.filled, ['#0d1116'], `an empty board prints only its ground: ${JSON.stringify(empty.ops.filled)}`)
  assert.deepEqual(empty.ops.stroked, ['#3c434c'], 'and only its frame')

  // The default board a **missing** front is given instead does print, which is what
  // makes the fallback a fix rather than a different blank face.
  const fallback = paint(defaultSignLayout({ lines: [LINE] }), [LINE], 'left')
  assert.ok(fallback.ops.filled.includes('#1f9c5e'), 'the fallback board prints the 出口 plate')
  assert.ok(fallback.ops.texts.includes('5号线'), 'and the station’s shield')
})

test('the printed frame is the panel’s, and a patch of the board can ask for none', () => {
  // The frame is the **panel's** own steel border, so it belongs to a canvas that is the
  // whole panel — the model's plate, the palette thumbnail, a hover ghost. The editor's
  // tiles are one-metre patches of the lit face, and a patch that drew the border would
  // put the sign's edge round every mark, which is the outline and the seams the two
  // rows are meant not to have. So the flag exists, and this pins both halves of it.
  const layout = [
    { id: 'c1', kind: 'icon', icon: 'lift', x: 0.6, y: 0.35, scale: 1, side: 'both' },
  ]
  const panel = signPanelSize(layout)
  const draw = (ctx) => {
    const plate = signPlate(panel)
    const { g, ops } = stubCanvas(plate.width, plate.height)
    drawSignPanel(g, layout, { lines: [LINE], panel, ppm: PX_PER_METRE, ...ctx }, 'left')
    return ops
  }
  const framed = draw({})
  assert.ok(framed.stroked.includes('#3c434c'), `the panel's plate wears its frame: ${JSON.stringify(framed.stroked)}`)
  // Without it the ground and the mark are all that is left: no stroke anywhere, and the
  // board's own black still filled edge to edge, which is what makes a row of tiles one
  // continuous plate.
  const bare = draw({ frame: false })
  assert.deepEqual(bare.stroked, [], `a patch prints no border at all: ${JSON.stringify(bare.stroked)}`)
  assert.ok(bare.filled.includes('#0d1116'), 'and still fills its own ground')
  // A pictogram is a **picture**: it prints no pale fill of its own (the art is ink on a
  // transparent ground), so the mark's presence is the bitmap it drew.
  assert.equal(bare.drawn.length, 1, 'and still prints its mark')
  assert.deepEqual(bare.drawn.map((d) => d.icon), ['lift'])
  // The mark is the same mark: turning the frame off changes nothing but the border.
  assert.deepEqual(bare.texts, framed.texts)
  assert.deepEqual(bare.drawn.map((d) => d.icon), framed.drawn.map((d) => d.icon))
  // A mark that *is* ink — an arrow — proves the ink still lands without a frame.
  const arrows = [{ id: 'c1', kind: 'arrow', arrow: 'left', x: 0.6, y: 0.35, scale: 1, side: 'both' }]
  const arrowPanel = signPanelSize(arrows)
  const arrowPlate = signPlate(arrowPanel)
  const { g, ops } = stubCanvas(arrowPlate.width, arrowPlate.height)
  drawSignPanel(g, arrows, { lines: [LINE], panel: arrowPanel, ppm: PX_PER_METRE, frame: false }, 'left')
  assert.ok(ops.filled.includes('#f4f7fa'), `the arrow is still printed on the bare ground: ${JSON.stringify(ops.filled)}`)
  assert.deepEqual(ops.stroked, [])
})

test('every mark the palette offers prints on its own', () => {
  // The ink is `render/signFace.ts`'s own pale mark colour, and the ground the plate
  // starts as; the frame is *stroked*, so neither of these is a mark.
  const INK = '#f4f7fa'
  const BOARD = '#0d1116'
  // One board per kind, drawn alone: a component whose drawing is broken (or whose box
  // is zero-sized, so the renderer skips it) would be a mark the player cannot put on a
  // sign at all. The pictograms are the whole palette, so every one of them is asked —
  // a mark whose asset is missing prints nothing, and that is the failure this catches.
  const marks = [
    { id: 'c1', kind: 'arrow', arrow: 'up-left', x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'c2', kind: 'line', lineId: '5', english: true, x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'c3', kind: 'text', text: '出站\nExit', x: 0, y: 0.35, scale: 1, side: 'both' },
    ...SIGN_ICONS.map((icon, i) => ({ id: `i${i}`, kind: 'icon', icon, x: 0, y: 0.35, scale: 1, side: 'both' })),
  ]
  for (const mark of marks) {
    const layout = settleSignBins([mark]).layout
    const { ops } = paint(layout, [LINE], 'left')
    const what = `${mark.kind}/${mark.icon ?? mark.arrow ?? mark.text}`
    // A mark has printed when it painted **anything of its own** over the ground, set a
    // word, or — for every pictogram that is a picture rather than a plate — drew its
    // bitmap. Not every mark is pale ink: the 出口 plate is a green field with white
    // words on it and the 禁止 roundel is red, so "the board's ground and nothing else"
    // is the failure — a black rectangle hanging in the station.
    const printed = ops.filled.some((c) => c !== BOARD) || ops.texts.length > 0 || ops.images > 0
    assert.ok(printed, `${what}: nothing was drawn (fills ${JSON.stringify(ops.filled)}, no words, no pictures)`)
    // A **bitmap** mark is drawn as one square picture of its own asset, so the drawing
    // and the catalogue cannot disagree about which mark a component wears. The two
    // drawn marks — the 出/EXIT plate and the 禁止 roundel — are paths instead, and are
    // pinned by their own tests below.
    if (mark.kind === 'icon' && !signIconIsDrawn(mark.icon)) {
      assert.deepEqual(ops.drawn.map((d) => d.icon), [mark.icon], `${what}: the wrong picture was printed`)
      assert.equal(ops.drawn[0].w, ops.drawn[0].h, `${what}: a pictogram is drawn square`)
      assert.ok(Math.abs(ops.drawn[0].w - SIGN_SIZE.icon.w * PX_PER_METRE) < 0.5, `${what}: drawn at ${ops.drawn[0].w}px`)
    }
  }
  // A shield prints the station's own colour, so a line component is the one mark whose
  // ink is not the pale one.
  const shield = paint(settleSignBins([marks[1]]).layout, [LINE], 'left')
  assert.ok(shield.ops.filled.includes('#a6224a'), 'the shield wears its line colour')
  assert.ok(shield.ops.texts.includes('5号线'), 'and prints the line name')
  // An icon prints no words at all: it is a picture, and its caption was removed.
  const restroom = paint(settleSignBins([marks[5]]).layout, [LINE], 'left')
  assert.deepEqual(restroom.ops.texts, [], 'an icon carries no wording')
  // A two-language label prints both rows, in order.
  const both = paint(settleSignBins([marks[2]]).layout, [LINE], 'left')
  assert.deepEqual(both.ops.texts.join(''), '出站Exit')
})

/**
 * The 禁止 roundel, mark by mark. It is the one mark whose look is **geometry and a
 * colour** rather than a photograph — a red ring with a level strip across its
 * diameter — so the two things that can go wrong are invisible anywhere else: a strip
 * at an angle (a prohibit *sign* roundel, which is not the "stop" mark it is named
 * for) and a ring painted in the board's pale ink.
 */
test('the 禁止 roundel is a red ring with a level strip across its diameter', () => {
  const RED = '#e0242a'
  const layout = settleSignBins([{ id: 'c1', kind: 'icon', icon: 'stop', x: 0, y: 0.35, scale: 1, side: 'both' }]).layout
  const { ops } = paint(layout, [LINE], 'left')
  // Both parts of the mark are the one red — the ring and the strip alike — and none of
  // the board's pale ink is on it: a prohibition sign is red, or it is not one.
  assert.ok(ops.filled.includes(RED), `the strip is painted red (${JSON.stringify(ops.filled)})`)
  assert.ok(ops.stroked.includes(RED), `the ring is stroked red (${JSON.stringify(ops.stroked)})`)
  assert.ok(!ops.filled.includes('#f4f7fa'), 'and the mark carries no pale ink of its own')
  // It is **drawn**, not a picture: no bitmap is blitted and no caption is set.
  assert.equal(ops.images, 0, 'the roundel is not a bitmap')
  assert.deepEqual(ops.texts, [], 'and it carries no wording')
  // The ring is one full circle whose **outer** edge is the mark's own square, so the
  // roundel is the same weight on a board as a pictogram beside it.
  assert.equal(ops.arcs.length, 1, 'one ring')
  const arc = ops.arcs[0]
  assert.equal(arc.a0, 0)
  assert.ok(Math.abs(arc.a1 - Math.PI * 2) < 1e-9, 'drawn right round')
  const side = SIGN_SIZE.icon.w * PX_PER_METRE
  const line = side * 0.13
  assert.ok(Math.abs(arc.r - (side / 2 - line / 2)) < 0.5, `the ring's centre line is ${arc.r} px`)
  assert.ok(Math.abs(ops.strokeWidths[ops.strokeWidths.length - 1] - line) < 0.5, 'and its thickness is its own')
  // The strip is **not turned at all**: the mark is the icon's plain "stop" bar, level
  // across a round ring, and a mark that turned itself would need a `rotate` to do it.
  assert.deepEqual(ops.rotations, [], 'the mark is drawn upright, with no turn on it')
  // ...and the strip really is **level and across the diameter**, which is a question
  // about the geometry rather than about the calls: the same board painted through the
  // matrix-tracking context leaves the strip as a box `2r` wide and one line tall,
  // centred on the ring.
  const panel = signPanelSize(layout)
  const plate = signPlate(panel)
  const tracked = trackingCanvas(plate.width, plate.height)
  drawSignPanel(tracked.g, layout, { lines: [LINE], panel }, 'left')
  const strip = tracked.painted.find((p) => p.kind === 'fill' && p.colour === RED)
  assert.ok(strip, 'the strip is a filled red path')
  const xs = strip.points.map((p) => p[0])
  const ys = strip.points.map((p) => p[1])
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  assert.ok(Math.abs(width - 2 * arc.r) < 0.5, `the strip spans the diameter (${width.toFixed(1)} px vs ${(2 * arc.r).toFixed(1)})`)
  assert.ok(Math.abs(height - line) < 0.5, `and is one line of the ring thick (${height.toFixed(1)} px vs ${line.toFixed(1)})`)
  // Level, not leaning: its top and bottom edges are each half a line off the ring's
  // own centre, so the box is two rows of equal y rather than a slope.
  const rows = [...new Set(ys.map((y) => Math.round(y * 100) / 100))].sort((a, b) => a - b)
  assert.equal(rows.length, 2, `a level bar has two edges (got ${rows.length})`)
  assert.ok(Math.abs((rows[0] + rows[1]) / 2 - arc.cy) < 0.5, 'centred on the ring, not off to one side')
  assert.ok(Math.abs(rows[1] - rows[0] - line) < 0.5, 'the two edges are one line apart')
  assert.ok(width > height * 4, `the bar is wide and shallow (${width.toFixed(1)}×${height.toFixed(1)} px)`)
})

/**
 * The assets themselves, which nothing above can see: a board prints whatever
 * bitmap it is handed, so a mark that arrived with a grey ground, a soft edge or a
 * non-square frame would print just as happily. The contract
 * `tools/prep-sign-icons.py` promises is what these assert.
 */
test('every pictogram asset is square, pure white ink on a clear ground', () => {
  const names = pictogramNames()
  // The **drawn** marks have no asset by design — the renderer paints the 出/EXIT plate
  // and the 禁止 roundel — so the folder holds one file per remaining pictogram.
  const icons = SIGN_ICONS.filter((icon) => !signIconIsDrawn(icon))
  assert.deepEqual(names, [...icons].sort(), 'one asset per pictogram, and no others')
  for (const name of names) {
    const png = readPictogram(name)
    assert.equal(png.width, png.height, `${name}: not square`)
    assert.ok(png.width >= 128, `${name}: only ${png.width}px — too coarse for a 512-px plate`)
    let ink = 0
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const p = png.at(x, y)
        // Alpha is a decision, not a gradient: the mark is in or it is out.
        assert.ok(p.a === 0 || p.a === 255, `${name}: soft pixel at ${x},${y} (alpha ${p.a})`)
        if (p.a === 0) continue
        ink++
        // The ink is the board's pale mark, so no colour of its own may survive.
        assert.ok(p.r === 255 && p.g === 255 && p.b === 255, `${name}: grey ink at ${x},${y}`)
      }
    }
    const coverage = (ink / (png.width * png.height)) * 100
    // A mark that fills the square is a slab, and one that barely marks it is
    // invisible on a plate: both are ways for an asset to be wrong rather than art.
    assert.ok(coverage > 8 && coverage < 45, `${name}: ${coverage.toFixed(1)}% ink`)
    // And the mark is centred, because the renderer draws it into a square box.
    const margin = Math.round(png.width * 0.02)
    for (let i = 0; i < margin; i++) {
      for (let j = 0; j < png.width; j++) {
        assert.equal(png.at(j, i).a, 0, `${name}: ink in the top margin`)
        assert.equal(png.at(j, png.height - 1 - i).a, 0, `${name}: ink in the bottom margin`)
        assert.equal(png.at(i, j).a, 0, `${name}: ink in the left margin`)
        assert.equal(png.at(png.width - 1 - i, j).a, 0, `${name}: ink in the right margin`)
      }
    }
  }
})

/**
 * A label's own geometry, which nothing else here can see: the wrong size still
 * prints the right words, only off the top of the board — a two-line label set from
 * the height of the whole *stack* came out `lines ×` too large and left the panel,
 * and a row pitch left in metres inside a pixel box stacked both rows on one baseline.
 */
test('a two-line label is set at its own size, one row under the other, on the plate', () => {
  const label = { id: 'c1', kind: 'text', text: '出站\nExit', x: 0, y: 0.35, scale: 1, side: 'both' }
  const { ops, plate } = paint(settleSignBins([label]).layout, [LINE], 'left')
  // The rows are drawn a character at a time, so the gloss is the first word set at a
  // size other than the name's.
  const zh = ops.words[0]
  const en = ops.words.find((word) => word.size !== zh?.size)
  assert.ok(zh && en, `the label printed both rows: ${JSON.stringify(ops.texts)}`)
  // Each row at the label's own size: 中文 at `SIGN_SIZE.text.h`, the gloss at its ratio.
  assert.ok(Math.abs(zh.size - SIGN_SIZE.text.h * PX_PER_METRE) < 0.5, `中文 set at ${zh.size}px`)
  assert.ok(Math.abs(en.size - SIGN_SIZE.text.h * SIGN_TEXT_EN_SCALE * PX_PER_METRE) < 0.5, `English set at ${en.size}px`)
  // 中文 over the gloss, a row apart rather than on one baseline, and the whole stack
  // between the plate's top edge and its foot.
  assert.ok(zh.y < en.y, `中文 is the upper row (${zh.y} vs ${en.y})`)
  assert.ok(en.y - zh.y > en.size, `the rows are stacked, not overprinted: ${en.y - zh.y}px apart`)
  assert.ok(zh.y - zh.size > 0, `the upper row runs off the plate: baseline ${zh.y}, size ${zh.size}`)
  assert.ok(en.y < plate.height, `the lower row runs off the plate: baseline ${en.y} of ${plate.height}`)
})

/**
 * The **turn back** (`uturn-left` / `uturn-right`) is the one arrow whose shape is not a rotation
 * of the straight mark, and it has been wrong twice, both times invisibly to every other test:
 *
 *   1. the bend was **swept the wrong way**, so the inner arc crossed the bottom of its own
 *      ellipse — inside the filled dome — and the mark printed as a blob with a slit in it;
 *   2. it was drawn as an **outline** (an outer arc and an inner arc, filled between them), which
 *      cannot have a constant line width: as the bend tightens the inner radius collapses toward
 *      zero, so the inside of the U necks down to a crescent. No tuning fixes that; only drawing
 *      the mark as a **stroked centre line** does, because then every point of it is `lineWidth`
 *      wide by construction.
 *
 * So both properties are pinned here: the mark is stroked once with a single width, and its bend
 * is a semicircle swept over the top — `3π/2` is up on screen in a y-down space, so
 * `anticlockwise = false` from π to 0 is the one that bulges upward.
 */
test('the U-turn arrow is one line of one width, bending over the top', () => {
  const board = [
    { id: 'c1', kind: 'arrow', arrow: 'uturn-right', x: 0, y: 0.35, scale: 1.6, side: 'both' },
    { id: 'c2', kind: 'arrow', arrow: 'uturn-left', x: 0, y: 0.35, scale: 1.6, side: 'both' },
  ]
  const { ops, plate } = paint(settleSignBins(board).layout, [LINE], 'left')
  // One line per mark — the run, the bend and the head run are **one path**, which is what makes
  // the width uniform. The plate's own frame is a stroke too, so the count is checked **from the
  // marks' own widths**: exactly two of them, and they are the drawing's, not the frame's (which
  // is a hairline at `frame * 0.5`).
  const markWidths = ops.strokeWidths.filter((strokeWidth) => strokeWidth > 2)
  assert.equal(markWidths.length, 2, `one stroked path per mark: ${markWidths.length} of ${ops.strokeWidths.length} strokes are the marks`)
  assert.equal(markWidths[0], markWidths[1], `both hands are the same weight: ${markWidths}`)
  // The bend: one arc per mark, a true semicircle (rx === ry), swept over the top.
  const arcs = ops.arcs
  assert.equal(arcs.length, 2, `one bend per mark: ${arcs.length}`)
  for (const [i, label] of ['uturn-right', 'uturn-left'].entries()) {
    const bend = arcs[i]
    assert.ok(Math.abs(bend.r - 0) > 0, `${label}: the bend has a radius`)
    assert.equal(bend.a0, Math.PI, `${label}: the bend starts on the tail's side`)
    assert.equal(bend.a1, 0, `${label}: and ends on the head's side`)
    assert.equal(bend.anticlockwise, false, `${label}: the bend bulges over the top`)
    // The whole drawing hangs below the bend's springing line: the top of the arc is the mark's
    // top edge, so a mark that grew would print its arrowhead off the plate.
    assert.ok(bend.cy - bend.r > 0 && bend.cy - bend.r < plate.height, `${label}: the bend is inside the plate (${bend.cy - bend.r} of ${plate.height})`)
  }
  // A square mark: the U is nearly as tall as it is wide, so it must not be given the long box
  // of a straight arrow (which would letterbox it into a sliver). The box is measured rather
  // than restated, so the drawing's own size and the palette's ink cannot drift apart.
  assert.ok(isUturnArrow('uturn-right') && isUturnArrow('uturn-left'))
  assert.ok(!isUturnArrow('left'), 'the eight directions are not turns back')
  const uturn = signInkSize({ id: 'u', kind: 'arrow', arrow: 'uturn-right', x: 0, y: 0, scale: 1, side: 'both' })
  const straight = signInkSize({ id: 's', kind: 'arrow', arrow: 'left', x: 0, y: 0, scale: 1, side: 'both' })
  assert.equal(uturn.w, uturn.h, `a turn back takes a square box: ${uturn.w} × ${uturn.h}`)
  assert.ok(uturn.h > straight.h, `and a taller one than a straight arrow's: ${uturn.h} vs ${straight.h}`)
  // And the drawing fits the **place** it was settled into: the bins of a two-mark row are far
  // wider than one mark, so a settled board magnifies its marks, and what must hold is that the
  // drawn mark stays inside its bin or two marks on a board would overlap.
  const drawnHalfWm = (Math.max(...arcs.map((a) => a.r)) + markWidths[0] / 2) / PX_PER_METRE
  assert.ok(drawnHalfWm <= settleSignBins(board).pitch / 2, `the U fits its bin: ${drawnHalfWm}`)
})

test('a sign module round-trips its boards through the save', () => {
  const placed = createModule('sign', 2, 3, 0, 'sign-1', 0, undefined, 'up', 'right', [LINE], {
    front: [
      { id: 'c1', kind: 'line', lineId: '5', english: true, x: 0.27, y: 0.35, scale: 1, side: 'both' },
      { id: 'c2', kind: 'icon', icon: 'exit', x: 0.81, y: 0.35, scale: 1, side: 'both' },
    ],
    back: [{ id: 'b1', kind: 'text', text: '电梯', x: 0.27, y: 0.35, scale: 1, side: 'both' }],
  })
  const state = toState({
    name: 't',
    seed: 1,
    cells: [],
    modules: [placed],
    lines: [LINE],
  })
  assert.deepEqual(state.modules[0].cfg.front, placed.cfg.front, 'the front survives toState')
  assert.deepEqual(state.modules[0].cfg.back, placed.cfg.back, 'and so does the back')
  const { ops } = paint(state.modules[0].cfg.front, [LINE], 'left')
  assert.ok(ops.texts.includes('5号线'), 'and still prints')
  const backPlate = paint(state.modules[0].cfg.back, [LINE], 'right')
  assert.ok(backPlate.ops.texts.includes('电'), 'and the back prints its own board')
})
