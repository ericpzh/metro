import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from '../game/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {detachedTrouserTriangles} from '../prototypes/passenger-female-shared/variant.js';
import {smoothShoulders} from '../model/src/characters/shoulders.js';
const dir=new URL('../prototypes/passenger-female-shared/',import.meta.url);
async function load(url){const b=readFileSync(url);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')}
function surfaces(scene){const result=[];scene.traverse(n=>{if(n.isSkinnedMesh)result.push(n)});return result}
const sourcePath=new URL('../prototypes/trellis-passenger/passenger-b-walk-forward.glb',import.meta.url);
const style=process.argv.find(a=>a.startsWith('--style='))?.split('=')[1]??'bob',withBag=!process.argv.includes('--no-bag')&&style!=='long',filename=withBag?(style==='bob'?'passenger-female-walk.glb':`passenger-female-${style}-walk.glb`):`passenger-female-no-bag-${style}-walk.glb`;
const source=await load(sourcePath),variant=await load(new URL(filename,dir));
smoothShoulders(source.scene);
const originals=surfaces(source.scene),meshes=surfaces(variant.scene);
assert.equal(meshes.length,withBag?4:3);
let maxWeightDifference=0,correctedTrouserVertices=0;
for(const original of originals){
 if(!withBag&&original!==originals[0]){assert(!meshes.some(n=>n.name===original.name),'no backpack mesh in no-bag asset');continue}
 const copy=meshes.find(n=>n.name===original.name);assert(copy,'approved mesh retained');
 for(const name of ['position','normal']){
  const before=original.geometry.attributes[name],after=copy.geometry.attributes[name],pos=original.geometry.attributes.position,col=original.geometry.attributes.color,hairGrey=new THREE.Color().setRGB(.47,.47,.47,THREE.SRGBColorSpace).r;
  if(name==='normal')assert(after.array.every(Number.isFinite),'reshaped surface normals remain valid');
  else for(let i=0;i<pos.count;i++)for(let k=0;k<3;k++){
   const coatGrey=new THREE.Color().setRGB(.66,.66,.66,THREE.SRGBColorSpace).r;
   const pantsGrey=new THREE.Color().setRGB(.53,.53,.53,THREE.SRGBColorSpace).r;
   const waist=k!==1&&pos.getY(i)>.79&&Math.abs(col.getX(i)-pantsGrey)<.001;
   const rearCoat=!withBag&&k===2&&pos.getY(i)>=.83&&pos.getY(i)<1.425&&(Math.abs(col.getX(i)-hairGrey)<.001||Math.abs(col.getX(i)-coatGrey)<.001);
   const shoulder=pos.getY(i)>=1.29&&pos.getY(i)<1.425;
   if(waist){if(pos.getY(i)>.815)assert(Math.hypot(copy.geometry.attributes.position.getX(i)/.195,(copy.geometry.attributes.position.getZ(i)-.035)/.108)<1.000001,'no waist overhang into the hand gap')}
   else if(shoulder){if(k===1)assert.equal(after.array[i*3+k],before.array[i*3+k],'shoulder height preserved')}
   else if(!rearCoat)assert.equal(after.array[i*3+k],before.array[i*3+k],'other body positions preserved');
   else assert(after.array[i*3+k]>=before.array[i*3+k],'back ridge folds into coat');
  }
 }
 const oldWeights=original.geometry.attributes.skinWeight.array,newWeights=copy.geometry.attributes.skinWeight.array;
 if(withBag&&original===originals[0])assert(newWeights.length>oldWeights.length,'strap trim adds a backed torso surface');
 else assert.equal(newWeights.length,oldWeights.length);
 const oldJoints=original.geometry.attributes.skinIndex.array,newJoints=copy.geometry.attributes.skinIndex.array,positions=original.geometry.attributes.position,colours=original.geometry.attributes.color,pantsGrey=new THREE.Color().setRGB(.53,.53,.53,THREE.SRGBColorSpace).r;
 for(let i=0;i<positions.count;i++){
  const affected=positions.getY(i)<.825&&Math.abs(colours.getX(i)-pantsGrey)<.001&&[0,1,2,3].some(k=>oldWeights[i*4+k]>0&&/arm|hand/i.test(original.skeleton.bones[oldJoints[i*4+k]].name));
  if(affected)correctedTrouserVertices++;
  for(let k=0;k<4;k++){
   if(affected){if(newWeights[i*4+k]>0)assert(!/arm|hand/i.test(copy.skeleton.bones[newJoints[i*4+k]].name),'trouser flap cannot follow an arm')}
   else {assert.equal(newJoints[i*4+k],oldJoints[i*4+k],'other skin joints preserved');maxWeightDifference=Math.max(maxWeightDifference,Math.abs(newWeights[i*4+k]-oldWeights[i*4+k]))}
  }
 }
 assert(maxWeightDifference<1e-7,'same weights within GLTFLoader float normalization precision');
 if(original.geometry.index){
  const p=original.geometry.attributes.position,c=original.geometry.attributes.color,indices=original.geometry.index.array,expected=[],hairGrey=new THREE.Color().setRGB(.47,.47,.47,THREE.SRGBColorSpace).r;
  const detached=detachedTrouserTriangles(original.geometry);if(original===originals[0])assert(detached.size>0,'detects actual detached waist ribbons');
  for(const offset of detached)for(let k=0;k<3;k++)assert(p.getY(indices[offset+k])>.65,'detached fragments do not contain lower-leg surfaces');
  for(let i=0;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]];if(!detached.has(i)&&!ids.every(j=>p.getY(j)>1.425&&Math.abs(c.getX(j)-hairGrey)<.001))expected.push(...ids)}
  if(withBag&&original===originals[0]){
   assert(copy.userData.trimmedStrapTriangles>0,'overlapping torso faces beneath the straps are trimmed');
   const actual=new Set();for(let i=0;i<copy.geometry.index.count;i+=3)actual.add([0,1,2].map(k=>copy.geometry.index.getX(i+k)).join(','));
   for(let i=0;i<expected.length;i+=3){const ids=expected.slice(i,i+3),y=ids.reduce((s,id)=>s+p.getY(id)/3,0),x=ids.reduce((s,id)=>s+p.getX(id)/3,0);
    if(y<.90||y>1.39||Math.abs(x)<.07||Math.abs(x)>.27)assert(actual.has(ids.join(',')),'triangles outside the strap corridor are preserved');
   }
  }else assert.deepEqual(Array.from(copy.geometry.index.array),expected,'only old hair and disconnected waist ribbons removed');
 }
}
const hair=meshes.find(m=>m.name.endsWith('_hairstyle'));assert(hair);
assert(style!=='long'||!withBag,'long hair is only exported without a bag');
hair.geometry.computeBoundingBox();
for(let i=0,p=hair.geometry.attributes.position;i<p.count;i++)if(p.getY(i)>1.50)assert(Math.abs(p.getX(i))<.14,'all hairstyles share a slim crown');
if(style==='long'){
 const p=hair.geometry.attributes.position;
 for(let i=0;i<p.count;i++){
  if(p.getY(i)>1.50)assert(Math.abs(p.getX(i))<.14,'slim long-hair crown');
  if(p.getZ(i)>.025)assert(p.getY(i)>1.29,'forward hair ends above the swinging sleeve');
 }
}
if(style==='shoulder'){
 assert(hair.geometry.boundingBox.max.x<.152&&hair.geometry.boundingBox.min.x>-.152,'shoulder hair fits closely around the head');
 if(withBag){const pack=meshes.find(m=>m.name==='Clean_backpack_panel');pack.geometry.computeBoundingBox();assert(hair.geometry.boundingBox.min.y>pack.geometry.boundingBox.max.y+.015,'hair hem stays above the pack')}
}
if(!withBag){
 assert(meshes.some(m=>m.name==='Jacket_back_fill'),'coat back closes the former pack opening');
 const body=meshes.find(m=>m.name===originals[0].name),p=body.geometry.attributes.position,c=body.geometry.attributes.color,old=originals[0].geometry.attributes.color,hairGrey=new THREE.Color().setRGB(.47,.47,.47,THREE.SRGBColorSpace).r,coatGrey=new THREE.Color().setRGB(.74,.74,.74,THREE.SRGBColorSpace).r;
 for(let i=0;i<p.count;i++)if(p.getY(i)<1.425&&Math.abs(old.getX(i)-hairGrey)<.001)assert(Math.abs(c.getX(i)-coatGrey)<.001,'straps removed from the coat colours');
 // Sample the actual exported outline across the former strap end. A protruding
 // strip or a panel lip produces an abrupt depth jump between adjacent heights.
 const rear=[];
 for(const y of [1.15,1.17,1.19,1.21,1.23,1.25,1.27]){
  let z=Infinity;
  for(const mesh of meshes){const mp=mesh.geometry.attributes.position,mc=mesh.geometry.attributes.color;for(let i=0;i<mp.count;i++)if(Math.abs(mp.getY(i)-y)<.003&&Math.abs(mc.getX(i)-coatGrey)<.001)z=Math.min(z,mp.getZ(i))}
  assert(Number.isFinite(z),'coat exists at every sampled height');rear.push(z);
 }
 for(let i=1;i<rear.length;i++)assert(Math.abs(rear[i]-rear[i-1])<.008,'continuous back silhouette without a strap ridge');
}
// The new fringe must reach the inherited forehead, including its off-centre
// projection; a narrower cap leaves the visible wedge from the review image.
variant.scene.updateMatrixWorld(true);meshes.forEach(m=>m.skeleton.update());
const ray=new THREE.Raycaster(),headPositions=originals[0].geometry.attributes.position,headColours=originals[0].geometry.attributes.color,skinGrey=new THREE.Color().setRGB(.78,.78,.78,THREE.SRGBColorSpace).r;
let foreheadSamples=0;
for(const y of [1.555,1.565,1.575])for(const x of [-.06,0,.06]){
 let forehead=-Infinity;
 for(let i=0;i<headPositions.count;i++)if(Math.abs(headPositions.getY(i)-y)<.008&&Math.abs(headPositions.getX(i)-x)<.008&&Math.abs(headColours.getX(i)-skinGrey)<.001)forehead=Math.max(forehead,headPositions.getZ(i));
 if(forehead<.10)continue;
 ray.set(new THREE.Vector3(x,y,1),new THREE.Vector3(0,0,-1));const hit=ray.intersectObject(hair,false)[0];
 assert(hit&&hit.point.z>forehead,'fringe covers projected forehead without a gap');foreheadSamples++;
}
assert(foreheadSamples>=6,'checks forehead across the centre and both sides');
assert(correctedTrouserVertices>0,'reproduces the inherited trouser/arm overlap');
let triangles=0;
for(const mesh of meshes){
 assert(mesh.material.isMeshBasicMaterial&&!mesh.material.transparent,'opaque flat material');
 for(const a of Object.values(mesh.geometry.attributes))assert(a.array.every(Number.isFinite));
 const w=mesh.geometry.attributes.skinWeight,j=mesh.geometry.attributes.skinIndex,c=mesh.geometry.attributes.color,idx=mesh.geometry.index?.array??Array.from({length:c.count},(_,i)=>i);
 triangles+=idx.length/3;
 for(let i=0;i<w.count;i++){let sum=0;for(let k=0;k<4;k++){const weight=w.array[i*4+k];sum+=weight;assert(j.array[i*4+k]<mesh.skeleton.bones.length);if(mesh===hair&&weight>0)assert.equal(mesh.skeleton.bones[j.array[i*4+k]].name,'Head')}assert(Math.abs(sum-1)<1e-5)}
 for(let i=0;i<idx.length;i+=3)for(let k=1;k<3;k++)assert(Math.abs(c.getX(idx[i])-c.getX(idx[i+k]))<1e-6,'no mixed-colour triangles');
}
assert.deepEqual(variant.animations.map(c=>c.name),['Walk_Slow','Walk_Medium','Walk_Fast']);
const body=meshes.find(m=>m.name===originals[0].name),p=body.geometry.attributes.position,shoes=[[],[]];
for(let i=0;i<p.count;i++)if(p.getY(i)<.10)shoes[p.getX(i)<0?0:1].push(i);
const mixer=new THREE.AnimationMixer(variant.scene),v=new THREE.Vector3(),walks=[];
for(let clipIndex=0;clipIndex<3;clipIndex++){
 const clip=variant.animations[clipIndex],contacts=[],sliding=[];assert(Math.abs(clip.duration-1.12)<1e-6);
 mixer.stopAllAction();mixer.clipAction(clip).play();
 for(let side=0;side<2;side++){
  const zs=[];
  for(let frame=0;frame<12;frame++){
   mixer.setTime((frame+(side?12:0))*clip.duration/24);variant.scene.updateMatrixWorld(true);meshes.forEach(m=>m.skeleton.update());
   let z=0,ground=Infinity;
   for(const i of shoes[side]){v.fromBufferAttribute(p,i);body.applyBoneTransform(i,v);v.applyMatrix4(body.matrixWorld);ground=Math.min(ground,v.y);z+=v.z}
   assert(Math.abs(ground)<.015,'stance sole grounded');contacts.push(ground);
   zs.push(z/shoes[side].length+[.9,1.15,1.4][clipIndex]*clip.duration*frame/24);
  }
  const slide=Math.max(...zs)-Math.min(...zs);assert(slide<.01,'planted shoe does not slide');sliding.push(slide);
 }
 walks.push({clip:clip.name,maxStanceSlide:Math.max(...sliding),groundRange:[Math.min(...contacts),Math.max(...contacts)]});
}
const report={source:'../trellis-passenger/passenger-b-walk-forward.glb',sourceSha256:createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),approvedBodyGeometryIdentical:false,bodyPositionsOutsideCleanupRegionsIdentical:true,correctedTrouserVertices,otherSkinWeightsPreserved:true,maxWeightDifference,onlyHairGeometryReplaced:false,meshes:meshes.length,triangles,bones:body.skeleton.bones.length,cleanColours:true,walks};
report.hairstyle=style;report.withBag=withBag;report.jacketBackFill=!withBag;report.foreheadSamplesCovered=foreheadSamples;writeFileSync(new URL(withBag?(style==='bob'?'validation.json':`validation-${style}.json`):`validation-no-bag-${style}.json`,dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
