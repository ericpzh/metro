import * as THREE from 'three';

/** Retain the original locks/topology and vary their relief, crown and ends. */
export function maleHairGeometry(source,indices,shape){
 const vertices=[...new Set(indices)],lookup=new Map(vertices.map((v,i)=>[v,i]));
 const geometry=new THREE.BufferGeometry();
 for(const [name,attribute] of Object.entries(source.attributes)){
  const values=new attribute.array.constructor(vertices.length*attribute.itemSize);
  for(const [out,vertex] of vertices.entries())values.set(attribute.array.subarray(vertex*attribute.itemSize,(vertex+1)*attribute.itemSize),out*attribute.itemSize);
  geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize,attribute.normalized));
 }
 geometry.setIndex(indices.map(i=>lookup.get(i)));
 const p=geometry.attributes.position;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),front=THREE.MathUtils.smoothstep(z,.065,.175);
  // Preserve the forehead join. Side/back locks can change below the crown,
  // while the front transition starts above the source's highest skin surface.
  const free=THREE.MathUtils.smoothstep(y,THREE.MathUtils.lerp(1.48,1.59,front),THREE.MathUtils.lerp(1.58,1.65,front));
  const radius=Math.hypot(x/.105,(y-1.56)/.13,(z-.045)/.15),coreScale=Math.min(1,1/radius);
  const relief=1-free*(1-(shape.tuftScale??1));
  const scale=THREE.MathUtils.lerp(coreScale,1,relief);
  let px=x*scale,py=1.56+(y-1.56)*scale,pz=.045+(z-.045)*scale;
  const crown=THREE.MathUtils.smoothstep(y,1.585,1.635);
  py=THREE.MathUtils.lerp(py,1.585+(py-1.585)*(shape.crownScale??1),crown);
  px*=1+((shape.widthScale??1)-1)*free;
  px+=(shape.sweepX??0)*crown;
  pz+=(shape.sweepZ??0)*crown;
  py+=(shape.frontLift??0)*front*crown;
  // A shallow part changes the existing clumps rather than adding a tall cap.
  if(shape.partX!==undefined)py-=(shape.partDepth??.016)*Math.exp(-(((x-shape.partX)/.025)**2))*crown;
  const fringe=front*(1-THREE.MathUtils.smoothstep(y,1.59,1.665));
  py-=(shape.fringeLength??0)*fringe;pz+=(shape.fringeLength??0)*.2*fringe;
  py+=(shape.napeLift??0)*(1-front)*(1-THREE.MathUtils.smoothstep(y,1.49,1.56));
  p.setXYZ(i,px,Math.min(py,shape.maxHeight??1.72),pz);
 }
 geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 return geometry;
}
