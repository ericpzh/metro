import {cleanMaterials as clean} from '../trellis-passenger/clean-materials.js';
import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

function bridgeAnkles(root){
 root.updateMatrixWorld(true);
 const bounds=[new THREE.Box3(),new THREE.Box3()],v=new THREE.Vector3();
 root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const p=mesh.geometry.attributes.position;
  for(let i=0;i<p.count;i++){
   v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
   if(v.y>.13&&v.y<.19&&Math.abs(v.x)>.04&&Math.abs(v.x)<.205)bounds[v.x<0?0:1].expandByPoint(v);
  }
 });
 const inverse=root.matrixWorld.clone().invert();
 for(let side=0;side<2;side++){
  const center=bounds[side].getCenter(new THREE.Vector3()),extent=bounds[side].getSize(new THREE.Vector3());
  const geometry=new THREE.CylinderGeometry(1,1,.10,32,8,false);
  geometry.scale(extent.x*.28,1,extent.z*.30);geometry.translate(center.x,.14,center.z);geometry.applyMatrix4(inverse);
  const bridge=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());bridge.name=`Ankle continuity ${side?'right':'left'}`;root.add(bridge);
 }
}
const linear=grey=>new THREE.Color().setRGB(grey,grey,grey,THREE.SRGBColorSpace).r;
const near=(value,grey)=>Math.abs(value-linear(grey))<.001;

// Remove the raised reconstructed collar, keeping the original shoulder/body.
function lowerCollar(root){
 root.updateMatrixWorld(true);const v=new THREE.Vector3();
 root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const p=mesh.geometry.attributes.position,inverse=mesh.matrixWorld.clone().invert();
  for(let i=0;i<p.count;i++){
   v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
   const x=Math.abs(v.x);
   if(x>.075&&x<.235&&v.y>1.29&&v.y<1.415){
    const shoulder=1.405-.43*(x-.075);
    v.y=Math.min(v.y,shoulder);
    v.applyMatrix4(inverse);p.setXYZ(i,v.x,v.y,v.z);
   }
  }
  p.needsUpdate=true;
 });
}

function simplifySurface(root){
 root.updateMatrixWorld(true);const v=new THREE.Vector3();
 root.traverse(mesh=>{
  if(!mesh.isMesh||mesh.name==='Clean backpack panel'||mesh.name.startsWith('Ankle continuity'))return;
  const g=mesh.geometry,p=g.attributes.position,c=g.attributes.color,inverse=mesh.matrixWorld.clone().invert();
  // Local cross sections retain the reconstruction, but remove its thigh lumps.
  const bins=Array.from({length:2},()=>Array.from({length:70},()=>({min:Infinity,max:-Infinity})));
  const worlds=[];
  for(let i=0;i<p.count;i++){
   v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);worlds.push(v.clone());
   if(near(c.getX(i),.53)&&v.y>.17&&v.y<.825){
    const bin=bins[v.x<0?0:1][Math.min(69,Math.floor((v.y-.17)/.01))];bin.min=Math.min(bin.min,v.z);bin.max=Math.max(bin.max,v.z);
   }
  }
  for(let i=0;i<p.count;i++){
   v.copy(worlds[i]);
   if(near(c.getX(i),.53)&&v.y>.18&&v.y<.81){
    const bin=bins[v.x<0?0:1][Math.min(69,Math.floor((v.y-.17)/.01))];
    if(bin.max>bin.min){
     const t=THREE.MathUtils.clamp((v.z-bin.min)/(bin.max-bin.min),0,1);
     const front=.085+.032*THREE.MathUtils.clamp((v.y-.43)/.38,0,1),back=-.047;
     const blend=THREE.MathUtils.smoothstep(v.y,.18,.26);
     v.z=THREE.MathUtils.lerp(v.z,THREE.MathUtils.lerp(back,front,t),blend);
     v.applyMatrix4(inverse);p.setXYZ(i,v.x,v.y,v.z);
    }
   }
   // Reconstructed straps are replaced with continuous independent ribbons.
   if(near(c.getX(i),.47)&&worlds[i].y<1.415&&worlds[i].y>.90&&!(Math.abs(worlds[i].x)>=.13399&&Math.abs(worlds[i].x)<=.17601))c.setXYZ(i,linear(.66),linear(.66),linear(.66));
  }
  // Trim the whole old hand, including the thumb and small finger fragments.
  const index=g.index?.array??Array.from({length:p.count},(_,i)=>i),out={};
  for(const key of Object.keys(g.attributes))out[key]=[];
  for(let k=0;k<index.length;k+=3){
   const ids=[index[k],index[k+1],index[k+2]],centre=ids.reduce((a,i)=>a.add(worlds[i]),new THREE.Vector3()).multiplyScalar(1/3);
   const pants=ids.every(i=>near(c.getX(i),.53));
   if(Math.abs(centre.x)>.17&&centre.y<.84&&centre.y>.47&&ids.every(i=>near(c.getX(i),.78)))continue;
   let poly=ids.map(i=>Object.fromEntries(Object.entries(g.attributes).map(([key,a])=>[key,Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize))])));
   if(!pants&&Math.abs(centre.x)>.17&&centre.y<.84&&centre.y>.47){
    const clipped=[];
    for(let j=0;j<poly.length;j++){
     const a=poly[j],b=poly[(j+1)%poly.length],ay=new THREE.Vector3().fromArray(a.position).applyMatrix4(mesh.matrixWorld).y,by=new THREE.Vector3().fromArray(b.position).applyMatrix4(mesh.matrixWorld).y;
     if(ay>=.805)clipped.push(a);
     if((ay>=.805)!==(by>=.805)){
      const t=(.805-ay)/(by-ay);clipped.push(Object.fromEntries(Object.keys(a).map(key=>[key,a[key].map((value,k)=>THREE.MathUtils.lerp(value,b[key][k],t))])));
     }
    }
    poly=clipped;
   }
   for(let j=1;j<poly.length-1;j++)for(const vertex of [poly[0],poly[j],poly[j+1]])for(const key of Object.keys(out))out[key].push(...vertex[key]);
  }
  const result=new THREE.BufferGeometry();
  for(const [key,values] of Object.entries(out))result.setAttribute(key,new THREE.Float32BufferAttribute(values,g.attributes[key].itemSize));
  mesh.geometry=mergeVertices(result,1e-6);mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
 });
}

