import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/human-candidates');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4285);let page;const results=[];
try{
 page=await withPage({url:'http://127.0.0.1:4285/candidates.html',profile:resolve(`.preview/.chrome-candidates-${process.pid}`),debugPort:9414,windowSize:'1440,1000'});
 const ready=()=>waitFor(page.evaluate,'window.__candidatePreview?.ready',{what:'candidate load',tries:120,every:250});
 const change=async(id,value)=>{await page.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'))})()`)};
 await ready();const catalog=await page.evaluate('window.__candidatePreview.entries');const entries=catalog.map(e=>e.id);
 assert.equal(catalog.filter(e=>e.age==='child').length,4,'two generated girls and two boys are available');
 assert.equal(catalog.filter(e=>e.age==='adult').length,10,'ten adult bases, not duplicate outfit entries');
 for(const id of entries){
  await change('candidate',id);await ready();
  for(const style of ['original','grey']){
   await change('style',style);
   const result=await page.evaluate(`(()=>{const p=window.__candidatePreview;p.renderer.render(p.scene,p.camera);let meshes=0,vertices=0,bones=0;p.root.traverse(n=>{if(n.isBone)bones++;if(n.isMesh){meshes++;vertices+=n.geometry.attributes.position.count}});return {id:p.selected.id,meshes,vertices,bones,age:p.selected.age,scale:p.root.scale.x,clips:p.clips.map(c=>c.name),errors:p.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length,status:document.querySelector('#status').textContent}})()`);
   assert(result.vertices>100);assert.equal(result.errors,0);assert.equal(result.status,'');
   assert(result.bones>10,'source rig retained for every candidate');
   const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${id}-${style}.png`),Buffer.from(shot.data,'base64'));results.push({...result,style});
  }
  const count=await page.evaluate('window.__candidatePreview.clips.length');
  for(let i=0;i<count;i++){
   await change('animation',String(i));
   const pose=async value=>page.evaluate(`(()=>{const e=document.querySelector('#timeline');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input'));const values=[];window.__candidatePreview.root.traverse(n=>{if(n.isBone)values.push(...n.quaternion.toArray(),...n.position.toArray())});return values})()`);
   const a=await pose(.1),b=await pose(.6);assert(a.some((v,j)=>Math.abs(v-b[j])>1e-5),`${id} clip ${i} actually animates bones`);
   assert.equal(await page.evaluate('document.querySelector("#status").textContent'),'');
  }
 }
 await change('candidate','rocketbox-Female_Adult_11');await ready();
 const chroma=()=>page.evaluate(`(()=>{const p=window.__candidatePreview;p.renderer.render(p.scene,p.camera);const gl=p.renderer.getContext(),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let chroma=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>128)chroma+=Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2]);return chroma})()`);
 await change('style','original');const originalChroma=await chroma();
 await change('style','grey');const greyChroma=await chroma();
 assert(originalChroma>greyChroma*3,'grey shader desaturates actual rendered pixels');
 assert(await page.evaluate(`(()=>{let valid=true;window.__candidatePreview.root.traverse(n=>{if(!n.isMesh)return;const originals=n.userData.originalMaterials,greys=n.userData.greyMaterials;valid&&=!!n.geometry.attributes.normal&&greys.every((m,i)=>!m.flatShading&&m.map===originals[i].map&&m.normalMap===originals[i].normalMap&&m.alphaMap===originals[i].alphaMap&&m.transparent===originals[i].transparent)});return valid})()`),'grey preserves source smooth normals, surface maps and transparency');
 await change('candidate','rocketbox-Female_Adult_11');await ready();
 await page.evaluate('localStorage.removeItem("metro-human-picks");document.querySelector("#pick").click()');
 await page.send('Page.reload');await ready();assert.equal(await page.evaluate('document.querySelector("#pick").getAttribute("aria-pressed")'),'true');
 await change('language','zh');assert.equal(await page.evaluate('document.documentElement.lang'),'zh');
 await page.send('Emulation.setDeviceMetricsOverride',{width:650,height:850,deviceScaleFactor:1,mobile:false});
 assert(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'compact layout fits');
 writeFileSync(resolve(out,'report.json'),JSON.stringify(results,null,2));console.log('Candidate gallery passed: all assets/styles, clips, shortlist reload, Chinese and compact layout.');
}finally{await page?.close();server.close()}
