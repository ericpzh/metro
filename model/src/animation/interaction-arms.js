import * as THREE from 'three';

// The reconstructed coat joins the torso to the forearm along a narrow strip.
// Large reaches stretch that strip into a web. Keep the reviewed source intact
// for walking/export and use closed, simple sleeves and empty mitten hands for
// activity studies. The torso lining remains in place behind the sleeve joint.
export function createInteractionArms(model){
 const bodies=[],overlays=[];let body;
 model.traverse(mesh=>{if(mesh.isSkinnedMesh&&mesh.userData.coatInterior&&(!body||mesh.geometry.attributes.position.count>body.geometry.attributes.position.count))body=mesh});
 if(body){
  const original=body.geometry,a=original.attributes,skeleton=body.skeleton;
  const armBones=new Set(skeleton.bones.flatMap((b,i)=>/Arm|Forearm|Hand/.test(b.name)?[i]:[]));
  const isArm=i=>{let w=0;for(let k=0;k<4;k++)if(armBones.has(a.skinIndex.array[i*4+k]))w+=a.skinWeight.array[i*4+k];return w>.08};
  const keep=[];const ix=original.index.array;
  for(let i=0;i<ix.length;i+=3)if(!isArm(ix[i])&&!isArm(ix[i+1])&&!isArm(ix[i+2]))keep.push(ix[i],ix[i+1],ix[i+2]);
  const torso=original.clone();torso.setIndex(keep);bodies.push({body,original,torso});
  function dominantColor(low,high,fallback){
   const colors=new Map();for(let i=0;i<a.position.count;i++)if(Math.abs(a.position.getX(i))>.24&&a.position.getY(i)>low&&a.position.getY(i)<high&&isArm(i)){
    const key=[a.color.getX(i),a.color.getY(i),a.color.getZ(i)].join(',');colors.set(key,(colors.get(key)??0)+1);
   }
   const key=[...colors].sort((a,b)=>b[1]-a[1])[0]?.[0];return key?new THREE.Color().fromArray(key.split(',').map(Number)):new THREE.Color(fallback);
  }
  const sleeveColor=dominantColor(1.05,1.22,0xbcbcbc),skinColor=dominantColor(.69,.77,0xd4d4d4);
  for(const side of ['Left','Right']){
   const sign=side==='Right'?1:-1,bone=name=>skeleton.bones.findIndex(b=>b.name===side+name);
   const positions=[],indices=[],joints=[],weights=[],colors=[];
   const vertex=(p,influences,color)=>{positions.push(...p);colors.push(color.r,color.g,color.b);for(let k=0;k<4;k++){joints.push(influences[k]?.[0]??0);weights.push(influences[k]?.[1]??0)}};
   const rows=32,segments=20;
   for(let row=0;row<=rows;row++){
    const t=row/rows,y=THREE.MathUtils.lerp(1.315,.823,t),x=sign*THREE.MathUtils.lerp(.195,.24,THREE.MathUtils.smoothstep(t,0,.65));
    const radius=THREE.MathUtils.lerp(.077,.034,t),fore=1-THREE.MathUtils.smoothstep(y,.98,1.08);
    const influences=[[bone('Arm'),1-fore],[bone('Forearm'),fore]];
    // Rounded closed shoulder and turned-in cuff, with continuous elbow weights.
    const cap=row===0?.03:row===rows?.85:1;
    for(let j=0;j<=segments;j++){const angle=j/segments*Math.PI*2;vertex([x+radius*Math.cos(angle)*cap,y,.03+radius*.88*Math.sin(angle)*cap],influences,sleeveColor);}
   }
   for(let row=0;row<rows;row++)for(let j=0;j<segments;j++){const a=row*(segments+1)+j,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1)}
   for(const row of [0,rows]){const center=positions.length/3,y=row===0?1.315:.823,x=row===0?sign*.195:sign*.24;vertex([x,y,.03],[[bone(row===0?'Arm':'Forearm'),1]],sleeveColor);for(let j=0;j<segments;j++){const a=row*(segments+1)+j;if(row===0)indices.push(center,a+1,a);else indices.push(center,a,a+1)}}
   function ellipsoid(center,size){
    const shape=new THREE.SphereGeometry(1,16,12),start=positions.length/3,p=shape.attributes.position;
    for(let i=0;i<p.count;i++)vertex([center[0]+p.getX(i)*size[0],center[1]+p.getY(i)*size[1],center[2]+p.getZ(i)*size[2]],[[bone('Hand'),1]],skinColor);
    for(const i of shape.index.array)indices.push(start+i);shape.dispose();
   }
   ellipsoid([sign*.24,.752,.034],[.043,.076,.031]);
   ellipsoid([sign*.21,.758,.052],[.023,.037,.023]);
   // Recess the wrist into the cuff so the joint has a solid overlap.
   ellipsoid([sign*.24,.800,.03],[.026,.045,.024]);
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));geometry.setIndex(indices);geometry.computeVertexNormals();
   const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));mesh.name=side+' clean activity sleeve and hand';mesh.userData.interactionArm=true;mesh.frustumCulled=false;model.add(mesh);mesh.bind(skeleton,body.bindMatrix);mesh.visible=false;overlays.push(mesh);
  }
 }
 return {setEnabled(enabled){for(const {body,original,torso} of bodies)body.geometry=enabled?torso:original;for(const mesh of overlays)mesh.visible=enabled},dispose(){this.setEnabled(false);for(const {torso} of bodies)torso.dispose();for(const mesh of overlays){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose()}}};
}
