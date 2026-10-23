import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { emptyStation } from '../src/data/reference-station.ts'
import { toState, toData, createModule, addWalls, addEquipment } from '../src/build/model.ts'
import { levelSteps, storeyBand, psdFullHeight } from '../src/sim/constants.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { liftStopZs, liftExtendedUp } from '../src/sim/lifts.ts'
import { stairLengthOf, stairTurnCells, stairFlights } from '../src/sim/stairs.ts'
import { escalatorLength, escalatorInclineRun, escalatorLengthSpec, escalatorModule } from '../src/sim/escalators.ts'
import { makeTrack } from '../src/build/rail.ts'
import { trackHeadroom } from '../src/sim/track.ts'
import { moduleEnvelope, ceilingMountHeight, ceilingMountMissing, hungCeilingAim } from '../src/sim/placement.ts'
import { lightCeilingZ } from '../src/sim/lights.ts'
import { ventCeilingZ } from '../src/sim/vents.ts'
import { hangerRoofMissing, hangerRoofZ } from '../src/sim/hangers.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { moduleLevels } from '../src/render/scene/systems/SceneSystem.ts'
import { ChunkSystem } from '../src/render/scene/systems/ChunkSystem.ts'
import { LevelSystem } from '../src/render/scene/systems/LevelSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { checkBlockCells } from '../src/build/validation.ts'
import { blockIndex } from '../src/sim/blockIndex.ts'
import { addSuspendedCeiling } from '../src/build/model/Ceilings.ts'
import { useStore } from '../src/app/store.ts'
import { readFileSync } from 'node:fs'
import { stubCanvas } from './support/stub-canvas.mjs'
import { buildModule } from '../src/render/models.ts'
import { EscalatorModel } from '../src/render/models/pieces/EscalatorModel.ts'
import { STOCK_CLASSES, CABIN_FLOOR_Z, doorCentres, trainLength, trainOriginForScale, trainScaleForStorey } from '../src/sim/stock.ts'
import { BlockTool } from '../src/app/tools/BlockTool.ts'

// Node has no `Worker`; the store's `newStation`/`loadReference` open one through
// `ensureClient`, so stand a no-op stub up (mirrors line-edit.test.mjs).
globalThis.Worker = class { constructor() { this.onmessage = null } postMessage() {} }
const make=(type,z=0)=>createModule(type,0,0,z,type,0,undefined,'up','lane',[],undefined,{storeyHeight:5})
// captured at import time, before any test mutates the singleton: the document the
// app opens with, and the one `newStation` must also produce.
const coldBootStation=useStore.getState().station

test('stations, save round trips and controls use the five-metre grid',()=>{
 const state=toState(emptyStation())
 assert.equal(state.storeyHeight,5)
 assert.equal(parse(serialize(state)).state.storeyHeight,5)
 useStore.setState({station:state,activeZ:0})
 useStore.getState().stepLevel(1);assert.equal(useStore.getState().activeZ,5)
 useStore.getState().stepLevel(-1);assert.equal(useStore.getState().activeZ,0)
 assert.deepEqual(levelSteps(1).slice(7,10),[-4,1,6])
 assert.equal(storeyBand(10),10);assert.equal(storeyBand(-1),-5)
})

test('five-metre stairs, escalators, lifts and wall tools reach their adjoining floor',()=>{
 for(const type of ['stair-straight','stair-left90','stair-right180','escalator']) {
  const m=make(type)
  assert.equal(m.to.z,5,type)
  assert.equal(m.from.z,0,type)
  if(type==='stair-straight'||type==='escalator') {
   assert.equal(Math.hypot(m.to.x-m.from.x,m.to.y-m.from.y),type==='escalator'?9:8)
   assert.equal(type==='escalator'?escalatorLength(m):stairLengthOf(m),'long')
  }
 }
 const lift=make('lift')
 assert.deepEqual(liftStopZs(lift.from.z,liftExtendedUp(lift).to.z,lift.storeyHeight),[0,5,10])
 const walls=addWalls(toState(emptyStation()),[[0,0,0]]).state.cells
 assert.deepEqual(walls.map(c=>c.z),[0,1,2,3,4])
})

