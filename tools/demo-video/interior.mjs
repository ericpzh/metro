// Real authoring in the production document: native preview/validation, then the
// same addEquipment / paintFaces edits used by the game's tools. No model poses
// or rendered appearance are faked in post-production.
import {setTimeout as sleep} from 'node:timers/promises'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {emptyStation} from '../../game/src/data/reference-station.ts'
import {toState,addCells,addWalls,addEquipment,removeModule,extendLift,createModule,paintFaces,fenceRotForLine} from '../../game/src/build/model.ts'
import {checkModulePlacements} from '../../game/src/build/validation.ts'
import {MODULE_OPTIONS,MODULE_FAMILIES} from '../../game/src/app/store/catalog.ts'
import {getLanguage,setLanguage,translate} from '../../game/src/sim/i18n.ts'
import {ui,videoText} from '../../web/src/i18n.js'

export const interiorBounds={x0:0,x1:26,y0:-12,y1:10,z:1}
const rect=(x0,x1,y0,y1,z)=>Array.from({length:x1-x0+1},(_,i)=>Array.from({length:y1-y0+1},(_,j)=>[x0+i,y0+j,z])).flat()
const zoo=JSON.parse(readFileSync(resolve('game/src/data/demo-station.json'),'utf8'))
const mostCommon=values=>[...values.reduce((m,v)=>m.set(v,(m.get(v)??0)+1),new Map())].sort((a,b)=>b[1]-a[1])[0][0]
export const zooMaterials={
 wall:mostCommon(zoo.cells.flatMap(c=>Object.values(c.finish??{})).filter(v=>v.startsWith('wall.enamel'))),
 floor:mostCommon(zoo.cells.filter(c=>c.zone!=='outside').map(c=>c.finish?.top).filter(v=>v&&v!=='floor.soil')),
 ceiling:mostCommon(zoo.cells.map(c=>c.finish?.bottom).filter(v=>v?.startsWith('ceil.'))),
}
export function constructionSteps(){
 const steps=[]
 for(let x=0;x<=26;x+=3)steps.push({kind:'floor',cells:rect(x,Math.min(26,x+2),-12,10,1)})
 for(let x=27;x<=39;x+=4)steps.push({kind:'floor',cells:rect(x,Math.min(39,x+3),-12,8,1)})
 for(let x=0;x<=26;x+=3)steps.push({kind:'wall',cells:rect(x,Math.min(26,x+2),10,10,2)})
 steps.push({kind:'wall',cells:rect(0,0,8,9,2)})
 steps.push({kind:'floor',cells:rect(11,20,5,9,6)},{kind:'floor',cells:rect(22,25,3,6,6)})
 return steps
}
export function buildStep(state,step){return step.kind==='wall'?addWalls(state,step.cells,null,4).state:{...state,cells:addCells(state.cells,step.cells,state.modules).cells}}
export function structuralBase(name){let state=toState(emptyStation(name));for(const step of constructionSteps())state=buildStep(state,step);return state}
export function colourSteps(){
 const steps=[{cells:rect(0,26,-12,10,1),face:'top',finish:zooMaterials.floor}]
 steps.push({cells:rect(27,39,-12,8,1),face:'top',finish:'floor.tile'})
 for(let x=0;x<=26;x++)for(const face of ['n','s'])steps.push({cells:rect(x,x,10,10,2).flatMap(([x,y])=>[2,3,4].map(z=>[x,y,z])),face,finish:zooMaterials.wall})
 steps.push({cells:rect(0,0,8,9,2).flatMap(([x,y])=>[2,3,4].map(z=>[x,y,z])),face:'e',finish:zooMaterials.wall})
 steps.push({cells:rect(1,25,-7,-7,1),face:'top',finish:'floor.slate'})
 steps.push({cells:rect(11,20,5,9,6),face:'top',finish:zooMaterials.floor},{cells:rect(22,25,3,6,6),face:'top',finish:zooMaterials.floor})
 steps.push({cells:rect(11,20,5,9,6),face:'bottom',finish:zooMaterials.ceiling},{cells:rect(22,25,3,6,6),face:'bottom',finish:zooMaterials.ceiling})
 return steps
}
export function colouredBase(name){let state=structuralBase(name);for(const step of colourSteps())state=paintFaces(state,step.cells,step.face,step.finish);return state}

