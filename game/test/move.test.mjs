// 移动 — moving a placed 设备 / 装饰 piece (GAME-SPEC §9.5).
//
// The feature is one idea with three parts, and all three have to agree:
//
//   1. **Lifting is not an edit.** The piece keeps its id and its whole `cfg`; the
//      renderer only stops drawing it, and the translucent ghost under the pointer
//      (`moveCandidate`) is the same piece the drop would place. So ✕ has nothing to
//      restore, and nothing lands on the undo stack until the drop is confirmed.
//   2. **The state travels.** A 指示牌's printed boards, a 闸机's lane, a 广告牌's
//      frozen poster: none of it is re-rolled by a move, and what lands is the piece
//      as the document holds it *now*, not a lift-time snapshot.
//   3. **The drop answers the placement rules.** Floor under every cell the piece
//      stands on, no track bed, nothing already in the space, a wall for a 广告牌, a
//      ceiling for a 指示牌 — asked of a piece that already exists, so the copy still
//      standing at its origin is never read as the obstacle.
//
// Structural pieces (楼梯 / 扶梯 / 电梯 / 出入口 / 房间 / 轨道 / 站台门) are refused by the
// same rule the delete tool uses to refuse a sweep: each is one piece whose derived
// geometry a translation would strand, so it is torn down and rebuilt instead.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMovableModule,
  moveCandidate,
  moveDropReason,
  movedModule,
} from '../src/sim/placement.ts'
import { createModule, replaceEquipment, toState } from '../src/build/model.ts'
import { useStore } from '../src/app/store.ts'

/* --------------------------------------------------------------- fixtures */

/** Open floor: a 12 × 12 slab at z = 0, with a ceiling slab where asked. */
function station(extra = []) {
  const cells = []
  for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  cells.push(...extra)
  return { name: '移动测试', seed: 1, cells, modules: [], lines: [] }
}

/** A floor with a solid slab 4 m up over (3, 3), which is what a 指示牌 hangs from. */
const ceilingSlab = { x: 3, y: 3, z: 4, fill: 'solid' }
/** The same, one cell along: enough ceiling for a sign moved from (3,3) to (4,3). */
const ceilingRun = [ceilingSlab, { x: 4, y: 3, z: 4, fill: 'solid' }]

const at = (x, y, z = 0) => ({ x, y, z })

/** A piece built by the real factory, so its `cfg` is the one the game makes. */
function piece(type, x, y, z = 0, rot = 0, extra = {}) {
  const mod = createModule(type, x, y, z, `${type}-1`, rot, extra.width, extra.dir, extra.door, [], extra.sign)
  assert.ok(mod, `${type} should build`)
  return mod
}

const state = (cells, modules) => toState({ name: '移动测试', seed: 1, cells, modules, lines: [] })
const flat = (mods = [], extra = []) => state(station(extra).cells, mods)

/* ----------------------------------------------------------- what can move */

test('the flat 设备 and 装饰 and an exit move; derived structural runs do not', () => {
  for (const type of ['gate', 'fence', 'tvm', 'vending', 'bench', 'shelf', 'desk', 'cubicle', 'sink', 'bin', 'extinguisher', 'billboard', 'glass', 'door', 'calligraphy', 'linemap', 'tv', 'sign']) {
    assert.equal(isMovableModule(piece(type, 1, 1)), true, `${type} is movable`)
  }
  assert.equal(isMovableModule(piece('exit', 1, 1)), true, 'the head-house carries its live floor footprint')
  // A run carves its openings, a room owns the walls around it and a rail is
  // derived from its line: none of them survives being translated.
  for (const type of ['stair', 'escalator', 'lift']) {
    assert.equal(isMovableModule(piece(type, 1, 1)), false, `${type} is not movable`)
  }
  // The pieces the palette does not build through the factory are still refused.
  assert.equal(isMovableModule({ id: 'shop-1', type: 'shop', x: 1, y: 1, z: 0, w: 4, h: 4, cfg: { kind: 'store' } }), false)
  assert.equal(isMovableModule({ id: 'booth-1', type: 'booth', x: 1, y: 1, z: 0, w: 3, h: 3, cfg: { kind: 'ticket' } }), false)
  assert.equal(isMovableModule({ id: 'track-1', type: 'track', x: 1, y: 1, z: 0, w: 6, d: 3, cfg: { line: '1', power: 'third-rail' } }), false)
  assert.equal(
    isMovableModule({ id: 'edge-1', type: 'platform-edge', x: 1, y: 1, z: 0, w: 6, cfg: { name: '1站台', line: '1', dir: 'up', side: 'left' } }),
    false,
  )
})

