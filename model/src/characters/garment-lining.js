import * as THREE from 'three';
import {cleanFrontBoundaries} from './front-boundaries.js';

// The reconstruction's coat is open behind the sleeves. When they swing away,
// the front shirt can be seen through the back. Add an inset torso lining so
// these openings reveal the coat's interior, with no change to the outer arms.
export function closeCoatInterior(body){
 const geometry=body.geometry,attributes=geometry.attributes;
 const arrays=Object.fromEntries(Object.entries(attributes).map(([key,a])=>[key,Array.from(a.array)]));
 const liningArrays=Object.fromEntries(Object.keys(attributes).map(key=>[key,[]]));
 const indices=Array.from(geometry.index.array),base=attributes.position.count;
 const spine=body.skeleton.bones.findIndex(b=>b.name==='Spine');
 const coat=new THREE.Color().setRGB(.66,.66,.66,THREE.SRGBColorSpace).r;
 const rows=48,segments=128;
 for(let row=0;row<=rows;row++){
  // Close the whole torso, including the front-side underarm openings. The
  // inset front stays behind the shirt; its upper rim follows the neckline.
  for(let j=0;j<=segments;j++){
   const phi=j/segments*Math.PI*2;
   const y=THREE.MathUtils.lerp(.835,1.303+.043*Math.sin(phi)**2,row/rows);
   const shoulder=THREE.MathUtils.smoothstep(y,1.26,1.345);
   const width=THREE.MathUtils.lerp(.217-.012*THREE.MathUtils.smoothstep(y,1.10,1.24),.145,shoulder);
   const rear=THREE.MathUtils.lerp(-.083+.008*THREE.MathUtils.smoothstep(y,1.10,1.24),-.020,shoulder);
   const front=THREE.MathUtils.lerp(.160-.045*THREE.MathUtils.smoothstep(y,1.10,1.28),.095,shoulder);
   // A rounded rectangle fills the front-side corners of the coat. An ellipse
   // left a diagonal sightline past the lining to the opposite front strap.
   const cosine=Math.cos(phi),sine=Math.sin(phi),position=[width*Math.sign(sine)*Math.sqrt(Math.abs(sine)),y,.035+(cosine<0?(.035-rear):(front-.035))*Math.sign(cosine)*Math.sqrt(Math.abs(cosine))];
   if(cosine>0){
    const x=position[0],support=.190-.045*THREE.MathUtils.smoothstep(y,1.10,1.28)-.040*THREE.MathUtils.smoothstep(y,1.28,1.405)-.020*(x/.20)**2-.002;
    position[2]=THREE.MathUtils.lerp(position[2],support,THREE.MathUtils.smoothstep(cosine,.05,.35)*THREE.MathUtils.smoothstep(Math.abs(x),.105,.125));
   }
   for(const [key,a] of Object.entries(attributes)){
    const value=key==='position'?position:key==='color'?[coat,coat,coat]:key==='normal'?[0,0,-1]:key==='skinIndex'?[spine,0,0,0]:key==='skinWeight'?[1,0,0,0]:Array(a.itemSize).fill(0);
    liningArrays[key].push(...value);
   }
  }
 }
 const liningIndices=[];
 for(let row=0;row<rows;row++)for(let j=0;j<segments;j++){
  const a=row*(segments+1)+j,b=a+1,c=a+segments+1,d=c+1;
  liningIndices.push(a,b,c,b,d,c);
 }
 const lining=new THREE.BufferGeometry();
 for(const [key,a] of Object.entries(attributes))lining.setAttribute(key,key==='skinIndex'?new THREE.Uint16BufferAttribute(liningArrays[key],a.itemSize):new THREE.Float32BufferAttribute(liningArrays[key],a.itemSize));
 lining.setIndex(liningIndices);cleanFrontBoundaries(lining,{interior:true});
 for(const key of Object.keys(arrays))for(const value of lining.attributes[key].array)arrays[key].push(value);
 for(const index of lining.index.array)indices.push(base+index);
 for(const [key,a] of Object.entries(attributes))geometry.setAttribute(key,key==='skinIndex'?new THREE.Uint16BufferAttribute(arrays[key],a.itemSize):new THREE.Float32BufferAttribute(arrays[key],a.itemSize));
 geometry.setIndex(indices);
 body.userData.coatInterior={firstVertex:base,vertexCount:lining.attributes.position.count};
 // Retain the inside faces of the existing thin sleeve/hem surfaces as well.
 for(const material of Array.isArray(body.material)?body.material:[body.material])material.side=THREE.DoubleSide;
}
