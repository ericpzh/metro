import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {INTERACTIONS,createInteractionPoser,interactionFrame,solveLimb} from '../src/animation/interactions.js';
import {createInteractionArms} from '../src/animation/interaction-arms.js';

test('limb contact preserves lengths and reaches reachable targets',()=>{
 const root=new THREE.Bone(),mid=new THREE.Bone(),end=new THREE.Bone();root.add(mid);mid.add(end);mid.position.y=-.3;end.position.y=-.25;
 const parent=new THREE.Group();parent.rotation.y=.6;parent.scale.setScalar(.8);parent.add(root);
 const target=new THREE.Vector3(.17,-.2,.15);solveLimb(root,mid,end,target,new THREE.Vector3(1,0,0));
 assert(end.getWorldPosition(new THREE.Vector3()).distanceTo(target)<1e-6);
 assert.equal(mid.position.length(),.3);assert.equal(end.position.length(),.25);
 solveLimb(root,mid,end,new THREE.Vector3(4,3,2),new THREE.Vector3(1,0,0));
 assert(root.matrixWorld.elements.every(Number.isFinite));assert(end.getWorldPosition(new THREE.Vector3()).length()<=.4401);
});

test('activity sleeves remove the stretched torso/forearm web and restore the reviewed source',async()=>{
 const {MODEL_LIBRARY}=await import('../src/characters/library.js');
 for(const sex of ['female','male']){
  const entry=MODEL_LIBRARY.find(m=>m.character===sex&&!m.bag&&!m.outfit),bytes=readFileSync(new URL('../public/models/'+entry.file,import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  let body;scene.traverse(m=>{if(m.userData.coatInterior&&(!body||m.geometry.attributes.position.count>body.geometry.attributes.position.count))body=m});
  const source=body.geometry,indices=source.index.array.slice(),arms=createInteractionArms(scene),pose=createInteractionPoser(scene);
  const maxBridge=()=>{
   const a=body.geometry.attributes,ix=body.geometry.index.array;let max=0;
   for(let i=0;i<ix.length;i+=3){const ids=[ix[i],ix[i+1],ix[i+2]];if(ids.some(i=>a.position.getX(i)<.13||a.position.getY(i)<.9||a.position.getY(i)>1.35))continue;
    const p=ids.map(i=>body.getVertexPosition(i,new THREE.Vector3()));for(let j=0;j<3;j++)max=Math.max(max,p[j].distanceTo(p[(j+1)%3]));
   }return max;
  };
  pose('shop',4);const before=maxBridge();if(sex==='female')assert(before>.2,'negative control exposes the original web');
  arms.setEnabled(true);pose('shop',4);assert(maxBridge()<.15,'torso no longer stretches to the wrist');
  const clean=[];scene.traverse(n=>{if(n.userData.interactionArm)clean.push(n)});assert.equal(clean.length,2);
  for(const n of clean){assert(n.visible);const a=n.geometry.attributes;for(let i=0;i<a.skinWeight.count;i++)assert(Math.abs(a.skinWeight.getX(i)+a.skinWeight.getY(i)-1)<1e-5);}
  arms.setEnabled(false);assert.equal(body.geometry,source);assert.deepEqual(source.index.array,indices);assert(clean.every(n=>!n.visible));
  arms.dispose();assert(clean.every(n=>!n.parent));
 }
});

test('seated trousers clear the bench and toilet seat and feet stay above the floor',async()=>{
 const {MODEL_LIBRARY}=await import('../src/characters/library.js');
 for(const sex of ['female','male']){
  const entry=MODEL_LIBRARY.find(m=>m.character===sex&&!m.bag&&!m.outfit),bytes=readFileSync(new URL('../public/models/'+entry.file,import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const pose=createInteractionPoser(scene);let body;scene.traverse(n=>{if(n.userData.coatInterior&&(!body||n.geometry.attributes.position.count>body.geometry.attributes.position.count))body=n});
  for(const [id,top] of [['sit',.49],['toilet',.458]]){
   pose(id,4);const a=body.geometry.attributes;let support=Infinity,sole=Infinity;
   for(let i=0;i<a.position.count;i++){
    const y=a.position.getY(i);if(y>.15&&(y<.68||y>.82||Math.abs(a.position.getX(i))>.17||a.position.getZ(i)>.04))continue;
    const p=body.getVertexPosition(i,new THREE.Vector3());if(y<.15)sole=Math.min(sole,p.y);else support=Math.min(support,p.y);
   }
   assert(support>top-.008&&support<top+.025,`${sex} ${id} support ${support} vs ${top}`);
   assert(sole>-.006&&sole<.025,`${sex} ${id} sole ${sole}`);
   assert(scene.getObjectByName('RightShin').rotation.x>.7,'knees remain bent');
   if(id==='toilet')assert(Math.abs(scene.getObjectByName('RightThigh').rotation.x+scene.getObjectByName('RightShin').rotation.x)<.12,'toilet shins sit upright over the feet');
  }
 }
});

test('all activities repeat deterministically on reviewed male and female skeletons',async()=>{
 for(const sex of ['female','male']){
  // Resolve canonical catalogue filenames instead of duplicating export naming.
  const {MODEL_LIBRARY}=await import('../src/characters/library.js');
  const entry=MODEL_LIBRARY.find(m=>m.character===sex&&!m.bag&&!m.outfit);
  const bytes=readFileSync(new URL('../public/models/'+entry.file,import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const pose=createInteractionPoser(scene);
  const snapshot=()=>{const data=[];scene.traverse(n=>{if(n.isBone)data.push(...n.matrixWorld.elements)});return data};
  for(const [id,,,duration] of INTERACTIONS){
   pose(id,4);const expected=snapshot();assert(expected.every(Number.isFinite),id);
   pose(id,1);pose(id,4);assert.deepEqual(snapshot(),expected,id+' scrub is history independent');
   pose(id,duration+4);assert.deepEqual(snapshot(),expected,id+' repeats');
   for(let t=0;t<duration;t+=.2){pose(id,t);assert(snapshot().every(Number.isFinite),id+' finite through transitions');}
   assert.equal(interactionFrame(id,duration).t,0);
  }
 }
});
