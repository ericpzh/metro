// Benches (座椅, GAME-SPEC §5.7): the 装饰 seating comes in two families — a
// plain stainless bench with no back and an upholstered seat with a back and arm
// rests — each 1 m or 2 m wide. The 2 m piece is a real two-cell run, so its
// collision envelope and its base cells cover both of its cells for every
// rotation, and the variant table is the one source the factory, the renderer
// and the palette share.
import test from 'node:test'
import assert from 'node:assert/strict'
import { benchCells, moduleAt, placementBlocked, placementOnTrack } from '../src/sim/placement.ts'
import { benchSpec, BENCH_SPECS, BENCH_VARIANTS } from '../src/sim/benches.ts'
import { createModule, toData, toState } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'

/** Open floor: 10x10 slab at z = 0. */
function flatStation() {
  const cells = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  return toState({ name: 't', seed: 1, cells, modules: [], lines: [] })
}

const bench = (id, x, y, rot = 0, w = 1, variant = undefined) => ({ id, type: 'bench', x, y, z: 0, rot, w, cfg: { variant } })

test('the bench table offers two families at two widths', () => {
  assert.deepEqual([...BENCH_VARIANTS], ['steel-1', 'steel-2', 'seat-1', 'seat-2'])
  assert.equal(BENCH_SPECS['steel-1'].style, 'steel')
  assert.equal(BENCH_SPECS['steel-2'].style, 'steel')
  assert.equal(BENCH_SPECS['seat-1'].style, 'seat')
  assert.equal(BENCH_SPECS['seat-2'].style, 'seat')
  assert.deepEqual(BENCH_VARIANTS.map((v) => BENCH_SPECS[v].w), [1, 2, 1, 2])
  // An unknown or legacy variant falls back to the 1 m stainless bench.
  assert.equal(benchSpec(undefined).variant, 'steel-1')
  assert.equal(benchSpec('nope').variant, 'steel-1')
})

test('the factory builds every variant with the hover rotation', () => {
  for (const [id, variant] of [
    ['bench-steel-1', 'steel-1'],
    ['bench-steel-2', 'steel-2'],
    ['bench-seat-1', 'seat-1'],
    ['bench-seat-2', 'seat-2'],
  ]) {
    const mod = createModule(id, 4, 4, 0, 'b', 2)
    assert.equal(mod?.type, 'bench')
    assert.equal(mod?.cfg.variant, variant)
    assert.equal(mod?.w, benchSpec(variant).w)
    assert.equal(mod?.rot, 2)
  }
})

test('a bare bench is the legacy 1 m stainless piece', () => {
  const mod = createModule('bench', 1, 2, 3, 'b')
  assert.equal(mod?.w, 1)
  assert.equal(mod?.cfg.variant, 'steel-1')
  assert.equal(mod?.x, 1)
  assert.equal(mod?.y, 2)
})

test('a two-metre bench covers two cells in its own direction', () => {
  const along = bench('a', 4, 4, 0, 2, 'steel-2')
  assert.deepEqual(benchCells(along), [
    [4, 4, 0],
    [5, 4, 0],
  ])
  // A quarter-turn runs it along +y instead.
  const turned = bench('b', 4, 4, 1, 2, 'steel-2')
  assert.deepEqual(benchCells(turned), [
    [4, 4, 0],
    [4, 5, 0],
  ])
  // The 1 m piece stays a single cell.
  assert.deepEqual(benchCells(bench('c', 4, 4, 0, 1, 'steel-1')), [[4, 4, 0]])
})

test('the long run blocks both of its cells and no more', () => {
  const two = bench('two', 4, 4, 0, 2, 'steel-2')
  // A piece on the second cell collides; the next one over does not.
  assert.equal(placementBlocked([two], bench('o', 5, 4, 0, 1, 'steel-1')), true)
  assert.equal(placementBlocked([two], bench('o', 6, 4, 0, 1, 'steel-1')), false)
  // And the reverse order too.
  assert.equal(placementBlocked([bench('o', 5, 4, 0, 1, 'steel-1')], two), true)
  // A quarter-turned run and its neighbour.
  const turned = bench('t', 4, 4, 1, 2, 'steel-2')
  assert.equal(placementBlocked([turned], bench('o', 4, 5, 0, 1, 'steel-1')), true)
})

test('a long run is found from any of its cells', () => {
  const two = bench('two', 4, 4, 0, 2, 'steel-2')
  assert.equal(moduleAt([two], 4, 4, 0)?.id, 'two')
  assert.equal(moduleAt([two], 5, 4, 0)?.id, 'two')
  assert.equal(moduleAt([two], 6, 4, 0), undefined)
})

test('equipment is still refused on every cell of a long run over a track bed', () => {
  const st = flatStation()
  // Paint the second cell of the run as a track bed.
  const cells = st.cells.map((c) => (c.x === 5 && c.y === 4 ? { ...c, finish: { top: 'floor.track' } } : c))
  const two = bench('two', 4, 4, 0, 2, 'steel-2')
  assert.equal(placementOnTrack(cells, two, [two]), true)
  assert.equal(placementOnTrack(cells, bench('one', 4, 4, 0, 1, 'steel-1'), []), false)
})

test('a bench variant and its width round-trip the save', () => {
  let st = flatStation()
  st = { ...st, modules: [bench('two', 4, 4, 0, 2, 'seat-2')] }
  const r = parse(serialize(st))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.modules, st.modules)
})
