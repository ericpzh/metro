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

test('pillars draw one continuous shaft, capped only at its ends', () => {
  const concrete = new THREE.MeshStandardMaterial({ name: 'concrete' })
  const mats = new Proxy({}, { get: (target, key) => target[key] ??= new THREE.MeshStandardMaterial({ name: String(key) }) })
  const parts = (size, height) => {
    const pillar = createModule(`pillar-${size}`, 0, 0, 0, `${size}-${height}`)
    pillar.cfg.height = height
    const group = buildModule(pillar, { mats, data: { name: 't', seed: 1, cells: [], modules: [pillar], lines: [] }, trackCells: new Set(), finish: id => {
      assert.equal(id, DEFAULT_MATERIAL, 'unpainted thick supports share the station default material')
      return concrete
    }, owned: [] })
    const shafts = [], collars = []
    group.traverse((part) => {
      if (!part.isMesh) return
      if (size === 'thick' && part.geometry.type !== 'CylinderGeometry') return
      ;(part.material === mats.steel ? collars : shafts).push(part)
    })
    return { shafts, collars }
  }
  // 长 5 m and 超长 6 m are one column each, never a short pillar stacked on
  // another; a stacked 10 m shaft reads the same way.
  for (const size of ['slim', 'thick']) {
    for (const height of [2, 5, 6, 10]) {
      const { shafts, collars } = parts(size, height)
      assert.equal(shafts.length, 1, `${size} ${height} m: one finished shaft`)
      assert.equal(collars.length, 2, `${size} ${height} m: collars cap the ends only`)
      assert.ok(Math.abs(collars[0].position.z - 0.05) < 1e-9)
      assert.ok(Math.abs(collars[1].position.z - (height - 0.05)) < 1e-9)
    }
  }
  const { shafts, collars } = parts('thick', 5)
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
