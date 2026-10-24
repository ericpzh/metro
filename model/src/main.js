import {createInteractionArms} from './animation/interaction-arms.js';
import {INTERACTIONS,createInteractionPoser} from './animation/interactions.js';
import {createInteractionEquipment} from './interaction-equipment.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {MODEL_LIBRARY,BAG_CHOICES,isBackpack,modelEligible} from './characters/library.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {t,setLanguage} from './i18n.js';
import {appearanceSizeRanges,constrainAppearance,previewScale,randomAppearance,sizePercent,sizeRanges} from './preview-appearance.js';
import './style.css';
import {applyPassengerCarryPose} from './animation/carry-pose.js';
import {HAIR_CHOICES,supportsBackpack} from './characters/hairstyles.js';
import {OUTFITS,outfitFor,applyOutfit} from './characters/outfits.js';

const $=selector=>document.querySelector(selector),params=new URL(location.href).searchParams;
const hairstyles=HAIR_CHOICES;
const character=params.get('character')==='male'?'male':'female';
const age=params.get('age')==='child'?'child':'adult';
const bagStyles=BAG_CHOICES.map(([value])=>value).filter(value=>value!=='0'&&value!=='1');
const bagStyleFromValue=value=>bagStyles.includes(value)?value:'standard';
const bagValue=()=>state.bag?(state.bagStyle==='standard'?'1':state.bagStyle):'0';
const state={age,character,outfit:outfitFor(character,params.get('outfit'))?params.get('outfit'):'original',hair:hairstyles[character].includes(params.get('hair'))?params.get('hair'):hairstyles[character][0],bag:params.get('bag')!=='0',bagStyle:bagStyleFromValue(params.get('bag')),size:Object.fromEntries(Object.keys(sizeRanges).map(axis=>[axis,sizePercent(axis,params.get(axis),age)])),profile:1,walking:true,standing:false};
state.swapTones=params.get('tones')==='swapped';
function constrainOutfit(){if(!outfitFor(state.character,state.outfit))state.outfit='original';if(state.outfit!=='original')state.bag=false}
constrainOutfit();
constrainAppearance(state);
const asset=name=>`${import.meta.env.BASE_URL}models/${name}`;
$('#site-link').href=import.meta.env.VITE_WEB_URL??'http://localhost:5173/';$('#game-link').href=import.meta.env.VITE_GAME_URL??'http://localhost:5174/';
$('#reference').src=asset('reference.png');
const host=$('#view'),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;host.append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minZoom=.4;controls.maxZoom=6;controls.autoRotateSpeed=1.1;
const ground=new THREE.Mesh(new THREE.CircleGeometry(.55,64),new THREE.MeshBasicMaterial({color:0xd8dad5,transparent:true,opacity:.5}));ground.rotation.x=-Math.PI/2;ground.position.y=-.01;scene.add(ground);
new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.left=-1.25*w/h;camera.right=1.25*w/h;camera.top=1.25;camera.bottom=-1.25;camera.updateProjectionMatrix()}).observe(host);
const views={front:[0,1,5],three:[3,1.35,4],side:[5,1,0],back:[0,1,-5]};
function setView(view){camera.position.set(...views[view]);camera.zoom=1;camera.updateProjectionMatrix();controls.target.set(0,1,0);controls.update();document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.view===view))}
setView('front');document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>setView(button.dataset.view));
let model,mixer,clips=[],loadId=0,loading=true,failed=false,interactionPoser,interactionArms,interactionTime=0;
const equipment=createInteractionEquipment(scene);
const queue=new THREE.Group();scene.add(queue);let queuePosers=[];
function refreshQueue(){queue.clear();queuePosers=[];if(!model)return;for(let i=0;i<3;i++){const passenger=cloneSkinned(model);passenger.position.set(0,0,0);queue.add(passenger);queuePosers.push(createInteractionPoser(passenger));}}
state.action=INTERACTIONS.some(a=>a[0]===params.get('action'))?params.get('action'):'walk';
scene.add(new THREE.HemisphereLight(0xffffff,0x8a9299,2.4));
const keyLight=new THREE.DirectionalLight(0xffffff,3);keyLight.position.set(3,6,4);scene.add(keyLight);
function refreshActions(){
 const zh=document.documentElement.lang==='zh';
 $('#action').replaceChildren(...[['walk','Walk','行走'],...INTERACTIONS].map(a=>{const option=document.createElement('option');option.value=a[0];option.textContent=a[zh?2:1];return option}));
 $('#action').value=state.action;$('#action-label').textContent=zh?'乘客动作':'Passenger activity';
 $('#timeline-label').textContent=zh?'动作时间轴':'Activity timeline';
 $('#play').textContent=state.walking?(zh?'暂停':'Pause'):(zh?'播放':'Play');
 $('#interaction-note').textContent=zh?'乘客互动动作预览。游戏中的时长和手势会随行程变化。':'Passenger activity preview. Game timing and optional gestures vary with each journey.';
}
function updateInteraction(){if(!model||state.action==='walk')return;interactionArms?.setEnabled(true);equipment.select(state.action);const f=interactionPoser(state.action,interactionTime,equipment.anchors(state.action,interactionTime));equipment.update(state.action,f.t,model);queue.visible=state.action==='queue';if(queue.visible)queue.children.forEach((n,i)=>{queuePosers[i]('queue',interactionTime+i*1.7);n.position.set(i%2?.65:0,0,-.8*(1+Math.floor(i/2)));});$('#timeline').max=f.duration;$('#timeline').value=f.t;$('#activity-phase').textContent=(document.documentElement.lang==='zh'?({'Approach':'准备','Reach / settle':'伸手 / 坐下','Interact / wait':'互动 / 等候','Release / leave':'收手 / 离开'}[f.phase]):f.phase)+' · '+f.t.toFixed(1)+' / '+f.duration+' s';}
function selectActivity(id){state.action=id;interactionTime=0;queue.visible=false;if(model){model.position.set(0,0,0);model.rotation.set(0,0,0);}if(id==='walk'){equipment.root.visible=false;playProfile();setView('front')}else{state.standing=false;mixer?.stopAllAction();equipment.root.visible=true;camera.position.set(3,2.4,-4);controls.target.set(0,1,.3);camera.zoom=.8;camera.updateProjectionMatrix();controls.update();updateInteraction();refresh()}const url=new URL(location.href);url.searchParams.set('action',id);history.replaceState(null,'',url);}
$('#action').onchange=e=>selectActivity(e.target.value);
$('#timeline').oninput=e=>{state.walking=false;interactionTime=Number(e.target.value);updateInteraction();refresh()};
function filename(){return MODEL_LIBRARY.find(model=>!model.outfit&&model.character===state.character&&model.hair===state.hair&&model.bag===state.bag&&(!state.bag||(model.bagStyle??'standard')===state.bagStyle)).file}
function refresh(){
 $('#age').value=state.age;
 for(const option of $('#character').options)option.textContent=t(state.age==='child'?(option.value==='male'?'boy':'girl'):option.value);
 $('#hair').replaceChildren(...hairstyles[state.character].filter(style=>state.age!=='child'||style!=='bald').map(style=>{const option=document.createElement('option');option.value=style;option.textContent=t(style);return option}));
 $('#bag').replaceChildren(...BAG_CHOICES.filter(([value])=>value==='0'||MODEL_LIBRARY.some(model=>model.character===state.character&&(model.bagStyle??'standard')===(value==='1'?'standard':value)&&model.bag&&modelEligible(model,state.age))).map(([value,key])=>{const option=document.createElement('option');option.value=value;option.textContent=t(key);return option}));
 $('#character').value=state.character;$('#hair').value=state.hair;$('#bag').value=bagValue();$('#profile').value=String(state.profile);
 $('#outfit').replaceChildren(...['original',...OUTFITS[state.character].map(outfit=>outfit.id)].map(id=>{const option=document.createElement('option');option.value=id;option.textContent=t(id==='original'?'originalOutfit':`outfit-${id}`);return option}));
 $('#outfit').value=state.outfit;
 $('#swap-tones').disabled=state.outfit==='original';$('#swap-tones').setAttribute('aria-pressed',state.swapTones);
 $('#bag').disabled=state.outfit!=='original';
 $('#outfit-hint').textContent=t('outfitHint');
 $('#variant-hint').textContent=state.outfit!=='original'?'':t(state.age==='child'?'childHint':state.character==='male'?'maleHint':'longHint');
 for(const [axis,range] of Object.entries(appearanceSizeRanges(state.age))){const input=$('#'+axis);input.min=Math.round(range[0]*100);input.max=Math.round(range[1]*100);input.value=state.size[axis];$('#'+axis+'-value').value=state.size[axis]+'%'}
 $('#play').textContent=t(state.walking?'pause':'play');$('#play').setAttribute('aria-pressed',state.walking);$('#stand').setAttribute('aria-pressed',state.standing);
 $('#download').href=asset(filename());$('#download').setAttribute('aria-disabled',loading||failed);$('#status').textContent=failed?t('failed'):loading?t('loading'):'';
 refreshActions();$('#reference').alt=t('reference');renderer.domElement.setAttribute('aria-label',t('viewLabel'));
 const url=new URL(location.href);url.searchParams.set('character',state.character);url.searchParams.set('hair',state.hair);url.searchParams.set('bag',bagValue());url.searchParams.set('lang',document.documentElement.lang);
 url.searchParams.set('action',state.action);url.searchParams.set('age',state.age);for(const axis of Object.keys(sizeRanges))url.searchParams.set(axis,state.size[axis]);history.replaceState(null,'',url);
 if(state.outfit==='original')url.searchParams.delete('outfit');else url.searchParams.set('outfit',state.outfit);if(state.swapTones)url.searchParams.set('tones','swapped');else url.searchParams.delete('tones');history.replaceState(null,'',url);
}
function applySize(){const [width,height,depth]=previewScale(state);model?.scale.set(width,height,depth);queue.children.forEach(n=>n.scale.set(width,height,depth));ground.scale.set(width,depth,1);model?.updateMatrixWorld(true)}
function updateAppearance(){constrainAppearance(state);applySize();refresh()}
function playProfile(){if(!mixer)return;state.action='walk';interactionArms?.setEnabled(false);queue.visible=false;equipment.root.visible=false;model.position.set(0,0,0);model.rotation.set(0,0,0);mixer.stopAllAction();mixer.clipAction(clips[state.profile]).play();state.standing=false;refresh()}
function stand(){if(!model)return;state.action='walk';interactionArms?.setEnabled(false);queue.visible=false;equipment.root.visible=false;model.position.set(0,0,0);model.rotation.set(0,0,0);state.walking=false;state.standing=true;mixer.stopAllAction();let skeleton;model.traverse(mesh=>{if(mesh.isSkinnedMesh)skeleton=mesh.skeleton});skeleton.pose();applyPassengerCarryPose(model);model.updateMatrixWorld(true);skeleton.update();refresh()}
function disposeModel(previous){previous.traverse(mesh=>{if(!mesh.isMesh)return;mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose()})}
async function loadModel(){
 constrainOutfit();
 constrainAppearance(state);
 const id=++loadId;loading=true;failed=false;refresh();
 try{
  const gltf=await new GLTFLoader().loadAsync(asset(filename()));
  if(id!==loadId){disposeModel(gltf.scene);return}
  if(state.outfit!=='original')applyOutfit(gltf.scene,state.character,state.outfit,{swapTones:state.swapTones,animations:gltf.animations});
  if(model){interactionArms?.dispose();mixer.stopAllAction();mixer.uncacheRoot(model);scene.remove(model);disposeModel(model)}
  model=gltf.scene;clips=gltf.animations;mixer=new THREE.AnimationMixer(model);scene.add(model);applySize();interactionArms=createInteractionArms(model);interactionPoser=createInteractionPoser(model);refreshQueue();loading=false;
  if(state.action!=='walk'){selectActivity(state.action)}else if(state.standing)stand();else playProfile();refresh();window.__modelReady=true;
 }catch(error){if(id!==loadId)return;loading=false;failed=true;refresh();console.error(error)}
}
$('#age').onchange=e=>{state.age=e.target.value;updateAppearance();loadModel()};
$('#character').onchange=e=>{state.character=e.target.value;state.hair=hairstyles[state.character][0];constrainAppearance(state);loadModel()};
$('#hair').onchange=e=>{state.hair=e.target.value;if(!supportsBackpack(state.character,state.hair)&&isBackpack(state.bagStyle))state.bag=false;loadModel()};
$('#outfit').onchange=e=>{state.outfit=e.target.value;loadModel()};
$('#swap-tones').onclick=()=>{state.swapTones=!state.swapTones;loadModel()};
$('#bag').onchange=e=>{state.bag=e.target.value!=='0';state.bagStyle=bagStyleFromValue(e.target.value);if(state.bag&&!supportsBackpack(state.character,state.hair)&&isBackpack(state.bagStyle))state.hair='shoulder';loadModel()};
for(const axis of Object.keys(sizeRanges))$('#'+axis).oninput=e=>{state.size[axis]=sizePercent(axis,e.target.value,state.age);applySize();refresh()};
$('#reset-size').onclick=()=>{for(const axis of Object.keys(sizeRanges))state.size[axis]=sizePercent(axis,null,state.age);applySize();refresh()};
$('#randomize').onclick=()=>{Object.assign(state,randomAppearance());updateAppearance();loadModel()};
$('#download').onclick=async event=>{
 if(state.outfit==='original')return;
 event.preventDefault();if(loading||failed||!model)return;
 const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
 const selected=model,scale=selected.scale.clone(),wasStanding=state.standing,time=mixer.time,activity=state.action,activityTime=interactionTime,position=selected.position.clone(),quaternion=selected.quaternion.clone();
 // Export the base template with its real rig and all three clips. Display size
 // is a preview transform, matching the existing approved GLB downloads.
 mixer.stopAllAction();let skeleton;selected.traverse(mesh=>{if(mesh.isSkinnedMesh)skeleton=mesh.skeleton});
 interactionArms?.setEnabled(false);skeleton.pose();selected.position.set(0,0,0);selected.quaternion.identity();selected.scale.setScalar(1);selected.updateMatrixWorld(true);skeleton.update();
 try{
  const bytes=await new GLTFExporter().parseAsync(selected,{binary:true,animations:clips,onlyVisible:true});
  const url=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'})),link=document.createElement('a');
  link.href=url;link.download=`passenger-${state.character}-${state.hair}-${state.outfit}${state.swapTones?'-swapped':''}-walk.glb`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){console.error(error);$('#status').textContent=t('exportFailed')}
 finally{selected.position.copy(position);selected.quaternion.copy(quaternion);selected.scale.copy(scale);if(selected===model){if(activity!=='walk'){selectActivity(activity);interactionTime=activityTime;updateInteraction()}else if(wasStanding)stand();else{playProfile();mixer.setTime(time)}}}
};
$('#profile').onchange=e=>{state.profile=Number(e.target.value);playProfile()};
$('#play').onclick=()=>{if(state.standing)playProfile();state.walking=!state.walking;refresh()};$('#stand').onclick=stand;
$('#rotate').onclick=e=>{controls.autoRotate=!controls.autoRotate;e.target.setAttribute('aria-pressed',controls.autoRotate)};
$('#language').onchange=e=>{setLanguage(e.target.value);refresh()};setLanguage(params.get('lang'));$('#language').value=document.documentElement.lang;refresh();
window.__modelPreview={renderer,scene,camera,controls,state,setView,stand,selectActivity,equipment,setInteractionTime:time=>{interactionTime=time;updateInteraction()},get model(){return model},get mixer(){return mixer},get clips(){return clips},get loading(){return loading},setTime:time=>{mixer.setTime(time);model.updateMatrixWorld(true);model.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.update()})}};
await loadModel();let previous=0;renderer.setAnimationLoop(now=>{const dt=previous?Math.min((now-previous)/1000,.05):0;previous=now;if(state.action!=='walk'){if(state.walking)interactionTime+=dt;updateInteraction()}else if(mixer&&state.walking&&!state.standing)mixer.update(dt);controls.update();renderer.render(scene,camera)});