/* --------------------------------------------------------- the piece itself */

test('the moved piece is the same piece: id, cfg and poster all travel', () => {
  const gate = piece('gate', 2, 2, 0, 1, { door: 'fence' })
  const moved = movedModule(gate, at(6, 7, 0), 3)
  assert.equal(moved.id, gate.id)
  assert.deepEqual(moved.cfg, gate.cfg, 'the lane / fence choice is untouched')
  assert.deepEqual([moved.x, moved.y, moved.z, moved.rot], [6, 7, 0, 3])
  // The piece it came from is not mutated: the draft keeps the origin as the way home.
  assert.deepEqual([gate.x, gate.y, gate.rot], [2, 2, 1])
})

test('a move never collides with the copy still standing at the origin', () => {
  const tvm = piece('tvm', 2, 2)
  const modules = [tvm]
  // Dropped back on its own cell: legal, because the piece is tested by id.
  const same = moveCandidate(station().cells, modules, tvm, at(2, 2, 0), 0)
  assert.equal(same.reason, '', 'a piece never blocks itself')
  // And a second piece in the target cell is still an obstacle.
  const other = piece('vending', 5, 5)
  assert.notEqual(moveCandidate(station().cells, [tvm, other], tvm, at(5, 5, 0), 0).reason, '')
})

/* ------------------------------------------------------------ the drop rules */

test('a drop needs floor under every cell the piece stands on', () => {
  const cells = station().cells
  const gate = piece('gate', 2, 2)
  assert.equal(moveDropReason(cells, [gate], movedModule(gate, at(4, 4, 0), 0)), '')
  // The street is infinite, so "off the slab" is now a storey with no ground:
  // the same drop one storey up is refused, and the reason says which rule fired.
  const void_ = movedModule(gate, at(40, 40, 4), 0)
  assert.match(moveDropReason(cells, [gate], void_), /地板/)
  // A 2 m 座椅 needs both of its cells: one of them a dug hole is not enough.
  const bench = piece('bench-steel-2', 2, 2)
  assert.equal(bench.w, 2)
  const half = [...station().cells.filter((c) => !(c.x === 4 && c.y === 3)), { x: 4, y: 3, z: 0, fill: 'void' }]
  assert.match(moveDropReason(half, [bench], movedModule(bench, at(3, 3, 0), 0)), /地板/)
})

test('a drop is refused on a track bed and where equipment already stands', () => {
  const gate = piece('gate', 2, 2)
  const bed = station().cells.map((c) => (c.x === 6 && c.y === 6 ? { ...c, finish: { top: 'floor.track' } } : c))
  assert.equal(moveDropReason(bed, [gate], movedModule(gate, at(6, 6, 0), 0)), '轨道上不能放设备')
  const other = piece('vending', 7, 7)
  assert.equal(moveDropReason(station().cells, [gate, other], movedModule(gate, at(7, 7, 0), 0)), '这儿已经有设备了，换个地方')
})

test('a 指示牌 is refused without a ceiling and moves under one', () => {
  const sign = piece('sign', 3, 3)
  assert.match(moveDropReason(station().cells, [sign], movedModule(sign, at(3, 3, 0), 0)), /天花板/)
  const cells = station([ceilingSlab]).cells
  assert.equal(moveDropReason(cells, [sign], movedModule(sign, at(3, 3, 0), 0)), '')
  // The slab is one column wide: a cell away it is open sky again.
  assert.match(moveDropReason(cells, [sign], movedModule(sign, at(4, 3, 0), 0)), /天花板/)
})

