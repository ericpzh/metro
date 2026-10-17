import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { RenderDemand } from '../src/render/renderDemand.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { StaticInstances } from '../src/render/staticInstances.ts'
import { BATCH_SOURCE_LAYER } from '../src/render/batchGeometry.ts'
import { OutdoorSurfaceModel, outdoorSurfaceGeometry, outdoorSurfaceCoarseGeometry } from '../src/render/models/pieces/OutdoorSurfaceModel.ts'
import { TreeModel } from '../src/render/models/pieces/TreeModel.ts'
import { createModule } from '../src/build/model.ts'

function tiles(count, transparent = false) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, transparent, opacity: transparent ? .35 : 1, depthWrite: !transparent })
  const modules = Array.from({ length: count }, (_, i) => createModule('sidewalk', i % 32, Math.floor(i / 32), 0, `tile-${i}`))
  const context = { data: { cells: [], modules }, mats: { outdoorSurface: material }, owned: [] }
  const roots = new THREE.Group()
  const add = module => {
    const root = new OutdoorSurfaceModel(context).build(module)
    Object.assign(root.userData, { moduleType: module.type, moduleId: module.id, levelZs: [0] })
    roots.add(root); return root
  }
  modules.forEach(add)
  return { roots, add, material }
}

for (const transparent of [false, true]) test(`static tiles retain chunk allocations and source picking (${transparent ? 'ghost' : 'opaque'})`, () => {
  const { roots, add } = tiles(1024, transparent)
  const batches = new EquipmentBatches()
  batches.sync(roots, 'first')
  assert.equal(batches.root.children.length, 4, '1024 tiles occupy four 16 m draw chunks')
  const originals = roots.children.map(root => root.children[0])
  for (const mesh of originals) assert.equal(mesh.layers.mask, 2 ** BATCH_SOURCE_LAYER)
  for (const mesh of batches.root.children) { assert.ok(mesh instanceof StaticInstances); assert.equal(mesh.count, 256) }
  const retained = batches.root.children.slice()
  batches.sync(roots, 'first')
  assert.deepEqual(batches.root.children, retained)
  const added = add(createModule('sidewalk', -1, 0, 0, 'new-chunk'))
  batches.sync(roots, 'append')
  assert.equal(batches.root.children.length, 5)
  assert.ok(retained.every(mesh => batches.root.children.includes(mesh)), 'an unrelated chunk creates no replacement buffers')
  roots.remove(added)
  batches.sync(roots, 'delete')
  assert.deepEqual(batches.root.children, retained)
  batches.setHiddenModule(roots.children[0])
  assert.equal(batches.root.children.filter(mesh => !mesh.visible).length, 1, 'pickup masks its chunk only')
  assert.equal(originals[0].layers.mask, 1, 'original picking/drawing geometry remains available during pickup')
  batches.setHiddenModule(null)
  const ray = new THREE.Raycaster(new THREE.Vector3(.5, .5, 10), new THREE.Vector3(0, 0, -1))
  ray.layers.set(BATCH_SOURCE_LAYER)
  assert.ok(ray.intersectObject(roots.children[0], true).length, 'original tile geometry remains ray-pickable')
  roots.remove(roots.children[0])
  batches.sync(roots, 'local-delete')
  assert.equal(retained.filter(mesh => batches.root.children.includes(mesh)).length, 3, 'deleting a tile replaces its chunk and retains the other three')
  assert.ok(batches.root.children.some(mesh => mesh.count === 255), 'the remaining tiles still draw in the edited chunk')
  batches.clear()
  originals.forEach(mesh => assert.equal(mesh.layers.mask, 1))
})

