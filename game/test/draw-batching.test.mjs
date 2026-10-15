import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { bakedGeometry, BATCH_SOURCE_LAYER } from '../src/render/batchGeometry.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { PanelAtlas, atlasUV } from '../src/render/panelAtlas.ts'
import { batchStaticParts } from '../src/render/batchStaticModule.ts'
import { batchTrainDoors, batchTrainTransparent } from '../src/render/trainBatches.ts'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject, setDoorsSides } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { passengerEligible } from '../src/render/passengerEligibility.ts'
import { STOCK_CLASSES } from '../src/sim/stock.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'

function canvas() {
  const node = { width: 0, height: 0 }
  const { g, ops } = stubCanvas(); g.canvas = node
  node.getContext = () => g; node.ops = ops
  return node
}
function surfaces(root) {
  const out = []
  root.traverseVisible(o => { if (o.isMesh && o.layers.isEnabled(0)) out.push(o) })
  return out
}
function matrixClose(a, b) { a.elements.forEach((v, i) => assert.ok(Math.abs(v - b.elements[i]) < 1e-5, `matrix ${i}`)) }

function renderedTriangles(root) {
  let count = 0
  root.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.layers.isEnabled(0)) return
    if (mesh.isBatchedMesh) for (let i = 0; i < mesh.instanceCount; i++) count += mesh.getGeometryRangeAt(mesh.getGeometryIdAt(i)).count / 3
    else count += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1)
  })
  return count
}

test('profiling preserves reviewed passenger pools across legacy and explicit age metadata', () => {
  assert.equal(passengerEligible({ bag: false, hair: 'short' }, 'child'), true)
  assert.equal(passengerEligible({ bag: true, hair: 'short' }, 'child'), false)
  assert.equal(passengerEligible({ bag: false, hair: 'bald' }, 'child'), false)
  assert.equal(passengerEligible({ bag: true, hair: 'bald' }, 'adult'), true)
  assert.equal(passengerEligible({ bag: false, hair: 'short', adultEligible: false }, 'adult'), false)
  assert.equal(passengerEligible({ bag: true, hair: 'short', childEligible: true }, 'child'), true)
})

test('reflection baking retains FrontSide ray hits and winding for mirrored seats', () => {
  const source = new THREE.BoxGeometry(2, 3, 4)
  const transform = new THREE.Matrix4().makeScale(1, -1, 1)
  const geometry = bakedGeometry(source, transform)
  const original = new THREE.Mesh(source, new THREE.MeshBasicMaterial()); original.scale.y = -1
  const batch = new THREE.Mesh(geometry, original.material)
  original.updateMatrixWorld(); batch.updateMatrixWorld()
  const ray = new THREE.Raycaster(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 1, 0))
  assert.equal(ray.intersectObject(original)[0].distance, ray.intersectObject(batch)[0].distance, 'outside face remains reachable rather than becoming back-facing')
  assert.equal(geometry.getAttribute('position').count, source.index.count, 'all triangles survive')
  source.dispose(); geometry.dispose(); original.material.dispose()
})

