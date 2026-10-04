// Fence (围栏, §5.2): a 1 m high thin panel that divides areas with a gate row.
// One panel per cell through the block middle; a dragged run follows the drag
// direction (R turns a single), and corners join at 90° by neighbour detection
// in the renderer. The sim treats a fence cell as not walkable, so a fence run
// plus its gate row is a barrier the crowd only crosses at a gate.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxesOverlap, moduleEnvelope, placementBlocked, placementOnTrack } from '../src/sim/placement.ts'
import { fenceArms, railLandingAt } from '../src/sim/fences.ts'
import { buildGraph } from '../src/sim/station.ts'
import { createModule, fenceRotForLine } from '../src/build/model.ts'

const fence = (x, y, z, rot = 0, id = 'f') => ({ id, type: 'fence', x, y, z, rot, cfg: {} })
const gate = (x, y, z, id = 'g') => ({ id, type: 'gate', x, y, z, cfg: { dir: 'both' } })

test('the factory builds a fence carrying the hover rotation', () => {
  assert.equal(createModule('fence', 1, 2, 3, 'f')?.type, 'fence')
  assert.equal(createModule('fence', 1, 2, 3, 'f')?.rot, 0)
  assert.equal(createModule('fence', 1, 2, 3, 'f', 1)?.rot, 1)
})

test('a dragged run follows the drag direction, ties go east-west', () => {
  // A span that grows along x is an east-west run, along y a north-south one,
  // and an exact tie goes east-west (matching `straightLineCells`).
  assert.equal(fenceRotForLine([[0, 0, 0], [5, 0, 0]]), 0)
  assert.equal(fenceRotForLine([[0, 0, 0], [0, 5, 0]]), 1)
  assert.equal(fenceRotForLine([[0, 0, 0], [3, 3, 0]]), 0)
})

test('a run reads its orientation from its own span, either drag direction', () => {
  // straightLineCells returns a min→max span; the run is east-west / north-south
  // regardless of which way the player actually dragged.
  const rowX = [[0, 0, 0], [1, 0, 0], [2, 0, 0]]
  const rowY = [[0, 0, 0], [0, 1, 0], [0, 2, 0]]
  assert.equal(fenceRotForLine(rowX), 0)
  assert.equal(fenceRotForLine(rowY), 1)
  // The span is direction-agnostic: a run handed back-to-front still reads right.
  assert.equal(fenceRotForLine([...rowY].reverse()), 1)
  // A single cell has no direction — the caller keeps the R rotation.
  assert.equal(fenceRotForLine([[4, 4, 0]]), null)
  assert.equal(fenceRotForLine([]), null)
})

test('a fence envelope is 1 m high and thin through the block middle', () => {
  const alongX = moduleEnvelope(fence(0, 0, 0, 0, 'a'))
  assert.ok(alongX)
  assert.equal(alongX.x1 - alongX.x0, 1)
  assert.ok(Math.abs((alongX.y1 - alongX.y0) - 0.1) < 1e-9, `thin in y, got ${alongX.y1 - alongX.y0}`)
  assert.equal(alongX.z1 - alongX.z0, 1.0)
  assert.ok(Math.abs(alongX.y0 - 0.45) < 1e-9 && Math.abs(alongX.y1 - 0.55) < 1e-9)
  const alongY = moduleEnvelope(fence(0, 0, 0, 1, 'b'))
  assert.ok(alongY)
  assert.ok(Math.abs((alongY.x1 - alongY.x0) - 0.1) < 1e-9, `thin in x, got ${alongY.x1 - alongY.x0}`)
  assert.equal(alongY.y1 - alongY.y0, 1)
  // rot 2 matches rot 0, rot 3 matches rot 1: R turns 90° but the panel repeats.
  assert.deepEqual(moduleEnvelope(fence(0, 0, 0, 2, 'c')), alongX)
  assert.deepEqual(moduleEnvelope(fence(0, 0, 0, 3, 'd')), alongY)
})

