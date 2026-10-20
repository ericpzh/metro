import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import human from '../src/assets/passenger-approved.json' with { type: 'json' }
import { passengerAppearance, passengerPose, passengerMesh, PASSENGER_OUTFITS, PASSENGER_CHILD_OUTFITS, PASSENGER_ADULT_OUTFITS, PASSENGER_ATLAS_WIDTH } from '../src/render/passengerModel.ts'
import { passengerIsChild, passengerWalkProfile, passengerProportions } from '../src/sim/walking.ts'
import { inflateSync } from 'node:zlib'
import { decodePassengerBytes } from '../src/render/passengerAtlas.ts'

const decoded = key => Buffer.from(decodePassengerBytes(human[key], human.encoding))

const maleHair=['original','short','bald','buzz','crew','crop','side-part','swept','quiff','rounded']
const femaleHair=['bob','shoulder','long','cropped-bob','rounded-bob','angled-bob','side-part-bob','lob','shoulder-swept','long-swept']
const backpackHair=femaleHair.filter(hair=>!['long','long-swept'].includes(hair))
const backpackModels=[...maleHair.map(hair=>`male-${hair}`),...backpackHair.map(hair=>`female-${hair}`)]
const allModels=[...maleHair.map(hair=>`male-${hair}`),...femaleHair.map(hair=>`female-${hair}`)]
const clothingIds={female:['long-a-line','slim-long-skirt','long-pleated','full-pleated','midi-a-line','midi-pleated','straight-trousers','tapered-trousers','wide-trousers','relaxed-trousers'],male:['crew-straight','crew-tapered','fitted-straight','fitted-tapered','relaxed-straight','relaxed-wide','short-straight','short-wide','long-tapered','long-relaxed']}
const clothing=Object.entries(clothingIds).flatMap(([sex,ids])=>ids.flatMap(id=>[`${sex}-${id}-no-bag`,`${sex}-${id}-swapped-no-bag`]))
const expected = [
 ...backpackModels.flatMap(model=>[`${model}-bag`,`${model}-no-bag`]),
 'female-long-no-bag','female-long-swept-no-bag',
 ...backpackModels.map(model=>`${model}-small-bag`),
 ...['87.5','75'].flatMap(size=>backpackModels.map(model=>`${model}-standard-${size}-bag`)),
 ...['shoulder','crossbody','purse'].flatMap(type=>['left','right'].flatMap(side=>allModels.filter(model=>type!=='purse'||model.startsWith('female-')).map(model=>`${model}-${type}-${side}-bag`))),
 ...clothing,
]

test('the game includes ten hairstyles per sex and every reviewed bag combination', () => {
 assert.deepEqual(PASSENGER_OUTFITS, expected)
 assert.deepEqual(human.library.map(m => m.id), expected)
 for(const [character,hairs] of [['male',maleHair],['female',femaleHair]])assert.deepEqual([...new Set(human.library.filter(m=>m.character===character).map(m=>m.hair))].sort(),[...hairs].sort())
 assert.equal(human.library.filter(m => m.character === 'male').length, maleHair.length*9+clothingIds.male.length*2)
 assert.equal(human.library.filter(m => m.bag).length, expected.length-20-clothing.length)
 assert.equal(PASSENGER_ADULT_OUTFITS.length,172+clothing.length)
 assert.equal(PASSENGER_CHILD_OUTFITS.length,74+clothing.length)
 assert.equal(human.library.filter(m => m.bagStyle === 'small').length, backpackModels.length)
 for (const model of human.library) {
  if(model.bagType==='purse')assert(model.character==='female'&&model.adultEligible&&!model.childEligible)
  if(model.bagType==='shoulder')assert(model.adultEligible&&!model.childEligible)
  if(model.bagType==='crossbody')assert.equal(model.adultEligible,model.character==='male')
  if(model.childEligible)assert(model.hair!=='bald'&&(!model.bag||model.bagStyle==='small'||model.bagType==='crossbody'))
  assert.match(model.sourceSha256, /^[a-f0-9]{64}$/)
  assert.ok(model.triangles > 1000 && model.triangles <= 11000)
 }
})

