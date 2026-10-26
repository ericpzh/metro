import * as THREE from 'three';

// Texture colours guide garment lengths once. Runtime colour boundaries are
// continuous fields in bind space, never per-vertex texture classifications.
const quantile=(values,t,fallback)=>values.length?values.sort((a,b)=>a-b)[Math.floor((values.length-1)*t)]:fallback;
export function fitSkinInterval(samples,fallback){
 const bins=Array.from({length:40},()=>({skin:0,total:0}));
 for(const {progress,skin} of samples)if(progress>=0&&progress<=1.1){const bin=bins[Math.min(39,Math.floor(progress/1.1*40))];bin.total++;bin.skin+=skin?1:0}
 const flags=bins.map(bin=>bin.total>2&&bin.skin/bin.total>.55);
 for(let i=1;i<39;i++)if(!flags[i]&&flags[i-1]&&flags[i+1])flags[i]=true;
 let first=-1,best=[-1,-1];for(let i=0;i<=40;i++){if(i<40&&flags[i]){if(first<0)first=i}else if(first>=0){if(i-first>best[1]-best[0])best=[first,i];first=-1}}
 if(best[0]<0||best[1]-best[0]<3)return fallback;
 return [best[0]/40*1.1,Math.min(1.04,best[1]/40*1.1)];
}
export async function createCandidateIllustration(root,height,{neckline}={}){
 const parts=[],palette={skin:.64,hair:.025,top:.60,bottom:.12,shoe:.025},bones=new Map();root.updateMatrixWorld(true);root.traverse(node=>{if(node.isBone)bones.set(node.name,node)});
 const find=(...names)=>names.map(name=>bones.get(name)).find(Boolean),pointOf=bone=>bone.getWorldPosition(new THREE.Vector3());
 const headPosition=pointOf(find('Head','Bip01_Head','head')),neckPosition=pointOf(find('Neck','Bip01_Neck','neck_01'));
 const arms=[],legs=[];
 for(const [side,letter,suffix] of [['Left','L','l'],['Right','R','r']]){
  arms.push([find(side+'Arm',`Bip01_${letter}_UpperArm`,`upperarm_${suffix}`),find(side+'ForeArm',`Bip01_${letter}_Forearm`,`lowerarm_${suffix}`),find(side+'Hand',`Bip01_${letter}_Hand`,`hand_${suffix}`)].map(pointOf));
  legs.push([find(side+'UpLeg',`Bip01_${letter}_Thigh`,`thigh_${suffix}`),find(side+'Leg',`Bip01_${letter}_Calf`,`calf_${suffix}`),find(side+'Foot',`Bip01_${letter}_Foot`,`foot_${suffix}`)].map(pointOf));
 }
 function along(point,chains){let best=Infinity,result=0;for(const chain of chains){const lengths=[chain[0].distanceTo(chain[1]),chain[1].distanceTo(chain[2])],total=lengths[0]+lengths[1];for(let segment=0;segment<2;segment++){const delta=chain[segment+1].clone().sub(chain[segment]),t=point.clone().sub(chain[segment]).dot(delta)/delta.lengthSq(),nearest=chain[segment].clone().addScaledVector(delta,THREE.MathUtils.clamp(t,0,1)),distance=point.distanceToSquared(nearest);if(distance<best){best=distance;result=((segment?lengths[0]:0)+t*lengths[segment])/total}}}return result}
 const imageCache=new Map(),samples={top:[],bottom:[],shoe:[]},armSamples=[],legSamples=[],hemSamples=[],collarSamples=[];
 function imageData(texture){if(!texture?.image)return null;if(!imageCache.has(texture)){const image=texture.image,canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);imageCache.set(texture,{pixels:context.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height})}return imageCache.get(texture)}
 function colour(material,uv,index){const result=(material.color??new THREE.Color(1,1,1)).clone().convertLinearToSRGB(),texture=material.map,data=imageData(texture);if(!data||!uv)return [result.r,result.g,result.b];const point=new THREE.Vector2(uv.getX(index),uv.getY(index));texture.updateMatrix();point.applyMatrix3(texture.matrix);const x=THREE.MathUtils.clamp(Math.floor(point.x*data.width),0,data.width-1),y=THREE.MathUtils.clamp(Math.floor((texture.flipY?1-point.y:point.y)*data.height),0,data.height-1),offset=(y*data.width+x)*4;return [result.r*data.pixels[offset]/255,result.g*data.pixels[offset+1]/255,result.b*data.pixels[offset+2]/255]}
 root.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.visible)return;
  const original=mesh.geometry,geometry=original.index?original.toNonIndexed():original.clone(),count=geometry.attributes.position.count,rest=new Float32Array(count*3),weightsArray=new Float32Array(count*4),progressArray=new Float32Array(count*2),point=new THREE.Vector3();
  const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material],skinIndex=geometry.attributes.skinIndex,skinWeight=geometry.attributes.skinWeight;let group=0;
  for(let index=0;index<count;index++){
   while(group+1<geometry.groups.length&&index>=geometry.groups[group].start+geometry.groups[group].count)group++;
   const material=originals[geometry.groups[group]?.materialIndex??0]??originals[0],rgb=colour(material,geometry.attributes.uv,index);
   mesh.getVertexPosition(original.index?original.index.getX(index):index,point);point.applyMatrix4(mesh.matrixWorld);point.toArray(rest,index*3);
   const weights={head:0,arm:0,leg:0,foot:0,hand:0};
   if(mesh.isSkinnedMesh&&skinIndex)for(let component=0;component<4;component++){
    const name=mesh.skeleton.bones[skinIndex.getComponent(index,component)]?.name??'',weight=skinWeight.getComponent(index,component);
    if(/head|neck/i.test(name))weights.head+=weight;
    if(/^(Left|Right)(Arm|ForeArm|Hand|Finger)|^Bip01_[LR]_(UpperArm|Forearm|Hand|Finger)|^(upperarm|lowerarm|hand|thumb|index|middle|pinky|ring)_/i.test(name))weights.arm+=weight;
    if(/hand|finger|thumb|index_|middle_|pinky_|ring_/i.test(name))weights.hand+=weight;
    if(/foot|toe|ball_/i.test(name))weights.foot+=weight;
    if(/thigh|upleg|shin|calf|^(Left|Right)Leg/i.test(name))weights.leg+=weight;
   }
   weightsArray.set([weights.head,weights.arm,weights.leg,weights.foot],index*4);
   const armProgress=along(point,arms),legProgress=along(point,legs);progressArray.set([armProgress,legProgress],index*2);
   const warm=rgb[0]>rgb[1]*1.08&&rgb[0]<rgb[1]*1.9&&rgb[0]>rgb[2]*1.12&&rgb[0]>.18,skin=warm||weights.hand>.5;
   if(warm&&weights.arm<.2&&Math.abs(point.x-headPosition.x)<height*.05&&point.z>headPosition.z&&point.y>neckPosition.y-height*.12&&point.y<neckPosition.y+height*.025)collarSamples.push(point.y);
   if(weights.arm>.7)armSamples.push({progress:armProgress,skin});
   if(weights.leg>.7)legSamples.push({progress:legProgress,skin});
   const region=skin?'skin':weights.head>.5?'hair':weights.foot>.5?'shoe':weights.leg>.4||point.y<height*.49?'bottom':'top';
   if(samples[region])samples[region].push(rgb[0]*.299+rgb[1]*.587+rgb[2]*.114);
   if((region==='top'||region==='bottom')&&weights.arm<.2&&Math.abs(point.x)<height*.13&&point.y>height*.4&&point.y<height*.65)hemSamples.push({y:point.y,top:region==='top'});
  }
  geometry.setAttribute('candidateRest',new THREE.BufferAttribute(rest,3));geometry.setAttribute('candidateParts',new THREE.BufferAttribute(weightsArray,4));geometry.setAttribute('candidateProgress',new THREE.BufferAttribute(progressArray,2));
  parts.push({mesh,geometry,originalGeometry:original,originalMaterial:mesh.material,originals,originalVisible:mesh.visible});
 });
 for(const region of ['top','bottom','shoe'])if(samples[region].length){const median=quantile(samples[region],.6,.5);palette[region]=median<.13?.025:median<.35?.12:median<.58?.32:median<.78?.60:.88}
 const sleeves=fitSkinInterval(armSamples,[1.01,1.1]),legInterval=fitSkinInterval(legSamples,[1.03,1.04]);
 let hem=height*.51,best=Infinity;for(let i=0;i<=64;i++){const y=height*(.43+i/64*.17);let error=0;for(const sample of hemSamples)if((sample.y>=y)!==sample.top)error++;if(error<best){best=error;hem=y}}
 const collarBottom=neckline==='v'?neckPosition.y-height*.075:THREE.MathUtils.clamp(quantile(collarSamples,.08,neckPosition.y-height*.035),neckPosition.y-height*.12,neckPosition.y-height*.015),vNeck=neckline==='v'||(neckline!=='crew'&&neckPosition.y-collarBottom>height*.05);
 const boundaries={collarBottom,vNeck,sleeve:sleeves[0],trouser:legInterval[0],shoe:legInterval[1],hem,head:headPosition.toArray(),neck:neckPosition.toArray(),height};
 for(const part of parts){
  part.faceDetail=/eye|gland|teeth/i.test(part.mesh.name);
  part.materials=part.originals.map(source=>{
   const hair=/hair|wig|bob|braid|ponytail/i.test(source.name+' '+part.mesh.name)&&!/eyebrow/i.test(source.name+' '+part.mesh.name);
   const material=new THREE.MeshBasicMaterial({color:0xffffff,map:source.transparent||source.alphaTest?source.map:null,alphaMap:source.alphaMap??null,transparent:source.transparent,opacity:source.opacity,alphaTest:source.alphaTest,side:source.side,depthWrite:source.depthWrite});
   material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec3 candidateRest; attribute vec4 candidateParts; attribute vec2 candidateProgress; varying vec3 restPoint; varying vec4 bodyParts; varying vec2 limbProgress;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nrestPoint=candidateRest;bodyParts=candidateParts;limbProgress=candidateProgress;');
    shader.fragmentShader='varying vec3 restPoint; varying vec4 bodyParts; varying vec2 limbProgress; uniform vec4 regionPalette; uniform float shoePalette; uniform vec4 seams; uniform vec3 headPoint; uniform vec3 neckPoint; uniform float bodyHeight; uniform float isHair; uniform vec2 collar; uniform float isFaceDetail;\n'+shader.fragmentShader;
    Object.assign(shader.uniforms,{regionPalette:{value:new THREE.Vector4(palette.skin,palette.hair,palette.top,palette.bottom)},shoePalette:{value:palette.shoe},seams:{value:new THREE.Vector4(boundaries.sleeve,boundaries.trouser,boundaries.shoe,hem)},headPoint:{value:headPosition},neckPoint:{value:neckPosition},bodyHeight:{value:height},isHair:{value:hair?1:0},collar:{value:new THREE.Vector2(collarBottom,vNeck?1:0)},isFaceDetail:{value:part.faceDetail?1:0}});
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
     float torso=max(0.0,1.0-dot(bodyParts,vec4(1.0))),weight=torso,part=0.0;
     if(bodyParts.x>weight){weight=bodyParts.x;part=1.0;}if(bodyParts.y>weight){weight=bodyParts.y;part=2.0;}if(bodyParts.z>weight){weight=bodyParts.z;part=3.0;}if(bodyParts.w>weight){part=4.0;}
     float grey=restPoint.y>=seams.w?regionPalette.z:regionPalette.w;
     if(part==1.0){
      float front=smoothstep(-bodyHeight*.025,bodyHeight*.025,restPoint.z-headPoint.z);
      float line=mix(headPoint.y-bodyHeight*.015,headPoint.y+bodyHeight*.045,front);
      grey=restPoint.y>=line?regionPalette.y:regionPalette.x;
     }else if(part==2.0){grey=limbProgress.x<seams.x?regionPalette.z:regionPalette.x;
     }else if(part==3.0){grey=limbProgress.y<seams.y?regionPalette.w:limbProgress.y<seams.z?regionPalette.x:shoePalette;
     }else if(part==4.0){grey=shoePalette;
     }else{
      float collarBottom=collar.x,level=clamp((restPoint.y-collarBottom)/(neckPoint.y-collarBottom),0.0,1.0);
      float opening=bodyHeight*.048*(collar.y>.5?level:sqrt(level));
      bool frontCollar=restPoint.z>headPoint.z && restPoint.y>collarBottom && abs(restPoint.x-headPoint.x)<opening;
      bool neck=restPoint.y>neckPoint.y-bodyHeight*.018 && abs(restPoint.x-headPoint.x)<bodyHeight*.045;
      if(frontCollar||neck)grey=regionPalette.x;
     }
     if(isHair>.5)grey=regionPalette.y;
     if(isFaceDetail>.5)grey=regionPalette.x;
     diffuseColor.rgb=vec3(grey);
    `);
   };
   material.customProgramCacheKey=()=> 'candidate-fitted-boundaries-v3';return material;
  });
 }
 let active=false;
 function enable(value){active=value;for(const part of parts){part.mesh.geometry=value?part.geometry:part.originalGeometry;part.mesh.material=value?(part.materials.length===1?part.materials[0]:part.materials):part.originalMaterial;part.mesh.visible=part.originalVisible}}
 return {setAngle(){},enable,palette,boundaries,get active(){return active},dispose(){enable(false);for(const part of parts){part.geometry.dispose();part.materials.forEach(material=>material.dispose())}}};
}
