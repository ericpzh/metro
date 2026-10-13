import * as THREE from 'three';
import {cleanFrontBoundaries} from './front-boundaries.js';
import {closeCoatInterior} from './garment-lining.js';
import {addBackpackConnectors} from './backpack-connectors.js';
import {repairWaistSkinning} from './waist-skinning.js';

function relaxJaw(geometry,skin,frontOnly=false){
 const p=geometry.attributes.position,c=geometry.attributes.color,ids=new Map(),groups=[],vertices=[],neighbors=[],weights=[];
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),key=[x,y,z].map(v=>Math.round(v*1e6)).join(',');
  let id=ids.get(key);
  if(id===undefined){id=groups.length;ids.set(key,id);groups.push([]);vertices.push([x,y,z]);neighbors.push(new Set());weights.push(0)}
  groups[id].push(i);
  if(!frontOnly&&Math.abs(c.getX(i)-skin)<.001&&y>1.385&&y<1.60)weights[id]=Math.max(weights[id],THREE.MathUtils.smoothstep(y,1.385,1.405)*(1-THREE.MathUtils.smoothstep(y,1.57,1.60)));
  if(frontOnly&&z>.045&&y>1.08&&y<1.385)weights[id]=Math.max(weights[id],THREE.MathUtils.smoothstep(y,1.08,1.15)*(1-THREE.MathUtils.smoothstep(y,1.35,1.385))*(1-THREE.MathUtils.smoothstep(Math.abs(x),.16,.23)));
 }
 const vertexId=new Uint32Array(p.count);groups.forEach((group,id)=>group.forEach(i=>vertexId[i]=id));
 const index=geometry.index.array;
 for(let i=0;i<index.length;i+=3){const a=vertexId[index[i]],b=vertexId[index[i+1]],d=vertexId[index[i+2]];neighbors[a].add(b).add(d);neighbors[b].add(a).add(d);neighbors[d].add(a).add(b)}
 const active=weights.flatMap((weight,id)=>weight>0?[id]:[]);
 for(let pass=0;pass<80;pass++){
  const next=active.map(id=>{
   const sum=[0,0,0],linked=neighbors[id];if(!linked.size)return vertices[id];
   for(const other of linked)for(let k=0;k<3;k++)sum[k]+=vertices[other][k];
   return sum.map((value,k)=>THREE.MathUtils.lerp(vertices[id][k],value/linked.size,.45*weights[id]));
  });
  active.forEach((id,i)=>vertices[id]=next[i]);
 }
 for(const id of active)for(const i of groups[id])p.setXYZ(i,...vertices[id]);
}

