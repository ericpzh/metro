import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { unzlibSync } from '../node_modules/three/examples/jsm/libs/fflate.module.js'
import * as THREE from '../node_modules/three/build/three.module.js'
import {createImportedSoftHuman} from '../../model/src/soft-human/imported-base.js'
import { ACTIVITY_NAMES } from '../src/sim/activities.ts'
import asset from '../src/assets/passenger-activities.json' with { type: 'json' }
import human from '../src/assets/passenger-approved.json' with { type: 'json' }

const bytes=value=>unzlibSync(Buffer.from(value,'base64'))
const data=new Float32Array(bytes(asset.data).buffer),matrices=new Float32Array(bytes(asset.matrices).buffer)
const indices=new Uint32Array(bytes(asset.indices).buffer),low=new Uint32Array(bytes(asset.lowIndices).buffer)
function paletteMatrix(rig,fit,action,frame,bone,hand=0){
 const at=(((((rig*asset.fits.length+fit)*asset.handModes.length+hand)*(asset.activities.length+3)+action)*asset.samples+frame)*asset.boneCount+bone)*16
 return new THREE.Matrix4().fromArray(matrices,at)
}
test('the actual activity asset covers every reviewed export with flat palettes and bounded full/Low topology',()=>{
 assert.deepEqual(asset.activities,[...ACTIVITY_NAMES]);assert.equal(asset.library.length,human.library.length)
 assert.equal(data.length,asset.vertices*16)
 assert.deepEqual(asset.handModes,['default','right','left'])
 assert.equal(matrices.length,asset.rigs.length*asset.fits.length*asset.handModes.length*(asset.activities.length+3)*asset.samples*asset.boneCount*16)
 assert.ok(matrices.every(Number.isFinite));assert.ok(data.every(Number.isFinite))
 assert.ok(asset.corners<=human.corners);assert.ok(asset.lowCorners<=human.lowCorners)
 for(let v=0;v<asset.vertices;v++){
  const offset=v*16,weights=data.slice(offset+8,offset+12)
  assert.ok(Math.abs(weights.reduce((s,w)=>s+w,0)-1)<1e-5)
  for(let i=0;i<4;i++)assert.ok(data[offset+12+i]>=0&&data[offset+12+i]<asset.boneCount)
 }
 for(let i=0;i<asset.library.length;i++){
  const model=asset.library[i],source=human.library[i]
  assert.equal(model.id,source.id);assert.equal(model.sourceSha256,source.sourceSha256)
  const exportBytes=readFileSync(new URL('../../model/public/'+source.file,import.meta.url))
  assert.equal(createHash('sha256').update(exportBytes).digest('hex'),model.sourceSha256)
  assert.ok(model.lowTriangles<=Math.floor(model.triangles*.1))
  for(const [table,stride] of [[indices,asset.corners],[low,asset.lowCorners]])for(let t=i*stride;t<(i+1)*stride;t+=3){
   const face=[table[t],table[t+1],table[t+2]]
   assert.ok(face.every(v=>v<asset.vertices))
   assert.equal(data[face[0]*16+7],data[face[1]*16+7]);assert.equal(data[face[0]*16+7],data[face[2]*16+7])
  }
 }
})

test('baked escalator arms remain natural on their own side at every size and belt variant',()=>{
 const b=readFileSync(new URL('../../'+human.sourcePath,import.meta.url)),c=createImportedSoftHuman(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))
 assert.equal(asset.rootBone,c.bones.indexOf(c.hips));assert.deepEqual(asset.armBones,[9,10,11,12,13,14])
 for(const [action,sign] of [[7,1],[14,-1]])for(let fit=0;fit<asset.fits.length;fit++)for(let variant=0;variant<4;variant++){
  const frame=variant*6+2,point=(l,bone,end=false)=>bone.userData.rest.clone().add(end?l.wrist:new THREE.Vector3()).applyMatrix4(paletteMatrix(0,fit,action,frame,c.bones.indexOf(bone)))
  const active=c.limbs.find(l=>l.s===sign),shoulder=point(active,active.arm),elbow=point(active,active.fore),wrist=point(active,active.fore,true)
  assert(sign*(elbow.x-shoulder.x)>.06,'holding elbow stays beside the torso instead of crossing the chest')
  assert(elbow.y<shoulder.y-.08&&elbow.y>shoulder.y-.16,'upper arm lifts forward in side view while keeping its sideways spacing')
  assert(wrist.z>elbow.z+.15,'forearm keeps its comfortable bend as the whole arm lifts')
  const expected=new THREE.Vector3(sign*.20,-.12,.74).multiplyScalar(c.metrics.armLength).applyAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/6)
  assert(wrist.clone().sub(shoulder).distanceTo(expected)<.002,'the baked shoulder lift preserves the authored front-view spacing and 30-degree side-view rotation')
  const chest=paletteMatrix(0,fit,action,frame,c.bones.indexOf(c.chest))
  assert(Math.abs(chest.elements[2])<1e-6&&Math.abs(chest.elements[8])<1e-6,'equipment never twists the chest')
  const free=c.limbs.find(l=>l.s!==sign),a=point(free,free.arm),end=point(free,free.fore,true)
  assert(free.s*(end.x-a.x)>.16&&free.s*(end.x-a.x)<.25,'free arm hangs outside the body with a modest spread')
  assert(end.y<a.y-.65&&end.y>a.y-.74,'free hand stays above the knee rather than being squeezed into the lane')
 }
})

