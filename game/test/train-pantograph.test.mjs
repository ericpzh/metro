import { PANTOGRAPH_CONTACT_Z } from '../src/sim/stock.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildTrain, createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'
import { STOCK, STOCK_CLASSES } from '../src/sim/stock.ts'
import { FORMATION_OPTIONS } from '../src/sim/headway.ts'
import { CONTACT_STRIP_Z } from '../src/sim/constants.ts'
import { buildTrainPantograph, PANTOGRAPH_MOUNT_Z, PANTOGRAPH_WELL_HALF_LENGTH } from '../src/render/models/pieces/TrainPantograph.ts'
import { CAR_GAP } from '../src/render/models/pieces/TrainGangway.ts'
import { World } from '../src/sim/world.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

function withMaterials(run) {
  const previous = globalThis.document
  globalThis.document = { createElement() { const canvas = { width: 0, height: 0 }; const { g } = stubCanvas(); g.canvas = canvas; canvas.getContext = () => g; return canvas } }
  const mats = createModelMaterials()
  try { run(mats) } finally { disposeModelMaterials(mats); globalThis.document = previous }
}
test('collector meets the raised wire in the five-metre profile', () => {
  assert.ok(Math.abs(CONTACT_STRIP_Z - 3.891) < 1e-9)
})

const collectors = root => root.children.filter(child => child.name === 'train-pantograph')

const formations = {
  A: ['><', '>.<', '.<>.', '.>..<.', '.<.<..>.'],
  B: ['><', '>.<', '.<>.', '.>..<.', '.>.<..>.'],
  C: ['><', '>.<', '.><.', '.>..<.', '..>..<..'],
  D: ['><', '>.<', '.><.', '.>..<.', '.>....<.'],
  L: ['><', '>.<', '.<>.', '>.>..<', '>.>...<.'],
}

