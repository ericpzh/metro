// Rolling stock detail (§9.3, GAME-SPEC §1.12–1.13). Every part a consist draws
// has an authored Low approximation prepared when the part is built, so a quality
// or storey change swaps geometry references only: no rebuild, no upload, and the
// exact sources stay in place for picking. This pins the per-consist Low budgets,
// the untouched full counts in the performance reference as asset integrity, the
// parts a passenger would still recognize (door leaves, gangways, straps) and the
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
import { STOCK, STOCK_CLASSES, TRAIN_ORIGIN_Z } from '../src/sim/stock.ts'
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
function trainSystem(mats, stock, cars, doorSides = 3, power = 'third-rail') {
  const ctx = new SceneContextData(new THREE.Scene(), {}, mats, {})
  const trains = new TrainSystem(ctx)
  trains.level = { applyGroupLevel(group) { group.visible = true } }
  trains.setTrains(new Float32Array([0, 0, 0, cars, STOCK_CLASSES.indexOf(stock), 1, 0x336699, 1, 0, doorSides | (power === 'catenary' ? 4 : 0)]))
  const group = trains.trainGroup.children[0]
  group.updateMatrixWorld(true)
  // Put the camera's storey on the consist so "high quality" really is the current floor.
  ctx.activeZ = group.userData.levelZs[0]
  return { ctx, trains, group, details: trains.details.get(group) }
}

test('a live line recolour retains consist geometry, door banks, poses and detail allocations', () => withDocument(mats=>{
  const {trains,group,details}=trainSystem(mats,'B',2)
  try {
    const geometry=[];group.traverse(m=>{if(m.isMesh)geometry.push([m,m.geometry])})
    const doors=group.userData.doors, banks=group.userData.trainDoorBatches
    const count=trains.trainGroup.children.length
    trains.setTrains(new Float32Array([0,0,0,2,STOCK_CLASSES.indexOf('B'),1,0x995533,1,0,3]))
    assert.equal(trains.trainGroup.children.length,count)
    const entry=[...trains.trainSlots.values()].find(e=>e.active)
    assert.equal(entry.group,group)
    assert.equal(group.userData.liveryMaterial.color.getHex(),0x995533)
    assert.equal(group.userData.doors,doors);assert.equal(group.userData.trainDoorBatches,banks)
    assert.equal(trains.details.get(group),details)
    for(const [mesh,buffer] of geometry)assert.equal(mesh.geometry,buffer)
    trains.setTrains(new Float32Array())
    trains.setTrains(new Float32Array())
    trains.setTrains(new Float32Array([50,0,0,2,STOCK_CLASSES.indexOf('B'),1,0x775599,1,0,3]))
    assert.equal(trains.trainGroup.children.length,count,'a parked consist can be recoloured for the next service')
    assert.equal([...trains.trainSlots.values()].find(e=>e.active).group,group)
    trains.setTrains(new Float32Array([50,0,0,2,STOCK_CLASSES.indexOf('B'),1,0x775599,1,0,3,100,0,0,2,STOCK_CLASSES.indexOf('B'),1,0x445566,1,0,3]))
    assert.equal(trains.trainGroup.children.length,count+1,'a simultaneous second service keeps its own model and material')
    assert.equal(group.userData.liveryMaterial.color.getHex(),0x775599)
  } finally {trains.dispose()}
}))

// One row per consist the game can build, with the full count the performance
// reference publishes. A changed full count means the inventory tool, that table
// and this one must be regenerated together.
const consists = [
  ['D', 8, 1308000, .1],
  ['D', 6, 1011484, .1],
  ['A', 8, 735088, .1],
  ['A', 6, 577676, .1],
  ['B', 6, 518976, .1],
  ['C', 6, 538320, .1],
  ['L', 6, 468008, .1],
  ['B', 4, 381628, .1],
  ['C', 4, 397940, .1],
  ['L', 4, 346780, .1],
]

test('identical consists on separate five-metre floors retain distinct cached poses', () => withDocument(mats => {
  const ctx = new SceneContextData(new THREE.Scene(), {}, mats, {})
  ctx.storeyHeight = 5
  const trains = new TrainSystem(ctx)
  trains.level = { applyGroupLevel(group) { group.visible = !group.userData.parked } }
  const poses = x => new Float32Array([
    x, 4.5, 3.3924, 1, 0, 0, 0x336699, 1, 0, 4,
    x, 4.5, 8.3924, 1, 0, 0, 0x336699, 1, 0, 4,
  ])
  try {
    trains.setTrains(poses(10))
    const initial = [...trains.trainSlots.values()]
    assert.equal(initial.length, 2, 'one visible model for each identical train')
    assert.ok(initial.every(entry => entry.active && entry.group.scale.z === .98))
    assert.deepEqual(initial.map(entry => entry.group.userData.levelZs), [[0], [5]])
    assert.ok(initial[1].to.z - initial[0].to.z > 4.99)
    trains.setTrains(poses(12))
    assert.deepEqual([...trains.trainSlots.values()].map(entry => entry.group), initial.map(entry => entry.group), 'repeated poses reuse both GPU models')
    assert.ok(initial.every(entry => entry.to.x === 12 && entry.active))
    trains.setTrains(poses(14).slice(0, 10))
    assert.equal(initial[0].group.userData.parked, false)
    assert.equal(initial[1].group.userData.parked, true, 'the absent train parks independently')
  } finally { trains.dispose() }
}))

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

