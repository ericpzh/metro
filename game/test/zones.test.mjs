// B2 acceptance (PLAN.md §4): a zone boundary is a movement barrier, and a gate
// is the only crossing. A flat station with a continuous floor but no gate must
// trap the crowd short of the platform; adding a turnstile must restore flow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { buildGraph } from '../src/sim/station.ts'
import {
  eraseZoneCells,
  paintZone,
  paintZoneCells,
  toData,
  toState,
  zoneAt,
  zoneFloorAt,
  zoneFloorKeys,
  zoneMapFloors,
  zoneMapFloorsAt,
  zoneRegionLabels,
} from '../src/build/model.ts'
import { crossingDir, ZONE_INDEX, zoneIndexOf, zoneOf } from '../src/sim/zones.ts'
import { ZONES } from '../src/sim/types.ts'

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

/* ------------------------------------------- the map follows the storey (§4.5) */

/** Two storeys of the same 8 × 2 plan: a paid concourse at grade, an unpaid
 *  basement one storey down (`LEVEL_STEPS`' -4). */
function twoStoreys() {
  const cells = []
  for (const [z, zone] of [
    [0, 'paid'],
    [-4, 'unpaid'],
  ]) {
    for (let x = 0; x <= 7; x++) for (let y = 0; y <= 1; y++) cells.push({ x, y, z, fill: 'solid', zone })
  }
  return { name: 't', seed: 7, cells, modules: [], lines: [] }
}

test('the zone map draws one storey, and the storey is the one being edited', () => {
  const data = twoStoreys()
  // The whole-station primitive still answers for every storey — the map's own
  // filter is what makes it a map of one level, and the level is the argument.
  assert.equal(zoneMapFloors(data.cells).length, 32, 'the floor of the station, both storeys')
  const ground = zoneMapFloorsAt(data.cells, 0)
  assert.equal(ground.length, 16)
  assert.ok(
    ground.every((c) => c.z === 0),
    'the grade map carried the basement: the 分区图 is one storey at a time',
  )
  const basement = zoneMapFloorsAt(data.cells, -4)
  assert.equal(basement.length, 16)
  assert.ok(basement.every((c) => c.z === -4))
  // A storey with no floor is an empty map, not the other storeys' paint.
  assert.deepEqual(zoneMapFloorsAt(data.cells, -8), [])

  // A storey is `storeyBand`'s, the rule the level slice keys every mesh by, so a
  // slab off the 4 m grid is drawn with the storey below it — and tinted with it.
  const offGrid = [...data.cells, { x: 9, y: 0, z: -6, fill: 'solid', zone: 'platform' }]
  const banded = zoneMapFloorsAt(offGrid, -8)
  assert.deepEqual(
    banded.map((c) => `${c.x},${c.y},${c.z}`),
    ['9,0,-6'],
    'a floor at −6 belongs to the −8 storey, or no storey would ever tint it',
  )
  assert.deepEqual(zoneMapFloorsAt(offGrid, -6).map((c) => c.z), [-6], 'asking for −6 asks for its storey')
  assert.equal(zoneMapFloorsAt(data.cells, 0).length, 16, 'and the storey above is untouched by it')

  // The labels come off the same floors, so they follow: one patch per storey,
  // each named on its own level and in its own zone.
  const g = zoneRegionLabels(ground)
  const b = zoneRegionLabels(basement)
  assert.equal(g.length, 1, 'the paid concourse is one patch')
  assert.equal(b.length, 1, 'and so is the unpaid basement')
  assert.equal(g[0].z, 1.06)
  assert.equal(b[0].z, -4 + 1.06)
  assert.equal(g[0].zone, ZONE_INDEX.paid)
  assert.equal(b[0].zone, ZONE_INDEX.unpaid)
})

/* ------------------------------------------- a zone is painted on floor (§4.5) */

/** One cell of each thing a drag can cross: real floor, the floor cell a wall
 *  stands in (its top is buried by the course above it), the earth roof over a
 *  tunnel, and a track bed with the coping above it. */
