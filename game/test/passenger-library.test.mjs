import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import human from '../src/assets/passenger-approved.json' with { type: 'json' }
import { passengerAppearance, passengerPose, passengerMesh, PASSENGER_OUTFITS, PASSENGER_CHILD_OUTFITS, PASSENGER_ADULT_OUTFITS, PASSENGER_ATLAS_WIDTH } from '../src/render/passengerModel.ts'
import { passengerIsChild, passengerWalkProfile, passengerProportions } from '../src/sim/walking.ts'
import { inflateSync } from 'node:zlib'
import { decodePassengerBytes } from '../src/render/passengerAtlas.ts'

const decoded = key => Buffer.from(decodePassengerBytes(human[key], human.encoding))

const expected=human.library.map(m=>m.id)

test('the selected base supplies twenty outfits per sex and every bag at both ages',()=>{
 assert.equal(human.style,'soft-human');assert.equal(human.library.length,440)
 assert.deepEqual(PASSENGER_OUTFITS,expected)
 for(const sex of ['male','female'])assert.equal(new Set(human.library.filter(m=>m.character===sex).map(m=>m.outfit)).size,20)
 assert(human.library.filter(m=>m.garmentShape==='skirt').every(m=>m.character==='female'))
 assert(human.library.filter(m=>m.outfit==='trail').every(m=>m.character==='female'))
 assert(human.library.filter(m=>m.outfit==='beach').every(m=>m.character==='male'))
 assert.equal(PASSENGER_CHILD_OUTFITS.length,440);assert.equal(PASSENGER_ADULT_OUTFITS.length,440)
 for(const m of human.library){assert(m.adultEligible&&m.childEligible);assert.match(m.recipeSha256,/^[a-f0-9]{64}$/);assert(m.triangles>2000&&m.triangles<11000)}
})

test('identity selects both age pools evenly and independently of gait',()=>{
 const counts=Array.from({length:2},()=>Array(440).fill(0)),scratch=[0,0,0,0,0]
 const gaitCounts=Array.from({length:3},()=>Array(human.library.length).fill(0))
 for(let id=0;id<human.library.length*25000;id++){assert.equal(passengerAppearance(id,scratch),scratch);counts[passengerIsChild(id)?1:0][scratch[0]]++;gaitCounts[passengerWalkProfile(id)][scratch[0]]++}
 for(const pool of counts){const mean=pool.reduce((a,b)=>a+b)/pool.length;assert(pool.every(n=>Math.abs(n/mean-1)<.09))}
 for(let i=0;i<human.library.length;i++)for(const gait of gaitCounts)assert(Math.abs(gait[i]/(counts[0][i]+counts[1][i])-1/3)<.03,'outfit choice is independent of gait')
 for(const id of [0,73,100000]){const a=passengerAppearance(id);passengerAppearance(id+1,scratch);assert.deepEqual(passengerAppearance(id),a)}
})

test('every wardrobe and bag remains finite, grounded and animated in all three walks',()=>{
 for(let outfit=0;outfit<expected.length;outfit++){
  const idle=passengerPose(0,outfit)
  for(const profile of human.walkProfiles){let moved=0
   for(const f of [0,6,12,18,23]){const p=passengerPose(profile.firstFrame+f,outfit);let floor=Infinity,top=-Infinity
    for(let i=0;i<p.length;i+=3){assert(Number.isFinite(p[i])&&Number.isFinite(p[i+1])&&Number.isFinite(p[i+2]));floor=Math.min(floor,p[i+2]);top=Math.max(top,p[i+2]);if(Math.abs(p[i]-idle[i])>.03)moved++}
    assert(floor>-.002&&floor<.018,`${expected[outfit]}: sole height ${floor}`);assert(top>1.5&&top<1.95)
   }assert(moved>100,`${expected[outfit]}: moving limbs survive`)
  }
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
  const indexWidth=2**Math.ceil(Math.log2(Math.max(1024,Math.ceil(human.corners*human.library.length/8192))))
  assert.equal(texture.image.width,name==='passengerPositions'||name==='passengerNormals'?PASSENGER_ATLAS_WIDTH:name==='passengerIndices'?indexWidth:1024)
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