test('every overhead formation matches the car and elbow table and fits its roof', () => withMaterials(mats => {
  for (const stock of STOCK_CLASSES) for (const [index, cars] of FORMATION_OPTIONS.entries()) {
    const pose = { x: 12, y: 8, z: -7.5, stock, cars, dirSign: 1, yaw: 0, colour: '#287db2', doorsOpen: false }
    const root = buildTrain(mats, { ...pose, power: 'catenary' })
    const bare = buildTrain(mats, { ...pose, power: 'third-rail' })
    try {
      const pans = collectors(root), length = STOCK[stock].length, half = cars * length / 2
      const expected = formations[stock][index]
      const actual = Array(cars).fill('.')
      assert.equal(collectors(bare).length, 0)
      root.updateMatrixWorld(true)
      const roofs = root.children.filter(part => ['car-roof', 'd-car-roof', 'pantograph-roof-well'].includes(part.name))
      const acUnits = root.children.filter(part => part.name === 'train-roof-ac-housing')
        .map(part => new THREE.Box3().setFromObject(part))
      for (const pan of pans) {
        const x = pan.position.x
        const car = Math.floor((x + half) / length)
        const centre = (car + .5) * length - half
        const axle = pan.getObjectByName('pantograph-base-axle')
        const elbow = pan.getObjectByName('pantograph-elbow-pivot')
        const elbowOffset = elbow.getWorldPosition(new THREE.Vector3()).x - axle.getWorldPosition(new THREE.Vector3()).x
        const direction = Math.sign(elbowOffset)
        assert.equal(actual[car], '.', `${stock}-${cars}: at most one collector per car`)
        actual[car] = direction > 0 ? '>' : '<'
        const mountEnd = car === 0 ? 1 : car === cars - 1 ? -1 : -direction
        assert.ok(Math.abs(x - (centre + mountEnd * ((length - CAR_GAP) / 2 - 2))) < 1e-9)

        const well = new THREE.Raycaster(new THREE.Vector3(pose.x + x, pose.y, pose.z + 4), new THREE.Vector3(0, 0, -1))
        const hit = well.intersectObjects(roofs)[0]
        assert.ok(hit && Math.abs(hit.point.z - (pose.z + PANTOGRAPH_MOUNT_Z)) < 1e-6, 'collector sits in a real roof recess')
        assert.ok(acUnits.every(box => box.max.x < pose.x + x - PANTOGRAPH_WELL_HALF_LENGTH ||
          box.min.x > pose.x + x + PANTOGRAPH_WELL_HALF_LENGTH), 'AC units clear the collector recess')

        const strips = pan.children.filter(child => child.name === 'pantograph-contact-strip')
        assert.equal(strips.length, 2)
        for (const strip of strips) {
          const bounds = new THREE.Box3().setFromObject(strip)
          assert.ok(Math.abs(bounds.max.z - (pose.z + PANTOGRAPH_CONTACT_Z)) < 1e-6, 'contact reaches the real wire underside in world space')
        }
        assert.ok(pan.getObjectByName('pantograph-lower-arm'))
        assert.ok(pan.getObjectByName('pantograph-upper-arm'))
        assert.ok(new THREE.Box3().setFromObject(pan.getObjectByName('pantograph-upper-arm')).max.z > pose.z + 3.25, 'the upper arm clears the car roof with a compact reach')
        assert.equal(pan.getObjectByName('pantograph-tie-rod').userData.lowDetailGeometry.getAttribute('position').count, 0)
      }
      assert.equal(actual.join(''), expected, `${stock}-${cars}: car positions and actual elbow directions`)
      for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        root.rotation.z = rotation
        root.updateMatrixWorld(true)
        for (const pan of pans) {
          const strip = pan.getObjectByName('pantograph-contact-strip')
          const bounds = new THREE.Box3().setFromObject(strip)
          assert.ok(Math.abs(bounds.max.z - (pose.z + PANTOGRAPH_CONTACT_Z)) < 1e-6)
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

test('legacy five- and seven-car render callers retain their original inboard cab mounts', () => withMaterials(mats => {
  for (const cars of [5, 7]) {
    const root = buildTrain(mats, { x: 0, y: 0, z: 0, cars, stock: 'A', power: 'catenary', colour: '#287db2', doorsOpen: false, dirSign: -1, yaw: 0 })
    try {
      const pans = collectors(root)
      assert.deepEqual(pans.map(pan => pan.rotation.z), [0, Math.PI])
      const x = (cars / 2 - 1) * STOCK.A.length + CAR_GAP / 2 + 2
      assert.deepEqual(pans.map(pan => pan.position.x), [-x, x])
    } finally { disposeObject(root) }
  }
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
    const closed = trains.trainGroup.children.find(root => root !== bare)
    assert.equal(closed,powered,'door-side changes retain the same powered roof and consist')
    assert.equal(closed.userData.doorSides, 0)
    pose[9] = 1
    trains.setTrains(pose)
    assert.equal(bare.visible, true)
    assert.equal(trains.trainGroup.children.length, 2, 'power selects geometry while door-side flags only change the live pose')
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
      assert.ok(bounds(insulator).getSize(new THREE.Vector3()).z < .18,'short ceramic stacks keep the base low')
    }
    assert.equal(named('pantograph-lower-arm').length, 1, 'one substantial lower spine')
    const lower = named('pantograph-lower-arm')[0]
    assert.ok(lower.geometry.parameters.radiusBottom > lower.geometry.parameters.radiusTop)
    assert.ok(lower.geometry.parameters.radiusBottom >= .1, 'arm has a solid cross-section')
    assert.equal(named('pantograph-upper-arm').length, 2, 'upper fork carries both head sides')
    for(const arm of [lower,...named('pantograph-upper-arm')]) {
      const axis=new THREE.Vector3(0,1,0).applyQuaternion(arm.quaternion)
      assert.ok(Math.asin(Math.abs(axis.z))*180/Math.PI < 10,'both articulated arms fold almost level')
    }
    assert.ok(new THREE.Box3().setFromObject(pan).max.z-PANTOGRAPH_MOUNT_Z < .73,'complete collector is less than half its old 1.53 m rise')
    for (const name of ['pantograph-base-axle','pantograph-elbow-pivot','pantograph-head-pivot','pantograph-tension-spring','pantograph-spring-clevis','pantograph-bonding-lead','pantograph-power-bushing','pantograph-power-lead']) assert.ok(named(name).length, name)
    const horns = named('pantograph-horn')
    const headBounds = horns.reduce((box, part) => box.union(bounds(part)), new THREE.Box3())
    assert.ok(headBounds.getSize(new THREE.Vector3()).y > 2.2, 'bow spans most of the roof width')
    const stripZ = PANTOGRAPH_CONTACT_Z
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