const fixture=(palette,x,y,rot=0,zone='details',extra={})=>({palette,x,y,z:1,rot,zone,...extra})
export const interiorPlacements=[
 ...['stair-rightForward','stair-left180','stair-right180','stair-centerForward','stair-left90','stair-right90','stair-straight'].map(p=>fixture(p,14,-3,0,'circulation')),
 fixture('stair-leftForward',14,-3,0,'circulation'),fixture('escalator',19,-4,0,'circulation'),
 ...['shelf-cooler','shelf-cooler-dark','shelf-white-tall','shelf-dark-tall','shelf-wire','shelf-white-short'].map((p,i)=>fixture(p,2+i,9,0,'shop')),
 fixture('checkout',3,6,0,'shop'),fixture('checkout',4,6,0,'shop'),
 fixture('cubicle',21,8,0,'restroom'),fixture('cubicle-toilet',22,8,0,'restroom'),fixture('sink',23,9,0,'restroom'),fixture('urinal',25,9,2,'restroom'),
 fixture('lift',24,3,0,'circulation'),
 fixture('lift',24,3,0,'circulation',{action:'extend'}),
 fixture('electrical-cabinet',1,1,1,'services'),fixture('extinguisher-glass',1,-1,1,'services'),
 fixture('cctv-dome',12,7,0,'services'),fixture('clock',14,7,0,'services'),fixture('cctv-ptz',16,7,0,'services'),fixture('cctv',18,7,0,'services'),
 ...[20,21,22].map(x=>fixture('tvm',x,-10,0,'ticketing')),
 ...Array.from({length:8},(_,i)=>fixture('gate-new',10+i,-7,0,'ticketing')),
 fixture('vending',24,-10,0,'ticketing'),fixture('bench-seat-1',2,-3,0,'details'),fixture('bin',5,-3,0,'details'),
 fixture('walkway',8,-2,0,'circulation',{to:{x:8,y:4,z:1}}),
 fixture('tactile-guide',10,-11,1,'details',{cells:rect(10,10,-11,-9,1)}),fixture('tactile-warning',10,-8,0,'details'),
 fixture('fence-iron',1,-7,0,'ticketing',{cells:rect(1,9,-7,-7,1)}),fixture('fence-iron',18,-7,0,'ticketing',{cells:rect(18,25,-7,-7,1)}),
 fixture('ac-unit',29,4,0,'forecourt'),fixture('tree',36,3,0,'forecourt'),fixture('busstop-long',30,-8,0,'forecourt'),fixture('cctv-post',37,-6,0,'forecourt'),
]
export function beforePlacement(state,item){if(item.palette.startsWith('stair'))for(const m of state.modules)if(m.type==='stair')state=removeModule(state,m.id);return state}
export function placedModule(item,index){const m=createModule(item.palette,item.x,item.y,item.z,`video-placed-${index}`,item.rot);if(!m)throw Error(item.palette);if(item.to)m.to=item.to;return m}
export function placedModules(item,index){return item.cells?item.cells.map(([x,y,z],j)=>({...createModule(item.palette,x,y,z,`video-placed-${index}-${j}`,fenceRotForLine(item.cells)??item.rot)})):[placedModule(item,index)]}
export function placementLabel(item,language){if(item.action==='extend')return ui[language].video.extendLift;const p=getLanguage();try{setLanguage(language==='en'?'en':'zh-CN');const label=translate(MODULE_OPTIONS.find(m=>m.id===item.palette).label),family=MODULE_FAMILIES.find(f=>f.owns(item.palette)),parent=family?translate(family.label):'',full=parent&&!label.includes(parent)?`${parent} · ${label}`:label;return item.cells?videoText(language,'dragPlacement',full):full}finally{setLanguage(p)}}
export function placementFocus(item){
 if(item.palette==='lift')return {target:[24,3,item.action==='extend'?6:3.5],fov:30}
 if(item.zone==='shop')return {target:[5,8,2],fov:18}
 if(item.zone==='forecourt')return {target:[34,-1,4.5],fov:48}
 if(item.zone==='restroom')return {target:[23,8,2],fov:16}
 if(item.zone==='services')return {target:item.x<5?[1,2,2]:[15,7,4],fov:18}
 if(item.palette==='gate-new')return {target:[14,-7,1.5],fov:25}
 if(item.palette==='tvm'||item.palette==='vending')return {target:[22,-10,1.5],fov:22}
 if(item.palette==='fence-iron')return {target:[13,-5,2],fov:45}
 if(item.palette.startsWith('tactile'))return {target:[10,-9,1.2],fov:22}
 if(item.zone==='circulation')return {target:[18,2,3.5],fov:36}
 return {target:[3,-3,1.6],fov:19}
}
export function validateInterior(){
 let state=colouredBase('test'),steps=[]
 for(const [index,item] of interiorPlacements.entries()){
  if(!MODULE_OPTIONS.some(m=>m.id===item.palette))throw Error(`Missing catalogue label: ${item.palette}`)
  state=beforePlacement(state,item)
  if(item.action==='extend'){const lift=state.modules.find(m=>m.type==='lift');state=extendLift(state,lift.id,true,5);steps.push({item,module:state.modules.find(m=>m.id===lift.id)});continue}
  for(const module of placedModules(item,index)){
   const check=checkModulePlacements(state,[{id:module.id,module}])
   if(check.refused.size)throw Error(`Invalid interior ${index} ${item.palette}: ${[...check.refused.values()].join(',')}`)
   state=addEquipment(state,module)
  }
  steps.push({item,modules:placedModules(item,index)})
 }
 return {state,steps}
}