test('real train batches preserve both door banks, moving glass, and train-local transforms', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  let mats, root
  try {
    mats = createModelMaterials()
    root = buildTrain(mats, { x: 10, y: 20, z: -15.5, cars: 4, stock: 'B', doorsOpen: false, colour: '#336699', dirSign: 1, yaw: Math.PI / 2 })
    const before = surfaces(root).length
    const leaves = root.userData.doors.slice()
    batchStaticParts(root, new Set(leaves), true)
    batchTrainDoors(root); batchTrainTransparent(root)
    assert.ok(surfaces(root).length < before / 3, 'most repeated train parts no longer submit separate meshes')
    assert.deepEqual(root.userData.doors, leaves, 'door rigs keep their original references')
    assert.ok(root.userData.trainDoorBatches.length >= 2, 'frames and kick plates both instance')
    const glass = root.userData.trainGlassBatches.find(b => b.sources.some(s => s.name === 'train-door-window'))
    assert.ok(glass); assert.equal(glass.mesh.sortObjects, true, 'transparent surfaces keep depth sorting')
    for (const [plus, minus] of [[1, 0], [0, 1], [0.3, 0.8], [0, 0]]) {
      setDoorsSides(root, plus, minus)
      root.updateWorldMatrix(true, true)
      const inverse = root.matrixWorld.clone().invert(), matrix = new THREE.Matrix4()
      for (const batch of root.userData.trainDoorBatches) for (let i = 0; i < batch.sources.length; i++) {
        batch.mesh.getMatrixAt(i, matrix)
        matrixClose(matrix, inverse.clone().multiply(batch.sources[i].matrixWorld))
      }
      for (let i = 0; i < glass.sources.length; i++) {
        glass.mesh.getMatrixAt(i, matrix)
        matrixClose(matrix, inverse.clone().multiply(glass.sources[i].matrixWorld))
      }
      for (const leaf of leaves) assert.equal(leaf.position.x, leaf.userData.closedX + leaf.userData.openSign * leaf.userData.travel * (leaf.userData.side >= 0 ? plus : minus))
    }
    let released = 0
    for (const mesh of surfaces(root)) if (mesh.isBatchedMesh || mesh.isInstancedMesh) mesh.addEventListener('dispose', () => released++)
    const expected = surfaces(root).filter(m => m.isBatchedMesh || m.isInstancedMesh).length
    disposeObject(root); root = null
    assert.equal(released, expected, 'instance buffers and batched matrix textures are released with the consist')
  } finally { if (root) disposeObject(root); if (mats) disposeModelMaterials(mats); globalThis.document = previous }
})

test('all four stock classes retain geometry and door poses in all track rotations', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  let mats
  try {
    mats = createModelMaterials()
    for (const stock of STOCK_CLASSES) for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const root = buildTrain(mats, { x: -50, y: 20, z: -7.5, cars: 2, stock, doorsOpen: false, colour: '#336699', dirSign: -1, yaw })
      try {
        const triangles = renderedTriangles(root), before = new THREE.Box3().setFromObject(root)
        batchStaticParts(root, new Set(root.userData.doors), true); batchTrainDoors(root); batchTrainTransparent(root)
        assert.equal(renderedTriangles(root), triangles, `${stock}/${yaw}: fewer draws must not remove or duplicate triangles`)
        const after = new THREE.Box3().setFromObject(root)
        assert.ok(before.min.distanceTo(after.min) < 1e-5 && before.max.distanceTo(after.max) < 1e-5, 'rounded body/cabs stay in their original world-space envelope')
        for (const [plus, minus] of [[0.25, 0.75], [1, 0], [0, 1]]) {
          setDoorsSides(root, plus, minus); root.updateWorldMatrix(true, true)
          const inverse = root.matrixWorld.clone().invert(), matrix = new THREE.Matrix4()
          for (const batch of [...root.userData.trainDoorBatches, ...root.userData.trainGlassBatches]) for (let i = 0; i < batch.sources.length; i++) {
            batch.mesh.getMatrixAt(i, matrix); matrixClose(matrix, inverse.clone().multiply(batch.sources[i].matrixWorld))
          }
        }
      } finally { disposeObject(root); root.userData.ownedMats.forEach(m => m.dispose()) }
    }
  } finally { if (mats) disposeModelMaterials(mats); globalThis.document = previous }
})

