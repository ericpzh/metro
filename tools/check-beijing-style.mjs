// Production checks for Beijing's distinct station/cab marks, synchronized signs,
// selected-city poster loading and saved identity. Pixels are reviewed separately.
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {mkdirSync,writeFileSync} from 'node:fs'
import {createModule,toState} from '../game/src/build/model.ts'
import {serialize} from '../game/src/persistence/save.ts'
import {defaultLine} from '../game/src/build/rail.ts'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'

const out=resolve('.preview/city-styles/beijing-browser');mkdirSync(out,{recursive:true})
const modules=['exit','exit-virtual','guidepost','linemap-wall','linemap-stand'].map((id,i)=>createModule(id,i*5,0,0,id))
modules[1].cfg.name='C口';modules[2].cfg.exitId=modules[1].id
const fixture=serialize(toState({name:'北宫门',nameEn:'BEIGONGMEN Station',seed:1,cells:[],modules,lines:[{...defaultLine('4','up','third-rail'),colour:'#123456'}]}))
const server=await serveDir(resolve('game/dist'),0);let page
try {
  page=await withPage({url:`http://127.0.0.1:${server.address().port}/en`,profile:resolve(out,'browser'),debugPort:9363,softwareGpu:true})
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('metro-game.tutorial.v1','{"step":0,"hidden":true}');window.bjErrors=[];addEventListener('error',e=>bjErrors.push(e.message));addEventListener('unhandledrejection',e=>bjErrors.push(String(e.reason)));`})
  await page.send('Page.reload')
  await waitFor(page.evaluate,'!!window.__scene && !!window.__metro')
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('beijing')`),false,'opening Guangzhou must not decode the Beijing poster')
  await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(fixture)})`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='北宫门'`)
  await page.evaluate(`document.querySelector('.cityStyleButton').click()`)
  assert.equal(await page.evaluate(`document.querySelectorAll('.cityStyleTile').length`),6)
  await page.evaluate(`document.querySelector('.cityStyleTile[data-city=beijing]').click()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='beijing' && __scene.ctx.lineMaps.ready('beijing')`)
  const state=await page.evaluate(`(()=>{
    const scene=__scene,groups=scene.modules.moduleMeshes.children,face=scene.ctx.lineMaps.face(1.8,1.8,'beijing');
    return {city:__metro.getState().station.cityStyle,colours:__metro.getState().station.lines.map(l=>l.colour),
      stationLogo:scene.modelMats.trainMark.userData.cityLogo,trainMark:scene.modelMats.trainMark.userData.cityTrainMark,
      exits:groups.filter(g=>g.userData.exitCityStyle==='beijing').length,pylons:groups.filter(g=>g.userData.guideCityStyle==='beijing').length,
      map:face.material.map.image.src,mapAspect:face.geometry.parameters.width/face.geometry.parameters.height,
      otherCityMapsDecoded:['shenzhen','shanghai'].filter(c=>scene.ctx.lineMaps.ready(c)),errors:bjErrors}
  })()`)
  assert.equal(state.city,'beijing');assert.equal(state.trainMark,'beijing-calligraphy')
  assert.equal(state.stationLogo,'beijing');assert.deepEqual(state.colours,['#123456'])
  assert.equal(state.exits,1);assert.equal(state.pylons,2);assert.ok(state.map.includes('beijing-map'))
  assert.ok(Math.abs(state.mapAspect-6564/6537)<1e-6);assert.deepEqual(state.otherCityMapsDecoded,[])
  assert.deepEqual(state.errors,[])
  // Capture and retain references before editing the live names/colours.
  const shared=await page.evaluate(`(()=>{
    const root=__scene.modules.moduleMeshes.children.find(g=>g.userData.exitCityStyle==='beijing'),signs=[];
    root.traverse(o=>{if(['beijing-entrance-sign','beijing-rooftop-front-sign','beijing-rooftop-side-sign'].includes(o.name))signs.push(o)});
    window.bjRetained={root,signs,map:signs[0].material.map,version:signs[0].material.map.version};
    return {count:signs.length,shared:signs.every(s=>s.material===signs[0].material)}
  })()`)
  assert.deepEqual(shared,{count:3,shared:true})
  await page.evaluate(`__metro.getState().renameStation('双井','SHUANGJING Station')`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='双井' && bjRetained.map.version>bjRetained.version`)
  assert.equal(await page.evaluate(`__scene.modules.moduleMeshes.children.includes(bjRetained.root) && bjRetained.signs.every(s=>s.material.map===bjRetained.map)`),true)
  for(const [name,expression] of [['entrance-plate',`bjRetained.map.image`],['train-mark',`__scene.modelMats.trainMark.map.image`]]) {
    const data=await page.evaluate(`${expression}.toDataURL('image/png')`)
    writeFileSync(resolve(out,`${name}.png`),Buffer.from(data.split(',')[1],'base64'))
  }
  await page.evaluate(`__metro.getState().undo()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='北宫门'`)
  await page.evaluate(`__metro.getState().undo()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='guangzhou'`)
  await page.evaluate(`__metro.getState().redo()`)
  await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='beijing'`)
  await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,'scene.png'),Buffer.from(r.data,'base64')))
  await page.evaluate(`(()=>{const s=__scene,c=s.cameraSys.activeCamera(),target=s.cameraSys.controls.target;target.set(4,-1,2.5);c.position.set(-10,18,12);c.lookAt(target);s.cameraSys.controls.update();s.requestRender()})()`)
  for(const quality of ['high','low']) {
    await page.evaluate(`__metro.getState().setGraphicsQuality('${quality}');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
    await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,`scene-${quality}.png`),Buffer.from(r.data,'base64')))
  }
  await page.send('Page.reload')
  await waitFor(page.evaluate,`window.__metro?.getState().station.cityStyle==='beijing' && window.__scene?.ctx.lineMaps.ready('beijing')`)
  assert.equal(await page.evaluate(`__scene.ctx.lineMaps.ready('guangzhou')`),false,'loading a saved Beijing station must not decode Guangzhou')
  assert.deepEqual(await page.evaluate('bjErrors'),[])
  await page.evaluate(`(()=>{
    const s=__scene,entry=s.trains.createEntry('beijing-review','beijing-review',{x:0,y:0,z:0,cars:1,stock:'B',doorsOpen:false,colour:'#a4343a',dirSign:1,yaw:0}),g=entry.group;
    __metro.getState().setGraphicsQuality('high');s.modules.moduleMeshes.visible=false;s.modules.batches.root.visible=false;
    s.ctx.scene.add(g);g.visible=true;g.updateMatrixWorld(true);
    const marks=[];g.traverse(m=>{if(m.name.endsWith('-beijing-cab-mark'))marks.push(m)});
    const m=marks[0],V=g.position.constructor;m.geometry.computeBoundingBox();
    const p=m.localToWorld(m.geometry.boundingBox.getCenter(new V())),d=Math.sign(p.x-g.position.x)||1;
    window.bjCabProbe={mark:m,point:p,direction:d};
    const camera=s.cameraSys.activeCamera(),target=s.cameraSys.controls.target;
    target.copy(p);target.z+=.6;camera.position.copy(target);camera.position.x+=d*4.3;
    camera.lookAt(target);s.cameraSys.controls.update();s.requestRender();
    return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  })()`)
  await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,'beijing-cab.png'),Buffer.from(r.data,'base64')))
  const decalPixels=[]
  for(const quality of ['high','low'])for(const angle of [-.25,0,.25]) {
    const pixels=[]
    for(const alphaTest of [0,.01]) {
      const roi=await page.evaluate(`(async()=>{
        const s=__scene,{mark,point:p,direction:d}=bjCabProbe,c=s.cameraSys.activeCamera(),target=s.cameraSys.controls.target,V=p.constructor;
        s.cameraSys.controls.minDistance=.5;
        __metro.getState().setGraphicsQuality('${quality}');
        s.modelMats.trainMark.alphaTest=${alphaTest};s.modelMats.trainMark.needsUpdate=true;
        target.copy(p);c.position.copy(p);c.position.x+=d*1.1;c.position.y+=${angle};c.lookAt(target);s.cameraSys.controls.update();s.requestRender();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const b=mark.geometry.boundingBox,rect=s.renderer.domElement.getBoundingClientRect(),points=[];
        for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]) {
          const v=mark.localToWorld(new V(x,y,z)).project(c);points.push([rect.left+(v.x+1)*rect.width/2,rect.top+(1-v.y)*rect.height/2]);
        }
        return {x:Math.floor(Math.min(...points.map(p=>p[0]))),y:Math.floor(Math.min(...points.map(p=>p[1]))),right:Math.ceil(Math.max(...points.map(p=>p[0]))),bottom:Math.ceil(Math.max(...points.map(p=>p[1])))};
      })()`)
      const capture=await page.send('Page.captureScreenshot',{format:'png'})
      writeFileSync(resolve(out,`decal-${quality}-${angle}-${alphaTest}.png`),Buffer.from(capture.data,'base64'))
      pixels.push(await page.evaluate(`(async()=>{
        const img=new Image();img.src=${JSON.stringify('data:image/png;base64,'+capture.data)};await img.decode();
        const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);
        const r=${JSON.stringify(roi)},data=g.getImageData(r.x,r.y,r.right-r.x,r.bottom-r.y).data;let white=0;
        for(let i=0;i<data.length;i+=4)if(data[i]>200&&data[i+1]>200&&data[i+2]>200)white++;return white;
      })()`))
    }
    assert.ok(pixels[1]>=pixels[0]-2,`${quality}/${angle}: blank decals must not cut out glyph pixels`)
    decalPixels.push({quality,angle,withoutDiscard:pixels[0],withDiscard:pixels[1]})
  }
  assert.ok(decalPixels.some(p=>p.withDiscard>p.withoutDiscard*1.05),'negative control must reproduce the transparent-decal occlusion')
  writeFileSync(resolve(out,'report.json'),JSON.stringify({...state,sharedSigns:shared,liveRepaintRetained:true,undoRedo:true,reload:true,decalPixels},null,2))
  console.log(JSON.stringify(state))
}finally{await page?.close();server.close()}
