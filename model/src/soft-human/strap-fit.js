import * as T from 'three';

// Fit both edges of a closed ribbon to the original bind skin, then copy the
// underlying triangle's skin weights. Chest-only straps cut through a surface
// that also follows Hips, Head and the arms when the pose changes.
export function fittedStrap(c,source,curve,material,name,{width=.036,surfaceWidth=false,project=null,clearance=.009,thickness=.007}={}){
 const rest=new T.Mesh(source,new T.MeshBasicMaterial({side:T.DoubleSide}));rest.updateMatrixWorld(true);
 const ray=new T.Raycaster(),bary=new T.Vector3();
 const p=source.attributes.position,n=source.attributes.normal,ids=source.attributes.skinIndex,weights=source.attributes.skinWeight;
 const a=new T.Vector3(),b=new T.Vector3(),d=new T.Vector3();
 const positions=[],normals=[],skinIds=[],skinWeights=[],faces=[],anchors=[];const steps=project?128:72;
 for(let i=0;i<=steps;i++){
  const local=project?curve.getPointAt(i/steps):curve.getPoint(i/steps),centerHit=project?.(local);
  const radial=new T.Vector3(local.x,0,local.z).normalize();
  const across=surfaceWidth?new T.Vector3().crossVectors(centerHit?.normal??radial,project?curve.getTangentAt(i/steps):curve.getTangent(i/steps)).normalize():new T.Vector3(1,0,0);
  for(const [edge,outer] of [[-1,false],[1,false],[1,true],[-1,true]]){
   let aim=(centerHit?.point??local).clone().addScaledVector(across,edge*width/2);if(!project)aim.y+=.98;
   let center=new T.Vector3(0,T.MathUtils.clamp(aim.y,.75,1.13),0);
   if(c.fitPoint&&!project){aim=c.fitPoint(aim);center=c.fitPoint(center)}
   const direction=aim.clone().sub(center).normalize();
   ray.set(center.clone().addScaledVector(direction,1.5),direction.clone().negate());
   const hit=project?project(aim):ray.intersectObject(rest,false).find(h=>{const [x,y]=c.wardrobePoint?c.wardrobePoint(h.point.toArray()):h.point.toArray();return Math.abs(x)<.265&&y>.70&&y<1.36});
   if(!hit)throw Error('Unable to fit backpack strap to torso');
   const tri=[hit.face.a,hit.face.b,hit.face.c];
   a.fromBufferAttribute(p,tri[0]);b.fromBufferAttribute(p,tri[1]);d.fromBufferAttribute(p,tri[2]);T.Triangle.getBarycoord(hit.point,a,b,d,bary);
   const factors=bary.toArray(),normal=new T.Vector3();const blend=new Map();
   tri.forEach((v,j)=>{normal.addScaledVector(new T.Vector3().fromBufferAttribute(n,v),factors[j]);for(let k=0;k<4;k++){const id=ids.array[v*4+k];blend.set(id,(blend.get(id)||0)+weights.array[v*4+k]*factors[j])}});
   normal.normalize();const point=hit.point.clone().addScaledVector(normal,clearance+(outer?thickness:0));
   const ranked=[...blend].sort((a,b)=>b[1]-a[1]).slice(0,4),total=ranked.reduce((s,x)=>s+x[1],0);
   while(ranked.length<4)ranked.push([0,0]);
   positions.push(...point.toArray());normals.push(...normal.toArray());skinIds.push(...ranked.map(x=>x[0]));skinWeights.push(...ranked.map(x=>x[1]/total));anchors.push({triangle:tri,barycentric:factors});
  }
 }
 for(let i=0;i<steps;i++)for(let k=0;k<4;k++){const a=i*4+k,b=i*4+(k+1)%4;faces.push(a,b,b+4,a,b+4,a+4)}
 faces.push(0,2,1,0,3,2,steps*4,steps*4+1,steps*4+2,steps*4,steps*4+2,steps*4+3);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIds,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeights,4));g.setIndex(faces);g.computeVertexNormals();
 const strap=new T.SkinnedMesh(g,material);strap.name=name;strap.castShadow=true;c.body.add(strap);strap.bind(c.body.skeleton,c.body.bindMatrix);strap.userData.surfaceAnchors=anchors;
 strap.userData.width=width;strap.userData.clearance=clearance;strap.userData.thickness=thickness;
 const surface=new T.SkinnedMesh(source);surface.bind(c.body.skeleton,c.body.bindMatrix);
 const transform=new T.Matrix4(),normal=new T.Vector3(),faceNormal=new T.Vector3(),target=new T.Vector3();
 // A barycentric point and its interpolated bone weights do not deform exactly
 // like the triangle under it. Correct that small LBS error from the actual
 // posed triangle, without raycasting or changing the skeleton. Inverse skinning
 // also leaves the downloaded current-pose GLB aligned with the visible jacket.
 strap.updateSurface=()=>{
  surface.bindMatrixInverse.copy(c.body.bindMatrixInverse);
  const matrices=c.body.skeleton.boneMatrices,cache=new Map();
  for(let i=0;i<anchors.length;i++){
   const {triangle,barycentric}=anchors[i],key=triangle.join(',');let posed=cache.get(key);
   if(!posed){posed=triangle.map(v=>surface.getVertexPosition(v,new T.Vector3()));posed.normals=triangle.map((v,j)=>{const end=new T.Vector3().fromBufferAttribute(p,v).add(new T.Vector3().fromBufferAttribute(n,v));return surface.applyBoneTransform(v,end).sub(posed[j]).normalize()});cache.set(key,posed)}
   const [a,b,d]=posed;
   faceNormal.copy(b).sub(a).cross(d.clone().sub(a)).normalize();
   normal.set(0,0,0);posed.normals.forEach((v,j)=>normal.addScaledVector(v,barycentric[j]));normal.normalize();
   if(normal.dot(faceNormal)<.5)normal.copy(faceNormal);
   target.set(0,0,0);posed.forEach((v,j)=>target.addScaledVector(v,barycentric[j]));target.addScaledVector(normal,(clearance+(i%4<2?0:thickness))/normal.dot(faceNormal));
   transform.elements.fill(0);
   for(let j=0;j<4;j++){const offset=g.attributes.skinIndex.array[i*4+j]*16,weight=g.attributes.skinWeight.array[i*4+j];for(let k=0;k<16;k++)transform.elements[k]+=matrices[offset+k]*weight}
   transform.premultiply(strap.bindMatrixInverse).multiply(strap.bindMatrix).invert();target.applyMatrix4(transform);g.attributes.position.setXYZ(i,target.x,target.y,target.z);
  }
  g.attributes.position.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();
 };
 rest.material.dispose();return strap;
}
