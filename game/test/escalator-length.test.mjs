// The fixed run lengths — one floor for every 扶梯 (超短 2 m, 短 3 m, 中 4 m,
// 长 5 m) and every 楼梯 (the same four plus 超长 6 m), and two floors for the
// 双层 扶梯 (超短 6 m … 超长 10 m) — and every consumer of a run's endpoints
// (§5.1). A piece's length is its endpoints, so a save made before the family
// grew still reads back from its span.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { escalatorModule, escalatorLength, escalatorLandings, escalatorLengthSpec, escalatorSpanOf } from '../src/sim/escalators.ts'
import { stairFacing, stairLengthOf } from '../src/sim/stairs.ts'
import {
  DOUBLE_RAMP_LENGTHS,
  DOUBLE_RAMP_LENGTH_DEFAULT,
  RAMP_LENGTHS,
  RAMP_LENGTH_DEFAULT,
  STAIR_LENGTHS,
  defaultRampLength,
  nextRampLength,
  rampLengthLabel,
  rampLengthOf,
  rampLengthSpec,
  stairLengthSpec,
} from '../src/sim/rampLengths.ts'
import { moduleEnvelope, movedModule } from '../src/sim/placement.ts'
import { buildGraph } from '../src/sim/station.ts'
import { ESCALATOR_SPEED } from '../src/sim/constants.ts'
import { addEquipment, createModule, toState } from '../src/build/model.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore, placementPreviewKey } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { EscalatorModel } from '../src/render/models/pieces/EscalatorModel.ts'
import { StairModel } from '../src/render/models/pieces/StairModel.ts'

test('every single-floor length rises its own metres over its own run, in either direction and width', () => {
  for (const spec of RAMP_LENGTHS) for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) for (const width of [1, 2]) {
    const base = { x: 3, y: 5, z: -spec.rise }
    const m = escalatorModule(base, rot, dir, spec.id, width, spec.id)
    const [dx, dy] = stairFacing(rot)
    const top = { x: 3 + dx * escalatorLengthSpec(spec.id).run, y: 5 + dy * escalatorLengthSpec(spec.id).run, z: 0 }
    assert.deepEqual(m.from, dir === 'up' ? base : top)
    assert.deepEqual(m.to, dir === 'up' ? top : base)
    assert.equal(escalatorLength(m), spec.id, 'the endpoints are the length')
    assert.equal(escalatorSpanOf(m), 'single')
    const e = moduleEnvelope(m)
    assert.equal(dx === 0 ? e.y1 - e.y0 : e.x1 - e.x0, escalatorLengthSpec(spec.id).run + 1, 'reservation includes both landing cells')
    assert.equal(dx === 0 ? e.x1 - e.x0 : e.y1 - e.y0, width)
    const moved = movedModule(m, { x: 20, y: 20, z: -spec.rise - 4 }, (rot + 1) % 4)
    assert.equal(Math.abs(moved.to.z - moved.from.z), spec.rise, 'moving preserves length')
    assert.equal(Math.hypot(moved.to.x - moved.from.x, moved.to.y - moved.from.y), escalatorLengthSpec(spec.id).run)
  }
})

test('the one-floor 扶梯 family is 2/3/4/5 m named 超短 / 短 / 中 / 长, and 长 is the default', () => {
  assert.deepEqual(RAMP_LENGTHS.map((s) => [s.id, s.rise, s.run]), [
    ['ultra-short', 2, 3],
    ['short', 3, 5],
    ['medium', 4, 6],
    ['long', 5, 8],
  ])
  assert.deepEqual(RAMP_LENGTHS.map((s) => rampLengthLabel(s.id)), ['超短', '短', '中', '长'])
  assert.equal(RAMP_LENGTH_DEFAULT, 'long')
  assert.equal(rampLengthSpec(undefined).id, 'long')
  // Tab walks 超短 → 短 → 中 → 长 and wraps.
  let id = 'ultra-short'
  for (const next of ['short', 'medium', 'long', 'ultra-short']) {
    id = nextRampLength(id)
    assert.equal(id, next)
  }
})

