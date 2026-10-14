import * as THREE from 'three';
import {smoothShoulders} from './shoulders.js';
import {addBackpackConnectors} from './backpack-connectors.js';
import {smallBackpackGeometry} from './small-backpack.js';
import {addCarriedBags} from './carried-bags.js';
import {isBackpack} from './library.js';
import {MALE_HAIRSTYLES,FEMALE_HAIRSTYLES,supportsBackpack} from './hairstyles.js';
import {maleHairGeometry} from './male-hair.js';

const grey=value=>new THREE.Color().setRGB(value,value,value,THREE.SRGBColorSpace).r;
// A continuous coat profile: rounded shoulder, straight back, gently flared hem.
export const coatBackZ=y=>-.075-.038*(1-THREE.MathUtils.smoothstep(y,.83,.98))+.045*THREE.MathUtils.smoothstep(y,1.25,1.39);

// Weld semantic trouser vertices across duplicated colour/normal seams. Genuine
// trouser shells reach the lower legs; detached waist ribbons do not.
export function detachedTrouserTriangles(geometry){
 const p=geometry.attributes.position,c=geometry.attributes.color,index=geometry.index.array;
 const keys=new Map(),vertices=new Map(),parent=[],low=[],triangles=[];
 const root=i=>parent[i]===i?i:parent[i]=root(parent[i]);
 function vertex(i){
  if(vertices.has(i))return vertices.get(i);
  const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');let id=keys.get(key);
  if(id===undefined){id=parent.length;keys.set(key,id);parent.push(id);low.push(p.getY(i))}
  vertices.set(i,id);return id;
 }
 for(let offset=0;offset<index.length;offset+=3){
  const ids=[index[offset],index[offset+1],index[offset+2]];
  if(!ids.every(i=>Math.abs(c.getX(i)-grey(.53))<.001))continue;
  const welded=ids.map(vertex);for(let k=1;k<3;k++){const a=root(welded[0]),b=root(welded[k]);if(a!==b){parent[b]=a;low[a]=Math.min(low[a],low[b])}}
  triangles.push([offset,welded[0]]);
 }
 return new Set(triangles.filter(([,id])=>low[root(id)]>.65).map(([offset])=>offset));
}

export const HAIRSTYLES=FEMALE_HAIRSTYLES;

