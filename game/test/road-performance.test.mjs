import test from 'node:test'
import assert from 'node:assert/strict'
import { equipmentReason, moduleFloorOk, placementOnTrack, placementColliders } from '../src/sim/placement.ts'
import { roadsOnlyChange } from '../src/sim/roads.ts'
import { retainedModuleIds } from '../src/render/moduleDependencies.ts'
import { isCosmeticStationEdit } from '../src/sim/cosmeticEdit.ts'
import { createModule } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { ROAD_LANE_WIDTH } from '../src/sim/constants.ts'

const road = {id:'road',type:'road',x:40,y:0,z:0,w:12,d:96,rot:0,cfg:{direction:'two-way'}}
// Independent original verdict: an optimization must preserve preview/refusal semantics.
function originalReason(cells,modules,r) {
  const width=(r.rot??0)%2?r.d:r.w
  if(width<(r.cfg.direction==='two-way'?ROAD_LANE_WIDTH*2:ROAD_LANE_WIDTH))return 'road-width'
  if(r.z<0||!moduleFloorOk(cells,modules,r))return 'road-ground'
  if(placementOnTrack(cells,r,modules))return 'track'
  if(cells.some(c=>c.fill==='solid'&&c.z>r.z&&c.z<=r.z+4&&c.x>=r.x&&c.x<r.x+r.w&&c.y>=r.y&&c.y<r.y+r.d))return 'occupied'
  return placementColliders(modules,r).length?'occupied':''
}
test('road preview prepares cells once instead of scanning the document per square metre',()=>{
  let reads=0
  const cells=Array.from({length:2000},(_,i)=>new Proxy({x:-100,y:i,z:0,fill:'solid'},{get(target,key){if(key==='x')reads++;return target[key]}}))
  const modules=[]
  assert.equal(equipmentReason(cells,modules,road),'')
  assert.ok(reads<=cells.length*2,'cold validation is linear in document cells, not road area times document cells')
  reads=0
  for(let i=0;i<12;i++)assert.equal(equipmentReason(cells,modules,{...road,d:96+i}),'')
  assert.equal(reads,0,'warm previews reuse the document index across different extents')
  const blocked=[...cells,{x:40,y:0,z:1,fill:'solid'}]
  assert.equal(equipmentReason(blocked,modules,road),'occupied','a new cell array invalidates the index')
  assert.equal(equipmentReason(cells,modules,road),'','preparing a later document never poisons the earlier one')
  const tracks=[{id:'track',type:'track',x:40,y:0,z:0,w:16,d:4,rot:0,cfg:{line:'5'}}]
  assert.equal(equipmentReason(cells,tracks,road),'track','new modules invalidate the track index')
})
test('indexed road verdict agrees with the original for ground holes, exits, tracks, slabs and rotations',()=>{
  const floors=Array.from({length:20*20},(_,i)=>({x:i%20-5,y:Math.floor(i/20)-5,z:4,fill:'solid'}))
  const exit=createModule('exit',0,0,0,'exit')
  const ramp=createModule('stair',0,4,-4,'ramp')
  const fixtures=[
    {cells:[],modules:[]},
    {cells:[{x:0,y:0,z:0,fill:'void'}],modules:[]},
    {cells:floors,modules:[]},
    {cells:[{x:0,y:0,z:0,fill:'solid',finish:{top:'floor.track'}}],modules:[]},
    {cells:[],modules:[exit,ramp].filter(Boolean)},
    {cells:[],modules:[{id:'track',type:'track',x:0,y:0,z:1,w:16,d:4,rot:1,cfg:{line:'5'}}]},
  ]
  for(const {cells,modules} of fixtures)for(const x of [-2,0,5,30])for(const z of [0,4])for(let rot=0;rot<4;rot++) {
    const r={...road,x,y:0,z,rot,w:6,d:8}
    assert.equal(equipmentReason(cells,modules,r),originalReason(cells,modules,r),JSON.stringify({x,z,rot}))
  }
})
test('road-only edits retain equipment models, rebuild road ink, and still invalidate pedestrian routing',()=>{
  const bench=createModule('bench',0,0,0,'bench'),before={...emptyStation(),modules:[bench,road]}
  const crossing={...road,id:'crossing',x:0,y:30,w:100,d:6,rot:1}
  const after={...before,modules:[...before.modules,crossing]}
  assert.equal(roadsOnlyChange(before,after),true)
  assert.deepEqual([...retainedModuleIds(before,after)],['bench'])
  assert.equal(isCosmeticStationEdit(before,after),false,'roads must still rebuild the walk graph')
  for(const next of [
    {...after,cells:[{x:0,y:0,z:0,fill:'solid'}]},
    {...after,name:'renamed'},
    {...after,modules:[{...bench,x:1},road,crossing]},
    {...after,modules:[...after.modules,createModule('gate',5,0,0,'gate')]},
  ]) assert.equal(roadsOnlyChange(before,next),false,'other changes fail closed')
  assert.equal(roadsOnlyChange(before,{...before,modules:[bench]}),true,'road removals rebuild surviving ink too')
})

test('ModuleSystem keeps actual equipment geometry during a road edit and disposes replaced road materials',async()=>{
  const THREE=await import('three')
  const {ModuleSystem}=await import('../src/render/scene/systems/ModuleSystem.ts')
  const {createModelMaterials,disposeModelMaterials}=await import('../src/render/models.ts')
  const {stubCanvas}=await import('./support/stub-canvas.mjs')
  const previous=globalThis.document
  globalThis.document={createElement:()=>{const {g}=stubCanvas(),node={width:0,height:0,getContext:()=>g};g.canvas=node;return node}}
  let mats,modules;const blob=new THREE.MeshBasicMaterial()
  try {
    mats=createModelMaterials()
    const ctx={scene:new THREE.Scene(),mats:{blob,finish:()=>mats.white},modelMats:mats,ads:{},groundOf:new Map(),levelBase:0,ownedMats:[]}
    modules=new ModuleSystem(ctx)
    modules.ghost={clearFencePreview(){}}
    modules.plates={retainTvPlates(){},retainSignPlates(){},retainDecorPlates(){},clearTvPlates(){},clearSignPlates(){},clearDecorPlates(){},ownsTexture:()=>false,adScreens:[],tvScreens:[]}
    modules.trains={psdGroups:[]};modules.lifts={escalatorRolls:[],liftRigs:[],liftPickMeshes:[]};modules.clocks={clockRigs:[]};modules.crowd={gateWings:[]}
    const bench=createModule('bench',0,0,0,'bench'),before={...emptyStation(),modules:[bench,road]}
    modules.buildModules(before,new Set())
    const benchGroup=modules.moduleMeshes.children.find(g=>g.userData.moduleId==='bench')
    const oldRoad=modules.moduleMeshes.children.find(g=>g.userData.moduleId==='road')
    let disposed=0;oldRoad.userData.ownedMaterials[0].addEventListener('dispose',()=>disposed++)
    const crossing={...road,id:'crossing',x:0,y:30,w:100,d:6,rot:1}
    modules.buildModules({...before,modules:[bench,road,crossing]},new Set(),true)
    assert.ok(modules.moduleMeshes.children.includes(benchGroup),'the original equipment group and its geometry survive')
    assert.ok(!modules.moduleMeshes.children.includes(oldRoad),'road ink is rebuilt for the intersection')
    assert.equal(disposed,1,'replaced road materials are disposed once')
    modules.clearModules();assert.equal(disposed,1,'teardown cannot dispose already replaced road materials twice')
  } finally {modules?.clearModules();if(mats)disposeModelMaterials(mats);blob.dispose();globalThis.document=previous}
})
