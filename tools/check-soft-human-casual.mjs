import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {outfitsForSex} from '../model/src/soft-human/wardrobe.js';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';

const out=resolve('.preview/soft-human/casual');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4292);let page;
try{
 page=await withPage({url:'http://127.0.0.1:4292/soft-human.html',profile:resolve(`.preview/.chrome-soft-casual-${process.pid}`),debugPort:9432,windowSize:'1440,1000'});
 await waitFor(page.evaluate,'window.__softHuman?.ready',{what:'casual wardrobe',tries:100,every:250});
 await page.evaluate("document.querySelector('#play').click()");
 const choose=async(id,value)=>page.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'))})()`);
 const report=[];
 for(const sex of ['male','female']){
  await choose('sex',sex);
  const options=await page.evaluate("Array.from(document.querySelector('#outfit').options,o=>o.value)");
  assert.equal(options.length,20);assert.deepEqual(options,outfitsForSex(sex).map(o=>o.id));assert.equal(options.includes('trail'),sex==='female');assert.equal(options.includes('beach'),sex==='male');assert.equal(options.includes('tee-skirt'),sex==='female');assert.equal(options.includes('blouse-skirt'),sex==='female');
  for(const outfit of options){
   await choose('outfit',outfit);
   const r=await page.evaluate(`(()=>{const p=window.__softHuman;p.selectAction('walk');p.setTime(.7);p.renderer.render(p.scene,p.camera);return {sex:p.wardrobe.state.sex,outfit:p.wardrobe.state.outfit,finite:p.character.body.geometry.attributes.position.array.every(Number.isFinite),shaderErrors:p.renderer.info.programs.filter(x=>x.diagnostics&&!x.diagnostics.runnable).length}})()`);
   assert.equal(r.sex,sex);assert.equal(r.outfit,outfit);assert(r.finite);assert.equal(r.shaderErrors,0);report.push(r);
  }
 }
 await choose('outfit','tee-shorts');await choose('backpack','crossbody-right');await choose('age','child');await choose('motion','walk');
 await page.evaluate('window.__softHuman.setTime(1.25)');
 const before=await page.evaluate('window.__softHuman.motion.time');await choose('sex','male');await choose('sex','female');
 const kept=await page.evaluate('({state:window.__softHuman.wardrobe.state,age:window.__softHuman.character.appearance.age,time:window.__softHuman.motion.time})');
 assert.equal(kept.state.outfit,'tee-shorts');assert.equal(kept.state.backpack,'crossbody-right');assert.equal(kept.age,'child');assert.equal(kept.time,before);
 await choose('outfit','trail');await choose('sex','male');assert.equal(await page.evaluate('window.__softHuman.wardrobe.state.outfit'),'commuter');
 for(const [sex,age] of [['male','adult'],['female','child']])for(const outfit of sex==='male'?['tee-shorts','polo-shorts','sport-shorts']:['tee-shorts',...outfitsForSex('female').filter(o=>o.skirt).map(o=>o.id)]){
  await choose('sex',sex);await choose('age',age);await choose('outfit',outfit);await choose('backpack','daypack');
  for(const mode of outfit.endsWith('skirt')?['idle','walk','sit']:['idle','walk']){
   await choose('motion',mode);await page.evaluate(`window.__softHuman.setTime(${mode==='sit'?4:.7})`);
   for(const angle of [0,.65,1.57,3.14]){
    await page.evaluate(`(()=>{const p=window.__softHuman,c=p.character,s=c.body.scale.y,center=c.body.position.clone();center.y+=.86*s;p.controls.target.copy(center);p.camera.position.copy(center).add({x:Math.sin(${angle})*3.3*s,y:.30*s,z:Math.cos(${angle})*3.3*s});p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
    const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${sex}-${age}-${outfit}-${mode}-${angle}.png`),Buffer.from(shot.data,'base64'));
   }
  }
 }
 for(const age of ['adult','child'])for(const outfit of outfitsForSex('female').filter(o=>o.skirt).map(o=>o.id)){
  await choose('sex','female');await choose('age',age);await choose('outfit',outfit);await choose('backpack','crossbody-right');await choose('motion','idle');
  const clip=await page.evaluate(`(()=>{const p=window.__softHuman,c=p.character,s=c.body.scale.y;p.setTime(.7);const center=c.body.localToWorld(c.hips.position.clone().set(0,.64,0));p.controls.target.copy(center);p.camera.position.copy(center).add({x:0,y:.48*s,z:1.22*s});p.controls.update();p.renderer.render(p.scene,p.camera);const r=p.renderer.domElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
  const shot=await page.send('Page.captureScreenshot',{format:'png',clip});writeFileSync(resolve(out,`flush-waist-${age}-${outfit}.png`),Buffer.from(shot.data,'base64'));
 }
 await page.send('Emulation.setDeviceMetricsOverride',{width:650,height:900,deviceScaleFactor:1,mobile:false});assert(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'));
 writeFileSync(resolve(out,'report.json'),JSON.stringify({outfits:report,kept},null,2));
 console.log('Passed 20 outfits per category, pink-jacket eligibility, state preservation, both ages, casual and skirt outfits, standing/walking/seated views and shaders.');
}finally{await page?.close();server.close()}
