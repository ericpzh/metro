import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import './style.css';
import './candidates.css';

import {CANDIDATES as entries} from './candidate-catalog.js';

const $=s=>document.querySelector(s),url=new URL(location.href),base=import.meta.env.BASE_URL;
let lang=url.searchParams.get('lang')==='zh'?1:0,selected=entries.find(e=>e.id===url.searchParams.get('candidate'))??entries[0],style=url.searchParams.get('style')==='original'?'original':'grey';
let picks=new Set();try{picks=new Set(JSON.parse(localStorage.getItem('metro-human-picks')??'[]').filter(id=>entries.some(e=>e.id===id)))}catch{}
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;$('#view').append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.01,100),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,.9,0);controls.autoRotateSpeed=1;
scene.add(new THREE.HemisphereLight(0xffffff,0x8a9299,2.4));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,6,4);scene.add(light);
const ground=new THREE.Mesh(new THREE.CircleGeometry(.7,64),new THREE.MeshBasicMaterial({color:0xd8dad5,transparent:true,opacity:.5}));ground.rotation.x=-Math.PI/2;ground.position.y=-.015;scene.add(ground);
let root,mixer,clips=[],action,request=0,playing=true,ready=false;
const views={front:[0,1.1,4.2],three:[2.8,1.4,3.2],side:[4.2,1.1,0],back:[0,1.1,-4.2]};
function view(id){camera.position.set(...views[id]);controls.target.set(0,.9,0);controls.update()}view('three');
new ResizeObserver(()=>{const host=$('#view');renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix()}).observe($('#view'));
function dispose(object){const geometries=new Set(),materials=new Set(),textures=new Set();object.traverse(n=>{if(!n.isMesh)return;geometries.add(n.geometry);for(const m of [...(Array.isArray(n.material)?n.material:[n.material]),...(n.userData.originalMaterials??[]),...(n.userData.greyMaterials??[])]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v)}if(n.isSkinnedMesh)n.skeleton.dispose()});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())}
function applyStyle(){root?.traverse(n=>{
 if(!n.isMesh)return;
 const original=n.userData.originalMaterials??(n.userData.originalMaterials=Array.isArray(n.material)?n.material:[n.material]);
 if(!n.userData.greyMaterials)n.userData.greyMaterials=original.map(source=>{
  // Preserve authored smooth normals, clothing detail and hair alpha instead of
  // replacing the source with a flat-shaded opaque material.
  const material=source.clone();material.flatShading=false;
  if(material.isMeshPhongMaterial){material.shininess=8;material.specular.setHex(0x171717)}
  material.onBeforeCompile=shader=>{
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float greyTone = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = vec3(greyTone);`);
  };
  material.customProgramCacheKey=()=> 'candidate-smooth-grey-v1';
  return material;
 });
 const materials=style==='grey'?n.userData.greyMaterials:original;n.material=materials.length===1?materials[0]:materials;
});}
function text(){document.documentElement.lang=lang?'zh':'en';$('#language').value=lang?'zh':'en';for(const [id,en,zh] of [
 ['title','Human candidates','候选人物'],['intro','Compare real downloadable assets. Select “Keep this candidate” to save a shortlist on this browser.','比较实际下载的模型。点击“保留此候选”将选择保存到当前浏览器。'],['candidate-label','Candidate','候选模型'],['style-label','Appearance','外观'],['animation-label','Bundled animation','附带动画'],['timeline-label','Animation timeline','动画时间轴'],['source','Original source ↗','原始来源 ↗'],['reset','Restart clip','重播动画'],['note','Preview only. 10 adult bases and 4 generated child candidates. Adults use 1.75 m comparison height; children span 1.18–1.46 m with child body proportions. Station interactions and our three walking speeds require rig adaptation; shortlist choices do not replace game passengers.','仅供预览。10 个成人基础角色和 4 个生成儿童候选。成人对比身高为 1.75 米；儿童为 1.18–1.46 米，保留儿童体型比例。车站互动及三档行走需要适配骨架；保留候选不会替换游戏乘客。'],['orbit-hint','Drag to orbit · Scroll to zoom · Selection is saved locally','拖动旋转 · 滚轮缩放 · 选择保存在本地']])$('#'+id).textContent=lang?zh:en;
 $('#candidate').replaceChildren(...entries.map(e=>new Option(e.name[lang],e.id)));$('#candidate').value=selected.id;$('#description').textContent=selected.description[lang];$('#source').href=selected.source;$('#style').value=style;$('#play').textContent=playing?(lang?'暂停':'Pause'):(lang?'播放':'Play');$('#pick').textContent=picks.has(selected.id)?(lang?'已保留 ✓（点击移除）':'Kept ✓ — click to remove'):(lang?'保留此候选':'Keep this candidate');$('#pick').setAttribute('aria-pressed',picks.has(selected.id));$('#picks').textContent=(lang?'已保留：':'Shortlist: ')+([...picks].map(id=>entries.find(e=>e.id===id)?.name[lang]).join(' · ')||(lang?'暂无':'None yet'));
 $('#animation').disabled=!clips.length;$('#timeline').disabled=!clips.length;$('#play').disabled=!clips.length;$('#reset').disabled=!clips.length;$('#pick').disabled=!ready;
 const chosen=$('#animation').value;$('#animation').replaceChildren(...(clips.length?clips.map((clip,i)=>new Option(clip.name||`Clip ${i+1}`,String(i))):[new Option(lang?'无附带动画（静态）':'No bundled clips — static','')]));if(clips.length)$('#animation').value=chosen||'0';
 url.searchParams.set('candidate',selected.id);url.searchParams.set('style',style);url.searchParams.set('lang',lang?'zh':'en');history.replaceState(null,'',url);
}
function playClip(index){if(!mixer)return;mixer.stopAllAction();action=clips[index]?mixer.clipAction(clips[index]).reset().play():null;$('#timeline').value=0;}
async function load(){const id=++request,entry=selected;ready=false;clips=[];$('#status').textContent=lang?'加载中…':'Loading…';text();
 try{let object,animations=[];
  if(entry.kind==='gltf'){const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(base+entry.file);object=gltf.scene;animations=gltf.animations}
  else{
   const folder=base+entry.file.slice(0,entry.file.lastIndexOf('/')+1),manager=new THREE.LoadingManager();
   manager.setURLModifier(path=>/\.tga$/i.test(path)?folder+path.split(/[\\/]/).pop().replace(/\.tga$/i,'.png'):path);
   object=await new FBXLoader(manager).loadAsync(base+entry.file);
   // Source FBX includes four overlapping detail levels. Display one level only.
   const meshes=[];object.traverse(n=>{if(n.isMesh)meshes.push(n)});
   const high=meshes.filter(n=>/hipoly/i.test(n.name));if(high.length)for(const n of meshes)n.visible=high.includes(n);
   object.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material]){if(m.map)m.color.set(0xffffff);m.shininess=8;}});
  }
  if(id!==request){dispose(object);return}
  if(root){mixer?.stopAllAction();mixer?.uncacheRoot(root);scene.remove(root);dispose(root)}
  // Normalize outside the animated root so source transforms/clip tracks remain intact.
  object.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),scale=(entry.height??(entry.age==='child'?1.25:1.75))/size.y;
  root=new THREE.Group();const offset=new THREE.Group();offset.position.set(-center.x,-bounds.min.y,-center.z);offset.add(object);root.scale.setScalar(scale);root.add(offset);scene.add(root);clips=animations;mixer=new THREE.AnimationMixer(object);applyStyle();playClip(0);ready=true;$('#status').textContent='';text();
 }catch(error){if(id!==request)return;$('#status').textContent=(lang?'加载失败：':'Could not load: ')+error.message;console.error(error);text()}}
$('#candidate').onchange=e=>{selected=entries.find(x=>x.id===e.target.value);load()};$('#style').onchange=e=>{style=e.target.value;applyStyle();text()};$('#language').onchange=e=>{lang=e.target.value==='zh'?1:0;text()};$('#animation').onchange=e=>playClip(Number(e.target.value));$('#play').onclick=()=>{playing=!playing;text()};$('#reset').onclick=()=>playClip(Number($('#animation').value));$('#timeline').oninput=e=>{playing=false;if(action)action.time=Number(e.target.value)*action.getClip().duration;mixer?.update(0);text()};$('#pick').onclick=()=>{if(picks.has(selected.id))picks.delete(selected.id);else picks.add(selected.id);try{localStorage.setItem('metro-human-picks',JSON.stringify([...picks]))}catch{}text()};document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));$('#rotate').onclick=()=>{controls.autoRotate=!controls.autoRotate;$('#rotate').setAttribute('aria-pressed',controls.autoRotate)};
window.__candidatePreview={entries,renderer,scene,camera,get ready(){return ready},get root(){return root},get clips(){return clips},get selected(){return selected},get mixer(){return mixer}};
let previous=0;renderer.setAnimationLoop(now=>{const dt=previous?Math.min((now-previous)/1000,.05):0;previous=now;if(ready&&playing)mixer?.update(dt);if(action&&playing)$('#timeline').value=action.time/action.getClip().duration;controls.update();renderer.render(scene,camera)});await load();
