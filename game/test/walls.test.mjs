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
  wallDirRot,
  wallRun,
  wallSnap,
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

test('the 方块 ghost leaves the platform footprint and screen doors out of its ring', () => {
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
  // Deletion stays in the hit's storey: courses 1..3 belong to band 0 while the
  // top course at z=4 belongs to the storey above, so it is left as the roof.
  assert.deepEqual(
    wallColumnAt(st, 1, 1, 3).map((c) => c[2]).sort((a, b) => a - b),
    [1, 2, 3],
  )
  // The roof course lifts on its own, from its own storey.
  assert.deepEqual(
    wallColumnAt(st, 1, 1, 4).map((c) => c[2]).sort((a, b) => a - b),
    [4],
  )
  // A right-drag along the edge returns both storey-limited columns,
  // de-duplicated even though (1,1) is touched twice.
  const run = [
    [1, 1, 1],
    [2, 1, 1],
    [1, 1, 3],
  ]
  assert.equal(wallColumnsAt(st, run).length, 2 * 3)
  // The floor block itself is not a wall course.
  assert.deepEqual(wallColumnAt(st, 1, 1, 0), [])
})

test('a stacked wall column lifts one storey at a time, never the roof above', () => {
  // Two hand-placed runs stacked into one contiguous column across B1 and G:
  // B1 owns -4..-1, G owns 0..3.
  let st = addWalls(empty(), [[2, 2, -4]]).state
  st = addWalls(st, [[2, 2, 0]]).state
  assert.deepEqual(
    wallColumnAt(st, 2, 2, -2).map((c) => c[2]).sort((a, b) => a - b),
    [-4, -3, -2, -1],
  )
  assert.deepEqual(
    wallColumnAt(st, 2, 2, 1).map((c) => c[2]).sort((a, b) => a - b),
    [0, 1, 2, 3],
  )
  // A doorway gap still stops the run: only the contiguous segment in this
  // storey comes back.
  const gap = removeFloor(toState({ name: 't', seed: 1, cells: st.cells, modules: [], lines: [] }), [[2, 2, -3]])
  assert.deepEqual(
    wallColumnAt(gap, 2, 2, -2).map((c) => c[2]).sort((a, b) => a - b),
    [-2, -1],
  )
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

/* ------------------------------------------------ 墙-tool smart snapping (R) */

/** A wall you can snap against: a full course of hand-tagged blocks at z = 1. */
const course = (x, y, z = 0) => wallRun([[x, y, z]]).map(([cx, cy, cz]) => ({ x: cx, y: cy, z: cz, fill: 'solid', tags: [WALL] }))

/** One floor cell at z = 0, plus the wall courses named after it. */
const floorCell = (x, y) => ({ x, y, z: 0, fill: 'solid' })
const withCourses = (footprint, courses) => [...footprint, ...courses.flatMap(([x, y]) => course(x, y))]
const at = (snap) => [snap.x, snap.y]

test('a cell open on exactly one side keeps its column and faces that side', () => {
  // A 3x3 patch whose whole ring is walled except the east edge of (2,1).
  const ring = [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 2], [2, 2]]
  const cells = withCourses(rect(0, 0, 2, 2).map(([x, y, z]) => floorCell(x, y, z)), ring)
  const snap = wallSnap(cells, [2, 1, 0])
  assert.deepEqual(at(snap), [2, 1], 'the column left the hovered cell')
  assert.equal(snap.dir, 'e', 'the wall should face the one open side')
  assert.deepEqual(snap.dirs, ['e'], 'one open side is not a choice, so R has nothing to cycle')
})

test('a corner cell offers every open side to R, best-first', () => {
  // A 2x2 patch: (0,0) faces open space south and west.
  const cells = withCourses(rect(0, 0, 1, 1).map(([x, y, z]) => floorCell(x, y, z)), [[1, 0], [0, 1], [1, 1]])
  const snap = wallSnap(cells, [0, 0, 0])
  assert.deepEqual(at(snap), [0, 0], 'a cell with its own edges must not snap away')
  assert.deepEqual(snap.dirs, ['s', 'w'], 'the corner should offer both open faces')
  // R steps the list, and it wraps in both directions.
  assert.equal(wallSnap(cells, [0, 0, 0], null, 0).dir, 's')
  assert.equal(wallSnap(cells, [0, 0, 0], null, 1).dir, 'w')
  assert.equal(wallSnap(cells, [0, 0, 0], null, 2).dir, 's', 'the cycle must wrap')
  assert.equal(wallSnap(cells, [0, 0, 0], null, 3).dir, 'w')
})

test('the pointer aim only breaks a tie between a corner cell’s open faces', () => {
  const cells = withCourses(rect(0, 0, 1, 1).map(([x, y, z]) => floorCell(x, y, z)), [[1, 0], [0, 1], [1, 1]])
  // Both open edges belong to (0,0); aiming is a delta from the cell centre.
  assert.equal(wallSnap(cells, [0, 0, 0], [-3, 0.5]).dir, 'w', 'aiming west should pick the west face')
  assert.equal(wallSnap(cells, [0, 0, 0], [0.5, -3]).dir, 's', 'aiming south should pick the south face')
  // An already-walled side is never offered.
  const walled = withCourses(rect(0, 0, 1, 1).map(([x, y, z]) => floorCell(x, y, z)), [[1, 0], [0, 1], [1, 1], [0, -1]])
  assert.ok(!wallSnap(walled, [0, 0, 0]).dirs.includes('s'), 'a side that already carries a wall is not a candidate')
})

test('a cell buried in a floor steps out to the nearest cell that faces open space', () => {
  // A 3x3 patch, its whole ring walled, and (2,2) buried in the middle. Every
  // ring cell therefore faces open space outward, and (2,2) is one step from
  // four of them.
  const ring = []
  for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) if (x !== 2 || y !== 2) ring.push([x, y])
  const cells = withCourses(rect(1, 1, 3, 3).map(([x, y, z]) => floorCell(x, y, z)), ring)
  const snap = wallSnap(cells, [2, 2, 0])
  // The scan runs x then y over the immediate ring, so (1,2) is the tie-break
  // winner among the four cells one step away. Its own open side is west.
  assert.deepEqual(at(snap), [1, 2], 'the column should have stepped to the ring')
  assert.equal(snap.dir, 'w', 'the wall should face the open space it stepped out to')
  assert.equal(snap.z, 0, 'the column must stay on the storey it was asked for')
  assert.deepEqual(snap.dirs, ['w'], 'a stepped column has nothing for R to cycle')
})

