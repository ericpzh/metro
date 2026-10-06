// Station-name calligraphy (装饰 站名, §5.7): the station's own name as an ink
// inscription on a wall.
//
// The piece holds **no text**. Everything about what it prints comes from two
// places — the hand and the axis on the module, and the station's name in the
// document — so the failures this file exists for are the silent ones:
//
//   * a panel cut to the wrong size (the name spills off it, or a three-character
//     name needs six metres of wall), which is a collision envelope and a wall
//     backing requirement, not just a look;
//   * an inscription whose ink is opaque, so the piece hangs a grey rectangle on
//     the wall instead of painting on it;
//   * a rename that never reaches the wall (the plate is retained by module id, so
//     nothing redraws unless `redrawDecorPlates` says so);
//   * a hand that prints the same as every other hand, which is the whole sub-menu.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  CALLIGRAPHY_ADVANCE,
  CALLIGRAPHY_AXIS_LABEL,
  CALLIGRAPHY_FALLBACK_NAME,
  CALLIGRAPHY_H,
  CALLIGRAPHY_MAX_CHARS,
  CALLIGRAPHY_PAD,
  CALLIGRAPHY_STYLES,
  CALLIGRAPHY_STYLE_LIST,
  CALLIGRAPHY_V,
  calligraphyBottom,
  calligraphyChars,
  calligraphyGeometry,
  calligraphyPanelSize,
  calligraphyStyle,
  isCalligraphyAxis,
  isCalligraphyStyle,
} from '../src/sim/calligraphy.ts'
import {
  autofaceWallMount,
  calligraphyCells,
  isWallMounted,
  moduleAt,
  moduleEnvelope,
  moduleFootprint,
  placementBlocked,
  wallMountCourses,
  wallMountMissing,
  wallSide,
} from '../src/sim/placement.ts'
import { createModule, toState } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { MODULE_OPTIONS, isCalligraphyType, isDecorType, isWallMountedType, moduleLabel } from '../src/app/store.ts'
import { sameSweepFamily, sweepFamily } from '../src/app/sweep.ts'
import { calligraphyPlate, calligraphyLayout, drawCalligraphyPanel } from '../src/render/calligraphyFace.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

/* ------------------------------------------------------------- the document */

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

/** The station the inscriptions are cut for: 动物园, the demo's own name. */
function station(name, modules = []) {
  return toState({ name, seed: 1, cells: walled(4), modules, lines: [LINE] })
}

/**
 * `cells` floor blocks at y = 0 with a wall column behind them at y = 1 standing
 * `courses` metres high: the wall a 站名 hangs on, and the courses every one of
 * them needs backed.
 */
function walled(courses = 4, cells = 6) {
  const out = []
  for (let x = 0; x < cells; x++) {
    out.push({ x, y: 0, z: 0, fill: 'solid' })
    for (let dz = 1; dz <= courses; dz++) out.push({ x, y: 1, z: dz, fill: 'solid' })
  }
  return out
}

/** A placed inscription of a hand and an axis, cut from a name — the factory's job. */
function placed(name, id, rot = 2, x = 2) {
  const doc = station(name)
  const mod = createModule(id, x, 0, 0, 'c-' + id, rot, undefined, 'up', 'lane', doc)
  assert.ok(mod, `${id} builds`)
  return mod
}

