// Staircases, GAME-SPEC.md §5.1.
//
// A stair climbs exactly one storey, like an escalator, but it turns, and the
// turn is real: each flight is its own two-way graph edge and each half/quarter
// landing is a walkable node between them. These tests pin that down — the four
// styles, the graph join, and the carve that keeps the landings while opening
// the slab the flights pass through.
import test from 'node:test'
import assert from 'node:assert/strict'
import { scenarioStation } from './support/scenario-station.ts'
import { buildGraph, EDGE_KIND } from '../src/sim/station.ts'
import { carveRampOpenings } from '../src/sim/openings.ts'
import { ESCALATOR_BAND } from '../src/sim/constants.ts'
import { STAIR_RISE, STAIR_RUN, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_NARROW, STAIR_WIDTH_TRIPLE, STAIR_WIDTHS, nextStairWidth, planStairLanes, stairFacing, stairFlights, stairLaneBases, stairLaneMates, stairLandings, stairLanes, stairRight, stairTurnCells } from '../src/sim/stairs.ts'
import { addEquipment, createModule, toState } from '../src/build/model.ts'

const key = (p) => `${p.x},${p.y},${p.z}`

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

test('stair widths cycle one → two → three lanes, each an escalator band wide', () => {
  assert.deepEqual(STAIR_WIDTHS, [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_TRIPLE])
  assert.equal(STAIR_WIDTH_NARROW, ESCALATOR_BAND)
  assert.equal(STAIR_WIDTH_DOUBLE, 2 * ESCALATOR_BAND)
  assert.equal(STAIR_WIDTH_TRIPLE, 3 * ESCALATOR_BAND)
  assert.equal(nextStairWidth(STAIR_WIDTH_NARROW), STAIR_WIDTH_DOUBLE)
  assert.equal(nextStairWidth(STAIR_WIDTH_DOUBLE), STAIR_WIDTH_TRIPLE)
  assert.equal(nextStairWidth(STAIR_WIDTH_TRIPLE), STAIR_WIDTH_NARROW)
  // A width that is not a whole number of lanes (an old 1.6 m stair) reads as the
  // nearest one.
  assert.equal(stairLanes(ESCALATOR_BAND), 1)
  assert.equal(stairLanes(STAIR_WIDTH_DOUBLE), 2)
  assert.equal(stairLanes(STAIR_WIDTH_TRIPLE), 3)
  assert.equal(stairLanes(1.6), 2)
  assert.equal(stairLanes(0.2), 1)
  assert.equal(stairLanes(9), 3)
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
  assert.deepEqual(cells, ['0,2,-2', '1,2,-2', '2,2,-2'])
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

test('the four stair buttons each build their fixed one-storey shape', () => {
  const expected = { 'stair-straight': 1, 'stair-left90': 2, 'stair-right90': 2, 'stair-right180': 2 }
  for (const [id, nFlights] of Object.entries(expected)) {
    const m = createModule(id, 4, 4, -4, 'x', 0, STAIR_WIDTH_NARROW)
    assert.ok(m && m.type === 'stair', `${id} did not build a stair`)
    assert.equal(m.cfg.flights.length, nFlights, `${id} has the wrong flight count`)
    assert.equal(m.from.z, -4, `${id} base is not the floor it was placed on`)
    assert.equal(m.to.z, 0, `${id} does not climb exactly one storey`)
    for (const f of m.cfg.flights) assert.notEqual(f.from.z, f.to.z, `${id} has a flat flight`)
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
