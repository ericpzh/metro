import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { trainPreparationPoses, trainPreparationFleet } from '../src/render/trainPreparation.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { createModelMaterials, disposeModelMaterials } from '../src/render/models.ts'
import { referenceStation } from '../src/data/reference-station.ts'
import { World } from '../src/sim/world.ts'
import { STOCK_CLASSES } from '../src/sim/stock.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

const appearance = buffer => {
  const counts = new Map()
  for (let i = 0; i < buffer.length; i += 10) {
    const key = [3,4,6,7,8,9].map(offset => buffer[i+offset]).join(':')
    counts.set(key, (counts.get(key) ?? 0)+1)
  }
  return counts
}

test('new platforms reuse bounded spare geometry across yaw and door-side changes',()=>{
  const previous=globalThis.document
  globalThis.document={createElement(){const canvas={width:0,height:0};const {g}=stubCanvas();g.canvas=canvas;canvas.getContext=()=>g;return canvas}}
  const mats=createModelMaterials(),ctx=new SceneContextData(new THREE.Scene(),{},mats,{})
  const trains=new TrainSystem(ctx)
  trains.level={applyGroupLevel(group){group.visible=!group.userData.parked}}
  const fixture=referenceStation(),line={...fixture.lines[0],stock:'B',cars:1}
  const old=fixture.modules.find(m=>m.type==='track')
  const track={...old,id:'first',rot:0,x:0,cfg:{line:line.id,dir:'up'}}
  const base={...fixture,cells:[],lines:[line],modules:[track]}
  try{
    assert.equal(trainPreparationFleet(base,8).length,20,'one actual anchor plus one spare')
    trains.prepareForStation(base)
    const groups=trains.trainGroup.children.slice()
    let builds=0
    const build=trains.createEntry
    trains.createEntry=function(...args){builds++;return build.apply(this,args)}
    const second={...track,id:'second',rot:1,x:25}
    const expanded={...base,modules:[track,second]}
    assert.equal(trainPreparationFleet(expanded,8).length,20,'an extra anchor consumes the spare instead of adding a third copy')
    trains.prepareForStation(expanded)
    assert.equal(builds,0)
    assert.deepEqual(new Set(trains.trainGroup.children),new Set(groups))
    const screened={...expanded,modules:[...expanded.modules,{id:'screen',type:'platform-edge',x:25,y:0,z:0,rot:1,w:1,cfg:{line:line.id,dir:'up',side:'left',from:'second',psd:'full'}}]}
    trains.prepareForStation(screened)
    assert.equal(builds,0,'door-side bits do not change built train geometry')
    const poses=trainPreparationPoses(screened,8)
    trains.setPlaying(false);trains.setTrains(poses)
    assert.equal(builds,0,'both arrivals reuse the prepared fleet')
    const active=[...trains.trainSlots.values()].filter(e=>e.active)
    assert.equal(active.length,2)
    active.forEach((e,i)=>{
      assert.equal(e.group.rotation.z,poses[i*10+8])
      assert.equal(e.group.userData.doorSides,poses[i*10+9]&3)
    })
    trains.prepareForStation({...screened,lines:[{...line,power:'catenary'}]})
    assert.ok(builds>0,'a different power system still prepares different roof geometry')
  }finally{trains.dispose();disposeModelMaterials(mats);globalThis.document=previous}
})

test('prepared demo appearances match every worker service anchor without dispatching or changing the document', () => {
  for (const id of ['zoo','tanwei']) {
    const data = referenceStation(id), original = structuredClone(data)
    const world = new World(data, data.seed)
    const expected = []
    for (const [key, anchor] of world.lineAnchors) {
      const line = world.lineById.get(key.split('|')[0])
      expected.push(anchor.x,anchor.y,anchor.z,anchor.cars,STOCK_CLASSES.indexOf(anchor.stock),0,
        anchor.colour,anchor.dirSign,anchor.yaw,anchor.doorSides | (line.power === 'catenary' ? 4 : 0))
    }
    assert.deepEqual(appearance(trainPreparationPoses(data,64)), appearance(new Float32Array(expected)), id)
    assert.equal(world.tick,0); assert.equal(world.trains.length,0)
    assert.deepEqual(data,original)
  }
})