async function install(page,state){await page.evaluate(`(()=>{__metro.getState().commit(${JSON.stringify(state)});__scene.requestRender();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{__scene.setGridVisible(false);r()})))})()`)}
export async function prepareInterior(page,shot,language){
 await page.evaluate(`(()=>{
  const s=__metro.getState();s.setPlaying(false);s.setActiveZ(0);s.setHideGround(true);s.setHideWalls(false);s.setHideRoof(false);s.setAutoCeiling(false);s.setGhostOther(false);s.setHideUI(false);s.setCutaway(true);s.placeSection([0,-10000,0]);for(let i=0;i<4&&__metro.getState().section.orientation.azimuth!==0;i++)s.rotateSection();s.setSectionOffset(0);s.setHideSectionSurface(true);s.setTool('select');
  document.body.setAttribute('data-video-clean','');
  const c=__scene.cameraSys;c.setOrtho(false);c.setFov(48);c.controls.enableDamping=false;c.controls.minDistance=.1;
  window.__videoInteriorToken=(window.__videoInteriorToken??0)+1;
  const Vector=c.camera.position.constructor;window.__videoInteriorFocus={target:[13,-1,2.5],fov:48};window.__videoInteriorLook=new Vector(13,-1,2.5);window.__videoInteriorFov=48;window.__videoInteriorLast=performance.now();
  window.__videoInteriorPose=t=>{
   const now=performance.now(),dt=Math.min(.1,(now-__videoInteriorLast)/1000);__videoInteriorLast=now;
   const mix=1-Math.exp(-dt/1.8),reveal=Math.max(0,(t-.91)/.09),a=(130+75*t)*Math.PI/180;
   const build=Math.min(1,t/(40/188)),elevation=30+38*reveal*reveal,e=elevation*Math.PI/180,d=43-9*build-3*t;
   const center=new Vector(13,-1,2.5),goal=reveal>0?new Vector(18,-1,2.5):new Vector(...__videoInteriorFocus.target);
   const fov=reveal>0?48:__videoInteriorFocus.fov;
   __videoInteriorLook.lerp(goal,mix);__videoInteriorFov+=(fov-__videoInteriorFov)*mix;
   c.setFov(__videoInteriorFov);c.controls.target.copy(__videoInteriorLook);
   c.camera.position.copy(center).add(new Vector(Math.sin(a)*Math.cos(e)*(d+10*reveal),Math.cos(a)*Math.cos(e)*(d+10*reveal),Math.sin(e)*(d+10*reveal)));
   const virtualOrbitCamera=c.camera.position.toArray();
   // Native lens stops at 30 degrees. Dolly along the viewing ray for tighter
   // details while retaining the continuous central orbit and smooth focus pans.
   c.camera.position.lerp(c.controls.target,1-Math.min(1,__videoInteriorFov/30));
   c.camera.lookAt(c.controls.target);c.controls.update();__scene.setGridVisible(false);for(const root of __scene.modules.moduleMeshes.children)if(String(root.userData.moduleId??'').startsWith('video-placed-'))root.visible=true;__scene.requestRender();
   return{virtualOrbitCamera,progress:t,camera:c.camera.position.toArray(),target:c.controls.target.toArray(),
    orbitCenter:center.toArray(),degrees:130+75*t,elevation,distance:d,fov:c.camera.fov,zoomFov:__videoInteriorFov};
  };
  window.__videoInteriorPoint=(x,y,z)=>{const r=__scene.renderer.domElement.getBoundingClientRect(),p=new Vector(x,y,z).project(c.activeCamera());return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}};
 })()`.replace('shotPlacement',String(shot.kind==='placement')))
 await page.evaluate('__scene.setVoidColor(0xf4f3ed,0xf4f3ed);__videoInteriorPose(0)')
 if(shot.kind==='placement'){
  await page.evaluate(`(()=>{let e=document.getElementById('video-placement-label');if(!e){e=document.createElement('aside');e.id='video-placement-label';document.body.append(e)}e.style.cssText='position:fixed;right:96px;top:150px;max-width:650px;padding:20px 28px;background:#fdfef9ed;color:#303a30;border:1px solid #d8dbce;border-left:5px solid #c94d24;border-radius:10px;z-index:100;font:30px var(--font);box-shadow:0 10px 35px #16221a12';e.textContent=${JSON.stringify(ui[language].video.placementStart)}})()`)
 }else await page.evaluate("document.getElementById('video-placement-label')?.remove()")
}
const twoFrames='new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
async function pointer(page,type,p,extra={}){await page.send('Input.dispatchMouseEvent',{type,...p,...extra})}
async function point(page,x,y,z){return page.evaluate(`__videoInteriorPoint(${x},${y},${z})`)}
export async function dragPlacement(page,item,index,seconds=3){
 const before=await page.evaluate('__metro.getState().station.modules.map(m=>m.id)')
 await page.evaluate(`(()=>{const s=__metro.getState();s.setActiveZ(0);s.setModuleType(${JSON.stringify(item.palette)});s.setModuleRot(${item.rot});s.setTool('module');__scene.setModulePreview(null)})()`)
 await page.evaluate(twoFrames)
 const cells=item.cells,a=cells[0],b=cells.at(-1)
 await pointer(page,'mouseMoved',await point(page,a[0]+.5,a[1]+.5,a[2]+1));await sleep(180)
 await pointer(page,'mousePressed',await point(page,a[0]+.5,a[1]+.5,a[2]+1),{button:'left',buttons:1,clickCount:1});await sleep(200)
 for(let i=1;i<=32;i++){
  await sleep(seconds*1000/32)
  const t=i/32,p=await point(page,a[0]+.5+(b[0]-a[0])*t,a[1]+.5+(b[1]-a[1])*t,a[2]+1)
  await pointer(page,'mouseMoved',p,{button:'left',buttons:1})
 }
 await pointer(page,'mouseReleased',await point(page,b[0]+.5,b[1]+.5,b[2]+1),{button:'left',buttons:0,clickCount:1});await page.evaluate(twoFrames)
 const state=await page.evaluate('__metro.getState().station'),added=state.modules.filter(m=>!before.includes(m.id)),expected=placedModules(item,index)
 if(added.length!==expected.length||expected.some(e=>!added.some(m=>m.type===e.type&&m.x===e.x&&m.y===e.y&&m.z===e.z)))throw Error(`Drag did not fill ${item.palette}: ${JSON.stringify(added)}`)
 const nativeIds=added.map(m=>m.id)
 state.modules=state.modules.map(m=>{if(!nativeIds.includes(m.id))return m;const e=expected.find(e=>e.x===m.x&&e.y===m.y&&e.z===m.z);return{...m,id:e.id}})
 await install(page,state);await page.evaluate("__metro.getState().setTool('select')")
 return {state,nativeIds,moduleIds:expected.map(m=>m.id),cells,gesture:'native-pointer-drag',points:32}
}
export async function extendLiftWithPointer(page){
 const before=await page.evaluate("__metro.getState().station.modules.find(m=>m.type==='lift')")
 await page.evaluate("(()=>{const s=__metro.getState();s.setModuleType('lift');s.setTool('module');s.setActiveZ(5);s.setLiftInterval(5)})()")
 await page.evaluate(twoFrames)
 const p=await point(page,before.x+.5,before.y+.5,before.to.z+.05)
 await pointer(page,'mouseMoved',p);await sleep(1100)
 const click=await point(page,before.x+.5,before.y+.5,before.to.z+.05)
 await pointer(page,'mousePressed',click,{button:'left',buttons:1,clickCount:1});await pointer(page,'mouseReleased',click,{button:'left',buttons:0,clickCount:1});await page.evaluate(twoFrames)
 const state=await page.evaluate('__metro.getState().station'),after=state.modules.find(m=>m.id===before.id)
 if(after.to.z!==before.to.z+5||after.from.z!==before.from.z||state.modules.filter(m=>m.type==='lift').length!==1)throw Error(`Lift did not extend upward: ${JSON.stringify(after)}`)
 await page.evaluate("__metro.getState().setTool('select');__metro.getState().setActiveZ(0)")
 return {state,moduleId:after.id,beforeTop:before.to.z,afterTop:after.to.z,rises:after.cfg.rises,gesture:'native-pointer-click'}
}
export async function interiorAction(page,shot,start,language){
 const events=[],at=async t=>sleep(Math.max(0,start+t*1000-performance.now())),elapsed=()=> (performance.now()-start)/1000
 const cue=action=>events.push({at:elapsed(),file:'place.wav',...action})
 const caption=async card=>{events.push({at:elapsed(),action:'build-card',card});await page.evaluate(`document.getElementById('video-placement-label').textContent=${JSON.stringify(card)}`)}
 let state=await page.evaluate('__metro.getState().station')
 validateInterior()
 await page.evaluate(`(()=>{const token=++__videoInteriorToken,start=performance.now();window.__videoMotionLog=[];function step(now){if(token!==__videoInteriorToken)return;const t=Math.min(1,(now-start)/${shot.captureSeconds*1000});__videoMotionLog.push(__videoInteriorPose(t));if(t<1)requestAnimationFrame(step)}requestAnimationFrame(step)})()`)
 let lastKind=''
 const structure=constructionSteps()
 for(let i=0;i<structure.length;i++){
  await at(.5+i*.61)
  const step=structure[i],kind=step.cells[0][2]===6?'deck':step.kind
  if(kind!==lastKind){await caption(ui[language].video.buildPhases[kind]);lastKind=kind}
  state=buildStep(state,step);await install(page,state);if(i%3===0)cue({action:'structure-built',kind:step.kind})
 }
 const colours=colourSteps();await at(16);await caption(ui[language].video.buildPhases.materials)
 for(let i=0;i<colours.length;i++){
  await at(16.5+i*.34);const step=colours[i];state=paintFaces(state,step.cells,step.face,step.finish);await install(page,state)
  if(i%8===0)cue({action:'surface-painted',finish:step.finish})
 }
 const weight=item=>item.action==='extend'?3.25:item.cells?2:1
 const unit=(shot.captureSeconds-40-22)/interiorPlacements.reduce((n,i)=>n+weight(i),0)
 let actionStart=42
 for(let i=0;i<interiorPlacements.length;i++){
  const item=interiorPlacements[i],duration=unit*weight(item),label=placementLabel(item,language)
  await at(actionStart);await caption(label)
  await page.evaluate(`window.__videoInteriorFocus=${JSON.stringify(placementFocus(item))}`)
  if(item.cells){
   await at(actionStart+1.2);const result=await dragPlacement(page,item,i,duration*.58);state=result.state
   cue({action:'run-dragged',catalogueId:item.palette,moduleIds:result.moduleIds,nativeModuleIds:result.nativeIds,cells:result.cells,gesture:result.gesture,points:result.points,validation:'accepted'})
  }else if(item.action==='extend'){
   await at(actionStart+1.8);const result=await extendLiftWithPointer(page);state=result.state
   cue({action:'lift-extended',catalogueId:'lift',moduleId:result.moduleId,beforeTop:result.beforeTop,afterTop:result.afterTop,rises:result.rises,gesture:result.gesture,validation:'accepted'})
  }else{
   const previous=state;state=beforePlacement(state,item);if(previous!==state)await install(page,state)
   const module=placedModule(item,i),check=checkModulePlacements(state,[{id:module.id,module}]);if(check.refused.size)throw Error(`Placement refused ${item.palette}: ${[...check.refused.values()]}`)
   await page.evaluate(`__scene.setModulePreview(${JSON.stringify(module)})`);await at(actionStart+duration*.28)
   state=addEquipment(state,module);await install(page,state);await page.evaluate('__scene.setModulePreview(null)')
   cue({action:'interior-placed',catalogueId:item.palette,moduleId:module.id,x:module.x,y:module.y,z:module.z,validation:'accepted'})
  }
  actionStart+=duration
 }
 await caption(ui[language].video.placementComplete)
 return events
}
