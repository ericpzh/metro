// B2 acceptance (PLAN.md §4): a zone boundary is a movement barrier, and a gate
// is the only crossing. A flat station with a continuous floor but no gate must
// trap the crowd short of the platform; adding a turnstile must restore flow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { buildGraph } from '../src/sim/station.ts'
import { paintZone, paintZoneCells, toData, toState, zoneAt, zoneMapFloors, zoneRegionLabels } from '../src/build/model.ts'
import { ZONE_INDEX } from '../src/sim/zones.ts'

/** A 2 m corridor x=0..12, unpaid up to x=4 and paid from x=5, with a line at
 *  the far end. The floor is continuous — only the zone line is in the way. */
function flatStation({ gate }) {
  const cells = []
  for (let x = 0; x <= 12; x++) {
    for (let y = 0; y <= 1; y++) cells.push({ x, y, z: 0, fill: 'solid', zone: x <= 4 ? 'unpaid' : 'paid' })
  }
  const modules = [
    { id: 'exit', type: 'exit', x: 0, y: 0, z: 0, cfg: { name: 'A口', inRate: 6000, open: true, headHouse: false } },
    { id: 'edge', type: 'platform-edge', x: 10, y: 0, z: 0, w: 3, cfg: { name: '1站台', line: '2', dir: 'up', side: 'left' } },
  ]
  if (gate) modules.push({ id: 'g1', type: 'gate', x: 5, y: 0, z: 0, cfg: { dir: 'both' } })
  const lines = [
    {
      id: '2',
      name: '2号线',
      colour: '#2f7ef2',
      stock: 'B',
      cars: 6,
      power: 'third-rail',
      headwayProfile: { peak: 60, offpeak: 120, late: 240 },
      alightPerTrain: 540,
      terminus: 'through',
      direction: 'up',
      travelSign: 1,
      stations: ['edge'],
    },
  ]
  return { name: 't', seed: 3, cells, modules, lines }
}

/**
 * Run the fixture with §4.5's fare line **enforced**. The rule is off by default
 * while the demo's zone paint is unfinished (`ZONE_LINES_BLOCK`), so a suite that
 * is *about* the fare line has to ask for it — and `zoneBarriers: false` below is
 * the default every station currently gets.
 */
function run(data, ticks, opts = { zoneBarriers: true }) {
  const w = new World(data, 3, opts)
  for (let i = 0; i < ticks; i++) w.tickOnce()
  return w
}

test('without a gate the crowd cannot reach the platform', () => {
  const w = run(flatStation({ gate: false }), 200)
  assert.equal(w.totals.boarded, 0, 'somebody boarded through an ungated fare line')
  assert.ok(w.metrics.stuck > 0, 'expected agents to be stranded at the fare line')
})

test('a gate is the only crossing, and it restores flow', () => {
  // The signal is the gate's **own** throughput, not one direction's — the
  // fixture is deliberately busy (a 6000/h street and a 540-passenger train
  // surge into one two-way lane), so which direction holds the lane is §7.1's
  // first-come rule and not this test's question. What it pins is that the fare
  // line carries a crowd once a gate stands in it, and carries nobody without
  // one. (`exited` alone would be a poor control: an agent spawned on the exit
  // cell completes a leg to it without crossing anything.)
  const gated = run(flatStation({ gate: true }), 200)
  const gate = gated.graph.servers.find((s) => s.kind === 'gate')
  assert.ok(gate.waitCount > 20, `the gate served only ${gate.waitCount} people in 200 s`)
})

test('the graph itself has no edge across an ungated zone line', () => {
  const g = buildGraph(flatStation({ gate: false }), true)
  // x=4,y=0 (node) and x=5,y=0 must not be adjacent.
  const a = g.nodeIndex.get('4,0,0')
  const b = g.nodeIndex.get('5,0,0')
  assert.ok(a !== undefined && b !== undefined)
  let edge = false
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) edge = true
  assert.equal(edge, false, 'an ungated zone boundary is a barrier: no edge crosses it')
})

test('a zone line is walkable while the fare line is unenforced', () => {
  // The shipped default (`ZONE_LINES_BLOCK = false`): a boundary with no gate on
  // it is a label, not a wall — the 动物园 save's unpainted floor stops standing
  // in for a fare line, and a station with one ungated line through it is not a
  // station nobody can leave. The same fixture, same seed, both ways.
  const open = buildGraph(flatStation({ gate: false }), false)
  const a = open.nodeIndex.get('4,0,0')
  const b = open.nodeIndex.get('5,0,0')
  let edge = false
  for (let e = open.adjStart[a]; e < open.adjStart[a + 1]; e++) if (open.adjTo[e] === b) edge = true
  assert.equal(edge, true, 'the ungated zone line still blocked the floor')

  const w = run(flatStation({ gate: false }), 200, { zoneBarriers: false })
  assert.equal(w.metrics.stuck, 0, 'someone was stranded by a fare line that is not being enforced')
  // And it really is a different station: with the line enforced the same fixture
  // strands its alighting passengers at the boundary, and nobody gets out.
  const shut = run(flatStation({ gate: false }), 200)
  assert.ok(
    w.totals.exited > shut.totals.exited,
    `the unenforced line let nobody through (${w.totals.exited} vs ${shut.totals.exited} with it enforced)`,
  )
})

