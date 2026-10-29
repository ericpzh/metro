import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createImportedSoftHuman,SOFT_BASE_URL} from '../src/soft-human/imported-base.js';
import {createSoftActivityPoser} from '../src/soft-human/activities.js';
import {createWardrobe} from '../src/soft-human/wardrobe.js';
import {activityRailTarget,ACTIVITY_NAMES,ACTIVITY_DURATION} from '../../game/src/sim/activities.ts';
import {solveLimb} from '../src/animation/interactions.js';
import {relaxedArmBend} from '../src/soft-human/relaxed-arms.js';
import * as T from 'three';

const bytes=readFileSync(new URL('../public'+SOFT_BASE_URL,import.meta.url));
const create=()=>createImportedSoftHuman(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));

test('both hands reach the same action target while the other arm keeps the shared relaxed stance',()=>{
 const c=create(),pose=createSoftActivityPoser(c);
 for(const age of ['adult','child'])for(const action of ['shop','ticket','vending','qr','card','lift','door']){
  c.setAge(age);const targets=[];
  for(const [hand,sign]of [['right',1],['left',-1]]){
   const result=pose(action,action==='door'?1.5:3,{hand});
   assert.deepEqual([...result.targets.keys()],[sign],`${age}/${action}/${hand}: only the chosen hand interacts`);
   targets.push(result.targets.get(sign).toArray());
   const free=c.limbs.find(l=>l.s!==sign);
   const a=c.body.worldToLocal(free.arm.getWorldPosition(new T.Vector3())),end=c.body.worldToLocal(result.wrists[c.limbs.indexOf(free)].getWorldPosition(new T.Vector3()));
   assert.ok(end.sub(a).distanceTo(new T.Vector3(free.s*.26,-.90,.06).multiplyScalar(c.metrics.armLength))<1e-5,'the free arm uses the same relaxed stance as an escalator rider');
  }
  assert.deepEqual(targets[0],targets[1],'changing hands must not reflect a real screen or handle to the other side');
 }
})

test('a hand-owned bag reserves its hand, including one-handed washing and a natural escalator arm on its own side',()=>{
 const c=create(),w=createWardrobe(c),pose=createSoftActivityPoser(c);
 for(const side of ['left','right'])for(const type of ['purse','handbag']){
  w.set('commuter',`${type}-${side}`);
  const free=side==='right'?-1:1;
  for(const action of ['ticket','shop','wash']){
   const result=pose(action,3);
   assert.deepEqual([...result.targets.keys()],[free],`${type}/${side}: the carrying hand has no action target`);
  }
  const target=activityRailTarget(1);target[0]*=-free;
  const result=pose('escalator',3,{foot:[0,0,0],rail:target});
  assert.deepEqual([...result.targets.keys()],[free]);
  const wrist=result.wrists[c.limbs.findIndex(l=>l.s===free)].getWorldPosition(c.body.position.clone());
  assert.ok(wrist.distanceTo(result.targets.get(free))<.005,'the free hand follows the comfortable authored reach');
  assert.equal(c.chest.rotation.y,0,'an opposite-side belt must not twist the chest');
  assert.ok(wrist.x*free>.3,'the arm stays on its own side instead of crossing the chest');
 }
 w.set('plain','none');
})

test('both screen hands stay in contact across the baked independent height fits',()=>{
 const c=create(),pose=createSoftActivityPoser(c),reset=c.resetPose;
 c.resetPose=()=>{reset();c.body.scale.set(1,c.fitHeight,1);c.body.updateMatrixWorld(true)};
 for(const height of [.8,.9,1,1.1,1.2])for(const action of [2,3,4,5,6,8,11])for(const [hand,s]of [['right',1],['left',-1]]){
  c.setAge('adult');c.fitHeight=height;
  const result=pose(ACTIVITY_NAMES[action],action===11?1.6:ACTIVITY_DURATION[action]*8/23,{hand});
  const p=result.wrists[c.limbs.findIndex(l=>l.s===s)].getWorldPosition(new T.Vector3());
  assert.ok(p.distanceTo(result.targets.get(s))<.006,`${height}/${action}/${hand}: the reach solves in the same rig frame as the IK`);
 }
})

