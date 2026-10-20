import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { drawModelText } from '../src/render/modelLabels.ts'
import { buildModule } from '../src/render/models.ts'
import { createModule } from '../src/build/model.ts'
import { DEFAULT_MATERIAL, finishDef } from '../src/sim/finishes.ts'
import { DEFAULT_ROOF_FINISH } from '../src/sim/structures.ts'
import { finishMaterialProperties, obsidianPixelAt, seamlessTextureOffsets } from '../src/render/materials.ts'

test('model labels shrink only when their actual ink exceeds the allotted width', () => {
  const calls = []
  const g = {
    font: '30px sans-serif',
    save: () => calls.push('save'), restore: () => calls.push('restore'),
    measureText: () => ({ width: 120, actualBoundingBoxLeft: 5, actualBoundingBoxRight: 125 }),
    fillText: (...args) => calls.push(['ink', g.font, ...args]),
  }
  drawModelText(g, '站名', 10, 20, 60)
  assert.deepEqual(calls, ['save', ['ink', '13.846153846153847px sans-serif', '站名', 10, 20], 'restore'], '130 px of visible ink fits a 60 px plate')
  g.font = '30px sans-serif'; calls.length = 0; g.measureText = () => ({ width: 50 })
  drawModelText(g, '短', 0, 0, 60)
  assert.equal(calls[1][1], '30px sans-serif', 'short ink retains the authored type size')
})

test('thick pillars are finished round shafts, recessed beneath steel collars', () => {
  const pillar = createModule('pillar-thick', 0, 0, 0, 'round')
  const concrete = new THREE.MeshStandardMaterial({ name: 'concrete' })
  const mats = new Proxy({}, { get: (target, key) => target[key] ??= new THREE.MeshStandardMaterial({ name: String(key) }) })
  const group = buildModule(pillar, { mats, data: { name: 't', seed: 1, cells: [], modules: [pillar], lines: [] }, trackCells: new Set(), finish: id => {
    assert.equal(id, DEFAULT_MATERIAL, 'unpainted thick supports share the station default material')
    return concrete
  }, owned: [] })
  const shafts = [], collars = []
  group.traverse((part) => {
    if (!part.isMesh || part.geometry.type !== 'CylinderGeometry') return
    ;(part.material === concrete ? shafts : collars).push(part)
  })
  assert.equal(shafts.length, 1)
  assert.equal(collars.length, 3, 'a five-metre column has collars at both ends and its mid-joint')
  assert.equal(shafts[0].geometry.parameters.radialSegments, 48, 'the thick support is round rather than a square post')
  assert.ok(shafts[0].geometry.attributes.uv.array.some(v => v > 1), 'shaft UVs repeat in real metres around and up the column')
  assert.ok(shafts[0].geometry.parameters.radiusTop < collars[0].geometry.parameters.radiusTop, 'the finished shaft recesses behind each collar')
  concrete.dispose(); for (const m of Object.values(mats)) m.dispose()
})

test('material tuning keeps seams and periodic stone deterministic', () => {
  assert.equal(DEFAULT_ROOF_FINISH, DEFAULT_MATERIAL)
  assert.deepEqual(seamlessTextureOffsets(256), [
    [-256, -256], [-256, 0], [-256, 256], [0, -256], [0, 0], [0, 256], [256, -256], [256, 0], [256, 256],
  ], 'granite redraws each edge-crossing crystal in all neighbouring tiles')
  const pixel = (x, y) => obsidianPixelAt(x, y).map(Math.round)
  assert.deepEqual(pixel(17, 31), pixel(17 + 256, 31), 'the x edge repeats exactly in the canvas pixels')
  assert.deepEqual(pixel(17, 31), pixel(17, 31 + 256), 'the y edge repeats exactly in the canvas pixels')
  const obsidian = finishMaterialProperties(finishDef('floor.obsidian'))
  const steel = finishMaterialProperties(finishDef('ceil.steel'))
  const hardwood = finishMaterialProperties(finishDef('floor.hardwood'))
  assert.deepEqual(obsidian, { roughness: 0.24, metalness: 0.02 })
  assert.deepEqual(steel, { roughness: 0.55, metalness: 0.4 })
  assert.deepEqual(hardwood, { roughness: 0.78, metalness: 0.02 })
})