test('actual train system holds paused/hidden door buffers and evicts their GPU resources', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  let mats, trains
  try {
    mats = createModelMaterials()
    const ctx = { scene: new THREE.Scene(), modelMats: mats, levelBase: 0, lastStateTime: 1000, stateIntervalMs: 1000 }
    trains = new TrainSystem(ctx); trains.level = { applyGroupLevel(root) { root.visible = true } }
    const pose = new Float32Array([0, 0, -15.5, 2, 1, 1, 0x336699, 1, 0, 1])
    trains.setTrains(pose); const root = trains.trainGroup.children[0]
    trains.updateTrains(2000, 1)
    const attributes = root.userData.trainDoorBatches.map(b => b.mesh.instanceMatrix), versions = attributes.map(a => a.version)
    const poses = attributes.map(a => a.array.slice())
    trains.setPlaying(false); trains.updateTrains(4000, 100)
    assert.deepEqual(attributes.map(a => a.version), versions, 'paused doors make no buffer uploads')
    attributes.forEach((a, i) => assert.deepEqual(a.array, poses[i]))
    root.visible = false; trains.setPlaying(true); trains.updateTrains(5000, 1)
    assert.deepEqual(attributes.map(a => a.version), versions, 'hidden train visuals hold their buffers')
    root.visible = true; trains.updateTrains(6000, 1)
    assert.ok(attributes.some((a, i) => a.version > versions[i]), 'visible doors resume towards the commanded bank')
    let released = 0, expected = 0
    root.traverse(o => { if (o.isInstancedMesh || o.isBatchedMesh) { expected++; o.addEventListener('dispose', () => released++) } })
    for (let i = 0; i < 5; i++) trains.setTrains(new Float32Array())
    assert.equal(root.visible, false)
    trains.setTrains(pose)
    assert.equal(trains.trainGroup.children[0], root, 'the next service reuses the same consist and GPU allocations')
    for (let index = 0; index < 9; index++) {
      const other = pose.slice(); other[6] += index + 1
      trains.setTrains(other)
    }
    assert.equal(trains.trainGroup.children.length, 9, 'one active train plus eight dormant configurations bounds the cache')
    assert.equal(released, expected, 'evicting the least recently used consist releases every instance buffer and batch texture')
    trains.setTrains(pose); trains.setDrawBatching(false)
    assert.equal(trains.trainGroup.children[0].userData.trainDoorBatches, undefined, 'profiling ablation creates the original door rendering')
    trains.setDrawBatching(true); assert.ok(trains.trainGroup.children[0].userData.trainDoorBatches.length)
  } finally { trains?.dispose(); if (mats) disposeModelMaterials(mats); globalThis.document = previous }
})

function equipment(x, id, geometry, material, type = 'bench') {
  const group = new THREE.Group(); group.position.x = x
  group.userData = { moduleId: id, moduleType: type, levelZs: [0] }
  group.add(new THREE.Mesh(geometry, material)); return group
}

test('equipment batches retain original picking IDs and unaffected spatial GPU batches', () => {
  const modules = new THREE.Group(), material = new THREE.MeshBasicMaterial()
  for (const [x, id] of [[0, 'a'], [3, 'b'], [32, 'c'], [35, 'd']]) modules.add(equipment(x, id, new THREE.BoxGeometry(), material))
  const batches = new EquipmentBatches()
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 2, 'two 16 m areas get independent draws')
    assert.ok(batches.root.children.every(m => m.isInstancedMesh), 'identical models share their vertex buffer')
    const far = batches.root.children.find(m => m.boundingBox.min.x > 30)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 1, 0)); ray.layers.enable(BATCH_SOURCE_LAYER)
    assert.equal(ray.intersectObjects(modules.children, true)[0].object.parent.userData.moduleId, 'a', 'picking still resolves the source module')
    modules.children[0].position.x = 1
    batches.sync(modules)
    assert.ok(batches.root.children.includes(far), 'editing a near bucket preserves the far allocation')
    modules.children[2].visible = modules.children[3].visible = false
    batches.sync(modules)
    assert.equal(batches.root.children.length, 1, 'hidden equipment submits no batch')
    modules.children[2].visible = modules.children[3].visible = true
    batches.sync(modules); assert.equal(batches.root.children.length, 2, 'showing a storey restores its equipment')
  } finally { batches.clear(); modules.traverse(o => { if (o.isMesh) o.geometry.dispose() }); material.dispose() }
})

