import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildModule, createModelMaterials, disposeModelMaterials, disposeObject, rollEscalator, setDoors } from '../src/render/models.ts'
import { createModule } from '../src/build/model.ts'
import { geometryDetailReady } from '../src/render/geometryDetail.ts'
import { modelDetailGeometry, omitModelDetail, setModelDetail } from '../src/render/modelDetail.ts'
import { batchStaticModule } from '../src/render/batchStaticModule.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { SourceGeometryDetail } from '../src/render/sourceGeometryDetail.ts'

await geometryDetailReady
const triangles = geometry => (geometry.index?.count ?? geometry.attributes.position.count) / 3
function totals(root, low = false) {
  let count = 0
  root.traverseVisible(mesh => {
    if (mesh.isMesh) count += triangles(low ? modelDetailGeometry(mesh) ?? mesh.geometry : mesh.geometry) * (mesh.isInstancedMesh ? mesh.count : 1)
  })
  return count
}
function fixture(id, run) {
  const previous = globalThis.document
  const canvas = () => ({ width: 0, height: 0, getContext: () => new Proxy({}, {
    get: (o, k) => o[k] ?? (k === 'measureText' ? text => ({ width: String(text ?? '').length * 8 }) : () => undefined),
    set: (o, k, v) => (o[k] = v, true),
  }) })
  globalThis.document = { createElement: canvas }
  const mats = createModelMaterials(), mod = createModule(id, 4, 4, 0, id)
  const data = { name: 'Test', seed: 1, cells: [], modules: [mod], lines: [] }
  const ctx = { mats, data, trackCells: new Set(), finish: () => mats.steel, ownedMats: [], preview: false }
  let root
  try {
    root = buildModule(mod, ctx)
    root.userData.moduleType = mod.type; root.userData.moduleId = mod.id; root.userData.levelZs = [0]
    return run(root, mod)
  } finally {
    if (root) disposeObject(root)
    for (const mat of ctx.ownedMats) mat.dispose()
    disposeModelMaterials(mats)
    globalThis.document = previous
  }
}

const budgets = [
  ...['dark-tall', 'white-tall', 'white-short', 'wire', 'cooler', 'cooler-dark'].map(v => [`shelf-${v}`, .1]),
  ['cubicle', .05], ['sink', .1], ['cctv', .1], ['cctv-ptz', .1], ['cctv-dome', .1],
  ['electrical-cabinet', .05], ['ac-unit', .1], ['tactile-warning', .05], ['bridge', .15],
  ['escalator', .2], ['walkway', .2], ['lift', .4], ['stair-block', .75],
  ...['straight', 'leftForward', 'centerForward', 'rightForward', 'left90', 'right90', 'left180', 'right180'].map(v => [`stair-${v}`, .5]),
]
for (const [id, ratio] of budgets) test(`${id} meets its authored Low triangle budget before and after local batching`, () => fixture(id, (root, mod) => {
  const full = totals(root), low = totals(root, true)
  assert.ok(full > 0 && low > 0)
  assert.ok(low <= full * ratio, `${id}: ${low}/${full} triangles`)
  batchStaticModule(root, mod.type)
  assert.equal(totals(root), full, 'full model is geometrically unchanged')
  assert.ok(totals(root, true) <= full * ratio, 'local batching preserves the authored approximation')
}))

test('shelf Low removes every product instance but keeps exact stock picks and GPU matrices', () => fixture('shelf-cooler', root => {
  const stock = root.children.find(m => m.name === 'stock-bottles')
  root.updateMatrixWorld(true)
  const matrix = new THREE.Matrix4(); stock.getMatrixAt(0, matrix)
  const centre = new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(stock.matrixWorld)
  const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, -2, 0)), new THREE.Vector3(0, 1, 0))
  const before = ray.intersectObject(stock).map(hit => [hit.instanceId, hit.distance])
  assert.ok(before.length)
  const geometry = stock.geometry, matrices = stock.instanceMatrix, detail = new SourceGeometryDetail()
  try {
    detail.apply(root, true)
    assert.equal(triangles(stock.geometry), 0)
    assert.equal(stock.instanceMatrix, matrices)
    assert.deepEqual(ray.intersectObject(stock).map(hit => [hit.instanceId, hit.distance]), before)
    detail.restore(); assert.equal(stock.geometry, geometry)
  } finally { detail.restore() }
}))

