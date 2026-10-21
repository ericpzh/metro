import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { geometryDetailReady } from '../src/render/geometryDetail.ts'
import { ChunkSystem } from '../src/render/scene/systems/ChunkSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { TrainSystem } from '../src/render/scene/systems/TrainSystem.ts'
import { createModelMaterials,disposeModelMaterials,setDoorsSides } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'
import { SourceGeometryDetail } from '../src/render/sourceGeometryDetail.ts'
import { BATCH_SOURCE_LAYER } from '../src/render/batchGeometry.ts'
await geometryDetailReady

test('unbatched moving equipment keeps mesh identity, exact picks and original disposal ownership',()=>{
  const root=new THREE.Group(),geometry=new THREE.SphereGeometry(1,48,24),material=new THREE.MeshStandardMaterial()
  const wing=new THREE.Mesh(geometry,material),hidden=wing.clone(),batched=wing.clone()
  hidden.visible=false;batched.layers.set(BATCH_SOURCE_LAYER);root.add(wing,hidden,batched)
  const ray=new THREE.Raycaster(new THREE.Vector3(.2,.1,4),new THREE.Vector3(0,0,-1)),raycast=wing.raycast
  const hits=ray.intersectObject(wing).map(h=>h.point.toArray()),matrix=wing.matrix
  const detail=new SourceGeometryDetail();detail.apply(root,false);assert.equal(wing.geometry,geometry)
  detail.apply(root,true);const far=wing.geometry;assert.notEqual(far,geometry)
  assert.equal(hidden.geometry,geometry);assert.equal(batched.geometry,geometry)
  assert.equal(wing.matrix,matrix);assert.deepEqual(ray.intersectObject(wing).map(h=>h.point.toArray()),hits)
  assert.equal(wing.geometry,far)
  detail.restore();assert.equal(wing.geometry,geometry);assert.equal(wing.raycast,raycast)
  let disposed=0;far.addEventListener('dispose',()=>disposed++)
  geometry.dispose();assert.equal(disposed,1);material.dispose()
})

test('chunk detail keeps original ray hits and restores shared full geometry before release',()=>{
  const ctx=new SceneContextData(new THREE.Scene(),{},{},{}),chunks=new ChunkSystem(ctx)
  const near=new THREE.SphereGeometry(1,48,24),mesh=new THREE.Mesh(near,new THREE.MeshBasicMaterial())
  const ray=new THREE.Raycaster(new THREE.Vector3(.2,.1,4),new THREE.Vector3(0,0,-1))
  const fullHits=ray.intersectObject(mesh).map(h=>h.point.toArray())
  const originalCast=mesh.raycast
  chunks.setGeometryDetail(mesh,false);chunks.setGeometryDetail(mesh,true)
  const far=mesh.geometry;assert.notEqual(far,near)
  assert.deepEqual(ray.intersectObject(mesh).map(h=>h.point.toArray()),fullHits)
  assert.equal(mesh.geometry,far,'picking restores the drawn approximation')
  chunks.setGeometryDetail(mesh,false);assert.equal(mesh.geometry,near)
  chunks.setGeometryDetail(mesh,true)
  let farDisposal=0,nearDisposal=0
  far.addEventListener('dispose',()=>farDisposal++);near.addEventListener('dispose',()=>nearDisposal++)
  chunks.chunkMeshes=[mesh];chunks.releaseChunks()
  assert.equal(mesh.geometry,near);assert.equal(mesh.raycast,originalCast)
  assert.equal(farDisposal,1);assert.equal(nearDisposal,1)
  chunks.disposeChunks();mesh.material.dispose()
})

