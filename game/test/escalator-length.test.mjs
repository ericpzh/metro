// The four fixed run lengths — 超短 2 m, 短 3 m, 中 4 m, 长 8 m — and every consumer
// of a run's endpoints (§5.1). A piece's length is its endpoints, so a save made
// before the family grew reads back as 中 / 长 with nothing stored on it.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { escalatorModule, escalatorLength, escalatorLandings } from '../src/sim/escalators.ts'
import { stairFacing, stairLengthOf } from '../src/sim/stairs.ts'
import { RAMP_LENGTHS, nextRampLength, rampLengthLabel, rampLengthOf, rampLengthSpec } from '../src/sim/rampLengths.ts'
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

test('every length rises its own metres over its own run, in either direction and width', () => {
  for (const spec of RAMP_LENGTHS) for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) for (const width of [1, 2]) {
    const base = { x: 3, y: 5, z: -spec.rise }
    const m = escalatorModule(base, rot, dir, spec.id, width, spec.id)
    const [dx, dy] = stairFacing(rot)
    const top = { x: 3 + dx * spec.run, y: 5 + dy * spec.run, z: 0 }
    assert.deepEqual(m.from, dir === 'up' ? base : top)
    assert.deepEqual(m.to, dir === 'up' ? top : base)
    assert.equal(escalatorLength(m), spec.id, 'the endpoints are the length')
    const e = moduleEnvelope(m)
    assert.equal(dx === 0 ? e.y1 - e.y0 : e.x1 - e.x0, spec.run + 1, 'reservation includes both landing cells')
    assert.equal(dx === 0 ? e.x1 - e.x0 : e.y1 - e.y0, width)
    const moved = movedModule(m, { x: 20, y: 20, z: -spec.rise - 4 }, (rot + 1) % 4)
    assert.equal(Math.abs(moved.to.z - moved.from.z), spec.rise, 'moving preserves length')
    assert.equal(Math.hypot(moved.to.x - moved.from.x, moved.to.y - moved.from.y), spec.run)
  }
})

test('the four lengths are distinct pieces, named 超短 / 短 / 中 / 长 on one tile', () => {
  const base = { x: 0, y: 0, z: -8 }
  const keys = RAMP_LENGTHS.map((s) => moduleGhostKey(escalatorModule(base, 0, 'up', s.id, 1, s.id)))
  assert.equal(new Set(keys).size, RAMP_LENGTHS.length, 'each length is its own ghost')
  assert.deepEqual(RAMP_LENGTHS.map((s) => rampLengthLabel(s.id)), ['超短', '短', '中', '长'])
  assert.deepEqual(RAMP_LENGTHS.map((s) => [s.id, s.rise, s.run]), [
    ['ultra-short', 2, 3],
    ['short', 3, 5],
    ['medium', 4, 6],
    ['long', 8, 12],
  ])
  // Tab walks the tile 超短 → 短 → 中 → 长 and wraps.
  let id = 'ultra-short'
  for (const next of ['short', 'medium', 'long', 'ultra-short']) {
    id = nextRampLength(id)
    assert.equal(id, next)
  }
})

test('a placed run reads its length back from its endpoints, old saves included', () => {
  // The two pieces an older save carries are the 4 m / 8 m ones, now 中 and 长.
  for (const [rise, run, id] of [[4, 6, 'medium'], [8, 12, 'long'], [2, 3, 'ultra-short'], [3, 5, 'short']]) {
    assert.equal(rampLengthOf(rise, run), id)
    assert.equal(rampLengthOf(-rise, run), id, 'a down run reads the same length')
  }
  // A 单跑楼梯 is built from the same four, and reports the one it was built at.
  for (const spec of RAMP_LENGTHS) {
    const stair = createModule('stair-straight', 0, 0, 0, `stair-${spec.id}`, 0, 0.68, 'up', 'lane', [], undefined, { rampLength: spec.id })
    assert.deepEqual(stair.to, { x: 0, y: spec.run, z: spec.rise }, `${spec.id} stair climbs its own run`)
    assert.equal(stairLengthOf(stair), spec.id)
  }
})

