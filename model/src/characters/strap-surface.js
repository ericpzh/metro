import * as THREE from 'three';

// Remove only the torso surface intersecting the webbing. A reconstructed coat
// contains overlapping shells; leaving those shells inside the strap produces
// the small grey triangles and broken lower return seen in the preview.
export function trimCoatUnderStraps(body,strap){
 const geometry=body.geometry,attributes=geometry.attributes,p=attributes.position;
 const arrays=Object.fromEntries(Object.entries(attributes).map(([key,a])=>[key,Array.from(a.array)])),indices=[];
 const points=strap.geometry.attributes.position,perSide=points.count/2,sections=[];
 const vector=i=>new THREE.Vector3().fromBufferAttribute(points,i);
 for(let side=0;side<2;side++)for(let offset=10;offset<perSide-10;offset+=10){
  const i=side*perSide+offset,center=vector(i+2).add(vector(i+7)).multiplyScalar(.5);
  const tangent=vector(i+12).sub(vector(i-8)).normalize();
  const across=vector(i+4).add(vector(i+5)).sub(vector(i)).sub(vector(i+9)).multiplyScalar(.5);
  const width=across.length();across.normalize();
  const normal=new THREE.Vector3().crossVectors(tangent,across).normalize();
  if(normal.dot(new THREE.Vector3(center.x,center.y>1.29?.2:0,center.z-.035))<0)normal.negate();
  sections.push({center,tangent,across,normal,width});
 }
 const allowed=[.66,.74,.78,.89,.62].map(v=>new THREE.Color().setRGB(v,v,v,THREE.SRGBColorSpace).r);
 const armBones=new Set(body.skeleton.bones.flatMap((b,i)=>/arm|hand/i.test(b.name)?[i]:[]));
 const armWeight=i=>{let total=0;for(let k=0;k<4;k++)if(armBones.has(attributes.skinIndex.array[i*4+k]))total+=attributes.skinWeight.array[i*4+k];return total};
 const vertex=i=>({id:i,...Object.fromEntries(Object.entries(attributes).map(([key,a])=>[key,Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize))]))});
 function interpolate(a,b,t){
  const v={};for(const key of Object.keys(attributes))v[key]=a[key].map((value,i)=>THREE.MathUtils.lerp(value,b[key][i],t));
  const influences=new Map();for(const [source,factor] of [[a,1-t],[b,t]])for(let k=0;k<4;k++)influences.set(source.skinIndex[k],(influences.get(source.skinIndex[k])??0)+source.skinWeight[k]*factor);
  const sorted=[...influences].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=sorted.reduce((s,[,w])=>s+w,0);
  v.skinIndex=Array.from({length:4},(_,i)=>sorted[i]?.[0]??0);v.skinWeight=Array.from({length:4},(_,i)=>(sorted[i]?.[1]??0)/sum);return v;
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
 const emitted=new Map();
 function emit(poly){for(let i=1;i<poly.length-1;i++)for(const v of [poly[0],poly[i],poly[i+1]]){
  let id=v.id;
  if(id===undefined){const key=JSON.stringify(v);id=emitted.get(key);if(id===undefined){id=arrays.position.length/3;emitted.set(key,id);for(const name of Object.keys(attributes))arrays[name].push(...v[name])}}
  indices.push(id);
 }}
 let trimmed=0;
 for(let offset=0;offset<geometry.index.count;offset+=3){
  const ids=[0,1,2].map(k=>geometry.index.getX(offset+k)),center=new THREE.Vector3();
  for(const i of ids)center.add(new THREE.Vector3().fromBufferAttribute(p,i).multiplyScalar(1/3));
  if(center.y<.90||center.y>1.39||Math.abs(center.x)<.07||Math.abs(center.x)>.27||(ids.some(i=>armWeight(i)>.005)&&!(center.y>1.24&&Math.abs(center.x)<.17))||!allowed.some(value=>Math.abs(attributes.color.getX(ids[0])-value)<.001)){indices.push(...ids);continue}
  let nearest=0,distance=Infinity;
  for(let i=0;i<sections.length;i++){const d=center.distanceToSquared(sections[i].center);if(d<distance){nearest=i;distance=d}}
  if(distance>.0036){indices.push(...ids);continue}
  let polygons=[ids.map(vertex)],changed=false;
  for(let i=Math.max(0,nearest-3);i<=Math.min(sections.length-1,nearest+3);i++){
   const section=sections[i],project=(point,axis)=>new THREE.Vector3(...point).sub(section.center).dot(axis),half=section.width/2+.0001;
   // Each clipping plane is linear. An absolute-value slab misses triangles
   // whose edge crosses both sides, leaving shards through the lower turn.
   const planes=[q=>half-project(q,section.across),q=>half+project(q,section.across),q=>.012-project(q,section.tangent),q=>.012+project(q,section.tangent),q=>.030+project(q,section.normal),q=>.045-project(q,section.normal)];
   const next=[];
   for(const polygon of polygons){
    let remaining=polygon,outside=[];
    for(const plane of planes){const [yes,no]=split(remaining,plane);if(no.length>=3)outside.push(no);remaining=yes;if(remaining.length<3)break}
    if(remaining.length<3)next.push(polygon);else{changed=true;next.push(...outside)}
   }
   polygons=next;
  }
  if(changed){trimmed++;polygons.forEach(emit)}else indices.push(...ids);
 }
 // A smooth coat backing closes the trimmed shell 3 mm beneath the webbing.
 // This keeps the lower return supported behind the arm instead of opening a
 // hole in the garment, and keeps the same support through every walking pose.
 const spine=body.skeleton.bones.findIndex(b=>b.name==='Spine');
 const grey=v=>new THREE.Color().setRGB(v,v,v,THREE.SRGBColorSpace).r;
 const coatGrey=attributes.color.array.some(v=>Math.abs(v-grey(.74))<.001)?.74:.66;
 for(let side=0;side<2;side++){
  const grid=[],inner=[],rows=perSide/10;
  for(let row=0;row<rows;row++){
   const i=side*perSide+row*10,center=vector(i+2).add(vector(i+7)).multiplyScalar(.5);
   const next=side*perSide+Math.min(rows-1,row+1)*10,previous=side*perSide+Math.max(0,row-1)*10;
   const tangent=vector(next+2).sub(vector(previous+2)).normalize(),across=vector(i+4).sub(vector(i));
   const normal=new THREE.Vector3().crossVectors(tangent,across).normalize();
   if(normal.dot(new THREE.Vector3(center.x,center.y>1.29?.2:0,center.z-.035))<0)normal.negate();
   for(let j=0;j<5;j++){
    const point=vector(i+j).add(vector(i+9-j)).multiplyScalar(.5).addScaledVector(across.clone().normalize(),(j-2)*.002);
    grid.push(point.clone().addScaledVector(normal,-.003));
    inner.push(point.clone().addScaledVector(normal,-.033));
   }
  }
  function backingTriangle(points){
   const center=points.reduce((v,point)=>v.add(point.clone().multiplyScalar(1/3)),new THREE.Vector3());
   const color=grey(center.y>1.305+4.1*center.x*center.x?.78:coatGrey);
   for(const point of points){
    const vertex=arrays.position.length/3;indices.push(vertex);
    for(const [key,a] of Object.entries(attributes))arrays[key].push(...(key==='position'?point.toArray():key==='color'?[color,color,color]:key==='skinIndex'?[spine,0,0,0]:key==='skinWeight'?[1,0,0,0]:Array(a.itemSize).fill(0)));
   }
  }
  for(let row=0;row<rows-1;row++)for(let j=0;j<4;j++)for(const ids of [[row*5+j,row*5+j+1,(row+1)*5+j],[row*5+j+1,(row+1)*5+j+1,(row+1)*5+j]]){
   backingTriangle(ids.map(id=>grid[id]));backingTriangle(ids.toReversed().map(id=>inner[id]));
  }
  // Close the sides down into the existing coat. A single inset sheet left a
  // visible background slit when viewed along the shoulder or swinging sleeve.
  for(let row=0;row<rows-1;row++)for(const j of [0,4]){
   const a=row*5+j,b=(row+1)*5+j;
   backingTriangle([grid[a],inner[a],grid[b]]);backingTriangle([inner[a],inner[b],grid[b]]);
  }
  for(const row of [0,rows-1])for(let j=0;j<4;j++){
   const a=row*5+j,b=a+1;
   backingTriangle([grid[a],grid[b],inner[a]]);backingTriangle([grid[b],inner[b],inner[a]]);
  }
 }
 const result=new THREE.BufferGeometry();
 for(const [key,a] of Object.entries(attributes))result.setAttribute(key,key==='skinIndex'?new THREE.Uint16BufferAttribute(arrays[key],a.itemSize):new THREE.Float32BufferAttribute(arrays[key],a.itemSize));
 result.setIndex(indices);result.computeVertexNormals();result.computeBoundingBox();result.computeBoundingSphere();
 result.userData.trimmedStrapTriangles=trimmed;return result;
}

export async function withTrimmedStrapSurface(model,exportAsset){
 const strap=model.getObjectByName('Backpack_strap_connectors');if(!strap?.visible)return exportAsset();
 let body;model.traverse(m=>{if(m.isSkinnedMesh&&m.userData.coatInterior&&(!body||m.geometry.index.count>body.geometry.index.count))body=m});
 const previous=body.geometry,previousData=body.userData;body.geometry=trimCoatUnderStraps(body,strap);
 body.userData={...previousData,trimmedStrapTriangles:body.geometry.userData.trimmedStrapTriangles};
 try{return await exportAsset()}finally{body.geometry.dispose();body.geometry=previous;body.userData=previousData}
}
