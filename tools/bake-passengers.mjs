import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from '../game/node_modules/three/build/three.module.js'
import { GLTFLoader } from '../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptSimplifier } from '../game/node_modules/meshoptimizer/meshopt_simplifier.js'
import { HAIRSTYLES, passengerHair } from './passenger-hair.mjs'
import { INK, passengerHead, passengerRegion } from './passenger-anime.mjs'

// Offline CC0 outfit preparation. Source folder contains shirt.gltf, hoodie.gltf,
// suit.gltf and casual-woman.gltf; see assets/PASSENGERS.md for provenance.
const folder = resolve(process.argv[2])
const names = ['shirt', 'hoodie', 'suit', 'casual-woman']
const WALK_FRAMES = 24
const FRAMES = WALK_FRAMES + 1
const TARGET_TRIANGLES = 1000
globalThis.ProgressEvent ??= class { constructor(type, init) { Object.assign(this, {type}, init) } }
await MeshoptSimplifier.ready
const loader = new GLTFLoader()
const variants = []
for (const name of names) {
 const source = JSON.parse(readFileSync(resolve(folder, name + '.gltf'), 'utf8'))
 // The suit source includes an optional pistol attached to a hand. Commuters
 // use the clothed body only; leave that node empty before loading the rig.
 for (const node of source.nodes) if (/pistol|weapon|sword/i.test(node.name ?? '')) {
  delete node.mesh; delete node.skin
 }
 source.images = []; source.textures = []
 // Keep semantic material names for flat colour blocks, never source textures.
 source.materials = source.materials.map(m => ({name:m.name,pbrMetallicRoughness:{metallicFactor:0}}))
 const model = await loader.parseAsync(JSON.stringify(source), '')
 const meshes = [], headMeshes = []
 model.scene.traverse(n => { if (n.isSkinnedMesh) {
  if (/head/i.test(n.name+' '+n.parent?.name)) headMeshes.push(n)
  else meshes.push(n)
 } })
 if (!headMeshes.length) throw new Error(`Missing head geometry: ${name}`)
 const total = meshes.reduce((n,m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count), 0)
 const parts = meshes.map(mesh => {
  const original = mesh.geometry, p = original.attributes.position
  const partName=mesh.name+' '+mesh.parent?.name
  const regions = Array(p.count).fill(passengerRegion('', partName))
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const group of original.groups.length ? original.groups : [{start:0,count:original.index?.count ?? p.count,materialIndex:0}]) {
   const region = passengerRegion(materials[group.materialIndex]?.name ?? '', partName)
   for(let i=group.start;i<group.start+group.count;i++) regions[original.index ? original.index.getX(i) : i] = region
  }
  // These flat-shaded source meshes duplicate corners. Weld before reduction,
  // then smooth the texture-free cloth; skinning still uses the original vertex.
  const canonical = new Map(), weld = new Uint32Array(p.count)
  for(let i=0;i<p.count;i++) {
   const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e5)).join(',')+':'+regions[i]
   if(!canonical.has(key)) canonical.set(key,i)
   weld[i]=canonical.get(key)
  }
  const welded = Uint32Array.from(original.index?.array ?? Array.from({length:p.count},(_,i)=>i), i=>weld[i])
  const faces = new Set(), unique = []
  for(let i=0;i<welded.length;i+=3) {
   const triangle=Array.from(welded.subarray(i,i+3)), key=triangle.slice().sort((a,b)=>a-b).join(',')
   if(new Set(triangle).size<3 || faces.has(key))continue
   faces.add(key);unique.push(...triangle)
  }
  const input=Uint32Array.from(unique)
  const target = Math.max(12, Math.floor(TARGET_TRIANGLES * 3 * input.length / total / 3) * 3)
  const compact=[...new Set(input)], lookup=new Map(compact.map((v,i)=>[v,i]))
  const compactPositions=Float32Array.from(compact.flatMap(i=>[p.getX(i),p.getY(i),p.getZ(i)]))
  const [reduced] = MeshoptSimplifier.simplify(Uint32Array.from(input,i=>lookup.get(i)), compactPositions, 3, target, 0.06)
  const indices=Uint32Array.from(reduced,i=>compact[i])
  const used = [...new Set(indices)], remap = new Map(used.map((v,i)=>[v,i]))
  const geo = new THREE.BufferGeometry()
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices,i=>remap.get(i)),1))
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(used.length*3),3))
  return {mesh,original,used,geo,regions:used.map(i=>regions[i])}
 })
 const mixer = new THREE.AnimationMixer(model.scene)
 const idle=model.animations.find(c=>c.name==='Idle_Neutral')
 const walk=model.animations.find(c=>c.name==='Walk')
 const v=new THREE.Vector3()
 const poses=[], normals=[]
 const headTransforms=[]
 const headBone=model.scene.getObjectByName('Head')
 let scale=1, floor=0
 function setClip(clip,time) {
  mixer.stopAllAction();mixer.clipAction(clip).play();mixer.setTime(time)
  model.scene.updateMatrixWorld(true)
  for(const mesh of [...meshes,...headMeshes])mesh.skeleton.update()
 }
 function rawPositions() {
  for(const {mesh,original,used,geo} of parts) {
   const p=geo.attributes.position.array
   for(let i=0;i<used.length;i++) {
    v.fromBufferAttribute(original.attributes.position,used[i]);mesh.applyBoneTransform(used[i],v);v.applyMatrix4(mesh.matrixWorld)
    // Y up, +Z forward -> game Z up, +X forward; no reflected winding.
    p[i*3]=v.z*scale;p[i*3+1]=v.x*scale;p[i*3+2]=(v.y-floor)*scale
   }
  }
 }
 setClip(idle,0);rawPositions()
 const box=new THREE.Box3()
 for(const {geo}of parts)for(let i=0;i<geo.attributes.position.count;i++)box.expandByPoint(v.fromBufferAttribute(geo.attributes.position,i))
 const headBox=new THREE.Box3()
 for(const sourceHead of headMeshes)for(let i=0;i<sourceHead.geometry.attributes.position.count;i++) {
  v.fromBufferAttribute(sourceHead.geometry.attributes.position,i);sourceHead.applyBoneTransform(i,v);v.applyMatrix4(sourceHead.matrixWorld)
  headBox.expandByPoint(new THREE.Vector3(v.z,v.x,v.y))
 }
 box.union(headBox)
 floor=box.min.z;scale=1.73/(box.max.z-box.min.z)
 headBox.min.set(headBox.min.x*scale,headBox.min.y*scale,(headBox.min.z-floor)*scale)
 headBox.max.set(headBox.max.x*scale,headBox.max.y*scale,(headBox.max.z-floor)*scale)
 function sample() {
  rawPositions()
  headTransforms.push(headBone.matrixWorld.clone())
  let foot=Infinity
  for(const {geo}of parts)for(let i=2;i<geo.attributes.position.array.length;i+=3)foot=Math.min(foot,geo.attributes.position.array[i])
  const p=[],n=[]
  for(const {geo}of parts) {
   for(let i=2;i<geo.attributes.position.array.length;i+=3)geo.attributes.position.array[i]-=foot
   geo.computeVertexNormals()
   for(let index=0;index<geo.attributes.position.count;index++) {
    const o=index*3
    p.push(...geo.attributes.position.array.subarray(o,o+3))
    n.push(...geo.attributes.normal.array.subarray(o,o+3))
   }
  }
  poses.push(p);normals.push(n)
 }
 sample()
 for(let i=0;i<WALK_FRAMES;i++) {setClip(walk, i*walk.duration/WALK_FRAMES);sample()}
 const indices=[]
 let offset=0
 for(const {geo}of parts) {indices.push(...Array.from(geo.index.array,i=>i+offset));offset+=geo.attributes.position.count}
 console.log({name,vertices:offset,triangles:indices.length/3,walkDuration:walk.duration})
 // Bind hair to the animated head once, then bake it with every idle/walk pose.
 // It remains part of the same instanced draw as the clothing.
 const bindInverse=headTransforms[0].clone().invert()
 const head=passengerHead(headBox)
 const bodyRegions=parts.flatMap(p=>p.regions)
 for(const style of HAIRSTYLES) {
  const hair=passengerHair(style,head.boundingBox), local=[]
  const headCount=head.attributes.position.count
  const faceAndHair=new THREE.BufferGeometry()
  faceAndHair.setAttribute('position',new THREE.Float32BufferAttribute([...head.attributes.position.array,...hair.attributes.position.array],3))
  faceAndHair.setIndex([...head.index.array,...Array.from(hair.index.array,i=>i+headCount)])
  hair.dispose()
  const detail=faceAndHair
  for(let i=0;i<detail.attributes.position.count;i++) {
   v.fromBufferAttribute(detail.attributes.position,i)
   v.set(v.y/scale,v.z/scale+floor,v.x/scale).applyMatrix4(bindInverse)
   local.push(v.clone())
  }
  const hairPoses=[],hairNormals=[]
  for(let frame=0;frame<FRAMES;frame++) {
   const p=detail.attributes.position.array
   // Recover the same foot grounding offset used by the body sample.
   setClip(frame===0?idle:walk,frame===0?0:(frame-1)*walk.duration/WALK_FRAMES)
   rawPositions()
   let foot=Infinity
   for(const {geo}of parts)for(let i=2;i<geo.attributes.position.array.length;i+=3)foot=Math.min(foot,geo.attributes.position.array[i])
   for(let i=0;i<local.length;i++) {
    v.copy(local[i]).applyMatrix4(headTransforms[frame])
    p[i*3]=v.z*scale;p[i*3+1]=v.x*scale;p[i*3+2]=(v.y-floor)*scale-foot
   }
   detail.computeVertexNormals()
   hairPoses.push([...poses[frame],...p])
   hairNormals.push([...normals[frame],...detail.attributes.normal.array])
  }
  variants.push({name:`${name}-${style}`,poses:hairPoses,normals:hairNormals,
   regions:[...bodyRegions,...head.userData.regions,...Array(detail.attributes.position.count-headCount).fill(INK.hair)],
   indices:[...indices,...Array.from(detail.index.array,i=>i+offset)]})
  detail.dispose()
 }
 head.dispose()
}
// Share identical animated vertices across hairstyles instead of baking each
// clothed body six times. Vertex zero supplies safe degenerate padding.
const unique=[{p:Array(FRAMES*3).fill(0),n:Array.from({length:FRAMES*3},(_,i)=>i%3===2?127:0),region:INK.skin}]
const lookup=new Map()
for(const variant of variants) {
 const remap=[]
 for(let i=0;i<variant.poses[0].length/3;i++) {
  // Shallow silhouettes and a larger illustrated head retain real facing in
  // plan/side views. Compress the whole animated pose so joints still meet.
  const p=variant.poses.flatMap(frame=>frame.slice(i*3,i*3+3).map((n,axis)=>Math.round(n*[0.65,1,0.9][axis]*4096)))
  const n=variant.normals.flatMap(frame=> {
   const v=new THREE.Vector3(frame[i*3]/0.65,frame[i*3+1],frame[i*3+2]/0.9).normalize()
   return v.toArray().map(n=>Math.round(n*127))
  })
  const region=variant.regions[i]
  const key=p.join(',')+';'+n.join(',')+';'+region
  if(!lookup.has(key)){lookup.set(key,unique.length);unique.push({p,n,region})}
  remap.push(lookup.get(key))
 }
 variant.indices=variant.indices.map(i=>remap[i])
}
const vertices=unique.length
if(vertices>65535)throw new Error('Passenger vertex lookup exceeds Uint16 capacity')
const positions=new Int16Array(vertices*3*FRAMES)
const normals=new Int8Array(positions.length)
for(let i=0;i<vertices;i++)for(let frame=0;frame<FRAMES;frame++) {
 positions.set(unique[i].p.slice(frame*3,frame*3+3),(frame*vertices+i)*3)
 normals.set(unique[i].n.slice(frame*3,frame*3+3),(frame*vertices+i)*3)
}
const corners=Math.max(...variants.map(v=>v.indices.length))
const index=new Uint16Array(corners*variants.length)
for(let variant=0;variant<variants.length;variant++)index.set(variants[variant].indices,variant*corners)
const encode=a=>Buffer.from(a.buffer).toString('base64')
const baked={source:'Quaternius Ultimate Modular Men and Women; locally authored anime heads and hair',license:'CC0-1.0',style:'anime',
 variants:variants.map(v=>v.name),hairstyles:HAIRSTYLES,vertices,corners,triangles:corners/3,frames:FRAMES,walkFrames:WALK_FRAMES,height:1.73,
 stride:1.1,positionScale:4096,normalScale:127,regions:encode(Uint8Array.from(unique,v=>v.region)),indices:encode(index),positions:encode(positions),normals:encode(normals)}
const out=resolve('game/src/assets/passenger-human.json')
writeFileSync(out,JSON.stringify(baked)+'\n')
console.log({vertices,triangles:baked.triangles,variants:variants.length,bytes:readFileSync(out).length})