test('every length carves its own passage, connects the crowd and survives saving', () => {
  for (const spec of RAMP_LENGTHS) {
    const zLo = -spec.rise
    const cells = []
    for (let z = zLo; z <= 0; z++) for (let x = -2; x <= 3; x++) for (let y = -2; y <= spec.run + 2; y++) cells.push({ x, y, z, fill: 'solid' })
    const m = escalatorModule({ x: 0, y: 0, z: zLo }, 0, 'up', `esc-${spec.id}`, 2, spec.id)
    const state = addEquipment(toState({ name: spec.id, seed: 1, cells, modules: [], lines: [] }), m)
    for (const p of escalatorLandings(m)) {
      assert.ok(state.cells.some((c) => c.x === p.x && c.y === p.y && c.z === p.z && c.fill === 'solid'), `${spec.id} keeps its landings`)
    }
    assert.ok(state.cells.length < cells.length, `${spec.id} opens the slab over the run`)
    const loaded = parse(serialize(state))
    assert.equal(loaded.ok, true)
    assert.deepEqual(loaded.state.modules[0], m)
    const g = buildGraph({ name: spec.id, seed: 1, cells: state.cells, modules: state.modules, lines: [] })
    const server = g.servers.find((s) => s.kind === 'escalator')
    assert.ok(server, `${spec.id} keeps both landings on the crowd graph`)
    assert.ok(Math.abs(server.ride - Math.hypot(spec.run, spec.rise) / ESCALATOR_SPEED) < 1e-6)
  }
})

test('every length snaps into an exit bay, and the setting redraws previews and restores on picker cancellation', () => {
  const before = useStore.getState()
  try {
    const exit = createModule('exit-covered-2', 0, 0, 0, 'exit')
    const station = toState({ name: 'exit', seed: 1, cells: [], modules: [exit], lines: [] })
    const tool = new EquipmentTool({})
    for (const spec of RAMP_LENGTHS) {
      useStore.setState({ station, rampLength: spec.id, escalatorWide: true, escalatorDir: 'down' })
      const m = tool.buildPlacementModules('escalator', [0, 0, 0], `snap-${spec.id}`)[0]
      assert.equal(m.from.z, 0, 'snapped upper landing stays in the exit')
      assert.equal(m.to.z, -spec.rise, 'lower landing reaches the piece\u2019s own rise below')
      assert.equal(Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), spec.run)
      assert.equal(m.cfg.width, 2)
      assert.equal(escalatorLength(m), spec.id)
    }
    // The length is in the key the viewport rebuilds its ghost from, and Esc puts
    // the armed length back after a pick moved it.
    useStore.setState({ station, rampLength: 'medium' })
    const key = placementPreviewKey(useStore.getState())
    useStore.getState().cycleRampLength()
    assert.equal(useStore.getState().rampLength, 'long')
    assert.notEqual(placementPreviewKey(useStore.getState()), key)
    useStore.getState().beginPick()
    useStore.getState().cycleRampLength()
    useStore.getState().cancelPick()
    assert.equal(useStore.getState().rampLength, 'long')
  } finally {
    useStore.setState(before)
  }
})

test('a 单跑楼梯 dropped in an exit bay snaps to its own length too', () => {
  const before = useStore.getState()
  try {
    const exit = createModule('exit-covered-2', 0, 0, 0, 'exit')
    const station = toState({ name: 'exit', seed: 1, cells: [], modules: [exit], lines: [] })
    const tool = new EquipmentTool({})
    for (const spec of RAMP_LENGTHS) {
      useStore.setState({ station, rampLength: spec.id })
      const m = tool.buildPlacementModules('stair-straight', [0, 0, 0], `snap-stair-${spec.id}`)[0]
      // A 楼梯 has no direction: the snapped bay cell is where it *lands*, so its
      // base sits its own rise below the exit and it climbs back up into the bay.
      assert.equal(m.from.z, -spec.rise)
      assert.equal(m.to.z, 0)
      assert.equal(Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), spec.run)
      assert.equal(stairLengthOf(m), spec.id)
    }
  } finally {
    useStore.setState(before)
  }
})

test('a save the catalogue cannot spell, or a span it never built, still arms a tile', () => {
  // The catalogue is the **only** place a length is named, so a document carrying a
  // size this build does not know (an older save, a newer one) has to answer 中 rather
  // than nothing: the tool would otherwise arm a piece with no length at all.
  assert.equal(rampLengthSpec(undefined).id, 'medium', 'a piece with no stored length is 中')
  assert.equal(rampLengthSpec('mile').id, 'medium', 'a length from another build falls back to 中')
  assert.equal(rampLengthLabel(undefined), '中')
  // The nearest entry wins on rise and run **together**, so an off-grid span a save
  // predates (an older stair band, a hand-edited piece) arms the closest tile.
  assert.equal(rampLengthOf(4, 7), 'medium', 'one cell longer than its own run')
  assert.equal(rampLengthOf(2, 4), 'ultra-short')
  assert.equal(rampLengthOf(3, 4), 'short')
})

