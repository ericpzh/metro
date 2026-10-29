import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createImportedSoftHuman,SOFT_BASE_URL} from '../src/soft-human/imported-base.js';
import {createSoftActivityPoser} from '../src/soft-human/activities.js';
import {createWardrobe} from '../src/soft-human/wardrobe.js';
import {activityRailTarget,ACTIVITY_NAMES,ACTIVITY_DURATION} from '../../game/src/sim/activities.ts';
import * as T from 'three';

const bytes=readFileSync(new URL('../public'+SOFT_BASE_URL,import.meta.url));
const create=()=>createImportedSoftHuman(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));

test('both hands reach the same action target while the other arm keeps its outward rest angle',()=>{
 const c=create(),pose=createSoftActivityPoser(c);
 for(const age of ['adult','child'])for(const action of ['shop','ticket','vending','qr','card','lift','door']){
  c.setAge(age);const targets=[];
  for(const [hand,sign]of [['right',1],['left',-1]]){
   const result=pose(action,action==='door'?1.5:3,{hand});
   assert.deepEqual([...result.targets.keys()],[sign],`${age}/${action}/${hand}: only the chosen hand interacts`);
   targets.push(result.targets.get(sign).toArray());
   const free=c.limbs.find(l=>l.s!==sign);
   assert.ok(Math.abs(free.arm.rotation.z)<1e-8&&Math.abs(free.fore.rotation.x)<1e-8,'the free arm does not tuck or act');
  }
  assert.deepEqual(targets[0],targets[1],'changing hands must not reflect a real screen or handle to the other side');
 }
})

test('a hand-owned bag reserves its hand, including one-handed washing and opposite-side rail reaches',()=>{
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
  assert.ok(wrist.distanceTo(result.targets.get(free))<.005,'the free hand reaches the original nearby belt across the body');
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