function addColouredMesh(root,geometry,name,grey){
 const color=linear(grey),colours=new Float32Array(geometry.attributes.position.count*3).fill(color);
 geometry.setAttribute('color',new THREE.BufferAttribute(colours,3));
 geometry.applyMatrix4(root.matrixWorld.clone().invert());geometry.computeVertexNormals();
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true}));mesh.name=name;root.add(mesh);return mesh;
}

function fingerlessHands(root){
 for(const sign of [-1,1]){
  const geometry=new THREE.CapsuleGeometry(.038,.086,10,24);
  geometry.scale(.82,1,.65);geometry.translate(sign*.235,.761,.040);
  addColouredMesh(root,geometry,`Fingerless hand ${sign<0?'left':'right'}`,.78);
 }
}

function continuousStraps(root){
 root.updateMatrixWorld(true);
 const surfaces=[];root.traverse(n=>{if(n.isMesh&&!/Ankle continuity|Fingerless hand|Clean backpack panel/.test(n.name))surfaces.push(n)});
 const ray=new THREE.Raycaster();
 for(const mesh of surfaces)mesh.material.side=THREE.DoubleSide;
 function surface(x,y,z,direction){
  ray.set(new THREE.Vector3(x,y,z),direction);const hit=ray.intersectObjects(surfaces,false)[0];return hit?.point;
 }
 for(const sign of [-1,1]){
  const rows=[],xs=[sign*.134,sign*.176];
  for(let i=0;i<=96;i++){
   const y=.99+(.325*i/96);
   rows.push(xs.map(x=>{const h=surface(x,y,.5,new THREE.Vector3(0,0,-1));return new THREE.Vector3(x,y,(h?.z??.12)+.022)}));
  }
  const front=rows.at(-1),back=xs.map(x=>surface(x,1.315,-.5,new THREE.Vector3(0,0,1))?.z??-.06);
  for(let i=1;i<=48;i++){
   const t=i/48;
   rows.push(xs.map((x,j)=>{
    const arch=Math.sin(Math.PI*t),z=THREE.MathUtils.lerp(front[j].z,back[j]-.022,t);
    const top=Math.min(1.409-.43*(Math.abs(x)-.075),1.300+4.1*x*x);
    return new THREE.Vector3(x,1.315+(top-1.315)*arch,z);
   }));
  }
  for(let i=1;i<=32;i++){
   const y=1.315-.10*i/32;
   rows.push(xs.map(x=>{const h=surface(x,y,-.5,new THREE.Vector3(0,0,1));return new THREE.Vector3(x,y,(h?.z??-.06)-.022)}));
  }
  const positions=[];
  for(let i=0;i<rows.length-1;i++)for(const v of [rows[i][0],rows[i][1],rows[i+1][0],rows[i][1],rows[i+1][1],rows[i+1][0]])positions.push(...v.toArray());
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const mesh=addColouredMesh(root,geometry,`Continuous strap ${sign<0?'left':'right'}`,.47);mesh.material.side=THREE.DoubleSide;
 }
 for(const mesh of surfaces)mesh.material.side=THREE.FrontSide;
}

export function cleanMaterials(root){
 lowerCollar(root);bridgeAnkles(root);clean(root,{female:true});simplifySurface(root);fingerlessHands(root);continuousStraps(root);
}
