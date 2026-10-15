import * as THREE from 'three';

// Fit the closed skirt around actual skinned leg vertices in the pelvis frame.
// Morph targets make this clearance part of the GLB, rather than a viewer-only
// displacement. The original skeleton and walking clips keep their foot motion.
export function addSkirtMotion(model,body,skirt,legVertices,animations){
 if(!animations?.length)throw new Error('Skirt motion requires the walking clips');
 const geometry=skirt.geometry,{segments,rows,hem,waist,flare,pleat}=geometry.userData.skirt;
 const skeleton=body.skeleton,hips=skeleton.bones.findIndex(b=>b.name==='Hips');
 const point=new THREE.Vector3(),hipInverse=new THREE.Matrix4();
 const base=geometry.attributes.position,step=(waist-hem)/rows,clearance=.022;
 function fit(){
  model.updateMatrixWorld(true);skeleton.update();
  hipInverse.copy(body.bindMatrixInverse).multiply(skeleton.bones[hips].matrixWorld).multiply(skeleton.boneInverses[hips]).multiply(body.bindMatrix).invert();
  const widths=[],front=[],back=[];
  for(let row=0;row<=rows;row++){
   const t=row/rows,f=(1-t)**.8,fold=pleat*(1-THREE.MathUtils.smoothstep(t,.65,.95));
   widths.push(.202+flare*f);front.push(.127+.10*f);back.push(.127+.10*f);
  }
  const points=[];
  for(const i of legVertices){
   point.fromBufferAttribute(body.geometry.attributes.position,i);body.applyBoneTransform(i,point);point.applyMatrix4(hipInverse);
   if(point.y<hem-step*1.5||point.y>waist+step)continue;
   const row=(point.y-hem)/step;
   points.push([point.x,point.y,point.z]);
   for(let r=Math.max(0,Math.floor(row)-1);r<=Math.min(rows,Math.ceil(row)+1);r++)widths[r]=Math.max(widths[r],(Math.abs(point.x)+clearance)/.88+pleat);
  }
  for(const [x,y,z] of points){
   const row=(y-hem)/step;
   for(let r=Math.max(0,Math.floor(row)-1);r<=Math.min(rows,Math.ceil(row)+1);r++){
    const radius=Math.sqrt(Math.max(.1,1-(x/(widths[r]-pleat))**2));
    const depth=(Math.abs(z-.035)+clearance)/radius+pleat;
    if(z>=.035)front[r]=Math.max(front[r],depth);else back[r]=Math.max(back[r],depth);
   }
  }
  // Relax outward only: smoothing can never undo the measured clearance.
  for(const values of [widths,front,back])for(let pass=0;pass<3;pass++){
   const copy=values.slice();for(let r=1;r<rows;r++)values[r]=Math.max(copy[r],(copy[r-1]+2*copy[r]+copy[r+1])/4);
  }
  const positions=new Float32Array(base.array.length);
  for(let shell=0;shell<2;shell++)for(let row=0;row<=rows;row++)for(let j=0;j<=segments;j++){
   const t=row/rows,phi=j/segments*Math.PI*2,sine=Math.sin(phi),cosine=Math.cos(phi),fold=pleat*Math.cos(phi*16)*(1-THREE.MathUtils.smoothstep(t,.65,.95));
   const i=(shell*(rows+1)*(segments+1)+row*(segments+1)+j)*3,inset=shell?.985:1;
   positions[i]=(widths[row]+fold)*sine*inset;positions[i+1]=hem+step*row;positions[i+2]=.035+((cosine>=0?front[row]:back[row])+fold)*cosine*inset;
  }
  return positions;
 }
 skeleton.pose();model.updateMatrixWorld(true);base.array.set(fit());base.needsUpdate=true;
 const targetCount=animations.length*24;
 geometry.morphAttributes.position=[];geometry.morphTargetsRelative=true;
 const mixer=new THREE.AnimationMixer(model);
 for(let profile=0;profile<animations.length;profile++){
  const clip=animations[profile],action=mixer.clipAction(clip);action.play();
  const times=[],values=[];
  for(let frame=0;frame<24;frame++){
   mixer.setTime(frame*clip.duration/24);
   const positions=fit();for(let i=0;i<positions.length;i++)positions[i]-=base.array[i];
   const attribute=new THREE.Float32BufferAttribute(positions,3);attribute.name=`${clip.name}-${frame}`;geometry.morphAttributes.position.push(attribute);
  }
  mixer.stopAllAction();
  for(let frame=0;frame<=24;frame++){
   times.push(frame*clip.duration/24);
   const active=profile*24+frame%24;for(let k=0;k<targetCount;k++)values.push(k===active?1:0);
  }
  // Append after sampling so the source mixer never sees a partial morph set.
  clip.userData??={};clip.userData.skirtTrack=new THREE.NumberKeyframeTrack(`${skirt.name}.morphTargetInfluences`,times,values);
 }
 mixer.uncacheRoot(model);
 for(const clip of animations){clip.tracks.push(clip.userData.skirtTrack);delete clip.userData.skirtTrack}
 skirt.updateMorphTargets();skirt.morphTargetInfluences.fill(0);
 skeleton.pose();model.updateMatrixWorld(true);skeleton.update();
 geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 skirt.userData.skirtMotion={framesPerCycle:24,clearance,exported:true};
}
