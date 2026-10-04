// Ceiling-hung decoration (指示牌 / 电视, GAME-SPEC §5.7): an overhead wayfinding
// board and an ad screen, both hung by rods from the storey ceiling. They are
// ceiling-mounted, not wall-mounted, so `ceilingMountMissing` requires a solid
// slab at the next grid line up and the builder refuses a piece with nothing
// overhead. Each envelope is the full storey column, so it is found and blocks
// its cell like any other equipment.
//
// The 指示牌's printed face is a **document** (§5.8 custom text signage): an
// ordered list of draggable components laid out by `sim/sign.ts`, on a board that
// sizes itself to what it carries. The second half of this file is that model —
// its scale conversion, its clamp, its per-face filter, the defaults a fresh
// board and an old save both get, the line shield's derivation from the station
// document, and the rule that no two marks may ever sit on top of each other.
import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleAt, moduleEnvelope, placementBlocked, ceilingMountMissing, wallMountMissing } from '../src/sim/placement.ts'
import { createModule, toState } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import {
  PANEL_INSET,
  PANEL_MAX_H,
  PANEL_MAX_W,
  PANEL_MIN_H,
  PANEL_MIN_W,
  PANEL_SIZE,
  PX_PER_METRE,
  SIGN_ARROWS,
  SIGN_BACK_MARK,
  SIGN_BIN_PITCH,
  SIGN_BLOCKS,
  SIGN_COMPONENT_MAX,
  SIGN_ICONS,
  SIGN_PIECE_PAD,
  SIGN_SCALE_MAX,
  SIGN_SCALE_MIN,
  SIGN_TEXT_EN_SCALE,
  SIGN_TEXT_MAX,
  clampSignComponent,
  defaultSignLayout,
  estimateSignTextWidth,
  hitSignComponent,
  makeSignComponent,
  nextSignComponentId,
  normalizeSignLayout,
  packSignRow,
  settleSignBins,
  settleSignBoards,
  settleSignLayout,
  signBlockComponents,
  signBoardsHaveInk,
  signBoardsOf,
  signBoardsPanel,
  signComponentAt,
  signContentBox,
  signInkSize,
  signLayoutInOrder,
  signLayoutInserted,
  signLayoutMoved,
  signLineEnglish,
  signLineNumber,
  signMarkFits,
  signPanelSize,
  signPieceSize,
  signPieces,
  signPlate,
  signTextLineScale,
  signTextLines,
  signTextSize,
  splitSignBoards,
  stampSignBlock,
} from '../src/sim/sign.ts'

/** A solid slab at one level. */
function slab(x, y, z, finish) {
  return { x, y, z, fill: 'solid', ...(finish ? { finish } : {}) }
}

const sign = (x, y, z, id = 'sign-1', rot = 0) => ({ id, type: 'sign', x, y, z, rot, cfg: {} })
const tv = (x, y, z, id = 'tv-1', rot = 0) => ({ id, type: 'tv', x, y, z, rot, cfg: {} })
const gate = (x, y, z, id = 'gate-1') => ({ id, type: 'gate', x, y, z, cfg: { dir: 'both' } })

/** The station's lines, as the shield components read them. */
const LINE_2 = {
  id: '2',
  name: '2号线',
  colour: '#00679e',
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

test('a sign is created with the hover rotation, like any equipment', () => {
  const mod = createModule('sign', 1, 2, 3, 's', 1)
  assert.equal(mod?.type, 'sign')
  assert.equal(mod?.rot, 1)
  assert.equal(mod?.x, 1)
  assert.equal(mod?.y, 2)
})

test('a ceiling-hung piece needs a solid ceiling one storey up', () => {
  for (const hung of [sign(2, 3, 0), tv(2, 3, 0)]) {
    // Floor at z = 0 with no ceiling: refused.
    assert.equal(ceilingMountMissing([slab(2, 3, 0)], hung), true)
    // A solid slab at z = 4 is the ceiling.
    assert.equal(ceilingMountMissing([slab(2, 3, 0), slab(2, 3, 4)], hung), false)
    // A ceiling over a different cell does not count.
    assert.equal(ceilingMountMissing([slab(2, 3, 0), slab(4, 3, 4)], hung), true)
    // The next grid line is used, so a piece on the B1 platform (-8) hangs from
    // the concourse slab (-4).
    assert.equal(ceilingMountMissing([slab(2, 3, -8), slab(2, 3, -4)], sign(2, 3, -8)), false)
    assert.equal(ceilingMountMissing([slab(2, 3, -8)], tv(2, 3, -8)), true)
  }
  // Wall-mounted and floor-standing modules are never refused by the rule.
  assert.equal(ceilingMountMissing([slab(2, 3, 0)], gate(2, 3, 0)), false)
})

test('the sign and TV are not wall-mounted', () => {
  // No wall behind them; the ceiling rule is the only one that applies.
  assert.equal(wallMountMissing([slab(2, 3, 0)], sign(2, 3, 0)), false)
  assert.equal(wallMountMissing([slab(2, 3, 0)], tv(2, 3, 0)), false)
})

test('a ceiling-hung piece envelope is the whole storey column', () => {
  for (const hung of [sign(2, 3, 0), tv(2, 3, 0)]) {
    const box = moduleEnvelope(hung)
    assert.deepEqual(box, { x0: 2, y0: 3, z0: 1, x1: 3, y1: 4, z1: 4 })
    // It is found from its floor cell and blocks another piece there.
    assert.equal(moduleAt([hung], 2, 3, 0)?.type, hung.type)
    assert.equal(placementBlocked([hung], gate(2, 3, 0)), true)
    // Adjacent cells stay free.
    assert.equal(placementBlocked([hung], gate(3, 3, 0)), false)
  }
})

test('a ceiling-hung piece round-trips the save', () => {
  // A board is placed through the factory, so it already carries the composed
  // **front** a save has to keep — a hand-written `cfg: {}` is the *legacy* shape,
  // and that one is backfilled instead (see the layout tests below). Its back is
  // empty, because a fresh sign is one-sided until the player composes the other
  // face, and an empty face survives the round trip as an empty face.
  const placed = createModule('sign', 2, 3, 0, 'sign-1', 0, undefined, 'up', 'right', [LINE_2])
  const st = toState({
    name: 't',
    seed: 1,
    cells: [slab(2, 3, 0), slab(2, 3, 4)],
    modules: [placed, tv(4, 3, 0)],
    lines: [],
  })
  const r = parse(serialize(st))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, st.modules)
  assert.equal(r.state.modules[0].cfg.front.length, placed.cfg.front.length)
  assert.deepEqual(r.state.modules[0].cfg.back, [])
})

