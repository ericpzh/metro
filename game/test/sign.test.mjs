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
import {
  autofaceWallMount,
  ceilingMountMissing,
  equipmentRefusalNotice,
  equipmentReason,
  isCeilingHung,
  isWallMounted,
  moduleAt,
  moduleBlockedCells,
  moduleEnvelope,
  placementBlocked,
  wallMountCourses,
  wallMountMissing,
} from '../src/sim/placement.ts'
import { createModule, toState } from '../src/build/model.ts'
import { ensureSignLayouts } from '../src/build/model/Equipment.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { sameSweepFamily, sweepFamily } from '../src/app/sweep.ts'
import { MODULE_OPTIONS, isSignType } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import {
  PANEL_END_PAD,
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
  SIGN_MOUNTS,
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
  signLayoutCarried,
  signLayoutInOrder,
  signLayoutInserted,
  signLayoutMoved,
  signLineEnglish,
  signLineNumber,
  signMarkFits,
  signMountOf,
  signMountSpec,
  isSignMount,
  isWallSignMount,
  signPanelSize,
  signPieceSize,
  signPieces,
  signPlate,
  signTextLineScale,
  signTextIsGloss,
  signTextLines,
  signTextSize,
  signWallCourses,
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
/**
 * A 指示牌 on its **wall** mount: the same board bolted flat to the wall on the
 * piece's local −y face. Its faces are stated rather than composed — every rule in the
 * first half of this file is about the piece, not about what is printed on it.
 */
const wallSign = (x, y, z, id = 'sign-w', rot = 0) => ({ id, type: 'sign', x, y, z, rot, cfg: { mount: 'wall', front: [], back: [] } })
/** The two boards a wall board has no use for: only the hung one mounts a back. */
const SIGN_BACKLESS_FRONT = [{ id: 'c1', kind: 'icon', icon: 'exit', x: 0.5, y: 0.35, scale: 1, side: 'both' }]
const SIGN_BACK = [{ id: 'c1', kind: 'text', text: '电梯', x: 0.5, y: 0.35, scale: 1, side: 'both' }]

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

test('the piece is created with the mount its palette tile names', () => {
  // Two mounts, in palette order, and one piece: the mount travels in `cfg` so every
  // rule below can ask the module rather than the id it was armed with.
  assert.deepEqual(SIGN_MOUNTS, ['ceiling', 'wall'])
  assert.deepEqual(MODULE_OPTIONS.filter((m) => isSignType(m.id)).map((m) => m.id), ['sign-ceiling', 'sign-wall'])
  assert.equal(isSignMount('wall'), true)
  assert.equal(isSignMount('floor'), false)
  assert.equal(signMountOf({ mount: 'floor' }), 'ceiling', 'an unknown mount is the hung board')
  assert.equal(signMountOf(undefined), 'ceiling')
  assert.equal(createModule('sign', 1, 2, 3, 's', 1)?.cfg.mount, 'ceiling', 'a bare type is the overhead board')
  assert.equal(createModule('sign-ceiling', 1, 2, 3, 's', 1)?.cfg.mount, 'ceiling')
  assert.equal(createModule('sign-wall', 1, 2, 3, 's', 1)?.cfg.mount, 'wall')
  // ...and only the hung board gets a second face to print on.
  const boards = { front: SIGN_BACKLESS_FRONT, back: SIGN_BACK }
  const wall = createModule('sign-wall', 1, 2, 3, 'w', 0, undefined, 'up', 'lane', [LINE_2], boards)
  const hung = createModule('sign-ceiling', 1, 2, 3, 'c', 0, undefined, 'up', 'lane', [LINE_2], boards)
  assert.ok(wall.cfg.front.length > 0, 'a wall board is composed on its one face')
  assert.deepEqual(wall.cfg.back, [], 'and carries no back: the wall is behind it')
  assert.ok(hung.cfg.back.length > 0, 'the hung board carries both faces')
})

test('a 指示牌 is wall-mounted on its wall mount, and never on its ceiling one', () => {
  // No wall behind them; the ceiling rule is the only one that applies — to the hung
  // board, whose mount is the one it has always had.
  assert.equal(wallMountMissing([slab(2, 3, 0)], sign(2, 3, 0)), false)
  assert.equal(wallMountMissing([slab(2, 3, 0)], tv(2, 3, 0)), false)
  assert.equal(isWallMounted(sign(2, 3, 0)), false)
  assert.equal(isCeilingHung(sign(2, 3, 0)), true)
  // ...and the opposite for the **wall** board: bolted to a wall, and hanging on
  // nothing, so a cell with open sky over it is exactly where it belongs.
  const wall = wallSign(2, 3, 0)
  assert.equal(isWallMounted(wall), true)
  assert.equal(isCeilingHung(wall), false)
  assert.equal(ceilingMountMissing([slab(2, 3, 0)], wall), false, 'a wall board hangs from nothing')
  assert.equal(wallMountMissing([slab(2, 3, 0)], wall), true, 'and with no wall it has nowhere to be')
})

test('a wall 指示牌 is backed on the one wall course its panel crosses', () => {
  // The board is 0.7 m tall and sits at 1.65 m, so it crosses the wall's **second**
  // course — the band from 2 to 3 m above the floor top — and nothing else.
  assert.deepEqual(signWallCourses('wall'), [1])
  assert.deepEqual(wallMountCourses(wallSign(2, 3, 0)), [1])
  assert.deepEqual(signWallCourses('ceiling'), [], 'the hung board asks the ceiling for air, not the wall for stone')
  const floor = slab(2, 3, 0)
  assert.equal(wallMountMissing([floor], wallSign(2, 3, 0)), true, 'no wall at all')
  assert.equal(wallMountMissing([floor, slab(2, 2, 1)], wallSign(2, 3, 0)), true, 'a wall one course tall is not enough')
  assert.equal(wallMountMissing([floor, slab(2, 2, 1), slab(2, 2, 2)], wallSign(2, 3, 0)), false, 'two courses back it')
  // The wall is the piece's own local −y face, so a quarter turn asks for backing on
  // another side of the cell (`wallSide`: rot 0 → −y, 1 → +x).
  assert.equal(wallMountMissing([floor, slab(3, 3, 1), slab(3, 3, 2)], wallSign(2, 3, 0, 'sign-w', 1)), false)
  assert.equal(wallMountMissing([floor, slab(2, 2, 1), slab(2, 2, 2)], wallSign(2, 3, 0, 'sign-w', 1)), true)
  // ...which is why the panel turns itself to the wall that backs it, exactly as a
  // 广告牌 does: which way a bolted board faces is the wall's answer, never the
  // player's, so the tool never has to ask for R first.
  const faced = autofaceWallMount([floor, slab(2, 2, 1), slab(2, 2, 2)], wallSign(2, 3, 0, 'sign-w', 3))
  assert.equal(faced.rot, 0, 'the piece is turned to face the wall that backs it')
})

test('a wall 指示牌 reserves a slab on its wall, not the whole storey column', () => {
  const wall = wallSign(2, 3, 0)
  const hung = sign(2, 3, 0)
  assert.deepEqual(moduleEnvelope(wall), { x0: 2, y0: 3, z0: 2.3, x1: 3, y1: 3.25, z1: 3 })
  assert.deepEqual(moduleEnvelope(hung), { x0: 2, y0: 3, z0: 1, x1: 3, y1: 4, z1: 4 }, 'the hung board keeps its column')
  // It is found from the floor cell it hangs over, like every other piece.
  assert.equal(moduleAt([wall], 2, 3, 0)?.id, 'sign-w')
  // A 座椅 on the floor **under** it shares the tile — the panel is two metres up and a
  // bench is one metre tall — while a 售票机 tall enough to reach the panel is in its way.
  assert.equal(placementBlocked([wall], createModule('bench', 2, 3, 0, 'b', 0)), false)
  assert.equal(placementBlocked([wall], createModule('tvm', 2, 3, 0, 't', 0)), true)
  // Two wall boards in one cell want the same slab of wall, so they collide.
  assert.equal(placementBlocked([wall], wallSign(2, 3, 0, 'sign-w2')), true)
  assert.equal(placementBlocked([wall], wallSign(3, 3, 0, 'sign-w3')), false, 'a cell along is free')
  // The course the panel covers is not the block brush's to lay — the wall has to be
  // there first — while the storey the hung board holds is the wall board's no longer.
  assert.equal(moduleBlockedCells([wall], 2).has('2,3,2'), true, 'the panel’s own course is spoken for')
  assert.equal(moduleBlockedCells([hung], 2).has('2,3,2'), true)
  assert.equal(moduleBlockedCells([wall], 1).has('2,3,1'), false, 'the course under the panel is still the room’s')
  assert.equal(moduleBlockedCells([hung], 1).has('2,3,1'), true, 'which is what the hung board’s column reserves')
})

test('the placement verdict answers each mount by its own rules', () => {
  const floor = slab(2, 3, 0)
  const wall = [slab(2, 2, 1), slab(2, 2, 2)]
  const hung = sign(2, 3, 0)
  assert.equal(equipmentReason([floor, ...wall], [], hung, true), 'ceiling', 'the hung board still wants its slab')
  assert.equal(equipmentReason([floor, ...wall], [], wallSign(2, 3, 0), true), '', 'the wall board is happy on a wall with open sky over it')
  assert.equal(equipmentReason([floor], [], wallSign(2, 3, 0), true), 'wall')
  // The tool is armed with a **palette id** before there is a module to ask, so the two
  // tiles answer for their own mounts — a `sign-ceiling` ghost hangs, a `sign-wall` one
  // bolts to the wall.
  assert.equal(isCeilingHung({ type: 'sign' }), true)
  assert.equal(isCeilingHung({ type: 'sign-ceiling' }), true)
  assert.equal(isCeilingHung({ type: 'sign-wall' }), false)
  assert.equal(isCeilingHung({ type: 'tv' }), true)
  assert.equal(isCeilingHung(createModule('sign-wall', 2, 3, 0, 'w', 0)), false)
})

test('a ceiling-hung piece envelope is the whole storey column', () => {
  for (const hung of [sign(2, 3, 0), tv(2, 3, 0)]) {
    const box = moduleEnvelope(hung)
    assert.deepEqual(box, { x0: 2, y0: 3, z0: 1, x1: 3, y1: 4, z1: 4 })
    // It is found from its floor cell, and that cell is its own: a second hung
    // piece — the one thing that really wants the same air — is refused there.
    assert.equal(moduleAt([hung], 2, 3, 0)?.type, hung.type)
    const other = hung.type === 'sign' ? tv(2, 3, 0, 'other') : sign(2, 3, 0, 'other')
    assert.equal(placementBlocked([hung], other), true)
    // A piece standing on the floor shares the tile: the sign hangs over it.
    assert.equal(placementBlocked([hung], gate(2, 3, 0)), false)
    // Adjacent cells stay free.
    assert.equal(placementBlocked([hung], gate(3, 3, 0)), false)
  }
})

test('a wall 指示牌 round-trips the save, and the two mounts are two pieces to a sweep', () => {
  const placed = createModule('sign-wall', 2, 3, 0, 'sign-w', 0, undefined, 'up', 'right', [LINE_2])
  const ceiling = createModule('sign-ceiling', 2, 3, 0, 'sign-c', 0, undefined, 'up', 'right', [LINE_2])
  // The mount survives the load path, which repairs a sign's boards: the repair writes
  // the pair and never the mount (`ensureSignLayouts`).
  const st = toState({
    name: 't',
    seed: 1,
    cells: [slab(2, 3, 0), slab(2, 2, 1), slab(2, 2, 2)],
    modules: [placed],
    lines: [LINE_2],
  })
  const r = parse(serialize(st))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, st.modules)
  assert.equal(r.state.modules[0].cfg.mount, 'wall', 'the mount survives the save')
  // A sweep takes the boards of one mount and leaves the other: a drag over the hung
  // ones must not bulldoze the wall board on the same wall.
  assert.equal(sweepFamily(placed), 'sign:wall')
  assert.equal(sweepFamily(ceiling), 'sign:ceiling')
  assert.equal(sweepFamily(sign(2, 3, 0)), 'sign:ceiling', 'a legacy sign with no mount is the hung one')
  assert.equal(sameSweepFamily(placed, ceiling), false)
  assert.equal(sameSweepFamily(placed, createModule('sign-wall', 4, 3, 0, 'sign-w9', 0)), true)
  // ...and so does the hover ghost: the two mounts draw differently, so a palette click
  // between them has to rebuild the piece under the pointer.
  assert.notEqual(moduleGhostKey(placed), moduleGhostKey(ceiling))
  assert.equal(moduleGhostKey(sign(2, 3, 0)), moduleGhostKey(ceiling), 'the bare type is the hung tile')
})