test('both power systems fit the same five-metre tunnel and full-height screen envelope',()=>{
 for(const power of ['catenary','third-rail']) {
  const track=makeTrack({id:power,x:0,y:0,z:0,w:12,d:3,rot:0,lineId:'1',dir:'up',power,storeyHeight:5})
  assert.equal(trackHeadroom(track)+1,4)
 }
 assert.equal(psdFullHeight(5)+1,4,'full screen meets the suspended ceiling')
})

test('suspended ceiling is a normal block with decor support and an independent ceiling render pass',()=>{
 const state=addSuspendedCeiling(toState(emptyStation()),[[0,0,4],[1,0,4]]).state
 assert.equal(state.cells.length,2)
 assert.ok(state.cells.every(c=>c.tags.includes('suspended-ceiling')))
 assert.equal(toData(toState(toData(state))).cells.length,2)
 const light=make('light-circular')
 assert.equal(ceilingMountHeight(state.cells,light,[]),3)
 assert.deepEqual(hungCeilingAim([0,0,0],[0,0,1],0,state.cells,[],5),[0,0,3])
 const mats={finish:()=>new THREE.MeshBasicMaterial(),outline:new THREE.MeshBasicMaterial()}
 const ctx=new SceneContextData(new THREE.Scene(),mats)
 ctx.storeyHeight=5
 const chunks=new ChunkSystem(ctx),level=new LevelSystem(ctx)
 level.chunks=chunks;level.modules={moduleMeshes:new THREE.Group(),syncBatches(){},restoreMovingModule(){}};level.trains={trainGroup:new THREE.Group()}
 chunks.prepareStation(toData(state));chunks.meshStation()
 const panels=[...chunks.chunkMeshes,...chunks.outlineMeshes].filter(m=>m.userData.suspendedCeiling)
 assert.ok(panels.length>0)
 const bounds=new THREE.Box3();for(const panel of chunks.chunkMeshes.filter(m=>m.userData.suspendedCeiling))bounds.union(panel.geometry.boundingBox)
 assert.ok(Math.abs(bounds.min.z-4)<1e-6,'three metres of clearance above the one-metre platform')
 level.setAutoCeiling(true);assert.ok(panels.every(m=>!m.visible))
 level.setAutoCeiling(false);assert.ok(panels.every(m=>m.visible))
 const geometry=panels[0].geometry
 chunks.prepareStation(toData(state));chunks.meshStation()
 assert.ok(chunks.chunkMeshes.some(m=>m.geometry===geometry),'the ceiling pass reuses unchanged chunk geometry')
})

test('block Tab variant and Shift+Tab wall toggle are exposed by the standard tools',()=>{
 useStore.getState().setSuspendedCeiling(true)
 assert.equal(useStore.getState().suspendedCeiling,true)
 assert.equal(useStore.getState().autoWalls,false)
 useStore.getState().setSuspendedCeiling(false)
 useStore.getState().setAutoWalls(true)
 assert.equal(useStore.getState().autoWalls,true)
 const keys=readFileSync(new URL('../src/app/windows/AppShell.tsx',import.meta.url),'utf8')
 assert.match(keys,/if \(e\.shiftKey\) st\.setAutoWalls/)
 assert.match(keys,/else st\.setSuspendedCeiling/)
 const ui=readFileSync(new URL('../src/app/rail/folders/RailFolder.tsx',import.meta.url),'utf8')
 assert.match(ui,/shortcut="Shift\+Tab"/)
 useStore.getState().setAutoWalls(false)
})

test('strict escalator inclines preserve integer landing cells and place the remainder in flat terminals',()=>{
 for(const length of ['ultra-short','short','medium','long'])for(const dir of ['up','down'])for(let rot=0;rot<4;rot++) {
  const m=escalatorModule({x:0,y:0,z:0},rot,dir,'esc',1,length,5)
  assert.ok([m,m.from,m.to].every(p=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&Number.isInteger(p.z)))
  const run=escalatorInclineRun(m)
  const angle=Math.atan2(Math.abs(run.to.z-run.from.z),Math.hypot(run.to.x-run.from.x,run.to.y-run.from.y))*180/Math.PI
  assert.ok(Math.abs(angle-30)<1e-8)
  assert.ok(run.inset>=0&&run.inset<0.5)
 }
})