test('equipment merge retains mirrored geometry, material boundaries and preview visibility', () => {
  const modules = new THREE.Group(), material = new THREE.MeshBasicMaterial(), batches = new EquipmentBatches()
  modules.add(equipment(0, 'a', new THREE.BoxGeometry(), material, 'fence'))
  modules.add(equipment(2, 'b', new THREE.BoxGeometry(2, 1, 1), material, 'fence'))
  modules.children[1].scale.y = -1
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 1)
    assert.equal(batches.root.children[0].geometry.getAttribute('position').count, 72, '24 box triangles retain their transformed winding')
    modules.children.forEach(g => g.visible = false); batches.sync(modules)
    assert.equal(batches.root.children.length, 0, 'committed fences disappear while the drag preview owns their drawing')
    modules.children.forEach(g => g.visible = true); batches.sync(modules)
    material.transparent = true; material.opacity = 0.35; batches.sync(modules)
    assert.equal(batches.root.children[0].isBatchedMesh, true, 'ghosted equipment keeps per-surface sorting')
  } finally { batches.clear(); modules.traverse(o => { if (o.isMesh) o.geometry.dispose() }); material.dispose() }
})

test('panel atlas retains full resolution, correct UV orientation and live screen repaints', () => {
  const previous = globalThis.document; globalThis.document = { createElement: canvas }
  const atlas = new PanelAtlas(128), a = canvas(), b = canvas()
  a.width = b.width = 32; a.height = b.height = 16
  const textures = [a, b].map(c => new THREE.CanvasTexture(c))
  const materials = textures.map(map => new THREE.MeshBasicMaterial({ map }))
  try {
    const regions = materials.map(m => atlas.resolve(m))
    assert.equal(regions[0].material, regions[1].material, 'different label textures can share one material')
    assert.equal(regions[0].w * 128, 32, 'label resolution stays 32 pixels wide')
    const geometry = new THREE.PlaneGeometry(); atlasUV(geometry, regions[0])
    const uv = geometry.getAttribute('uv')
    assert.equal(uv.getY(0), regions[0].v + regions[0].h, 'top of the label stays at the top of the atlas slot')
    const page = regions[0].material.map
    const initialVersion = page.version
    atlas.update(); assert.equal(page.version, initialVersion, 'unchanged screens do not re-upload')
    textures[0].needsUpdate = true; atlas.update()
    assert.equal(page.version, initialVersion + 1, 'a countdown repaint reaches the page')
    assert.equal(atlas.resolve(materials[0]).u, regions[0].u, 'repaint does not move a panel UV region')
    atlas.retain(new Set([textures[1]]))
    const version = page.version; textures[0].needsUpdate = true; atlas.update()
    assert.equal(page.version, version, 'deleted screens stop causing atlas uploads')
    const replacement = new THREE.CanvasTexture(a), replacementMaterial = new THREE.MeshBasicMaterial({ map: replacement })
    assert.equal(atlas.resolve(replacementMaterial).u, regions[0].u, 'deleted panel slots recycle instead of growing pages across undo/rebuilds')
    replacement.dispose(); replacementMaterial.dispose()
    geometry.dispose()
  } finally { atlas.dispose(); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); globalThis.document = previous }
})

test('equipment batching leaves door, wing, clock and cabin descendants live', () => {
  const modules = new THREE.Group(), material = new THREE.MeshBasicMaterial(), batches = new EquipmentBatches()
  const root = equipment(0, 'gate', new THREE.BoxGeometry(), material, 'gate')
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  const wing = new THREE.Group(), moving = new THREE.Mesh(new THREE.BoxGeometry(), material)
  wing.add(moving); root.add(wing); root.userData.wing = wing
  const hand = new THREE.Group(), arm = new THREE.Mesh(new THREE.BoxGeometry(), material)
  hand.add(arm); root.add(hand); root.userData.clockRig = { hour: [hand], minute: [] }
  modules.add(root)
  try {
    batches.sync(modules)
    assert.equal(batches.root.children.length, 1, 'static cabinet parts can share a draw')
    assert.equal(moving.layers.mask, 1); assert.equal(arm.layers.mask, 1, 'animated descendants keep their own draw')
    wing.scale.x = 0.1; hand.rotation.y = 1
    assert.equal(moving.parent, wing); assert.equal(arm.parent, hand, 'the actual pivots still own the visible surfaces')
  } finally { batches.clear(); modules.traverse(o => { if (o.isMesh) o.geometry.dispose() }); material.dispose() }
})