test('static detail switches without allocations, keeps near bounds, and disposes both representations once', () => {
  const { roots } = tiles(2)
  const batches = new EquipmentBatches()
  batches.sync(roots, 'first')
  const instance = batches.root.children[0], detailed = instance.geometry
  let sourceDisposal = 0
  roots.children[0].children[0].geometry.addEventListener('dispose', () => sourceDisposal++)
  const bounds = instance.boundingSphere.clone()
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 5000)
  camera.position.set(0, 0, 1000); camera.updateMatrixWorld()
  assert.equal(batches.updateDetail(camera, 800), true)
  const coarse = instance.geometry
  assert.notEqual(coarse, detailed)
  assert.ok(coarse.index.count < detailed.index.count / 5)
  assert.deepEqual(instance.boundingSphere, bounds)
  assert.equal(batches.updateDetail(camera, 800), false)
  batches.detailEnabled = false
  assert.equal(batches.updateDetail(camera, 800), true)
  assert.equal(instance.geometry, detailed)
  batches.detailEnabled = true
  batches.updateDetail(camera, 800)
  assert.equal(instance.geometry, coarse, 'returning to far reuses its geometry')
  camera.position.z = 2; camera.updateMatrixWorld()
  batches.updateDetail(camera, 800)
  assert.equal(instance.geometry, detailed, 'near view restores the complete original geometry')
  const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, .1, 5000)
  ortho.position.z = 100; ortho.updateMatrixWorld()
  batches.updateDetail(ortho, 800); assert.equal(instance.geometry, coarse)
  ortho.zoom = 4; ortho.updateProjectionMatrix()
  batches.updateDetail(ortho, 800); assert.equal(instance.geometry, detailed, 'orthographic zoom uses screen size too')
  let nearDisposal = 0, farDisposal = 0, instanceDisposal = 0
  detailed.addEventListener('dispose', () => nearDisposal++)
  coarse.addEventListener('dispose', () => farDisposal++)
  instance.addEventListener('dispose', () => instanceDisposal++)
  batches.clear(); batches.clear()
  assert.deepEqual([nearDisposal, farDisposal, instanceDisposal], [1, 1, 1])
  assert.equal(sourceDisposal, 0, 'batch teardown never disposes shared source geometry')
  assert.equal(outdoorSurfaceGeometry('sidewalk').index.count, 396, 'shared source was not altered')
})

test('ghost instances sort back to front and keep settled matrix buffers untouched', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial({ transparent: true })
  const matrices = [new THREE.Matrix4().makeTranslation(0, 0, -2), new THREE.Matrix4().makeTranslation(0, 0, -8)]
  const mesh = new StaticInstances(geometry, material, matrices)
  const camera = new THREE.PerspectiveCamera(); camera.updateMatrixWorld()
  mesh.updateDetail(camera, 800)
  const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix)
  assert.equal(matrix.elements[14], -8)
  const version = mesh.instanceMatrix.version
  mesh.updateDetail(camera, 800)
  assert.equal(mesh.instanceMatrix.version, version)
  camera.rotation.y = Math.PI; camera.updateMatrixWorld()
  mesh.updateDetail(camera, 800)
  mesh.getMatrixAt(0, matrix); assert.equal(matrix.elements[14], -2)
  mesh.dispose(); geometry.dispose(); material.dispose()
})

test('distant tile envelopes and tree leaf UV cards preserve the authored geometry bounds', () => {
  for (const type of ['sidewalk', 'lawn']) {
    const detailed = outdoorSurfaceGeometry(type), coarse = outdoorSurfaceCoarseGeometry(type)
    detailed.computeBoundingBox(); coarse.computeBoundingBox()
    assert.ok(detailed.boundingBox.min.distanceTo(coarse.boundingBox.min) < 1e-6)
    assert.ok(detailed.boundingBox.max.distanceTo(coarse.boundingBox.max) < 1e-6)
  }
  const root = new TreeModel({ mats: {}, owned: [], data: { modules: [], cells: [] } }).build(createModule('tree', 0, 0, 0, 'tree'))
  for (const mesh of root.children) {
    const coarse = mesh.userData.staticDetailGeometry
    assert.ok(coarse.index.count < mesh.geometry.index.count * .6)
    assert.equal(coarse.getAttribute('uv').count, coarse.getAttribute('position').count)
    for (const index of coarse.index.array) assert.ok(index < coarse.getAttribute('position').count)
  }
  const crown = root.children[1], coarse = crown.userData.staticDetailGeometry
  crown.geometry.computeBoundingBox(); coarse.computeBoundingBox()
  assert.deepEqual(coarse.boundingBox, crown.geometry.boundingBox, 'keep the canopy extrema in every direction')
  for (const mesh of root.children) {
    const far = mesh.userData.staticFarGeometry
    assert.ok(far.index.count < mesh.userData.staticDetailGeometry.index.count / 3)
    assert.equal(far.getAttribute('uv').count, far.getAttribute('position').count)
    assert.ok([...far.getAttribute('uv').array].every(v=>Number.isFinite(v)&&v>=0&&v<=1))
  }
  const far = crown.userData.staticFarGeometry; far.computeBoundingBox()
  const lowTriangles = root.children.reduce((sum, mesh) => sum + mesh.userData.staticFarGeometry.index.count / 3, 0)
  assert.ok(lowTriangles <= 400, `far tree triangle budget: ${lowTriangles}`)
  const trunk = root.children[0].userData.staticFarGeometry
  trunk.computeBoundingBox()
  assert.ok(Math.abs(trunk.boundingBox.min.z) < 1e-5, 'Low trunk reaches the ground')
  assert.ok(trunk.boundingBox.max.z > crown.geometry.boundingBox.min.z, 'Low trunk reaches the canopy')
  // All trunk rings must form a continuous surface, including below the canopy.
  const edges = new Map()
  for (let i = 0; i < trunk.index.count; i += 3) {
    const face = Array.from(trunk.index.array.slice(i, i + 3))
    for (const a of face) {
      if (!edges.has(a)) edges.set(a, new Set())
      for (const b of face) edges.get(a).add(b)
    }
  }
  const reached = new Set([0]), queue = [0]
  for (let i = 0; i < queue.length; i++) for (const next of edges.get(queue[i])) {
    if (!reached.has(next)) { reached.add(next); queue.push(next) }
  }
  assert.equal(reached.size, trunk.attributes.position.count, 'no disconnected trunk fragments')
  assert.ok(far.boundingBox.min.distanceTo(crown.geometry.boundingBox.min)<1e-6)
  assert.ok(far.boundingBox.max.distanceTo(crown.geometry.boundingBox.max)<1e-6)
})

