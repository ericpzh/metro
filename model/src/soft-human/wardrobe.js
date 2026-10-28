import * as T from 'three';
import {softBagGeometry} from './bag-shell.js';
import {connectStrapToBag} from './bag-connectors.js';
import {fittedStrap} from './strap-fit.js';
import {CARRIED_BAGS,addSoftCarriedBag} from './carried-bags.js';
export const OUTFITS=[
 {id:'plain',label:'Plain white / 素白',top:'#f2f1ed',bottom:'#f2f1ed',trim:'#f2f1ed',bag:'#82978c'},
 {id:'commuter',label:'Commuter jacket / 通勤夹克',top:'#345346',bottom:'#354b60',trim:'#e6b947',bag:'#c29b54'},
 {id:'stripe',label:'Striped explorer / 条纹探险家',top:'#425039',bottom:'#ece6d5',trim:'#efb52e',bag:'#d5ad55'},
 {id:'trail',label:'Pink trail jacket / 粉色户外服',top:'#cc3c70',bottom:'#64754a',trim:'#394851',bag:'#24b9aa'},
 {id:'beach',label:'Summer stripes / 夏日条纹',top:'#27a5a4',bottom:'#bc4d83',trim:'#f4d160',bag:'#edd18a'},
 {id:'navy-suit',label:'Navy suit / 藏青西装',formal:true,top:'#293d58',bottom:'#293d58',trim:'#455b76',tie:'#8c3346',bag:'#614b3d'},
 {id:'charcoal-suit',label:'Charcoal suit / 炭灰西装',formal:true,top:'#45464c',bottom:'#35363d',trim:'#5b5d65',tie:'#355f85',bag:'#423c37'},
 {id:'beige-blazer',label:'Beige blazer / 米色西装',formal:true,top:'#b8a387',bottom:'#3b4b64',trim:'#cdb99c',tie:'#3b705f',bag:'#78573e'},
];
export const BACKPACKS=[{id:'none',label:'None / 无'},{id:'daypack',label:'Small daypack / 日用背包'},{id:'hiking',label:'Hiking pack / 徒步背包'},...CARRIED_BAGS];

