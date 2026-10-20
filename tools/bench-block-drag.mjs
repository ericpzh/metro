import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/block-drag.json')
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(`.preview/perf/block-chrome-${process.pid}`), windowSize: '1440,1000' })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics', { what: 'game' })
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  const fixture = await page.evaluate(`(async () => {
    const store=__metro, s=store.getState(), scene=__scene
    s.commit({...s.station,name:'Block drag 100x100',seed:12345,cells:[],modules:[],lines:[]})
    s.setActiveZ(1); store.setState({tool:'block',autoWalls:false,halfWall:false,triangles:false,playing:false})
    scene.setPreset('plan'); scene.setOrtho(true)
    const cam=scene.cameraSys
    cam.controls.enableDamping=false
    const activeCamera=cam.activeCamera()
    cam.controls.target.set(50,50,1); activeCamera.position.set(50,50,600); cam.controls.update()
    activeCamera.zoom=0.6; activeCamera.updateProjectionMatrix()
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    const camera=cam.activeCamera();camera.updateMatrixWorld(true)
    const rect=scene.renderer.domElement.getBoundingClientRect(), Vector=camera.position.constructor
    const point=(x,y)=>{const p=new Vector(x+.5,y+.5,1).project(camera);return{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}}
    const points=[point(0,0),point(99,99)]
    const picks=points.map(p=>scene.pick(p.x,p.y,1))
    if(picks.some((hit,i)=>!hit || hit.cell[0]!== (i?98:0) || hit.cell[1] !== (i?98:0))) throw Error('pointer target mismatch '+JSON.stringify({points,picks}))
    window.__blockBench={phase:'idle',samples:[],errors:[],commits:0,ghostCounts:[]}
    addEventListener('error',e=>__blockBench.errors.push(e.message))
    addEventListener('unhandledrejection',e=>__blockBench.errors.push(String(e.reason)))
    const commit=store.getState().commit
    store.setState({commit:(...args)=>{__blockBench.commits++;return commit(...args)}})
    const original=scene.setGhost
    scene.setGhost=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{if(args[0]?.length)__blockBench.ghostCounts.push({phase:__blockBench.phase,cells:args[0].length,ms:performance.now()-t})}}
    for(const name of ['pointerdown','pointermove','pointerup']){
      document.addEventListener(name,()=>{__blockBench.eventStart=performance.now()},true)
      document.addEventListener(name,()=>{__blockBench.handlerMs=performance.now()-__blockBench.eventStart})
    }
    const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    return{name:s.station.name,cells:s.station.cells.length,modules:s.station.modules.length,seed:s.station.seed,activeZ:1,
      browser:navigator.userAgent,gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),viewport:[innerWidth,innerHeight],points}
  })()`)
  async function event(phase, method, params) {
    await page.evaluate(`__blockBench.phase=${JSON.stringify(phase)};__blockBench.start=performance.now();__blockBench.handlerMs=null`)
    await page.send(method, params)
    if(phase.includes('move100x100')) await page.evaluate('new Promise(r=>setTimeout(r,110))')
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const sample=await page.evaluate(`(()=>{const s={phase:__blockBench.phase,twoRafMs:performance.now()-__blockBench.start,handlerMs:__blockBench.handlerMs};__blockBench.samples.push(s);return s})()`)
    return sample
  }
  const [a,b]=fixture.points
  for(const iteration of ['cold','warm']){
    await event(iteration+':hover','Input.dispatchMouseEvent',{type:'mouseMoved',...a})
    await event(iteration+':down','Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1})
    await page.evaluate('new Promise(r=>setTimeout(r,220))')
    await event(iteration+':move100x100','Input.dispatchMouseEvent',{type:'mouseMoved',...b,button:'left',buttons:1})
    if(iteration==='cold'){
      await event('cold:cancel','Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
      await event('cold:release-after-cancel','Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1})
    } else await event('warm:release','Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1})
  }
  const status=await page.evaluate(`({samples:__blockBench.samples,errors:__blockBench.errors,commits:__blockBench.commits,ghostCounts:__blockBench.ghostCounts,
    cells:__metro.getState().station.cells.length,notice:__metro.getState().notice})`)
  const report={fixture,status}
  writeFileSync(output,JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  if(status.errors.length)throw Error('browser interaction failed')
} finally { await page?.close(); server.close() }
