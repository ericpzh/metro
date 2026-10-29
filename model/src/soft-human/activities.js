import * as T from 'three';
import {INTERACTIONS,interactionFrame,solveLimb,smooth} from '../animation/interactions.js';
import {ACTIVITY_NAMES,ACTIVITY_DURATION} from '../../../game/src/sim/activities.ts';
import {relaxedArmTarget,relaxedArmBend,poseRelaxedArm} from './relaxed-arms.js';
export const SOFT_ACTIONS=[
 {id:'walk-slow',label:'Slow walk / 慢走',duration:4},
 {id:'walk',label:'Medium walk / 行走',duration:4},
 {id:'walk-fast',label:'Fast walk / 快走',duration:4},
 ...ACTIVITY_NAMES.filter(id=>id!=='walk').map(id=>{const labels=INTERACTIONS.find(x=>x[0]===(id==='escalator-left'?'escalator':id));return {id,label:id==='escalator-left'?'Ride escalator · left hand / 扶梯左手':`${labels[1]} / ${labels[2]}`,duration:ACTIVITY_DURATION[ACTIVITY_NAMES.indexOf(id)],activity:true}}),
 {id:'idle',label:'Idle / 站立',duration:8},{id:'reach',label:'Arms up / 举手',duration:8},{id:'float',label:'Airborne pose / 空中姿态',duration:8},
];
export const isStationActivity=id=>SOFT_ACTIONS.some(a=>a.id===id&&a.activity);
export function createSoftActivityPoser(c){
 const keepDefaultArms=c.restArmAngle===0;
 const wrists=c.limbs.map(({s,fore,wrist})=>{const p=new T.Object3D();p.name=`Activity wrist ${s}`;p.position.copy(wrist??new T.Vector3(s*.21,-.295,.03));fore.add(p);return p});
 const ankles=c.limbs.map(({s,shin,ankle})=>{const p=new T.Object3D();p.name=`Activity ankle ${s}`;p.position.copy(ankle??new T.Vector3(s*.03,-.30,.025));shin.add(p);return p});
 const hips=c.hips.position.clone(),body=c.body;
 return (id,time,anchors={})=>{
  const base=id==='escalator-left'?'escalator':id,f=interactionFrame(base,time),{t,engage:e}=f;
  const held=c.carry&&['handbag','purse'].includes(c.carry.type),hand=anchors.hand??(held?(c.carry.side===1?'left':'right'):'default');
  const actionSide=hand==='left'?-1:1;
  c.resetPose?.();for(const b of c.bones)b.rotation.set(0,0,0);c.hips.position.copy(hips);body.position.set(0,0,0);body.rotation.set(0,0,0);
  c.chest.rotation.z=.012*Math.sin(t*1.5);c.head.rotation.y=.09*Math.sin(t*.8);
  for(const {s,arm,fore} of c.limbs){arm.rotation.z=keepDefaultArms?0:s*(c.carry?.side===s?.25:.1);fore.rotation.x=keepDefaultArms?0:-.08}
  const scale=body.scale,child=c.appearance.age==='child',seated=id==='sit'||id==='toilet',seat=anchors.seatHeight??(id==='toilet'?.45:.49),front=anchors.seatFront??(id==='toilet'?.354:.09);
  if(c.metrics){
   const narrow=['qr','card','door','escalator'].includes(base);
   // Keep the selected age's default width as well as its outward arm pose.
   // Narrow equipment must not silently compress the character's silhouette.
   for(const l of c.limbs)l.leg.position.x=narrow&&base!=='escalator'?l.s*.19:l.leg.userData.rest.x-c.hips.userData.rest.x;
  }
  let sitting;
  if(seated){
   const lower=smooth(.5,1.4,t)*(1-smooth(f.duration-1.1,f.duration-.1,t));
   const relax=smooth(1.4,2.5,t)*(1-smooth(f.duration-2.2,f.duration-1.1,t));
   const step=anchors.seatStepHeight??(child?Math.max(0,seat-.555*scale.y+.045):0);
   const standingZ=front+(c.metrics?.235:.09)*scale.z+.008,seatedZ=front+.025-.169*scale.z;
   body.position.y=step;body.position.z=T.MathUtils.lerp(standingZ,seatedZ,relax);
   const supportOffset=T.MathUtils.lerp(c.metrics?.20:.12,c.metrics?.205:.16,smooth(0,.3,relax))+.008*Math.sin(Math.PI*relax);
   c.hips.position.y=T.MathUtils.lerp(c.metrics?.hipHeight??.70,(seat+supportOffset*scale.y-step)/scale.y,lower);
   c.chest.rotation.x=.25*lower*(1-relax);
   sitting={lower,relax,step,footZ:standingZ-.01*scale.z};
  }
  const moving=(['qr','card'].includes(id)&&t>4.5&&t<7)||(id==='door'&&t>4&&t<7);
  if(moving){for(const {s,leg,shin,arm} of c.limbs){const phase=t*5.3+(s<0?Math.PI:0);leg.rotation.x=.35*Math.sin(phase);shin.rotation.x=.5*Math.max(0,-Math.sin(phase));arm.rotation.x=-.22*Math.sin(phase)}}
  const targets=new Map(),set=(s,p)=>targets.set(s,new T.Vector3(...p));
  if(['ticket','shop','lift','vending'].includes(id)){body.position.z=.12*e;set(actionSide,[id==='lift'?.42:.16,child?.91:id==='shop'?1.13:1.12,id==='lift'?.46:id==='vending'?.35:child?.38:.48]);if(id==='lift'&&anchors.floorHeight)body.position.y=anchors.floorHeight-(c.metrics?0:.018)*scale.y+.006;}
  if(id==='qr'||id==='card'){set(actionSide,[.36,id==='qr'?.77:.92,id==='qr'?.28:.36]);body.position.x=-.16*smooth(4,4.5,t);body.position.z=(child?.06*e:0)+1.9*smooth(4.5,7,t)}
  if(id==='wash'){
   body.position.z=(c.metrics&&!child?-.04:child?.11:.12)*e;if(anchors.washStepHeight)body.position.y=anchors.washStepHeight-(c.metrics?0:.018)*scale.y+.006;c.chest.rotation.x=.10*e;const dry=t>7;
   for(const s of hand==='default'?[-1,1]:[actionSide])set(s,[s*.045+.02*Math.sin(t*8+s),dry?.98+.025*Math.sin(t*18+s):child?.92:.89,dry?.4:child?.49:.48]);
  }
  if(id==='door'){set(actionSide,[.33,1.02,.72]);body.position.x=(child?.10:0)*smooth(.4,1.6,t)-(child?.18:.08)*smooth(4,4.5,t);body.position.z=(child?.42:.22)*smooth(.4,1.6,t)+1.8*smooth(4,7,t);body.position.y=((anchors.thresholdHeight??.05)+.012)*smooth(.3,.5,body.position.z)*(1-smooth(1.25,1.5,body.position.z));}
  if(id==='wait'||id==='queue'){c.hips.position.x=.018*Math.sin(t);c.head.rotation.y=.3*Math.sin(t*.55)}
  if(base==='escalator'&&anchors.foot){
   body.position.set(0,anchors.foot[1]+(c.metrics?.02:0),anchors.foot[2]);
   const s=hand==='default'?(id==='escalator-left'?-1:1):actionSide;
   if(keepDefaultArms){
    // Author a comfortable arm on its own side. The equipment follows the
    // rider's feet; it must not twist the torso or pull an elbow across the chest.
    // Rail overlap is allowed: natural posture takes priority over contact.
    const {arm}=c.limbs.find(l=>l.s===s),length=c.metrics.armLength;
    body.updateMatrixWorld(true);
    const target=body.worldToLocal(arm.getWorldPosition(new T.Vector3()))
     .add(new T.Vector3(s*.20,-.12,.74).multiplyScalar(length));
    set(s,body.localToWorld(target).toArray());
   }else set(s,anchors.rail);
  }
  body.updateMatrixWorld(true);
  // Keep the historical procedural fixture's older resting pose.
  for(let i=0;i<c.limbs.length;i++){
   if(keepDefaultArms)continue;
   const {s,arm,fore}=c.limbs[i],narrow=['qr','card','door','escalator'].includes(base)?1:0,carrying=c.carry?.side===s;
   const spread=T.MathUtils.lerp(carrying?.14:.105,.035,narrow),drop=c.metrics?Math.sqrt(c.metrics.armLength**2-spread**2)*.997:T.MathUtils.lerp(carrying?.644:.651,.658,narrow);
   const rest=arm.getWorldPosition(new T.Vector3()).add(new T.Vector3(s*spread*scale.x,-drop*scale.y,.02*scale.z));
   if(moving){const swing=Math.sin(t*5.3+(s<0?Math.PI:0));rest.z+=.16*swing*scale.z;rest.y+=.035*Math.abs(swing)*scale.y;}
   solveLimb(arm,fore,wrists[i],rest,new T.Vector3(s*.35,0,1));
  }
  if(seated){
   for(let i=0;i<c.limbs.length;i++){
    const {s,leg,shin}=c.limbs[i],held=c.carry?.side===s&&['handbag','purse'].includes(c.carry.type);
    const planted=new T.Vector3((c.metrics?c.limbs[i].leg.userData.rest.x:s*.17)*scale.x,sitting.step+(c.metrics?c.limbs[i].shin.userData.rest.y+c.limbs[i].ankle.y:.085)*scale.y,sitting.footZ);
    solveLimb(leg,shin,ankles[i],planted,new T.Vector3(0,0,1));
    leg.quaternion.slerp(new T.Quaternion().setFromEuler(new T.Euler(-Math.PI/2,0,0)),sitting.relax);
    shin.quaternion.slerp(new T.Quaternion().setFromEuler(new T.Euler(Math.PI/2,0,0)),sitting.relax);
    body.updateMatrixWorld(true);
    if(!keepDefaultArms)set(s,[s*(held?.24:.15)*scale.x,seat+(held?.25:.15)*scale.y,held?front+.17*scale.z:body.position.z+.19*scale.z]);
   }
  }
  const contact=seated?sitting.lower:base==='escalator'?1:id==='door'?smooth(.4,1.6,t)*(1-smooth(1.8,2.3,t)):['qr','card'].includes(id)&&t>=4?0:moving?0:e;
  const relaxedTarget=limb=>relaxedArmTarget(c,limb);
  // Bring a short or opposite-side arm within its actual two-bone reach before
  // solving the elbow. This uses joint lengths and the authored target only.
  if(keepDefaultArms&&base!=='escalator'&&targets.size===1&&contact>1e-6){
   const [s,target]=targets.entries().next().value,i=c.limbs.findIndex(l=>l.s===s),{arm,fore}=c.limbs[i];
   let frame=arm;while(frame.isBone&&frame.parent)frame=frame.parent;
   const inverse=frame.matrixWorld.clone().invert(),point=bone=>bone.getWorldPosition(new T.Vector3()).applyMatrix4(inverse);
   const a=point(arm),b=point(fore),end=point(wrists[i]);
   const reach=(a.distanceTo(b)+b.distanceTo(end))*.995,goal=relaxedTarget(c.limbs[i]).applyMatrix4(inverse).lerp(target.clone().applyMatrix4(inverse),contact);
   if(a.distanceTo(goal)>reach){
    const start=c.chest.rotation.y,turn=-s*1.45;let low=0,high=1;
    c.chest.rotation.y=turn;body.updateMatrixWorld(true);
    if(point(arm).distanceTo(goal)<=reach){
     for(let k=0;k<10;k++){const blend=(low+high)/2;c.chest.rotation.y=T.MathUtils.lerp(start,turn,blend);body.updateMatrixWorld(true);if(point(arm).distanceTo(goal)>reach)low=blend;else high=blend;}
     c.chest.rotation.y=T.MathUtils.lerp(start,turn,high);c.head.rotation.y-=(c.chest.rotation.y-start)*.5;
    }else c.chest.rotation.y=start;
    body.updateMatrixWorld(true);
   }
  }
  // The accepted escalator free arm is the shared station rest pose. Apply it
  // after torso/seat adjustments, including both arms before and after a reach.
  if(keepDefaultArms)for(let i=0;i<c.limbs.length;i++){
   const l=c.limbs[i];if(targets.has(l.s)&&contact>1e-6)continue;
   poseRelaxedArm(c,l,wrists[i]);
  }
  for(let i=0;i<c.limbs.length;i++){
   const {s,arm,fore}=c.limbs[i],target=targets.get(s);if(!target)continue;
   if(keepDefaultArms&&contact<=1e-6)continue;
   const rest=(keepDefaultArms&&base!=='escalator'?relaxedTarget(c.limbs[i]):wrists[i].getWorldPosition(new T.Vector3())).lerp(target,contact);
   if(id==='wash')rest.y+=.22*Math.sin(Math.PI*contact);
   const bend=base==='escalator'?(keepDefaultArms?new T.Vector3(s*.35,-1,-.1):child?new T.Vector3(s*.2,0,1):new T.Vector3(0,-1,.05)):id==='wash'?(c.metrics?new T.Vector3(s*.9,child?-.1:.2,-.5):new T.Vector3(s*(child?.8:.15),-1,.1)):new T.Vector3(s*.15,-1,-.12);
   if(keepDefaultArms&&base!=='escalator')bend.lerp(relaxedArmBend(c,c.limbs[i]),1-contact);
   solveLimb(arm,fore,wrists[i],rest,bend);
   if(keepDefaultArms&&base==='escalator'){
    // Lift the comfortable arm as one piece in side view. Preserve its frontal
    // spacing and elbow bend, rather than solving a new shape against the rail.
    const parentFrame=body.matrixWorld.clone().invert().multiply(arm.parent.matrixWorld);
    const axis=new T.Vector3(1,0,0).transformDirection(parentFrame.invert());
    arm.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(axis,-Math.PI/6));
    arm.updateWorldMatrix(true,true);target.copy(wrists[i].getWorldPosition(new T.Vector3()));
   }
  }
  body.updateMatrixWorld(true);body.skeleton.update();
  return {...f,targets,wrists,ankles,sitting,contact};
 };
}









