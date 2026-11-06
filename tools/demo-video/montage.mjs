import {setTimeout as sleep} from 'node:timers/promises'
import {waitFor} from '../browser-harness.mjs'

export async function prepareMontage(page,shot){
 if(shot.stage==='bridge'){
  await page.evaluate('__metro.getState().setHideUI(false);__metro.getState().setActiveZ(15);__metro.getState().setHideGround(false);__metro.getState().setHideRoof(false);__metro.getState().setSpeed(64);__metro.getState().setPlaying(true)')
  await waitFor(page.evaluate,'__scene.trains.lastBuffer.length>0&&__scene.trains.lastBuffer[5]>.5',{tries:360,every:30,what:'the real bridge service'})
  await page.evaluate('__metro.getState().setSpeed(4)')
  await waitFor(page.evaluate,'__scene.trains.lastBuffer.length>0&&__scene.trains.lastBuffer[0]>1&&__scene.trains.lastBuffer[0]<45',{tries:700,every:30,what:'a real train starting its bridge departure'})
  await page.evaluate('__metro.getState().setPlaying(false);__metro.getState().setSpeed(1)')
 }else await page.evaluate(`(()=>{const s=__metro.getState();s.setHideUI(false);s.setActiveZ(0);s.setHideGround(false);s.setHideRoof(false);if(${shot.stage==='equipment'}){s.setHideGround(true);s.setAutoCeiling(false);s.setCutaway(true);s.placeSection([0,-10000,0]);for(let i=0;i<4&&__metro.getState().section.orientation.azimuth!==0;i++)s.rotateSection();s.setSectionOffset(0);s.setHideSectionSurface(true)}})()`)
 await sleep(200)
 await page.evaluate(`(()=>{
  const c=__scene.cameraSys,Vector=c.camera.position.constructor,Box=__scene.ctx.bounds.constructor;
  c.setOrtho(false);c.setFov(${shot.panelCapture?43:55});c.controls.enableDamping=false;c.controls.minDistance=.1;
  let center=new Vector(.5,1,2.3),radius=14,height=7;
  if(${JSON.stringify(shot.stage)}==='equipment'){
   const box=new Box();for(const root of __scene.modules.moduleMeshes.children)if(String(root.userData.moduleId??'').startsWith('video-focus')){root.visible=true;root.updateWorldMatrix(true,true);box.expandByObject(root)}
   if(box.isEmpty())throw Error('Equipment stage has no rendered fixture');
   center=box.getCenter(new Vector());const size=box.getSize(new Vector()),extent=Math.max(size.x,size.y,size.z);
   radius=Math.max(.8,extent*1.25);height=radius*.5;
   if(${!!shot.panelCapture}){
    const corners=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new Vector(x,y,z));
    const fits=d=>{for(const degrees of [${shot.spin.from},${shot.spin.to}]){const a=degrees*Math.PI/180;c.camera.position.copy(center).add(new Vector(Math.sin(a)*d,Math.cos(a)*d,d*.5));c.camera.lookAt(center);c.camera.updateMatrixWorld(true);for(const p of corners){const v=p.clone().project(c.camera);if(Math.abs(v.x)>.87||Math.abs(v.y)>.60||v.z>1)return false}}return true};
    let low=.08,high=Math.max(1,extent);while(!fits(high))high*=1.5;
    for(let i=0;i<28;i++){const mid=(low+high)/2;if(fits(mid))high=mid;else low=mid}
    radius=high;height=radius*.5;
   }
  }
  if(${JSON.stringify(shot.stage)}==='bridge'){
   const lengths=[22,19.5,19,20.1,16.8],b=__scene.trains.lastBuffer,length=lengths[b[4]|0]*b[3];
   radius=28;height=12;
  }
  window.__videoOrbit={center:center.toArray(),radius,height,from:${shot.spin.from},to:${shot.spin.to},follow:${shot.stage==='bridge'},headOffset:${shot.stage==='bridge'?`[22,19.5,19,20.1,16.8][__scene.trains.lastBuffer[4]|0]*(__scene.trains.lastBuffer[3]/2-.45)*.98`:'0'}};
  window.__videoMotionToken=(window.__videoMotionToken??0)+1;const token=__videoMotionToken;
  window.__videoPose=degrees=>{
   const o=__videoOrbit,target=new Vector(...o.center);
   if(o.follow){__scene.trains.updateTrains(performance.now(),0);const train=__scene.trains.trainGroup.children.find(g=>g.userData.parked!==true&&g.visible);if(train)target.copy(train.position).add(new Vector(o.headOffset,0,1.7))}
   const a=degrees*Math.PI/180;c.controls.target.copy(target);c.camera.position.copy(target).add(new Vector(Math.sin(a)*o.radius,Math.cos(a)*o.radius,o.height));c.camera.lookAt(target);c.controls.update();__scene.requestRender();
   return {degrees,camera:c.camera.position.toArray(),target:target.toArray()};
  };
  function follow(){if(token!==__videoMotionToken)return;__videoPose(__videoOrbit.from);if(__videoOrbit.follow)requestAnimationFrame(follow)}follow();
 })()`)
 if(shot.stage==='bridge'){
  await page.evaluate('__metro.getState().setPlaying(true)')
  await sleep(250+(shot.montageIndex-1)*400)
 }
}

export async function startMontage(page,shot){
 await page.evaluate(`(()=>{
  const token=++__videoMotionToken,start=performance.now(),duration=${shot.captureSeconds*1000};window.__videoMotionLog=[];
  function animate(now){if(token!==__videoMotionToken)return;const t=Math.min(1,(now-start)/duration),angle=__videoOrbit.from+(__videoOrbit.to-__videoOrbit.from)*t;
   __videoMotionLog.push({progress:t,...__videoPose(angle)});if(t<1)requestAnimationFrame(animate)}
  __videoMotionLog.push({progress:0,...__videoPose(__videoOrbit.from)});requestAnimationFrame(animate);
 })()`)
}