test('the mount vocabulary reads an id and a legacy save the way the piece does', () => {
  // The predicate the editor and the model ask (`isWallSignMount`), for the three
  // spellings a mount arrives in: the two named, and anything else — a save from before
  // the wall board existed, or a value no version ever wrote — which is the hanging board.
  assert.equal(isWallSignMount('wall'), true)
  assert.equal(isWallSignMount('ceiling'), false)
  assert.equal(isWallSignMount(undefined), false, 'a save with no mount is the overhead board')
  assert.equal(signMountSpec(undefined).hung, true)
  assert.equal(signMountSpec('wall').hung, false)
  assert.equal(signMountSpec(undefined).doubleSided, true, 'and the hanging board is the two-faced one')
  assert.equal(signMountSpec('wall').doubleSided, false)
  // The palette tiles are built from that table, so the labels are its own words.
  const tiles = MODULE_OPTIONS.filter((m) => isSignType(m.id))
  assert.deepEqual(tiles.map((m) => m.label), [signMountSpec('ceiling').label, signMountSpec('wall').label])

  // A **legacy save** — a single `components` list, and now a mount — is repaired to the
  // pair *and keeps the mount it was written with*, wall board included: the repair writes
  // the boards, never the mount.
  const legacy = {
    id: 'sign-legacy',
    type: 'sign',
    x: 2,
    y: 3,
    z: 0,
    rot: 0,
    cfg: { mount: 'wall', components: [{ ...SIGN_BACKLESS_FRONT[0], id: 'c1', side: 'front' }] },
  }
  const repaired = ensureSignLayouts([legacy], [LINE_2])[0]
  assert.equal(repaired.cfg.mount, 'wall', 'the repair keeps the mount')
  assert.ok(repaired.cfg.front.length > 0, 'and folds the legacy list onto the front')
  assert.equal(repaired.cfg.components, undefined, 'the legacy list is dropped rather than carried along')

  // The refusal notices name each mount, because the two are refused for opposite
  // reasons: no backing for the wall board, no slab overhead for the hanging one.
  assert.match(equipmentRefusalNotice('wall'), /墙面指示牌/)
  assert.match(equipmentRefusalNotice('ceiling'), /吊挂指示牌/)
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
  // Six arrows need the ceiling to move: 3.24 m of row plus a quiet end pad at each
  // end is 3.48 m of steel, and a board narrower than that cannot hold them centred.
  // The ceiling is what makes that possible, so it is stated here rather than left to
  // be rediscovered — a ceiling that squeezes a legal row leaves the print off centre,
  // which is the report this file's render tests pin (`sign-render.test.mjs`).
  assert.ok(arrowPanel.w >= 3.48 - 0.05, `six arrows are given their own steel: ${arrowPanel.w} m`)

  // A smaller mark fits more — the rule is width, not kind. (A shield is 0.42 m of ink
  // to an arrow's 0.48, so a seventh still lands inside the ceiling.)
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

test('room is a question about the board and the mark, not about where the mark has been', () => {
  // The bug this pins: a mark carried off **背面** into **正面** was refused with "这块牌子放不下了"
  // while the very same mark, dragged in from the palette, was taken — on a board with room
  // for it. Two things made the answer depend on where the mark came from, and both were the
  // *mark's own state* leaking into a question about the board:
  //
  //   * its `x` — the place it held on the row it was leaving, which scattered the pack: the
  //     gaps the spread implies are not room a new mark can use, and a request that lands
  //     near the ceiling is folded back onto a neighbour there;
  //   * its `id` — a board numbers its own marks from `c1`, so the two boards are full of the
  //     same names, and the pack (which is keyed by id) read two marks of one name as two
  //     marks in one place.
  const arrow = (id, x = 0) => ({ id, kind: 'arrow', arrow: 'up', x, y: 0.35, scale: 1, side: 'both' })
  const board = settleSignLayout([arrow('c1'), arrow('c2'), arrow('c3')]).layout
  const fromPalette = arrow('drag', 0)
  assert.ok(signMarkFits(board, fromPalette), 'a fourth arrow from the palette fits three')

  // Carried across from the other row, the mark is the same mark: same arrow, name from the
  // board it is leaving, place from the row it was on.
  for (const id of ['c1', 'c2', 'c3']) {
    for (const x of [0.165, 0.495, 1.485, 3.135]) {
      const carried = arrow(id, x)
      assert.equal(
        signMarkFits(board, carried),
        true,
        `the same arrow carried over (id ${id}, x ${x}) fits three: the answer may not depend on where it stands`,
      )
    }
  }

  // And a board that really is full still refuses both, on the same reasoning. The count
  // is **asked of the model** rather than stated here: how many marks a board holds
  // depends on how wide they are, and a vertical arrow's box is the horizontal mark's
  // turned with it (`signInkSize`) — so the number is a property of the board and the
  // mark, which is the whole point of `signMarkFits`.
  let full = []
  for (let n = 1; n <= SIGN_COMPONENT_MAX + 2; n++) {
    const next = arrow(`f${n}`)
    if (!signMarkFits(full, next)) break
    full = settleSignLayout([...full, next]).layout
  }
  assert.ok(full.length >= 3, `${full.length} arrows fill a board`)
  assert.equal(signMarkFits(full, fromPalette), false, 'one more from the palette is refused')
  assert.equal(signMarkFits(full, arrow('f3', 0.99)), false, 'and so is one more carried off the other row')
})

test('a pack places by the place in the list, not by the name on the mark', () => {
  // Two boards number their own marks from `c1`, so a row of marks from *both* boards — which
  // is exactly what `signMarkFits` lays out to ask about room — holds a repeated id. Keyed by
  // id, the pack gave both marks of one name the *same* `x` (`c2` came back twice, at the
  // place the first of them had been given), which reads as a row that has already folded two
  // marks onto one place.
  const arrow = (id) => ({ id, kind: 'arrow', arrow: 'up', x: 0, y: 0.35, scale: 1, side: 'both' })
  const row = packSignRow([arrow('c1'), arrow('c2'), arrow('c3'), arrow('c2')])
  assert.equal(row.length, 4, 'every mark in the list is placed')
  const xs = row.map((c) => c.x)
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'and they stand in the order they were listed')
  const boxes = signPieces(row, signPanelSize(row))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const ox = Math.min(boxes[i].left + boxes[i].w, boxes[j].left + boxes[j].w) - Math.max(boxes[i].left, boxes[j].left)
      assert.ok(ox <= 1e-6, `marks ${i} (${row[i].id}) and ${j} (${row[j].id}) share ${ox.toFixed(3)} m`)
    }
  }
})