test('the six hands are six different faces, and the two axes are the two ways', () => {
  assert.equal(CALLIGRAPHY_STYLE_LIST.length, 6)
  assert.deepEqual(CALLIGRAPHY_STYLE_LIST, ['kai', 'xing', 'li', 'wei', 'hei', 'song'])
  assert.deepEqual(Object.keys(CALLIGRAPHY_STYLES).sort(), [...CALLIGRAPHY_STYLE_LIST].sort())
  const families = new Set(CALLIGRAPHY_STYLE_LIST.map((s) => CALLIGRAPHY_STYLES[s].family))
  assert.equal(families.size, 6, 'each hand names its own font stack, not one shared stack')
  const inks = new Set(CALLIGRAPHY_STYLE_LIST.map((s) => CALLIGRAPHY_STYLES[s].ink))
  assert.equal(inks.size >= 4, true, 'the hands print in their own inks')
  for (const s of CALLIGRAPHY_STYLE_LIST) {
    const spec = calligraphyStyle(s)
    assert.equal(spec.style, s)
    assert.ok(spec.label.length > 0, `${s} is named in the palette`)
    assert.ok(spec.strike >= 0 && spec.strike < 0.1, `${s}: the second strike is a hair, not a second character`)
    assert.equal('seal' in spec, false, `${s}: nothing is printed but the station's own name`)
  }
  assert.equal(calligraphyStyle('nonsense').style, 'kai', 'an unknown hand is 楷书')
  assert.equal(isCalligraphyStyle('li'), true)
  assert.equal(isCalligraphyStyle('nope'), false)
  assert.equal(isCalligraphyAxis('v'), true)
  assert.equal(isCalligraphyAxis('x'), false)
  assert.deepEqual(CALLIGRAPHY_AXIS_LABEL, { h: '横排', v: '竖排' })

  // One palette tile per hand × axis, and every tile's label says both.
  const tiles = MODULE_OPTIONS.filter((m) => isCalligraphyType(m.id))
  assert.equal(tiles.length, 12, 'six hands on two axes')
  for (const s of CALLIGRAPHY_STYLE_LIST) {
    for (const axis of ['h', 'v']) {
      const tile = tiles.find((t) => t.id === `calligraphy-${s}-${axis}`)
      assert.ok(tile, `${s} ${axis} has a tile`)
      assert.equal(tile.label, `${calligraphyStyle(s).label} ${CALLIGRAPHY_AXIS_LABEL[axis]}`)
    }
  }
  assert.equal(isDecorType('calligraphy-kai-h'), true)
  assert.equal(isWallMountedType('calligraphy-kai-h'), true)
  assert.equal(isWallMountedType('calligraphy-li-v'), true)
  assert.equal(moduleLabel('calligraphy'), '站名')
})

test('the characters are the station name, capped and never blank', () => {
  assert.deepEqual(calligraphyChars('动物园'), ['动', '物', '园'])
  assert.deepEqual(calligraphyChars('  汉溪长隆 '), ['汉', '溪', '长', '隆'], 'whitespace is not a character')
  assert.deepEqual(calligraphyChars(''), Array.from(CALLIGRAPHY_FALLBACK_NAME), 'a blank name still prints something')
  const long = calligraphyChars('一二三四五六七八九十')
  assert.equal(long.length, CALLIGRAPHY_MAX_CHARS, `a name past ${CALLIGRAPHY_MAX_CHARS} characters is cut`)
  // Astral characters are one character each, not two halves of a surrogate pair.
  assert.deepEqual(calligraphyChars('𠮷站'), ['𠮷', '站'])
})