test('two fences may not share a cell, even crosswise, but a run is legal', () => {
  assert.equal(placementBlocked([fence(0, 0, 0, 0, 'a')], fence(0, 0, 0, 0, 'b')), true)
  assert.equal(placementBlocked([fence(0, 0, 0, 0, 'a')], fence(0, 0, 0, 1, 'b')), true, 'perpendicular panels meet at the centre')
  assert.equal(placementBlocked([fence(0, 0, 0, 0, 'a')], fence(1, 0, 0, 0, 'b')), false)
  assert.equal(placementBlocked([fence(0, 0, 0, 0, 'a')], fence(0, 1, 0, 1, 'b')), false)
})

test('a fence plugs into a gate row: adjacent is free, stacking is refused', () => {
  assert.equal(placementBlocked([gate(0, 0, 0, 'g')], fence(1, 0, 0, 0, 'f')), false)
  assert.equal(placementBlocked([gate(0, 0, 0, 'g')], fence(0, 0, 0, 0, 'f')), true)
  assert.equal(placementBlocked([fence(0, 0, 0, 0, 'f')], gate(0, 0, 0, 'g')), true)
})

test('touching thin boxes do not collide, so a gate line stays legal', () => {
  const a = moduleEnvelope(fence(0, 0, 0, 0, 'a'))
  const b = moduleEnvelope(fence(1, 0, 0, 0, 'b'))
  assert.ok(a && b)
  assert.equal(boxesOverlap(a, b), false)
})

test('a fence may not stand on a rail track bed', () => {
  const cells = [{ x: 0, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.track' } }]
  assert.equal(placementOnTrack(cells, fence(0, 0, 0, 0, 'f')), true)
  assert.equal(placementOnTrack(cells, fence(0, 1, 0, 0, 'f')), false)
})

test('a fence cell is not walkable, so the run is a barrier with a gate gap', () => {
  // 3x2 floor: y=0 unpaid, y=1 paid. Fences at both ends of row 0, one gate in
  // the middle — the only crossing is the gate lane.
  const cells = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 2; y++) cells.push({ x, y, z: 0, fill: 'solid', zone: y === 0 ? 'unpaid' : 'paid' })
  }
  const modules = [fence(0, 0, 0, 0, 'f1'), gate(1, 0, 0, 'g'), fence(2, 0, 0, 0, 'f2')]
  const g = buildGraph({ name: 't', seed: 1, cells, modules, lines: [] })
  assert.equal(g.nodeIndex.get('0,0,0'), undefined, 'a fence cell has no node')
  assert.equal(g.nodeIndex.get('2,0,0'), undefined)
  const gateNode = g.nodeIndex.get('1,0,0')
  const paidNode = g.nodeIndex.get('1,1,0')
  assert.ok(gateNode !== undefined && paidNode !== undefined)
  const hasEdge = (a, b) => {
    for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) return true
    return false
  }
  assert.equal(hasEdge(paidNode, gateNode), true, 'the gate lane crosses the fare line')
  // The paid cell west of the gate only reaches its paid neighbour — the fence
  // cell south of it has no node, so there is no edge through the fence.
  const westPaid = g.nodeIndex.get('0,1,0')
  assert.ok(westPaid !== undefined)
  assert.equal(hasEdge(westPaid, g.nodeIndex.get('1,1,0')), true)
  let southEdge = false
  for (let e = g.adjStart[westPaid]; e < g.adjStart[westPaid + 1]; e++) {
    const key = g.nodeKey[g.adjTo[e]]
    if (key === '0,0,0') southEdge = true
  }
  assert.equal(southEdge, false, 'no walk edge runs through a fence cell')
})

test('a fence treats a stair or escalator landing as a neighbour', () => {
  // A fence run butts up to a ramp handrail at its landing, so the renderer
  // drops the end cap there instead of stopping short. A mid-flight cell is not
  // a landing and does not connect.
  const stair = createModule('stair-straight', 0, 0, 0, 's', 0)
  assert.ok(stair)
  assert.equal(railLandingAt([stair], 0, 0, 0), true, 'the lower landing connects')
  assert.equal(railLandingAt([stair], 0, 6, 4), true, 'the upper landing connects')
  assert.equal(railLandingAt([stair], 0, 3, 2), false, 'mid-flight does not')
  const esc = createModule('escalator', 0, 0, 0, 'e', 0)
  assert.ok(esc)
  assert.equal(railLandingAt([esc], esc.from.x, esc.from.y, esc.from.z), true)
  assert.equal(railLandingAt([esc], esc.to.x, esc.to.y, esc.to.z), true)
  assert.equal(railLandingAt([], 0, 0, 0), false)
})

