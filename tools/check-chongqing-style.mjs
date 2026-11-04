// Chongqing production selection, three sealed sides, closed pylons and retained line badges.
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {cpus} from 'node:os'
import {createModule,toState} from '../game/src/build/model.ts'
import {serialize} from '../game/src/persistence/save.ts'
import {defaultLine} from '../game/src/build/rail.ts'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'

const out=resolve('.preview/city-styles/chongqing-browser');mkdirSync(out,{recursive:true})
const modules=['exit','exit-virtual','guidepost','linemap-wall','linemap-stand','exit-doorway-2'].map((id,i)=>createModule(id,i*5,0,0,id))
modules[0].cfg.name='3A口';modules[1].cfg.name='4A口';modules[2].cfg.exitId=modules[1].id;modules[5].cfg.name='4口'
const lines=['5','9'].map(id=>defaultLine(id,'up','third-rail',5,'chongqing'))
for(let i=0;i<2;i++){
  modules.push({id:'track-'+i,type:'track',x:i*30,y:-16,z:0,rot:0,w:21,d:3,cfg:{line:lines[i].id,dir:'up',power:'third-rail'}})
  lines[i].cars=1
}
const fixture=serialize(toState({name:'重光',nameEn:'Chongguang',seed:1,cells:[],modules,lines}))
const server=await serveDir(resolve('game/dist'),0);let page
const report={build:JSON.parse(readFileSync('game/dist/editor-benchmark-build.json','utf8')),cpu:cpus()[0].model,
  fixture:'one covered exit, virtual exit, guidepost, wall/standing maps, doorway and two prepared B trains; paused; DOM click to first render submission'}
