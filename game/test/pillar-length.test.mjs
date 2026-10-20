import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule } from '../src/build/model.ts'
import { familyFor, familyOptions, useStore } from '../src/app/store.ts'
import { extendedPillar } from '../src/sim/structures.ts'

test('pillars keep two width tiles and Tab toggles the added section from 5 m to 2 m', () => {
  const options = familyOptions(familyFor('pillar'))
  assert.deepEqual(options.map((m) => m.id), ['pillar-slim', 'pillar-thick'])
  assert.deepEqual(options.map((m) => m.label), ['细支柱', '粗支柱'])
  const before = useStore.getState()
  try {
    for (const size of ['slim', 'thick']) {
      useStore.setState({ moduleType: `pillar-${size}`, pillarLength: 5 })
      const base = createModule(`pillar-${size}`, 0, 0, 0, 'base')
      assert.equal(base.cfg.height, 5, 'the default pillar section stays 5 m')
      useStore.getState().togglePillarLength()
      assert.equal(useStore.getState().pillarLength, 2)
      assert.equal(extendedPillar(base, useStore.getState().pillarLength).cfg.height, 7)
      useStore.getState().togglePillarLength()
      assert.equal(useStore.getState().pillarLength, 5)
      assert.equal(extendedPillar(extendedPillar(base, 5), 2).cfg.height, 12, 'mixed sections add 5 m then 2 m')
    }
  } finally { useStore.setState(before) }
})