test('tree third LoD restores both earlier geometries and disposes all three once',()=>{
  const full=new THREE.BoxGeometry(), middle=new THREE.TetrahedronGeometry(), far=new THREE.PlaneGeometry()
  const mat=new THREE.MeshBasicMaterial(), mesh=new StaticInstances(full,mat,[new THREE.Matrix4()],middle,4.5,45,far,18)
  const camera=new THREE.PerspectiveCamera(60,1,.1,10000)
  camera.position.z=500;camera.updateMatrixWorld();mesh.updateDetail(camera,800)
  const third=mesh.geometry;assert.equal(third.attributes.position.count,far.attributes.position.count)
  mesh.updateDetail(camera,800,false);const second=mesh.geometry;assert.notEqual(second,third)
  camera.position.z=2;camera.updateMatrixWorld();mesh.updateDetail(camera,800);const first=mesh.geometry
  assert.notEqual(first,second);assert.notEqual(first,third)
  const count=[0,0,0];[first,second,third].forEach((g,i)=>g.addEventListener('dispose',()=>count[i]++))
  mesh.dispose();assert.deepEqual(count,[1,1,1]);full.dispose();middle.dispose();far.dispose();mat.dispose()
})

test('transparent sorting uses the transformed surface centre, including rotated off-centre foliage', () => {
  const geometry = new THREE.BoxGeometry(); geometry.translate(10, 0, 0)
  const material = new THREE.MeshBasicMaterial({ transparent: true })
  const mesh = new StaticInstances(geometry, material, [new THREE.Matrix4(), new THREE.Matrix4().makeRotationZ(Math.PI)])
  const camera = new THREE.PerspectiveCamera(); camera.position.set(30, 0, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
  mesh.updateDetail(camera, 800)
  const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix)
  assert.equal(matrix.elements[0], -1, 'the rotated leaf centre is further away even though both tree origins coincide')
  mesh.dispose(); geometry.dispose(); material.dispose()
})

test('paused frame cache wakes for camera, projections, edits and animations', () => {
  const demand = new RenderDemand(), matrix = new THREE.Matrix4().elements, projection = matrix.slice()
  assert.equal(demand.needsFrame(matrix, projection, false), true)
  assert.equal(demand.needsFrame(matrix, projection, false), false)
  demand.invalidate(); assert.equal(demand.needsFrame(matrix, projection, false), true)
  matrix[12] = 1; assert.equal(demand.needsFrame(matrix, projection, false), true)
  projection[0] = 2; assert.equal(demand.needsFrame(matrix, projection, false), true)
  assert.equal(demand.needsFrame(matrix, projection, true), true)
  assert.equal(demand.needsFrame(matrix, projection, false), false)
  demand.continuous = true
  assert.equal(demand.needsFrame(matrix, projection, false), true)
  demand.continuous = false
  assert.equal(demand.needsFrame(matrix, projection, false), false)
})

test('scene mutation entry points invalidate the retained framebuffer', () => {
  const source = readFileSync(new URL('../src/render/scene/SceneRenderer.ts', import.meta.url), 'utf8').replaceAll('\r', '')
  const mutations = [...source.matchAll(/^  ((?:set\w+|resize|followPassenger|clearFaceGhost))\([\s\S]*?\)\s*:\s*void \{\n([^\n]*)/gm)]
  assert.ok(mutations.length > 35)
  for (const [, name, first] of mutations) {
    assert.match(first, /this.requestRender\(\)/, name)
  }
  assert.match(source, /if \(this.plates.updateAdScreens\(now\)\) this.requestRender\(\)/)
  assert.match(source, /addEventListener\('webglcontextrestored', this.restoreFrame\)/)
  assert.match(source, /removeEventListener\('webglcontextrestored', this.restoreFrame\)/)
})
