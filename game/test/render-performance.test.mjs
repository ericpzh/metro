import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { batchStaticModule } from '../src/render/batchStaticModule.ts'
import { canRetainPaintedModules } from '../src/render/retainPaintedModules.ts'

test('static batching keeps transformed bounds, triangles and module ray picking', () => {
  const root = new THREE.Group()
  root.userData.moduleId = 'bench-1'
  root.position.set(10, -2, 3)
  const nested = new THREE.Group()
  nested.rotation.z = Math.PI / 2
  root.add(nested)
  const material = new THREE.MeshBasicMaterial()
  let disposed = 0
  for (const x of [-1, 1]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    mesh.position.x = x
    mesh.geometry.addEventListener('dispose', () => disposed++)
    nested.add(mesh)
  }
  const before = new THREE.Box3().setFromObject(root)
  batchStaticModule(root, 'bench')
  assert.equal(nested.children.length, 1, 'two opaque parts become one draw')
  assert.equal(nested.children[0].geometry.index.count, 72, 'all 24 box triangles survive')
  assert.equal(disposed, 2, 'replaced geometries release their buffers')
  const after = new THREE.Box3().setFromObject(root)
  assert.ok(before.min.distanceTo(after.min) < 1e-6 && before.max.distanceTo(after.max) < 1e-6)
  root.updateMatrixWorld(true)
  const ray = new THREE.Raycaster(new THREE.Vector3(10, -1, 10), new THREE.Vector3(0, 0, -1))
  const hit = ray.intersectObject(root, true)[0]
  assert.ok(hit, 'the drawn part is still pickable')
  assert.equal(hit.object.parent.parent.userData.moduleId, 'bench-1')
})

test('batching preserves transparent sorting, screen ownership and animated rigs', () => {
  for (const type of ['gate', 'clock', 'escalator', 'lift', 'platform-edge', 'tv']) {
    const root = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial()
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(), mat)
    root.add(leaf, new THREE.Mesh(new THREE.BoxGeometry(), mat))
    batchStaticModule(root, type)
    assert.equal(root.children[0], leaf, `${type} retains its animation/screen reference`)
    assert.equal(root.children.length, 2)
  }
  const root = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 })
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), mat), new THREE.Mesh(new THREE.BoxGeometry(), mat))
  const shared = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  shared.userData.sharedGeometry = true
  root.add(shared, new THREE.Mesh(new THREE.BoxGeometry(), shared.material))
  batchStaticModule(root, 'bench')
  assert.equal(root.children.length, 4, 'transparent and shared parts remain separate')
})

test('module reuse accepts unrelated floor paint but rejects geometry and dependent finishes', () => {
  const station = { name: 'test', seed: 1, lines: [], modules: [{ id: 's', type: 'stair', x: 0, y: 0, z: 0,
    from: { x: 0, y: 0, z: 0 }, to: { x: 4, y: 0, z: 4 }, cfg: {} }],
    cells: [{ x: 0, y: 0, z: 0, fill: 'solid' }, { x: 8, y: 0, z: 0, fill: 'solid' }] }
  const paint = (index, finish) => ({ ...station, cells: station.cells.map((c, i) => i === index ? { ...c, finish } : c) })
  assert.equal(canRetainPaintedModules(station, paint(1, { top: 'floor.tile' })), true)
  assert.equal(canRetainPaintedModules(station, structuredClone(station)), true, 'undo clones are safe too')
  assert.equal(canRetainPaintedModules(station, paint(0, { top: 'floor.tile' })), false, 'stair inherits its starting floor')
  assert.equal(canRetainPaintedModules(station, paint(1, { n: 'wall.enamel' })), false, 'room side finishes must rebuild')
  assert.equal(canRetainPaintedModules(station, { ...station, name: 'renamed' }), false)
  assert.equal(canRetainPaintedModules(station, { ...station, cells: station.cells.slice(1) }), false)
  assert.equal(canRetainPaintedModules(station, { ...station, cells: station.cells.map(c => ({ ...c, fill: 'void' })) }), false)
  assert.equal(canRetainPaintedModules(station, { ...station, modules: [] }), false)
})
