// Offline promotion of the selected body, wardrobe, bags and motion into the
// existing instanced crowd. No FBX loading or live skeletons in game runtime.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import * as T from '../model/node_modules/three/build/three.module.js';
import {MeshoptSimplifier} from '../game/node_modules/meshoptimizer/meshopt_simplifier.js';
import {createImportedSoftHuman,SOFT_BASE_URL} from '../model/src/soft-human/imported-base.js';
import {createWardrobe,OUTFITS} from '../model/src/soft-human/wardrobe.js';
import {createMotion} from '../model/src/soft-human/character.js';
import {createSoftActivityPoser} from '../model/src/soft-human/activities.js';
import {SOFT_MODEL_LIBRARY} from '../model/src/soft-human/catalog.js';
import {ACTIVITY_NAMES,ACTIVITY_DURATION,ACTIVITY_SAMPLES,activityRailTarget} from '../game/src/sim/activities.ts';
import {WALK_PROFILES} from '../game/src/sim/constants.ts';
import {deltaPassengerFrames} from './passenger-bake-geometry.mjs';
import {passengerLowTopology} from './passenger-low-topology.mjs';
import {writeAsset} from '../model/scripts/write-asset.mjs';

await MeshoptSimplifier.ready;
const source=readFileSync(new URL('../model/public'+SOFT_BASE_URL,import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const inputs=['game/src/sim/activities.ts','game/src/sim/constants.ts','model/src/animation/interactions.js','model/src/soft-human/imported-base.js','model/src/soft-human/character.js','model/src/soft-human/activities.js','model/src/soft-human/wardrobe.js','model/src/soft-human/skirt.js','model/src/soft-human/torso-fit.js','model/src/soft-human/mathematical-strap.js','model/src/soft-human/carried-bags.js','model/src/soft-human/bag-shell.js','model/src/soft-human/bag-connectors.js','model/src/soft-human/catalog.js','tools/bake-soft-passengers.mjs','tools/passenger-low-topology.mjs'];
const sourceHashes=Object.fromEntries(inputs.map(path=>[path,sha(readFileSync(new URL('../'+path,import.meta.url)))]));
const sourceSha256=sha(source),recipeSha256=sha(JSON.stringify(sourceHashes));
const c=createImportedSoftHuman(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength)),w=createWardrobe(c),motion=createMotion(c);
const frames=73,walkFrames=24,boneCount=c.bones.length,cache=new Map(),parts=[],models=[],paletteRGB=[];
let vertices=0;
const palette=material=>{const hex='#'+material.color.getHexString();let id=paletteRGB.indexOf(hex);if(id<0){id=paletteRGB.length;paletteRGB.push(hex)}return id};
const vec=new T.Vector3(),mat=new T.Matrix4();

function prepare(mesh,group,outfit){
 const g=mesh.geometry,a=g.attributes,raw=g.index?.array??Array.from({length:a.position.count},(_,i)=>i),region=palette([].concat(mesh.material)[group.materialIndex??0]);
 const positions=[],normals=[],weights=[],bones=[],original=[],remap=new Map(),canonical=new Map(),indices=[];
 let rigid=mesh.parent;while(rigid&&!rigid.isBone)rigid=rigid.parent;
 const rigidBone=rigid?c.bones.indexOf(rigid):c.bones.indexOf(c.chest);
 const transform=c.body.matrixWorld.clone().invert().multiply(mesh.matrixWorld),normalMatrix=new T.Matrix3().getNormalMatrix(transform);
 const isSkirt=mesh.userData.skirt?.construction==='source-body-bridge';
 for(let k=group.start;k<group.start+group.count;k+=3){
  const tri=[raw[k],raw[k+1],raw[k+2]];
  for(const v of tri){
   if(!remap.has(v)){
    const p=new T.Vector3().fromBufferAttribute(a.position,v),n=new T.Vector3().fromBufferAttribute(a.normal,v);
    if(!mesh.isSkinnedMesh){p.applyMatrix4(transform);n.applyMatrix3(normalMatrix).normalize()}
    const ids=mesh.isSkinnedMesh?Array.from(a.skinIndex.array.slice(v*4,v*4+4)):[rigidBone,0,0,0],ws=mesh.isSkinnedMesh?Array.from(a.skinWeight.array.slice(v*4,v*4+4)):[1,0,0,0];
    const key=[...p.toArray(),...n.toArray(),...ids,...ws].map(x=>Math.round(x*1e6)).join(',');
    if(!canonical.has(key)){canonical.set(key,original.length);original.push(v);positions.push(...p.toArray());normals.push(...n.toArray());bones.push(...ids);weights.push(...ws)}
    remap.set(v,canonical.get(key));
   }
   indices.push(remap.get(v));
  }
 }
 if(!indices.length)return null;
 const key=sha(JSON.stringify([region,positions,normals,bones,weights,indices]));
 if(cache.has(key))return cache.get(key);
 const attrs=new Float32Array(original.length*boneCount);
 for(let v=0;v<original.length;v++)for(let j=0;j<4;j++)attrs[v*boneCount+bones[v*4+j]]+=weights[v*4+j];
 const target=mesh===c.body?Math.max(90,Math.round(indices.length/(g.index?.count??a.position.count)*3800))*3:isSkirt?1800*3:mesh.userData.mathematicalStrap?420*3:360*3;
 const locked=Uint8Array.from(original,(_,i)=>mesh===c.body&&positions[i*3+1]<.015?1:0);
 const [reduced]=MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(indices),Float32Array.from(positions),3,attrs,boneCount,Array(boneCount).fill(2),locked,Math.min(indices.length,target),isSkirt?.003:.009);
 const used=[...new Set(reduced)],local=new Map(used.map((v,i)=>[v,i]));
 const p={mesh,isSkirt,used:used.map(i=>original[i]),region,start:vertices,vertices:used.length,indices:Array.from(reduced,v=>local.get(v)),bind:[],poses:new Int16Array(used.length*3*frames),normals:new Int8Array(used.length*3*frames)};
 for(const v of used)p.bind.push(...positions.slice(v*3,v*3+3),0,...normals.slice(v*3,v*3+3),region,...weights.slice(v*4,v*4+4),...bones.slice(v*4,v*4+4));
 vertices+=p.vertices;cache.set(key,p);parts.push(p);return p;
}
function sample(newParts){
 for(let frame=0;frame<frames;frame++){
  c.setAge('adult');
  if(frame){const gait=Math.floor((frame-1)/24),phase=((frame-1)%24)/24;motion.state.mode=['walk-slow','walk','walk-fast'][gait];motion.seek((2+phase)*WALK_PROFILES[gait].cycleSeconds)}else motion.reset();
  w.update();
  let foot=Infinity;
  const skin=c.body.geometry.attributes.position;
  for(let i=0;i<skin.count;i++)if(skin.getY(i)<.08){c.body.applyBoneTransform(i,vec.fromBufferAttribute(skin,i)).applyMatrix4(c.body.matrixWorld);foot=Math.min(foot,vec.y)}
  for(const part of newParts){
   const pos=[];
   for(const v of part.used){part.mesh.getVertexPosition(v,vec).applyMatrix4(part.mesh.matrixWorld);pos.push(vec.z,vec.x,vec.y-foot)}
   // Preserve source smooth normals across color cuts. Recomputing each
   // material region independently creates a false hard seam at the waist.
   const attrs=part.mesh.geometry.attributes,n=new T.Vector3(),sum=new T.Vector3(),boneMatrix=new T.Matrix4();
   for(let v=0;v<part.vertices;v++){
    const target=(frame*part.vertices+v)*3,source=part.used[v];n.fromBufferAttribute(attrs.normal,source);
    if(part.mesh.isSkinnedMesh){
     sum.set(0,0,0);
     for(let k=0;k<4;k++){const weight=attrs.skinWeight.array[source*4+k];if(!weight)continue;boneMatrix.fromArray(part.mesh.skeleton.boneMatrices,attrs.skinIndex.array[source*4+k]*16);sum.addScaledVector(n.clone().transformDirection(boneMatrix),weight)}
     n.copy(sum).normalize();
    }
    n.transformDirection(part.mesh.matrixWorld);
    part.poses.set(pos.slice(v*3,v*3+3).map(x=>Math.round(x*4096)),target);part.normals.set(n.toArray().map(x=>Math.round(x*127)),target);
   }
  }
 }
}
for(const variant of SOFT_MODEL_LIBRARY){
 c.setAge('adult');motion.reset();w.set(variant.outfit,variant.bagStyle);w.update();
 const outfit=OUTFITS.find(o=>o.id===variant.outfit),before=parts.length,prepared=[];
 c.body.traverse(mesh=>{if(!mesh.isMesh||!mesh.visible)return;const g=mesh.geometry;for(const group of g.groups.length?g.groups:[{start:0,count:g.index?.count??g.attributes.position.count,materialIndex:0}]){const part=prepare(mesh,group,outfit);if(part)prepared.push(part)}});
 sample(parts.slice(before));
 const indices=prepared.flatMap(p=>p.indices.map(v=>v+p.start));
 models.push({...variant,indices,triangles:indices.length/3,hem:outfit.skirt?(outfit.skirt==='midi'?.16:.29):0,waist:outfit.skirt?.64:0});
 console.log(variant.id,'triangles',indices.length/3,'shared vertices',vertices);
}
const poses=new Int16Array(vertices*3*frames),normals=new Int8Array(poses.length),regions=new Uint8Array(vertices),bind=new Float32Array(vertices*16);
for(const p of parts){regions.fill(p.region,p.start,p.start+p.vertices);bind.set(p.bind,p.start*16);for(let f=0;f<frames;f++){poses.set(p.poses.subarray(f*p.vertices*3,(f+1)*p.vertices*3),(f*vertices+p.start)*3);normals.set(p.normals.subarray(f*p.vertices*3,(f+1)*p.vertices*3),(f*vertices+p.start)*3)}}
const lowCache=new Map();
for(const m of models){const key=m.indices.join(',');if(!lowCache.has(key)){const used=[...new Set(m.indices)],map=new Map(used.map((v,i)=>[v,i])),localPos=new Int16Array(used.length*3*frames);for(let f=0;f<frames;f++)for(let i=0;i<used.length;i++)localPos.set(poses.subarray((f*vertices+used[i])*3,(f*vertices+used[i])*3+3),(f*used.length+i)*3);const low=passengerLowTopology({indices:m.indices.map(i=>map.get(i)),poses:localPos,vertices:used.length,regions:used.map(v=>regions[v]),garmentShape:m.garmentShape,clothRegion:paletteRGB.indexOf(m.bottom),minimumClothTriangles:60}).indices.map(i=>used[i]);lowCache.set(key,low)}m.lowIndices=lowCache.get(key);m.lowTriangles=m.lowIndices.length/3}
const corners=Math.max(...models.map(m=>m.indices.length)),lowCorners=Math.max(...models.map(m=>m.lowIndices.length)),Index=vertices>65535?Uint32Array:Uint16Array;
const table=(key,stride,Type=Index)=>{const a=new Type(models.length*stride);models.forEach((m,i)=>{a.fill(m[key][0],i*stride,(i+1)*stride);a.set(m[key],i*stride)});return a};
const encode=a=>deflateSync(Buffer.from(a.buffer,a.byteOffset,a.byteLength),{level:9}).toString('base64');
const library=models.map(({indices,lowIndices,hem,waist,...m})=>({...m,vertices:new Set(indices).size,sourceSha256,recipeSha256}));
const walkProfiles=WALK_PROFILES.map((p,i)=>({...p,stride:p.speed*p.cycleSeconds,firstFrame:i*walkFrames+1}));
const provenance={source:'Selected HumanBody_Alt.fbx; authored wardrobe, mathematical straps and soft-human motion',sourcePath:'model/public'+SOFT_BASE_URL,sourceSha256,recipeSha256,sourceHashes,license:'Source readme describes a game extract; no redistribution license supplied.'};
await writeAsset(new URL('../game/src/assets/passenger-approved.json',import.meta.url),JSON.stringify({...provenance,style:'soft-human',encoding:'zlib-base64',poseEncoding:'frame-delta',variants:library.map(m=>m.id),hairstyles:library.map(m=>m.hair),library,palette:paletteRGB.map(hex=>{const color=new T.Color(hex);return color.getHex()>>16&255}).map(v=>v/255),paletteRGB,vertices,corners,triangles:corners/3,lowCorners,lowTriangles:lowCorners/3,indexBits:Index.BYTES_PER_ELEMENT*8,frames,walkFrames,walkProfiles,height:1.7,stride:walkProfiles[0].stride,positionScale:4096,normalScale:127,regions:encode(regions),indices:encode(table('indices',corners)),lowIndices:encode(table('lowIndices',lowCorners)),positions:encode(deltaPassengerFrames(poses,vertices)),normals:encode(deltaPassengerFrames(normals,vertices))})+'\n');

