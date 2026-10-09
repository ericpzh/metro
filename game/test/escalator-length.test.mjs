// 长 bridges two storeys; every consumer must use its endpoints (§5.1).
import test from 'node:test'
import assert from 'node:assert/strict'
import { escalatorModule, escalatorIsLong, escalatorLandings } from '../src/sim/escalators.ts'
import { stairFacing } from '../src/sim/stairs.ts'
import { moduleEnvelope, movedModule } from '../src/sim/placement.ts'
import { buildGraph } from '../src/sim/station.ts'
import { ESCALATOR_SPEED } from '../src/sim/constants.ts'
import { addEquipment, createModule, toState } from '../src/build/model.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore, placementPreviewKey } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'

test('long escalators rise 8 m over a 12 m run in either direction and width', () => {
  for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) for (const width of [1, 2]) {
    const base = { x: 3, y: 5, z: -8 }
    const m = escalatorModule(base, rot, dir, 'long', width, true)
    const short = escalatorModule(base, rot, dir, 'short', width)
    const [dx, dy] = stairFacing(rot)
    const top = { x: 3 + dx * 12, y: 5 + dy * 12, z: 0 }
    assert.deepEqual(m.from, dir === 'up' ? base : top)
    assert.deepEqual(m.to, dir === 'up' ? top : base)
    assert.equal(escalatorIsLong(m), true)
    assert.equal(escalatorIsLong(short), false)
    const e = moduleEnvelope(m)
    assert.equal(dx === 0 ? e.y1 - e.y0 : e.x1 - e.x0, 13, 'reservation includes both landing cells')
    assert.equal(dx === 0 ? e.x1 - e.x0 : e.y1 - e.y0, width)
    assert.notEqual(moduleGhostKey(m), moduleGhostKey(short))
    const moved = movedModule(m, { x: 20, y: 20, z: -12 }, (rot + 1) % 4)
    assert.equal(Math.abs(moved.to.z - moved.from.z), 8, 'moving preserves length')
    assert.equal(Math.hypot(moved.to.x - moved.from.x, moved.to.y - moved.from.y), 12)
  }
})

test('long placement carves both slabs, survives saving and supplies a full-length ride', () => {
  for (const dir of ['up', 'down']) {
    const m = escalatorModule({ x: 0, y: 0, z: -8 }, 0, dir, 'long', 2, true)
    const cells = []
    for (const z of [-8, -4, 0]) for (let x = -2; x <= 3; x++) for (let y = -2; y <= 14; y++) cells.push({ x, y, z, fill: 'solid' })
    const state = addEquipment(toState({ name: 'long', seed: 1, cells, modules: [], lines: [] }), m)
    assert.equal(state.modules.length, 1)
    for (const p of escalatorLandings(m)) assert.ok(state.cells.some((c) => c.x === p.x && c.y === p.y && c.z === p.z && c.fill === 'solid'))
    for (const [y, z] of [[3, -4], [9, 0]]) for (const x of [0, 1]) {
      assert.equal(state.cells.some((c) => c.x === x && c.y === y && c.z === z && c.fill === 'solid'), false, 'intermediate and upper floors open across both columns')
    }
    const loaded = parse(serialize(state))
    assert.equal(loaded.ok, true)
    assert.deepEqual(loaded.state.modules[0], m)
    const g = buildGraph({ name: 'long', seed: 1, cells: state.cells, modules: state.modules, lines: [] })
    const server = g.servers.find((s) => s.kind === 'escalator')
    assert.ok(server, 'both landings remain connected to the crowd graph')
    assert.ok(Math.abs(server.ride - Math.hypot(12, 8) / ESCALATOR_SPEED) < 1e-6)
  }
})

test('length changes redraw previews, snap into exits and restore on picker cancellation', () => {
  const before = useStore.getState()
  try {
    const exit = createModule('exit-covered-2', 0, 0, 0, 'exit')
    const station = toState({ name: 'exit', seed: 1, cells: [], modules: [exit], lines: [] })
    useStore.setState({ station, escalatorLong: false, escalatorWide: true, escalatorDir: 'down' })
    const oldKey = placementPreviewKey(useStore.getState())
    useStore.getState().toggleEscalatorLength()
    assert.notEqual(placementPreviewKey(useStore.getState()), oldKey)
    const m = new EquipmentTool({}).buildPlacementModules('escalator', [0, 0, 0], 'long')[0]
    assert.equal(m.from.z, 0, 'snapped upper landing stays in the exit')
    assert.equal(m.to.z, -8, 'lower landing reaches two storeys below')
    assert.equal(Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), 12)
    assert.equal(m.cfg.width, 2)
    useStore.getState().beginPick()
    useStore.getState().toggleEscalatorLength()
    useStore.getState().cancelPick()
    assert.equal(useStore.getState().escalatorLong, true)
  } finally {
    useStore.setState(before)
  }
})