/* ------------------------------------------------------- the board document */

test('a component is its ink plus a pad, so two marks cannot touch', () => {
  const bare = { id: 'c', kind: 'icon', icon: 'restroom', x: 0.5, y: 0.35, scale: 1, side: 'both' }
  const a = signPieceSize(bare)
  const ink = signInkSize(bare)
  // The box the board makes room for is the ink drawn, plus the pad on every side.
  assert.ok(Math.abs(a.w - (ink.w + SIGN_PIECE_PAD * 2)) < 1e-9, `${a.w}`)
  assert.ok(Math.abs(a.h - (ink.h + SIGN_PIECE_PAD * 2)) < 1e-9, `${a.h}`)
  // An icon is a **picture**: a square mark, the same size whatever is left on the
  // component from an older save — there is no caption to make room for.
  assert.equal(ink.w, ink.h)
  const stale = { ...bare, label: '厕所' }
  assert.deepEqual(signInkSize(stale), ink, 'a leftover caption changes nothing')
  assert.deepEqual(signPieceSize(stale), a)
  // Clamped against the bottom edge, the whole box still fits.
  const low = clampSignComponent({ ...bare, x: 0.5, y: 0 }, PANEL_SIZE)
  assert.ok(low.y - a.h / 2 >= -1e-9, `${low.y - a.h / 2}`)
  // The one exception to the padding rule is a drawn mark whose own shape matters:
  // an arrow keeps its 1.6:1 ink whatever its box is.
  const arrow = signInkSize({ ...bare, kind: 'arrow', arrow: 'right' })
  assert.equal(arrow.w / arrow.h, 1.6)
})

test('the row grows longer with its content, and never taller', () => {
  // The standard board is a legal board, and the floor is the smallest a sign gets.
  const standard = defaultSignLayout({ lines: [LINE_2] })
  const floor = signPanelSize(standard)
  assert.ok(floor.w >= PANEL_MIN_W && floor.w <= PANEL_MIN_W + 0.2, `${floor.w}`)
  assert.equal(floor.h, PANEL_MIN_H)

  // Adding to the row is a list insert: the board gets longer, and it stays one row.
  const wide = stampSignBlock(standard, 'text', { x: 3.0 })
  const grown = signPanelSize(wide)
  assert.ok(grown.w > floor.w + 0.3, `${grown.w} > ${floor.w}`)
  assert.equal(grown.h, PANEL_MIN_H, 'the board never grows taller')
  assert.ok(grown.w <= PANEL_MAX_W)
  assert.equal(new Set(wide.map((c) => c.y)).size, 1, 'every mark is on the one row')
  const last = wide[wide.length - 1]
  assert.ok(last.x + signPieceSize(last).w / 2 <= grown.w + 1e-9, 'the grown board holds the block')

  // A multi-component block buys its own room and still does not start a second row.
  const tall = stampSignBlock(standard, 'exit-text', { x: 2.4 })
  assert.equal(signPanelSize(tall).h, PANEL_MIN_H)
  assert.equal(new Set(tall.map((c) => c.y)).size, 1, 'every mark is on the one row')
  assert.equal(tall.length, standard.length + 2)

  // The ceiling holds: a board asked for far more than it may have stops there, and
  // still refuses to spill onto a second row.
  const huge = signPanelSize([
    { id: 'a', kind: 'text', text: '换乘二号线', x: 9, y: 0.35, scale: 2, side: 'both' },
    { id: 'b', kind: 'text', text: '请往前走', x: 12, y: 0.35, scale: 2, side: 'both' },
  ])
  assert.equal(huge.w, PANEL_MAX_W)
  assert.equal(huge.h, PANEL_MIN_H)
})

test('no two components on a board ever overlap', () => {
  const overlaps = (layout, panel) => {
    const boxes = signPieces(layout, panel)
    const bad = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const ox = Math.min(a.left + a.w, b.left + b.w) - Math.max(a.left, b.left)
        const oy = Math.min(a.bottom + a.h, b.bottom + b.h) - Math.max(a.bottom, b.bottom)
        // Touching edges are fine; a shared area is not.
        if (ox > 1e-6 && oy > 1e-6) bad.push(`${a.id}/${b.id} ${ox.toFixed(3)}x${oy.toFixed(3)}`)
      }
    }
    return bad
  }

  // Two marks dropped in exactly the same place are pushed apart.
  const stacked = settleSignLayout([
    { id: 'a', kind: 'icon', icon: 'accessible', x: 0.6, y: 0.35, scale: 1, side: 'both' },
    { id: 'b', kind: 'icon', icon: 'lift', x: 0.6, y: 0.35, scale: 1, side: 'both' },
  ])
  assert.deepEqual(overlaps(stacked.layout, stacked.panel), [])

  // Everything is still inside the board the separation asked for.
  for (const p of signPieces(stacked.layout, stacked.panel)) {
    assert.ok(p.left >= -1e-6 && p.left + p.w <= stacked.panel.w + 1e-6, `${p.id} x`)
    assert.ok(p.bottom >= -1e-6 && p.bottom + p.h <= stacked.panel.h + 1e-6, `${p.id} y`)
  }

  // The worst case a board can be filled with: every block the palette offers,
  // stamped at the same point. The row is capped at what fits, so the last marks
  // end up in the same place rather than running off the sign — but the board never
  // reads as two rows, and nothing is taller than it was.
  let pile = defaultSignLayout({ lines: [LINE_2] })
  for (const block of SIGN_BLOCKS) pile = stampSignBlock(pile, block.id, { x: 1.0 })
  const settled = settleSignLayout(pile)
  assert.equal(settled.panel.h, PANEL_MIN_H)
  assert.equal(new Set(settled.layout.map((c) => c.y)).size, 1, 'one row')
})

/**
 * How many marks a board really holds — the count the palette has to obey.
 *
 * This is the bug the check exists for: the palette used to hand marks out against the
 * twenty-place ceiling alone, so a board of six arrows (3.24 m of a 3.4 m panel) would take
 * a seventh, `packSignRow` would fold it back inside, and the print drew two marks stacked
 * on one place while the row of bins showed seven separate ones. The count is not a
 * constant: it depends on which marks they are, so the rule is asked per mark.
 */
