import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {resolve} from 'node:path';import {mkdirSync,writeFileSync} from 'node:fs';
const repo=resolve(import.meta.dirname,'..'),server=await serveDir(repo,4268);
const url='http://127.0.0.1:4268/prototypes/trellis-passenger/index.html';console.log(`Preview: ${url}`);
if(!process.argv.includes('--serve-only')){
 const session=await withPage({url,profile:resolve(repo,`.preview/.chrome-trellis-${process.pid}`),debugPort:9390,windowSize:'1200,1000'});
 try{await waitFor(session.evaluate,'window.__trellisReady===true',{what:'generated GLB'});
 await session.evaluate('window.__trellisPreview.setWalking(false);window.__trellisPreview.walk.setTime(0)');const out=resolve(repo,'prototypes/trellis-passenger/views');mkdirSync(out,{recursive:true});
 for(const view of ['front','three','side','back','backThree','left']){await session.evaluate(`window.__trellisPreview.setView('${view}');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);const{data}=await session.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${view}.png`),Buffer.from(data,'base64'))}
 for(const back of [false,true]){
  await session.evaluate(`(()=>{const p=window.__trellisPreview;p.controls.enableDamping=false;p.controls.target.set(0,1.32,0);p.camera.position.set(0,3,${back?-3:3});p.camera.zoom=2;p.camera.updateProjectionMatrix();p.controls.update();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const {data}=await session.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`neck-${back?'back':'front'}.png`),Buffer.from(data,'base64'));
 }
 for(const phase of [0,.14,.28,.42,.56]){await session.evaluate(`window.__trellisPreview.setView('side');window.__trellisPreview.walk.setTime(${phase});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);const {data}=await session.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'walk-'+phase+'.png'),Buffer.from(data,'base64'))}
 const metrics=await session.evaluate(`(()=>{let meshes=0,triangles=0;window.__trellisPreview.model.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;for(const a of Object.values(n.geometry.attributes))if(!Array.from(a.array).every(Number.isFinite))throw Error('Nonfinite geometry')}});return{meshes,triangles}})()`);console.log(JSON.stringify(metrics));
 const length=await session.evaluate('window.__exportFlat()'),chunks=[];
 for(let offset=0;offset<length;offset+=196608)chunks.push(Buffer.from(await session.evaluate(`window.__flatChunk(${offset})`),'base64'));
 writeFileSync(resolve(repo,'prototypes/trellis-passenger/passenger-b-walk-forward.glb'),Buffer.concat(chunks));console.log(`Exported grey unlit GLB: ${length} bytes`);
 }finally{await session.close()}
}
if(!process.argv.includes('--serve')&&!process.argv.includes('--serve-only'))server.close();
