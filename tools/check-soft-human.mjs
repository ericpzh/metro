import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/soft-human');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4287);let page;
try{
 page=await withPage({url:'http://127.0.0.1:4287/soft-human.html',profile:resolve(`.preview/.chrome-soft-${process.pid}`),debugPort:9417,windowSize:'1440,1000'});
 await waitFor(page.evaluate,'window.__softHuman?.ready',{what:'soft human',tries:80,every:250});
 const report=await page.evaluate(`(async()=>{const p=window.__softHuman,c=p.character,m=p.motion;document.querySelector('#play').click();
 const pos=c.body.geometry.attributes.position,weights=c.body.geometry.attributes.skinWeight;let finite=true,maxError=0;for(let i=0;i<pos.count;i++){for(let j=0;j<3;j++)finite&&=Number.isFinite(pos.array[i*3+j]);maxError=Math.max(maxError,Math.abs(Array.from(weights.array.slice(i*4,i*4+4)).reduce((a,b)=>a+b,0)-1))}
 const poses=[];for(const mode of ['idle','walk','reach','float']){m.state.mode=mode;m.reset();for(let i=0;i<240;i++)m.update(1/120);c.body.updateMatrixWorld(true);c.body.skeleton.update();poses.push({mode,angles:c.bones.map(b=>[b.rotation.x,b.rotation.z]),height:c.body.position.y})}
 m.state.mode='idle';m.reset();for(let i=0;i<120;i++)m.update(1/120);const before=c.chest.rotation.z;m.push();m.update(1/60);const after=c.chest.rotation.z;for(let i=0;i<1800;i++)m.update(1/120);const settled=c.chest.rotation.z;
 m.state.mode='walk';m.reset();for(let i=0;i<160;i++)m.update(1/120);p.wardrobe.update();p.renderer.render(p.scene,p.camera);return {vertices:pos.count,finite,maxError,poses,nudge:{before,after,settled},badPrograms:p.renderer.info.programs.filter(x=>x.diagnostics&&!x.diagnostics.runnable).length}})()`);
 assert(report.vertices>3000);assert(report.finite);assert(report.maxError<1e-6);assert.equal(report.badPrograms,0);assert(Math.abs(report.nudge.after-report.nudge.before)>.005);assert(Math.abs(report.nudge.settled)<.001);assert.notDeepEqual(report.poses[0].angles,report.poses[1].angles);
 for(const mode of ['idle','walk','reach','float']){await page.evaluate(`(()=>{const p=window.__softHuman,m=p.motion;m.state.mode='${mode}';m.reset();for(let i=0;i<240;i++)m.update(1/120);p.wardrobe.update();p.renderer.render(p.scene,p.camera)})()`);const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`motion-${mode}.png`),Buffer.from(shot.data,'base64'))}
 for(const angle of ['0','.65','1.57','3.14']){await page.evaluate(`document.querySelector('[data-angle="${angle}"]').click()`);const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`view-${angle}.png`),Buffer.from(shot.data,'base64'))}
 assert.equal(await page.evaluate('document.querySelector("#outfit").options.length'),8);
 assert.equal(await page.evaluate('document.querySelector("#backpack").options.length'),11);
 for(const outfit of ['plain','commuter','stripe','trail','beach'])for(const bag of ['none','daypack','hiking']){
  const result=await page.evaluate(`(()=>{const p=window.__softHuman;for(const [id,value] of [['outfit','${outfit}'],['backpack','${bag}']]){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('change'))}p.wardrobe.update();p.renderer.render(p.scene,p.camera);return {outfit:p.wardrobe.state.outfit,bag:p.wardrobe.state.backpack,pack:!!p.wardrobe.pack,badPrograms:p.renderer.info.programs.filter(x=>x.diagnostics&&!x.diagnostics.runnable).length}})()`);
  assert.equal(result.outfit,outfit);assert.equal(result.bag,bag);assert.equal(result.pack,bag!=='none');assert.equal(result.badPrograms,0);
  if(bag==='hiking')for(const angle of ['0','1.57','3.14']){await page.evaluate(`document.querySelector('[data-angle="${angle}"]').click()`);const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`outfit-${outfit}-${angle}.png`),Buffer.from(shot.data,'base64'))}
 }
 for(const age of ['adult','child'])for(const bag of ['shoulder-left','shoulder-right','crossbody-left','crossbody-right','handbag-left','handbag-right','purse-left','purse-right']){
  const result=await page.evaluate(`(()=>{const p=window.__softHuman;const age=document.getElementById('age');age.value='${age}';age.dispatchEvent(new Event('change'));document.querySelector('#outfit').value='navy-suit';document.querySelector('#backpack').value='${bag}';document.querySelector('#backpack').dispatchEvent(new Event('change'));p.character.cap.visible=false;for(const mode of ['idle','walk','reach','float']){p.motion.state.mode=mode;p.motion.reset();for(let i=0;i<120;i++)p.motion.update(1/120);p.wardrobe.update();p.renderer.render(p.scene,p.camera)}p.motion.state.mode='walk';p.motion.reset();for(let i=0;i<120;i++)p.motion.update(1/120);p.wardrobe.update();return {age:p.character.appearance.age,bag:p.wardrobe.state.backpack,badPrograms:p.renderer.info.programs.filter(x=>x.diagnostics&&!x.diagnostics.runnable).length}})()`);
  assert.equal(result.age,age);assert.equal(result.bag,bag);assert.equal(result.badPrograms,0);
  for(const angle of [.65,1.57]){await page.evaluate(`(()=>{const p=window.__softHuman;p.controls.target.set(0,.85,0);p.camera.position.set(Math.sin(${angle})*3.3,1.55,Math.cos(${angle})*3.3);p.controls.update();p.renderer.render(p.scene,p.camera)})()`);const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`carry-${age}-${bag}-${angle}.png`),Buffer.from(shot.data,'base64'))}
 }
 for(const outfit of ['charcoal-suit','beige-blazer']){await page.evaluate(`(()=>{const p=window.__softHuman;p.character.setAge('adult');p.wardrobe.set('${outfit}','handbag-right');p.wardrobe.update();p.camera.position.set(2,1.6,3.2);p.controls.target.set(0,.9,0);p.controls.update();p.renderer.render(p.scene,p.camera)})()`);const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`formal-${outfit}.png`),Buffer.from(shot.data,'base64'))}
 for(const mode of ['idle','reach'])for(const angle of [0,.65,1.57]){
  await page.evaluate(`(()=>{const p=window.__softHuman;p.wardrobe.set('commuter','hiking');p.motion.state.mode='${mode}';p.motion.reset();for(let i=0;i<240;i++)p.motion.update(1/120);p.wardrobe.update();p.controls.target.set(0,1.22,0);p.camera.position.set(Math.sin(${angle})*1.7,1.45,Math.cos(${angle})*1.7);p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
  const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`neck-straps-${mode}-${angle}.png`),Buffer.from(shot.data,'base64'));
 }
 await page.send('Emulation.setDeviceMetricsOverride',{width:650,height:900,deviceScaleFactor:1,mobile:false});assert(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'));
 writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await page?.close();server.close()}





