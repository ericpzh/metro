import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule } from '../src/build/model.ts'
import { RoofModel } from '../src/render/models/pieces/RoofModel.ts'
import { instanceRoofPreview } from '../src/render/roofPreview.ts'
import { disposeObject } from '../src/render/models.ts'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { emptyStation } from '../src/data/reference-station.ts'

test('the real ghost system batches compatible roofs, preserves mixed roofs, and disposes on cancellation', () => {
  const material = new THREE.MeshStandardMaterial()
  const ctx = new SceneContextData(new THREE.Scene(), { finish: () => material, owns: () => true }, { steel: material }, null)
  ctx.stationData = emptyStation()
  const ghost = new GhostSystem(ctx)
  ghost.clocks = { previewRigs: [] }
  ghost.plates = { ownsTexture: () => false }
  const first = createModule('roof', 0, 0, 0, 'first')
  const second = { ...first, x: 1, id: 'second' }
  ghost.setModulePreview([first, second])
  assert.equal(ghost.previewGroup.children.length, 1)
  const mesh = ghost.previewGroup.children[0].children[0]
  assert.equal(mesh.isInstancedMesh, true)
  assert.equal(mesh.count, 2)
  let released = 0
  mesh.addEventListener('dispose', () => released++)
  ghost.setModulePreview([first, second])
  assert.equal(released, 0, 'an unchanged preview retains its instance buffer')
  ghost.setModulePreview([first, { ...second, cfg: { ...second.cfg, plateSnap: 'lower' } }])
  assert.equal(released, 1)
  assert.equal(ghost.previewGroup.children.length, 2, 'different roof shapes keep their exact independent models')
  ghost.clearModulePreview()
  assert.equal(ghost.previewGroup.visible, false)
  assert.equal(ghost.previewGroup.children.length, 0)
  material.dispose()
})

test('roof preview instances preserve every variant and rotation with one geometry per model part', () => {
  const material = new THREE.MeshStandardMaterial()
  const builder = new RoofModel({ mats: { steel: material }, finish: () => material })
  try {
    for (const type of ['roof', 'roof-shell', 'roof-truss', 'roof-tapered', 'roof-canopy']) {
      for (const rot of [0, 1, 2, 3]) {
        const first = createModule(type, -4, 3, 5, 'first', rot, 8)
        const second = { ...first, id: 'second', x: 12, y: -7, z: 10 }
        const source = builder.build(first)
        const expected = builder.build(second)
        source.updateMatrixWorld(true); expected.updateMatrixWorld(true)
        const meshes = [], expectedMeshes = []
        source.traverse(o => { if (o.isMesh) meshes.push(o) })
        expected.traverse(o => { if (o.isMesh) expectedMeshes.push(o) })
        const instances = instanceRoofPreview(source, [first, second])
        assert.equal(instances.children.length, meshes.length, type)
        for (let i = 0; i < meshes.length; i++) {
          const mesh = instances.children[i], matrix = new THREE.Matrix4()
          assert.equal(mesh.count, 2)
          assert.equal(mesh.geometry, meshes[i].geometry, 'geometry is transferred once, not cloned per tile')
          mesh.getMatrixAt(1, matrix)
          for (let j = 0; j < 16; j++) assert.ok(Math.abs(matrix.elements[j] - expectedMeshes[i].matrixWorld.elements[j]) < 1e-5, `${type}/${rot} matrix ${j}`)
        }
        let buffers = 0
        for (const mesh of instances.children) mesh.addEventListener('dispose', () => buffers++)
        disposeObject(instances)
        assert.equal(buffers, meshes.length, 'instance buffers are disposed once')
        disposeObject(expected)
      }
    }
  } finally { material.dispose() }
})

test('10,000 thin roof tiles use one preview draw with all tiles retained', () => {
  const material = new THREE.MeshStandardMaterial()
  const first = createModule('roof', 0, 0, 0, 'roof')
  const source = new RoofModel({ finish: () => material }).build(first)
  const modules = Array.from({ length: 10_000 }, (_, i) => ({ ...first, id: `roof-${i}`, x: i % 100, y: Math.floor(i / 100) }))
  const preview = instanceRoofPreview(source, modules)
  assert.equal(preview.children.length, 1)
  assert.equal(preview.children[0].count, 10_000)
  const matrix = new THREE.Matrix4()
  preview.children[0].getMatrixAt(9_999, matrix)
  assert.ok(matrix.elements[12] > 98 && matrix.elements[13] > 98)
  disposeObject(preview); material.dispose()
})
