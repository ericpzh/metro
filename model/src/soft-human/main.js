import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createMotion} from './character.js';
import {loadImportedSoftHuman} from './imported-base.js';
import {createWardrobe,OUTFITS,BACKPACKS} from './wardrobe.js';
import {SOFT_ACTIONS,isStationActivity,createSoftActivityPoser} from './activities.js';
import {createInteractionEquipment} from '../interaction-equipment.js';
const $=s=>document.querySelector(s),view=$('#view');
const scene=new T.Scene();scene.background=new T.Color('#cadbd8');scene.fog=new T.Fog('#cadbd8',7,16);
const camera=new T.PerspectiveCamera(35,1,.01,40);camera.position.set(2.5,1.9,4.4);
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.setClearColor('#cadbd8');view.prepend(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.96,0);controls.minDistance=2;controls.maxDistance=9;controls.maxPolarAngle=Math.PI*.49;controls.update();
scene.add(new T.HemisphereLight(0xf6fbff,0x69796e,2.5));const light=new T.DirectionalLight(0xfff4df,3.5);light.position.set(-3,5,4);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-3;light.shadow.camera.right=3;light.shadow.camera.top=3;light.shadow.camera.bottom=-3;light.shadow.bias=-.0003;scene.add(light);
const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0xcadbd8,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.018;floor.receiveShadow=true;scene.add(floor);
$('#status').textContent='Loading selected character base…';
const inputControls=[...document.querySelectorAll('aside input,aside select,aside button')];inputControls.forEach(e=>e.disabled=true);
const c=await loadImportedSoftHuman().catch(error=>{$('#status').textContent='Could not load character: '+error.message;throw error});
const wardrobe=createWardrobe(c),motion=createMotion(c);scene.add(c.body,c.rig);let playing=true;
inputControls.forEach(e=>e.disabled=false);
const equipment=createInteractionEquipment(scene,{softBody:true}),activityPose=createSoftActivityPoser(c);let action='walk',activityTime=0,lastPhase;
const previousRoot=new T.Vector3();
$('#motion').replaceChildren(...SOFT_ACTIONS.map(a=>new Option(a.label,a.id)));$('#motion').value=action;
function poseCurrent(){
 const station=isStationActivity(action),id=action==='escalator-left'?'escalator':action;
 $('#softness').disabled=station;$('#push').disabled=station;$('#equipment').disabled=!station;
 equipment.root.visible=station&&$('#equipment').checked;
 if(station){equipment.root.scale.x=1;equipment.select(id);equipment.root.scale.x=action==='escalator-left'?-1:1;equipment.update(id,activityTime,c.body);lastPhase=activityPose(action,activityTime,equipment.anchors(id,activityTime,c.body.scale))}
 if(station){const delta=c.body.position.clone().sub(previousRoot);camera.position.add(delta);controls.target.add(delta);controls.update()}previousRoot.copy(c.body.position);
 const duration=SOFT_ACTIONS.find(a=>a.id===action).duration,time=station?lastPhase.t:motion.time%duration;
 $('#timeline').max=duration;$('#timeline').value=time;$('#phase').textContent=`${station?lastPhase.phase:'Loop'} · ${time.toFixed(1)} / ${duration} s`;
 wardrobe.update();
}
function selectAction(id){
 if(!SOFT_ACTIONS.some(a=>a.id===id))throw Error('Unknown action');action=id;activityTime=0;motion.state.mode=id;motion.reset();$('#motion').value=id;
 poseCurrent();
 if(isStationActivity(id)){camera.position.set(3,2.2,-3.7);controls.target.set(0,.95,.3)}else{camera.position.set(2.5,1.9,4.4);controls.target.set(0,.96,0)}controls.update();
}
function setTime(t){if(isStationActivity(action))activityTime=Number(t);else motion.seek(Number(t));poseCurrent()}
const resize=()=>{const {width,height}=view.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix()};new ResizeObserver(resize).observe(view);resize();
for(const [id,items] of [['outfit',OUTFITS],['backpack',BACKPACKS]]){
 const select=document.getElementById(id);
 for(const item of items)select.add(new Option(item.label,item.id));
 select.value=wardrobe.state[id];
 select.onchange=()=>wardrobe.set(document.getElementById('outfit').value,document.getElementById('backpack').value);
}
$('#age').onchange=e=>{c.setAge(e.target.value);poseCurrent()};
$('#motion').onchange=e=>selectAction(e.target.value);
$('#timeline').oninput=e=>{playing=false;$('#play').textContent='Play / 播放';setTime(e.target.value)};
$('#equipment').onchange=poseCurrent;
$('#softness').oninput=e=>motion.state.softness=Number(e.target.value);$('#speed').oninput=e=>motion.state.speed=Number(e.target.value);
$('#play').onclick=()=>{playing=!playing;$('#play').textContent=playing?'Pause / 暂停':'Play / 播放'};$('#reset').onclick=()=>setTime(0);$('#push').onclick=()=>motion.push();
$('#cap').onchange=e=>c.cap.visible=e.target.checked;$('#rig').onchange=e=>c.rig.visible=e.target.checked;
for(const b of document.querySelectorAll('[data-angle]'))b.onclick=()=>{const a=Number(b.dataset.angle),r=4.5,center=c.body.position.clone().add(new T.Vector3(0,.96*c.body.scale.y,0));camera.position.copy(center).add(new T.Vector3(Math.sin(a)*r,.69,Math.cos(a)*r));controls.target.copy(center);controls.update()};
$('#download').onclick=async()=>{const button=$('#download');button.disabled=true;const wasPlaying=playing;playing=false;try{wardrobe.update();const data=await new GLTFExporter().parseAsync(c.body,{binary:true,onlyVisible:true});const url=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=url;a.download=`soft-human-${c.appearance.age}-${wardrobe.state.outfit}-${wardrobe.state.backpack}.glb`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#status').textContent='GLB exported · current pose, skin and skeleton'}catch(e){$('#status').textContent='Export failed: '+e.message}finally{button.disabled=false;playing=wasPlaying}};
let last=performance.now();renderer.setAnimationLoop(now=>{const dt=Math.min((now-last)/1000,.1);last=now;if(playing&&!document.hidden){if(isStationActivity(action))activityTime+=dt*motion.state.speed;else motion.update(dt)}controls.update();poseCurrent();renderer.render(scene,camera)});
poseCurrent();$('#status').textContent='Selected FBX base · Clothing, bags + station activities';window.__softHuman={ready:true,scene,camera,renderer,controls,character:c,motion,wardrobe,equipment,actions:SOFT_ACTIONS,selectAction,setTime,get phase(){return lastPhase}};







