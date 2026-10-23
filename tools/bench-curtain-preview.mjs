import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/curtain-preview/report.json')
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(`.preview/perf/curtain-chrome-${process.pid}`), softwareGpu: false })
  await waitFor(page.evaluate, '!!(window.__scene && window.__metro?.getState().metrics)', { what: 'station' })
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  await loadExampleStation(page, process.env.BENCH_DEMO ?? 'tanwei')
  await page.evaluate(`new Promise(r=>setTimeout(r,2500))`)
  const setup = await page.evaluate(`(async()=>{
    const store=window.__metro, scene=window.__scene;
    store.setState({playing:false,tool:'module',moduleType:'curtain-wall'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    window.__curtain={previews:[],dispatchEvents:[],commits:0,stationCalls:0,phase:'setup',errors:[]};
    window.__curtainStation=store.getState().station;
    addEventListener('error',e=>__curtain.errors.push(e.message));
    addEventListener('unhandledrejection',e=>__curtain.errors.push(String(e.reason)));
    for(const [object,key,counter] of [[scene,'setStation','stationCalls'],[store.getState(),'commit','commits']]) {
      const original=object[key]; object[key]=function(...args){__curtain[counter]++;return original.apply(this,args)};
    }
    const original=scene.setModulePreview;
    scene.setModulePreview=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{__curtain.previews.push({phase:__curtain.phase,ms:performance.now()-t,modules:args[0]?(Array.isArray(args[0])?args[0].length:1):0})}};
    document.addEventListener('pointermove',()=>{__curtain.start=performance.now()},{capture:true});
    // The tool is frame-coalesced: this is dispatch overhead only, not hover CPU.
    document.addEventListener('pointermove',()=>{__curtain.dispatchEvents.push({phase:__curtain.phase,ms:performance.now()-__curtain.start})});
    const rect=scene.renderer.domElement.getBoundingClientRect(), points=[];
    for(let row=3;row<8;row++)for(let col=3;col<9;col++){
      const p={x:rect.left+rect.width*col/10,y:rect.top+rect.height*row/10};
      const hit=scene.pick(p.x,p.y,store.getState().activeZ);
      if(hit?.solid)points.push({...p,cell:hit.cell});
    }
    if(points.length<4)throw Error('not enough hover targets');
    const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {points,station:store.getState().station.name,modules:store.getState().station.modules.length,gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
  })()`)
  await page.send('Profiler.enable')
  await page.send('Profiler.start')
  const samples=[]
  for(let i=0;i<12;i++) {
    await page.evaluate(`__curtain.phase=${JSON.stringify(i===0?'first-hover':`move-${i}`)}`)
    const start=performance.now()
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:setup.points[i%setup.points.length].x,y:setup.points[i%setup.points.length].y})
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    samples.push({phase:i===0?'first-hover':`move-${i}`,twoRafMs:performance.now()-start})
    await page.evaluate(`(()=>{
      const group=window.__scene.ghostSys.previewGroup;
      let meshes=0;group.traverse(o=>{if(o.isMesh){meshes++;if(!o.material.transparent)throw Error('opaque ghost')}});
      if(!group.visible||meshes<3)throw Error('missing curtain preview');
      if(window.__metro.getState().station!==window.__curtainStation)throw Error('preview edited station');
    })()`)
  }
  const profile=await page.send('Profiler.stop')
  writeFileSync(output+'.cpuprofile',JSON.stringify(profile.profile))
  const result=await page.evaluate('window.__curtain')
  if(result.commits||result.stationCalls||result.errors.length)throw Error('hover committed, rebuilt station or raised an error')
  const screenshot=await page.send('Page.captureScreenshot',{format:'png'})
  writeFileSync(output+'.png',Buffer.from(screenshot.data,'base64'))
  writeFileSync(output,JSON.stringify({setup,samples,...result},null,2))
  console.log(JSON.stringify({setup:{...setup,points:setup.points.length},samples,...result},null,2))
} finally { await page?.close(); server.close() }