test('a 广告牌 turns to face its wall, and needs one', () => {
  // A wall course behind the panel: the neighbour one storey up, on the −y side,
  // which is the face a rot-0 panel bolts to.
  const wall = { x: 5, y: 4, z: 1, fill: 'solid', tags: ['wall'] }
  const cells = station([wall]).cells
  const board = piece('billboard-wide', 5, 5)
  const { module: faced, reason } = moveCandidate(cells, [board], board, at(5, 5, 0), 2)
  assert.equal(reason, '', 'a panel with a backing wall drops')
  assert.equal(faced.rot, 0, 'and it is turned to the wall it can actually hang on')
  // No wall anywhere near: the panel has nothing to bolt to.
  assert.match(moveCandidate(station().cells, [board], board, at(5, 5, 0), 0).reason, /墙/)
})

test('a 广告牌 may hang over the track, where there is no floor in front of the wall', () => {
  // The station wall across the rails, with nothing but track bed in front of it.
  const cells = station([{ x: 5, y: 4, z: 1, fill: 'solid', tags: ['wall'] }]).cells.filter(
    (c) => !(c.x === 5 && c.y === 5),
  )
  const board = piece('billboard-wide', 5, 5)
  assert.equal(moveDropReason(cells, [board], movedModule(board, at(5, 5, 0), 0)), '', 'the wall is the whole requirement')
})

/* ------------------------------------------------------- putting it back */

test('replaceEquipment swaps the piece in place, keeping the list order', () => {
  const a = piece('gate', 1, 1)
  const b = piece('tvm', 2, 2)
  const c = piece('bin', 3, 3)
  const before = flat([a, b, c])
  const after = replaceEquipment(before, movedModule(b, at(8, 8, 0), 1))
  assert.deepEqual(after.modules.map((m) => m.id), ['gate-1', 'tvm-1', 'bin-1'], 'the order is untouched')
  assert.deepEqual([after.modules[1].x, after.modules[1].y, after.modules[1].rot], [8, 8, 1])
  assert.equal(after.modules[0], before.modules[0], 'the pieces around it are the same objects')
  // An unknown id changes nothing at all, so a stale commit is inert.
  assert.equal(replaceEquipment(before, { ...b, id: 'gone' }), before)
})

/* ---------------------------------------------------------- the store's lift */

/** Put a station in the store with no undo history, as a fresh load leaves it. */
function load(cells, modules, rest = {}) {
  useStore.setState({
    station: state(cells, modules),
    moveDraft: null,
    selected: null,
    past: [],
    future: [],
    notice: null,
    version: 0,
    ...rest,
  })
}

const st = () => useStore.getState()
const held = (id) => st().station.modules.find((m) => m.id === id)

test('lifting a piece is not an edit: it stays in the document and off the undo stack', () => {
  const gate = piece('gate', 2, 2, 0, 1, { door: 'fence' })
  load(station().cells, [gate])
  st().liftModule('gate-1')
  const d = st().moveDraft
  assert.ok(d, 'the piece is in the air')
  assert.equal(d.module.id, 'gate-1')
  assert.equal(d.rot, 1, 'it is carried at the rotation it was placed with')
  assert.equal(d.at, null, 'and it is not aimed anywhere yet')
  assert.ok(held('gate-1'), 'the document still holds it')
  assert.equal(st().past.length, 0, 'nothing to undo')
  assert.equal(st().version, 0, 'and nothing has changed')
})

test('the lift is a state of the piece, not a tool', () => {
  // There is no 移动 tool: the 信息 card lifts the selected piece, so the lift has to
  // work whatever tool happens to be active — and must not change it, or the player
  // would be dropped out of the mode they were building in.
  for (const tool of ['select', 'block', 'wall', 'delete', 'module', 'paint', 'zone', 'rail', 'tunnel']) {
    load(station().cells, [piece('tvm', 4, 4)], { tool })
    st().liftModule('tvm-1')
    assert.ok(st().moveDraft, `${tool}: the piece comes up`)
    assert.equal(st().tool, tool, `${tool}: and the tool is untouched`)
    st().cancelMove()
  }
})

test('a structural piece is refused, with the reason the player needs', () => {
  load(station().cells, [piece('stair', 2, 2), piece('exit', 6, 6, 0)])
  st().liftModule('stair-1')
  assert.equal(st().moveDraft, null)
  assert.match(st().notice, /不能移动/)
})