test('static and non-reaching activity arms share the accepted relaxed stance at every height and hand mode',()=>{
 assert.equal(asset.boneCount,16);assert.equal(asset.rigs.length,1)
 const b=readFileSync(new URL('../../'+human.sourcePath,import.meta.url)),c=createImportedSoftHuman(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))
 const check=(fit,action,frame,hand,l)=>{
  const point=(bone,end=false)=>bone.userData.rest.clone().add(end?l.wrist:new THREE.Vector3()).applyMatrix4(paletteMatrix(0,fit,action,frame,c.bones.indexOf(bone),hand))
  const shoulder=point(l.arm),elbow=point(l.fore),wrist=point(l.fore,true)
  const actual=wrist.clone().sub(shoulder),expected=new THREE.Vector3(l.s*.26,-.90,.06).multiplyScalar(c.metrics.armLength)
  assert(actual.distanceTo(expected)<.003,`${fit}/${action}/${frame}/${hand}/${l.s}: non-reaching arm matches the accepted resting pose`)
  assert(elbow.z<shoulder.z-.05&&wrist.z>elbow.z+.1,'baked relaxed arm preserves the corrected side-view bend')
 }
 for(let fit=0;fit<asset.fits.length;fit++)for(const hand of [0,1,2]){
  for(const action of [0,1,9,12,13])for(const frame of [0,8,16,23])for(const l of c.limbs)check(fit,action,frame,hand,l)
  for(const action of [2,3,4,5,6,8,10,11])if(hand){const l=c.limbs.find(l=>l.s!==(hand===1?1:-1));for(const frame of [0,8,16,23])check(fit,action,frame,hand,l)}
 }
})

test('the standing atlas used by waiting and queueing matches the relaxed activity arms',()=>{
 // Frame zero is absolute even in frame-delta storage. The renderer deliberately
 // keeps waits/queues on this cheap path, so testing only their palettes misses it.
 assert.equal(human.vertices,asset.vertices)
 const standing=new Int16Array(bytes(human.positions).buffer),fit=asset.fits.indexOf(1),boneMatrices=Array.from({length:asset.boneCount},(_,bone)=>paletteMatrix(0,fit,12,0,bone))
 // Use a bagless body's vertices: rigid carried bags have their own upright
 // transform in the walking atlas, independent of the anatomical arm stance.
 const outfit=human.library.findIndex(m=>!m.bag)
 assert(outfit>=0)
 const bodyVertices=new Set(indices.subarray(outfit*asset.corners,(outfit+1)*asset.corners))
 const p=new THREE.Vector3(),sum=new THREE.Vector3(),source=new THREE.Vector3(),sides=[0,0]
 for(const v of bodyVertices){
  const at=v*16;let armWeight=0
  for(let k=0;k<4;k++)if(asset.armBones.includes(data[at+12+k]))armWeight+=data[at+8+k]
  if(armWeight<.5)continue
  source.fromArray(data,at);sum.set(0,0,0)
  for(let k=0;k<4;k++)if(data[at+8+k])sum.addScaledVector(p.copy(source).applyMatrix4(boneMatrices[data[at+12+k]]),data[at+8+k])
  p.set(standing[v*3+1],standing[v*3+2],standing[v*3]).divideScalar(human.positionScale)
  assert(p.distanceTo(sum)<.002,'waiting must render the relaxed arms rather than the outward bind pose')
  sides[data[at]>0?1:0]++
 }
 assert(sides.every(count=>count>0),'both body arms are checked')
})

test('baked handed palettes share screen targets and keep either escalator arm on its own side',()=>{
 const b=readFileSync(new URL('../../'+human.sourcePath,import.meta.url)),c=createImportedSoftHuman(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))
 const wrist=(fit,action,frame,hand)=>{
  const limb=c.limbs.find(l=>l.s===(hand===1?1:-1)),joint=c.bones.indexOf(limb.fore)
  const p=limb.fore.userData.rest.clone().add(limb.wrist).applyMatrix4(paletteMatrix(0,fit,action,frame,joint,hand));p.y*=asset.fits[fit];return p
 }
 for(let fit=0;fit<asset.fits.length;fit++)if(asset.fits[fit]>=.8){
  for(const action of [2,3,4,5,6,8])assert.ok(wrist(fit,action,8,1).distanceTo(wrist(fit,action,8,2))<.025,`${action}/${fit}: both hands use the same actual screen`)
  assert.ok(wrist(fit,11,4,1).distanceTo(wrist(fit,11,4,2))<.025,'both hands use the actual door handle during contact')
  for(const [action,side]of [[7,1],[14,-1]])for(let variant=0;variant<4;variant++)for(const hand of [1,2]){
   const p=wrist(fit,action,variant*6+2,hand),sign=hand===1?1:-1
   assert.ok(p.x*sign>.3&&p.z>.4,`${action}/${fit}/${variant}/${hand}: chosen hand reaches forward on its own side without twisting to the belt`)
  }
 }
})