test('the panel is cut for the name: whole cells across, one column down', () => {
  // 横排: the panel **is** its run, in whole cells, so the wall it needs is the wall it
  // draws. Three characters want three cells, not four.
  const three = calligraphyGeometry('动物园', 'h')
  assert.equal(three.cells, 3)
  assert.equal(three.panelW, 3)
  assert.equal(three.panelH, CALLIGRAPHY_H.panelH)
  // The characters are cut to the slot the panel leaves, so a short name nearly
  // reaches the largest size the panel cuts and a two-character name does reach it.
  assert.ok(three.ink < 0.85 && three.ink > 0.8, `three characters set at ${three.ink.toFixed(3)} m`)
  assert.equal(calligraphyGeometry('公园', 'h').ink, 0.85, 'a two-character name prints at the full size')
  // A longer name grows the panel until it reaches its ceiling, and then shrinks the
  // type instead of the wall.
  assert.equal(calligraphyGeometry('公园', 'h').cells, 3, '0.3 + 2 × 0.86 rounds up to three cells')
  assert.equal(calligraphyGeometry('园', 'h').cells, 2, 'and a single character to two')
  const five = calligraphyGeometry('动物园西站', 'h')
  assert.equal(five.cells, CALLIGRAPHY_H.maxCells, 'the panel stops at its ceiling')
  assert.ok(five.ink < 0.85, 'and the characters set smaller to fit it')
  const eight = calligraphyGeometry('一二三四五六七八', 'h')
  assert.equal(eight.cells, CALLIGRAPHY_H.maxCells)
  assert.ok(eight.ink < five.ink, 'the more characters, the smaller the type')
  assert.ok(eight.ink > 0.3, `still legible at the ceiling (${eight.ink.toFixed(3)} m)`)
  // Every character stays inside the panel it was cut for, at every length.
  for (const name of ['园', '公园', '动物园', '动物园西站', '一二三四五六七八']) {
    const geo = calligraphyGeometry(name, 'h')
    assert.ok(geo.ink * geo.chars.length <= geo.panelW - CALLIGRAPHY_PAD + 1e-9, `${name}: the run fits the panel`)
  }

  // 竖排: one cell wide, as tall as the name wants — up to the storey's own ceiling.
  const v = calligraphyGeometry('动物园', 'v')
  assert.equal(v.cells, 1)
  assert.equal(v.panelW, CALLIGRAPHY_V.panelW)
  assert.equal(v.panelH, CALLIGRAPHY_V.maxPanelH, 'three characters want more than the column holds')
  assert.equal(v.bottom, CALLIGRAPHY_V.bottom)
  assert.ok(v.bottom + v.panelH <= 3.0 + 1e-9, 'the column stops under the storey ceiling (3 m of air)')
  const short = calligraphyGeometry('园', 'v')
  assert.ok(short.panelH < CALLIGRAPHY_V.maxPanelH, 'a short column is only as tall as its characters')
  assert.ok(short.ink <= 0.85)
})

test('a panel is backed on exactly the courses it crosses', () => {
  // 横排 hangs at eye height: 1.5–2.5 m above the floor, so courses 1 and 2.
  assert.deepEqual(calligraphyGeometry('动物园', 'h').courses, [1, 2])
  assert.deepEqual(wallMountCourses(placed('动物园', 'calligraphy-kai-h')), [1, 2])
  // 竖排 climbs from 0.4 m: courses 0, 1 and 2.
  assert.deepEqual(calligraphyGeometry('动物园', 'v').courses, [0, 1, 2])
  assert.deepEqual(wallMountCourses(placed('动物园', 'calligraphy-kai-v')), [0, 1, 2])
  // A one-character column stops inside the first two courses, and asks for two.
  assert.deepEqual(calligraphyGeometry('园', 'v').courses, [0, 1])
  assert.equal(calligraphyBottom('h'), CALLIGRAPHY_H.bottom)
  assert.equal(calligraphyBottom('v'), CALLIGRAPHY_V.bottom)
})

test('the factory records the hand and the axis, and cuts the panel from the name', () => {
  const mod = placed('动物园', 'calligraphy-xing-v')
  assert.equal(mod.type, 'calligraphy')
  assert.deepEqual(mod.cfg, { style: 'xing', axis: 'v' })
  assert.equal(mod.w, 1, '竖排 is one cell wide')
  assert.equal(mod.panelH, CALLIGRAPHY_V.maxPanelH)
  const wide = placed('动物园', 'calligraphy-li-h')
  assert.deepEqual(wide.cfg, { style: 'li', axis: 'h' })
  assert.equal(wide.w, 3, 'a three-character name is three metres of wall')
  assert.equal(wide.panelH, 1)
  // An id the palette does not offer is refused; a bare `calligraphy` is the default.
  assert.equal(createModule('calligraphy-nope-h', 2, 0, 0, 'x', 2, undefined, 'up', 'lane', station('动物园')), null)
  const bare = createModule('calligraphy', 2, 0, 0, 'x', 2, undefined, 'up', 'lane', station('动物园'))
  assert.deepEqual(bare.cfg, { style: 'kai', axis: 'h' })
  // With no station document behind it (a line array), the piece is cut for the
  // fallback name — the same one `calligraphyChars` prints.
  const noDoc = createModule('calligraphy-kai-h', 2, 0, 0, 'x', 2, undefined, 'up', 'lane', [LINE])
  assert.equal(noDoc.w, calligraphyGeometry(CALLIGRAPHY_FALLBACK_NAME, 'h').cells)
})

