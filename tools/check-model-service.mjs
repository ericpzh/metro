import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor} from './browser-harness.mjs';
import {GLTFLoader} from '../model/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {smoothShoulders} from '../model/src/characters/shoulders.js';
import {trimCoatUnderStraps} from '../model/src/characters/strap-surface.js';

const url=process.argv.find(arg=>arg.startsWith('--url='))?.slice(6)??'http://127.0.0.1:5175/';
const out=resolve('.preview/models');mkdirSync(out,{recursive:true});
const page=await withPage({url,profile:resolve(`.preview/.chrome-model-library-${process.pid}`),debugPort:9395,windowSize:'1440,1000'});
try{
 await waitFor(page.evaluate,'window.__modelReady===true',{tries:100,every:300});
 async function select(id,value){await page.evaluate(`(()=>{const input=document.getElementById('${id}');input.value='${value}';input.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitFor(page.evaluate,'window.__modelPreview&&!window.__modelPreview.loading&&document.querySelector("#status").textContent===""',{tries:100,every:200})}
 async function checkSwing(label){
  if(label.endsWith('-1')){
   await page.evaluate('window.__modelPreview.stand()');
   for(const [view,x,y,z] of [['front',0,1.23,5],['side',5,1.23,0],['back',0,1.23,-5],['above',.1,6.23,.1]]){
    await page.evaluate(`(()=>{const p=window.__modelPreview;p.camera.zoom=2.7;p.camera.position.set(${x},${y},${z});p.controls.target.set(0,1.23,0);p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
    const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${label}-strap-${view}.png`),Buffer.from(shot.data,'base64'));
   }
  }
  const lining=await page.evaluate(`(()=>{const p=window.__modelPreview;let body;p.model.traverse(m=>{if(m.userData.coatInterior)body=m});if(!body)return false;const {firstVertex,vertexCount}=body.userData.coatInterior,g=body.geometry;for(let i=firstVertex;i<firstVertex+vertexCount;i++){if(body.skeleton.bones[g.attributes.skinIndex.getX(i)].name!=='Spine'||g.attributes.skinWeight.getX(i)!==1)return false}return body.material.side===2})()`);
  assert(lining,'coat interior is opaque, two-sided and follows the torso');
  for(const [profile,time,angle] of [['0',0,135],['1',.56,225],['2',0,135],['2',0,225],['2',.56,315]]){
   await select('profile',profile);
   await page.evaluate(`(()=>{const p=window.__modelPreview;p.state.walking=false;p.state.standing=false;p.setTime(${time});p.camera.zoom=2;p.camera.position.set(5*Math.sin(${angle}*Math.PI/180),1.13,5*Math.cos(${angle}*Math.PI/180));p.controls.target.set(0,1.13,0);p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
   const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${label}-swing-${profile}-${angle}.png`),Buffer.from(shot.data,'base64'));
  }
  await page.evaluate('window.__modelPreview.setView("front")');
 }
 for(const [hair,bag] of [['bob','1'],['shoulder','1'],['bob','0'],['shoulder','0'],['long','0']]){
  await select('hair',hair);await select('bag',bag);
  await page.evaluate('window.__modelPreview.stand()');
  const result=await page.evaluate(`(()=>{const p=window.__modelPreview;return {hair:p.state.hair,bag:p.state.bag,clips:p.clips.map(c=>c.name),download:document.querySelector('#download').getAttribute('href'),programErrors:p.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length}})()`);
  assert.equal(result.hair,hair);assert.equal(result.bag,bag==='1');assert.equal(result.programErrors,0);assert.equal(result.clips.length,3);
  const response=await fetch(new URL(result.download,url));assert(response.ok,'download resolves to a GLB');const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.toString('ascii',0,4),'glTF');
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${hair}-${bag}.png`),Buffer.from(data,'base64'));
  await page.evaluate('(()=>{const p=window.__modelPreview;p.setView("side");p.camera.zoom=3;p.camera.position.y=1.42;p.controls.target.y=1.42;p.camera.updateProjectionMatrix();p.controls.update()})()');
  await new Promise(resolve=>setTimeout(resolve,150));
  const close=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`female-${hair}-${bag}-close.png`),Buffer.from(close.data,'base64'));
  await page.evaluate('window.__modelPreview.setView("front")');
  await checkSwing(`female-${hair}-${bag}`);
 }
 await select('bag','1');assert.equal(await page.evaluate('window.__modelPreview.state.hair'),'shoulder','bag replaces long hair');
 await select('character','male');
 await select('bag','1');
 assert.deepEqual(await page.evaluate('[...document.querySelector("#hair").options].map(o=>o.value)'),['original','short','bald']);
 const male=await new GLTFLoader().parseAsync(await(await fetch(new URL('models/passenger-male-walk.glb',url))).arrayBuffer(),'');
 const originalBytes=readFileSync(resolve('prototypes/trellis-passenger/passenger-b-walk-forward.glb'));
 const original=await new GLTFLoader().parseAsync(originalBytes.buffer.slice(originalBytes.byteOffset,originalBytes.byteOffset+originalBytes.byteLength),'');
 smoothShoulders(original.scene);
 let expectedBody;original.scene.traverse(m=>{if(m.isSkinnedMesh&&m.userData.coatInterior&&(!expectedBody||m.geometry.index.count>expectedBody.geometry.index.count))expectedBody=m});
 expectedBody.geometry=trimCoatUnderStraps(expectedBody,original.scene.getObjectByName('Backpack_strap_connectors'));
 original.scene.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const copy=male.scene.getObjectByName(mesh.name);assert(copy);assert.deepEqual(copy.geometry.attributes.position.array,mesh.geometry.attributes.position.array);assert.deepEqual(copy.geometry.index?.array,mesh.geometry.index?.array)});
 assert.deepEqual(male.animations.map(clip=>clip.name),['Walk_Slow','Walk_Medium','Walk_Fast']);
 let shortScalp;
 for(const hair of ['original','short','bald'])for(const bag of ['1','0']){
  await select('hair',hair);await select('bag',bag);await page.evaluate('window.__modelPreview.stand()');
  const link=await page.evaluate('document.querySelector("#download").getAttribute("href")');
  const response=await fetch(new URL(link,url));assert(response.ok);
  const variant=await new GLTFLoader().parseAsync(await response.arrayBuffer(),'');
  assert.equal(variant.animations.length,3);
  const connectors=variant.scene.getObjectByName('Backpack_strap_connectors');
  assert.equal(Boolean(connectors),bag==='1','attachment ribbons only appear with a backpack');
  let coatBody;variant.scene.traverse(m=>{if(m.isSkinnedMesh&&m.userData.coatInterior&&(!coatBody||m.geometry.index.count>coatBody.geometry.index.count))coatBody=m});
  assert.equal(Boolean(coatBody.userData.trimmedStrapTriangles),bag==='1','coat overlaps are trimmed only when straps are present');
  if(connectors){
   const g=connectors.geometry;for(let i=0;i<g.attributes.position.count;i++){
    assert.equal(connectors.skeleton.bones[g.attributes.skinIndex.getX(i)].name,'Spine','every strap section stays on the torso rather than the arms');
    let total=0;for(let k=0;k<4;k++)total+=g.attributes.skinWeight.array[i*4+k];
    assert(Math.abs(total-1)<1e-6,'fitted straps retain normalized coat skin weights');
   }
   const pack=variant.scene.getObjectByName('Clean_backpack_panel');pack.geometry.computeBoundingBox();
   for(let ribbon=0;ribbon<2;ribbon++)for(const endpoint of ['start','end']){
    const verticesPerRibbon=g.attributes.position.count/2;
    const end=endpoint==='start'?ribbon*verticesPerRibbon:(ribbon+1)*verticesPerRibbon-10,point={x:0,y:0,z:0};
    for(let k=0;k<10;k++){point.x+=g.attributes.position.getX(end+k)/10;point.y+=g.attributes.position.getY(end+k)/10;point.z+=g.attributes.position.getZ(end+k)/10}
    for(let k=0;k<10;k++)assert.equal(connectors.skeleton.bones[g.attributes.skinIndex.getX(end+k)].name,'Spine','pack anchors stay on the torso');
    assert(pack.geometry.boundingBox.containsPoint(point),'each upper/lower strap ends inside the backpack');
   }
  }
  const scalp=variant.scene.getObjectByName(`${hair[0].toUpperCase()+hair.slice(1)}_hairstyle`);
  if(hair!=='original'){
   assert(scalp);const g=scalp.geometry;
   if(hair==='short')shortScalp=g.attributes.position.array.slice();
   else assert.deepEqual(g.attributes.position.array,shortScalp,'bald and short use identical scalp geometry');
   const expected=hair==='bald'?.78:.47,linear=expected<=.04045?expected/12.92:((expected+.055)/1.055)**2.4;
   for(const value of g.attributes.color.array)assert(Math.abs(value-linear)<1e-6,'scalp uses one flat hair/skin color');
  }
  if(bag==='0')assert(variant.scene.getObjectByName('Jacket_back_fill'),'bagless jacket is closed');
  for(const view of ['front','three','side','back']){
   await page.evaluate(`window.__modelPreview.setView('${view}')`);
   await new Promise(resolve=>setTimeout(resolve,150));
   const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`male-${hair}-${bag}-${view}.png`),Buffer.from(shot.data,'base64'));
   if(bag==='0'&&hair!=='original'){
    await page.evaluate('(()=>{const p=window.__modelPreview;p.camera.zoom=3;p.camera.position.y=1.42;p.controls.target.y=1.42;p.camera.updateProjectionMatrix();p.controls.update()})()');
    await new Promise(resolve=>setTimeout(resolve,150));
    const close=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`male-${hair}-shoulder-${view}.png`),Buffer.from(close.data,'base64'));
   }
  }
  await checkSwing(`male-${hair}-${bag}`);
 }
 await page.evaluate('window.__modelPreview.setView("front")');
 await page.evaluate('window.__modelPreview.stand()');let shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'male.png'),Buffer.from(shot.data,'base64'));
 await page.evaluate('document.querySelector("#play").click()');assert(await page.evaluate('window.__modelPreview.state.walking&&!window.__modelPreview.state.standing'),'walking resumes from standing');
 await select('profile','2');assert.equal(await page.evaluate('window.__modelPreview.state.profile'),2);
 await select('language','zh');assert.equal(await page.evaluate('document.querySelector("h1").textContent'),'模型库');
 shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'male-zh.png'),Buffer.from(shot.data,'base64'));
 console.log('Model service passes: five female and six male variants, preserved source, identical short/bald scalp, clips, stand/play, bag rules, downloads, Chinese labels, and WebGL shaders.');
}finally{await page.close()}
