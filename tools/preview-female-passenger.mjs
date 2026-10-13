import {withPage,waitFor} from './browser-harness.mjs';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {WALK_PROFILES} from '../game/src/sim/constants.ts';
import {exportSharedPassengerVariants} from './export-shared-passenger-variants.mjs';
const repo=resolve(import.meta.dirname,'..'),folder=process.argv.includes('--shared')?'passenger-female-shared':'trellis-passenger-female',out=resolve(repo,'prototypes',folder);
const url=`http://127.0.0.1:4268/prototypes/${folder}/index.html`;
async function writeModel(path,bytes){
 const temporary=`${path}.${process.pid}.tmp`;writeFileSync(temporary,bytes);
 for(let attempt=0;;attempt++)try{renameSync(temporary,path);return}catch(error){if(attempt>=5)throw error;await new Promise(r=>setTimeout(r,500))}
}
writeFileSync(resolve(out,'walk-profiles.json'),JSON.stringify(WALK_PROFILES,null,2)+'\n');
const page=await withPage({url,profile:resolve(repo,`.preview/.chrome-female-${process.pid}`),debugPort:9393,windowSize:'1200,1000'});
try{
 await waitFor(page.evaluate,'window.__femaleReady===true',{what:'female model',tries:120,every:500});
 await page.evaluate('window.__femalePreview.setWalking(false);window.__femalePreview.controls.enableDamping=false');
 mkdirSync(resolve(out,'views'),{recursive:true});
 for(const view of ['front','three','side','back','backThree','left']){
  await page.evaluate(`(()=>{const p=window.__femalePreview;p.mixer.stopAllAction();let sk;p.model.traverse(n=>{if(n.isSkinnedMesh)sk=n.skeleton});sk.pose();p.model.updateMatrixWorld(true);sk.update();p.setView('${view}');return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'views',`${view}.png`),Buffer.from(data,'base64'));
 }
 for(let profile=0;profile<3;profile++)for(const time of [0,.14,.28,.42,.56]){
  await page.evaluate(`(()=>{const p=window.__femalePreview;p.setView('side');p.setProfile(${profile});p.setTime(${time});return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'views',`walk-${profile}-${time}.png`),Buffer.from(data,'base64'));
 }
 for(const view of ['front','backThree'])for(const time of [0,.28]){
  await page.evaluate(`(()=>{const p=window.__femalePreview;p.setView('${view}');p.setProfile(1);p.setTime(${time});return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'views',`walk-${view}-${time}.png`),Buffer.from(data,'base64'));
 }
 for(const view of ['front','side','back']){
  await page.evaluate(`(()=>{const p=window.__femalePreview;p.mixer.stopAllAction();let sk;p.model.traverse(n=>{if(n.isSkinnedMesh)sk=n.skeleton});sk.pose();p.model.updateMatrixWorld(true);sk.update();p.setView('${view}');p.camera.position.y=1.34;p.controls.target.y=1.34;p.camera.zoom=3.5;p.camera.updateProjectionMatrix();p.controls.update();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'views',`neck-${view}.png`),Buffer.from(data,'base64'));
 }
 for(const view of ['front','side']){
  await page.evaluate(`(()=>{const p=window.__femalePreview;p.setView('${view}');p.camera.position.y=.73;p.controls.target.y=.73;p.camera.zoom=4;p.camera.updateProjectionMatrix();p.controls.update();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'views',`hands-${view}.png`),Buffer.from(data,'base64'));
 }
 for(const animate of folder==='passenger-female-shared'?[]:[false,true]){
  const length=await page.evaluate(`window.__exportFemale(${animate})`),chunks=[];
  for(let offset=0;offset<length;offset+=196608)chunks.push(Buffer.from(await page.evaluate(`window.__femaleChunk(${offset})`),'base64'));
  await writeModel(resolve(out,animate?'passenger-female-walk.glb':'passenger-female-flat.glb'),Buffer.concat(chunks));
  console.log(`${animate?'Animated':'Static'} female GLB: ${length} bytes`);
 }
 if(folder==='passenger-female-shared')for(const [style,bag] of [['shoulder',true],['bob',false],['shoulder',false],['long',false]]){
  const prefix=bag?style:`no-bag-${style}`;
  await page.evaluate(`window.__femalePreview.setBag(${bag});window.__femalePreview.setHairstyle('${style}')`);
  for(const view of ['front','side','back','three']){
   await page.evaluate(`(()=>{const p=window.__femalePreview;p.mixer.stopAllAction();let sk;p.model.traverse(n=>{if(n.isSkinnedMesh)sk=n.skeleton});sk.pose();p.model.updateMatrixWorld(true);sk.update();p.setView('${view}');return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
   const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'views',`${prefix}-${view}.png`),Buffer.from(data,'base64'));
  }
 }
 if(folder==='passenger-female-shared')await exportSharedPassengerVariants();
 console.log(await page.evaluate(`(()=>{const p=window.__femalePreview;let triangles=0,meshes=0;p.model.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3}});return {meshes,triangles,clips:p.clips.map(c=>c.name),shaderErrors:p.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length}})()`));
 console.log(`Preview: ${url}`);
}finally{await page.close()}