test('one through eight cars, both roof powers and both door banks retain the 10% Low budget', () => withDocument(mats => {
  for (const stock of STOCK_CLASSES) for (let cars = 1; cars <= 8; cars++) for (const power of ['third-rail', 'catenary']) {
    const { ctx, trains, group } = trainSystem(mats, stock, cars, 3, power)
    try {
      const high = trainDrawnTriangles(group)
      ctx.graphicsQuality = 'low'; trains.updateGeometryDetail()
      const low = trainDrawnTriangles(group)
      assert.ok(low > 0 && low <= Math.floor(high * .1), `${stock}-${cars} ${power}: ${low}/${high} triangles`)
      setDoorsSides(group, 0, 1)
      assert.equal(trainDrawnTriangles(group), low, 'door motion cannot change the submitted triangle budget')
      ctx.graphicsQuality = 'high'; trains.updateGeometryDetail()
      assert.equal(trainDrawnTriangles(group), high, 'restoring High retains its exact topology')
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
    assert.equal(triangles(modelDetailGeometry(strap)), 12)
    assert.equal(triangles(modelDetailGeometry(ring)), 48)
    assert.equal(triangles(modelDetailGeometry(bench)), 12)
    const ringSize = extent(ring.geometry).getSize(new THREE.Vector3()), ringLow = extent(modelDetailGeometry(ring)).getSize(new THREE.Vector3())
    assert.ok(Math.abs(ringSize.x - ringLow.x) < 0.02 && Math.abs(ringSize.z - ringLow.z) < 0.02, 'the ring light keeps its diameter')
    const gangwaySize = extent(gangway.geometry).getSize(new THREE.Vector3()), gangwayLow = extent(modelDetailGeometry(gangway)).getSize(new THREE.Vector3())
    assert.ok(Math.abs(gangwaySize.z - gangwayLow.z) < 1e-6, 'the bellows keeps the section it fills')
    const lowBellows = extent(gangwayGeometry([0, STOCK.B.length], STOCK.B.width, true))
    assert.ok(lowBellows.min.z > 0.3 && lowBellows.max.z > 3, 'a Low bellows still spans the gap between cars')
  } finally { disposeObject(group) }
}))

test('Low door apertures and hollow strap loops keep visible surfaces on both sides', () => withDocument(mats => {
  const group=consist(mats,'B',2)
  try {
    const door=group.children.find(m=>m.name==='passenger-curved-door'),seal=door.children.find(m=>m.name==='train-door-perimeter-seal')
    for(const source of [door,seal]){
      const mesh=new THREE.Mesh(modelDetailGeometry(source),source.material)
      mesh.updateMatrixWorld(true);mesh.geometry.computeBoundingBox()
      const bounds=extent(mesh.geometry),x=bounds.max.x-.01
      for(const side of [-1,1]){
        const ray=new THREE.Raycaster(new THREE.Vector3(x,side*4,.28),new THREE.Vector3(0,-side,0))
        assert.ok(ray.intersectObject(mesh).length,`${source.name}: both broad faces remain visible`)
        ray.ray.origin.x=0
        assert.equal(ray.intersectObject(mesh).length,0,`${source.name}: the window/inner opening is unbacked`)
      }
    }
    const strap=group.children.find(m=>m.name==='hanging-strap'),path=strap.geometry.parameters.path
    const top=path.getPoint(0),center=[0,1/3,2/3].map(t=>path.getPoint(t)).reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/3)
    const loop=new THREE.Mesh(modelDetailGeometry(strap),strap.material);loop.updateMatrixWorld(true)
    for(const side of [-1,1]){
      const ray=new THREE.Raycaster(new THREE.Vector3(top.x,top.y+side*2,top.z),new THREE.Vector3(0,-side,0))
      assert.ok(ray.intersectObject(loop).length,'the loop rim is drawn from both cabin directions')
      ray.ray.origin.x=center.x;ray.ray.origin.z=center.z
      assert.equal(ray.intersectObject(loop).length,0,'a Low strap remains a hollow loop')
    }
  } finally {disposeObject(group)}
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


test('platform-aligned train origins keep their track storey when other levels are hidden',()=>withDocument(mats=>{
 const ctx=new SceneContextData(new THREE.Scene(),{},mats,{})
 const trains=new TrainSystem(ctx);trains.level={applyGroupLevel(){}}
 try{for(const z of [-20,0,10]){
  trains.setTrains(new Float32Array([0,0,z+TRAIN_ORIGIN_Z,1,1,1,0x336699,1,0,0]))
  const slot=[...trains.trainSlots.values()].find(e=>e.active)
  assert.deepEqual(slot.group.userData.levelZs,[z],'train belongs to the platform storey')
  trains.setTrains(new Float32Array())
 }}finally{trains.dispose()}
}))