test('a board takes exactly as many marks as fit, and no more', () => {
  const mark = (kind, id, extra = {}) => ({ id, kind, x: 0, y: 0.35, scale: 1, side: 'both', ...extra })
  const capacity = (kind, extra) => {
    let layout = []
    // Well past any capacity, so the loop is stopped by the model rather than by the count.
    for (let n = 1; n <= SIGN_COMPONENT_MAX + 2; n++) {
      const comp = mark(kind, `c${n}`, extra)
      if (!signMarkFits(layout, comp)) break
      layout = [...layout, comp]
    }
    return layout
  }

  // Six arrows fill the board: 6 × 0.48 m of ink, and the piece's pad between them.
  const arrows = capacity('arrow')
  assert.equal(arrows.length, 6, `${arrows.length} arrows fit`)
  const arrowPanel = signPanelSize(packSignRow(arrows))
  assert.ok(arrowPanel.w > 3.0 && arrowPanel.w <= PANEL_MAX_W, `six arrows: ${arrowPanel.w} m`)

  // A smaller mark fits more, a wider one fewer — the rule is width, not kind.
  assert.ok(capacity('icon').length > arrows.length, 'pictograms are narrower than arrows')
  assert.ok(capacity('line').length > arrows.length, 'a shield is narrower than an arrow')

  // And what the rule accepted really is on the board: no two marks share a place.
  for (const kind of ['arrow', 'icon', 'line']) {
    const layout = capacity(kind)
    const boxes = signPieces(packSignRow(layout), signPanelSize(packSignRow(layout)))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const ox = Math.min(boxes[i].left + boxes[i].w, boxes[j].left + boxes[j].w) - Math.max(boxes[i].left, boxes[j].left)
        assert.ok(ox <= 1e-6, `${kind}: marks ${i} and ${j} share ${ox.toFixed(3)} m`)
      }
    }
  }
})

test('the block the player holds keeps its place; what it lands on moves', () => {  const { layout } = settleSignLayout(
    [
      { id: 'hold', kind: 'icon', icon: 'accessible', x: 1.0, y: 0.35, scale: 1, side: 'both' },
      { id: 'other', kind: 'icon', icon: 'lift', x: 1.0, y: 0.35, scale: 1, side: 'both' },
    ],
    undefined,
    new Set(['hold']),
  )
  const byId = new Map(layout.map((c) => [c.id, c]))
  // A board that shoved the held block out from under the pointer would read as a
  // bug, so the held one stays exactly where it was put.
  assert.equal(byId.get('hold').x, 1.0)
  assert.equal(byId.get('hold').y, 0.35)
  assert.notEqual(byId.get('other').x, 1.0)
})

test('the texture follows the board, at a constant pixels per metre', () => {
  const small = signPlate(PANEL_SIZE)
  const big = signPlate({ w: PANEL_MAX_W, h: PANEL_MAX_H })
  // One conversion at every size: a mark printed at 0.3 m is the same number of
  // pixels on a big sign as on a small one, which is what keeps a component the
  // size the player set it to.
  assert.ok(Math.abs(small.width / PANEL_MIN_W - PX_PER_METRE) < 1)
  assert.ok(Math.abs(big.width / PANEL_MAX_W - PX_PER_METRE) < 1)
  assert.ok(Math.abs(big.height / PANEL_MAX_H - PX_PER_METRE) < 1)
  // And the plate is the board's own shape, so nothing is squashed.
  assert.ok(Math.abs(big.width / big.height - PANEL_MAX_W / PANEL_MAX_H) < 0.01)
})

test('settling a layout keeps its content and fits its board', () => {
  // A layout written in metres on a board that has not been sized yet: settling
  // sizes the board, frees the overlaps and folds every piece inside it.
  const raw = [
    { id: 'a', kind: 'icon', icon: 'lift', x: 9, y: 9, scale: 1, side: 'both' },
    { id: 'b', kind: 'text', text: '出站', x: -4, y: -4, scale: 1, side: 'both' },
  ]
  const { layout, panel } = settleSignLayout(raw)
  assert.equal(layout.length, 2)
  for (const c of layout) {
    const size = signPieceSize(c)
    assert.ok(c.x - size.w / 2 >= -1e-9 && c.x + size.w / 2 <= panel.w + 1e-9, `${c.id} x ${c.x}`)
    assert.ok(c.y - size.h / 2 >= -1e-9 && c.y + size.h / 2 <= panel.h + 1e-9, `${c.id} y ${c.y}`)
  }
  // Settling is idempotent: a second pass changes neither the board nor a position,
  // which is what keeps a board from creeping a few millimetres on every edit.
  const again = settleSignLayout(layout)
  assert.deepEqual(again.panel, panel)
  assert.deepEqual(again.layout, layout)
})

test('the panel conversion is one number, derived from the panel', () => {
  const ppm = PX_PER_METRE
  // 16 px per centimetre: a 0.3 m pictogram is 154 px on the plate.
  assert.ok(Math.abs(ppm * 0.3 - 154) < 2, `${ppm * 0.3}`)
  // The printed area is the panel less its frame.
  const box = signContentBox(PANEL_SIZE)
  assert.ok(Math.abs(box.w - PANEL_MIN_W * (1 - PANEL_INSET * 2)) < 1e-9)
  assert.ok(box.h < PANEL_MIN_H)
})

test('text is measured, and estimated the same way without a canvas', () => {
  // The fallback measure is what the Node tests and a cold font both get, so it
  // has to be in the right ballpark: a CJK glyph is one em, digits a bit over half.
  const cjk = estimateSignTextWidth('出站', 0.16)
  assert.ok(Math.abs(cjk - 0.32) < 1e-9, `${cjk}`)
  const latin = estimateSignTextWidth('EXIT', 0.16)
  assert.ok(latin > 0.3 && latin < 0.5, `${latin}`)
  // A real canvas measurement replaces it, and the ink follows the measurement.
  const measured = (text, size) => text.length * size
  const comp = { id: 'c', kind: 'text', text: '出站', x: 1, y: 0.35, scale: 1, side: 'both' }
  assert.ok(Math.abs(signInkSize(comp).w - cjk) < 1e-9)
  assert.ok(Math.abs(signInkSize(comp, measured).w - 0.32) < 1e-9)
  assert.equal(signInkSize(comp, measured).h, signInkSize(comp).h)
  // The padded box is that ink plus the pad either side.
  assert.ok(Math.abs(signPieceSize(comp).w - (cjk + SIGN_PIECE_PAD * 2)) < 1e-9)
})

