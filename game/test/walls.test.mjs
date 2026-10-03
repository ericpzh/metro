// Build floors and their automatic walls.
//
// The 建造 tool's deliberate drag draws a floor patch and raises a 4 m wall ring
// on its outer edge. A patch is tracked by `AUTO_FLOOR` cells, so overlapping or
// abutting two patches unions them exactly like a facility room: the shared edge
// inside the union loses its wall and the new outer edge gains one. Only
// `AUTO_WALL` cells are touched, so a hand-placed wall survives a union (unlike
// a room, whose derived walls cannot tell hand from auto). A hole dug through
// the middle of a patch stays open.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addFloor,
  addWalls,
  AUTO_FLOOR,
  AUTO_WALL,
  AUTO_WALL_H,
  plannedAutoWalls,
  removeFloor,
  syncAutoWalls,
  toState,
  WALL,
  wallColumnAt,
  wallColumnsAt,
  wallRun,
} from '../src/build/model.ts'

function empty() {
  return toState({
    name: 't',
    seed: 1,
    cells: [],
    modules: [],
    lines: [],
  })
}

/** A filled inclusive rectangle on one level. */
function rect(x0, y0, x1, y1, z = 0) {
  const out = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y, z])
  return out
}

const has = (cells, x, y, z) => cells.some((c) => c.x === x && c.y === y && c.z === z)
const tagsAt = (cells, x, y, z) => cells.find((c) => c.x === x && c.y === y && c.z === z)?.tags ?? []
const autoWalls = (cells) => cells.filter((c) => c.tags?.includes(AUTO_WALL))

test('a drawn patch grows a 4 m wall ring around its edge, not its middle', () => {
  const st = addFloor(empty(), rect(1, 1, 5, 5))
  assert.equal(st.cells.filter((c) => c.tags?.includes(AUTO_FLOOR)).length, 25, 'the floor was not tagged')
  // The 5x5 perimeter is 16 cells, each a full column.
  assert.equal(autoWalls(st.cells).length, 16 * AUTO_WALL_H)
  assert.ok(has(st.cells, 1, 1, 1) && has(st.cells, 1, 1, AUTO_WALL_H), 'a corner column is incomplete')
  assert.ok(!has(st.cells, 3, 3, 1), 'the interior grew a wall')
})

test('overlapping two patches unions them: inner wall gone, new edge walled', () => {
  const a = addFloor(empty(), rect(1, 1, 5, 5))
  const st = addFloor(a, rect(3, 1, 7, 5))
  // Union is 7x5 = 35 cells; perimeter is 2*(7+5)-4 = 20.
  assert.equal(autoWalls(st.cells).length, 20 * AUTO_WALL_H)
  assert.ok(!has(st.cells, 5, 3, 1), 'the wall buried inside the union was not removed')
  assert.ok(has(st.cells, 7, 3, 1), 'the new outer edge has no wall')
})

test('abutting two patches merges them with no wall on the shared edge', () => {
  const a = addFloor(empty(), rect(1, 1, 3, 3))
  const st = addFloor(a, rect(4, 1, 6, 3))
  assert.ok(!has(st.cells, 3, 2, 1) && !has(st.cells, 4, 2, 1), 'the shared edge kept a wall')
  assert.ok(has(st.cells, 1, 2, 1) && has(st.cells, 6, 2, 1), 'the outer edges lost their wall')
})

test('hand-built floor is ground, not a patch to wall against', () => {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 5; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const base = toState({
    name: 't',
    seed: 1,
    cells,
    modules: [],
    lines: [],
  })
  const st = addFloor(base, rect(10, 0, 14, 4))
  assert.ok(!has(st.cells, 10, 2, 1), 'a wall grew against the hand-built floor')
  assert.ok(has(st.cells, 14, 2, 1), 'the far edge has no wall')
})

test('a hand-placed wall survives a union that buries it', () => {
  // A manual (untagged) column at (5,3), before any patch exists.
  const cells = []
  for (let dz = 1; dz <= AUTO_WALL_H; dz++) cells.push({ x: 5, y: 3, z: dz, fill: 'solid' })
  const base = toState({
    name: 't',
    seed: 1,
    cells,
    modules: [],
    lines: [],
  })
  const a = addFloor(base, rect(1, 1, 5, 5))
  assert.ok(!tagsAt(a.cells, 5, 3, 1).includes(AUTO_WALL), 'the hand-placed wall was adopted as auto')
  // Extending east makes (5,3) interior; only auto walls may be dropped.
  const st = addFloor(a, rect(3, 1, 7, 5))
  assert.ok(has(st.cells, 5, 3, 1), 'the hand-placed wall was deleted by the union')
  assert.ok(!tagsAt(st.cells, 5, 3, 1).includes(AUTO_WALL))
  assert.ok(!has(st.cells, 5, 2, 1), 'the auto wall beside it should still go')
})

test('digging an edge cell moves the auto wall inward and clears the orphan', () => {
  const a = addFloor(empty(), rect(1, 1, 5, 5))
  const st = removeFloor(a, [[5, 3, 0]])
  assert.ok(!has(st.cells, 5, 3, 0), 'the floor block was not dug')
  assert.ok(!has(st.cells, 5, 3, 1), 'an orphan auto wall was left behind')
  assert.ok(has(st.cells, 4, 3, 1), 'the new edge did not get a wall')
})

test('a hole dug through the middle stays open — no wall boards it up', () => {
  const a = addFloor(empty(), rect(1, 1, 5, 5))
  const st = removeFloor(a, [[3, 3, 0]])
  assert.ok(!has(st.cells, 3, 3, 0), 'the hole was not dug')
  for (const [x, y] of [[2, 3], [4, 3], [3, 2], [3, 4]]) {
    assert.ok(!has(st.cells, x, y, 1), `the hole was walled in at ${x},${y}`)
  }
})

