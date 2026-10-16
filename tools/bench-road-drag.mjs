import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {serveDir,withPage,waitFor,loadExampleStation} from './browser-harness.mjs'
const output=resolve(process.env.BENCH_OUTPUT??'.preview/perf/road-baseline.json');mkdirSync(dirname(output),{recursive:true})
const server=await serveDir(resolve('game/dist'),0);let page,profile
try {
 page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(`.preview/perf/road-chrome-${process.pid}`),debugPort:9401,softwareGpu:process.env.ROAD_SOFTWARE_GPU==='1',windowSize:'1440,1000'})
 await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics',{what:'game'})
 await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
 if(process.env.BENCH_STATION) await page.evaluate(`window.__metro.getState().loadFromText(${JSON.stringify(readFileSync(process.env.BENCH_STATION,'utf8'))})`)
 else if(process.env.ROAD_FIXTURE!=='empty') await loadExampleStation(page)
 const fixture=await page.evaluate(`(async()=>{
  const store=window.__metro,s=store.getState(),scene=window.__scene;
  store.setState({tool:'module',moduleType:'road',moduleRot:0,roadDirection:'two-way'});s.setActiveZ(0);
  const cellEdge=s.station.cells.reduce((hi,c)=>Math.max(hi,c.x),0);
  const x=s.station.modules.reduce((hi,m)=>Math.max(hi,m.x+(m.w??1)),cellEdge)+20,y=0;
  if(${process.env.ROAD_INTERSECT==='1'}) {
    s.commit({...s.station,modules:[...s.station.modules,{id:'bench-cross-road',type:'road',x:x-20,y:y+40,z:0,rot:1,w:52,d:6,cfg:{direction:'two-way'}}]});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  }
  scene.setPreset('plan');scene.setOrtho(true);
  const cs=scene.cameraSys;cs.controls.target.set(x+6,y+48,1);cs.camera.position.set(x+6,y+48,201);cs.controls.update();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  window.__roadBench={samples:[],sceneCalls:[],errors:[],phase:'idle',x,y};
  window.addEventListener('error',e=>__roadBench.errors.push(e.message));
  window.addEventListener('unhandledrejection',e=>__roadBench.errors.push(String(e.reason)));
  for(const name of ['setModulePreview','setStation','pickModule']) {
    const original=scene[name];scene[name]=function(...args){const start=performance.now(),before=name==='setStation'?new Set(scene.modules.moduleMeshes.children):null;try{return original.apply(this,args)}finally{__roadBench.sceneCalls.push({name,phase:__roadBench.phase,ms:performance.now()-start,retained:before?scene.modules.moduleMeshes.children.filter(g=>typeof g.userData.moduleId==='string'&&before.has(g)).length:undefined,previewMeshes:scene.ghostSys.previewGroup.children.reduce((sum,g)=>{g.traverse(o=>{if(o.isMesh)sum++});return sum},0)})}};
  }
  let commits=0;const commit=store.getState().commit;store.setState({commit:(...args)=>{commits++;return commit(...args)}});__roadBench.commits=()=>commits;
  const cam=cs.activeCamera(),rect=scene.renderer.domElement.getBoundingClientRect();
  const point=(dx,dy)=>{const v=cam.position.clone().set(x+dx+.5,y+dy+.5,1.001).project(cam);return {x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2}};
  return {name:s.station.name,cells:s.station.cells.length,modules:store.getState().station.modules.length,intersect:${process.env.ROAD_INTERSECT==='1'},seed:s.station.seed,population:s.metrics?.inside??0,points:[point(0,0),point(5,7),point(11,31),point(11,63),point(11,95)],browser:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},playing:s.playing,activeZ:0,gpu:(()=>{const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)})()};
 })()`)
 if(process.env.BENCH_PROFILE==='1'){await page.send('Profiler.enable');await page.send('Profiler.start')}
 const measure=async(phase,method,params)=>{
  await page.evaluate(`__roadBench.phase=${JSON.stringify(phase)};__roadBench.start=performance.now()`)
  await page.send(method,params)
  await page.evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{__roadBench.samples.push({phase:__roadBench.phase,twoRafMs:performance.now()-__roadBench.start});r()})))`)
 }
 for(let run=0;run<3;run++) {
  const [a,...points]=fixture.points;
  await measure(`${run}:hover`,'Input.dispatchMouseEvent',{type:'mouseMoved',...a})
  await measure(`${run}:down`,'Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1})
  for(let i=0;i<points.length;i++)await measure(`${run}:move${i}`,'Input.dispatchMouseEvent',{type:'mouseMoved',...points[i],button:'left',buttons:1})
  if(run===2) await measure(`${run}:release`,'Input.dispatchMouseEvent',{type:'mouseReleased',...points.at(-1),button:'left',buttons:0,clickCount:1})
  else {
    await measure(`${run}:cancel`,'Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...points.at(-1),button:'left',buttons:0,clickCount:1})
  }
 }
 if(process.env.BENCH_PROFILE==='1')profile=(await page.send('Profiler.stop')).profile
 const report=await page.evaluate(`({samples:__roadBench.samples,errors:__roadBench.errors,shaderFailures:window.__scene.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length,calls:__roadBench.sceneCalls,commits:__roadBench.commits(),placed:window.__metro.getState().station.modules.filter(m=>m.type==='road'),notice:window.__metro.getState().notice})`)
 Object.assign(report,{fixture,profiled:!!profile,softwareGpu:process.env.ROAD_SOFTWARE_GPU==='1'});writeFileSync(output,JSON.stringify(report,null,2));if(profile)writeFileSync(output.replace(/\.json$/,'.cpuprofile'),JSON.stringify(profile));
 console.log(JSON.stringify({fixture:{cells:fixture.cells,modules:fixture.modules,gpu:fixture.gpu},samples:report.samples,calls:report.calls.filter(c=>c.name==='setModulePreview'||c.name==='setStation'),commits:report.commits,placed:report.placed.length},null,2))
}finally{await page?.close();server.close()}
