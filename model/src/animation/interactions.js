import * as THREE from 'three';
import {applyPassengerCarryPose} from './carry-pose.js';
import {createPassengerWalkPoser} from './walk-poses.js';

export const INTERACTIONS=[
 ['sit','Sit down / rest / stand','坐下 / 休息 / 起身',10],
 ['shop','Browse shelves','浏览货架',9],
 ['ticket','Buy a train ticket','购买车票',10],
 ['vending','Use drink machine','使用饮料售货机',10],
 ['qr','Scan QR / pass gate','扫码过闸',8],
 ['card','Tap card / pass gate','刷卡过闸',8],
 ['escalator','Ride / hold handrail','扶梯 / 扶扶手',10],
 ['lift','Select elevator floor / wait','电梯选层 / 等候',9],
 ['toilet','Sit on toilet / stand','如厕坐下 / 起身',10],
 ['wash','Turn on tap / wash / dry','开水 / 洗手 / 甩干',10],
 ['door','Open / walk through / close','开门 / 通过 / 关门',10],
 ['wait','Wait / look around','等候 / 张望',12],
 ['queue','Queue at platform screen doors','站台屏蔽门前排队',12],
];
export const smooth=(a,b,t)=>{const v=THREE.MathUtils.clamp((t-a)/(b-a),0,1);return v*v*(3-2*v)};
export function interactionFrame(id,time){
 const duration=INTERACTIONS.find(a=>a[0]===id)?.[3]??10;
 const t=((time%duration)+duration)%duration;
 const engage=smooth(1,2.5,t)*(1-smooth(duration-2,duration-1,t));
 return {t,duration,engage,phase:t<1?'Approach':t<2.5?'Reach / settle':t<duration-2?'Interact / wait':'Release / leave'};
}

// Two-bone IK keeps each limb's authored length. Targets are in viewer world
// space, so hand contact stays on equipment when passenger dimensions change.
export function solveLimb(root,mid,end,target,bend){
 root.updateWorldMatrix(true,true);
 // Solve in the rig's frame. Decomposing world quaternions under independently
 // scaled height/width/depth introduces shear and misses the wrist target.
 let frame=root;while(frame.isBone&&frame.parent)frame=frame.parent;
 const inverse=frame.isBone?new THREE.Matrix4():frame.matrixWorld.clone().invert();
 const point=bone=>bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
 const rotation=bone=>{const q=new THREE.Quaternion();new THREE.Matrix4().multiplyMatrices(inverse,bone.matrixWorld).decompose(new THREE.Vector3(),q,new THREE.Vector3());return q};
 const a=point(root),b=point(mid),c=point(end);
 const l1=a.distanceTo(b),l2=b.distanceTo(c),delta=target.clone().applyMatrix4(inverse).sub(a);
 const d=THREE.MathUtils.clamp(delta.length(),Math.abs(l1-l2)+.0001,l1+l2-.0001),axis=delta.normalize();
 const along=(l1*l1-l2*l2+d*d)/(2*d);
 const pole=bend.clone().transformDirection(inverse);
 const normal=pole.clone().addScaledVector(axis,-pole.dot(axis)).normalize();
 const elbow=a.clone().addScaledVector(axis,along).addScaledVector(normal,Math.sqrt(Math.max(0,l1*l1-along*along)));
 function aim(bone,child,to){
  const from=point(bone),old=point(child).sub(from).normalize();
  const q=rotation(bone);
  q.premultiply(new THREE.Quaternion().setFromUnitVectors(old,to.clone().sub(from).normalize()));
  bone.quaternion.copy(rotation(bone.parent).invert().multiply(q));bone.updateWorldMatrix(true,true);
 }
 aim(root,mid,elbow);aim(mid,end,a.clone().addScaledVector(axis,d));
}

