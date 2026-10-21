import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';

const output=resolve(process.env.BENCH_OUTPUT??'.preview/perf/passenger-10pct/final-browser.json');
mkdirSync(dirname(output),{recursive:true});
const server=await serveDir(resolve('game/dist'),0);
let page;
try{
 page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(dirname(output),`quality-${process.pid}`),debugPort:9461,softwareGpu:false});
 await waitFor(page.evaluate,'!!window.__scene && !!window.__metro',{what:'production app'});
 await page.evaluate(`(async()=>{
  document.querySelector('.tutorialActions .ghost')?.click();
  __metro.getState().setPlaying(false);await new Promise(r=>setTimeout(r,500));
  window.__lodErrors=[];const original=console.error;console.error=(...args)=>{__lodErrors.push(args.map(String).join(' '));original(...args)};
  window.addEventListener('error',e=>__lodErrors.push(e.message));
  const c=__scene.crowd,z=__metro.getState().activeZ,agents=[];
  for(let i=0;i<232;i++)agents.push((i%16)-8,Math.floor(i/16)-7,z,0,0,i+1);
  c.setAgents(Float32Array.from(agents),232,1000);c.renderAgents(__scene.ctx.lastStateTime+500);
  window.__lodRefs=[c.agents.geometry,c.agentsLow.geometry,c.agents.instanceMatrix,c.agentsLow.instanceMatrix];
  window.__lodTick=__metro.getState().metrics.tick;window.__lodVersion=__metro.getState().version;
  document.querySelector('.settingsMenu summary').click();
 })()`);
 const results=[];
 for(const quality of ['low','high','low','high','low','high']){
  const point=await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.settingsMenu button')].find(b=>b.textContent==='${quality==='low'?'低画质':'高画质'}');if(!b)throw Error('quality control missing');const r=b.getBoundingClientRect();window.__lodStart=performance.now();b.addEventListener('click',()=>{window.__lodEventStart=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__lodEnd=performance.now()))},{once:true,capture:true});return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  await waitFor(page.evaluate,'window.__lodEnd>=window.__lodStart',{what:'quality frame'});
  results.push(await page.evaluate(`(()=>{const c=__scene.crowd;return{quality:__metro.getState().graphicsQuality,eventTwoRafMs:__lodEnd-__lodEventStart,highCount:c.agents.count,lowCount:c.agentsLow.count,highStride:c.agents.geometry.index.count/3,lowStride:c.agentsLow.geometry.index.count/3,retained:__lodRefs.every((v,i)=>v===[c.agents.geometry,c.agentsLow.geometry,c.agents.instanceMatrix,c.agentsLow.instanceMatrix][i]),tick:__metro.getState().metrics.tick,version:__metro.getState().version,render:{...__scene.renderer.info.render}}})()`));
  assert.equal(results.at(-1).quality,quality);assert.equal(results.at(-1).retained,true);
 }
 const state=await page.evaluate(`(()=>{const r=__scene.renderer,g=r.getContext(),extension=g.getExtension('WEBGL_debug_renderer_info');return{errors:__lodErrors,glError:g.getError(),shaderErrors:r.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length,tick:__lodTick,version:__lodVersion,gpu:extension?g.getParameter(extension.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),browser:navigator.userAgent,viewport:[r.domElement.width,r.domElement.height],population:232,seed:__metro.getState().station.seed}})()`);
 writeFileSync(output,JSON.stringify({state,results},null,2));
 assert.deepEqual(state.errors,[]);assert.equal(state.glError,0);assert.equal(state.shaderErrors,0);
 for(const r of results){assert.equal(r.tick,state.tick);assert.equal(r.version,state.version);assert.equal(r.highCount+r.lowCount,232);}
 console.log(JSON.stringify({output,...state,results},null,2));
}finally{if(page)await page.close();server.close();}
