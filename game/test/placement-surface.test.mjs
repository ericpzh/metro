import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { cameraRig } from './support/camera-rig.mjs'
import { createModule, toState } from '../src/build/model.ts'
import { placementSurface } from '../src/app/tools/placementSurface.ts'
import { moduleAim } from '../src/app/tools/moduleAim.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { moveCandidate } from '../src/sim/placement.ts'
import { hangerSupports } from '../src/sim/hangers.ts'
import { useStore } from '../src/app/store.ts'
import { OutdoorSurfaceModel } from '../src/render/models/pieces/OutdoorSurfaceModel.ts'

test('low-angle beam hit wins over distant ground for fresh placement and moving, with one shared raycast', () => {
  const previous = useStore.getState(), { cam } = cameraRig()
  const material = new THREE.MeshBasicMaterial()
  const beam = new THREE.Mesh(new THREE.BoxGeometry(8, .2, .2), material)
  beam.position.set(1, .5, 15.9)
  const root = new THREE.Group(); root.userData = { moduleId: 'beam', moduleType: 'hanger' }; root.add(beam)
  const modules = new THREE.Group(); modules.add(root); modules.updateMatrixWorld(true)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 1), material)
  floor.position.set(0, 60, 11.5); floor.updateMatrixWorld(true)
  cam.modules = { moduleMeshes: modules }; cam.setPickables([floor])
  cam.camera.position.set(1, -8, 16.4); cam.camera.lookAt(1, .5, 15.9); cam.camera.updateMatrixWorld(true)
  const hanger = createModule('hanger-roof', 0, 0, 11, 'beam', 0, 8)
  const station = { name: 'visible beam', seed: 1, cells: [], modules: [hanger], lines: [], storeyHeight: 5 }
  let rays = 0
  const intersect = cam.raycaster.intersectObjects.bind(cam.raycaster)
  cam.raycaster.intersectObjects = (...args) => { rays++; return intersect(...args) }
  try {
    for (const type of ['cctv-ptz', 'clock', 'tv', 'sign-ceiling']) {
      rays = 0
      const hit = cam.withPointerPick(() => {
        const ground = cam.pick(640, 410, 11)
        assert.ok(ground.cell[1] > 30, 'the old terrain pick is visibly behind the beam')
        const object = cam.pick(640, 410, 11, true)
        assert.equal(object.moduleId, hanger.id)
        assert.equal(cam.pickModuleHit(640, 410).moduleId, hanger.id)
        return placementSurface(station, type, object)
      })
      assert.equal(rays, 1)
      assert.deepEqual(hit.cell, [1, 0, 11])
      assert.deepEqual(moduleAim(station, type, hit), [1, 0, 11])
      useStore.setState({ station: toState(station), moduleType: type, moduleRot: 0, currentBoards: { front: [], back: [] }, past: [], future: [] })
      const tool = new EquipmentTool({})
      const preview = tool.ceilingPlacement(hit.cell, hit.place, 'preview')[0]
      assert.ok(hangerSupports(hanger, preview), JSON.stringify({ hanger, preview }))
      assert.deepEqual([preview.x, preview.y, preview.z], [1, 0, 11])
      tool.placeModule(hit.cell, hit.place, hit.solid, type)
      const placed = useStore.getState().station.modules.find(m => m.id !== hanger.id)
      assert.ok(placed, `${type}: ${useStore.getState().notice}`)
      assert.deepEqual([placed.x, placed.y, placed.z], [1, 0, 11])
      const moved = moveCandidate([], [hanger], { ...placed, x: 40, z: 17, ceilingAnchored: true }, { x: 1, y: 0, z: 11 }, 0)
      assert.equal(moved.reason, '')
      assert.equal(moved.module.ceilingAnchored, undefined)
      useStore.getState().undo()
      assert.equal(useStore.getState().station.modules.length, 1)
    }
    const occluder = new THREE.Mesh(new THREE.BoxGeometry(4, .2, 2), material)
    occluder.position.set(1, -1, 15.9); occluder.updateMatrixWorld(true)
    cam.setPickables([floor, occluder])
    assert.equal(cam.pick(640, 410, 11, true).moduleId, undefined, 'a nearer real block still occludes the object')
    cam.setPickables([floor]); root.visible = false
    assert.equal(cam.pick(640, 410, 11, true).moduleId, undefined, 'hidden modules cannot attract placement')
    occluder.geometry.dispose()
  } finally { useStore.setState(previous); cam.dispose(); beam.geometry.dispose(); floor.geometry.dispose(); material.dispose() }
})

