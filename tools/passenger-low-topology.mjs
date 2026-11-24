import {MeshoptSimplifier} from '../game/node_modules/meshoptimizer/meshopt_simplifier.js';

export const PASSENGER_LOW_RATIO=.1;

const POSE_SAMPLE_FRAMES=[0,7,13,19,31,37,55,61];
const SKINNED_SAMPLE_FRAMES=[0,13,37,61];

function splitConnectedComponents(source){
 const parent=new Map();
 const find=x=>{
  let r=x;
  while(parent.get(r)!==r)r=parent.get(r);
  while(parent.get(x)!==r){const next=parent.get(x);parent.set(x,r);x=next;}
  return r;
 };
 const unite=(a,b)=>{
  if(!parent.has(a))parent.set(a,a);
  if(!parent.has(b))parent.set(b,b);
  const ra=find(a),rb=find(b);
  if(ra!==rb)parent.set(ra,rb);
 };
 for(let i=0;i<source.length;i+=3){
  unite(source[i],source[i+1]);
  unite(source[i+1],source[i+2]);
 }
 const components=new Map();
 for(let i=0;i<source.length;i+=3){
  const root=find(source[i]);
  let list=components.get(root);
  if(!list){list=[];components.set(root,list);}
  list.push(source[i],source[i+1],source[i+2]);
 }
 return [...components.values()];
}

/** Game-only low-detail topology (§9.3), reusing existing animated vertex IDs.
 * Simplify each palette region's connected mesh components directly with
 * multi-frame pose displacement and optional skin-weight attributes instead of
 * spatial ConvexHull envelopes, so arms never web to the torso or legs and
 * large low-curvature components (such as the head) keep their surface share.
 * No full-detail positions, normals, palette values or walk samples are edited.
 */