function floorsAndNonFloors() {
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid' }, //                                 the concourse floor
    { x: 1, y: 0, z: 0, fill: 'solid' }, //                                 the cell a wall stands in
    { x: 1, y: 0, z: 1, fill: 'solid' }, //                                 the wall's first course
    { x: 2, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.soil' } }, //  the earth roof over a tunnel
    { x: 3, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.track' } }, // a track bed
    { x: 3, y: 0, z: 1, fill: 'solid', finish: { top: 'floor.track' } }, // the coping above it
    { x: 4, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.track' } }, // a bed at the foot of its column
  ]
  return toState({ name: 't', seed: 11, cells, modules: [], lines: [] })
}

test('the 分区 brush paints floor and nothing else', () => {
  const state = floorsAndNonFloors()
  // The brush's own set, the one the viewport hands the tool (`zoneFloorKeys`
  // over `withGround`, which here is the document and the empty street window).
  const keys = zoneFloorKeys(state.cells)
  assert.ok(keys.has('0,0,0'), 'the concourse floor takes a zone')
  assert.equal(keys.has('1,0,0'), false, 'the cell a wall stands in has no exposed top to paint')
  assert.ok(keys.has('1,0,1'), 'while a wall course the crowd can walk on top of is floor')
  assert.equal(keys.has('2,0,0'), false, 'the earth roof over a tunnel is solid and not walkable')
  assert.equal(keys.has('3,0,0'), false, 'the bed under the coping is buried')
  assert.equal(keys.has('3,0,1'), false, 'and the coping is not the foot of its column')
  assert.ok(keys.has('4,0,0'), 'a track bed at the foot of its column is floor')

  // The point query the 信息 card asks answers the same thing, cell by cell.
  for (const [x, y, z, want] of [
    [0, 0, 0, true],
    [1, 0, 0, false],
    [1, 0, 1, true],
    [2, 0, 0, false],
    [3, 0, 0, false],
    [3, 0, 1, false],
    [4, 0, 0, true],
  ]) {
    assert.equal(zoneFloorAt(state.cells, state.modules, x, y, z), want, `${x},${y},${z}`)
  }

  // A rectangle over all of them writes the floor alone: the tiles that are not
  // floor are dropped rather than carrying a zone nothing could draw. The tiles
  // that keep no label keep the **reading** they had too — 无分区, because nobody
  // has said what they are (`zoneOf`).
  const all = state.cells.map((c) => [c.x, c.y, c.z])
  const painted = paintZoneCells(state, all, 'paid')
  assert.equal(zoneAt(painted.cells, 0, 0, 0), 'paid')
  assert.equal(zoneAt(painted.cells, 1, 0, 0), 'none', 'a zone reached the cell under the wall')
  assert.equal(zoneAt(painted.cells, 2, 0, 0), 'none', 'and one reached the earth roof')
  assert.equal(zoneAt(painted.cells, 3, 0, 0), 'none', 'and one reached the buried bed')
  assert.equal(zoneAt(painted.cells, 3, 0, 1), 'none', 'and one reached the coping')
  assert.equal(zoneAt(painted.cells, 4, 0, 0), 'paid', 'the bed at the foot of its column takes the zone')
  assert.equal(painted.cells.length, state.cells.length, 'a zone never adds a block')
})

test('a bucket flood and a fixed cell set stop at a cell that is not floor', () => {
  // A wall column divides a two-cell room: the floor cell it stands in is buried,
  // so the flood stops there — the crowd walks round that cell, and the zone
  // follows the walkable floor rather than the plan.
  const state = floorsAndNonFloors()
  const flooded = paintZone(state, 0, 0, 0, 'platform')
  assert.equal(zoneAt(flooded.cells, 0, 0, 0), 'platform')
  assert.equal(zoneAt(flooded.cells, 1, 0, 0), 'none', 'the flood crossed the wall column')
  assert.equal(zoneAt(flooded.cells, 2, 0, 0), 'none', 'and reached the far side through it')
  // A single-cell set on a cell that is not floor is no edit at all.
  assert.equal(paintZone(state, 1, 0, 0, 'paid', false), state)
  assert.equal(paintZone(state, 2, 0, 0, 'paid', false), state)
})

test('the 分区 map tints exactly the floor the 分区 brush accepts', () => {
  // The rule is one function (`isFloorCell`, `build/model/Zones.ts`), read by the
  // brush, its bucket and the overlay. This pins the agreement rather than the
  // rule twice: every cell the map draws can be painted, and every cell the brush
  // accepts is drawn — so a change to one of them that forgot the other fails here.
  const state = floorsAndNonFloors()
  const keys = zoneFloorKeys(state.cells)
  const drawn = zoneMapFloors(state.cells)
  const drawnKeys = new Set(drawn.map((c) => `${c.x},${c.y},${c.z}`))
  for (const c of drawn) {
    assert.ok(keys.has(`${c.x},${c.y},${c.z}`), `${c.x},${c.y},${c.z} is drawn but not paintable`)
  }
  for (const k of keys) assert.ok(drawnKeys.has(k), `${k} is paintable but never drawn`)
})

/* ------------------------------------ the ground storey is 站外 by default (§4.5) */

test('the 无分区 brush takes a label off, and the cell reads 无分区 again', () => {
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid', zone: 'paid' }, //                                 a zoned pavement tile
    { x: 1, y: 0, z: 0, fill: 'solid', zone: 'paid', finish: { top: 'floor.tile' } }, //  …one with a finish of its own
    { x: 2, y: 0, z: 0, fill: 'solid' }, //                                               unzoned already
    { x: 3, y: 0, z: -4, fill: 'solid', zone: 'paid' }, //                                a zoned concourse tile
  ]
  const state = toState({ name: 't', seed: 3, cells, modules: [], lines: [] })
  const cleared = eraseZoneCells(state, [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, -4],
  ])
  // The pavement tile carried nothing but the label: it *is* the street, which the
  // document stores inverted, so the record goes with the label — and the plane
  // speaks for that coordinate again, which reads **站外**: the world outside the
  // station is a zone, and the ground plane *is* it (`sim/ground.ts`).
  assert.deepEqual(
    cleared.cells.map((c) => `${c.x},${c.y},${c.z}`),
    ['1,0,0', '2,0,0', '3,0,-4'],
    'a record that held nothing but a zone is the plane, and goes',
  )
  assert.equal(zoneAt(cleared.cells, 0, 0, 0), 'outside', 'the plane speaks for the dropped coordinate')
  assert.equal(cleared.cells.find((c) => c.x === 1).zone, undefined, 'the finished tile loses only the label')
  assert.equal(cleared.cells.find((c) => c.x === 1).finish.top, 'floor.tile', 'and keeps its finish')
  // A tile that keeps its record reads **无分区** with no label — which is the state
  // the whole zone model hangs off (`zoneOf`), at grade and below it alike.
  assert.equal(zoneAt(cleared.cells, 1, 0, 0), 'none', 'with the label gone it reads 无分区')
  assert.equal(zoneAt(cleared.cells, 2, 0, 0), 'none', 'and so does one that never had a label')
  assert.equal(zoneAt(cleared.cells, 3, 0, -4), 'none', 'and the concourse tile below grade')
  assert.equal(zoneAt(state.cells, 0, 0, 0), 'paid', 'the 无分区 brush mutated the state it was given')
  // Nothing to clear is not an edit, and neither is an empty rectangle.
  assert.equal(eraseZoneCells(state, [[2, 0, 0]]), state)
  assert.equal(eraseZoneCells(state, []), state)
})