test('a buried cell with no edge in its ring is left where it stands', () => {
  // The scan is deliberately the immediate ring: a snap is a nudge to the next
  // edge, never a jump across the room. On a 5x5 patch with a fully walled ring,
  // (2,2) is buried *and* so are all eight cells around it, so the tool holds
  // position and lets `addWalls` report whatever is actually wrong there.
  const ring = []
  for (let x = 0; x <= 4; x++) for (const y of [0, 4]) ring.push([x, y])
  for (let y = 1; y <= 3; y++) for (const x of [0, 4]) ring.push([x, y])
  const cells = withCourses(rect(0, 0, 4, 4).map(([x, y, z]) => floorCell(x, y, z)), ring)
  const snap = wallSnap(cells, [2, 2, 0])
  assert.deepEqual(at(snap), [2, 2], 'the column should not have wandered out of the scan')
  assert.equal(snap.dir, 's', 'with no open edge to read, the face falls back to the default')
  assert.deepEqual(snap.dirs, ['s'])
})

test('the snap never consults the placement rotation', () => {
  // The whole point of the snap is that it reads the geometry: a rotation the
  // player happens to be holding must not steer it, and there is no parameter
  // left for one to travel through. `wallSnap` takes (cells, cell, pointer,
  // cycle) and nothing else — R only reaches the *output*, as `dir`/`dirs`.
  assert.equal(wallSnap.length, 2, 'wallSnap must expose no rotation argument')
  // Same geometry, every R step: the column never moves, only the face cycles.
  const cells = withCourses(rect(0, 0, 1, 1).map(([x, y, z]) => floorCell(x, y, z)), [[1, 0], [0, 1], [1, 1]])
  const spots = [0, 1, 2, 3, 4, 5].map((cycle) => at(wallSnap(cells, [0, 0, 0], null, cycle)))
  assert.ok(spots.every(([x, y]) => x === 0 && y === 0), `R moved the column: ${JSON.stringify(spots)}`)
})

test('a snapped face turns back into the placement quarter-turn', () => {
  // The snap output is a face; the tool turns it into the `rot` the rest of the
  // placement pipeline reads, so the mapping must be an exact round trip.
  for (const [dir, rot] of [['s', 0], ['w', 1], ['n', 2], ['e', 3]]) {
    assert.equal(wallDirRot(dir), rot)
  }
})
