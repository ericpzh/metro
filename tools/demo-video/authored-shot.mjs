import {setTimeout as sleep} from 'node:timers/promises'
import {authoredState,authoredCamera,emptyAuthoredState,authoredFrameSteps,authoredSchedule,authoredLabel,modulePalette,validateAuthoredReplay} from './authored-layout.mjs'
import {ui} from '../../web/src/i18n.js'
import {isDeepStrictEqual} from 'node:util'

const frames='new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
async function install(page,state){await page.evaluate(`(()=>{__metro.getState().commit(${JSON.stringify(state)});__scene.requestRender();return ${frames}})()`)}
export async function prepareAuthored(page,shot,language,{full=false}={}){
 await install(page,full?authoredState:emptyAuthoredState())
 await page.evaluate(`(()=>{
  const s=__metro.getState();s.setPlaying(false);s.setActiveZ(1);s.setHideGround(false);s.setHideWalls(false);s.setHideRoof(false);s.setAutoCeiling(false);s.setGhostOther(false);s.setHideUI(true);s.setCutaway(false);s.setTool('select');s.setGraphicsQuality('high');s.setUpscalingMode('native');
  document.body.setAttribute('data-video-clean','');window.__videoScene=__scene;
  const c=__scene.cameraSys;c.setOrtho(false);c.setFov(${authoredCamera.fov});c.controls.enableDamping=false;c.controls.minDistance=.1;
  window.__videoInteriorToken=(window.__videoInteriorToken??0)+1;
  const Vector=c.camera.position.constructor,from=${JSON.stringify(authoredCamera.from)},to=${JSON.stringify(authoredCamera.to)};
  window.__videoInteriorPose=t=>{
   const mix=(a,b)=>a+(b-a)*t,degrees=mix(from.azimuth,to.azimuth),a=degrees*Math.PI/180;
   const batchPhase=Math.max(0,Math.min(1,(t-.19)/.38));
   const batchFraming=Math.sin(Math.PI*batchPhase)**2;
   const r=mix(from.radius,to.radius)+7*batchFraming,target=from.target.map((v,i)=>mix(v,to.target[i]));
   const panPhase=Math.max(0,(t-${authoredCamera.westwardPanFrom??0})/(1-${authoredCamera.westwardPanFrom??0}));
   target[0]-=${authoredCamera.westwardPan??0}*Math.sin(Math.PI*panPhase)**2;
   const fencePhase=Math.max(0,Math.min(1,(t-.45)/.29));
   c.setFov(${authoredCamera.fov}+7*Math.sin(Math.PI*fencePhase)**2);
   c.controls.target.set(...target);c.camera.position.set(target[0]+Math.sin(a)*r,target[1]+Math.cos(a)*r,target[2]+mix(from.height,to.height));c.camera.lookAt(c.controls.target);c.controls.update();__scene.setGridVisible(false);__scene.requestRender();
   return{progress:t,degrees,camera:c.camera.position.toArray(),target:c.controls.target.toArray(),fov:c.camera.fov};
  };
  window.__videoInteriorPoint=(x,y,z)=>{const r=__scene.renderer.domElement.getBoundingClientRect(),p=new Vector(x,y,z).project(c.activeCamera());return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}};
  let e=document.getElementById('video-placement-label');if(!e){e=document.createElement('aside');e.id='video-placement-label';document.body.append(e)}
  e.style.cssText='position:fixed;right:96px;bottom:180px;max-width:650px;padding:20px 28px;background:#fdfef9ed;color:#303a30;border:1px solid #d8dbce;border-left:5px solid #c94d24;border-radius:10px;z-index:100;font:30px var(--font);pointer-events:none';e.textContent=${JSON.stringify(ui[language].video.placementStart)};
  __videoInteriorPose(0);
 })()`)
 await page.evaluate(frames)
}
const point=(page,m,anchor=null)=>page.evaluate(`(()=>{
 const {x,y,z}=${JSON.stringify({x:Math.floor(m.x),y:Math.floor(m.y),z:m.z})};
 const anchor=${JSON.stringify(anchor)}, tactile=${m.type==='tactile'}, candidates=[];
 const onFloor=h=>{
  if(!h?.solid||h.cell[0]!==x||h.cell[1]!==y||tactile&&h.normal?.[2]<=.5)return false;
  if(h.cell[2]===z)return true;
  const host=h.moduleId&&__metro.getState().station.modules.find(m=>m.id===h.moduleId);
  return h.normal?.[2]>.5&&host?.z===z&&['sidewalk','lawn'].includes(host.type);
 };
 const onTarget=h=>{
  if(onFloor(h))return true;
  if(!h||!anchor)return false;
  const dx=Math.abs(x-anchor.x),dy=Math.abs(y-anchor.y);
  return (dx>=dy&&h.cell[0]===x&&Math.abs(h.cell[1]-anchor.y)<=dx)||(dy>dx&&h.cell[1]===y&&Math.abs(h.cell[0]-anchor.x)<dy);
 };
 for(const u of [.5,.15,.85,.3,.7])for(const v of [.5,.15,.85,.3,.7]){
  const projected=__videoInteriorPoint(x+u,y+v,z+1);
  const p={x:Math.round(projected.x),y:Math.round(projected.y)};
  if(p.x<4||p.y<4||p.x>innerWidth-4||p.y>innerHeight-4)continue;
  const h=__scene.pickPlacement(p.x,p.y,z);
  if(!onTarget(h))continue;
  // Leave a few pixels of clearance for the moving camera and native input rounding.
  if([-3,3].every(d=>onTarget(__scene.pickPlacement(p.x+d,p.y,z))&&onTarget(__scene.pickPlacement(p.x,p.y+d,z))))return p;
  if(!tactile||anchor)candidates.push(p);
 }
 return candidates[0]??null;
})()`)
const pointer=(page,type,p,extra={})=>page.send('Input.dispatchMouseEvent',{type,...p,...extra})
export async function extendAuthoredLift(page){
 const before=await page.evaluate("__metro.getState().station.modules.find(m=>m.type==='lift')");
 await page.evaluate("(()=>{const s=__metro.getState();s.setModuleType('lift');s.setTool('module');s.setActiveZ(6);s.setLiftInterval(5)})()");await page.evaluate(frames);
 const candidate=()=>page.evaluate(`(()=>{const m=${JSON.stringify(before)},s=__metro.getState();for(const z of [m.to.z+1.02,m.to.z+1,m.to.z+.8,m.to.z+.4,m.to.z-.1,m.to.z-1])for(const dx of [.5,1,1.5])for(const dy of [.5,1,1.5]){const p=__videoInteriorPoint(m.x+dx,m.y+dy,z),hit=__scene.pickPlacement(p.x,p.y,s.activeZ);if(hit&&hit.cell[0]>=m.x&&hit.cell[0]<m.x+2&&hit.cell[1]>=m.y&&hit.cell[1]<m.y+2&&hit.cell[2]>=(m.from.z+m.to.z)/2)return{...p,hit}}return null})()`);
 const p=await candidate();if(!p){const debug=await page.evaluate(`(()=>{const m=${JSON.stringify(before)},a=[];for(const z of [4,5,6,7]){const p=__videoInteriorPoint(m.x+1,m.y+1,z);a.push({z,p,hit:__scene.pickPlacement(p.x,p.y,6)})}return{camera:__scene.cameraSys.camera.position.toArray(),a}})()`);throw Error('No visible upper lift surface: '+JSON.stringify(debug))}await pointer(page,'mouseMoved',{x:p.x,y:p.y});await sleep(800);
 const q=await candidate();if(!q)throw Error('Lift upper surface disappeared');await pointer(page,'mouseMoved',{x:q.x,y:q.y});await sleep(80);await pointer(page,'mousePressed',{x:q.x,y:q.y},{button:'left',buttons:1,clickCount:1});await pointer(page,'mouseReleased',{x:q.x,y:q.y},{button:'left',buttons:0,clickCount:1});await page.evaluate(frames);
 const state=await page.evaluate('__metro.getState().station'),after=state.modules.find(m=>m.id===before.id);if(after.to.z!==before.to.z+5||after.from.z!==before.from.z||state.modules.filter(m=>m.type==='lift').length!==1)throw Error(`Authored lift extension failed: ${JSON.stringify(after)}`);
 await page.evaluate("__metro.getState().setTool('select');__metro.getState().setActiveZ(1)");return{state,moduleId:after.id,beforeTop:before.to.z,afterTop:after.to.z,rises:after.cfg.rises,gesture:'native-pointer-click'};
}
export async function dragAuthored(page,step,seconds=1.3){
 const state=await page.evaluate('__metro.getState().station'),m=step.modules[0];
 const override=step.kind==='surface-override';
 let a=step.modules.reduce((a,b)=>b.x<a.x||b.x===a.x&&b.y<a.y?b:a),b=step.modules.reduce((a,b)=>b.x>a.x||b.x===a.x&&b.y>a.y?b:a);
 if(step.kind==='drag'&&a.x!==b.x&&m.type!=='tactile')[a,b]=[b,a];
 const points=override?0:step.batch?8:24;
 await page.evaluate(`(()=>{const s=__metro.getState();s.setActiveZ(${m.z});s.setModuleType(${JSON.stringify(modulePalette(m))});s.setModuleRot(${m.rot??0});s.setLineSpacing(0);s.setGateDoor(${JSON.stringify(m.type==='gate'?(m.cfg.door??'lane'):'lane')});s.setTool('module');__scene.setModulePreview(null)})()`);await page.evaluate(frames)
 const ids=new Set(state.modules.map(m=>m.id));
 const complete=added=>added.length===step.modules.length&&step.modules.every(e=>added.some(m=>m.type===e.type&&m.x===e.x&&m.y===e.y&&m.z===e.z));
 let added=[];
 const attempts=step.kind==='drag'?2:1;
 for(let attempt=0;attempt<attempts;attempt++){
  const begin=await point(page,a);
  if(begin){
   await pointer(page,'mouseMoved',begin);await sleep(100);
   const down=await point(page,a);
   if(down){
    await pointer(page,'mousePressed',down,{button:'left',buttons:1,clickCount:1});await sleep(180);
    for(let i=1;i<=points;i++){
     await sleep(seconds*1000/points);const t=i/points;
     await pointer(page,'mouseMoved',await page.evaluate(`__videoInteriorPoint(${a.x+.5+(b.x-a.x)*t},${a.y+.5+(b.y-a.y)*t},${a.z+1})`),{button:'left',buttons:1});
    }
    const anchor=step.kind==='drag'?a:null;
    const end=await point(page,b,anchor);
    if(end)await pointer(page,'mouseMoved',end,{button:'left',buttons:1});
    const release=end&&await point(page,b,anchor);
    if(!release){
     await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
     await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    }
    await pointer(page,'mouseReleased',release??down,{button:'left',buttons:0,clickCount:1});await page.evaluate(frames);
    const after=await page.evaluate('__metro.getState().station');
    added=after.modules.filter(m=>!ids.has(m.id));
    if(override&&after.modules.some(m=>m.id===step.replaces))throw Error(`Surface override kept the temporary paving at ${m.x},${m.y}`);
    if(complete(added))break;
    if(added.length&&attempt+1<attempts)await install(page,state);
   }
  }
  [a,b]=[b,a];
 }
 if(!complete(added))throw Error(`Authored ${step.kind} ${a.id} → ${b.id} expected ${step.modules.length}, got ${JSON.stringify(added)}; notice ${JSON.stringify(await page.evaluate('__metro.getState().notice'))}`);
 // Retain original save IDs and all authored subtype/configuration fields.
 const normalized={...state,modules:[...state.modules.filter(m=>m.id!==step.replaces),...step.modules]};await install(page,normalized);await page.evaluate("__metro.getState().setTool('select')")
 return{state:normalized,gesture:override?'native-pointer-click':'native-pointer-drag',nativeModuleIds:added.map(m=>m.id),points}
}
export async function authoredAction(page,shot,start,language){
 validateAuthoredReplay();const events=[],elapsed=()=> (performance.now()-start)/1000,at=async t=>sleep(Math.max(0,start+t*1000-performance.now()));
 const log=e=>events.push({at:elapsed(),...e});
 const caption=async card=>{events.push({at:elapsed(),action:'build-card',card});await page.evaluate(`document.getElementById('video-placement-label').textContent=${JSON.stringify(card)}`)};
 await page.evaluate(`(()=>{const token=++__videoInteriorToken,start=performance.now();window.__videoMotionLog=[];function step(now){if(token!==__videoInteriorToken)return;const t=Math.min(1,(now-start)/${shot.captureSeconds*1000});__videoMotionLog.push(__videoInteriorPose(t));if(t<1)requestAnimationFrame(step)}requestAnimationFrame(step)})()`)
 let state=emptyAuthoredState(),previous='';const frame=authoredFrameSteps(),cellSteps=frame.filter(s=>s.kind==='cells'),other=frame.filter(s=>s.kind!=='cells');
 for(let i=0;i<cellSteps.length;i++){
  await at(.5+i*30/cellSteps.length);const step=cellSteps[i],key=step.cells[0].z===1?'floor':step.cells[0].z===6?'deck':'wall';if(key!==previous){await caption(ui[language].video.buildPhases[key]);previous=key}
  state={...state,cells:[...state.cells,...step.cells]};await install(page,state);if(i%3===0)log({action:'frame-built',cells:step.cells.length})
 }
 await caption(ui[language].video.buildPhases.materials)
 for(let i=0;i<other.length;i++){
  const step=other[i];await at(31+i*16/other.length)
  if(['rectangle','surface-override'].includes(step.kind)){const {state:after,...gesture}=await dragAuthored(page,step,1.3);state=after;log({action:step.kind==='rectangle'?'frame-dragged':'surface-overridden',moduleIds:step.modules.map(m=>m.id),...gesture})}
  else{state={...state,modules:[...state.modules,...step.modules]};await install(page,state);log({action:'frame-built',moduleIds:step.modules.map(m=>m.id)})}
 }
 let previousBatch;
 for(const {step,when,duration} of authoredSchedule(shot.captureSeconds)){
  const m=step.modules[0];await at(when);
  if(!step.batch||step.batch!==previousBatch)await caption(step.batch?ui[language].video.placementGroups[step.batch]:step.kind==='extend'?ui[language].video.extendLift:authoredLabel(step,language));
  let gesture='native-preview-and-commit',extra={};
  const drag=step.kind==='drag'
   ? await dragAuthored(page,step,step.batch ? .32 : Math.max(.5,duration-.7))
   : null;
  if(drag){state=drag.state;gesture=drag.gesture;extra={nativeModuleIds:drag.nativeModuleIds,points:drag.points}}
  else if(step.kind==='extend'){const r=await extendAuthoredLift(page);state={...state,modules:state.modules.map(n=>n.id===m.id?m:n)};await install(page,state);gesture=r.gesture;extra={beforeTop:r.beforeTop,afterTop:r.afterTop,rises:r.rises}}
  else{
   await page.evaluate(`__scene.setModulePreview(${JSON.stringify(m)})`);
   await at(when+duration*.25);
   state={...state,modules:[...state.modules,...step.modules]};await install(page,state);await page.evaluate('__scene.setModulePreview(null)');
  }
  const action=step.kind==='extend'?'lift-extended':drag?'run-dragged':'interior-placed';
  const event={action,batch:step.batch,east:step.east,moduleIds:step.modules.map(m=>m.id),catalogueId:modulePalette(m),gesture,validation:'accepted',...extra};
  log(!step.batch||step.batch!==previousBatch?{file:'place.wav',...event}:event);
  previousBatch=step.batch;
 }
 const ordered=(values,key)=>[...values].sort((a,b)=>key(a).localeCompare(key(b)));
 if(!isDeepStrictEqual(ordered(state.modules,m=>m.id),ordered(authoredState.modules,m=>m.id))||!isDeepStrictEqual(ordered(state.cells,c=>`${c.x},${c.y},${c.z}`),ordered(authoredState.cells,c=>`${c.x},${c.y},${c.z}`)))throw Error('Recorded construction differs from the authored save');
 // Exact final snapshot retains authored ordering too; geometry never changes.
 await install(page,authoredState);await caption(ui[language].video.placementComplete);return events;
}
