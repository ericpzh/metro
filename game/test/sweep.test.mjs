// The delete tool's same-type drag sweep (GAME-SPEC §9.5): holding the button on
// one 设备 / 装饰 piece and dragging across its neighbours collects every matching
// piece the pointer passes over, highlighted as it is crossed, and the release
// bulldozes the whole run as one edit. The 3D picking lives in the viewport, so
// this covers the pure half: which pieces may be swept together, where the
// pointer travelled between two move events, and the bulk teardown.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SWEEP_MAX_SAMPLES, SWEEP_STEP_PX, removeSweptModules, sameSweepFamily, sweepFamily, sweepSamples, sweepThrough } from '../src/app/sweep.ts'
import { toState } from '../src/build/model.ts'

const gate = (x, y, z, id = 'gate-1', rot = 0) => ({ id, type: 'gate', x, y, z, rot, cfg: { dir: 'both' } })
const tvm = (x, y, z, id = 'tvm-1') => ({ id, type: 'tvm', x, y, z, cfg: {} })
const bench = (x, y, z, variant, id = 'bench-1') => ({ id, type: 'bench', x, y, z, w: variant === 'steel-2' ? 2 : 1, cfg: { variant } })
const billboard = (x, y, z, variant, id = 'bb-1') => ({ id, type: 'billboard', x, y, z, rot: 0, w: 1, cfg: { variant } })
const fence = (x, y, z, id = 'f-1') => ({ id, type: 'fence', x, y, z, rot: 0, cfg: {} })
const track = (x, y, z, id = 'track-1') => ({ id, type: 'track', x, y, z, w: 6, d: 3, cfg: { line: 'A', power: 'third-rail' } })
const exit = (x, y, z, id = 'exit-1') => ({ id, type: 'exit', x, y, z, cfg: { name: 'A口', inRate: 900, outRate: 900, open: true } })
const stair = (x, y, z, id = 'stair-1') => ({ id, type: 'stair', x, y, z, rot: 0, to: { x, y: y + 3, z: z + 4 }, cfg: { width: 1 } })
const shop = (id = 'shop-1') => ({ id, type: 'shop', x: 0, y: 0, z: 0, w: 5, h: 5, cfg: { kind: 'store', door: [] } })
const platformEdge = (x, y, z, id = 'pe-1') => ({ id, type: 'platform-edge', x, y, z, w: 6, cfg: { name: '1站台', line: 'A', dir: 'up', side: 'left' } })

test('a sweep matches the same equipment type, whatever the rotation', () => {
  assert.equal(sweepFamily(gate(0, 0, 0)), 'gate')
  assert.equal(sameSweepFamily(gate(0, 0, 0, 'a'), gate(1, 0, 0, 'b')), true)
  // Two gate rows facing opposite ways are still one type: a queue line is a row.
  assert.equal(sameSweepFamily(gate(0, 0, 0, 'a', 0), gate(1, 0, 0, 'b', 2)), true)
  // A different type at the end of the row never joins the sweep.
  assert.equal(sameSweepFamily(gate(0, 0, 0, 'a'), tvm(1, 0, 0, 'b')), false)
  assert.equal(sameSweepFamily(tvm(0, 0, 0, 'a'), gate(1, 0, 0, 'b')), false)
})

test('a sweep keeps the palette variant apart', () => {
  assert.equal(sweepFamily(bench(0, 0, 0, 'steel-1')), 'bench:steel-1')
  assert.equal(sameSweepFamily(bench(0, 0, 0, 'steel-1', 'a'), bench(2, 0, 0, 'steel-1', 'b')), true)
  // A dragged 2 m 座椅 leaves the 1 m ones standing.
  assert.equal(sameSweepFamily(bench(0, 0, 0, 'steel-1', 'a'), bench(2, 0, 0, 'steel-2', 'b')), false)
  assert.equal(sameSweepFamily(bench(0, 0, 0, 'steel-1', 'a'), bench(2, 0, 0, 'seat-1', 'b')), false)
  // A 横版 16:9 广告牌 does not take the portrait panels with it.
  assert.equal(sweepFamily(billboard(0, 0, 0, 'wide')), 'billboard:wide')
  assert.equal(sameSweepFamily(billboard(0, 0, 0, 'wide', 'a'), billboard(1, 0, 0, 'wide', 'b')), true)
  assert.equal(sameSweepFamily(billboard(0, 0, 0, 'wide', 'a'), billboard(1, 0, 0, 'portrait', 'b')), false)
})

