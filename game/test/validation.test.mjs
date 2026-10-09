// The one placement verdict, and the display that reads it — GAME-SPEC §5, §9.5.
//
// The rule this file defends is the one the player sees: **the preview and the
// release must agree**. They used to answer separately — `app/tools/*` ran the
// rules inline to colour the ghost, `build/model/*` ran its own copy to make the
// edit — so a cell could be promised by the ghost and dropped by the release (a
// block the 方块 brush refused in silence), or refused by the ghost for a reason the
// release never checked.
//
// `build/validation.ts` gathers both sides onto `sim/placement.ts`'s two verdicts,
// `blockReason` and `equipmentReason`. These tests pin, in order:
//
//   1. the block verdict says *why*, and names the piece in the way;
//   2. the preview gathers a whole gesture's worth of candidates into the accepted
//      cells the cyan ghost draws and the refused cells + offending pieces the red
//      boxes mark;
//   3. the release (`addCells` / `addFloor` / `addWalls`) takes exactly the cells
//      the preview accepted — the property that was broken;
//   4. the equipment verdict is one rule set, and a lifted piece asks the same one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { blockReason, blockRefusalNotice, checkBlockCells, checkModulePlacements, dominantRefusal, equipmentReason, equipmentRefusalNotice, firstRefusal } from '../src/build/validation.ts'
import { addCells, addEquipment, addFloor, createModule, toState, wallRun, addWalls } from '../src/build/model.ts'
import { moduleEnvelope, moduleFootprint, moveDropReason } from '../src/sim/placement.ts'
import { wallCourses } from '../src/sim/courses.ts'

/** Open floor: a 6 × 6 slab at z = 0, plus a ceiling slab one storey up. */
function flatStation(extra = [], modules = []) {
  const cells = []
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  cells.push(...extra)
  return toState({ name: 't', seed: 1, cells, modules, lines: [] })
}

const gate = (x, y, z = 0, id = 'gate-1') => ({ id, type: 'gate', x, y, z, rot: 0, cfg: { dir: 'both' } })
const clock = (x, y, z = 0, id = 'clock-1') => ({ id, type: 'clock', x, y, z, rot: 0, cfg: {} })

/* ------------------------------------------------------------- the block verdict */

test('the block verdict names the rule that refused it, and the piece in the way', () => {
  const st = flatStation([], [gate(2, 2, 0, 'g1')])
  const free = blockReason(st.cells, st.modules, 3, 3, 1)
  assert.equal(free.ok, true)
  assert.equal(free.reason, '')
  assert.deepEqual(free.blockers, [])

  // The cell the 闸机 stands in: the column above its own floor is not buildable.
  const taken = blockReason(st.cells, st.modules, 2, 2, 1)
  assert.equal(taken.ok, false)
  assert.equal(taken.reason, 'equipment')
  assert.deepEqual(
    taken.blockers.map((m) => m.id),
    ['g1'],
    'the refusal names the 闸机 itself, so the preview can box it',
  )

  // A rail's dug bed is its own answer: covered ground, not a refusal to report.
  const bed = flatStation([{ x: 4, y: 4, z: 1, fill: 'solid', finish: { top: 'floor.track' } }])
  assert.equal(blockReason(bed.cells, bed.modules, 4, 4, 1).reason, 'track')
})

test('a run owns its corridor, and the ground under its slope is floor', () => {
  // The run climbs +y from (2, 2). A block laid **at** the flight is refused by the
  // carve — the rule that stops a hand-built course sealing a run the player can see
  // through — while the ground the slope passes over is exactly what the brush is for.
  const stair = createModule('stair-straight', 2, 2, 0, 's1', 0)
  const st = flatStation([], [stair])
  const corridor = blockReason(st.cells, st.modules, 2, 3, 1)
  assert.equal(corridor.ok, false, 'the run’s own corridor is not free ground')
  assert.equal(corridor.reason, 'opening', 'the carve owns it, not the block rule')
  // The ground under the slope is floor, and so is a cell beside the run.
  assert.equal(blockReason(st.cells, st.modules, 2, 3, 0).ok, true, 'the ground under the first treads')
  assert.equal(blockReason(st.cells, st.modules, 3, 2, 0).ok, true, 'beside the run')
  // A run is never the *equipment* refusal: §5.1 makes its landings the floor the
  // crowd stands on and its slope ground the filling is drawn under.
  assert.equal(blockReason(st.cells, st.modules, 2, 2, 0).reason, '', 'a landing tile is floor')
})

/* ---------------------------------------------------------------- the block preview */