// Pose the same 16-bone rig at eight size fits. Shared GPU palettes include
// inverse binds. Instance transforms own travel and final age/height scaling.
const pose=createSoftActivityPoser(c),fits=[.5,.6,.7,.8,.9,1,1.1,1.2],handModes=['default','right','left'],matrices=[],samples=ACTIVITY_SAMPLES;
const reset=c.resetPose;c.resetPose=()=>{reset();c.body.scale.set(c.appearance.age==='child'?.7:1,c.fitHeight??1,c.appearance.age==='child'?.7:1);c.body.updateMatrixWorld(true)};
for(const height of fits)for(const hand of handModes)for(let activity=0;activity<ACTIVITY_NAMES.length+3;activity++)for(let f=0;f<samples;f++){
 c.setAge(height<.78?'child':'adult');c.fitHeight=height;
 const id=ACTIVITY_NAMES[activity],t=(ACTIVITY_DURATION[activity]??1)*f/(samples-1);
 if(activity>=ACTIVITY_NAMES.length){const g=activity-ACTIVITY_NAMES.length;motion.state.mode=['walk-slow','walk','walk-fast'][g];motion.seek((2+f/samples)*WALK_PROFILES[g].cycleSeconds)}
 else if(id==='escalator'||id==='escalator-left'){
  const side=id==='escalator-left'?-1:1,target=activityRailTarget(Math.floor(f/6),height);target[0]*=side;
  const stage=f%6;if(stage===1||stage===4){target[0]-=side*.08;target[1]+=.08}
  pose(stage===0||stage===5?'wait':id,t,{foot:[0,0,0],rail:target,hand});
 }else pose(id==='walk'?'wait':id,t,{hand});
 c.body.position.set(0,0,0);c.body.rotation.set(0,0,0);c.body.scale.setScalar(1);c.body.updateMatrixWorld(true);c.body.skeleton.update();matrices.push(...c.body.skeleton.boneMatrices);
}
await writeAsset(new URL('../game/src/assets/passenger-activities.json',import.meta.url),JSON.stringify({...provenance,version:3,style:'soft-human',encoding:'zlib-base64',samples,boneCount,rootBone:c.bones.indexOf(c.hips),armBones:c.bones.flatMap((b,i)=>/Shoulder|Arm|Forearm/.test(b.name)?[i]:[]),boneNames:c.bones.map(b=>b.name),fits,handModes,rigs:['soft-human'],activities:ACTIVITY_NAMES,durations:ACTIVITY_DURATION,vertices,corners,lowCorners,library:models.map(m=>({id:m.id,sourceSha256,recipeSha256,triangles:m.triangles,lowTriangles:m.lowTriangles,hem:m.hem,waist:m.waist})),data:encode(bind),matrices:encode(Float32Array.from(matrices)),indices:encode(table('indices',corners,Uint32Array)),lowIndices:encode(table('lowIndices',lowCorners,Uint32Array))})+'\n');
console.log({variants:models.length,vertices,corners,lowCorners,palette:paletteRGB.length,recipeSha256});
