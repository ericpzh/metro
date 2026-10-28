import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createImportedSoftHuman,SOFT_BASE_URL} from '../src/soft-human/imported-base.js';
import {createMotion} from '../src/soft-human/character.js';
import {createWardrobe,OUTFITS,BACKPACKS} from '../src/soft-human/wardrobe.js';
import {createSoftActivityPoser,SOFT_ACTIONS} from '../src/soft-human/activities.js';

const bytes=readFileSync(new URL('../public'+SOFT_BASE_URL,import.meta.url));
const create=()=>createImportedSoftHuman(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));

test('walking and idle preserve the selected base outward arm angle from the first frame',()=>{
 const c=create(),m=createMotion(c);
 for(const age of ['adult','child'])for(const mode of ['idle','walk-slow','walk','walk-fast'])for(const softness of [0,.65,1]){
  c.setAge(age);m.state.mode=mode;m.state.softness=softness;
  for(const t of [0,1/60,.25,.5,1,2,4]){
   m.seek(t);c.body.updateMatrixWorld(true);
   for(const l of c.limbs){
    const shoulder=c.body.worldToLocal(l.arm.getWorldPosition(new T.Vector3()));
    const elbow=c.body.worldToLocal(l.fore.getWorldPosition(new T.Vector3())),d=elbow.sub(shoulder);
    const outward=Math.atan2(l.s*d.x,Math.hypot(d.y,d.z));
    assert(outward>.65,`${age}/${mode}/${softness}/${t}: arm angle ${outward} must retain the outward bind pose`);
   }
  }
 }
});

test('every station action keeps free arms in the default outward pose, including approach and release',()=>{
 const c=create(),pose=createSoftActivityPoser(c),m=createMotion(c);
 for(const age of ['adult','child'])for(const carry of [null,{side:1,type:'shoulder'}]){
  c.setAge(age);c.carry=carry;
  for(const action of SOFT_ACTIONS.filter(a=>a.activity))for(const t of [0,.25,1,3.5,action.duration-.01]){
   const result=pose(action.id,t,{foot:[0,.146,.13],rail:[action.id==='escalator-left'?-.2255:.2255,1.288,.122],washStepHeight:age==='child'?.28:0});
   assert.equal(c.body.scale.x,age==='child'?.70:1,'activities preserve the default age width');
   for(const l of c.limbs){
    const free=!result.targets.has(l.s)||result.contact<=1e-6;
    if(!free)continue;
    assert(Math.abs(l.arm.rotation.z)<1e-6,`${age}/${action.id}/${t}: no inward free-arm offset`);
    assert(Math.abs(l.fore.rotation.x)<1e-6,`${age}/${action.id}/${t}: no automatic resting elbow bend`);
    const shoulder=c.body.worldToLocal(l.arm.getWorldPosition(new T.Vector3())),elbow=c.body.worldToLocal(l.fore.getWorldPosition(new T.Vector3())),d=elbow.sub(shoulder);
    assert(Math.atan2(l.s*d.x,Math.hypot(d.y,d.z))>.65,`${age}/${action.id}/${t}: free arm retains its outward silhouette`);
   }
  }
 }
 // Return from an active equipment reach to an unrelated waiting pose.
 c.setAge('adult');pose('ticket',3.5);pose('wait',4);
 for(const l of c.limbs)assert.equal(l.arm.rotation.z,0);
 m.state.mode='idle';m.seek(2);for(const l of c.limbs)assert.equal(l.arm.rotation.z,0);
});

test('selected FBX retains its source vertices, weights, smooth normals and complete rig',()=>{
 const c=create(),g=c.body.geometry;
 assert.equal(c.source.vertices,26544);assert.equal(c.bones.length,16);
 assert(c.bones.some(b=>b.name==='LeftShoulder'));assert(c.bones.some(b=>b.name==='RightHip'));
 g.computeBoundingBox();assert(Math.abs(g.boundingBox.max.y-1.7)<.001);
 const p=new T.Vector3();for(let i=0;i<g.attributes.position.count;i++){
  const w=g.attributes.skinWeight;assert(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-6);
  assert(c.body.getVertexPosition(i,p).distanceTo(new T.Vector3().fromBufferAttribute(g.attributes.position,i))<1e-5,'rebind preserves the selected surface');
  assert(Math.abs(new T.Vector3().fromBufferAttribute(g.attributes.normal,i).length()-1)<1e-5);
 }
 const m=createMotion(c);m.seek(2);const first=c.bones.map(b=>b.quaternion.toArray());m.seek(2);assert.deepEqual(c.bones.map(b=>b.quaternion.toArray()),first);
 m.reset();assert.equal(c.hips.position.y,c.metrics.hipHeight);
});