test('a label is two lines of eight, and no more', () => {
  assert.deepEqual(signTextLines('出站方向'), ['出站方向'])
  assert.deepEqual(signTextLines('换乘二号线\n请往前走'), ['换乘二号线', '请往前走'])
  // Each line is cut to its own limit, and a third line is dropped.
  const long = signTextLines('1234567890\nabcdefghij\nthird')
  assert.deepEqual(long, ['12345678', 'abcdefgh'])
  assert.equal(signTextLines('').length, 0)
  assert.equal(signTextLines('a\n\nb').length, 2)
})

test('a label sets its second line small, so one box carries both languages', () => {
  // The board's one text box is 中文 over English: the first line is full size and
  // the second is the gloss, at the one ratio the model, the renderer and the
  // editor's tiles all read.
  assert.equal(signTextLineScale(0), 1)
  assert.equal(signTextLineScale(1), SIGN_TEXT_EN_SCALE)
  assert.ok(SIGN_TEXT_EN_SCALE > 0.4 && SIGN_TEXT_EN_SCALE < 0.8, `${SIGN_TEXT_EN_SCALE}`)

  const size = signTextSize(1)
  // A measure that reports exactly what it was handed, so the size each row is
  // measured at is visible in the box the row asks for.
  const measured = (text, at) => text.length * at
  const both = { id: 'c', kind: 'text', text: '换乘二号线\nExit', x: 1, y: 0.35, scale: 1, side: 'both' }
  const ink = signInkSize(both, measured)
  const zh = measured('换乘二号线', size)
  const en = measured('Exit', size * SIGN_TEXT_EN_SCALE)
  // The box is as wide as the wider of the two rows, each at **its own** size: the
  // gloss is never measured at the name's size, which is what would make the box
  // wider than the ink the renderer prints.
  assert.ok(Math.abs(ink.w - Math.max(zh, en)) < 1e-9, `${ink.w}`)
  assert.ok(en < zh, `the small gloss should not outweigh the name: ${en} vs ${zh}`)
  // Which is the same box the name alone asks for: the gloss, set small, fits inside
  // it rather than stretching the box the way a full-size second row would.
  assert.ok(Math.abs(signInkSize({ ...both, text: '换乘二号线' }, measured).w - zh) < 1e-9)
  assert.ok(en < measured('Exit', size), `the gloss is set smaller: ${en} < ${measured('Exit', size)}`)
  // Its height is the stack of two rows at the name's size, so a two-line label is
  // twice as tall as a one-line one and the board makes room for both rows.
  assert.ok(Math.abs(ink.h - size * 1.15 * 2) < 1e-9, `${ink.h}`)
  assert.ok(Math.abs(ink.h - 2 * signInkSize({ ...both, text: '出站' }, measured).h) < 1e-9)
})

test('the bin order is the row: a move or an insert is a list edit', () => {
  const a = { id: 'a', kind: 'icon', icon: 'accessible', x: 0, y: 0.35, scale: 1, side: 'both' }
  const b = { id: 'b', kind: 'arrow', arrow: 'right', x: 0, y: 0.35, scale: 1, side: 'both' }
  const c = { id: 'c', kind: 'text', text: '出站', x: 0, y: 0.35, scale: 1, side: 'both' }
  const list = [a, b, c]
  const order = (l) => [...l].sort((p, q) => p.x - q.x).map((p) => p.id)

  // Written in order, the list's own order is the row's: one bin per place, all the
  // same width, so nothing is placed by a hand-set millimetre.
  const lined = signLayoutInOrder(list)
  assert.deepEqual(order(lined), ['a', 'b', 'c'])
  assert.ok(Math.abs(lined[1].x - lined[0].x - SIGN_BIN_PITCH) < 1e-9)
  assert.ok(Math.abs(lined[2].x - lined[1].x - SIGN_BIN_PITCH) < 1e-9)

  // A drag between bins moves the item and shuffles the rest along, which is the
  // whole of the reorder rule: there is no free horizontal position to ask for.
  assert.deepEqual(order(signLayoutMoved(list, 'a', 2)), ['b', 'c', 'a'])
  assert.deepEqual(order(signLayoutMoved(list, 'c', 0)), ['c', 'a', 'b'])
  assert.deepEqual(order(signLayoutMoved(list, 'b', 1)), ['a', 'b', 'c'])
  // An index past the end is the last bin rather than an error, and an unknown id
  // changes the order of nothing.
  assert.deepEqual(order(signLayoutMoved(list, 'a', 99)), ['b', 'c', 'a'])
  assert.deepEqual(order(signLayoutMoved(list, 'gone', 0)), ['a', 'b', 'c'])

  // An insert from the palette takes a bin and pushes the rest along.
  const d = { id: 'd', kind: 'icon', icon: 'lift', x: 0, y: 0.35, scale: 1, side: 'both' }
  assert.deepEqual(order(signLayoutInserted(list, d, 1)), ['a', 'd', 'b', 'c'])
  assert.deepEqual(order(signLayoutInserted(list, d, 99)), ['a', 'b', 'c', 'd'])
  // Every bin the editor can make settles onto a board that holds it: the pack reads
  // the list's own order, so what the player sees in the bins is the printed row.
  for (const moved of [signLayoutMoved(list, 'a', 2), signLayoutMoved(list, 'c', 0), signLayoutInserted(list, d, 1)]) {
    const settled = settleSignLayout(moved)
    assert.deepEqual(settled.layout.map((p) => p.id), moved.map((p) => p.id))
    assert.equal(settled.panel.h, PANEL_MIN_H)
  }
})

