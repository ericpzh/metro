import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'
const output=resolve('.preview/perf/ceiling-wall-faces');mkdirSync(output,{recursive:true})
const demo=JSON.parse(readFileSync('game/src/data/tanwei-station.json','utf8'))
const server=await serveDir(resolve('game/dist'),0);let page
try {
 page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(output,`chrome-${process.pid}`),debugPort:15000+process.pid%20000})
 await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics')
 await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
 await page.evaluate(`__metro.getState().commit(${JSON.stringify(demo)});__metro.setState({activeZ:-5,playing:false,autoCeiling:true,ghostOtherLevels:false})`)
 await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 const result=await page.evaluate(`(()=>{
 const scene=__scene,meshes=scene.chunks.chunkMeshes;
 const face=(y,ny)=>meshes.some(m=>m.visible&&!m.userData.suspendedCeiling&&(()=>{const p=m.geometry.attributes.position,n=m.geometry.attributes.normal;for(let i=0;i<p.count;i++)if(p.getX(i)>=16&&p.getX(i)<=17&&p.getY(i)===y&&p.getZ(i)>=-1&&p.getZ(i)<=0&&n.getY(i)===ny)return true;return false})());
 const faces={south:face(6,-1),north:face(7,1)},geometry=meshes.map(m=>m.geometry),times=[];
 for(let i=0;i<6;i++){const t=performance.now();scene.setAutoCeiling(i%2===0?false:true);times.push(performance.now()-t)}
 scene.ctx.scene.updateMatrixWorld(true);
 const ray=new scene.cameraSys.raycaster.constructor(),v=scene.cameraSys.camera.position.clone();
 ray.set(v.clone().set(18.5,12.5,-.5),v.clone().set(0,0,-1));
 const ledgeHit=ray.intersectObjects(meshes.filter(m=>m.visible&&m.userData.levelZ===-5&&!m.userData.suspendedCeiling))[0];
 ray.set(v.clone().set(18.5,12.1,-.25),v.clone().set(0,.4,-.75).normalize());
 const obliqueHit=ray.intersectObjects(meshes.filter(m=>m.visible&&m.userData.levelZ===-5&&!m.userData.suspendedCeiling))[0];
 return {faces,ledgeZ:ledgeHit?.point.z,obliqueZ:obliqueHit?.point.z,toggleMs:times,geometryRetained:meshes.every((m,i)=>m.geometry===geometry[i]),ceilingsHidden:meshes.filter(m=>m.userData.suspendedCeiling).every(m=>!m.visible)}
 })()`)
 assert.deepEqual(result.faces,{south:true,north:true});assert.ok(result.geometryRetained);assert.ok(result.ceilingsHidden)
 assert.equal(result.ledgeZ,-1);assert.ok(Math.abs(result.obliqueZ+1)<1e-6)
 await page.evaluate(`(()=>{const s=__scene,cs=s.cameraSys;s.setLevel(-5,false);s.setOrtho(false);cs.controls.enableDamping=false;cs.camera.position.set(18,-6,32);cs.controls.target.set(18,14,-3);cs.controls.update();cs.camera.updateMatrixWorld(true);s.requestRender()})()`)
 await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 const screenshot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(output,'tanwei-south.png'),Buffer.from(screenshot.data,'base64'))
 writeFileSync(resolve(output,'browser.json'),JSON.stringify(result,null,2));console.log(result)
}finally{await page?.close();server.close()}
