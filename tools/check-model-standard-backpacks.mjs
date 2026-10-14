import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor} from './browser-harness.mjs';
import {MODEL_LIBRARY} from '../model/src/characters/library.js';

const out=resolve('.preview/models/standard-backpacks');mkdirSync(out,{recursive:true});
const page=await withPage({url:'http://127.0.0.1:5175/?bag=standard-75',profile:resolve(`.preview/.chrome-standard-packs-${process.pid}`),debugPort:9409,windowSize:'1100,1000'});
try{
 await waitFor(page.evaluate,'window.__modelReady===true');
 async function select(id,value){await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.value='${value}';e.dispatchEvent(new Event('change'))})()`);await waitFor(page.evaluate,'!window.__modelPreview.loading&&document.querySelector("#status").textContent===""')}
 for(const entry of MODEL_LIBRARY.filter(m=>m.bagScale)){
  await select('character',entry.character);await select('hair',entry.hair);await select('bag',entry.bagStyle);
  assert.equal(await page.evaluate('document.querySelector("#download").getAttribute("href")'),`/models/${entry.file}`);
  assert.equal(await page.evaluate('new URL(location.href).searchParams.get("bag")'),entry.bagStyle);
  const report=await page.evaluate(`(async()=>{
   const T=await import('/node_modules/three/build/three.module.js'),p=window.__modelPreview;p.stand();
   const pack=p.model.getObjectByName('Clean_backpack_panel'),strap=p.model.getObjectByName('Backpack_strap_connectors');
   pack.geometry.computeBoundingBox();const size=pack.geometry.boundingBox.getSize(new T.Vector3()),a=strap.geometry.attributes.position,anchors=[];
   for(let side=0;side<2;side++)for(const end of [0,a.count/2-10]){
    const point=new T.Vector3(),offset=side*a.count/2+end;for(let i=0;i<10;i++)point.add(new T.Vector3().fromBufferAttribute(a,offset+i).multiplyScalar(.1));
    anchors.push([new T.Vector3(1,0,0),new T.Vector3(-1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,-1,0),new T.Vector3(0,0,1),new T.Vector3(0,0,-1)].every(d=>new T.Raycaster(point,d).intersectObject(pack,false).length>0));
   }
   const torso=[pack,strap].every(mesh=>{
    const a=mesh.geometry.attributes;
    for(let i=0;i<a.position.count;i++)if(mesh.skeleton.bones[a.skinIndex.getX(i)].name!=='Spine'||a.skinWeight.getX(i)!==1)return false;
    return true;
   });
   return {size:size.toArray(),anchors,torso};
  })()`);
  assert(Math.abs(report.size[0]-.39*entry.bagScale)<.001,'pack width follows the selected percentage');
  assert(Math.abs(report.size[1]-.445*entry.bagScale)<.001,'pack height follows the selected percentage');
  assert(report.anchors.every(Boolean),`${entry.id}: all four strap ends are buried in the pack`);
  assert(report.torso,`${entry.id}: bag and straps follow the torso`);
  for(const profile of ['0','1','2']){
   await select('profile',profile);
   for(const time of [0,.28,.56,.84])for(const view of ['front','side','back','three'])await page.evaluate(`(()=>{const p=window.__modelPreview;p.state.walking=false;p.state.standing=false;p.setTime(${time});p.setView('${view}');p.renderer.render(p.scene,p.camera);if(p.renderer.info.programs.some(x=>x.diagnostics&&!x.diagnostics.runnable))throw new Error('shader failed')})()`);
  }
  for(const view of ['front','side','back','three']){
   await page.evaluate(`(()=>{const p=window.__modelPreview;p.stand();p.setView('${view}');p.camera.zoom=2.5;p.camera.position.y=1.12;p.controls.target.y=1.12;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
   const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${entry.id}-${view}.png`),Buffer.from(shot.data,'base64'));
  }
  console.log(entry.id,report);
 }
 await select('language','zh');assert.equal(await page.evaluate('document.querySelector("#bag option[value=standard-75]").textContent'),'标准背包 · 75%');
 await select('language','en');assert.equal(await page.evaluate('document.querySelector("#bag option[value="+CSS.escape("standard-87.5")+"]").textContent'),'Standard backpack · 87.5%');
 console.log('Resized standard backpacks pass: dimensions, buried anchors, downloads and all three walks in four views.');
}finally{await page.close()}
