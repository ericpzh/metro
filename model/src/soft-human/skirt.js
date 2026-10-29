import * as T from 'three';

// Keep the source waist, hips and outer legs; replace only the crotch patch.
export const SKIRT_BRIDGE_TOP=.50;
export const SKIRT_BRIDGE_HALF_WIDTH=.20;
const EPS=1e-7;
const key=v=>v.p.map(x=>Math.round(x*1e6)).join(',');
function vertex(p,n,weights){
 const skin=[...weights].filter(v=>v[1]>1e-10).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=skin.reduce((s,v)=>s+v[1],0);while(skin.length<4)skin.push([0,0]);
 return {p,n,ids:skin.map(v=>v[0]),ws:skin.map(v=>v[1]/sum)};
}
function mix(a,b,t){
 const weights=new Map();for(const [v,f] of [[a,1-t],[b,t]])v.ids.forEach((id,k)=>weights.set(id,(weights.get(id)??0)+v.ws[k]*f));
 return vertex(a.p.map((v,k)=>T.MathUtils.lerp(v,b.p[k],t)),a.n.map((v,k)=>T.MathUtils.lerp(v,b.n[k],t)),weights);
}
function split(poly,axis,value){
 const sides=[[],[]];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=a.p[axis]-value,db=b.p[axis]-value;if(da>=-EPS)sides[0].push(a);if(da<=EPS)sides[1].push(a);if(da*db<0){const v=mix(a,b,da/(da-db));v.p[axis]=value;sides[0].push(v);sides[1].push(v)}}return sides.filter(p=>p.length>=3);
}
function planeSegment(tri,axis,value){
 const points=new Map();for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3],da=a.p[axis]-value,db=b.p[axis]-value;if(Math.abs(da)<EPS)points.set(key(a),a);if(da*db<0){const v=mix(a,b,da/(da-db));v.p[axis]=value;points.set(key(v),v)}}return points.size===2?[...points.values()]:null;
}
function at(segments,axis,value,front){
 const hits=[];for(const [a,b] of segments){if(value<Math.min(a.p[axis],b.p[axis])-EPS||value>Math.max(a.p[axis],b.p[axis])+EPS)continue;if(Math.abs(a.p[axis]-b.p[axis])<EPS){hits.push(a,b);continue}hits.push(mix(a,b,T.MathUtils.clamp((value-a.p[axis])/(b.p[axis]-a.p[axis]),0,1)))}
 if(!hits.length)throw Error('Missing source skirt boundary '+axis+':'+value);return hits.reduce((a,b)=>(front?b.p[2]>a.p[2]:b.p[2]<a.p[2])?b:a);
}
const unique=values=>[...new Set(values.map(v=>Math.round(v*1e7)/1e7))].sort((a,b)=>a-b);
export function skinWeightsOf(v){
 const weights=new Map();v.ids.forEach((id,k)=>weights.set(id,(weights.get(id)??0)+v.ws[k]));return weights;
}

