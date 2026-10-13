import * as THREE from 'three';

// All overlapping reconstructed front layers must agree on their garment
// boundaries. Split crossing triangles and keep each triangle one flat color.
export function cleanFrontBoundaries(geometry,{interior=false}={}){
 const grey=value=>new THREE.Color().setRGB(value,value,value,THREE.SRGBColorSpace).r;
 const attributes=geometry.attributes;
 // Retire the reconstructed strap mask, including its ragged lower tabs.
 // The backpack straps now have their own continuous closed geometry.
 for(let i=0;i<attributes.color.count;i++)if(attributes.position.getY(i)<1.425&&Math.abs(attributes.color.getX(i)-grey(.47))<.001)attributes.color.setXYZ(i,grey(.66),grey(.66),grey(.66));
 const arrays=Object.fromEntries(Object.entries(attributes).map(([key,a])=>[key,Array.from(a.array)])),kept=[];
 const pos=attributes.position,emitted=new Map();
 const vertex=i=>Object.fromEntries(Object.entries(attributes).map(([key,a])=>[key,Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize))]));
 function interpolate(a,b,t){
  const v={};for(const key of Object.keys(a))v[key]=a[key].map((value,i)=>THREE.MathUtils.lerp(value,b[key][i],t));
  const influences=new Map();
  for(const [source,factor] of [[a,1-t],[b,t]])for(let k=0;k<4;k++)influences.set(source.skinIndex[k],(influences.get(source.skinIndex[k])??0)+source.skinWeight[k]*factor);
  const sorted=[...influences].sort((a,b)=>b[1]-a[1]).slice(0,4),total=sorted.reduce((sum,[,weight])=>sum+weight,0);
  v.skinIndex=Array.from({length:4},(_,i)=>sorted[i]?.[0]??0);v.skinWeight=Array.from({length:4},(_,i)=>(sorted[i]?.[1]??0)/total);return v;
 }
 function split(poly,distance){
  const inside=[],outside=[];
  for(let i=0;i<poly.length;i++){
   const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a.position),db=distance(b.position);
   (da>=0?inside:outside).push(a);
   if((da>=0)!==(db>=0)){const v=interpolate(a,b,da/(da-db));inside.push(v);outside.push(v)}
  }
  return [inside,outside];
 }
 function emit(poly,value){
  for(let i=1;i<poly.length-1;i++)for(const v of [poly[0],poly[i],poly[i+1]]){
   const values=Object.fromEntries(Object.keys(arrays).map(key=>[key,key==='color'?[grey(value),grey(value),grey(value)]:v[key]]));
   const key=JSON.stringify(values);let id=emitted.get(key);
   if(id===undefined){id=arrays.position.length/3;emitted.set(key,id);for(const name of Object.keys(arrays))arrays[name].push(...values[name])}
   kept.push(id);
  }
 }
 const regions=interior?[]:[
  [.78,[([x,y])=>y-(1.305+4.1*x*x)]],
  [.89,[([x])=>.098-Math.abs(x),([,,z])=>z-.045]],
 ];
 const index=geometry.index.array;
 for(let offset=0;offset<index.length;offset+=3){
  const ids=[index[offset],index[offset+1],index[offset+2]],center=[0,0,0];for(const i of ids){center[0]+=pos.getX(i)/3;center[1]+=pos.getY(i)/3;center[2]+=pos.getZ(i)/3}
  if(center[1]<=.92||center[1]>=1.425||Math.abs(center[0])>=.23){kept.push(...ids);continue}
  let remaining=[ids.map(vertex)];
  for(const [value,planes] of regions){
   const next=[];
   for(const poly of remaining){let interior=poly;for(const plane of planes){const [yes,no]=split(interior,plane);if(no.length>=3)next.push(no);interior=yes;if(interior.length<3)break}if(interior.length>=3)emit(interior,value)}
   remaining=next;
  }
  for(const poly of remaining)emit(poly,.66);
 }
 for(const [key,a] of Object.entries(attributes))geometry.setAttribute(key,key==='skinIndex'?new THREE.Uint16BufferAttribute(arrays[key],a.itemSize):new THREE.Float32BufferAttribute(arrays[key],a.itemSize));
 geometry.setIndex(kept);
}
