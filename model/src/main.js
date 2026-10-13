import {MODEL_LIBRARY} from './characters/library.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {t,setLanguage} from './i18n.js';
import {appearanceSizeRanges,constrainAppearance,previewScale,randomAppearance,sizePercent,sizeRanges} from './preview-appearance.js';
import './style.css';

const $=selector=>document.querySelector(selector),params=new URL(location.href).searchParams;
const hairstyles={male:['original','short','bald'],female:['bob','shoulder','long']};
const character=params.get('character')==='male'?'male':'female';
const age=params.get('age')==='child'?'child':'adult';
const state={age,character,hair:hairstyles[character].includes(params.get('hair'))?params.get('hair'):hairstyles[character][0],bag:params.get('bag')!=='0',bagStyle:params.get('bag')==='small'?'small':'standard',size:Object.fromEntries(Object.keys(sizeRanges).map(axis=>[axis,sizePercent(axis,params.get(axis),age)])),profile:1,walking:true,standing:false};
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
let model,mixer,clips=[],loadId=0,loading=true,failed=false;
function filename(){return MODEL_LIBRARY.find(model=>model.character===state.character&&model.hair===state.hair&&model.bag===state.bag&&(!state.bag||(model.bagStyle??'standard')===state.bagStyle)).file}
function refresh(){
 $('#age').value=state.age;
 for(const option of $('#character').options)option.textContent=t(state.age==='child'?(option.value==='male'?'boy':'girl'):option.value);
 $('#hair').replaceChildren(...hairstyles[state.character].filter(style=>state.age!=='child'||style!=='bald').map(style=>{const option=document.createElement('option');option.value=style;option.textContent=t(style);return option}));
 $('#character').value=state.character;$('#hair').value=state.hair;$('#bag').value=state.bag?(state.bagStyle==='small'?'small':'1'):'0';$('#profile').value=String(state.profile);
 $('#bag').disabled=state.age==='child';
 $('#variant-hint').textContent=t(state.age==='child'?'childHint':state.character==='male'?'maleHint':'longHint');
 for(const [axis,range] of Object.entries(appearanceSizeRanges(state.age))){const input=$('#'+axis);input.min=Math.round(range[0]*100);input.max=Math.round(range[1]*100);input.value=state.size[axis];$('#'+axis+'-value').value=state.size[axis]+'%'}
 $('#play').textContent=t(state.walking?'pause':'play');$('#play').setAttribute('aria-pressed',state.walking);$('#stand').setAttribute('aria-pressed',state.standing);
 $('#download').href=asset(filename());$('#download').setAttribute('aria-disabled',loading||failed);$('#status').textContent=failed?t('failed'):loading?t('loading'):'';
 $('#reference').alt=t('reference');renderer.domElement.setAttribute('aria-label',t('viewLabel'));
 const url=new URL(location.href);url.searchParams.set('character',state.character);url.searchParams.set('hair',state.hair);url.searchParams.set('bag',state.bag?(state.bagStyle==='small'?'small':'1'):'0');url.searchParams.set('lang',document.documentElement.lang);
 url.searchParams.set('age',state.age);for(const axis of Object.keys(sizeRanges))url.searchParams.set(axis,state.size[axis]);history.replaceState(null,'',url);
}
function applySize(){const [width,height,depth]=previewScale(state);model?.scale.set(width,height,depth);ground.scale.set(width,depth,1);model?.updateMatrixWorld(true)}
function updateAppearance(){constrainAppearance(state);applySize();refresh()}
function playProfile(){if(!mixer)return;mixer.stopAllAction();mixer.clipAction(clips[state.profile]).play();state.standing=false;refresh()}
function stand(){if(!model)return;state.walking=false;state.standing=true;mixer.stopAllAction();let skeleton;model.traverse(mesh=>{if(mesh.isSkinnedMesh)skeleton=mesh.skeleton});skeleton.pose();model.updateMatrixWorld(true);skeleton.update();refresh()}
function disposeModel(previous){previous.traverse(mesh=>{if(!mesh.isMesh)return;mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose()})}
async function loadModel(){
 constrainAppearance(state);
 const id=++loadId;loading=true;failed=false;refresh();
 try{
  const gltf=await new GLTFLoader().loadAsync(asset(filename()));
  if(id!==loadId){disposeModel(gltf.scene);return}
  if(model){mixer.stopAllAction();mixer.uncacheRoot(model);scene.remove(model);disposeModel(model)}
  model=gltf.scene;clips=gltf.animations;mixer=new THREE.AnimationMixer(model);scene.add(model);applySize();loading=false;
  if(state.standing)stand();else playProfile();refresh();window.__modelReady=true;
 }catch(error){if(id!==loadId)return;loading=false;failed=true;refresh();console.error(error)}
}
$('#age').onchange=e=>{state.age=e.target.value;updateAppearance();loadModel()};
$('#character').onchange=e=>{state.character=e.target.value;state.hair=hairstyles[state.character][0];constrainAppearance(state);loadModel()};
$('#hair').onchange=e=>{state.hair=e.target.value;if(state.hair==='long')state.bag=false;loadModel()};
$('#bag').onchange=e=>{state.bag=e.target.value!=='0';state.bagStyle=e.target.value==='small'?'small':'standard';if(state.bag&&state.hair==='long')state.hair='shoulder';loadModel()};
for(const axis of Object.keys(sizeRanges))$('#'+axis).oninput=e=>{state.size[axis]=sizePercent(axis,e.target.value,state.age);applySize();refresh()};
$('#reset-size').onclick=()=>{for(const axis of Object.keys(sizeRanges))state.size[axis]=sizePercent(axis,null,state.age);applySize();refresh()};
$('#randomize').onclick=()=>{Object.assign(state,randomAppearance());updateAppearance();loadModel()};
$('#profile').onchange=e=>{state.profile=Number(e.target.value);playProfile()};
$('#play').onclick=()=>{if(state.standing)playProfile();state.walking=!state.walking;refresh()};$('#stand').onclick=stand;
$('#rotate').onclick=e=>{controls.autoRotate=!controls.autoRotate;e.target.setAttribute('aria-pressed',controls.autoRotate)};
$('#language').onchange=e=>{setLanguage(e.target.value);refresh()};setLanguage(params.get('lang'));$('#language').value=document.documentElement.lang;refresh();
window.__modelPreview={renderer,scene,camera,controls,state,setView,stand,get model(){return model},get mixer(){return mixer},get clips(){return clips},get loading(){return loading},setTime:time=>{mixer.setTime(time);model.updateMatrixWorld(true);model.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.update()})}};
await loadModel();let previous=0;renderer.setAnimationLoop(now=>{const dt=previous?Math.min((now-previous)/1000,.05):0;previous=now;if(mixer&&state.walking&&!state.standing)mixer.update(dt);controls.update();renderer.render(scene,camera)});
