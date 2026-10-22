import test from 'node:test'
import assert from 'node:assert/strict'
import { createModule } from '../src/build/model.ts'
import { familyFor, familyOptions, moduleBuilderAttributes, useStore } from '../src/app/store.ts'
import { extendedPillar, PILLAR_LENGTHS, pillarLengthLabel } from '../src/sim/structures.ts'

test('pillars keep two width tiles and Tab cycles the added section from 超短 2 m to 超长 6 m', () => {
  const options = familyOptions(familyFor('pillar'))
  assert.deepEqual(options.map((m) => m.id), ['pillar-slim', 'pillar-thick'])
  assert.deepEqual(options.map((m) => m.label), ['细支柱', '粗支柱'])
  assert.deepEqual(PILLAR_LENGTHS, [2, 3, 4, 5, 6])
  assert.deepEqual([2, 3, 4, 5, 6].map(pillarLengthLabel), ['超短', '短', '中', '长', '超长'])
  const before = useStore.getState()
  try {
    for (const size of ['slim', 'thick']) {
      useStore.setState({ moduleType: `pillar-${size}`, pillarLength: 5 })
      const base = createModule(`pillar-${size}`, 0, 0, 0, 'base')
      assert.equal(base.cfg.height, 5, 'the default pillar section stays 5 m')
      const cycled = []
      for (let i = 0; i < 6; i++) {
        useStore.getState().cyclePillarLength()
        cycled.push(useStore.getState().pillarLength)
      }
      assert.deepEqual(cycled, [6, 2, 3, 4, 5, 6], 'Tab wraps 长 → 超长 → 超短')
      assert.deepEqual([2, 3, 4, 5, 6].map((step) => extendedPillar(base, step).cfg.height), [7, 8, 9, 10, 11])
      assert.equal(extendedPillar(extendedPillar(base, 5), 2).cfg.height, 12, 'mixed sections add 5 m then 2 m')
    }
    useStore.setState({ pillarLength: 5 })
    assert.equal(moduleBuilderAttributes('pillar-slim', useStore.getState()).find((a) => a.kind === 'length').label, '长')
    useStore.setState({ pillarLength: 6 })
    assert.equal(moduleBuilderAttributes('pillar-thick', useStore.getState()).find((a) => a.kind === 'length').label, '超长')
  } finally { useStore.setState(before) }
})
