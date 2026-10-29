// Natural posture takes priority over escalator contact and equipment clearance.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';

const out=resolve('.preview/soft-human/escalator-pose');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4291);let page;
try{
 page=await withPage({url:'http://127.0.0.1:4291/soft-human.html',profile:resolve(`.preview/.chrome-escalator-pose-${process.pid}`),debugPort:9431,windowSize:'1440,1100'});
 await waitFor(page.evaluate,'window.__softHuman?.ready',{tries:100,every:250});
 await page.evaluate("document.querySelector('#play').click();window.__softHuman.renderer.setAnimationLoop(null)");
 const report=[];
 for(const age of ['adult','child'])for(const action of ['escalator','escalator-left']){
  await page.evaluate(`(()=>{const p=window.__softHuman;p.character.setAge('${age}');p.wardrobe.set('commuter','daypack');p.selectAction('${action}')})()`);
  for(let t=0;t<10;t+=.25){
   const r=await page.evaluate(`(()=>{
    const p=window.__softHuman,c=p.character;p.setTime(${t});
    const side='${action}'==='escalator'?1:-1,point=o=>c.body.worldToLocal(o.getWorldPosition(c.body.position.clone()));
    const limbs=c.limbs.map((l,i)=>({s:l.s,shoulder:point(l.arm).toArray(),elbow:point(l.fore).toArray(),wrist:point(p.phase.wrists[i]).toArray()}));
    return {limbs,chestTurn:c.chest.rotation.y,finite:c.bones.every(b=>b.matrixWorld.elements.every(Number.isFinite)),shaderErrors:p.renderer.info.programs.filter(x=>x.diagnostics&&!x.diagnostics.runnable).length};
   })()`);
   const side=action==='escalator'?1:-1,active=r.limbs.find(l=>l.s===side),free=r.limbs.find(l=>l.s!==side);
   assert.equal(r.chestTurn,0,'escalator geometry must not twist the torso');assert(r.finite);
   assert(side*(active.elbow[0]-active.shoulder[0])>.06,'holding elbow stays on its own side');
   assert(active.elbow[1]<active.shoulder[1]-.08&&active.elbow[1]>active.shoulder[1]-.16&&active.wrist[2]>active.elbow[2]+.15,'holding arm lifts forward at the shoulder while keeping its comfortable bend');
   assert(free.s*(free.wrist[0]-free.shoulder[0])>.16&&free.s*(free.wrist[0]-free.shoulder[0])<.25,'free arm hangs outside the body with a modest spread');
   assert(free.wrist[1]>free.shoulder[1]-.74&&free.wrist[1]<free.shoulder[1]-.65,'free hand hangs above the knee');
   assert(free.elbow[2]<free.shoulder[2]-.05&&free.wrist[2]>free.elbow[2]+.1,'free elbow bends back and forearm forward');
   assert.equal(r.shaderErrors,0);report.push({age,action,t,...r});
  }
  await page.evaluate('window.__softHuman.setTime(4)');
  for(const [view,x,y,z]of [['front',0,.35,3.3],['overhead',0,2.5,1.5],['side',3.3,.35,.05],['oblique',2,.8,2.8]]){
   const clip=await page.evaluate(`(()=>{const p=window.__softHuman,c=p.character,center=c.body.position.clone();center.y+=.85*c.body.scale.y;p.controls.target.copy(center);p.camera.position.copy(center).add({x:${x},y:${y},z:${z}});p.controls.update();p.renderer.render(p.scene,p.camera);const r=p.renderer.domElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
   const shot=await page.send('Page.captureScreenshot',{format:'png',clip});writeFileSync(resolve(out,`${age}-${action}-${view}.png`),Buffer.from(shot.data,'base64'));
  }
  const clip=await page.evaluate(`(()=>{const p=window.__softHuman,c=p.character,center=c.body.position.clone();center.y+=.85*c.body.scale.y;p.controls.target.copy(center);p.camera.position.copy(center).add({x:0,y:.35,z:3.3});p.controls.update();p.equipment.root.visible=false;p.renderer.render(p.scene,p.camera);const r=p.renderer.domElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
  const shot=await page.send('Page.captureScreenshot',{format:'png',clip});writeFileSync(resolve(out,`${age}-${action}-pose.png`),Buffer.from(shot.data,'base64'));
 }
 writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));
 console.log({samples:report.length,naturalPosture:true,chestTurn:0,captures:out});
}finally{await page?.close();server.close()}
