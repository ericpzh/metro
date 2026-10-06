// Staircases, GAME-SPEC.md §5.1.
//
// A stair climbs exactly one storey, like an escalator, but it turns, and the
// turn is real: each flight is its own two-way graph edge and each half/quarter
// landing is a walkable node between them. These tests pin that down — the five
// styles, the flush switchback, the graph join, and the carve that keeps the
// landings while opening the slab the flights pass through.
import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarioStation } from './support/scenario-station.ts'
import { buildGraph, EDGE_KIND } from '../src/sim/station.ts'
import { carveRampOpenings } from '../src/sim/openings.ts'
import { placementBlocked } from '../src/sim/placement.ts'
import { ESCALATOR_BAND, STAIR_RAIL_PROUD } from '../src/sim/constants.ts'
import { STAIR_FLIGHT_RISE, STAIR_RISE, STAIR_RUN, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_LABELS, STAIR_WIDTH_NARROW, STAIR_WIDTH_TRIPLE, STAIR_WIDTHS, nextStairWidth, planStairLanes, stairBuildWidth, stairFacing, stairFlightSlides, stairFlights, stairLaneBases, stairLaneMates, stairLandingShape, stairLandingWalls, stairLandings, stairLanes, stairOnBlockGrid, stairRight, stairRunBlocks, stairSwitchbackGap, stairSwitchbackOffset, stairSwitchbackRunWidth, stairTurnCells, stairWallSides, stairWidthLabel } from '../src/sim/stairs.ts'
import { addEquipment, createModule, removeModule, toState, wallRun } from '../src/build/model.ts'

const key = (p) => `${p.x},${p.y},${p.z}`

/**
 * A 墙-tool column standing on the floor whose surface is `z`: four courses,
 * `z` … `z + 3` — the 4 m wall a stairwell is made of.
 */
const wall = (x, y, z) => wallRun([[x, y, z]]).map(([wx, wy, wz]) => ({ x: wx, y: wy, z: wz, fill: 'solid', tags: ['wall'] }))

function reachable(g, from, to) {
  const seen = new Set([from])
  const q = [from]
  while (q.length) {
    const n = q.shift()
    if (n === to) return true
    for (let e = g.adjStart[n]; e < g.adjStart[n + 1]; e++) {
      const nb = g.adjTo[e]
      if (seen.has(nb)) continue
      seen.add(nb)
      q.push(nb)
    }
  }
  return false
}

test('the demo keeps only the exit-connected straight stair', () => {
  const stairs = scenarioStation().modules.filter((m) => m.type === 'stair')
  assert.equal(stairs.length, 1, `expected one demo stair, got ${stairs.map((m) => m.id)}`)
  const [only] = stairs
  assert.equal(only.cfg.style, 'straight')
  assert.ok(only.id.startsWith('stair-gc-exit-a'), `${only.id} is not the exit-A stair`)
  assert.equal(only.from.z - only.to.z, -4, `${only.id} does not climb exactly one storey`)
  for (const f of stairFlights(only)) {
    assert.notEqual(f.from.z, f.to.z, `${only.id} has a flat flight`)
    assert.notEqual(f.from.x + f.from.y, f.to.x + f.to.y, `${only.id} has a zero-length flight`)
  }
})

test('every flight of a turning stair is a two-way edge between walkable landings', () => {
  const data = scenarioStation()
  const g = buildGraph(data)
  for (const m of data.modules.filter((x) => x.type === 'stair')) {
    for (const f of stairFlights(m)) {
      const a = g.nodeIndex.get(key(f.from))
      const b = g.nodeIndex.get(key(f.to))
      assert.notEqual(a, undefined, `${m.id}: ${key(f.from)} is not a floor node`)
      assert.notEqual(b, undefined, `${m.id}: ${key(f.to)} is not a floor node`)
      const kind = (from, to) => {
        for (let e = g.adjStart[from]; e < g.adjStart[from + 1]; e++) if (g.adjTo[e] === to) return g.adjKind[e]
        return -1
      }
      assert.equal(kind(a, b), EDGE_KIND.stair, `${m.id}: no stair edge up ${key(f.from)} -> ${key(f.to)}`)
      assert.equal(kind(b, a), EDGE_KIND.stair, `${m.id}: a stair must be walkable both ways`)
    }
  }
})

test('a turning stair walks bottom to top across its landing', () => {
  // The old demo switchback geometry, rebuilt on the current demo slabs: the
  // half-landing is a real node, not a jump straight through the turn.
  const data = scenarioStation()
  const Z_MID = -2
  for (const x of [2, 3, 4, 5]) data.cells.push({ x, y: 13, z: Z_MID, fill: 'solid' })
  const mod = {
    id: 'u',
    type: 'stair',
    x: 2,
    y: 16,
    z: -4,
    from: { x: 2, y: 16, z: -4 },
    to: { x: 5, y: 16, z: 0 },
    cfg: {
      width: STAIR_WIDTH_NARROW,
      style: 'right180',
      flights: [
        { from: { x: 2, y: 16, z: -4 }, to: { x: 2, y: 13, z: Z_MID } },
        { from: { x: 5, y: 13, z: Z_MID }, to: { x: 5, y: 16, z: 0 } },
      ],
    },
  }
  data.modules.push(mod)
  const g = buildGraph(data)
  const bottom = g.nodeIndex.get(key(mod.from))
  const top = g.nodeIndex.get(key(mod.to))
  assert.notEqual(bottom, undefined, 'the switchback bottom is not walkable')
  assert.notEqual(top, undefined, 'the switchback top is not walkable')
  assert.ok(reachable(g, bottom, top), 'the switchback does not connect its two landings')
  // The half-landing is a real node, not a jump straight through the turn.
  const landing = g.nodeIndex.get(key({ x: 2, y: 13, z: -2 }))
  assert.notEqual(landing, undefined, 'the half-landing is not walkable')
  assert.ok(mod.cfg.flights.length === 2, 'the switchback should be two flights')
})