test('the block preview splits a drag into accepted cells and refused cells', () => {
  const st = flatStation([], [gate(2, 2, 0, 'g1')])
  const cells = [
    [1, 2, 1],
    [2, 2, 1],
    [3, 2, 1],
  ]
  const preview = checkBlockCells(st, cells)
  assert.deepEqual(
    preview.acceptedCells,
    [
      [1, 2, 1],
      [3, 2, 1],
    ],
    'the two free cells are what the cyan ghost draws',
  )
  assert.deepEqual(preview.blockedCells, [[2, 2, 1]], 'the occupied cell is the red box')
  assert.deepEqual(preview.colliderIds, ['g1'], 'and the 闸机 is boxed in red beside it')
  assert.equal(preview.refused.get('2,2,1'), 'equipment')
})

test('the preview and the release take the same cells', () => {
  // The property the whole module exists for: what the ghost accepts is what the
  // edit commits, over a gesture that meets a 闸机, a hung 时钟 and a rail bed.
  const st = flatStation(
    [{ x: 5, y: 5, z: 1, fill: 'solid', finish: { top: 'floor.track' } }],
    [gate(2, 2, 0, 'g1'), clock(4, 1, 0, 'c1')],
  )
  // A candidate is a cell the drag would *change*: the caller (`pendingCells`) drops
  // the ones that are already solid, exactly as the release skips them.
  const before = new Set(st.cells.map((c) => `${c.x},${c.y},${c.z}`))
  const cells = []
  for (let x = 1; x <= 4; x++) for (let y = 1; y <= 2; y++) cells.push([x, y, 1])
  cells.push([5, 5, 1])
  const candidates = cells.filter(([x, y, z]) => !before.has(`${x},${y},${z}`))
  const preview = checkBlockCells(st, candidates)

  const laid = addCells(st.cells, cells, st.modules)
  const committed = new Set(laid.cells.filter((c) => c.z === 1 && !before.has(`${c.x},${c.y},${c.z}`)).map((c) => `${c.x},${c.y},${c.z}`))
  assert.deepEqual(
    [...preview.accepted].sort(),
    [...committed].sort(),
    'the release laid a different set of cells from the one the preview accepted',
  )
  assert.deepEqual(
    [...preview.refused.keys()].sort(),
    candidates.map(([x, y, z]) => `${x},${y},${z}`).filter((k) => !committed.has(k)).sort(),
    'and refused exactly the rest — the count in the notice is the number of red boxes',
  )
  assert.equal(preview.refused.size, laid.blocked, 'the preview’s refusals are the release’s blocked count')
  assert.ok(preview.refused.size > 0, 'the gesture met nothing, so the agreement is untested')
})

test('a floor patch carries on around a piece, and the walls it raises do not rise through one', () => {
  const st = flatStation([], [gate(2, 2, 0, 'g1')])
  const patch = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) patch.push([x, y, 0])
  const patched = addFloor(toState({ name: 't', seed: 1, cells: [], modules: st.modules, lines: [] }), patch)
  assert.equal(patched.cells.some((c) => c.x === 2 && c.y === 2 && c.z === 0), false, 'the patch poured a block into the 闸机')
  // The ring the patch raises is four courses on the outer edge, and none of them
  // stands in the 闸机's own column.
  assert.equal(patched.cells.some((c) => c.x === 2 && c.y === 2 && c.z > 0), false, 'the ring rose through the 闸机')
  assert.ok(patched.cells.some((c) => c.x === 0 && c.y === 0 && c.z === 1), 'the outer edge lost its wall')
})

test('the wall tool refuses a course a piece holds, in the same words as the release', () => {
  // A one-course wall at the 闸机's own height: the piece is 1.3 m tall, so a single
  // course at z = 1 is squarely inside it, and the release refuses it.
  const st = flatStation([], [gate(2, 2, 0, 'g1')])
  const course = [[2, 2, 1]]
  const preview = checkBlockCells(st, course)
  assert.equal(preview.accepted.length, 0, 'a course landed in the 闸机')
  assert.deepEqual(preview.blockedCells, [[2, 2, 1]])
  assert.deepEqual(preview.colliderIds, ['g1'])
  // The release refuses the same course. A wall is laid **at** the cell it occupies
  // (`addWalls`'s base cells are courses, not floors), with the 半墙 side and the 三角
  // shape as the flags either side of the height.
  const one = addWalls(st, [[2, 2, 1]], null, 1, null)
  assert.equal(one.changed, 0)
  assert.equal(one.blocked, 1, 'the release refused a different number of courses from the preview')
  // A four-course column from the same base is refused at the courses the piece
  // really occupies and rises above it: the 闸机 is 1.3 m, so z = 3 and z = 4 clear.
  const column = checkBlockCells(st, wallRun([[2, 2, 1]]))
  assert.deepEqual(
    column.blockedCells.map((c) => c[2]).sort(),
    [1, 2],
    'the courses inside the machine are refused, the ones above it are not',
  )
  assert.deepEqual(
    column.acceptedCells.map((c) => c[2]).sort(),
    [3, 4],
    'a wall higher than the machine stands on it',
  )
  const full = addWalls(st, [[2, 2, 1]])
  assert.equal(full.changed, 2, 'the release lays the same two courses the preview accepted')
  assert.equal(full.blocked, 2)
})

