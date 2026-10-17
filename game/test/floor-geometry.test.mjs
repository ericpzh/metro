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

test('other-floor train geometry reduces without changing doors, and Hide UI/full-detail controls restore originals',()=>{
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
    assert.ok(swapped.every(d=>d.mesh.geometry===d.near))
    ctx.hideUI=false;trains.updateGeometryDetail();assert.ok(swapped.every(d=>d.mesh.geometry===d.far))
    ctx.detailEnabled=false;trains.updateGeometryDetail();assert.ok(swapped.every(d=>d.mesh.geometry===d.near))
    let disposed=0;swapped.forEach(d=>d.far.addEventListener('dispose',()=>disposed++))
    trains.dispose();assert.equal(disposed,swapped.length,'every prepared approximation is released exactly once')
  } finally {trains?.dispose();if(mats)disposeModelMaterials(mats);globalThis.document=previous}
})
