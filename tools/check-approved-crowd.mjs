import {withPage,waitFor,loadExampleStation} from './browser-harness.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('.preview/approved-crowd');mkdirSync(out,{recursive:true});
const page=await withPage({url:'http://127.0.0.1:4270/',profile:resolve(`.preview/.chrome-approved-crowd-${process.pid}`),debugPort:9392,windowSize:'1400,1000'});
try{
 await waitFor(page.evaluate,'!!(window.__scene&&window.__metro?.getState().metrics)',{what:'live station'});
 await loadExampleStation(page);
 await page.evaluate('window.__metro.getState().setSpeed(16);window.__metro.getState().setPlaying(true)');
 await waitFor(page.evaluate,'window.__scene.crowd.agentCount>20',{what:'live passengers',tries:120,every:250});
 console.log(await page.evaluate(`(()=>{const s=window.__metro.getState(),r=window.__scene;s.setPlaying(false);const c=r.crowd;let a=c.cur;for(let i=0;i<a.length;i+=6)if((a[i+3]===1||a[i+3]===2)){a=a.subarray(i);break}window.__approvedTarget=[a[0],a[1],a[2]];s.setActiveZ?.(Math.floor(a[2]/4)*4);s.setHideUI?.(true);return {firstAgent:Array.from(a.slice(0,6)),count:c.agentCount}})()`));
 await page.evaluate('new Promise(r=>setTimeout(r,1000))');
 await page.evaluate(`(()=>{const r=window.__scene,[x,y,z]=window.__approvedTarget;r.setOrtho(false);r.controls.target.set(x,y,z+.8);r.camera.position.set(x+4,y-5,z+3);r.controls.update();return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})()`);
 const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'station.png'),Buffer.from(data,'base64'));
 console.log(await page.evaluate(`(()=>{const r=window.__scene;return {passengers:r.crowd.agentCount,trianglesPerPassenger:r.crowd.agents.geometry.index.count/3,crowdDraws:1,shaderErrors:r.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length}})()`));
}finally{await page.close()}
