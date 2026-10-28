import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/human-candidates');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4285);let page;const results=[];
try{
 page=await withPage({url:'http://127.0.0.1:4285/candidates.html',profile:resolve(`.preview/.chrome-candidates-${process.pid}`),debugPort:9414,windowSize:'1440,1000'});
 const ready=()=>waitFor(page.evaluate,'window.__candidatePreview?.ready',{what:'candidate load',tries:120,every:250});
 const change=async(id,value)=>page.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'))})()`);
 await ready();const catalog=await page.evaluate('window.__candidatePreview.entries');
 assert.equal(catalog.filter(e=>e.age==='adult').length,11);assert.equal(catalog.filter(e=>e.age==='child').length,4);
 assert.equal(await page.evaluate('document.querySelector("#render-mode").value'),'animated');
 assert(await page.evaluate('!document.querySelector("#bag")&&!document.querySelector("#style")'),'superseded experiments removed');
 for(const entry of catalog){
  await change('candidate',entry.id);await ready();
  const hasStudies=entry.studies!==false;
  const sheets=hasStudies?await page.evaluate(`(async()=>{const report=[];for(const kind of ['original','minimalist']){const image=new Image();image.src='./human-candidates/studies/'+window.__candidatePreview.selected.id+'-'+kind+'.png';await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.filter=kind==='minimalist'?'grayscale(1)':'none';ctx.drawImage(image,0,0,256,256);const pixels=ctx.getImageData(0,0,256,256).data,tiles=Array(16).fill(0);let chroma=0;for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4;if(pixels[i+3]>128&&Math.min(...pixels.slice(i,i+3))<170)tiles[Math.floor(y/64)*4+Math.floor(x/64)]++;if(pixels[i+3]>128)chroma=Math.max(chroma,Math.max(...pixels.slice(i,i+3))-Math.min(...pixels.slice(i,i+3)))}report.push({kind,width:image.width,height:image.height,tiles,chroma})}return report})()`):[];
  for(const sheet of sheets){assert.equal(sheet.width,sheet.height);assert(sheet.width>=1024);assert(sheet.tiles.every(n=>n>80),`${entry.id} has visible figures in all 16 tiles`)}
  if(hasStudies)assert(sheets.find(s=>s.kind==='minimalist').chroma<=1,'rendered artwork is neutral grayscale');
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#study-clean")).filter'),'grayscale(1)');
  for(let angle=0;angle<16;angle++){await page.evaluate(`(()=>{const e=document.querySelector('#study-angle');e.value=${angle};e.dispatchEvent(new Event('input'))})()`);assert.equal(await page.evaluate('document.querySelector("#study-degrees").value'),`${angle*22.5}°`)}
  for(const mode of ['compare','source','minimalist']){
   await change('render-mode',mode);
   assert.equal(await page.evaluate('document.querySelector("#image-study").hidden'),mode==='source');
   if(mode==='source')assert.equal(await page.evaluate('(()=>{const p=window.__candidatePreview;p.renderer.render(p.scene,p.camera);return p.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length})()'),0);
  }
  await page.evaluate("document.querySelector('[data-view=front]').click()");
  const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,entry.id+'-grayscale.png'),Buffer.from(shot.data,'base64'));
  results.push({id:entry.id,sheets});
 }
 await page.evaluate('localStorage.removeItem("metro-human-picks");document.querySelector("#pick").click()');await page.send('Page.reload');await ready();assert.equal(await page.evaluate('document.querySelector("#pick").getAttribute("aria-pressed")'),'true');
 await change('language','zh');assert.equal(await page.evaluate('document.documentElement.lang'),'zh');
 await page.send('Emulation.setDeviceMetricsOverride',{width:650,height:850,deviceScaleFactor:1,mobile:false});assert(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'));
 writeFileSync(resolve(out,'report.json'),JSON.stringify(results,null,2));console.log('Passed: candidate preview, all preview modes, source shaders, shortlist reload, Chinese and compact layout.');
}finally{await page?.close();server.close()}