test('the baked male hair additions retain the approved lower crowns with every bag', () => {
 const additions=['buzz','crew','crop','side-part','swept','quiff','rounded']
 const original=human.library.findIndex(model=>model.id==='male-original-no-bag')
 const originalHeight=bounds(passengerPose(0,original)).max.z
 for(const [index,model] of human.library.entries())if(model.character==='male'&&additions.includes(model.hair)) {
  const height=bounds(passengerPose(0,index)).max.z
  assert(height<=1.70,`${model.id}: the shipped crown stays below 1.70 m`)
  assert(height<originalHeight-.02,`${model.id}: the shipped crown stays lower than the original locks`)
 }
 assert.equal(human.library.filter(model=>model.character==='male'&&additions.includes(model.hair)).length,63)
})

test('adult models and eligible child models are selected equally within their age group', () => {
 const counts = Array(expected.length).fill(0), profiles = Array.from({length:3}, () => Array(expected.length).fill(0))
 const kids = Array(expected.length).fill(0), adults = Array(expected.length).fill(0), scratch = [0,0,0,0,0]
 // Keep at least 5,000 expected child observations per template as its pool
 // grows, retaining the same tight gait-independence assertion for rare models.
 const samples=Math.max(880000,PASSENGER_CHILD_OUTFITS.length*25000)
 for (let id=0; id<samples; id++) {
  assert.equal(passengerAppearance(id, scratch), scratch, 'caller scratch is reused')
  const outfit = scratch[0];counts[outfit]++;profiles[passengerWalkProfile(id)][outfit]++
  ;(passengerIsChild(id) ? kids : adults)[outfit]++
  const proportions = passengerProportions(id)
  assert.deepEqual(scratch.slice(1), proportions.map((value, axis) => axis < 3 ? value * .98 : value), 'appearance scales the model without altering sim physique or speed')
 }
 const eligible = human.library.flatMap((model,index)=>model.childEligible?[index]:[])
 assert.deepEqual(PASSENGER_CHILD_OUTFITS,eligible)
 for(const index of expected.keys())if(!eligible.includes(index))assert.equal(kids[index],0,'children cannot choose shoulder bags, purses, standard packs or bald heads')
 for(const index of expected.keys())if(!human.library[index].adultEligible)assert.equal(adults[index],0,'female crossbody templates are child-only')
 for(const group of [PASSENGER_ADULT_OUTFITS.map(index=>adults[index]),eligible.map(index=>kids[index])]) {
  const mean = group.reduce((a,b)=>a+b,0)/group.length
  for(const count of group) assert.ok(Math.abs(count-mean)/mean<.09, `biased or unreachable variant: ${group}`)
 }
 for(const profile of profiles)for(const index of expected.keys())assert.ok(Math.abs(profile[index]/counts[index]-1/3)<.03,'age-appropriate appearance remains independent of gait')
 for(const id of [0, 73, 100000, 0x7fffffff]) {
  const original = passengerAppearance(id)
  passengerAppearance(id+1, scratch)
  assert.deepEqual(passengerAppearance(id),original, 'identity survives unrelated passengers and reordering')
 }
})

test('resized standard backpacks retain their own silhouette throughout all walks', () => {
 assert.equal(human.library.filter(m=>m.bagScale===.75).length,backpackModels.length)
 assert.equal(human.library.filter(m=>m.bagScale===.875).length,backpackModels.length)
 const raw=decoded('indices'),indices=new (human.indexBits===32?Uint32Array:Uint16Array)(raw.buffer,raw.byteOffset,raw.byteLength/(human.indexBits/8)),regions=decoded('regions')
 // Moving arms can hide the pack in the bounds of the complete body. Measure
 // the bag's own flat-grey surface, including every expanded baked triangle.
 const packBounds=(frame,index)=>{
  const pose=passengerPose(frame,index),box=new THREE.Box3()
  for(let i=0;i<human.corners;i++)if(human.palette[regions[indices[index*human.corners+i]]]===.43)box.expandByPoint(new THREE.Vector3(...pose.slice(i*3,i*3+3)))
  return box
 }
 for(const pack of human.library.filter(m=>m.bagScale)) {
  const index=human.library.indexOf(pack),standard=human.library.findIndex(m=>m.character===pack.character&&m.hair===pack.hair&&m.bag&&!m.bagStyle)
  for(const profile of human.walkProfiles)for(const frame of [0,7,15,23]) {
   const pose=profile.firstFrame+frame,box=packBounds(pose,index),size=box.getSize(new THREE.Vector3())
   assert.ok(box.min.x<-.15,`${pack.id}: pack extends behind the torso`)
   assert.ok(Math.abs(size.y-.39*pack.bagScale)<.012,`${pack.id}: baked width retains the selected size`)
   assert.ok(Math.abs(size.z-.445*pack.bagScale)<.018,`${pack.id}: baked height retains the selected size`)
   assert.ok(size.x<packBounds(pose,standard).getSize(new THREE.Vector3()).x-.01,`${pack.id}: resized pack is shallower than full size`)
  }
 }
})

