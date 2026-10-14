import * as THREE from 'three';
import {applyPassengerCarryPose} from '../animation/carry-pose.js';

// Closed, flat-grey accessories authored in the character's bind pose.
// Left/right always refer to the wearer's side. Crossbody straps use the
// opposite shoulder; purses follow the hand, side bags rest against the torso.
export function addCarriedBags(model,body){
 const variants=new Map(),skeleton=body.skeleton,source=body.geometry.attributes,surfaceIndices=[];
 const armWeight=i=>{let total=0;for(let k=0;k<4;k++)if(/arm|hand/i.test(skeleton.bones[source.skinIndex.array[i*4+k]].name))total+=source.skinWeight.array[i*4+k];return total};
 for(let i=0;i<body.geometry.index.count;i+=3){
  const ids=[0,1,2].map(k=>body.geometry.index.getX(i+k));
  // The medial shoulder rim has small arm influences in the reconstruction.
  // Include that rim while excluding the sleeves that can occlude torso rays.
  const torso=ids.every(v=>armWeight(v)<.005)||ids.every(v=>source.position.getY(v)>1.24&&Math.abs(source.position.getX(v))<.17);
  if(torso&&ids.some(v=>source.position.getY(v)>.94&&source.position.getY(v)<1.41&&Math.abs(source.position.getX(v))<.27))surfaceIndices.push(...ids);
 }
 const surfaceGeometry=new THREE.BufferGeometry();surfaceGeometry.setAttribute('position',source.position);surfaceGeometry.setIndex(surfaceIndices);
 const surfaceMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),surface=new THREE.Group(),ray=new THREE.Raycaster();surface.add(new THREE.Mesh(surfaceGeometry,surfaceMaterial));
 const backing=model.getObjectByName('Jacket back fill');if(backing)surface.add(new THREE.Mesh(backing.geometry,surfaceMaterial));surface.updateMatrixWorld(true);
 const shoulderGeometry=body.geometry.clone(),shoulderSurface=new THREE.Mesh(shoulderGeometry,surfaceMaterial);shoulderSurface.updateMatrixWorld(true);
 function contact(point,outward){
  ray.set(point.clone().addScaledVector(outward,.22),outward.clone().negate());const hit=ray.intersectObject(surface,true)[0];
  // Always return a separate point: fitting computes a displacement from the
  // input. Aliasing a missed ray would subtract the input from itself and move
  // an unsupported bag anchor to the origin, leaving long dangling triangles.
  const supported=Boolean(hit&&hit.point.distanceTo(point)<.10);
  return {point:supported?hit.point.clone().addScaledVector(outward,.0035):point.clone(),supported};
 }
 const bone=name=>skeleton.bones.findIndex(b=>b.name===name);
 function panel(width,height,depth,radius,center,turn=0){
  const x=-width/2,y=-height/2,s=new THREE.Shape();
  s.moveTo(x+radius,y);s.lineTo(-x-radius,y);s.quadraticCurveTo(-x,y,-x,y+radius);
  s.lineTo(-x,-y-radius);s.quadraticCurveTo(-x,-y,-x-radius,-y);s.lineTo(x+radius,-y);
  s.quadraticCurveTo(x,-y,x,-y-radius);s.lineTo(x,y+radius);s.quadraticCurveTo(x,y,x+radius,y);
  const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSize:.004,bevelThickness:.003,bevelSegments:2,curveSegments:5,steps:1});
  g.translate(0,0,-depth/2);g.rotateY(turn);g.translate(...center);return g;
 }
 function ribbon(points,width,normal,fit=false,shoulder=false){
  if(fit)return fittedRibbon(points,width,normal);
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),positions=[],indices=[],rows=80,sections=[];
  for(let i=0;i<=rows;i++){
   const center=curve.getPoint(i/rows),tangent=curve.getTangent(i/rows),outward=normal(center),across=new THREE.Vector3().crossVectors(outward,tangent).normalize();
   const edges=[-1,1].map(a=>{
    const point=center.clone().addScaledVector(across,a*width/2);
    if(shoulder&&point.y>1.235){
     ray.set(new THREE.Vector3(point.x,1.6,point.z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(shoulderSurface,false)[0];
     if(hit&&hit.point.y>1.20)point.y=Math.max(point.y,hit.point.y+.002);
    }
    return point;
   });
   sections.push({edges,outward});
  }
  // Blend surface samples along the ribbon so source triangle boundaries do
  // not leave abrupt steps in either edge of the diagonal strap.
  const required=sections.map(s=>s.edges.map(p=>p.clone()));
  if(shoulder)for(let pass=0;pass<160;pass++){
   const previous=sections.map(s=>s.edges.map(p=>p.clone()));
   for(let i=1;i<rows;i++)for(let edge=0;edge<2;edge++){
    const point=sections[i].edges[edge].copy(previous[i][edge]).multiplyScalar(.5).addScaledVector(previous[i-1][edge],.25).addScaledVector(previous[i+1][edge],.25);
    const axis=shoulder?new THREE.Vector3(0,1,0):sections[i].outward;
    point.addScaledVector(axis,Math.max(0,required[i][edge].clone().sub(point).dot(axis)));
   }
  }
  for(const {edges,outward} of sections){
   for(const [a,b] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
    const point=edges[a<0?0:1].clone();
    positions.push(...point.addScaledVector(outward,b*.001).toArray());
   }
  }
  for(let i=0;i<rows;i++)for(let j=0;j<4;j++){const a=i*4+j,b=i*4+(j+1)%4;indices.push(a,b,a+4,b,b+4,a+4)}
  indices.push(0,2,1,0,3,2,rows*4,rows*4+1,rows*4+2,rows*4,rows*4+2,rows*4+3);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
 }
 function fittedRibbon(points,width,normal){
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),rows=80,sections=[],positions=[],indices=[];
  for(let i=0;i<=rows;i++){
   const center=curve.getPoint(i/rows),outward=normal(center),across=new THREE.Vector3().crossVectors(outward,curve.getTangent(i/rows)).normalize();
   // Fit the centre as well as the edges. A flat strip between two fitted
   // edges can still disappear inside the rounded shoulder and neckline.
   const samples=[-1,-.5,0,.5,1].map(s=>{
    const point=center.clone().addScaledVector(across,s*width/2),fit=contact(point,outward),offset=fit.point.sub(point).dot(outward);
    return {point,offset,required:offset,supported:fit.supported};
   });
   sections.push({outward,samples});
  }
  // The crown crosses the edge of the neckline, where a few fitting rays have
  // no surface beneath them. Bridge those samples from nearby shoulder contact
  // instead of forcing a zero offset that leaves raised corners in the ribbon.
  sections.forEach((section,i)=>section.samples.forEach((s,j)=>{
   if(s.supported||section.outward.y<=.15)return;
   let sum=0,weight=0;
   for(let row=Math.max(0,i-5);row<=Math.min(rows,i+5);row++)for(let column=0;column<5;column++){
    const neighbor=sections[row],sample=neighbor.samples[column];if(!sample.supported||neighbor.outward.dot(section.outward)<.7)continue;
    const w=1/(1+(row-i)**2+(column-j)**2);sum+=sample.required*w;weight+=w;
   }
   if(weight){s.offset=sum/weight;s.required=-Infinity}
  }));
  // Smooth only the outward displacement, retaining every surface sample's
  // clearance. Averaging positions themselves can sink the strip into the coat.
  for(let pass=0;pass<240;pass++){
   const next=sections.map((section,i)=>section.samples.map((s,j)=>{
    const average=(sections[Math.max(0,i-1)].samples[j].offset+2*s.offset+sections[Math.min(rows,i+1)].samples[j].offset)/4;
    // Keep the crown resting on the shoulder instead of borrowing the larger
    // outward offsets needed to clear the vertical neckline on either side.
    const crown=THREE.MathUtils.smoothstep(section.outward.y,.15,.7);
    const ceiling=s.supported&&crown>0?s.required+.003/crown:Infinity;
    return Math.min(ceiling,Math.max(s.required,average));
   }));
   sections.forEach((section,i)=>section.samples.forEach((s,j)=>s.offset=next[i][j]));
  }
  for(const {outward,samples} of sections)for(const [j,thickness] of [[0,-1],[1,-1],[2,-1],[3,-1],[4,-1],[4,1],[3,1],[2,1],[1,1],[0,1]])positions.push(...samples[j].point.clone().addScaledVector(outward,samples[j].offset+thickness*.001).toArray());
  for(let i=0;i<rows;i++)for(let j=0;j<10;j++){const a=i*10+j,b=i*10+(j+1)%10;indices.push(a,b,a+10,b,b+10,a+10)}
  for(let j=1;j<9;j++)indices.push(0,j+1,j,rows*10,rows*10+j,rows*10+j+1);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
 }
 for(const type of ['shoulder','crossbody','purse'])for(const side of ['left','right']){
  const sign=side==='left'?-1:1,arm=bone(side==='left'?'LeftArm':'RightArm'),hand=bone(side==='left'?'LeftHand':'RightHand'),spine=bone('Spine'),meshes=[];
  function add(geometry,component,grey,joint,blend){
   const count=geometry.attributes.position.count,indices=new Uint16Array(count*4),weights=new Float32Array(count*4),color=new THREE.Color().setRGB(grey,grey,grey,THREE.SRGBColorSpace).r;
   for(let i=0;i<count;i++){
    const armPart=blend?THREE.MathUtils.smoothstep(geometry.attributes.position.getY(i),1.22,1.29):0;
    indices[i*4]=joint;weights[i*4]=1-armPart;indices[i*4+1]=arm;weights[i*4+1]=armPart;
    if(blend){
     const armMatrix=new THREE.Matrix4().multiplyMatrices(skeleton.bones[arm].matrixWorld,skeleton.boneInverses[arm]);
     const spineMatrix=new THREE.Matrix4().multiplyMatrices(skeleton.bones[spine].matrixWorld,skeleton.boneInverses[spine]);
     const transform=new THREE.Matrix4();for(let k=0;k<16;k++)transform.elements[k]=spineMatrix.elements[k]*(1-armPart)+armMatrix.elements[k]*armPart;
     transform.premultiply(body.bindMatrixInverse).multiply(body.bindMatrix).invert();
     const point=new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(transform);geometry.attributes.position.setXYZ(i,point.x,point.y,point.z);
    }
   }
   geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(count*3).fill(color),3));
   geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
   const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,side:THREE.DoubleSide}));
   mesh.name=`Carried_${type}_${side}_${component}`;mesh.userData.carriedBag={type,side,component,anchorBone:skeleton.bones[joint].name};mesh.bind(skeleton,body.bindMatrix);mesh.visible=false;model.add(mesh);meshes.push(mesh);
  }
  const up=new THREE.Vector3(0,1,0);
  if(type==='shoulder'){
   add(panel(.235,.24,.032,.025,[sign*.240,.965,.045],sign*Math.PI/2),'body',.44,spine);
   skeleton.pose();applyPassengerCarryPose(model,side);model.updateMatrixWorld(true);skeleton.update();
   const posed=source.position.clone(),v=new THREE.Vector3();for(let i=0;i<posed.count;i++){v.fromBufferAttribute(source.position,i);body.applyBoneTransform(i,v);posed.setXYZ(i,v.x,v.y,v.z)}shoulderGeometry.setAttribute('position',posed);
   add(ribbon([[sign*.240,1.080,.153],[sign*.247,1.17,.151],[sign*.230,1.255,.128],[sign*.205,1.290,.080],[sign*.205,1.295,.033],[sign*.215,1.270,-.024],[sign*.245,1.205,-.067],[sign*.240,1.080,-.063]],.016,p=>new THREE.Vector3(sign,THREE.MathUtils.smoothstep(p.y,1.25,1.32),0).normalize(),false,true),'strap',.47,spine,true);
   skeleton.pose();model.updateMatrixWorld(true);skeleton.update();
  }else if(type==='crossbody'){
   add(panel(.235,.22,.032,.025,[sign*.240,.965,.045],sign*Math.PI/2),'body',.46,spine);
   add(panel(.215,.075,.004,.012,[sign*.262,1.025,.045],sign*Math.PI/2),'flap',.43,spine);
   const points=[[sign*.240,1.064,-.061],[sign*.205,1.085,-.076],[sign*.12,1.18,-.086],[-sign*.02,1.28,-.072],[-sign*.11,1.335,-.050],[-sign*.13,1.365,.045],[-sign*.14,1.325,.120],[-sign*.12,1.27,.162],[-sign*.075,1.20,.182],[sign*.02,1.125,.191],[sign*.15,1.085,.170],[sign*.240,1.064,.151]];
   add(ribbon(points,.019,p=>{
    const outward=new THREE.Vector3(p.x/.24,0,(p.z-.035)/.18).normalize();
    outward.lerp(new THREE.Vector3(0,0,p.z>.035?1:-1),THREE.MathUtils.smoothstep(Math.abs(p.z-.035),.055,.10)).normalize();
    // Keep front/rear fitting rays facing the torso until the curve actually
    // reaches the crown. Turning upward early missed the vertical neckline.
    const crown=THREE.MathUtils.smoothstep(p.y,1.30,1.35)*(1-THREE.MathUtils.smoothstep(Math.abs(p.z-.035),.045,.075));
    return outward.lerp(up,crown).normalize();
   },true),'strap',.47,spine);
  }else{
   add(panel(.175,.16,.075,.020,[sign*.250,.540,.045],sign*Math.PI/2),'body',.40,hand);
   add(panel(.155,.05,.004,.012,[sign*.293,.586,.045],sign*Math.PI/2),'flap',.43,hand);
   add(ribbon([[sign*.250,.615,-.025],[sign*.250,.676,-.009],[sign*.250,.725,.045],[sign*.250,.676,.099],[sign*.250,.615,.115]],.012,()=>new THREE.Vector3(sign,0,0)),'handle',.47,hand);
  }
  variants.set(`${type}-${side}`,meshes);
 }
 surfaceGeometry.dispose();shoulderGeometry.dispose();surfaceMaterial.dispose();return variants;
}

