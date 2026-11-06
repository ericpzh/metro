// Open the exported file through the production file input, then verify native
// drag gestures and lift stacking in an isolated browser copy of that save.
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {serveDir,withPage,waitFor} from '../browser-harness.mjs'
import {parse} from '../../game/src/persistence/save.ts'
import {removeLiftExtension} from '../../game/src/build/model.ts'
import {prepareInterior,interiorPlacements,placementFocus,dragPlacement,extendLiftWithPointer} from './interior.mjs'
import {connectRecorder} from './record.mjs'
import {screenshot} from './capture.mjs'
const output=resolve('.preview/demo-video/zh-studio-2k-v5'),file=resolve(process.argv[2]??'video/demo-station.metro.json')
const parsed=parse(readFileSync(file,'utf8'));if(!parsed.ok)throw Error(parsed.error)
const server=await serveDir(resolve('game/dist'),0);let page,recorder
try{
 const port=19182;page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(output,'save-check-browser'),debugPort:port,windowSize:'2560,1440',softwareGpu:false})
 await page.send('Emulation.setDeviceMetricsOverride',{width:2560,height:1440,deviceScaleFactor:1,mobile:false})
 await waitFor(page.evaluate,'!!window.__metro&&!!window.__scene',{what:'production game'})
 const {root}=await page.send('DOM.getDocument'),{nodeId}=await page.send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'})
 if(!nodeId)throw Error('Game save-file input missing')
 await page.send('DOM.setFileInputFiles',{nodeId,files:[file]})
 await waitFor(page.evaluate,`__metro.getState().station.name===${JSON.stringify(parsed.state.name)}&&__scene.ctx.stationData?.modules.length===${parsed.state.modules.length}`,{what:'actual file import'})
 const loaded=await page.evaluate('({name:__metro.getState().station.name,cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length})')
 await prepareInterior(page,{kind:'placement'},'zh');await page.evaluate('void(window.__videoScene=__scene);__videoInteriorLook.set(18,-1,2.5);__videoInteriorFov=48;__videoInteriorPose(1)')
 recorder=await connectRecorder(port);await screenshot(page,resolve(output,'save-preview.png'),recorder,{width:2560,height:1440})
 let state=parsed.state
 const lift=state.modules.find(m=>m.type==='lift');state=removeLiftExtension(state,lift.id,'top')
 const runs=interiorPlacements.map((item,index)=>({item,index})).filter(p=>p.item.cells)
 const prefixes=runs.map(p=>`video-placed-${p.index}-`);state={...state,modules:state.modules.filter(m=>!prefixes.some(p=>m.id.startsWith(p)))}
 await page.evaluate(`__metro.getState().commit(${JSON.stringify(state)})`)
 const gestures=[]
 for(const {item,index}of runs){
  const f=placementFocus(item);await page.evaluate(`(()=>{__videoInteriorFocus=${JSON.stringify(f)};__videoInteriorLook.set(...__videoInteriorFocus.target);__videoInteriorFov=__videoInteriorFocus.fov;__videoInteriorPose(.65)})()`)
  const result=await dragPlacement(page,item,index,2);gestures.push({palette:item.palette,cells:result.cells.length,gesture:result.gesture})
 }
 const f={target:[24,3,6],fov:30};await page.evaluate(`(()=>{__videoInteriorFocus=${JSON.stringify(f)};__videoInteriorLook.set(...__videoInteriorFocus.target);__videoInteriorFov=30;__videoInteriorPose(.5)})()`)
 const grown=await extendLiftWithPointer(page)
 const report={file,loaded,gestures,lift:{id:grown.moduleId,from:grown.beforeTop,to:grown.afterTop,rises:grown.rises,gesture:grown.gesture}}
 writeFileSync(resolve(output,'save-browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{recorder?.close();if(page)await page.close();await new Promise(r=>server.close(r))}
