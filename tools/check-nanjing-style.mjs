// Production city selection, retained artwork, lazy supplied poster and High/Low review.
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {createModule,toState} from '../game/src/build/model.ts'
import {serialize} from '../game/src/persistence/save.ts'
import {defaultLine} from '../game/src/build/rail.ts'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'

const out=resolve('.preview/city-styles/nanjing-browser');mkdirSync(out,{recursive:true})
const modules=['exit','exit-virtual','guidepost','linemap-wall','linemap-stand','exit-doorway-2'].map((id,i)=>createModule(id,i*7,0,0,id))
modules[0].cfg.name='4口';modules[1].cfg.name='1A口';modules[2].cfg.exitId=modules[1].id;modules[5].cfg.name='2口'
const lines=['3','5'].map(id=>defaultLine(id,'up','third-rail',5,'nanjing'))
for(let i=0;i<2;i++){
  modules.push({id:'track-'+i,type:'track',x:i*30,y:-16,z:0,rot:0,w:21,d:3,cfg:{line:lines[i].id,dir:'up',power:'third-rail'}})
  lines[i].cars=1
}
const fixture=serialize(toState({name:'诚信大道',nameEn:'Chengxindadao',seed:1,cells:[],modules,lines}))
const server=await serveDir(resolve('game/dist'),0);let page
const report={build:JSON.parse(readFileSync('game/dist/editor-benchmark-build.json','utf8'))}
const shot=async name=>{const r=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,name+'.png'),Buffer.from(r.data,'base64'))}
const exportCanvas=async(name,expression)=>{const data=await page.evaluate(`${expression}.toDataURL('image/png')`);writeFileSync(resolve(out,name+'.png'),Buffer.from(data.split(',')[1],'base64'))}
const frame=()=>page.evaluate(`new Promise(r=>{__scene.onNextFrame=r;__scene.requestRender()})`)
try{
  // A unique profile makes lazy-decode checks repeatable even after a saved Wuhan run.
  page=await withPage({url:`http://127.0.0.1:${server.address().port}/en`,profile:resolve(out,'browser-'+process.pid),debugPort:9368,softwareGpu:false,windowSize:'1440,1000'})
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('metro-game.ui-theme','blueprint');localStorage.setItem('metro-game.tutorial.v1','{"step":0,"hidden":true}');window.njErrors=[];addEventListener('error',e=>njErrors.push(e.message));addEventListener('unhandledrejection',e=>njErrors.push(String(e.reason)));`})
  await page.send('Page.reload');await waitFor(page.evaluate,'!!window.__scene && !!window.__metro')
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('nanjing')`),false)
  await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(fixture)})`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='诚信大道'`);await frame()
  await page.evaluate(`document.querySelector('.cityStyleButton').click()`)
  assert.equal(await page.evaluate(`document.querySelectorAll('.cityStyleTile').length`),8);await shot('selector')
  await page.evaluate(`(()=>{
    window.njAudit={chunks:0,rays:0};const chunks=__scene.chunks,mesh=chunks.meshStation;chunks.meshStation=function(...a){njAudit.chunks++;return mesh.apply(this,a)};
    const ray=__scene.cameraSys.raycaster,intersect=ray.intersectObjects;ray.intersectObjects=function(...a){njAudit.rays++;return intersect.apply(this,a)};
    window.njTrains=__scene.trains.trainGroup.children.slice();window.njMark=__scene.modelMats.trainMark.map;window.njSide=__scene.modelMats.nanjingTrainMark.map;
    document.querySelector('.cityStyleTile[data-city=nanjing]').click()
  })()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='nanjing' && __scene.ctx.lineMaps.ready('nanjing')`);await frame()
  assert.equal(await page.evaluate(`__scene.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='nanjing').getObjectByName('nanjing-guide-white-pylon')===undefined`),true)
  Object.assign(report,await page.evaluate(`(()=>{
    const s=__scene,face=s.ctx.lineMaps.face(1.8,1.8,'nanjing');
    return {audit:njAudit,sameTrainRoots:njTrains.length>0&&njTrains.every(g=>s.trains.trainGroup.children.includes(g)),sameTrainTexture:s.modelMats.trainMark.map===njMark,
      colours:__metro.getState().station.lines.map(l=>l.colour),aspect:face.geometry.parameters.width/face.geometry.parameters.height,
      map:face.material.map.image.src}
  })()`))
  assert.deepEqual(report.audit,{chunks:0,rays:0});assert.equal(report.sameTrainRoots,true);assert.equal(report.sameTrainTexture,true)
  assert.deepEqual(report.colours,['#009a44','#f2da51']);assert.ok(Math.abs(report.aspect-1497/1618)<1e-8)
  await page.evaluate(`(()=>{const root=__scene.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='nanjing'),sign=root.getObjectByName('nanjing-entrance-sign');window.njRetained={root,sign,map:sign.material.map,version:sign.material.map.version}})()`)
  await exportCanvas('entrance-plate','njRetained.map.image');await exportCanvas('ui-logo',`document.querySelector('.cityStyleButton canvas')`);await exportCanvas('train-atlas','njMark.image');await exportCanvas('train-side-logo','njSide.image')
  await page.evaluate(`__metro.getState().renameStation('明故宫','Minggugong')`)
  await waitFor(page.evaluate,`njRetained.map.version>njRetained.version`)
  assert.equal(await page.evaluate(`__scene.modules.moduleMeshes.children.includes(njRetained.root)&&njRetained.sign.material.map===njRetained.map`),true)
  await page.evaluate(`__metro.getState().updateLine('5',{colour:'#123456'})`);await frame()
  assert.equal(await page.evaluate(`(()=>{const c=njRetained.map.image,a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i]===18&&a[i+1]===52&&a[i+2]===86)return true;return false})()`),true)
  await page.evaluate(`__metro.getState().undo();__metro.getState().undo();__metro.getState().undo()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='guangzhou'`)
  await page.evaluate(`__metro.getState().redo()`);await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='nanjing'`)
  report.undoRedo=true;report.retainedSignRepaint=true
  for(const theme of ['blueprint','site','studio']){
    await page.evaluate(`(()=>{for(let i=0;i<3&&document.documentElement.dataset.uiTheme!=='${theme}';i++)document.querySelector('.settingsActionGrid button:last-child').click()})()`);await frame()
    await page.evaluate(`document.querySelector('.cityStyleButton').click()`);await shot('selector-'+theme);await page.evaluate(`document.querySelector('#cityStylesMenu').hidePopover()`)
  }
  for(const subject of ['front','side','rear','guide','map'])for(const quality of ['high','low']){
    await page.evaluate(`(()=>{
      const s=__scene,root=s.modules.moduleMeshes.children.find(g=>g.userData.${subject==='guide'?"moduleId==='guidepost'":subject==='map'?"moduleId==='linemap-stand'":"exitCityStyle==='nanjing'"}),V=root.position.constructor;
      root.updateMatrixWorld(true);const target=s.cameraSys.controls.target,c=s.cameraSys.activeCamera();
      const p=${subject==='front'?'[0,1,1.8]':subject==='rear'?'[0,-4.5,1.5]':subject==='side'?'[1.5,-1.5,1.9]':subject==='guide'?'[0,0,2.4]':'[0,0,1.2]'};
      const eye=${subject==='front'?'[-5,11,5.5]':subject==='rear'?'[5,-12,4.5]':subject==='side'?'[11,-1,4.5]':subject==='guide'?'[1.3,-4.2,3.1]':'[0,-4.8,1.8]'};
      target.copy(root.localToWorld(new V(...p)));c.position.copy(root.localToWorld(new V(...eye)));c.lookAt(target);s.cameraSys.controls.update();__metro.getState().setGraphicsQuality('${quality}');
    })()`);await frame();await shot(subject+'-'+quality)
  }
  await page.send('Page.reload');await waitFor(page.evaluate,`window.__metro?.getState().station.cityStyle==='nanjing' && window.__scene?.ctx.lineMaps.ready('nanjing')`)
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('guangzhou')`),false);report.savedReload=true
  report.trainModels=[]
  for(const stock of (process.env.NANJING_STOCKS??'A,B,C,D,L').split(',')){
    const count=await page.evaluate(`(()=>{
      const s=__scene;__metro.getState().setGraphicsQuality('high');if(window.njReviewTrain){s.ctx.scene.remove(njReviewTrain);njReviewTrain.visible=false}
      const g=s.trains.createEntry('nj-review-${stock}','nj-review-${stock}',{x:0,y:0,z:0,cars:2,stock:'${stock}',doorsOpen:false,colour:'#009a44',lineId:'3',cityStyle:'nanjing',dirSign:1,yaw:0}).group;
      s.trains.trainSlots.delete('nj-review-${stock}'); // Keep review models outside live fleet reconciliation.
      window.njReviewTrain=g;s.modules.moduleMeshes.visible=false;s.modules.batches.root.visible=false;s.setHideGround(true);s.ctx.scene.add(g);g.visible=true;g.updateMatrixWorld(true);
      const points=[],boxes=new Map(),V=g.position.constructor;
      g.traverse(m=>{if(!m.isMesh||m.material!==s.modelMats.nanjingTrainMark)return;
        const geo=m.geometry,p=geo.attributes.position;geo.computeBoundingBox();const B=geo.boundingBox.constructor;
        for(let i=0;i<p.count;i++){const v=m.localToWorld(new V().fromBufferAttribute(p,i)),key=Math.sign(v.x)+'/'+Math.sign(v.y);if(!boxes.has(key))boxes.set(key,new B());boxes.get(key).expandByPoint(v)}
      });for(const b of boxes.values())points.push(b.getCenter(new V()));points.sort((a,b)=>a.x-b.x||a.y-b.y);window.njPoints=points;return points.length
    })()`);assert.equal(count,4)
    for(const end of [0,2])for(const side of [0,1])for(const quality of ['high','low']){
      await page.evaluate(`(()=>{const s=__scene,p=njPoints[${end+side}],d=Math.sign(p.y)||1,c=s.cameraSys.activeCamera(),t=s.cameraSys.controls.target;t.copy(p);c.position.copy(p);c.position.y+=d*4.2;c.position.z+=.15;c.lookAt(t);s.cameraSys.controls.update();__metro.getState().setGraphicsQuality('${quality}')})()`);await frame();await shot('train-'+stock+'-'+end+'-'+side+'-'+quality)
    }
    report.trainModels.push({stock,sideMarks:count,points:await page.evaluate('njPoints.map(p=>p.toArray())')})
  }
  assert.deepEqual(await page.evaluate('njErrors'),[])
  report.complete=true;writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await page?.close();server.close()}