test('side bags stay on the requested side in standing and every gait',()=>{
 const raw=decoded('indices'),indices=new (human.indexBits===32?Uint32Array:Uint16Array)(raw.buffer,raw.byteOffset,raw.byteLength/(human.indexBits/8)),regions=decoded('regions')
 for(const model of human.library.filter(m=>m.bagType)){
  const outfit=human.library.indexOf(model),ink=model.bagType==='shoulder'?.44:model.bagType==='crossbody'?.46:.40,sign=model.bagSide==='left'?-1:1
  const idlePose=passengerPose(0,outfit),torsoCorners=[],bagCorners=[],strapTriangles=[]
  for(let i=0;i<human.corners;i+=3)if([0,1,2].every(k=>human.palette[regions[indices[outfit*human.corners+i+k]]]===.47))strapTriangles.push(i)
  assert(strapTriangles.length>20,`${model.id}: strap/handle survives the bake`)
  // Select the accessory in standing geometry; the source also has dark head
  // details sharing the purse's palette stop, which are not part of the bag.
  for(let i=0;i<human.corners;i++)if(human.palette[regions[indices[outfit*human.corners+i]]]===ink&&idlePose[i*3+2]>.35&&idlePose[i*3+2]<(model.bagType==='purse'?.75:1.25)&&sign*idlePose[i*3+1]>.18)bagCorners.push(i)
  for(let i=0;i<human.corners;i++)if(human.palette[regions[indices[outfit*human.corners+i]]]===(model.character==='female'?.62:.89)&&idlePose[i*3+2]>.82&&idlePose[i*3+2]<1.31&&Math.abs(idlePose[i*3+1])<.09)torsoCorners.push(i)
  assert(torsoCorners.length>20,'the chest provides a torso landmark')
  let idleOffset
  for(const frame of [0,...human.walkProfiles.flatMap(p=>[p.firstFrame,p.firstFrame+6,p.firstFrame+12,p.firstFrame+18])]){
   const pose=passengerPose(frame,outfit),box=new THREE.Box3();let count=0
   for(const i of strapTriangles){
    const points=[0,1,2].map(k=>new THREE.Vector3(...pose.slice((i+k)*3,(i+k)*3+3)))
    // The game simplifier merges flat ribbon segments (the GLB checker uses
    // a tighter bound). Preserve a short accessory span and reject origin debris.
    for(let k=0;k<3;k++){
     assert(points[k].distanceTo(points[(k+1)%3])<.30,`${model.id} frame ${frame}: no broken strap triangle extends toward the feet`)
     assert(points[k].z>(model.bagType==='purse'?.30:.85),`${model.id} frame ${frame}: strap/handle ink remains above the legs`)
    }
   }
   for(const i of bagCorners){box.expandByPoint(new THREE.Vector3(...pose.slice(i*3,i*3+3)));count++}
   assert(count>20,`${model.id}: bag body survives simplification`)
   const center=box.getCenter(new THREE.Vector3());assert(sign*center.y>.215,`${model.id}: bag stays on the wearer's ${model.bagSide}`)
   if(frame===0){
    const size=box.getSize(new THREE.Vector3());assert(size.x>size.y*2,`${model.id}: broad bag face runs along body depth`)
    if(model.bagType!=='purse')assert(sign*center.y<.255&&size.y<.045,`${model.id}: thin bag rests beside the torso inside the carrying arm`)
   }
   assert(box.min.z>.30&&box.max.z<1.2,`${model.id}: bag remains above the floor and below the shoulder`)
   const torsoHeight=torsoCorners.reduce((sum,i)=>sum+pose[i*3+2],0)/torsoCorners.length
   if(frame===0)idleOffset=center.z-torsoHeight
   if(model.bagType!=='purse')assert(Math.abs(center.z-torsoHeight-idleOffset)<.003,`${model.id}: side bag follows the moving torso rather than swinging arm`)
  }
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
 for(const model of human.library.filter(m=>m.bag&&!m.bagStyle)) for(const frame of [0, 7, 31, 55]) {
  const index=human.library.indexOf(model),bareIndex=human.library.findIndex(m=>m.character===model.character&&m.hair===model.hair&&!m.bag)
  const bag=bounds(passengerPose(frame,index),.8,1.15),bare=bounds(passengerPose(frame,bareIndex),.8,1.15)
  assert.ok(bag.getSize(new THREE.Vector3()).x > bare.getSize(new THREE.Vector3()).x+.07, `${model.id} frame ${frame}: pack must remain attached and visible`)
 }
 for(const small of human.library.filter(m=>m.bagStyle==='small')) for(const frame of [0,7,31,55]) {
  const index=human.library.indexOf(small),standard=human.library.findIndex(m=>m.character===small.character&&m.hair===small.hair&&m.bag&&!m.bagStyle),bare=human.library.findIndex(m=>m.character===small.character&&m.hair===small.hair&&!m.bag)
  const size=bounds(passengerPose(frame,index),.8,1.15).getSize(new THREE.Vector3()).x
  assert.ok(size>bounds(passengerPose(frame,bare),.8,1.15).getSize(new THREE.Vector3()).x+.045,`${small.id}: small pack stays visible during walking`)
  assert.ok(size<bounds(passengerPose(frame,standard),.8,1.15).getSize(new THREE.Vector3()).x-.02,`${small.id}: shallower pack silhouette survives baking`)
 }
})

test('the library remains a single instanced draw with valid padded topology and disposed atlases', () => {
 const raw=decoded('indices'),indices=new (human.indexBits===32?Uint32Array:Uint16Array)(raw.buffer,raw.byteOffset,raw.byteLength/(human.indexBits/8))
 assert.equal(indices.length,expected.length*human.corners)
 assert.equal(decoded('positions').length,human.vertices*human.frames*3*2)
 assert.equal(decoded('normals').length,human.vertices*human.frames*3)
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
  assert.equal(texture.image.width,name==='passengerPositions'||name==='passengerNormals'?PASSENGER_ATLAS_WIDTH:1024)
  assert.ok(texture.image.height<=8192,'pose atlas stays within the game GPU texture budget')
  if (name === 'passengerPositions' || name === 'passengerNormals') {
   assert.equal(texture.format, THREE.RGBAIntegerFormat)
   assert.equal(texture.type, name === 'passengerPositions' ? THREE.ShortType : THREE.ByteType)
  }
  texture.addEventListener('dispose',()=>disposed++)
 }
 const pixels = shader.uniforms.passengerPositions.value.image.data, indicesBuffer = decoded('indices')
 const corner = 123, vertex = human.indexBits === 32 ? indicesBuffer.readUInt32LE(corner * 4) : indicesBuffer.readUInt16LE(corner * 2)
 for (const frame of [0, human.frames - 1]) {
  const pose = passengerPose(frame)
  for (let axis = 0; axis < 3; axis++) assert.equal(Math.fround(pixels[(frame * human.vertices + vertex) * 4 + axis] / human.positionScale), pose[corner * 3 + axis], 'signed integer textures reconstruct the exact baked pose')
 }
 mesh.userData.disposePassenger();assert.equal(disposed,4)
 mesh.geometry.dispose();mesh.material.dispose()
})

