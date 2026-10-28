import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createSoftHuman} from '../src/soft-human/character.js';
import {createWardrobe} from '../src/soft-human/wardrobe.js';
import {createSoftActivityPoser} from '../src/soft-human/activities.js';
test('hip bags remain attached without clearance-driven jumps; padded strap ends meet the bag',()=>{
 const c=createSoftHuman(),w=createWardrobe(c),pose=createSoftActivityPoser(c);
 for(const age of ['adult','child'])for(const side of ['left','right'])for(const type of ['shoulder','crossbody']){
  c.setAge(age);w.set('commuter',`${type}-${side}`);const origin=w.pack.position.clone(),strap=w.straps[0];
  for(const action of ['wait','sit','wash','ticket','escalator'])for(const t of [0,.5,1,2,3,4,5,6]){
   pose(action,t);w.update();assert(w.pack.position.equals(origin),'no collision-based bag displacement');
   assert(strap.userData.surfaceAnchors.length>0,'strap follows actual torso triangles');
   assert.equal(strap.children.length,2,'both ends connect to bag');
  }
 }
});