/* ----------------------------------------------------------- the equipment verdict */

test('the equipment verdict is one rule set, with one sentence per rule', () => {
  const st = flatStation()
  const tvm = createModule('tvm', 1, 1, 0, 't1', 0)
  assert.equal(equipmentReason(st.cells, st.modules, tvm), '')
  assert.equal(equipmentRefusalNotice(''), '')

  // The same piece one storey up, where there is no street: no ground under it.
  const offEdge = createModule('tvm', 9, 9, 4, 't2', 0)
  assert.equal(equipmentReason(st.cells, st.modules, offEdge), 'floor')
  assert.match(equipmentRefusalNotice('floor'), /地板/)

  // Two pieces in one cell, whichever side is asked.
  const crowded = flatStation([], [gate(1, 1, 0, 'g1')])
  assert.equal(equipmentReason(crowded.cells, crowded.modules, tvm), 'occupied')
  assert.match(equipmentRefusalNotice('occupied'), /已经有设备/)

  // A hung piece with nothing overhead: the envelope reaches the storey ceiling,
  // and the slab it needs is the first grid line above.
  const hung = createModule('sign', 1, 1, 0, 's1', 0)
  assert.equal(equipmentReason(st.cells, st.modules, hung), 'ceiling')
  // A hung piece is exempt from the ground: the cell off the slab's edge refuses a
  // 售票机 for its floor and takes the 指示牌 that hangs from the slab over it.
  const well = flatStation([{ x: 9, y: 9, z: 4, fill: 'solid' }])
  const overWell = createModule('sign', 9, 9, 0, 's2', 0)
  assert.equal(equipmentReason(well.cells, well.modules, overWell, true), '', 'a hung piece wants the slab, not the ground')
  // A 出入口 belongs at the street, and only while placing — a 移动 of one already
  // standing on a concourse is not refused for where it is.
  const exit = { id: 'x1', type: 'exit', x: 2, y: 2, z: -4, rot: 0, cfg: { name: 'A口', inRate: 600, open: true } }
  assert.equal(equipmentReason(st.cells, st.modules, exit, true), 'exit-on-slab')
  assert.notEqual(equipmentReason(st.cells, st.modules, exit, false), 'exit-on-slab')
})

test('the equipment preview names the pieces a refusal collides with', () => {
  const st = flatStation([], [gate(1, 1, 0, 'g1')])
  const tvm = createModule('tvm', 1, 1, 0, 'preview', 0)
  const check = checkModulePlacements(st, [{ id: 'preview', module: tvm }])
  assert.equal(check.accepted.length, 0)
  assert.equal(check.refused.get('preview'), 'occupied')
  assert.deepEqual(check.colliderIds, ['g1'], 'the 闸机 is highlighted as the obstacle')
  // Its own envelope really does cover the cell: the verdict and the geometry agree.
  const e = moduleEnvelope(tvm)
  assert.ok(e.x0 <= 1 && e.x1 >= 2 && e.y0 <= 1 && e.y1 >= 2)
})

/* ------------------------------------------------------------------- moving a piece */

test('a lifted piece is judged by the same rule set as a fresh placement', () => {
  const st = flatStation([], [gate(1, 1, 0, 'g1')])
  const tvm = createModule('tvm', 1, 1, 0, 't9', 0)
  // The same cell a fresh 售票机 is refused in, refused in the same words — the
  // 移动 card and the hover cannot drift.
  assert.equal(moveDropReason(st.cells, st.modules, tvm), equipmentRefusalNotice(equipmentReason(st.cells, st.modules, tvm)))
  assert.match(moveDropReason(st.cells, st.modules, tvm), /已经有设备/)
  // A free cell moves without complaint.
  const free = createModule('tvm', 4, 4, 0, 't9', 0)
  assert.equal(moveDropReason(st.cells, st.modules, free), '')
})

