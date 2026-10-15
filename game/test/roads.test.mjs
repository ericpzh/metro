import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { roadFromDrag, roadLayout, roadInkIntervals, roadTrafficPose, roadContainsPoint, roadMoveClear } from '../src/sim/roads.ts'
import { PASSENGER_OPACITY } from '../src/sim/constants.ts'
import { equipmentReason, moduleFootprint } from '../src/sim/placement.ts'
import { groundWindow } from '../src/sim/ground.ts'
import { addEquipment, toState } from '../src/build/model.ts'
import { emptyStation as emptyData } from '../src/data/reference-station.ts'
const emptyStation = () => toState(emptyData())
import { serialize, parse } from '../src/persistence/save.ts'
import { RoadTool } from '../src/app/tools/RoadTool.ts'
import { useStore } from '../src/app/store.ts'
import { RoadModel } from '../src/render/models/pieces/RoadModel.ts'
import { roadVehicleParts } from '../src/render/models/pieces/RoadVehicleModel.ts'

const road = (w = 6, d = 40, direction = 'two-way') => ({ id: 'road-a', type: 'road', x: 0, y: 0, z: 0, rot: 0, w, d, cfg: { direction } })
test('road widths derive whole lanes, equal opposing directions, and long-axis drags', () => {
  for (const [width, one, two] of [[3,1,0],[5,1,0],[6,2,2],[9,3,2],[12,4,4],[18,6,6]]) {
    assert.equal(roadLayout(road(width,40,'one-way')).lanes, one)
    assert.equal(roadLayout(road(width)).lanes, two)
  }
  const r = roadFromDrag([39,5,0],[0,0,0],2,'one-way','r')
  assert.deepEqual([r.x,r.y,r.w,r.d,r.rot],[0,0,40,6,3])
  assert.equal(roadLayout(r).lanes,2)
})
test('roads share intersections but require complete supported ground at nonnegative heights', () => {
  const a = road(), cross = {...road(40,6),id:'b',x:-10,y:10,rot:1}
  assert.equal(equipmentReason([], [a], cross),'')
  assert.equal(equipmentReason([],[],{...a,z:-1}),'road-ground')
  assert.equal(equipmentReason([],[],{...a,z:4}),'road-ground')
  assert.equal(equipmentReason([{x:2,y:2,z:0,fill:'void'}],[],a),'road-ground')
  assert.equal(equipmentReason([],[],road(5)),'road-width')
  const cells = moduleFootprint(a).map(([x,y])=>({x,y,z:4,fill:'solid'}))
  assert.equal(equipmentReason(cells,[],{...a,z:4}),'')
  assert.equal(equipmentReason([{x:3,y:3,z:1,fill:'solid'}],[],a),'occupied')
  assert.ok(groundWindow([], [a]).y1 >= 39)
})
test('crossings and T junctions remove all lane and edge ink only on the shared plane', () => {
  const a = road(), cross = {...road(40,6),id:'b',x:-10,y:10,rot:1}
  for (const offset of [.16,2.87,3.13,5.84]) assert.deepEqual(roadInkIntervals(a,[a,cross],offset),[[0,10],[16,40]])
  assert.deepEqual(roadInkIntervals(a,[{...cross,z:4}],3),[[0,40]])
  const t = {...cross,x:3,w:20}
  assert.deepEqual(roadInkIntervals(a,[t],.16),[[0,40]])
  assert.deepEqual(roadInkIntervals(a,[t],5.84),[[0,10],[16,40]])
})
test('ambient traffic is seeded, follows lane directions, stays inside its road and uses the requested vehicle mix and density', () => {
  const a = road(12,120), kinds = new Set(), counts={car:0,bus:0,scooter:0}, candidates=1000
  for (let lane=0;lane<4;lane++) for(let slot=0;slot<250;slot++) {
    const p = roadTrafficPose(a,lane,slot,100,42)
    assert.deepEqual(p,roadTrafficPose(a,lane,slot,100,42))
    if(p.spawn) { kinds.add(p.kind); counts[p.kind]++ }
    assert.equal(p.sign,lane<2?-1:1)
    if(p.visible) { assert.ok(p.along>=p.size/2); assert.ok(p.along<=120-p.size/2) }
  }
  assert.equal(kinds.size,3)
  const spawned=counts.car+counts.bus+counts.scooter
  assert.ok(spawned/candidates >= .45 && spawned/candidates <= .55)
  assert.ok(counts.bus/spawned >= .07 && counts.bus/spawned <= .13)
  assert.ok(counts.scooter/spawned >= .55 && counts.scooter/spawned <= .65)
  for(const kind of kinds) {
    const parts = roadVehicleParts(kind)
    const bounds = new THREE.Box3()
    for(const part of parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox); part.geometry.dispose();part.material.dispose() }
    assert.ok(bounds.max.z > 1.4 && bounds.max.y-bounds.min.y > 1.5,kind)
  }
})
test('road model emits actual asphalt, yellow centre and white ink; saved geometry round trips', () => {
  const a = road(12), white = new THREE.MeshStandardMaterial({color:0xffffff}),owned=[]
  const model = new RoadModel({data:{modules:[a]},mats:{white},owned}).build(a)
  assert.ok(model.children.length>5)
  assert.equal(model.children.filter(m=>m.material.color.getHex()===0xf7c83c).length,2)
  for(const child of model.children) child.geometry.dispose()
  for(const material of owned) material.dispose()
  white.dispose()
  const state = addEquipment(emptyStation(),a)
  const result = parse(serialize(state))
  assert.ok(result.ok)
  assert.deepEqual(result.state.modules.find(m=>m.id===a.id),a)
})
test('road gesture previews without commits, uses one press pick, commits once, undoes and erases', () => {
  const state=emptyStation(),drag={current:null},hover={current:null};let picks=0,preview
  const scene={pickModule:()=>{picks++;return null},setGhost(){},setCursor(){},setModulePreview:m=>{preview=m}}
  useStore.setState({station:state,past:[],future:[],tool:'module',moduleType:'road',moduleRot:0,roadDirection:'two-way'})
  const tool=new RoadTool({scene:()=>scene,pickModule:()=>{picks++;return null},drag,hover,clearMeasure(){},showMeasure(){}})
  const event=(x,y,button=0)=>({clientX:x,clientY:y,button,buttons:button===2?2:1,shiftKey:false,preventDefault(){},hit:{cell:[x,y,0],place:[x,y,1],solid:true}})
  tool.onDown(event(0,0));tool.onMove(event(5,39))
  assert.equal(picks,1)
  assert.equal(useStore.getState().past.length,0)
  assert.equal(preview[0].d,40)
  tool.onUp(event(5,39))
  assert.equal(useStore.getState().past.length,1)
  assert.equal(useStore.getState().station.modules.length,1)
  tool.onDown(event(0,0,2));tool.onUp(event(5,39,2))
  assert.equal(useStore.getState().station.modules.length,0)
  useStore.getState().undo()
  assert.equal(useStore.getState().station.modules.length,1)
})

