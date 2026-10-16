import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'
const output=resolve('.preview/roads');mkdirSync(output,{recursive:true})
const server=await serveDir(resolve('game/dist'),0),reports=[]
try {
 for(const language of ['zh-CN','en']) {
  const page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(`${output}/node-${language}-${process.pid}`),debugPort:9450,softwareGpu:false,windowSize:'1440,1000'})
  try {
   await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics',{what:'road node builder'})
   if(language==='en') {await page.evaluate("document.querySelector('.tutorialLanguage button:nth-child(2)').click()");await waitFor(page.evaluate,"document.documentElement.lang==='en'",{what:'English UI'})}
   await page.evaluate(`(async()=>{
    document.querySelector('.tutorialActions .ghost')?.click();const store=window.__metro,s=store.getState();s.commit({...s.station,cells:[],modules:[]});store.setState({tool:'module',moduleType:'road',roadWidth:6,roadDirection:'two-way',moduleRot:0,past:[],future:[]});
    const scene=window.__scene;scene.setPreset('plan');scene.setOrtho(true);scene.frame();
    const cs=scene.cameraSys;cs.controls.target.set(10,3,1);cs.camera.position.set(10,3,201);cs.controls.update();const cam=cs.activeCamera();cam.zoom*=.65;cam.updateProjectionMatrix();
    window.__roadNodeErrors=[];addEventListener('error',e=>__roadNodeErrors.push(e.message));addEventListener('unhandledrejection',e=>__roadNodeErrors.push(String(e.reason)));
    window.__nodePicks=0;const pick=scene.pickModule;scene.pickModule=function(...args){__nodePicks++;return pick.apply(this,args)};
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   })()`)
   const point=async(x,y)=>page.evaluate(`(()=>{const scene=window.__scene,cam=scene.cameraSys.activeCamera(),rect=scene.renderer.domElement.getBoundingClientRect(),v=cam.position.clone().set(${x},${y},1.025).project(cam);return {x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2}})()`)
   const move=async(x,y,held=false)=>page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(x,y),...(held?{button:'left',buttons:1}:{})})
   const press=async(x,y)=>{await move(x,y);await page.evaluate('__nodePicks=0');await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...await point(x,y),button:'left',buttons:1,clickCount:1});assert.equal(await page.evaluate('__nodePicks'),1,'one pick per road press')}
   const release=async(x,y)=>{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...await point(x,y),button:'left',buttons:0,clickCount:1});await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')}
   const key=async(key,code,vk,modifiers=0)=>{await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,modifiers});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk,modifiers})}
   const snap=()=>page.evaluate(`(()=>{const s=window.__metro.getState(),g=window.__scene.ghostSys,roads=s.station.modules.filter(m=>m.type==='road'),degree={};for(const road of roads)for(const p of [road.cfg.from,road.cfg.to])if(p){const k=p.join(',');degree[k]=(degree[k]??0)+1}return {roads,degree,past:s.past.length,width:s.roadWidth,direction:s.roadDirection,preview:g.previewGroup.children[0]?.userData.roadArrows,handles:g.roadNodes?.count,handleVisible:g.roadNodes?.visible,notice:s.notice}})()`)
   await press(-12,0);await move(12,0,true)
   const preview=await snap();assert.equal(preview.roads.length,0);assert.equal(preview.past,0);assert.equal(preview.preview.length,2);assert.ok(preview.handleVisible)
   await key('Tab','Tab',9);await waitFor(page.evaluate,'window.__metro.getState().roadWidth===12',{what:'road width refresh'})
   assert.equal((await snap()).preview.length,4)
   await key('Tab','Tab',9,8);await waitFor(page.evaluate,"window.__metro.getState().roadDirection==='one-way'",{what:'road direction refresh'})
   const forward=await snap();assert.equal(new Set(forward.preview.map(a=>a.sign)).size,1)
   await key('r','KeyR',82);const reverse=await snap();assert.notEqual(reverse.preview[0].sign,forward.preview[0].sign)
   await key('r','KeyR',82);await key('Tab','Tab',9,8);for(let i=0;i<3;i++)await key('Tab','Tab',9)
   await release(12,0);const built=await snap();assert.equal(built.roads.length,1);assert.deepEqual(built.roads[0].cfg.from,[-12,0]);assert.deepEqual(built.roads[0].cfg.to,[12,0]);assert.equal(built.past,1);assert.ok(built.handleVisible,'end nodes remain visible after release')
   await press(12,0);await move(32,0,true);await release(32,0);const extended=await snap();assert.equal(extended.roads.length,2);assert.equal(extended.degree['12,0'],2)
   await press(12,0);await move(12,20,true);await release(12,20);const branched=await snap();assert.equal(branched.roads.length,3);assert.equal(branched.degree['12,0'],3)
   await press(0,0);await move(0,-16,true);await release(0,-16);const split=await snap();assert.equal(split.roads.length,5);assert.equal(split.degree['0,0'],3)
   await move(12,0)
   await page.evaluate(`(()=>{const c=window.__scene.cameraSys.activeCamera();c.zoom*=2;c.updateProjectionMatrix()})()`);
   const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(output,`node-network-${language}.png`),Buffer.from(shot.data,'base64'))
   await page.evaluate(`(()=>{const c=window.__scene.cameraSys.activeCamera();c.zoom/=2;c.updateProjectionMatrix()})()`);
   await key('b','KeyB',66);await press(22,0);await release(22,0);const deleted=await snap();assert.equal(deleted.roads.length,4);assert.equal(deleted.degree['12,0'],2);assert.equal(deleted.degree['32,0'],undefined)
   await press(12,14);await release(12,14);assert.equal((await snap()).degree['12,0'],1)
   await press(7,0);await release(7,0);const last=await snap();assert.equal(last.degree['12,0'],undefined);assert.equal(last.roads.length,2)
   await key('z','KeyZ',90,2);assert.equal((await snap()).degree['12,0'],1)
   await key('y','KeyY',89,2);assert.equal((await snap()).degree['12,0'],undefined)
   const errors=await page.evaluate('__roadNodeErrors');assert.deepEqual(errors,[])
   reports.push({language,preview,built,extended,branched,split,deleted,last,errors});console.log(`${language}: node drag, width/direction, extension, branching, split deletion and undo/redo passed`)
  } finally {await page.close()}
 }
} finally {server.close()}
writeFileSync(resolve(output,'node-input-report.json'),JSON.stringify(reports,null,2))