// Fold the reconstructed collar tabs into the continuous neck/shoulder surface.
// This operates on every color seam with the same position-based falloff.
export function smoothShoulders(model){
 let body;model.traverse(mesh=>{if(mesh.isSkinnedMesh&&(!body||mesh.geometry.attributes.position.count>body.geometry.attributes.position.count))body=mesh});
 model.traverse(mesh=>{
  if(mesh!==body)return;
  const p=mesh.geometry.attributes.position;
  repairWaistSkinning(mesh);
  // The reconstruction assigned inner coat panels to the forearms. Keep the
  // torso on Spine, blending into the actual sleeve at the outer shoulder.
  const joints=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
  const spine=mesh.skeleton.bones.findIndex(b=>b.name==='Spine');
  const coat=new THREE.Color().setRGB(.66,.66,.66,THREE.SRGBColorSpace).r;
  // The lower coat panels inherited a forearm blend from the reconstruction.
  // Keep the torso hem at its rest location while the actual sleeves swing.
  for(let i=0;i<p.count;i++){
   if(p.getY(i)<.80||p.getY(i)>=.96||Math.abs(p.getX(i))>=.225||Math.abs(mesh.geometry.attributes.color.getX(i)-coat)>.001)continue;
   let arm=0;for(let k=0;k<4;k++)if(/arm|hand/i.test(mesh.skeleton.bones[joints.array[i*4+k]].name))arm+=weights.array[i*4+k];
   if(arm>=.95)continue;
   for(let k=0;k<4;k++){joints.array[i*4+k]=k?0:spine;weights.array[i*4+k]=k?0:1}
  }
  for(let i=0;i<p.count;i++)if(p.getY(i)>.92&&p.getY(i)<1.27&&Math.abs(p.getX(i))<.235){
   const factor=1-THREE.MathUtils.smoothstep(Math.abs(p.getX(i)),.195,.235),influences=new Map();let transfer=0;
   for(let k=0;k<4;k++){const id=joints.array[i*4+k],weight=weights.array[i*4+k],moved=/arm|hand/i.test(mesh.skeleton.bones[id].name)?weight*factor:0;transfer+=moved;influences.set(id,(influences.get(id)??0)+weight-moved)}
   influences.set(spine,(influences.get(spine)??0)+transfer);
   const sorted=[...influences].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=sorted.reduce((total,[,w])=>total+w,0);
   for(let k=0;k<4;k++){joints.array[i*4+k]=sorted[k]?.[0]??0;weights.array[i*4+k]=(sorted[k]?.[1]??0)/sum}
  }
  const colors=mesh.geometry.attributes.color,skin=new THREE.Color().setRGB(.78,.78,.78,THREE.SRGBColorSpace).r;
  const strap=new THREE.Color().setRGB(.47,.47,.47,THREE.SRGBColorSpace).r;
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
   // Pull the old raised strap loops into the coat before repainting narrower
   // bands. The original source remains available outside this library cleanup.
   if(y>.99&&y<1.425&&Math.abs(colors.getX(i)-strap)<.001){
    const back=-.075-.038*(1-THREE.MathUtils.smoothstep(y,.83,.98))+.045*THREE.MathUtils.smoothstep(y,1.25,1.39);
    if(z<back)p.setZ(i,back+.002);
    if(z>.18&&y<1.18)p.setZ(i,.18+.03*(z-.18));
   }
   if(Math.abs(colors.getX(i)-skin)<.001&&y>1.385&&y<1.465&&z>.095){
    const jawFront=.107+.066*THREE.MathUtils.smoothstep(y,1.40,1.465);
    if(z>jawFront)p.setZ(i,THREE.MathUtils.lerp(z,jawFront+.02*(z-jawFront),THREE.MathUtils.smoothstep(y,1.385,1.40)));
   }
   // Round the underside of the jaw into the neck; the reconstruction left
   // a squared chin ledge and a small rear notch, shared by every hairstyle.
   if(Math.abs(colors.getX(i)-skin)<.001&&y>1.405&&y<1.60){
    if(z>.095){
     const jaw=1.405+.048*THREE.MathUtils.smoothstep(z,.095,.173)+.012*(x/.10)**2;
     p.setY(i,Math.max(y,jaw));
    }
    if(z<.015){const back=-.020-.047*THREE.MathUtils.smoothstep(y,1.405,1.475);p.setZ(i,Math.max(z,back))}
   }
   // A fitted front surface removes the little collar/chest spurs without
   // making different material layers occupy exactly the same plane.
   if(y>1.18&&y<1.40&&z>.08){
    const front=.195-.040*THREE.MathUtils.smoothstep(y,1.0,1.24)-.030*THREE.MathUtils.smoothstep(y,1.24,1.40);
    if(z>front)p.setZ(i,THREE.MathUtils.lerp(z,front+.06*(z-front),THREE.MathUtils.smoothstep(y,1.18,1.22)));
   }
   if(y<1.29||y>=1.425)continue;
   const flare=1-THREE.MathUtils.smoothstep(y,1.30,1.395);
   const currentZ=p.getZ(i),radius=Math.hypot(x/(.06+.16*flare),(currentZ-.055)/(.075+.04*flare));
   if(radius>1){
    const fold=(1+.08*(radius-1))/radius;
    const scale=THREE.MathUtils.lerp(1,fold,THREE.MathUtils.smoothstep(y,1.29,1.33));
    p.setX(i,x*scale);p.setZ(i,.055+(currentZ-.055)*scale);
   }
  }
  relaxJaw(mesh.geometry,skin);
  // The old shirt and cardigan edges contained separate raised layers. Fit
  // their front vertices to one continuous chest surface, retaining a tiny
  // amount of depth ordering, then relax the joined outline across color seams.
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
   if(y<=1.08||y>=1.385||z<=.045)continue;
   const weight=THREE.MathUtils.smoothstep(y,1.08,1.15)*(1-THREE.MathUtils.smoothstep(Math.abs(x),.16,.23));
   const surface=.190-.045*THREE.MathUtils.smoothstep(y,1.10,1.28)-.040*THREE.MathUtils.smoothstep(y,1.28,1.405)-.020*(x/.20)**2;
   const fitted=THREE.MathUtils.lerp(surface+.01*(z-surface),Math.min(z,surface+.01*(z-surface)),THREE.MathUtils.smoothstep(y,1.34,1.365));
   p.setZ(i,THREE.MathUtils.lerp(z,fitted,weight));
  }
  relaxJaw(mesh.geometry,skin,true);
  cleanFrontBoundaries(mesh.geometry);
  closeCoatInterior(mesh);
  // Retire rear reconstruction ridges before fitting webbing. Those ridges
  // were visible through the strap edges and the tapered pack's front rim.
  const rear=mesh.geometry.attributes.position,ink=mesh.geometry.attributes.color,coatInk=new THREE.Color().setRGB(.66,.66,.66,THREE.SRGBColorSpace).r;
  for(let i=0;i<rear.count;i++){
   const x=rear.getX(i),y=rear.getY(i),z=rear.getZ(i);
   if(y<.90||y>1.385||z>=0||Math.abs(x)>.235)continue;
   let arms=0;for(let k=0;k<4;k++)if(/arm|hand/i.test(mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.array[i*4+k]].name))arms+=mesh.geometry.attributes.skinWeight.array[i*4+k];
   const coat=Math.abs(ink.getX(i)-coatInk)<.001;
   if(arms>.005||(!coat&&!(Math.abs(x)>.07&&y<1.385&&Math.abs(ink.getX(i)-skin)<.001)))continue;
   const back=-.075-.038*(1-THREE.MathUtils.smoothstep(y,.83,.98))+.045*THREE.MathUtils.smoothstep(y,1.25,1.39);
   rear.setZ(i,Math.max(z,back+.001));
  }
  p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
 });
 addBackpackConnectors(model,body);
}
