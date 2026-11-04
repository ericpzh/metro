// Production city selection, retained artwork, lazy supplied poster and High/Low review.
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {createModule,toState} from '../game/src/build/model.ts'
import {serialize} from '../game/src/persistence/save.ts'
import {defaultLine} from '../game/src/build/rail.ts'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'

const out=resolve('.preview/city-styles/wuhan-browser');mkdirSync(out,{recursive:true})
const modules=['exit','exit-virtual','guidepost','linemap-wall','linemap-stand','exit-doorway-2'].map((id,i)=>createModule(id,i*7,0,0,id))
modules[0].cfg.name='C2口';modules[1].cfg.name='B1口';modules[2].cfg.exitId=modules[1].id;modules[5].cfg.name='D口'
const lines=['2','4'].map(id=>defaultLine(id,'up','third-rail',5,'wuhan'))
for(let i=0;i<2;i++){
  modules.push({id:'track-'+i,type:'track',x:i*30,y:-16,z:0,rot:0,w:21,d:3,cfg:{line:lines[i].id,dir:'up',power:'third-rail'}})
  lines[i].cars=1
}
const fixture=serialize(toState({name:'中南路',nameEn:'Zhongnan Rd.',seed:1,cells:[],modules,lines}))
const server=await serveDir(resolve('game/dist'),0);let page
const report={build:JSON.parse(readFileSync('game/dist/editor-benchmark-build.json','utf8'))}
const shot=async name=>{const r=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,name+'.png'),Buffer.from(r.data,'base64'))}
const exportCanvas=async(name,expression)=>{const data=await page.evaluate(`${expression}.toDataURL('image/png')`);writeFileSync(resolve(out,name+'.png'),Buffer.from(data.split(',')[1],'base64'))}
const frame=()=>page.evaluate(`new Promise(r=>{__scene.onNextFrame=r;__scene.requestRender()})`)
try{
  // A unique profile makes lazy-decode checks repeatable even after a saved Wuhan run.
  page=await withPage({url:`http://127.0.0.1:${server.address().port}/en`,profile:resolve(out,'browser-'+process.pid),debugPort:9367,softwareGpu:false,windowSize:'1440,1000'})
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('metro-game.ui-theme','blueprint');localStorage.setItem('metro-game.tutorial.v1','{"step":0,"hidden":true}');window.whErrors=[];addEventListener('error',e=>whErrors.push(e.message));addEventListener('unhandledrejection',e=>whErrors.push(String(e.reason)));`})
  await page.send('Page.reload');await waitFor(page.evaluate,'!!window.__scene && !!window.__metro')
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('wuhan')`),false)
  await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(fixture)})`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='中南路'`);await frame()
  await page.evaluate(`document.querySelector('.cityStyleButton').click()`)
  assert.equal(await page.evaluate(`document.querySelectorAll('.cityStyleTile').length`),7);await shot('selector')
  await page.evaluate(`(()=>{
    window.whAudit={chunks:0,rays:0};const chunks=__scene.chunks,mesh=chunks.meshStation;chunks.meshStation=function(...a){whAudit.chunks++;return mesh.apply(this,a)};
    const ray=__scene.cameraSys.raycaster,intersect=ray.intersectObjects;ray.intersectObjects=function(...a){whAudit.rays++;return intersect.apply(this,a)};
    window.whTrains=__scene.trains.trainGroup.children.slice();window.whMark=__scene.modelMats.trainMark.map;
    document.querySelector('.cityStyleTile[data-city=wuhan]').click()
  })()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='wuhan' && __scene.ctx.lineMaps.ready('wuhan')`);await frame()
  assert.equal(await page.evaluate(`__scene.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='wuhan').getObjectByName('wuhan-guide-square-shaft')===undefined`),true)
  Object.assign(report,await page.evaluate(`(()=>{
    const s=__scene,face=s.ctx.lineMaps.face(1.8,1.8,'wuhan');
    return {audit:whAudit,sameTrainRoots:whTrains.length>0&&whTrains.every(g=>s.trains.trainGroup.children.includes(g)),sameTrainTexture:s.modelMats.trainMark.map===whMark,
      colours:__metro.getState().station.lines.map(l=>l.colour),aspect:face.geometry.parameters.width/face.geometry.parameters.height,
      map:face.material.map.image.src}
  })()`))
  assert.deepEqual(report.audit,{chunks:0,rays:0});assert.equal(report.sameTrainRoots,true);assert.equal(report.sameTrainTexture,true)
  assert.deepEqual(report.colours,['#ec9cbb','#a6d30b']);assert.ok(Math.abs(report.aspect-2732/2731)<1e-8)
  await page.evaluate(`(()=>{const root=__scene.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='wuhan'),sign=root.getObjectByName('wuhan-entrance-sign');window.whRetained={root,sign,map:sign.material.map,version:sign.material.map.version}})()`)
  await exportCanvas('entrance-plate','whRetained.map.image');await exportCanvas('ui-logo',`document.querySelector('.cityStyleButton canvas')`);await exportCanvas('train-atlas','whMark.image')
  await page.evaluate(`__metro.getState().renameStation('仁和路','Renhe Rd.')`)
  await waitFor(page.evaluate,`whRetained.map.version>whRetained.version`)
  assert.equal(await page.evaluate(`__scene.modules.moduleMeshes.children.includes(whRetained.root)&&whRetained.sign.material.map===whRetained.map`),true)
  await page.evaluate(`__metro.getState().updateLine('4',{colour:'#123456'})`);await frame()
  assert.equal(await page.evaluate(`(()=>{const c=whRetained.map.image,a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i]===18&&a[i+1]===52&&a[i+2]===86)return true;return false})()`),true)
  await page.evaluate(`__metro.getState().undo();__metro.getState().undo();__metro.getState().undo()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='guangzhou'`)
  await page.evaluate(`__metro.getState().redo()`);await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='wuhan'`)
  report.undoRedo=true;report.retainedSignRepaint=true
  for(const theme of ['blueprint','site','studio']){
    await page.evaluate(`(()=>{for(let i=0;i<3&&document.documentElement.dataset.uiTheme!=='${theme}';i++)document.querySelector('.settingsActionGrid button:last-child').click()})()`);await frame()
    await page.evaluate(`document.querySelector('.cityStyleButton').click()`);await shot('selector-'+theme);await page.evaluate(`document.querySelector('#cityStylesMenu').hidePopover()`)
  }
  for(const subject of ['front','side','rear','guide','map'])for(const quality of ['high','low']){
    await page.evaluate(`(()=>{
      const s=__scene,root=s.modules.moduleMeshes.children.find(g=>g.userData.${subject==='guide'?"moduleId==='guidepost'":subject==='map'?"moduleId==='linemap-stand'":"exitCityStyle==='wuhan'"}),V=root.position.constructor;
      root.updateMatrixWorld(true);const target=s.cameraSys.controls.target,c=s.cameraSys.activeCamera();
      const p=${subject==='front'?'[0,1,1.8]':subject==='rear'?'[0,-4.5,1.5]':subject==='side'?'[1.5,-1.5,1.9]':subject==='guide'?'[0,0,2.4]':'[0,0,1.2]'};
      const eye=${subject==='front'?'[-5,11,5.5]':subject==='rear'?'[5,-12,4.5]':subject==='side'?'[11,-1,4.5]':subject==='guide'?'[1.3,-4.2,3.1]':'[0,-4.8,1.8]'};
      target.copy(root.localToWorld(new V(...p)));c.position.copy(root.localToWorld(new V(...eye)));c.lookAt(target);s.cameraSys.controls.update();__metro.getState().setGraphicsQuality('${quality}');
    })()`);await frame();await shot(subject+'-'+quality)
  }
  await page.send('Page.reload');await waitFor(page.evaluate,`window.__metro?.getState().station.cityStyle==='wuhan' && window.__scene?.ctx.lineMaps.ready('wuhan')`)
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('guangzhou')`),false);report.savedReload=true
  assert.deepEqual(await page.evaluate('whErrors'),[])
  report.complete=true;writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await page?.close();server.close()}