test('the stair reaches the station and is reached from the street', () => {
  const data = scenarioStation()
  const g = buildGraph(data)
  const exit = g.exits[0].node
  for (const m of data.modules.filter((x) => x.type === 'stair')) {
    for (const p of [m.from, m.to]) {
      const n = g.nodeIndex.get(key(p))
      assert.ok(reachable(g, exit, n), `${m.id}: ${key(p)} cannot be reached from ${g.exits[0].name}`)
    }
  }
})

test('a straight stair is a single implied flight', () => {
  const m = { id: 's', type: 'stair', x: 0, y: 0, z: 0, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 6, z: 4 }, cfg: { width: 2 } }
  assert.deepEqual(stairFlights(m), [{ from: m.from, to: m.to }])
  assert.deepEqual(stairLandings(m), [m.from, m.to])
})

test('stair sizes cycle 窄 → 中 → 宽, each a whole number of lanes', () => {
  assert.deepEqual(STAIR_WIDTHS, [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_TRIPLE])
  assert.equal(STAIR_WIDTH_NARROW, ESCALATOR_BAND)
  assert.equal(STAIR_WIDTH_DOUBLE, 2 * ESCALATOR_BAND)
  assert.equal(STAIR_WIDTH_TRIPLE, 3 * ESCALATOR_BAND)
  assert.equal(nextStairWidth(STAIR_WIDTH_NARROW), STAIR_WIDTH_DOUBLE)
  assert.equal(nextStairWidth(STAIR_WIDTH_DOUBLE), STAIR_WIDTH_TRIPLE)
  assert.equal(nextStairWidth(STAIR_WIDTH_TRIPLE), STAIR_WIDTH_NARROW)
  assert.deepEqual(STAIR_WIDTH_LABELS, ['窄', '中', '宽'])
  assert.equal(stairWidthLabel(STAIR_WIDTH_NARROW), '窄')
  assert.equal(stairWidthLabel(STAIR_WIDTH_DOUBLE), '中')
  assert.equal(stairWidthLabel(STAIR_WIDTH_TRIPLE), '宽')
  // The label is the *size*, so a legacy width (an old 1.6 m stair) reads as the
  // nearest one, exactly as `stairLanes` does.
  assert.equal(stairWidthLabel(1.6), '中')
  assert.equal(stairWidthLabel(0.2), '窄')
  // A width that is not a whole number of lanes reads as the nearest one.
  assert.equal(stairLanes(ESCALATOR_BAND), 1)
  assert.equal(stairLanes(STAIR_WIDTH_DOUBLE), 2)
  assert.equal(stairLanes(STAIR_WIDTH_TRIPLE), 3)
  assert.equal(stairLanes(1.6), 2)
  assert.equal(stairLanes(0.2), 1)
  assert.equal(stairLanes(9), 3)
})

test('a switchback’s runs are built a whole number of blocks wide, lanes or not', () => {
  // A straight stair is lanes — one 0.68 m flight per cell — but a 双跑楼梯's two runs
  // stand flush, so the **pair** is what has to land on the block grid: each run fills its
  // own blocks, balustrades included, which is the size in blocks less the two rails.
  for (const [size, blocks, run] of [
    [STAIR_WIDTH_NARROW, 1, 0.79],
    [STAIR_WIDTH_DOUBLE, 2, 1.79],
    [STAIR_WIDTH_TRIPLE, 3, 2.79],
  ]) {
    assert.equal(stairLanes(size), blocks, `${size} m is not ${blocks} lanes`)
    assert.ok(Math.abs(stairSwitchbackRunWidth(size) - run) < 1e-9, `${size} m lays a ${stairSwitchbackRunWidth(size)} m run`)
    // The run plus its two balustrades is exactly the blocks it fills.
    assert.equal(stairRunBlocks(run), blocks)
    assert.ok(Math.abs(run + 2 * STAIR_RAIL_PROUD - blocks) < 1e-9)
    assert.ok(stairOnBlockGrid(run), `${run} m is not read as a block-wide run`)
    // And that width is what the builder stores for a 180, while every other shape keeps
    // the tool's own width (a lane, or the single wide piece it always was).
    assert.equal(stairBuildWidth('right180', size), run)
    assert.equal(stairBuildWidth('left180', size), run)
    assert.equal(stairBuildWidth('straight', size), size)
    assert.equal(stairBuildWidth('right90', size), size)
  }
  // An old piece's width is not a whole number of blocks, so it keeps its own band.
  for (const legacy of [ESCALATOR_BAND, STAIR_WIDTH_DOUBLE, 1.6, STAIR_WIDTH_TRIPLE]) {
    assert.equal(stairOnBlockGrid(legacy), false, `${legacy} m reads as a block-wide run`)
  }
})