test('an inscription reserves the band of wall it is written on', () => {
  const band = moduleEnvelope(placed('动物园', 'calligraphy-kai-h'))
  // 横排 at eye height: a thin slab on the wall from 1.5 m to 2.5 m above the floor,
  // which is why a bench against the same wall is not in its way…
  assert.ok(Math.abs(band.z0 - 2.2) < 1e-9 && Math.abs(band.z1 - 3.2) < 1e-9, `the band is 2.2–3.2 m (got ${band.z0}–${band.z1})`)
  assert.ok(band.y0 > 0.5 && band.y1 <= 1, 'and the housing keeps the wall’s own quarter of the cell')
  assert.deepEqual([band.x0, band.x1], [1, 4], 'three cells of run, centred on the hovered cell')
  const column = moduleEnvelope(placed('动物园', 'calligraphy-kai-v'))
  assert.ok(Math.abs(column.z0 - 1.4) < 1e-9 && Math.abs(column.z1 - 4.0) < 1e-9, `the column is 1.4–4.0 m (got ${column.z0}–${column.z1})`)
  // The panel's own width, not the cell: 竖排 never fills its column.
  // The run marches the way the model draws it — along −x at rot 2, from an anchor
  // placed so the run is centred on the cell the pointer was on.
  assert.deepEqual(calligraphyCells(placed('动物园', 'calligraphy-kai-h')), [
    [3, 0, 0],
    [2, 0, 0],
    [1, 0, 0],
  ])
  assert.deepEqual(moduleFootprint(placed('动物园', 'calligraphy-kai-v')), [[2, 0]])
})

test('a low inscription shares its cell with what stands under it, a tall piece does not', () => {
  const ink = placed('动物园', 'calligraphy-kai-h')
  const bench = { id: 'b', type: 'bench', x: 2, y: 0, z: 0, w: 1, cfg: {} }
  assert.equal(placementBlocked([ink], bench), false, 'a bench stands under the inscription')
  assert.equal(placementBlocked([bench], ink), false, 'either side of the pair')
  const tvm = { id: 't', type: 'tvm', x: 2, y: 0, z: 0, cfg: {} }
  assert.equal(placementBlocked([ink], tvm), true, 'a 1.9 m 售票机 reaches into the band')
  // The inscription is found from its own floor cell even though its body is in the
  // upper half of the storey — the piece a right-click has to reach.
  assert.equal(moduleAt([ink], 2, 0, 0)?.id, 'c-calligraphy-kai-h')
  assert.equal(moduleAt([ink], 1, 0, 0)?.id, 'c-calligraphy-kai-h', 'and from the far cell of its run')
})

test('the wall must back every course the inscription crosses', () => {
  const ink = placed('动物园', 'calligraphy-kai-h')
  // The band is written 1.2 m up, so it crosses the wall's 2nd and 3rd courses: a
  // one- or two-course wall stops below it, and a three-course wall (3 m, which is
  // what the 墙 tool lays) carries it.
  assert.equal(wallMountMissing(walled(1), ink), true)
  assert.equal(wallMountMissing(walled(2), ink), true)
  assert.equal(wallMountMissing(walled(3), ink), false)
  // A 竖排 column starts on the floor, so it wants the first course as well — and
  // reaches the third, because its panel is 2.6 m tall.
  const column = placed('动物园', 'calligraphy-kai-v')
  assert.equal(wallMountMissing(walled(2), column), true)
  assert.equal(wallMountMissing(walled(3), column), false)
  // The panel still turns itself to a wall that backs it, courses and all.
  const faced = autofaceWallMount(walled(3), { ...ink, rot: 0 })
  assert.equal(faced.rot, 2)
  assert.equal(isWallMounted(ink), true)
  assert.equal(isWallMounted({ type: 'linemap', cfg: { mount: 'stand' } }), false)
})