test('cancelling puts the piece back: no commit, no undo entry, no change', () => {
  const gate = piece('gate', 2, 2)
  load(station().cells, [gate])
  st().liftModule('gate-1')
  st().aimMove(at(8, 8, 0), movedModule(gate, at(8, 8, 0), 0), '')
  st().cancelMove()
  assert.equal(st().moveDraft, null)
  assert.equal(st().notice, '已放回原位')
  assert.deepEqual([held('gate-1').x, held('gate-1').y], [2, 2], 'exactly where it came from')
  assert.equal(st().past.length, 0)
  assert.equal(st().version, 0)
})

test('confirming drops it where it is aimed, as one undoable commit', () => {
  const gate = piece('gate', 2, 2, 0, 1, { door: 'fence' })
  load(station().cells, [gate])
  const before = st().version
  st().liftModule('gate-1')
  const { module: candidate, reason } = moveCandidate(st().station.cells, st().station.modules, gate, at(9, 7, 0), 1)
  assert.equal(reason, '')
  st().aimMove(at(9, 7, 0), candidate, reason)
  st().confirmMove()
  assert.equal(st().moveDraft, null, 'the piece is down')
  assert.deepEqual([held('gate-1').x, held('gate-1').y, held('gate-1').rot], [9, 7, 1])
  assert.deepEqual(held('gate-1').cfg, gate.cfg, 'its lane / fence choice came with it')
  assert.equal(st().past.length, 1, 'one commit, so one Ctrl+Z')
  assert.ok(st().version > before, 'the station was rebuilt')
  st().undo()
  assert.deepEqual([held('gate-1').x, held('gate-1').y], [2, 2], 'and undo puts it back')
})

test('a 指示牌 keeps its printed boards through a move', () => {
  const sign = piece('sign', 3, 3)
  const boards = { front: sign.cfg.front.map((c) => ({ ...c })), back: sign.cfg.back.map((c) => ({ ...c })) }
  load(station(ceilingRun).cells, [sign])
  st().liftModule('sign-1')
  const { module: candidate, reason } = moveCandidate(st().station.cells, st().station.modules, sign, at(4, 3, 0), 0)
  assert.equal(reason, '')
  st().aimMove(at(4, 3, 0), candidate, reason)
  st().confirmMove()
  const after = held('sign-1')
  assert.deepEqual([after.x, after.y], [4, 3])
  assert.deepEqual({ front: after.cfg.front, back: after.cfg.back }, boards, 'the text is the same text')
})

test('what lands is the live piece, not a snapshot taken at the lift', () => {
  const sign = piece('sign', 3, 3)
  load(station(ceilingRun).cells, [sign])
  st().liftModule('sign-1')
  // The boards are edited (as the board editor does) while the sign is in the air.
  const edited = held('sign-1')
  const nextFront = edited.cfg.front.map((c, i) => (i === 0 ? { ...c, x: c.x + 0.25 } : c))
  useStore.setState({
    station: {
      ...st().station,
      modules: st().station.modules.map((m) => (m.id === 'sign-1' ? { ...m, cfg: { ...m.cfg, front: nextFront } } : m)),
    },
  })
  const { module: candidate, reason } = moveCandidate(st().station.cells, st().station.modules, held('sign-1'), at(4, 3, 0), 0)
  assert.equal(reason, '')
  st().aimMove(at(4, 3, 0), candidate, reason)
  st().confirmMove()
  assert.deepEqual(held('sign-1').cfg.front, nextFront, 'the move does not reprint the sign')
})

test('a refused drop keeps the piece in the air and says why', () => {
  load(station().cells, [piece('gate', 2, 2), piece('vending', 6, 6)])
  st().liftModule('gate-1')
  const blocked = moveCandidate(st().station.cells, st().station.modules, held('gate-1'), at(6, 6, 0), 0)
  assert.notEqual(blocked.reason, '')
  st().aimMove(at(6, 6, 0), blocked.module, blocked.reason)
  st().confirmMove()
  assert.ok(st().moveDraft, 'still in the air')
  assert.equal(st().notice, blocked.reason)
  assert.deepEqual([held('gate-1').x, held('gate-1').y], [2, 2])
  assert.equal(st().past.length, 0)
  // With no aim at all, ✓ has nothing to do but say so.
  st().aimMove(null, null, '')
  st().confirmMove()
  assert.ok(st().moveDraft)
  assert.match(st().notice, /指针/)
})

