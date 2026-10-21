import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {STOCK_CLASSES,TRAIN_ORIGIN_Z} from '../game/src/sim/stock.ts';
const output=resolve(process.env.BENCH_OUTPUT??'.preview/perf/transport-10pct/final-browser.json');
mkdirSync(dirname(output),{recursive:true});
const server=await serveDir(resolve('game/dist'),0);let page;
try{
 page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(dirname(output),`transport-${process.pid}`),debugPort:9473,softwareGpu:false});
 await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics',{what:'production app'});
 const setup=await page.evaluate(`(async()=>{
  document.querySelector('.tutorialActions .ghost')?.click();__metro.getState().setPlaying(false);await new Promise(r=>setTimeout(r,500));
  window.__transportErrors=[];const original=console.error;console.error=(...a)=>{__transportErrors.push(a.map(String).join(' '));original(...a)};
  addEventListener('error',e=>__transportErrors.push(e.message));const start=performance.now(),s=__scene;
  const road={id:'benchmark-road',type:'road',x:0,y:0,z:0,rot:0,w:24,d:1000,cfg:{direction:'two-way'}};
  s.setStation({...__metro.getState().station,cells:[],modules:[road]});
  const snapshot=${JSON.stringify(STOCK_CLASSES.flatMap((stock,i)=>[0,i*8,TRAIN_ORIGIN_Z,stock==='A'||stock==='D'?8:6,i,0,0x336699,1,0,3]))};
  s.setTrains(Float32Array.from(snapshot));s.roads.setSimTime(100);s.roads.update(performance.now()+1000,s.modules.moduleMeshes);
  s.cameraSys.camera.position.set(110,-170,100);s.controls.target.set(0,0,0);s.controls.enableDamping=false;s.controls.update();
  s.trains.trainGroup.traverse(o=>{if(o.isMesh)o.frustumCulled=false});s.requestRender();
  const roads=[...s.roads.meshes.values()].flatMap(d=>[...d.high,...d.low]);
  window.__transportRefs=roads.map(m=>[m,m.geometry,m.instanceMatrix]);
  window.__transportTrains=[...s.trains.details.entries()].map(([group,details])=>[group,details]);
  window.__transportTick=__metro.getState().metrics.tick;window.__transportVersion=__metro.getState().version;
  document.querySelector('.settingsMenu summary').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return{prepareMs:performance.now()-start,trains:s.trains.trainSlots.size,roadVariants:[...s.roads.meshes.keys()],tick:__transportTick,version:__transportVersion};
 })()`);
 const results=[];
 for(const quality of ['low','high','low','high','low','high']){
  const point=await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.settingsMenu button')].find(b=>b.textContent==='${quality==='low'?'低画质':'高画质'}');const r=b.getBoundingClientRect();window.__transportStart=performance.now();b.addEventListener('click',()=>{window.__transportEvent=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__transportEnd=performance.now()))},{once:true,capture:true});return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  await waitFor(page.evaluate,'window.__transportEnd>=window.__transportStart',{what:'quality frame'});
  results.push(await page.evaluate(`(()=>{const s=__scene;return{quality:__metro.getState().graphicsQuality,eventTwoRafMs:__transportEnd-__transportEvent,render:{...s.renderer.info.render},retained:__transportRefs.every(([m,g,a])=>m.geometry===g&&m.instanceMatrix===a)&&__transportTrains.every(([g,d])=>s.trains.details.get(g)===d),vehicles:__transportRefs.filter(([m])=>m.material.colorWrite&&m.count>0).map(([m])=>({variant:m.userData.vehicleVariant,quality:m.userData.vehicleDetail,count:m.count})),tick:__metro.getState().metrics.tick,version:__metro.getState().version}})()`));
 }
 const state=await page.evaluate(`(()=>{const r=__scene.renderer,g=r.getContext(),ext=g.getExtension('WEBGL_debug_renderer_info');return{errors:__transportErrors,glError:g.getError(),shaderErrors:r.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length,gpu:ext?g.getParameter(ext.UNMASKED_RENDERER_WEBGL):'',browser:navigator.userAgent,viewport:[r.domElement.width,r.domElement.height],dpr:devicePixelRatio}})()`);
 writeFileSync(output,JSON.stringify({setup,state,results},null,2));
 assert.equal(setup.trains,5);assert.equal(setup.roadVariants.length,6);assert.deepEqual(state.errors,[]);assert.equal(state.glError,0);assert.equal(state.shaderErrors,0);
 for(const [i,r]of results.entries()){assert.equal(r.quality,i%2?'high':'low');assert.equal(r.retained,true);assert.equal(r.tick,setup.tick);assert.equal(r.version,setup.version);assert.ok(r.vehicles.length>0);assert.ok(r.vehicles.every(v=>v.quality===r.quality));}
 console.log({output,setup,results});
}finally{await page?.close();server.close();}
