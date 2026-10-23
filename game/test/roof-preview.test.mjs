import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule } from '../src/build/model.ts'
import { RoofModel } from '../src/render/models/pieces/RoofModel.ts'
import { instanceRoofPreview } from '../src/render/roofPreview.ts'
import { disposeObject } from '../src/render/models.ts'
import { GhostSystem } from '../src/render/scene/systems/GhostSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { rampFillKeys } from '../src/sim/openings.ts'
import { packKey } from '../src/sim/types.ts'
import { meshChunk } from '../src/render/chunkMesher.ts'
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
  ghost.setModulePreview(first)
  assert.equal(ghost.previewGroup.children[0].children[0].isInstancedMesh, true, 'hover prepares the same shader path as the drag')
  const hoverMaterial = ghost.previewGroup.children[0].children[0].material
  let materialReleased = 0
  hoverMaterial.addEventListener('dispose', () => materialReleased++)
  ghost.setModulePreview([first, second])
  assert.equal(ghost.previewGroup.children.length, 1)
  const mesh = ghost.previewGroup.children[0].children[0]
  assert.equal(mesh.isInstancedMesh, true)
  assert.equal(mesh.count, 2)
  assert.equal(mesh.material, hoverMaterial, 'movement keeps the shader owner from the hover')
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
  assert.equal(materialReleased, 0, 'cancellation retains the bounded material cache')
  ghost.dispose()
  assert.equal(materialReleased, 1, 'scene teardown releases the cached shader owner')
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
        assert.equal(instances.children.length, meshes.length * 2, type)
        for (let i = 0; i < meshes.length; i++) {
          const mesh = instances.children[i * 2 + 1], matrix = new THREE.Matrix4()
          assert.equal(mesh.count, 1)
          assert.equal(mesh.geometry, meshes[i].geometry, 'geometry is transferred once, not cloned per tile')
          mesh.getMatrixAt(0, matrix)
          for (let j = 0; j < 16; j++) assert.ok(Math.abs(matrix.elements[j] - expectedMeshes[i].matrixWorld.elements[j]) < 1e-5, `${type}/${rot} matrix ${j}`)
        }
        let buffers = 0
        for (const mesh of instances.children) mesh.addEventListener('dispose', () => buffers++)
        disposeObject(instances)
        assert.equal(buffers, meshes.length * 2, 'instance buffers are disposed once')
        disposeObject(expected)
      }
    }
  } finally { material.dispose() }
})

test('10,000 thin roof tiles use bounded spatial draws with all tiles retained', () => {
  const material = new THREE.MeshStandardMaterial()
  const first = createModule('roof', 0, 0, 0, 'roof')
  const source = new RoofModel({ finish: () => material }).build(first)
  const modules = Array.from({ length: 10_000 }, (_, i) => ({ ...first, id: `roof-${i}`, x: i % 100, y: Math.floor(i / 100) }))
  const preview = instanceRoofPreview(source, modules)
  assert.ok(preview.children.length <= 64)
  assert.equal(preview.children.reduce((sum, mesh) => sum + mesh.count, 0), 10_000)
  assert.equal(new Set(preview.children.map(mesh => mesh.geometry)).size, 1)
  const matrix = new THREE.Matrix4()
  const last = preview.children.at(-1)
  last.getMatrixAt(last.count - 1, matrix)
  assert.ok(matrix.elements[12] > 98 && matrix.elements[13] > 98)
  let geometryDisposals = 0, buffers = 0
  preview.children[0].geometry.addEventListener('dispose', () => geometryDisposals++)
  for (const mesh of preview.children) mesh.addEventListener('dispose', () => buffers++)
  disposeObject(preview)
  assert.equal(geometryDisposals, 1, 'spatial buckets share a single geometry owner')
  assert.equal(buffers, preview.children.length, 'every spatial instance buffer is released')
  material.dispose()
})


test('sparse block ghosts visit candidates, preserve exact mesher output and restore station occupancy', () => {
  class CountedSet extends Set {
    reads = 0
    has(key) { this.reads++; return super.has(key) }
  }
  const cells = Array.from({ length: 32 }, (_, i) => [-257 + i * 16, -17, 1])
  const solid = new CountedSet([packKey(-258, -17, 1)])
  const initial = [...solid]
  const sys = new GhostSystem({ scene: new THREE.Scene(), solid, slopeCuts: new Map(), finishes: new Map() })
  sys.setGhost([...cells, cells[0]], 'add')
  assert.ok(solid.reads < 6000, '32 sparse candidates must not scan 8,192 chunk cells: ' + solid.reads)
  assert.deepEqual([...solid], initial, 'temporary occupancy is removed after meshing')
  const expectedSolid = new Set([...initial, ...cells.map(c => packKey(...c))])
  const emit = new Set(cells.map(c => packKey(...c)))
  const expected = cells.flatMap(([x,y,z]) => meshChunk(expectedSolid, new Map(), Math.floor(x/16)*16, Math.floor(y/16)*16, z, z, emit).parts)
  assert.equal(sys.ghostGroup.children.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    const geo = sys.ghostGroup.children[i].geometry
    assert.deepEqual(geo.getAttribute('position').array, expected[i].positions)
    assert.deepEqual(geo.getAttribute('normal').array, expected[i].normals)
    assert.deepEqual(geo.getIndex().array, expected[i].indices)
  }
  sys.clearShapeGhost()
})


test('candidate-only ghost meshing retains ramp filling above pending cells exactly once', () => {
  const solid = new Set(), finishes = new Map()
  const cuts = new Map([[packKey(-1, 0, 2), { axis: 'x', lo: .2, hi: .8 }]])
  const sys = new GhostSystem({ scene: new THREE.Scene(), solid, slopeCuts: cuts, finishes })
  sys.setGhost([[-1, 0, 1], [-1, 0, 1]], 'add')
  assert.equal(solid.size, 0)
  const pending = new Set([packKey(-1, 0, 1)]), fills = rampFillKeys(pending, cuts)
  const emit = new Set([...pending, ...fills])
  const expected = [1, 2].flatMap(z => meshChunk(pending, finishes, -16, 0, z, z, emit, undefined, undefined, undefined, cuts, fills).parts)
  assert.equal(sys.ghostGroup.children.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    const geo = sys.ghostGroup.children[i].geometry
    assert.deepEqual(geo.getAttribute('position').array, expected[i].positions)
    assert.deepEqual(geo.getIndex().array, expected[i].indices)
  }
  sys.clearShapeGhost()
})
