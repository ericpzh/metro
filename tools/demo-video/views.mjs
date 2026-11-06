import {setTimeout as sleep} from 'node:timers/promises'
export async function prepareExtraView(page,shot){
 if(shot.kind==='section')await page.evaluate(`(()=>{
  const s=__metro.getState(),zoo=${shot.station==='zoo'};s.setCutaway(true);s.setHideGround(true);s.setHideRoof(true);s.setHideWalls(false);s.setHideSectionSurface(false);
  const center=zoo?[76,18,-8]:[-10,7,5],azimuth=zoo?0:90;s.placeSection(zoo?center:[0,12,6]);for(let i=0;i<4&&__metro.getState().section.orientation.azimuth!==azimuth;i++)s.rotateSection();s.setSectionOffset(zoo?-4:-12);s.setHideSectionSurface(true);
  const c=__scene.cameraSys;c.setOrtho(false);c.setFov(38);c.controls.target.set(...center);c.camera.position.set(...(zoo?[105,-16,14]:[-45,-40,38]));c.camera.lookAt(c.controls.target);c.controls.update();__scene.requestRender();
 })()`)
 else await page.evaluate(`(()=>{
  document.body.setAttribute('data-video-cube','');const s=__metro.getState();s.setActiveZ(-15);s.setHideWalls(true);s.setHideGround(true);s.setGhostOther(true);
  const c=__scene.cameraSys;c.setOrtho(false);c.controls.target.set(68,15,-12);c.camera.position.set(120,-55,45);c.camera.lookAt(c.controls.target);c.controls.update();__scene.requestRender();
 })()`)
}
export async function extraViewAction(page,shot,start){
 if(shot.kind==='section'){
  await page.evaluate(`(()=>{const start=performance.now(),zoo=${shot.station==='zoo'},duration=${shot.seconds*1000};function slide(now){const t=Math.min(1,(now-start)/duration),ease=t*t*(3-2*t);__metro.getState().setSectionOffset(zoo?-4+16*ease:-12+24*ease);if(t<1)requestAnimationFrame(slide)}requestAnimationFrame(slide)})()`)
  return []
 }
 const at=async t=>sleep(Math.max(0,start+t*1000-performance.now())),events=[]
 const mouse=(type,p,extra={})=>page.send('Input.dispatchMouseEvent',{type,...p,...extra})
 await at(.25)
 const p=await page.evaluate("(()=>{const r=document.querySelector('.viewCubeStage svg').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
 await mouse('mouseMoved',p);await mouse('mousePressed',p,{button:'left',buttons:1,clickCount:1})
 for(let i=1;i<=42;i++){await at(.25+i*2/42);await mouse('mouseMoved',{x:p.x+96*Math.sin(i/42*Math.PI),y:p.y+65*i/42},{button:'left',buttons:1})}
 await mouse('mouseReleased',{x:p.x,y:p.y+65},{button:'left',buttons:0,clickCount:1});events.push({at:2.3,action:'view-cube-orbit'})
 await at(2.6)
 const top=await page.evaluate("(()=>{const e=document.querySelector('[data-action=\"face:top\"]'),r=e?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()")
 if(!top)throw Error('Top face of the view cube is not visible after dragging')
 await mouse('mouseMoved',top);await mouse('mousePressed',top,{button:'left',buttons:1,clickCount:1});await mouse('mouseReleased',top,{button:'left',buttons:0,clickCount:1});events.push({at:2.6,file:'select.wav'})
 await at(3.6)
 const corner=await page.evaluate("(()=>{const e=document.querySelector('.cubeCorner circle'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
 await mouse('mouseMoved',corner);await mouse('mousePressed',corner,{button:'left',buttons:1,clickCount:1});await mouse('mouseReleased',corner,{button:'left',buttons:0,clickCount:1});events.push({at:3.6,file:'select.wav'})
 return events
}
