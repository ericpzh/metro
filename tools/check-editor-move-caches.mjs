// Production move/undo/redo and GPU parity. This is a functional check, not a
// latency capture: readback and forced fresh batches are deliberately untimed.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const output=resolve(process.env.MOVE_CHECK_OUTPUT??`.preview/perf/editor-move-caches/run-${Date.now()}`)
mkdirSync(output,{recursive:true})
const server=await serveDir(resolve(process.env.BENCH_DIST??'game/dist'),0),reports=[]
try{
  for(const [demo,id]of [['zoo','guidepost'],['tanwei','walkway/length=long']]){
    const page=await withPage({url:`http://127.0.0.1:${server.address().port}/?bench-editor-actions`,profile:join(output,'chrome-'+demo),
      debugPort:27000+process.pid%20000,softwareGpu:process.argv.includes('--software-gpu'),windowSize:'1440,1000'})
    try{
      await waitFor(page.evaluate,'!!window.__editorActions&&!!window.__metro?.getState().metrics')
      await loadExampleStation(page,demo)
      await page.evaluate(`__metro.getState().setPlaying(false);new Promise(r=>setTimeout(r,1200))`)
      await page.evaluate(`(()=>{
        window.__moveCheck={errors:[],fastMoves:0};
        addEventListener('error',e=>__moveCheck.errors.push(e.message));addEventListener('unhandledrejection',e=>__moveCheck.errors.push(String(e.reason)));
        const error=console.error;console.error=(...args)=>{__moveCheck.errors.push(args.map(String).join(' '));error(...args)};
        const store=__metro.getState(),confirm=store.confirmMove;
        store.confirmMove=()=>{confirm();if(!__metro.getState().moveDraft)__moveCheck.station=__metro.getState().station};
        const batches=__scene.modules.batches,translate=batches.translateRoots;
        batches.translateRoots=function(...args){const ok=translate.apply(this,args);if(ok)__moveCheck.fastMoves++;return ok};
      })()`)
      await page.evaluate('__editorActions.initialize()')
      const setup=await page.evaluate(`__editorActions.runCase(${JSON.stringify(id)},1)`)
      assert.deepEqual(setup.errors,[]);assert.equal(setup.glError,0)
      await page.evaluate(`__metro.getState().commit(__moveCheck.station)`)
      await waitFor(page.evaluate,'__scene.ctx.stationData.modules===__metro.getState().station.modules')
      await page.evaluate(`(async()=>{
        const c=__moveCheck,s=__scene; c.frame=()=>new Promise(r=>requestAnimationFrame(r));await c.frame();await c.frame();
        s.setModulePreview(null);s.setGhost([],'add');s.setStaticDetail(false);s.setAgentsVisible(false);
        c.id=c.station.modules.at(-1).id;c.root=s.modules.moduleMeshes.children.find(root=>root.userData.moduleId===c.id);
        c.materials=()=>c.root.userData.ownedMaterials?.map(m=>m.map?.uuid??m.uuid)??[];c.ink=JSON.stringify(c.materials());
        c.pixels=()=>{
          const renderer=s.renderer,camera=s.cameraSys.activeCamera(),gl=renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
          // Read immediately after rendering to the production framebuffer.
          const previous=renderer.getRenderTarget();renderer.setRenderTarget(null);
          s.modules.batches.withHiddenSources(camera,()=>renderer.render(s.ctx.scene,camera));
          const data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);renderer.setRenderTarget(previous);
          return {data,w,h};
        };
        c.check=async phase=>{
          await c.frame();await c.frame();s.setSelection(null);
          if(s.modules.moduleMeshes.children.find(root=>root.userData.moduleId===c.id)!==c.root)throw Error('Move replaced the retained model');
          if(JSON.stringify(c.materials())!==c.ink)throw Error('Move replaced guidepost ink');
          const a=c.pixels();s.modules.batches.invalidateViews(false);s.modules.retainedBatches=false;s.modules.syncBatches();const b=c.pixels();
          let changed=0;for(let i=0;i<a.data.length;i+=4)if([0,1,2].some(k=>Math.abs(a.data[i+k]-b.data[i+k])>1))changed++;
          if(changed>128)throw Error(phase+': cached/fresh pixels differ at '+changed+' pixels');
          const glError=s.renderer.getContext().getError();if(glError)throw Error('WebGL error '+glError);
          return {phase,changedPixels:changed,canvas:[a.w,a.h],fastMoves:c.fastMoves};
        };
        const mod=__metro.getState().station.modules.find(m=>m.id===c.id),at={x:mod.x,y:mod.y+8,z:mod.z};
        __metro.getState().liftModule(c.id);await c.frame();
        const candidate={...mod,y:mod.y+8,...(mod.from?{from:{...mod.from,y:mod.from.y+8},to:{...mod.to,y:mod.to.y+8}}:{})};
        __metro.getState().aimMove(at,candidate,'');c.startMoves=c.fastMoves;__metro.getState().confirmMove();
      })()`)
      await waitFor(page.evaluate,'__scene.ctx.stationData.modules===__metro.getState().station.modules&&__scene.ghostSys.movingModuleId===null')
      const phases=[await page.evaluate('__moveCheck.check("drop")')]
      for(const action of ['undo','redo']){
        await page.evaluate(`__metro.getState().${action}()`)
        await waitFor(page.evaluate,'__scene.ctx.stationData.modules===__metro.getState().station.modules')
        phases.push(await page.evaluate(`__moveCheck.check(${JSON.stringify(action)})`))
      }
      const result=await page.evaluate('({errors:__moveCheck.errors,fastMoves:__moveCheck.fastMoves-__moveCheck.startMoves})')
      assert.deepEqual(result.errors,[]);assert.ok(result.fastMoves>=3,'drop/undo/redo exercised direct batch translation')
      reports.push({demo,id,...result,phases});console.log(demo,id,JSON.stringify(phases))
      const screenshot=await page.send('Page.captureScreenshot',{format:'png'})
      writeFileSync(join(output,demo+'.png'),Buffer.from(screenshot.data,'base64'))
    }finally{await page.close()}
  }
}finally{server.close();writeFileSync(join(output,'report.json'),JSON.stringify({reports},null,2))}
console.log('Editor move GPU parity passed:',join(output,'report.json'))