export function passengerLowTopology({
 indices,
 poses,
 vertices,
 regions,
 garmentShape,
 positionScale=4096,
 maxTriangles=Infinity,
 clothRegion,
 minimumClothTriangles=200,
 bind,
 boneCount=16,
}){
 const sourceTriangles=indices.length/3;
 const budget=Math.min(maxTriangles,Math.floor(sourceTriangles*PASSENGER_LOW_RATIO));
 if(budget<1)throw Error('Passenger Low topology needs at least ten source triangles');
 const frames=Math.max(1,Math.floor(poses.length/(vertices*3)));
 const used=[...new Set(indices)],locked=new Set();
 for(let frame=0;frame<frames;frame++)for(let axis=0;axis<3;axis++){
  const offset=frame*vertices*3;let lo=used[0],hi=lo;
  for(const v of used){
   if(poses[offset+v*3+axis]<poses[offset+lo*3+axis])lo=v;
   if(poses[offset+v*3+axis]>poses[offset+hi*3+axis])hi=v;
  }
  locked.add(lo);locked.add(hi);
 }

 const groups=new Map();
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i],b=indices[i+1],c=indices[i+2];
  const region=regions?.[a]??0;
  if(regions&&(regions[b]!==region||regions[c]!==region))throw Error('Passenger source triangle crosses palette regions');
  let list=groups.get(region);
  if(!list){list=[];groups.set(region,list);}
  list.push(a,b,c);
 }

 // Use a walking A-pose frame when present so arms and legs are separated in
 // reference space; fall back to frame 0 for single-frame fixtures.
 const refFrame=frames>1?1:0;
 const useBind=Boolean(bind&&bind.length>=vertices*16&&boneCount>0);
 const sampleFrames=(useBind?SKINNED_SAMPLE_FRAMES:POSE_SAMPLE_FRAMES).filter(f=>f<frames&&f!==refFrame);
 const attrCount=(useBind?boneCount:0)+sampleFrames.length*3;
 const attrWeights=useBind
  ?[...Array(boneCount).fill(2),...Array(sampleFrames.length*3).fill(2)]
  :Array(attrCount).fill(4);
 const hasSkirt=Boolean(garmentShape&&garmentShape!=='trousers');

 const parts=[];
 for(const [region,regionSource] of groups){
  for(const source of splitConnectedComponents(regionSource)){
   const ids=[...new Set(source)];
   const lookup=new Map(ids.map((v,i)=>[v,i]));
   const localIndices=Uint32Array.from(source,v=>lookup.get(v));
   const points=new Float32Array(ids.length*3);
   const attributes=attrCount?new Float32Array(ids.length*attrCount):null;
   const vertexLock=new Uint8Array(ids.length);
   for(let i=0;i<ids.length;i++){
    const v=ids[i];
    if(locked.has(v))vertexLock[i]=1;
    const refOffset=(refFrame*vertices+v)*3;
    const rx=poses[refOffset],ry=poses[refOffset+1],rz=poses[refOffset+2];
    points[i*3]=rx/positionScale;
    points[i*3+1]=ry/positionScale;
    points[i*3+2]=rz/positionScale;
    if(attributes){
     let ao=i*attrCount;
     if(useBind){
      const bo=v*16;
      for(let k=0;k<4;k++){
       const w=bind[bo+8+k],bone=bind[bo+12+k];
       if(w&&bone>=0&&bone<boneCount)attributes[ao+bone]+=w;
      }
      ao+=boneCount;
     }
     for(let s=0;s<sampleFrames.length;s++){
      const fOff=(sampleFrames[s]*vertices+v)*3;
      attributes[ao+s*3]=(poses[fOff]-rx)/positionScale;
      attributes[ao+s*3+1]=(poses[fOff+1]-ry)/positionScale;
      attributes[ao+s*3+2]=(poses[fOff+2]-rz)/positionScale;
     }
    }
   }
   let area=0;
   for(let i=0;i<localIndices.length;i+=3){
    const a=localIndices[i]*3,b=localIndices[i+1]*3,c=localIndices[i+2]*3;
    const ux=points[b]-points[a],uy=points[b+1]-points[a+1],uz=points[b+2]-points[a+2];
    const vx=points[c]-points[a],vy=points[c+1]-points[a+1],vz=points[c+2]-points[a+2];
    area+=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)*.5;
   }
   const triangles=source.length/3;
   const isCloth=hasSkirt&&(clothRegion===undefined||region===clothRegion)&&triangles>100;
   parts.push({
    ids,
    points,
    indices:localIndices,
    attributes,
    vertexLock,
    triangles,
    weight:Math.max(1e-6,area),
    minimum:Math.min(isCloth?minimumClothTriangles:triangles>=24?6:1,triangles),
   });
  }
 }

 const minimumSum=parts.reduce((sum,p)=>sum+p.minimum,0);
 const floorScale=minimumSum>budget?budget/minimumSum:1;
 for(const part of parts)part.minimum=Math.max(1,Math.floor(part.minimum*floorScale));
 const baseSum=parts.reduce((sum,p)=>sum+p.minimum,0);
 const extraBudget=Math.max(0,budget-baseSum);
 const weightSum=parts.reduce((sum,p)=>sum+p.weight,0)||1;

 const firstIncident=new Map();
 for(const v of locked){
  const i=indices.indexOf(v);
  if(i>=0)firstIncident.set(v,i-i%3);
 }

 const simplifyPass=(fraction,lockVertices)=>{
  const result=[];let error=0;
  for(const part of parts){
   const share=Math.floor(extraBudget*fraction*part.weight/weightSum);
   const target=Math.max(1,Math.min(part.triangles,Math.floor(part.minimum*Math.min(1,fraction))+share));
   const lock=lockVertices?part.vertexLock:null;
   const [reduced,e]=part.attributes
    ?MeshoptSimplifier.simplifyWithAttributes(part.indices,part.points,3,part.attributes,attrCount,attrWeights,lock,target*3,1,[])
    :MeshoptSimplifier.simplify(part.indices,part.points,3,target*3,1,[]);
   for(let i=0;i<reduced.length;i++)result.push(part.ids[reduced[i]]);
   error=Math.max(error,e);
  }
  const covered=new Set(result);
  for(const [v,start] of firstIncident)if(!covered.has(v)){
   for(let k=0;k<3;k++){result.push(indices[start+k]);covered.add(indices[start+k]);}
  }
  return {indices:result,error};
 };

 let best=null;
 const fractions=[1,.96,.92,.88,.84,.8,.72,.64,.55,.45,.35,.25,.15,.08,0];
 for(const lockVertices of [true,false]){
  for(const fraction of fractions){
   const candidate=simplifyPass(fraction,lockVertices);
   if(candidate.indices.length>0&&candidate.indices.length<=budget*3){best=candidate;break;}
  }
  if(best)break;
 }
 if(!best||!best.indices.length||best.indices.length>budget*3){
  throw Error(`Passenger Low topology exceeds 10%: ${(best?.indices.length??0)/3}/${sourceTriangles}`);
 }
 return best;
}
