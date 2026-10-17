// Rolling stock detail (§9.3, GAME-SPEC §1.12–1.13). Every part a consist draws
// has an authored Low approximation prepared when the part is built, so a quality
// or storey change swaps geometry references only: no rebuild, no upload, and the
// exact sources stay in place for picking. This pins the per-consist Low budgets,
// the untouched full counts from PERFORMANCE.md as asset integrity, the parts a
// passenger would still recognize (door leaves, gangways, straps) and the
// door-bank / sorted-glass swaps.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject, setDoorsSides } from '../src/render/models.ts'
import { geometryDetailReady } from '../src/render/geometryDetail.ts'
import { modelDetailGeometry } from '../src/render/modelDetail.ts'
import { batchStaticParts } from '../src/render/batchStaticModule.ts'
import { batchTrainDoors, batchTrainTransparent } from '../src/render/trainBatches.ts'
import { gangwayGeometry } from '../src/render/models/pieces/TrainGangway.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'
import { STOCK, STOCK_CLASSES } from '../src/sim/stock.ts'
import { TRAIN_DETAIL_MAX_RADIUS } from '../src/sim/constants.ts'
import { trainDrawnTriangles } from '../src/render/trainDetail.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

await geometryDetailReady
const triangles = (geometry) => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
const extent = (geometry) => {
  const position = geometry.getAttribute('position'), box = new THREE.Box3()
  for (let i = 0; i < position.count; i++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, i))
  return box
}

function withDocument(run) {
  const previous = globalThis.document
  globalThis.document = { createElement: () => { const canvas = { width: 0, height: 0 }; const { g } = stubCanvas(); g.canvas = canvas; canvas.getContext = () => g; return canvas } }
  const mats = createModelMaterials()
  try { return run(mats) } finally { disposeModelMaterials(mats); globalThis.document = previous }
}

function consist(mats, stock, cars) {
  return buildTrain(mats, { x: 0, y: 0, z: 0, cars, stock, doorsOpen: false, colour: '#c8102e', dirSign: 1, yaw: 0 })
}

/** A TrainSystem holding one consist, with a storey-slicing stub. */
function trainSystem(mats, stock, cars, doorSides = 3) {
  const ctx = new SceneContextData(new THREE.Scene(), {}, mats, {})
  const trains = new TrainSystem(ctx)
  trains.level = { applyGroupLevel(group) { group.visible = true } }
  trains.setTrains(new Float32Array([0, 0, 0, cars, STOCK_CLASSES.indexOf(stock), 1, 0x336699, 1, 0, doorSides]))
  const group = trains.trainGroup.children[0]
  group.updateMatrixWorld(true)
  // Put the camera's storey on the consist so "high quality" really is the current floor.
  ctx.activeZ = group.userData.levelZs[0]
  return { ctx, trains, group, details: trains.details.get(group) }
}

// One row per consist the game can build, with the full count the performance
// reference publishes. A changed full count means the inventory tool, that table
// and this one must be regenerated together.
const consists = [
  ['D', 8, 1061168, .10],
  ['D', 6, 812988, .11],
  ['A', 8, 228512, .28],
  ['A', 6, 178592, .27],
  ['B', 6, 156320, .27],
  ['C', 6, 156320, .27],
  ['L', 6, 136496, .25],
  ['B', 4, 113824, .26],
  ['C', 4, 113824, .26],
  ['L', 4, 100608, .24],
]

test('every consist draws its published full count and a Low within budget', () => withDocument((mats) => {
  for (const [stock, cars, full, ratio] of consists) {
    const { ctx, trains, group } = trainSystem(mats, stock, cars)
    try {
      const high = trainDrawnTriangles(group)
      ctx.graphicsQuality = 'low'
      trains.updateGeometryDetail()
      const low = trainDrawnTriangles(group)
      assert.equal(high, full, `${stock}-${cars}: full geometry is unchanged`)
      assert.ok(low > 0 && low <= full * ratio, `${stock}-${cars}: Low ${low}/${full} (${(low / full * 100).toFixed(1)}%)`)
    } finally { trains.dispose() }
  }
}))

