import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {OUTFITS} from '../model/src/characters/outfits.js';
import {captureOutfitOrbit} from './model-outfit-orbit.mjs';

const server=process.argv.includes('--production')?await serveDir(resolve('model/dist'),4288):null;
const url=process.argv.find(arg=>arg.startsWith('--url='))?.slice(6)??(server?'http://127.0.0.1:4288/':'http://127.0.0.1:5175/');
const child=process.argv.includes('--child');
const size=process.argv.find(arg=>arg.startsWith('--size='))?.slice(7);
assert(!size||child&&['short-wide','tall-narrow'].includes(size),'size presets apply to children');
const dimensions=size==='short-wide'?'&height=80&width=90&depth=90':size==='tall-narrow'?'&height=120&width=80&depth=80':'';
const out=resolve('.preview/model-outfits',child?'children':'',size??'');mkdirSync(out,{recursive:true});
const quick=process.argv.includes('--quick');
const standingOnly=process.argv.includes('--standing-only');
const orbit=process.argv.includes('--orbit');
const hardware=process.argv.includes('--hardware');
if(orbit)mkdirSync(resolve(out,'orbit'),{recursive:true});
const page=await withPage({url:url+`?character=female&bag=0&outfit=long-a-line&age=${child?'child':'adult'}${dimensions}`,profile:resolve(`.preview/.chrome-outfits-${process.pid}`),debugPort:hardware?9466:server?9464:9463,windowSize:'1440,1000',softwareGpu:!hardware});
try{
 const ready=()=>waitFor(page.evaluate,'window.__modelReady&&!window.__modelPreview.loading&&document.querySelector("#status").textContent===""',{tries:150,every:200});
 const change=async(id,value)=>{await page.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await ready()};
 await ready();
 const cards={};
 for(const character of ['female','male']){
  await change('character',character);
  assert.equal(await page.evaluate('document.querySelector("#outfit").options.length'),11);
  cards[character]=[];
  for(const outfit of (quick?OUTFITS[character].slice(0,1):OUTFITS[character])){
   await change('outfit',outfit.id);await page.evaluate('window.__modelPreview.stand()');
   assert.equal(await page.evaluate('window.__modelPreview.state.bag'),false);
   assert.equal(await page.evaluate('document.querySelector("#bag").disabled'),true);
   assert.equal(await page.evaluate('window.__modelPreview.model.userData.outfit.id'),outfit.id);
   assert.equal(await page.evaluate('document.querySelector("#outfit").disabled'),false);
   assert.equal(await page.evaluate('window.__modelPreview.state.age'),child?'child':'adult');
   if(child){
    const scale=await page.evaluate('window.__modelPreview.model.scale.toArray()');
    const expected=size==='short-wide'?[.63,.52,.63]:size==='tall-narrow'?[.56,.78,.56]:[.595,.65,.595];
    scale.forEach((v,i)=>assert(Math.abs(v-expected[i])<1e-8,'outfit follows child size bounds'));
   }
   const views=[];
   for(const view of ['front','three','side','back']){
    const image=await page.evaluate(`(()=>{const p=window.__modelPreview,s=p.model.scale.y;p.setView(${JSON.stringify(view)});p.camera.zoom=1.12/s;p.controls.target.y=.86*s;p.camera.position.y=.86*s;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera);return p.renderer.domElement.toDataURL('image/png')})()`);
    views.push(image);
    if(outfit===OUTFITS[character][0])writeFileSync(resolve(out,`${character}-${view}.png`),Buffer.from(image.split(',')[1],'base64'));
   }
   for(let profile=0;profile<(standingOnly?0:3);profile++){
    await change('profile',String(profile));
    for(let frame=0;frame<24;frame+=quick?6:1){
     const check=await page.evaluate(`(()=>{const p=window.__modelPreview;p.state.walking=false;p.setTime(${frame*1.12/24});p.renderer.render(p.scene,p.camera);let finite=true,minY=Infinity;const v=new p.camera.position.constructor();p.model.traverse(m=>{if(!m.isSkinnedMesh||!m.visible)return;for(const i of new Set(m.geometry.index?.array??Array.from({length:m.geometry.attributes.position.count},(_,i)=>i))){m.getVertexPosition(i,v);v.applyMatrix4(m.matrixWorld);finite&&=Number.isFinite(v.x+v.y+v.z);minY=Math.min(minY,v.y)}});return {finite,minY,shaderErrors:p.renderer.info.programs.filter(s=>s.diagnostics&&!s.diagnostics.runnable).length}})()`);
     assert(check.finite,`${character}/${outfit.id}: finite animated vertices`);assert(check.minY>-.025,`${character}/${outfit.id}: garment stays off the ground (${check.minY})`);assert.equal(check.shaderErrors,0);
    }
    if(outfit===OUTFITS[character][0]){
     for(const view of ['front','three','side','back']){
      const image=await page.evaluate(`(()=>{const p=window.__modelPreview,s=p.model.scale.y;p.setView(${JSON.stringify(view)});p.camera.zoom=1.12/s;p.controls.target.y=.86*s;p.camera.position.y=.86*s;p.camera.updateProjectionMatrix();p.controls.update();p.setTime(.28);p.renderer.render(p.scene,p.camera);return p.renderer.domElement.toDataURL('image/png')})()`);
      writeFileSync(resolve(out,`${character}-walk-${profile}-${view}.png`),Buffer.from(image.split(',')[1],'base64'));
     }
    }
   }
   if(orbit){
    const result=await page.evaluate(`(${captureOutfitOrbit.toString()})()`);
    writeFileSync(resolve(out,'orbit',`${character}-${outfit.id}.png`),Buffer.from(result.image.split(',')[1],'base64'));
    assert.deepEqual(result.leaks,[],`${character}/${outfit.id}: visible skin breaks through the rendered skirt: ${JSON.stringify(result.leaks)}`);
   }
   cards[character].push({id:outfit.id,label:await page.evaluate('document.querySelector("#outfit").selectedOptions[0].textContent'),views});
   assert.equal(await page.evaluate('window.__modelPreview.renderer.info.programs.filter(s=>s.diagnostics&&!s.diagnostics.runnable).length'),0,'WebGL shaders compile');
   console.log(`${child?'Child':'Adult'} ${character}/${outfit.id}: views${orbit?', 16 angles × 5 poses':''} pass.`);
  }
 }
 await change('outfit',OUTFITS.male[0].id);
 const originalTones=await page.evaluate('window.__modelPreview.model.userData.outfit');
 await page.evaluate('document.querySelector("#swap-tones").click()');await ready();
 let swapped=await page.evaluate('({outfit:window.__modelPreview.model.userData.outfit,url:location.href})');
 assert.equal(swapped.outfit.top,originalTones.bottom);assert.equal(swapped.outfit.bottom,originalTones.top);assert(swapped.url.includes('tones=swapped'));
 await page.send('Page.navigate',{url:swapped.url});await ready();
 assert.equal(await page.evaluate('window.__modelPreview.model.userData.outfit.swapTones'),true,'swapped greys persist after reload');
 assert.equal(await page.evaluate('window.__modelPreview.state.age'),child?'child':'adult','age persists after reload');
 const previewScale=await page.evaluate('window.__modelPreview.model.scale.toArray()');
 // Intercept only the generated blob URL, then parse the actual browser GLB.
 await page.evaluate(`window.__outfitBlob=null;window.__originalCreateObjectURL=URL.createObjectURL;URL.createObjectURL=blob=>{window.__outfitBlob=blob;return window.__originalCreateObjectURL(blob)}`);
 await page.evaluate('document.querySelector("#download").click()');
 await waitFor(page.evaluate,'window.__outfitBlob!==null',{tries:100,every:100});
 const exported=await page.evaluate(`(async()=>{const bytes=await window.__outfitBlob.arrayBuffer(),view=new DataView(bytes),json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,view.getUint32(12,true))));return {magic:view.getUint32(0,true),version:view.getUint32(4,true),length:view.getUint32(8,true),actualLength:bytes.byteLength,clips:json.animations.length,outfit:json.nodes.find(n=>n.extras?.outfit)?.extras.outfit,top:json.nodes.some(n=>n.name==='Jacket-free top')}})()`);
 assert.equal(exported.magic,0x46546c67);assert.equal(exported.version,2);assert.equal(exported.length,exported.actualLength);assert.equal(exported.clips,3);assert(exported.top);assert.equal(exported.outfit.swapTones,true);
 assert.deepEqual(await page.evaluate('window.__modelPreview.model.scale.toArray()'),previewScale,'base GLB download restores the preview size');
 await page.evaluate('URL.createObjectURL=window.__originalCreateObjectURL');
 // Show the actual meshes at a common scale, with no lighting/palette changes.
 for(const character of ['female','male']){
  const sheet=await page.evaluate(`(async()=>{const cards=${JSON.stringify(cards[character])};const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=1060;const c=canvas.getContext('2d');c.fillStyle='#eeefed';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#444';c.font='24px system-ui';c.fillText('${character} · 10 jacket-free clothing studies',30,38);for(let i=0;i<cards.length;i++){for(let v=0;v<2;v++){const image=new Image();image.src=cards[i].views[v];await image.decode();const x=20+i*218,y=65+v*480;const sw=image.width,sh=image.height;c.drawImage(image,sw/2-sh*.245,0,sh*.49,sh,x,y,210,430);c.fillStyle='#444';c.font='14px system-ui';c.fillText(cards[i].id,x,y+452)}}return canvas.toDataURL('image/png')})()`);
  writeFileSync(resolve(out,`${character}-${quick?'sample-':''}lineup.png`),Buffer.from(sheet.split(',')[1],'base64'));
 }
 await change('outfit',OUTFITS.male[0].id);await change('language','zh');
 assert(!await page.evaluate('document.querySelector("#outfit").selectedOptions[0].textContent.includes("outfit-")'));
 for(const age of ['adult','child','adult','child']){
  await change('age',age);
  assert.equal(await page.evaluate('window.__modelPreview.state.outfit'),OUTFITS.male[0].id);
  assert.equal(await page.evaluate('window.__modelPreview.model.userData.outfit.swapTones'),true);
  assert.equal(await page.evaluate('document.querySelector("#outfit").disabled'),false);
  assert.equal(await page.evaluate('window.__modelPreview.state.bag'),false);
 }
 await change('age','adult');await change('hair','bald');await change('age','child');
 assert.equal(await page.evaluate('window.__modelPreview.state.hair'),'short');
 assert.equal(await page.evaluate('window.__modelPreview.state.outfit'),OUTFITS.male[0].id);
 assert.equal(await page.evaluate('[...document.querySelector("#hair").options].some(o=>o.value==="bald")'),false);
 await change('outfit','original');assert.equal(await page.evaluate('document.querySelector("#bag").disabled'),false);
 console.log(`${quick?'Two sample':'20'} ${child?'child':'adult'} clothing studies: standing/four views${standingOnly?'':`, 3 × ${quick?4:24} walk frames, finite geometry, ground clearance`}, WebGL, swap/reload/GLB downloads, bag/age rules and bilingual labels.`);
}finally{await page.close();server?.close()}