test('both axes round-trip the save, and a sweep keeps the hands apart', () => {
  const modules = [placed('动物园', 'calligraphy-kai-h'), placed('动物园', 'calligraphy-li-v', 2, 4)]
  const r = parse(serialize({ name: '动物园', seed: 1, cells: walled(4), modules, lines: [LINE] }))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, modules)
  assert.equal(sweepFamily(placed('动物园', 'calligraphy-kai-h')), 'calligraphy:kai:h')
  assert.equal(sameSweepFamily(placed('动物园', 'calligraphy-kai-h'), placed('动物园', 'calligraphy-kai-h', 0, 4)), true)
  assert.equal(sameSweepFamily(placed('动物园', 'calligraphy-kai-h'), placed('动物园', 'calligraphy-kai-v')), false, 'the axis is part of the piece')
  assert.equal(sameSweepFamily(placed('动物园', 'calligraphy-kai-h'), placed('动物园', 'calligraphy-song-h')), false, 'and so is the hand')
})

test('a different hand or axis is a different hover ghost', () => {
  // The ghost is skipped when its key matches the one already drawn, so the two
  // settings the piece carries have to be in it: otherwise picking 隶书 竖排 under the
  // pointer would keep drawing 楷书 横排.
  const kai = placed('动物园', 'calligraphy-kai-h')
  const li = placed('动物园', 'calligraphy-li-h')
  const vertical = placed('动物园', 'calligraphy-kai-v')
  assert.notEqual(moduleGhostKey(kai), moduleGhostKey(li), 'the hand is part of the ghost')
  assert.notEqual(moduleGhostKey(kai), moduleGhostKey(vertical), 'and so is the axis')
  assert.equal(moduleGhostKey(kai), moduleGhostKey(placed('动物园', 'calligraphy-kai-h')))
})

/* ---------------------------------------------------------------- the pixels */

/** Draw one inscription at a panel size and read back what it painted. */
function painted(name, axis, style, panel) {
  const { g, ops } = stubCanvas(Math.round(panel.w * 512), Math.round(panel.h * 512))
  // Where the ink was actually put: the drawing carries each character's place in the
  // canvas transform, so the recorded `fillText` calls are all at the origin and the
  // translations are the positions. Recording them is what keeps "the layout says
  // where the characters go" and "the drawing goes there" one check.
  const moves = []
  const ctx = new Proxy(g, {
    get: (t, k) => (k === 'translate' ? (x, y) => moves.push([x, y]) : t[k]),
  })
  const layout = drawCalligraphyPanel(ctx, { text: name, style, axis, panel })
  return { ops, layout, moves }
}

test('an inscription is ink on the wall: no ground, one strike per character', () => {
  const panel = { w: 3, h: 1 }
  const { ops, layout, moves } = painted('动物园', 'h', 'kai', panel)
  // **The station's name is the whole plate**: nothing fills at all, so the wall behind
  // the piece shows through everywhere the strokes do not cover it. A ground — or a red
  // seal stamped beside the characters — would hang something nobody asked for.
  assert.deepEqual(ops.filled, [], 'no ground and no seal: the ink is all there is')
  // Two passes per character: the ink, then its drier second strike.
  assert.deepEqual(ops.words.map((w) => w.text), ['动', '动', '物', '物', '园', '园'])
  const chars = layout.glyphs
  assert.equal(chars.length, 3)
  // The characters really are drawn where the layout puts them — at 512 px/m, in
  // reading order, out along the panel.
  assert.equal(moves.length, 3, 'one placement per character')
  assert.deepEqual(
    moves.map(([x]) => Math.round(x / 512)),
    chars.map((c) => Math.round(c.x)),
    'each character is drawn at its own slot',
  )
  assert.ok(moves[2][0] - moves[0][0] > 1.5 * 512, `the three characters span the panel (${(moves[2][0] - moves[0][0]).toFixed(0)} px)`)
  assert.equal(new Set(moves.map(([, y]) => Math.round(y / 512))).size, 1, 'and stay on one line')
  // Every character is inside the panel, left to right, on one line.
  const xs = chars.map((c) => c.x)
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, '横排 reads left to right')
  for (const c of chars) {
    assert.ok(c.x - c.size / 2 > -0.01 && c.x + c.size / 2 < panel.w + 0.01, `${c.char} is inside the panel`)
    assert.ok(Math.abs(c.y - panel.h / 2) <= panel.h * 0.05 + 1e-9, `${c.char} sits on the panel's centre line`)
    assert.equal(c.size, layout.glyphs[0].size, 'every character is cut at one size')
  }
  // The ink is the hand's own, and each word is set in that hand's own face at the
  // character's own size.
  assert.equal(ops.words[0].colour, CALLIGRAPHY_STYLES.kai.ink)
  assert.ok(ops.words[0].size > 200, `the character is drawn large (${ops.words[0].size} px)`)
})

