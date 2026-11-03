// Production Chengdu selection, retained artwork, whole poster, save and High/Low review.
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {cpus} from 'node:os'
import {createModule,toState} from '../game/src/build/model.ts'
import {serialize} from '../game/src/persistence/save.ts'
import {defaultLine} from '../game/src/build/rail.ts'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'

const out=resolve('.preview/city-styles/chengdu-browser');mkdirSync(out,{recursive:true})
const modules=['exit','exit-virtual','guidepost','linemap-wall','linemap-stand','exit-doorway-2'].map((id,i)=>createModule(id,i*5,0,0,id))
modules[0].cfg.name='B口';modules[1].cfg.name='D1口';modules[2].cfg.exitId=modules[1].id
modules[5].cfg.name='B口'
const fixture=serialize(toState({name:'成都大学',nameEn:'Chengdu University Station',seed:1,cells:[],modules,lines:[{...defaultLine('5','up','third-rail'),colour:'#123456'},{...defaultLine('6','down','third-rail'),colour:'#74226e'}]}))
const server=await serveDir(resolve('game/dist'),0);let page
const report={build:JSON.parse(readFileSync('game/dist/editor-benchmark-build.json','utf8')),cpu:cpus()[0].model,fixture:'one covered exit, virtual exit, bound guidepost, both maps and doorway sign; two saved custom lines; paused; DOM click to render submission'}
try {
  page=await withPage({url:`http://127.0.0.1:${server.address().port}/en`,profile:resolve(out,'browser'),debugPort:9364,softwareGpu:false,windowSize:'1440,1000'})
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('metro-game.tutorial.v1','{"step":0,"hidden":true}');window.cdErrors=[];addEventListener('error',e=>cdErrors.push(e.message));addEventListener('unhandledrejection',e=>cdErrors.push(String(e.reason)));`})
  await page.send('Page.reload');await waitFor(page.evaluate,'!!window.__scene && !!window.__metro')
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('chengdu')`),false)
  await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(fixture)})`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='成都大学'`)
  await page.evaluate(`document.querySelector('.cityStyleButton').click()`)
  assert.equal(await page.evaluate(`document.querySelectorAll('.cityStyleTile').length`),5)
  await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,'selector.png'),Buffer.from(r.data,'base64')))
  await page.evaluate(`(()=>{
    window.cdAudit={chunks:0,rays:0};const chunks=__scene.chunks,mesh=chunks.meshStation;chunks.meshStation=function(...a){cdAudit.chunks++;return mesh.apply(this,a)};
    const ray=__scene.cameraSys.raycaster,intersect=ray.intersectObjects;ray.intersectObjects=function(...a){cdAudit.rays++;return intersect.apply(this,a)};
    window.cdMark=__scene.modelMats.trainMark.map;window.cdStarted=performance.now();__scene.onNextFrame=()=>window.cdMs=performance.now()-cdStarted;
    document.querySelector('.cityStyleTile[data-city=chengdu]').click()
  })()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='chengdu' && __scene.ctx.lineMaps.ready('chengdu') && window.cdMs>0`)
  Object.assign(report,await page.evaluate(`(()=>{
    const scene=__scene,groups=scene.modules.moduleMeshes.children,face=scene.ctx.lineMaps.face(1.8,1.8,'chengdu'),gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {ms:cdMs,audit:cdAudit,city:__metro.getState().station.cityStyle,colours:__metro.getState().station.lines.map(l=>l.colour),sameTrainTexture:scene.modelMats.trainMark.map===cdMark,
      exits:groups.filter(g=>g.userData.exitCityStyle==='chengdu').length,pylons:groups.filter(g=>g.userData.guideCityStyle==='chengdu').length,
      aspect:face.geometry.parameters.width/face.geometry.parameters.height,map:face.material.map.image.src,
      gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',canvas:{width:gl.canvas.width,height:gl.canvas.height,pixelRatio:scene.renderer.getPixelRatio()}}
  })()`))
  assert.equal(report.city,'chengdu');assert.equal(report.sameTrainTexture,true);assert.deepEqual(report.audit,{chunks:0,rays:0})
  assert.deepEqual(report.colours,['#123456','#74226e']);assert.equal(report.exits,1);assert.equal(report.pylons,2)
  assert.ok(report.map.includes('chengdu-map'));assert.ok(Math.abs(report.aspect-3000/3202)<1e-8)
  await page.evaluate(`(()=>{const root=__scene.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='chengdu'),sign=root.getObjectByName('chengdu-entrance-sign');window.cdRetained={root,sign,map:sign.material.map,version:sign.material.map.version}})()`)
  await page.evaluate(`__metro.getState().renameStation('孵化园','Incubation Park Station')`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='孵化园' && cdRetained.map.version>cdRetained.version`)
  assert.equal(await page.evaluate(`__scene.modules.moduleMeshes.children.includes(cdRetained.root) && cdRetained.sign.material.map===cdRetained.map`),true)
  for(const [name,expression] of [['entrance-plate','cdRetained.map.image'],['train-ui-logo','__scene.modelMats.trainMark.map.image']]) {
    const data=await page.evaluate(`${expression}.toDataURL('image/png')`);writeFileSync(resolve(out,`${name}.png`),Buffer.from(data.split(',')[1],'base64'))
  }
  await page.evaluate(`__metro.getState().undo()`);await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='成都大学'`)
  await page.evaluate(`__metro.getState().undo()`);await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='guangzhou'`)
  await page.evaluate(`__metro.getState().redo()`);await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='chengdu'`)
  await page.evaluate(`(()=>{const s=__scene,c=s.cameraSys.activeCamera(),target=s.cameraSys.controls.target;target.set(6,-1,2.5);c.position.set(-8,20,13);c.lookAt(target);s.cameraSys.controls.update();s.requestRender()})()`)
  for(const quality of ['high','low']) {
    await page.evaluate(`__metro.getState().setGraphicsQuality('${quality}');new Promise(r=>{__scene.onNextFrame=r;__scene.requestRender()})`)
    await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,`scene-${quality}.png`),Buffer.from(r.data,'base64')))
  }
  report.entrancePixels=await page.evaluate(`({width:cdRetained.map.image.width,height:cdRetained.map.image.height})`)
  assert.deepEqual(report.entrancePixels,{width:2048,height:384})
  for(const subject of ['exit','pillar','doorway'])for(const quality of ['high','low']) {
    const isPillar=subject==='pillar'
    await page.evaluate(`(()=>{
      const s=__scene,root=s.modules.moduleMeshes.children.find(g=>${subject==='exit'?"g.userData.exitCityStyle==='chengdu'":`g.userData.moduleId==='${isPillar?'guidepost':'exit-doorway-2'}'`});
      const part=${isPillar?'root':`root.getObjectByName('${subject==='exit'?'chengdu-entrance-sign':'exit-doorway-sign'}')`},V=part.position.constructor;
      ${isPillar?'':'part.geometry.computeBoundingBox();'}root.updateMatrixWorld(true);
      const target=s.cameraSys.controls.target,camera=s.cameraSys.activeCamera(),p=part.localToWorld(${isPillar?'new V(0,0,2)':'part.geometry.boundingBox.getCenter(new V())'});
      target.copy(p);${isPillar?'':'target.z-=.35;'}
      const n=${isPillar?'new V(.8,-1,0).normalize().transformDirection(root.matrixWorld)':'new V(0,0,1).transformDirection(part.matrixWorld)'};
      camera.position.copy(target).addScaledVector(n,${isPillar?'5':'8'});camera.position.z+=${isPillar?'.2':'.12'};
      camera.lookAt(target);s.cameraSys.controls.update();__metro.getState().setGraphicsQuality('${quality}');
      return new Promise(r=>{s.onNextFrame=r;s.requestRender()});
    })()`)
    await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,`${subject}-front-${quality}.png`),Buffer.from(r.data,'base64')))
  }
  for(const side of [-1,1])for(const quality of ['high','low']) {
    await page.evaluate(`(()=>{
      const s=__scene,root=s.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='chengdu'),header=root.getObjectByName('chengdu-entrance-sign'),V=root.position.constructor;
      const width=header.geometry.parameters.width+.3,x=header.position.x+${side}*(width/2-.15),target=s.cameraSys.controls.target,camera=s.cameraSys.activeCamera();
      target.copy(root.localToWorld(new V(x,.75,1.55)));camera.position.copy(root.localToWorld(new V(x+${side}*3.4,3.8,.65)));
      camera.lookAt(target);s.cameraSys.controls.update();__metro.getState().setGraphicsQuality('${quality}');
      return new Promise(r=>{s.onNextFrame=r;s.requestRender()});
    })()`)
    await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,`exit-joint-${side<0?'left':'right'}-${quality}.png`),Buffer.from(r.data,'base64')))
  }
  await page.send('Page.reload');await waitFor(page.evaluate,`window.__metro?.getState().station.cityStyle==='chengdu' && window.__scene?.ctx.lineMaps.ready('chengdu')`)
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('guangzhou')`),false)
  assert.deepEqual(await page.evaluate('cdErrors'),[])
  report.trainSlot=await page.evaluate(`(()=>{
    const canvas=__scene.modelMats.trainMark.map.image,g=canvas.getContext('2d'),data=g.getImageData(0,0,canvas.width,canvas.height).data,slots=[0,0,0];
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]>0)slots[Math.floor(x/128)]++;
    return {width:canvas.width,slots}
  })()`)
  assert.equal(report.trainSlot.width,384);assert.deepEqual(report.trainSlot.slots.slice(0,2),[0,0]);assert.ok(report.trainSlot.slots[2]>100)
  report.trainModels=[]
  for(const stock of ['A','B','C','D','L']) {
    const count=await page.evaluate(`(()=>{
      const s=__scene;__metro.getState().setGraphicsQuality('high');
      if(window.cdReviewTrain){s.ctx.scene.remove(cdReviewTrain);cdReviewTrain.visible=false}
      const g=s.trains.createEntry('chengdu-review-${stock}','chengdu-review-${stock}',{x:0,y:0,z:0,cars:1,stock:'${stock}',doorsOpen:false,colour:'#d8aa76',dirSign:1,yaw:0}).group;
      window.cdReviewTrain=g;s.modules.moduleMeshes.visible=false;s.modules.batches.root.visible=false;s.setHideGround(true);s.ctx.scene.add(g);g.visible=true;g.updateMatrixWorld(true);
      const marks=[];g.traverse(m=>{if(m.name.endsWith('-chengdu-cab-mark'))marks.push(m)});
      const m=marks[0],V=m.position.constructor;m.geometry.computeBoundingBox();const p=m.localToWorld(m.geometry.boundingBox.getCenter(new V())),d=Math.sign(p.x-g.position.x)||1;
      window.cdCabProbe={mark:m,point:p,direction:d};return marks.length
    })()`)
    assert.equal(count,2)
    for(const quality of ['high','low']) {
      await page.evaluate(`(()=>{
        const s=__scene,{point:p,direction:d}=cdCabProbe,c=s.cameraSys.activeCamera(),target=s.cameraSys.controls.target;
        target.copy(p);target.z+=.55;c.position.copy(target);c.position.x+=d*4.8;
        c.lookAt(target);s.cameraSys.controls.update();__metro.getState().setGraphicsQuality('${quality}');
        return new Promise(r=>{s.onNextFrame=r;s.requestRender()});
      })()`)
      await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,`train-${stock}-${quality}.png`),Buffer.from(r.data,'base64')))
    }
    report.trainModels.push({stock,marks:count})
  }
  report.savedReload=true;report.undoRedo=true;report.retainedSignRepaint=true
  writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
} finally {await page?.close();server.close()}
