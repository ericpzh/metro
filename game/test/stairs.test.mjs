// Staircases, GAME-SPEC.md §5.1.
//
// A stair climbs exactly one storey, like an escalator, but it turns, and the
// turn is real: each flight is its own two-way graph edge and each half/quarter
// landing is a walkable node between them. These tests pin that down — the five
// styles, the flush switchback, the graph join, and the carve that keeps the
// landings while opening the slab the flights pass through.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { StairModel } from '../src/render/models/pieces/StairModel.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { buildGraph, EDGE_KIND } from '../src/sim/station.ts'
import { carveRampOpenings, rampBodyBoxes, rampCorridorHalf, rampEnvelope, thinWallCells } from '../src/sim/openings.ts'
import { placementBlocked } from '../src/sim/placement.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore } from '../src/app/store.ts'
import { ESCALATOR_BAND, STAIR_RAIL_PROUD } from '../src/sim/constants.ts'
import { STAIR_FLIGHT_RISE, STAIR_RISE, STAIR_RUN, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_LABELS, STAIR_WIDTH_NARROW, STAIR_WIDTH_TRIPLE, STAIR_WIDTHS, nextStairWidth, planStairLanes, stairBuildWidth, stairFacing, stairFlightSlides, stairFlights, stairFlightsFor, stairLaneBases, stairLaneMates, stairLandingShape, stairLandingWalls, stairLandings, stairLanes, stairLevels, stairOnBlockGrid, stairQuarterTurnOffset, stairRight, stairRotFor, stairRunBlocks, stairSwitchbackGap, stairSwitchbackOffset, stairSwitchbackRunWidth, stairTurnCells, stairWallSides, stairWidthLabel } from '../src/sim/stairs.ts'
import { addEquipment, createModule, removeModule, toData, toState, wallRun } from '../src/build/model.ts'

test('saved straight stair sizes reserve their full block band and detect walls at its edges', () => {
  for (let rot = 0; rot < 4; rot++) {
    const [rx, ry] = stairRight(rot)
    for (const [width, blocks] of [[0.68, 1], [1.36, 2], [2.04, 3]]) {
      const m = createModule('stair-straight', 0, 0, 0, 'stair', rot, width)
      assert.equal(m.cfg.width, width, 'stored size stays compatible with saved stairs and the picker')
      const slide = stairFlightSlides(m)[0]
      assert.deepEqual(slide, { dx: rx * (blocks - 1) / 2 || 0, dy: ry * (blocks - 1) / 2 || 0 })
      assert.ok(Math.abs(rampCorridorHalf(m) - blocks / 2) < 1e-9,
        'carving includes the full width of the two outer rails')
      const e = rampEnvelope(m)
      const lo = rx ? e.x0 : e.y0
      const hi = rx ? e.x1 : e.y1
      // The physical tread leaves room for its balustrades inside the blocks.
      assert.ok(Math.abs((lo + hi) / 2 - (0.5 + (rx || ry) * (blocks - 1) / 2)) < 1e-9,
        'collision envelope uses the same centre as the rendered flight')
      const walls = []
      const [fx, fy] = stairFacing(rot)
      for (const side of [-1, blocks]) {
        for (let along = 0; along <= STAIR_RUN; along++) {
          for (let z = 0; z <= STAIR_RISE + 2; z++) {
            walls.push({ x: fx * along + rx * side, y: fy * along + ry * side, z, fill: 'solid' })
          }
        }
      }
      const treadWidth = blocks - 2 * STAIR_RAIL_PROUD
      assert.deepEqual(stairWallSides(walls, m.from, m.to, treadWidth, slide), { left: true, right: true })
      assert.equal(carveRampOpenings(walls, [m]), 0, 'full-block fit does not carve adjacent walls')
      assert.deepEqual(thinWallCells(walls, [m]), [], 'adjacent blocks remain whole walls')
    }
  }
})

const key = (p) => `${p.x},${p.y},${p.z}`

test('explicit block-fitted stair widths retain their palette size and Tab cycle', () => {
  for (const [width, blocks, label, next] of [
    [0.79, 1, '窄', STAIR_WIDTH_DOUBLE],
    [1.79, 2, '中', STAIR_WIDTH_TRIPLE],
    [2.79, 3, '宽', STAIR_WIDTH_NARROW],
  ]) {
    assert.equal(stairLanes(width), blocks, 'stored fitted width identifies the same number of blocks')
    assert.equal(stairWidthLabel(width), label)
    assert.equal(nextStairWidth(width), next, 'Tab advances from the saved size rather than resetting to narrow')
  }
})

test('explicit fitted narrow stairs still join adjacent stair treads while keeping their own rails', () => {
  const a = createModule('stair-straight', 0, 0, 0, 'a', 0, 0.79)
  const b = createModule('stair-straight', 1, 0, 0, 'b', 0, 0.79)
  assert.deepEqual(stairLaneMates([a, b], a), [{ mate: b, step: [1, 0], side: 1, sameFlight: false }])
  assert.deepEqual(stairLaneMates([a, b], b), [{ mate: a, step: [-1, 0], side: -1, sameFlight: false }])
})

test('the equipment tool places each straight stair size as one standalone module in every rotation', () => {
  const previous = useStore.getState()
  try {
    useStore.setState({ station: { ...previous.station, cells: [], modules: [] } })
    const tool = new EquipmentTool({})
    for (const width of STAIR_WIDTHS) {
      for (let rot = 0; rot < 4; rot++) {
        useStore.setState({ stairWidth: width, moduleRot: rot })
        for (const type of ['stair', 'stair-straight']) {
          const pieces = tool.buildPlacementModules(type, [0, 0, 0], 'whole-stair')
          assert.equal(pieces.length, 1, 'preview and placement carry one selectable/deletable piece')
          assert.equal(pieces[0].cfg.width, width, 'the standalone piece keeps the chosen full width')
          assert.equal(pieces[0].cfg.flight, undefined, 'no token ties separate narrow stairs together')
          assert.equal(stairFlights(pieces[0]).length, 1, 'one continuous straight flight')
        }
      }
    }
  } finally {
    useStore.setState({ station: previous.station, stairWidth: previous.stairWidth, moduleRot: previous.moduleRot })
  }
})

