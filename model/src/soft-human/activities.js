import * as T from 'three';
import {INTERACTIONS,interactionFrame,solveLimb,smooth} from '../animation/interactions.js';
import {ACTIVITY_NAMES,ACTIVITY_DURATION} from '../../../game/src/sim/activities.ts';
export const SOFT_ACTIONS=[
 {id:'walk-slow',label:'Slow walk / 慢走',duration:4},
 {id:'walk',label:'Medium walk / 行走',duration:4},
 {id:'walk-fast',label:'Fast walk / 快走',duration:4},
 ...ACTIVITY_NAMES.filter(id=>id!=='walk').map(id=>{const labels=INTERACTIONS.find(x=>x[0]===(id==='escalator-left'?'escalator':id));return {id,label:id==='escalator-left'?'Ride escalator · left hand / 扶梯左手':`${labels[1]} / ${labels[2]}`,duration:ACTIVITY_DURATION[ACTIVITY_NAMES.indexOf(id)],activity:true}}),
 {id:'idle',label:'Idle / 站立',duration:8},{id:'reach',label:'Arms up / 举手',duration:8},{id:'float',label:'Airborne pose / 空中姿态',duration:8},
];
export const isStationActivity=id=>SOFT_ACTIONS.some(a=>a.id===id&&a.activity);
export function createSoftActivityPoser(c){
 const wrists=c.limbs.map(({s,fore})=>{const p=new T.Object3D();p.name=`Activity wrist ${s}`;p.position.set(s*.21,-.295,.03);fore.add(p);return p});
 const ankles=c.limbs.map(({s,shin})=>{const p=new T.Object3D();p.name=`Activity ankle ${s}`;p.position.set(s*.03,-.30,.025);shin.add(p);return p});
 const hips=c.hips.position.clone(),body=c.body;
 return (id,time,anchors={})=>{
  const base=id==='escalator-left'?'escalator':id,f=interactionFrame(base,time),{t,engage:e}=f;
  for(const b of c.bones)b.rotation.set(0,0,0);c.hips.position.copy(hips);body.position.set(0,0,0);body.rotation.set(0,0,0);
  c.chest.rotation.z=.012*Math.sin(t*1.5);c.head.rotation.y=.09*Math.sin(t*.8);
  for(const {s,arm,fore} of c.limbs){arm.rotation.z=s*(c.carry?.side===s?.25:.1);fore.rotation.x=-.08}
  const scale=body.scale,child=c.appearance.age==='child',seated=id==='sit'||id==='toilet',seat=anchors.seatHeight??(id==='toilet'?.45:.49),front=anchors.seatFront??(id==='toilet'?.354:.09);
  let sitting;
  if(seated){
   const lower=smooth(.5,1.4,t)*(1-smooth(f.duration-1.1,f.duration-.1,t));
   const relax=smooth(1.4,2.5,t)*(1-smooth(f.duration-2.2,f.duration-1.1,t));
   const step=anchors.seatStepHeight??(child?Math.max(0,seat-.555*scale.y+.045):0);
   const standingZ=front+.09*scale.z+.008,seatedZ=front+.025-.169*scale.z;
   body.position.y=step;body.position.z=T.MathUtils.lerp(standingZ,seatedZ,relax);
   const supportOffset=T.MathUtils.lerp(.12,.16,smooth(0,.3,relax))+.008*Math.sin(Math.PI*relax);
   c.hips.position.y=T.MathUtils.lerp(.70,(seat+supportOffset*scale.y-step)/scale.y,lower);
   c.chest.rotation.x=.25*lower*(1-relax);
   sitting={lower,relax,step,footZ:standingZ-.01*scale.z};
  }
  const moving=(['qr','card'].includes(id)&&t>4.5&&t<7)||(id==='door'&&t>4&&t<7);
  if(moving){for(const {s,leg,shin,arm} of c.limbs){const phase=t*5.3+(s<0?Math.PI:0);leg.rotation.x=.35*Math.sin(phase);shin.rotation.x=.5*Math.max(0,-Math.sin(phase));arm.rotation.x=-.22*Math.sin(phase)}}
  const targets=new Map(),set=(s,p)=>targets.set(s,new T.Vector3(...p));
  if(['ticket','shop','lift','vending'].includes(id)){body.position.z=.12*e;set(1,[id==='lift'?.42:.16,child?.91:id==='shop'?1.13:1.12,id==='lift'?.46:id==='vending'?.35:child?.38:.48]);if(id==='lift'&&anchors.floorHeight)body.position.y=anchors.floorHeight-.018*scale.y+.006;}
  if(id==='qr'||id==='card'){set(1,[.36,id==='qr'?.77:.92,id==='qr'?.28:.36]);body.position.x=-.16*smooth(4,4.5,t);body.position.z=(child?.06*e:0)+1.9*smooth(4.5,7,t)}
  if(id==='wash'){
   body.position.z=(child?.11:.12)*e;if(anchors.washStepHeight)body.position.y=anchors.washStepHeight-.018*scale.y+.006;c.chest.rotation.x=.10*e;const dry=t>7;
   for(const s of [-1,1])set(s,[s*.045+.02*Math.sin(t*8+s),dry?.98+.025*Math.sin(t*18+s):child?.92:.89,dry?.4:child?.49:.48]);
  }
  if(id==='door'){set(1,[.33,1.02,.72]);body.position.x=(child?.10:0)*smooth(.4,1.6,t)-(child?.18:.08)*smooth(4,4.5,t);body.position.z=(child?.42:.22)*smooth(.4,1.6,t)+1.8*smooth(4,7,t);body.position.y=((anchors.thresholdHeight??.05)+.012)*smooth(.3,.5,body.position.z)*(1-smooth(1.25,1.5,body.position.z));}
  if(id==='wait'||id==='queue'){c.hips.position.x=.018*Math.sin(t);c.head.rotation.y=.3*Math.sin(t*.55)}
  if(base==='escalator'&&anchors.foot){body.position.set(0,anchors.foot[1],anchors.foot[2]);const s=id==='escalator-left'?-1:1;set(s,anchors.rail)}
  body.updateMatrixWorld(true);
  // The resting A-pose is wider than a gate/escalator lane. Keep the whole
  // non-interacting arm beside the body before blending to an equipment target.
  for(let i=0;i<c.limbs.length;i++){
   const {s,arm,fore}=c.limbs[i],narrow=['qr','card','door','escalator'].includes(base)?1:0,carrying=c.carry?.side===s;
   const spread=T.MathUtils.lerp(carrying?.14:.105,.035,narrow),drop=T.MathUtils.lerp(carrying?.644:.651,.658,narrow);
   const rest=arm.getWorldPosition(new T.Vector3()).add(new T.Vector3(s*spread*scale.x,-drop*scale.y,.02*scale.z));
   if(moving){const swing=Math.sin(t*5.3+(s<0?Math.PI:0));rest.z+=.16*swing*scale.z;rest.y+=.035*Math.abs(swing)*scale.y;}
   solveLimb(arm,fore,wrists[i],rest,new T.Vector3(s*.35,0,1));
  }
  if(seated){
   for(let i=0;i<c.limbs.length;i++){
    const {s,leg,shin}=c.limbs[i],held=c.carry?.side===s&&['handbag','purse'].includes(c.carry.type);
    const planted=new T.Vector3(s*.17*scale.x,sitting.step+.085*scale.y,sitting.footZ);
    solveLimb(leg,shin,ankles[i],planted,new T.Vector3(0,0,1));
    leg.quaternion.slerp(new T.Quaternion().setFromEuler(new T.Euler(-Math.PI/2,0,0)),sitting.relax);
    shin.quaternion.slerp(new T.Quaternion().setFromEuler(new T.Euler(Math.PI/2,0,0)),sitting.relax);
    body.updateMatrixWorld(true);
    set(s,[s*(held?.24:.15)*scale.x,seat+(held?.25:.15)*scale.y,held?front+.17*scale.z:body.position.z+.19*scale.z]);
   }
  }
  const contact=seated?sitting.lower:base==='escalator'?1:id==='door'?smooth(.4,1.6,t)*(1-smooth(1.8,2.3,t)):['qr','card'].includes(id)&&t>=4?0:moving?0:e;
  for(let i=0;i<c.limbs.length;i++){
   const {s,arm,fore}=c.limbs[i],target=targets.get(s);if(!target)continue;
   const rest=wrists[i].getWorldPosition(new T.Vector3()).lerp(target,contact);
   if(id==='wash')rest.y+=.22*Math.sin(Math.PI*contact);
   const bend=base==='escalator'?(child?new T.Vector3(s*.2,0,1):new T.Vector3(0,-1,.05)):id==='wash'?new T.Vector3(s*(child?.8:.15),-1,.1):new T.Vector3(s*.15,-1,-.12);
   solveLimb(arm,fore,wrists[i],rest,bend);
  }
  body.updateMatrixWorld(true);body.skeleton.update();
  return {...f,targets,wrists,ankles,sitting};
 };
}









