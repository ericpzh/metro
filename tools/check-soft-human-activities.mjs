import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/soft-human/activities');mkdirSync(out,{recursive:true});const server=await serveDir(resolve('model/dist'),4288);let page;
try{
 page=await withPage({url:'http://127.0.0.1:4288/soft-human.html',profile:resolve(`.preview/.chrome-soft-activities-${process.pid}`),debugPort:9428,windowSize:'1440,1000'});
 await waitFor(page.evaluate,'window.__softHuman?.ready',{what:'soft activities',tries:100,every:250});await page.evaluate("document.querySelector('#play').click();window.__softHuman.renderer.setAnimationLoop(null)");
 const actions=await page.evaluate('window.__softHuman.actions');assert.equal(actions.length,20);assert(actions.some(a=>a.id==='escalator-left'));
 const selectedActions=process.argv.includes('--smoke')?actions.filter(a=>['idle','wash','qr','card','sit','escalator','escalator-left'].includes(a.id)):actions;const report=[];
 for(const age of ['adult','child'])for(const action of selectedActions){
  await page.evaluate(`(()=>{const p=window.__softHuman;document.querySelector('#age').value='${age}';document.querySelector('#age').dispatchEvent(new Event('change'));document.querySelector('#outfit').value='beige-blazer';document.querySelector('#backpack').value='crossbody-right';p.wardrobe.set('beige-blazer','crossbody-right');p.character.cap.visible=false;p.selectAction('${action.id}')})()`);
  for(const t of [0,action.duration*.35,action.duration*.7,action.duration-.01]){
   const r=await page.evaluate(`(()=>{const p=window.__softHuman;p.setTime(${t});p.renderer.render(p.scene,p.camera);const phase=p.phase;return {finite:p.character.bones.every(b=>b.matrixWorld.elements.every(Number.isFinite)),freeArmPose:!${!!action.activity}||p.character.limbs.filter(l=>!phase.targets.has(l.s)||phase.contact<=1e-6).every(l=>{const c=p.character,shoulder=c.body.worldToLocal(l.arm.getWorldPosition(c.body.position.clone())),wrist=c.body.worldToLocal(phase.wrists[c.limbs.indexOf(l)].getWorldPosition(c.body.position.clone())),expected=shoulder.clone().set(l.s*.26,-.90,.06).multiplyScalar(c.metrics.armLength),elbow=c.body.worldToLocal(l.fore.getWorldPosition(c.body.position.clone()));return elbow.z<shoulder.z-.05&&wrist.z>elbow.z+.1&&wrist.sub(shoulder).distanceTo(expected)<.003}),shaderErrors:p.renderer.info.programs.filter(x=>x.diagnostics&&!x.diagnostics.runnable).length,equipment:p.equipment.root.visible,nodes:p.equipment.root.children.length}})()`);
   assert(r.finite);assert(r.freeArmPose,`${age}/${action.id}/${t}: non-reaching station arms share the accepted relaxed stance`);assert.equal(r.shaderErrors,0);assert.equal(r.equipment,!!action.activity);if(action.activity&&!['wait'].includes(action.id))assert(r.nodes>0,action.id+' has production equipment');report.push({age,id:action.id,t,...r});
  }
  await page.evaluate(`(()=>{const p=window.__softHuman;p.setTime(${action.duration*.35});p.renderer.render(p.scene,p.camera)})()`);
  const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${age}-${action.id}.png`),Buffer.from(shot.data,'base64'));
  if(['idle','qr','card','lift','wait','queue','sit','toilet','door'].includes(action.id))for(const [view,x,z]of [['front',0,3.3],['side',3.3,.05]]){
   const clip=await page.evaluate(`(()=>{const p=window.__softHuman,c=p.character,center=c.body.position.clone();center.y+=.85*c.body.scale.y;p.controls.target.copy(center);p.camera.position.copy(center).add({x:${x},y:.3,z:${z}});p.controls.update();p.renderer.render(p.scene,p.camera);const r=p.renderer.domElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
   const capture=await page.send('Page.captureScreenshot',{format:'png',clip});writeFileSync(resolve(out,`${age}-${action.id}-${view}.png`),Buffer.from(capture.data,'base64'));
   if(action.id==='lift'){
    await page.evaluate('(()=>{const p=window.__softHuman;p.equipment.root.visible=false;p.renderer.render(p.scene,p.camera)})()');
    const pose=await page.send('Page.captureScreenshot',{format:'png',clip});writeFileSync(resolve(out,`${age}-${action.id}-${view}-pose.png`),Buffer.from(pose.data,'base64'));
    await page.evaluate('window.__softHuman.equipment.root.visible=true');
   }
  }

 }
 await page.evaluate("(()=>{window.__softHuman.selectAction('wash');const e=document.querySelector('#timeline');e.value=4;e.dispatchEvent(new Event('input'))})()");assert.equal(await page.evaluate('window.__softHuman.phase.t'),4);
 await page.evaluate("(()=>{const e=document.querySelector('#equipment');e.checked=false;e.dispatchEvent(new Event('change'))})()");assert.equal(await page.evaluate('window.__softHuman.equipment.root.visible'),false);
 writeFileSync(resolve(out,process.argv.includes('--smoke')?'smoke-report.json':'report.json'),JSON.stringify(report,null,2));console.log(`Passed ${selectedActions.length} actions × 2 ages × 4 samples, production equipment, timeline and shader checks.`);
}finally{await page?.close();server.close()}


