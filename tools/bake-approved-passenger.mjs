import {readFileSync} from 'node:fs';
import {writeAsset} from '../model/scripts/write-asset.mjs';
import {createHash} from 'node:crypto';
import * as THREE from '../game/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptSimplifier} from '../game/node_modules/meshoptimizer/meshopt_simplifier.js';
import {WALK_PROFILES} from '../game/src/sim/constants.ts';
import {MODEL_LIBRARY} from '../model/src/characters/library.js';
import {createPassengerWalkPoser} from './passenger-walk-poses.mjs';

// Consume the reviewed exports, including closed coats and trimmed strap surfaces.
// Regenerate them first: node model/scripts/prepare-assets.mjs.
await MeshoptSimplifier.ready;
const palette=[.40,.43,.44,.46,.47,.48,.53,.62,.66,.74,.78,.89];
const linear=palette.map(g=>new THREE.Color().setRGB(g,g,g,THREE.SRGBColorSpace).r);
async function bakeVariant(variant) {
const source=new URL('../model/public/models/'+variant.file,import.meta.url);
const bytes=readFileSync(source),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const meshes=[];gltf.scene.traverse(n=>{
 if(!n.isSkinnedMesh||!n.visible)return;
 if(n.name.includes('backpack')){meshes.push(n);return}
 const p=n.geometry.attributes.position,index=n.geometry.index?.array??Array.from({length:p.count},(_,i)=>i),head=[],body=[];
 for(let i=0;i<index.length;i+=3){const target=[index[i],index[i+1],index[i+2]].some(v=>p.getY(v)>1.34)?head:body;target.push(index[i],index[i+1],index[i+2])}
 for(const [name,indices] of [['Head',head],['Body',body]]){if(!indices.length)continue;const part=n.clone(false);part.name=name;part.geometry=n.geometry.clone();part.geometry.setIndex(indices);meshes.push(part)}
});

const total=meshes.reduce((sum,m)=>sum+(m.geometry.index?.count??m.geometry.attributes.position.count),0);
const parts=[];
for(const mesh of meshes){
 const geo=mesh.geometry,p=geo.attributes.position,c=geo.attributes.color,skin=geo.attributes.skinWeight,bones=geo.attributes.skinIndex;
 const canonical=new Map(),remap=[],original=[],positions=[],attributes=[],regions=[];
 for(const i of new Set(geo.index?.array??Array.from({length:p.count},(_,i)=>i))){
  const region=linear.reduce((best,v,j)=>Math.abs(v-c.getX(i))<Math.abs(linear[best]-c.getX(i))?j:best,0);
  const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e5)).join(',')+':'+region+':'+Array.from(bones.array.subarray(i*4,i*4+4))+':'+Array.from(skin.array.subarray(i*4,i*4+4),x=>Math.round(x*1e4));
  if(!canonical.has(key)){
   canonical.set(key,original.length);original.push(i);positions.push(p.getX(i),p.getY(i),p.getZ(i));regions.push(region);
   const head=THREE.MathUtils.smoothstep(p.getY(i),1.32,1.43);
   attributes.push(linear[region],...skin.array.subarray(i*4,i*4+4),p.getX(i)*head,(p.getY(i)-1.4)*head,p.getZ(i)*head);
  }
  remap[i]=canonical.get(key);
 }
 const raw=Uint32Array.from(geo.index?.array??Array.from({length:p.count},(_,i)=>i),i=>remap[i]);
 const target=mesh.name==='Head'?650*3:Math.max(120,Math.floor(2400*3*raw.length/total/3)*3);
 const [reduced,error]=MeshoptSimplifier.simplifyWithAttributes(raw,Float32Array.from(positions),3,Float32Array.from(attributes),8,[8,.2,.2,.2,.2,3,3,3],null,Math.min(raw.length,target),mesh.name==='Head'?.012:.025);

 const used=[...new Set(reduced)],lookup=new Map(used.map((v,i)=>[v,i]));
 parts.push({mesh,used:used.map(i=>original[i]),regions:used.map(i=>regions[i]),indices:Array.from(reduced,i=>lookup.get(i))});

}
const walkFrames=24,frames=walkFrames*WALK_PROFILES.length+1,vertices=parts.reduce((sum,p)=>sum+p.used.length,0);
if(vertices>65535)throw Error('Atlas needs Uint16 indices');
const corners=parts.reduce((sum,p)=>sum+p.indices.length,0),indices=[],regions=[];
let offset=0;for(const p of parts){indices.push(...p.indices.map(i=>i+offset));regions.push(...p.regions);offset+=p.used.length}
const poses=new Int16Array(vertices*3*frames),normals=new Int8Array(poses.length);
const poseWalk=createPassengerWalkPoser(gltf.scene);
const v=new THREE.Vector3();
for(let frame=0;frame<frames;frame++){
 if(frame){poseWalk(((frame-1)%walkFrames)/walkFrames,WALK_PROFILES[Math.floor((frame-1)/walkFrames)]);parts.forEach(p=>p.mesh.skeleton.update())}
 const values=[],geometries=[];let foot=Infinity;
 for(const part of parts){
  const position=part.mesh.geometry.attributes.position,a=[];
  for(const i of part.used){v.fromBufferAttribute(position,i);if(frame)part.mesh.applyBoneTransform(i,v);a.push(v.z,v.x,v.y);foot=Math.min(foot,v.y)}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(a,3));geo.setIndex(part.indices);geo.computeVertexNormals();geometries.push(geo);values.push(a);
 }
 let vertex=0;
 for(let j=0;j<parts.length;j++){
  const a=values[j],n=geometries[j].attributes.normal.array;
  for(let i=0;i<a.length;i+=3,vertex++){
   const k=(frame*vertices+vertex)*3;
   poses.set([Math.round(a[i]*4096),Math.round(a[i+1]*4096),Math.round((a[i+2]-foot)*4096)],k);
   normals.set([n[i],n[i+1],n[i+2]].map(x=>Math.round(x*127)),k);
  }
 }
 geometries.forEach(g=>g.dispose());
}
return {...variant,vertices,corners,poses,normals,indices,regions,sourceSha256:createHash('sha256').update(bytes).digest('hex')};
}
const models=[];
for(const variant of MODEL_LIBRARY){const model=await bakeVariant(variant);models.push(model);console.log(variant.id,{vertices:model.vertices,triangles:model.corners/3});}
const walkFrames=24,frames=1+walkFrames*WALK_PROFILES.length;
// Share identical complete animated vertices across variants. Never weld by
// standing position alone: a matching vertex must retain every walk and colour.
const canonical=new Map(),references=[];
for(const model of models){
 model.lookup=[];
 const fingerprint=new Uint8Array(frames*9+1),view=new DataView(fingerprint.buffer);
 for(let vertex=0;vertex<model.vertices;vertex++){
  fingerprint[frames*9]=model.regions[vertex];
  for(let frame=0;frame<frames;frame++)for(let axis=0;axis<3;axis++){
   const i=(frame*model.vertices+vertex)*3+axis;
   view.setInt16(frame*9+axis*2,model.poses[i],true);view.setInt8(frame*9+6+axis,model.normals[i]);
  }
  const key=createHash('sha256').update(fingerprint).digest('hex');
  if(!canonical.has(key)){canonical.set(key,references.length);references.push({model,vertex});}
  model.lookup.push(canonical.get(key));
 }
}
// Planar cleanup can make formerly separate vertices match in every pose.
// Drop triangles collapsed by that canonicalization before choosing padding.
for(const model of models){
 const indices=[];
 for(let i=0;i<model.indices.length;i+=3){
  const triangle=model.indices.slice(i,i+3),[a,b,c]=triangle.map(v=>model.lookup[v]);
  if(a!==b&&a!==c&&b!==c)indices.push(...triangle);
 }
 model.indices=indices;model.corners=indices.length;
}
const vertices=references.length,corners=Math.max(...models.map(m=>m.corners));
const poses=new Int16Array(vertices*3*frames),normals=new Int8Array(poses.length),regions=new Uint8Array(vertices);
const IndexArray=vertices>65535?Uint32Array:Uint16Array;
const indices=new IndexArray(corners*models.length);
for(let vertex=0;vertex<vertices;vertex++){
 const ref=references[vertex];regions[vertex]=ref.model.regions[ref.vertex];
 for(let frame=0;frame<frames;frame++){
  const i=(frame*ref.model.vertices+ref.vertex)*3,target=(frame*vertices+vertex)*3;
  poses.set(ref.model.poses.subarray(i,i+3),target);normals.set(ref.model.normals.subarray(i,i+3),target);
 }
}
for(const [outfit,model] of models.entries()){
 const start=outfit*corners;indices.fill(model.lookup[0],start,start+corners);
 indices.set(model.indices.map(i=>model.lookup[i]),start);
}
const encode=a=>Buffer.from(a.buffer).toString('base64');
const walkProfiles=WALK_PROFILES.map((p,i)=>({...p,stride:p.speed*p.cycleSeconds,firstFrame:i*walkFrames+1}));
const library=models.map(({id,character,hair,bag,bagStyle,file,vertices,corners,sourceSha256})=>({id,character,hair,bag,...(bagStyle?{bagStyle}:{}),file,vertices,triangles:corners/3,sourceSha256}));
const baked={source:'Approved model library, local TRELLIS reconstruction and authored variants; foot-targeted slow/medium/fast walks',style:'grey-faceless',variants:models.map(m=>m.id),hairstyles:models.map(m=>m.hair),library,palette,vertices,corners,triangles:corners/3,indexBits:IndexArray.BYTES_PER_ELEMENT*8,frames,walkFrames,walkProfiles,height:1.72,stride:walkProfiles[0].stride,positionScale:4096,normalScale:127,regions:encode(regions),indices:encode(indices),positions:encode(poses),normals:encode(normals)};
const out=new URL('../game/src/assets/passenger-approved.json',import.meta.url);await writeAsset(out,JSON.stringify(baked)+'\n');
console.log({variants:models.length,vertices,triangles:corners/3,atlasRows:Math.ceil(vertices*frames/1024),bytes:readFileSync(out).length});