test('a movable piece is refused over void by the same floor rule', () => {
  const st = flatStation()
  // One storey up there is no street, so the same bench really is floorless.
  const bench = createModule('bench', 9, 9, 4, 'b1', 0)
  assert.equal(moveDropReason(st.cells, st.modules, bench), equipmentRefusalNotice('floor'))
  // Placing the same piece is refused identically (it is the same rule set).
  assert.equal(equipmentReason(st.cells, st.modules, bench, true), 'floor')
  // And a piece really can be added where the verdict says it may.
  const ok = createModule('bench', 2, 2, 0, 'b2', 0)
  assert.equal(equipmentReason(st.cells, st.modules, ok, true), '')
  assert.equal(addEquipment(st, ok).modules.length, st.modules.length + 1)
})

/* ------------------------------------------------------- a poster on its wall */

test('a wall-mounted 广告牌 does not fight the floor, only the wall', () => {
  // The defect this pins: the 广告牌's collision box was the whole cell it hangs over,
  // three courses deep, so a 座椅 standing on that floor tile "collided" with a poster
  // two metres above it and the chair's ghost turned the whole placement red.
  //
  // A panel bolted to a wall reserves the **wall band** it covers and nothing else, so
  // a piece standing on the floor, or hung from the ceiling, shares the tile with it.
  const wall = [
    { x: 2, y: 2, z: 1, fill: 'solid' },
    { x: 3, y: 2, z: 1, fill: 'solid' },
    // …and the slab a hung piece needs, one storey up.
    { x: 2, y: 3, z: 4, fill: 'solid' },
  ]
  const st = flatStation(wall)
  // Facing −y (rot 0), so it bolts onto the wall at (2, 2, 1) — the cell in front of
  // its own backing.
  const poster = createModule('billboard', 2, 3, 0, 'ad1', 0)
  assert.equal(poster?.type, 'billboard')
  const e = moduleEnvelope(poster)
  assert.ok(e.z0 > 2.2, `the housing starts above the floor furniture, not at it (z0 = ${e.z0.toFixed(2)})`)
  assert.ok(e.y1 - e.y0 <= 0.6, `the housing is a slab on the wall, not a cell (${(e.y1 - e.y0).toFixed(2)} m deep)`)
  assert.ok(e.x1 - e.x0 >= 1, 'and it still spans its run across the wall')

  // A bench under it, and the nearest ceiling-hung piece: both share the tile.
  const bench = createModule('bench', 2, 3, 0, 'b1', 0)
  const clock = createModule('clock', 2, 3, 0, 'c1', 0)
  assert.equal(equipmentReason(st.cells, [bench], poster, true), '', 'a 座椅 five feet under the poster is not in its way')
  assert.equal(equipmentReason(st.cells, [clock], poster, true), '', 'nor is a 时钟 above it')
  assert.equal(equipmentReason(st.cells, [poster], bench, true), '', 'and the pair is symmetric')
  assert.equal(equipmentReason(st.cells, [poster], clock, true), '', 'either way round')

  // What it *does* need is its wall: with the backing gone the poster has nowhere
  // to bolt, and the one rule says so.
  assert.equal(equipmentReason([], [bench], poster, true), 'wall')
  // And a piece tall enough to **reach** the poster's own band really is in its way:
  // the rule is the drawn geometry, not a blanket "wall pieces never collide". A
  // 售票机 is a 1.9 m machine, whose top passes the skirt of the panel above it.
  const tvm = createModule('tvm', 2, 3, 0, 't1', 0)
  assert.equal(equipmentReason(st.cells, [tvm], poster, true), 'occupied', 'a 1.9 m 售票机 reaches into the panel’s band')
})

/* --------------------------------------- runs stand on their ends, not their middles */

