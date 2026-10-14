import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {withPage,waitFor} from './browser-harness.mjs';
const page=await withPage({url:'http://127.0.0.1:5175/?character=female&hair=bob&bag=1',profile:resolve(`.preview/.chrome-coat-${process.pid}`),debugPort:9397,windowSize:'1440,1000'});
try{
 await waitFor(page.evaluate,'window.__modelReady===true',{tries:100,every:200});
 async function select(id,value){await page.evaluate(`(()=>{const e=document.querySelector('#${id}');e.value='${value}';e.dispatchEvent(new Event('change'))})()`);await waitFor(page.evaluate,'!window.__modelPreview.loading&&document.querySelector("#status").textContent===""',{tries:100,every:200})}
 for(const character of ['female','male'])for(const bag of ['1','small','standard-87.5','standard-75','0']){
  await select('character',character);await select('bag',bag);await select('profile','2');
  if(bag!=='0')for(const view of ['front','side','back']){
   await page.evaluate(`(()=>{const p=window.__modelPreview;p.stand();p.setView('${view}');p.camera.zoom=2.7;p.camera.position.y=1.23;p.controls.target.y=1.23;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
   const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(`.preview/models/${character}-strap-${view}-current.png`),Buffer.from(shot.data,'base64'));
  }
  await select('profile','2');
  for(const time of [0,.56])for(const angle of [135,225]){
   const result=await page.evaluate(`(async()=>{const T=await import('/node_modules/three/build/three.module.js'),p=window.__modelPreview;p.state.walking=false;p.state.standing=false;p.setTime(${time});p.camera.zoom=2;p.camera.position.set(5*Math.sin(${angle}*Math.PI/180),1.13,5*Math.cos(${angle}*Math.PI/180));p.controls.target.set(0,1.13,0);p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera);let body;p.model.traverse(m=>{if(m.userData.coatInterior&&!body)body=m});const skeleton=body.skeleton,spine=skeleton.bones.findIndex(b=>b.name==='Spine'),target=new T.Vector3(${angle===135?.14:-.14},1.177,.16).applyMatrix4(skeleton.bones[spine].matrixWorld.clone().multiply(skeleton.boneInverses[spine]));const ray=new T.Raycaster(p.camera.position,target.clone().sub(p.camera.position).normalize());const hit=ray.intersectObject(p.model,true)[0];return hit?{color:hit.object.geometry.attributes.color.getX(hit.face.a),clearance:target.distanceTo(p.camera.position)-hit.distance}:null})()`);
   const color=result?.color;assert(result&&result.clearance>.025,"underarm lining occludes the opposite strap before the ray reaches it");const grey=character==='female'?.74:.66,expected=((grey+.055)/1.055)**2.4;
   const strap=((.47+.055)/1.055)**2.4;
   assert(color!==null&&(Math.abs(color-expected)<1e-6||(bag!=='0'&&Math.abs(color-strap)<1e-6)),`${character}, bag ${bag}, phase ${time}, rear angle ${angle}: closed garment surface blocks the shirt/background`);
   const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(`.preview/models/${character}-${bag}-coat-${angle}-${time}.png`),Buffer.from(shot.data,'base64'));
  }
 }
 console.log('Coat closure passes: both rear angles and extreme arm swings, male/female, with/without backpacks.');
}finally{await page.close()}