test('Low shares one prepared swap per drawn piece and keeps the full sources in place', () => withDocument((mats) => {
  const { ctx, trains, details } = trainSystem(mats, 'B', 6)
  try {
    const swapped = details.filter(detail => detail.far)
    assert.ok(swapped.length > 0)
    for (const detail of swapped) assert.ok(detail.mesh && detail.near instanceof THREE.BufferGeometry && detail.far instanceof THREE.BufferGeometry)
    const prepared = swapped.map(detail => ({ mesh: detail.mesh, near: detail.near, far: detail.far }))
    ctx.graphicsQuality = 'low'
    trains.updateGeometryDetail()
    trains.updateGeometryDetail()
    for (const { mesh, far } of prepared) assert.equal(mesh.geometry, far, 'a settled policy does no geometry work')
    ctx.graphicsQuality = 'high'
    trains.updateGeometryDetail()
    for (const { mesh, near } of prepared) assert.equal(mesh.geometry, near)
    for (const [index, { mesh, near, far }] of prepared.entries()) {
      assert.equal(swapped[index].mesh, mesh)
      assert.equal(swapped[index].near, near)
      assert.equal(swapped[index].far, far)
    }
  } finally { trains.dispose() }
}))

test('Low keeps the doorway moving, the glass sortable and the batch allocations', () => withDocument((mats) => {
  const { ctx, trains, group } = trainSystem(mats, 'D', 8)
  try {
    const doors = group.userData.doors
    const glass = group.userData.trainGlassBatches.map(batch => batch.mesh)
    const doorBanks = group.userData.trainDoorBatches.map(batch => batch.mesh).filter(bank => bank.userData.trainDoorDetail)
    assert.ok(glass.every(batch => batch.userData.trainGlassDetail), 'the plug doors prepare reduced panes')
    assert.ok(glass.length > 0 && doorBanks.length > 0, 'the consist prepares a reduced door bank and reduced panes')
    const nearIds = glass.map(batch => batch.getGeometryIdAt(0))
    ctx.graphicsQuality = 'low'
    trains.updateGeometryDetail()
    for (const bank of doorBanks) assert.equal(bank.geometry, bank.userData.trainDoorDetail.far)
    glass.forEach((batch, i) => assert.notEqual(batch.getGeometryIdAt(0), nearIds[i], 'a reduced car sorts its own Low panes'))
    const closed = doors.map(door => door.position.x)
    for (const open of [.4, 1, 0]) {
      setDoorsSides(group, open, 0)
      for (const [i, door] of doors.entries()) {
        if (door.userData.side === -1) continue
        if (open) assert.notEqual(door.position.x, closed[i])
        else assert.equal(door.position.x, closed[i])
      }
    }
    ctx.graphicsQuality = 'high'
    trains.updateGeometryDetail()
    glass.forEach((batch, i) => assert.equal(batch.getGeometryIdAt(0), nearIds[i]))
    for (const bank of doorBanks) assert.equal(bank.geometry, bank.userData.trainDoorDetail.near)
  } finally { trains.dispose() }
}))

test('Low keeps the parts a passenger recognizes: straps, ring lights, benches and gangways', () => withDocument((mats) => {
  const group = consist(mats, 'B', 6)
  try {
    const strap = group.children.find(mesh => mesh.name === 'hanging-strap')
    const ring = group.children.find(mesh => mesh.name === 'cabin-ring-light')
    const bench = group.children.find(mesh => mesh.name === 'cabin-bench')
    const gangway = group.getObjectByName('car-intercar-gangway')
    for (const mesh of [strap, ring, bench, gangway]) {
      const low = modelDetailGeometry(mesh)
      assert.ok(low, `${mesh.name} has an authored approximation`)
      assert.ok(triangles(low) < triangles(mesh.geometry), `${mesh.name}: ${triangles(low)}/${triangles(mesh.geometry)} triangles`)
      assert.ok(low.boundingBox.containsBox(mesh.geometry.boundingBox), `${mesh.name} keeps its source envelope`)
    }
    assert.equal(triangles(modelDetailGeometry(strap)), 48)
    assert.equal(triangles(modelDetailGeometry(ring)), 96)
    assert.equal(triangles(modelDetailGeometry(bench)), 12)
    const ringSize = extent(ring.geometry).getSize(new THREE.Vector3()), ringLow = extent(modelDetailGeometry(ring)).getSize(new THREE.Vector3())
    assert.ok(Math.abs(ringSize.x - ringLow.x) < 0.02 && Math.abs(ringSize.z - ringLow.z) < 0.02, 'the ring light keeps its diameter')
    const gangwaySize = extent(gangway.geometry).getSize(new THREE.Vector3()), gangwayLow = extent(modelDetailGeometry(gangway)).getSize(new THREE.Vector3())
    assert.ok(Math.abs(gangwaySize.z - gangwayLow.z) < 1e-6, 'the bellows keeps the section it fills')
    const lowBellows = extent(gangwayGeometry([0, STOCK.B.length], STOCK.B.width, true))
    assert.ok(lowBellows.min.z > 0.3 && lowBellows.max.z > 3, 'a Low bellows still spans the gap between cars')
  } finally { disposeObject(group) }
}))