test('escalator posture is independent of belt position, including an opposite-hand reach',()=>{
 const c=create(),pose=createSoftActivityPoser(c);
 for(const age of ['adult','child'])for(const hand of ['default','left','right'])for(const action of ['escalator','escalator-left']){
  c.setAge(age);
  pose(action,4,{foot:[0,.15,.3],rail:[.22,1.3,.4],hand});
  const first=c.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]);
  pose(action,4,{foot:[0,.15,.3],rail:[-2,3,-1],hand});
  assert.deepEqual(c.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]),first,'moving a belt cannot force a different body or arm pose');
  assert.equal(c.chest.rotation.y,0);
 }
})

test('the escalator shoulder lift preserves front-view spacing, elbow bend and the free arm',()=>{
 const c=create(),reference=create(),pose=createSoftActivityPoser(c),rest=createSoftActivityPoser(reference);
 const point=(body,o)=>body.worldToLocal(o.getWorldPosition(new T.Vector3()));
 for(const age of ['adult','child'])for(const hand of ['left','right']){
  c.setAge(age);reference.setAge(age);
  const s=hand==='right'?1:-1,base=rest('wait',4),result=pose('escalator',4,{foot:[0,.15,.3],rail:[-.22,1.3,.4],hand});
  for(let i=0;i<reference.limbs.length;i++){
   const l=reference.limbs[i],active=l.s===s,a=point(reference.body,l.arm);
   const target=reference.body.localToWorld(a.clone().add(new T.Vector3(...(active?[s*.20,-.12,.74]:[l.s*.26,-.90,.06])).multiplyScalar(reference.metrics.armLength)));
   solveLimb(l.arm,l.fore,base.wrists[i],target,active?new T.Vector3(s*.35,-1,-.1):relaxedArmBend(reference,l));
   const actual=c.limbs[i],shoulder=point(c.body,actual.arm),before=[point(reference.body,l.fore).sub(a),point(reference.body,base.wrists[i]).sub(a)],after=[point(c.body,actual.fore).sub(shoulder),point(c.body,result.wrists[i]).sub(shoulder)];
   for(let k=0;k<2;k++){
    assert(Math.abs(after[k].x-before[k].x)<1e-6,'raising the arm cannot change its front-view sideways spacing');
    const expected=before[k].clone();if(active)expected.applyAxisAngle(new T.Vector3(1,0,0),-Math.PI/6);
    assert(after[k].distanceTo(expected)<1e-6,active?'the whole bent arm only rotates in side view':'the free arm stays unchanged');
   }
   assert(Math.abs(after[0].angleTo(after[1].clone().sub(after[0]))-before[0].angleTo(before[1].clone().sub(before[0])))<1e-6,'elbow bend stays unchanged');
  }
  assert.equal(c.chest.rotation.y,0);
 }
})

test('relaxed elbows bend backward and forearms forward without changing the accepted front view',()=>{
 const c=create(),reference=create(),pose=createSoftActivityPoser(c),old=createSoftActivityPoser(reference);
 const point=(body,o)=>body.worldToLocal(o.getWorldPosition(new T.Vector3()));
 for(const age of ['adult','child'])for(const hand of ['default','left','right'])for(const action of ['wait','sit','qr','lift','escalator']){
  c.setAge(age);reference.setAge(age);
  const args={foot:[0,.15,.3],rail:[.22,1.3,.4],hand},result=pose(action,3.5,args),baseline=old(action,3.5,args);
  for(let i=0;i<c.limbs.length;i++){
   const l=c.limbs[i];if(result.targets.has(l.s)&&result.contact>1e-6)continue;
   const prior=reference.limbs[i],goal=baseline.wrists[i].getWorldPosition(new T.Vector3());
   solveLimb(prior.arm,prior.fore,baseline.wrists[i],goal,new T.Vector3(prior.s*.1,0,1));
   const shoulder=point(c.body,l.arm),elbow=point(c.body,l.fore),wrist=point(c.body,result.wrists[i]);
   const oldElbow=point(reference.body,prior.fore),oldWrist=point(reference.body,baseline.wrists[i]);
   assert(elbow.z<shoulder.z-.05,'upper arm angles back from the shoulder');
   assert(wrist.z>elbow.z+.1,'forearm angles forward toward the hand');
   assert(Math.abs(elbow.x-oldElbow.x)<1e-6,'side-view correction preserves the frontal elbow spacing');
   assert(wrist.distanceTo(oldWrist)<1e-6,'the accepted wrist position stays unchanged');
  }
 }
})