test('the lanes of a wide stair lie side by side across its run', () => {
  // rot 0 runs +y, so the lanes step in +x; rot 1 runs +x, so they step in −y —
  // the same "right of forward" the switchback's second flight uses.
  assert.deepEqual(stairRight(0), [1, 0])
  assert.deepEqual(stairRight(1), [0, -1])
  assert.deepEqual(stairLaneBases({ x: 3, y: 5, z: -4 }, 0, 3), [
    { x: 3, y: 5, z: -4 },
    { x: 4, y: 5, z: -4 },
    { x: 5, y: 5, z: -4 },
  ])
  assert.deepEqual(stairLaneBases({ x: 3, y: 5, z: -4 }, 1, 2), [
    { x: 3, y: 5, z: -4 },
    { x: 3, y: 4, z: -4 },
  ])
  assert.deepEqual(stairLaneBases({ x: 3, y: 5, z: -4 }, 0, 1), [{ x: 3, y: 5, z: -4 }])
})

test('a wide stair snaps beside whatever already stands next to it', () => {  const free = () => true
  const blocked = (cells) => (p) => !cells.some((c) => c.x === p.x && c.y === p.y)
  const base = { x: 0, y: 0, z: 0 }
  // Open ground: the hovered cell is the first lane, and the flight grows +right.
  assert.deepEqual(planStairLanes(base, 0, 2, free).lanes.map((p) => p.x), [0, 1])
  assert.equal(planStairLanes(base, 0, 2, free).free, true)
  // Something already stands at x = 1: the flight shifts back so it sits west of
  // it instead of overlapping.
  const east = planStairLanes(base, 0, 2, blocked([{ x: 1, y: 0 }]))
  assert.deepEqual(east.lanes.map((p) => p.x), [-1, 0])
  assert.equal(east.free, true)
  // Something stands at x = −1: the flight grows east, butting against it.
  const west = planStairLanes(base, 0, 2, blocked([{ x: -1, y: 0 }]))
  assert.deepEqual(west.lanes.map((p) => p.x), [0, 1])
  assert.equal(west.free, true)
  // A three-lane flight with something standing two cells east of the pointer
  // shifts back so its last lane butts against it.
  const gap = planStairLanes(base, 0, 3, blocked([{ x: 2, y: 0 }]))
  assert.deepEqual(gap.lanes.map((p) => p.x), [-1, 0, 1])
  assert.equal(gap.free, true)
  // Nowhere to stand: the first candidate comes back flagged, so the ghost shows
  // the same refusal a single piece would.
  const wall = planStairLanes(base, 0, 2, blocked([{ x: 0, y: 0 }, { x: 1, y: 0 }]))
  assert.equal(wall.free, false)
  assert.deepEqual(wall.lanes.map((p) => p.x), [0, 1])
})

test('lanes side by side are neighbours; only one action makes them one flight', () => {
  const lane = (id, x, y, rot = 0, width = STAIR_WIDTH_NARROW, z = -4, flight) => {
    const m = createModule('stair-straight', x, y, z, id, rot, width)
    assert.ok(m && m.type === 'stair')
    if (flight) m.cfg.flight = flight
    return m
  }
  const a = lane('a', 0, 0)
  // rot 0 runs +y, so a lane at +x stands on the run's right. Neighbours join
  // their steps (`sameFlight` false: two stairs placed separately).
  const b = lane('b', 1, 0)
  assert.deepEqual(stairLaneMates([a, b], a).map((m) => [m.step, m.side, m.sameFlight]), [[[1, 0], 1, false]])
  assert.deepEqual(stairLaneMates([a, b], b).map((m) => [m.step, m.side, m.sameFlight]), [[[-1, 0], -1, false]])
  // The same two lanes carrying one flight token are one staircase.
  const fa = lane('a', 0, 0, 0, STAIR_WIDTH_NARROW, -4, 'f1')
  const fb = lane('b', 1, 0, 0, STAIR_WIDTH_NARROW, -4, 'f1')
  assert.deepEqual(stairLaneMates([fa, fb], fa).map((m) => m.sameFlight), [true])
  assert.deepEqual(stairLaneMates([fa, fb], fb).map((m) => m.sameFlight), [true])
  // Two different flights, or one lane with no token at all, are neighbours only.
  const fc = lane('c', 1, 0, 0, STAIR_WIDTH_NARROW, -4, 'f2')
  assert.deepEqual(stairLaneMates([fa, fc], fa).map((m) => m.sameFlight), [false])
  assert.deepEqual(stairLaneMates([fa, b], fa).map((m) => m.sameFlight), [false])
  // rot 1 runs +x, so its lanes step in −y and "right" turns with the run.
  const c = lane('c', 3, 5, 1)
  const d = lane('d', 3, 4, 1)
  assert.deepEqual(stairLaneMates([c, d], c).map((m) => [m.step, m.side]), [[[0, -1], 1]])
  // A lane set *along* the run is a different flight, not part of this one.
  assert.deepEqual(stairLaneMates([a, lane('along', 0, 1)], a), [])
  // So is one running the other way (its lower landing is a full run away), one
  // on another level, and one that is not a single straight flight at all.
  assert.deepEqual(stairLaneMates([a, lane('back', 1, 6, 2)], a), [])
  assert.deepEqual(stairLaneMates([a, lane('higher', 1, 0, 0, STAIR_WIDTH_NARROW, 0)], a), [])
  const turn = createModule('stair-left90', 1, 0, -4, 'turn', 0, STAIR_WIDTH_NARROW)
  assert.ok(turn)
  assert.deepEqual(stairLaneMates([a, turn], a), [])
  // A saved single-piece wide stair is one flight of its own: it does not merge,
  // and neither do two of them.
  const wide = lane('wide', 1, 0, 0, STAIR_WIDTH_DOUBLE)
  assert.deepEqual(stairLaneMates([a, wide], a), [])
  assert.deepEqual(stairLaneMates([wide, lane('wide2', 2, 0, 0, STAIR_WIDTH_DOUBLE)], wide), [])
})

