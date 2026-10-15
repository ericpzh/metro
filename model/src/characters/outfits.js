import * as THREE from 'three';
import {addSkirtMotion} from './skirt-motion.js';

import {outfitFor} from './outfit-presets.js';
export {OUTFITS,outfitFor} from './outfit-presets.js';
const grey=value=>new THREE.Color().setRGB(value,value,value,THREE.SRGBColorSpace).r;
const matches=(color,i,value)=>Math.abs(color.getX(i)-grey(value))<.001&&Math.abs(color.getY(i)-grey(value))<.001;

// Closed ring surfaces, with crisp per-face colours and normalized weights.
// The skirt follows the pelvis; splitting it into independent left/right
// trouser weights tears the centre while walking.
function garmentGeometry(skeleton,kind,outfit){
 const segments=96,rows=kind==='hem'?8:kind==='waist'?2:32,positions=[],indices=[],weights=[],joints=[],colors=[];
 const bone=name=>skeleton.bones.findIndex(b=>b.name===name);
 const color=new THREE.Color(kind==='hem'?outfit.top:outfit.bottom);
 const hem=outfit.hem??.19;
 const waist=(outfit.topHem??.825)+.0005;
 for(let shell=0;shell<2;shell++)for(let row=0;row<=rows;row++)for(let j=0;j<=segments;j++){
  const t=row/rows,phi=j/segments*Math.PI*2,sine=Math.sin(phi),cosine=Math.cos(phi);
  let x,y,z,influences;
  if(kind==='hem'){
   y=THREE.MathUtils.lerp(outfit.topHem??.825,.945,t);
   const width=THREE.MathUtils.lerp(.222,.214,t)*(outfit.topFit??1),depth=cosine>0?THREE.MathUtils.lerp(.155,.145,t):THREE.MathUtils.lerp(.147,.127,t);
   const rounded=v=>Math.sign(v)*Math.sqrt(Math.abs(v));
   x=width*rounded(sine)*(shell?.985:1);z=.035+depth*rounded(cosine)*(shell?.985:1);
   influences=[['Spine',1]];
  }else if(kind==='waist'){
   y=THREE.MathUtils.lerp(.785,.865,t);
   const width=THREE.MathUtils.lerp(.195,.180,t),depth=THREE.MathUtils.lerp(cosine>0?.126:.105,cosine>0?.115:.095,t);
   x=width*sine*(shell?.985:1);z=.035+depth*cosine*(shell?.985:1);
   influences=[['Hips',1]];
  }else{
   y=THREE.MathUtils.lerp(hem,waist,t);
   const flare=(1-t)**.8;
   const pleat=outfit.shape==='pleated'?(outfit.pleat??.014)*Math.cos(phi*16)*(1-THREE.MathUtils.smoothstep(t,.65,.95)):0;
   x=(.202+(outfit.flare??.105)*flare+pleat)*sine*(shell?.985:1);
   // Depth accommodates the full accepted fast stride without changing feet.
   z=.035+(.127+.22*flare+pleat)*cosine*(shell?.985:1);
   influences=[['Hips',1]];
  }
  positions.push(x,y,z);colors.push(color.r,color.g,color.b);
  for(let k=0;k<4;k++){joints.push(influences[k]?bone(influences[k][0]):0);weights.push(influences[k]?.[1]??0)}
 }
 const count=(rows+1)*(segments+1);
 for(let shell=0;shell<2;shell++)for(let row=0;row<rows;row++)for(let j=0;j<segments;j++){
  const a=shell*count+row*(segments+1)+j,b=a+1,c=a+segments+1,d=c+1;
  if(shell)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
 }
 for(const row of [0,rows])for(let j=0;j<segments;j++){
  const a=row*(segments+1)+j,b=a+1,c=a+count,d=b+count;
  if(row===0)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 geometry.setIndex(indices);geometry.computeVertexNormals();
 if(kind==='skirt')geometry.userData.skirt={segments,rows,hem,waist,flare:outfit.flare??.105,pleat:outfit.shape==='pleated'?(outfit.pleat??.014):0};
 return geometry;
}

/** Apply once to a fresh, reviewed bagless GLB; source assets stay untouched. */
export function applyOutfit(model,character,id,{swapTones=false,animations}={}){
 const preset=outfitFor(character,id);
 if(!preset)throw new Error(`Unknown ${character} outfit: ${id}`);
 const outfit=swapTones?{...preset,top:preset.bottom,bottom:preset.top}:preset;
 if(model.userData.outfit)throw new Error('Apply an outfit to a fresh model');
 let body;model.traverse(mesh=>{if(mesh.isSkinnedMesh&&mesh.userData.coatInterior&&(!body||mesh.geometry.index.count>body.geometry.index.count))body=mesh});
 if(!body)throw new Error('Expected a reviewed character with garment metadata');
 const skeleton=body.skeleton;skeleton.pose();model.updateMatrixWorld(true);
 const geometry=body.geometry,a=geometry.attributes,p=a.position,c=a.color;
 const female=character==='female',coat=female?.74:.66,pants=female?.48:.53,shirt=female?.62:.89;
 const legVertices=[...new Set(geometry.index.array)].filter(i=>matches(c,i,pants)&&p.getY(i)<.88);
 // Keep the source's continuous sleeves, underarm lining and front/back closure.
 // All garment layers receive the same smooth mapping. Cutting at a fixed X
 // coordinate left open walls that only looked closed from cardinal cameras.
 function fitTop(position,i){
  const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
  const sleeve=THREE.MathUtils.smoothstep(Math.abs(x),.18,.235)*(1-THREE.MathUtils.smoothstep(y,1.23,1.32));
  const fit=THREE.MathUtils.lerp(outfit.topFit??1,1,THREE.MathUtils.smoothstep(y,1.18,1.30));
  const center=Math.sign(x)*.24,sleeveFit=outfit.sleeveFit??1;
  const lower=1-THREE.MathUtils.smoothstep(Math.abs(x),.195,.23);
  const newY=y<1.15?THREE.MathUtils.lerp(outfit.topHem??.825,1.15,(y-.815)/(1.15-.815)):y;
  const mappedY=THREE.MathUtils.lerp(y,newY,lower);
  position.setXYZ(i,THREE.MathUtils.lerp(x*fit,center+(x-center)*sleeveFit,sleeve),sleeve<.5?Math.max(outfit.topHem??.825,mappedY):mappedY,.035+(z-.035)*THREE.MathUtils.lerp(1,sleeveFit,sleeve));
 }
 const top=new THREE.Color(outfit.top),bottom=new THREE.Color(outfit.bottom),skin=new THREE.Color().setRGB(.78,.78,.78,THREE.SRGBColorSpace);
 for(let i=0;i<p.count;i++){
  const isCoat=matches(c,i,coat)||matches(c,i,shirt),isPants=matches(c,i,pants);
  if(isCoat){
   c.setXYZ(i,top.r,top.g,top.b);
   fitTop(p,i);
  }else if(isPants){
   const tint=outfit.shape==='trousers'?bottom:skin;c.setXYZ(i,tint.r,tint.g,tint.b);
   const blend=THREE.MathUtils.smoothstep(p.getY(i),.14,.25)*(1-THREE.MathUtils.smoothstep(p.getY(i),.65,.79));
   const fit=THREE.MathUtils.lerp(1,outfit.legFit??1,blend),center=Math.sign(p.getX(i))*.115;
   p.setX(i,center+(p.getX(i)-center)*fit);p.setZ(i,.035+(p.getZ(i)-.035)*fit);
  }
 }
 c.needsUpdate=true;p.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 body.name='Jacket-free top';body.userData.outfitTop={continuousSource:true};
 // The source back patch closes the former backpack opening too.
 const back=model.getObjectByName('Jacket_back_fill')??model.getObjectByName('Jacket back fill');
 if(back){const a=back.geometry.attributes;for(let i=0;i<a.position.count;i++){fitTop(a.position,i);a.color.setXYZ(i,top.r,top.g,top.b)}a.position.needsUpdate=true;a.color.needsUpdate=true;back.geometry.computeVertexNormals()}
 function add(kind,name){
  const mesh=new THREE.SkinnedMesh(garmentGeometry(skeleton,kind,outfit),new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,side:THREE.DoubleSide}));
  mesh.name=name;mesh.frustumCulled=false;model.add(mesh);mesh.bind(skeleton,body.bindMatrix);return mesh;
 }
 add('hem','Top hem closure');
 if(outfit.shape!=='trousers')addSkirtMotion(model,body,add('skirt','Long_skirt'),legVertices,animations);else add('waist','Trouser waist');
 model.userData.outfit={character,...outfit,swapTones};
 model.updateMatrixWorld(true);return model;
}
