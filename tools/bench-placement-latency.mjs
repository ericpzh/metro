// Production demo placement: real pointer input, browser-clock timings, first
// invocation and repeated commits. Run clean and profiled captures separately.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadExampleStation, serveDir, waitFor, withPage } from './browser-harness.mjs'

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/placement-100ms/clean.json')
const demos = process.env.BENCH_DEMO ? [process.env.BENCH_DEMO] : ['zoo', 'tanwei']
const count = Number(process.env.BENCH_EDITS ?? 5)
if (!Number.isInteger(count) || count < 1 || count > 20) throw Error('BENCH_EDITS must be 1..20')
const profiled = process.argv.includes('--profile')
const softwareGpu = process.argv.includes('--software-gpu')
const retainParent = process.argv.includes('--retain-parent')
// Pin the reproduced workload: both an interior edit and placements that widen
// the generated street window must remain in the default five-click run.
const expectedTargets = {
  zoo: [[-11,16,0],[4,29,0],[18,41,0],[33,53,0],[13,-20,0]],
  tanwei: [[-59,45,0],[-39,62,0],[-19,79,0],[2,96,0],[-76,-35,0]],
}
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve(process.env.BENCH_DIST ?? 'game/dist'), 0)
const reports = []
try {
  for (const demo of demos) {
    const page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
      profile: resolve(dirname(output), `placement-${demo}-${process.pid}`),
      debugPort: 19000 + process.pid % 10000, windowSize: '1440,1000', softwareGpu })
    try {
      await loadExampleStation(page, demo)
      await page.evaluate(`__metro.getState().setPlaying(false);new Promise(r=>setTimeout(r,1200))`)
      const setup = await page.evaluate(`(() => {
        const store=__metro, scene=__scene, s=store.getState();
        const gl=scene.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
        const rect=scene.renderer.domElement.getBoundingClientRect(), points=[], cells=new Set();
        // Same authored camera and visible-surface selection as the usage tour.
        // Fixture discovery happens outside all timed events.
        for(let row=1;row<10;row++)for(let col=1;col<10;col++){
          const p={x:rect.left+rect.width*col/10,y:rect.top+rect.height*row/10};
          if(document.elementFromPoint(p.x,p.y)!==scene.renderer.domElement)continue;
          const hit=scene.pick(p.x,p.y,s.activeZ), key=hit?.cell.join(',');
          if(hit?.solid&&!cells.has(key)&&!scene.pickModule(p.x,p.y)){
            cells.add(key);points.push({...p,cell:hit.cell});
          }
        }
        if(!points.length)throw Error('No placement targets');
        const expected=${JSON.stringify(expectedTargets[demo])};
        if(!expected||JSON.stringify(points.slice(0,Math.min(${count},5)).map(p=>p.cell))!==JSON.stringify(expected.slice(0,Math.min(${count},5))))
          throw Error('Demo/camera placement targets changed; review the pinned interior/ground-edge workload');
        window.__placement={work:{},events:[],errors:[],acks:[],longTasks:[],phase:'idle',commits:0,renderEnds:[],reparentSkipped:0};
        const b=__placement;
        if(${retainParent}){
          // Diagnostic ablation only: avoid Three.Object3D.add's remove/splice
          // when buildModules adds an unchanged child to its existing parent.
          const add=scene.modules.moduleMeshes.add;
          scene.modules.moduleMeshes.add=function(...objects){const fresh=objects.filter(o=>{
            if(o.parent!==this)return true;b.reparentSkipped++;return false;
          });return fresh.length?add.apply(this,fresh):this;};
        }
        addEventListener('error',e=>b.errors.push(e.message));
        addEventListener('unhandledrejection',e=>b.errors.push(String(e.reason)));
        const error=console.error;console.error=(...a)=>{b.errors.push(a.map(String).join(' '));error(...a)};
        const wrap=(object,name,label=name)=>{
          const original=object[name];if(typeof original!=='function')throw Error('Missing '+label);
          object[name]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{
            const row=b.work[label]??={calls:0,ms:0};row.calls++;row.ms+=performance.now()-t;
            if(label==='render')b.renderEnds.push(performance.now());
          }};
        };
        for(const [obj,name,label] of [
          [scene,'setStation','station'],[scene.chunks,'prepareStation','chunks.prepare'],[scene.chunks,'meshStation','chunks.mesh'],
          [scene.modules,'buildModules','modules.build'],[scene.modules,'syncBatches','modules.syncBatches'],
          [scene.modules.batches,'invalidateViews','batches.invalidate'],[scene.modules.batches,'sync','batches.sync'],
          [scene.level,'applyLevel','level'],[scene.grid,'buildGrid','grid'],[scene.sectionSys,'applyClip','section.clip'],
          [scene,'setModulePreview','preview'],[scene.renderer,'render','render'],
          [scene.cameraSys.raycaster,'intersectObjects','raycast'],
          [Storage.prototype,'setItem','storage.write']])wrap(obj,name,label);
        const commit=s.commit;store.setState({commit:(...args)=>{
          const t=performance.now();b.commitAt=t;b.commits++;
          try{return commit(...args)}finally{const w=b.work.commit??={calls:0,ms:0};w.calls++;w.ms+=performance.now()-t}
        }});
        let metrics=store.getState().metrics;
        store.subscribe(next=>{if(next.metrics!==metrics){metrics=next.metrics;if(b.commitAt!==null&&b.commitAt!==undefined){
          b.acks.push({commit:b.commits,ms:performance.now()-b.commitAt});b.commitAt=null;
        }}});
        new PerformanceObserver(list=>b.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask'});
        for(const type of ['pointermove','pointerdown','pointerup']){
          let current;
          addEventListener(type,e=>{if(e.target!==scene.renderer.domElement)return;
            current={type,start:performance.now(),phase:b.phase};const row=current;
            requestAnimationFrame(()=>requestAnimationFrame(()=>{row.twoRafMs=performance.now()-row.start;b.events.push(row)}));
          },true);
          addEventListener(type,()=>{if(current){current.handlerMs=performance.now()-current.start;current=null}});
        }
        store.getState().setTool('module');store.setState({moduleType:'bench',moduleRot:0});
        return {points,fixture:{name:s.station.name,cells:s.station.cells.length,modules:s.station.modules.length,
          seed:s.station.seed,population:s.metrics.population,activeZ:s.activeZ},environment:{browser:navigator.userAgent,
          gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),viewport:[rect.width,rect.height],quality:s.graphicsQuality}};
      })()`)
      if (profiled) { await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval',{interval:100}); await page.send('Profiler.start') }
      const samples = []
      for (let i=0; i<setup.points.length && samples.filter(s=>s.added.length).length<count; i++) {
        const point=setup.points[i]
        const phases=[]
        for(const [phase,type,extra] of [
          ['hover','mouseMoved',{}], ['down','mousePressed',{button:'left',buttons:1,clickCount:1}],
          ['up','mouseReleased',{button:'left',buttons:0,clickCount:1}],
        ]) {
          await page.evaluate(`(()=>{const b=__placement;b.phase=${JSON.stringify(`${samples.length}:${phase}`)};b.work={};b.events=[];b.renderEnds=[];b.version=__metro.getState().version;
            b.beforeStation=__metro.getState().station;b.ids=new Set(b.beforeStation.modules.map(m=>m.id));
            b.roots=new Map(__scene.modules.moduleMeshes.children.filter(g=>g.userData.moduleId).map(g=>[g.userData.moduleId,g]));
            b.start=performance.now();})()`)
          await page.send('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,...extra})
          await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
          phases.push(await page.evaluate(`(()=>{const b=__placement;const elapsedMs=performance.now()-b.start;
            const station=__metro.getState().station,roots=__scene.modules.moduleMeshes.children.filter(g=>g.userData.moduleId);
            const models={retained:0,replaced:0,added:0};for(const g of roots){const id=g.userData.moduleId;models[b.roots.get(id)===g?'retained':b.roots.has(id)?'replaced':'added']++;}
            return {phase:b.phase,elapsedMs,events:b.events.map(e=>({...e,firstRenderMs:b.renderEnds.find(t=>t>=e.start)-e.start})),work:b.work,commits:__metro.getState().version-b.version,models,
              cellsUnchanged:station.cells===b.beforeStation.cells,
              renderEnds:b.renderEnds.map(t=>t-b.start),added:__metro.getState().station.modules.filter(m=>!b.ids.has(m.id)).map(m=>m.id)};})()`))
        }
        const added=phases.flatMap(p=>p.added)
        if(added.length!==1||phases.some(p=>(p.work.raycast?.calls??0)>1||!p.cellsUnchanged||
          p.commits!==(p.phase.endsWith(':down')?1:0)))
          throw Error('Expected one press commit, unchanged authored cells, and at most one scene raycast per pointer event');
        const sample={point,added,phases}
        samples.push(sample)
        if(added.length){
          await waitFor(page.evaluate,'__placement.commitAt==null',{every:20,tries:500,what:'paused worker edit response'})
          const event=phases.flatMap(p=>p.events).find(e=>e.type==='pointerdown')
          if(!event||!Number.isFinite(event.firstRenderMs))throw Error('Missing accepted-placement render measurement')
          console.log(`${demo} #${samples.filter(s=>s.added.length).length}: click-to-render ${event.firstRenderMs.toFixed(1)} ms; two RAF ${event.twoRafMs.toFixed(1)} ms; handler ${event.handlerMs.toFixed(1)} ms`)
        }
      }
      if(profiled){const profile=(await page.send('Profiler.stop')).profile;writeFileSync(output.replace(/\.json$/,`-${demo}.cpuprofile`),JSON.stringify(profile))}
      const end=await page.evaluate(`({acks:__placement.acks,errors:__placement.errors,longTasks:__placement.longTasks,reparentSkipped:__placement.reparentSkipped,
        modules:__metro.getState().station.modules.length,glError:__scene.renderer.getContext().getError()})`)
      reports.push({demo,profiled,retainParent,targetMs:100,...setup,samples,...end})
      writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),reports},null,2))
      if(end.errors.length||end.glError||samples.filter(s=>s.added.length).length!==count)throw Error(`${demo}: incomplete/invalid capture`)
    } finally { await page.close() }
  }
} finally { server.close() }
console.log(`Report: ${output}`)
