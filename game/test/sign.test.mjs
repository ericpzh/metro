// Ceiling-hung decoration (指示牌 / 电视, GAME-SPEC §5.7): an overhead wayfinding
// board and an ad screen, both hung by rods from the storey ceiling. They are
// ceiling-mounted, not wall-mounted, so `ceilingMountMissing` requires a solid
// slab at the next grid line up and the builder refuses a piece with nothing
// overhead. Each envelope is the full storey column, so it is found and blocks
// its cell like any other equipment.
import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleAt, moduleEnvelope, placementBlocked, ceilingMountMissing, wallMountMissing } from '../src/sim/placement.ts'
import { createModule, toState } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'

/** A solid slab at one level. */
function slab(x, y, z, finish) {
  return { x, y, z, fill: 'solid', ...(finish ? { finish } : {}) }
}

const sign = (x, y, z, id = 'sign-1', rot = 0) => ({ id, type: 'sign', x, y, z, rot, cfg: {} })
const tv = (x, y, z, id = 'tv-1', rot = 0) => ({ id, type: 'tv', x, y, z, rot, cfg: {} })
const gate = (x, y, z, id = 'gate-1') => ({ id, type: 'gate', x, y, z, cfg: { dir: 'both' } })

test('a sign is created with the hover rotation, like any equipment', () => {
  const mod = createModule('sign', 1, 2, 3, 's', 1)
  assert.equal(mod?.type, 'sign')
  assert.equal(mod?.rot, 1)
  assert.equal(mod?.x, 1)
  assert.equal(mod?.y, 2)
})

test('a ceiling-hung piece needs a solid ceiling one storey up', () => {
  for (const hung of [sign(2, 3, 0), tv(2, 3, 0)]) {
    // Floor at z = 0 with no ceiling: refused.
    assert.equal(ceilingMountMissing([slab(2, 3, 0)], hung), true)
    // A solid slab at z = 4 is the ceiling.
    assert.equal(ceilingMountMissing([slab(2, 3, 0), slab(2, 3, 4)], hung), false)
    // A ceiling over a different cell does not count.
    assert.equal(ceilingMountMissing([slab(2, 3, 0), slab(4, 3, 4)], hung), true)
    // The next grid line is used, so a piece on the B1 platform (-8) hangs from
    // the concourse slab (-4).
    assert.equal(ceilingMountMissing([slab(2, 3, -8), slab(2, 3, -4)], sign(2, 3, -8)), false)
    assert.equal(ceilingMountMissing([slab(2, 3, -8)], tv(2, 3, -8)), true)
  }
  // Wall-mounted and floor-standing modules are never refused by the rule.
  assert.equal(ceilingMountMissing([slab(2, 3, 0)], gate(2, 3, 0)), false)
})

test('the sign and TV are not wall-mounted', () => {
  // No wall behind them; the ceiling rule is the only one that applies.
  assert.equal(wallMountMissing([slab(2, 3, 0)], sign(2, 3, 0)), false)
  assert.equal(wallMountMissing([slab(2, 3, 0)], tv(2, 3, 0)), false)
})

test('a ceiling-hung piece envelope is the whole storey column', () => {
  for (const hung of [sign(2, 3, 0), tv(2, 3, 0)]) {
    const box = moduleEnvelope(hung)
    assert.deepEqual(box, { x0: 2, y0: 3, z0: 1, x1: 3, y1: 4, z1: 4 })
    // It is found from its floor cell and blocks another piece there.
    assert.equal(moduleAt([hung], 2, 3, 0)?.type, hung.type)
    assert.equal(placementBlocked([hung], gate(2, 3, 0)), true)
    // Adjacent cells stay free.
    assert.equal(placementBlocked([hung], gate(3, 3, 0)), false)
  }
})

test('a ceiling-hung piece round-trips the save', () => {
  const st = toState({
    name: 't',
    seed: 1,
    cells: [slab(2, 3, 0), slab(2, 3, 4)],
    modules: [sign(2, 3, 0), tv(4, 3, 0)],
    lines: [],
  })
  const r = parse(serialize(st))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, st.modules)
})