test('the block gesture places, undoes and deletes suspended ceilings through the standard cell commands',()=>{
 const cells=[0,1,2,3].map(x=>({x,y:0,z:0,fill:'solid'}))
 useStore.setState({station:toState({...emptyStation(),cells}),past:[],future:[],activeZ:0,tool:'block',halfWall:false,triangles:false})
 useStore.getState().setSuspendedCeiling(true)
 const scene={setGhost(){},setCursor(){},setModulePreview(){},setFencePreview(){},setCollisionHighlight(){}}
 const ctx={scene:()=>scene,drag:{current:null},hover:{current:null},solids:()=>new Set(useStore.getState().station.cells.filter(c=>c.fill==='solid').map(c=>`${c.x},${c.y},${c.z}`)),showMeasure(){},clearMeasure(){}}
 const tool=new BlockTool(ctx)
 const event=(z,button=0)=>({button,buttons:button===2?2:1,clientX:0,clientY:0,shiftKey:false,hit:{cell:[0,0,z],place:[0,0,z+1],point:[.5,.5,z+1],normal:[0,0,1],solid:true},preventDefault(){}})
 tool.onDown(event(0));tool.onUp(event(0))
 assert.ok(useStore.getState().station.cells.some(c=>c.z===1&&c.tags?.includes('suspended-ceiling')))
 useStore.getState().undo();assert.equal(useStore.getState().station.cells.length,4)
 useStore.getState().redo();assert.equal(useStore.getState().station.cells.length,5)
 tool.onDown(event(1,2));tool.onUp(event(1,2))
 assert.equal(useStore.getState().station.cells.length,4)
 useStore.getState().setSuspendedCeiling(false)
})

test('the rendered escalator step chain has an exact thirty-degree incline',()=>{
 const mats=new Proxy({}, {get:(t,k)=>t[k]??=new THREE.MeshStandardMaterial()})
 const data=emptyStation()
 for(const dir of ['up','down']) {
  const m=escalatorModule({x:0,y:0,z:0},0,dir,'esc',1,'medium',5)
  const group=new EscalatorModel({data,mats,trackCells:new Set(),owned:[]}).build(m)
  const climb=group.userData.escalator.climb
  assert.ok(Math.abs(Math.asin(climb.z)*180/Math.PI-30)<1e-8)
 }
})

test('full PSD glazing fills below the top-mounted 0.6-metre information plate without padding',()=>{
 const old=globalThis.document
 globalThis.document={createElement:()=>{const {g}=stubCanvas();return {width:0,height:0,getContext:()=>g}}}
 try {
  const mats=new Proxy({}, {get:(t,k)=>t[k]??=new THREE.MeshStandardMaterial()})
  const mod={id:'psd',type:'platform-edge',x:0,y:0,z:0,rot:0,w:24,storeyHeight:5,cfg:{name:'PSD',line:'1',side:'left',dir:'up',psd:'full'}}
  const data={...emptyStation(),modules:[mod],lines:[{id:'1',colour:'#c8102e',stock:'B',cars:4,psd:'full'}]}
  const group=buildModule(mod,{data,mats,trackCells:new Set(),finish:()=>mats.steel,owned:[]})
  const named=name=>group.children.filter(c=>c.name===name)
  for(const name of ['psd-door-glass','psd-fixed-glass']) {
   assert.ok(named(name).length>0)
   assert.ok(named(name).every(mesh=>Math.abs(mesh.geometry.parameters.height-2.35)<1e-8))
  }
  assert.ok(named('psd-station-header').every(mesh=>Math.abs(mesh.geometry.parameters.height-.6)<1e-8))
  assert.equal(named('psd-fixed-transom-glass').length,0)
  assert.equal(named('psd-header-padding').length,0)
  const header=named('psd-station-header')[0];assert.ok(header)
  const box=new THREE.Box3().setFromObject(header)
  assert.ok(Math.abs(box.min.z-3.35)<1e-6)
  assert.ok(Math.abs(box.max.z-3.95)<1e-6)
  assert.ok(Math.abs(new THREE.Box3().setFromObject(group).max.z-4)<1e-6)
 } finally {if(old===undefined)delete globalThis.document;else globalThis.document=old}
})