test('the pavement top keeps decor in the tile column instead of the air cell above it', () => {
  for (const type of ['sidewalk', 'lawn']) {
    const surface = createModule(type, 2, 3, 0, 'surface')
    const station = { modules: [surface] }
    // What `pickCells` hands a top-face hit on the drawn tile: the 0.1 m finish
    // reads as a block one cell up, so the raw place cell is the air above it.
    const hit = { moduleId: surface.id, cell: [2, 3, 1], place: [2, 3, 2], normal: [0, 0, 1], solid: true, point: [2.5, 3.5, 1.1] }
    for (const piece of ['bench', 'tree', 'bin', 'tvm', 'light']) {
      const aimed = placementSurface(station, piece, hit)
      assert.deepEqual(aimed.cell, [2, 3, 0], `${type} ${piece}: the tile's own column`)
      assert.deepEqual(aimed.place, [2, 3, 0])
      assert.deepEqual(moduleAim({ ...station, cells: [], levelBase: 0, storeyHeight: 5 }, piece, aimed), [2, 3, 0], `${type} ${piece}: the candidate stands on the pavement`)
    }
    // A side hit is a neighbour placement, not a tile-column target.
    const side = { ...hit, cell: [2, 3, 0], place: [2, 2, 0], normal: [0, -1, 0], point: [2.5, 3, 0.05] }
    assert.equal(placementSurface(station, 'bench', side), side)
  }
})

test('a real pavement mesh supports fresh placement and a moved decor drop', () => {
  const previous = useStore.getState(), { cam } = cameraRig()
  const surface = createModule('sidewalk', 2, 3, 0, 'surface')
  const station = { name: 'pavement', seed: 1, cells: [], modules: [surface], lines: [], storeyHeight: 5, levelBase: 0 }
  const root = new THREE.Group(); root.userData = { moduleId: surface.id, moduleType: surface.type }
  const model = new OutdoorSurfaceModel({ data: station, mats: {}, owned: [] }).build(surface)
  model.position.set(2, 3, 1); root.add(model)
  const modules = new THREE.Group(); modules.add(root); modules.updateMatrixWorld(true)
  cam.modules = { moduleMeshes: modules }; cam.setPickables([])
  cam.camera.position.set(2.5, 3.5, 10); cam.camera.up.set(0, 1, 0)
  cam.camera.lookAt(2.5, 3.5, 0); cam.camera.updateMatrixWorld(true)
  try {
    const raw = cam.pick(640, 410, 0, true)
    assert.equal(raw.moduleId, surface.id)
    assert.deepEqual(raw.cell, [2, 3, 1])
    const hit = placementSurface(station, 'bin', raw)
    assert.deepEqual(moduleAim(station, 'bin', hit), [2, 3, 0])
    useStore.setState({ station: toState(station), moduleType: 'bin', moduleRot: 0, past: [], future: [] })
    new EquipmentTool({}).placeModule(hit.cell, hit.place, hit.solid, 'bin')
    const placed = useStore.getState().station.modules.find(m => m.type === 'bin')
    assert.ok(placed)
    assert.deepEqual([placed.x, placed.y, placed.z], [2, 3, 0])
    const [x, y, z] = moduleAim(station, placed, hit)
    const moved = moveCandidate([], [surface], { ...placed, x: 8 }, { x, y, z }, 0)
    assert.equal(moved.reason, '')
    assert.deepEqual([moved.module.x, moved.module.y, moved.module.z], [2, 3, 0])
  } finally { useStore.setState(previous); cam.dispose() }
})

test('non-hanger objects keep their visible surface cell instead of inventing support behind them', () => {
  const hit = { moduleId: 'bench', cell: [2, 3, 12], place: [2, 2, 12], normal: [0, -1, 0], solid: true, point: [2.5, 3.1, 12.4] }
  const station = { modules: [createModule('bench', 2, 3, 11, 'bench')] }
  assert.equal(placementSurface(station, 'tvm', hit), hit)
  assert.equal(placementSurface(station, 'cctv-post', hit), hit)
  assert.equal(placementSurface(station, 'clock', null), null)
})