test('the equipment tool places a turning stair’s block-grid legs and square landing', () => {
  // Preview and commit are one piece built by the same factory call, so the ghost a player
  // aims with carries the square landing and the departing leg laid on its far edge — never a
  // strip, and never a leg starting on the corner cell the drawing no longer uses.
  const previous = useStore.getState()
  try {
    useStore.setState({ station: { ...previous.station, cells: [], modules: [] } })
    const tool = new EquipmentTool({})
    for (const style of ['right90', 'left90', 'right180', 'left180']) {
      for (const width of STAIR_WIDTHS) {
        useStore.setState({ stairWidth: width, moduleRot: 0 })
        const type = `stair-${style}`
        const pieces = tool.buildPlacementModules(type, [0, 0, 0], 'turn')
        assert.equal(pieces.length, 1, `${type}/${width}: preview and placement carry one piece`)
        const fresh = createModule(type, 0, 0, 0, 'turn', 0, width, 'up', 'lane', [], undefined, { storeyHeight: previous.station.storeyHeight })
        assert.deepEqual(pieces[0].cfg.flights, fresh.cfg.flights, `${type}/${width}: the ghost is not the piece the factory builds`)
        assert.equal(pieces[0].cfg.width, fresh.cfg.width, `${type}/${width}: the ghost's run width`)
        if (!style.endsWith('90')) continue
        const lanes = stairLanes(width)
        assert.equal(stairTurnCells(pieces[0]).length, lanes * lanes, `${type}/${width}: the quarter-landing is not ${lanes} × ${lanes}`)
        // Every whole block the legs fill, and the square between them: the aim cell is the
        // corner, so the piece never crosses into a column or row it was not drawn in.
        const [first, second] = stairFlights(pieces[0])
        assert.equal(Number.isInteger(stairFlightSlides(pieces[0])[0].dx + first.from.x + 0.5 - lanes / 2), true, `${type}/${width}: the first leg is off the grid`)
        assert.equal(Math.abs(second.from.x - first.to.x) + Math.abs(second.from.y - first.to.y), lanes - 1, `${type}/${width}: the departing leg is not on the square's far edge`)
      }
    }
  } finally {
    useStore.setState({ station: previous.station, stairWidth: previous.stairWidth, moduleRot: previous.moduleRot })
  }
})

test('a 90° turn’s landing is one block of side per lane, read from the piece itself', () => {
  // The landing's depth less one is how far in the departing leg starts: zero at 窄 — the turn
  // the game always drew — one at 中 and two at 宽.
  assert.equal(stairQuarterTurnOffset(STAIR_WIDTH_NARROW), 0)
  assert.equal(stairQuarterTurnOffset(STAIR_WIDTH_DOUBLE), 1)
  assert.equal(stairQuarterTurnOffset(STAIR_WIDTH_TRIPLE), 2)
  // Both the placed widths (`createModule` stores the block-fitted run, and a rebuilt piece is
  // handed that same number back) and the palette's own off-grid 1.6 m sample: the landing is
  // read from the **flights**, so its far edge is always where the departing leg's treads
  // start — half a landing cell from that leg's own lower landing, never a gap and never a
  // step standing on the platform.
  for (const width of [stairSwitchbackRunWidth(STAIR_WIDTH_NARROW), stairSwitchbackRunWidth(STAIR_WIDTH_DOUBLE), stairSwitchbackRunWidth(STAIR_WIDTH_TRIPLE), 1.6]) {
    for (const style of ['right90', 'left90']) {
      const flights = stairFlightsFor({ x: 0, y: 0, z: 0 }, 0, style, width)
      const mod = { id: 'sample', type: 'stair', x: 0, y: 0, z: 0, rot: 0, from: flights[0].from, to: flights[flights.length - 1].to, cfg: { width, style, flights } }
      const cells = stairTurnCells(mod)
      const shape = stairLandingShape(mod, 0)
      const corner = flights[0].to
      const start = flights[1].from
      const columns = cells.map((c) => c.x)
      assert.equal(Math.min(...columns), Math.min(corner.x, start.x), `${style}/${width}: the landing does not start at the corner cell`)
      assert.equal(Math.max(...columns), Math.max(corner.x, start.x), `${style}/${width}: the landing does not reach the departing leg`)
      const [ux] = [Math.sign(flights[1].to.x - flights[1].from.x)]
      const far = ux > 0 ? shape.x1 : shape.x0
      const treadStart = start.x + 0.5 + (ux > 0 ? 0.5 : -0.5)
      assert.ok(Math.abs(far - treadStart) < 1e-9, `${style}/${width}: the platform ends at ${far}, the treads start at ${treadStart}`)
    }
  }
})