test('suspended ceilings keep fixtures and normal block preview caches unchanged',()=>{
 const light=createModule('light-rectangular',0,0,0,'light',0)
 const state={...toState(emptyStation()),cells:[{x:0,y:0,z:5,fill:'solid'}],modules:[{...light,storeyHeight:5}]}
 const cells=[[0,0,4]]
 const check=checkBlockCells(state,cells)
 const occupied=blockIndex(state.cells,state.modules)
 const result=addSuspendedCeiling(state,cells)
 assert.equal(result.changed,check.acceptedCells.length)
 assert.equal(result.blocked,check.blockedCells.length)
 assert.equal(result.state.modules,state.modules,'placement never relocates fixtures or copies the module array')
 assert.equal(state.modules[0].z,0)
 assert.equal(blockIndex(state.cells,state.modules),occupied)
 assert.equal(checkBlockCells(state,cells),check,'unchanged hover reuses the normal block verdict')
})

test('suspended ceiling hover and release refuse a fixture collision without moving it',()=>{
 const light={...make('light-circular',3),ceilingAnchored:true}
 const station={...toState(emptyStation()),cells:[{x:0,y:0,z:4,fill:'solid'}],modules:[light]}
 useStore.setState({station,past:[],future:[],tool:'block',suspendedCeiling:true,autoWalls:false,halfWall:false,triangles:false})
 const ghosts=[]
 const scene={setGhost(...args){ghosts.push(args)},setCursor(){},setCollisionHighlight(){},setModulePreview(){},setFencePreview(){}}
 const ctx={scene:()=>scene,drag:{current:null},hover:{current:null},solids:()=>new Set(['0,0,4']),showMeasure(){},clearMeasure(){}}
 const tool=new BlockTool(ctx)
 const event={button:0,buttons:0,clientX:0,clientY:0,shiftKey:false,hit:{cell:[0,0,3],place:[0,0,3],point:[.5,.5,3],normal:[0,0,1],solid:false},preventDefault(){}}
 const expected=checkBlockCells(station,[[0,0,3]])
 assert.deepEqual(expected.blockedCells,[[0,0,3]])
 tool.onMove(event)
 tool.onMove(event)
 assert.equal(ghosts.at(-1)[0],expected.acceptedCells,'hover uses the existing station collision cache')
 assert.equal(ghosts.at(-1)[4],expected.blockedCells)
 assert.equal(useStore.getState().past.length,0,'hover does not commit')
 tool.onDown(event);tool.onUp(event)
 assert.equal(useStore.getState().station,station,'refused release keeps the document intact')
 assert.equal(useStore.getState().past.length,0)
 assert.equal(addSuspendedCeiling(station,[[0,0,3]]).blocked,1)
 useStore.setState({suspendedCeiling:false})
})

test('a hung fitting on a shifted editing base hangs from the block over its own cell',()=>{
 // A station whose editing base is not 0 puts the storey lines off the default
 // arithmetic `lightCeilingZ` reads back off the grid, so the fitting is hung where
 // the aim put it: one cell under the block over its own cell, whatever the base.
 for(const [base,height] of [[0,5],[1,5],[2,5],[3,5],[4,5]]) {
  const cells=[{x:0,y:0,z:base+height,fill:'solid'},{x:0,y:0,z:base+2*height,fill:'solid'}]
  const floor=[0,0,base]
  const aim=hungCeilingAim(floor,floor,base,cells,[],height)
  assert.deepEqual(aim,[0,0,base+height-1])
  const settings={storeyHeight:height,levelBase:base,ceilingAnchored:true}
  const light=createModule('light-circular',aim[0],aim[1],aim[2],'l',0,undefined,'up','lane',[],undefined,settings)
  const vent=createModule('vent',aim[0],aim[1],aim[2],'v',0,undefined,'up','lane',[],undefined,settings)
  assert.equal(lightCeilingZ(light),base+height,`the light hangs from its own block (base ${base}, ${height} m)`)
  assert.equal(ventCeilingZ(vent),base+height)
  assert.equal(moduleEnvelope(light).z1,base+height,'the fitting reserves the room under its own ceiling')
 }
})

test('the actual street plane can ceiling rooms of any height',()=>{
 const light=make('light-circular',-5)
 assert.equal(ceilingMountMissing([],light,[]),false,'the top below-grade storey hangs from the street')
 assert.equal(ceilingMountHeight([],light,[]),4)
 assert.equal(ceilingMountMissing([],make('light-circular',-10),[]),false,'support depends on real geometry, not room height')
 assert.equal(ceilingMountHeight([],make('light-circular',-10),[]),9)
})