test('station preparation keeps a bounded invisible fleet and first arrivals reuse its exact geometry and rigs', () => {
  const previous = globalThis.document
  globalThis.document = { createElement() { const canvas={width:0,height:0}; const {g}=stubCanvas(); g.canvas=canvas; canvas.getContext=()=>g; return canvas } }
  const mats = createModelMaterials(), ctx = new SceneContextData(new THREE.Scene(), {}, mats, {})
  const trains = new TrainSystem(ctx)
  trains.level = { applyGroupLevel(group) { group.visible = !group.userData.parked } }
  const fixture = referenceStation()
  const line = {...fixture.lines[0],stock:'B',cars:1}
  const track = fixture.modules.find(module=>module.type==='track')
  const data = {...fixture,cells:[],lines:[line],modules:Array.from({length:12},(_,i)=>({...track,id:`track-${i}`,x:i*25,cfg:{line:line.id,dir:'up'}}))}
  try {
    trains.prepareForStation(data)
    const prepared = trains.trainGroup.children.slice()
    assert.equal(prepared.length,8,'opening preparation respects the dormant fleet bound')
    assert.ok(prepared.every(group=>!group.visible && group.userData.parked))
    assert.equal(trains.lastBuffer.length,0,'preparation is not a simulation snapshot')
    const allocations=[]
    for (const group of prepared) group.traverse(object=>{if(object.isMesh)allocations.push([object,object.geometry])})
    let builds=0
    const create = trains.createEntry
    trains.createEntry = function (...args) { builds++; return create.apply(this,args) }
    trains.prepareForStation(data)
    const poses=trainPreparationPoses(data,8)
    for(let i=0;i<poses.length;i+=10) { poses[i]+=100; poses[i+5]=1 }
    trains.setPlaying(false)
    trains.setTrains(poses)
    assert.equal(builds,0,'first dispatch builds no model')
    assert.deepEqual(trains.trainGroup.children,prepared)
    assert.ok(prepared.every(group=>group.visible && !group.userData.parked))
    prepared.forEach((group,i)=>assert.deepEqual(group.position.toArray(),Array.from(poses.subarray(i*10,i*10+3)), 'first paused snapshot supplies the real live position'))
    for(const [mesh,geometry]of allocations)assert.equal(mesh.geometry,geometry)
    trains.setTrains(new Float32Array())
    trains.setPlaying(true)
    for(let i=0;i<poses.length;i+=10) poses[i]+=25
    trains.setTrains(poses)
    assert.equal(builds,0,'repeated services reuse the prepared models')
    prepared.forEach((group,i)=>assert.deepEqual(group.position.toArray(),Array.from(poses.subarray(i*10,i*10+3)), 'a parked service snaps to its new approach even on resume'))
    trains.setTrains(new Float32Array())
    trains.prepareForStation({...data,lines:[{...line,power:'catenary'}]})
    assert.equal(trains.trainGroup.children.length,8,'changed configurations evict old parked models')
    assert.ok(prepared.every(group=>!trains.trainGroup.children.includes(group)))
  } finally { trains.dispose(); disposeModelMaterials(mats); globalThis.document=previous }
})

test('suspended editor retains only the latest train snapshot and applies it when shown', () => {
  const source = readFileSync(new URL('../src/render/scene/SceneRenderer.ts',import.meta.url),'utf8')
  const suspended = source.slice(source.indexOf('setSuspended('),source.indexOf('private lastFrame'))
  assert.match(suspended,/if \(!on && this\.deferredTrains\)/)
  assert.match(suspended,/this\.deferredTrains = null\s*this\.setTrains\(latest\)/)
  const setTrains = source.slice(source.indexOf('  setTrains('),source.indexOf('  setLifts('))
  assert.ok(setTrains.indexOf('if (this.suspended)') < setTrains.indexOf('this.trains.setTrains'))
  assert.match(setTrains,/if \(this\.suspended\) \{ this\.deferredTrains = buffer; return \}/)
})
