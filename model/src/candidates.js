import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createLibraryMotion} from './animation/candidate-library-motion.js';
import {createCandidateMotion,CANDIDATE_MOTIONS} from './animation/candidate-motion.js';
import {createCandidateIllustration} from './candidate-illustration.js';
import {captureDirections} from './candidate-snapshots.js';
import {createCandidateSmoother} from './candidate-smooth.js';
import {CANDIDATES as entries} from './candidate-catalog.js';
import './style.css';
import './candidates.css';

const $=s=>document.querySelector(s),url=new URL(location.href),base=import.meta.env.BASE_URL;
let lang=url.searchParams.get('lang')==='zh'?1:0;
let selected=entries.find(e=>e.id===url.searchParams.get('candidate'))??entries[0];
let mode=['animated','minimalist','compare','source','sprite'].includes(url.searchParams.get('mode'))?url.searchParams.get('mode'):'animated';
let picks=new Set();try{picks=new Set(JSON.parse(localStorage.getItem('metro-human-picks')??'[]').filter(id=>entries.some(e=>e.id===id)))}catch{}
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;$('#view').append(renderer.domElement);
const smoother=createCandidateSmoother(renderer);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.01,100),controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.target.set(0,.9,0);controls.autoRotateSpeed=1;
scene.add(new THREE.HemisphereLight(0xffffff,0x8a9299,2.4));
const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,6,4);scene.add(light);
const ground=new THREE.Mesh(new THREE.CircleGeometry(.7,64),new THREE.MeshBasicMaterial({color:0xd8dad5,transparent:true,opacity:.5}));
ground.userData.studyGround=true;ground.rotation.x=-Math.PI/2;ground.position.y=-.015;scene.add(ground);
const illustrationCamera=new THREE.OrthographicCamera(-1.225,1.225,1.225,-1.225,.01,100);
let motion,illustration,motionId='medium',motionTime=0,motionPlaying=true,motionReport;
const spriteId='valid-Asian_F_3_Casual',spriteCycle=32/30;let spriteTime=0,spritePlaying=true,spriteAngle=2,spriteElevation='normal',spriteQuality='smooth';
// Register each generated image by its dark hair and overall visible height.
// The source art remains untouched; this avoids jumps from generator layout drift.
function spriteAnchors(image,rows){const cell=image.naturalWidth/4,canvas=document.createElement('canvas');canvas.width=Math.round(cell);const ctx=canvas.getContext('2d'),anchors=[];for(let i=0;i<(rows.length-1)*4;i++){const row=Math.floor(i/4),rowHeight=rows[row+1]-rows[row];canvas.height=rowHeight;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,i%4*cell,rows[row],cell,rowHeight,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let top=canvas.height,bottom=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>128){top=Math.min(top,y);bottom=Math.max(bottom,y)}let sx=0,count=0;for(let y=top;y<Math.min(bottom,top+canvas.width*.18);y++)for(let x=0;x<canvas.width;x++){const p=(y*canvas.width+x)*4;if(pixels[p+3]>128&&pixels[p]<100&&pixels[p+1]<100&&pixels[p+2]<100){sx+=x;count++}}anchors.push({x:count?sx/count:canvas.width/2,top,height:Math.max(1,bottom-top),size:canvas.width})}return anchors}
// The generated figures can extend past nominal grid lines; cut through the
// empty gaps between rows instead, so shoes stay in their own frames.
const spriteRows={0:[0,321,626,933,1254],2:[0,349,663,972,1254],4:[0,337,645,955,1254],8:[0,336,639,944,1254],low:[0,324,634,945,1254],high:[0,336,630,926,1254]};
const spriteSheets=new Map(),spriteRife=new Map();
function spriteKey(){return spriteElevation==='normal'?spriteAngle:spriteElevation}
function ensureSpriteSheets(){if(spriteSheets.size)return;for(const key of [0,2,4,8,'low','high']){const image=new Image(),rows=spriteRows[key],sheet={image,rows,anchors:null};spriteSheets.set(key,sheet);image.onload=()=>{sheet.anchors=spriteAnchors(image,rows);sheet.height=sheet.anchors.map(a=>a.height).sort((a,b)=>a-b)[8];drawSprite()};image.src=base+`human-candidates/animation-studies/valid-Asian_F_3_Casual-walk-16-angle-${typeof key==='number'?key:'2-'+key}.png`;const interpolated=new Image();spriteRife.set(key,interpolated);interpolated.onload=drawSprite;interpolated.src=base+`human-candidates/animation-studies/valid-Asian_F_3_Casual-walk-rife32-${typeof key==='number'?key+'-normal':'2-'+key}.png`}}
function spriteFrames(){return spriteQuality==='smooth'?32:16}
function spriteAsset(){return spriteQuality==='smooth'?spriteRife.get(spriteKey()):spriteSheets.get(spriteKey())?.image}
function drawSprite(){const canvas=$('#sprite-canvas'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);const count=spriteFrames(),frame=Math.min(count-1,Math.floor(spriteTime/spriteCycle*count)),sheet=spriteSheets.get(spriteKey());$('#sprite-timeline').max=count-1;$('#sprite-timeline').value=frame;if(selected.id!==spriteId)return;if(spriteQuality==='smooth'){const image=spriteAsset();if(image?.complete&&image.naturalWidth)ctx.drawImage(image,frame%8*512,Math.floor(frame/8)*512,512,512,0,0,512,512);return}if(!sheet?.anchors)return;const image=sheet.image,row=Math.floor(frame/4),cell=image.naturalWidth/4,rowHeight=sheet.rows[row+1]-sheet.rows[row],{x,top,size}=sheet.anchors[frame],isHigh=spriteElevation==='high',scale=size*(isHigh ? .57 : .79)/sheet.height,dx=(size*.49-x*scale)/size*canvas.width,dy=(size*(isHigh ? .25 : .146)-top*scale)/size*canvas.height;ctx.drawImage(image,frame%4*cell,sheet.rows[row],cell,rowHeight,dx,dy,canvas.width*scale,canvas.height*scale*rowHeight/size)}
let root,mixer,clips=[],action,request=0,playing=false,ready=false,angle=0,rotating=false,rotationTime=0;
const views={front:[0,1.1,4.2],three:[2.8,1.4,3.2],side:[4.2,1.1,0],back:[0,1.1,-4.2]};
function setAngle(value){angle=(Number(value)+16)%16;$('#study-angle').value=angle;$('#live-angle').value=angle;illustration?.setAngle(angle);const azimuth=angle*Math.PI/8;illustrationCamera.position.set(Math.sin(azimuth)*4,.875+1.3,Math.cos(azimuth)*4);illustrationCamera.lookAt(0,.875,0);$('#study-degrees').value=`${angle*22.5}°`;for(const id of ['study-original','study-clean'])$('#'+id).style.backgroundPosition=`${angle%4/3*100}% ${Math.floor(angle/4)/3*100}%`}
function view(id){if(mode==='source'){camera.position.set(...views[id]);controls.target.set(0,.9,0);controls.update()}else setAngle({front:0,three:2,side:4,back:8}[id])}
camera.position.set(...views.three);controls.update();
new ResizeObserver(()=>{const host=$('#view');renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();illustrationCamera.left=-1.225*camera.aspect;illustrationCamera.right=1.225*camera.aspect;illustrationCamera.updateProjectionMatrix()}).observe($('#view'));
function dispose(object){const geometries=new Set(),materials=new Set(),textures=new Set();object.traverse(n=>{if(!n.isMesh)return;geometries.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:[n.material]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v)}if(n.isSkinnedMesh)n.skeleton.dispose()});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())}
const sheet=(entry,kind)=>`${base}human-candidates/studies/${entry.id}-${kind}.png`;
function presentation(){
 if(mode==='sprite'){ensureSpriteSheets();$('#sprite-sheet').href=spriteAsset().src}
 $('#render-mode').value=mode;$('#image-study').hidden=mode==='source'||mode==='animated'||mode==='sprite';$('#sprite-study').hidden=mode!=='sprite';$('#sprite-controls').hidden=selected.id!==spriteId;$('#sprite-canvas').hidden=selected.id!==spriteId;$('#motion-controls').hidden=mode!=='animated'&&mode!=='source';$('#live-angle').hidden=mode!=='animated';illustration?.enable(mode==='animated');$('#source-controls').hidden=mode!=='source';
 document.querySelectorAll('[data-view],#rotate').forEach(button=>button.disabled=mode==='sprite');
 $('#sprite-description').textContent=selected.id===spriteId?(lang?'实验：32 帧行走循环。':'Experiment: 32-frame walking cycle.'):(lang?'此实验目前仅适用于 VALID 女性 3。':'This experiment is currently available for VALID woman 3.');drawSprite();
 $('#image-study').classList.toggle('comparison',mode==='compare');controls.autoRotate=mode==='source'&&rotating;
 $('#study-original').style.backgroundImage=`url("${sheet(selected,'original')}")`;
 $('#study-clean').style.backgroundImage=`url("${sheet(selected,'minimalist')}")`;
 $('#original-sheet').href=sheet(selected,'original');$('#clean-sheet').href=sheet(selected,'minimalist');
 $('#study-name').textContent=selected.name[lang];$('#image-study').style.setProperty('--body-scale',(selected.height??1.75)/1.75);setAngle(angle);
}
function text(){document.documentElement.lang=lang?'zh':'en';$('#language').value=lang?'zh':'en';for(const [id,en,zh] of [
 ['title','Minimalist passengers','极简乘客'],['intro','11 adults and 4 children. Faceless grayscale illustrations captured from 16 directions.','10 位成人与 4 位儿童。基于 16 个视角的无脸灰阶插画。'],
 ['candidate-label','Character','角色'],['mode-label','View','查看方式'],['angle-label','View angle','视角'],['animation-label','Source animation','原始动画'],['timeline-label','Animation timeline','动画时间轴'],['source','Original source ↗','原始来源 ↗'],['reset','Restart clip','重播动画'],
 ['note','Quaternius CC0 walk/idle animations drive the upper body through Three.js retargeting; foot IK preserves stance contact. Stable surface colours replace snapshot projection.','使用 Quaternius CC0 行走与待机动作及 Three.js 动作重定向驱动上半身，足部 IK 保持接地；表面颜色不再使用快照投射。'],
 ['orbit-hint','Use the angle slider or Rotate to inspect all 16 directions.','使用视角滑块或旋转按钮查看全部 16 个方向。'],['study-title','Faceless · grayscale · minimal lines','无脸 · 灰阶 · 极简线条'],['original-caption','Original 3D snapshot','原始三维快照'],['clean-caption','Minimalist grayscale','极简灰阶'],['original-sheet','Original contact sheet ↗','原始视角图集 ↗'],['clean-sheet','Grayscale contact sheet ↗','灰阶视角图集 ↗']])$('#'+id).textContent=lang?zh:en;
 if(mode==='sprite'){$('#note').textContent=lang?'预先生成的二维帧；此实验包含一个角色的四个视角。':'Pre-generated 2D frames; this experiment covers four views of one character.';$('#orbit-hint').textContent=lang?'切换视角时保持当前动作帧。':'Switch views without resetting the current frame.'}
 $('#candidate').replaceChildren(...entries.map(e=>new Option(e.name[lang],e.id)));$('#candidate').value=selected.id;
 $('#render-mode').replaceChildren(...[['animated','Animated grayscale','灰阶动画'],['sprite','Generated 2D walk experiment','生成的二维行走实验'],['minimalist','Minimalist grayscale','极简灰阶'],['compare','Compare with original','对比原始快照'],['source','Original 3D source','原始三维模型']].map(([value,en,zh])=>new Option(lang?zh:en,value)));
 $('#sprite-title').textContent=lang?'生成的二维行走实验':'Generated 2D walk experiment';$('#sprite-play').textContent=spritePlaying?(lang?'暂停':'Pause'):(lang?'播放':'Play');$('#sprite-angle-label').textContent=lang?'方向':'Direction';$('#sprite-elevation-label').textContent=lang?'高度':'Elevation';$('#sprite-phase-label').textContent=lang?'帧':'Frame';$('#sprite-sheet').textContent=lang?'查看图集 ↗':'View sprite sheet ↗';$('#sprite-sheet').href=spriteAsset()?.src??'';
 $('#motion').replaceChildren(...CANDIDATE_MOTIONS.map(item=>new Option(item.name[lang],item.id)));$('#motion').value=motionId;$('#motion-play').textContent=motionPlaying?(lang?'暂停动作':'Pause motion'):(lang?'播放动作':'Play motion');
 $('#description').textContent=selected.description[lang];$('#source').href=selected.source;
 $('#play').textContent=playing?(lang?'暂停':'Pause'):(lang?'播放':'Play');$('#pick').textContent=picks.has(selected.id)?(lang?'已保留 ✓（点击移除）':'Kept ✓ — click to remove'):(lang?'保留此角色':'Keep this character');$('#pick').setAttribute('aria-pressed',picks.has(selected.id));
 $('#picks').textContent=(lang?'已保留：':'Shortlist: ')+([...picks].map(id=>entries.find(e=>e.id===id)?.name[lang]).join(' · ')||(lang?'暂无':'None yet'));
 for(const id of ['animation','timeline','play','reset'])$('#'+id).disabled=!clips.length;$('#pick').disabled=!ready;
 const chosen=$('#animation').value;$('#animation').replaceChildren(...(clips.length?clips.map((clip,i)=>new Option(clip.name||`Clip ${i+1}`,String(i))):[new Option(lang?'无附带动画':'No bundled clips','')]));if(clips.length)$('#animation').value=chosen||'0';
 url.searchParams.delete('style');url.searchParams.delete('study');url.searchParams.set('candidate',selected.id);url.searchParams.set('mode',mode);url.searchParams.set('lang',lang?'zh':'en');history.replaceState(null,'',url);presentation();
}
function playClip(index){if(!mixer)return;mixer.stopAllAction();action=clips[index]?mixer.clipAction(clips[index]).reset().play():null;$('#timeline').value=0;}
async function load(){const id=++request,entry=selected;ready=false;clips=[];playing=false;$('#status').textContent=lang?'加载中…':'Loading…';text();
 let object;
 try{let animations=[];
  if(entry.kind==='gltf'){const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(base+entry.file);object=gltf.scene;animations=gltf.animations}
  else{
   const folder=base+entry.file.slice(0,entry.file.lastIndexOf('/')+1),manager=new THREE.LoadingManager();
   manager.setURLModifier(path=>/\.tga$/i.test(path)?folder+path.split(/[\\/]/).pop().replace(/\.tga$/i,'.png'):path);
   object=await new FBXLoader(manager).loadAsync(base+entry.file);
   const meshes=[];object.traverse(n=>{if(n.isMesh)meshes.push(n)});
   const high=meshes.filter(n=>/hipoly/i.test(n.name));if(high.length)for(const n of meshes)n.visible=high.includes(n);
   object.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material]){if(m.map)m.color.set(0xffffff);m.shininess=8;}});
  }
  // FBX geometry can resolve before its textures: capture only after all images decode.
  const images=new Set();object.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])for(const v of Object.values(m))if(v?.isTexture&&v.image?.decode)images.add(v.image)});
  await Promise.all([...images].map(image=>image.decode()));
  if(mode!=='source' && entry.studies!==false)await Promise.all(['original','minimalist'].map(async kind=>{const image=new Image();image.src=sheet(entry,kind);await image.decode()})).catch(()=>{});
  if(id!==request){dispose(object);return}
  object.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),scale=(entry.height??1.75)/size.y;
  const nextRoot=new THREE.Group(),offset=new THREE.Group();offset.position.set(-center.x,-bounds.min.y,-center.z);offset.add(object);nextRoot.scale.setScalar(scale);nextRoot.add(offset);
  const library=await createLibraryMotion(nextRoot,base);
  const nextMotion=createCandidateMotion(nextRoot,entry.height??1.75,library);
  const nextIllustration=await createCandidateIllustration(nextRoot,entry.height??1.75,{neckline:entry.neckline});
  if(id!==request){nextMotion.dispose();nextIllustration.dispose();dispose(nextRoot);return}
  if(root){motion?.dispose();illustration?.dispose();mixer?.stopAllAction();mixer?.uncacheRoot(root);scene.remove(root);dispose(root)}
  root=nextRoot;motion=nextMotion;illustration=nextIllustration;scene.add(root);clips=animations;mixer=new THREE.AnimationMixer(object);motionTime=0;playClip(0);ready=true;$('#status').textContent='';text();
 }catch(error){if(object&&object.parent!==root)dispose(object);if(id!==request)return;$('#status').textContent=(lang?'加载失败：':'Could not load: ')+error.message;console.error(error);text()}}
