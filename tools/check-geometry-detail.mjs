import assert from 'node:assert/strict'
import { mkdirSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir,withPage,waitFor,loadExampleStation } from './browser-harness.mjs'
const fallback=process.argv.includes('--no-multi-draw')
const output=resolve('.preview/perf/geometry-detail',fallback?'fallback':'native')
mkdirSync(output,{recursive:true})
const server=await serveDir(resolve('game/dist'),0),reports=[]
try {
  for(const id of ['zoo','tanwei']) {
    const page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(output,`chrome-${id}-${process.pid}`),softwareGpu:false})
    try {
      if(fallback) {
        await page.send('Page.enable')
        await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`const original=WebGL2RenderingContext.prototype.getExtension;WebGL2RenderingContext.prototype.getExtension=function(name){return name==='WEBGL_multi_draw'?null:original.call(this,name)}`})
        await page.send('Page.reload')
      }
      await waitFor(page.evaluate,'!!window.__scene && !!window.__metro',{what:'app'})
      await page.evaluate(`window.__detailErrors=[];const error=console.error;console.error=(...args)=>{__detailErrors.push(args.map(String).join(' '));error(...args)};window.addEventListener('error',e=>__detailErrors.push(e.message));window.addEventListener('unhandledrejection',e=>__detailErrors.push(String(e.reason)))`)
      await loadExampleStation(page,id)
      const settings=await page.evaluate(`(async()=>{
        const frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        document.querySelector('.settingsMenu summary').click();
        const menu=document.querySelector('.settingsMenu');if(!menu.open)throw Error('gear did not open settings');
        const buttons=[...menu.querySelectorAll('button')];
        const low=buttons.find(b=>b.textContent==='低画质'),high=buttons.find(b=>b.textContent==='高画质');
        if(!low||!high)throw Error('missing bilingual quality choices');
        const version=__metro.getState().version,tick=__metro.getState().metrics.tick;
        low.click();await frames();
        if(__metro.getState().graphicsQuality!=='low'||__scene.modules.batches.graphicsQuality!=='low')throw Error('low quality not applied');
        const lowTriangles=__scene.renderer.info.render.triangles;
        high.click();await frames();
        if(__metro.getState().version!==version||__metro.getState().metrics.tick!==tick)throw Error('quality edited station/sim');
        const lang=menu.querySelector('[title^="切换语言"]');lang.click();await frames();
        if(!menu.textContent.includes('中文')||!menu.textContent.includes('Graphics quality'))throw Error('opposite native language label missing');
        menu.querySelector('[title^="Switch language"]').click();await frames();
        __scene.setHideUI(true);await frames();const presented=__scene.renderer.info.render.triangles;
        const approximated=[...__scene.modules.batches.entries.values()].filter(e=>e.detail?.far||e.mesh.minimalOn||e.mesh.far).length;
        if(approximated)throw Error('Hide UI retained reduced visible geometry');
        __scene.setStaticDetail(false);await frames();
        if(__scene.renderer.info.render.triangles!==presented)throw Error('Hide UI differed from full geometry');
        __scene.setStaticDetail(true);__scene.setHideUI(false);await frames();
        return{lowTriangles,presentationTriangles:presented,actions:[...menu.querySelectorAll('.settingsAction')].map(b=>b.textContent.trim())};
      })()`)
      const menuShot=await page.send('Page.captureScreenshot',{format:'png'})
      writeFileSync(resolve(output,`${id}-settings.png`),Buffer.from(menuShot.data,'base64'))
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
      assert.equal(await page.evaluate('document.querySelector(".settingsMenu").open'),false)
      const point=await page.evaluate(`(async()=>{
        __metro.getState().setPlaying(false);await new Promise(r=>setTimeout(r,2000));
        const s=__scene;s.controls.enableDamping=false;s.zoomBy(.5);
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        window.__detailBatches=s.modules.batches.root.children.slice();window.__detailInputs=[];
        s.renderer.domElement.addEventListener('wheel',()=>{const t=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>__detailInputs.push(performance.now()-t)))},{capture:true});
        const r=s.renderer.domElement.getBoundingClientRect();return{x:r.left+r.width*.5,y:r.top+r.height*.65};
      })()`)
      for(let i=0;i<2;i++) {
        await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:400})
        await page.evaluate('new Promise(r=>setTimeout(r,300))')
      }
      const report=await page.evaluate(`(async()=>{
        const s=__scene,frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        s.setEquipmentDetail(false);await frames();const before={...s.renderer.info.render};
        s.setEquipmentDetail(true);await frames();const after={...s.renderer.info.render};
        const objects=s.modules.batches.root.children.slice();
        const details=[...s.modules.batches.entries.values()].filter(e=>e.detail).length;
        s.setEquipmentDetail(false);await frames();const restored={...s.renderer.info.render};
        s.setEquipmentDetail(true);await frames();
        if(!__detailBatches.every(m=>objects.includes(m)))throw Error('zoom replaced a GPU batch');
        return{before,after,restored,details,zoomInputMs:__detailInputs,errors:__detailErrors,glError:s.renderer.getContext().getError(),multiDraw:!!s.renderer.getContext().getExtension('WEBGL_multi_draw')};
      })()`)
      assert.ok(report.details>0);assert.ok(report.after.triangles<report.before.triangles)
      assert.equal(report.before.triangles,report.restored.triangles)
      assert.equal(report.before.calls,report.after.calls)
      assert.equal(report.glError,0);assert.deepEqual(report.errors,[])
      assert.equal(report.zoomInputMs.length,2)
      if(fallback)assert.equal(report.multiDraw,false)
      const {data}=await page.send('Page.captureScreenshot',{format:'png'})
      writeFileSync(resolve(output,`${id}.png`),Buffer.from(data,'base64'))
      reports.push({id,settings,...report})
      console.log(`${id}: ${report.before.triangles} → ${report.after.triangles} triangles; zoom ${report.zoomInputMs.map(t=>t.toFixed(1)).join('/')} ms; allocations/restore/GL pass`)
    } finally {await page.close()}
  }
  writeFileSync(resolve(output,'report.json'),JSON.stringify(reports,null,2))
} finally {server.close()}
