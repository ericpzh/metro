import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {GLTFLoader} from '../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {AnimationMixer,Vector3} from '../game/node_modules/three/build/three.module.js';
const bytes=readFileSync(new URL('../prototypes/trellis-passenger/passenger-b-walk-forward.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
assert.equal(gltf.animations.length,1);assert.equal(gltf.animations[0].name,'Walk');
const meshes=[];gltf.scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n)});assert.equal(meshes.length,2);
for(const mesh of meshes) {
 assert(mesh.material.isMeshBasicMaterial);
 for(const attribute of Object.values(mesh.geometry.attributes))assert(attribute.array.every(Number.isFinite));
 const weights=mesh.geometry.attributes.skinWeight,indices=mesh.geometry.attributes.skinIndex;
 for(let i=0;i<weights.count;i++) {
  let total=0;for(let j=0;j<4;j++){total+=weights.array[i*4+j];assert(indices.array[i*4+j]<mesh.skeleton.bones.length)}
  assert(Math.abs(total-1)<1e-5);
 }
}
const mixer=new AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations[0]).play();
const v=new Vector3(),bounds=[];
for(const time of [0,.14,.28,.42,.56,.70,.84,.98,1.12]) {
 mixer.setTime(time);gltf.scene.updateMatrixWorld(true);let lowest=Infinity;
 for(const side of ['Left','Right']) {
  const knee=gltf.scene.getObjectByName(side+'Shin');
  assert(knee.quaternion.x>=-1e-6,`${side} knee must bend backward, never hyperextend`);
 }
 if(time===.28) {
  const left=gltf.scene.getObjectByName('LeftFoot').getWorldPosition(new Vector3());
  const right=gltf.scene.getObjectByName('RightFoot').getWorldPosition(new Vector3());
  assert(left.z>right.z,'Advancing foot must extend toward the character front (+Z)');
  assert(gltf.scene.getObjectByName('LeftShin').quaternion.x>.2,'Forward swing must lift the advancing knee');
  const trailingKnee=gltf.scene.getObjectByName('RightShin').quaternion.x;
  assert(trailingKnee>.04&&trailingKnee<.10,'Trailing stance knee must retain a slight bend');
 }
 const heels={Left:Infinity,Right:Infinity};let bagFront=-Infinity,bagBack=Infinity;
 for(const mesh of meshes){mesh.skeleton.update();const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);const shoe=v.y<.145,side=v.x<0?'Left':'Right';mesh.applyBoneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);assert(v.toArray().every(Number.isFinite));lowest=Math.min(lowest,v.y);if(shoe)heels[side]=Math.min(heels[side],v.z);if(mesh===meshes[1]){bagFront=Math.max(bagFront,v.z);bagBack=Math.min(bagBack,v.z)}}}
 assert(Math.min(heels.Left,heels.Right)>(bagFront+bagBack)/2-.004,'Shoes must not extend behind the backpack midline');
 if(time===.28||time===.84)assert(Math.abs(heels[time===.28?'Right':'Left']-(bagFront+bagBack)/2)<.004,`Trailing heel must reach the backpack midline: ${time}, heel ${heels[time===.28?'Right':'Left']}, bag ${(bagFront+bagBack)/2}`);
 assert(lowest>-.04&&lowest<.045,`Foot contact at ${time}: ${lowest}`);bounds.push(lowest);
}
assert(Math.abs(bounds[0]-bounds.at(-1))<1e-5,'Loop must close');
console.log(JSON.stringify({clip:'Walk',duration:gltf.animations[0].duration,skinnedMeshes:meshes.length,bones:meshes[0].skeleton.bones.length,groundContact:bounds.map(x=>+x.toFixed(4)),validWeights:true,loopClosed:true}));