test('a settled board refuses the mark that would stack, not only the one that would overhang', () => {
  // The editor settles the row after every drop, so the marks a real board holds carry
  // resolved `x` positions instead of all asking for 0. That is the case the count above
  // cannot reach: the incoming mark asks for `x = 0`, so the pack always finds *it* room
  // at the row's start and pushes the settled marks along instead — and the two it then
  // piles at the ceiling are marks the caller never looked at. Asking the packed row
  // rather than the added mark's own slot is what refuses the drop.
  const mark = (n) => ({ id: `s${n}`, kind: 'arrow', x: 0, y: 0.35, scale: 1, side: 'both' })
  let layout = []
  for (let n = 1; n <= SIGN_COMPONENT_MAX + 2; n++) {
    const comp = mark(n)
    if (!signMarkFits(layout, comp)) break
    layout = settleSignLayout([...layout, comp]).layout
  }
  assert.equal(layout.length, 6, `${layout.length} arrows fit once the row is settled`)
  const boxes = signPieces(packSignRow(layout), signPanelSize(packSignRow(layout)))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const ox = Math.min(boxes[i].left + boxes[i].w, boxes[j].left + boxes[j].w) - Math.max(boxes[i].left, boxes[j].left)
      assert.ok(ox <= 1e-6, `marks ${i} and ${j} share ${ox.toFixed(3)} m`)
    }
  }
})

