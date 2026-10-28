import * as T from 'three';
import {strapNormal} from './torso-fit.js';

// Construct a closed, constant-width ribbon directly from the authored Bezier
// shoulder/chest curves and elliptical rib wrap. No raycasts, triangle fitting,
// per-edge projections, or per-frame surface corrections participate here.
export function mathematicalStrap(c,path,material,name,{width=.024,thickness=.0025}={}){
 const steps=192,positions=[],indices=[],skinIds=[],skinWeights=[],centers=[];
 const chestIndex=c.bones.indexOf(c.chest);let previousAcross,previousTangent;
 for(let row=0;row<=steps;row++){
  const t=row/steps,point=path.getPointAt(t),tangent=path.getTangentAt(t).normalize(),desired=strapNormal(point);
  let across=new T.Vector3().crossVectors(desired,tangent).normalize();
  if(previousAcross){
   const carried=previousAcross.clone().applyQuaternion(new T.Quaternion().setFromUnitVectors(previousTangent,tangent));
   across=carried.addScaledVector(tangent,-carried.dot(tangent)).normalize();
  }
  const normal=new T.Vector3().crossVectors(tangent,across).normalize();
  previousAcross=across.clone();previousTangent=tangent;centers.push(point.toArray());
  for(const [side,outer] of [[-1,false],[1,false],[1,true],[-1,true]]){
   positions.push(...point.clone().addScaledVector(across,side*width/2).addScaledVector(normal,outer?thickness:0).toArray());
   // The whole belt belongs to the torso, just like the bag. An arm moving
   // through a gesture cannot pull out a section or change its cross-section.
   skinIds.push(chestIndex,0,0,0);skinWeights.push(1,0,0,0);
  }
 }
 for(let row=0;row<steps;row++)for(let k=0;k<4;k++){const a=row*4+k,b=row*4+(k+1)%4;indices.push(a,b,b+4,a,b+4,a+4)}
 indices.push(0,2,1,0,3,2,steps*4,steps*4+1,steps*4+2,steps*4,steps*4+2,steps*4+3);
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIds,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeights,4));geometry.setIndex(indices);geometry.computeVertexNormals();
 const strap=new T.SkinnedMesh(geometry,material);strap.name=name;strap.castShadow=true;c.body.add(strap);strap.bind(c.body.skeleton,c.body.bindMatrix);
 strap.userData={width,thickness,centerline:centers,mathematicalStrap:true};return strap;
}