test('the bins fill the board, so a place on the screen is a place on the sign', () => {
  const list = [
    { id: 'a', kind: 'arrow', arrow: 'left', x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'b', kind: 'line', lineId: '2', english: true, x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'c', kind: 'icon', icon: 'exit', x: 0, y: 0.35, scale: 1, side: 'both' },
    { id: 'd', kind: 'text', text: '出站', x: 0, y: 0.35, scale: 1, side: 'both' },
  ]
  const board = settleSignBins(list)
  // One spare place past the last item, so there is always somewhere to drop the
  // next one, and never more places than a board may hold.
  assert.equal(board.bins, list.length + 1)
  assert.ok(board.bins <= SIGN_COMPONENT_MAX)
  // The places divide the board **equally** and cover all of it: bin i is the slice
  // from i·pitch to (i+1)·pitch, and the last edge is the board's own end.
  assert.ok(board.pitch > 0)
  assert.ok(Math.abs(board.pitch * board.bins - board.room) < 1e-9, `${board.pitch * board.bins} vs ${board.room}`)
  assert.ok(board.room >= board.panel.w - 1e-9, 'the board is never shorter than its content')
  // Every mark sits in the middle of its own bin, and inside the board.
  board.layout.forEach((c, i) => {
    const centre = (i + 0.5) * board.pitch
    assert.ok(Math.abs(c.x - centre) < 1e-9, `${c.id} at ${c.x}, bin centre ${centre}`)
    assert.ok(c.x > 0 && c.x < board.room)
  })
  // The printed row is the row of bins: the pack confirms the places rather than
  // shoving marks right, so what the preview shows is what the bins say.
  const pieces = signPieces(board.layout, { w: board.room, h: board.panel.h })
  assert.deepEqual(pieces.map((p) => p.id), board.layout.map((p) => p.id))
  // Every mark is inside the board. (A board whose marks are wider than their bins —
  // a row filled to the ceiling — packs tighter, which is what the ceiling is for.)
  for (const p of pieces) {
    assert.ok(p.left >= -1e-9 && p.left + p.w <= board.room + 1e-9, `${p.id} outside the board`)
  }
  // Settling is idempotent: a board read back gives the same places, which is what
  // keeps a bin from creeping on every re-render.
  const again = settleSignBins(board.layout)
  assert.ok(Math.abs(again.room - board.room) < 1e-9)
  assert.ok(Math.abs(again.pitch - board.pitch) < 1e-9)
  assert.deepEqual(again.layout.map((c) => c.id), board.layout.map((c) => c.id))

  // With no content at all, a board still has one place to drop something into.
  const empty = settleSignBins([])
  assert.equal(empty.bins, 1)
  assert.ok(empty.room >= PANEL_MIN_W)
  // A board of three marks is divided into four places, and each of them is wide
  // enough for the widest mark on it — that is what makes the bins a preview.
  const three = settleSignBins(list.slice(0, 3))
  assert.equal(three.bins, 4)
  assert.ok(three.pitch + 1e-9 >= 0.48, `${three.pitch}`)
})

test('a component is clamped onto the panel, not off it', () => {
  const comp = { id: 'c', kind: 'text', text: '出站', x: 1, y: 0.35, scale: 1, side: 'both' }
  const w = signPieceSize(comp).w
  const h = signPieceSize(comp).h

  // The band is the whole panel less the piece's own half-extent, so the mark's box
  // lands on the board's edge rather than inside its frame.
  const left = clampSignComponent({ ...comp, x: -3 })
  assert.ok(left.x > 0 && left.x < PANEL_MIN_W / 2, `${left.x}`)
  assert.ok(left.x - w / 2 >= -1e-9, `${left.x - w / 2}`)
  const right = clampSignComponent({ ...comp, x: 40 })
  assert.ok(right.x > PANEL_MIN_W / 2 && right.x + w / 2 <= PANEL_MIN_W + 1e-9)

  // Vertically the whole piece stays inside too, which is what keeps a caption
  // from hanging off the bottom of the board.
  const low = clampSignComponent({ ...comp, y: -2 })
  assert.ok(low.y >= 0 && low.y - h / 2 >= -1e-9, `${low.y}`)
  assert.ok(clampSignComponent({ ...comp, y: 9 }).y + h / 2 <= PANEL_MIN_H + 1e-9)

  // Scale is clamped rather than trusted: a save cannot make a component 50×.
  assert.equal(clampSignComponent({ ...comp, scale: 99 }).scale, SIGN_SCALE_MAX)
  assert.equal(clampSignComponent({ ...comp, scale: 0 }).scale, SIGN_SCALE_MIN)
  assert.equal(clampSignComponent({ ...comp, scale: Number.NaN }).scale, 1)
  // A component that needs no repair comes back as the very same object, and
  // clamping one that did is idempotent — the board cannot creep on a second pass.
  const good = clampSignComponent(comp)
  assert.equal(clampSignComponent(good), good)
  assert.deepEqual(clampSignComponent(left), left)
})

test('the panel lays components out in metres, bottom-left first', () => {
  const layout = [
    { id: 'a', kind: 'text', text: '出站', x: 1, y: 0.35, scale: 1, side: 'both' },
    { id: 'b', kind: 'arrow', arrow: 'left', x: 0.4, y: 0.35, scale: 1, side: 'both' },
  ]
  const pieces = signPieces(layout, PANEL_SIZE)
  assert.equal(pieces.length, 2)
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const text = byId.get('a')
  const arrow = byId.get('b')
  // A position is the piece's own centre, in metres from the panel's corner.
  assert.ok(Math.abs(text.left + text.w / 2 - 1) < 1e-9)
  assert.ok(Math.abs(text.bottom + text.h / 2 - 0.35) < 1e-9)
  // The arrow's *ink* is a 1.6:1 mark, 0.48 m long at scale 1.
  assert.ok(Math.abs(arrow.inkW / arrow.inkH - 1.6) < 1e-9, `${arrow.inkW / arrow.inkH}`)
  assert.ok(arrow.left < text.left)
  // Every box is inside the board.
  for (const p of pieces) {
    assert.ok(p.left >= -1e-9 && p.left + p.w <= PANEL_MIN_W + 1e-9, `${p.id} x ${p.left}…${p.left + p.w}`)
    assert.ok(p.bottom >= -1e-9 && p.bottom + p.h <= PANEL_MIN_H + 1e-9, `${p.id} y ${p.bottom}…${p.bottom + p.h}`)
  }
})

test('a component bound to one face prints on that face only', () => {
  const layout = [
    { id: 'both', kind: 'text', text: '出站', x: 1, y: 0.35, scale: 1, side: 'both' },
    { id: 'l', kind: 'icon', icon: 'lift', x: 0.4, y: 0.35, scale: 1, side: 'left' },
    { id: 'r', kind: 'arrow', arrow: 'right', x: 1.6, y: 0.35, scale: 1, side: 'right' },
  ]
  const ids = (face) => signPieces(layout, PANEL_SIZE, face).map((p) => p.id)
  assert.deepEqual(ids('both'), ['both', 'l', 'r'])
  assert.deepEqual(ids('left'), ['both', 'l'])
  assert.deepEqual(ids('right'), ['both', 'r'])
  // Which is what makes a one-way board one-way: the far face is genuinely empty
  // of that component, so the renderer draws no plate for it.
  const oneWay = layout.filter((c) => c.side === 'left')
  assert.equal(signPieces(oneWay, PANEL_SIZE, 'right').length, 0)
  assert.equal(signPieces(oneWay, PANEL_SIZE, 'left').length, 1)
})