test('the 楼梯 family adds 超长 6 m, exactly one metre above 长', () => {
  assert.deepEqual(STAIR_LENGTHS.map((s) => [s.id, s.rise, s.run]), [
    ['ultra-short', 2, 3],
    ['short', 3, 5],
    ['medium', 4, 6],
    ['long', 5, 8],
    ['ultra-long', 6, 9],
  ])
  assert.deepEqual(STAIR_LENGTHS.map((s) => rampLengthLabel(s.id, 'single', 'stair')), ['超短', '短', '中', '长', '超长'])
  assert.deepEqual([STAIR_LENGTHS.at(-2).rise, STAIR_LENGTHS.at(-1).rise], [5, 6], '超长 is one metre above 长')
  assert.equal(stairLengthSpec(undefined).id, 'long', 'a fresh stair is 长')
  assert.equal(stairLengthSpec('ultra-long').rise, 6)
  // The two families share every rung below 超长, so one armed bank length still
  // builds an 扶梯 and a 楼梯 side by side.
  for (const spec of RAMP_LENGTHS) assert.deepEqual(stairLengthSpec(spec.id), spec)
  // Tab walks the stair family's five rungs and wraps; an 扶梯 resolves the same
  // armed 超长 to its own maximum (长) before its cycle wraps.
  let id = 'ultra-short'
  for (const next of ['short', 'medium', 'long', 'ultra-long', 'ultra-short']) {
    id = nextRampLength(id, 'single', 'stair')
    assert.equal(id, next)
  }
  assert.equal(nextRampLength('ultra-long', 'single', 'escalator'), 'ultra-short')
  assert.equal(rampLengthLabel('ultra-long', 'single', 'escalator'), '长')
  assert.equal(rampLengthLabel('ultra-long', 'single', 'stair'), '超长')
  // A placed 6 m stair reads back into the stair family; the same climb on a
  // 扶梯 is the 双层 超短 piece, never a one-floor 6 m escalator.
  assert.equal(rampLengthOf(6, 9, 'single', 'stair'), 'ultra-long')
  assert.equal(stairLengthSpec('ultra-long').label, 'ultra_long')
  assert.deepEqual(defaultRampLength(5, 'single', 'stair'), 'long')
})

test('the double-floor family is 6…10 m named 超短 / 短 / 中 / 长 / 超长, and 超长 is its default', () => {
  assert.deepEqual(DOUBLE_RAMP_LENGTHS.map((s) => [s.id, s.rise, s.run]), [
    ['ultra-short', 6, 9],
    ['short', 7, 11],
    ['medium', 8, 12],
    ['long', 9, 14],
    ['ultra-long', 10, 15],
  ])
  assert.deepEqual(DOUBLE_RAMP_LENGTHS.map((s) => rampLengthLabel(s.id, 'double')), ['超短', '短', '中', '长', '超长'])
  assert.equal(DOUBLE_RAMP_LENGTH_DEFAULT, 'ultra-long')
  assert.equal(rampLengthSpec('ultra-long', 'double').rise, 10)
  // A single-floor id the double family also spells keeps its own rise there:
  // 中 is 4 m on one floor and 8 m on two.
  assert.deepEqual([rampLengthSpec('medium').rise, rampLengthSpec('medium', 'double').rise], [4, 8])
  // 超长 is not a 单层 扶梯 rung; asking for it on one falls back to 长. (The
  // stair family owns that rung on one floor — see its own test above.)
  assert.equal(rampLengthSpec('ultra-long', 'single').id, 'long')
  let id = 'ultra-short'
  for (const next of ['short', 'medium', 'long', 'ultra-long', 'ultra-short']) {
    id = nextRampLength(id, 'double')
    assert.equal(id, next)
  }
})

test('every length is its own ghost, and the 双层 family spans two floors', () => {
  const base = { x: 0, y: 0, z: -8 }
  const keys = RAMP_LENGTHS.map((s) => moduleGhostKey(escalatorModule(base, 0, 'up', s.id, 1, s.id)))
  assert.equal(new Set(keys).size, RAMP_LENGTHS.length, 'each length is its own ghost')
  const double = DOUBLE_RAMP_LENGTHS.map((s) => escalatorModule(base, 0, 'up', s.id, 1, s.id, 4, 'double'))
  assert.equal(new Set(double.map((m) => moduleGhostKey(m))).size, DOUBLE_RAMP_LENGTHS.length)
  for (const [m, spec] of double.map((m, i) => [m, DOUBLE_RAMP_LENGTHS[i]])) {
    assert.equal(Math.abs(m.to.z - m.from.z), spec.rise)
    assert.equal(escalatorSpanOf(m), 'double')
    assert.equal(escalatorLength(m), spec.id)
  }
})