test('a roof hanger finds the slab one storey up, and reserves its own steel',()=>{
 const slab=(x,y,z)=>({x,y,z,fill:'solid'})
 const five={id:'h',type:'hanger',x:0,y:0,z:0,rot:0,w:2,cfg:{mount:'roof'},storeyHeight:5}
 assert.equal(hangerRoofZ([slab(0,0,5),slab(1,0,5)],[],five,0,0),5)
 assert.equal(hangerRoofMissing([slab(0,0,5),slab(1,0,5)],[],five),false)
 // A roof hanger is steel carried by the roof a storey up, not a fitting that hangs
 // from the block over its own cell, so its envelope is its bar and posts wherever
 // it stands — never the three-metre drop a ceiling-anchored fitting reserves.
 const built=createModule('hanger-roof',0,0,0,'built',0,2,undefined,'lane',[],undefined,{storeyHeight:5})
 assert.equal(built.ceilingAnchored,undefined,'the factory cannot infer support from station height')
 const box=moduleEnvelope(built)
 assert.equal(box.z1,5)
 assert.ok(box.z0>4,'the envelope is the bar under the roof, not a drop to the floor')
})

test("an exit-bay snap descends the station's own grid, and the ghost is what the click builds",()=>{
 const before=useStore.getState()
 try {
  const exit=createModule('exit-covered-2',0,0,0,'exit')
  const station=toState({...emptyStation(),cells:[],modules:[exit]})
  assert.equal(station.storeyHeight,5)
  let preview=null
  const scene={setModulePreview:(mods)=>{preview=Array.isArray(mods)?mods[0]:mods},setGhost(){},setCursor(){},setCollisionHighlight(){},setFencePreview(){}}
  const tool=new EquipmentTool({scene:()=>scene,hover:{current:null},drag:{current:null}})
  useStore.setState({station,past:[],future:[],tool:'module',moduleType:'escalator',moduleRot:0,rampLength:'medium',escalatorWide:false,escalatorDir:'down'})
  // The hover is over the exit's own floor with no block under the pointer, the
  // open bay the snap exists for; the run must descend its own rise (five metres
  // over nine cells at thirty degrees).
  const pointer={button:0,clientX:0,clientY:0,buttons:0,preventDefault(){},hit:{cell:[0,0,0],place:[0,0,1],point:[.5,.5,1],solid:false}}
  tool.onMove(pointer)
  const spec=escalatorLengthSpec('medium',5)
  assert.ok(preview,'the bay cell accepts the run even where the floor is open')
  assert.equal(preview.from.z,0,'the upper landing stands in the bay')
  assert.equal(preview.to.z,-spec.rise)
  assert.equal(Math.hypot(preview.to.x-preview.from.x,preview.to.y-preview.from.y),spec.run)
  assert.equal(escalatorLength(preview),'medium')
  const placed=tool.buildPlacementModules('escalator',[0,0,0],'commit')[0]
  assert.deepEqual([placed.from,placed.to],[preview.from,preview.to],'the click builds the ghost exactly')
 } finally { useStore.setState(before) }
})

test('five-metre turning stairs save half-storey landings and route through both flights', async()=>{
 const {buildGraph}=await import('../src/sim/station.ts')
 for(const style of ['left90','right90','left180','right180'])for(let rot=0;rot<4;rot++)for(const width of [.68,1.36,2.04]) {
  const mod=createModule(`stair-${style}`,0,0,0,'stair',rot,width,'up','lane',[],undefined,{storeyHeight:5})
  const flights=stairFlights(mod)
  assert.equal(flights[0].to.z,2.5)
  const cells=[mod.from,mod.to].map(p=>({...p,fill:'solid'}))
  const state=addEquipment(toState({...emptyStation(),cells}),mod)
  assert.ok(state.cells.every(c=>Number.isInteger(c.z)),'internal landings do not create off-grid editable blocks')
  const saved=parse(serialize(state)).state
  assert.equal(saved.modules.length,1)
  assert.deepEqual(stairFlights(saved.modules[0]),flights)
  const graph=buildGraph(toData(saved))
  const landing=stairTurnCells(mod)[0]
  const node=graph.nodeIndex.get(`${landing.x},${landing.y},${landing.z}`)
  assert.notEqual(node,undefined)
  assert.equal(graph.nodeZ[node],3.5,'walking surface is 2.5 m above the lower floor')
  assert.equal(graph.servers.filter(s=>s.kind==='stair').length,4,'both directions of both flights remain connected')
 }
})

