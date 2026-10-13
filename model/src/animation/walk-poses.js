import * as THREE from 'three';

// Animate the approved skin with foot targets: a planted sole travels backward
// at exactly the root's forward speed; the other sole returns with clearance.
export function createPassengerWalkPoser(scene) {
 const bones={};let skeleton;
 scene.traverse(n=>{if(n.isBone)bones[n.name]=n;if(n.isSkinnedMesh)skeleton=n.skeleton});
 skeleton.pose();scene.updateMatrixWorld(true);
 const thigh=bones.LeftThigh,shin=bones.LeftShin,foot=bones.LeftFoot;
 const upper=-shin.position.y,lower=Math.hypot(foot.position.y,foot.position.z),reach=upper+lower-.006;
 const ankleOffset=Math.atan2(foot.position.z,-foot.position.y);
 const ankleY=foot.getWorldPosition(new THREE.Vector3()).y;
 const ankleZ=foot.getWorldPosition(new THREE.Vector3()).z;
 const soles=[Infinity,Infinity];
 scene.traverse(n=>{
  if(!n.isSkinnedMesh)return;
  const p=n.geometry.attributes.position;
  for(let i=0;i<p.count;i++)if(p.getY(i)<.10){const side=p.getX(i)<0?0:1;soles[side]=Math.min(soles[side],p.getY(i))}
 });
 const hipY=bones.Hips.position.y,thighY=thigh.position.y,thighZ=thigh.position.z;
 return (phase,profile)=>{
  skeleton.pose();
  const stride=profile.speed*profile.cycleSeconds;
  const feet=[0,.5].map(offset=>{
   const p=(phase+offset)%1;
   const y=ankleY-soles[offset===0?0:1];
   if(p<.5)return {z:ankleZ+stride*(.25-p),y,pitch:0};
   const t=(p-.5)*2,ease=t*t*(3-2*t);
   return {z:ankleZ+stride*(-.25+.5*ease),y:y+.085*Math.sin(Math.PI*t)**2,pitch:-.10*Math.sin(Math.PI*t)};
  });
  // Lower the pelvis only as much as the extended stance requires. This gives
  // the knees room to flex instead of stretching the skin to reach a long step.
  bones.Hips.position.y=Math.min(hipY,...feet.map(f=>f.y-thighY+Math.sqrt(Math.max(.01,reach**2-(f.z-thighZ)**2))));
  for(let i=0;i<2;i++){
   const side=i?'Right':'Left',f=feet[i];
   const dz=f.z-thighZ,down=bones.Hips.position.y+thighY-f.y;
   const knee=Math.acos(THREE.MathUtils.clamp((dz*dz+down*down-upper*upper-lower*lower)/(2*upper*lower),-1,1));
   const hip=Math.atan2(-dz,down)-Math.atan2(lower*Math.sin(knee),upper+lower*Math.cos(knee));
   bones[side+'Thigh'].rotation.x=hip;
   bones[side+'Shin'].rotation.x=knee+ankleOffset;
   bones[side+'Foot'].rotation.x=f.pitch-hip-knee-ankleOffset;
   const swing=Math.cos((phase+(i?.5:0))*Math.PI*2);
   bones[side+'Arm'].rotation.x=.22*(stride/1.288)*swing;
   bones[side+'Forearm'].rotation.x=-.14-.06*Math.max(0,swing);
   bones[side+'Hand'].rotation.x=-.035*swing;
  }
  const sway=Math.sin(phase*Math.PI*2);
  bones.Spine.rotation.y=-.025*sway;
  bones.Neck.rotation.y=.018*sway;
  scene.updateMatrixWorld(true);skeleton.update();
 };
}
