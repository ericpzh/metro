import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from '../game/node_modules/three/build/three.module.js'
import { GLTFLoader } from '../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptSimplifier } from '../game/node_modules/meshoptimizer/meshopt_simplifier.js'

// Offline CC0 outfit preparation. Source folder contains shirt.gltf, hoodie.gltf,
// suit.gltf and casual-woman.gltf; see assets/PASSENGERS.md for provenance.
const folder = resolve(process.argv[2])
const names = ['shirt', 'hoodie', 'suit', 'casual-woman']
const WALK_FRAMES = 24
const FRAMES = WALK_FRAMES + 1
const TARGET_TRIANGLES = 1200
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
 source.images = []; source.textures = []; source.materials = [{pbrMetallicRoughness:{metallicFactor:0}}]
 for (const mesh of source.meshes) for (const primitive of mesh.primitives) primitive.material = 0
 const model = await loader.parseAsync(JSON.stringify(source), '')
 const meshes = []
 model.scene.traverse(n => { if (n.isSkinnedMesh) meshes.push(n) })
 const total = meshes.reduce((n,m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count), 0)
 const parts = meshes.map(mesh => {
  const original = mesh.geometry, p = original.attributes.position
  // These flat-shaded source meshes duplicate corners. Weld before reduction,
  // then smooth the texture-free cloth; skinning still uses the original vertex.
  const canonical = new Map(), weld = new Uint32Array(p.count)
  for(let i=0;i<p.count;i++) {
   const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e5)).join(',')
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
  return {mesh,original,used,geo}
 })
 const mixer = new THREE.AnimationMixer(model.scene)
 const idle=model.animations.find(c=>c.name==='Idle_Neutral')
 const walk=model.animations.find(c=>c.name==='Walk')
 const v=new THREE.Vector3()
 const poses=[], normals=[]
 let scale=1, floor=0
 function setClip(clip,time) {
  mixer.stopAllAction();mixer.clipAction(clip).play();mixer.setTime(time)
  model.scene.updateMatrixWorld(true)
  for(const {mesh} of parts)mesh.skeleton.update()
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
 floor=box.min.z;scale=1.73/(box.max.z-box.min.z)
 function sample() {
  rawPositions()
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
 variants.push({name,poses,normals,indices})
}
const vertices=Math.max(...variants.map(v=>v.poses[0].length/3))
const positions=new Int16Array(vertices*3*FRAMES*variants.length)
const normals=new Int8Array(positions.length)
for(let variant=0;variant<variants.length;variant++)for(let frame=0;frame<FRAMES;frame++) {
 const row=(variant*FRAMES+frame)*vertices*3
 positions.set(Int16Array.from(variants[variant].poses[frame],n=>Math.round(n*4096)),row)
 normals.set(Int8Array.from(variants[variant].normals[frame],n=>Math.round(n*127)),row)
 // Degenerate padding has a valid normal to avoid NaNs in lighting.
 for(let i=variants[variant].poses[frame].length+2;i<vertices*3;i+=3)normals[row+i]=127
}
const corners=Math.max(...variants.map(v=>v.indices.length))
const index=new Uint16Array(corners*variants.length)
for(let variant=0;variant<variants.length;variant++)index.set(variants[variant].indices,variant*corners)
const encode=a=>Buffer.from(a.buffer).toString('base64')
const baked={source:'Quaternius Ultimate Modular Men and Women',license:'CC0-1.0',
 variants:names,vertices,corners,triangles:corners/3,frames:FRAMES,walkFrames:WALK_FRAMES,height:1.73,
 stride:1.1,positionScale:4096,normalScale:127,indices:encode(index),positions:encode(positions),normals:encode(normals)}
const out=resolve('game/src/assets/passenger-human.json')
writeFileSync(out,JSON.stringify(baked)+'\n')
console.log({vertices,triangles:baked.triangles,variants:names.length,bytes:readFileSync(out).length})