function bobGeometry(style='bob'){
 if(MALE_HAIRSTYLES[style]?.kind==='scalp')return scalpGeometry(false,MALE_HAIRSTYLES[style]);
 const shape=HAIRSTYLES[style];
 const kind=shape.kind;
 const segments=80,rows=28,positions=[],indices=[];
 // Closed hair shell: a rounded crown, chin-length sides, and an open face.
 // Its inner surface and hem join the outer surface without filling the face.
 for(let shell=0;shell<2;shell++)for(let row=0;row<=rows;row++)for(let j=0;j<=segments;j++){
  const t=row/rows,phi=j/segments*Math.PI*2,cap=Math.min(1,t/.55);
  const front=THREE.MathUtils.smoothstep(Math.cos(phi),.35,.75);
  // The fringe overlaps the old hair/forehead seam rather than ending above it.
  // Long lengths sit behind the shoulders. Forward side locks stop above the
  // sleeve instead of poking through it as the arms swing.
  const lowerHem=shape.hem+.018*Math.sin(phi)**2+(shape.angle??0)*Math.sin(phi);
  const sideHem=kind==='long'?THREE.MathUtils.lerp(lowerHem,1.31,THREE.MathUtils.smoothstep(Math.cos(phi),-.45,-.05)):lowerHem;
  const hem=THREE.MathUtils.lerp(sideHem,1.549+.004*Math.sin(2*phi-.3)-(shape.fringe??0)*(.5+.5*Math.sin(phi)),front);
  const skirt=Math.max(0,(t-.55)/.45);
  const radius=Math.sin(cap*Math.PI/2)*(1-.035*skirt-.075*THREE.MathUtils.smoothstep(skirt,.82,1))*(shell?.94:1);
  const y=t<=.55?1.72-.12*(1-Math.cos(cap*Math.PI/2)):THREE.MathUtils.lerp(1.60,hem,skirt);
  const fringe=.009*Math.max(0,Math.cos(phi))**8*skirt;
  // The approved forehead reaches Z=.209. A symmetric .13 m cap left an
  // exposed wedge; the front crown must enclose that actual head envelope.
  const cosine=Math.cos(phi),depth=cosine>0?.205:(kind==='bob'?.130:.105),profile=cosine>0?Math.sqrt(cosine):cosine;
  // Close-fitting crown and sides, with a small flare only at the lower hem.
  // The long-hair temple follows height, not each column's different hem.
  // Otherwise the forehead column flares early and leaves a notch at its side.
  const width=shape.width+(kind==='bob'?0:kind==='long'?.040*THREE.MathUtils.smoothstep(1.50-y,0,.19):.009*THREE.MathUtils.smoothstep(skirt,.45,1))-(shape.taper??0)*skirt+(shape.roundness??0)*Math.sin(skirt*Math.PI);
  const sideRadius=kind==='long'?Math.sin(cap*Math.PI/2)*(1-.11*THREE.MathUtils.smoothstep(1.32-y,0,.22))*(shell?.94:1):radius;
  const crown=1-THREE.MathUtils.smoothstep(t,.2,.55);
  positions.push(width*sideRadius*Math.sin(phi)+(shape.part??0)*crown,y-(shell?.002:0),.018-shape.sweep*skirt*(1-front)+depth*radius*profile+fringe);
 }
 const count=(rows+1)*(segments+1);
 for(let shell=0;shell<2;shell++)for(let row=0;row<rows;row++)for(let j=0;j<segments;j++){
  const a=shell*count+row*(segments+1)+j,b=a+1,c=a+segments+1,d=c+1;
  if(shell)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
 }
 for(let j=0;j<segments;j++){
  const a=rows*(segments+1)+j,b=a+1,c=a+count,d=b+count;
  indices.push(a,c,b,b,c,d);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 return geometry;
}

// Follow the actual skin envelope, rather than retaining a bob's projecting
// fringe and square rear hem. Short/bald share this scalp; crops vary its crown.
const scalpHem=phi=>{const t=(Math.cos(phi)+1)/2;return 1.475+.08*(.6*t+.4*t*t)};
function scalpGeometry(lower=false,shape={}){
 const segments=80,rows=28,positions=[],indices=[],count=(rows+1)*(segments+1);
 for(let shell=0;shell<2;shell++)for(let row=0;row<=rows;row++)for(let j=0;j<=segments;j++){
  const phi=j/segments*Math.PI*2;
  const front=Math.max(0,Math.cos(phi)),hem=scalpHem(phi)-(shape.fringe??0)*front**4;
  const edge=Math.acos((hem-1.56)/.13),theta=lower?THREE.MathUtils.lerp(edge,Math.PI,row/rows):row/rows*edge,radius=Math.sin(theta)*(shell?.98:1);
  const crown=lower?0:Math.max(0,Math.cos(theta))**2;
  const lift=(shape.volume??0)*crown+(shape.quiff??0)*front*crown*Math.sin(theta);
  const part=(shape.part??0)*crown*Math.sin(theta)*Math.sin(phi);
  // A lowered fringe must cover the source forehead's projecting skin surface,
  // rather than cutting a shallow scalp through it and exposing jagged slivers.
  const fringe=shape.fringe?.043*front**8*THREE.MathUtils.smoothstep(row/rows,.55,1):0;
  positions.push((.108+(shape.width??0))*radius*Math.sin(phi)+(shape.sweep??0)*crown,1.56+.13*Math.cos(theta)+lift+part-(shell?.001:0),.04+.133*radius*Math.cos(phi)+fringe);
 }
 for(let shell=0;shell<2;shell++)for(let row=0;row<rows;row++)for(let j=0;j<segments;j++){
  const a=shell*count+row*(segments+1)+j,b=a+1,c=a+segments+1,d=c+1;
  if(shell)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
 }
 for(let j=0;j<segments;j++){const a=rows*(segments+1)+j,b=a+1,c=a+count,d=b+count;indices.push(a,c,b,b,c,d)}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function createFemaleVariant(model,{male=false}={}){
 let skeleton,body;
 model.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  skeleton??=mesh.skeleton;
  if(!body||mesh.geometry.attributes.position.count>body.geometry.attributes.position.count)body=mesh;
 });
 skeleton.pose();model.updateMatrixWorld(true);
 smoothShoulders(model);
 const p=body.geometry.attributes.position,c=body.geometry.attributes.color,index=body.geometry.index.array,kept=[];
 const detached=detachedTrouserTriangles(body.geometry);
 model.userData.removedDetachedTrouserTriangles=detached.size;
 // Remove the old hair and genuinely disconnected waist ribbons.
 for(let i=0;i<index.length;i+=3){
  const triangle=[index[i],index[i+1],index[i+2]];
  const hair=triangle.every(j=>p.getY(j)>1.425&&Math.abs(c.getX(j)-grey(.47))<.001);
  if(!hair&&!detached.has(i))kept.push(...triangle);
 }
 body.geometry.setIndex(kept);
 // The reconstructed waist contains thin overhangs reaching into the hand gap.
 // Fold only those upper trouser vertices into a continuous oval waist surface.
 for(let i=0;i<p.count;i++)if(p.getY(i)>.79&&Math.abs(c.getX(i)-grey(.53))<.001){
  const x=p.getX(i),z=p.getZ(i)-.035,q=Math.hypot(x/.195,z/.108);
  if(q>1){const t=THREE.MathUtils.smoothstep(p.getY(i),.79,.815),scale=THREE.MathUtils.lerp(1,1/q,t);p.setX(i,x*scale);p.setZ(i,.035+z*scale)}
 }
 body.geometry.computeVertexNormals();
 const palette=male?[]:[[.66,.74],[.89,.62],[.53,.48]];
 const coatGrey=male?.66:.74;
 model.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;
  const colours=mesh.geometry.attributes.color;
  for(let i=0;i<colours.count;i++){
   const old=colours.getX(i),entry=palette.find(([from])=>Math.abs(old-grey(from))<.001);
   if(entry){
    // A light cardigan over a darker top; retain the approved crisp boundaries.
    const value=grey(entry[1]);colours.setXYZ(i,value,value,value);
   }
  }
  mesh.material=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,side:THREE.DoubleSide});
 });
 const backpack=[];model.traverse(mesh=>{if(mesh.isSkinnedMesh&&mesh!==body)backpack.push(mesh)});
 const strapVertices=[];
 for(let i=0;i<p.count;i++)if(p.getY(i)<1.425&&Math.abs(c.getX(i)-grey(.47))<.001)strapVertices.push(i);
 const noBagPositions=p.clone();
 for(let i=0;i<p.count;i++){
  const y=p.getY(i),coat=Math.abs(c.getX(i)-grey(coatGrey))<.001||Math.abs(c.getX(i)-grey(.47))<.001;
  if(coat&&y>=.83&&y<1.425)noBagPositions.setZ(i,Math.max(p.getZ(i),coatBackZ(y)));
 }
 const noBagGeometry=body.geometry.clone();noBagGeometry.setAttribute('position',noBagPositions);noBagGeometry.computeVertexNormals();
 const originalNormals=body.geometry.attributes.normal,noBagNormals=noBagGeometry.attributes.normal;
 // The reconstruction had no coat surface beneath the removed pack. Reuse its
 // rounded panel topology as a shallow jacket back, inside the coat silhouette.
 const backFill=backpack[0].clone();backFill.geometry=backpack[0].geometry.clone();backFill.name='Jacket back fill';
 const bp=backFill.geometry.attributes.position,bc=backFill.geometry.attributes.color;
 for(let i=0;i<bp.count;i++){bp.setZ(i,coatBackZ(bp.getY(i))+(bp.getZ(i)+.255)*.10);bc.setXYZ(i,grey(coatGrey),grey(coatGrey),grey(coatGrey))}
 backFill.geometry.computeVertexNormals();backFill.material=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});backFill.visible=false;model.add(backFill);
 const panel=model.getObjectByName('Clean_backpack_panel'),standardPanel=panel.geometry;
 const smallPanel=smallBackpackGeometry(skeleton),standardStrap=model.getObjectByName('Backpack_strap_connectors');
 const smallStrap=addBackpackConnectors(model,body,{small:true,coatGrey});smallStrap.name='Small backpack straps';smallStrap.visible=false;
 const scaledPacks=new Map([.875,.75].map(scale=>{
  const geometry=standardPanel.clone(),positions=geometry.attributes.position;
  geometry.computeBoundingBox();const center=geometry.boundingBox.getCenter(new THREE.Vector3());
  // Scale around the pack centre in elevation; keep its front buried in the
  // coat and scale depth outward from that surface, rather than floating it.
  for(let i=0;i<positions.count;i++){
   const oldY=positions.getY(i),y=center.y+(oldY-center.y)*scale;
   positions.setXYZ(i,positions.getX(i)*scale,y,coatBackZ(y)+(positions.getZ(i)-coatBackZ(oldY))*scale);
  }
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const strap=addBackpackConnectors(model,body,{coatGrey,packScale:scale});strap.name=`Standard ${scale*100} backpack straps`;strap.visible=false;
  return [`standard-${scale*100}`,{geometry,strap}];
 }));
 const head=skeleton.bones.findIndex(b=>b.name==='Head');
 const carriedBags=addCarriedBags(model,body);
 function styledGeometry(style){
 const geometry=bobGeometry(style);
 const skinIndices=new Uint16Array(geometry.attributes.position.count*4),hairWeights=new Float32Array(skinIndices.length);
 const colour=new Float32Array(geometry.attributes.position.count*3).fill(grey(style==='bald'?.78:.47));
 for(let i=0;i<geometry.attributes.position.count;i++){skinIndices[i*4]=head;hairWeights[i*4]=1}
 geometry.setAttribute('color',new THREE.BufferAttribute(colour,3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(hairWeights,4));
 return geometry;
 }
 const hair=new THREE.SkinnedMesh(styledGeometry('bob'),new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,side:THREE.DoubleSide}));hair.name='Bob hairstyle';hair.frustumCulled=false;
 model.add(hair);hair.bind(skeleton,new THREE.Matrix4());
 let currentStyle='bob',withBag=true,bagStyle='standard';
 function setBag(enabled){
  withBag=Boolean(enabled);
  bagStyle=enabled==='small'||scaledPacks.has(enabled)||carriedBags.has(enabled)?enabled:'standard';
  const onBack=withBag&&isBackpack(bagStyle);
  body.geometry.setAttribute('position',onBack?p:noBagPositions);body.geometry.computeBoundingBox();body.geometry.computeBoundingSphere();
  body.geometry.setAttribute('normal',onBack?originalNormals:noBagNormals);
  backpack.forEach(mesh=>mesh.visible=onBack);backFill.visible=!onBack||bagStyle!=='standard';
  panel.geometry=bagStyle==='small'?smallPanel:scaledPacks.get(bagStyle)?.geometry??standardPanel;
  standardStrap.visible=withBag&&bagStyle==='standard';smallStrap.visible=withBag&&bagStyle==='small';
  // Export trimming finds the active ribbon by its established mesh name.
  standardStrap.name=bagStyle!=='standard'?'Standard backpack straps':'Backpack_strap_connectors';
  smallStrap.name=bagStyle==='small'?'Backpack_strap_connectors':'Small backpack straps';
  for(const [style,{strap}] of scaledPacks){strap.visible=withBag&&bagStyle===style;strap.name=bagStyle===style?'Backpack_strap_connectors':`${style} backpack straps`}
  for(const [style,meshes] of carriedBags)for(const mesh of meshes)mesh.visible=withBag&&bagStyle===style;
  for(const i of strapVertices)c.setXYZ(i,grey(withBag?.47:coatGrey),grey(withBag?.47:coatGrey),grey(withBag?.47:coatGrey));c.needsUpdate=true;
  if(onBack&&!supportsBackpack(male?'male':'female',currentStyle))setHairstyle('shoulder');
 }
 function setHairstyle(style){
  if(!(male?MALE_HAIRSTYLES:HAIRSTYLES)[style])throw new Error(`Unknown hairstyle: ${style}`);
  if(!supportsBackpack(male?'male':'female',style)&&isBackpack(bagStyle))setBag(false);currentStyle=style;
  const previous=hair.geometry;hair.geometry=styledGeometry(style);previous.dispose();hair.name=style[0].toUpperCase()+style.slice(1)+' hairstyle';
 }
 // Preserve the approved tousled hair as a separate head-skinned surface for
 // the bagless male; cropped and bald variants use the same smooth scalp mesh.
 if(male){
  const croppedPositions=[p,noBagPositions].map(attribute=>{
   const positions=attribute.clone();
   for(let i=0;i<positions.count;i++)if(p.getY(i)>1.425&&Math.abs(c.getX(i)-grey(.78))<.001){
    const phi=Math.atan2(p.getX(i)/.108,(p.getZ(i)-.04)/.133);
    positions.setY(i,Math.min(p.getY(i),scalpHem(phi)-.001));
    if(p.getZ(i)<.075&&p.getY(i)>1.445){
     const radius=Math.hypot(p.getX(i)/.108,(p.getZ(i)-.04)/.133),allowed=.99*Math.sqrt(Math.max(0,1-((positions.getY(i)-1.56)/.13)**2));
     if(radius>allowed){const scale=allowed/radius;positions.setX(i,p.getX(i)*scale);positions.setZ(i,.04+(p.getZ(i)-.04)*scale)}
    }
   }
   return positions;
  });
  const updateHead=()=>{const onBack=withBag&&isBackpack(bagStyle);body.geometry.setAttribute('position',MALE_HAIRSTYLES[currentStyle].kind==='source'?(onBack?p:noBagPositions):croppedPositions[onBack?0:1]);body.geometry.computeVertexNormals();body.geometry.computeBoundingBox();body.geometry.computeBoundingSphere()};
  const changeBag=setBag;setBag=enabled=>{changeBag(enabled);updateHead()};
  const headFill=hair.clone();headFill.geometry=scalpGeometry(true);headFill.name='Scalp skin continuation';headFill.visible=false;
  const count=headFill.geometry.attributes.position.count,indices=new Uint16Array(count*4),weights=new Float32Array(count*4);
  for(let i=0;i<count;i++){indices[i*4]=head;weights[i*4]=1}
  headFill.geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(count*3).fill(grey(.78)),3));
  headFill.geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));headFill.geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));model.add(headFill);
  const originalHair=body.clone();originalHair.name='Original male hair';originalHair.geometry=body.geometry.clone();
  const hairIndices=[];
  for(let i=0;i<index.length;i+=3){const ids=[index[i],index[i+1],index[i+2]];if(ids.every(j=>p.getY(j)>1.425&&Math.abs(c.getX(j)-grey(.47))<.001))hairIndices.push(...ids)}
  originalHair.geometry.setIndex(hairIndices);model.add(originalHair);
  const sourceHair=originalHair.geometry;
  const changeHair=setHairstyle;
  setHairstyle=style=>{
   if(!MALE_HAIRSTYLES[style])throw new Error(`Unknown male hairstyle: ${style}`);
   const shape=MALE_HAIRSTYLES[style],fromSource=shape.kind==='source';
   originalHair.visible=style==='original';hair.visible=style!=='original';
   headFill.visible=!fromSource;
   if(style==='original')currentStyle=style;
   else if(fromSource){
    const previous=hair.geometry;hair.geometry=maleHairGeometry(sourceHair,hairIndices,shape);previous.dispose();
    hair.name=style[0].toUpperCase()+style.slice(1)+' hairstyle';currentStyle=style;
   }else changeHair(style);
   updateHead();
  };
  setHairstyle('original');
 }
 return {model,skeleton,body,setHairstyle,setBag,getStyle:()=>currentStyle,hasBag:()=>withBag};
}
