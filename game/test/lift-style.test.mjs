import test from 'node:test'
import assert from 'node:assert/strict'
import { useStore, placementPreviewKey } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { liftModule, liftExtendedUp, liftExtendedDown } from '../src/sim/lifts.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'

test('lift Tab cycle refreshes both preview keys and pick cancellation restores style', () => {
  useStore.setState({ moduleType: 'lift', liftStyle: 'glass' })
  const before = placementPreviewKey(useStore.getState())
  useStore.getState().cycleLiftStyle()
  assert.equal(useStore.getState().liftStyle, 'steel')
  assert.notEqual(placementPreviewKey(useStore.getState()), before)
  useStore.getState().beginPick()
  useStore.getState().setLiftStyle('glass')
  useStore.getState().cancelPick()
  assert.equal(useStore.getState().liftStyle, 'steel')
  useStore.getState().cycleLiftStyle()
  assert.equal(useStore.getState().liftStyle, 'glass')
  const m = liftModule({ x: 0, y: 0, z: 0 }, 0, 'lift')
  assert.equal(moduleGhostKey(m), moduleGhostKey({ ...m, cfg: { style: 'glass' } }))
  assert.notEqual(moduleGhostKey(m), moduleGhostKey({ ...m, cfg: { style: 'steel' } }))
})

test('both lift styles survive extending and saving', () => {
  for (const style of ['glass', 'steel']) {
    const mod = { ...liftModule({ x: 0, y: 0, z: 0 }, 0, 'lift'), cfg: { style } }
    const grown = liftExtendedDown(liftExtendedUp(mod))
    assert.equal(grown.cfg.style, style)
    const station = toState({ ...emptyStation(), modules: [grown] })
    const saved = parse(serialize(station))
    assert.ok(saved.ok)
    assert.equal(saved.state.modules[0].cfg.style, style)
  }
})
