import * as THREE from '../game/node_modules/three/build/three.module.js';
import {ConvexHull} from '../game/node_modules/three/examples/jsm/math/ConvexHull.js';
import {MeshoptSimplifier} from '../game/node_modules/meshoptimizer/meshopt_simplifier.js';

export const PASSENGER_LOW_RATIO=.1;

/** Game-only faceted envelopes (§9.3), using existing animated vertex IDs.
 * Separate anatomical parts and palette regions before building closed hulls:
 * a head must not join a hand, nor may the two legs collapse into one cluster.
 * No full-detail positions, normals, palette values or walk samples are edited.
 */
export function passengerLowTopology({indices,poses,vertices,regions,garmentShape,positionScale=4096}){
 const budget=Math.floor(indices.length/3*PASSENGER_LOW_RATIO);
 if(budget<1)throw Error('Passenger Low topology needs at least ten source triangles');
 const positions=Float32Array.from(poses.subarray(0,vertices*3),v=>v/positionScale);
 const used=[...new Set(indices)],locked=new Set();
 for(let frame=0;frame<poses.length/(vertices*3);frame++)for(let axis=0;axis<3;axis++){
  const offset=frame*vertices*3;let lo=used[0],hi=lo;
  for(const v of used){
   if(poses[offset+v*3+axis]<poses[offset+lo*3+axis])lo=v;
   if(poses[offset+v*3+axis]>poses[offset+hi*3+axis])hi=v;
  }
  locked.add(lo);locked.add(hi);
 }
 const groups=new Map();
 for(let i=0;i<indices.length;i+=3){
  const face=Array.from(indices.slice(i,i+3)),region=regions?.[face[0]]??0;
  if(regions&&face.some(v=>regions[v]!==region))throw Error('Passenger source triangle crosses palette regions');
  const center=[0,1,2].map(axis=>face.reduce((sum,v)=>sum+positions[v*3+axis],0)/3);
  const [x,y,z]=center,side=y<0?'right':'left';
  const skirt=garmentShape&&garmentShape!=='trousers';
  const zone=z>1.34?'head':z<.13?`foot-${side}`:z<.84?(skirt&&z>.16?'skirt':`leg-${side}`):Math.abs(y)>.18?`arm-${side}`:x<-.17?'pack':'torso';
  const key=region+':'+zone;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(...face);
 }
 const parts=[];
 for(const [key,source] of groups){
  const ids=[...new Set(source)],points=ids.map(v=>new THREE.Vector3(...positions.subarray(v*3,v*3+3)));
  const pointIds=new Map(points.map((p,i)=>[p,i]));
  const animatedCloth=key.endsWith(':skirt')&&source.length>300;
  const hull=!animatedCloth&&points.length>=4?new ConvexHull().setFromPoints(points):null;
  let topology=[];
  if(hull)for(const face of hull.faces){let edge=face.edge;do{topology.push(pointIds.get(edge.head().point));edge=edge.next;}while(edge!==face.edge);}
  if(!topology.length){const lookup=new Map(ids.map((v,i)=>[v,i]));topology=source.map(v=>lookup.get(v));}
  const packed=Float32Array.from(points.flatMap(p=>[p.x,p.y,p.z]));
  let area=0;
  for(let i=0;i<topology.length;i+=3){const a=points[topology[i]],b=points[topology[i+1]],c=points[topology[i+2]];area+=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).length()/2;}
  const attributes=new Float32Array(ids.length*27);
  if(animatedCloth)for(let v=0;v<ids.length;v++)for(let gait=0;gait<3;gait++)for(let phase=0;phase<3;phase++)for(let axis=0;axis<3;axis++){
   const frame=1+gait*24+(phase+1)*6;
   attributes[v*27+gait*9+phase*3+axis]=(poses[(frame*vertices+ids[v])*3+axis]-poses[ids[v]*3+axis])/positionScale;
  }
  parts.push({ids,points:packed,indices:Uint32Array.from(topology),attributes,animatedCloth,weight:Math.sqrt(area),minimum:Math.min(animatedCloth?200:4,topology.length/3)});
 }
 // Retain source faces incident to every gait's extrema, including vertices
 // that lie inside the standing envelope and become exposed while walking.
 const reserve=[],covered=new Set();
 for(const v of locked)if(!covered.has(v)){
  const i=indices.indexOf(v),start=i-i%3;
  for(let k=0;k<3;k++){reserve.push(indices[start+k]);covered.add(indices[start+k]);}
 }
 const remaining=budget-reserve.length/3,minimum=parts.reduce((sum,p)=>sum+p.minimum,0),weight=parts.reduce((sum,p)=>sum+p.weight,0);
 if(remaining<minimum)throw Error('Passenger Low palette regions exceed triangle budget');
 let result=[],error=0;
 for(const fraction of [1,.9,.8,.7,.6,.5,.25,0]){
  result=[...reserve];error=0;
  for(const part of parts){
   const target=Math.min(part.indices.length/3,part.minimum+Math.floor((remaining-minimum)*fraction*part.weight/weight));
   const [reduced,e]=part.animatedCloth
    ?MeshoptSimplifier.simplifyWithAttributes(part.indices,part.points,3,part.attributes,27,Array(27).fill(2),null,target*3,1,['Permissive'])
    :MeshoptSimplifier.simplify(part.indices,part.points,3,target*3,1);
   result.push(...Array.from(reduced,v=>part.ids[v]));error=Math.max(error,e);
  }
  if(result.length<=budget*3)break;
 }
 if(!result.length||result.length>budget*3)throw Error(`Passenger Low topology exceeds 10%: ${result.length/3}/${indices.length/3}`);
 return {indices:result,error};
}
