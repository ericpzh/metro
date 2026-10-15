/** Morph trajectories are part of vertex identity, even when standing points match. */
export function passengerVertexKey(geometry,index,region){
 const a=geometry.attributes;
 const quantized=values=>Array.from(values,value=>Math.round(value*1e5)).join(',');
 return quantized(a.position.array.subarray(index*3,index*3+3))+':'+region+':'+
  Array.from(a.skinIndex.array.subarray(index*4,index*4+4))+':'+
  quantized(a.skinWeight.array.subarray(index*4,index*4+4))+':'+
  (geometry.morphAttributes.position??[]).map(target=>quantized(target.array.subarray(index*3,index*3+3))).join(';');
}

/** Detached simplifier parts retain the source mesh's animated morph weights. */
export function passengerBakePart(source,indices){
 const part=source.clone(false);
 part.geometry=source.geometry.clone();part.geometry.setIndex(indices);
 if(source.morphTargetInfluences)part.morphTargetInfluences=source.morphTargetInfluences;
 return part;
}

/** The game blends at 70% opacity without depth writes. Opaque GLB support
 * walls and covered thighs must not become visible layers through the cloth. */
export function passengerExteriorGeometry(mesh,clothing){
 if(!clothing)return mesh.geometry;
 const geometry=mesh.geometry,a=geometry.attributes,p=a.position;
 const name=mesh.name.replaceAll('_',' ').toLowerCase();
 const shell=['long skirt','top hem closure','trouser waist'].includes(name);
 const half=p.count/2,source=geometry.index?.array??Array.from({length:p.count},(_,i)=>i),kept=[];
 const isLeg=i=>{
  for(let k=0;k<4;k++)if(a.skinWeight.array[i*4+k]>1e-5&&!/^(Hips|(Left|Right)(Thigh|Shin|Foot))$/.test(mesh.skeleton.bones[a.skinIndex.array[i*4+k]].name))return false;
  return true;
 };
 for(let i=0;i<source.length;i+=3){
  const triangle=[source[i],source[i+1],source[i+2]];
  if(shell&&!triangle.every(v=>v<half))continue; // outer wall only, no caps
  if(!shell&&clothing.shape!=='trousers'&&triangle.every(v=>isLeg(v)&&p.getY(v)>(clothing.hem??.19)))continue;
  kept.push(...triangle);
 }
 if(kept.length===source.length&&!shell)return geometry;
 const exterior=geometry.clone();exterior.setIndex(kept);
 if(name==='trouser waist'){
  const position=exterior.attributes.position;
  for(let i=0;i<position.count;i++)position.setY(i,Math.min(position.getY(i),(clothing.topHem??.825)-.001));
  position.needsUpdate=true;
 }
 return exterior;
}

/** Exact typed-integer differences; the first frame remains absolute. */
export function deltaPassengerFrames(values,vertices){
 const delta=values.slice(),stride=vertices*3;
 if(!Number.isSafeInteger(vertices)||vertices<1||values.length%stride)throw Error('Invalid passenger frame dimensions');
 for(let i=stride;i<values.length;i++)delta[i]=values[i]-values[i-stride];
 return delta;
}
