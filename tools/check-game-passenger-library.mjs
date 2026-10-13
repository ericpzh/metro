import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {MODEL_LIBRARY} from '../model/src/characters/library.js';
const out=resolve('.preview/game-passenger-library');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('game/dist'),4281);
let page;
try {
 page=await withPage({url:'http://127.0.0.1:4281/?capture-passengers',profile:resolve(`.preview/.chrome-library-${process.pid}`),debugPort:9395,windowSize:'1400,900'});
 await waitFor(page.evaluate,'!!window.__passengerCardsReady',{what:'production passenger capture'});
 const report=await page.evaluate(`(async()=>{
  const errors=[],original=console.error;console.error=(...args)=>{errors.push(args.join(' '));original(...args)};
  window.__libraryImages=window.__passengerCards.capturePassengers();
  const coverage=new Set(),empty=[];
  for(const card of window.__libraryImages){
   const img=new Image();img.src=card.png;await img.decode();
   const canvas=document.createElement('canvas');canvas.width=card.width;canvas.height=card.height;
   const context=canvas.getContext('2d');context.drawImage(img,0,0);
   const pixels=context.getImageData(0,0,card.width,card.height).data;
   let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])visible++;
   if(visible<500)empty.push(card.id);coverage.add(card.variant);
  }
  console.error=original;return {images:window.__libraryImages.length,variants:[...coverage],empty,errors};
 })()`);
 assert.equal(report.images,11*3*4);assert.equal(report.variants.length,11);assert.deepEqual(report.empty,[]);assert.deepEqual(report.errors,[]);
 const names=MODEL_LIBRARY.map(m=>m.id);
 await page.evaluate(`(()=>{
  const images=window.__libraryImages.filter(c=>c.view==='iso'&&c.sample===0);
  document.body.innerHTML='';document.body.style.cssText='margin:0;background:#edf0ed;color:#333;font:14px sans-serif';
  const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(6, 208px);gap:8px;padding:16px';
  for(const card of images){const item=document.createElement('div');item.style.cssText='box-sizing:border-box;text-align:center;background:#e1e5e1;padding:8px';const img=document.createElement('img');img.src=card.png;item.append(img);const label=document.createElement('div');label.textContent=${JSON.stringify(names)}[card.variant];item.append(label);grid.append(item)}
  document.body.append(grid);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 })()`);
 const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'all-variants.png'),Buffer.from(shot.data,'base64'));
 await page.send('Page.navigate',{url:'http://127.0.0.1:4281/'});
 await waitFor(page.evaluate,'!!(window.__scene&&window.__metro?.getState().metrics)',{what:'live production station'});
 await page.evaluate('window.__metro.getState().setSpeed(16);window.__metro.getState().setPlaying(true)');
 await waitFor(page.evaluate,'window.__scene.crowd.agentCount>100',{what:'live library crowd',tries:120,every:250});
 const live=await page.evaluate(`(()=>{
  const r=window.__scene,c=r.crowd;window.__metro.getState().setPlaying(false);
  const outfits=c.agents.geometry.getAttribute('passengerOutfit');
  return {agents:c.agentCount,variants:[...new Set(Array.from(outfits.array).slice(0,c.agents.count))].sort((a,b)=>a-b),instanced:c.agents.isInstancedMesh,triangles:c.agents.geometry.index.count/3,shaderErrors:r.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length};
 })()`);
 assert.equal(live.instanced,true);assert.equal(live.shaderErrors,0);assert.equal(live.variants.length,11);
 writeFileSync(resolve(out,'report.json'),JSON.stringify({report,live},null,2));console.log({report,live});
} finally {if(page)await page.close();server.close()}