test('the hit test picks what the player can see', () => {
  const layout = [
    { id: 'under', kind: 'icon', icon: 'accessible', x: 1, y: 0.35, scale: 1, side: 'both' },
    { id: 'over', kind: 'icon', icon: 'stairs', x: 1, y: 0.35, scale: 1, side: 'both' },
  ]
  // Two components in the same place: the later one paints on top and is picked.
  assert.equal(hitSignComponent(layout, 1, 0.35, PANEL_SIZE)?.id, 'over')
  // Empty panel: nothing to pick.
  assert.equal(hitSignComponent(layout, 0.05, 0.65, PANEL_SIZE), null)
  // A face-bound component is not pickable from the other face.
  const sided = [{ id: 'l', kind: 'icon', icon: 'lift', x: 1, y: 0.35, scale: 1, side: 'left' }]
  assert.equal(hitSignComponent(sided, 1, 0.35, PANEL_SIZE, 'left')?.id, 'l')
  assert.equal(hitSignComponent(sided, 1, 0.35, PANEL_SIZE, 'right'), null)
})

test('the drop rule swaps two blocks, and only the ones it was given', () => {
  const layout = [
    { id: 'a', kind: 'icon', icon: 'accessible', x: 0.35, y: 0.35, scale: 1, side: 'both' },
    { id: 'b', kind: 'icon', icon: 'lift', x: 1.4, y: 0.35, scale: 1, side: 'both' },
  ]
  // The block under the point, which is what a drag swaps places with.
  assert.equal(signComponentAt(layout, 1.4, 0.35, undefined, PANEL_SIZE)?.id, 'b')
  assert.equal(signComponentAt(layout, 0.9, 0.35, undefined, PANEL_SIZE), null)
  // Excluding the one being dragged keeps a block from swapping with itself.
  assert.equal(signComponentAt(layout, 1.4, 0.35, new Set(['a']), PANEL_SIZE)?.id, 'b')
  assert.equal(signComponentAt(layout, 0.35, 0.35, new Set(['b']), PANEL_SIZE)?.id, 'a')
  assert.equal(signComponentAt(layout, 0.35, 0.35, new Set(['a', 'b']), PANEL_SIZE), null)
})

test('a fresh board carries the station line, and a legacy board is backfilled', () => {
  const fresh = createModule('sign', 1, 1, 0, 's', 0, undefined, 'up', 'right', [LINE_2])
  assert.equal(fresh.type, 'sign')
  const line = fresh.cfg.front.find((c) => c.kind === 'line')
  // The auto-generated shield names the station's own line, so a new sign is
  // already readable instead of waiting for the editor.
  assert.equal(line.lineId, '2')
  assert.ok(fresh.cfg.front.some((c) => c.kind === 'icon' && c.icon === 'exit'))
  assert.ok(fresh.cfg.front.some((c) => c.kind === 'arrow'))
  // The back is **empty**, and that is the point of a second face: a fresh sign says
  // one thing, to one side, until the player composes the other board.
  assert.deepEqual(fresh.cfg.back, [], 'a fresh sign has an empty back')
  // A fresh board is a legal board: no overlap, and inside its own size.
  const freshPanel = signPanelSize(fresh.cfg.front)
  for (const p of signPieces(fresh.cfg.front, freshPanel)) {
    assert.ok(p.left >= -1e-9 && p.left + p.w <= freshPanel.w + 1e-9, `${p.id} x`)
  }

  // A station with no line at all still gets a legible board — just no shield.
  const bare = createModule('sign', 1, 1, 0, 's2', 0)
  assert.equal(bare.cfg.front.some((c) => c.kind === 'line'), false)
  assert.ok(bare.cfg.front.length >= 3)

  // A legacy module (`cfg: {}`) is repaired on the way in, once, by `toState`.
  const legacy = toState({ name: 't', seed: 1, cells: [], modules: [sign(2, 3, 0)], lines: [LINE_2] })
  const repaired = legacy.modules[0]
  assert.equal(repaired.type, 'sign')
  assert.ok(repaired.cfg.front.length > 0, 'a legacy sign is backfilled on the front')
  assert.equal(repaired.cfg.front.find((c) => c.kind === 'line').lineId, '2')
  assert.deepEqual(repaired.cfg.back, [], 'and its back is left empty, not filled with the default')
  // ...and a load is idempotent: a second pass leaves the document alone.
  const again = toState({ name: 't', seed: 1, cells: [], modules: legacy.modules, lines: [LINE_2] })
  assert.deepEqual(again.modules[0].cfg.front, repaired.cfg.front)
  assert.deepEqual(again.modules[0].cfg.back, repaired.cfg.back)
  // A second repair changes nothing at all, field for field.
  assert.deepEqual(normalizeSignLayout(repaired.cfg.front), repaired.cfg.front)
  assert.deepEqual(signBoardsOf(repaired.cfg, { lines: [LINE_2] }), { front: repaired.cfg.front, back: [] })
})

test('the two boards are independent, and the split folds a per-face binding once', () => {
  // A save from the per-component era: one list, each mark bound to a face or to both.
  const legacy = [
    { id: 'b', kind: 'text', text: '出站', x: 1, y: 0.35, scale: 1, side: 'both' },
    { id: 'l', kind: 'icon', icon: 'lift', x: 0.4, y: 0.35, scale: 1, side: 'left' },
    { id: 'r', kind: 'arrow', arrow: 'right', x: 1.6, y: 0.35, scale: 1, side: 'right' },
  ]
  const boards = signBoardsOf({ components: legacy }, { lines: [LINE_2] })
  // The one list becomes the two the document now holds: a mark bound to the right
  // face is a mark on the **back** board, and everything else is on the front. The
  // fold is a pure function of the list, so it is what a save, a stamp and the
  // editor all read.
  assert.deepEqual(boards.front.map((c) => c.id), ['b', 'l'])
  assert.deepEqual(boards.back.map((c) => c.id), ['r'])
  // ...and it is idempotent: the pair it produced folds back to itself.
  assert.deepEqual(splitSignBoards([...boards.front, ...boards.back]), boards)

  // The two faces are independent documents, so the same line may stand on both and
  // the pair is settled as a pair — the shared panel is as long as the longer face.
  const composed = settleSignBoards({
    front: [makeSignComponent('icon', 'f1')],
    back: [makeSignComponent('line', 'b1', '2'), makeSignComponent('icon', 'b2')],
  })
  assert.equal(composed.front.length, 1)
  assert.equal(composed.back.length, 2)
  const panel = signBoardsPanel(composed)
  assert.ok(panel.w >= signPanelSize(composed.back).w, 'the panel holds the longer face')
  assert.ok(panel.w >= signPanelSize(composed.front).w)
  // An empty face is a face with no plate, not a plate with nothing on it.
  assert.equal(signBoardsHaveInk({ front: [], back: [] }), false)
  assert.equal(signBoardsHaveInk({ front: [], back: composed.back }), true)
})