/* ------------------------------------------ 无分区 is what an unpainted cell reads */

test('an unlabelled cell reads 无分区, on every storey', () => {
  // Nobody has said what an unpainted cell is, so the game does not guess a fare
  // side: it reads 无分区 — one rule, no records, and the same answer at grade as
  // it is underground.
  assert.equal(zoneOf({ z: 0 }), 'none')
  assert.equal(zoneOf({ z: 1 }), 'none')
  assert.equal(zoneOf({ z: 4 }), 'none')
  assert.equal(zoneOf({ z: -4 }), 'none')
  assert.equal(zoneOf({ z: -8 }), 'none')
  assert.equal(zoneOf({ z: -8, zone: 'platform' }), 'platform', 'a label always wins')
  assert.equal(zoneIndexOf({ z: 0 }), ZONE_INDEX.none)
  assert.equal(zoneIndexOf({ z: -8, zone: 'paid' }), ZONE_INDEX.paid)

  // The build tools and the overlay read the same rule, so two storeys of
  // unpainted floor tint and label as 无分区 without a single label in the
  // document — and the labels say so on their own storey.
  const cells = []
  for (let x = 0; x < 8; x++) cells.push({ x, y: 0, z: 0, fill: 'solid' })
  for (let x = 0; x < 8; x++) cells.push({ x, y: 0, z: -4, fill: 'solid' })
  const state = toState({ name: 't', seed: 5, cells, modules: [], lines: [] })
  assert.equal(zoneAt(state.cells, 3, 0, 0), 'none')
  assert.equal(zoneAt(state.cells, 3, 0, -4), 'none')
  // A coordinate the document speaks for nowhere is the **street** at the ground
  // plane (which `withGround` labels 站外), and 无分区 anywhere else.
  assert.equal(zoneAt(state.cells, 99, 99, 0), 'outside', 'the plane is 站外')
  assert.equal(zoneAt(state.cells, 99, 99, -8), 'none', 'and there is nothing to zone below it')
  const labels = zoneRegionLabels(zoneMapFloorsAt(state.cells, 0))
  assert.equal(labels.length, 1)
  assert.equal(labels[0].zone, ZONE_INDEX.none, 'unpainted floor is one 无分区 area')
  assert.equal(zoneRegionLabels(zoneMapFloorsAt(state.cells, -4))[0].zone, ZONE_INDEX.none)

  // The sim's graph reads it too — this is the zone a walker on unpainted floor is
  // on, at either storey.
  const g = buildGraph({ name: 't', seed: 5, cells, modules: [], lines: [] })
  assert.equal(ZONES[g.nodeZone[g.nodeIndex.get('3,0,0')]], 'none')
  assert.equal(ZONES[g.nodeZone[g.nodeIndex.get('3,0,-4')]], 'none')

  // 无分区 is a **reading, not a record**: the model refuses to write it, and a
  // label the cell already reads is not an edit either way.
  assert.equal(paintZone(state, 3, 0, 0, 'none', false), state, '无分区 cannot be painted on')
  assert.equal(paintZoneCells(state, [[3, 0, 0]], 'none'), state)
  assert.notEqual(paintZone(state, 3, 0, 0, 'unpaid', false), state, 'while 非付费区 is a real label')
})