test('a same-side zone relabel is not a fare barrier', () => {
  // `outside` and `unpaid` are both the unpaid side of the fare line, so a
  // floor labelled with one and then the other is continuous: no gate needed.
  // The same holds for `paid` next to `platform`. Only a real crossing (a walk
  // from unpaid/outside into paid/platform/restricted) is gated.
  const cells = []
  for (let x = 0; x <= 8; x++) {
    for (let y = 0; y <= 1; y++) cells.push({ x, y, z: 0, fill: 'solid', zone: x <= 3 ? 'outside' : 'unpaid' })
  }
  const g = buildGraph({ name: 't', seed: 1, cells, modules: [], lines: [] })
  const a = g.nodeIndex.get('3,0,0')
  const b = g.nodeIndex.get('4,0,0')
  assert.ok(a !== undefined && b !== undefined)
  let edge = false
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) edge = true
  assert.ok(edge, 'outside↔unpaid is the same side, so the floor stays connected')
})

test('zone painting is a bucket and is immutable', () => {
  const state = toState(flatStation({ gate: true }))
  assert.equal(zoneAt(state.cells, 0, 0, 0), 'unpaid')
  const painted = paintZone(state, 10, 0, 0, 'platform')
  assert.equal(zoneAt(painted.cells, 10, 1, 0), 'platform', 'the bucket should flood the connected floor')
  assert.equal(zoneAt(painted.cells, 0, 0, 0), 'unpaid', 'the bucket leaked into an unconnected cell')
  assert.equal(zoneAt(state.cells, 10, 0, 0), 'paid', 'paint mutated the base state')
  const one = paintZone(state, 0, 0, 0, 'outside', false)
  assert.equal(zoneAt(one.cells, 0, 0, 0), 'outside')
  assert.equal(zoneAt(one.cells, 1, 0, 0), 'unpaid', 'single-cell paint should not flood')
})

test('the zone drag paint sets a rectangle, skipping void cells', () => {
  const state = toState(flatStation({ gate: true }))
  // A 3x2 patch over cells that all exist, plus one void cell outside the floor.
  const painted = paintZoneCells(state, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [7, 7, 0]], 'platform')
  assert.equal(zoneAt(painted.cells, 0, 0, 0), 'platform')
  assert.equal(zoneAt(painted.cells, 1, 1, 0), 'platform')
  assert.equal(zoneAt(painted.cells, 5, 0, 0), 'paid', 'the rectangle must not flood past its cells')
  assert.equal(zoneAt(state.cells, 0, 0, 0), 'unpaid', 'paint mutated the base state')
  // An empty list, or a patch already in the zone, leaves the state identical.
  assert.equal(paintZoneCells(state, [], 'platform'), state)
  assert.equal(paintZoneCells(state, [[0, 0, 0]], 'unpaid'), state)
})

test('the zone map tints the floor, not a roof or a wall coping', () => {
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid' },
    { x: 1, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.soil' } },
    { x: 2, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.track' } },
    { x: 3, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.track' } },
    { x: 3, y: 0, z: 1, fill: 'solid', finish: { top: 'floor.track' } },
  ]
  const floors = zoneMapFloors(cells)
    .map((c) => `${c.x},${c.y},${c.z}`)
    .sort()
  // Granite floor and the platform track bed stay; cover soil and the track
  // coping on top of the wall are structure, not floor.
  assert.deepEqual(floors, ['0,0,0', '2,0,0'])
})

test('the zone map labels one area per contiguous zone patch', () => {
  const state = toState(flatStation({ gate: true }))
  const labels = zoneRegionLabels(zoneMapFloors(state.cells))
  // The corridor is unpaid (x 0..4) then paid (x 5..12); two patches, two labels.
  assert.equal(labels.length, 2)
  const paid = labels.find((l) => l.zone === ZONE_INDEX.paid)
  const unpaid = labels.find((l) => l.zone === ZONE_INDEX.unpaid)
  assert.ok(paid && unpaid, 'both zone patches should be labelled')
  assert.ok(paid.x > 4.5, 'the paid label belongs to the paid half')
  assert.ok(unpaid.x < 4.5, 'the unpaid label belongs to the unpaid half')
  // The label sits on a floor cell of its own zone, at the walk height.
  assert.equal(zoneAt(state.cells, Math.floor(paid.x), 0, 0), 'paid')
})
