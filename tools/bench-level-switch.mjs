import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/level-switch.json')
mkdirSync(dirname(output), {recursive:true})
const server = await serveDir(resolve('game/dist'), 0)
const reports = []
const uncached = process.argv.includes('--uncached')
const noMultiDraw = process.argv.includes('--no-multi-draw')
const baseline = process.argv.includes('--baseline')
try {
  for (const id of ['zoo', 'tanwei']) {
    const page = await withPage({url:`http://127.0.0.1:${server.address().port}/`,
      profile:resolve(dirname(output), `levels-${id}-${process.pid}`), softwareGpu:false})
    try {
      if (noMultiDraw) {
        await page.send('Page.enable')
        await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const getExtension=WebGL2RenderingContext.prototype.getExtension; WebGL2RenderingContext.prototype.getExtension=function(name){return name==='WEBGL_multi_draw'?null:getExtension.call(this,name)}`})
        await page.send('Page.reload')
      }
      await waitFor(page.evaluate, '!!window.__scene && !!window.__metro', {what:'app'})
      await page.evaluate(`(() => {
        window.__levelOpening={warmMs:0,warmCalls:0,invalidations:[],syncs:[],errors:[]};
        const error=console.error; console.error=(...args)=>{__levelOpening.errors.push(args.map(String).join(' '));error(...args)};
        window.addEventListener('error',e=>__levelOpening.errors.push(e.message));
        window.addEventListener('unhandledrejection',e=>__levelOpening.errors.push(String(e.reason)));
        const scene=__scene, prepare=scene.prepareBuildViews;
        const invalidate=scene.modules.batches.invalidateViews;
        scene.modules.batches.invalidateViews=function(){__levelOpening.invalidations.push({at:performance.now(),stack:new Error().stack});return invalidate.call(this)};
        const synchronize=scene.modules.batches.sync;
        scene.modules.batches.sync=function(...args){
          __levelOpening.syncs.push({z:scene.ctx.activeZ,at:performance.now(),hit:this.views.has(args[1]),sameGeneration:this.generation===args[2],keys:[...this.views.keys()].map(k=>k.split('|')[0])});
          return synchronize.apply(this,args);
        };
        scene.prepareBuildViews=function(...args){const t=performance.now(); try{return prepare.apply(this,args)}finally{__levelOpening.warmMs+=performance.now()-t;__levelOpening.warmCalls++}};
        ${uncached ? `scene.prepareBuildViews=()=>{}; const sync=scene.modules.batches.sync; scene.modules.batches.sync=function(modules,revision){return sync.call(this,modules,revision)}` : ''}
      })()`)
      const loadStart = performance.now()
      await loadExampleStation(page,id)
      const loadMs = performance.now()-loadStart
      await page.evaluate(`window.__metro.getState().setPlaying(false); new Promise(r=>setTimeout(r,3000))`)
      await page.evaluate(`(() => {
        const s=window.__scene; window.__levelBench={work:{},events:[],errors:[],views:{},tick:__metro.getState().metrics.tick};
        window.addEventListener('error',e=>__levelBench.errors.push(e.message));
        for(const [owner,name,label] of [[s,'setLevel','setLevel'],[s.level,'applyLevel','slice'],
          [s.modules,'syncBatches','batches'],[s.modules,'buildModules','models'],[s,'setStation','station'],
          [s.renderer,'render','render'],[Storage.prototype,'setItem','save']]) {
          const fn=owner[name]; owner[name]=function(...args) {
            const t=performance.now(); try {return fn.apply(this,args)} finally {
              const w=__levelBench.work[label]??={calls:0,ms:0}; w.calls++; w.ms+=performance.now()-t;
            }
          };
        }
        s.controls.enableDamping=false;
        document.activeElement?.blur();
        document.addEventListener('keydown', e=> {
          if(!['q','e'].includes(e.key))return;
          const t=performance.now(),z=__metro.getState().activeZ;
          requestAnimationFrame(()=>requestAnimationFrame(()=>__levelBench.events.push({key:e.key,z,to:__metro.getState().activeZ,ms:performance.now()-t})));
        },true);
      })()`)
      const events=[]
      for(const key of ['e','q','e','q','e','q','e','q']) {
        await page.evaluate(`__levelBench.work={}; __levelBench.before=__scene.modules.batches.root.children.map(m=>m.uuid)`)
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:`Key${key.toUpperCase()}`,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:`Key${key.toUpperCase()}`,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})
        await page.evaluate(`new Promise(r=>setTimeout(r,600))`)
        events.push(await page.evaluate(`(() => {
          const meshes=__scene.modules.batches.root.children.map(m=>m.uuid), z=__metro.getState().activeZ;
          const previous=__levelBench.views[z]; __levelBench.views[z]=meshes;
          const sync=__levelOpening.syncs.at(-1);
          return {event:__levelBench.events.at(-1),work:__levelBench.work,batchHit:sync.hit&&sync.sameGeneration,
            sameViewRetained:previous ? meshes.filter(id=>previous.includes(id)).length : null,
            retained:meshes.filter(id=>__levelBench.before.includes(id)).length,batches:meshes.length,render:{...__scene.renderer.info.render}};
        })()`))
      }
      const state=await page.evaluate(`({cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length,version:__metro.getState().version,opening:__levelOpening,errors:[...__levelOpening.errors,...__levelBench.errors],glError:__scene.renderer.getContext().getError(),chunkLevels:[...__scene.chunks.levelGroups.keys()],
        viewport:[__scene.renderer.domElement.width,__scene.renderer.domElement.height],dpr:devicePixelRatio,browser:navigator.userAgent,
        tickStart:__levelBench.tick,tickEnd:__metro.getState().metrics.tick,seed:__metro.getState().station.seed,population:__metro.getState().metrics.population,ownedBatches:__scene.modules.batches.owned.size,cachedViews:__scene.modules.batches.views.size,
        gpu:__scene.renderer.getContext().getParameter(__scene.renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
        multiDraw:!!__scene.renderer.getContext().getExtension('WEBGL_multi_draw')})`)
      reports.push({id,uncached,loadMs,...state,events})
      writeFileSync(output,JSON.stringify(reports,null,2))
      assert.ok(events.every(e=>e.event.z!==e.event.to),'Q/E must change storey')
      assert.deepEqual(state.errors,[])
      assert.equal(state.glError,0)
      assert.equal(state.tickStart,state.tickEnd,'paused Q/E never advances simulation')
      if(!uncached && !baseline) assert.equal(events[0].batchHit,true,'first Q/E uses an opening view prepared during loading')
      if (!uncached) for(const event of events) if(event.sameViewRetained!==null) assert.equal(event.sameViewRetained,event.batches,'Q/E must retain every batch of a revisited level')
      if(noMultiDraw) assert.equal(state.multiDraw,false)
      const mean = values => values.reduce((a,b)=>a+b,0)/values.length
      console.log(`${id}: first Q/E ${events[0].event.ms.toFixed(1)} ms; repeated ${mean(events.slice(2).map(e=>e.event.ms)).toFixed(1)} ms; batch CPU ${mean(events.map(e=>e.work.batches.ms)).toFixed(1)} ms; opening prewarm ${state.opening.warmMs.toFixed(1)} ms`)
    } finally {await page.close()}
  }
  writeFileSync(output,JSON.stringify(reports,null,2))
  console.log(`Report: ${output}`)
} finally {server.close()}
