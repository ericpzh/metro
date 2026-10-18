import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildTrainBogie, BOGIE_AXLE_Z, BOGIE_AXLE_HALF_SPAN, BOGIE_WHEEL_Y, carBogieCentres, BOGIE_WHEEL_RADIUS } from '../src/render/models/pieces/TrainBogie.ts'
import { buildTrackDetails } from '../src/render/models/pieces/TrackDetails.ts'
import { createModelMaterials, disposeModelMaterials, disposeObject, buildTrain } from '../src/render/models.ts'
import { STOCK, STOCK_CLASSES, CABIN_FLOOR_Z, doorCentres } from '../src/sim/stock.ts'
import { RAIL_HEAD_Z } from '../src/sim/constants.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
const named = (root, name) => root.children.filter(p => p.name === `bogie-${name}`)
const bounds = root => { root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(root) }
const triangles = geometry => (geometry.index?.count ?? geometry.getAttribute('position').count)/3
function withKit(run) {
  const previous = globalThis.document
  globalThis.document = {createElement(){const c={width:0,height:0};const {g}=stubCanvas();g.canvas=c;c.getContext=()=>g;return c}}
  const mats=createModelMaterials()
  try {run(mats)} finally {disposeModelMaterials(mats);globalThis.document=previous}
}

test('shared bogie has full-size wheelsets, connected suspension and under-seat/aisle clearance',()=>withKit(mats=>{
 const root=new THREE.Group();buildTrainBogie(root,mats,0)
 try {
  assert.equal(named(root,'wheel-tyre').length,4)
  assert.equal(named(root,'wheel-web').length,4)
  assert.equal(named(root,'axle').length,2)
  assert.equal(named(root,'side-frame').length,2)
  assert.equal(named(root,'primary-coil-spring').length,4)
  assert.equal(named(root,'air-spring').length,2)
  for(const name of ['bolster','motor-coupling','gear-case','traction-motor','axle-box','trailing-arm','bearing-cap','brake-disc','brake-caliper','damper-rod','damper-body'])assert.ok(named(root,name).length,name)
  assert.ok(bounds(root).max.z<1.0,'enlarged wheel-side hardware clears the under-seat housings')
  assert.equal(BOGIE_WHEEL_RADIUS,.4)
  for(const part of root.children.filter(p=>['bogie-axle','bogie-bolster','bogie-frame-crossmember','bogie-traction-motor'].includes(p.name)))assert.ok(bounds(part).max.z<.60,'central hardware clears the unchanged-height aisle')
  for(const side of [-1,1]) {
   const tyre=named(root,'wheel-tyre').find(p=>Math.sign(p.position.y)===side)
   const points=tyre.geometry.parameters.points
   assert.ok(Math.max(...points.map(p=>p.x))>.17,'flange stands proud of the tread')
   const flange=points.filter(p=>p.x>.17)
   assert.ok(flange.every(p=>p.y<-.04),'flange faces inboard, rather than outside the rail')
   assert.equal(Math.sign(tyre.position.y),side)
  }
  let high=0,low=0
  for(const part of root.children){high+=triangles(part.geometry);low+=triangles(part.userData.lowDetailGeometry??part.geometry)}
  assert.ok(low<high*.25,`authored Low retains the bogie with ${low}/${high} triangles`)
  for(const spring of named(root,'primary-coil-spring')) {
   assert.equal(triangles(spring.userData.lowDetailGeometry),0)
   for(const name of ['spring-seat','spring-frame-bracket'])assert.ok(named(root,name).some(part=>bounds(part).intersectsBox(bounds(spring))), 'visible primary spring meets its lower and upper seats')
  }
 }finally{disposeObject(root)}
}))

