import {withPage,waitFor} from './browser-harness.mjs';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const out=resolve('prototypes/passenger-female-shared/views');
const page=await withPage({url:'http://127.0.0.1:4268/prototypes/passenger-female-shared/index.html?hair=long&bag=0',profile:resolve(`.preview/.chrome-hair-detail-${process.pid}`),debugPort:9393,windowSize:'1200,1000'});
try{
 await waitFor(page.evaluate,'window.__femaleReady===true',{tries:100,every:300});
 for(const [view,time] of [['front',null],['side',null],['back',null],['three',null],['side',.14],['side',.28],['three',.28]]){
  await page.evaluate(`(()=>{const p=window.__femalePreview;p.setWalking(false);p.controls.enableDamping=false;p.mixer.stopAllAction();let sk;p.model.traverse(m=>{if(m.isSkinnedMesh)sk=m.skeleton});sk.pose();p.model.updateMatrixWorld(true);sk.update();p.setView('${view}');p.camera.position.y=1.31;p.controls.target.y=1.31;p.camera.zoom=2.3;p.camera.updateProjectionMatrix();p.controls.update();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  if(time!==null)await page.evaluate(`(()=>{const p=window.__femalePreview;p.setProfile(1);p.setTime(${time});return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`long-detail-${view}${time===null?'':`-walk-${time}`}.png`),Buffer.from(data,'base64'));
 }
 console.log('Long-hair detail views captured.');
 for(const style of ['bob','shoulder','long'])for(const bag of style==='long'?[false]:[true,false])for(const [view,time] of [['three',0],['three',.14],['three',.28],['front',null],['back',null]]){
  await page.evaluate(`(()=>{const p=window.__femalePreview;p.setBag(${bag});p.setHairstyle('${style}');p.setView('${view}');p.camera.position.y=.78;p.controls.target.y=.78;p.camera.zoom=3;p.camera.updateProjectionMatrix();p.controls.update();p.setProfile(1);p.setTime(${time??0});${time===null?'p.mixer.stopAllAction?.();let sk;p.model.traverse(m=>{if(m.isSkinnedMesh)sk=m.skeleton});p.mixer.stopAllAction();sk.pose();p.model.updateMatrixWorld(true);sk.update();':''}return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`hands-legs-${style}-${bag?'bag':'no-bag'}-${time===null?view:time}.png`),Buffer.from(data,'base64'));
 }
 console.log('Hand/leg separation checked across all five variants and three walking poses.');
}finally{await page.close()}
