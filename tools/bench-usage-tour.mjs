// A repeatable production-browser tour of ordinary editing and viewing paths.
// The fixture is always one of the shipped demos; edits are restored before the
// report is written. Timings are diagnostic and never CI thresholds.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { MODULE_OPTIONS } from '../game/src/app/store/catalog.ts'
import { createModule } from '../game/src/build/model.ts'
import { loadExampleStation, serveDir, waitFor, withPage } from './browser-harness.mjs'

const demos = process.env.BENCH_DEMO ? [process.env.BENCH_DEMO] : ['zoo', 'tanwei']
const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/usage-tour.json')
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
const reports = []
const twoFrames = `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`

try {
  for (const demo of demos) {
    const page = await withPage({
      url: `http://127.0.0.1:${server.address().port}/`,
      profile: resolve(dirname(output), `usage-tour-${demo}-${process.pid}`),
      debugPort: 9400 + (process.pid % 1000),
      windowSize: process.env.BENCH_SIZE ?? '1440,1000',
      softwareGpu: process.env.METRO_BROWSER_GPU !== 'hardware',
    })
    try {
      await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics', { what: 'production game' })
      const loadStarted = performance.now()
      await loadExampleStation(page, demo)
      const loadMs = performance.now() - loadStarted
      await page.evaluate(`__metro.getState().setPlaying(false);new Promise(r=>setTimeout(r,1200))`)
      await page.evaluate(`(() => {
        window.__tour={rows:[],errors:[],fixture:{name:__metro.getState().station.name,seed:__metro.getState().station.seed,
          cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length}};
        const error=console.error;console.error=(...a)=>{__tour.errors.push(a.map(String).join(' ').slice(0,2048));error(...a)};
        addEventListener('error',e=>__tour.errors.push(e.message));
        addEventListener('unhandledrejection',e=>__tour.errors.push(String(e.reason)));
      })()`)

      // Sweep every shipped palette option through the production preview path.
      // Keep cold and warmed model-preview timings separate for each option.
      const options = []
      for (const option of MODULE_OPTIONS) {
        const mod = createModule(option.id, 0, 0, 0, 'usage-tour-preview', 0)
        const row = await page.evaluate(`(() => {
          const id=${JSON.stringify(option.id)},mod=${JSON.stringify(mod)},started=performance.now();
          __scene.setModulePreview(mod);
          const cold=performance.now()-started;
          const warmStart=performance.now();__scene.setModulePreview(mod);
          const warm=performance.now()-warmStart;__scene.setModulePreview(null);
          return {id,coldMs:cold,warmMs:warm};
        })()`)
        options.push(row)
      }

      // Exercise visible tool hover, move lift/cancel, and view navigation on
      // real demo geometry. The view events are real keyboard/wheel/mouse input.
      const points = await page.evaluate(`(() => {
        const rect=__scene.renderer.domElement.getBoundingClientRect(),out=[];
        for(let row=1;row<10&&out.length<40;row++)for(let col=1;col<10&&out.length<40;col++){
          const p={x:rect.left+rect.width*col/10,y:rect.top+rect.height*row/10};
          const hit=__scene.pick(p.x,p.y,__metro.getState().activeZ);
          if(hit?.solid&&!out.some(q=>q.cell.x===hit.cell.x&&q.cell.y===hit.cell.y&&q.cell.z===hit.cell.z))out.push({...p,cell:hit.cell});
        }
        return out;
      })()`)
      if (!points.length) throw new Error(`${demo}: no visible solid hover targets`)
      const tools = ['select','pick','move','delete','block','wall','module','paint','zone','rail','tunnel']
      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i], point = points[i % points.length]
        await page.evaluate(`__metro.getState().setTool(${JSON.stringify(tool)});__metro.setState({moduleType:'bench',zoneBrush:'paid'})`)
        const start = performance.now()
        await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y})
        await page.evaluate(twoFrames)
        const elapsedMs = performance.now() - start
        await page.evaluate(`__tour.rows.push({action:'tool-hover',tool:${JSON.stringify(tool)},ms:${elapsedMs}})`)
      }

      // A complete single-piece round trip through real pointer input. Catalogue
      // variants above get preview coverage; committed placement is represented
      // by a floor-supported bench so the same repeatable operation works in
      // both authored demos without editing their original geometry.
      const placementPoints = await page.evaluate(`(() => {
        const rect=__scene.renderer.domElement.getBoundingClientRect(),out=[];
        for(let row=1;row<10&&out.length<50;row++)for(let col=1;col<10&&out.length<50;col++){
          const p={x:rect.left+rect.width*col/10,y:rect.top+rect.height*row/10},hit=__scene.pick(p.x,p.y,__metro.getState().activeZ);
          if(hit?.solid&&!__scene.pickModule(p.x,p.y)&&!out.some(q=>q.cell.x===hit.cell[0]&&q.cell.y===hit.cell[1]&&q.cell.z===hit.cell[2]))out.push({...p,cell:{x:hit.cell[0],y:hit.cell[1],z:hit.cell[2]}});
        }
        return out;
      })()`)
      const usage = { placementAttempts: 0, placement: null, move: null, pick: null, deletion: null, undo: null }
      const inputClick = async (point, button='left') => {
        await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y})
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button,buttons:button==='right'?2:1,clickCount:1})
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button,buttons:0,clickCount:1})
        await page.evaluate(twoFrames)
      }
      const initialModuleIds = await page.evaluate(`__metro.getState().station.modules.map(m=>m.id)`)
      await page.evaluate(`__metro.getState().setTool('module');__metro.setState({moduleType:'bench'})`)
      for (const point of placementPoints) {
        const start=performance.now();usage.placementAttempts++
        await inputClick(point)
        const placed=await page.evaluate(`__metro.getState().station.modules.find(m=>!${JSON.stringify(initialModuleIds)}.includes(m.id)&&m.type==='bench')?.id ?? null`)
        if (placed) {
          usage.placement={ms:performance.now()-start,cell:point.cell,id:placed}
          break
        }
      }
      if (usage.placement) {
        let point=placementPoints.find(p=>p.cell.x===usage.placement.cell.x&&p.cell.y===usage.placement.cell.y&&p.cell.z===usage.placement.cell.z)
        const beforeMove=await page.evaluate(`__metro.getState().station.modules.find(m=>m.id===${JSON.stringify(usage.placement.id)})`)
        await page.evaluate(`__metro.getState().setTool('move')`)
        const started=performance.now();await page.evaluate(`__metro.getState().liftModule(${JSON.stringify(usage.placement.id)});${twoFrames}`)
        const lifted=await page.evaluate(`!!__metro.getState().moveDraft`)
        let attempts=0,lastReason=''
        if(lifted) for(const target of placementPoints) {
          if(target.x===point.x&&target.y===point.y)continue
          attempts++
          await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y})
          await page.evaluate(twoFrames)
          const aim=await page.evaluate(`(()=>{const d=__metro.getState().moveDraft;return d?{reason:d.reason,at:d.at,candidate:!!d.candidate}:null})()`)
          lastReason=aim?.reason??''
          if(!aim?.candidate||lastReason)continue
          const moveStart=performance.now();await inputClick(target)
          const after=await page.evaluate(`({draft:!!__metro.getState().moveDraft,module:__metro.getState().station.modules.find(m=>m.id===${JSON.stringify(usage.placement.id)})})`)
          if(!after.draft&&after.module&&(after.module.x!==beforeMove.x||after.module.y!==beforeMove.y||after.module.z!==beforeMove.z)) {
            usage.move={placed:true,liftMs:moveStart-started,dropMs:performance.now()-moveStart,attempts,from:{x:beforeMove.x,y:beforeMove.y,z:beforeMove.z},to:{x:after.module.x,y:after.module.y,z:after.module.z}}
            point=target
            break
          }
          if(!after.draft)break
        }
        if(await page.evaluate(`!!__metro.getState().moveDraft`)) {
          await page.evaluate(`__metro.getState().cancelMove(false);${twoFrames}`)
          usage.move={lifted:true,placed:false,attempts,lastReason}
        }
        await page.evaluate(`__metro.getState().setTool('pick')`)
        let start=performance.now();await inputClick(point)
        usage.pick={ms:performance.now()-start,armed:await page.evaluate(`!!__metro.getState().pickDraft`)}
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
        await page.evaluate(twoFrames)
        await page.evaluate(`__metro.getState().setTool('delete')`)
        start=performance.now();await inputClick(point)
        usage.deletion={ms:performance.now()-start,removed:await page.evaluate(`!__metro.getState().station.modules.some(m=>m.id===${JSON.stringify(usage.placement.id)})`)}
        if (usage.deletion.removed) {
          start=performance.now();await page.evaluate(`__metro.getState().undo();${twoFrames}`)
          usage.undo={ms:performance.now()-start,restored:await page.evaluate(`__metro.getState().station.modules.some(m=>m.id===${JSON.stringify(usage.placement.id)})`)}
          const cleanupUndos=usage.move?.placed?2:1
          for(let i=0;i<cleanupUndos;i++)await page.evaluate(`__metro.getState().undo();${twoFrames}`)
          usage.stationRestored=await page.evaluate(`__metro.getState().station.modules.length===${await page.evaluate('__tour.fixture.modules')}&&!__metro.getState().station.modules.some(m=>m.id===${JSON.stringify(usage.placement.id)})`)
        }
      }

      const movable = await page.evaluate(`__metro.getState().station.modules.find(m=>m.type==='bench')?.id ?? null`)
      let move = null
      if (movable) {
        const start = performance.now()
        await page.evaluate(`__metro.getState().liftModule(${JSON.stringify(movable)});${twoFrames}`)
        const liftedMs = performance.now() - start
        const cancelStart = performance.now()
        await page.evaluate(`__metro.getState().cancelMove(false);${twoFrames}`)
        move = { liftMs: liftedMs, cancelMs: performance.now() - cancelStart, fixture: 'bench' }
      }

      // Camera tour: rotate/orbit, pan in four directions, zoom in/out, and
      // visit every available storey view while paused.
      const camera = []
      const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
        const start = performance.now()
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,modifiers})
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode,modifiers})
        await page.evaluate(twoFrames)
        camera.push({action:'key',key,ms:performance.now()-start})
      }
      for (const k of ['w','a','s','d']) await key(k,`Key${k.toUpperCase()}`,k.toUpperCase().charCodeAt(0))
      for (const k of ['q','e','q','e']) await key(k,`Key${k.toUpperCase()}`,k.toUpperCase().charCodeAt(0))
      for (const [direction,deltaY] of [['zoom-in',-240],['zoom-out',240]]) {
        const start=performance.now()
        await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:points[0].x,y:points[0].y,deltaX:0,deltaY})
        await page.evaluate(twoFrames)
        camera.push({action:direction,ms:performance.now()-start})
      }
      const canvas = await page.evaluate(`(()=>{const r=__scene.renderer.domElement.getBoundingClientRect();return{x:r.left+r.width*.5,y:r.top+r.height*.5}})()`)
      const orbitStart=performance.now()
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:canvas.x,y:canvas.y,button:'left',buttons:1,clickCount:1})
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:canvas.x+90,y:canvas.y+45,button:'left',buttons:1})
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:canvas.x+90,y:canvas.y+45,button:'left',buttons:0,clickCount:1})
      await page.evaluate(twoFrames)
      camera.push({action:'orbit-drag',ms:performance.now()-orbitStart})

      // Exercise line, exit and clock edits through the same store actions the
      // mounted editor controls call; restore each value before moving on.
      const settings = await page.evaluate(`(async()=>{
        const s=__metro.getState(),rows=[];
        const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        if(s.station.lines[0]){
          let line=s.station.lines[0],orig=line.colour,t=performance.now();
          s.updateLine(line.id,{colour:'#B34B91'});await frame();rows.push({action:'line-colour',ms:performance.now()-t});
          s.updateLine(line.id,{colour:orig});await frame();
        }
        const exit=s.station.modules.find(m=>m.type==='exit');
        if(exit){
          const original=s.station;
          for(const open of [!exit.cfg.open,exit.cfg.open]){
            const now=performance.now(),state=s;
            const modules=state.station.modules.map(m=>m.id===exit.id?{...m,cfg:{...m.cfg,open}}:m);
            state.commit({...state.station,modules});await frame();
            rows.push({action:open===exit.cfg.open?'exit-open-restore':'exit-open',ms:performance.now()-now});
          }
        }
        const old=s.metrics, time=performance.now();s.setTimePanel(true);s.seekToDate({year:2026,month:1,day:5});await frame();
        rows.push({action:'time-panel-and-date',ms:performance.now()-time});s.setTimePanel(false);
        const simStart=performance.now();s.setSpeed(2);s.setPlaying(true);await new Promise(r=>setTimeout(r,180));s.setPlaying(false);await frame();
        rows.push({action:'time-play-pause',ms:performance.now()-simStart,tickDelta:s.metrics.tick-old.tick});
        return rows;
      })()`)

      const errors = await page.evaluate(`__tour.errors`)
      const report = { demo, loadMs, fixture: await page.evaluate('__tour.fixture'),
        catalogue: { options: options.length, samples: options, slowest: [...options].sort((a,b)=>b.coldMs-a.coldMs).slice(0,10) },
        toolHover: await page.evaluate(`__tour.rows.filter(r=>r.action==='tool-hover')`), usage, move,
        camera, settings, errors }
      reports.push(report)
      writeFileSync(output, JSON.stringify({ generatedAt:new Date().toISOString(), browser:await page.evaluate('navigator.userAgent'), reports },null,2))
      if (errors.length) throw new Error(`${demo}: browser errors: ${errors.join(' | ')}`)
      console.log(`${demo}: ${options.length} palette previews; place/pick/delete round trip ${usage.placement?'completed':'not placed'}; ${tools.length} tool hovers; ${camera.length} camera actions; ${settings.length} settings/time actions`)
    } finally { await page.close() }
  }
  writeFileSync(output, JSON.stringify({ generatedAt:new Date().toISOString(), reports },null,2))
  console.log(`Report: ${output}`)
} finally { server.close() }
