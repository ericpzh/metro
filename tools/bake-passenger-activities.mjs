// Compact GPU rigs for the reviewed interaction poses. No runtime skeletons or
// per-appearance pose-volume duplication: bind vertices + two small bone palettes.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import * as THREE from '../model/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../model/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptSimplifier} from '../game/node_modules/meshoptimizer/meshopt_simplifier.js';
import {MODEL_LIBRARY} from '../model/src/characters/library.js';
import {createInteractionArms} from '../model/src/animation/interaction-arms.js';
import {createInteractionPoser,solveLimb} from '../model/src/animation/interactions.js';
import {createPassengerWalkPoser} from '../model/src/animation/walk-poses.js';
import {passengerExteriorGeometry} from './passenger-bake-geometry.mjs';
import {passengerLowTopology} from './passenger-low-topology.mjs';
import {outfitFor} from '../model/src/characters/outfit-presets.js';
import {ACTIVITY_NAMES,ACTIVITY_DURATION,ACTIVITY_SAMPLES,activityRailTarget} from '../game/src/sim/activities.ts';
import {WALK_PROFILES} from '../game/src/sim/constants.ts';
import {writeAsset} from '../model/scripts/write-asset.mjs';

await MeshoptSimplifier.ready;
const human=JSON.parse(readFileSync(new URL('../game/src/assets/passenger-approved.json',import.meta.url),'utf8'));
const posesOnly=process.argv.includes('--poses-only');
if(MODEL_LIBRARY.length!==human.library.length||MODEL_LIBRARY.some((m,i)=>m.id!==human.library[i].id))throw Error('Bake the approved walking catalogue before activities');
if(posesOnly)for(const model of human.library){
 const bytes=readFileSync(new URL('../model/public/models/'+model.file,import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!==model.sourceSha256)throw Error('Reviewed export changed; run npm run bake:passengers');
}
const palette=human.palette.map(g=>new THREE.Color().setRGB(g,g,g,THREE.SRGBColorSpace).r);
const samples=ACTIVITY_SAMPLES,boneCount=16,fits=[.5,.6,.7,.8,.9,1,1.1,1.2],rigs=[],matrices=[],vertices=[],lookup=new Map(),models=[];
const encode=a=>deflateSync(Buffer.from(a.buffer,a.byteOffset,a.byteLength),{level:9}).toString('base64');
const matrix=new THREE.Matrix4();
function garmentOf(id){
 const variant=MODEL_LIBRARY.find(m=>m.id===id),clothes=variant.outfit?outfitFor(variant.character,variant.outfit):null;
 return clothes&&clothes.shape!=='trousers'?{hem:clothes.hem??.19,waist:(clothes.topHem??.825)+.0005}:{hem:0,waist:0};
}
for(const variant of posesOnly?['male','female'].map(character=>MODEL_LIBRARY.find(m=>m.character===character)):MODEL_LIBRARY){
 const data=readFileSync(new URL('../model/public/models/'+variant.file,import.meta.url));
 if(createHash('sha256').update(data).digest('hex')!==human.library.find(m=>m.id===variant.id).sourceSha256)throw Error('Reviewed export changed; bake its walking atlas before activities');
 const gltf=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 const arms=createInteractionArms(gltf.scene);arms.setEnabled(true);
 const meshes=[];gltf.scene.traverse(n=>{if(n.isSkinnedMesh&&n.visible)meshes.push(n)});
 const skeleton=meshes[0].skeleton;
 if(skeleton.bones.length!==boneCount)throw Error('Unexpected passenger rig');
 let rig=rigs.indexOf(variant.character);
 if(rig<0){
  rig=rigs.length;rigs.push(variant.character);
  const pose=createInteractionPoser(gltf.scene),walk=createPassengerWalkPoser(gltf.scene);
  // Rows 0..14 are activities, then three ordinary walk palettes. Matrices
  // already include inverse bind; the source meshes use identity bind frames.
  for(const height of fits)for(let activity=0;activity<ACTIVITY_NAMES.length+3;activity++)for(let frame=0;frame<samples;frame++){
   gltf.scene.scale.set(height<.78?.7:1,height,height<.78?.7:1);
   const name=ACTIVITY_NAMES[activity],t=(ACTIVITY_DURATION[activity]??1)*frame/(samples-1),mirrorGate=(name==='qr'||name==='card')&&t>=4;
   if(activity>=ACTIVITY_NAMES.length)walk(frame/samples,WALK_PROFILES[activity-ACTIVITY_NAMES.length]);
   else if(name==='qr'||name==='card')pose(name,(t%4)*2);
   else if(name==='escalator-left'||name==='escalator'){
    pose('wait',4);
    const bones=Object.fromEntries(skeleton.bones.map(b=>[b.name,b]));
    const side=name==='escalator-left'?'Left':'Right',sign=side==='Left'?-1:1;
    const target=activityRailTarget(Math.floor(frame/6),height);target[0]*=sign;
    // Raise above the inner edge before reaching onto the belt; reverse this
    // path on release so neither hand nor sleeve cuts through the solid rail.
    const stage=frame%6;
    if(stage===1||stage===4){target[0]-=sign*.08;target[1]+=.08;}
    if(stage>0&&stage<5)solveLimb(bones[side+'Arm'],bones[side+'Forearm'],bones[side+'Hand'],new THREE.Vector3(...target),height<.9||frame>=12?new THREE.Vector3(-sign*.6,-.3,-1):new THREE.Vector3(-sign*.1,-1,0));
   }else pose(name==='walk'?'wait':name,t,{foot:[0,0,0],rail:[.48,1.15,.32]});
   // World root travel belongs to simulation, never to the gesture clip.
   gltf.scene.position.set(0,0,0);gltf.scene.rotation.set(0,0,0);gltf.scene.scale.setScalar(1);gltf.scene.updateMatrixWorld(true);skeleton.update();
   if(mirrorGate){
    const reflect=new THREE.Matrix4().makeScale(-1,1,1);
    for(let bone=0;bone<boneCount;bone++){
     const name=skeleton.bones[bone].name,other=/Arm|Forearm|Hand/.test(name)?skeleton.bones.findIndex(b=>b.name===name.replace(/Left|Right/,s=>s==='Left'?'Right':'Left')):bone;
     const pose=new THREE.Matrix4().fromArray(skeleton.boneMatrices,other*16);
     if(other!==bone)pose.premultiply(reflect).multiply(reflect);
     matrices.push(...pose.elements);
    }
   }else matrices.push(...skeleton.boneMatrices);
  }
 }
 if(posesOnly){arms.dispose();continue;}
 skeleton.pose();gltf.scene.position.set(0,0,0);gltf.scene.rotation.set(0,0,0);gltf.scene.updateMatrixWorld(true);
 const full=[],localVertices=[],regions=[],global=[];
 for(const mesh of meshes){
  // Game exterior policy preserves the opaque source for download.
  const clothing=variant.outfit?outfitFor(variant.character,variant.outfit):null;
  const geo=passengerExteriorGeometry(mesh,clothing),a=geo.attributes;
  if(!geo.index?.count)continue;
  if(!a.normal)geo.computeVertexNormals();
  const used=[],source=new Map(),canonical=new Map();
  for(const v of new Set(geo.index.array)){
   const key=[...a.position.array.slice(v*3,v*3+3),a.color?.getX(v)??.5,...a.skinIndex.array.slice(v*4,v*4+4),...a.skinWeight.array.slice(v*4,v*4+4)].map(x=>Math.round(x*100000)).join(',');
   if(!canonical.has(key)){canonical.set(key,used.length);used.push(v)}
   source.set(v,canonical.get(key));
  }
  const positions=Float32Array.from(used.flatMap(v=>[a.position.getX(v),a.position.getY(v),a.position.getZ(v)]));
  const attributes=new Float32Array(used.length*(boneCount+1));
  for(const [j,v] of used.entries()){
   attributes[j*(boneCount+1)]=a.color?.getX(v)??.5;
   for(let k=0;k<4;k++)attributes[j*(boneCount+1)+1+a.skinIndex.array[v*4+k]]+=a.skinWeight.array[v*4+k];
  }
  const raw=Uint32Array.from(geo.index.array,v=>source.get(v));
  const target=Math.min(raw.length,(mesh.userData.interactionArm?280:used.length>20000?3800:450)*3);
  const [reduced]=MeshoptSimplifier.simplifyWithAttributes(raw,positions,3,attributes,boneCount+1,[8,...Array(boneCount).fill(1)],null,target,.012);
  const local=new Map();
  for(const r of new Set(reduced)){
   const v=used[r],region=palette.reduce((best,c,i)=>Math.abs(c-(a.color?.getX(v)??.5))<Math.abs(palette[best]-(a.color?.getX(v)??.5))?i:best,0);
   matrix.copy(mesh.bindMatrix);
   const p=new THREE.Vector3().fromBufferAttribute(a.position,v).applyMatrix4(matrix);
   const n=new THREE.Vector3().fromBufferAttribute(a.normal,v).transformDirection(matrix);
   const values=[p.x,p.y,p.z,rig,n.x,n.y,n.z,region,...a.skinWeight.array.slice(v*4,v*4+4),...a.skinIndex.array.slice(v*4,v*4+4)];
   const key=values.map(x=>Math.round(x*100000)).join(',');
   if(!lookup.has(key)){lookup.set(key,vertices.length/16);vertices.push(...values)}
   local.set(r,localVertices.length/3);localVertices.push(p.z,p.x,p.y);regions.push(region);global.push(lookup.get(key));
  }
  full.push(...Array.from(reduced,r=>local.get(r)));
 }
 const count=localVertices.length/3;
 const {indices:low}=passengerLowTopology({indices:full,poses:Int16Array.from(localVertices,v=>Math.round(v*4096)),vertices:count,regions,maxTriangles:human.lowCorners/3});
 models.push({id:variant.id,sourceSha256:createHash('sha256').update(data).digest('hex'),indices:full.map(i=>global[i]),lowIndices:low.map(i=>global[i])});
 arms.dispose();gltf.scene.traverse(n=>{if(n.isMesh){n.geometry.dispose();for(const m of [].concat(n.material))m.dispose()}});
 console.log(variant.id,full.length/3,low.length/3);
}
if(posesOnly){
 const path=new URL('../game/src/assets/passenger-activities.json',import.meta.url),asset=JSON.parse(readFileSync(path,'utf8'));
 if(asset.library.length!==human.library.length||asset.library.some((m,i)=>m.id!==human.library[i].id||m.sourceSha256!==human.library[i].sourceSha256))throw Error('Activity geometry is stale; run the full activity bake');
 Object.assign(asset,{matrices:encode(Float32Array.from(matrices)),fits,rigs,samples,boneCount,library:asset.library.map(m=>({...m,...garmentOf(m.id)}))});
 await writeAsset(path,JSON.stringify(asset)+'\n');console.log('Updated shared activity palettes');process.exit(0);
}
const corners=Math.max(...models.map(m=>m.indices.length)),lowCorners=Math.max(...models.map(m=>m.lowIndices.length));
if(corners>human.corners||lowCorners>human.lowCorners)throw Error(`Activity topology exceeds prepared crowd stride: ${corners}/${human.corners}, ${lowCorners}/${human.lowCorners}`);
const table=key=>{const stride=key==='indices'?corners:lowCorners,values=new Uint32Array(models.length*stride);models.forEach((m,i)=>{values.fill(m[key][0],i*stride,(i+1)*stride);values.set(m[key],i*stride)});return encode(values)};
const asset={version:1,encoding:'zlib-base64',samples,boneCount,fits,rigs,activities:ACTIVITY_NAMES,durations:ACTIVITY_DURATION,vertices:vertices.length/16,corners,lowCorners,
 library:models.map(m=>({id:m.id,sourceSha256:m.sourceSha256,triangles:m.indices.length/3,lowTriangles:m.lowIndices.length/3,...garmentOf(m.id)})),
 data:encode(Float32Array.from(vertices)),matrices:encode(Float32Array.from(matrices)),indices:table('indices'),lowIndices:table('lowIndices')};
await writeAsset(new URL('../game/src/assets/passenger-activities.json',import.meta.url),JSON.stringify(asset)+'\n');
console.log({vertices:asset.vertices,corners,lowCorners,rigs,bytes:JSON.stringify(asset).length});
