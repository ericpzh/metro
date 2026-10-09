// Placed escalators (扶梯). An escalator is fixed-length equipment like a stair:
// its base is the floor cell it is dropped on and it rises exactly one storey
// along the placement rotation. `dir` only orders `from`/`to` — the one-way
// travel the sim and the label read — so up and down share one footprint.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule, ESCALATOR_RISE, ESCALATOR_RUN, nextEscalatorDir, toState, addEquipment } from '../src/build/model.ts'
import { escalatorModule } from '../src/sim/escalators.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { moduleEnvelope, placementBlocked } from '../src/sim/placement.ts'
import { stairFacing } from '../src/sim/stairs.ts'
import { escalatorLandings } from '../src/sim/escalators.ts'
import { escalatorBasesSolid, rampOpeningAt, rampSlopeCuts } from '../src/sim/openings.ts'
import { packKey } from '../src/sim/types.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore } from '../src/app/store.ts'

const floor = (x0, x1, y0, y1, z) => {
  const cells = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push({ x, y, z, fill: 'solid' })
  return cells
}

test('a wide escalator is one two-block piece in every rotation and direction', () => {
  for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
    const wide = createModule('escalator', 0, 0, -4, 'wide', rot, 2, dir)
    const narrow = createModule('escalator', 0, 0, -4, 'narrow', rot, 1, dir)
    const [dx, dy] = stairFacing(rot)
    const e = moduleEnvelope(wide)
    assert.equal(dx === 0 ? e.x1 - e.x0 : e.y1 - e.y0, 2, 'reserves exactly two blocks across')
    assert.equal(dx === 0 ? e.y1 - e.y0 : e.x1 - e.x0, ESCALATOR_RUN + 1, 'keeps the same run length')
    assert.notEqual(moduleGhostKey(wide), moduleGhostKey(narrow), 'width change redraws the ghost')
    const lower = { x: 0, y: 0, z: -4 }
    const upper = { x: dx * ESCALATOR_RUN, y: dy * ESCALATOR_RUN, z: 0 }
    const second = { x: dy, y: -dx, z: -4 }
    assert.equal(placementBlocked([wide], createModule('escalator', second.x, second.y, -4, 'overlap', rot)), true)
    assert.equal(placementBlocked([wide], createModule('escalator', 2 * dy, -2 * dx, -4, 'beside', rot)), false)
    const cells = escalatorLandings(wide).map((p) => ({ ...p, fill: 'solid' }))
    const cuts = rampSlopeCuts([wide])
    for (const p of escalatorLandings(wide)) {
      assert.equal(cuts.has(packKey(p.x, p.y, p.z)), p.z === 0, 'only upper landing floors are recessed beneath the terminal track')
    }
    assert.equal(escalatorBasesSolid(cells, [], wide), true)
    assert.equal(escalatorBasesSolid(cells.filter((c) => c.x !== second.x || c.y !== second.y || c.z !== second.z), [], wide), false, 'both blocks need lower support')
    for (const offset of [0, 1]) {
      assert.equal(rampOpeningAt([wide], 3 * dx + offset * dy, 3 * dy - offset * dx, 0), true, 'opens both columns')
    }
    const state = toState({ name: 'wide', seed: 1, cells: [...floor(-8, 8, -8, 8, 0), ...floor(-8, 8, -8, 8, -4)], modules: [], lines: [] })
    const placed = addEquipment(state, wide)
    assert.equal(placed.modules.length, 1, 'placement creates one module')
    for (const p of escalatorLandings(wide)) assert.ok(placed.cells.some((c) => c.x === p.x && c.y === p.y && c.z === p.z), 'retains every landing floor')
    assert.deepEqual(wide.from, dir === 'up' ? lower : upper)
  }
})

test('the wide escalator tool previews one piece, including downward travel', () => {
  const before = useStore.getState()
  try {
    const station = toState({ name: 'wide tool', seed: 1, cells: [], modules: [], lines: [] })
    const tool = new EquipmentTool({})
    for (let rot = 0; rot < 4; rot++) for (const dir of ['up', 'down']) {
      useStore.setState({ station, moduleRot: rot, escalatorWide: true, escalatorDir: dir })
      const pieces = tool.buildPlacementModules('escalator', [3, 5, -4], 'wide')
      assert.equal(pieces.length, 1, 'wide never creates a second escalator')
      assert.equal(pieces[0].cfg.width, 2)
      assert.equal(pieces[0].cfg.dir, dir)
      assert.deepEqual([pieces[0].x, pieces[0].y, pieces[0].z], [3, 5, -4], 'direction never changes the placement anchor')
      useStore.setState({ escalatorWide: false })
      assert.equal(tool.buildPlacementModules('escalator', [3, 5, -4], 'narrow')[0].cfg.width ?? 1, 1)
    }
  } finally {
    useStore.setState(before)
  }
})