test('a 扶梯 stands on its lower base; the upper landing is carved, not required', () => {
  // The run climbs +y from (0, 0): six cells over, one storey up. Only the lower
  // base needs solid floor (or an exit's floor): the upper landing and everything
  // between the ends are carved on placement, so a void upper landing is no refusal.
  const step = flatStation([{ x: 0, y: 6, z: 0, fill: 'solid' }])
  const run = createModule('escalator', 0, 0, 0, 'e1', 0, undefined, 'up')
  assert.deepEqual([run.from, run.to], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 6, z: 4 }], 'the piece climbs six cells to the storey above')
  assert.deepEqual(moduleFootprint(run), [[0, 0], [0, 6]], 'its footprint is the two landings, not the slope between them')
  assert.equal(equipmentReason(step.cells, step.modules, run), '', 'the upper landing is carved on placement')
  assert.match(equipmentRefusalNotice('escalator-bases'), /底端/, 'in the words the notice bar uses')
  // Dig the lower base out and the same run has nowhere to stand: the generic floor
  // rule answers first, because the base plan cell is in the footprint it checks.
  const dug = flatStation([{ x: 0, y: 6, z: 0, fill: 'solid' }])
  dug.cells = dug.cells.map((c) => (c.x === 0 && c.y === 0 && c.z === 0 ? { ...c, fill: 'void' } : c))
  assert.equal(equipmentReason(dug.cells, dug.modules, run), 'floor')
  // Everything between the landings is carved on placement, so a void middle is no
  // refusal: give the run its base and the same run stands.
  const landed = flatStation([
    { x: 0, y: 6, z: 0, fill: 'solid' },
    { x: 0, y: 6, z: 4, fill: 'solid' },
  ])
  assert.equal(equipmentReason(landed.cells, landed.modules, run), '', 'both ends on floor, the middle may be air')
})

test('a 电梯 is refused for its bay, in its own words', () => {
  // The bay is 2 × 2, and the verdict names it rather than the generic no-floor:
  // the 'lift-footprint' branch used to sit behind the generic floor check, where
  // no lift could ever reach it.
  const st = flatStation()
  // One storey up: nothing stands there, so the lift has no floor for its bay.
  const bay = createModule('lift', 5, 5, 4, 'l1', 0)
  assert.deepEqual(moduleFootprint(bay).sort(), [[5, 5], [5, 6], [6, 5], [6, 6]].sort(), 'the footprint is the whole bay')
  assert.equal(equipmentReason(st.cells, st.modules, bay), 'lift-footprint', 'with no floor the lift names its bay, not the generic rule')
  assert.match(equipmentRefusalNotice('lift-footprint'), /2×2/, 'in the words the notice bar uses')
  assert.equal(moveDropReason(st.cells, st.modules, bay), equipmentRefusalNotice('lift-footprint'), 'the notice reads the same verdict a drop would')
  // The whole bay on floor, and the shaft stands.
  const whole = createModule('lift', 1, 1, 0, 'l2', 0)
  assert.equal(equipmentReason(st.cells, st.modules, whole), '')
})

/* --------------------------------------- the notice reads the whole preview */

test('first and dominant refusals read the preview, not the rectangle order', () => {
  const st = flatStation([], [gate(1, 1, 0, 'g1')])
  const tvm = createModule('tvm', 1, 1, 0, 'preview', 0)
  const check = checkModulePlacements(st, [{ id: 'preview', module: tvm }])
  assert.equal(firstRefusal(check), 'occupied', 'the first refusal is the preview’s first')
  assert.equal(dominantRefusal(check), 'occupied', 'and with one refusal it is also what the drag is about')
  assert.equal(firstRefusal(checkModulePlacements(st, [])), '', 'no refusal, no notice')
  // A drag that meets two rails and one machine says rails.
  const drag = checkBlockCells({ cells: [], modules: [] }, [])
  drag.refused.set('a', 'track')
  drag.refused.set('b', 'equipment')
  drag.refused.set('c', 'track')
  assert.equal(firstRefusal(drag), 'track', 'first is insertion order')
  assert.equal(dominantRefusal(drag), 'track', 'dominant is the majority, not the first cell walked into')
  assert.match(blockRefusalNotice('opening'), /预留开口/, 'a carved corridor keeps its own sentence')
  assert.match(blockRefusalNotice('track'), /轨道/, 'as does a rail bed')
  assert.match(blockRefusalNotice('equipment'), /设备/, 'and a held cell')
  assert.match(blockRefusalNotice(''), /放不下/, 'with a fallback for no refusal at all')
})

/* --------------------------------------- a course is [c, c + 1) */

test('wallCourses claims a course the panel crosses, never one it merely touches', () => {
  // The shared leaf every wall-mounted backing rule reads: a panel from `bottom`
  // to `bottom + height` crosses the courses it overlaps, half-open per course.
  assert.deepEqual(wallCourses(1.5, 1), [1, 2], '1.5 m up and 1 m tall crosses the second and third courses')
  assert.deepEqual(wallCourses(0, 2), [0, 1], 'a 2 m panel standing on the floor crosses the first two')
  assert.deepEqual(wallCourses(1, 1), [1], 'edges exactly on a course line do not claim the course merely touched')
  assert.deepEqual(wallCourses(2, 0.5), [2], 'a short panel inside one course claims exactly it')
})
