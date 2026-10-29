import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import human from '../src/assets/passenger-approved.json' with {type:'json'}
import {passengerPose,PASSENGER_ADULT_OUTFITS,PASSENGER_CHILD_OUTFITS} from '../src/render/passengerModel.ts'
import {decodePassengerBytes,restorePassengerFrames} from '../src/render/passengerAtlas.ts'
import {passengerBakePart,passengerVertexKey,passengerExteriorGeometry} from '../../tools/passenger-bake-geometry.mjs'

test('the game bake matches the selected FBX and every model recipe source',()=>{
 const hash=b=>createHash('sha256').update(b).digest('hex')
 assert.equal(hash(readFileSync(new URL('../../'+human.sourcePath,import.meta.url))),human.sourceSha256)
 for(const [path,expected] of Object.entries(human.sourceHashes))assert.equal(hash(readFileSync(new URL('../../'+path,import.meta.url))),expected,path+' changed: run npm run bake:passengers')
 assert.equal(hash(JSON.stringify(human.sourceHashes)),human.recipeSha256)
 assert.match(human.license,/no redistribution license/)
})

test('the baker preserves morph identity and samples the same animated weights on detached parts',()=>{
 const geometry=new THREE.BufferGeometry()
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,0,0,0,1,0],3))
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(12),4))
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4))
 geometry.setIndex([0,1,2]);geometry.morphTargetsRelative=true
 geometry.morphAttributes.position=[new THREE.Float32BufferAttribute([.2,0,0,0,0,0,0,0,0],3)]
 assert.notEqual(passengerVertexKey(geometry,0,1),passengerVertexKey(geometry,1,1),'standing-coincident vertices with different morphs cannot weld')
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial()),bone=new THREE.Bone()
 mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));mesh.updateMatrixWorld(true);mesh.skeleton.update()
 const part=passengerBakePart(mesh,[0,1,2])
 const mixer=new THREE.AnimationMixer(mesh),clip=new THREE.AnimationClip('skirt',1,[new THREE.NumberKeyframeTrack('.morphTargetInfluences',[0,1],[0,1])])
 mixer.clipAction(clip).play();mixer.setTime(.5)
 assert(Math.abs(part.getVertexPosition(0,new THREE.Vector3()).x-.1)<1e-6,'exported morph moves the actual baked point')
 assert.equal(part.getVertexPosition(1,new THREE.Vector3()).x,0)
 assert.equal(part.applyBoneTransform(0,new THREE.Vector3()).x,0,'the old skeleton-only sampler misses the deformation')
 geometry.dispose();part.geometry.dispose();mesh.material.dispose();mixer.stopAllAction();mixer.uncacheRoot(mesh)
})

test('all clothing and bag combinations enter both age pools with the authored RGB palette',()=>{
 const raw=decodePassengerBytes(human.indices,human.encoding),ids=new (human.indexBits===32?Uint32Array:Uint16Array)(raw.buffer),regions=decodePassengerBytes(human.regions,human.encoding)
 for(const [index,m] of human.library.entries()){
  assert(PASSENGER_ADULT_OUTFITS.includes(index)&&PASSENGER_CHILD_OUTFITS.includes(index))
  const colors=new Set(Array.from(ids.subarray(index*human.corners,(index+1)*human.corners),v=>human.paletteRGB[regions[v]]))
  assert(colors.has(m.top),m.id+' top color');assert(colors.has(m.bottom),m.id+' bottom color')
 }
})

test('the translucent game keeps outer cloth, exposed ankles and sleeves while omitting hidden support layers',()=>{
 const geometry=new THREE.BufferGeometry()
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,.8,0,1,.8,0,0,.9,1,1,.9,1,0,.8,0,1,.8,0,0,.9,1,1,.9,1],3))
 geometry.setIndex([0,1,2,1,3,2,4,6,5,5,6,7,0,4,1])
 const shell={name:'Trouser_waist',geometry}
 const exterior=passengerExteriorGeometry(shell,{shape:'trousers',topHem:.825})
 assert.deepEqual([...exterior.index.array],[0,1,2,1,3,2],'the inward wall and annular cap do not show through')
 assert(Math.max(...exterior.attributes.position.array.filter((_,i)=>i%3===1))<.825,'waist hidden under the shirt is trimmed')
 assert(geometry.attributes.position.getY(2)>.89,'the downloadable closed source stays intact')
 const legs=new THREE.BufferGeometry()
 legs.setAttribute('position',new THREE.Float32BufferAttribute([0,.5,0,1,.5,0,0,.6,1,0,.1,0,1,.1,0,0,.12,1,0,.5,0,1,.5,0,0,.6,1],3))
 legs.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(Array.from({length:36},(_,i)=>i>=24?1:0),4))
 legs.setAttribute('skinWeight',new THREE.Float32BufferAttribute(Array.from({length:36},(_,i)=>i%4===0?1:0),4))
 legs.setIndex([0,1,2,3,4,5,6,7,8])
 const body={name:'Jacket-free_top',geometry:legs,skeleton:{bones:[{name:'LeftShin'},{name:'LeftArm'}]}}
 const visible=passengerExteriorGeometry(body,{shape:'a-line',hem:.19})
 assert.deepEqual([...visible.index.array],[3,4,5,6,7,8],'hidden legs are omitted, ankles and moving sleeves survive')
 assert.equal(passengerExteriorGeometry(body,null),legs,'original jacket variants are unaffected')
 for(const g of [geometry,exterior,legs,visible])g.dispose()
})

