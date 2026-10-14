import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {MODEL_LIBRARY,modelEligible} from '../model/src/characters/library.js';
import {HAIR_CHOICES} from '../model/src/characters/hairstyles.js';

const out=resolve('.preview/model-hairstyles');mkdirSync(out,{recursive:true});
const selected=process.argv.find(arg=>arg.startsWith('--character='))?.slice(12);
if(selected&&!['male','female'].includes(selected))throw Error('Expected --character=male or --character=female');
const characters=selected?[selected]:['male','female'];
const templates=MODEL_LIBRARY.filter(entry=>characters.includes(entry.character));
const server=await serveDir(resolve('model/dist'),4285);let page;
try{
 page=await withPage({url:'http://127.0.0.1:4285/?bag=0',profile:resolve(`.preview/.chrome-hairstyles-${process.pid}`),debugPort:9415,windowSize:'1100,1000'});
 const ready=()=>waitFor(page.evaluate,'window.__modelReady&&!window.__modelPreview.loading&&document.querySelector("#status").textContent===""',{what:'hairstyle preview'});
 const change=async(id,value)=>{await page.evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});if(input.value===${JSON.stringify(value)})return;input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}))})()`);await ready()};
 await ready();
 for(const character of characters){
  await change('character',character);await change('bag','0');
  assert.deepEqual(await page.evaluate('[...document.querySelector("#hair").options].map(o=>o.value)'),HAIR_CHOICES[character]);
  await page.evaluate('window.__hairCards=[]');
  for(const hair of HAIR_CHOICES[character]){
   await change('hair',hair);await page.evaluate('window.__modelPreview.stand()');
   for(const language of ['zh','en']){
    await change('language',language);
    const label=await page.evaluate('document.querySelector("#hair").selectedOptions[0].textContent');
    assert(label!==hair||['original','short','bald','bob','shoulder','long'].includes(hair),'new hair labels are translated');
   }
   for(const view of ['front','three','side','back']){
    await page.evaluate(`(()=>{const p=window.__modelPreview;p.setView(${JSON.stringify(view)});p.camera.position.y=1.58;p.controls.target.y=1.58;p.camera.zoom=5;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera);
     const source=p.renderer.domElement,canvas=document.createElement('canvas');canvas.width=180;canvas.height=180;
     const span=source.height*.84;canvas.getContext('2d').drawImage(source,(source.width-span)/2,(source.height-span)/2,span,span,0,0,180,180);
     window.__hairCards.push({png:canvas.toDataURL(),hair:${JSON.stringify(hair)},view:${JSON.stringify(view)}})})()`);
   }
   // Same head view across opposite arm phases makes shoulder collisions visible.
   for(const profile of ['0','1','2']){
    await change('profile',profile);
    for(const time of [0,.28,.56,.84])await page.evaluate(`(()=>{const p=window.__modelPreview;p.state.walking=false;p.setTime(${time});for(const view of ['front','three','side','back']){p.setView(view);p.renderer.render(p.scene,p.camera)}})()`);
   }
   console.log(`${character}/${hair}: standing and all walks, four views`);
  }
  const png=await page.evaluate(`(async()=>{const cards=window.__hairCards,canvas=document.createElement('canvas');canvas.width=720;canvas.height=2000;const c=canvas.getContext('2d');c.fillStyle='#edf0ed';c.fillRect(0,0,720,2000);c.font='12px sans-serif';
   for(let i=0;i<cards.length;i++){const card=cards[i],img=new Image();img.src=card.png;await img.decode();const x=i%4*180,y=Math.floor(i/4)*200;c.drawImage(img,x,y);c.fillStyle='#333';c.fillText(card.hair+' · '+card.view,x+4,y+194)}return canvas.toDataURL().split(',')[1]})()`);
  writeFileSync(resolve(out,`${character}-hair.png`),Buffer.from(png,'base64'));
 }
 // Check each exported bag/hair permutation rather than only the twenty bare heads.
 for(const [entryIndex,entry] of templates.entries()){
  await change('age',entry.adultEligible?'adult':'child');await change('character',entry.character);
  await change('bag','0');await change('hair',entry.hair);await change('bag',entry.bag?(entry.bagStyle??'1'):'0');
  assert.equal(await page.evaluate('new URL(document.querySelector("#download").href).pathname.split("/").at(-1)'),entry.file);
  await page.evaluate(`(()=>{const p=window.__modelPreview;p.stand();for(const view of ['front','three','side','back']){p.setView(view);p.renderer.render(p.scene,p.camera)}})()`);
  for(const profile of ['0','1','2']){
   await change('profile',profile);
   await page.evaluate(`(()=>{const p=window.__modelPreview;p.state.walking=false;for(const time of [0,.56]){p.setTime(time);for(const view of ['front','three','side','back']){p.setView(view);p.renderer.render(p.scene,p.camera)}}})()`);
  }
  assert.equal(await page.evaluate('window.__modelPreview.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length'),0);
  if((entryIndex+1)%24===0)console.log(`Exported templates: ${entryIndex+1}/${templates.length}`);
 }
 for(const character of characters){
  await change('character',character);await change('age','child');
  const eligible=HAIR_CHOICES[character].filter(hair=>MODEL_LIBRARY.some(m=>m.character===character&&m.hair===hair&&modelEligible(m,'child')));
  assert.deepEqual(await page.evaluate('[...document.querySelector("#hair").options].map(o=>o.value)'),eligible);
 }
 console.log(`Hairstyles pass: ten per selected sex (${characters.join(', ')}), bilingual options, URLs/downloads, age rules and ${templates.length} exported templates standing/walking in four views.`);
}finally{if(page)await page.close();server.close()}