test('a five-metre station lays its escalators at a strict 30° inside whole-cell landings', () => {
  for (const [family, span] of [[RAMP_LENGTHS, 'single'], [DOUBLE_RAMP_LENGTHS, 'double']]) for (const spec of family) {
    const m = escalatorModule({ x: 0, y: 0, z: 0 }, 0, 'up', 'e', 1, spec.id, 5, span)
    const run = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y)
    assert.equal(run, Math.ceil(spec.rise / Math.tan(Math.PI / 6)), `${span} ${spec.id} keeps its own 30° run`)
    assert.equal(m.cfg.incline, 30)
    assert.equal(escalatorLengthSpec(spec.id, 5, span).rise, spec.rise)
  }
})

test('a placed run reads its length back from its endpoints, old saves included', () => {
  // The two pieces an older save carries are the 4 m / 8 m ones, now 中 and — for
  // the eight-metre escalator — 双层 中.
  for (const [rise, run, span, id] of [
    [4, 6, 'single', 'medium'],
    [8, 12, 'double', 'medium'],
    [2, 3, 'single', 'ultra-short'],
    [3, 5, 'single', 'short'],
  ]) {
    assert.equal(rampLengthOf(rise, run, span), id)
    assert.equal(rampLengthOf(-rise, run, span), id, 'a down run reads the same length')
  }
  // A 楼梯 is built from the stair family, and reports the one it was built at —
  // 超长 6 m included.
  for (const spec of STAIR_LENGTHS) {
    const stair = createModule('stair-straight', 0, 0, 0, `stair-${spec.id}`, 0, 0.68, 'up', 'lane', [], undefined, { rampLength: spec.id })
    assert.deepEqual(stair.to, { x: 0, y: spec.run, z: spec.rise }, `${spec.id} stair climbs its own run`)
    assert.equal(stairLengthOf(stair), spec.id)
  }
  // A double escalator is read back as the double family, not the single one.
  const double = escalatorModule({ x: 0, y: 0, z: 0 }, 0, 'up', 'd', 1, 'long', 4, 'double')
  assert.equal(escalatorLength(double), 'long')
  assert.equal(escalatorSpanOf(double), 'double')
})

test('every length carves its own passage, connects the crowd and survives saving', () => {
  for (const [family, span] of [[RAMP_LENGTHS, 'single'], [DOUBLE_RAMP_LENGTHS, 'double']]) for (const spec of family) {
    const zLo = -spec.rise
    const cells = []
    for (let z = zLo; z <= 0; z++) for (let x = -2; x <= 3; x++) for (let y = -2; y <= escalatorLengthSpec(spec.id, 5, span).run + 2; y++) cells.push({ x, y, z, fill: 'solid' })
    const m = escalatorModule({ x: 0, y: 0, z: zLo }, 0, 'up', `esc-${span}-${spec.id}`, 2, spec.id, 5, span)
    const state = addEquipment(toState({ name: spec.id, seed: 1, cells, modules: [], lines: [] }), m)
    for (const p of escalatorLandings(m)) {
      assert.ok(state.cells.some((c) => c.x === p.x && c.y === p.y && c.z === p.z && c.fill === 'solid'), `${span} ${spec.id} keeps its landings`)
    }
    assert.ok(state.cells.length < cells.length, `${span} ${spec.id} opens the slab over the run`)
    const loaded = parse(serialize(state))
    assert.equal(loaded.ok, true)
    assert.deepEqual(loaded.state.modules[0], m)
    const g = buildGraph({ name: spec.id, seed: 1, cells: state.cells, modules: state.modules, lines: [] })
    const server = g.servers.find((s) => s.kind === 'escalator')
    assert.ok(server, `${span} ${spec.id} keeps both landings on the crowd graph`)
    assert.ok(Math.abs(server.ride - Math.hypot(escalatorLengthSpec(spec.id, 5, span).run, spec.rise) / ESCALATOR_SPEED) < 1e-6)
  }
})

