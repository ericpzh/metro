import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLevelBase } from '../src/sim/constants.ts'
import {
  nextRoofWidth,
  pillarSupportsBridge,
  roofWidthLabel,
  supportedRoofWidth,
  trussRoofRidge,
  trussRoofTop,
} from '../src/sim/structures.ts'
import { paintRoofSurface } from '../src/build/model/RoofPaint.ts'
import { createModule } from '../src/build/model.ts'
import { toState } from '../src/build/model/State.ts'
import { emptyStation } from '../src/data/reference-station.ts'

test('normalizeLevelBase repairs rather than refuses', () => {
  assert.equal(normalizeLevelBase(undefined), 0, 'an old save with no base stays at 0 m')
  assert.equal(normalizeLevelBase(Number.NaN), 0, 'NaN is not a grid shift')
  assert.equal(normalizeLevelBase(-2), 0, 'a negative base clamps to the grid')
  assert.equal(normalizeLevelBase(99), 3, 'a base past the slider clamps to 3 m')
  assert.equal(normalizeLevelBase(1.6), 2, 'a fractional base rounds to whole metres')
})

test('roof width helpers cycle, clamp and label the three bays', () => {
  assert.equal(nextRoofWidth(4), 8)
  assert.equal(nextRoofWidth(8), 12)
  assert.equal(nextRoofWidth(12), 4, 'the width cycle wraps instead of running off the palette')
  assert.equal(supportedRoofWidth(99), 4, 'an unknown width reads as the narrow bay')
  assert.equal(supportedRoofWidth(undefined), 4)
  assert.equal(roofWidthLabel(4), '窄')
  assert.equal(roofWidthLabel(8), '中')
  assert.equal(roofWidthLabel(12), '宽')
  assert.equal(trussRoofRidge(8), 6 + 8 * 0.1, 'the ridge rises one metre per ten of span')
  assert.equal(trussRoofTop(8), trussRoofRidge(8) + 0.12, 'the cap sits 12 cm above the ridge')
})

test('a pillar carries a bridge only on its own cell at deck height', () => {
  const pillar = createModule('pillar-slim', 0, 0, 0, 'pillar')
  const bridge = { ...createModule('bridge', 0, 0, 4, 'bridge'), z: 4 }
  assert.equal(pillarSupportsBridge(pillar, bridge), true)
  const plain = { ...bridge, cfg: { ...bridge.cfg, bridge: false } }
  assert.equal(pillarSupportsBridge(pillar, plain), false, 'a tunnel run is not a bridge')
  assert.equal(pillarSupportsBridge(pillar, { ...bridge, z: 5 }), false, 'a deck one metre up is not carried')
  assert.equal(pillarSupportsBridge(pillar, { ...bridge, x: 9 }), false, 'a deck on another cell is not carried')
})

test('painting an unknown or unchanged roof is a no-op', () => {
  const state = { ...toState(emptyStation()), modules: [createModule('roof', 0, 0, 0, 'roof')] }
  assert.equal(paintRoofSurface(state, 'missing', 'floor.tile#2266cc'), state, 'an unknown id keeps the document')
  const painted = paintRoofSurface(state, state.modules[0].id, 'floor.tile#2266cc')
  assert.equal(paintRoofSurface(painted, painted.modules[0].id, 'floor.tile#2266cc'), painted, 'the same finish twice is one state')
})
