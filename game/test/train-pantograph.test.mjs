import { TRAIN_ORIGIN_Z } from '../src/sim/stock.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'
import { STOCK, STOCK_CLASSES } from '../src/sim/stock.ts'
import { CONTACT_STRIP_Z } from '../src/sim/constants.ts'
import { buildTrainPantograph, PANTOGRAPH_MOUNT_Z } from '../src/render/models/pieces/TrainPantograph.ts'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

function withMaterials(run) {
  const previous = globalThis.document
  globalThis.document = { createElement() { const canvas = { width: 0, height: 0 }; const { g } = stubCanvas(); g.canvas = canvas; canvas.getContext = () => g; return canvas } }
  const mats = createModelMaterials()
  try { run(mats) } finally { disposeModelMaterials(mats); globalThis.document = previous }
}
test('raised contact sits 0.99 m above the previous wire underside', () => {
  assert.ok(Math.abs(CONTACT_STRIP_Z - 4.758) < 1e-9)
})

const collectors = root => root.children.filter(child => child.name === 'train-pantograph')

test('all stock classes have two mirrored inboard cab-car collectors only for overhead power', () => withMaterials(mats => {
  for (const stock of STOCK_CLASSES) for (const cars of [2, STOCK[stock].consist[1]]) for (const dirSign of [-1, 1]) {
    const yaw = dirSign < 0 ? Math.PI / 2 : 0
    const pose = { x: 12, y: 8, z: -7.5, stock, cars, dirSign, yaw, colour: '#287db2', doorsOpen: false }
    const root = buildTrain(mats, { ...pose, power: 'catenary' })
    const bare = buildTrain(mats, { ...pose, power: 'third-rail' })
    try {
      const pans = collectors(root), length = STOCK[stock].length, half = cars * length / 2
      assert.equal(pans.length, 2)
      assert.equal(collectors(bare).length, 0)
      assert.ok(pans[0].position.x > -half + length / 2 && pans[0].position.x < -half + length)
      assert.ok(Math.abs(pans[0].position.x + pans[1].position.x) < 1e-9)
      assert.equal(pans[0].rotation.z, 0)
      assert.equal(pans[1].rotation.z, Math.PI)
      root.updateMatrixWorld(true)
      for (const pan of pans) {
        const strips = pan.children.filter(child => child.name === 'pantograph-contact-strip')
        assert.equal(strips.length, 2)
        for (const strip of strips) {
          const bounds = new THREE.Box3().setFromObject(strip)
          assert.ok(Math.abs(bounds.max.z - (pose.z + CONTACT_STRIP_Z - TRAIN_ORIGIN_Z)) < 1e-6, 'contact reaches the real wire underside in world space')
        }
        assert.ok(pan.getObjectByName('pantograph-lower-arm'))
        assert.ok(pan.getObjectByName('pantograph-upper-arm'))
        assert.ok(new THREE.Box3().setFromObject(pan.getObjectByName('pantograph-upper-arm')).max.z > pose.z + 4.0, 'the upper arm projects visibly above the car roof')
        assert.equal(pan.getObjectByName('pantograph-tie-rod').userData.lowDetailGeometry.getAttribute('position').count, 0)
      }
      for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        root.rotation.z = rotation
        root.updateMatrixWorld(true)
        for (const pan of pans) {
          const strip = pan.getObjectByName('pantograph-contact-strip')
          const bounds = new THREE.Box3().setFromObject(strip)
          assert.ok(Math.abs(bounds.max.z - (pose.z + CONTACT_STRIP_Z - TRAIN_ORIGIN_Z)) < 1e-6)
          const well = new THREE.Raycaster(new THREE.Vector3(pan.position.x, 0, 4), new THREE.Vector3(0, 0, -1))
          root.rotation.z = 0
          root.position.set(0, 0, 0)
          root.updateMatrixWorld(true)
          const roofs = []; root.traverse(mesh => { if (mesh.name === 'car-roof' || mesh.name === 'd-car-roof' || mesh.name === 'pantograph-roof-well') roofs.push(mesh) })
          const hit = well.intersectObjects(roofs)[0]
          assert.ok(hit && hit.point.z <= 2.851, 'the collector occupies a real roof recess above the cabin')
          root.position.set(pose.x, pose.y, pose.z)
          root.rotation.z = rotation
          root.updateMatrixWorld(true)
        }
      }
      assert.equal(root.userData.doors.length, bare.userData.doors.length, 'power does not change doors')
    } finally { disposeObject(root); disposeObject(bare) }
  }
}))

test('one-car overhead formation has one central collector, clear of both cabs', () => withMaterials(mats => {
  const root = buildTrain(mats, { x: 0, y: 0, z: 0, cars: 1, stock: 'D', power: 'catenary', colour: '#287db2', doorsOpen: false, dirSign: 1, yaw: 0 })
  try { assert.equal(collectors(root).length, 1); assert.equal(collectors(root)[0].position.x, 0) } finally { disposeObject(root) }
}))

test('worker sends line power independently of stock, preserving both door bits', () => {
  for (const power of ['third-rail', 'catenary']) {
    const data = scenarioStation()
    data.lines = data.lines.map(line => ({ ...line, power }))
    const world = new World(data, 99)
    world.tickOnce()
    const pose = world.trainRenderState()
    assert.equal(pose.length, 10)
    assert.equal(pose[9] & 4, power === 'catenary' ? 4 : 0)
    assert.equal(pose[9] & 3, 1)
  }
})