test('every length snaps into an exit bay, and the setting redraws previews and restores on picker cancellation', () => {
  const before = useStore.getState()
  try {
    const exit = createModule('exit-covered-2', 0, 0, 0, 'exit')
    const station = toState({ name: 'exit', seed: 1, cells: [], modules: [exit], lines: [] })
    const tool = new EquipmentTool({})
    for (const spec of RAMP_LENGTHS) {
      useStore.setState({ station, rampLength: spec.id, escalatorSpan: 'single', escalatorWide: true, escalatorDir: 'down' })
      const m = tool.buildPlacementModules('escalator', [0, 0, 0], `snap-${spec.id}`)[0]
      assert.equal(m.from.z, 0, 'snapped upper landing stays in the exit')
      assert.equal(m.to.z, -spec.rise, 'lower landing reaches the piece\u2019s own rise below')
      assert.equal(Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), escalatorLengthSpec(spec.id).run)
      assert.equal(m.cfg.width, 2)
      assert.equal(escalatorLength(m), spec.id)
      assert.equal(escalatorSpanOf(m), 'single')
    }
    // The double family snaps at its own two-floor rise, and the tool rebuilds the
    // run its span selected.
    for (const spec of DOUBLE_RAMP_LENGTHS) {
      useStore.setState({ station, escalatorSpan: 'double', doubleRampLength: spec.id })
      const m = tool.buildPlacementModules('escalator', [0, 0, 0], `snap-double-${spec.id}`)[0]
      assert.equal(m.to.z, -spec.rise)
      assert.equal(escalatorLength(m), spec.id)
      assert.equal(escalatorSpanOf(m), 'double')
    }
    // The length and span are in the key the viewport rebuilds its ghost from, and
    // Esc puts the armed settings back after a pick moved them.
    useStore.setState({ station, rampLength: 'medium', escalatorSpan: 'single' })
    const key = placementPreviewKey(useStore.getState())
    useStore.getState().cycleRampLength()
    assert.equal(useStore.getState().rampLength, 'long')
    assert.notEqual(placementPreviewKey(useStore.getState()), key)
    useStore.getState().cycleEscalatorSpan()
    assert.equal(useStore.getState().escalatorSpan, 'double')
    assert.notEqual(placementPreviewKey(useStore.getState()), key)
    useStore.getState().beginPick()
    useStore.getState().cycleRampLength()
    useStore.getState().cycleEscalatorSpan()
    useStore.getState().cancelPick()
    assert.equal(useStore.getState().rampLength, 'long')
    assert.equal(useStore.getState().escalatorSpan, 'double')
  } finally {
    useStore.setState(before)
  }
})

test('a 超长 stair climbs 6 m over 9 cells, opens the slab above and keeps its landing', () => {
  // The staircase's extra rung is the one length that leaves the fixed 5 m
  // storey: it must carve the ceiling it climbs through and still found its top
  // landing one metre above the storey grid (a mezzanine floor the player built).
  const cells = []
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 12; y++) for (const z of [0, 5]) cells.push({ x, y, z, fill: 'solid' })
  for (let x = -2; x <= 2; x++) for (let y = 8; y <= 12; y++) cells.push({ x, y, z: 6, fill: 'solid' })
  const stair = createModule('stair-straight', 0, 0, 0, 'stair-ultra', 0, 0.68, 'up', 'lane', [], undefined, { rampLength: 'ultra-long' })
  assert.deepEqual([stair.from, stair.to], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 9, z: 6 }])
  const state = addEquipment(toState({ name: 'ultra', seed: 1, cells, modules: [], lines: [] }), stair)
  assert.ok(state.cells.length < cells.length, 'the flight opens the slab it climbs through')
  assert.ok(!state.cells.some((c) => c.x === 0 && c.y === 7 && c.z === 5 && c.fill === 'solid'), 'the storey ceiling over the flight is carved')
  assert.ok(state.cells.some((c) => c.x === 0 && c.y === 9 && c.z === 6 && c.fill === 'solid'), 'the top landing stays solid')
  const g = buildGraph({ name: 'ultra', seed: 1, cells: state.cells, modules: state.modules, lines: [] })
  const bottom = g.nodeIndex.get('0,0,0')
  const top = g.nodeIndex.get('0,9,6')
  assert.notEqual(bottom, undefined, 'the foot is a walk node')
  assert.notEqual(top, undefined, 'the top landing is a walk node one metre above the storey')
  assert.ok(g.servers.some((s) => s.kind === 'stair' && s.node === bottom && s.exitNode === top), 'one flight joins them')
})