test('an unpainted station has one fare side from the pavement down', () => {
  // What 无分区 being on the unpaid side is *for*: a station nobody has zoned has
  // no barrier of its own, even with §4.5's fare line enforced — which is the
  // unfinished paint `ZONE_LINES_BLOCK` is still off for (`sim/constants.ts`). A
  // `paid` patch is a crossing, as it should be.
  assert.equal(crossingDir('none', 'none'), 0)
  assert.equal(crossingDir('none', 'unpaid'), 0, '无分区↔非付费区 is not a crossing')
  assert.equal(crossingDir('none', 'outside'), 0, 'nor 无分区↔站外')
  assert.equal(crossingDir('none', 'paid'), 1, 'but a paid patch still needs a gate')
  assert.equal(crossingDir('paid', 'none'), -1)

  // And the graph agrees: two unpainted cells stay connected with the barrier on,
  // which is the whole of "an unfinished station does not wall itself off".
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid' },
    { x: 1, y: 0, z: 0, fill: 'solid' },
  ]
  const g = buildGraph({ name: 't', seed: 5, cells, modules: [], lines: [] }, true)
  const a = g.nodeIndex.get('0,0,0')
  const b = g.nodeIndex.get('1,0,0')
  let edge = false
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) edge = true
  assert.ok(edge, 'two unpainted cells are one zone: no fare line between them')
})