test('game skirts retain a flush waist, outward cloth shell and exposed legs',()=>{
 const raw=decodePassengerBytes(human.indices,human.encoding),ids=new (human.indexBits===32?Uint32Array:Uint16Array)(raw.buffer),regions=decodePassengerBytes(human.regions,human.encoding)
 for(const [variant,m] of human.library.entries())if(m.garmentShape==='skirt'){
  const p=passengerPose(0,variant),hem=m.outfit.includes('blouse')||m.outfit==='rose-slate-skirt'?.16:.29;let cloth=0,exposed=0
  for(let i=0;i<human.corners;i++){const color=human.paletteRGB[regions[ids[variant*human.corners+i]]],z=p[i*3+2]
   if(color===m.bottom)cloth++
   if(color==='#f2f1ed'&&Math.abs(p[i*3+1])<.34){assert(!(z>hem+.04&&z<.63),m.id+' hidden thigh');if(z<hem+.02)exposed++}
  }
  assert(cloth>300&&exposed>20,m.id+' cloth and feet survive')
  let waist=0
  for(let i=0;i<human.corners;i++)if(human.paletteRGB[regions[ids[variant*human.corners+i]]]===m.bottom&&Math.abs(p[i*3+2]-.64)<.004){
   assert(Math.abs(p[i*3+1])<.299&&p[i*3]>-.213&&p[i*3]<.193,m.id+' rim meets the body without a projecting shelf');waist++
  }
  assert(waist>30,m.id+' flush waist seam survives simplification')
  const walking=passengerPose(human.walkProfiles[1].firstFrame+6,variant)
  assert(walking.some((v,i)=>Math.abs(v-p[i])>.02),'the skirt follows the moving pelvis')
 }
})


test('the walking atlas preserves smooth source normals across shirt/skirt color boundaries',()=>{
 const raw=decodePassengerBytes(human.indices,human.encoding),ids=new (human.indexBits===32?Uint32Array:Uint16Array)(raw.buffer),regions=decodePassengerBytes(human.regions,human.encoding)
 const normals=restorePassengerFrames(new Int8Array(decodePassengerBytes(human.normals,human.encoding).buffer),human.vertices,human.poseEncoding)
 for(const outfit of ['tee-skirt','blouse-skirt','blue-navy-skirt','rose-slate-skirt']){
  const variant=human.library.findIndex(m=>m.outfit===outfit&&!m.bag),m=human.library[variant],p=passengerPose(0,variant),upper=new Map(),pairs=[]
  for(let i=0;i<human.corners;i++)if(Math.abs(p[i*3+2]-.64)<.004){const id=ids[variant*human.corners+i],color=human.paletteRGB[regions[id]],key=Array.from(p.slice(i*3,i*3+3)).join(',');if(color===m.top)upper.set(key,id)}
  for(let i=0;i<human.corners;i++)if(Math.abs(p[i*3+2]-.64)<.004){const id=ids[variant*human.corners+i],key=Array.from(p.slice(i*3,i*3+3)).join(',');if(human.paletteRGB[regions[id]]===m.bottom&&upper.has(key))pairs.push([id,upper.get(key)])}
  assert(pairs.length>10,outfit+' has shared source seam points')
  for(const [a,b]of pairs)for(const frame of [0,31,55])for(let axis=0;axis<3;axis++)assert(Math.abs(normals[(frame*human.vertices+a)*3+axis]-normals[(frame*human.vertices+b)*3+axis])<=2,'color boundaries cannot create a hard lighting seam')
 }
})
