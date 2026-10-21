import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const demo = process.env.BENCH_DEMO ?? ''
const piece = process.env.BENCH_PIECE ?? 'roof'
const side = Number(process.env.BENCH_SIDE ?? 30)
const previewDelay = process.env.BENCH_PREVIEW_DELAY ? Number(process.env.BENCH_PREVIEW_DELAY) : null
const floor = process.env.BENCH_FLOOR !== '0'
const autoWalls = process.env.BENCH_AUTO_WALLS === '1'
const suspendedCeiling = process.env.BENCH_SUSPENDED_CEILING === '1'
const continuous = process.env.BENCH_CONTINUOUS === '1'
const output = resolve(process.env.BENCH_OUTPUT ?? `.preview/perf/${piece}-latency.json`)
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(`.preview/perf/drag-latency-chrome-${process.pid}`), debugPort: 10000 + process.pid % 40000, windowSize: '1440,1000' })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics', { what: 'game' })
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  if (demo) await loadExampleStation(page, demo)
  const fixture = await page.evaluate(`(async () => {
    const store=__metro, s=store.getState(), scene=__scene
    const cells=${floor} ? Array.from({length:${side * side}},(_,i)=>({x:i%${side},y:Math.floor(i/${side}),z:0,fill:'solid'})) : []
    if (!${Boolean(demo)}) s.commit({...s.station,name:'${piece} drag ${side}x${side}',seed:12345,cells,modules:[],lines:[]})
    const obstacle = ${Boolean(demo)} ? s.station.modules.find(m=>m.type==='booth') : null
    const origin=obstacle?[obstacle.x-5,obstacle.y-5]:[0,0],level=obstacle?obstacle.z+1:1
    s.setActiveZ(level); s.setGhostOther(false); store.setState({tool:'${piece === 'block' || piece === 'wall' ? piece : 'module'}',moduleType:'${piece}',moduleRot:0,roofPlateSnap:'upper',autoWalls:${autoWalls},suspendedCeiling:${suspendedCeiling},halfWall:false,triangles:false,playing:false})
    scene.setPreset('plan'); scene.setOrtho(true)
    const cam=scene.cameraSys
    cam.controls.enableDamping=false
    const activeCamera=cam.activeCamera()
    cam.controls.target.set(origin[0]+${side / 2},origin[1]+${side / 2},level); activeCamera.position.set(origin[0]+${side / 2},origin[1]+${side / 2},level+600); cam.controls.update()
    activeCamera.zoom=${36 / side}; activeCamera.updateProjectionMatrix()
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    await new Promise(r=>setTimeout(r,500))
    const camera=cam.activeCamera();camera.updateMatrixWorld(true)
    const rect=scene.renderer.domElement.getBoundingClientRect(), Vector=camera.position.constructor
    const point=(x,y)=>{const p=new Vector(origin[0]+x+.5,origin[1]+y+.5,level+1).project(camera);return{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}}
    const points=[point(0,0),point(${side - 1},${['wall','fence','tactile-guide','tactile-warning','road'].includes(piece) ? 0 : side - 1})]
    const picks=points.map(p=>scene.pick(p.x,p.y,level))
    if(picks.some(hit=>!hit)) throw Error('pointer target mismatch '+JSON.stringify({points,picks}))
    window.__blockBench={phase:'idle',samples:[],errors:[],commits:0,ghostCounts:[],commitMs:[],stationMs:[],stages:[],timers:[],presentations:[],witnessChecks:[]}
    const timeout=window.setTimeout
    window.setTimeout=function(callback,ms,...args){
      if(ms!==100&&ms!==50)return timeout(callback,ms,...args)
      const queued=performance.now(),phase=__blockBench.phase,eventAt=__blockBench.eventStart
      return timeout(()=>{const start=performance.now();try{callback(...args)}finally{__blockBench.timers.push({phase,waitMs:start-queued,eventToStartMs:start-eventAt,workMs:performance.now()-start})}},${previewDelay ?? 'ms'})
    }
    addEventListener('error',e=>__blockBench.errors.push(e.message))
    addEventListener('unhandledrejection',e=>__blockBench.errors.push(String(e.reason)))
    const commit=store.getState().commit
    store.setState({commit:(...args)=>{__blockBench.commits++;const start=performance.now();try{return commit(...args)}finally{__blockBench.commitMs.push(performance.now()-start)}}})
    const setStation=scene.setStation
    scene.setStation=function(...args){const start=performance.now();try{return setStation.apply(this,args)}finally{__blockBench.stationMs.push(performance.now()-start)}}
    for(const [owner,names] of [[scene.modules,['buildModules','retainPaintedModules','equipmentOnlyChanged']],[scene.chunks,['prepareStation','meshStation']],[scene.level,['applyLevel']],[scene.grid,['buildGrid']]]) for(const name of names){
      const original=owner[name];owner[name]=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{__blockBench.stages.push({name,ms:performance.now()-start})}}
    }
    const cursor=scene.setCursor
    scene.setCursor=function(cell,valid){__blockBench.cursor={cell,valid};return cursor.call(this,cell,valid)}
    for(const name of ['setGhost','setModulePreview','setFencePreview','setCollisionHighlight']) {
      const original=scene[name]
      scene[name]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{const count=(Array.isArray(args[0])?args[0].length:args[0]?1:0)+(name==='setGhost'?(args[4]?.length??0):0);if(count){
        const phase=__blockBench.phase,eventAt=__blockBench.eventStart
        __blockBench.ghostCounts.push({phase,name,cells:count,accepted:name==='setGhost'?args[0].length:null,refused:name==='setGhost'?(args[4]?.length??0):null,ms:performance.now()-t,eventToReadyMs:performance.now()-eventAt})
        requestAnimationFrame(()=>requestAnimationFrame(()=>__blockBench.presentations.push({phase,name,cells:count,eventToFrameMs:performance.now()-eventAt})))
      }}}
    }
    for(const name of ['pointerdown','pointermove','pointerup']){
      document.addEventListener(name,()=>{__blockBench.eventStart=performance.now()},true)
      document.addEventListener(name,()=>{__blockBench.handlerMs=performance.now()-__blockBench.eventStart})
    }
    const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    const fixture=store.getState().station
    return{name:fixture.name,cells:fixture.cells.length,modules:fixture.modules.length,seed:fixture.seed,activeZ:level,picks,demo:${JSON.stringify(demo)},obstacle:obstacle?.id,
      browser:navigator.userAgent,gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),viewport:[innerWidth,innerHeight],points,piece:'${piece}',autoWalls:${autoWalls},suspendedCeiling:${suspendedCeiling},stableTimerOverrideMs:${previewDelay}}
  })()`)
  async function event(phase, method, params) {
    await page.evaluate(`__blockBench.phase=${JSON.stringify(phase)};__blockBench.start=performance.now();__blockBench.handlerMs=null`)
    await page.send(method, params)
    if(phase.includes(':move')) await page.evaluate('new Promise(r=>setTimeout(r,160))')
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const sample=await page.evaluate(`(()=>{const s={phase:__blockBench.phase,twoRafMs:performance.now()-__blockBench.start,handlerMs:__blockBench.handlerMs,drawCalls:__scene.renderer.info.render.calls,previewMeshes:__scene.ghostSys.previewGroup.children.length};__blockBench.samples.push(s);return s})()`)
    return sample
  }
  const [a,b]=fixture.points
  for(const iteration of ['cold','warm']){
    await event(iteration+':hover','Input.dispatchMouseEvent',{type:'mouseMoved',...a})
    await event(iteration+':down','Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1})
    await page.evaluate('new Promise(r=>setTimeout(r,220))')
    if (continuous) {
      await page.evaluate(`__blockBench.phase='${iteration}:continuous';__blockBench.burstStart=performance.now()`)
      for (let step = 1; step <= 12; step++) {
        await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*step/12,y:a.y+(b.y-a.y)*step/12,button:'left',buttons:1})
        await page.evaluate('new Promise(r=>setTimeout(r,16))')
      }
      await page.evaluate(`__blockBench.stages.push({name:'${iteration}:previews-during-movement',count:__blockBench.ghostCounts.filter(s=>s.phase==='${iteration}:continuous'&&s.name!=='setCollisionHighlight'&&(s.cells>1||'${piece}'==='road')).length});new Promise(r=>setTimeout(r,160))`)
    } else {
      if (process.env.BENCH_PROFILE === '1' && iteration === 'cold') {
        await page.send('Profiler.enable');await page.send('Profiler.start')
      }
      await event(iteration+':move:'+piece,'Input.dispatchMouseEvent',{type:'mouseMoved',...b,button:'left',buttons:1})
      if (process.env.BENCH_PROFILE === '1' && iteration === 'cold') {
        const profile=await page.send('Profiler.stop')
        writeFileSync(output.replace(/\.json$/, '.cpuprofile'),JSON.stringify(profile.profile))
      }
    }
    if (process.env.BENCH_ASSERT_WITNESS === '1') {
      const before = await page.evaluate('__blockBench.ghostCounts.length')
      await page.evaluate(`__blockBench.phase='${iteration}:witness'`)
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:b.x+.001,y:b.y+.001,button:'left',buttons:1})
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      const witness=await page.evaluate(`({cursor:__blockBench.cursor,draws:__blockBench.ghostCounts.length})`)
      if(witness.cursor?.valid!==false||witness.draws!==before)throw Error('unchanged blocked footprint lost its red witness '+JSON.stringify(witness))
      await page.evaluate(`__blockBench.witnessChecks.push(${JSON.stringify({iteration,...witness})})`)
    }
    if (iteration === 'cold') {
      const shot = await page.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(output.replace(/\.json$/, '-preview.png'), Buffer.from(shot.data, 'base64'))
    }
    if(iteration==='cold'||demo){
      await event(iteration+':cancel','Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
      await event(iteration+':release-after-cancel','Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1})
    } else await event('warm:release','Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1})
  }
  const status=await page.evaluate(`({samples:__blockBench.samples,errors:__blockBench.errors,commits:__blockBench.commits,ghostCounts:__blockBench.ghostCounts,commitMs:__blockBench.commitMs,stationMs:__blockBench.stationMs,stages:__blockBench.stages,
    timers:__blockBench.timers,presentations:__blockBench.presentations,witnessChecks:__blockBench.witnessChecks,modules:__metro.getState().station.modules.length,cells:__metro.getState().station.cells.length,notice:__metro.getState().notice})`)
  const report={fixture,status}
  writeFileSync(output,JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  if(status.errors.length)throw Error('browser interaction failed')
} finally { await page?.close(); server.close() }