// Split the actual skinned triangles at garment boundaries. Unlike a shader,
// these crisp material regions survive GLB export with the same bone weights.
function clothingGeometry(source,outfit){
 const src=source.index?source.toNonIndexed():source.clone(),p=src.attributes.position,n=src.attributes.normal,idx=src.attributes.skinIndex,w=src.attributes.skinWeight;
 const planes=[[0,-.56],[0,-.30],[0,-.24],[0,-.045],[0,-.012],[0,.012],[0,.045],[0,.24],[0,.30],[0,.56],[2,0],...[.12,.32,.46,.64,.65,.72,.76,.80,.86,.92,.98,1.04,1.10,1.16,1.22,1.27,1.30].map(y=>[1,y])];
 if(outfit.formal)planes.push([0,-.53],[0,.53],[0,-.013],[0,.013],[1,.14],[1,1.01],[1,1.235]);
 const buckets=Array.from({length:8},()=>[]);
 const lerp=(a,b,t)=>{const skin=new Map();for(const [v,f] of [[a,1-t],[b,t]])v.ids.forEach((id,i)=>skin.set(id,(skin.get(id)||0)+v.ws[i]*f));const s=[...skin].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=s.reduce((v,x)=>v+x[1],0);return {p:a.p.map((v,i)=>T.MathUtils.lerp(v,b.p[i],t)),n:a.n.map((v,i)=>T.MathUtils.lerp(v,b.n[i],t)),ids:s.map(x=>x[0]),ws:s.map(x=>x[1]/sum)}};
 function splitField(poly,field){const sides=[[],[]];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=field(a.p),db=field(b.p);if(da>=-1e-9)sides[0].push(a);if(da<=1e-9)sides[1].push(a);if(da*db<0){const v=lerp(a,b,da/(da-db));sides[0].push(v);sides[1].push(v)}}return sides.filter(x=>x.length>=3)}
 function region(x,y,z){
  if(outfit.id==='plain'||y>1.36)return 0;
  const arm=Math.abs(x)>.24&&y>.50,beach=outfit.id==='beach';
  if(y<.72){if(arm)return 0;if(outfit.formal)return y>.14?2:5;const hem=beach?.32:outfit.id==='trail'?.46:.12;return y>hem?2:0}
  if(y<.76&&!arm)return outfit.formal?1:3;
  if(arm&&Math.abs(x)>(beach?.30:.56))return 0;
  if(beach&&arm)return 0;
  if(y>1.265+4*x*x)return 0;
  if(outfit.formal){
   if(arm&&Math.abs(x)>.53)return 4;
   if(!arm&&z>0){if(Math.abs(x)<.013&&y>1.01&&y<1.235)return 6;if(y>1.01&&Math.abs(x)<(y-1.01)*.22)return 4;if(y>1.01&&Math.abs(x)<(y-1.01)*.22+.025)return 7}
   return 1;
  }
  if(beach&&!arm)return Math.floor((y-.80)/.06)%2===0?1:4;
  if(!arm&&z>0){
   if(Math.abs(x)<.012)return 5;
   if(outfit.id==='stripe'&&Math.abs(x)<.045)return Math.floor((y-.80)/.06)%2===0?3:4;
  }
  return 1;
 }
 for(let i=0;i<p.count;i+=3){let polys=[[0,1,2].map(j=>{const k=i+j;return {p:[p.getX(k),p.getY(k),p.getZ(k)],n:[n.getX(k),n.getY(k),n.getZ(k)],ids:[idx.getX(k),idx.getY(k),idx.getZ(k),idx.getW(k)],ws:[w.getX(k),w.getY(k),w.getZ(k),w.getW(k)]}})];
  for(const [axis,value] of planes)polys=polys.flatMap(poly=>splitField(poly,p=>p[axis]-value));
  polys=polys.flatMap(poly=>splitField(poly,p=>p[1]-1.265-4*p[0]*p[0]));
  if(outfit.formal)for(const offset of [0,.025])polys=polys.flatMap(poly=>splitField(poly,p=>Math.abs(p[0])-(p[1]-1.01)*.22-offset));
  for(const poly of polys)for(let j=1;j<poly.length-1;j++){const tri=[poly[0],poly[j],poly[j+1]],c=[0,1,2].map(k=>tri.reduce((s,v)=>s+v.p[k],0)/3);buckets[region(...c)].push(...tri)}
 }
 const positions=[],normals=[],indices=[],weights=[],g=new T.BufferGeometry();let start=0;
 buckets.forEach((vertices,materialIndex)=>{for(const v of vertices){positions.push(...v.p);normals.push(...v.n);indices.push(...v.ids);weights.push(...v.ws)}if(vertices.length)g.addGroup(start,vertices.length,materialIndex);start+=vertices.length});
 g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.normalizeNormals();g.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));src.dispose();return g;
}
export function createWardrobe(c){
 const base=c.body.geometry,skin=c.body.material,capMaterial=skin.clone();c.cap.traverse(o=>{if(o.isMesh)o.material=capMaterial});
 const state={outfit:'commuter',backpack:'daypack'};let pack;const straps=[];
 function disposePack(){for(const strap of straps){strap.removeFromParent();strap.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})}straps.length=0;if(!pack)return;pack.removeFromParent();pack.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose()});pack=null}
 function makePack(outfit){disposePack();c.carry=null;if(state.backpack==='none')return;
  if(CARRIED_BAGS.some(x=>x.id===state.backpack)){const carried=addSoftCarriedBag(c,c.body.geometry,state.backpack,outfit);pack=carried.group;straps.push(...carried.straps);return}
  pack=new T.Group();pack.name=`Backpack-${state.backpack}`;c.chest.add(pack);const big=state.backpack==='hiking',color=outfit.bag;
  const mat=color=>new T.MeshStandardMaterial({color,roughness:.9});
  function box(name,size,pos,color){const mesh=new T.Mesh(softBagGeometry(size),mat(color));mesh.name=name;mesh.position.set(...pos);mesh.castShadow=true;pack.add(mesh);return mesh}
  box('Pack body',big?[.29,.39,.17]:[.25,.30,.13],[0,.015,big?-.245:-.225],color);
  box('Front pocket',big?[.22,.16,.05]:[.18,.12,.04],[0,-.065,big?-.33:-.29],color);
  if(big){box('Top flap',[.31,.10,.22],[0,.17,-.255],color);box('Bedroll',[.29,.085,.09],[0,.255,-.25],outfit.trim)}
  for(const s of [-1,1]){
   // Purpose-built armhole loop: across the shoulder, down the outer chest,
   // around the ribs below the axilla, and directly back into the pack.
   const points=[[s*.10,.12,-.16],[s*.125,.23,-.10],[s*.13,.28,0],[s*.13,.19,.135],[s*.14,.07,.15],[s*.18,-.04,.10],[s*.20,-.065,0],[s*.17,-.07,-.10],[s*.10,-.07,-.16]].map(p=>new T.Vector3(...p));
   const strap=fittedStrap(c,c.body.geometry,new T.CatmullRomCurve3(points),mat(color),`Shoulder strap ${s}`,{width:.032,surfaceWidth:true});
   connectStrapToBag(c,strap,pack,[[s*.085,.13,-.18],[s*.085,-.085,-.18]]);straps.push(strap);
  }
 }
 function set(outfitId=state.outfit,backpackId=state.backpack){
  const outfit=OUTFITS.find(x=>x.id===outfitId);if(!outfit||!BACKPACKS.some(x=>x.id===backpackId))throw Error('Unknown wardrobe option');state.outfit=outfitId;state.backpack=backpackId;
  if(c.body.geometry!==base)c.body.geometry.dispose();if(Array.isArray(c.body.material))c.body.material.forEach(m=>m.dispose());
  c.body.geometry=clothingGeometry(base,outfit);c.body.material=['#f2f1ed',outfit.top,outfit.bottom,outfit.trim,outfit.id==='beach'?'#9bdfd3':'#fff5d6','#263039',outfit.tie??'#263039',outfit.trim].map(color=>new T.MeshStandardMaterial({color,roughness:.86}));
  capMaterial.color.set(outfit.id==='plain'?'#f2f1ed':outfit.trim);makePack(outfit);
 }
 function update(){c.body.updateMatrixWorld(true);c.body.skeleton.update();pack?.userData.updateCarry?.();for(const strap of straps){strap.updateSurface();strap.updateConnections?.()}}
 set();update();return {state,set,update,get pack(){return pack},straps,source:base};
}