test('five-metre imports preserve half-storey stair landings before module tags are repaired',()=>{
 const tagged=createModule('stair-left90',0,0,0,'stair',0,.68,'up','lane',[],undefined,{storeyHeight:5})
 const flights=stairFlights(tagged)
 for(const storeyHeight of [undefined,5]) {
  const mod={...tagged,storeyHeight}
  const data={...emptyStation(),cells:[],modules:[mod]}
  const state=toState(data)
  assert.equal(state.modules.length,1,'the owning five-metre profile admits the 2.5 m internal landing')
  assert.deepEqual(stairFlights(state.modules[0]),flights)
  const saved=parse(serialize(state))
  assert.ok(saved.ok)
  assert.equal(saved.state.modules.length,1)
  assert.deepEqual(stairFlights(saved.state.modules[0]),flights)
  assert.equal(toState({...data,modules:[{...mod,to:{...mod.to,z:5.5}}]}).modules.length,0,'outer endpoints must remain integer-grid')
 }
})

test('compact rolling stock keeps cabin floors, rail crowns, door cadence and contact strips aligned',async()=>{
 const {buildTrain,createModelMaterials,disposeModelMaterials,disposeObject}=await import('../src/render/models.ts')
 const {BOGIE_RAIL_Z}=await import('../src/render/models/pieces/TrainBogie.ts')
 const {defaultLine,trackPieceForLine}=await import('../src/build/rail.ts')
 const previous=globalThis.document
 globalThis.document={createElement(){const canvas={width:0,height:0};const {g}=stubCanvas();g.canvas=canvas;canvas.getContext=()=>g;return canvas}}
 const mats=createModelMaterials()
 try {
  const scale=trainScaleForStorey(5), origin=trainOriginForScale(scale)
  const bottom = -1, ceiling = 4
  assert.equal(origin+CABIN_FLOOR_Z*scale-bottom,2,'the floor is two metres above the bottom block')
  assert.equal(scale,.98)
  assert.equal(origin+CABIN_FLOOR_Z*scale,1)
  for(const stock of STOCK_CLASSES)for(const power of ['catenary','third-rail']) {
   const line={...defaultLine('1','up',power,5),stock,cars:2}
   const track=makeTrack({id:'track',lineId:'1',dir:'up',power,storeyHeight:5,x:0,y:0,z:0,w:trackPieceForLine(line).w,d:3,rot:0})
   const data={...emptyStation(),modules:[track],lines:[line]}
   const root=buildTrain(mats,{x:0,y:0,z:origin,stock,cars:2,power,modelScale:scale,colour:'#287db2',dirSign:1,doorsOpen:false,yaw:0})
   const rail=buildModule(track,{data,mats,trackCells:new Set(),finish:()=>mats.steel,owned:[]})
   try {
    assert.deepEqual(root.scale.toArray(),[.98,.98,.98])
    assert.equal(trainLength(line),trainLength({...line,modelScale:1})*.98)
    assert.deepEqual(doorCentres(line),doorCentres({...line,modelScale:1}).map(x=>x*.98))
    rail.updateMatrixWorld(true)
    const crown=new THREE.Raycaster(new THREE.Vector3(2,1.5+.7525*.98,2),new THREE.Vector3(0,0,-1)).intersectObject(rail,true)[0]
    assert.ok(crown,'actual compact rail remains below the wheel centreline')
    assert.ok(Math.abs(crown.point.z-(origin+BOGIE_RAIL_Z*scale))<1e-6)
    const bed=rail.getObjectByName('track-bed')
    assert.ok(Math.abs(new THREE.Box3().setFromObject(bed).min.z+1)<1e-6,'concrete fills the dug block down to its integer-grid underside')
    root.updateMatrixWorld(true)
    assert.ok(new THREE.Box3().setFromObject(root).max.z <= ceiling,'the body and collector fit the three metres above the floor')
    assert.ok(new THREE.Box3().setFromObject(rail).max.z-bottom <= 5+1e-6,'the complete covered overhead assembly fits five metres from the bottom block')
    const collectors=root.children.filter(c=>c.name==='train-pantograph')
    assert.equal(collectors.length,power==='catenary'?2:0)
    for(const pan of collectors) {
     const strip=pan.getObjectByName('pantograph-contact-strip')
     assert.ok(Math.abs(new THREE.Box3().setFromObject(strip).max.z-3.891)<1e-5)
     const arm=pan.getObjectByName('pantograph-lower-arm')
     const along=new THREE.Vector3(0,1,0).applyQuaternion(arm.quaternion)
     assert.ok(Math.asin(Math.abs(along.z))*180/Math.PI<10,'lower linkage is flatter than the original collector')
    }
   }finally{disposeObject(root);disposeObject(rail)}
  }
 }finally{disposeModelMaterials(mats);globalThis.document=previous}
})