test('other-floor train geometry reduces without changing doors, and Low quality stays reduced in Hide UI',()=>{
  const previous=globalThis.document
  globalThis.document={createElement:()=>{const c={width:0,height:0};const {g}=stubCanvas();g.canvas=c;c.getContext=()=>g;return c}}
  let mats,trains
  try {
    mats=createModelMaterials()
    const ctx=new SceneContextData(new THREE.Scene(),{},mats,{})
    trains=new TrainSystem(ctx);trains.level={applyGroupLevel(g){g.visible=true}}
    trains.setTrains(new Float32Array([0,0,1,1,0,0,0x336699,1,0,1]))
    const group=trains.trainGroup.children[0],details=trains.details.get(group),swapped=details.filter(d=>d.far)
    assert.ok(swapped.length>0)
    assert.ok(swapped.every(d=>d.near instanceof THREE.BufferGeometry&&d.far instanceof THREE.BufferGeometry))
    setDoorsSides(group,.5,0);group.updateMatrixWorld(true)
    const doors=group.userData.doors.map(d=>d.position.toArray())
    ctx.activeZ=4;trains.updateGeometryDetail()
    assert.ok(swapped.every(d=>d.mesh.geometry===d.far))
    assert.deepEqual(group.userData.doors.map(d=>d.position.toArray()),doors)
    ctx.hideUI=true;ctx.graphicsQuality='low';trains.updateGeometryDetail()
    assert.ok(swapped.every(d=>d.mesh.geometry===d.far),'Hide UI preserves the chosen Low quality')
    ctx.hideUI=false;trains.updateGeometryDetail();assert.ok(swapped.every(d=>d.mesh.geometry===d.far))
    ctx.detailEnabled=false;trains.updateGeometryDetail();assert.ok(swapped.every(d=>d.mesh.geometry===d.near))
    let disposed=0;swapped.forEach(d=>d.far.addEventListener('dispose',()=>disposed++))
    trains.dispose();assert.equal(disposed,swapped.length,'every prepared approximation is released exactly once')
  } finally {trains?.dispose();if(mats)disposeModelMaterials(mats);globalThis.document=previous}
})


test('PSD base wins the platform block volume; no-screen restores it and invalidates chunk reuse', async () => {
 const { emptyStation }=await import('../src/data/reference-station.ts')
 const { rotateLocal }=await import('../src/sim/track.ts')
 for(const side of ['left','right'])for(const rot of [0,1,2,3]) {
  const material=new THREE.MeshStandardMaterial()
  const ctx=new SceneContextData(new THREE.Scene(),{finish:()=>material,outline:material},{},{})
  const chunks=new ChunkSystem(ctx)
  const edge={id:'edge',type:'platform-edge',x:15,y:15,z:4,w:2,rot,cfg:{line:'1',side,psd:'half'}}
  const [runX,runY]=rotateLocal(rot,1,0)
  const cells=[0,1].map(i=>({x:edge.x+i*runX,y:edge.y+i*runY,z:4,fill:'solid'}))
  const data={...emptyStation(),cells,modules:[edge]}
  const toward=side==='right'?1:-1
  const hit=(i,across)=> {
   const [dx,dy]=rotateLocal(rot,i,toward*across)
   for(const mesh of chunks.chunkMeshes)mesh.updateMatrixWorld(true)
   return new THREE.Raycaster(new THREE.Vector3(edge.x+.5+dx,edge.y+.5+dy,8),new THREE.Vector3(0,0,-1)).intersectObjects(chunks.chunkMeshes)
  }
  try {
   chunks.prepareStation(data,cells);chunks.meshStation()
   const geometries=chunks.chunkMeshes.map(m=>m.geometry)
   for(const i of [0,1]) {
    assert.equal(hit(i,.34).length,0,'the complete block column under the frame is cut out')
    assert.ok(hit(i,.18).some(h=>Math.abs(h.point.z-5)<1e-6),'yellow line keeps its platform foundation')
   }
   chunks.prepareStation({...data,modules:[{...edge,cfg:{...edge.cfg,psd:'full'}}]},cells);chunks.meshStation()
   assert.deepEqual(chunks.chunkMeshes.map(m=>m.geometry),geometries,'same base footprint retains identical chunks')
   chunks.prepareStation({...data,modules:[{...edge,cfg:{...edge.cfg,psd:'none'}}]},cells);chunks.meshStation()
   for(const i of [0,1])assert.ok(hit(i,.34).some(h=>Math.abs(h.point.z-5)<1e-6),'no PSD restores the full platform block')
   assert.ok(chunks.chunkMeshes.every(m=>!geometries.includes(m.geometry)),'removing a PSD cannot reuse a carved chunk')
  } finally {chunks.disposeChunks();material.dispose()}
 }
})
