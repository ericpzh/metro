import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {mkdirSync,writeFileSync} from 'node:fs'
import {createModule,toState} from '../game/src/build/model.ts'
import {serialize} from '../game/src/persistence/save.ts'
import {defaultLine} from '../game/src/build/rail.ts'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'
const out=resolve('.preview/city-styles/shanghai-browser');mkdirSync(out,{recursive:true})
const line={...defaultLine('12','up','third-rail'),colour:'#123456'}
const modules=['exit','exit-virtual','guidepost','linemap-wall','linemap-stand'].map((id,i)=>createModule(id,i*5,0,0,id))
modules[0].cfg.name='13号口'
const fixture=serialize(toState({name:'南京西路',nameEn:'West Nanjing Road Station',seed:1,cells:[],modules,lines:[line]}))
const server=await serveDir(resolve('game/dist'),0);let page
try {
 page=await withPage({url:`http://127.0.0.1:${server.address().port}/en`,profile:resolve(out,'browser'),debugPort:9360,softwareGpu:true})
 await page.send('Page.enable')
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('metro-game.tutorial.v1','{"step":0,"hidden":true}');window.shErrors=[];addEventListener('error',e=>shErrors.push(e.message));addEventListener('unhandledrejection',e=>shErrors.push(String(e.reason)));`})
 await page.send('Page.reload')
 await waitFor(page.evaluate,'!!window.__scene && !!window.__metro')
 await page.evaluate(`__metro.getState().loadFromText(${JSON.stringify(fixture)})`)
 await waitFor(page.evaluate,`__scene.ctx.stationData?.name==='南京西路'`)
 await page.evaluate(`document.querySelector('.cityStyleButton').click();document.querySelector('.cityStyleTile[data-city=shanghai]').click()`)
 await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='shanghai' && __scene.ctx.lineMaps.ready('shanghai')`)
 const state=await page.evaluate(`(()=>{const scene=__scene,groups=scene.modules.moduleMeshes.children,face=scene.ctx.lineMaps.face(1.8,1.8,'shanghai');return{city:__metro.getState().station.cityStyle,colours:__metro.getState().station.lines.map(l=>l.colour),logo:scene.modelMats.trainMark.userData.cityLogo,exits:groups.filter(g=>g.userData.exitCityStyle==='shanghai').length,pylons:groups.filter(g=>g.userData.guideCityStyle==='shanghai').length,map:face.material.map.image.src,portrait:face.geometry.parameters.height>face.geometry.parameters.width,errors:shErrors}})()`)
 assert.equal(state.city,'shanghai');assert.equal(state.logo,'shanghai');assert.deepEqual(state.colours,['#123456']);assert.equal(state.exits,1);assert.equal(state.pylons,2);assert.ok(state.map.includes('shanghai-map'));assert.ok(state.portrait);assert.deepEqual(state.errors,[])
 await page.evaluate(`__metro.getState().undo()`);await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='guangzhou'`)
 await page.evaluate(`__metro.getState().redo()`);await waitFor(page.evaluate,`__scene.ctx.stationData?.cityStyle==='shanghai'`)
 await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(out,'scene.png'),Buffer.from(r.data,'base64')))
 await page.send('Page.reload');await waitFor(page.evaluate,`window.__metro?.getState().station.cityStyle==='shanghai' && !!window.__scene`)
 writeFileSync(resolve(out,'report.json'),JSON.stringify({...state,undoRedo:true,reload:true},null,2));console.log(JSON.stringify(state))
}finally{await page?.close();server.close()}