test('new base supports every wardrobe, both ages and deterministic station poses',()=>{
 const c=create(),w=createWardrobe(c),m=createMotion(c),pose=createSoftActivityPoser(c);
 for(const age of ['adult','child']){c.setAge(age);
  for(const outfit of OUTFITS)for(const bag of BACKPACKS){
   w.set(outfit.id,bag.id);m.seek(.8);w.update();
   const g=c.body.geometry;assert.equal(g.attributes.skinWeight.count,g.attributes.position.count);
   for(const attribute of ['position','normal','skinWeight'])assert(g.attributes[attribute].array.every(Number.isFinite),`${age}/${outfit.id}/${bag.id}/${attribute}`);
   for(const strap of w.straps)assert(strap.geometry.attributes.position.array.every(Number.isFinite));
  }
  w.set('navy-suit','crossbody-right');
  for(const action of SOFT_ACTIONS.filter(a=>a.activity))for(const time of [0,action.duration*.35,action.duration-.01]){
   const args={foot:[0,.146,.13],rail:[action.id==='escalator-left'?-.2255:.2255,age==='child'?1.288:1.2,.122],washStepHeight:age==='child'?.18:0};
   pose(action.id,time,args);w.update();const first=c.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]);
   pose(action.id,time,args);w.update();assert.deepEqual(c.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]),first);
   assert(first.flat().every(Number.isFinite));
  }
 }
});

test('new base exports clothing, carried bag and all source joints in a posed GLB',async()=>{
 globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.()})}};
 const c=create(),w=createWardrobe(c);c.setAge('child');w.set('beige-blazer','purse-right');createMotion(c).seek(1);w.update();
 const bytes=await new GLTFExporter().parseAsync(c.body,{binary:true}),loaded=await new GLTFLoader().parseAsync(bytes,'');
 const skins=[];loaded.scene.traverse(o=>{if(o.isSkinnedMesh)skins.push(o)});assert(skins.every(o=>o.skeleton.bones.length===16));
 assert(loaded.scene.getObjectByName('Carried-purse-right'));assert(new Set(skins.map(o=>o.material)).size>3);
});

test('selected base reaches the basin with outward elbows and restores width after narrow lanes',()=>{
 const c=create(),pose=createSoftActivityPoser(c),m=createMotion(c);
 for(const age of ['adult','child']){
  c.setAge(age);const result=pose('wash',3.5,{washStepHeight:age==='child'?.28:0});
  for(let i=0;i<c.limbs.length;i++){
   const l=c.limbs[i],a=l.arm.getWorldPosition(new T.Vector3()),b=l.fore.getWorldPosition(new T.Vector3());
   assert(result.wrists[i].getWorldPosition(new T.Vector3()).distanceTo(result.targets.get(l.s))<.002,'wrist reaches the real basin');
   assert(l.s*(b.x-a.x)>-.01,'elbow remains outside the shoulder');assert(b.y<a.y-.03,'elbow hangs below the shoulder');
  }
  pose('escalator',4,{foot:[0,.146,.13],rail:[.2255,1.288,.122]});m.reset();
  assert.equal(c.body.scale.x,age==='child'?.7:1);
  for(const l of c.limbs)assert(Math.abs(l.leg.position.x-l.leg.userData.rest.x)<1e-6,'walking restores the source stance');
 }
});

test('trousers cover the selected base outer thighs without treating them as arms',()=>{
 const c=create(),w=createWardrobe(c);w.set('commuter','none');const g=c.body.geometry,a=g.attributes;
 for(const group of g.groups.filter(x=>x.materialIndex===0))for(let i=group.start;i<group.start+group.count;i++){
  if(a.position.getY(i)<.15)continue;
  for(let j=0;j<4;j++)if(a.skinWeight.array[i*4+j]>.5)assert(!/Thigh|Leg/.test(c.bones[a.skinIndex.array[i*4+j]].name),'outer thigh must remain trouser coloured');
 }
 const standing=c.body.geometry.attributes.position.array.slice();createSoftActivityPoser(c)('sit',4);w.set('commuter','none');
 assert.deepEqual(c.body.geometry.attributes.position.array,standing,'changing clothes while seated keeps the same bind-space garment boundaries');
});
