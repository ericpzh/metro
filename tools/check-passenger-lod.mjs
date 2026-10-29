import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {SOFT_MODEL_LIBRARY as MODEL_LIBRARY,softModelEligible as modelEligible} from '../model/src/soft-human/catalog.js';
import {passengerCaptureBatches} from './passenger-capture-plan.mjs';

const out=resolve('.preview/perf/passenger-10pct');mkdirSync(out,{recursive:true});
const quick=process.argv.includes('--quick');
const cloth=process.argv.includes('--cloth');
const cases=[['male','commuter','daypack'],['male','white-denim','none'],['male','navy-sand','crossbody-right'],['female','tee-skirt','none'],['female','tee-skirt','hiking'],['female','blouse-skirt','none'],['female','blouse-skirt','crossbody-right'],['female','blue-navy-skirt','daypack'],['female','rose-slate-skirt','none'],['female','trail','purse-right']];
const variants=quick?cases.map(([sex,outfit,bag])=>MODEL_LIBRARY.findIndex(m=>m.character===sex&&m.outfit===outfit&&m.bagStyle===bag)):MODEL_LIBRARY.flatMap((m,i)=>!cloth||(m.garmentShape&&m.garmentShape!=='trousers')?[i]:[]);
const server=await serveDir(resolve('game/dist'),0);
let page;
try{
 page=await withPage({url:`http://127.0.0.1:${server.address().port}/?capture-passengers`,profile:resolve(out,`visual-${process.pid}`),debugPort:9396,softwareGpu:false});
 await waitFor(page.evaluate,'!!window.__passengerCardsReady',{what:'production passenger capture'});
 await page.evaluate(`window.__lodVisual={errors:[],rows:[],worst:[]};const original=console.error;console.error=(...args)=>{__lodVisual.errors.push(args.map(String).join(' '));original(...args)};window.addEventListener('error',e=>__lodVisual.errors.push(e.message));window.addEventListener('unhandledrejection',e=>__lodVisual.errors.push(String(e.reason)))`);
 for(const age of ['adult','child'])for(let walkProfile=0;walkProfile<(quick?1:3);walkProfile++)for(const cycleVariants of passengerCaptureBatches(variants)){
  const options={age,walkProfile,cycleVariants,reuseContext:true};
  await page.evaluate(`window.__lodFull=window.__passengerCards.capturePassengers(${JSON.stringify(options)})`);
  const count=await page.evaluate(`(async()=>{
   const low=window.__passengerCards.capturePassengers(${JSON.stringify({...options,detail:'low'})});
   if(low.length!==__lodFull.length)throw Error('full/Low capture coverage differs');
   const canvas=document.createElement('canvas');canvas.width=192;canvas.height=256;const c=canvas.getContext('2d');
   const mask=async card=>{const image=new Image();image.src=card.png;await image.decode();c.clearRect(0,0,192,256);c.drawImage(image,0,0);const pixels=c.getImageData(0,0,192,256).data;return Uint8Array.from({length:192*256},(_,i)=>pixels[i*4+3]>8?1:0)};
   for(let i=0;i<low.length;i++){
    const full=__lodFull[i],card=low[i],a=await mask(full),b=await mask(card);let intersection=0,union=0,fullPixels=0,lowPixels=0;
    for(let p=0;p<a.length;p++){intersection+=a[p]&&b[p];union+=a[p]||b[p];fullPixels+=a[p];lowPixels+=b[p];}
    const row={id:card.id,variant:card.variant,age:card.age,view:card.view,sample:card.sample,walkProfile:card.walkProfile,frame:card.frame,iou:intersection/union,coverage:intersection/fullPixels,fullPixels,lowPixels};
    __lodVisual.rows.push(row);
    __lodVisual.worst.push({row,full:full.png,low:card.png});__lodVisual.worst.sort((a,b)=>a.row.iou-b.row.iou);__lodVisual.worst.length=Math.min(__lodVisual.worst.length,16);
   }
   delete window.__lodFull;return low.length;
  })()`);
  console.log(`${age} / gait ${walkProfile} / ${cycleVariants[0]}: ${count} paired renders`);
 }
 const report=await page.evaluate(`({rows:__lodVisual.rows,errors:__lodVisual.errors,browser:navigator.userAgent})`);
 writeFileSync(resolve(out,'visual-report.json'),JSON.stringify(report,null,2));
 const sheet=await page.evaluate(`(async()=>{
  const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=1160;const c=canvas.getContext('2d');c.fillStyle='#eef0ed';c.fillRect(0,0,1536,1160);
  for(const [i,pair] of __lodVisual.worst.entries()){
   const x=i%4*384,y=Math.floor(i/4)*290;
   for(const [j,src]of[pair.full,pair.low].entries()){const img=new Image();img.src=src;await img.decode();c.drawImage(img,x+j*192,y);}
   c.fillStyle='#222';c.font='11px sans-serif';c.fillText(pair.row.id+' / '+pair.row.walkProfile,x+4,y+268);c.fillText('High | Low / IoU '+pair.row.iou.toFixed(3),x+4,y+282);
  }return canvas.toDataURL('image/png');
 })()`);
 writeFileSync(resolve(out,'worst-pairs.png'),Buffer.from(sheet.split(',')[1],'base64'));
 await page.evaluate('window.__passengerCards.disposePassengerCapture()');
 assert.deepEqual(report.errors,[]);
 const expected=quick?variants.reduce((n,i)=>n+Number(modelEligible(MODEL_LIBRARY[i],'adult'))+Number(modelEligible(MODEL_LIBRARY[i],'child')),0)*12:variants.reduce((n,i)=>n+Number(modelEligible(MODEL_LIBRARY[i],'adult'))+Number(modelEligible(MODEL_LIBRARY[i],'child')),0)*12*3;
 assert.equal(report.rows.length,expected);
 assert.equal(new Set(report.rows.map(r=>r.variant)).size,quick?variants.filter(i=>modelEligible(MODEL_LIBRARY[i],'adult')).length:variants.length);
 assert.ok(report.rows.every(r=>r.fullPixels>0&&r.lowPixels>0),'every appearance/pose/view draws pixels');
 assert.ok(report.rows.every(r=>r.coverage>=.8&&r.iou>=.7),'Low retains a recognizable silhouette in every paired capture; inspect visual-report.json and worst-pairs.png');
 console.log({pairedCaptures:report.rows.length,minIou:Math.min(...report.rows.map(r=>r.iou)),minCoverage:Math.min(...report.rows.map(r=>r.coverage))});
}finally{if(page)await page.close();server.close();}
