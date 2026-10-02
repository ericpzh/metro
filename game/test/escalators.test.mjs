// Placed escalators (扶梯). An escalator is fixed-length equipment like a stair:
// its base is the floor cell it is dropped on and it rises exactly one storey
// along the placement rotation. `dir` only orders `from`/`to` — the one-way
// travel the sim and the label read — so up and down share one footprint.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule, ESCALATOR_RISE, ESCALATOR_RUN, nextEscalatorDir, toState, addEquipment } from '../src/build/model.ts'
import { escalatorModule } from '../src/sim/escalators.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { moduleEnvelope, placementBlocked } from '../src/sim/placement.ts'
import { stairFacing } from '../src/sim/stairs.ts'

const floor = (x0, x1, y0, y1, z) => {
  const cells = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push({ x, y, z, fill: 'solid' })
  return cells
}

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
    levels: [{ id: 'G', z: 0, kind: 'at-grade', height: 4 }],
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

test('the demo pre-places the equipment escalator, exact same dimensions', () => {
  const ramps = referenceStation().modules.filter((m) => m.type === 'escalator')
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
