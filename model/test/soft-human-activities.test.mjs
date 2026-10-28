import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ACTIVITY_NAMES} from '../../game/src/sim/activities.ts';
import {createSoftHuman} from '../src/soft-human/character.js';
import {createWardrobe} from '../src/soft-human/wardrobe.js';
import {SOFT_ACTIONS,createSoftActivityPoser} from '../src/soft-human/activities.js';

test('soft preview covers every game activity and deterministic timeline samples',()=>{
 assert(ACTIVITY_NAMES.every(id=>SOFT_ACTIONS.some(a=>a.id===id)));
 const c=createSoftHuman(),w=createWardrobe(c),pose=createSoftActivityPoser(c);w.set('beige-blazer','crossbody-right');
 for(const age of ['adult','child']){c.setAge(age);for(const action of SOFT_ACTIONS.filter(a=>a.activity))for(const time of [0,2,4,7,action.duration-.1]){
  const anchors={foot:[0,.2,.3],rail:[action.id==='escalator-left'?-.3:.3,1.1,.55]};
  pose(action.id,time,anchors);w.update();const first=c.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]);pose(action.id,time,anchors);w.update();assert.deepEqual(c.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray()]),first);assert(first.flat().every(Number.isFinite));
 }}
});
test('adult and child wash poses reach the actual basin contact height',()=>{
 const c=createSoftHuman(),pose=createSoftActivityPoser(c);
 for(const age of ['adult','child']){c.setAge(age);const result=pose('wash',3.5);for(let i=0;i<c.limbs.length;i++){const s=c.limbs[i].s;const actual=result.wrists[i].getWorldPosition(new T.Vector3());assert(actual.distanceTo(result.targets.get(s))<.002,'wrist reaches basin without lowering the contact below the sink')}}
});

test('seated thighs stay horizontal and clear the actual seat front',()=>{
 const c=createSoftHuman(),pose=createSoftActivityPoser(c),a=new T.Vector3(),b=new T.Vector3();
 for(const age of ['adult','child']){c.setAge(age);for(const id of ['sit','toilet']){const seatHeight=id==='sit'?.49:.45,seatFront=id==='sit'?.09:.354;const result=pose(id,4,{seatHeight,seatFront});for(let i=0;i<c.limbs.length;i++){const {leg,shin}=c.limbs[i];leg.getWorldPosition(a);shin.getWorldPosition(b);assert(Math.abs(b.y-a.y)<1e-5,'upper leg remains horizontal instead of being pulled through seat');assert(b.z>seatFront+.07*c.body.scale.z,'knee and hanging shin clear seat front');assert(result.ankles[i].getWorldPosition(a).y>.05,'short shins dangle instead of forcing feet to floor')}}}
});
test('escalator free hand stays inside the balustrade and children stand on the wash step',()=>{
 const c=createSoftHuman(),pose=createSoftActivityPoser(c),p=new T.Vector3();for(const age of ['adult','child']){c.setAge(age);for(const id of ['escalator','escalator-left']){const held=id==='escalator'?1:-1,result=pose(id,4,{foot:[0,.2,.3],rail:[held*.223,1.48,.6]});const free=c.limbs.findIndex(l=>l.s!==held);result.wrists[free].getWorldPosition(p);assert(Math.abs(p.x)<.24*c.body.scale.x,'free hand stays beside torso')}
 if(age==='child'){const result=pose('wash',3.5,{washStepHeight:.18});assert(c.body.position.y>.17);for(let i=0;i<c.limbs.length;i++)assert(result.wrists[i].getWorldPosition(p).distanceTo(result.targets.get(c.limbs[i].s))<.002)}
 }
});

test('child rail reach keeps the elbow inboard as well as the palm',()=>{
 const c=createSoftHuman(),pose=createSoftActivityPoser(c);c.setAge('child');const p=new T.Vector3();
 for(const s of [-1,1]){const target=[s*.2255,1.288,.122],result=pose(s===1?'escalator':'escalator-left',4,{foot:[0,.146,.13],rail:target});const i=c.limbs.findIndex(l=>l.s===s);c.limbs[i].fore.getWorldPosition(p);assert(Math.abs(p.x)<.245,'elbow does not bow through the glass');assert(result.wrists[i].getWorldPosition(p).distanceTo(new T.Vector3(...target))<.002,'hand reaches the belt')}
});

test('sit and stand remain supported by planted feet or the seat throughout the motion',()=>{
 const c=createSoftHuman(),pose=createSoftActivityPoser(c),v=new T.Vector3(),p=c.body.geometry.attributes.position;
 for(const age of ['adult','child']){c.setAge(age);for(const id of ['sit','toilet']){
  const seat=id==='sit'?.49:.45,front=id==='sit'?.09:.354,step=age==='child'?Math.max(0,seat-.555*c.body.scale.y+.045):0,anchors={seatHeight:seat,seatFront:front,seatStepHeight:step};
  const initial=pose(id,0,anchors),planted=initial.ankles.map(a=>a.getWorldPosition(new T.Vector3()));
  for(let n=0;n<200;n++){const t=n/20,r=pose(id,t,anchors);assert.equal(c.body.position.y,step,'no airborne root lift');let sole=Infinity,seatGap=Infinity;
   for(let i=0;i<p.count;i++){const y=p.getY(i);if(y>=.2&&(y<.48||y>.85))continue;c.body.getVertexPosition(i,v).applyMatrix4(c.body.matrixWorld);if(y<.2)sole=Math.min(sole,v.y-step);else if(v.z<front&&v.z>front-.4)seatGap=Math.min(seatGap,v.y-seat)}
   assert(sole>-.003,`${age} ${id} at ${t}: feet stay above support`);assert(sole<.02||Math.abs(seatGap)<.02,`${age} ${id} at ${t}: feet cannot leave support before seat contact`);
   if(r.sitting.relax<1e-6)r.ankles.forEach((a,i)=>assert(a.getWorldPosition(v).distanceTo(planted[i])<.001,'planted ankle does not slide or rise'));
  }
 }}
});
test('resting and wash elbows hang below the shoulder without an inward bend',()=>{
 const c=createSoftHuman(),pose=createSoftActivityPoser(c),a=new T.Vector3(),b=new T.Vector3();
 for(const age of ['adult','child']){c.setAge(age);for(const id of ['wait','ticket','wash']){pose(id,3.5,{washStepHeight:age==='child'?.18:0});for(const l of c.limbs){if(id==='ticket'&&l.s===1)continue;l.arm.getWorldPosition(a);l.fore.getWorldPosition(b);assert(b.y<a.y-.03*c.body.scale.y,'no raised wash elbows');assert(l.s*(b.x-a.x)>-.01,'no inward resting elbow')}}}
});
test('free arms hang at near full length rather than a bent IK crouch',()=>{
 const c=createSoftHuman(),pose=createSoftActivityPoser(c);
 for(const age of ['adult','child']){c.setAge(age);for(const id of ['wait','queue','ticket','shop','vending'])for(const t of [0,1,3.5,7]){
  const r=pose(id,t);for(let i=0;i<c.limbs.length;i++){const l=c.limbs[i];if(l.s===1&&!['wait','queue'].includes(id))continue;
   const a=l.arm.getWorldPosition(new T.Vector3()),b=l.fore.getWorldPosition(new T.Vector3()),d=r.wrists[i].getWorldPosition(new T.Vector3());
   const angle=b.clone().sub(a).angleTo(d.clone().sub(b));assert(angle<.20,`free elbow flexion ${angle} at ${age}/${id}/${t}`);
  }
 }}
});

