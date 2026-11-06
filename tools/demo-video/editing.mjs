import {setTimeout as sleep} from 'node:timers/promises'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
const reference=JSON.parse(readFileSync(resolve('game/src/data/tanwei-station.json'),'utf8'))
const item=(sourceId,palette,zone)=>{
 const m=reference.modules.find(m=>m.id===sourceId)
 if(!m||m.z!==1)throw Error(`Tanwei 1 m reference fixture missing: ${sourceId}`)
 return {sourceId,palette,zone,x:m.x,y:m.y,rot:m.rot??0,type:m.type}
}
export const placementLayout=[
 ...['tvm-472','tvm-473','tvm-9627'].map(id=>item(id,'tvm','unpaid-ticketing')),
 ...['gate-323','gate-322','gate-321','gate-320','gate-224','gate-223','gate-2149','gate-2148'].map(id=>item(id,'gate-new','fare-boundary')),
 ...['vending-476','vending-477'].map(id=>item(id,'vending','west-wall')),
 ...['shelf-cooler-dark-1595','shelf-cooler-dark-1596','shelf-cooler-dark-1597'].map(id=>item(id,'shelf-cooler-dark','shop-wall')),
 ...['shelf-dark-tall-1598','shelf-dark-tall-1599'].map(id=>item(id,'shelf-dark-tall','shop-wall')),
 ...['checkout-1116','checkout-1117'].map(id=>item(id,'checkout','shop-counter')),
 item('bin-484','bin','paid-hall'),
]
export const serviceRooms=['ticket-9625','ticket-579'].map(sourceId=>{
 const m=reference.modules.find(m=>m.id===sourceId);return {sourceId,x:m.x,y:m.y,w:m.w,h:m.h}
})
export const hall={x0:0,x1:32,y0:-24,y1:10,z:1}
const frames='new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
const mouse=(page,type,p,extra={})=>page.send('Input.dispatchMouseEvent',{type,...p,...extra})
async function project(page,x,y,z){return page.evaluate(`__videoPoint(${x},${y},${z})`)}
async function drag(page,a,b,seconds){
 const start=performance.now();await mouse(page,'mouseMoved',a);await sleep(100)
 await mouse(page,'mousePressed',a,{button:'left',buttons:1,clickCount:1})
 for(let i=1;i<=28;i++){await sleep(Math.max(0,start+seconds*1000*i/28-performance.now()));await mouse(page,'mouseMoved',{x:a.x+(b.x-a.x)*i/28,y:a.y+(b.y-a.y)*i/28},{button:'left',buttons:1})}
 await mouse(page,'mouseReleased',b,{button:'left',buttons:0,clickCount:1});await page.evaluate(frames)
}
export async function prepareEditing(page,shot){
 await page.evaluate(`(()=>{
  const s=__metro.getState();s.setPlaying(false);s.setActiveZ(1);s.setHideGround(true);s.setHideWalls(false);s.setHideUI(false);s.setAutoWalls(false);s.setTool('block');
  const c=__scene.cameraSys;c.setOrtho(false);c.setFov(45);c.controls.enableDamping=false;c.controls.target.set(16,-7,1);c.camera.position.set(28,-17,76);c.camera.lookAt(c.controls.target);c.controls.update();c.camera.updateMatrixWorld(true);const pan=new c.camera.position.constructor().setFromMatrixColumn(c.camera.matrixWorld,1).multiplyScalar(4);c.controls.target.add(pan);c.camera.position.add(pan);c.controls.update();__scene.requestRender();
  const Vector=c.camera.position.constructor;
  window.__videoPoint=(x,y,z)=>{const r=__scene.renderer.domElement.getBoundingClientRect(),v=new Vector(x,y,z).project(c.activeCamera());return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}};
 })()`)
 await page.evaluate(frames)
 if(shot.kind==='equipment'&&await page.evaluate('__metro.getState().station.cells.length===0')){
  await drag(page,await project(page,.5,-23.5,1),await project(page,32.5,10.5,1),1)
 }
 if(shot.kind==='equipment')await page.evaluate('__metro.getState().setActiveZ(0)')
 await page.evaluate(frames)
 await page.evaluate('window.__videoBefore={cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length}')
 await mouse(page,'mouseMoved',{x:1000,y:90})
}
export async function editingAction(page,shot,recordStart){
 const events=[],at=async t=>sleep(Math.max(0,recordStart+t*1000-performance.now()))
 const cue=()=>events.push({at:(performance.now()-recordStart)/1000,file:'place.wav'})
 if(shot.kind==='blocks'){
  await at(1);await drag(page,await project(page,.5,-23.5,1),await project(page,32.5,10.5,1),3.2);cue()
  await page.evaluate('__metro.getState().setActiveZ(0)');await page.evaluate(frames)
  await at(5.5);await page.evaluate("__metro.getState().setTool('wall')")
  await drag(page,await project(page,.5,10.5,1),await project(page,32.5,10.5,1),2.7);cue()
  await at(9.3);await drag(page,await project(page,.5,-23.5,1),await project(page,.5,9.5,1),2.7);cue()
  await at(13.5);await page.evaluate("__metro.getState().setTool('select')")
  const change=await page.evaluate('({before:__videoBefore,after:{cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length}})')
  if(change.before.cells!==0||change.before.modules!==0||change.after.cells<1000)throw Error(`Empty-station foundation differs: ${JSON.stringify(change)}`)
  events.push({at:13.5,action:'empty-station-built',...change})
 }else{
  for(let i=0;i<serviceRooms.length;i++){
   const room=serviceRooms[i];await at(.4+i*1.25)
   await page.evaluate("__metro.getState().setZoneBrush('ticket');__metro.getState().setTool('zone')")
   await drag(page,await project(page,room.x+.5,room.y+.5,1),await project(page,room.x+room.w-.5,room.y+room.h-.5,1),.9)
   const found=await page.evaluate(`__metro.getState().station.modules.some(m=>m.type==='booth'&&m.x===${room.x}&&m.y===${room.y})`)
   if(!found)throw Error(`Service room placement refused: ${room.sourceId}`)
   cue();events.push({at:(performance.now()-recordStart)/1000,action:'facility-drawn',sourceId:room.sourceId})
  }
  for(let i=0;i<placementLayout.length;i++){
   const item=placementLayout[i]
   await at(3+i*.78);await page.evaluate(`window.__videoOldIds=new Set(__metro.getState().station.modules.map(m=>m.id));__metro.getState().setModuleType(${JSON.stringify(item.palette)});__metro.getState().setModuleRot(${item.rot});__metro.getState().setTool('module')`);await page.evaluate(frames)
   const p=await project(page,item.x+.5,item.y+.5,1)
   await mouse(page,'mouseMoved',p);await sleep(140);await mouse(page,'mousePressed',p,{button:'left',buttons:1,clickCount:1});await mouse(page,'mouseReleased',p,{button:'left',buttons:0,clickCount:1});await page.evaluate(frames)
   const added=await page.evaluate(`__metro.getState().station.modules.filter(m=>!__videoOldIds.has(m.id)).map(m=>({id:m.id,type:m.type,x:m.x,y:m.y,z:m.z}))`)
   if(!added.some(m=>m.type===item.type&&m.x===item.x&&m.y===item.y&&m.z===1))throw Error(`Equipment placement differs: ${item.palette} (${item.sourceId}); ${await page.evaluate('JSON.stringify({notice:__metro.getState().notice,added:__metro.getState().station.modules.filter(m=>!__videoOldIds.has(m.id))})')}`)
   cue();events.push({at:(performance.now()-recordStart)/1000,action:'equipment-placed',...item,added})
  }
  await page.evaluate("__metro.getState().setModuleType('fence');__metro.getState().setModuleRot(0);__metro.getState().setTool('module')")
  for(const [i,[x0,x1]] of [[1,10],[19,22],[26,31]].entries()){
   await at(20.2+i*1.1)
   await drag(page,await project(page,x0+.5,-19.5,1),await project(page,x1+.5,-19.5,1),.8);cue()
   const complete=await page.evaluate(`Array.from({length:${x1-x0+1}},(_,i)=>${x0}+i).every(x=>__metro.getState().station.modules.some(m=>m.type==='fence'&&m.x===x&&m.y===-20&&m.z===1))`)
   if(!complete)throw Error(`Fare divider incomplete: ${x0}–${x1}`)
   events.push({at:(performance.now()-recordStart)/1000,action:'fare-divider',from:[x0,-20],to:[x1,-20]})
  }
  await page.evaluate("__metro.getState().setTool('select')")
 }
 await mouse(page,'mouseMoved',{x:1000,y:90})
 return events
}