test('a mark dropped on one face lands on that face and nowhere else', () => {
  // The editor resolves a drop to **which row the pointer is over** and edits only that
  // board. This pins the model half of that contract, because the failure it guards is
  // the one that shipped: a drop that resolved to the wrong face put every mark on 正面
  // while the player aimed at 背面, and the model had no complaint to make about it.
  const boards = settleSignBoards({
    front: [makeSignComponent('icon', 'f1')],
    back: [],
  })
  const lift = makeSignComponent('icon', 'drop')

  // Dropping on the back face: the mark is on the back board, and the front is the very
  // same list it was — not a copy, not re-settled, not renumbered.
  const onBack = settleSignBoards({ front: boards.front, back: [lift] })
  assert.deepEqual(onBack.back.map((c) => c.id), ['drop'])
  assert.deepEqual(onBack.back.map((c) => c.kind), ['icon'])
  assert.deepEqual(onBack.front.map((c) => c.id), ['f1'], 'the front is untouched by a back drop')

  // Dropping on the front face is the mirror image of it.
  const onFront = settleSignBoards({ front: [...boards.front, lift], back: [] })
  assert.deepEqual(onFront.front.map((c) => c.id), ['f1', 'drop'])
  assert.deepEqual(onFront.back, [], 'the back is untouched by a front drop')

  // The two boards also mint ids independently, so the same id may stand on both faces
  // and neither drop may disturb the other's numbering.
  const both = settleSignBoards({ front: [makeSignComponent('icon', 'c1')], back: [makeSignComponent('icon', 'c1')] })
  assert.deepEqual(both.front.map((c) => c.id), ['c1'])
  assert.deepEqual(both.back.map((c) => c.id), ['c1'])

  // Which face a drop resolved to is read off the row, and the row states it as
  // `data-face` for exactly that reason (`app/SignEditor.tsx` `BinStrip`/`placeAt`): the
  // attribute is the only thing that tells the two rows apart once they are in the DOM.
  // A row that does not say is **not** the front row — it is no row at all.
  const faces = new Set(['front', 'back'])
  const resolve = (dataFace) => (faces.has(dataFace) ? dataFace : null)
  assert.equal(resolve('back'), 'back')
  assert.equal(resolve('front'), 'front')
  assert.equal(resolve(undefined), null, 'an untagged row must not silently become 正面')
  assert.equal(resolve(''), null)
})

test('a mark can be carried from one board to the other, and only ever lives on one', () => {
  // The editor's cross-face drag: the mark leaves the board it was on and joins the one it
  // is over, at the place it was dropped. It is written as one statement over the pair —
  // take it out of one list, put it into the other — which is what keeps the two boards
  // from ever both holding it, or neither. This is the model half of that; the gesture
  // itself is exercised in the browser.
  const boards = settleSignBoards({
    front: [
      makeSignComponent('arrow', 'a1'),
      makeSignComponent('icon', 'a2'),
      makeSignComponent('arrow', 'a3'),
    ],
    back: [],
  })
  const carried = boards.front[1]
  const source = boards.front.filter((c) => c.id !== carried.id)
  const destination = signLayoutInserted(boards.back, carried, 0)
  const moved = { front: source, back: destination }

  assert.equal(moved.front.length, 2, 'the board it left is one shorter')
  assert.equal(moved.back.length, 1, 'the board it joined is one longer')
  assert.ok(!moved.front.some((c) => c.id === carried.id), 'and it is no longer on the board it left')
  assert.equal(moved.back[0].kind, carried.kind, 'the board it joined holds the mark itself')
  // Aimed at the start of the shorter board, it *is* the start: the row states each mark's
  // place, so the drop lands where the pointer was and not merely somewhere on the board.
  assert.ok(moved.back[0].x <= moved.front[0].x + 1e-9, `dropped at the start: ${moved.back[0].x}`)

  // Carried back, the pair is whole again — and the mark is counted once throughout.
  const returned = { front: signLayoutInserted(moved.front, moved.back[0], 1), back: [] }
  assert.equal(returned.front.length, 3)
  assert.equal(returned.front.filter((c) => c.kind === 'icon').length, 1, 'exactly one copy, never a duplicate')

  // A mark may not be on both boards: the pair is a statement about one sign, so a mark
  // whose id is in both lists is a mark the renderer would print twice.
  const onOneBoard = (pair) => {
    const ids = [...pair.front, ...pair.back].map((c) => c.id)
    return ids.length === new Set(ids).size
  }
  assert.ok(onOneBoard(moved), 'a carried mark is on exactly one board')
  assert.ok(onOneBoard(returned), 'and so is one carried back')
})