test('both black ends of a board match', () => {
  const ends = (layout) => {
    const settled = settleSignLayout(layout)
    const lefts = settled.layout.map((c) => c.x - signPieceSize(c).w / 2)
    const rights = settled.layout.map((c) => c.x + signPieceSize(c).w / 2)
    return { left: Math.min(...lefts), right: settled.panel.w - Math.max(...rights) }
  }
  // The pack starts the row one end pad from the frame and the panel ends one
  // pad past the last mark — the panel's 5 cm rounding is the only slack, so
  // the back face mirrors the same ends. (A board shorter than the floor keeps
  // its slack on the right; these boards all outgrow it.)
  const station = { lines: [LINE_2] }
  const fresh = defaultSignLayout(station)
  for (const [name, layout] of [
    ['fresh', fresh],
    ['grown', stampSignBlock(fresh, 'text', { x: 3.0 })],
    ['stored', settleSignBoards({ front: fresh, back: [] }).front],
  ]) {
    const e = ends(layout)
    assert.ok(Math.abs(e.left - PANEL_END_PAD) < 0.03, `${name} leading ${e.left}`)
    assert.ok(Math.abs(e.right - PANEL_END_PAD) < 0.03, `${name} trailing ${e.right}`)
    assert.ok(Math.abs(e.left - e.right) < 0.03, `${name} ends differ: ${e.left} vs ${e.right}`)
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

test('a label is 中文 of eight and English of sixteen, and no more', () => {
  assert.deepEqual(signTextLines('出站方向'), ['出站方向'])
  assert.deepEqual(signTextLines('换乘二号线\n请往前走'), ['换乘二号线', '请往前走'])
  // The name is cut to its own limit, the gloss to its longer one, and a third
  // line is dropped.
  const long = signTextLines('123456789012\nabcdefghijklmnopqrs\nthird')
  assert.deepEqual(long, ['12345678', 'abcdefghijklmnop'])
  // A lone line may be the gloss with no name above it, so it keeps the gloss
  // limit rather than being cut to the name's.
  assert.deepEqual(signTextLines('abcdefghijklmnopqrs'), ['abcdefghijklmnop'])
  assert.equal(signTextLines('').length, 0)
  assert.equal(signTextLines('a\n\nb').length, 2)
})

test('a label sets its English gloss small, so one box carries both languages', () => {
  // The board's one text box is 中文 over English: the 中文 row is full size and the
  // English one is the gloss, at the one ratio the model, the renderer and the
  // editor's tiles all read.
  assert.equal(signTextLineScale(0, '出站'), 1)
  assert.equal(signTextLineScale(1, 'Exit'), SIGN_TEXT_EN_SCALE)
  // The scale is asked about the row's **own text**, not about its place in the label:
  // a 中文 row is full size wherever it sits, and an English-only label is a gloss
  // even though it is the first row — the editor's two boxes are 中文 over English, but
  // a *one-row* label is whatever the player typed into them.
  assert.equal(signTextLineScale(1, '出站'), 1, 'a 中文 second row is not a gloss')
  assert.equal(signTextLineScale(0, 'Exit'), 1, 'the name row is the name row')
  assert.equal(signTextLineScale(1, 'Towards Jiaokou'), SIGN_TEXT_EN_SCALE)
  assert.equal(signTextIsGloss('Towards Jiaokou'), true)
  assert.equal(signTextIsGloss('Exit'), true)
  assert.equal(signTextIsGloss('5号线'), false)
  assert.equal(signTextIsGloss('Line 5'), true)
  assert.equal(signTextIsGloss('APM线'), false)
  assert.equal(signTextIsGloss(''), true)
  // The English is sized by the **ink the eye reads**, not by em: a Latin cap-height is
  // about 0.72 of an em while a CJK glyph fills its box, so the gloss has to set well
  // under the 中文 to stop reading as a second headline.
  assert.ok(SIGN_TEXT_EN_SCALE > 0.4 && SIGN_TEXT_EN_SCALE < 0.8, `${SIGN_TEXT_EN_SCALE}`)
  assert.ok(SIGN_TEXT_EN_SCALE <= 0.55, `the gloss must not outweigh the 中文 it sits under: ${SIGN_TEXT_EN_SCALE}`)

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
  // The row the **drawing** sets is the row the **measurement** priced: the renderer
  // reads the same function (`render/signFace.ts`), and a label whose gloss was
  // measured at one size and printed at another overran the board it was packed onto.
  const glossAtHalf = signInkSize({ id: 'g', kind: 'text', text: '方向\nDirection', x: 1, y: 0.35, scale: 1, side: 'both' }, measured)
  const directionAtFull = measured('Direction', size)
  assert.ok(glossAtHalf.w < directionAtFull, `the gloss must not be priced at full size: ${glossAtHalf.w} vs ${directionAtFull}`)
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
  // is over, at the place it was dropped. It is written as one statement over the pair
  // (`signLayoutCarried`) — take it out of one list, put it into the other — which is what
  // keeps the two boards from ever both holding it, or neither. This is the model half of
  // that; the gesture itself is exercised in the browser.
  const boards = settleSignBoards({
    front: [
      makeSignComponent('arrow', 'a1'),
      makeSignComponent('icon', 'a2'),
      makeSignComponent('arrow', 'a3'),
    ],
    back: [],
  })
  const carried = boards.front[1]
  const first = signLayoutCarried(boards.front, boards.back, carried.id, 0)
  const moved = { front: first.source, back: first.target }

  assert.equal(moved.front.length, 2, 'the board it left is one shorter')
  assert.equal(moved.back.length, 1, 'the board it joined is one longer')
  assert.ok(!moved.front.some((c) => c.id === carried.id), 'and it is no longer on the board it left')
  assert.equal(moved.back[0].kind, carried.kind, 'the board it joined holds the mark itself')
  // Aimed at the start of the shorter board, it *is* the start: the row states each mark's
  // place, so the drop lands where the pointer was and not merely somewhere on the board.
  assert.ok(moved.back[0].x <= moved.front[0].x + 1e-9, `dropped at the start: ${moved.back[0].x}`)
  // The mark is a **new mark** on the board it joins, and the caller is told what it is
  // called there: a drag follows its mark by id from one pointer move to the next.
  assert.equal(moved.back[0].id, first.id, 'the returned id is the one the mark now carries')
  assert.notEqual(first.id, carried.id, 'a mark that changes boards is renamed to a free id there')

  // Carried back, the pair is whole again — and the mark is counted once throughout.
  const second = signLayoutCarried(moved.back, moved.front, first.id, 1)
  const returned = { front: second.target, back: second.source }
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

  // **The rows are numbered independently, so they are full of the same names**: three marks
  // on each board are `c1`, `c2`, `c3` twice over. A mark handed over as it stands is a second
  // `c2` in the row it joins — and taking it off the board it was *joining* (a filter by an id
  // both boards hold) deletes that board's own mark instead: a drag that eats a neighbour and
  // puts nothing in its place. The carry is written against the list the mark is really on, and
  // mints an id the destination does not already have.
  const both = settleSignBoards({
    front: [makeSignComponent('arrow', 'c1'), makeSignComponent('arrow', 'c2'), makeSignComponent('arrow', 'c3')],
    back: [makeSignComponent('arrow', 'c1'), makeSignComponent('arrow', 'c2'), makeSignComponent('arrow', 'c3')],
  })
  assert.deepEqual(both.front.map((c) => c.id), ['c1', 'c2', 'c3'], 'a board numbers its own marks')
  assert.deepEqual(both.back.map((c) => c.id), ['c1', 'c2', 'c3'], 'and the other board numbers them the same')
  const cross = signLayoutCarried(both.back, both.front, 'c2', 1)
  assert.equal(cross.target.length, 4, 'the board it joins keeps every mark it had, and gains one')
  assert.equal(cross.source.length, 2, 'the board it left keeps the two it is not carrying')
  assert.deepEqual(cross.target.map((c) => c.id), ['c1', 'c4', 'c2', 'c3'], `the mark lands in the place it was aimed at: ${JSON.stringify(cross.target.map((c) => c.id))}`)
  assert.equal(new Set(cross.target.map((c) => c.id)).size, 4, 'and no row holds one name twice')
  assert.ok(cross.source.every((c) => c.id !== cross.id), 'the carried mark is off the board it left')
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