test('a 楼梯 dropped in an exit bay snaps to its own length too, 超长 included', () => {
  const before = useStore.getState()
  try {
    const exit = createModule('exit-covered-2', 0, 0, 0, 'exit')
    const station = toState({ name: 'exit', seed: 1, cells: [], modules: [exit], lines: [] })
    const tool = new EquipmentTool({})
    for (const spec of STAIR_LENGTHS) {
      useStore.setState({ station, rampLength: spec.id })
      const m = tool.buildPlacementModules('stair-straight', [0, 0, 0], `snap-stair-${spec.id}`)[0]
      // A 楼梯 has no direction: the snapped bay cell is where it *lands*, so its
      // base sits its own rise below the exit and it climbs back up into the bay.
      assert.equal(m.from.z, -spec.rise)
      assert.equal(m.to.z, 0)
      assert.equal(Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), spec.run)
      assert.equal(stairLengthOf(m), spec.id)
      // The snap's descent and the piece built must agree for every rung: a
      // 超长 stair that descended 5 m would land a storey above the concourse.
      const stairSpec = stairLengthSpec(spec.id)
      assert.deepEqual([m.to.z - m.from.z, Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y)], [stairSpec.rise, stairSpec.run])
    }
  } finally {
    useStore.setState(before)
  }
})

test('a save the catalogue cannot spell, or a span it never built, still arms a tile', () => {
  // The catalogue is the **only** place a length is named, so a document carrying a
  // size this build does not know (an older save, a newer one) has to answer the
  // family default rather than nothing: the tool would otherwise arm a piece with
  // no length at all.
  assert.equal(rampLengthSpec(undefined).id, 'long', 'a piece with no stored length is 长')
  assert.equal(rampLengthSpec('mile').id, 'long', 'a length from another build falls back to 长')
  assert.equal(rampLengthLabel(undefined), '长')
  assert.equal(rampLengthLabel(undefined, 'double'), '超长')
  // The nearest entry wins on rise, with run as the tie-breaker, so an off-grid
  // span a save predates (an older stair band, a hand-edited piece) arms the
  // closest tile.
  assert.equal(rampLengthOf(4, 7), 'medium', 'one cell longer than its own run')
  assert.equal(rampLengthOf(2, 4), 'ultra-short')
  assert.equal(rampLengthOf(3, 4), 'short')
  // An old 8 m escalator reads as a two-floor 中.
  assert.equal(rampLengthOf(8, 12, 'double'), 'medium')
})

test('a turning stair takes the same length tile, with its platform at half the rise', () => {
  for (const spec of STAIR_LENGTHS) {
    const turn = createModule('stair-right180', 0, 0, 0, `turn-${spec.id}`, 0, 0.68, 'up', 'lane', [], undefined, { rampLength: spec.id })
    assert.equal(Math.abs(turn.to.z - turn.from.z), spec.rise, `${spec.id} turning stair climbs its own rise`)
    assert.equal(stairLengthOf(turn), spec.id)
    const flights = turn.cfg.flights
    assert.equal(flights.length, 2)
    assert.equal(flights[0].to.z, spec.rise / 2, `${spec.id} platform is at half the rise`)
    assert.equal(flights[1].from.z, spec.rise / 2)
  }
  const keys = STAIR_LENGTHS.map((s) => moduleGhostKey(createModule('stair-right180', 0, 0, 0, 's', 0, 0.68, 'up', 'lane', [], undefined, { rampLength: s.id })))
  assert.equal(new Set(keys).size, STAIR_LENGTHS.length, 'a stair length is in the ghost the viewport rebuilds from')
})