const shot=async name=>{const r=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,name+'.png'),Buffer.from(r.data,'base64'))}
const exportCanvas=async(name,expression)=>{const data=await page.evaluate(`${expression}.toDataURL('image/png')`);writeFileSync(resolve(out,name+'.png'),Buffer.from(data.split(',')[1],'base64'))}
try{
  page=await withPage({url:`http://127.0.0.1:${server.address().port}/en`,profile:resolve(out,'browser'),debugPort:9366,softwareGpu:false,windowSize:'1440,1000'})
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('metro-game.ui-theme','blueprint');localStorage.setItem('metro-game.tutorial.v1','{"step":0,"hidden":true}');window.cqErrors=[];addEventListener('error',e=>cqErrors.push(e.message));addEventListener('unhandledrejection',e=>cqErrors.push(String(e.reason)));`})
  await page.send('Page.reload');await waitFor(page.evaluate,'!!window.__scene && !!window.__metro')
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('chongqing')`),false)
  await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(fixture)})`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='重光'`)
  await page.evaluate(`document.querySelector('.cityStyleButton').click()`)
  assert.equal(await page.evaluate(`document.querySelectorAll('.cityStyleTile').length`),6);await shot('selector')
  await page.evaluate(`(()=>{
    window.cqAudit={chunks:0,rays:0};const chunks=__scene.chunks,mesh=chunks.meshStation;chunks.meshStation=function(...a){cqAudit.chunks++;return mesh.apply(this,a)};
    const ray=__scene.cameraSys.raycaster,intersect=ray.intersectObjects;ray.intersectObjects=function(...a){cqAudit.rays++;return intersect.apply(this,a)};
    window.cqTrains=__scene.trains.trainGroup.children.slice();window.cqMaps=cqTrains.map(g=>g.userData.chongqingTrainMark.map);
    window.cqStarted=performance.now();__scene.onNextFrame=()=>window.cqMs=performance.now()-cqStarted;
    document.querySelector('.cityStyleTile[data-city=chongqing]').click()
  })()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='chongqing' && __scene.ctx.lineMaps.ready('chongqing') && cqMs>0`)
  Object.assign(report,await page.evaluate(`(()=>{
    const s=__scene,face=s.ctx.lineMaps.face(1.8,1.8,'chongqing'),gl=s.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {ms:cqMs,audit:cqAudit,sameTrainRoots:cqTrains.every(g=>s.trains.trainGroup.children.includes(g)),sameTrainTextures:cqTrains.every((g,i)=>g.userData.chongqingTrainMark.map===cqMaps[i]),
      badges:cqTrains.map(g=>g.userData.chongqingTrainMark.userData.badgeKey),colours:__metro.getState().station.lines.map(l=>l.colour),aspect:face.geometry.parameters.width/face.geometry.parameters.height,
      map:face.material.map.image.src,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',canvas:{width:gl.canvas.width,height:gl.canvas.height,pixelRatio:s.renderer.getPixelRatio()}}
  })()`))
  assert.deepEqual(report.audit,{chunks:0,rays:0});assert.equal(report.sameTrainRoots,true);assert.equal(report.sameTrainTextures,true)
  assert.deepEqual(report.colours,['#00a3e0','#861f41']);assert.ok(report.badges.includes('5|#00a3e0'));assert.ok(report.badges.includes('9|#861f41'))
  assert.ok(Math.abs(report.aspect-2000/1833)<1e-8)
  await page.evaluate(`(()=>{const root=__scene.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='chongqing'),sign=root.getObjectByName('chongqing-entrance-sign');window.cqRetained={root,sign,map:sign.material.map,version:sign.material.map.version}})()`)
  await page.evaluate(`__metro.getState().renameStation('红岩村','Hongyancun')`)
  await waitFor(page.evaluate,`cqRetained.map.version>cqRetained.version`)
  assert.equal(await page.evaluate(`__scene.modules.moduleMeshes.children.includes(cqRetained.root)&&cqRetained.sign.material.map===cqRetained.map`),true)
  await exportCanvas('entrance-plate','cqRetained.map.image')
  await page.evaluate(`__metro.getState().updateLine('5',{colour:'#123456'})`)
  await waitFor(page.evaluate,`cqTrains.some(g=>g.userData.chongqingTrainMark.userData.badgeKey==='5|#123456')`)
  assert.equal(await page.evaluate(`cqTrains.every((g,i)=>g.userData.chongqingTrainMark.map===cqMaps[i])`),true)
  await page.evaluate(`__metro.getState().undo();__metro.getState().undo();__metro.getState().undo()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='guangzhou'`)
  await page.evaluate(`__metro.getState().redo()`);await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='chongqing'`)
  report.undoRedo=true;report.retainedSignAndBadgeRepaint=true
  for(const theme of ['blueprint','site','studio']){
    await page.evaluate(`(()=>{for(let i=0;i<3&&document.documentElement.dataset.uiTheme!=='${theme}';i++)document.querySelector('.settingsActionGrid button:last-child').click()})()`)
    await page.evaluate(`new Promise(r=>requestAnimationFrame(r))`)
    await page.evaluate(`document.querySelector('.cityStyleButton').click()`)
    await shot('selector-'+theme);await page.evaluate(`document.querySelector('#cityStylesMenu').hidePopover()`)
  }
  await page.evaluate(`document.querySelector('.settingsActionGrid button:last-child').click()`)
  for(const subject of ['front','left','right','rear','guide-end'])for(const quality of ['high','low']){
    await page.evaluate(`(()=>{
      const s=__scene,root=s.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='chongqing'),V=root.position.constructor;
      root.updateMatrixWorld(true);const target=s.cameraSys.controls.target,c=s.cameraSys.activeCamera();
      const p=${subject==='front'?'[0,1.4,1.7]':subject==='rear'?'[0,-4.8,1.5]':subject==='left'?'[-1.7,-1.0,1.8]':subject==='right'?'[1.7,-1,1.8]':'[3.0,1.7,3.6]'};
      const eye=${subject==='front'?'[-4,10,4.2]':subject==='rear'?'[5,-12,4]':subject==='left'?'[-10,-.5,2.4]':subject==='right'?'[10,-.5,2.4]':'[6,1.72,4.0]'};
      target.copy(root.localToWorld(new V(...p)));c.position.copy(root.localToWorld(new V(...eye)));c.lookAt(target);s.cameraSys.controls.update();__metro.getState().setGraphicsQuality('${quality}');
      return new Promise(r=>{s.onNextFrame=r;s.requestRender()})
    })()`);await shot('exit-'+subject+'-'+quality)
  }
  await page.send('Page.reload');await waitFor(page.evaluate,`window.__metro?.getState().station.cityStyle==='chongqing' && window.__scene?.ctx.lineMaps.ready('chongqing')`)
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('guangzhou')`),false);report.savedReload=true
  await exportCanvas('ui-logo',`document.querySelector('.cityStyleButton canvas')`)
  report.trainModels=[]
  for(const stock of ['A','B','C','D','L']){
    const count=await page.evaluate(`(()=>{
      const s=__scene;__metro.getState().setGraphicsQuality('high');if(window.cqReviewTrain){s.ctx.scene.remove(cqReviewTrain);cqReviewTrain.visible=false}
      const g=s.trains.createEntry('cq-review-${stock}','cq-review-${stock}',{x:0,y:0,z:0,cars:1,stock:'${stock}',doorsOpen:false,colour:'#dc8633',lineId:'4',cityStyle:'chongqing',dirSign:1,yaw:0}).group;
      window.cqReviewTrain=g;s.modules.moduleMeshes.visible=false;s.modules.batches.root.visible=false;s.setHideGround(true);s.ctx.scene.add(g);g.visible=true;g.updateMatrixWorld(true);
      const marks=[];g.traverse(m=>{if(m.name.endsWith('-chongqing-cab-mark'))marks.push(m)});const m=marks[0],V=m.position.constructor;m.geometry.computeBoundingBox();
      const p=m.localToWorld(m.geometry.boundingBox.getCenter(new V())),d=Math.sign(p.x-g.position.x)||1;window.cqCabProbe={point:p,direction:d};return marks.length
    })()`);assert.equal(count,2)
    for(const quality of ['high','low']){
      await page.evaluate(`(()=>{const s=__scene,{point:p,direction:d}=cqCabProbe,c=s.cameraSys.activeCamera(),t=s.cameraSys.controls.target;t.copy(p);t.z+=.50;c.position.copy(t);c.position.x+=d*4.8;c.lookAt(t);s.cameraSys.controls.update();__metro.getState().setGraphicsQuality('${quality}');return new Promise(r=>{s.onNextFrame=r;s.requestRender()})})()`)
      await shot('train-'+stock+'-'+quality)
    }
    report.trainModels.push({stock,marks:count})
  }
  for(const [line,colour] of [['0','#f2a900'],['4','#dc8633'],['6','#f67599']]){
    await page.evaluate(`(()=>{const g=__scene.trains.createEntry('badge-${line}','badge-${line}',{x:0,y:0,z:0,cars:1,stock:'B',doorsOpen:false,colour:'${colour}',lineId:'${line}',cityStyle:'chongqing',dirSign:1,yaw:0}).group;window.cqBadge=g.userData.chongqingTrainMark.map.image})()`)
    await exportCanvas('badge-'+line,'cqBadge')
  }
  assert.deepEqual(await page.evaluate('cqErrors'),[])
  report.complete=true;writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await page?.close();server.close()}
