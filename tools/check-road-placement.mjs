import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'

// Drive the actual viewport owner dispatch and actual ghost cache. Direct RoadTool
// calls cannot detect a release accidentally falling through to the block brush.
const output=resolve('.preview/roads')
mkdirSync(output,{recursive:true})
const server=await serveDir(resolve('game/dist'),0)
const reports=[]
try {
  for(const language of ['zh-CN','en']) {
    const page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,
      profile:resolve(`.preview/roads/chrome-input-${language}-${process.pid}`),debugPort:language==='en'?9399:9398,windowSize:'1440,1000'})
    try {
      await waitFor(page.evaluate,'!!(window.__scene && window.__metro?.getState().metrics)',{what:'road input fixture'})
      if(language==='en') {
        await page.evaluate("document.querySelector('.tutorialLanguage button:nth-child(2)').click()")
        await waitFor(page.evaluate,"document.documentElement.lang === 'en'",{what:'English interface'})
      }
      const points=await page.evaluate(`(async()=>{
        document.querySelector('.tutorialActions .ghost')?.click();
        const store=window.__metro,s=store.getState();
        store.setState({tool:'module',moduleType:'road',moduleRot:0,roadDirection:'two-way',past:[],future:[]});
        s.commit({...s.station,cells:[],modules:[]});s.setActiveZ(0);
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const scene=window.__scene;scene.setPreset('plan');scene.setOrtho(true);scene.frame();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const camera=scene.cameraSys.activeCamera(),rect=scene.renderer.domElement.getBoundingClientRect();
        const project=(x,y)=>{const v=camera.position.clone().set(x,y,1.001).project(camera);return {x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2}};
        return {a:project(-2.5,-8.5),b:project(2.5,8.5),past:store.getState().past.length};
      })()`)
      const snapshot=()=>page.evaluate(`(()=>{const ghost=window.__scene.ghostSys,s=window.__metro.getState(),surface=ghost.previewGroup.children[0]?.children[0];return {key:ghost.previewKey,w:surface?.geometry.parameters.width,d:surface?.geometry.parameters.height,past:s.past.length,modules:s.station.modules,cells:s.station.cells,notice:s.notice,rot:s.moduleRot,direction:s.roadDirection}})()`)
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...points.a})
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...points.a,button:'left',buttons:1,clickCount:1})
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...points.b,button:'left',buttons:1})
      await waitFor(page.evaluate,'window.__scene.ghostSys.previewGroup.children[0]?.children[0]?.geometry.parameters.height > 10',{what:'held road rectangle'})
      const before=await snapshot()
      const key=async(key,code,windowsVirtualKeyCode)=>{
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode})
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode})
      }
      await key('r','KeyR',82)
      await waitFor(page.evaluate,`window.__scene.ghostSys.previewKey !== ${JSON.stringify(before.key)}`,{what:'R refresh without mouse movement'})
      const rotated=await snapshot()
      assert.equal(rotated.w,before.d);assert.equal(rotated.d,before.w)
      assert.equal(rotated.past,points.past)
      await key('Tab','Tab',9)
      await waitFor(page.evaluate,`window.__scene.ghostSys.previewKey !== ${JSON.stringify(rotated.key)}`,{what:'Tab refresh without mouse movement'})
      const toggled=await snapshot()
      assert.equal(toggled.direction,'one-way');assert.match(toggled.key,/one-way/)
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...points.b,button:'left',buttons:0,clickCount:1})
      const placed=await snapshot()
      assert.equal(placed.modules.length,1,'real viewport release places a road')
      assert.equal(placed.modules[0].type,'road')
      assert.equal(placed.modules[0].z,0)
      assert.equal(placed.modules[0].w,rotated.w);assert.equal(placed.modules[0].d,rotated.d)
      assert.deepEqual(placed.cells,[],'road does not try to add existing ground blocks')
      assert.equal(placed.past,points.past+1)
      const report={language,before,rotated,toggled,placed}
      reports.push(report)
      const shot=await page.send('Page.captureScreenshot',{format:'png'})
      writeFileSync(resolve(output,`placement-${language}.png`),Buffer.from(shot.data,'base64'))
      console.log(`${language}: flat-ground drag, R/Tab preview and release passed`)
    } finally {await page.close()}
  }
} finally {server.close()}
writeFileSync(resolve(output,'input-report.json'),JSON.stringify(reports,null,2))
