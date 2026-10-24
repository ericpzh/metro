import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { unzlibSync } from '../node_modules/three/examples/jsm/libs/fflate.module.js'
import * as THREE from '../node_modules/three/build/three.module.js'
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { activityRailTarget, ACTIVITY_NAMES } from '../src/sim/activities.ts'
import asset from '../src/assets/passenger-activities.json' with { type: 'json' }
import human from '../src/assets/passenger-approved.json' with { type: 'json' }

const bytes=value=>unzlibSync(Buffer.from(value,'base64'))
const data=new Float32Array(bytes(asset.data).buffer),matrices=new Float32Array(bytes(asset.matrices).buffer)
const indices=new Uint32Array(bytes(asset.indices).buffer),low=new Uint32Array(bytes(asset.lowIndices).buffer)
function paletteMatrix(rig,fit,action,frame,bone){
 const at=((((rig*asset.fits.length+fit)*(asset.activities.length+3)+action)*asset.samples+frame)*asset.boneCount+bone)*16
 return new THREE.Matrix4().fromArray(matrices,at)
}
test('the actual activity asset covers every reviewed export with flat palettes and bounded full/Low topology',()=>{
 assert.deepEqual(asset.activities,[...ACTIVITY_NAMES]);assert.equal(asset.library.length,human.library.length)
 assert.equal(data.length,asset.vertices*16)
 assert.equal(matrices.length,asset.rigs.length*asset.fits.length*(asset.activities.length+3)*asset.samples*asset.boneCount*16)
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
  const exportBytes=readFileSync(new URL('../../model/public/models/'+source.file,import.meta.url))
  assert.equal(createHash('sha256').update(exportBytes).digest('hex'),model.sourceSha256)
  assert.ok(model.lowTriangles<=Math.floor(model.triangles*.1))
  for(const [table,stride] of [[indices,asset.corners],[low,asset.lowCorners]])for(let t=i*stride;t<(i+1)*stride;t+=3){
   const face=[table[t],table[t+1],table[t+2]]
   assert.ok(face.every(v=>v<asset.vertices))
   assert.equal(data[face[0]*16+7],data[face[1]*16+7]);assert.equal(data[face[0]*16+7],data[face[2]*16+7])
  }
 }
})

test('baked up/down and narrow/wide rail wrists reach the real belt plane without sideways local hand twists',async()=>{
 for(const [rig,character] of asset.rigs.entries()){
  const model=human.library.find(m=>m.character===character&&!m.bag&&!m.outfit)
  const b=readFileSync(new URL('../../model/public/models/'+model.file,import.meta.url))
  const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')
  let skeleton;gltf.scene.traverse(n=>{if(n.isSkinnedMesh)skeleton=n.skeleton})
  for(const [side,action,sign] of [['Right',7,1],['Left',14,-1]]){
   const joint=skeleton.bones.findIndex(b=>b.name===side+'Hand')
   const bind=new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[joint].clone().invert())
   const arm=skeleton.bones.findIndex(b=>b.name===side+'Arm'),forearm=skeleton.bones.findIndex(b=>b.name===side+'Forearm')
   const row=asset.library.findIndex(m=>m.id===model.id)
   const sleeve=[...new Set(indices.subarray(row*asset.corners,(row+1)*asset.corners))].filter(v=>{
    let weight=0;for(let k=0;k<4;k++)if(data[v*16+12+k]===arm||data[v*16+12+k]===forearm)weight+=data[v*16+8+k];return weight>.99
   })
   assert.ok(sleeve.length>30)
   for(let fit=0;fit<asset.fits.length;fit++)if(asset.fits[fit]>=.8)for(let variant=0;variant<4;variant++){
    const handMatrix=paletteMatrix(rig,fit,action,variant*6+2,joint)
    const p=bind.clone().applyMatrix4(handMatrix)
    const height=asset.fits[fit];p.y*=height
    const target=new THREE.Vector3(...activityRailTarget(variant,height));target.x*=sign
    assert.ok(p.distanceTo(target)<.002,`${character}/${side}/${height}/${variant}: wrist misses belt by ${p.distanceTo(target)}`)
    const elbowIndex=skeleton.bones.findIndex(b=>b.name===side+'Forearm')
    const elbowMatrix=paletteMatrix(rig,fit,action,variant*6+2,elbowIndex)
    for(const component of [0,1,2,4,5,6,8,9,10])assert.ok(Math.abs(handMatrix.elements[component]-elbowMatrix.elements[component])<1e-5,'the hand follows its forearm without a wrist override')
    const elbow=new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[elbowIndex].clone().invert()).applyMatrix4(elbowMatrix)
    assert.ok(p.z-elbow.z>.015,`${character}/${side}/${height}/${variant}: forearm folds backward`)
    for(let stage=0;stage<=5;stage+=.5){
     const a=variant*6+Math.floor(stage),b=variant*6+Math.min(5,Math.floor(stage)+1),blend=stage%1
     const palette=Array.from({length:asset.boneCount},(_,bone)=>{
      const first=paletteMatrix(rig,fit,action,a,bone),second=paletteMatrix(rig,fit,action,b,bone)
      first.elements=first.elements.map((v,i)=>v+(second.elements[i]-v)*blend);return first
     })
     let hits=0
     for(const vertex of sleeve){
      const point=new THREE.Vector3(),source=new THREE.Vector3(...data.subarray(vertex*16,vertex*16+3))
      for(let k=0;k<4;k++){const w=data[vertex*16+8+k];if(w)point.addScaledVector(source.clone().applyMatrix4(palette[data[vertex*16+12+k]]),w)}
      point.y*=height
      const lateral=sign*point.x-(variant%2?.51:.36),normal=point.y*Math.cos(Math.PI/6)-(variant>=2?-1:1)*point.z*Math.sin(Math.PI/6)
      if(Math.abs(lateral)<.048&&normal>.962&&normal<1.038)hits++
     }
     assert.equal(hits,0,`${character}/${side}/${height}/${variant}/${stage}: sleeve crosses the handrail during reach/release`)
    }
   }
  }
 }
})