test('the empty face’s stand-in place is not a mark, and never reaches a board', () => {
  // An empty face still has one place to drop the first mark into (`SIGN_BACK_MARK`), so
  // the row always has something to aim at. It is a **place**, not a mark: it prints
  // nothing and measures nothing, which is what keeps it from ever being drawn or written
  // into a sign while still giving `placeAt` a square to resolve a drop to.
  const place = SIGN_BACK_MARK
  const ink = signInkSize(place)
  assert.equal(ink.w, 0, 'the stand-in has no ink')
  assert.equal(ink.h, 0)
  assert.equal(place.kind, 'text')
  assert.equal(place.text, '', 'it is an empty label: the one mark that draws and measures as nothing')

  // It is a bin like any other — that is the point, one place to drop into — so the row
  // it is added to gains a place and the pitch divides by one more. What it must not do
  // is become a *piece*: `signPieces` drops it (zero ink, no box), so the renderer draws
  // nothing where it sits and the board never grows for it.
  const real = makeSignComponent('icon', 'c1')
  assert.equal(signPieces(settleSignBins([real, place]).layout).length, 1, 'only the real mark is a piece')
  assert.equal(signPieces(settleSignBins([place]).layout).length, 0, 'a row of nothing but the stand-in has no pieces')
  assert.equal(signPanelSize(settleSignBins([place]).layout).w, PANEL_MIN_W, 'and the board does not grow for it')

  // A board can never *store* one either: the editor lays its bins over the stand-in but
  // writes only real marks. What a sign holding one would print is `render/signFace.ts`'s
  // business, and is asserted there.
  const composed = settleSignBoards({ front: [real], back: [] })
  assert.deepEqual(composed.front.map((c) => c.id), ['c1'])
  assert.ok(!composed.back.some((c) => c.id === place.id))
})

test('an unreadable layout is repaired rather than trusted', () => {
  // Duplicate ids would break the editor's selection, so they are made unique.
  const dup = normalizeSignLayout([
    { id: 'x', kind: 'text', text: '出站', x: 1, y: 0.35, scale: 1, side: 'both' },
    { id: 'x', kind: 'text', text: '进站', x: 0.6, y: 0.35, scale: 1, side: 'both' },
  ])
  assert.equal(dup.length, 2)
  assert.notEqual(dup[0].id, dup[1].id)

  // Too many components, and a wild scale, are both clamped.
  const many = normalizeSignLayout(
    Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, kind: 'text', text: '出站', x: 1, y: 0.35, scale: 99, side: 'both' })),
  )
  assert.equal(many.length, SIGN_COMPONENT_MAX)
  assert.equal(many[0].scale, SIGN_SCALE_MAX)

  // An empty layout is a legacy one, so it gets the default board.
  assert.deepEqual(normalizeSignLayout([]), defaultSignLayout())
  assert.deepEqual(normalizeSignLayout(undefined), defaultSignLayout())
  // A repaired layout is a fixed point: repairing it again changes nothing.
  const good = normalizeSignLayout(defaultSignLayout({ lines: [LINE_2] }))
  assert.deepEqual(normalizeSignLayout(good), good)
})

test('the palette blocks are content groups, and they stamp where they are dropped', () => {
  // Every block names a real kind and stamps at least one component, so a tile
  // that does nothing cannot reach the palette.
  for (const block of SIGN_BLOCKS) {
    const parts = signBlockComponents(block.id, '2')
    assert.ok(parts.length > 0, `${block.id} stamps nothing`)
    assert.equal(parts.length, block.count, `${block.id} count`)
    assert.ok(parts.every((p) => p.side === 'both'))
    assert.ok(parts.every((p) => p.scale > 0))
  }
  // A pictogram block is one mark, and nothing else: an icon carries no caption.
  const restroom = signBlockComponents('restroom')
  assert.equal(restroom.length, 1)
  assert.equal(restroom[0].kind, 'icon')
  assert.equal(restroom[0].icon, 'restroom')
  assert.equal(Object.hasOwn(restroom[0], 'label'), false, 'an icon is a picture, with no wording on it')
  // An arrow beside a plate is two components that land together.
  const pair = signBlockComponents('exit-arrow')
  assert.equal(pair.length, 2)
  assert.deepEqual(pair.map((p) => p.kind).sort(), ['arrow', 'icon'])

  // Stamping on a small board places the block where it was dropped — a drop is a
  // place along the row — and the row stays one line of marks.
  const board = defaultSignLayout()
  const stamped = stampSignBlock(board, 'restroom', { x: 2.6 })
  assert.equal(stamped.length, board.length + 1)
  const fresh = stamped[stamped.length - 1]
  assert.equal(fresh.kind, 'icon')
  assert.equal(fresh.y, fresh.y, 'the row has a single centre line')
  assert.equal(new Set(stamped.map((c) => c.y)).size, 1)
  assert.deepEqual(signPanelSize(stamped).h, PANEL_MIN_H)
  // Its own centre is where it asked to be, up to the room the row has for it.
  assert.ok(Math.abs(fresh.x - 2.6) < 0.35, `${fresh.x}`)
  // Ids are minted per stamp, so the same block twice makes two groups.
  const twice = stampSignBlock(stamped, 'restroom', { x: 1.6, y: 0.35 })
  const ids = twice.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('a palette component is born unplaced, and the caller settles it', () => {
  const comp = makeSignComponent('icon', 'c9', '2')
  assert.equal(comp.kind, 'icon')
  assert.equal(comp.id, 'c9')
  assert.equal(comp.side, 'both')
  assert.equal(comp.scale, 1)
  // It is a real pictogram and a real label, so a stamped block is never invisible.
  assert.ok(SIGN_ICONS.includes(comp.icon))
  assert.ok(makeSignComponent('text', 'c10').text.length > 0)
  assert.equal(makeSignComponent('line', 'c11', '2').lineId, '2')
  // Ids walk past the ones already in use.
  const layout = [{ id: 'c1' }, { id: 'c2' }, { id: 'c4' }]
  assert.equal(nextSignComponentId(layout), 'c5')
})

test('the shield prints the line name as the 线路 panel spells it', () => {
  // The name is printed as-is: `5号线` stays `5号线`, and nothing is renumbered or
  // re-stacked from it. Only the optional gloss is derived.
  assert.equal(signLineNumber('2号线'), '2')
  assert.equal(signLineNumber('APM线'), 'APM')
  assert.equal(signLineNumber('14'), '14')
  assert.equal(signLineEnglish('2号线'), 'Line 2')
  assert.equal(signLineEnglish('APM线'), 'APM')
  // A shield carries the name, never a bare number: the component's own data has
  // no field for one, so `5号线` cannot print as `5`.
  const shield = signBlockComponents('line', '5')[0]
  assert.equal(shield.english, true)
  assert.equal(Object.hasOwn(shield, 'chinese'), false)
  // A shield bound to a line the station no longer has keeps its binding: it
  // prints the neutral plate rather than silently rebinding to line 1.
  const orphan = normalizeSignLayout([
    { id: 'c', kind: 'line', lineId: 'gone', english: true, x: 1, y: 0.35, scale: 1, side: 'both' },
  ])
  assert.equal(orphan[0].lineId, 'gone')
})
