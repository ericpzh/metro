import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {randomAppearance} from '../model/src/preview-appearance.js';

const out=resolve('.preview/model-options');mkdirSync(out,{recursive:true});
let children=0;
for(let i=0;i<10000;i++){
 const a=randomAppearance();
 if(a.age==='child'){children++;assert.equal(a.bag,false);assert.notEqual(a.hair,'bald');for(const axis of ['width','depth'])assert(a.size[axis]>=80&&a.size[axis]<=90)}
}
assert(children>1750&&children<2250,'random preview uses a 20% child chance');
const server=await serveDir(resolve('model/dist'),4283);
let page;
try{
 page=await withPage({url:'http://127.0.0.1:4283/?age=child&character=male&hair=bald&bag=small&height=120&width=90&depth=110',profile:resolve(`.preview/.chrome-model-options-${process.pid}`),debugPort:9396,windowSize:'1440,1000'});
 const ready=()=>waitFor(page.evaluate,'window.__modelReady&&!window.__modelPreview.loading&&document.querySelector("#status").textContent===""',{what:'model preview'});
 const change=async(id,value,event='change')=>{await page.evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`);await ready()};
 const read=()=>page.evaluate(`(()=>{const p=window.__modelPreview;return {age:p.state.age,hair:p.state.hair,bag:p.state.bag,scale:p.model.scale.toArray(),bagDisabled:document.querySelector('#bag').disabled,hairs:[...document.querySelector('#hair').options].map(o=>o.value),characterLabels:[...document.querySelector('#character').options].map(o=>o.textContent),url:location.href,uuid:p.model.uuid,shaderErrors:p.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length}})()`);
 const scaled=(actual,expected)=>actual.forEach((v,i)=>assert(Math.abs(v-expected[i])<1e-8));
 const capture=async name=>{await page.evaluate('(()=>{const p=window.__modelPreview;p.renderer.render(p.scene,p.camera)})()');const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${name}.png`),Buffer.from(shot.data,'base64'))};
 await ready();let result=await read();
 assert.equal(result.age,'child');assert.equal(result.hair,'short');assert.equal(result.bag,false);assert(result.bagDisabled);assert(!result.hairs.includes('bald'));assert.deepEqual(result.characterLabels,['Girl','Boy']);scaled(result.scale,[.63,.78,.63]);
 assert.deepEqual(await page.evaluate('[...document.querySelectorAll("#width,#depth")].map(input=>[input.min,input.max])'),[['80','90'],['80','90']]);
 await page.evaluate('window.__modelPreview.stand()');await capture('boy-en');
 const uuid=result.uuid;
 await change('height','80','input');await change('width','80','input');await change('depth','90','input');
 result=await read();assert.equal(result.uuid,uuid,'sliders resize in place without reloading the rig');scaled(result.scale,[.56,.52,.63]);
 const shared=result.url;
 await page.send('Page.navigate',{url:shared});await ready();scaled((await read()).scale,[.56,.52,.63]);
 await change('age','adult');await change('hair','bald');await change('bag','small');
 result=await read();assert.equal(result.bag,true);assert(!result.bagDisabled);scaled(result.scale,[.9,.8,.9]);
 assert.deepEqual(await page.evaluate('[...document.querySelectorAll("#width,#depth")].map(input=>[input.min,input.max])'),[['90','110'],['90','110']]);
 await change('height','120','input');await capture('adult-en');
 await change('age','child');assert.equal((await read()).hair,'short');assert.equal((await read()).bag,false);
 await change('character','female');await change('hair','long');
 await page.evaluate('document.querySelector("#reset-size").click()');scaled((await read()).scale,[.595,.65,.595]);
 await change('profile','2');await page.evaluate('window.__modelPreview.setTime(.56)');scaled((await read()).scale,[.595,.65,.595]);
 await change('language','zh');assert.equal(await page.evaluate('document.querySelector("label[for=height]").textContent'),'身高');assert.deepEqual((await read()).characterLabels,['女孩','男孩']);await capture('girl-zh');
 for(const [character,hair] of [['male','original'],['male','short'],['female','bob'],['female','shoulder'],['female','long']]){
  await change('character',character);await change('hair',hair);
  await page.evaluate('document.querySelector("#reset-size").click()');
  for(const profile of ['0','1','2']){
   await change('profile',profile);await page.evaluate('window.__modelPreview.setTime(.56)');
   result=await read();assert.equal(result.age,'child');assert.equal(result.bag,false);assert.equal(result.hair,hair);scaled(result.scale,[.595,.65,.595]);assert.equal(result.shaderErrors,0);
  }
 }
 for(let i=0;i<8;i++){
  await page.evaluate('document.querySelector("#randomize").click()');await ready();result=await read();
  if(result.age==='child'){assert.equal(result.bag,false);assert.notEqual(result.hair,'bald')}
  assert.equal(result.shaderErrors,0);
 }
 await page.send('Emulation.setDeviceMetricsOverride',{width:650,height:850,deviceScaleFactor:1,mobile:false});
 await capture('compact-zh');
 assert(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'controls fit the compact viewport');
 writeFileSync(resolve(out,'report.json'),JSON.stringify({sampledChildren:children,samples:10000,result},null,2));
 console.log('Preview options pass: age rules, independent dimensions, URL reload, animation scale, reset/random controls, bilingual labels, compact layout and WebGL shaders.');
}finally{if(page)await page.close();server.close()}
