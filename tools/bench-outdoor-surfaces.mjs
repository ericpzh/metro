import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'
import {createModule} from '../game/src/build/model.ts'
const output=resolve(process.env.BENCH_OUTPUT??'.preview/perf/outdoor-surfaces');mkdirSync(output,{recursive:true})
const server=await serveDir(resolve('game/dist'),0);let page
try {
 page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(output,`chrome-${process.pid}`),debugPort:9495,softwareGpu:false,windowSize:'1440,1000'})
 await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics',{what:'game'})
 const modules=Array.from({length:400},(_,i)=>createModule('bin',-25+(i%20),-10+Math.floor(i/20),0,'fixture-'+i))
 if(process.env.BENCH_EXPAND!=='1') modules.push(createModule('bin',20,20,0,'extent'))
 await page.evaluate(`window.outdoorErrors=[];addEventListener('error',e=>outdoorErrors.push(e.message));document.querySelector('.tutorialActions .ghost')?.click();__metro.getState().commit({...__metro.getState().station,cells:[],modules:${JSON.stringify(modules)}});__metro.setState({playing:false,activeZ:0,tool:'select'})`)
 await page.evaluate('new Promise(r=>setTimeout(r,1000))')
 await page.evaluate(`(()=>{const c=__scene.cameraSys;c.controls.enableDamping=false;c.controls.target.set(4,4,1);c.camera.position.set(23,-24,32);c.controls.update();window.results=[];window.work={};for(const [object,key] of [[__scene,'pickModule'],[__scene,'setModulePreview'],[__scene,'setStation'],[__scene.chunks,'meshStation'],[__scene.modules,'buildModules']]){const original=object[key];object[key]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{const stat=work[key]??={calls:0,ms:0};stat.calls++;stat.ms+=performance.now()-t}}}for(const event of ['pointerdown','pointermove','pointerup']){document.addEventListener(event,()=>{window.eventStart=performance.now()},{capture:true});document.addEventListener(event,()=>{window.lastEvent={event,ms:performance.now()-eventStart}})}})()`)
 writeFileSync(resolve(output,'environment.json'),JSON.stringify(await page.evaluate(`(()=>{const gl=__scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {browser:navigator.userAgent,processors:navigator.hardwareConcurrency,viewport:[innerWidth,innerHeight],gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),seed:__metro.getState().station.seed,modules:__metro.getState().station.modules.length,playing:__metro.getState().playing,population:0}})()`),null,2))
 for(const type of ['sidewalk','lawn'])for(let run=0;run<2;run++) {
  await page.evaluate(`__metro.setState({tool:'module',moduleType:'${type}',moduleRot:0});window.work={};window.beforeRoots=new Set(__scene.modules.moduleMeshes.children.filter(m=>m.userData.moduleId))`)
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const points=await page.evaluate(`(()=>{const c=__scene.cameraSys.camera;c.updateMatrixWorld(true);const rect=__scene.renderer.domElement.getBoundingClientRect();return [[.5,.5],[4.5,4.5],[9.5,9.5]].map(([x,y])=>{const v=c.position.clone().set(x,y,1).project(c);return {x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2}})})()`)
  const phases=[]
  async function event(phase,method,args){await page.evaluate('window.phaseStart=performance.now()');await page.send(method,args);await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');phases.push(await page.evaluate(`({phase:'${phase}',handler:lastEvent,frameMs:performance.now()-phaseStart,work:JSON.parse(JSON.stringify(work))})`))}
  if(process.env.PROFILE==='1') {await page.send('Profiler.enable');await page.send('Profiler.start')}
  await event('hover','Input.dispatchMouseEvent',{type:'mouseMoved',...points[0]})
  await event('down','Input.dispatchMouseEvent',{type:'mousePressed',...points[0],button:'left',clickCount:1})
  for(let i=1;i<3;i++)await event('move-'+i,'Input.dispatchMouseEvent',{type:'mouseMoved',...points[i],buttons:1,button:'left'})
  await event('release','Input.dispatchMouseEvent',{type:'mouseReleased',...points[2],button:'left',clickCount:1})
  if(process.env.PROFILE==='1'){const {profile}=await page.send('Profiler.stop');writeFileSync(resolve(output,`${type}-${run}.cpuprofile`),JSON.stringify(profile))}
  const status=await page.evaluate(`({modules:__metro.getState().station.modules.length,notice:__metro.getState().notice,draws:__scene.renderer.info.render.calls,retainedRoots:__scene.modules.moduleMeshes.children.filter(m=>beforeRoots.has(m)).length})`)
  assert.equal(status.modules,modules.length+100,'the gesture must place exactly 100 visible tiles');assert.deepEqual(await page.evaluate('outdoorErrors'),[]);const report={type,run,phases,status};console.log(JSON.stringify(report));await page.evaluate(`results.push(${JSON.stringify(report)});__metro.getState().undo()`);await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 }
 writeFileSync(resolve(output,'report.json'),JSON.stringify(await page.evaluate('results'),null,2))
}finally{await page?.close();server.close()}
