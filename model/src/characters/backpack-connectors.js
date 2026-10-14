import * as THREE from 'three';

// Continuous, closed straps run from the pack over each shoulder and return
// beneath the arms. All sections stay on the torso; sleeves move over them.
export function addBackpackConnectors(model,body,{small=false,coatGrey=.66,packScale=1}={}){
 const positions=[],indices=[],skinIndices=[],skinWeights=[],segments=160;
 const source=body.geometry.attributes,coat=new THREE.Color().setRGB(coatGrey,coatGrey,coatGrey,THREE.SRGBColorSpace).r,skin=new THREE.Color().setRGB(.78,.78,.78,THREE.SRGBColorSpace).r;
 const spine=body.skeleton.bones.findIndex(b=>b.name==='Spine');
 const armInfluence=i=>{
  let sum=0;for(let j=0;j<4;j++)if(/arm|hand/i.test(body.skeleton.bones[source.skinIndex.array[i*4+j]].name))sum+=source.skinWeight.array[i*4+j];
  return sum;
 };
 // Fit static front coat layers to the same continuous chest profile. Moving
 // sleeves retain their geometry and naturally cover the return beneath them.
 for(let i=0;i<source.position.count;i++){
  const p=source.position,x=p.getX(i),y=p.getY(i);
  if(Math.abs(source.color.getX(i)-coat)>.001||y<.94||y>1.39||Math.abs(x)>.235||armInfluence(i)>.005)continue;
  if(p.getZ(i)>.055&&Math.abs(x)>.11){
   const front=.190-.045*THREE.MathUtils.smoothstep(y,1.10,1.28)-.040*THREE.MathUtils.smoothstep(y,1.28,1.405)-.020*(x/.20)**2;
   p.setZ(i,Math.min(p.getZ(i),front-.001));
  }
 }
 // Include the closed torso under moving sleeves: these were the areas where
 // a strap fitted only to the reconstructed outer shell still floated.
 const coatIndices=[];
 for(let k=0;k<body.geometry.index.count;k+=3){
  const ids=[0,1,2].map(j=>body.geometry.index.getX(k+j));
  if(ids.some(i=>Math.abs(source.color.getX(i)-coat)>.001&&Math.abs(source.color.getX(i)-skin)>.001))continue;
  // A coat-coloured sleeve is not a strap support surface. Fitting to those
  // triangles placed disconnected tabs on the swinging arms.
  if(ids.some(i=>armInfluence(i)>.005))continue;
  if(ids.some(i=>source.position.getY(i)>.90&&source.position.getY(i)<1.41&&Math.abs(source.position.getX(i))<.26))coatIndices.push(...ids);
 }
 const surfaceGeometry=new THREE.BufferGeometry();surfaceGeometry.setAttribute('position',source.position);surfaceGeometry.setIndex(coatIndices);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),surface=new THREE.Group(),ray=new THREE.Raycaster();
 surface.add(new THREE.Mesh(surfaceGeometry,material));
 // The small pack exposes the coat backing that the standard pack covers.
 // Fit the rear returns to that backing too, so it cannot cut the ribbon into tabs.
 if(small||packScale<1)surface.add(new THREE.Mesh(model.getObjectByName('Jacket back fill').geometry,material));
 function contact(point,outward){
  ray.set(point.clone().addScaledVector(outward,.22),outward.clone().negate());
  const hit=ray.intersectObject(surface,true)[0];
  if(!hit||hit.point.distanceTo(point)>.10)return {point,weights:[[spine,1]]};
  return {point:hit.point.clone(),weights:[[spine,1]]};
 }
 function ribbon(points,width){
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),base=positions.length/3,sections=[];
  for(let i=0;i<=segments;i++){
   const center=curve.getPoint(i/segments),tangent=curve.getTangent(i/segments);
   // The ribbon lies against the torso. Its width turns smoothly from across
   // the chest to vertical beneath the arm, without a twisted joining tab.
   const outward=new THREE.Vector3(center.x/.205,THREE.MathUtils.smoothstep(center.y,1.29,1.335),(center.z-.035)/.135).normalize();
   outward.lerp(new THREE.Vector3(0,0,1),THREE.MathUtils.smoothstep(center.z,.095,.15)).normalize();
   if(center.y>1.20)outward.lerp(new THREE.Vector3(0,0,-1),THREE.MathUtils.smoothstep(-center.z,0,.035)).normalize();
   // At the shoulder crown fit downward onto the garment. Radial side rays
   // lifted the ribbon edges into two little peaks in front/back elevation.
   const shoulder=THREE.MathUtils.smoothstep(center.y,1.28,1.34);
   outward.lerp(new THREE.Vector3(0,1,0),shoulder).normalize();
   const side=new THREE.Vector3().crossVectors(outward,tangent).normalize();
   const bridge=center.z<-.13,fitWeight=bridge?0:1;
   // Five samples across the width preserve the coat's curvature. A flat
   // rectangle either floated at its centre or intersected the coat there.
   const samples=[-1,-.5,0,.5,1].map(s=>{
    const localWidth=THREE.MathUtils.lerp(.016,width,THREE.MathUtils.smoothstep(center.y,1.00,1.08));
    const point=center.clone().addScaledVector(side,s*localWidth/2),hit=bridge?{point}:contact(point,outward);
    const clearance=.002-.0005*shoulder;
    const contactOffset=bridge?0:(hit.point.clone().sub(point).dot(outward)+clearance)*fitWeight;
    // Rear sections already clear of the coat form the bridge into the pack.
    // Fade inward fitting before that bridge, avoiding a sharp kink at its rim.
    const offset=contactOffset<0?contactOffset*(1-THREE.MathUtils.smoothstep(-center.z,.075,.11)):contactOffset;
    return {point,weights:hit.weights??[[spine,1]],offset,required:offset};
   });
   sections.push({outward,samples,bridge,shoulderFit:THREE.MathUtils.smoothstep(center.y,1.25,1.32),constrained:center.z<.095||center.y>1.28||center.y<1.06});
  }
  // Smooth the fitted contour while retaining its clearance over the coat.
  for(let pass=0;pass<240;pass++){
   const next=sections.map((section,i)=>section.samples.map((sample,j)=>{
    if(section.bridge||(!section.constrained&&pass>=80))return sample.offset;
    const average=(sections[Math.max(0,i-1)].samples[j].offset+2*sample.offset+sections[Math.min(segments,i+1)].samples[j].offset)/4;
    // Smooth the upper envelope without sinking any edge into the garment.
    return section.constrained?Math.max(sample.required,average):average;
   }));
   sections.forEach((section,i)=>section.samples.forEach((sample,j)=>sample.offset=next[i][j]));
  }
  // Remove triangle-scale ripples from contact rays at the shoulder without
  // borrowing the raised envelope used for the long lower return.
  sections.forEach(section=>section.samples.forEach(sample=>sample.shoulderOffset=sample.required));
  for(let pass=0;pass<64;pass++){
   const next=sections.map((section,i)=>section.samples.map((sample,j)=>Math.max(sample.required,(sections[Math.max(0,i-1)].samples[j].shoulderOffset+2*sample.shoulderOffset+sections[Math.min(segments,i+1)].samples[j].shoulderOffset)/4)));
   sections.forEach((section,i)=>section.samples.forEach((sample,j)=>sample.shoulderOffset=next[i][j]));
  }
  for(const fit of sections){
   for(const [id,n] of [[0,-1],[1,-1],[2,-1],[3,-1],[4,-1],[4,1],[3,1],[2,1],[1,1],[0,1]]){
    const sample=fit.samples[id],total=sample.weights.reduce((sum,[,w])=>sum+w,0);
    // Follow the actual shoulder contact instead of lifting it to the lower
    // return's smoothing envelope, which left raised corners and a side slit.
    const offset=THREE.MathUtils.lerp(sample.offset,Math.max(sample.required,sample.shoulderOffset),fit.shoulderFit);
    positions.push(...sample.point.clone().addScaledVector(fit.outward,offset+n*.0005).toArray());
    for(let j=0;j<4;j++){skinIndices.push(sample.weights[j]?.[0]??0);skinWeights.push((sample.weights[j]?.[1]??0)/total)}
   }
  }
  for(let i=0;i<segments;i++)for(let j=0;j<10;j++){const a=base+i*10+j,b=base+i*10+(j+1)%10,c=a+10,d=b+10;indices.push(a,b,c,b,d,c)}
  const end=base+segments*10;
  for(let j=1;j<9;j++){indices.push(base,base+j+1,base+j);indices.push(end,end+j,end+j+1)}
 }
 for(const sign of [-1,1]){
  // One curve per side, including the lower turn: no separate butt joint or
  // disconnected painted return between the shoulder and pack attachment.
  // Begin the sweep higher on the chest and descend throughout the return.
  // This gives the lower webbing a broad diagonal arc instead of a flat foot.
  const lowerY=.930+(1-packScale)*.12,upperY=1.220-(1-packScale)*.12;
  ribbon([[sign*(small?.095:.110*packScale),lowerY,-.140],[sign*.125,lowerY-.005,-.115],[sign*.153,lowerY-.005,-.082],[sign*.205,lowerY,-.045],[sign*.215,lowerY+.008,.025],[sign*.196,1.006,.100],[sign*.166,1.051,.160],[sign*.143,1.097,.183],[sign*.130,1.145,.176],[sign*.120,1.25,.149],[sign*.115,1.32,.113],[sign*.110,1.350,.045],[sign*.095,1.335,-.047],[sign*.090,1.290,-.063],[sign*(small?.075:.100*packScale),upperY+.025,-.105],[sign*(small?.065:.110*packScale),upperY,small?-.120:-.140]],.028);
 }
 const geometry=new THREE.BufferGeometry(),count=positions.length/3;
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 const color=new THREE.Color().setRGB(.47,.47,.47,THREE.SRGBColorSpace).r;
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(count*3).fill(color),3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeights,4));
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,side:THREE.DoubleSide}));
 mesh.name='Backpack_strap_connectors';mesh.bind(body.skeleton,body.bindMatrix);model.add(mesh);
 body.geometry.computeVertexNormals();body.geometry.computeBoundingBox();body.geometry.computeBoundingSphere();
 surfaceGeometry.dispose();material.dispose();
 return mesh;
}
