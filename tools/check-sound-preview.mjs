// Build with: node model/node_modules/vite/bin/vite.js build model
// Audits local audio decoding, live output/mute, lifecycle and responsive layout.
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const server=await serveDir(resolve('model/dist'),4189);
let page;
try {
 page=await withPage({url:'http://127.0.0.1:4189/sounds.html',profile:resolve('.preview/sound-research/browser'),debugPort:9397,windowSize:'1440,1150'});
 await page.send('Page.enable');
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));window.diag={contexts:[],active:new Set(),starts:[],cues:[],decodes:0};const AC=window.AudioContext;window.AudioContext=class extends AC{constructor(...args){super(...args);diag.contexts.push(this);this.analyser=this.createAnalyser();this.analyser.fftSize=2048;}createDynamicsCompressor(){const n=super.createDynamicsCompressor();n.connect(this.analyser);return n;}createBufferSource(){const n=super.createBufferSource();const start=n.start.bind(n);n.start=(...args)=>{diag.active.add(n);diag.starts.push(performance.now());let peak=0;for(let ch=0;ch<n.buffer.numberOfChannels;ch++){const samples=n.buffer.getChannelData(ch);for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]));}let rms=0;if(!n.loop){const w=Math.min(n.buffer.length,Math.round(n.buffer.sampleRate*.02));const energy=new Float64Array(n.buffer.length);for(let ch=0;ch<n.buffer.numberOfChannels;ch++){const samples=n.buffer.getChannelData(ch);for(let i=0;i<samples.length;i++)energy[i]+=samples[i]**2/n.buffer.numberOfChannels;}let sum=0;for(let i=0;i<energy.length;i++){sum+=energy[i];if(i>=w)sum-=energy[i-w];if(i>=w-1)rms=Math.max(rms,Math.sqrt(Math.max(0,sum)/w));}}diag.cues.push({rate:n.playbackRate.value,peak,rms});n.addEventListener('ended',()=>diag.active.delete(n));return start(...args);};return n;}async decodeAudioData(...args){const b=await super.decodeAudioData(...args);diag.decodes++;return b;}};`});
 await page.send('Page.reload');
 await waitFor(page.evaluate,`!!window.diag && !!document.querySelector('[data-effect]')`);
 const gesture=async expression=>{
  const r=await page.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;
 };
 const report={};
 report.initial=await page.evaluate(`({voices:diag.active.size,contexts:diag.contexts.length,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})`);
 report.firstClick=await gesture(`(async()=>{const t=performance.now();document.querySelector('[data-effect="0"]').click();while(!diag.starts.length)await new Promise(r=>setTimeout(r,5));return {ms:diag.starts[0]-t,state:diag.contexts[0].state};})()`);
 report.warmClick=await gesture(`(async()=>{const count=diag.starts.length,t=performance.now();document.querySelector('[data-effect="0"]').click();while(diag.starts.length===count)await new Promise(r=>setTimeout(r,5));return {ms:diag.starts.at(-1)-t,decodes:diag.decodes};})()`);
 report.allFiles=await gesture(`(async()=>{const manifest=(await Promise.all(['manifest.json','soft-manifest.json'].map(name=>fetch('./sounds/'+name).then(r=>r.json())))).flat();const result=[];for(const s of manifest){const b=await diag.contexts[0].decodeAudioData(await fetch('./sounds/'+s.file).then(r=>r.arrayBuffer()));let peak=0;const c=b.getChannelData(0);for(let i=0;i<c.length;i+=10)peak=Math.max(peak,Math.abs(c[i]));result.push({file:s.file,duration:b.duration,channels:b.numberOfChannels,peak});}return result;})()`);
 report.selected=[];
 for(let i=0;i<6;i++){
  report.selected.push(await gesture(`(async()=>{const before=diag.starts.length;document.querySelector('[data-effect="${i}"]').click();while(diag.starts.length===before)await new Promise(r=>setTimeout(r,5));return {label:document.querySelectorAll('.chosen-sound')[${i}].textContent,...diag.cues.at(-1)};})()`));
 }
 if(await page.evaluate(`document.querySelectorAll('#effects select').length`)!==0)throw Error('Alternative selection menus remain');
 if(report.selected.some(c=>c.peak>.501)||Math.abs(report.selected[2].rate-2**(-8/12))>.00001||Math.abs(report.selected[5].rate-2**(-5/12))>.00001)throw Error('Selected sound tuning did not reach playback');
 if(report.selected.some((cue,i)=>Math.abs(cue.rms-([.205,.115,.115,.23,.20,.115][i]))>.001))throw Error('Interaction cue levels are no longer balanced');
 await gesture(`document.getElementById('ambience').click()`);
 await waitFor(page.evaluate,`document.getElementById('ambience').textContent.includes('Stop scene')`);
 report.scene=await page.evaluate(`({voices:diag.active.size,loops:[...diag.active].filter(n=>n.loop).length,status:document.getElementById('status').textContent})`);
 report.signal=await page.evaluate(`new Promise(resolve=>setTimeout(()=>{const a=diag.contexts[0].analyser,buf=new Float32Array(a.fftSize);a.getFloatTimeDomainData(buf);resolve(Math.max(...buf.map(Math.abs)));},250))`);
 await gesture(`document.querySelector('[data-enable="master"]').click()`);
 report.muted=await page.evaluate(`new Promise(resolve=>setTimeout(()=>{const a=diag.contexts[0].analyser,buf=new Float32Array(a.fftSize);a.getFloatTimeDomainData(buf);resolve(Math.max(...buf.map(Math.abs)));},500))`);
 await gesture(`document.querySelector('[data-enable="master"]').click()`);
 report.camera=await page.evaluate(`(()=>{document.getElementById('motion').checked=false;const before=document.getElementById('distance-crowd').textContent;document.getElementById('height').value=45;document.getElementById('height').dispatchEvent(new Event('input'));return {before,after:document.getElementById('distance-crowd').textContent};})()`);
 report.speedTrials=[];
 for(const speed of [1,4,16,64]){
  const switchMs=await gesture(`(()=>{const start=performance.now();document.querySelector('[data-speed="${speed}"]').click();document.querySelector('[data-preset="rate"]').click();return performance.now()-start;})()`);
  await new Promise(r=>setTimeout(r,100));
  const trial=await page.evaluate(`({speed:${speed},rates:[...diag.active].filter(n=>n.loop).map(n=>n.playbackRate.value),selects:document.querySelectorAll('[data-tactic]').length})`);
  if(trial.rates.length!==3||trial.rates.some(rate=>rate!==speed)||trial.selects!==12)throw Error('Ambient full-speed tactic did not reach every layer');
  report.speedTrials.push({...trial,switchMs});
 }
 await gesture(`document.querySelector('[data-preset="game"]').click()`);
 await waitFor(page.evaluate,`[...diag.active].filter(n=>n.loop).length>=5 && [...diag.active].every(n=>n.playbackRate.value===1)`);
 report.approvedFastMix=await page.evaluate(`({loops:[...diag.active].filter(n=>n.loop).length,rates:[...diag.active].filter(n=>n.loop).map(n=>n.playbackRate.value)})`);
 await gesture(`document.querySelector('[data-preset="skip"]').click();document.querySelector('[data-solo="train"]').click()`);
 await new Promise(r=>setTimeout(r,350));
 report.skipping=await page.evaluate(`({loops:[...diag.active].filter(n=>n.loop).length,rates:[...diag.active].filter(n=>n.loop).map(n=>n.playbackRate.value),solo:document.querySelector('[data-solo="train"]').getAttribute('aria-pressed')})`);
 if(report.skipping.loops<5||report.skipping.loops>7||report.skipping.rates.some(rate=>rate!==1)||report.skipping.solo!=='true')throw Error('Pitch-preserving slices or solo control failed');
 report.trainPassMs=await gesture(`new Promise((resolve,reject)=>{document.getElementById('motion').checked=true;document.getElementById('motion').dispatchEvent(new Event('change'));document.getElementById('replay-pass').click();const start=performance.now();function check(){const elapsed=performance.now()-start;if(document.getElementById('pass-status').textContent.includes('Between trains'))resolve(elapsed);else if(elapsed>2000)reject(Error('Accelerated train did not leave'));else requestAnimationFrame(check);}requestAnimationFrame(check);})`);
 if(report.trainPassMs<600||report.trainPassMs>1100)throw Error('64× train pass did not follow simulation time');
 await gesture(`document.querySelector('[data-speed="1"]').click();document.querySelector('[data-preset="game"]').click();document.querySelector('[data-solo="train"]').click()`);
 for(let i=0;i<4;i++){await gesture(`document.querySelector('[data-scene="${i}"]').click()`);}
 await gesture(`document.getElementById('stop').click()`);
 await waitFor(page.evaluate,`diag.active.size===0`);
 report.stop=await page.evaluate(`diag.active.size`);
 await gesture(`document.getElementById('ambience').click();document.getElementById('stop').click()`);
 await new Promise(r=>setTimeout(r,350));report.cancel=await page.evaluate(`diag.active.size`);
 await waitFor(page.evaluate,`document.querySelectorAll('#music-tracks button').length===8`);
 report.music=[];
 for(let i=0;i<8;i++){
  await gesture(`document.querySelectorAll('#music-tracks button')[${i}].click()`);
  await waitFor(page.evaluate,`!document.getElementById('music-player').paused && document.getElementById('music-player').readyState>=2`);
  report.music.push(await page.evaluate(`({title:document.getElementById('music-now').textContent,duration:document.getElementById('music-player').duration})`));
 }
 await gesture(`document.getElementById('music-next').click()`);
 await waitFor(page.evaluate,`document.getElementById('music-now').textContent.startsWith('Dream Culture') && !document.getElementById('music-player').paused`);
 await gesture(`document.getElementById('music-player').playbackRate=16`);
 await waitFor(page.evaluate,`document.getElementById('music-now').textContent.startsWith('Skyline') && !document.getElementById('music-player').paused`);
 await gesture(`document.getElementById('music-player').playbackRate=1;document.getElementById('stop').click()`);
 if(!await page.evaluate(`document.getElementById('music-player').paused`))throw Error('Stop all did not pause music');
 if(report.music.some(t=>Math.abs(t.duration-90)>.2))throw Error('Music excerpt duration mismatch');
 await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}).then(r=>writeFileSync('.preview/sound-research/desktop.png',Buffer.from(r.data,'base64')));
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 report.mobile=await page.evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth})`);
 await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}).then(r=>writeFileSync('.preview/sound-research/mobile.png',Buffer.from(r.data,'base64')));
 report.errors=await page.evaluate('window.errors');
 await page.evaluate(`document.querySelector('[data-volume="effects"]').value=23;document.querySelector('[data-volume="effects"]').dispatchEvent(new Event('input'))`);
 await page.send('Page.reload');
 await waitFor(page.evaluate,`document.querySelector('[data-volume="effects"]')?.value==='23' && window.diag?.contexts.length===0`);
 report.persisted=await page.evaluate(`document.querySelector('[data-volume="effects"]').value`);
 report.persistedTactic=await page.evaluate(`document.querySelector('[data-tactic="train"][data-at-speed="64"]').value`);
 if(report.persistedTactic!=='skip')throw Error('Per-speed sound tactics were not restored');
 report.errors.push(...await page.evaluate('window.errors'));
 writeFileSync('.preview/sound-research/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(report.errors.length||report.initial.contexts!==0||report.scene.loops!==3||report.signal<=0||report.muted>0.001||report.cancel!==0||report.mobile.overflow||report.allFiles.some(f=>f.peak<=0))throw Error('Sound preview checks failed');
}finally{await page?.close();server.close();}
