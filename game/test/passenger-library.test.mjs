import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import human from '../src/assets/passenger-approved.json' with { type: 'json' }
import { passengerAppearance, passengerPose, passengerMesh, PASSENGER_OUTFITS, PASSENGER_CHILD_OUTFITS } from '../src/render/passengerModel.ts'
import { passengerIsChild, passengerWalkProfile, passengerProportions } from '../src/sim/walking.ts'

const expected = [
 'male-original-bag', 'male-original-no-bag', 'male-short-bag', 'male-short-no-bag',
 'male-bald-bag', 'male-bald-no-bag', 'female-bob-bag', 'female-bob-no-bag',
 'female-shoulder-bag', 'female-shoulder-no-bag', 'female-long-no-bag',
 'male-original-small-bag', 'male-short-small-bag', 'male-bald-small-bag',
 'female-bob-small-bag', 'female-shoulder-small-bag',
]

test('the game includes all sixteen reviewed variants, including small backpacks and bagless long hair', () => {
 assert.deepEqual(PASSENGER_OUTFITS, expected)
 assert.deepEqual(human.library.map(m => m.id), expected)
 assert.equal(human.library.filter(m => m.character === 'male').length, 9)
 assert.equal(human.library.filter(m => m.bag).length, 10)
 assert.equal(human.library.filter(m => m.bagStyle === 'small').length, 5)
 for (const model of human.library) {
  assert.match(model.sourceSha256, /^[a-f0-9]{64}$/)
  assert.ok(model.triangles > 1000 && model.triangles <= 11000)
 }
})

test('adult models and eligible child models are selected equally within their age group', () => {
 const counts = Array(expected.length).fill(0), profiles = Array.from({length:3}, () => Array(expected.length).fill(0))
 const kids = Array(expected.length).fill(0), adults = Array(expected.length).fill(0), scratch = [0,0,0,0,0]
 for (let id=0; id<110000; id++) {
  assert.equal(passengerAppearance(id, scratch), scratch, 'caller scratch is reused')
  const outfit = scratch[0];counts[outfit]++;profiles[passengerWalkProfile(id)][outfit]++
  ;(passengerIsChild(id) ? kids : adults)[outfit]++
  assert.deepEqual(scratch.slice(1), passengerProportions(id), 'appearance does not alter sim physique or speed')
 }
 const eligible = human.library.flatMap((model,index)=>!model.bag&&model.hair!=='bald'?[index]:[])
 assert.deepEqual(PASSENGER_CHILD_OUTFITS,eligible)
 for(const index of expected.keys())if(!eligible.includes(index))assert.equal(kids[index],0,'children have no bag or bald head')
 for(const group of [adults,eligible.map(index=>kids[index])]) {
  const mean = group.reduce((a,b)=>a+b,0)/group.length
  for(const count of group) assert.ok(Math.abs(count-mean)/mean<.09, `biased or unreachable variant: ${group}`)
 }
 for(const profile of profiles)for(const index of expected.keys())assert.ok(Math.abs(profile[index]/counts[index]-1/3)<.025,'age-appropriate appearance remains independent of gait')
 for(const id of [0, 73, 100000, 0x7fffffff]) {
  const original = passengerAppearance(id)
  passengerAppearance(id+1, scratch)
  assert.deepEqual(passengerAppearance(id),original, 'identity survives unrelated passengers and reordering')
 }
})

function bounds(pose, low=0, high=2) {
 const box = new THREE.Box3()
 for(let i=0;i<pose.length;i+=3) if(pose[i+2]>=low && pose[i+2]<=high) box.expandByPoint(new THREE.Vector3(pose[i],pose[i+1],pose[i+2]))
 return box
}