test('traffic instances stop while paused, advance with sim snapshots, follow visibility, and dispose', async () => {
  const { RoadTrafficSystem } = await import('../src/render/scene/systems/RoadTrafficSystem.ts')
  const ctx={scene:new THREE.Scene(),stationData:{modules:[road(12,120)],seed:42},lastStateTime:0,stateIntervalMs:1000,activeZ:0,ghost:false,hideGround:false,cutaway:false}
  const roots=new THREE.Group(),root=new THREE.Group();root.userData.moduleId='road-a';roots.add(root)
  const traffic=new RoadTrafficSystem(ctx)
  traffic.setSimTime(100);traffic.update(1000,roots)
  const meshes=ctx.scene.children[0].children
  assert.ok(meshes.some(m=>m.count>0))
  const mesh=meshes.find(m=>m.count>0),first=Array.from(mesh.instanceMatrix.array),version=mesh.instanceMatrix.version
  traffic.update(2000,roots)
  assert.equal(mesh.instanceMatrix.version,version,'paused buffers stay unchanged')
  traffic.setSimTime(101);traffic.update(1000,roots)
  assert.notDeepEqual(Array.from(mesh.instanceMatrix.array),first)
  assert.ok(meshes.every(m=>m.count<=192))
  root.visible=false;traffic.update(1000,roots)
  assert.ok(meshes.every(m=>m.count===0))
  let disposed=0;for(const m of meshes)m.addEventListener('dispose',()=>disposed++)
  traffic.dispose();assert.equal(disposed,meshes.length);assert.equal(ctx.scene.children.length,0)
})

test('road controls quarter-turn the footprint and picker rotations stay finite', () => {
  useStore.setState({moduleType:'road',moduleRot:0,roadDirection:'two-way'})
  const s=useStore.getState()
  s.rotateModule();assert.equal(useStore.getState().moduleRot,3)
  s.setModuleRot(1);assert.equal(useStore.getState().moduleRot,1)
  s.rotateModule();assert.equal(useStore.getState().moduleRot,0)
  s.toggleRoadDirection();assert.equal(useStore.getState().roadDirection,'one-way')
  s.toggleRoadDirection();assert.equal(useStore.getState().roadDirection,'two-way')
})

