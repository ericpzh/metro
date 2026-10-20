import test from 'node:test'
import assert from 'node:assert/strict'
import { useStore, placementPreviewKey } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { liftModule, liftExtendedUp, liftExtendedDown } from '../src/sim/lifts.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'

test('lift interval and style tiles refresh the preview keys, and pick cancellation restores both', () => {
  useStore.setState({ moduleType: 'lift', liftStyle: 'glass', liftInterval: 5 })
  const before = placementPreviewKey(useStore.getState())
  // Tab is the floor-interval tile now; the housing moved to Shift+Tab.
  useStore.getState().cycleLiftInterval()
  assert.equal(useStore.getState().liftInterval, 6)
  assert.notEqual(placementPreviewKey(useStore.getState()), before)
  const mid = placementPreviewKey(useStore.getState())
  useStore.getState().cycleLiftStyle()
  assert.equal(useStore.getState().liftStyle, 'steel')
  assert.notEqual(placementPreviewKey(useStore.getState()), mid)
  useStore.getState().beginPick()
  useStore.getState().setLiftInterval(3)
  useStore.getState().setLiftStyle('glass')
  useStore.getState().cancelPick()
  assert.equal(useStore.getState().liftInterval, 6)
  assert.equal(useStore.getState().liftStyle, 'steel')
  useStore.getState().cycleLiftStyle()
  assert.equal(useStore.getState().liftStyle, 'glass')
  useStore.getState().cycleLiftInterval()
  assert.equal(useStore.getState().liftInterval, 7)
  const m = liftModule({ x: 0, y: 0, z: 0 }, 0, 'lift')
  assert.equal(moduleGhostKey(m), moduleGhostKey({ ...m, cfg: { ...m.cfg, style: 'glass' } }))
  assert.notEqual(moduleGhostKey(m), moduleGhostKey({ ...m, cfg: { ...m.cfg, style: 'steel' } }))
  // The interval is part of the ghost identity too: two shafts with the same ends
  // but different internal stops draw different landings.
  assert.notEqual(moduleGhostKey(m), moduleGhostKey({ ...m, cfg: { ...m.cfg, rises: [2, 2] } }))
})

test('both lift styles survive extending and saving', () => {
  for (const style of ['glass', 'steel']) {
    const mod = { ...liftModule({ x: 0, y: 0, z: 0 }, 0, 'lift'), cfg: { rises: [4], style } }
    const grown = liftExtendedDown(liftExtendedUp(mod))
    assert.equal(grown.cfg.style, style)
    const station = toState({ ...emptyStation(), modules: [grown] })
    const saved = parse(serialize(station))
    assert.ok(saved.ok)
    assert.equal(saved.state.modules[0].cfg.style, style)
  }
})
