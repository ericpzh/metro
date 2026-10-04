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
import { pictogramArt, pictogramNames, readPictogram } from './support/pictograms.mjs'
import { createModule, toState } from '../src/build/model.ts'
import { settleSignBins, settleSignBoards, defaultSignLayout, SIGN_BACK_MARK, signBoardsPanel, signPanelSize, signPlate, PX_PER_METRE, SIGN_ICONS, SIGN_SIZE, SIGN_TEXT_EN_SCALE } from '../src/sim/sign.ts'

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
  // The ink is `render/signFace.ts`'s own pale mark colour; the ground and the frame
  // are the two it paints before any component is reached.
  const INK = '#f4f7fa'
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
    // A mark has printed when it filled in the ink colour, set a word in it (the 出口
    // plate is ink words on a green field, so it does the second), or — for every
    // pictogram that is a picture rather than a plate — drew its bitmap. What it must
    // not do is leave the plate as the ground alone, which is how a broken board looks:
    // a black rectangle hanging in the station.
    const printed = ops.filled.includes(INK) || ops.texts.length > 0 || ops.images > 0
    assert.ok(printed, `${what}: nothing was drawn (fills ${JSON.stringify(ops.filled)}, no words, no pictures)`)
    // A bitmap mark is drawn as one square picture of its own asset, so the drawing
    // and the catalogue cannot disagree about which mark a component wears.
    if (mark.kind === 'icon' && mark.icon !== 'exit') {
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
 * The assets themselves, which nothing above can see: a board prints whatever
 * bitmap it is handed, so a mark that arrived with a grey ground, a soft edge or a
 * non-square frame would print just as happily. The contract
 * `tools/prep-sign-icons.py` promises is what these assert.
 */
test('every pictogram asset is square, pure white ink on a clear ground', () => {
  const names = pictogramNames()
  const icons = SIGN_ICONS.filter((icon) => icon !== 'exit')
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