test('an up escalator rises from the dropped cell to the storey above', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = createModule('escalator', 3, 5, -4, 'e', rot, undefined, 'up')
    assert.ok(m && m.type === 'escalator')
    const [dx, dy] = stairFacing(rot)
    assert.deepEqual(m.from, { x: 3, y: 5, z: -4 }, 'up travels from the base (lower) landing')
    assert.deepEqual(m.to, { x: 3 + dx * ESCALATOR_RUN, y: 5 + dy * ESCALATOR_RUN, z: -4 + ESCALATOR_RISE })
    assert.equal(m.cfg.dir, 'up')
    assert.equal(m.rot, rot)
  }
})

test('a down escalator keeps the same footprint, entered from the top', () => {
  for (let rot = 0; rot < 4; rot++) {
    const up = createModule('escalator', 3, 5, -4, 'u', rot, undefined, 'up')
    const down = createModule('escalator', 3, 5, -4, 'd', rot, undefined, 'down')
    assert.ok(up && down && up.type === 'escalator' && down.type === 'escalator')
    // A down run is entered at the storey above and lands on the dropped cell.
    assert.deepEqual(down.from, up.to)
    assert.deepEqual(down.to, up.from)
    assert.equal(down.cfg.dir, 'down')
    assert.deepEqual(moduleEnvelope(up), moduleEnvelope(down), 'direction must not move the run')
  }
})

test('two escalators may not share the same run', () => {
  const a = createModule('escalator', 0, 0, 0, 'a', 0, undefined, 'up')
  const b = createModule('escalator', 0, 0, 0, 'b', 0, undefined, 'down')
  // Side by side, as the reference station's two-bay ramp pairs: the balustrade
  // half-width means the next bay is two cells over, not the immediate one.
  const beside = createModule('escalator', 2, 0, 0, 'c', 0, undefined, 'up')
  assert.ok(a && b && beside)
  assert.equal(placementBlocked([a], b), true, 'the same footprint collides')
  assert.equal(placementBlocked([a], beside), false, 'the next bay over is free')
})

test('placing an escalator appends it and carves the slab it climbs through', () => {
  const state = toState({
    name: 't',
    seed: 1,
    cells: floor(0, 2, 0, 8, 0),
    modules: [],
    lines: [],
  })
  const mod = createModule('escalator', 1, 0, -4, 'esc-1', 0, undefined, 'up')
  assert.ok(mod)
  const next = addEquipment(state, mod)
  assert.equal(next.modules.length, 1)
  assert.ok(next.cells.length < state.cells.length, 'the slab over the run is opened')
})

test('the direction cycle flips up ↔ down', () => {
  assert.equal(nextEscalatorDir('up'), 'down')
  assert.equal(nextEscalatorDir('down'), 'up')
})

test('switching a selected escalator reverses travel and undo restores it', () => {
  const before = useStore.getState()
  try {
    const escalator = createModule('escalator', 2, 3, 0, 'selected-escalator', 1, undefined, 'up')
    assert.ok(escalator && escalator.type === 'escalator')
    const station = toState({ name: 'direction switch', seed: 1, cells: [], modules: [escalator], lines: [] })
    useStore.setState({ station, past: [], future: [], selected: { kind: 'module', key: escalator.id, label: '扶梯' } })

    useStore.getState().switchEscalatorDirection(escalator.id)
    const reversed = useStore.getState().station.modules[0]
    assert.ok(reversed.type === 'escalator')
    assert.equal(reversed.cfg.dir, 'down', 'the sim-facing direction changes')
    assert.deepEqual(reversed.from, escalator.to, 'the new direction boards at the former exit')
    assert.deepEqual(reversed.to, escalator.from, 'the new direction exits at the former entrance')
    assert.equal(useStore.getState().past.length, 1, 'the direction change is one undoable edit')

    useStore.getState().undo()
    const restored = useStore.getState().station.modules[0]
    assert.ok(restored.type === 'escalator')
    assert.equal(restored.cfg.dir, 'up')
    assert.deepEqual(restored.from, escalator.from)
    assert.deepEqual(restored.to, escalator.to)
  } finally {
    useStore.setState(before)
  }
})

test('the demo pre-places the equipment escalator, exact same dimensions', () => {
  const ramps = scenarioStation().modules.filter((m) => m.type === 'escalator')
  assert.ok(ramps.length > 0, 'the demo has no escalators')
  for (const m of ramps) {
    // The pre-placed run is byte-for-byte the piece the 扶梯 button builds.
    const rebuilt = escalatorModule({ x: m.x, y: m.y, z: m.z }, m.rot ?? 0, m.cfg.dir, m.id)
    assert.deepEqual(m, rebuilt, `${m.id} is not the equipment piece`)
    const run = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y)
    assert.equal(run, ESCALATOR_RUN, `${m.id} run is not the equipment's ${ESCALATOR_RUN}`)
    assert.equal(Math.abs(m.to.z - m.from.z), ESCALATOR_RISE, `${m.id} does not climb one storey`)
  }
})