test('竖排 writes down the wall, one column, same as 横排 reads across it', () => {
  const panel = { w: CALLIGRAPHY_V.panelW, h: CALLIGRAPHY_V.maxPanelH }
  const { ops, layout, moves } = painted('汉溪长隆', 'v', 'kai', panel)
  const ys = layout.glyphs.map((g) => g.y)
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, '竖排 reads top to bottom')
  // One column: the characters sit on its centre line, and only the wash moves them.
  for (const g of layout.glyphs) {
    assert.ok(Math.abs(g.x - panel.w / 2) <= panel.w * 0.03 + 1e-9, `${g.char} stays on the column's centre line`)
    assert.ok(g.y - g.size / 2 > 0 && g.y + g.size / 2 < panel.h, `${g.char} is inside the column`)
    assert.ok(g.size > 0.3, `${g.char} is legible (${g.size.toFixed(3)} m)`)
  }
  // Drawn down the wall, one character below the next, each within the column's width.
  assert.equal(new Set(moves.map(([, y]) => Math.round((y / 512) * 10))).size, 4, 'four rows, top to bottom')
  assert.deepEqual([...moves.map(([, y]) => y)].sort((a, b) => a - b), moves.map(([, y]) => y), 'in reading order')
  for (const [x] of moves) assert.ok(Math.abs(x / 512 - panel.w / 2) <= panel.w * 0.03 + 1e-9, 'inside the column')
  assert.equal(ops.words.filter((w) => w.text === '汉').length, 2, 'one strike and its drier pass, and nothing else')
})

test('a hand with no brush edge is one clean pass', () => {
  const { ops } = painted('动物园', 'h', 'hei', { w: 3, h: 1 })
  assert.deepEqual(ops.filled, [], 'nothing fills on any hand: the ink has no ground')
  assert.deepEqual(ops.words.map((w) => w.text), ['动', '物', '园'], 'one pass, no second strike')
  // Whereas 行书 leans and 隶书 is wide, and both strike twice.
  const xing = painted('动物园', 'h', 'xing', { w: 3, h: 1 })
  assert.equal(xing.ops.words.length, 6, 'two passes per character, and nothing else')
  const xingFaces = []
  const { g } = stubCanvas(64, 64)
  drawCalligraphyPanel(g, { text: '园', style: 'xing', axis: 'h', panel: { w: 2, h: 1 } })
  xingFaces.push(g.font)
  const { g: g2 } = stubCanvas(64, 64)
  drawCalligraphyPanel(g2, { text: '园', style: 'kai', axis: 'h', panel: { w: 2, h: 1 } })
  xingFaces.push(g2.font)
  assert.notEqual(xingFaces[0], xingFaces[1], 'two hands set two faces')
})