test('a wall hugging a flight from bottom to top is the side it stands on', () => {
  const s = createModule('stair-straight', 0, 0, -4, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(s && s.type === 'stair')
  // The run climbs +y from (0,0) to (0,6), one storey: its left is west, its
  // right east (`stairRight(0)`).
  const east = [0, 1, 2, 3, 4, 5].flatMap((y) => wall(1, y, -3))
  const west = [0, 1, 2, 3, 4, 5].flatMap((y) => wall(-1, y, -3))
  assert.deepEqual(stairWallSides([], s.from, s.to, s.cfg.width), { left: false, right: false }, 'open air is not a wall')
  assert.deepEqual(stairWallSides(east, s.from, s.to, s.cfg.width), { left: false, right: true })
  assert.deepEqual(stairWallSides(west, s.from, s.to, s.cfg.width), { left: true, right: false })
  assert.deepEqual(stairWallSides([...east, ...west], s.from, s.to, s.cfg.width), { left: true, right: true })
  // A flight not laid along a cell axis has no cells beside it: both rails stay.
  assert.deepEqual(stairWallSides(east, { x: 0, y: 0, z: -4 }, { x: 3, y: 3, z: 0 }, s.cfg.width), { left: false, right: false })
})

test('a wall that does not hug the whole flight leaves the handrail on', () => {
  const s = createModule('stair-straight', 0, 0, -4, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(s && s.type === 'stair')
  // A wall along the first three cells only: half the run is open.
  assert.deepEqual(stairWallSides([0, 1, 2].flatMap((y) => wall(1, y, -3)), s.from, s.to, s.cfg.width), { left: false, right: false })
  // A wall only as tall as the bottom steps: two metres up the third cell the
  // flight stands beside nothing.
  assert.deepEqual(stairWallSides([0, 1, 2, 3, 4, 5].flatMap((y) => wall(1, y, -3).slice(0, 2)), s.from, s.to, s.cfg.width), { left: false, right: false })
  // A doorway punched through one course of an otherwise full-height wall.
  const holed = [0, 1, 2, 3, 4, 5].flatMap((y) => wall(1, y, -3)).filter((c) => !(c.y === 2 && c.z === -2))
  assert.deepEqual(stairWallSides(holed, s.from, s.to, s.cfg.width), { left: false, right: false })
  // A wall standing only on the storey above: the flight climbs out from under it.
  assert.deepEqual(stairWallSides([0, 1, 2, 3, 4, 5].flatMap((y) => wall(1, y, 1)), s.from, s.to, s.cfg.width), { left: false, right: false })
})

test('the top course a wall shares with the floor slab above still counts', () => {
  // A stairwell wall reaching the slab the flight lands on leaves that top course
  // as the floor above it (the auto-wall ring will not stack a wall on a slab), so
  // the check reads solids, not wall tags.
  const s = createModule('stair-straight', 0, 0, -4, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(s && s.type === 'stair')
  const beside = [0, 1, 2, 3, 4, 5].flatMap((y) => [...wall(1, y, -3).slice(0, 3), { x: 1, y, z: 0, fill: 'solid', tags: ['auto-floor'] }])
  assert.deepEqual(stairWallSides(beside, s.from, s.to, s.cfg.width), { left: false, right: true })
})

test('a turning stair is judged flight by flight, at each flight’s own heights', () => {
  const turn = createModule('stair-right90', 0, 0, -4, 't', 0, STAIR_WIDTH_NARROW)
  assert.ok(turn && turn.type === 'stair')
  const [first, second] = stairFlights(turn)
  // A wall along the first flight's east side walls that flight alone.
  const eastOfFirst = [0, 1, 2].flatMap((y) => wall(1, y, -3))
  assert.deepEqual(stairWallSides(eastOfFirst, first.from, first.to, turn.cfg.width), { left: false, right: true })
  assert.deepEqual(stairWallSides(eastOfFirst, second.from, second.to, turn.cfg.width), { left: false, right: false })
  // The half-landing flight runs +x, so its left is north, and the wall beside it
  // stands on the landing one storey's half up — not on the floor below.
  const northOfSecond = [0, 1, 2].flatMap((x) => wall(x, 4, -1))
  assert.deepEqual(stairWallSides(northOfSecond, second.from, second.to, turn.cfg.width), { left: true, right: false })
  assert.deepEqual(stairWallSides(northOfSecond, first.from, first.to, turn.cfg.width), { left: false, right: false })
})

test('a switchback’s turn cells are the row of landings between its flights', () => {
  const m = {
    id: 'turn',
    type: 'stair',
    x: 0,
    y: 0,
    z: -4,
    from: { x: 0, y: 0, z: -4 },
    to: { x: 2, y: 0, z: 0 },
    cfg: {
      width: 1.6,
      style: 'right180',
      flights: [
        { from: { x: 0, y: 0, z: -4 }, to: { x: 0, y: 2, z: -2 } },
        { from: { x: 2, y: 2, z: -2 }, to: { x: 2, y: 0, z: 0 } },
      ],
    },
  }
  const cells = stairTurnCells(m).map((c) => key(c)).sort()
  // The row runs between the two flight ends and is as wide as the treads that
  // end on it: this piece is 1.6 m wide, so its bands reach half a metre past the
  // three cells the paths stand in, and the landing holds those cells too.
  assert.deepEqual(cells, ['-1,2,-2', '0,2,-2', '1,2,-2', '2,2,-2', '3,2,-2'])
})

test('a placeable stair is a fixed one-storey piece run along its rotation', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = createModule('stair', 3, 5, -4, 's', rot, STAIR_WIDTH_NARROW)
    assert.ok(m && m.type === 'stair')
    const [dx, dy] = stairFacing(rot)
    assert.deepEqual(m.from, { x: 3, y: 5, z: -4 }, 'the base cell is the bottom landing')
    assert.deepEqual(m.to, { x: 3 + dx * STAIR_RUN, y: 5 + dy * STAIR_RUN, z: -4 + STAIR_RISE })
    assert.equal(m.cfg.width, STAIR_WIDTH_NARROW)
    assert.equal(m.cfg.style, 'straight')
  }
})

test('placing a stair carves the slab it climbs through', () => {
  const cells = []
  for (let x = 0; x < 3; x++) for (let y = 0; y < 9; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const state = toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
  const mod = createModule('stair', 1, 0, -4, 'stair-1', 0, STAIR_WIDTH_NARROW)
  assert.ok(mod)
  const next = addEquipment(state, mod)
  assert.equal(next.modules.length, 1)
  // The stair runs +y from (1, 0): its slab above the walking line is opened.
  assert.ok(next.cells.length < state.cells.length, 'the slab it climbs through is carved')
})

test('the five stair buttons each build their fixed one-storey shape', () => {
  const expected = { 'stair-straight': 1, 'stair-left90': 2, 'stair-right90': 2, 'stair-right180': 2, 'stair-left180': 2 }
  for (const [id, nFlights] of Object.entries(expected)) {
    const m = createModule(id, 4, 4, -4, 'x', 0, STAIR_WIDTH_NARROW)
    assert.ok(m && m.type === 'stair', `${id} did not build a stair`)
    assert.equal(m.cfg.flights.length, nFlights, `${id} has the wrong flight count`)
    assert.equal(m.from.z, -4, `${id} base is not the floor it was placed on`)
    assert.equal(m.to.z, 0, `${id} does not climb exactly one storey`)
    for (const f of m.cfg.flights) assert.notEqual(f.from.z, f.to.z, `${id} has a flat flight`)
  }
})

/**
 * A minimal stairwell: a floor at −4 to stand the stair on, a full slab at 0 to
 * climb through, and nothing else at the half height — so the only way from the
 * bottom landing to the top one is the stair itself. `addEquipment` lays the
 * turn landing and carves the slab the flights pass through.
 */
function stairwell(mod) {
  const cells = []
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) cells.push({ x, y, z: -4, fill: 'solid' })
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const state = addEquipment(toState({ name: 'well', seed: 1, cells, modules: [], lines: [] }), mod)
  return buildGraph({ name: 'well', seed: 1, cells: state.cells, modules: state.modules, lines: [] })
}

/** True when `to` is reachable from `from` over the given cells alone. */
function reachableWithin(g, from, to, cells) {
  const allowed = new Set(cells.map(key))
  const seen = new Set([from])
  const q = [from]
  while (q.length) {
    const n = q.shift()
    if (n === to) return true
    for (let e = g.adjStart[n]; e < g.adjStart[n + 1]; e++) {
      const nb = g.adjTo[e]
      if (seen.has(nb)) continue
      if (!allowed.has(`${g.nodeX[nb] - 0.5},${g.nodeY[nb] - 0.5},${g.nodeZ[nb] - 1}`)) continue
      seen.add(nb)
      q.push(nb)
    }
  }
  return false
}

test('a switchback’s runs share their balustrades: 2 / 4 / 6 blocks across', () => {
  // The two runs are laid in neighbouring columns (one cell per lane), and the
  // returning flight's treads slide across until its balustrade meets the first
  // run's — the shared centre balustrade a real 双跑楼梯 has. No floor is left
  // between the runs, and the **size is the blocks the piece takes across**, two per
  // run: 窄 claims 2, 中 4 and 宽 6 — which is what fixes the 宽 size's 2.5 m treads,
  // since a flush pair of three lanes a side (2.04 m) reaches into five blocks only.
  for (const [width, blocks] of [
    [STAIR_WIDTH_NARROW, 2],
    [STAIR_WIDTH_DOUBLE, 4],
    [STAIR_WIDTH_TRIPLE, 6],
  ]) {
    for (const style of ['right180', 'left180']) {
      const m = createModule(`stair-${style}`, 0, 0, -4, 'x', 0, width)
      assert.ok(m && m.type === 'stair')
      const [first, second] = m.cfg.flights
      const span = stairSwitchbackOffset(width)
      assert.equal(span, stairLanes(width), `${style} at ${width} m is not one cell per lane across`)
      // Both flights run the same way and the same length; the second is the
      // first, shifted across by `span` cells (mirrored for left180).
      const across = style === 'right180' ? span : -span
      assert.deepEqual(second.from, { x: first.to.x + across, y: first.to.y, z: first.to.z })
      assert.deepEqual(second.to, { x: first.from.x + across, y: first.from.y, z: first.to.z + STAIR_FLIGHT_RISE })
      // Both runs are laid **on the block grid**: each moves half a block across (a whole
      // block at three lanes) along the run's right, so the flush pair covers `2 × lanes`
      // blocks from the base cell and the balustrades land on the cell edges — nothing to
      // slide closed, which is what a piece saved at an older width still needs.
      const slides = stairFlightSlides(m)
      const grid = blocks / 4 - 0.5
      assert.deepEqual(slides[0], { dx: grid, dy: 0 }, `${style} at ${width} m is not centred on its blocks`)
      assert.deepEqual(slides[1], { dx: grid, dy: 0 }, `${style} at ${width} m: the pair must move together`)
      const run = m.cfg.width
      assert.ok(Math.abs(run + 2 * STAIR_RAIL_PROUD - blocks / 2) < 1e-9, `${style} at ${width} m is not a block-wide run`)
      // The two bands come out exactly `stairSwitchbackGap(run)` apart = the blocks a run
      // fills, so their handrails meet back to back on the seam.
      assert.ok(Math.abs(span - stairSwitchbackGap(run)) < 1e-9, `${style} at ${width} m leaves a corridor between the runs`)
      // The blocks the piece claims are the blocks a 围栏 cannot stand in: probe
      // every column along the flights with a fence at the half height.
      const claimed = []
      for (let x = -6; x <= 8; x++) {
        if (placementBlocked([m], createModule('fence', x, 1, -2, 'f', 0))) claimed.push(x)
      }
      assert.equal(claimed.length, blocks, `${style} at ${width} m claims ${claimed.length} blocks (${claimed.join(',')}), not ${blocks}`)
      // The first block is the base cell itself: the pair grows along the run's right, so
      // the piece never hangs off the west side of the cell it was placed on.
      assert.equal(claimed[0], style === 'right180' ? 0 : -blocks / 2, `${style} at ${width} m starts at ${claimed[0]}`)
      // The half-landing holds the floor the treads end on, in the same blocks.
      const turn = stairTurnCells(m)
      assert.equal(turn.length, blocks, `${style} at ${width} m lays ${turn.length} landing cells, not ${blocks}`)
      const along = turn.every((c) => c.x === turn[0].x) ? 'y' : 'x'
      const spread = Math.max(...turn.map((c) => c[along])) - Math.min(...turn.map((c) => c[along])) + 1
      assert.equal(spread, blocks, `${style} at ${width} m turns on more than one row`)
    }
  }
})

test('a piece saved at an older, off-grid width keeps its own band', () => {
  // Every switchback placed before the runs were block-wide (a 1.36 m 中, a 1.6 m saved
  // piece) is left exactly where it was: its band centred on its walking line, and the
  // return run slid toward the first until the rails meet. Moving it would also move it
  // off the opening the builder carved for it.
  const m = createModule('stair-right180', 0, 0, -4, 'x', 0, STAIR_WIDTH_DOUBLE)
  assert.ok(m && m.type === 'stair')
  m.cfg.width = STAIR_WIDTH_DOUBLE // as a station saved before the block grid stores it
  const slides = stairFlightSlides(m)
  assert.deepEqual(slides[0], { dx: 0, dy: 0 }, 'an old piece must not move')
  const slide = Math.hypot(slides[1].dx, slides[1].dy)
  assert.ok(slide > 0, 'an old piece still closes its well')
  assert.equal(Math.sign(slides[1].dx), -1, 'the return run slides toward the first')
  assert.equal(slides[1].dy, 0)
  assert.ok(Math.abs(stairSwitchbackOffset(STAIR_WIDTH_DOUBLE) - slide - stairSwitchbackGap(STAIR_WIDTH_DOUBLE)) < 0.05)
})

test('a switchback in a stairwell leans on the walls, and loses the rails they replace', () => {
  // The two runs stand on the block grid, so a wall built beside the piece stands flush
  // against the outer balustrade of each run — and that balustrade goes, exactly like a
  // straight flight's. The turn landing's two long sides lean on the same walls, and its
  // railing goes with them: a 双跑楼梯 in a stairwell is railed only where it is open.
  const m = createModule('stair-right180', 0, 0, -4, 'x', 0, STAIR_WIDTH_DOUBLE)
  assert.ok(m && m.type === 'stair')
  const slides = stairFlightSlides(m)
  const column = (x, ys) => ys.flatMap((y) => [-4, -3, -2, -1, 0].map((z) => ({ x, y, z, fill: 'solid', tags: ['wall'] })))
  const sides = (cells) =>
    stairFlights(m).map((f, i) => {
      const s = stairWallSides(cells, f.from, f.to, m.cfg.width, slides[i])
      return `${s.left ? 'L' : '-'}${s.right ? 'R' : '-'}`
    })
  const ys = [0, 1, 2, 3, 4]
  assert.deepEqual(sides([]), ['--', '--'], 'open air is not a wall')
  // The west wall hugs run 1's west side, the east wall run 2's east side (it climbs back
  // down, so its "left" is east).
  assert.deepEqual(sides(column(-1, ys)), ['L-', '--'])
  assert.deepEqual(sides(column(4, ys)), ['--', 'L-'])
  const both = [...column(-1, ys), ...column(4, ys)]
  assert.deepEqual(sides(both), ['L-', 'L-'])
  // The landing between the runs reads the same two walls, at its own storey, and the
  // open north end of the stairwell does not.
  assert.deepEqual(stairLandingWalls([], m, 0), { w: false, e: false, s: false, n: false })
  assert.deepEqual(stairLandingWalls(both, m, 0), { w: true, e: true, s: false, n: false })
  assert.deepEqual(stairLandingWalls([0, 1, 2, 3].flatMap((x) => column(x, [4])), m, 0), {
    w: false,
    e: false,
    s: false,
    n: true,
  })
  // The platform spans the two runs' blocks **across** and exactly one block — the row the
  // runs turn on — along them: a platform as deep as the runs are wide would hang over the
  // rows below and above, across the last steps of the run climbing into it.
  const shape = stairLandingShape(m, 0)
  assert.ok(Math.abs(shape.x0 - 0.105) < 1e-9 && Math.abs(shape.x1 - 3.895) < 1e-9, `the landing spans ${shape.x0}..${shape.x1}`)
  assert.ok(Math.abs(shape.y0 - 3) < 1e-9 && Math.abs(shape.y1 - 4) < 1e-9, `the landing is ${shape.y0}..${shape.y1} deep, not one block`)
  assert.ok(Math.abs(shape.z - -2) < 1e-9, 'the landing is read at its own storey')
  // A 90° turn meets at one cell on both axes, so its platform stays a square the stair's
  // width across rather than a block.
  const turn = createModule('stair-right90', 0, 0, -4, 't', 0, STAIR_WIDTH_NARROW)
  assert.ok(turn && turn.type === 'stair')
  const square = stairLandingShape(turn, 0)
  assert.ok(Math.abs(square.x1 - square.x0 - STAIR_WIDTH_NARROW) < 1e-9, `the corner platform is ${square.x1 - square.x0} across`)
  assert.ok(Math.abs(square.y1 - square.y0 - STAIR_WIDTH_NARROW) < 1e-9)
})

test('bulldozing a turning stair takes its half-landing block with it', () => {
  // The landing floor is the *stair's*: the block mesher skips it while the model draws the
  // platform there, so a stair deleted on its own would leave a stray 1 m block in the middle
  // of the station — the shape a piece is torn down and rebuilt in. A straight stair lays no
  // such cell, and a block the player put there by hand is not the stair's to take away.
  const cells = []
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) cells.push({ x, y, z: -4, fill: 'solid' })
  const handLaid = { x: 6, y: 6, z: -3, fill: 'solid' }
  const base = toState({ name: 'well', seed: 1, cells: [...cells, handLaid], modules: [], lines: [] })
  const holds = (list, p) => list.some((c) => c.x === p.x && c.y === p.y && c.z === p.z)
  for (const id of ['stair-right90', 'stair-left180']) {
    const mod = createModule(id, 2, 2, -4, 'x', 0, STAIR_WIDTH_NARROW)
    assert.ok(mod)
    const laid = stairTurnCells(mod)
    assert.ok(laid.length > 0, `${id} lays no turn landing`)
    const placed = addEquipment(base, mod)
    for (const p of laid) assert.ok(holds(placed.cells, p), `${id}: the landing at ${key(p)} was not laid`)
    const after = removeModule(placed, mod.id)
    assert.equal(after.modules.length, 0, `${id} was not bulldozed`)
    for (const p of laid) assert.ok(!holds(after.cells, p), `${id}: the landing at ${key(p)} was left behind`)
    assert.ok(holds(after.cells, handLaid), `${id}: a hand-laid block went with it`)
  }
  // A straight stair lays no landing cell at all, so bulldozing it leaves the station exactly
  // as the ground it stood on.
  const straight = createModule('stair-straight', 2, 2, -4, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(straight)
  assert.deepEqual(stairTurnCells(straight), [])
  const placed = addEquipment(base, straight)
  assert.equal(removeModule(placed, straight.id).cells.length, placed.cells.length, 'a straight stair took a cell with it')
})

test('a landing another piece stands on is kept when the stair goes', () => {
  // The landing cell is floor like any other, so a piece that **spans** it keeps it: a 2 m
  // 座椅 laid across the turn landing still stands on both of its cells once the stair is
  // bulldozed. Protecting only each remaining piece's *anchor* cell left the floor under the
  // bench's far half to be taken away with the stair, so the bench stood over void.
  const cells = []
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) cells.push({ x, y, z: -4, fill: 'solid' })
  const base = toState({ name: 'well', seed: 1, cells, modules: [], lines: [] })
  const holds = (list, p) => list.some((c) => c.x === p.x && c.y === p.y && c.z === p.z)
  const stair = createModule('stair-right180', 2, 2, -4, 'x', 0, STAIR_WIDTH_NARROW)
  assert.ok(stair)
  const row = stairTurnCells(stair).slice().sort((a, b) => a.x - b.x || a.y - b.y)
  assert.ok(row.length >= 2, 'the rig needs a landing two cells wide to span')
  const placed = addEquipment(base, stair)
  // A 2 m 座椅 along the landing row: its own run spans the row's first two cells.
  const bench = createModule('bench-steel-2', row[0].x, row[0].y, row[0].z, 'b1', 0, undefined)
  assert.ok(bench && bench.type === 'bench')
  const withBench = addEquipment(placed, bench)
  for (const p of [row[0], row[1]]) assert.ok(holds(withBench.cells, p), 'the bench’s own cell is not floor')

  const after = removeModule(withBench, stair.id)
  assert.equal(after.modules.length, 1, 'the bench went with the stair')
  for (const p of [row[0], row[1]]) {
    assert.ok(holds(after.cells, p), `the floor under the bench at ${key(p)} was taken away with the stair`)
  }
})

