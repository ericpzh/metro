import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../game/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const path=new URL('../prototypes/trellis-passenger-female/passenger-female-walk.glb',import.meta.url);
const bytes=readFileSync(path),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
assert.deepEqual(gltf.animations.map(c=>c.name),['Walk_Slow','Walk_Medium','Walk_Fast']);
const meshes=[];gltf.scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n)});assert.equal(meshes.length,8);
gltf.scene.updateMatrixWorld(true);
const rest=new THREE.Box3().setFromObject(gltf.scene);
assert.ok(Math.abs(rest.getSize(new THREE.Vector3()).y-1.65)<.005,'female rest height is 1.65 metres');
let triangles=0;
for(const mesh of meshes){
 assert(mesh.material.isMeshBasicMaterial,'flat opaque unlit greys');assert.equal(mesh.material.transparent,false);
 for(const a of Object.values(mesh.geometry.attributes))assert(a.array.every(Number.isFinite),'finite attributes');
 const c=mesh.geometry.attributes.color,w=mesh.geometry.attributes.skinWeight,j=mesh.geometry.attributes.skinIndex,index=mesh.geometry.index?.array??Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i);
 triangles+=index.length/3;
 for(let i=0;i<w.count;i++){let sum=0;for(let k=0;k<4;k++){sum+=w.array[i*4+k];assert(j.array[i*4+k]<mesh.skeleton.bones.length)}assert(Math.abs(sum-1)<1e-5)}
 for(let i=0;i<index.length;i+=3)for(let k=1;k<3;k++)assert(Math.abs(c.getX(index[i])-c.getX(index[i+k]))<1e-6,'clean material boundary has no mixed-colour triangles');
}
const body=meshes.reduce((a,b)=>a.geometry.attributes.position.count>b.geometry.attributes.position.count?a:b),p=body.geometry.attributes.position;
// Outer trouser vertices overlap the arm region in X. They must still follow
// the legs, or swinging arms pull the thigh silhouette into lumps.
const pantsGrey=new THREE.Color().setRGB(.53,.53,.53,THREE.SRGBColorSpace).r;
const colours=body.geometry.attributes.color,joints=body.geometry.attributes.skinIndex,weights=body.geometry.attributes.skinWeight;
let trouserVertices=0;
for(let i=0;i<p.count;i++)if(p.getY(i)<.825&&Math.abs(colours.getX(i)-pantsGrey)<.001){
 trouserVertices++;
 for(let k=0;k<4;k++)if(weights.array[i*4+k]>1e-5)assert(!/Arm|Hand/.test(body.skeleton.bones[joints.array[i*4+k]].name),'trousers never follow arm bones');
}
assert(trouserVertices>1000,'checks reconstructed trouser surface');
const hands=meshes.filter(m=>/^Fingerless[_ ]hand/.test(m.name)),straps=meshes.filter(m=>/^Continuous[_ ]strap/.test(m.name));
assert.equal(hands.length,2);assert.equal(straps.length,2);
for(const mesh of [...hands,...straps]){
 const w=mesh.geometry.attributes.skinWeight,j=mesh.geometry.attributes.skinIndex;
 for(let i=0;i<w.count;i++)for(let k=0;k<4;k++)if(w.array[i*4+k]>1e-5){
  const bone=mesh.skeleton.bones[j.array[i*4+k]].name;
  assert(hands.includes(mesh)?/Hand$/.test(bone):bone==='Spine','hands and straps follow their own joint');
 }
}
for(const mesh of straps){
 const bounds=new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
 assert(Math.abs(bounds.getSize(new THREE.Vector3()).x-.042)<1e-5,'strap keeps constant width and straight lateral edges');
 assert.equal(mesh.material.side,THREE.DoubleSide,'strap is visible from both sides');
}
for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))>.17&&p.getY(i)<.835&&p.getY(i)>.47)assert(!nearSkin(colours.getX(i)),'old fingers and wrist pieces removed');
function nearSkin(value){return Math.abs(value-new THREE.Color().setRGB(.78,.78,.78,THREE.SRGBColorSpace).r)<.001}
const shoes=[[],[]];for(let i=0;i<p.count;i++)if(p.getY(i)<.10)shoes[p.getX(i)<0?0:1].push(i);
const speeds=[.9,1.15,1.4],v=new THREE.Vector3(),mixer=new THREE.AnimationMixer(gltf.scene),results=[];
for(let clipIndex=0;clipIndex<3;clipIndex++){
 const clip=gltf.animations[clipIndex];assert(Math.abs(clip.duration-1.12)<1e-6);
 mixer.stopAllAction();mixer.clipAction(clip).play();
 const contacts=[],sliding=[];
 for(let side=0;side<2;side++){
  const worldZ=[];
  for(let frame=0;frame<12;frame++){
   const time=(frame+(side?12:0))*clip.duration/24;mixer.setTime(time);gltf.scene.updateMatrixWorld(true);meshes.forEach(m=>m.skeleton.update());
   const knee=gltf.scene.getObjectByName((side?'Right':'Left')+'Shin');assert(knee.quaternion.x>0,'knee folds backward');
   let z=0,ground=Infinity;
   for(const i of shoes[side]){v.fromBufferAttribute(p,i);body.applyBoneTransform(i,v);v.applyMatrix4(body.matrixWorld);z+=v.z;ground=Math.min(ground,v.y)}
   worldZ.push(z/shoes[side].length+speeds[clipIndex]*clip.duration*frame/24*(1.65/1.72));
   assert(Math.abs(ground)<.015,'stance sole stays on the floor');contacts.push(ground);
  }
  const slide=Math.max(...worldZ)-Math.min(...worldZ);assert(slide<.01,`planted foot world slide ${slide}`);sliding.push(slide);
 }
 const positions=[];
 for(const t of [0,clip.duration]){
  mixer.setTime(t);gltf.scene.updateMatrixWorld(true);meshes.forEach(m=>m.skeleton.update());
  v.fromBufferAttribute(p,shoes[0][0]);body.applyBoneTransform(shoes[0][0],v);positions.push(v.clone());
 }
 assert(positions[0].distanceTo(positions[1])<1e-5,'loop closes');
 results.push({clip:clip.name,duration:clip.duration,maxStanceSlide:Math.max(...sliding),groundRange:[Math.min(...contacts),Math.max(...contacts)]});
}
const report={height:rest.getSize(new THREE.Vector3()).y,meshes:meshes.length,triangles,bones:meshes[0].skeleton.bones.length,validWeights:true,cleanColours:true,trouserVerticesWithoutArmWeights:trouserVertices,fingerlessHands:hands.length,continuousStraps:straps.length,originalHandFragmentsRemoved:true,walks:results};
writeFileSync(new URL('../prototypes/trellis-passenger-female/validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