test('a drop that changes nothing is not an edit, but a turn in place is', () => {
  load(station().cells, [piece('tvm', 4, 4, 0, 0)])
  st().liftModule('tvm-1')
  const same = moveCandidate(st().station.cells, st().station.modules, held('tvm-1'), at(4, 4, 0), 0)
  st().aimMove(at(4, 4, 0), same.module, same.reason)
  st().confirmMove()
  assert.equal(st().moveDraft, null)
  assert.equal(st().notice, '位置没变')
  assert.equal(st().past.length, 0, 'nothing was committed')

  st().liftModule('tvm-1')
  st().rotateMove()
  assert.equal(st().moveDraft.rot, 3, 'R turns it a quarter clockwise')
  const turned = moveCandidate(st().station.cells, st().station.modules, held('tvm-1'), at(4, 4, 0), st().moveDraft.rot)
  st().aimMove(at(4, 4, 0), turned.module, turned.reason)
  st().confirmMove()
  assert.equal(held('tvm-1').rot, 3, 'the same cell, a new rotation: a real move')
  assert.equal(st().past.length, 1)
})

test('the aim is pushed back only when it really changed', () => {
  load(station().cells, [piece('gate', 2, 2)])
  st().liftModule('gate-1')
  const one = moveCandidate(st().station.cells, st().station.modules, held('gate-1'), at(5, 5, 0), 0)
  st().aimMove(at(5, 5, 0), one.module, one.reason)
  const draft = st().moveDraft
  st().aimMove(at(5, 5, 0), one.module, one.reason)
  assert.equal(st().moveDraft, draft, 'the same answer is not a new state')
  st().aimMove(at(6, 5, 0), one.module, one.reason)
  assert.notEqual(st().moveDraft, draft, 'a new cell is')
})

test('opening the board editor puts a sign in the air back down', () => {
  load(station([ceilingSlab]).cells, [piece('sign', 3, 3)])
  st().liftModule('sign-1')
  assert.ok(st().moveDraft)
  st().openSignEditor('sign-1')
  assert.equal(st().moveDraft, null, 'the editor composes against the station, not against a ghost')
  st().closeSignEditor()
})

test('the rail’s 自定义 composer also puts a lifted piece back', () => {
  // The composer is the other way into the board editor and takes the keyboard the
  // same way. Its ✓ is `Enter` (`SignEditor.tsx`), and the viewport reads `Enter` as
  // the move's 确认 (`Viewport.tsx`) — so a lift left standing was dropped behind the
  // modal by one keypress, a real edit with the editor up.
  load(station().cells, [piece('gate', 2, 2)])
  st().liftModule('gate-1')
  assert.ok(st().moveDraft, 'the piece is in the air')
  st().openSignComposer()
  assert.equal(st().signComposing, true)
  assert.equal(st().moveDraft, null, 'the composer takes the keyboard, so the lift goes back first')
  const past = st().past.length
  st().confirmMove()
  assert.equal(st().past.length, past, 'Enter in the composer must not commit a move behind it')
  assert.deepEqual([held('gate-1').x, held('gate-1').y], [2, 2], 'the piece never left its cell')
})

test('a piece that vanished under the lift is not dropped back into being', () => {
  load(station().cells, [piece('gate', 2, 2)])
  st().liftModule('gate-1')
  const aim = moveCandidate(st().station.cells, st().station.modules, held('gate-1'), at(5, 5, 0), 0)
  st().aimMove(at(5, 5, 0), aim.module, aim.reason)
  // An undo (or a load) takes the piece away while it is in the air.
  useStore.setState({ station: { ...st().station, modules: [] } })
  st().confirmMove()
  assert.equal(st().moveDraft, null)
  assert.match(st().notice, /不在了/)
  assert.equal(st().station.modules.length, 0)
})