test('the D plug door keeps its opening and its glass at Low', () => withDocument((mats) => {
  const group = consist(mats, 'D', 8)
  try {
    const leaf = group.children.find(mesh => mesh.name === 'd-passenger-double-door')
    const seal = leaf.children.find(mesh => mesh.name === 'd-passenger-door-seal')
    const pane = leaf.children.find(mesh => mesh.name === 'train-door-window')
    for (const mesh of [leaf, seal, pane]) {
      const low = modelDetailGeometry(mesh)
      assert.ok(low, `${mesh.name} has an authored approximation`)
      assert.ok(triangles(low) <= 72, `${mesh.name}: ${triangles(low)} triangles`)
      assert.ok(low.boundingBox.containsBox(mesh.geometry.boundingBox), `${mesh.name} keeps the opening it plugs`)
    }
    assert.ok(triangles(pane.geometry) > triangles(modelDetailGeometry(pane)), 'the pane is a surface at Low, not a solid')
  } finally { disposeObject(group) }
}))

test('a merged car body is never fed to the relative-error simplifier', () => withDocument((mats) => {
  const { trains, group, details } = trainSystem(mats, 'B', 6)
  try {
    const swapped = new Set(details.map(detail => detail.mesh))
    let wide = 0
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.isBatchedMesh || object.isInstancedMesh || object.layers.mask !== 1) return
      if (object.userData.lowDetailGeometry) return
      object.geometry.computeBoundingSphere()
      if ((object.geometry.boundingSphere?.radius ?? 0) <= TRAIN_DETAIL_MAX_RADIUS) return
      wide++
      assert.ok(!swapped.has(object), 'a consist-wide mesh keeps its own geometry rather than a 2%-of-150 m approximation')
    })
    assert.ok(wide > 0, 'batching really does merge a body wider than the simplifier radius')
  } finally { trains.dispose() }
}))

test('batching carries both variants of the body and of the door banks', () => withDocument((mats) => {
  const group = consist(mats, 'L', 6)
  try {
    const doors = new Set(group.userData.doors), leafGeometry = new Map()
    for (const leaf of group.userData.doors) leafGeometry.set(leaf, leaf.geometry)
    batchStaticParts(group, new Set(group.userData.doors), true)
    batchTrainDoors(group)
    batchTrainTransparent(group)
    for (const [leaf, geometry] of leafGeometry) assert.equal(leaf.geometry, geometry, 'an animated leaf keeps its exact source')
    const merged = group.children.filter(mesh => mesh.isMesh && !mesh.isInstancedMesh && !mesh.isBatchedMesh && mesh.userData.lowDetailGeometry)
    assert.ok(merged.length > 0)
    for (const mesh of merged) {
      const low = modelDetailGeometry(mesh)
      assert.ok(triangles(low) < triangles(mesh.geometry), 'a merged body piece carries the merged Low variant')
      assert.ok(low.boundingBox.containsBox(mesh.geometry.boundingBox))
    }
    const banks = group.userData.trainDoorBatches.map(batch => batch.mesh).filter(bank => bank.userData.trainDoorDetail)
    assert.ok(banks.length > 0)
    for (const bank of banks) assert.notEqual(bank.userData.trainDoorDetail.far, bank.geometry)
    for (const batch of group.userData.trainGlassBatches) {
      const detail = batch.mesh.userData.trainGlassDetail
      if (detail) assert.equal(detail.farIds.length, batch.sources.length)
    }
    assert.ok(doors.size > 0)
  } finally { disposeObject(group) }
}))
