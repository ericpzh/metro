import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {addCarriedBags} from '../src/characters/carried-bags.js';
import {applyPassengerCarryPose} from '../src/animation/carry-pose.js';

test('visible side bags apply the same mirrored carrying pose without moving purse arms',()=>{
 for(const type of ['shoulder','crossbody','purse'])for(const side of ['left','right']){
  const scene=new THREE.Group(),bones={};
  for(const prefix of ['Left','Right'])for(const joint of ['Arm','Forearm']){
   const bone=new THREE.Bone();bone.name=prefix+joint;scene.add(bone);bones[bone.name]=bone;
  }
  const prefix=side==='left'?'Left':'Right',other=side==='left'?'Right':'Left',sign=side==='left'?-1:1;
  bones[prefix+'Arm'].rotation.x=.5;
  const bag=new THREE.Group();bag.userData.carriedBag={type,side,component:'body'};scene.add(bag);
  // Hidden alternatives must not override the chosen carrying side.
  const hidden=new THREE.Group();hidden.visible=false;hidden.userData.carriedBag={type:'shoulder',side:side==='left'?'right':'left',component:'body'};scene.add(hidden);
  applyPassengerCarryPose(scene);
  assert.equal(bones[prefix+'Arm'].rotation.z,type==='purse'?0:sign*.16);
  assert.equal(bones[prefix+'Forearm'].rotation.z,type==='purse'?0:-sign*.08);
  assert.equal(bones[prefix+'Arm'].rotation.x,type==='purse'?.5:.5*.28,'carrying side reduces swing while hand-held purses retain normal walking');
  assert.equal(bones[other+'Arm'].rotation.z,0,'the other arm retains its gait');
 }
});

test('crossbody straps keep their free anchors when garment fitting rays miss',()=>{
 const model=new THREE.Group(),spine=new THREE.Bone();spine.name='Spine';spine.position.y=1.11;model.add(spine);
 const bones=[spine];
 for(const [side,sign] of [['Left',-1],['Right',1]]){
  const arm=new THREE.Bone(),forearm=new THREE.Bone(),hand=new THREE.Bone();
  arm.name=side+'Arm';arm.position.set(sign*.205,.175,.035);spine.add(arm);
  forearm.name=side+'Forearm';forearm.position.set(sign*.035,-.27,0);arm.add(forearm);
  hand.name=side+'Hand';hand.position.set(0,-.245,0);forearm.add(hand);bones.push(arm,forearm,hand);
 }
 model.updateMatrixWorld(true);
 // A remote surface deliberately leaves the strap unsupported. Real bag
 // anchors and points crossing a neckline gap exercise this same missed-ray path.
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([1.5,1.1,0,1.6,1.1,0,1.5,1.2,0],3));geometry.setIndex([0,1,2]);
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(12),4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
 const body=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial()),skeleton=new THREE.Skeleton(bones);model.add(body);body.bind(skeleton);model.updateMatrixWorld(true);
 const original=Array.from(geometry.attributes.position.array),variants=addCarriedBags(model,body);
 for(const side of ['left','right']){
  const strap=variants.get('crossbody-'+side).find(m=>m.userData.carriedBag.component==='strap'),p=strap.geometry.attributes.position,index=strap.geometry.index;
  for(let i=0;i<p.count;i++)assert(Number.isFinite(p.getX(i))&&Number.isFinite(p.getY(i))&&Number.isFinite(p.getZ(i))&&p.getY(i)>1.03&&p.getY(i)<1.40,'a missed ray must keep the ribbon between shoulder and bag');
  for(let i=0;i<index.count;i+=3){const vertices=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+k)));for(let k=0;k<3;k++)assert(vertices[k].distanceTo(vertices[(k+1)%3])<.10,'the free bridge cannot create a long triangle toward the origin')}
 }
 assert.deepEqual(Array.from(geometry.attributes.position.array),original,'fitting accessories does not mutate the source body');
});