/** A track module whose dug bed covers `w` cells along +x from `x, y`. */
const trackModule = (x, y, w) => ({ id: 't1', type: 'track', x, y, z: 0, w, d: 1, rot: 0, cfg: { line: '1', power: 'third-rail' } })

/** A full-height screen-door run on the platform strip. */
const screenRun = (x, y, w) => ({ id: 'e1', type: 'platform-edge', x, y, z: 0, w, rot: 0, cfg: { name: '站台门', line: '1', dir: 'up', side: 'right', psd: 'full', from: 't1' } })

test('a platform/tunnel footprint is covered ground, so the ring skips the platform edge', () => {
  // The rail dug its bed at y = 2 and runs out past the patch, so the exterior
  // flood would otherwise pour down the trench and wall the platform edge.
  const base = toState({ name: 't', seed: 1, cells: [], modules: [trackModule(2, 2, 5)], lines: [] })
  const st = addFloor(base, rect(0, 0, 5, 2))
  for (const x of [2, 3, 4]) assert.ok(!has(st.cells, x, 1, 1), `a wall boarded the platform edge at ${x},1`)
  // The true outer edge still earns its wall...
  assert.ok(has(st.cells, 2, 0, 1), 'the outer edge lost its wall')
  // ...and the drag never pours a block into the dug bed.
  for (const x of [2, 3, 4, 5]) assert.ok(!has(st.cells, x, 2, 0), `the trench was filled at ${x},2`)
})

test('a full track through a patch does not board up the platform screen door', () => {
  // A one-cell platform strip: void at y = 0 makes every cell an outer edge, so
  // only the screen-door guard keeps the auto wall out of it.
  const base = toState({ name: 't', seed: 1, cells: [], modules: [trackModule(2, 2, 5), screenRun(0, 1, 6)], lines: [] })
  const st = addFloor(base, rect(0, 1, 5, 1))
  for (const x of [0, 1, 2, 3, 4, 5]) {
    assert.ok(!has(st.cells, x, 1, 1), `a wall rose in the screen door at ${x},1`)
    assert.ok(has(st.cells, x, 1, 0), `the platform floor was skipped at ${x},1`)
  }
})

test('the 地基 ghost leaves the platform footprint and screen doors out of its ring', () => {
  const modules = [trackModule(2, 2, 5), screenRun(0, 1, 6)]
  const walls = plannedAutoWalls(new Set(), rect(0, 0, 5, 2), modules)
  for (const x of [0, 1, 2, 3, 4, 5]) {
    assert.ok(!walls.some(([wx, wy, wz]) => wx === x && wy === 1 && wz === 1), `the ghost promised a wall in the screen at ${x},1`)
  }
  // The dug bed the release skips never grows a ghost wall either.
  for (const x of [2, 3, 4, 5]) {
    assert.ok(!walls.some(([wx, wy, wz]) => wx === x && wy === 2 && wz === 1), `the ghost promised a wall on the bed at ${x},2`)
  }
})

test('a redundant sync is a no-op and keeps the same state object', () => {
  const st = addFloor(empty(), rect(1, 1, 5, 5))
  assert.equal(syncAutoWalls(st), st, 'a no-op sync rebuilt the station')
})

test('wallRun lays four courses on every base cell of the run', () => {
  const cols = wallRun([[2, 2, 0], [3, 2, 0]])
  assert.equal(cols.length, 2 * AUTO_WALL_H)
  for (const [x, y] of [[2, 2], [3, 2]]) {
    for (let dz = 0; dz < AUTO_WALL_H; dz++) assert.ok(cols.some(([cx, cy, cz]) => cx === x && cy === y && cz === dz))
  }
})

test('the 墙 tool lifts an auto-generated wall column in bulk, too', () => {
  const st = addFloor(empty(), rect(1, 1, 5, 5))
  // (1,1) is an auto-wall corner; the floor is at z=0, the wall courses z=1..4.
  assert.deepEqual(
    wallColumnAt(st, 1, 1, 3).map((c) => c[2]).sort((a, b) => a - b),
    [1, 2, 3, 4],
  )
  // A right-drag along the edge returns both full columns, de-duplicated even
  // though (1,1) is touched twice.
  const run = [
    [1, 1, 1],
    [2, 1, 1],
    [1, 1, 3],
  ]
  assert.equal(wallColumnsAt(st, run).length, 2 * AUTO_WALL_H)
  // The floor block itself is not a wall course.
  assert.deepEqual(wallColumnAt(st, 1, 1, 0), [])
})

test('the 墙 tool tags its columns so right-click can lift the whole run', () => {
  const st = addWalls(empty(), [[2, 2, 0], [3, 2, 0]]).state
  // Four tagged courses per base cell, and they are not auto walls.
  const tagged = st.cells.filter((c) => c.tags?.includes(WALL))
  assert.equal(tagged.length, 2 * AUTO_WALL_H)
  assert.ok(tagged.every((c) => !c.tags?.includes(AUTO_WALL)))
  // Whichever course the pointer lands on, the whole column comes back.
  assert.deepEqual(wallColumnAt(st, 2, 2, 3).map((c) => c[2]).sort(), [0, 1, 2, 3])
  assert.equal(wallColumnAt(st, 2, 2, 1).length, AUTO_WALL_H)
  // A right-drag across both columns returns all eight, de-duplicated.
  assert.equal(wallColumnsAt(st, [[2, 2, 0], [3, 2, 0], [2, 2, 2]]).length, 2 * AUTO_WALL_H)
  // A cell that is not a 墙-tool wall has no column.
  assert.deepEqual(wallColumnAt(st, 9, 9, 0), [])
})
