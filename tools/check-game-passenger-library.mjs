import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor,loadExampleStation} from './browser-harness.mjs';
import {SOFT_MODEL_LIBRARY as MODEL_LIBRARY,softModelEligible as modelEligible} from '../model/src/soft-human/catalog.js';
import {passengerCaptureBatches} from './passenger-capture-plan.mjs';
const out=resolve('.preview/game-passenger-library');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('game/dist'),4281);
let page;
try {
 page=await withPage({url:'http://127.0.0.1:4281/?capture-passengers',profile:resolve(`.preview/.chrome-library-${process.pid}`),debugPort:9395,windowSize:'1400,900'});
 await waitFor(page.evaluate,'!!window.__passengerCardsReady',{what:'production passenger capture'});
 const report={images:0,childImages:0,childVariants:[],variants:[],empty:[],errors:[]};
 await page.evaluate('window.__libraryImages=[];window.__childImages=[]');
 for(const age of ['adult','child'])for(const cycleVariants of passengerCaptureBatches(MODEL_LIBRARY.map((_,i)=>i))){
  const batch=await page.evaluate(`(async()=>{
   const errors=[],original=console.error;console.error=(...args)=>{errors.push(args.join(' '));original(...args)};
   const images=window.__passengerCards.capturePassengers(${JSON.stringify({age,cycleVariants,reuseContext:true})});
   window.${age==='child'?'__childImages':'__libraryImages'}.push(...images);
   const coverage=new Set(),empty=[];
   for(const card of images){
    const img=new Image();img.src=card.png;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=card.width;canvas.height=card.height;
    const context=canvas.getContext('2d');context.drawImage(img,0,0);
    const pixels=context.getImageData(0,0,card.width,card.height).data;
    let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])visible++;
    const minimumPixels=500*(card.age==='child'?.52*.56:1);
    if(visible<minimumPixels)empty.push(card.id);coverage.add(card.variant);
   }
   console.error=original;return {images:images.length,variants:[...coverage],empty,errors};
  })()`);
  report[age==='child'?'childImages':'images']+=batch.images;
  report.variants.push(...batch.variants);if(age==='child')report.childVariants.push(...batch.variants);
  report.empty.push(...batch.empty);report.errors.push(...batch.errors);
 }
 report.variants=[...new Set(report.variants)];report.childVariants=[...new Set(report.childVariants)];
 // Photograph new clothes at the actual game opacity on both age groups.
 const clothingImage=await page.evaluate(`(async()=>{
  const models=${JSON.stringify(MODEL_LIBRARY)},canvas=document.createElement('canvas');canvas.width=1920;const ageHeight=Math.ceil(models.filter(m=>!m.bag).length/10)*290;canvas.height=ageHeight*2;
  const c=canvas.getContext('2d');c.fillStyle='#eeefed';c.fillRect(0,0,canvas.width,canvas.height);
  for(const [row,age] of ['adult','child'].entries()){
   const cards=window[age==='child'?'__childImages':'__libraryImages'].filter(card=>card.view==='iso'&&card.sample===1&&models[card.variant].bagStyle==='none');
   for(const [i,card] of cards.entries()){
    const image=new Image();image.src=card.png;await image.decode();const x=i%10*192,y=row*ageHeight+Math.floor(i/10)*290;
    c.drawImage(image,x,y);c.fillStyle='#444';c.font='11px sans-serif';c.fillText(age+' / '+models[card.variant].character+' / '+models[card.variant].outfit,x+4,y+272);
   }
  }
  return canvas.toDataURL('image/png');
 })()`);
 writeFileSync(resolve(out,'clothing-both-ages.png'),Buffer.from(clothingImage.split(',')[1],'base64'));
 await page.evaluate('window.__passengerCards.disposePassengerCapture()');
 assert.equal(report.images,MODEL_LIBRARY.filter(m=>modelEligible(m,'adult')).length*3*4);assert.equal(report.variants.length,MODEL_LIBRARY.length);assert.deepEqual(report.empty,[]);assert.deepEqual(report.errors,[]);
 const childVariants=MODEL_LIBRARY.flatMap((model,index)=>modelEligible(model,'child')?[index]:[]);
 assert.equal(report.childImages,childVariants.length*3*4);assert.deepEqual(report.childVariants,childVariants);
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
 await loadExampleStation(page,'zoo');
 await page.evaluate('window.__metro.getState().setSpeed(16);window.__metro.getState().setPlaying(true)');
 await waitFor(page.evaluate,'window.__scene.crowd.agentCount>100',{what:'live library crowd',tries:120,every:250});
 const live=await page.evaluate(`(()=>{
  const r=window.__scene,c=r.crowd;window.__metro.getState().setPlaying(false);
  const outfits=c.agents.geometry.getAttribute('passengerOutfit');
  const models=${JSON.stringify(MODEL_LIBRARY)},children=[],invalid=[];let visible=0;
  for(let i=0;i<c.agents.count;i++){
   const m=c.agents.instanceMatrix.array,offset=i*16,depth=Math.hypot(m[offset],m[offset+1],m[offset+2])/.98,width=Math.hypot(m[offset+4],m[offset+5],m[offset+6])/.98,height=Math.hypot(m[offset+8],m[offset+9],m[offset+10])/.98;
   // Hidden storeys and a followed passenger use a zero instance matrix.
   if(height===0&&depth===0&&width===0)continue;visible++;
   const child=height<.8,model=models[outfits.getX(i)];if(child)children.push(model.id);
   if(child?(height<.5199||height>.7801||depth<.5599||depth>.6301||width<.5599||width>.6301||!model.childEligible):(height<.7999||height>1.2001||depth<.8999||depth>1.1001||width<.8999||width>1.1001||!model.adultEligible))invalid.push(i);
  }
  return {agents:c.agentCount,visible,variants:[...new Set(Array.from(outfits.array).slice(0,c.agents.count))].sort((a,b)=>a-b),children:children.length,childModels:[...new Set(children)],invalidSizes:invalid,opacity:c.agents.material.opacity,transparent:c.agents.material.transparent,instanced:c.agents.isInstancedMesh,triangles:c.agents.geometry.index.count/3,shaderErrors:r.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length};
 })()`);
 assert.equal(live.instanced,true);assert.equal(live.shaderErrors,0);
 // The captures above exhaust every eligible template. A finite station crowd
 // can omit a rare child-only template, so validate its actual sampled pool.
 assert(live.variants.length>20&&live.variants.every(i=>Number.isInteger(i)&&i>=0&&i<MODEL_LIBRARY.length));
 assert.deepEqual([...new Set(live.variants.map(i=>MODEL_LIBRARY[i].bagType).filter(Boolean))].sort(),['crossbody','daypack','handbag','hiking','none','purse','shoulder']);
 assert(live.variants.some(i=>MODEL_LIBRARY[i].outfit),'the live station spawns approved clothes');
 assert.equal(live.opacity,1);assert.equal(live.transparent,false);
 assert.deepEqual(live.invalidSizes,[]);assert(live.children>0&&live.children<live.agents,'the live crowd contains adults and smaller children');
 writeFileSync(resolve(out,'report.json'),JSON.stringify({report,live},null,2));console.log({report,live});
} finally {if(page)await page.close();server.close()}
