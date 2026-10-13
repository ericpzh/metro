import * as THREE from 'three';

// The source arm mask spills onto the trousers beside the hands. The waist
// belongs to Hips; below it, restore the same leg blend as the trouser shell.
export function repairWaistSkinning(body){
 const a=body.geometry.attributes,skeleton=body.skeleton;
 const trouser=new THREE.Color().setRGB(.53,.53,.53,THREE.SRGBColorSpace).r;
 const boneIndex=name=>skeleton.bones.findIndex(b=>b.name===name);
 for(let i=0;i<a.position.count;i++){
  const y=a.position.getY(i);
  if(y>=.825||Math.abs(a.color.getX(i)-trouser)>.001)continue;
  let arm=0;for(let k=0;k<4;k++)if(/arm|hand/i.test(skeleton.bones[a.skinIndex.array[i*4+k]].name))arm+=a.skinWeight.array[i*4+k];
  if(arm===0&&y<.79)continue;
  const side=a.position.getX(i)<0?'Left':'Right';let influences;
  if(y>=.79)influences=[['Hips',1]];
  else if(y>.75){const t=THREE.MathUtils.smoothstep(y,.75,.79);influences=[['Hips',t],[side+'Thigh',1-t]]}
  else if(y>.50)influences=[[side+'Thigh',1]];
  else if(y>.36){const t=THREE.MathUtils.smoothstep(y,.36,.50);influences=[[side+'Thigh',t],[side+'Shin',1-t]]}
  else if(y>.17)influences=[[side+'Shin',1]];
  else {const t=THREE.MathUtils.smoothstep(y,.115,.17);influences=[[side+'Shin',t],[side+'Foot',1-t]]}
  for(let k=0;k<4;k++){a.skinIndex.array[i*4+k]=influences[k]?boneIndex(influences[k][0]):0;a.skinWeight.array[i*4+k]=influences[k]?.[1]??0}
 }
}