test('both wheel treads contact the actual rail crowns in High and Low, with flange clearance inside the gauge',()=>withKit(mats=>{
 const bogie=new THREE.Group();buildTrainBogie(bogie,mats,0);bogie.position.z=.5
 const rails=new THREE.Group();buildTrackDetails(rails,mats,mats.white,mats.darkSteel,4,3);rails.position.set(-1.5,-1,0)
 try {
  bogie.updateMatrixWorld(true);rails.updateMatrixWorld(true)
  for(const tyre of named(bogie,'wheel-tyre')) {
   const x=tyre.position.x,y=tyre.position.y
   const down=new THREE.Raycaster(new THREE.Vector3(x,y,2),new THREE.Vector3(0,0,-1))
   const rail=down.intersectObject(rails,true)[0]
   assert.ok(rail&&Math.abs(rail.point.z-RAIL_HEAD_Z)<1e-6,'actual model rail crown is under the wheel')
   const high=tyre.geometry
   for(const geometry of [high,tyre.userData.lowDetailGeometry]) {
    tyre.geometry=geometry
    const up=new THREE.Raycaster(new THREE.Vector3(x,y,0),new THREE.Vector3(0,0,1))
    const tread=up.intersectObject(tyre)[0]
    assert.ok(tread&&Math.abs(tread.point.z-rail.point.z)<1e-6,'round wheel meets the crown without sinking or hovering')
   }
   tyre.geometry=high
   const inner=Math.abs(BOGIE_WHEEL_Y)-.042
   assert.ok(inner<.7175,'flange stays on the gauge side of the 70 mm head')
  }
 }finally{disposeObject(bogie);disposeObject(rails)}
}))

test('every A/B/C/D/L car gets two complete bogies without changing the passenger floor or doorway geometry',()=>withKit(mats=>{
 for(const stock of STOCK_CLASSES)for(const cars of [1,STOCK[stock].consist[1]]) {
  const root=buildTrain(mats,{x:12,y:8,z:-7.5,cars,stock,power:cars===1?'catenary':'third-rail',doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
  try {
   assert.equal(named(root,'wheel-tyre').length,cars*8,stock)
   assert.equal(named(root,'axle').length,cars*4,stock)
   const expected=[]
   for(let c=0;c<cars;c++){const centre=c*STOCK[stock].length+STOCK[stock].length/2-cars*STOCK[stock].length/2;const doors=doorCentres({stock,cars}).filter(x=>Math.abs(x-centre)<STOCK[stock].length/2);for(const bogie of carBogieCentres(doors))for(const axle of [-1,1])expected.push(bogie+axle*Math.min(.72,((doors[1]-doors[0])-STOCK[stock].doorWidth-.8)/2-.05))}
   assert.deepEqual(named(root,'axle').map(p=>+p.position.x.toFixed(6)).sort((a,b)=>a-b),expected.map(x=>+x.toFixed(6)).sort((a,b)=>a-b))
   for(const rot of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
    root.rotation.z=rot;root.updateMatrixWorld(true)
    for(const axle of named(root,'axle'))assert.ok(Math.abs(axle.getWorldPosition(new THREE.Vector3()).z-(-7.5+BOGIE_AXLE_Z))<1e-6)
   }
   const floors=root.children.filter(p=>p.name==='cabin-floor')
   root.rotation.z=0;root.position.set(0,0,0);root.updateMatrixWorld(true)
   for(const axle of named(root,'axle')) {
    const hole=new THREE.Raycaster(new THREE.Vector3(axle.position.x,BOGIE_WHEEL_Y,2),new THREE.Vector3(0,0,-1)).intersectObjects(floors)
    assert.equal(hole.length,0,'wheelsets have open floor apertures beneath window seats')
    const aisle=new THREE.Raycaster(new THREE.Vector3(axle.position.x,0,2),new THREE.Vector3(0,0,-1)).intersectObjects(floors)[0]
    assert.ok(aisle&&Math.abs(aisle.point.z-CABIN_FLOOR_Z)<1e-6,'aisle remains continuous at its original platform-aligned height')
    assert.ok(doorCentres({stock,cars}).every(d=>Math.abs(d-axle.position.x)>STOCK[stock].doorWidth/2+BOGIE_WHEEL_RADIUS),'large wheels clear every passenger doorway')
   }
   assert.equal(root.children.filter(p=>p.name==='cabin-wheel-housing-top').length,cars*4)
   for(const floor of root.children.filter(p=>p.name==='cabin-floor'))assert.ok(Math.abs(floor.position.z+.06-CABIN_FLOOR_Z)<1e-6)
  }finally{disposeObject(root)}
 }
}))

test('bogie source and authored Low geometries release exactly once',()=>withKit(mats=>{
 const root=new THREE.Group();buildTrainBogie(root,mats,0)
 const releases=new Map()
 for(const part of root.children)for(const geometry of [part.geometry,part.userData.lowDetailGeometry].filter(Boolean)){
  releases.set(geometry,0);geometry.addEventListener('dispose',()=>releases.set(geometry,releases.get(geometry)+1))
 }
 disposeObject(root)
 for(const n of releases.values())assert.equal(n,1)
}))