test('authored omissions survive merged batches, Hide UI restoration and repeated disposal', () => {
  const material = new THREE.MeshStandardMaterial(), root = new THREE.Group(), model = new THREE.Group()
  model.userData = { moduleType: 'bench', moduleId: 'one', levelZs: [0] }; root.add(model)
  const first = new THREE.Mesh(new THREE.BoxGeometry(), material), second = new THREE.Mesh(new THREE.BoxGeometry(), material)
  second.position.x = 2; model.add(first, second); omitModelDetail(second)
  const low = second.userData.lowDetailGeometry; let releases = 0
  low.addEventListener('dispose', () => releases++)
  const batches = new EquipmentBatches(), camera = new THREE.PerspectiveCamera(60, 1, .1, 100)
  camera.position.z = 5; camera.updateMatrixWorld()
  try {
    batches.sync(root, 'one', 'document')
    const mesh = batches.root.children[0], full = mesh.geometry
    assert.equal(triangles(full), 24)
    batches.graphicsQuality = 'low'; batches.updateDetail(camera, 800)
    assert.equal(triangles(mesh.geometry), 12, 'identical full meshes with different Low variants cannot share one instanced geometry')
    const reduced = mesh.geometry
    batches.hideUI = true; batches.updateDetail(camera, 800); assert.equal(mesh.geometry, full)
    batches.hideUI = false; batches.updateDetail(camera, 800); assert.equal(mesh.geometry, reduced)
    assert.equal(batches.root.children[0], mesh)
  } finally {
    batches.clear(); disposeObject(root); disposeObject(root); material.dispose()
  }
  assert.equal(releases, 1)
})

test('authored geometry keeps finish colours and releases replaced approximations once', () => {
  const source = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial({ vertexColors: true })
  source.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.count * 3).fill(1), 3))
  const mesh = new THREE.Mesh(source, material), low = new THREE.PlaneGeometry()
  setModelDetail(mesh, low)
  assert.ok([...low.attributes.color.array].every(value => value === 1), 'painted stairs must not turn black')
  assert.deepEqual(low.boundingBox, source.boundingBox)
  let count = 0; low.addEventListener('dispose', () => count++)
  setModelDetail(mesh, new THREE.BoxGeometry()); source.dispose(); source.dispose()
  assert.equal(count, 1); material.dispose()
})

for (const id of ['escalator', 'walkway', 'lift']) test(`${id} Low preserves the actual moving rig and restores all geometry`, () => fixture(id, root => {
  const originals = new Map(); root.traverse(mesh => { if (mesh.isMesh) originals.set(mesh, mesh.geometry) })
  const detail = new SourceGeometryDetail(), roll = root.userData.escalator, cabin = root.userData.liftCabin
  try {
    detail.apply(root, true)
    if (roll) {
      const matrix = roll.parts[0].instanceMatrix.array.slice()
      rollEscalator(roll, 1)
      assert.notDeepEqual(roll.parts[0].instanceMatrix.array, matrix)
      assert.equal(root.userData.escalator, roll)
    } else {
      const door = root.userData.doors[0], before = door.position.clone()
      setDoors(root, 1)
      assert.notDeepEqual(door.position, before)
      assert.equal(root.userData.liftCabin, cabin)
    }
    detail.restore()
    for (const [mesh, geometry] of originals) assert.equal(mesh.geometry, geometry)
  } finally { detail.restore() }
}))