test('a turning stair has no length of its own, and every length redraws the stair ghost too', () => {
  for (const style of ['right90', 'left90', 'right180', 'centerForward']) {
    const turn = createModule(`stair-${style}`, 0, 0, 0, `turn-${style}`, 0, 0.68)
    assert.equal(stairLengthOf(turn), 'medium', `${style} is the fixed footprint its turn is drawn at`)
  }
  const keys = RAMP_LENGTHS.map((s) => moduleGhostKey(createModule('stair-straight', 0, 0, 0, 's', 0, 0.68, 'up', 'lane', [], undefined, { rampLength: s.id })))
  assert.equal(new Set(keys).size, RAMP_LENGTHS.length, 'a stair length is in the ghost the viewport rebuilds from')
})

test('one armed length drives both pieces, so a bank is one size', () => {
  const before = useStore.getState()
  try {
    const station = toState({ name: 'bank', seed: 1, cells: [], modules: [], lines: [] })
    const tool = new EquipmentTool({})
    for (const spec of RAMP_LENGTHS) {
      useStore.setState({ station, moduleType: 'escalator', rampLength: spec.id, moduleRot: 0, escalatorWide: false })
      // The length belongs to the **player**, not to the piece: switching to the
      // 单跑楼梯 that will stand beside it keeps the size, which is the one thing the
      // seam between the two depends on.
      useStore.getState().setModuleType('stair-straight')
      assert.equal(useStore.getState().rampLength, spec.id)
      const esc = tool.buildPlacementModules('escalator', [0, 0, 0], `bank-esc-${spec.id}`)[0]
      const stair = tool.buildPlacementModules('stair-straight', [1, 0, 0], `bank-stair-${spec.id}`)[0]
      assert.equal(escalatorLength(esc), spec.id)
      assert.equal(stairLengthOf(stair), spec.id)
      assert.deepEqual(
        [Math.hypot(esc.to.x - esc.from.x, esc.to.y - esc.from.y), Math.abs(esc.to.z - esc.from.z)],
        [Math.hypot(stair.to.x - stair.from.x, stair.to.y - stair.from.y), Math.abs(stair.to.z - stair.from.z)],
        `the ${spec.id} 扶梯 and 单跑楼梯 are the same run`,
      )
    }
  } finally {
    useStore.setState(before)
  }
})

test('the drawn 扶梯 and 单跑楼梯 follow the run they were built at', () => {
  // The models are the third consumer of the endpoints after the collision body and
  // the carve: a length that reached only two of the three would draw one run and
  // walk another. Both pieces span their own run and climb their own rise.
  const mats = new Proxy({}, { get: (o, k) => (o[k] ??= new THREE.MeshStandardMaterial()) })
  const finish = () => new THREE.MeshStandardMaterial()
  const spans = []
  for (const spec of RAMP_LENGTHS) {
    const esc = escalatorModule({ x: 0, y: 0, z: -spec.rise }, 0, 'up', `esc-${spec.id}`, 1, spec.id)
    const data = { name: 'runs', seed: 1, cells: [], modules: [esc], lines: [] }
    const g = new EscalatorModel({ mats, data, preview: false }).build(esc)
    g.updateMatrixWorld(true)
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3())
    assert.ok(Number.isFinite(size.x + size.y + size.z), `${spec.id} escalator builds`)
    assert.ok(size.y > spec.run && size.y < spec.run + 2, `${spec.id} escalator spans its own ${spec.run} cell run`)
    assert.ok(size.z > spec.rise + 0.9 && size.z < spec.rise + 2, `${spec.id} escalator climbs its own ${spec.rise} m rise`)
    spans.push(size.y)

    const stair = createModule('stair-straight', 0, 0, -spec.rise, `stair-${spec.id}`, 0, 0.68, 'up', 'lane', [], undefined, { rampLength: spec.id })
    const sg = new StairModel({ mats, finish, data: { ...data, modules: [stair] }, preview: false }).build(stair)
    sg.updateMatrixWorld(true)
    const ssize = new THREE.Box3().setFromObject(sg).getSize(new THREE.Vector3())
    assert.ok(Number.isFinite(ssize.x + ssize.y + ssize.z), `${spec.id} stair builds`)
    assert.ok(Math.abs(ssize.y - spec.run) < 1.5, `${spec.id} stair spans its own ${spec.run} cell run`)
    assert.ok(ssize.z > spec.rise + 0.9 && ssize.z < spec.rise + 2, `${spec.id} stair climbs its own ${spec.rise} m rise`)
  }
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i] > spans[i - 1], 'a longer piece really is longer')
})