test('nothing but the name is printed, whatever the hand', () => {
  // The piece carries the station's name and nothing else: no seal, no plate, no
  // lettering of its own — every hand prints its characters in its own ink and stops.
  for (const style of CALLIGRAPHY_STYLE_LIST) {
    const { ops, layout } = painted('动物园', 'h', style, { w: 3, h: 1 })
    assert.deepEqual(ops.filled, [], `${style}: nothing is filled`)
    assert.deepEqual(
      [...new Set(ops.words.map((w) => w.text))],
      ['动', '物', '园'],
      `${style}: the station's three characters, and nothing else`,
    )
    assert.deepEqual(layout.glyphs.map((g) => g.char), ['动', '物', '园'])
    assert.ok(
      ops.words.every((w) => w.colour !== '#ffffff'),
      `${style}: no mark is printed in white (a seal would be)`,
    )
  }
})

test('the wash of the brush is a property of the text, not of the moment', () => {
  // A rebuild must reprint the same wall: the turn and the drift come from a hash of
  // the character and its place, so nothing twitches when the player clicks elsewhere.
  const a = calligraphyLayout(['动', '物', '园'], 'h', 'kai', { w: 3, h: 1 })
  const b = calligraphyLayout(['动', '物', '园'], 'h', 'kai', { w: 3, h: 1 })
  assert.deepEqual(a, b, 'the same name prints identically every time')
  const other = calligraphyLayout(['动', '物', '园'], 'h', 'kai', { w: 4, h: 1 })
  assert.notDeepEqual(a.glyphs.map((g) => g.x), other.glyphs.map((g) => g.x), 'a wider panel re-lays the run')
})

test('the plate is cut to the panel, and the ink is transparent', () => {
  assert.deepEqual(calligraphyPlate({ w: 3, h: 1 }), { width: 1536, height: 512 })
  assert.deepEqual(calligraphyPlate({ w: 0, h: 0 }), { width: 64, height: 64 }, 'never smaller than a stamp')
  assert.deepEqual(calligraphyPanelSize('h', 3, 1), { w: 3, h: 1 })
  assert.deepEqual(calligraphyPanelSize('v', 1, 2.6), { w: CALLIGRAPHY_V.panelW, h: 2.6 }, '竖排 takes its column width')
  assert.deepEqual(calligraphyPanelSize('h', 0, 0), { w: 1, h: 1 }, 'a degenerate panel falls back to the 1 m band')
})

/* ----------------------------------------------------------------- the model */

/** Build one inscription, recording the face the model asked the scene for. */
function build(mod, face) {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshBasicMaterial({ name: String(k) })) })
  const asked = []
  const group = buildModule(mod, {
    mats,
    data: station('动物园'),
    trackCells: new Set(),
    finish: () => mats.steel,
    calligraphyFace: (id, spec) => {
      asked.push({ id, ...spec })
      return face ? { material: face } : { material: new THREE.MeshBasicMaterial({ name: 'ink' }) }
    },
  })
  const meshes = []
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o)
  })
  return { mats, meshes, asked, group }
}

test('the model hangs the live station name on the wall it is bolted to', () => {
  const mod = placed('动物园', 'calligraphy-li-v')
  const { meshes, asked } = build(mod)
  assert.equal(asked.length, 1, 'one plate per piece')
  assert.equal(asked[0].id, mod.id, 'keyed by the module, so the scene can retain it')
  assert.deepEqual(asked[0].panel, { w: CALLIGRAPHY_V.panelW, h: CALLIGRAPHY_V.maxPanelH })
  assert.equal(asked[0].style, 'li')
  assert.equal(asked[0].axis, 'v')
  // One plane, hung on the local −y wall and printing into the room: at rot 2 the wall
  // is the +y neighbour, so the ink faces −y — away from its own backing and into the
  // room the piece was hung for.
  assert.equal(meshes.length, 1)
  const ink = meshes[0]
  assert.equal(ink.geometry.type, 'PlaneGeometry')
  assert.equal(ink.userData.calligraphy, true, 'the ink is marked, so a test can find it')
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(ink.getWorldQuaternion(new THREE.Quaternion()))
  const wall = wallSide(mod.rot)
  assert.ok(normal.x * wall[0] + normal.y * wall[1] < -0.99, `the ink prints away from its wall (normal ${normal.x.toFixed(2)},${normal.y.toFixed(2)})`)
  const world = ink.getWorldPosition(new THREE.Vector3())
  assert.ok(world.y > 0.9 && world.y < 1, `hangs beside the wall at +y, not on the cell centre line (y ${world.y})`)
  // At the panel's own height: the column the wall-backing rule reserves.
  const bottom = calligraphyBottom('v')
  assert.ok(Math.abs(ink.position.z - (bottom + mod.panelH / 2)) < 1e-6, 'centred on the band it reserves')
})

