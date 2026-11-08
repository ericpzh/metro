import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {serveDir,withPage,waitFor} from '../browser-harness.mjs'
import {authoredState,authoredPath,authoredFrameSteps,authoredSteps,authoredSchedule} from './authored-layout.mjs'
import {prepareAuthored,dragAuthored,extendAuthoredLift} from './authored-shot.mjs'
import {prepareShot} from './capture.mjs'
import {timeline} from './plan.mjs'
import {setTimeout as sleep} from 'node:timers/promises'
import {connectRecorder} from './record.mjs'
import {screenshot} from './capture.mjs'
const output=resolve('.preview/demo-video/zh-studio-2k-v6');mkdirSync(output,{recursive:true});const server=await serveDir(resolve('game/dist'),0);let page,recorder;
try{
 const port=19183;page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(output,'authored-check-browser'),debugPort:port,windowSize:'2560,1440',softwareGpu:false});await page.send('Emulation.setDeviceMetricsOverride',{width:2560,height:1440,deviceScaleFactor:1,mobile:false});await waitFor(page.evaluate,'!!window.__metro&&!!window.__scene',{what:'production game'});
 const{root}=await page.send('DOM.getDocument'),{nodeId}=await page.send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});await page.send('DOM.setFileInputFiles',{nodeId,files:[authoredPath]});await waitFor(page.evaluate,`__scene.ctx.stationData?.modules.length===${authoredState.modules.length}`,{what:'native save import'});
 const shot=timeline('zh').find(s=>s.kind==='placement');
 await prepareShot(page,shot,{language:'zh'});await prepareAuthored(page,{kind:'placement'},'zh',{full:true});await page.evaluate("document.getElementById('video-placement-label').remove()");recorder=await connectRecorder(port);
 for(const [name,t]of[['p1',0],['middle',.5],['p2',1]]){await page.evaluate(`__videoInteriorPose(${t})`);await sleep(600);await page.evaluate('__scene.requestRender()');await screenshot(page,resolve(output,`${name}.png`),recorder,{width:2560,height:1440});console.log(name,await page.evaluate('({camera:__scene.cameraSys.camera.position.toArray(),target:__scene.cameraSys.controls.target.toArray()})'))}
 writeFileSync(resolve(output,'authored-import-check.json'),JSON.stringify({file:authoredPath,cells:authoredState.cells.length,modules:authoredState.modules.length,loadedThroughNativeInput:true},null,2));console.log(output)
 if(process.argv.includes('--last-run')){
  const i=authoredSteps.findIndex(s=>s.kind==='drag'&&s.modules[0].type==='fence'&&s.modules.length===4),state={...authoredState,modules:[...authoredState.modules.filter(m=>authoredFrameSteps().some(s=>s.modules?.some(n=>n.id===m.id))),...authoredSteps.slice(0,i).filter(s=>s.kind!=='extend').flatMap(s=>s.modules)]};await page.evaluate(`__metro.getState().commit(${JSON.stringify(state)});__videoInteriorPose(${.26+i/authoredSteps.length*.65})`);await dragAuthored(page,authoredSteps[i],.65);console.log('last fence passed')
 }
 if(process.argv.includes('--gestures')){
  const steps=authoredFrameSteps().filter(s=>s.modules),gestures=[];let state={...authoredState,modules:[]};
  const install=async()=>page.evaluate(`__metro.getState().commit(${JSON.stringify(state)})`);
  for(const [i,step] of steps.entries()){
   await install();await page.evaluate(`__videoInteriorPose(${(31+i*16/steps.length+.5)/shot.captureSeconds})`);
   if(['rectangle','surface-override'].includes(step.kind)){const r=await dragAuthored(page,step,.65);state=r.state;gestures.push({kind:step.kind,ids:step.modules.map(m=>m.id),gesture:r.gesture});console.log(step.kind,step.modules[0].type,step.modules.length)}else state.modules.push(...step.modules)
  }
  for(const {step,when} of authoredSchedule(shot.captureSeconds)){
   await install();await page.evaluate(`__videoInteriorPose(${(when+.5)/shot.captureSeconds})`);
   if(step.kind==='drag'){const r=await dragAuthored(page,step,.65);state=r.state;gestures.push({ids:step.modules.map(m=>m.id),gesture:r.gesture});console.log('drag',step.modules[0].type,step.modules.length)}
   else if(step.kind==='extend'){const r=await extendAuthoredLift(page);state=r.state;gestures.push({id:r.moduleId,gesture:r.gesture,rises:r.rises});console.log('lift extended')}
   else state={...state,modules:[...state.modules,...step.modules]}
  }
  writeFileSync(resolve(output,'gesture-check.json'),JSON.stringify(gestures,null,2));
 }
}finally{recorder?.close();if(page)await page.close();await new Promise(r=>server.close(r))}
