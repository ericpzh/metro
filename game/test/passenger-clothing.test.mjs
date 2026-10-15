import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import human from '../src/assets/passenger-approved.json' with {type:'json'}
import {passengerPose,PASSENGER_ADULT_OUTFITS,PASSENGER_CHILD_OUTFITS} from '../src/render/passengerModel.ts'
import {decodePassengerBytes} from '../src/render/passengerAtlas.ts'
import {passengerBakePart,passengerVertexKey,passengerExteriorGeometry} from '../../tools/passenger-bake-geometry.mjs'

test('every baked clothing entry matches its current reviewed GLB export',()=>{
 const stale=[]
 for(const model of human.library.filter(m=>m.outfit)){
  const data=readFileSync(new URL(`../../model/public/models/${model.file}`,import.meta.url))
  const actual=createHash('sha256').update(data).digest('hex')
  if(actual!==model.sourceSha256)stale.push({id:model.id,file:model.file,expected:model.sourceSha256,actual})
 }
 assert.deepEqual(stale,[],'clothing exports changed: regenerate the reviewed exports and game atlas with npm run bake:passengers')
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

test('all twenty clothes and both grey arrangements enter both age pools with exact flat tones',()=>{
 const clothes=human.library.filter(m=>m.outfit)
 assert.equal(clothes.length,40)
 const bytes=decodePassengerBytes(human.indices,human.encoding)
 const indices=new (human.indexBits===32?Uint32Array:Uint16Array)(bytes.buffer,bytes.byteOffset,bytes.byteLength/(human.indexBits/8))
 const regions=decodePassengerBytes(human.regions,human.encoding)
 for(const sex of ['female','male'])assert.equal(new Set(clothes.filter(m=>m.character===sex).map(m=>m.outfit)).size,10)
 for(const model of clothes){
  const index=human.library.indexOf(model)
  assert(PASSENGER_ADULT_OUTFITS.includes(index)&&PASSENGER_CHILD_OUTFITS.includes(index))
  assert(!model.bag&&model.hair!=='bald')
  const pair=clothes.find(m=>m.character===model.character&&m.outfit===model.outfit&&m.swapTones!==model.swapTones)
  assert(pair);assert.equal(pair.top,model.bottom);assert.equal(pair.bottom,model.top)
  const palette=new Set(Array.from(indices.subarray(index*human.corners,(index+1)*human.corners),v=>human.palette[regions[v]]))
  for(const color of [model.top,model.bottom])assert(palette.has(parseInt(color.slice(1,3),16)/255),`${model.id}: authored grey survives the bake`)
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

test('the actual skirt bake omits hidden thighs, inward walls and horizontal caps at game opacity',()=>{
 const bytes=decodePassengerBytes(human.indices,human.encoding)
 const indices=new (human.indexBits===32?Uint32Array:Uint16Array)(bytes.buffer,bytes.byteOffset,bytes.byteLength/(human.indexBits/8))
 const regions=decodePassengerBytes(human.regions,human.encoding)
 for(const [variant,model] of human.library.entries())if(model.outfit&&model.garmentShape!=='trousers'){
  const pose=passengerPose(0,variant),hem=model.outfit.startsWith('midi-')?.27:.19,bottom=parseInt(model.bottom.slice(1,3),16)/255
  let outerFaces=0,ankles=0
  for(let i=0;i<human.corners;i++){
   const ink=human.palette[regions[indices[variant*human.corners+i]]],point=new THREE.Vector3(...pose.slice(i*3,i*3+3))
   if(ink===.78&&point.z<hem+.02&&point.z>.10)ankles++
   assert(!(ink===.78&&point.z>hem+.06&&point.z<.72&&Math.abs(point.y)<.20),`${model.id}: hidden thighs cannot show through the translucent skirt`)
  }
  for(let i=0;i<human.corners;i+=3){
   const ids=indices.subarray(variant*human.corners+i,variant*human.corners+i+3)
   if(new Set(ids).size<3||human.palette[regions[ids[0]]]!==bottom)continue
   const [a,b,c]=[0,1,2].map(k=>new THREE.Vector3(...pose.slice((i+k)*3,(i+k)*3+3)))
   const normal=b.clone().sub(a).cross(c.clone().sub(a)),center=a.clone().add(b).add(c).multiplyScalar(1/3)
   if(normal.lengthSq()<1e-14)continue
   assert(normal.x*(center.x-.035)+normal.y*center.y>0,`${model.id}: only the outward wall is rendered, without see-through caps or inner walls`)
   outerFaces++
  }
  assert(outerFaces>200&&ankles>20,'outer cloth and exposed ankles both survive the bake')
 }
})

test('the actual baked skirts retain their exported clearance morphs through all three gaits',async()=>{
 const bytes=decodePassengerBytes(human.indices,human.encoding)
 const indices=new (human.indexBits===32?Uint32Array:Uint16Array)(bytes.buffer,bytes.byteOffset,bytes.byteLength/(human.indexBits/8))
 const regions=decodePassengerBytes(human.regions,human.encoding)
 let missingWithStaticSkirt=0
 for(const model of human.library.filter(m=>m.outfit&&m.garmentShape!=='trousers'&&!m.swapTones)){
  const data=readFileSync(new URL(`../../model/public/models/${model.file}`,import.meta.url))
  assert.equal(createHash('sha256').update(data).digest('hex'),model.sourceSha256,`${model.id}: the game uses the current reviewed GLB`)
  const gltf=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'')
  const skirt=gltf.scene.getObjectByName('Long_skirt');assert.equal(skirt.morphTargetInfluences.length,72)
  const variant=human.library.indexOf(model),bottom=parseInt(model.bottom.slice(1,3),16)/255
  const corners=[]
  for(let i=0;i<human.corners;i++)if(human.palette[regions[indices[variant*human.corners+i]]]===bottom)corners.push(i)
  const used=[...new Set(corners.map(i=>indices[variant*human.corners+i]))]
  assert(used.length>200,'the actual skirt surface survives simplification')
  // The baker grounds the simplified sole, which can sit a few millimetres
  // above the full GLB sole. Align the common skirt hem before comparing its
  // actual shape; the library suite independently pins contact with the ground.
  const key=v=>[v.x,v.y,v.z].map(x=>Math.floor(x/.004)).join(',')
  const cloud=bakedHem=>{
   const points=new Map(),point=new THREE.Vector3(),posed=[]
   for(let i=0;i<skirt.geometry.attributes.position.count;i++){
    skirt.getVertexPosition(i,point);posed.push(new THREE.Vector3(point.z,point.x,point.y))
   }
   const offset=Math.min(...posed.map(q=>q.z))-bakedHem
   assert(offset>-.001&&offset<.05,`${model.id}: source/bake sole adjustment ${offset} stays within the simplified shoe`)
   for(const q of posed){
    q.z-=offset;const cell=key(q)
    if(!points.has(cell))points.set(cell,[]);points.get(cell).push(q)
   }
   return points
  }
  const matches=(points,q)=>{
   const cell=key(q).split(',').map(Number)
   for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)
    if(points.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))?.some(p=>p.distanceTo(q)<.004))return true
   return false
  }
  const mixer=new THREE.AnimationMixer(gltf.scene)
  for(const [profile,clip] of gltf.animations.entries()){
   mixer.stopAllAction();mixer.clipAction(clip).play()
   for(const sample of [6,12,18]){
    mixer.setTime(sample*clip.duration/24);gltf.scene.updateMatrixWorld(true);skirt.skeleton.update()
    const pose=passengerPose(human.walkProfiles[profile].firstFrame+sample,variant)
    const bakedHem=Math.min(...corners.map(i=>pose[i*3+2]))
    const posed=cloud(bakedHem),weights=skirt.morphTargetInfluences.slice()
    skirt.morphTargetInfluences.fill(0);const standingShell=cloud(bakedHem);skirt.morphTargetInfluences.splice(0,weights.length,...weights)
    // Repeated triangle corners need only one check per actual baked vertex.
    const seen=new Set()
    for(const corner of corners){
     const vertex=indices[variant*human.corners+corner];if(seen.has(vertex))continue;seen.add(vertex)
     const point=new THREE.Vector3(...pose.slice(corner*3,corner*3+3))
     assert(matches(posed,point),`${model.id}/${clip.name}/${sample}: baked cloth follows the exported moving shell`)
     if(!matches(standingShell,point))missingWithStaticSkirt++
    }
   }
  }
  mixer.stopAllAction();mixer.uncacheRoot(gltf.scene)
  gltf.scene.traverse(m=>{if(m.isMesh){m.geometry.dispose();for(const material of Array.isArray(m.material)?m.material:[m.material])material.dispose()}})
 }
 assert(missingWithStaticSkirt>1000,'the regression rejects a standing skirt attached to a walking skeleton')
})
