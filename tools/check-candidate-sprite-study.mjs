import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/human-candidates/sprite-study');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4293);let page;
try{
 page=await withPage({url:'http://127.0.0.1:4293/candidates.html?mode=sprite&candidate=valid-Asian_F_3_Casual',profile:resolve('.preview/.chrome-sprite-study'),debugPort:9423,windowSize:'1440,1000'});
 await waitFor(page.evaluate,`window.__candidatePreview?.ready && window.__candidatePreview.spriteReady`,{tries:120,every:250});
 assert.equal(await page.evaluate(`document.querySelector('#sprite-quality')===null && document.querySelector('#sprite-timeline').max==='31'`),true,'only the 32-frame animation is exposed');
 for(const angle of [0,2,4,8]){
  const oldPhase=await page.evaluate(`window.__candidatePreview.spritePhase`);
  await page.evaluate(`(()=>{const e=document.querySelector('#sprite-angle');e.value='${angle}';e.dispatchEvent(new Event('change'))})()`);
  if(angle!==0)assert.equal(await page.evaluate(`window.__candidatePreview.spritePhase`),oldPhase,'switching views keeps the walk phase');
  const hashes=[];
  const count=32;
  for(let frame=0;frame<count;frame++){
  hashes.push(await page.evaluate(`(()=>{const slider=document.querySelector('#sprite-timeline');slider.value=${frame};slider.dispatchEvent(new Event('input'));const data=document.querySelector('#sprite-canvas').getContext('2d').getImageData(0,0,512,512).data;let hash=2166136261;for(let i=0;i<data.length;i+=17)hash=Math.imul(hash^data[i],16777619);return hash})()`));
   if([0,count/2,count-1].includes(frame)||([2,4].includes(angle)&&[1,24].includes(frame))){const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`angle-${angle}-frame-${frame}.png`),Buffer.from(shot.data,'base64'))}
  }
  assert.equal(new Set(hashes).size,count,`all frames must be visibly distinct for angle ${angle}`);
 }
 for(const elevation of ['low','high']){
  const phase=await page.evaluate(`window.__candidatePreview.spritePhase`);
  await page.evaluate(`(()=>{const e=document.querySelector('#sprite-elevation');e.value='${elevation}';e.dispatchEvent(new Event('change'))})()`);
  assert.equal(await page.evaluate(`window.__candidatePreview.spritePhase`),phase,'switching elevation keeps walk phase');
  assert.equal(await page.evaluate(`document.querySelector('#sprite-angle').value`),'2');
  const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`elevation-${elevation}.png`),Buffer.from(shot.data,'base64'));
 }
 const continuity=await page.evaluate(`(()=>{
  const angle=document.querySelector('#sprite-angle'),elevation=document.querySelector('#sprite-elevation');
  const slider=document.querySelector('#sprite-timeline'),source=document.querySelector('#sprite-canvas'),canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d');
  function sample(mode,count,view,pitch){window.__candidatePreview.setSpriteSource(mode==='original');const frames=[],feet=[];for(let i=0;i<count;i++){slider.value=i;slider.dispatchEvent(new Event('input'));ctx.clearRect(0,0,128,128);ctx.drawImage(source,0,0,128,128);frames.push(ctx.getImageData(40,30,48,55).data);const footData=ctx.getImageData(25,68,78,60).data,ys=[];for(let y=0;y<60;y++)for(let x=0;x<78;x++)if(footData[(y*78+x)*4+3]>220)ys.push(y);feet.push(ys[Math.floor(ys.length*.99)])}const diffs=[];for(let i=0;i<count;i++){const a=frames[i],b=frames[(i+1)%count];let sum=0;for(let j=0;j<a.length;j+=4){const aa=a[j+3]/255,ba=b[j+3]/255;sum+=Math.abs(aa-ba);for(let k=0;k<3;k++)sum+=Math.abs(a[j+k]*aa-b[j+k]*ba)/255}diffs.push(sum/a.length)}const centers=frames.map(a=>{let sx=0,sy=0,n=0;for(let y=5;y<41;y++)for(let x=12;x<44;x++){const j=(y*48+x)*4,v=(a[j]+a[j+1]+a[j+2])/3;if(a[j+3]>220&&v>115&&v<190){sx+=x;sy+=y;n++}}return [sx/n,sy/n]});const spread=k=>{const mean=centers.reduce((sum,c)=>sum+c[k],0)/count;return Math.sqrt(centers.reduce((sum,c)=>sum+(c[k]-mean)**2,0)/count)};const lengths=frames.map(a=>{const ys=[];for(let y=6;y<45;y++)for(let x=(pitch==='high'?18:view===4?19:18);x<(pitch==='high'?30:view===4?35:39);x++){const j=(y*48+x)*4,v=(a[j]+a[j+1]+a[j+2])/3;if(a[j+3]>225&&v>115&&v<190)ys.push(y)}return ys[Math.floor(ys.length*.95)]-ys[Math.floor(ys.length*.05)]});const hems=frames.map(a=>{let end=0;for(let y=6;y<45;y++){let n=0;for(let x=15;x<42;x++){const j=(y*48+x)*4,v=(a[j]+a[j+1]+a[j+2])/3;if(a[j+3]>225&&v>115&&v<190)n++}if(n>=6)end=y}return end});return {mean:diffs.reduce((a,b)=>a+b,0)/count,max:Math.max(...diffs),centerX:spread(0),centerY:spread(1),shirtRange:Math.max(...lengths)-Math.min(...lengths),hemRange:Math.max(...hems)-Math.min(...hems),footRange:Math.max(...feet)-Math.min(...feet),footMedian:[...feet].sort((a,b)=>a-b)[Math.floor(count/2)]}}
  return [[0,'normal'],[2,'normal'],[4,'normal'],[8,'normal'],[2,'low'],[2,'high']].map(([view,pitch])=>{angle.value=view;angle.dispatchEvent(new Event('change'));elevation.value=pitch;elevation.dispatchEvent(new Event('change'));return {view,pitch,original:sample('original',16,view,pitch),interpolated:sample('smooth',32,view,pitch)}});
 })()`);
 const torso=continuity.find(row=>row.view===2&&row.pitch==='normal');assert(torso.interpolated.shirtRange<torso.original.shirtRange*.7,JSON.stringify(torso));assert(torso.interpolated.footRange<torso.original.footRange*.6,JSON.stringify(torso));
 for(const row of continuity){assert(row.interpolated.mean<row.original.mean*.8,JSON.stringify(row));assert(row.interpolated.max<row.original.max*.85,JSON.stringify(row));assert(row.interpolated.centerX<row.original.centerX*.7,JSON.stringify(row));assert(row.interpolated.centerY<row.original.centerY*.7,JSON.stringify(row));assert(row.interpolated.footRange<=3,JSON.stringify(row))}
 const common=continuity.filter(row=>row.pitch!=='high').map(row=>row.interpolated.footMedian);assert(Math.max(...common)-Math.min(...common)<=1,'normal and low views share a projected ground reference');
 await page.evaluate(`(()=>{const e=document.querySelector('#candidate');e.value='mpfb-boy-01';e.dispatchEvent(new Event('change'))})()`);
 await waitFor(page.evaluate,`window.__candidatePreview?.ready && window.__candidatePreview.selected.id==='mpfb-boy-01'`,{tries:120,every:250});
 assert.equal(await page.evaluate(`document.querySelector('#sprite-canvas').hidden && document.querySelector('#sprite-controls').hidden`),true,'prototype must not display as another character');
 console.log('Four directions, two extra elevations, phase-preserving switching, source comparison and frame continuity passed.',JSON.stringify(continuity));
}finally{await page?.close();server.close()}