test('both hands of a switchback climb their flights and are walked across the turn', () => {
  // Each flight is a two-way edge and the half-landing between them is walked
  // cell by cell: the flight the switchback turns back into may not seal the
  // landing off, or the bottom and the top of the stair are two dead ends.
  for (const width of [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_TRIPLE]) {
    for (const style of ['right180', 'left180']) {
      const m = createModule(`stair-${style}`, 0, 0, -4, 'x', 0, width)
      assert.ok(m && m.type === 'stair')
      const g = stairwell(m)
      const bottom = g.nodeIndex.get(key(m.from))
      const top = g.nodeIndex.get(key(m.to))
      assert.notEqual(bottom, undefined, `${style}: the lower landing is not walkable`)
      assert.notEqual(top, undefined, `${style}: the upper landing is not walkable`)
      assert.ok(reachable(g, bottom, top), `${style} at ${width} m is not walked bottom to top`)
      // The turn is walked across the landing itself — every one of its cells is
      // a node and the two flight ends join over those cells and nothing else.
      const row = stairTurnCells(m)
      const a = m.cfg.flights[0].to
      const b = m.cfg.flights[1].from
      for (const p of row) assert.notEqual(g.nodeIndex.get(key(p)), undefined, `${style}: landing ${key(p)} is not walkable`)
      assert.ok(
        reachableWithin(g, g.nodeIndex.get(key(a)), g.nodeIndex.get(key(b)), row),
        `${style} at ${width} m has its landing sealed: the two flights are not joined`,
      )
    }
  }
})