test('a legacy piece with no variant reads as the palette default it is drawn as', () => {
  // A pre-variant save (or a station built by an older room builder) carries no
  // `cfg.variant`; the family key comes from the same spec table the model is
  // drawn from, so it still matches a freshly placed piece of that default.
  assert.equal(sweepFamily(bench(0, 0, 0, undefined)), sweepFamily(bench(0, 0, 0, 'steel-1')))
  assert.equal(sweepFamily(billboard(0, 0, 0, undefined)), sweepFamily(billboard(0, 0, 0, 'wide')))
  assert.equal(sameSweepFamily(bench(0, 0, 0, undefined, 'a'), bench(2, 0, 0, 'steel-1', 'b')), true)
})

test('a room, a rail, an exit, a staircase or a 围栏 is never swept', () => {
  // Each of these is one structure with its own teardown: a room folds its auto
  // walls away, a rail goes through the line manager, an exit frees its letter,
  // a staircase spans storeys, and a 围栏 already drags out a straight run.
  const unSweepable = [fence(0, 0, 0), track(0, 0, 0), exit(0, 0, 0), stair(0, 0, 0), shop(), platformEdge(0, 0, 0)]
  for (const mod of unSweepable) {
    assert.equal(sweepFamily(mod), null, `${mod.type} must not be sweepable`)
    assert.equal(sameSweepFamily(mod, { ...mod, id: 'other' }), false, `${mod.type} must not match itself`)
  }
})

test('every 设备 / 装饰 type a sweep may collect is listed', () => {
  // The list is deliberately explicit: adding a palette piece without deciding
  // its teardown leaves it un-sweepable (a safe default), and this test is where
  // that decision is written down.
  const sweepable = ['gate', 'tvm', 'vending', 'escalator', 'lift', 'bench', 'shelf', 'desk', 'cubicle', 'sink', 'bin', 'extinguisher', 'billboard', 'tv', 'sign']
  for (const type of sweepable) {
    const mod = { id: `m-${type}`, type, x: 0, y: 0, z: 0, cfg: {} }
    const family = sweepFamily(mod)
    assert.ok(family === type || family.startsWith(`${type}:`), `${type} should be sweepable, got ${family}`)
    // The same piece turned a quarter is the same target.
    assert.equal(sameSweepFamily(mod, { ...mod, id: 'other', rot: 3 }), true, `${type} should match its own type`)
  }
})

test('the pointer path between two move events is sampled, both ends included', () => {
  // A 6 px hop is one sample — the event position itself.
  assert.deepEqual(sweepSamples({ x: 10, y: 10 }, { x: 13, y: 14 }), [{ x: 13, y: 14 }])
  // A still pointer samples its own position, so a press that never moves is
  // still tested once.
  assert.deepEqual(sweepSamples({ x: 4, y: 4 }, { x: 4, y: 4 }), [{ x: 4, y: 4 }])
  // A real jump is walked end to end: the last sample is exactly the event
  // position, so a piece under the pointer is never missed by rounding.
  const step = sweepSamples({ x: 0, y: 0 }, { x: 60, y: 0 })
  assert.equal(step.length, Math.ceil(60 / SWEEP_STEP_PX))
  assert.deepEqual(step[step.length - 1], { x: 60, y: 0 })
  assert.ok(Math.abs(step[0].x - SWEEP_STEP_PX) < 1e-9, `first sample after one step, got ${step[0].x}`)
  // Samples are evenly spaced and strictly forward, so a line of 1 m cells at
  // any zoom is crossed in order.
  for (let i = 1; i < step.length; i++) assert.ok(step[i].x > step[i - 1].x)
})

