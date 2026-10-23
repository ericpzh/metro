import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { cameraRig } from './support/camera-rig.mjs'
import { moduleAim } from '../src/app/tools/moduleAim.ts'
import { createModule } from '../src/build/model.ts'
import { equipmentReason, moveCandidate } from '../src/sim/placement.ts'

test('all tool queries share one scene intersection per pointer dispatch and refresh next dispatch', () => {
  const { cam } = cameraRig()
  const modules = new THREE.Group()
  const group = new THREE.Group()
  group.userData = { moduleId: 'deck', moduleType: 'track' }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.5), new THREE.MeshBasicMaterial())
  mesh.position.set(0.5, 0.5, 3.25)
  group.add(mesh); modules.add(group); modules.updateMatrixWorld(true)
  cam.modules = { moduleMeshes: modules }
  cam.camera.position.set(0.5, 0.5, 1); cam.camera.lookAt(0.5, 0.5, 4); cam.camera.updateMatrixWorld(true)
  let rays = 0
  const intersect = cam.raycaster.intersectObjects.bind(cam.raycaster)
  cam.raycaster.intersectObjects = (...args) => { rays++; return intersect(...args) }
  try {
    cam.withPointerPick(() => {
      assert.ok(cam.pickHorizontalPlane(640, 410, 3, 2))
      assert.equal(rays, 0, 'a plane-only tool does not traverse scene geometry')
    })
    cam.withPointerPick(() => {
      const hit = cam.pick(640, 410, 0)
      assert.deepEqual(hit.cell, [0, 0, 3]); assert.deepEqual(hit.place, [0, 0, 2])
      assert.equal(cam.pickModule(640, 410), 'deck')
      assert.equal(cam.pickModuleHit(640, 410).moduleId, 'deck')
      assert.deepEqual(cam.pickModuleSurfaceHit(640, 410).normal, [0, 0, -1])
      assert.equal(cam.pickModuleInBounds(640, 410, new Set(['deck'])), 'deck')
      assert.ok(cam.pickRoofModuleNear(640, 410, new Set(['deck'])))
      assert.ok(cam.pickHorizontalPlane(640, 410, 3, 2))
      cam.withPointerPick(() => assert.equal(cam.pickModule(640, 410), 'deck'))
      assert.equal(rays, 1, 'floor, module, normal, bounds, roof and plane queries reuse one raycast')
      assert.equal(cam.raycaster.layers.mask, 1)
    })
    group.visible = false
    cam.withPointerPick(() => {
      assert.equal(cam.pickModule(640, 410), null)
      assert.equal(cam.pickModuleHit(640, 410), null)
    })
    assert.equal(rays, 2, 'a miss is cached too, and the next event sees visibility changes')
    assert.throws(() => cam.withPointerPick(() => { cam.pickModule(640, 410); throw Error('cancel') }), /cancel/)
    cam.pickModule(640, 410)
    assert.equal(rays, 4, 'exceptions release event state; standalone queries never reuse stale results')
  } finally { cam.dispose(); mesh.geometry.dispose(); mesh.material.dispose() }
})

test('a lift surface shared by block and module roots is intersected once', () => {
  const { cam } = cameraRig(), root = new THREE.Group(), modules = new THREE.Group()
  root.userData = { moduleId: 'lift', moduleType: 'lift' }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  root.add(mesh); modules.add(root); modules.updateMatrixWorld(true)
  cam.modules = { moduleMeshes: modules }; cam.setPickables([mesh])
  cam.camera.position.set(0, -5, 0); cam.camera.lookAt(0, 0, 0); cam.camera.updateMatrixWorld(true)
  let visits = 0
  const raycast = mesh.raycast.bind(mesh)
  mesh.raycast = (...args) => { visits++; raycast(...args) }
  try {
    cam.withPointerPick(() => {
      assert.ok(cam.pick(640, 410, 0)?.solid)
      assert.equal(cam.pickModule(640, 410), 'lift')
    })
    assert.equal(visits, 1)
  } finally { cam.dispose(); mesh.geometry.dispose(); mesh.material.dispose() }
})

test('fresh and moved ceiling props share aim and the same support verdict below a platform', () => {
  const platform = { id: 'platform', type: 'track', x: 0, y: 0, z: 4, rot: 0, w: 4, d: 3, cfg: { line: '1', power: 'third-rail' } }
  const station = { cells: [], modules: [platform], storeyHeight: 5, levelBase: 0 }
  const hit = { cell: [1, 1, 3], place: [1, 1, 2], solid: true }
  for (const type of ['sign-ceiling', 'tv', 'clock', 'cctv', 'light-circular', 'vent', 'monitor']) {
    const source = createModule(type, 8, 8, 0, type)
    assert.ok(source)
    const freshAt = moduleAim(station, type, hit)
    const movedAt = moduleAim(station, source, hit)
    assert.deepEqual(freshAt, [1, 1, 2]); assert.deepEqual(movedAt, freshAt)
    const fresh = createModule(type, ...freshAt, 'fresh')
    assert.equal(equipmentReason(station.cells, station.modules, fresh, true), '', type)
    const moved = moveCandidate(station.cells, station.modules, source, { x: movedAt[0], y: movedAt[1], z: movedAt[2] }, 0)
    assert.equal(moved.reason, '', type)
    assert.equal(equipmentReason([], [], fresh, true), 'ceiling', `${type} still needs real support`)
  }
})