test('a fence on a landing closes the flight it stands on', () => {
  // A stair's landing tile is free ground for a fence (its treads stop at the
  // landing edge, `rampBodyBoxes`), which is how the head of a well is guarded —
  // and because the landing is the flight's graph node, the run is then *closed*:
  // the flight is dropped rather than left dangling, so a barrier across the top
  // step really does shut the stair.
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid' },
    { x: 0, y: 6, z: 4, fill: 'solid' },
  ]
  const stair = createModule('stair-straight', 0, 0, 0, 's', 0)
  assert.ok(stair)
  const guard = fence(0, 6, 4, 0, 'guard')
  assert.equal(placementBlocked([stair], guard), false, 'the landing takes the panel')
  const open = buildGraph({ name: 't', seed: 1, cells, modules: [stair], lines: [] })
  const bottom = open.nodeIndex.get('0,0,0')
  const top = open.nodeIndex.get('0,6,4')
  assert.notEqual(bottom, undefined)
  assert.notEqual(top, undefined)
  const edgesFrom = (g, a) => {
    const out = []
    for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) out.push(g.nodeKey[g.adjTo[e]])
    return out
  }
  assert.deepEqual(edgesFrom(open, bottom), ['0,6,4'], 'the flight is the way up')
  const shut = buildGraph({ name: 't', seed: 1, cells, modules: [stair, guard], lines: [] })
  assert.equal(shut.nodeIndex.get('0,6,4'), undefined, 'the fenced landing is no node')
  assert.deepEqual(edgesFrom(shut, shut.nodeIndex.get('0,0,0')), [], 'and the flight is gone')
})



const arms = (rot, e, w, n, s) => fenceArms(rot, { e, w, n, s })

test('a lone panel is full length on its rotation axis, capped at both ends', () => {
  const x = arms(0, false, false, false, false)
  assert.deepEqual([x.x0, x.x1, x.y0, x.y1], [-0.5, 0.5, 0, 0])
  assert.deepEqual([x.capE, x.capW, x.capN, x.capS], [true, true, false, false])
  const y = arms(1, false, false, false, false)
  assert.deepEqual([y.x0, y.x1, y.y0, y.y1], [0, 0, -0.5, 0.5])
  assert.deepEqual([y.capE, y.capW, y.capN, y.capS], [false, false, true, true])
})

test('a straight run has no caps in its middle and one at each end', () => {
  const mid = arms(0, true, true, false, false)
  assert.deepEqual([mid.x0, mid.x1], [-0.5, 0.5])
  assert.deepEqual([mid.capE, mid.capW, mid.capN, mid.capS], [false, false, false, false])
  const end = arms(0, false, true, false, false)
  assert.deepEqual([end.x0, end.x1], [-0.5, 0.5])
  assert.equal(end.capE, true, 'the free end caps')
  assert.equal(end.capW, false, 'the connected end does not')
})

test('an L corner draws two half arms through the centre, no overhang, no caps', () => {
  // Horizontal run ends at this cell (west neighbour) and turns north.
  const l = arms(0, false, true, true, false)
  assert.deepEqual([l.x0, l.x1, l.y0, l.y1], [-0.5, 0, 0, 0.5])
  assert.deepEqual([l.capE, l.capW, l.capN, l.capS], [false, false, false, false])
})

test('a T junction passes through and adds a half arm, never a cap', () => {
  const t = arms(0, true, true, true, false)
  assert.deepEqual([t.x0, t.x1, t.y0, t.y1], [-0.5, 0.5, 0, 0.5])
  assert.deepEqual([t.capE, t.capW, t.capN, t.capS], [false, false, false, false])
})

test('a + junction is a full cross with no caps', () => {
  const plus = arms(0, true, true, true, true)
  assert.deepEqual([plus.x0, plus.x1, plus.y0, plus.y1], [-0.5, 0.5, -0.5, 0.5])
  assert.deepEqual([plus.capE, plus.capW, plus.capN, plus.capS], [false, false, false, false])
})