test('a teleport is sampled at a bounded resolution, never skipped', () => {
  const far = sweepSamples({ x: 0, y: 0 }, { x: 100000, y: 0 })
  assert.equal(far.length, SWEEP_MAX_SAMPLES)
  assert.deepEqual(far[far.length - 1], { x: 100000, y: 0 })
  // A diagonal keeps the direction of travel: every sample is on the segment.
  const diag = sweepSamples({ x: 0, y: 0 }, { x: 30, y: 30 })
  for (const p of diag) assert.ok(Math.abs(p.x - p.y) < 1e-9)
})

test('a dragged sweep collects every matching piece the pointer passes through', () => {
  // A gate line along x at 100 px per cell, and a TVM sitting at the far end.
  // The picker stands in for `scene.pickModule`: it answers with whatever piece
  // covers that pixel column.
  const mods = [gate(0, 0, 0, 'g0'), gate(1, 0, 0, 'g1'), gate(2, 0, 0, 'g2'), tvm(3, 0, 0, 't0')]
  const pick = (x) => mods.find((m) => x >= m.x * 100 && x < (m.x + 1) * 100)?.id ?? null

  // Press on the first gate, then drag one cell to the right: the second joins.
  const ids = ['g0']
  assert.equal(sweepThrough(ids, 'gate', { x: 50, y: 50 }, { x: 150, y: 50 }, pick, mods), 1)
  assert.deepEqual(ids, ['g0', 'g1'])
  // A fast flick that jumps two cells still tests the ground it crossed, so the
  // middle gate is not skipped by a frame that landed past it.
  assert.equal(sweepThrough(ids, 'gate', { x: 150, y: 50 }, { x: 350, y: 50 }, pick, mods), 1)
  assert.deepEqual(ids, ['g0', 'g1', 'g2'])
  // The TVM at the end of the row never joins the gate sweep.
  assert.equal(sweepThrough(ids, 'gate', { x: 250, y: 50 }, { x: 380, y: 50 }, pick, mods), 0)
  assert.deepEqual(ids, ['g0', 'g1', 'g2'])
  // Crossing back over a piece already pending adds nothing (and never drops one).
  assert.equal(sweepThrough(ids, 'gate', { x: 350, y: 50 }, { x: 50, y: 50 }, pick, mods), 0)
  assert.deepEqual(ids, ['g0', 'g1', 'g2'])
  // Bare floor on the way contributes nothing.
  assert.equal(sweepThrough(ids, 'gate', { x: 350, y: 50 }, { x: 900, y: 50 }, pick, mods), 0)
  assert.deepEqual(ids, ['g0', 'g1', 'g2'])
})

test('a sweep of one is the plain single-piece bulldoze', () => {
  const mods = [gate(0, 0, 0, 'g0'), tvm(4, 0, 0, 't0')]
  const ids = ['g0']
  // A drag that crosses only its own piece leaves the list at one id, which the
  // release routes through the ordinary single-module teardown.
  assert.equal(sweepThrough(ids, 'gate', { x: 10, y: 10 }, { x: 30, y: 12 }, () => 'g0', mods), 0)
  assert.deepEqual(ids, ['g0'])
})

test('a swept run is bulldozed in one state, leaving everything else standing', () => {
  const state = toState({
    name: 't',
    seed: 1,
    cells: [
      { x: 0, y: 0, z: 0, fill: 'solid' },
      { x: 1, y: 0, z: 0, fill: 'solid' },
    ],
    modules: [gate(0, 0, 0, 'g1'), gate(1, 0, 0, 'g2'), gate(2, 0, 0, 'g3'), tvm(3, 0, 0, 't1')],
    lines: [],
  })
  const next = removeSweptModules(state, ['g1', 'g3'])
  assert.deepEqual(next.modules.map((m) => m.id), ['g2', 't1'])
  // The floor the pieces stood on is untouched: a bulldoze never digs.
  assert.deepEqual(next.cells, state.cells)
  // Nothing swept, no new state: the caller can commit unconditionally and a
  // no-op release still leaves the undo stack alone.
  assert.equal(removeSweptModules(state, []), state)
  assert.equal(removeSweptModules(state, ['missing']), state)
})
