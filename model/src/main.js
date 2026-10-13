import {MODEL_LIBRARY} from './characters/library.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {t,setLanguage} from './i18n.js';
import './style.css';

const $=selector=>document.querySelector(selector),params=new URL(location.href).searchParams;
const hairstyles={male:['original','short','bald'],female:['bob','shoulder','long']};
const character=params.get('character')==='male'?'male':'female';
const state={character,hair:hairstyles[character].includes(params.get('hair'))?params.get('hair'):hairstyles[character][0],bag:params.get('bag')!=='0',profile:1,walking:true,standing:false};
if(state.hair==='long')state.bag=false;
const asset=name=>`${import.meta.env.BASE_URL}models/${name}`;
$('#site-link').href=import.meta.env.VITE_WEB_URL??'http://localhost:5173/';$('#game-link').href=import.meta.env.VITE_GAME_URL??'http://localhost:5174/';
$('#reference').src=asset('reference.png');
const host=$('#view'),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;host.append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minZoom=.4;controls.maxZoom=6;controls.autoRotateSpeed=1.1;
const ground=new THREE.Mesh(new THREE.CircleGeometry(.55,64),new THREE.MeshBasicMaterial({color:0xd8dad5,transparent:true,opacity:.5}));ground.rotation.x=-Math.PI/2;ground.position.y=-.01;scene.add(ground);
new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.left=-1.01*w/h;camera.right=1.01*w/h;camera.top=1.01;camera.bottom=-1.01;camera.updateProjectionMatrix()}).observe(host);
const views={front:[0,.84,5],three:[3,1.18,4],side:[5,.84,0],back:[0,.84,-5]};
function setView(view){camera.position.set(...views[view]);camera.zoom=1;camera.updateProjectionMatrix();controls.target.set(0,.82,0);controls.update();document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.view===view))}
setView('front');document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>setView(button.dataset.view));
let model,mixer,clips=[],loadId=0,loading=true,failed=false;
function filename(){return MODEL_LIBRARY.find(model=>model.character===state.character&&model.hair===state.hair&&model.bag===state.bag).file}
function refresh(){
 $('#hair').replaceChildren(...hairstyles[state.character].map(style=>{const option=document.createElement('option');option.value=style;option.textContent=t(style);return option}));
 $('#character').value=state.character;$('#hair').value=state.hair;$('#bag').value=state.bag?'1':'0';$('#profile').value=String(state.profile);
 $('#variant-hint').textContent=t(state.character==='male'?'maleHint':'longHint');
 $('#play').textContent=t(state.walking?'pause':'play');$('#play').setAttribute('aria-pressed',state.walking);$('#stand').setAttribute('aria-pressed',state.standing);
 $('#download').href=asset(filename());$('#download').setAttribute('aria-disabled',loading||failed);$('#status').textContent=failed?t('failed'):loading?t('loading'):'';
 $('#reference').alt=t('reference');renderer.domElement.setAttribute('aria-label',t('viewLabel'));
 const url=new URL(location.href);url.searchParams.set('character',state.character);url.searchParams.set('hair',state.hair);url.searchParams.set('bag',state.bag?'1':'0');url.searchParams.set('lang',document.documentElement.lang);history.replaceState(null,'',url);
}
function playProfile(){if(!mixer)return;mixer.stopAllAction();mixer.clipAction(clips[state.profile]).play();state.standing=false;refresh()}
function stand(){if(!model)return;state.walking=false;state.standing=true;mixer.stopAllAction();let skeleton;model.traverse(mesh=>{if(mesh.isSkinnedMesh)skeleton=mesh.skeleton});skeleton.pose();model.updateMatrixWorld(true);skeleton.update();refresh()}
function disposeModel(previous){previous.traverse(mesh=>{if(!mesh.isMesh)return;mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose()})}
async function loadModel(){
 const id=++loadId;loading=true;failed=false;refresh();
 try{
  const gltf=await new GLTFLoader().loadAsync(asset(filename()));
  if(id!==loadId){disposeModel(gltf.scene);return}
  if(model){mixer.stopAllAction();mixer.uncacheRoot(model);scene.remove(model);disposeModel(model)}
  model=gltf.scene;clips=gltf.animations;mixer=new THREE.AnimationMixer(model);scene.add(model);loading=false;
  if(state.standing)stand();else playProfile();refresh();window.__modelReady=true;
 }catch(error){if(id!==loadId)return;loading=false;failed=true;refresh();console.error(error)}
}
$('#character').onchange=e=>{state.character=e.target.value;state.hair=hairstyles[state.character][0];loadModel()};
$('#hair').onchange=e=>{state.hair=e.target.value;if(state.hair==='long')state.bag=false;loadModel()};
$('#bag').onchange=e=>{state.bag=e.target.value==='1';if(state.bag&&state.hair==='long')state.hair='shoulder';loadModel()};
$('#profile').onchange=e=>{state.profile=Number(e.target.value);playProfile()};
$('#play').onclick=()=>{if(state.standing)playProfile();state.walking=!state.walking;refresh()};$('#stand').onclick=stand;
$('#rotate').onclick=e=>{controls.autoRotate=!controls.autoRotate;e.target.setAttribute('aria-pressed',controls.autoRotate)};
$('#language').onchange=e=>{setLanguage(e.target.value);refresh()};setLanguage(params.get('lang'));$('#language').value=document.documentElement.lang;refresh();
window.__modelPreview={renderer,scene,camera,controls,state,setView,stand,get model(){return model},get mixer(){return mixer},get clips(){return clips},get loading(){return loading},setTime:time=>{mixer.setTime(time);model.updateMatrixWorld(true);model.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.update()})}};
await loadModel();let previous=0;renderer.setAnimationLoop(now=>{const dt=previous?Math.min((now-previous)/1000,.05):0;previous=now;if(mixer&&state.walking&&!state.standing)mixer.update(dt);controls.update();renderer.render(scene,camera)});