test('covered and tunnel clearances use a five-metre bottom-to-ceiling envelope, with open gantries independent',async()=>{
 const {boreTunnel}=await import('../src/build/model/TunnelShell.ts')
 for(const power of ['catenary','third-rail'])for(let rot=0;rot<4;rot++) {
  const track=makeTrack({id:'tunnel',lineId:'1',dir:'up',power,storeyHeight:5,x:0,y:0,z:0,w:4,d:3,rot,tunnel:true})
  const state=boreTunnel(toState({...emptyStation(),modules:[track]}),track)
  const ceiling=track.z+trackHeadroom(track)+1
  assert.equal(ceiling-(track.z-1),5)
  assert.ok(state.cells.some(c=>c.z===ceiling&&c.tags?.includes('tunnel-shell:tunnel')))
  assert.ok(!state.cells.some(c=>c.z>ceiling),'the tunnel tool does not add an extra overhead course')
 }
 for(const cfg of [{bridge:true},{catenaryStyle:'gantry'}]) {
  const open=makeTrack({id:'open',lineId:'1',dir:'up',power:'catenary',storeyHeight:5,x:0,y:0,z:0,w:4,d:3,rot:0,...cfg})
  assert.equal(trackHeadroom(open),4,'open overhead structures keep their taller allowance')
 }
})


test('covered wire inherits the station profile and hangs directly from the ceiling with no extra plate',async()=>{
 const {createModelMaterials,disposeModelMaterials,disposeObject}=await import('../src/render/models.ts')
 const previous=globalThis.document
 globalThis.document={createElement(){const canvas={width:0,height:0};const {g}=stubCanvas();g.canvas=canvas;canvas.getContext=()=>g;return canvas}}
 const mats=createModelMaterials()
 try {
  const mod=makeTrack({id:'covered',lineId:'1',dir:'up',power:'catenary',x:0,y:0,z:0,w:4,d:3,rot:0})
  const data={...emptyStation(),modules:[mod]}
  const root=buildModule(mod,{data,mats,trackCells:new Set(),finish:()=>mats.steel,owned:[]})
  try {
   assert.equal(root.getObjectByName('catenary-canopy'),undefined)
   assert.equal(root.getObjectByName('catenary-canopy-fascia'),undefined)
   const wire=root.getObjectByName('catenary-contact-wire')
   assert.ok(Math.abs(new THREE.Box3().setFromObject(wire).min.z-3.891)<1e-6,'untagged track uses its five-metre station profile')
   const plate=root.getObjectByName('catenary-ceiling-plate')
   assert.ok(Math.abs(new THREE.Box3().setFromObject(plate).max.z-4)<1e-6,'mount touches the underside of the next floor block')
   assert.ok(new THREE.Box3().setFromObject(root).max.z <= 4+1e-6)
  }finally{disposeObject(root)}
 }finally{disposeModelMaterials(mats);globalThis.document=previous}
})

test('the app opens and newStation both open on the five-metre grid', () => {
  assert.equal(coldBootStation.storeyHeight, 5, 'cold boot document keeps the five-metre grid')
  assert.equal(coldBootStation.seed, 7654321, 'cold boot seed')
  useStore.getState().newStation()
  const s = useStore.getState().station
  assert.equal(s.storeyHeight, 5, 'newStation keeps the five-metre grid')
  assert.equal(s.name, emptyStation().name, 'newStation opens an unnamed station')
  assert.equal(s.seed, 7654321)
  const steps = levelSteps(s.levelBase, s.storeyHeight)
  assert.equal(steps[1] - steps[0], 5, 'the altitude rail steps by five metres, not four')
  assert.ok(steps.includes(0), 'the origin is one of the altitude stops')
})
