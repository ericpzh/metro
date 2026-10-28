import * as THREE from 'three';
import {solveLimb} from './interactions.js';
import {WALK_PROFILES} from '../../../game/src/sim/constants.ts';

export const CANDIDATE_MOTIONS=[
 {id:'stand',name:['Stand','站立']},
 ...WALK_PROFILES.map(profile=>({...profile,id:profile.name,name:[`Walk · ${profile.name}`,`行走 · ${{slow:'慢速',medium:'中速',fast:'快速'}[profile.name]}`]})),
 {id:'wait',name:['Wait / look around','等候 / 张望']},
];
const position=bone=>bone.getWorldPosition(new THREE.Vector3());
function worldRotation(bone,quaternion){bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(quaternion));bone.updateWorldMatrix(true,true)}

// Retarget the accepted foot-target trajectory to each source skeleton's own
// limb lengths and bind axes. No source bone is renamed or moved in bind pose.
export function createCandidateMotion(root,height,library){
 const bones=new Map(),skeletons=new Set();root.traverse(n=>{if(n.isBone)bones.set(n.name,n);if(n.isSkinnedMesh)skeletons.add(n.skeleton)});
 const get=(...names)=>names.map(name=>bones.get(name)).find(Boolean);
 const hips=get('Hips','Bip01','pelvis');
 const spine=get('Spine2','Bip01_Spine1','spine_03');
 const head=get('Head','Bip01_Head','head');
 const sideData=[];
 for(const [index,side] of ['Left','Right'].entries()){
  const suffix=index?'r':'l',prefix=index?'R':'L';
  const leg=[get(side+'UpLeg',`Bip01_${prefix}_Thigh`,`thigh_${suffix}`),get(side+'Leg',`Bip01_${prefix}_Calf`,`calf_${suffix}`),get(side+'Foot',`Bip01_${prefix}_Foot`,`foot_${suffix}`)];
  const arm=[get(side+'Arm',`Bip01_${prefix}_UpperArm`,`upperarm_${suffix}`),get(side+'ForeArm',`Bip01_${prefix}_Forearm`,`lowerarm_${suffix}`),get(side+'Hand',`Bip01_${prefix}_Hand`,`hand_${suffix}`)];
  if([...leg,...arm].some(bone=>!bone))return null;
  sideData.push({leg,arm});
 }
 const sides=sideData;
 if(!hips||!spine||!head)return null;
 root.updateMatrixWorld(true);
 const bind=[...bones.values()].map(bone=>({bone,p:bone.position.clone(),q:bone.quaternion.clone(),s:bone.scale.clone()}));
 for(const side of sides){
  side.legRest=side.leg.map(position);side.armRest=side.arm.map(position);
  side.footRotation=side.leg[2].getWorldQuaternion(new THREE.Quaternion());
  side.upper=side.legRest[0].distanceTo(side.legRest[1]);side.lower=side.legRest[1].distanceTo(side.legRest[2]);
  side.armLength=side.armRest[0].distanceTo(side.armRest[1])+side.armRest[1].distanceTo(side.armRest[2]);
 }
 const rootRest=position(hips),scale=height/1.72;
 const reset=()=>{for(const {bone,p,q,s} of bind){bone.position.copy(p);bone.quaternion.copy(q);bone.scale.copy(s)}root.updateMatrixWorld(true);for(const skeleton of skeletons)skeleton.update()};
 const pose=(id,time=0)=>{
  reset();
  const profile=WALK_PROFILES.find(p=>p.name===id),phase=profile?((time/profile.cycleSeconds)%1+1)%1:0;
  const stride=profile?profile.speed*profile.cycleSeconds*scale:0;
  if(library){
   library.apply(id,time,profile?.cycleSeconds??1);
   const mapped=new Set(library.mapped);
   for(const {bone,p,q,s} of bind){bone.position.copy(p);bone.scale.copy(s);if(!mapped.has(bone.name))bone.quaternion.copy(q)}
   root.updateMatrixWorld(true);
  }
  const feet=sides.map((side,index)=>{
   const p=(phase+index*.5)%1,target=side.legRest[2].clone();
   if(profile){
    if(p<.5)target.z+=stride*(.25-p);
    else{const t=(p-.5)*2,ease=t*t*(3-2*t);target.z+=stride*(-.25+.5*ease);target.y+=.085*scale*Math.sin(Math.PI*t)**2}
   }
   return target;
  });
  let drop=0;
  sides.forEach((side,index)=>{const target=feet[index],start=position(side.leg[0]),reach=side.upper+side.lower-.004*scale;const vertical=Math.sqrt(Math.max(.0001,reach*reach-(target.z-start.z)**2-(target.x-start.x)**2));drop=Math.max(drop,start.y-target.y-vertical)});
  const targetRoot=rootRest.clone();targetRoot.y-=drop;
  hips.position.copy(hips.parent.worldToLocal(targetRoot));hips.updateWorldMatrix(true,true);
  if(!library&&profile)spine.rotateY(-.025*Math.sin(phase*Math.PI*2));
  if(!library&&id==='wait'){spine.rotateY(.025*Math.sin(time*1.5));head.rotateY(.12*Math.sin(time*.8))}
  root.updateMatrixWorld(true);
  sides.forEach((side,index)=>{
   solveLimb(...side.leg,feet[index],new THREE.Vector3(0,0,1));
   worldRotation(side.leg[2],side.footRotation);
   if(library)return;
   const shoulder=position(side.arm[0]),sign=Math.sign(shoulder.x)||1;
   const swing=profile?Math.cos((phase+index*.5)*Math.PI*2):0;
   // Let the wrists trace a small outward arc rather than a narrow vertical
   // rail. A softer elbow and side-directed bend keep clearance at the hips.
   const lateral=profile ? .5+.5*Math.sin((phase+index*.5)*Math.PI*2) : id==='wait' ? .5+.5*Math.sin(time*1.2+index) : .35;
   const outward=(.065+.035*lateral)*scale;
   const hand=shoulder.clone().add(new THREE.Vector3(sign*outward,-side.armLength*.91,swing*stride*.16+.035*scale));
   solveLimb(...side.arm,hand,new THREE.Vector3(sign*.65,-.1,-1));
  });
  root.updateMatrixWorld(true);for(const skeleton of skeletons)skeleton.update();
  return {phase,stride,drop,feet:sides.map(side=>position(side.leg[2]).toArray()),targets:feet.map(foot=>foot.toArray()),hands:sides.map(side=>position(side.arm[2]).toArray()),shoulders:sides.map(side=>position(side.arm[0]).toArray())};
 };
 return {pose,reset,bones:Object.fromEntries(bones),sides,height,library:library?{source:library.source,mapped:library.mapped}:null,dispose(){library?.dispose()}};
}
