import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {measureSoftTorso} from './torso-fit.js';

export const SOFT_BASE_URL='/human-candidates/human-fall-flat/HumanBody_Alt.fbx';

// Rebase the authored skin and joints into metre-sized, Y-up coordinates.
// Identity bind rotations let the existing pose/IK layer work in the rig frame;
// the source weights and silhouette are retained, including shoulder/hip bones.
export function createImportedSoftHuman(data){
 const source=new FBXLoader().parse(data,'');source.updateMatrixWorld(true);
 let mesh;source.traverse(o=>{if(o.isSkinnedMesh)mesh=o});
 if(!mesh)throw Error('The selected soft-human base has no skinned mesh');
 const box=new T.Box3().setFromObject(source),height=box.max.y-box.min.y,scale=1.7/height;
 const center=new T.Vector3((box.min.x+box.max.x)/2,box.min.y,0);
 const normalize=p=>p.sub(center).multiplyScalar(scale);
 const geometry=mesh.geometry.clone(),p=geometry.attributes.position;
 const normals=geometry.attributes.normal,normalMatrix=new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
 const v=new T.Vector3();mesh.skeleton.update();
 for(let i=0;i<p.count;i++){mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld);normalize(v);p.setXYZ(i,v.x,v.y,v.z)}
 for(let i=0;i<normals.count;i++){v.fromBufferAttribute(normals,i).applyNormalMatrix(normalMatrix);normals.setXYZ(i,v.x,v.y,v.z)}
 const material=new T.MeshStandardMaterial({color:0xf2f1ed,roughness:.83});
 const body=new T.SkinnedMesh(geometry,material);body.name='Soft human · selected FBX base';body.castShadow=true;
 const original=mesh.skeleton.bones,bones=original.map(b=>{const n=new T.Bone();n.name=b.name;n.userData.rest=normalize(b.getWorldPosition(new T.Vector3()));return n});
 const byName=Object.fromEntries(bones.map(b=>[b.name,b]));
 const hips=new T.Bone();hips.name='Hips';hips.userData.rest=byName.Waist.userData.rest.clone();body.add(hips);hips.position.copy(hips.userData.rest);
 for(let i=0;i<bones.length;i++){
  const bone=bones[i],parent=byName[original[i].parent?.name]??hips;
  parent.add(bone);bone.position.copy(bone.userData.rest).sub(parent.userData.rest);
 }
 bones.push(hips);body.updateMatrixWorld(true);body.bind(new T.Skeleton(bones));
 const limbs=[-1,1].map(s=>{
  const prefix=s<0?'Right':'Left',arm=byName[prefix+'Arm'],fore=byName[prefix+'Forearm'],leg=byName[prefix+'Thigh'],shin=byName[prefix+'Leg'];
  const wrist=normalize(source.getObjectByName(prefix+'Forearm_end').getWorldPosition(new T.Vector3())).sub(fore.userData.rest);
  const ankle=normalize(source.getObjectByName(prefix+'Leg_end').getWorldPosition(new T.Vector3())).sub(shin.userData.rest);
  return {s,arm,fore,leg,shin,wrist,ankle};
 });
 // Put the source T-pose into a neutral A-pose before rebinding. No new body
 // surface is generated: every vertex is the selected asset with its own weights.
 for(const l of limbs)l.arm.rotation.z=-l.s*.80;
 body.updateMatrixWorld(true);body.skeleton.update();
 const positions=new Float32Array(p.array.length);
 for(let i=0;i<p.count;i++){body.getVertexPosition(i,v);v.toArray(positions,i*3)}
 const skinMatrix=new T.Matrix4(),sum=new T.Vector3(),normal=new T.Vector3(),weights=geometry.attributes.skinWeight,ids=geometry.attributes.skinIndex;
 for(let i=0;i<normals.count;i++){
  normal.fromBufferAttribute(normals,i);sum.set(0,0,0);
  for(let j=0;j<4;j++){const weight=weights.array[i*4+j];if(!weight)continue;skinMatrix.fromArray(body.skeleton.boneMatrices,ids.array[i*4+j]*16);sum.addScaledVector(v.copy(normal).transformDirection(skinMatrix),weight)}
  sum.normalize();normals.setXYZ(i,sum.x,sum.y,sum.z);
 }
 const rests=bones.map(b=>b.getWorldPosition(new T.Vector3()));
 const wrists=limbs.map(l=>l.fore.localToWorld(l.wrist.clone()));
 p.array.set(positions);p.needsUpdate=true;normals.needsUpdate=true;
 for(let i=0;i<bones.length;i++){const b=bones[i];b.userData.rest.copy(rests[i]);b.rotation.set(0,0,0);b.position.copy(rests[i]).sub(b.parent===body?new T.Vector3():rests[bones.indexOf(b.parent)])}
 body.updateMatrixWorld(true);body.bind(new T.Skeleton(bones));
 limbs.forEach((l,i)=>{l.wrist.copy(wrists[i]).sub(l.fore.userData.rest)});
 const chest=byName.Chest,head=byName.Head;
 const anatomy=measureSoftTorso(geometry,head.userData.rest,limbs.map(l=>l.arm.userData.rest));
 anatomy.cuffs=limbs.map(l=>{
  const axis=l.wrist.clone().normalize(),point=l.fore.userData.rest.clone().addScaledVector(axis,l.wrist.length()-.055);
  return {side:l.s,point,axis,field:p=>(p[0]-point.x)*axis.x+(p[1]-point.y)*axis.y+(p[2]-point.z)*axis.z};
 });
 anatomy.sleeves=limbs.map(l=>{
  const axis=l.fore.userData.rest.clone().sub(l.arm.userData.rest).normalize(),point=l.arm.userData.rest.clone().lerp(l.fore.userData.rest,.55);
  return {side:l.s,point,axis,field:p=>(p[0]-point.x)*axis.x+(p[1]-point.y)*axis.y+(p[2]-point.z)*axis.z};
 });
 const shoulder=limbs[1].arm.userData.rest,thigh=limbs[1].leg.userData.rest,knee=limbs[1].shin.userData.rest;
 const reference=[0,.4,.65,.72,.98,1.22,1.38,1.71];
 const actual=[0,knee.y,thigh.y,hips.position.y,chest.userData.rest.y,shoulder.y,head.userData.rest.y,1.7];
 function mapY(y,from=reference,to=actual){let i=0;while(i<from.length-2&&y>from[i+1])i++;return T.MathUtils.mapLinear(y,from[i],from[i+1],to[i],to[i+1])}
 const width=shoulder.x/.18;
 const fitPoint=p=>new T.Vector3(p.x*width,mapY(p.y),p.z*1.2);
 const wardrobePoint=p=>{
  // The authored legs stand farther apart than the old study's legs. Use their
  // own width below the pelvis so outer thighs are not classified as sleeves.
  const lowerWidth=Math.abs(thigh.x)/.11;
  const xScale=Math.abs(p[0])<.4?T.MathUtils.lerp(lowerWidth,width,T.MathUtils.smoothstep(p[1],hips.userData.rest.y,chest.userData.rest.y)):width;
  return [p[0]/xScale,mapY(p[1],actual,reference),p[2]/1.2];
 };
 const cap=new T.Group();cap.name='Soft cap';head.add(cap);
 geometry.computeBoundingBox();
 const headPoints=[];for(let i=0;i<p.count;i++)if(p.getY(i)>1.4)headPoints.push(new T.Vector3().fromBufferAttribute(p,i));
 const headBox=new T.Box3().setFromPoints(headPoints),capRadius=(headBox.max.x-headBox.min.x)/2+.008;
 const crown=new T.Mesh(new T.SphereGeometry(capRadius,40,24,0,Math.PI*2,0,Math.PI*.53),material.clone());
 crown.scale.y=.65;crown.position.set(0,1.7-head.userData.rest.y-capRadius*.45,headBox.getCenter(new T.Vector3()).z-head.userData.rest.z);cap.add(crown);
 const rig=new T.SkeletonHelper(body);rig.visible=false;
 const appearance={age:'adult'};
 function setAge(age){if(!['adult','child'].includes(age))throw Error('Unknown age');appearance.age=age;body.scale.set(age==='child'?.70:1,age==='child'?.65:1,age==='child'?.70:1);head.scale.setScalar(age==='child'?1.08:1);body.updateMatrixWorld(true)}
 function resetPose(){for(const b of bones){b.rotation.set(0,0,0);b.position.copy(b.userData.rest);if(b.parent!==body)b.position.sub(b.parent.userData.rest)}setAge(appearance.age)}
 return {body,hips,chest,head,limbs,cap,rig,bones,appearance,setAge,resetPose,fitPoint,wardrobePoint,anatomy,restArmAngle:0,metrics:{hipHeight:hips.position.y,shoulderHeight:shoulder.y,armLength:limbs[0].fore.position.length()+limbs[0].wrist.length(),thighHeight:thigh.y,kneeHeight:knee.y},source:{path:SOFT_BASE_URL.slice(1),vertices:p.count,bones:original.length}};
}

export async function loadImportedSoftHuman(){
 const response=await fetch(SOFT_BASE_URL);if(!response.ok)throw Error(`Base model load failed (${response.status})`);
 return createImportedSoftHuman(await response.arrayBuffer());
}