export function skirtBodyGeometry(source,outfit){
 const hem=outfit.skirt==='midi'?.16:.29,top=SKIRT_BRIDGE_TOP,a=source.attributes;
 let legWidth=0;for(let i=0;i<a.position.count;i++)if(Math.abs(a.position.getY(i)-hem)<.025)legWidth=Math.max(legWidth,Math.abs(a.position.getX(i)));
 const width=Math.min(SKIRT_BRIDGE_HALF_WIDTH,legWidth*.8);
 const raw=source.index?.array??Array.from({length:a.position.count},(_,i)=>i),kept=[],sides=[[],[]],upper=[],lower=[];
 const read=i=>({p:[a.position.getX(i),a.position.getY(i),a.position.getZ(i)],n:[a.normal.getX(i),a.normal.getY(i),a.normal.getZ(i)],ids:Array.from(a.skinIndex.array.slice(i*4,i*4+4)),ws:Array.from(a.skinWeight.array.slice(i*4,i*4+4))});
 for(let i=0;i<raw.length;i+=3){
  const tri=[read(raw[i]),read(raw[i+1]),read(raw[i+2])];
  for(const [axis,value,segments] of [[0,-width,sides[0]],[0,width,sides[1]],[1,top,upper],[1,hem,lower]]){const edge=planeSegment(tri,axis,value);if(edge)segments.push(edge)}
  if(tri.every(v=>v.p[1]>=top-EPS)||tri.every(v=>v.p[1]<=hem+EPS)||tri.every(v=>v.p[0]>=width-EPS)||tri.every(v=>v.p[0]<=-width+EPS)){kept.push(...tri);continue}
  let polys=[tri];for(const [axis,value] of [[0,-width],[0,width],[1,hem],[1,top]])polys=polys.flatMap(p=>split(p,axis,value));
  for(const poly of polys){const center=[0,1].map(k=>poly.reduce((s,v)=>s+v.p[k],0)/poly.length);if(Math.abs(center[0])<width-EPS&&center[1]>hem+EPS&&center[1]<top-EPS)continue;for(let j=1;j<poly.length-1;j++)kept.push(poly[0],poly[j],poly[j+1])}
 }
 const rows=unique([hem,top,...sides.flat(2).map(v=>v.p[1]).filter(y=>y>hem&&y<top),...Array.from({length:17},(_,i)=>T.MathUtils.lerp(hem,top,i/16))]);
 const columns=unique([-width,width,...upper.flat().map(v=>v.p[0]).filter(x=>Math.abs(x)<width),...Array.from({length:33},(_,i)=>T.MathUtils.lerp(-width,width,i/32))]);
 const panels=[],frontHem=[],backHem=[];
 for(const front of [true,false]){
  const grid=[];
  for(const y of rows){
   const left=at(sides[0],1,y,front),right=at(sides[1],1,y,front),leftTop=at(upper,0,-width,front),rightTop=at(upper,0,width,front),fade=T.MathUtils.smoothstep(y,top-.09,top),line=[];
   for(const x of columns){
    const t=(x+width)/(2*width),topPoint=at(upper,0,x,front),base=mix(left,right,t),topLine=mix(leftTop,rightTop,t),slope=v=>-v.n[0]/(Math.abs(v.n[2])<.05?(front?.05:-.05):v.n[2]);
    const h=(l,r,dl,dr)=>((2*t-3)*t*t+1)*l+((t-2)*t+1)*t*2*width*dl+(-2*t+3)*t*t*r+(t-1)*t*t*2*width*dr;
    const z=h(left.p[2],right.p[2],slope(left),slope(right)),zTop=h(leftTop.p[2],rightTop.p[2],slope(leftTop),slope(rightTop)),weights=skinWeightsOf(base);
    const nearLeft=at(sides[0],1,top-.001,front),nearRight=at(sides[1],1,top-.001,front);
    const sideSlope=(zTop-h(nearLeft.p[2],nearRight.p[2],slope(nearLeft),slope(nearRight)))/.001;
    const topSlope=-topPoint.n[1]/topPoint.n[2];
    topPoint.ids.forEach((id,k)=>weights.set(id,(weights.get(id)??0)+fade*topPoint.ws[k]));topLine.ids.forEach((id,k)=>weights.set(id,Math.max(0,(weights.get(id)??0)-fade*topLine.ws[k])));
    const v=vertex([x,y,z+fade*(topPoint.p[2]-zTop)+(y-top)*fade*(topSlope-sideSlope)],base.n.map((v,k)=>v+fade*(topPoint.n[k]-topLine.n[k])),weights);
    line.push(Math.abs(x+width)<EPS?left:Math.abs(x-width)<EPS?right:Math.abs(y-top)<EPS?topPoint:v);
   }grid.push(line);
  }
  for(let r=0;r<rows.length-1;r++)for(let j=0;j<columns.length-1;j++){const [a,b,c,d]=[grid[r][j],grid[r][j+1],grid[r+1][j],grid[r+1][j+1]];panels.push(...(front?[a,b,c,b,d,c]:[a,c,b,b,c,d]))}
  (front?frontHem:backHem).push(...grid[0]);
 }
 // The hem connection follows the source inner-leg arcs; no thick waistband.
 function innerArc(sign){
  const nodes=new Map(),edges=new Map();
  for(const segment of lower){
   let [a,b]=segment;if(a.p[0]*sign<0&&b.p[0]*sign<0)continue;if(Math.abs(a.p[0])>width&&Math.abs(b.p[0])>width)continue;
   if(Math.abs(a.p[0])>width){a=mix(a,b,(sign*width-a.p[0])/(b.p[0]-a.p[0]));a.p[0]=sign*width}if(Math.abs(b.p[0])>width){b=mix(a,b,(sign*width-a.p[0])/(b.p[0]-a.p[0]));b.p[0]=sign*width}
   const ka=key(a),kb=key(b);if(ka===kb)continue;nodes.set(ka,a);nodes.set(kb,b);for(const [k,v] of [[ka,kb],[kb,ka]]){if(!edges.has(k))edges.set(k,new Set());edges.get(k).add(v)}
  }
  const ends=[...nodes.keys()].filter(k=>edges.get(k).size===1),start=ends.sort((a,b)=>nodes.get(b).p[2]-nodes.get(a).p[2])[0];if(!start)throw Error('Cannot connect skirt hem to source leg');
  const path=[];let previous,current=start;while(current){path.push(nodes.get(current));const next=[...edges.get(current)].find(k=>k!==previous);previous=current;current=next;if(path.length>nodes.size+1)throw Error('Skirt hem arc loops')}return path;
 }
 const right=innerArc(1),left=innerArc(-1),contour=[...frontHem,...right.slice(1),...backHem.slice(0,-1).reverse(),...left.slice(1).reverse()],clean=[];
 for(const v of contour)if(!clean.length||key(v)!==key(clean.at(-1)))clean.push(v);if(key(clean[0])===key(clean.at(-1)))clean.pop();
 const caps=[];
 for(const tri of T.ShapeUtils.triangulateShape(clean.map(v=>new T.Vector2(v.p[0],v.p[2])),[])){let [a,b,c]=tri.map(i=>clean[i]);const cross=new T.Vector3().subVectors(new T.Vector3(...b.p),new T.Vector3(...a.p)).cross(new T.Vector3().subVectors(new T.Vector3(...c.p),new T.Vector3(...a.p)));if(cross.y>0)[b,c]=[c,b];caps.push(a,b,c)}
 // Subdivide source cut edges at the connector's exact vertices. Shared edge
 // points retain identical weights on both sides, avoiding posed T-junctions.
 const boundary=new Map();
 for(const v of [...panels,...caps])if(Math.abs(Math.abs(v.p[0])-width)<EPS||Math.abs(v.p[1]-top)<EPS||Math.abs(v.p[1]-hem)<EPS)boundary.set(key(v),v);
 const boundaryPoints=[...boundary.values()],stitched=[];
 for(let i=0;i<kept.length;i+=3){
  const tri=kept.slice(i,i+3).map(v=>boundary.get(key(v))??v),poly=[];
  for(let j=0;j<3;j++){
   const a=tri[j],b=tri[(j+1)%3];poly.push(a);
   if(!((Math.abs(a.p[0]-b.p[0])<EPS&&Math.abs(Math.abs(a.p[0])-width)<EPS)||(Math.abs(a.p[1]-b.p[1])<EPS&&(Math.abs(a.p[1]-top)<EPS||Math.abs(a.p[1]-hem)<EPS))))continue;
   const edge=new T.Vector3(...b.p).sub(new T.Vector3(...a.p)),length=edge.lengthSq(),extra=[];if(length<1e-14)continue;
   for(const v of boundaryPoints){const d=new T.Vector3(...v.p).sub(new T.Vector3(...a.p)),t=d.dot(edge)/length;if(t>EPS&&t<1-EPS&&d.addScaledVector(edge,-t).lengthSq()<1e-14)extra.push({t,v})}
   extra.sort((a,b)=>a.t-b.t);poly.push(...extra.map(v=>v.v));
  }
  if(poly.length===3){stitched.push(...tri);continue}
  const center=mix(mix(tri[0],tri[1],.5),tri[2],1/3);
  for(let j=0;j<poly.length;j++)stitched.push(center,poly[j],poly[(j+1)%poly.length]);
 }
 const all=[...stitched,...panels,...caps],positions=[],normals=[],ids=[],weights=[];
 for(const v of all){positions.push(...v.p);normals.push(...new T.Vector3(...v.n).normalize().toArray());ids.push(...v.ids);weights.push(...v.ws)}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
 geometry.userData={skirt:{construction:'source-body-bridge',waist:.64,hem,bridgeTop:top,bridgeHalfWidth:width,bridgeStart:stitched.length,bridgeVertices:panels.length,capVertices:caps.length,rows:rows.length,columns:columns.length}};return geometry;
}
