// Production pointer events, including the first fence preview and its cleanup.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/fence-drag.json')
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(`.preview/perf/fence-chrome-${process.pid}`), windowSize: '1440,1000',
    softwareGpu: process.env.METRO_BROWSER_GPU !== 'hardware' })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics', { what: 'game' })
  console.log('Game ready')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  if (process.env.BENCH_STATION) {
    await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(readFileSync(process.env.BENCH_STATION, 'utf8'))})`)
  }
  const fixture = await page.evaluate(`(async () => {
    const store = __metro, s = store.getState(), scene = __scene
    if (!${Boolean(process.env.BENCH_STATION)}) {
      const modules = Array.from({length: 256}, (_, i) => ({id:'fence-'+i,type:'fence',
        x:3*(i%16),y:3*Math.floor(i/16),z:i%2 ? -5 : 0,rot:0,cfg:{variant:'glass'}}))
      const cells = modules.filter(m=>m.z<0).map(m=>({x:m.x,y:m.y,z:m.z,fill:'solid'}))
      s.commit({...s.station,name:'Fence preview 256',seed:12345,cells,modules,lines:[]})
    }
    const station = store.getState().station
    const fence = station.modules.find(m=>m.type==='fence' && m.z===0 &&
      !station.modules.some(n=>n.z===0 && n.x>=m.x+1 && n.x<=m.x+5 && n.y===m.y))
    if (!fence) throw Error('fixture needs a ground fence with five free cells to its east')
    window.__fenceCells = [1,2,3,4].map(dx=>[fence.x+dx,fence.y,0])
    s.setActiveZ(0); s.setGhostOther(false)
    store.setState({tool:'module',moduleType:'fence',moduleRot:0,playing:false})
    scene.setPreset('plan');scene.setOrtho(true)
    const cam=scene.cameraSys, mid=__fenceCells[1]
    cam.controls.enableDamping=false;cam.controls.target.set(mid[0]+.5,mid[1]+.5,1)
    cam.camera.position.set(mid[0]+.5,mid[1]+.5,240);cam.controls.update()
    if (${process.env.BENCH_CLOSE === '1'}) {
      cam.camera.position.set(mid[0]+20,mid[1]-25,22);cam.controls.update();cam.zoomBy(.3)
    }
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    const camera=cam.activeCamera();camera.updateMatrixWorld(true)
    const rect=scene.renderer.domElement.getBoundingClientRect(), Vector=camera.position.constructor
    window.__fencePoints=__fenceCells.map(([x,y,z])=>{
      const p=new Vector(x+.5,y+.5,z+1).project(camera)
      return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}
    })
    for(let i=0;i<__fencePoints.length;i++) {
      const p=__fencePoints[i],hit=scene.pick(p.x,p.y,0)
      if (!hit?.solid || hit.cell.join()!==__fenceCells[i].join()) throw Error('pointer target mismatch: '+JSON.stringify(hit))
    }
    window.__fd={phase:'idle',samples:[],errors:[],commits:0,work:{},previewSizes:[],hiddenLeaks:[]}
    addEventListener('error',e=>__fd.errors.push(e.message))
    addEventListener('unhandledrejection',e=>__fd.errors.push(String(e.reason)))
    const commit=store.getState().commit
    store.setState({commit:(...args)=>{__fd.commits++;return commit(...args)}})
    const ghost=scene.ghostSys
    for(const [object,key] of [[scene,'setFencePreview'],[scene.modules,'syncBatches'],[scene.modules,'buildModules'],[scene,'setStation']]) {
      const original=object[key]
      object[key]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{
        const v=__fd.work[key]??={calls:0,ms:0};v.calls++;v.ms+=performance.now()-t
        if(key==='setFencePreview' && args[0]?.length) __fd.previewSizes.push({phase:__fd.phase,groups:ghost.fencePreviewGroup.children.length})
      }}
    }
    for(const name of ['pointerdown','pointermove','pointerup','keydown']) {
      document.addEventListener(name,()=>{__fd.eventStart=performance.now()},true)
      document.addEventListener(name,()=>{__fd.handlerMs=performance.now()-__fd.eventStart})
    }
    const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    return {name:station.name,seed:station.seed,cells:station.cells.length,modules:station.modules.length,
      fences:station.modules.filter(m=>m.type==='fence').length,browser:navigator.userAgent,
      gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),viewport:[innerWidth,innerHeight],
      hardwareConcurrency:navigator.hardwareConcurrency,activeZ:0,ghostOtherLevels:false,
      closeView:${process.env.BENCH_CLOSE === '1'},points:__fencePoints}
  })()`)
  console.log('Fixture ready')
  const points = fixture.points
  async function event(phase, method, params) {
    console.log(phase)
    await page.evaluate(`__fd.phase=${JSON.stringify(phase)};__fd.start=performance.now();__fd.handlerMs=null;__fd.work={}`)
    await page.send(method, params)
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const sample = await page.evaluate(`(() => {
      const sample={phase:__fd.phase,twoRafMs:performance.now()-__fd.start,handlerMs:__fd.handlerMs,work:__fd.work,
        previewGroups:__scene.ghostSys.fencePreviewGroup.children.length,
        hiddenLevelLeaks:__scene.modules.fenceGroups.filter(g=>g.userData.levelZs?.every(z=>z<0)&&g.visible).length}
      __fd.samples.push(sample);return sample
    })()`)
    if (process.env.BENCH_CAPTURE === '1' && phase === 'cold:move3') {
      const shot = await page.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(output.replace(/\.json$/, '.png'), Buffer.from(shot.data, 'base64'))
    }
    return sample
  }
  if (process.env.BENCH_PROFILE === '1') { await page.send('Profiler.enable'); await page.send('Profiler.start') }
  for (const iteration of ['cold', 'warm']) {
    await event(iteration+':hover','Input.dispatchMouseEvent',{type:'mouseMoved',...points[0]})
    await event(iteration+':down','Input.dispatchMouseEvent',{type:'mousePressed',...points[0],button:'left',buttons:1,clickCount:1})
    // A real long press is part of the production straight-run gesture.
    await page.evaluate('new Promise(r=>setTimeout(r,220))')
    for (let i=1;i<points.length;i++) await event(iteration+':move'+i,'Input.dispatchMouseEvent',{type:'mouseMoved',...points[i],button:'left',buttons:1})
    if (iteration==='cold') {
      await event('cold:cancel','Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
      await event('cold:release-after-cancel','Input.dispatchMouseEvent',{type:'mouseReleased',...points.at(-1),button:'left',buttons:0,clickCount:1})
      await page.evaluate(`__metro.setState({tool:'module',moduleType:'fence'})`)
    } else await event('warm:release','Input.dispatchMouseEvent',{type:'mouseReleased',...points.at(-1),button:'left',buttons:0,clickCount:1})
  }
  let profile
  if (process.env.BENCH_PROFILE === '1') profile = (await page.send('Profiler.stop')).profile
  const status=await page.evaluate(`({samples:__fd.samples,errors:__fd.errors,commits:__fd.commits,previewSizes:__fd.previewSizes,
    shaderFailures:__scene.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length,
    fences:__metro.getState().station.modules.filter(m=>m.type==='fence').length})`)
  const report={fixture,status,profiled:!!profile}
  writeFileSync(output,JSON.stringify(report,null,2))
  if(profile)writeFileSync(output.replace(/\.json$/,'.cpuprofile'),JSON.stringify(profile))
  console.log(JSON.stringify(report,null,2))
  if(status.errors.length || status.shaderFailures) throw Error('browser render failed')
  if (process.env.BENCH_EXPECT_LOCAL === '1') {
    if (status.samples.some(s=>s.hiddenLevelLeaks)) throw Error('hidden storey leaked during preview cleanup')
    const previews = status.samples.filter(s=>/:(down|move\d)$/.test(s.phase))
    if (previews.some(s=>s.previewGroups>5 || (s.work.syncBatches?.calls??0)!==0)) throw Error('preview rebuilt remote equipment')
    if (status.commits!==1 || status.fences!==fixture.fences+4) throw Error('cancel/release changed placement contract')
  }
} finally { await page?.close(); server.close() }
