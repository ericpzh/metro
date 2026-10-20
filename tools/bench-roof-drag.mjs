import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const side = Number(process.env.BENCH_SIDE ?? 30)
const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/roof-drag.json')
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(`.preview/perf/roof-chrome-${process.pid}`), windowSize: '1440,1000' })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics', { what: 'game' })
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  const fixture = await page.evaluate(`(async () => {
    const store=__metro, s=store.getState(), scene=__scene
    s.commit({...s.station,name:'Roof drag ${side}x${side}',seed:12345,cells:[],modules:[],lines:[]})
    s.setActiveZ(1); store.setState({tool:'module',moduleType:'roof',moduleRot:0,roofPlateSnap:'upper',autoWalls:false,halfWall:false,triangles:false,playing:false})
    scene.setPreset('plan'); scene.setOrtho(true)
    const cam=scene.cameraSys
    cam.controls.enableDamping=false
    const activeCamera=cam.activeCamera()
    cam.controls.target.set(${side / 2},${side / 2},1); activeCamera.position.set(${side / 2},${side / 2},600); cam.controls.update()
    activeCamera.zoom=${36 / side}; activeCamera.updateProjectionMatrix()
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    const camera=cam.activeCamera();camera.updateMatrixWorld(true)
    const rect=scene.renderer.domElement.getBoundingClientRect(), Vector=camera.position.constructor
    const point=(x,y)=>{const p=new Vector(x+.5,y+.5,2).project(camera);return{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}}
    const points=[point(0,0),point(${side - 1},${side - 1})]
    const picks=points.map(p=>scene.pick(p.x,p.y,1))
    if(picks.some(hit=>!hit)) throw Error('pointer target mismatch '+JSON.stringify({points,picks}))
    window.__blockBench={phase:'idle',samples:[],errors:[],commits:0,ghostCounts:[],commitMs:[],stationMs:[],stages:[]}
    addEventListener('error',e=>__blockBench.errors.push(e.message))
    addEventListener('unhandledrejection',e=>__blockBench.errors.push(String(e.reason)))
    const commit=store.getState().commit
    store.setState({commit:(...args)=>{__blockBench.commits++;const start=performance.now();try{return commit(...args)}finally{__blockBench.commitMs.push(performance.now()-start)}}})
    const setStation=scene.setStation
    scene.setStation=function(...args){const start=performance.now();try{return setStation.apply(this,args)}finally{__blockBench.stationMs.push(performance.now()-start)}}
    for(const [owner,names] of [[scene.modules,['buildModules','retainPaintedModules','equipmentOnlyChanged']],[scene.chunks,['prepareStation','meshStation']],[scene.level,['applyLevel']],[scene.grid,['buildGrid']]]) for(const name of names){
      const original=owner[name];owner[name]=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{__blockBench.stages.push({name,ms:performance.now()-start})}}
    }
    const original=scene.setModulePreview
    scene.setModulePreview=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{if(args[0]?.length)__blockBench.ghostCounts.push({phase:__blockBench.phase,cells:args[0].length,ms:performance.now()-t})}}
    for(const name of ['pointerdown','pointermove','pointerup']){
      document.addEventListener(name,()=>{__blockBench.eventStart=performance.now()},true)
      document.addEventListener(name,()=>{__blockBench.handlerMs=performance.now()-__blockBench.eventStart})
    }
    const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    const fixture=store.getState().station
    return{name:fixture.name,cells:fixture.cells.length,modules:fixture.modules.length,seed:fixture.seed,activeZ:1,
      browser:navigator.userAgent,gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),viewport:[innerWidth,innerHeight],points}
  })()`)
  async function event(phase, method, params) {
    await page.evaluate(`__blockBench.phase=${JSON.stringify(phase)};__blockBench.start=performance.now();__blockBench.handlerMs=null`)
    await page.send(method, params)
    if(phase.includes(':move')) await page.evaluate('new Promise(r=>setTimeout(r,110))')
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const sample=await page.evaluate(`(()=>{const s={phase:__blockBench.phase,twoRafMs:performance.now()-__blockBench.start,handlerMs:__blockBench.handlerMs,drawCalls:__scene.renderer.info.render.calls,previewMeshes:__scene.ghostSys.previewGroup.children.length};__blockBench.samples.push(s);return s})()`)
    return sample
  }
  const [a,b]=fixture.points
  for(const iteration of ['cold','warm']){
    await event(iteration+':hover','Input.dispatchMouseEvent',{type:'mouseMoved',...a})
    await event(iteration+':down','Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1})
    await page.evaluate('new Promise(r=>setTimeout(r,220))')
    await event(iteration+':move:roof','Input.dispatchMouseEvent',{type:'mouseMoved',...b,button:'left',buttons:1})
    if (iteration === 'cold') {
      const shot = await page.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(output.replace(/\.json$/, '-preview.png'), Buffer.from(shot.data, 'base64'))
    }
    if(iteration==='cold'){
      await event('cold:cancel','Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
      await event('cold:release-after-cancel','Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1})
    } else await event('warm:release','Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1})
  }
  const status=await page.evaluate(`({samples:__blockBench.samples,errors:__blockBench.errors,commits:__blockBench.commits,ghostCounts:__blockBench.ghostCounts,commitMs:__blockBench.commitMs,stationMs:__blockBench.stationMs,stages:__blockBench.stages,
    modules:__metro.getState().station.modules.length,cells:__metro.getState().station.cells.length,notice:__metro.getState().notice})`)
  const report={fixture,status}
  writeFileSync(output,JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  if(status.errors.length)throw Error('browser interaction failed')
} finally { await page?.close(); server.close() }