test('a stair reports the storeys it reaches, and the off-axis answers are degenerate', () => {
  // The distinct storeys a stair touches, for level slicing (`SceneSystem` bands every piece
  // by them): a straight run stands on its base and one storey up; a turn also stands on its
  // half-storey landing, which is the level its square platform is drawn at.
  const straight = createModule('stair-straight', 0, 0, -5, 's', 0, STAIR_WIDTH_NARROW)
  assert.deepEqual(stairLevels(straight), [-5, 0])
  const turn = createModule('stair-right90', 0, 0, -5, 't', 0, STAIR_WIDTH_DOUBLE)
  assert.deepEqual(stairLevels(turn), [-5, -2.5, 0])
  // A step that is not a cell axis names no placement rotation (the exit-bay snap asks this),
  // and a flight that runs off the grid is no lane at all — degenerate answers, not promises.
  assert.equal(stairRotFor(1, 1), 0)
  const diagonal = {
    id: 'd',
    type: 'stair',
    x: 0,
    y: 0,
    z: -5,
    rot: 0,
    from: { x: 0, y: 0, z: -5 },
    to: { x: 3, y: 4, z: 0 },
    cfg: { width: STAIR_WIDTH_NARROW, style: 'straight', flights: [{ from: { x: 0, y: 0, z: -5 }, to: { x: 3, y: 4, z: 0 } }] },
  }
  assert.deepEqual(stairLaneMates([diagonal], diagonal), [])
})

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
  assert.equal(only.from.z - only.to.z, -5, `${only.id} does not climb exactly one storey`)
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
  const Z_MID = -2.5
  for (const x of [2, 3, 4, 5]) data.cells.push({ x, y: 13, z: Z_MID, fill: 'solid' })
  const mod = {
    id: 'u',
    type: 'stair',
    x: 2,
    y: 16,
    z: -5,
    from: { x: 2, y: 16, z: -5 },
    to: { x: 5, y: 16, z: 0 },
    cfg: {
      width: STAIR_WIDTH_NARROW,
      style: 'right180',
      flights: [
        { from: { x: 2, y: 16, z: -5 }, to: { x: 2, y: 13, z: Z_MID } },
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
  const landing = g.nodeIndex.get(key({ x: 2, y: 13, z: -2.5 }))
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
  const m = { id: 's', type: 'stair', x: 0, y: 0, z: 0, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 8, z: 5 }, cfg: { width: 2 } }
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
    // And that width is what the builder stores for **every turning shape** — the two
    // 180s and both 90s alike — while the single-run stair keeps the tool's own width
    // (its treads resolve through `stairTreadWidth`).
    assert.equal(stairBuildWidth('right180', size), run)
    assert.equal(stairBuildWidth('left180', size), run)
    assert.equal(stairBuildWidth('straight', size), size)
    assert.equal(stairBuildWidth('right90', size), run)
    assert.equal(stairBuildWidth('left90', size), run)
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
  assert.deepEqual(stairLaneBases({ x: 3, y: 5, z: -5 }, 0, 3), [
    { x: 3, y: 5, z: -5 },
    { x: 4, y: 5, z: -5 },
    { x: 5, y: 5, z: -5 },
  ])
  assert.deepEqual(stairLaneBases({ x: 3, y: 5, z: -5 }, 1, 2), [
    { x: 3, y: 5, z: -5 },
    { x: 3, y: 4, z: -5 },
  ])
  assert.deepEqual(stairLaneBases({ x: 3, y: 5, z: -5 }, 0, 1), [{ x: 3, y: 5, z: -5 }])
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
  const lane = (id, x, y, rot = 0, width = STAIR_WIDTH_NARROW, z = -5, flight) => {
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
  const fa = lane('a', 0, 0, 0, STAIR_WIDTH_NARROW, -5, 'f1')
  const fb = lane('b', 1, 0, 0, STAIR_WIDTH_NARROW, -5, 'f1')
  assert.deepEqual(stairLaneMates([fa, fb], fa).map((m) => m.sameFlight), [true])
  assert.deepEqual(stairLaneMates([fa, fb], fb).map((m) => m.sameFlight), [true])
  // Two different flights, or one lane with no token at all, are neighbours only.
  const fc = lane('c', 1, 0, 0, STAIR_WIDTH_NARROW, -5, 'f2')
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
  const turn = createModule('stair-left90', 1, 0, -5, 'turn', 0, STAIR_WIDTH_NARROW)
  assert.ok(turn)
  assert.deepEqual(stairLaneMates([a, turn], a), [])
  // A saved single-piece wide stair is one flight of its own: it does not merge,
  // and neither do two of them.
  const wide = lane('wide', 1, 0, 0, STAIR_WIDTH_DOUBLE)
  assert.deepEqual(stairLaneMates([a, wide], a), [])
  assert.deepEqual(stairLaneMates([wide, lane('wide2', 2, 0, 0, STAIR_WIDTH_DOUBLE)], wide), [])
})

test('a wall hugging a flight from bottom to top is the side it stands on', () => {
  const s = createModule('stair-straight', 0, 0, -5, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(s && s.type === 'stair')
  // The run climbs +y from (0,0) to (0,6), one storey: its left is west, its
  // right east (`stairRight(0)`).
  const east = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((y) => wall(1, y, -4))
  const west = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((y) => wall(-1, y, -4))
  assert.deepEqual(stairWallSides([], s.from, s.to, s.cfg.width), { left: false, right: false }, 'open air is not a wall')
  assert.deepEqual(stairWallSides(east, s.from, s.to, s.cfg.width), { left: false, right: true })
  assert.deepEqual(stairWallSides(west, s.from, s.to, s.cfg.width), { left: true, right: false })
  assert.deepEqual(stairWallSides([...east, ...west], s.from, s.to, s.cfg.width), { left: true, right: true })
  // A flight not laid along a cell axis has no cells beside it: both rails stay.
  assert.deepEqual(stairWallSides(east, { x: 0, y: 0, z: -5 }, { x: 3, y: 4, z: 0 }, s.cfg.width), { left: false, right: false })
})

test('a wall that does not hug the whole flight leaves the handrail on', () => {
  const s = createModule('stair-straight', 0, 0, -5, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(s && s.type === 'stair')
  // A wall along the first three cells only: half the run is open.
  assert.deepEqual(stairWallSides([0, 1, 2, 3].flatMap((y) => wall(1, y, -4)), s.from, s.to, s.cfg.width), { left: false, right: false })
  // A wall only as tall as the bottom steps: two metres up the third cell the
  // flight stands beside nothing.
  assert.deepEqual(stairWallSides([0, 1, 2, 3, 4, 5, 6, 7].flatMap((y) => wall(1, y, -4).slice(0, 2)), s.from, s.to, s.cfg.width), { left: false, right: false })
  // A doorway punched through one course of an otherwise full-height wall.
  const holed = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((y) => wall(1, y, -4)).filter((c) => !(c.y === 2 && c.z === -3))
  assert.deepEqual(stairWallSides(holed, s.from, s.to, s.cfg.width), { left: false, right: false })
  // A wall standing only on the storey above: the flight climbs out from under it.
  assert.deepEqual(stairWallSides([0, 1, 2, 3, 4, 5, 6, 7].flatMap((y) => wall(1, y, 1)), s.from, s.to, s.cfg.width), { left: false, right: false })
})

test('the top course a wall shares with the floor slab above still counts', () => {
  // A stairwell wall reaching the slab the flight lands on leaves that top course
  // as the floor above it (the auto-wall ring will not stack a wall on a slab), so
  // the check reads solids, not wall tags.
  const s = createModule('stair-straight', 0, 0, -5, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(s && s.type === 'stair')
  const beside = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((y) => [...wall(1, y, -4).slice(0, 4), { x: 1, y, z: 0, fill: 'solid', tags: ['auto-floor'] }])
  assert.deepEqual(stairWallSides(beside, s.from, s.to, s.cfg.width), { left: false, right: true })
})

test('a turning stair is judged flight by flight, at each flight’s own heights', () => {
  const turn = createModule('stair-right90', 0, 0, -5, 't', 0, STAIR_WIDTH_NARROW)
  assert.ok(turn && turn.type === 'stair')
  const [first, second] = stairFlights(turn)
  // A wall along the first flight's east side walls that flight alone.
  const eastOfFirst = [0, 1, 2, 3].flatMap((y) => wall(1, y, -4))
  assert.deepEqual(stairWallSides(eastOfFirst, first.from, first.to, turn.cfg.width), { left: false, right: true })
  assert.deepEqual(stairWallSides(eastOfFirst, second.from, second.to, turn.cfg.width), { left: false, right: false })
  // The half-landing flight runs +x, so its left is north, and the wall beside it
  // stands on the landing one storey's half up — not on the floor below.
  const northOfSecond = [0, 1, 2, 3].flatMap((x) => wall(x, 5, -2))
  assert.deepEqual(stairWallSides(northOfSecond, second.from, second.to, turn.cfg.width), { left: true, right: false })
  assert.deepEqual(stairWallSides(northOfSecond, first.from, first.to, turn.cfg.width), { left: false, right: false })
})

test('a switchback’s turn cells are the row of landings between its flights', () => {
  const m = {
    id: 'turn',
    type: 'stair',
    x: 0,
    y: 0,
    z: -5,
    from: { x: 0, y: 0, z: -5 },
    to: { x: 2, y: 0, z: 0 },
    cfg: {
      width: 1.6,
      style: 'right180',
      flights: [
        { from: { x: 0, y: 0, z: -5 }, to: { x: 0, y: 2, z: -2.5 } },
        { from: { x: 2, y: 2, z: -2.5 }, to: { x: 2, y: 0, z: 0 } },
      ],
    },
  }
  const cells = stairTurnCells(m).map((c) => key(c)).sort()
  // The row runs between the two flight ends and is as wide as the treads that
  // end on it: this piece is 1.6 m wide, so its bands reach half a metre past the
  // three cells the paths stand in, and the landing holds those cells too.
  assert.deepEqual(cells, ['-1,2,-2.5', '0,2,-2.5', '1,2,-2.5', '2,2,-2.5', '3,2,-2.5'])
})

test('a placeable stair is a fixed one-storey piece run along its rotation', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = createModule('stair', 3, 5, -5, 's', rot, STAIR_WIDTH_NARROW)
    assert.ok(m && m.type === 'stair')
    const [dx, dy] = stairFacing(rot)
    assert.deepEqual(m.from, { x: 3, y: 5, z: -5 }, 'the base cell is the bottom landing')
    assert.deepEqual(m.to, { x: 3 + dx * STAIR_RUN, y: 5 + dy * STAIR_RUN, z: -5 + STAIR_RISE })
    assert.equal(m.cfg.width, STAIR_WIDTH_NARROW)
    assert.equal(m.cfg.style, 'straight')
  }
})

test('placing a stair carves the slab it climbs through', () => {
  const cells = []
  for (let x = 0; x < 3; x++) for (let y = 0; y < 9; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const state = toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
  const mod = createModule('stair', 1, 0, -5, 'stair-1', 0, STAIR_WIDTH_NARROW)
  assert.ok(mod)
  const next = addEquipment(state, mod)
  assert.equal(next.modules.length, 1)
  // The stair runs +y from (1, 0): its slab above the walking line is opened.
  assert.ok(next.cells.length < state.cells.length, 'the slab it climbs through is carved')
})

test('all eight fixed stair buttons build their one-storey flight plans', () => {
  const expected = {
    'stair-straight': 1,
    'stair-left90': 2,
    'stair-right90': 2,
    'stair-left180': 2,
    'stair-right180': 2,
    'stair-leftForward': 2,
    'stair-centerForward': 2,
    'stair-rightForward': 2,
  }
  for (const [id, nFlights] of Object.entries(expected)) {
    const m = createModule(id, 4, 4, -5, 'x', 0, STAIR_WIDTH_NARROW)
    assert.ok(m && m.type === 'stair', `${id} did not build a stair`)
    assert.equal(m.cfg.flights.length, nFlights, `${id} has the wrong flight count`)
    assert.equal(m.from.z, -5, `${id} base is not the floor it was placed on`)
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
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) cells.push({ x, y, z: -5, fill: 'solid' })
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
      const m = createModule(`stair-${style}`, 0, 0, -5, 'x', 0, width)
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
        if (placementBlocked([m], createModule('fence', x, 3, -3, 'f', 0))) claimed.push(x)
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

test('a 90° turn’s legs are built on the block grid, and its quarter-landing is square', () => {
  // The report this fixes: a 90° turn was built at the tool's palette width
  // (0.68 / 1.36 / 2.04 m), so each band stayed **centred on its own walking line** —
  // 0.18 / 0.52 m into the tiles either side — and its balustrades stopped short of the
  // cell edge a wall or a floor block could meet them on. A turning leg now fills the
  // blocks it stands in exactly as a 双跑楼梯's run does (`stairSwitchbackRunWidth`), and
  // because the two legs are perpendicular each band moves half a block across **its own**
  // run: the corner block is the first lane of both, and the two hands mirror about the
  // column the corner cell stands in.
  for (const [width, blocks] of [
    [STAIR_WIDTH_NARROW, 1],
    [STAIR_WIDTH_DOUBLE, 2],
    [STAIR_WIDTH_TRIPLE, 3],
  ]) {
    for (const [style, hand] of [['right90', 1], ['left90', -1]]) {
      const grid = (blocks - 1) / 2
      // Every rotation, since a turn is placed in all four: each leg's band fills `blocks`
      // whole cells across **its own** run, the quarter-landing is the `blocks × blocks`
      // square the two legs meet on, and no flight body stands over any of its cells.
      for (let rot = 0; rot < 4; rot++) {
        const turned = createModule(`stair-${style}`, 0, 0, -5, 'x', rot, width)
        assert.ok(turned && turned.type === 'stair')
        assert.ok(Math.abs(turned.cfg.width - stairSwitchbackRunWidth(width)) < 1e-9, `${style}/${width} is not built block-wide`)
        const legs = stairFlights(turned)
        const legSlides = stairFlightSlides(turned)
        for (const [i, f] of legs.entries()) {
          const alongX = f.to.x !== f.from.x
          const centre = (alongX ? f.from.y : f.from.x) + 0.5 + (alongX ? legSlides[i].dy : legSlides[i].dx)
          assert.equal(Number.isInteger(centre - blocks / 2), true, `${style}/${width}/rot ${rot}: leg ${i} starts at ${centre - blocks / 2}`)
        }
        const cells = stairTurnCells(turned)
        assert.equal(cells.length, blocks * blocks, `${style}/${width}/rot ${rot} lays ${cells.length} landing cells`)
        // The square is as deep along the departing leg's run as it is wide across it.
        const alongX = legs[1].to.x !== legs[1].from.x
        const spread = (pick) => Math.max(...cells.map(pick)) - Math.min(...cells.map(pick)) + 1
        assert.equal(spread((c) => (alongX ? c.y : c.x)), blocks, `${style}/${width}/rot ${rot}: the landing is not ${blocks} blocks across`)
        assert.equal(spread((c) => (alongX ? c.x : c.y)), blocks, `${style}/${width}/rot ${rot}: the landing is not ${blocks} blocks deep`)
        // ... and the departing leg's lower landing is the square's far cell along its own
        // run, so its treads begin where the platform ends and nothing climbs over the
        // landing (the pillar/extension hitbox reads the flights alone there).
        const start = legs[1].from
        assert.equal(
          cells.some((c) => c.x === start.x && c.y === start.y),
          true,
          `${style}/${width}/rot ${rot}: the departing leg's lower landing ${start.x},${start.y} is off the landing`,
        )
        const corner = legs[0].to
        const alongRun = alongX ? Math.abs(start.x - corner.x) : Math.abs(start.y - corner.y)
        assert.equal(alongRun, blocks - 1, `${style}/${width}/rot ${rot}: the departing leg starts ${alongRun} cells from the corner`)
        for (const c of cells) {
          for (const b of rampBodyBoxes(turned)) {
            assert.ok(
              !(b.x0 < c.x + 0.5 && c.x + 0.5 < b.x1 && b.y0 < c.y + 0.5 && c.y + 0.5 < b.y1),
              `${style}/${width}/rot ${rot}: a flight passes over the landing cell ${c.x},${c.y}`,
            )
          }
        }
        // ... and the turn is **walked**: the two legs join across the square's own cells,
        // and the whole stair climbs bottom to top.
        const g = stairwell(turned)
        const bottom = g.nodeIndex.get(key(turned.from))
        const top = g.nodeIndex.get(key(turned.to))
        assert.notEqual(bottom, undefined, `${style}/${width}/rot ${rot}: the lower landing is not walkable`)
        assert.notEqual(top, undefined, `${style}/${width}/rot ${rot}: the upper landing is not walkable`)
        assert.ok(reachable(g, bottom, top), `${style}/${width}/rot ${rot} is not walked bottom to top`)
        assert.ok(
          reachableWithin(g, g.nodeIndex.get(key(legs[0].to)), g.nodeIndex.get(key(legs[1].from)), cells),
          `${style}/${width}/rot ${rot}: the two legs are not joined across the landing`,
        )
      }
      // Rot 0 names the sides: the first leg runs +y, so its band spans x; the second runs
      // +x (right) or −x (left), so its band spans y — the axis the *first* leg travels
      // along — and it is laid one block in per extra lane, on the square's far edge.
      const m = createModule(`stair-${style}`, 0, 0, -5, 'x', 0, width)
      assert.ok(m && m.type === 'stair')
      const [first, second] = stairFlights(m)
      const slides = stairFlightSlides(m)
      const shifted = hand * grid === 0 ? 0 : hand * grid
      assert.deepEqual(slides[0], { dx: shifted, dy: 0 }, `${style}/${width}: the first leg is not on its blocks`)
      assert.deepEqual(slides[1], { dx: 0, dy: grid }, `${style}/${width}: the second leg did not move across its own run`)
      const farEdge = hand * (blocks - 1) === 0 ? 0 : hand * (blocks - 1)
      assert.equal(second.from.x, farEdge, `${style}/${width}: the departing leg starts at x=${second.from.x}, not on the landing's edge`)
      assert.equal(second.from.y, 4, `${style}/${width}: the departing leg left the corner row`)
      const f1 = first.from.x + 0.5 + slides[0].dx
      const f2 = second.from.y + 0.5 + slides[1].dy
      const firstLane = hand > 0 ? 0 : -(blocks - 1)
      assert.equal(f1 - blocks / 2, firstLane === 0 ? 0 : firstLane, `${style}/${width}: the first band starts at ${f1 - blocks / 2}`)
      assert.equal(f2 - blocks / 2, 4, `${style}/${width}: the second band starts at ${f2 - blocks / 2}, not on the corner row`)
      // The quarter-landing is the square the two legs meet on: the corner cell's own block
      // across the departing leg's run, the lanes of its band across it.
      const cells = stairTurnCells(m)
      const columns = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b)
      const rows = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b)
      const firstColumn = Math.min(hand * (blocks - 1), 0)
      assert.deepEqual(columns, Array.from({ length: blocks }, (_, i) => firstColumn + i),
        `${style}/${width}: the landing columns are ${columns.join(',')}`)
      assert.deepEqual(rows, Array.from({ length: blocks }, (_, i) => 4 + i), `${style}/${width}: the landing rows are ${rows.join(',')}`)
    }
  }
})

test('a piece saved at an older, off-grid width keeps its own band', () => {
  // Every switchback placed before the runs were block-wide (a 1.36 m 中, a 1.6 m saved
  // piece) is left exactly where it was: its band centred on its walking line, and the
  // return run slid toward the first until the rails meet. Moving it would also move it
  // off the opening the builder carved for it.
  const m = createModule('stair-right180', 0, 0, -5, 'x', 0, STAIR_WIDTH_DOUBLE)
  assert.ok(m && m.type === 'stair')
  m.cfg.width = STAIR_WIDTH_DOUBLE // as a station saved before the block grid stores it
  const slides = stairFlightSlides(m)
  assert.deepEqual(slides[0], { dx: 0, dy: 0 }, 'an old piece must not move')
  const slide = Math.hypot(slides[1].dx, slides[1].dy)
  assert.ok(slide > 0, 'an old piece still closes its well')
  assert.equal(Math.sign(slides[1].dx), -1, 'the return run slides toward the first')
  assert.equal(slides[1].dy, 0)
  assert.ok(Math.abs(stairSwitchbackOffset(STAIR_WIDTH_DOUBLE) - slide - stairSwitchbackGap(STAIR_WIDTH_DOUBLE)) < 0.05)
  // A 90° turn saved the same way keeps the band and the legs it has: an older build laid the
  // departing leg on the corner cell itself, so the landing stays that one cell — the square
  // is read from the piece, not from the size it was placed at.
  const turn = {
    id: 'legacy-turn',
    type: 'stair',
    x: 0,
    y: 0,
    z: -5,
    rot: 0,
    from: { x: 0, y: 0, z: -5 },
    to: { x: 3, y: 4, z: 0 },
    cfg: {
      width: STAIR_WIDTH_DOUBLE,
      style: 'right90',
      flights: [
        { from: { x: 0, y: 0, z: -5 }, to: { x: 0, y: 4, z: -2.5 } },
        { from: { x: 0, y: 4, z: -2.5 }, to: { x: 3, y: 4, z: 0 } },
      ],
    },
  }
  assert.deepEqual(stairFlightSlides(turn), [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }], 'an old 90° turn must not move')
  assert.deepEqual(stairTurnCells(turn).map((c) => key(c)), ['0,4,-2.5'], 'an old 90° turn keeps its one landing cell')
})

test('a switchback in a stairwell leans on the walls, and loses the rails they replace', () => {
  // The two runs stand on the block grid, so a wall built beside the piece stands flush
  // against the outer balustrade of each run — and that balustrade goes, exactly like a
  // straight flight's. The turn landing's two long sides lean on the same walls, and its
  // railing goes with them: a 双跑楼梯 in a stairwell is railed only where it is open.
  const m = createModule('stair-right180', 0, 0, -5, 'x', 0, STAIR_WIDTH_DOUBLE)
  assert.ok(m && m.type === 'stair')
  const slides = stairFlightSlides(m)
  const column = (x, ys) => ys.flatMap((y) => [-5, -4, -3, -2, -1, 0].map((z) => ({ x, y, z, fill: 'solid', tags: ['wall'] })))
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
  assert.deepEqual(stairLandingWalls([0, 1, 2, 3].flatMap((x) => column(x, [5])), m, 0), {
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
  assert.ok(Math.abs(shape.y0 - 4) < 1e-9 && Math.abs(shape.y1 - 5) < 1e-9, `the landing is ${shape.y0}..${shape.y1} deep, not one block`)
  assert.ok(Math.abs(shape.z - -2.5) < 1e-9, 'the landing is read at its own storey')
  // A 90° turn's legs are perpendicular, so what the two share is the corner **square** —
  // and it is square rather than the one-block strip a 180's half-landing is: a landing
  // only one block deep would be narrower than the leg climbing away from it. The
  // departing leg's lower landing sits on the square's far edge, so no tread stands over
  // the landing, and every edge of the platform is a cell edge.
  const turn = createModule('stair-right90', 0, 0, -5, 't', 0, STAIR_WIDTH_NARROW)
  assert.ok(turn && turn.type === 'stair')
  const [turnFirst, turnSecond] = stairFlights(turn)
  const square = stairLandingShape(turn, 0)
  assert.deepEqual([turnSecond.from.x, turnSecond.from.y], [turnFirst.to.x, turnFirst.to.y], 'a narrow 90° turn still meets on the corner cell')
  assert.deepEqual(stairTurnCells(turn).map((c) => key(c)), ['0,4,-2.5'], 'the narrow quarter-landing is that one cell')
  assert.ok(Math.abs(square.x0 - 0) < 1e-9 && Math.abs(square.x1 - 1) < 1e-9, `the corner platform is ${square.x0}..${square.x1} along the leg`)
  assert.ok(Math.abs(square.y0 - 4.105) < 1e-9 && Math.abs(square.y1 - 4.895) < 1e-9, `and ${square.y0}..${square.y1} across it`)
  assert.ok(Math.abs(square.z - -2.5) < 1e-9, 'the quarter-landing is read at its own storey')
  // A 中 turn lays the 2 × 2 square the two legs meet on: two blocks either way, so the
  // platform is at least square and the leg that climbs away starts on its far edge.
  const wide = createModule('stair-right90', 0, 0, -5, 'w', 0, STAIR_WIDTH_DOUBLE)
  assert.ok(wide && wide.type === 'stair')
  assert.deepEqual([wide.cfg.flights[1].from.x, wide.cfg.flights[1].from.y], [1, 4], 'the departing leg starts on the square’s far edge')
  assert.deepEqual(stairTurnCells(wide).map((c) => key(c)).sort(), ['0,4,-2.5', '0,5,-2.5', '1,4,-2.5', '1,5,-2.5'])
  const wideShape = stairLandingShape(wide, 0)
  assert.ok(Math.abs(wideShape.x0 - 0) < 1e-9 && Math.abs(wideShape.x1 - 2) < 1e-9, `the 中 platform is ${wideShape.x1 - wideShape.x0} m along the leg`)
  assert.ok(Math.abs(wideShape.y0 - 4.105) < 1e-9 && Math.abs(wideShape.y1 - 5.895) < 1e-9)
})

test('a turning stair is model-only at its landing, while a legacy landing block is still cleaned up', () => {
  // The middle platform is the stair's own 0.5 m slab: placing the piece lays no
  // document cell, and the crowd walks it as a virtual landing. A save made before
  // that rule still carries the block the old builder laid, so deleting its stair
  // takes that block away — while a block the player put there by hand is left.
  const cells = []
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) cells.push({ x, y, z: -5, fill: 'solid' })
  const handLaid = { x: 6, y: 8, z: -3, fill: 'solid' }
  const base = toState({ name: 'well', seed: 1, cells: [...cells, handLaid], modules: [], lines: [] })
  const holds = (list, p) => list.some((c) => c.x === p.x && c.y === p.y && c.z === p.z)
  for (const id of ['stair-right90', 'stair-left180']) {
    const mod = createModule(id, 2, 2, -5, 'x', 0, STAIR_WIDTH_NARROW)
    assert.ok(mod)
    const landing = stairTurnCells(mod)
    assert.ok(landing.length > 0, `${id} has no turn landing`)
    const placed = addEquipment(base, mod)
    for (const p of landing) assert.ok(!holds(placed.cells, p), `${id}: the landing at ${key(p)} was laid as a block`)
    // The same document, with the landing block an older build laid.
    const legacy = { ...placed, cells: [...placed.cells, ...landing.map((p) => ({ ...p, fill: 'solid' }))] }
    const after = removeModule(legacy, mod.id)
    assert.equal(after.modules.length, 0, `${id} was not bulldozed`)
    for (const p of landing) assert.ok(!holds(after.cells, p), `${id}: the legacy landing at ${key(p)} was left behind`)
    assert.ok(holds(after.cells, handLaid), `${id}: a hand-laid block went with it`)
  }
  // A straight stair has no turn landing, so placing and bulldozing it changes no cell.
  const straight = createModule('stair-straight', 2, 2, -5, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(straight)
  assert.deepEqual(stairTurnCells(straight), [])
  const placed = addEquipment(base, straight)
  assert.equal(placed.cells.length, base.cells.length, 'a straight stair laid a cell')
  assert.equal(removeModule(placed, straight.id).cells.length, placed.cells.length, 'a straight stair took a cell with it')
})

test('a legacy landing another piece stands on is kept when the stair goes', () => {
  // The landing cell is not the piece's when another piece spans it: a 2 m 座椅
  // laid across an old landing block keeps both of its cells once the stair is
  // bulldozed. Protecting only each remaining piece's *anchor* cell left the floor
  // under the bench's far half to be taken away with the stair.
  const cells = []
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) cells.push({ x, y, z: -5, fill: 'solid' })
  const base = toState({ name: 'well', seed: 1, cells, modules: [], lines: [] })
  const holds = (list, p) => list.some((c) => c.x === p.x && c.y === p.y && c.z === p.z)
  const stair = createModule('stair-right180', 2, 2, -5, 'x', 0, STAIR_WIDTH_NARROW)
  assert.ok(stair)
  const row = stairTurnCells(stair).slice().sort((a, b) => a.x - b.x || a.y - b.y)
  assert.ok(row.length >= 2, 'the rig needs a landing two cells wide to span')
  // A legacy document: the stair's landing block is in the save.
  const legacy = { ...base, cells: [...cells, ...stairTurnCells(stair).map((p) => ({ ...p, fill: 'solid' }))] }
  const placed = addEquipment(legacy, stair)
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
      const m = createModule(`stair-${style}`, 0, 0, -5, 'x', 0, width)
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
  const right = createModule('stair-right180', 0, 0, -5, 'r', 0, STAIR_WIDTH_DOUBLE)
  const left = createModule('stair-left180', 0, 0, -5, 'l', 0, STAIR_WIDTH_DOUBLE)
  assert.ok(right && right.type === 'stair' && left && left.type === 'stair')
  // The first flight is shared; the second is the same run on the other hand of
  // the turn, so the two landings mirror across the first flight's centreline.
  assert.deepEqual(right.cfg.flights[0], left.cfg.flights[0])
  assert.deepEqual(right.cfg.flights[1].from, { x: -left.cfg.flights[1].from.x, y: left.cfg.flights[1].from.y, z: left.cfg.flights[1].from.z })
  assert.deepEqual(right.cfg.flights[1].to, { x: -left.cfg.flights[1].to.x, y: left.cfg.flights[1].to.y, z: left.cfg.flights[1].to.z })
  // R only ever turns the piece about its base, so the two hands stay distinct
  // at every rotation.
  for (let rot = 0; rot < 4; rot++) {
    const r = createModule('stair-right180', 0, 0, -5, 'r', rot, STAIR_WIDTH_NARROW)
    const l = createModule('stair-left180', 0, 0, -5, 'l', rot, STAIR_WIDTH_NARROW)
    assert.notDeepEqual(r.cfg.flights, l.cfg.flights, `rot ${rot} builds the same switchback either way`)
  }
})

test('placing a turning stair leaves the document alone while every landing cell stays walkable', () => {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 5, fill: 'solid' })
  const state = toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
  for (const style of ['left90', 'right90']) {
    for (const width of STAIR_WIDTHS) {
      const mod = createModule(`stair-${style}`, 2, 2, 4, 's', 0, width)
      assert.ok(mod)
      const next = addEquipment(state, mod)
      // The quarter-landing sits one storey's half up, between the two flights, and it is
      // **the stair's own platform**: no document cell is laid, but every cell the model
      // draws the platform on is a walkable node of the graph.
      const landing = stairTurnCells(mod)
      assert.equal(landing.length, stairLanes(width) ** 2, `${style}/${width}: the landing is not a square`)
      for (const p of landing) assert.ok(!next.cells.some((c) => c.x === p.x && c.y === p.y && c.z === p.z), `${style}/${width}: landing ${key(p)} was laid as a block`)
      const graph = buildGraph(toData(next))
      for (const p of landing) assert.notEqual(graph.nodeIndex.get(key(p)), undefined, `${style}/${width}: landing ${key(p)} is not walkable`)
    }
  }
})

test('a turning stair draws its middle platform as the piece’s own 0.5 m slab at half the rise', () => {
  const mats = new Proxy({}, { get: (o, k) => (o[k] ??= new THREE.MeshStandardMaterial()) })
  const finish = () => new THREE.MeshStandardMaterial()
  for (const spec of [['ultra-short', 2], ['medium', 4], ['long', 5]]) {
    const [length, rise] = spec
    const stair = createModule('stair-right180', 0, 0, 0, `s-${length}`, 0, 0.68, 'up', 'lane', [], undefined, { rampLength: length })
    const group = new StairModel({ mats, finish, data: { cells: [], modules: [stair] }, preview: false }).build(stair)
    group.updateMatrixWorld(true)
    const landings = group.children.filter((c) => c.name === 'stair-landing')
    assert.equal(landings.length, 1, `${length}: one drawn platform`)
    // The platform is the surface + its frame; the railings above it are not the slab.
    const slabParts = []
    landings[0].traverse((o) => { if (o.name === 'stair-landing-surface' || o.name === 'stair-landing-frame') slabParts.push(o) })
    const box = new THREE.Box3()
    for (const part of slabParts) box.expandByObject(part)
    assert.ok(Math.abs(box.max.z - box.min.z - 0.5) < 1e-6, `${length}: the platform is a 0.5 m slab`)
    assert.ok(Math.abs(box.max.z - (stair.cfg.flights[0].to.z + 1)) < 1e-6, `${length}: its walking surface is at half the rise`)
    assert.ok(Math.abs(stair.cfg.flights[0].to.z - rise / 2) < 1e-6)
  }
})

test('carving a turning stair keeps its landings and opens the slab it climbs through', () => {
  const cells = []
  for (let x = -2; x <= 3; x++) for (let y = 0; y <= 4; y++) for (const z of [0, 1]) cells.push({ x, y, z, fill: 'solid' })
  // The half-landing at the turn, between the two flights.
  for (const x of [0, 1, 2]) cells.push({ x, y: 2, z: -2.5, fill: 'solid' })
  const m = {
    id: 'turn',
    type: 'stair',
    x: 0,
    y: 0,
    z: -5,
    from: { x: 0, y: 0, z: -5 },
    to: { x: 2, y: 0, z: 0 },
    cfg: {
      width: 1.6,
      style: 'right180',
      flights: [
        { from: { x: 0, y: 0, z: -5 }, to: { x: 0, y: 2, z: -2.5 } },
        { from: { x: 2, y: 2, z: -2.5 }, to: { x: 2, y: 0, z: 0 } },
      ],
    },
  }
  const removed = carveRampOpenings(cells, [m])
  assert.ok(removed > 0, 'the roof the stair climbs through is carved')
  assert.ok(cells.some((c) => c.x === 1 && c.y === 2 && c.z === -2.5), 'the half-landing is kept')
  assert.ok(cells.some((c) => c.x === 2 && c.y === 0 && c.z === 0), 'the top landing is kept')
})


test('forward stairs continue after a block-fitted middle landing in every size and rotation', () => {
  for (const width of STAIR_WIDTHS) for (let rot = 0; rot < 4; rot++) {
    const [fx, fy] = stairFacing(rot)
    const [rx, ry] = stairRight(rot)
    const blocks = stairLanes(width)
    for (const [style, hand] of [['leftForward', -1], ['centerForward', 0], ['rightForward', 1]]) {
      const m = createModule(`stair-${style}`, 0, 0, -5, 'forward', rot, width)
      assert.equal(m.cfg.width, stairSwitchbackRunWidth(width))
      const [first, second] = stairFlights(m)
      assert.deepEqual(first.to, { x: fx * 4, y: fy * 4, z: -2.5 })
      assert.deepEqual(second.from, { x: fx * 4 + rx * hand * blocks, y: fy * 4 + ry * hand * blocks, z: -2.5 })
      assert.deepEqual(m.to, { x: fx * 8 + rx * hand * blocks, y: fy * 8 + ry * hand * blocks, z: 0 })
      const row = stairTurnCells(m)
      assert.equal(row.length, blocks * (hand === 0 ? 1 : 2), 'middle landing fills only the shared row')
      const shape = stairLandingShape(m, 0)
      assert.equal(fx ? shape.x1 - shape.x0 : shape.y1 - shape.y0, 1, 'landing is one cell deep along the run')
      const g = stairwell(m)
      const bottom = g.nodeIndex.get(key(m.from))
      const top = g.nodeIndex.get(key(m.to))
      assert.notEqual(bottom, undefined)
      assert.notEqual(top, undefined)
      assert.ok(reachable(g, bottom, top), `${style}/${rot}/${width} connects uphill`)
      assert.ok(reachable(g, top, bottom), `${style}/${rot}/${width} connects downhill`)
      assert.ok(reachableWithin(g, g.nodeIndex.get(key(first.to)), g.nodeIndex.get(key(second.from)), row), 'flights connect across their own landing')
    }
  }
})