test('the packed atlas decodes losslessly with legacy raw-buffer compatibility',()=>{
 assert.equal(human.encoding,'zlib-base64')
 assert.equal(human.poseEncoding,'frame-delta')
 assert.ok(Buffer.byteLength(JSON.stringify(human))<100*1024**2,'the expanded library stays within the 100 MiB tracked-asset budget')
 for(const field of ['positions','normals','indices','regions']){
  const expected=inflateSync(Buffer.from(human[field],'base64'))
  assert.deepEqual(decoded(field),expected,'browser decoder matches the independent Node inflater byte for byte')
  assert.deepEqual(Buffer.from(decodePassengerBytes(Buffer.from(human[field], 'base64'), human.encoding)), expected, 'production binary buffers decode to the same bytes')
  assert.deepEqual(Buffer.from(decodePassengerBytes(expected.toString('base64'))),expected,'older plain-base64 atlases retain their exact bytes')
 }
 assert.throws(()=>decodePassengerBytes('AA==','unknown'),/Unsupported passenger atlas encoding/)
 const native = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64')
 try {
  Object.defineProperty(Uint8Array, 'fromBase64', { value: undefined, configurable: true })
  const expected = Buffer.from(Array.from({ length: 256 }, (_, index) => index))
  assert.deepEqual(Buffer.from(decodePassengerBytes(expected.toString('base64'))), expected, 'the compatibility decoder preserves every byte')
 } finally {
  if (native) Object.defineProperty(Uint8Array, 'fromBase64', native)
  else delete Uint8Array.fromBase64
 }
})