test('R and Tab immediately refresh the held road preview and release matches it', () => {
  const drag={current:null},hover={current:null};let preview
  const scene={setGhost(){},setCursor(){},setModulePreview:m=>{preview=m}}
  useStore.setState({station:emptyStation(),past:[],future:[],tool:'module',moduleType:'road',moduleRot:0,roadDirection:'two-way'})
  const tool=new RoadTool({scene:()=>scene,pickModule:()=>null,drag,hover,clearMeasure(){},showMeasure(){}})
  const event=(x,y)=>({clientX:x,clientY:y,button:0,buttons:1,shiftKey:false,preventDefault(){},hit:{cell:[x,y,0],place:[x,y,1],solid:true}})
  tool.onDown(event(0,0));tool.onMove(event(5,19))
  assert.deepEqual([preview[0].w,preview[0].d],[6,20])
  useStore.getState().rotateModule();tool.refreshHover()
  assert.deepEqual([preview[0].w,preview[0].d],[20,6])
  useStore.getState().toggleRoadDirection();tool.refreshHover()
  assert.equal(preview[0].cfg.direction,'one-way')
  const expected={...preview[0]};tool.onUp(event(5,19))
  assert.deepEqual({...useStore.getState().station.modules[0],id:expected.id},expected)
  useStore.setState({tool:'block'});preview=null;tool.refreshHover();assert.equal(preview,null)
})
test('every vehicle material is grayscale with the same opacity as passengers', () => {
  for(const kind of ['car','bus','bike','scooter']) for(const {geometry,material} of roadVehicleParts(kind)) {
    assert.equal(material.color.r,material.color.g);assert.equal(material.color.g,material.color.b)
    assert.equal(material.opacity,PASSENGER_OPACITY);assert.equal(material.transparent,true);assert.equal(material.depthWrite,false)
    geometry.dispose();material.dispose()
  }
})
test('roads remove walking nodes on their own floor and swept moves cannot enter or cross them', async () => {
  const {buildGraph,cellKey}=await import('../src/sim/station.ts')
  const a=road(6,20),data={...emptyData(),modules:[a]}
  const g=buildGraph(data)
  for(const [x,y] of moduleFootprint(a)) assert.equal(g.nodeIndex.has(cellKey(x,y,0)),false)
  assert.ok(g.nodeIndex.has(cellKey(-1,0,0)))
  assert.ok(g.nodeIndex.has(cellKey(6,0,0)))
  for(const [x,y,nx,ny] of [[-1,5,7,5],[-.1,-.1,.1,.1],[-.5,5,.5,5]]) assert.equal(roadMoveClear([a],x,y,nx,ny,0),false)
  assert.equal(roadMoveClear([a],-1,5,7,5,4),true)
  assert.equal(roadMoveClear([a],-1,5,-1,10,0),true)
  const elevated=moduleFootprint(a).map(([x,y])=>({x,y,z:4,fill:'solid'}))
  const above=buildGraph({...data,cells:elevated})
  assert.ok(above.nodeIndex.has(cellKey(1,1,4)))
  assert.equal(roadContainsPoint([a],1,1,0),true)
})
test('crowd pressure cannot push onto a road; paving beneath existing walkers relocates them', async () => {
  const {World}=await import('../src/sim/world.ts')
  const a=road(6,20),w=new World({...emptyData(),modules:[a]},42)
  const agent=w.pool.spawn({origin:'',stops:[],dest:''},-.1,5.5,1,0)
  for(let i=0;i<30;i++)w.tryMove(agent,.2,5.5,true)
  assert.ok(agent.x<0)
  w.tryMove(agent,6.5,5.5,true);assert.ok(agent.x<0,'no tunnelling across a road')
  const inside=w.pool.spawn({origin:'',stops:[],dest:''},2.5,5.5,1,0)
  w.rebuild()
  assert.equal(roadContainsPoint([a],inside.x,inside.y,0),false)
})

test('the real ghost cache invalidates on road extent, rotation and direction changes', async () => {
  const {moduleGhostKey}=await import('../src/render/moduleGhostKey.ts')
  const a=road(),key=moduleGhostKey(a)
  for(const b of [{...a,w:12},{...a,d:41},{...a,rot:1},{...a,cfg:{direction:'one-way'}}]) assert.notEqual(key,moduleGhostKey(b))
})
