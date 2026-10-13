import * as THREE from 'three';
import {createPassengerWalkPoser} from './walk-poses.js';

export function createWalkClips(model,profiles){
 let skeleton;model.traverse(mesh=>{if(mesh.isSkinnedMesh)skeleton=mesh.skeleton});
 const pose=createPassengerWalkPoser(model),bones=skeleton.bones;
 const clips=profiles.map(profile=>{
  const times=[],quats=bones.map(()=>[]),positions=[];
  for(let i=0;i<=48;i++){times.push(i*profile.cycleSeconds/48);pose((i%48)/48,profile);bones.forEach((bone,j)=>quats[j].push(...bone.quaternion.toArray()));positions.push(...bones[0].position.toArray())}
  const tracks=bones.map((bone,j)=>new THREE.QuaternionKeyframeTrack(bone.name+'.quaternion',times,quats[j]));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position',times,positions));
  return new THREE.AnimationClip('Walk_'+profile.name[0].toUpperCase()+profile.name.slice(1),profile.cycleSeconds,tracks);
 });
 skeleton.pose();model.updateMatrixWorld(true);return clips;
}