test('a ctx with no scene behind it still draws an inscription', () => {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshBasicMaterial({ name: String(k) })) })
  let meshes = 0
  const group = buildModule(placed('动物园', 'calligraphy-kai-h'), {
    mats,
    data: { name: '动物园', seed: 1, cells: [], modules: [], lines: [] },
    trackCells: new Set(),
    finish: () => mats.steel,
  })
  group.traverse((o) => {
    if (o.isMesh) meshes++
  })
  assert.equal(meshes, 1, 'the kit’s own ink is the fallback, so the piece is never invisible')
})

/* ------------------------------------------------------------- the scene plate */

/**
 * The scene's own plate cache, driven the way `ModuleSystem` drives it. This is the
 * other half of "the name is not on the piece": the texture is **retained** by module
 * id across rebuilds, so a rename only reaches the wall if `redrawDecorPlates`
 * repaints it in place — and a piece whose hand changed needs a new texture rather
 * than a repaint.
 */
async function plateRig(name, mod) {
  const canvases = []
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') return { style: {}, appendChild: () => {}, setAttribute: () => {} }
      const { g, ops } = stubCanvas()
      const c = { width: 0, height: 0, ops, getContext: () => g, toDataURL: () => 'data:,' }
      g.canvas = c
      canvases.push(c)
      return c
    },
  }
  const { PlateSystem } = await import('../src/render/scene/systems/PlateSystem.ts')
  const data = { name, seed: 1, cells: [], modules: [mod], lines: [LINE] }
  const plates = new PlateSystem({ stationData: data })
  return { plates, data, canvases }
}

test('a rename reprints every inscription already on the wall', async () => {
  const mod = placed('动物园', 'calligraphy-kai-h')
  const { plates, data, canvases } = await plateRig('动物园', mod)
  const spec = { style: 'kai', axis: 'h', panel: { w: 3, h: 1 } }
  const first = plates.makeCalligraphyPlate(mod.id, spec)
  assert.equal(first.material.transparent, true, 'the ink is transparent: the wall is the paper')
  assert.equal(first.material.isMeshBasicMaterial, true, 'a material, not a bare texture — a mesh cannot draw a texture')
  assert.ok(first.texture, 'and the pixels it minted are named, so the plate can be repainted')
  const canvas = canvases[0]
  assert.deepEqual([...new Set(canvas.ops.words.map((w) => w.text))], ['动', '物', '园'], 'the wall prints the station’s name')
  // The rename: the plate is retained (same key), so the redraw is what carries it.
  // The canvas stub records rather than rasterises, so its record is emptied by hand
  // where the real canvas is emptied by the `clearRect` a groundless plate needs.
  data.name = '汉溪长隆'
  canvas.ops.words.length = 0
  plates.redrawDecorPlates()
  assert.deepEqual([...new Set(canvas.ops.words.map((w) => w.text))], ['汉', '溪', '长', '隆'], 'the wall reprints itself')
  assert.equal(canvases.length, 1, 'in place: the allocation is kept, not re-minted')
  // The piece’s own key is what a rebuild retains on, and a different hand is a
  // different plate rather than a repaint of this one.
  assert.equal(plates.makeCalligraphyPlate(mod.id, spec).material, first.material, 'the same piece and hand hands back the same face')
  const other = plates.makeCalligraphyPlate(mod.id, { ...spec, style: 'li' })
  assert.notEqual(other.material, first.material, 'a different hand is a different face')
  plates.retainDecorPlates({ ...data, modules: [] })
  assert.equal(plates.decorPlates.size, 0, 'a piece the document no longer holds releases its plate')
})

