import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor} from './browser-harness.mjs';
import {MODEL_LIBRARY} from '../model/src/characters/library.js';
const out=resolve('.preview/models/small-backpack');mkdirSync(out,{recursive:true});
const page=await withPage({url:'http://127.0.0.1:5175/?bag=small',profile:resolve(`.preview/.chrome-small-pack-${process.pid}`),debugPort:9396,windowSize:'1100,1000'});
try{
 await waitFor(page.evaluate,'window.__modelReady===true',{tries:100,every:200});
 async function select(id,value){await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.value='${value}';e.dispatchEvent(new Event('change'))})()`);await waitFor(page.evaluate,'!window.__modelPreview.loading&&document.querySelector("#status").textContent===""',{tries:100,every:200})}
 const characterArg=process.argv.find(a=>a.startsWith('--character='))?.split('=')[1];
 for(const entry of MODEL_LIBRARY.filter(m=>m.bagStyle==='small'&&(!characterArg||m.character===characterArg))){
  await select('character',entry.character);await select('hair',entry.hair);await select('bag','small');
  assert.equal(await page.evaluate('document.querySelector("#download").getAttribute("href")'),`/models/${entry.file}`);
  const shape=await page.evaluate(`(async()=>{
   const T=await import('/node_modules/three/build/three.module.js'),p=window.__modelPreview;p.stand();
   const pack=p.model.getObjectByName('Clean_backpack_panel'),strap=p.model.getObjectByName('Backpack_strap_connectors');
   pack.geometry.computeBoundingBox();const a=pack.geometry.attributes.position,g=strap.geometry.attributes;
   const width=(low,high)=>{let max=0;for(let i=0;i<a.count;i++)if(a.getY(i)>low&&a.getY(i)<high)max=Math.max(max,Math.abs(a.getX(i)));return 2*max};
   const anchors=[];for(let side=0;side<2;side++)for(const end of [0,g.position.count/2-10]){
    const point=new T.Vector3(),offset=side*g.position.count/2+end;
    for(let i=0;i<10;i++)point.add(new T.Vector3().fromBufferAttribute(g.position,offset+i).multiplyScalar(.1));
    // An interior point has a surface in every axis direction.
    anchors.push([new T.Vector3(1,0,0),new T.Vector3(-1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,-1,0),new T.Vector3(0,0,1),new T.Vector3(0,0,-1)].every(d=>new T.Raycaster(point,d).intersectObject(pack,false).length>0));
   }
   let torso=true;for(const m of [pack,strap])for(let i=0;i<m.geometry.attributes.position.count;i++)if(m.skeleton.bones[m.geometry.attributes.skinIndex.getX(i)].name!=='Spine'||m.geometry.attributes.skinWeight.getX(i)!==1)torso=false;
   return {size:pack.geometry.boundingBox.getSize(new T.Vector3()).toArray(),upper:width(1.19,1.25),lower:width(.98,1.08),anchors,torso,back:!!p.model.getObjectByName('Jacket_back_fill'),trimmed:p.model.getObjectByName('mesh_0').userData.trimmedStrapTriangles};
  })()`);
  assert(shape.size[0]<.32&&shape.size[2]<.16,'small pack is narrower and shallower than the .39 × .18 m standard pack');
  assert(shape.upper<shape.lower*.8,'crown tapers above the fuller rounded base');
  assert(shape.anchors.every(Boolean),'all four ribbon anchors are inside the closed pack');assert(shape.torso&&shape.back&&shape.trimmed);
  for(const profile of ['0','1','2']){
   await select('profile',profile);
   for(const time of [null,0,.28,.56,.84]){
    await page.evaluate(`(()=>{const p=window.__modelPreview;if(${time}===null)p.stand();else{p.mixer.stopAllAction();p.mixer.clipAction(p.clips[${profile}]).play();p.state.walking=false;p.state.standing=false;p.setTime(${time})}p.renderer.render(p.scene,p.camera)})()`);
    assert.equal(await page.evaluate('window.__modelPreview.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length'),0);
    // All standing views, plus moving side/back/oblique poses for every gait.
    for(const view of time===null?['front','side','back','three']:['side','back','three']){
     await page.evaluate(`(()=>{const p=window.__modelPreview;p.setView('${view}');p.renderer.render(p.scene,p.camera)})()`);
     const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${entry.id}-${profile}-${time??'stand'}-${view}.png`),Buffer.from(shot.data,'base64'));
    }
   }
  }
  console.log(entry.id,shape);
 }
 await select('hair','long');assert.equal(await page.evaluate('window.__modelPreview.state.bag'),false);
 await select('bag','small');assert.equal(await page.evaluate('window.__modelPreview.state.hair'),'shoulder');
 await select('language','zh');assert.equal(await page.evaluate('document.querySelector("#bag option[value=small]").textContent'),'小背包');
 console.log('Small backpacks pass: reviewed downloads, tapered shape, closed coat, buried anchors, Spine weights, three gaits, four views, WebGL and bilingual controls.');
}finally{await page.close()}