$('#candidate').onchange=e=>{selected=entries.find(x=>x.id===e.target.value);load()};
$('#render-mode').onchange=e=>{mode=e.target.value;if(mode==='source')motion?.reset();text()};
$('#motion').onchange=e=>{motionId=e.target.value;motionTime=0;playing=false};$('#motion-play').onclick=()=>{motionPlaying=!motionPlaying;text()};$('#motion-timeline').oninput=e=>{motionPlaying=false;motionTime=Number(e.target.value)*(CANDIDATE_MOTIONS.find(item=>item.id===motionId)?.cycleSeconds??6);motionReport=motion?.pose(motionId,motionTime);text()};
$('#sprite-play').onclick=()=>{spritePlaying=!spritePlaying;text()};$('#sprite-timeline').oninput=e=>{spritePlaying=false;spriteTime=(Number(e.target.value)+.001)/spriteFrames()*spriteCycle;drawSprite();text()};$('#sprite-angle').onchange=e=>{spriteAngle=Number(e.target.value);if(spriteAngle!==2){spriteElevation='normal';$('#sprite-elevation').value='normal'}drawSprite();text()};$('#sprite-elevation').onchange=e=>{spriteElevation=e.target.value;if(spriteElevation!=='normal'){spriteAngle=2;$('#sprite-angle').value='2'}drawSprite();text()};
$('#language').onchange=e=>{lang=e.target.value==='zh'?1:0;text()};
$('#study-angle').oninput=e=>setAngle(e.target.value);$('#live-angle').oninput=e=>setAngle(e.target.value);
$('#animation').onchange=e=>playClip(Number(e.target.value));$('#play').onclick=()=>{playing=!playing;if(playing)motionPlaying=false;text()};$('#reset').onclick=()=>playClip(Number($('#animation').value));
$('#timeline').oninput=e=>{playing=false;if(action)action.time=Number(e.target.value)*action.getClip().duration;mixer?.update(0);text()};
$('#pick').onclick=()=>{if(picks.has(selected.id))picks.delete(selected.id);else picks.add(selected.id);try{localStorage.setItem('metro-human-picks',JSON.stringify([...picks]))}catch{}text()};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>view(button.dataset.view));
$('#rotate').onclick=()=>{rotating=!rotating;$('#rotate').setAttribute('aria-pressed',rotating);presentation()};
function drawAnimated(){ground.visible=false;try{if(illustration)smoother.render(scene,illustrationCamera,illustration.palette);else renderer.render(scene,illustrationCamera)}finally{ground.visible=true}}
window.__candidatePreview={entries,renderer,scene,camera,drawAnimated,get spritePhase(){return spriteTime/spriteCycle},setSpriteSource(value){spriteQuality=value?'original':'smooth';drawSprite()},get spriteReady(){return spriteSheets.size===6&&[...spriteSheets.values()].every(sheet=>sheet.anchors)&&[...spriteRife.values()].every(image=>image.complete&&image.naturalWidth)},get ready(){return ready},get root(){return root},get clips(){return clips},get selected(){return selected},get mixer(){return mixer},get motion(){return motion},get illustration(){return illustration},get motionReport(){return motionReport},get illustrationCamera(){return illustrationCamera},poseMotion(id,time){motionId=id;motionTime=time;motionPlaying=false;motionReport=motion?.pose(id,time);return motionReport},captureOriginal(){illustration?.enable(false);motion?.reset();playing=false;mixer?.stopAllAction();root.updateMatrixWorld(true);return captureDirections(scene,selected.height??1.75)}};
let previous=0;renderer.setAnimationLoop(now=>{
 const dt=previous?Math.min((now-previous)/1000,.05):0;previous=now;
 if(mode==='animated'){
  if(ready){if(motionPlaying)motionTime+=dt;motionReport=motion?.pose(motionId,motionTime);const duration=CANDIDATE_MOTIONS.find(item=>item.id===motionId)?.cycleSeconds??6;$('#motion-timeline').value=(motionTime%duration)/duration;drawAnimated()}
 }else if(mode==='sprite'){
  if(spritePlaying)spriteTime=(spriteTime+dt)%spriteCycle;drawSprite();
 }else if(mode==='source'){
  if(ready){if(playing)mixer?.update(dt);else{if(motionPlaying)motionTime+=dt;motionReport=motion?.pose(motionId,motionTime)}}
  controls.update();renderer.render(scene,camera);
 }
 if(rotating&&mode!=='source'){rotationTime+=dt;if(rotationTime>=.3){rotationTime=0;setAngle(angle+1)}}
});
await load();
