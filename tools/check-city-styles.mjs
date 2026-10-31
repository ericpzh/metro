import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cpus, platform, release } from 'node:os'
import { createHash } from 'node:crypto'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const output = resolve(process.env.CITY_STYLE_OUTPUT || '.preview/city-styles/final')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
const report = { build: JSON.parse(readFileSync('game/dist/editor-benchmark-build.json', 'utf8')), gpu: 'hardware requested', host: { cpu: cpus()[0].model, platform: platform(), release: release() }, viewport: '1440x1000', demos: [] }
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/en`, profile: resolve(output, 'browser'), debugPort: 9398, windowSize: '1440,1000', softwareGpu: false })
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('metro-game.tutorial.v1',JSON.stringify({step:0,hidden:true}));window.cityErrors=[];addEventListener('error',e=>cityErrors.push(e.message));addEventListener('unhandledrejection',e=>cityErrors.push(String(e.reason)));` })
  await page.send('Page.reload')
  await waitFor(page.evaluate, `!!window.__scene && !!window.__metro && !document.querySelector('.gameLoadingOverlay')`)
  for (const demo of ['zoo', 'tanwei']) {
    await page.evaluate(`__metro.getState().loadReference('${demo}')`)
    await waitFor(page.evaluate, `__scene.ctx.stationData?.name===__metro.getState().station.name && __scene.framesRendered>0`)
    await page.evaluate(`new Promise(r=>{__scene.onNextFrame=r;__scene.requestRender()})`)
    await page.evaluate(`(()=>{
      window.cityAudit={chunks:0,rays:0,worker:[]};
      const chunks=__scene.chunks, mesh=chunks.meshStation;
      if(!window.cityMeshOriginal){window.cityMeshOriginal=mesh;chunks.meshStation=function(...a){cityAudit.chunks++;return cityMeshOriginal.apply(this,a)}}
      const ray=__scene.cameraSys.raycaster;
      if(!window.cityRayOriginal){window.cityRayOriginal=ray.intersectObjects;ray.intersectObjects=function(...a){cityAudit.rays++;return cityRayOriginal.apply(this,a)}}
      if(!window.cityPostOriginal){window.cityPostOriginal=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...a){cityAudit.worker.push(m.type);return cityPostOriginal.call(this,m,...a)}}
      __scene.setTrains(new Float32Array([0,0,1,1,1,0,13043009,1,0,0]));
      window.cityTrainRoots=__scene.trains.trainGroup.children.slice();window.cityMark=__scene.modelMats.trainMark.map;
      window.cityBenchRoots=__scene.modules.moduleMeshes.children.filter(g=>__metro.getState().station.modules.find(m=>m.id===g.userData.moduleId)?.type==='bench');
      window.citySwitches=[];
      const select=document.querySelector('#cityStylesMenu');
      if(!select.dataset.audit){select.dataset.audit='1';select.addEventListener('click',e=>{if(!e.target.closest('.cityStyleTile'))return;const started=performance.now();__scene.onNextFrame=()=>citySwitches.push({city:__metro.getState().station.cityStyle,ms:performance.now()-started})},true)}
    })()`)
    for (const [i, key] of ['End','Home','End'].entries()) {
      await page.evaluate(`document.querySelector('.cityStyleButton').click();document.querySelectorAll('.cityStyleTile')[${key==='End'?1:0}].click()`)
      await waitFor(page.evaluate, `citySwitches.length===${i+1}`, { what: 'city selection render' })
    }
    const checks = await page.evaluate(`(()=>{
      const s=__metro.getState(),scene=__scene,mark=scene.modelMats.trainMark.map;
      const roots=scene.modules.moduleMeshes.children;
      return {switches:citySwitches,audit:cityAudit,city:s.station.cityStyle,colours:s.station.lines.map(l=>l.colour),
        sameTrainTexture:mark===cityMark,sameTrainRoots:cityTrainRoots.every(g=>scene.trains.trainGroup.children.includes(g)),
        sameBenches:cityBenchRoots.every(g=>roots.includes(g)),logoPixel:Array.from(mark.image.getContext('2d').getImageData(46,125,1,1).data),
        graphicsQuality:s.graphicsQuality,gpuRenderer:(()=>{const g=scene.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown'})(),
        canvas:{width:scene.renderer.domElement.width,height:scene.renderer.domElement.height,pixelRatio:scene.renderer.getPixelRatio()},
        selectorLabel:document.querySelector('.cityStyleButton').getAttribute('aria-label'),errors:cityErrors}
    })()`)
    assert.equal(checks.city, 'shenzhen')
    assert.equal(checks.sameTrainTexture, true);assert.equal(checks.sameTrainRoots,true);assert.equal(checks.sameBenches,true)
    assert.equal(checks.audit.chunks,0);assert.equal(checks.audit.rays,0)
    assert.ok(checks.audit.worker.every(type=>type==='population'))
    assert.deepEqual(checks.logoPixel,[0,153,67,255]);assert.deepEqual(checks.errors,[])
    await page.evaluate(`(()=>{const s=__metro.getState();s.updateLine(s.station.lines[0].id,{colour:'#123456'})})()`)
    await page.evaluate(`new Promise(r=>{__scene.onNextFrame=r;__scene.requestRender()})`)
    checks.liveBadgeRecolour=await page.evaluate(`(()=>{
      const root=__scene.modules.moduleMeshes.children.find(g=>g.userData.ownedMaterials?.some(m=>m.map?.image?.height===96));
      const canvas=root?.userData.ownedMaterials.find(m=>m.map?.image?.height===96)?.map.image;
      if(!canvas)return false;const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=0;i<pixels.length;i+=4)if(pixels[i]===18&&pixels[i+1]===52&&pixels[i+2]===86)return true;return false;
    })()`)
    assert.equal(checks.liveBadgeRecolour,true)
    await page.evaluate(`__metro.getState().undo();new Promise(r=>{__scene.onNextFrame=r;__scene.requestRender()})`)
    report.demos.push({demo,...checks})
    await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(output,demo+'-shenzhen.png'),Buffer.from(r.data,'base64')))
    // Review the real model artwork at legible scale, together with its shared train mark.
    const artwork = await page.evaluate(`(()=>{
      const root=__scene.modules.moduleMeshes.children.find(g=>g.userData.ownedMaterials?.some(m=>m.map?.image?.height===96));
      const header=root?.userData.ownedMaterials.find(m=>m.map?.image?.height===96)?.map.image;
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=400;const c=canvas.getContext('2d');c.fillStyle='#eef1f4';c.fillRect(0,0,1200,400);
      if(header)c.drawImage(header,20,20,1160,218);
      c.drawImage(__scene.modelMats.trainMark.map.image,530,245,128,150);
      return canvas.toDataURL('image/png').split(',')[1]
    })()`)
    writeFileSync(resolve(output,demo+'-artwork.png'),Buffer.from(artwork,'base64'))
  }
  await page.evaluate(`__metro.getState().undo()`)
  await waitFor(page.evaluate,`__metro.getState().station.cityStyle==='guangzhou'`)
  await page.evaluate(`__metro.getState().redo()`)
  await waitFor(page.evaluate,`__metro.getState().station.cityStyle==='shenzhen'`)
  report.undoRedo=true
  await page.send('Page.reload')
  await waitFor(page.evaluate,`!!window.__scene && window.__metro?.getState().station.cityStyle==='shenzhen'`,{what:'saved city style'})
  report.autosaveReload=true
  await page.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`})
  await waitFor(page.evaluate,`document.querySelector('.cityStyleButton')?.getAttribute('aria-label')==='城市风格'`)
  report.chineseSelector=true
  await page.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false})
  report.topbarFits1024=await page.evaluate(`(()=>{const bar=document.querySelector('.topbar');return bar.scrollWidth<=bar.clientWidth})()`)
  assert.equal(report.topbarFits1024,true)
  report.assetHash=createHash('sha256').update(readFileSync('game/dist/index.html')).digest('hex')
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
} finally { await page?.close();server.close() }