export function createInteractionPoser(scene){
 const bones={},skeletons=new Set();scene.traverse(n=>{if(n.isBone)bones[n.name]=n;if(n.isSkinnedMesh)skeletons.add(n.skeleton)});
 const hips=bones.Hips.position.clone();
 const walk=createPassengerWalkPoser(scene);
 return (id,time,anchors={})=>{
  for(const skeleton of skeletons)skeleton.pose();
  scene.position.set(0,0,0);scene.rotation.set(0,0,0);
  const f=interactionFrame(id,time),{t,engage:e}=f;
  bones.Hips.position.copy(hips);bones.Spine.rotation.z=.012*Math.sin(t*1.5);bones.Neck.rotation.y=.09*Math.sin(t*.8);
  applyPassengerCarryPose(scene);
  const seated=id==='sit'||id==='toilet';
  if(seated){
   bones.Hips.position.y=THREE.MathUtils.lerp(hips.y,(id==='toilet'?.633:.666)/scene.scale.y,e);bones.Hips.position.z+=(id==='toilet'?.38:.30)*(1-e)-(id==='toilet'?.08:.15)*e;
   for(const side of ['Left','Right']){bones[side+'Thigh'].rotation.x=-1.48*e;bones[side+'Shin'].rotation.x=1.48*e;}
   bones.Spine.rotation.x=.16*Math.sin(Math.PI*e);
  }
  const moving=(['qr','card'].includes(id)&&t>4.5&&t<7)||(id==='door'&&t>4&&t<7);
  if(moving)walk((t/1.12)%1,{speed:.9,cycleSeconds:1.12});
  const hands={};
  if(['ticket','shop','lift','vending'].includes(id)){
   scene.position.z=.10*e;
   hands.Right=[id==='lift'?.42:.16,id==='shop'?1.13:1.12,.48];
  }
  if(id==='qr'||id==='card'){
   hands.Right=[.36,id==='qr'?.77:.92,id==='qr'?.32:.36];
   scene.position.z=1.9*smooth(4.5,7,t);
  }
  if(id==='escalator'&&anchors.foot){
   scene.position.set(0,anchors.foot[1],anchors.foot[2]);hands.Right=anchors.rail;
  }
  if(id==='wash'){
   scene.position.z=.12*e;bones.Spine.rotation.x=.10*e;
   const dry=t>7;
   hands.Right=[.045+.035*Math.sin(t*8),dry?.98+.035*Math.sin(t*18):.91,dry?.4:.59];hands.Left=[-.045+.035*Math.sin(t*8+1),dry?.98+.035*Math.sin(t*18+1):.91,dry?.4:.59];
  }
  if(id==='door'){hands.Right=[.33,1.02,.57];scene.position.z=1.8*smooth(4,7,t);}
  if(id==='wait'||id==='queue'){
   bones.Hips.position.x=.018*Math.sin(t);bones.Neck.rotation.y=.3*Math.sin(t*.55);
  }
  if(seated){hands.Right=[.17,.64,.14];hands.Left=[-.17,.64,.14];}
  scene.updateMatrixWorld(true);
  if(seated)for(const side of ['Left','Right']){
   const foot=bones[side+'Foot'];const target=foot.getWorldPosition(new THREE.Vector3());
   target.y=THREE.MathUtils.lerp(target.y,.125*scene.scale.y,e);target.z=THREE.MathUtils.lerp(target.z,id==='toilet'?.30:.20,e);
   solveLimb(bones[side+'Thigh'],bones[side+'Shin'],foot,target,new THREE.Vector3(0,0,1));foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  }
  for(const [side,xyz] of Object.entries(hands)){
   const hand=bones[side+'Hand'],rest=hand.getWorldPosition(new THREE.Vector3());
   const target=new THREE.Vector3(...xyz);
   const contact=moving?0:id==='escalator'?1:e;
   const bend=id==='escalator'?new THREE.Vector3(-.1,-1,0):new THREE.Vector3(side==='Right'?.12:-.12,-1,-.15);
   rest.lerp(target,contact);solveLimb(bones[side+'Arm'],bones[side+'Forearm'],hand,rest,bend);

  }
  scene.updateMatrixWorld(true);for(const skeleton of skeletons)skeleton.update();
  return f;
 };
}
