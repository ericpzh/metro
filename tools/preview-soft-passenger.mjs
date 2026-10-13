// Local review server and screenshots of the actual exported prototype GLB.
import {serveDir,withPage,waitFor} from './browser-harness.mjs'
import {resolve} from 'node:path'
import {mkdirSync,writeFileSync} from 'node:fs'
const repo=resolve(import.meta.dirname,'..')
const server=await serveDir(repo,4267)
const url='http://127.0.0.1:4267/prototypes/soft-passenger/index.html'
console.log(`Preview: ${url}`)
const session=await withPage({url,profile:resolve(repo,`.preview/.chrome-soft-passenger-${process.pid}`),debugPort:9389,windowSize:'1200,1000'})
try{
 await waitFor(session.evaluate,'window.__passengerReady===true',{what:'prototype GLB'})
 const out=resolve(repo,'prototypes/soft-passenger/views');mkdirSync(out,{recursive:true})
 for(const view of ['front','three','side','back']){
  await session.evaluate(`window.__passengerPreview.setPose('idle');window.__passengerPreview.setView('${view}');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  const {data}=await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  writeFileSync(resolve(out,`${view}.png`),Buffer.from(data,'base64'))
 }
 const validation=await session.evaluate(`(()=>{const {model}=window.__passengerPreview;let triangles=0,meshes=0,bad=0;model.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;if(!n.material.isMeshBasicMaterial)bad++;for(const attr of Object.values(n.geometry.attributes))if(!Array.from(attr.array).every(Number.isFinite))throw Error('Non-finite geometry')}});return{meshes,triangles,unlit:bad===0,faceless:model.getObjectByName('BlankHead')!==undefined&&!model.getObjectByName('Eyes')}})()`)
 await session.evaluate(`window.__passengerPreview.setView('three');window.__passengerPreview.setPose('walk');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
 const pose1=await session.evaluate(`window.__passengerPreview.model.getObjectByName('ThighL').quaternion.toArray()`)
 await session.evaluate(`window.__passengerPreview.mixer.update(.3);true`)
 const pose2=await session.evaluate(`window.__passengerPreview.model.getObjectByName('ThighL').quaternion.toArray()`)
 if(JSON.stringify(pose1)===JSON.stringify(pose2))throw Error('Walk clip did not animate the exported rig')
 const {data}=await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
 writeFileSync(resolve(out,'walk.png'),Buffer.from(data,'base64'))
 console.log(JSON.stringify({...validation,walk:true,screenshots:out}))
}finally{await session.close()}
if(!process.argv.includes('--serve'))server.close()
