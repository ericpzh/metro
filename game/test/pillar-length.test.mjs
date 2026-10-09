import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule } from '../src/build/model.ts'
import { familyFor, familyOptions, useStore } from '../src/app/store.ts'
import { extendedPillar } from '../src/sim/structures.ts'

test('pillars keep two width tiles and Tab toggles the added section from 4 m to 2 m', () => {
  const options = familyOptions(familyFor('pillar'))
  assert.deepEqual(options.map((m) => m.id), ['pillar-slim', 'pillar-thick'])
  assert.deepEqual(options.map((m) => m.label), ['细支柱', '粗支柱'])
  const before = useStore.getState()
  try {
    for (const size of ['slim', 'thick']) {
      useStore.setState({ moduleType: `pillar-${size}`, pillarLength: 4 })
      const base = createModule(`pillar-${size}`, 0, 0, 0, 'base')
      assert.equal(base.cfg.height, 4, 'the legacy/default pillar section stays 4 m')
      useStore.getState().togglePillarLength()
      assert.equal(useStore.getState().pillarLength, 2)
      assert.equal(extendedPillar(base, useStore.getState().pillarLength).cfg.height, 6)
      useStore.getState().togglePillarLength()
      assert.equal(useStore.getState().pillarLength, 4)
      assert.equal(extendedPillar(extendedPillar(base, 4), 2).cfg.height, 10, 'mixed sections add 4 m then 2 m')
    }
  } finally { useStore.setState(before) }
})