test('the two switchbacks are mirror images of each other', () => {
  const right = createModule('stair-right180', 0, 0, -4, 'r', 0, STAIR_WIDTH_DOUBLE)
  const left = createModule('stair-left180', 0, 0, -4, 'l', 0, STAIR_WIDTH_DOUBLE)
  assert.ok(right && right.type === 'stair' && left && left.type === 'stair')
  // The first flight is shared; the second is the same run on the other hand of
  // the turn, so the two landings mirror across the first flight's centreline.
  assert.deepEqual(right.cfg.flights[0], left.cfg.flights[0])
  assert.deepEqual(right.cfg.flights[1].from, { x: -left.cfg.flights[1].from.x, y: left.cfg.flights[1].from.y, z: left.cfg.flights[1].from.z })
  assert.deepEqual(right.cfg.flights[1].to, { x: -left.cfg.flights[1].to.x, y: left.cfg.flights[1].to.y, z: left.cfg.flights[1].to.z })
  // R only ever turns the piece about its base, so the two hands stay distinct
  // at every rotation.
  for (let rot = 0; rot < 4; rot++) {
    const r = createModule('stair-right180', 0, 0, -4, 'r', rot, STAIR_WIDTH_NARROW)
    const l = createModule('stair-left180', 0, 0, -4, 'l', rot, STAIR_WIDTH_NARROW)
    assert.notDeepEqual(r.cfg.flights, l.cfg.flights, `rot ${rot} builds the same switchback either way`)
  }
})

