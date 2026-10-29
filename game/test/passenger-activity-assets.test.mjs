import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { unzlibSync } from '../node_modules/three/examples/jsm/libs/fflate.module.js'
import * as THREE from '../node_modules/three/build/three.module.js'
import {createImportedSoftHuman} from '../../model/src/soft-human/imported-base.js'
import { activityRailTarget, ACTIVITY_NAMES } from '../src/sim/activities.ts'
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

test('both rail hands reach all four mathematical belt targets, while the free arm stays outward',()=>{
 const b=readFileSync(new URL('../../'+human.sourcePath,import.meta.url)),c=createImportedSoftHuman(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))
 assert.equal(asset.rootBone,c.bones.indexOf(c.hips));assert.deepEqual(asset.armBones,[9,10,11,12,13,14])
 for(const [action,sign] of [[7,1],[14,-1]])for(let fit=0;fit<asset.fits.length;fit++)if(asset.fits[fit]>=.8)for(let variant=0;variant<4;variant++){
  const limb=c.limbs.find(l=>l.s===sign),joint=c.bones.indexOf(limb.fore),bind=limb.fore.userData.rest.clone().add(limb.wrist)
  const p=bind.applyMatrix4(paletteMatrix(0,fit,action,variant*6+2,joint));p.y*=asset.fits[fit]
  const target=new THREE.Vector3(...activityRailTarget(variant,asset.fits[fit]));target.x*=sign
  assert(p.distanceTo(target)<.025,`${action}/${fit}/${variant}: hand clearance ${p.distanceTo(target)}`)
  const free=c.limbs.find(l=>l.s!==sign),arm=paletteMatrix(0,fit,action,variant*6+2,c.bones.indexOf(free.arm))
  assert(Math.abs(arm.elements[1])<.04,'free shoulder retains its outward bind angle')
 }
})

test('all activity palettes share the selected 16 bones and preserve the outward free-arm policy',()=>{
 assert.equal(asset.boneCount,16);assert.equal(asset.rigs.length,1)
 const armIndices=asset.boneNames.flatMap((name,i)=>name.endsWith('Arm')&&!name.endsWith('Forearm')?[i]:[])
 for(const action of [0,1,9,12,13])for(let fit=0;fit<asset.fits.length;fit++)for(const frame of [0,8,16,23])for(const arm of armIndices){
  const m=paletteMatrix(0,fit,action,frame,arm)
  assert(Math.abs(m.elements[1])<.08,'idle, seating and waiting cannot tuck the arms into the body')
 }
})

test('baked handed palettes reach the same screen and the original rail with either free hand',()=>{
 const b=readFileSync(new URL('../../'+human.sourcePath,import.meta.url)),c=createImportedSoftHuman(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))
 const wrist=(fit,action,frame,hand)=>{
  const limb=c.limbs.find(l=>l.s===(hand===1?1:-1)),joint=c.bones.indexOf(limb.fore)
  const p=limb.fore.userData.rest.clone().add(limb.wrist).applyMatrix4(paletteMatrix(0,fit,action,frame,joint,hand));p.y*=asset.fits[fit];return p
 }
 for(let fit=0;fit<asset.fits.length;fit++)if(asset.fits[fit]>=.8){
  for(const action of [2,3,4,5,6,8])assert.ok(wrist(fit,action,8,1).distanceTo(wrist(fit,action,8,2))<.025,`${action}/${fit}: both hands use the same actual screen`)
  assert.ok(wrist(fit,11,4,1).distanceTo(wrist(fit,11,4,2))<.025,'both hands use the actual door handle during contact')
  for(const [action,side]of [[7,1],[14,-1]])for(let variant=0;variant<4;variant++)for(const hand of [1,2]){
   const target=new THREE.Vector3(...activityRailTarget(variant,asset.fits[fit]));target.x*=side
   assert.ok(wrist(fit,action,variant*6+2,hand).distanceTo(target)<.025,`${action}/${fit}/${variant}/${hand}: free hand reaches the existing belt`)
  }
 }
})