test('one armed length drives both pieces, and only a stair takes 超长', () => {
  const before = useStore.getState()
  try {
    const station = toState({ name: 'bank', seed: 1, cells: [], modules: [], lines: [] })
    const tool = new EquipmentTool({})
    for (const spec of RAMP_LENGTHS) {
      useStore.setState({ station, moduleType: 'escalator', rampLength: spec.id, escalatorSpan: 'single', moduleRot: 0, escalatorWide: false })
      // The length belongs to the **player**, not to the piece: switching to the
      // 楼梯 that will stand beside it keeps the size.
      useStore.getState().setModuleType('stair-straight')
      assert.equal(useStore.getState().rampLength, spec.id)
      const esc = tool.buildPlacementModules('escalator', [0, 0, 0], `bank-esc-${spec.id}`)[0]
      const stair = tool.buildPlacementModules('stair-straight', [1, 0, 0], `bank-stair-${spec.id}`)[0]
      assert.equal(escalatorLength(esc), spec.id)
      assert.equal(stairLengthOf(stair), spec.id)
      assert.equal(Math.abs(esc.to.z - esc.from.z), spec.rise)
      assert.equal(Math.abs(stair.to.z - stair.from.z), spec.rise)
    }
    // 超长 is the stair's own rung: the same armed setting builds a 6 m stair and
    // resolves the 扶梯 beside it to its 5 m maximum, never a one-floor 6 m run.
    useStore.setState({ station, moduleType: 'stair-straight', rampLength: 'ultra-long', escalatorSpan: 'single' })
    const tallStair = tool.buildPlacementModules('stair-straight', [1, 0, 0], 'bank-stair-ultra')[0]
    assert.equal(Math.abs(tallStair.to.z - tallStair.from.z), 6)
    assert.equal(stairLengthOf(tallStair), 'ultra-long')
    const clampedEsc = tool.buildPlacementModules('escalator', [0, 0, 0], 'bank-esc-ultra')[0]
    assert.equal(Math.abs(clampedEsc.to.z - clampedEsc.from.z), 5)
    assert.equal(escalatorLength(clampedEsc), 'long')
  } finally {
    useStore.setState(before)
  }
})

test('the drawn 扶梯 and 楼梯 follow the run they were built at', () => {
  // The models are the third consumer of the endpoints after the collision body and
  // the carve: a length that reached only two of the three would draw one run and
  // walk another. Both pieces span their own run and climb their own rise.
  const mats = new Proxy({}, { get: (o, k) => (o[k] ??= new THREE.MeshStandardMaterial()) })
  const finish = () => new THREE.MeshStandardMaterial()
  const spans = []
  for (const [family, spanFamily] of [[RAMP_LENGTHS, 'single'], [DOUBLE_RAMP_LENGTHS, 'double']]) for (const spec of family) {
    const esc = escalatorModule({ x: 0, y: 0, z: -spec.rise }, 0, 'up', `esc-${spanFamily}-${spec.id}`, 1, spec.id, 4, spanFamily)
    const data = { name: 'runs', seed: 1, cells: [], modules: [esc], lines: [] }
    const g = new EscalatorModel({ mats, data, preview: false }).build(esc)
    g.updateMatrixWorld(true)
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3())
    assert.ok(Number.isFinite(size.x + size.y + size.z), `${spanFamily} ${spec.id} escalator builds`)
    assert.ok(size.y > escalatorLengthSpec(spec.id, 5, spanFamily).run && size.y < escalatorLengthSpec(spec.id, 5, spanFamily).run + 2, `${spanFamily} ${spec.id} escalator spans its own ${escalatorLengthSpec(spec.id, 5, spanFamily).run} cell run`)
    assert.ok(size.z > spec.rise + 0.9 && size.z < spec.rise + 2, `${spanFamily} ${spec.id} escalator climbs its own ${spec.rise} m rise`)
    spans.push(size.y)
  }
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i] > spans[i - 1], 'a longer piece really is longer')
  // The stair draws its own five-rung family, 超长 6 m included.
  for (const spec of STAIR_LENGTHS) {
    const stair = createModule('stair-straight', 0, 0, -spec.rise, `stair-${spec.id}`, 0, 0.68, 'up', 'lane', [], undefined, { rampLength: spec.id })
    const sg = new StairModel({ mats, finish, data: { name: 'runs', seed: 1, cells: [], modules: [stair], lines: [] }, preview: false }).build(stair)
    sg.updateMatrixWorld(true)
    const ssize = new THREE.Box3().setFromObject(sg).getSize(new THREE.Vector3())
    assert.ok(Number.isFinite(ssize.x + ssize.y + ssize.z), `${spec.id} stair builds`)
    assert.ok(Math.abs(ssize.y - spec.run) < 1.5, `${spec.id} stair spans its own ${spec.run} cell run`)
    assert.ok(ssize.z > spec.rise + 0.9 && ssize.z < spec.rise + 2, `${spec.id} stair climbs its own ${spec.rise} m rise`)
  }
})