test('placing a turning stair lays its half-landing as a walkable cell', () => {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 4, fill: 'solid' })
  const state = toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
  const mod = createModule('stair-left90', 2, 2, 4, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(mod)
  const next = addEquipment(state, mod)
  // The half-landing sits one storey up, between the two flights.
  const landing = stairTurnCells(mod)
  assert.ok(landing.length > 0, 'the turning stair has an interior landing')
  for (const p of landing) assert.ok(next.cells.some((c) => c.x === p.x && c.y === p.y && c.z === p.z), `landing ${key(p)} was not laid`)
})

test('carving a turning stair keeps its landings and opens the slab it climbs through', () => {
  const cells = []
  for (let x = -2; x <= 3; x++) for (let y = 0; y <= 3; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  // The half-landing at the turn, between the two flights.
  for (const x of [0, 1, 2]) cells.push({ x, y: 2, z: -2, fill: 'solid' })
  const m = {
    id: 'turn',
    type: 'stair',
    x: 0,
    y: 0,
    z: -4,
    from: { x: 0, y: 0, z: -4 },
    to: { x: 2, y: 0, z: 0 },
    cfg: {
      width: 1.6,
      style: 'right180',
      flights: [
        { from: { x: 0, y: 0, z: -4 }, to: { x: 0, y: 2, z: -2 } },
        { from: { x: 2, y: 2, z: -2 }, to: { x: 2, y: 0, z: 0 } },
      ],
    },
  }
  const removed = carveRampOpenings(cells, [m])
  assert.ok(removed > 0, 'the roof the stair climbs through is carved')
  assert.ok(cells.some((c) => c.x === 1 && c.y === 2 && c.z === -2), 'the half-landing is kept')
  assert.ok(cells.some((c) => c.x === 2 && c.y === 0 && c.z === 0), 'the top landing is kept')
})
