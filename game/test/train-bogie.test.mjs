import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildTrainBogie, BOGIE_AXLE_Z, BOGIE_AXLE_HALF_SPAN, BOGIE_WHEEL_Y, carBogieCentres, BOGIE_WHEEL_RADIUS, BOGIE_RAIL_Z } from '../src/render/models/pieces/TrainBogie.ts'
import { buildTrackDetails } from '../src/render/models/pieces/TrackDetails.ts'
import { createModelMaterials, disposeModelMaterials, disposeObject, buildTrain } from '../src/render/models.ts'
import { STOCK, STOCK_CLASSES, CABIN_FLOOR_Z, TRAIN_ORIGIN_Z, DOOR_HEAD_Z, DOOR_SILL_Z, doorCentres } from '../src/sim/stock.ts'
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
  for(const name of ['upper-cheek-frame','secondary-air-cushion','body-load-pad','upper-bolster','bolster','motor-coupling','gear-case','traction-motor','axle-box','trailing-arm','bearing-cap','brake-disc','brake-caliper','damper-rod','damper-body'])assert.ok(named(root,name).length,name)
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
 const bogie=new THREE.Group();buildTrainBogie(bogie,mats,0);bogie.position.z=TRAIN_ORIGIN_Z
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
    const up=new THREE.Raycaster(new THREE.Vector3(x,y,RAIL_HEAD_Z-.2),new THREE.Vector3(0,0,1))
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
   for(let c=0;c<cars;c++){const centre=c*STOCK[stock].length+STOCK[stock].length/2-cars*STOCK[stock].length/2;const doors=doorCentres({stock,cars}).filter(x=>Math.abs(x-centre)<STOCK[stock].length/2);for(const bogie of carBogieCentres(doors))for(const axle of [-1,1])expected.push(bogie+axle*.72)}
   assert.deepEqual(named(root,'axle').map(p=>+p.position.x.toFixed(6)).sort((a,b)=>a-b),expected.map(x=>+x.toFixed(6)).sort((a,b)=>a-b))
   for(const rot of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
    root.rotation.z=rot;root.updateMatrixWorld(true)
    for(const axle of named(root,'axle'))assert.ok(Math.abs(axle.getWorldPosition(new THREE.Vector3()).z-(-7.5+BOGIE_AXLE_Z))<1e-6)
   }
   const floors=root.children.filter(p=>p.name==='cabin-floor')
   root.rotation.z=0;root.position.set(0,0,0);root.updateMatrixWorld(true)
   for(const floor of floors) {
    const box=bounds(floor), x=(box.min.x+box.max.x)/2
    const aisle=new THREE.Raycaster(new THREE.Vector3(x,0,2),new THREE.Vector3(0,0,-1)).intersectObject(floor)[0]
    assert.ok(aisle&&Math.abs(aisle.point.z-CABIN_FLOOR_Z)<1e-6,'each passenger floor keeps its continuous platform-height aisle')
   }
   for(const axle of named(root,'axle')) {
    const hole=new THREE.Raycaster(new THREE.Vector3(axle.position.x,BOGIE_WHEEL_Y,2),new THREE.Vector3(0,0,-1)).intersectObjects(floors)
    if (hole.length) assert.ok(Math.abs(hole[0].point.z-CABIN_FLOOR_Z)<1e-6,'floor stays intact over wheelsets')
    const aisle=new THREE.Raycaster(new THREE.Vector3(axle.position.x,0,2),new THREE.Vector3(0,0,-1)).intersectObjects(floors)[0]
    if (aisle) assert.ok(Math.abs(aisle.point.z-CABIN_FLOOR_Z)<1e-6,'passenger aisle retains its platform-aligned height')
    assert.ok(bounds(axle).max.z<DOOR_SILL_Z,'axles remain below passenger thresholds')
   }
   assert.equal(root.children.filter(p=>p.name==='cabin-wheel-housing-top').length,0,'no raised housing obstructs a doorway')
   for(const part of root.children.filter(p=>p.name.startsWith('bogie-')))assert.ok(bounds(part).max.z<DOOR_SILL_Z,'all wheel and suspension hardware clears the threshold vertically')
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

test('bogies match the reference outer-door bays with balanced inward offsets',()=>{
 for(const stock of STOCK_CLASSES) {
  const doors=doorCentres({stock,cars:1}).sort((a,b)=>a-b)
  const centres=carBogieCentres(doors)
  assert.ok(centres[0]>=doors[0] && centres[0]<doors[0]+.5)
  assert.ok(centres[1]<=doors.at(-1) && centres[1]>doors.at(-1)-.5)
  assert.ok(centres[0]-.72-.4 > -STOCK[stock].length/2+1.5)
  assert.ok(centres[1]+.72+.4 < STOCK[stock].length/2-1.5)
  assert.ok(Math.abs(centres[0]+centres[1])<1e-6,'one-car support is mirrored about the car centre')
 }
})


test('underfloor equipment fills the inter-bogie bay without moving the floor or roof',()=>withKit(mats=>{
 for(const stock of STOCK_CLASSES) {
  const root=buildTrain(mats,{x:0,y:0,z:0,stock,cars:1,doorsOpen:false,colour:'#287db2',dirSign:1,yaw:0})
  try {
   const equipment=root.children.filter(p=>p.name.startsWith('underframe-'))
   for(const name of ['inverter','battery-cabinet','air-reservoir','vent','mounting-bracket','cable-conduit'])assert.ok(equipment.some(p=>p.name===`underframe-${name}`),`${stock}: ${name}`)
   const bogies=carBogieCentres(doorCentres({stock,cars:1}).sort((a,b)=>a-b))
   let high=0,low=0
   for(const part of equipment) {
    const box=bounds(part)
    assert.ok(box.min.x>=bogies[0]+1.64&&box.max.x<=bogies[1]-1.64,'clear of moving wheelsets')
    assert.ok(box.max.z<CABIN_FLOOR_Z&&box.min.z>BOGIE_RAIL_Z+.15,'below floor and above the rail hardware')
    assert.ok(box.min.y>-STOCK[stock].width/2&&box.max.y<STOCK[stock].width/2,'inside car width')
    high+=triangles(part.geometry);low+=triangles(part.userData.lowDetailGeometry??part.geometry)
   }
   assert.ok(low<high*.4,'Low retains equipment silhouettes and omits the vents, latches and straps')
   const roofs=root.children.filter(p=>p.name===(stock==='D'?'d-car-roof':'car-roof'))
   const roof=Math.max(...roofs.map(p=>bounds(p).max.z))
   assert.ok(Math.abs(roof-(stock==='D'?3.25:3.15))<1e-5,'original roof height is retained')
   const ratio=(DOOR_HEAD_Z-DOOR_SILL_Z)/(roof-BOGIE_RAIL_Z)
   assert.ok(ratio>.52&&ratio<.55,`${stock}: doors are ${(ratio*100).toFixed(1)}% of wheel-to-roof height`)
   for(const leaf of root.userData.doors) {
    const box=bounds(leaf)
    assert.ok(box.max.z<=DOOR_HEAD_Z+1e-5,'glazing and trim stay inside the shorter aperture')
    assert.ok(box.min.z>=DOOR_SILL_Z-1e-5)
   }
   assert.equal(TRAIN_ORIGIN_Z+CABIN_FLOOR_Z,1,'boarding floor stays flush with the platform')
  }finally{disposeObject(root)}
 }
}))