test('every variant stays grounded, outward-facing and animated in all three walks', () => {
 for(let outfit=0;outfit<expected.length;outfit++) {
  const idle=passengerPose(0,outfit)
  let volume=0
  for(let i=0;i<idle.length;i+=9) {
   const a=new THREE.Vector3(...idle.slice(i,i+3)),b=new THREE.Vector3(...idle.slice(i+3,i+6)),c=new THREE.Vector3(...idle.slice(i+6,i+9))
   volume+=a.dot(b.cross(c))/6
  }
  assert.ok(volume>.025 && volume<.25, `${expected[outfit]} has outward human surfaces`)
  for(const profile of human.walkProfiles) {
   let movingLegs=0,movingArms=0
   for(let f=0;f<human.walkFrames;f++) {
    const pose=passengerPose(profile.firstFrame+f,outfit),box=bounds(pose)
    assert.ok(Math.abs(box.min.z)<.002 && box.max.z>1.5 && box.max.z<1.9, `${expected[outfit]} ${profile.name} frame ${f}`)
    for(let i=0;i<pose.length;i+=3) {
     assert.ok(Number.isFinite(pose[i]) && Number.isFinite(pose[i+1]) && Number.isFinite(pose[i+2]))
     const moved=Math.hypot(pose[i]-idle[i],pose[i+1]-idle[i+1],pose[i+2]-idle[i+2])
     if(idle[i+2]<.8 && moved>.08) movingLegs++
     if(idle[i+2]>.8 && idle[i+2]<1.4 && Math.abs(idle[i+1])>.2 && moved>.08) movingArms++
    }
   }
   assert.ok(movingLegs>100 && movingArms>50, `${expected[outfit]} ${profile.name} retains animated limbs`)
  }
 }
})

test('backpack variants retain a pack and bagless variants remove it throughout walking', () => {
 for(let pair=0;pair<10;pair+=2) for(const frame of [0, 7, 31, 55]) {
  const bag=bounds(passengerPose(frame,pair),.8,1.15),bare=bounds(passengerPose(frame,pair+1),.8,1.15)
  assert.ok(bag.getSize(new THREE.Vector3()).x > bare.getSize(new THREE.Vector3()).x+.07, `${expected[pair]} frame ${frame}: pack must remain attached and visible`)
 }
 for(const small of human.library.filter(m=>m.bagStyle==='small')) for(const frame of [0,7,31,55]) {
  const index=human.library.indexOf(small),standard=human.library.findIndex(m=>m.character===small.character&&m.hair===small.hair&&m.bag&&!m.bagStyle),bare=human.library.findIndex(m=>m.character===small.character&&m.hair===small.hair&&!m.bag)
  const size=bounds(passengerPose(frame,index),.8,1.15).getSize(new THREE.Vector3()).x
  assert.ok(size>bounds(passengerPose(frame,bare),.8,1.15).getSize(new THREE.Vector3()).x+.045,`${small.id}: small pack stays visible during walking`)
  assert.ok(size<bounds(passengerPose(frame,standard),.8,1.15).getSize(new THREE.Vector3()).x-.02,`${small.id}: shallower pack silhouette survives baking`)
 }
})

test('the library remains a single instanced draw with valid padded topology and disposed atlases', () => {
 const raw=Buffer.from(human.indices,'base64'),indices=new (human.indexBits===32?Uint32Array:Uint16Array)(raw.buffer,raw.byteOffset,raw.byteLength/(human.indexBits/8))
 assert.equal(indices.length,expected.length*human.corners)
 assert.equal(Buffer.from(human.positions,'base64').length,human.vertices*human.frames*3*2)
 assert.equal(Buffer.from(human.normals,'base64').length,human.vertices*human.frames*3)
 for(let outfit=0;outfit<expected.length;outfit++) {
  let real=0
  for(let i=outfit*human.corners;i<(outfit+1)*human.corners;i+=3) {
   assert.ok(indices[i]<human.vertices && indices[i+1]<human.vertices && indices[i+2]<human.vertices)
   if(new Set(indices.slice(i,i+3)).size===3) real++
  }
  assert.equal(real,human.library[outfit].triangles,'shorter variants pad only degenerate triangles')
 }
 const mesh=passengerMesh(16)
 assert.equal(mesh.isInstancedMesh,true);assert.equal(Array.isArray(mesh.material),false)
 const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader}
 mesh.material.onBeforeCompile(shader)
 let disposed=0
 for(const name of ['passengerPositions','passengerNormals','passengerIndices','passengerRegions']) {
  const texture=shader.uniforms[name].value
  assert.equal(texture.image.width,1024)
  assert.ok(texture.image.height<=8192,'pose atlas stays within the game GPU texture budget')
  texture.addEventListener('dispose',()=>disposed++)
 }
 mesh.userData.disposePassenger();assert.equal(disposed,4)
 mesh.geometry.dispose();mesh.material.dispose()
})
