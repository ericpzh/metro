import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {solveLimb} from './interactions.js';
import {clone,retarget} from 'three/addons/utils/SkeletonUtils.js';
let sourcePromise;
const normalize=name=>name.toLowerCase().replace(/[^a-z0-9]/g,'');

export async function createLibraryMotion(root,base){
 sourcePromise??=new GLTFLoader().loadAsync(base+'human-candidates/motions/AnimationLibrary_Godot_Standard.gltf');
 const asset=await sourcePromise,source=clone(asset.scene),mixer=new THREE.AnimationMixer(source);
 let sourceMesh,targetMesh;source.traverse(n=>{if(n.isSkinnedMesh)sourceMesh=n});root.traverse(n=>{if(n.isSkinnedMesh&&!targetMesh)targetMesh=n});
 const sourceBones=new Map(sourceMesh.skeleton.bones.map(bone=>[normalize(bone.name),bone]));
 const get=name=>sourceBones.get(normalize(name));
 const names={},offsets={},mapped=[];
 const roles={Head:'DEF-head',Neck:'DEF-neck',Spine:'DEF-spine.001',Spine1:'DEF-spine.002',Spine2:'DEF-spine.003',Bip01_Head:'DEF-head',Bip01_Neck:'DEF-neck',Bip01_Spine:'DEF-spine.001',Bip01_Spine1:'DEF-spine.002',Bip01_Spine2:'DEF-spine.003',head:'DEF-head',neck_01:'DEF-neck',spine_01:'DEF-spine.001',spine_02:'DEF-spine.002',spine_03:'DEF-spine.003'};
 for(const [side,letter,suffix] of [['Left','L','l'],['Right','R','r']])for(const [target,sourceName,rocket,mpfb] of [['Shoulder','shoulder','Clavicle','clavicle'],['Arm','upper_arm','UpperArm','upperarm'],['ForeArm','forearm','Forearm','lowerarm'],['Hand','hand','Hand','hand']]){
  for(const name of [side+target,`Bip01_${letter}_${rocket}`,`${mpfb}_${suffix}`])roles[name]=`DEF-${sourceName}.${letter}`;
 }
 const targetBind=[];root.traverse(bone=>{if(bone.isBone)targetBind.push({bone,q:bone.quaternion.clone(),p:bone.position.clone(),s:bone.scale.clone()})});
 // Source clips use a T-pose reference. Match that reference temporarily,
 // including the children's A-pose rigs, before deriving axis offsets.
 const targetBones=new Map(targetBind.map(item=>[item.bone.name,item.bone]));
 for(const [side,letter,suffix,sign] of [['Left','L','l',1],['Right','R','r',-1]]){
  const find=(...names)=>names.map(name=>targetBones.get(name)).find(Boolean);
  const chain=[find(side+'Arm',`Bip01_${letter}_UpperArm`,`upperarm_${suffix}`),find(side+'ForeArm',`Bip01_${letter}_Forearm`,`lowerarm_${suffix}`),find(side+'Hand',`Bip01_${letter}_Hand`,`hand_${suffix}`)];
  if(chain.every(Boolean)){const points=chain.map(bone=>bone.getWorldPosition(new THREE.Vector3())),reach=points[0].distanceTo(points[1])+points[1].distanceTo(points[2]);solveLimb(...chain,points[0].clone().add(new THREE.Vector3(sign*(reach-.0001),0,0)),new THREE.Vector3(0,0,-1))}
 }
 root.updateMatrixWorld(true);
 const tPose=asset.animations.find(clip=>clip.name==='A_TPose');mixer.clipAction(tPose).play();mixer.setTime(0);source.updateMatrixWorld(true);root.updateMatrixWorld(true);
 for(const bone of targetMesh.skeleton.bones){const donor=get(roles[bone.name]??'');if(!donor)continue;names[bone.name]=donor.name;const q=donor.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));offsets[bone.name]=new THREE.Matrix4().makeRotationFromQuaternion(q);mapped.push(bone.name)}
 for(const {bone,q,p,s} of targetBind){bone.quaternion.copy(q);bone.position.copy(p);bone.scale.copy(s)}root.updateMatrixWorld(true);
 const actions=new Map();
 function apply(id,time,cycleSeconds){
  const name=['slow','medium','fast'].includes(id)?'Walk_Loop':'Idle_Loop',clip=asset.animations.find(clip=>clip.name===name);
  mixer.stopAllAction();let action=actions.get(name);if(!action){action=mixer.clipAction(clip);actions.set(name,action)}action.reset().play();
  mixer.setTime(['slow','medium','fast'].includes(id)?((time/cycleSeconds)%1+1)%1*clip.duration:id==='wait'?time:0);
  source.updateMatrixWorld(true);
  retarget(targetMesh,sourceMesh,{names,localOffsets:offsets,useTargetMatrix:true,preserveBoneMatrix:false,preserveBonePositions:true});
  root.updateMatrixWorld(true);
 }
 return {apply,mapped,source:'Quaternius Universal Animation Library · CC0',dispose(){mixer.stopAllAction();mixer.uncacheRoot(source)}};
}
