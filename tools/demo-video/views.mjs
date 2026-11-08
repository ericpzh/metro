import {setTimeout as sleep} from 'node:timers/promises'

const section = { anchor: [50,-120,-8], from: 0, to: 98, target: [55,-83,-7], camera: [6,-200,42] }

export async function prepareExtraView(page,shot){
 if(shot.kind==='section')await page.evaluate(`(()=>{
  const s=__metro.getState(),section=${JSON.stringify(section)};
  s.setOrtho(false);s.setCutaway(true);s.setHideGround(true);s.setHideRoof(true);s.setHideWalls(false);s.setHideSectionSurface(true);
  s.placeSection(section.anchor);for(let i=0;i<4&&__metro.getState().section.orientation.azimuth!==0;i++)s.rotateSection();
  s.setSectionOffset(section.from);
  const c=__scene.cameraSys;c.setOrtho(false);c.setFov(44);c.controls.enableDamping=false;
  c.controls.target.set(...section.target);c.camera.position.set(...section.camera);c.camera.lookAt(c.controls.target);c.controls.update();__scene.requestRender();
 })()`)
 else await page.evaluate(`(()=>{
  // The cube drag is a viewing-angle change, not a cutaway: keep the walls.
  document.body.setAttribute('data-video-cube','');const s=__metro.getState();s.setOrtho(false);s.setActiveZ(-15);s.setHideWalls(false);s.setHideGround(true);s.setGhostOther(false);
  const c=__scene.cameraSys;c.setOrtho(false);c.controls.target.set(68,15,-12);c.camera.position.set(120,-55,45);c.camera.lookAt(c.controls.target);c.controls.update();__scene.requestRender();
 })()`)
}
export async function extraViewAction(page,shot,start){
 if(shot.kind==='section'){
  await page.evaluate(`(()=>{
   const start=performance.now(),duration=${shot.captureSeconds*1000},token=__videoMotionToken;
   const scene=__scene,c=scene.cameraSys,position=c.camera.position.clone(),target=c.controls.target.clone();
   window.__videoMotionLog=[];
   function slide(now){
    if(token!==__videoMotionToken)return;
    const t=Math.max(0,Math.min(1,(now-start)/duration)),ease=t*t*(3-2*t),offset=${section.from}+${section.to-section.from}*ease;
    __metro.getState().setSectionOffset(offset);
    const west=42*ease**2;
    c.camera.position.set(position.x-west,position.y+offset*.82,position.z-7*ease);
    c.controls.target.set(target.x-west,target.y+offset*.72,target.z);
    c.controls.update();scene.requestRender();
    __videoMotionLog.push({t,offset,camera:c.camera.position.toArray()});
    if(t<1)requestAnimationFrame(slide);
   }
   requestAnimationFrame(slide);
  })()`)
  return []
 }
 const at=async t=>sleep(Math.max(0,start+t*1000-performance.now())),events=[]
 const mouse=(type,p,extra={})=>page.send('Input.dispatchMouseEvent',{type,...p,...extra})
 await at(.25)
 const p=await page.evaluate("(()=>{const r=document.querySelector('.viewCubeStage svg').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
 await mouse('mouseMoved',p);await mouse('mousePressed',p,{button:'left',buttons:1,clickCount:1})
 const duration=shot.captureSeconds-.85
 for(let i=1;i<=78;i++){
  const t=i/78,ease=t*t*(3-2*t)
  await at(.25+duration*t)
  await mouse('mouseMoved',{x:p.x-155*ease,y:p.y+55*ease},{button:'left',buttons:1})
 }
 await mouse('mouseReleased',{x:p.x-155,y:p.y+55},{button:'left',buttons:0,clickCount:1})
 if(await page.evaluate('__metro.getState().ortho'))throw Error('The view cube left perspective during the recording')
 events.push({at:.25,action:'view-cube-orbit'})
 return events
}