test('live power changes select a distinct cached roof without opening the wire flag as a door', () => withMaterials(mats => {
  const ctx = { scene: new THREE.Scene(), modelMats: mats, levelBase: 0, lastStateTime: 1000, stateIntervalMs: 1000 }
  const trains = new TrainSystem(ctx)
  trains.level = { applyGroupLevel(root) { root.visible = true } }
  const pose = new Float32Array([0, 0, 0.5, 2, 1, 1, 0x287db2, 1, 0, 1])
  try {
    trains.setTrains(pose)
    const bare = trains.trainGroup.children[0]
    assert.equal(collectors(bare).length, 0)
    pose[9] = 5
    trains.setTrains(pose)
    const powered = trains.trainGroup.children.find(root => root !== bare)
    assert.equal(collectors(powered).length, 2)
    assert.equal(powered.userData.doorSides, 1)
    pose[9] = 4
    trains.setTrains(pose)
    const closed = trains.trainGroup.children.find(root => root !== bare && root !== powered)
    assert.equal(closed.userData.doorSides, 0)
    pose[9] = 1
    trains.setTrains(pose)
    assert.equal(bare.visible, true)
    assert.equal(trains.trainGroup.children.length, 3, 'returning power mode reuses its existing consist')
  } finally { trains.dispose() }
}))


test('collector has a wide downturned bow, solid articulated arms and ribbed electrical mounts', () => withMaterials(mats => {
  const root = new THREE.Group()
  buildTrainPantograph(root, mats, 0, 1, PANTOGRAPH_MOUNT_Z)
  try {
    const pan = collectors(root)[0]
    root.updateMatrixWorld(true)
    const named = name => pan.children.filter(p => p.name === name)
    const bounds = p => new THREE.Box3().setFromObject(p)
    assert.equal(named('pantograph-ribbed-insulator').length, 4)
    for (const insulator of named('pantograph-ribbed-insulator')) {
      assert.equal(insulator.geometry.type, 'LatheGeometry')
      const points = insulator.geometry.parameters.points
      assert.equal(points.filter(p => p.x === .14).length, 5, 'five flared ceramic sheds')
      assert.ok(bounds(insulator).min.z >= PANTOGRAPH_MOUNT_Z)
      assert.ok(bounds(insulator).max.z < bounds(named('pantograph-base')[0]).min.z)
    }
    assert.equal(named('pantograph-lower-arm').length, 1, 'one substantial lower spine')
    const lower = named('pantograph-lower-arm')[0]
    assert.ok(lower.geometry.parameters.radiusBottom > lower.geometry.parameters.radiusTop)
    assert.ok(lower.geometry.parameters.radiusBottom >= .1, 'arm has a solid cross-section')
    assert.equal(named('pantograph-upper-arm').length, 2, 'upper fork carries both head sides')
    for (const name of ['pantograph-base-axle','pantograph-elbow-pivot','pantograph-head-pivot','pantograph-tension-spring','pantograph-spring-clevis','pantograph-bonding-lead','pantograph-power-bushing','pantograph-power-lead']) assert.ok(named(name).length, name)
    const horns = named('pantograph-horn')
    const headBounds = horns.reduce((box, part) => box.union(bounds(part)), new THREE.Box3())
    assert.ok(headBounds.getSize(new THREE.Vector3()).y > 2.2, 'bow spans most of the roof width')
    const stripZ = CONTACT_STRIP_Z - TRAIN_ORIGIN_Z
    assert.ok(headBounds.min.z < stripZ - .2, 'horns turn down visibly')
    assert.ok(headBounds.max.z < stripZ, 'metal bow stays below carbon contact')
    assert.ok(new THREE.Box3().setFromObject(pan).max.z <= stripZ + 1e-6, 'no hardware penetrates the contact wire')
    let high = 0, low = 0
    pan.traverse(part => {
      if (!part.isMesh) return
      const triangles = geometry => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
      high += triangles(part.geometry)
      low += triangles(part.userData.lowDetailGeometry ?? part.geometry)
    })
    assert.ok(low < high * .25, `Low retains the silhouette with ${low}/${high} triangles`)
    for (const spring of named('pantograph-tension-spring')) assert.equal(spring.userData.lowDetailGeometry.getAttribute('position').count, 0)
  } finally { disposeObject(root) }
}))


test('thin roof AC units stay inside each car and clear the collector wells for every stock',()=>withMaterials(mats=>{
 for(const stock of STOCK_CLASSES)for(const power of ['third-rail','catenary']){
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:1,power,doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
  try{
   root.updateMatrixWorld(true)
   const units=root.children.filter(p=>p.name==='train-roof-ac-housing')
   assert.equal(units.length,2,`${stock}: two shallow packaged units`)
   const roof=stock==='D'?3.25:3.15
   for(const unit of units){
    const box=new THREE.Box3().setFromObject(unit)
    assert.ok(box.max.z<=roof+.16&&box.min.z>=roof-.03,'housing is less than 20 cm high')
    assert.ok(box.min.x>-STOCK[stock].length/2&&box.max.x<STOCK[stock].length/2,'unit stays on its car')
    assert.ok(box.min.y>-STOCK[stock].width/2&&box.max.y<STOCK[stock].width/2,'unit clears rolled roof shoulders')
    if(power==='catenary')assert.ok(box.max.x < -1.12 || box.min.x > 1.12,'AC does not cover the central collector recess')
    assert.ok(unit.userData.lowDetailGeometry,'Low retains the housing silhouette')
   }
   assert.equal(root.children.filter(p=>p.name==='train-roof-ac-fan-grille').length,4)
   assert.ok(root.children.some(p=>p.name==='train-roof-ac-side-vent'))
  }finally{disposeObject(root)}
 }
}))
