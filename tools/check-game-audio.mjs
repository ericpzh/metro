import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {sourceMix} from '../game/src/render/audioScene.ts'
import {createModule} from '../game/src/build/model.ts'
import {serveDir,withPage,waitFor} from './browser-harness.mjs'
const output=resolve('.preview/perf/game-audio');mkdirSync(output,{recursive:true})
const server=await serveDir(resolve('game/dist'),0);let page
try{
 page=await withPage({url:`http://127.0.0.1:${server.address().port}/en`,profile:resolve(output,'browser'),debugPort:9394,windowSize:'1440,1000'})
 await page.send('Page.enable')
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.audit={contexts:[],active:new Set(),events:[],errors:[],requests:[],bytes:new WeakMap(),gains:[]};addEventListener('error',e=>audit.errors.push(e.message));addEventListener('unhandledrejection',e=>audit.errors.push(String(e.reason)));const originalFetch=fetch;window.fetch=async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).includes('/audio/')){audit.requests.push(String(args[0]));const read=response.arrayBuffer.bind(response);response.arrayBuffer=async()=>{const bytes=await read();audit.bytes.set(bytes,String(args[0]));return bytes;};}return response;};const AC=AudioContext;window.AudioContext=class extends AC{constructor(...args){super(...args);audit.contexts.push(this);this.analyser=this.createAnalyser();this.analyser.fftSize=2048;}createGain(){const node=super.createGain();audit.gains.push(node);return node;}createDynamicsCompressor(){const node=super.createDynamicsCompressor();node.connect(this.analyser);return node;}async decodeAudioData(bytes){const buffer=await super.decodeAudioData(bytes);buffer.audioFile=audit.bytes.get(bytes);return buffer;}createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...args)=>{audit.active.add(source);audit.events.push({file:source.buffer.audioFile,loop:source.loop,time:performance.now(),dispatch:audit.lastDispatch});source.addEventListener('ended',()=>audit.active.delete(source));return start(...args);};return source;}};`})
 await page.send('Page.reload')
 await waitFor(page.evaluate,'!!window.audit && !!window.__scene && !!window.__metro?.getState().metrics')
 await page.evaluate(`(()=>{const scene=__scene,camera=scene.cameraSys,intersect=camera.raycaster.intersectObjects;let rays=0;camera.raycaster.intersectObjects=function(...args){rays++;return intersect.apply(this,args)};const dispatch=scene.withPointerPick;scene.withPointerPick=function(action){const record={start:performance.now(),rays:0,handlerMs:0},before=rays;audit.lastDispatch=record;try{return dispatch.call(this,action)}finally{record.rays=rays-before;record.handlerMs=performance.now()-record.start;}};})()`)
 const report={initial:await page.evaluate('({contexts:audit.contexts.length,voices:audit.active.size})')}
 await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
 const bench=createModule('bench',2,2,1,'audio-bench')
 await page.evaluate(`(()=>{const state=__metro.getState(),cells=[];for(let x=0;x<10;x++)for(let y=0;y<10;y++)cells.push({x,y,z:0,fill:'solid'});state.commit({...state.station,cells,modules:[${JSON.stringify(bench)}],lines:[]});__metro.setState({playing:false,activeZ:0,autoWalls:false,autoCeiling:false,cutaway:false,tool:'block',selected:null,past:[],future:[]});const scene=__scene;scene.setOrtho(false);const cs=scene.cameraSys;cs.controls.enableDamping=false;cs.camera.position.set(16,-14,18);cs.controls.target.set(4,4,1);cs.controls.update();cs.camera.updateMatrixWorld(true);})()`)
 const settle=()=>page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 await settle()
 const point=(x,y,z)=>page.evaluate(`(()=>{const cs=__scene.cameraSys,cam=cs.activeCamera(),rect=__scene.renderer.domElement.getBoundingClientRect(),v=cam.position.clone().set(${x},${y},${z}).project(cam);return{x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2};})()`)
 const click=async p=>{for(const type of ['mouseMoved','mousePressed','mouseReleased']){await page.send('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1})});await settle()}}
 const actions=[]
 async function act(tool,p,expected){
  await page.evaluate(`__metro.getState().setTool('${tool}')`);await settle()
  const before=await page.evaluate('audit.events.length');const start=performance.now();await click(p)
  try {await waitFor(page.evaluate,`audit.events.slice(${before}).some(e=>e.file?.endsWith('/${expected}.wav'))`,{tries:30,every:50,what:expected+' cue'})}catch(error){console.log(await page.evaluate(`JSON.stringify({events:audit.events,move:__metro.getState().moveDraft,notice:__metro.getState().notice,tool:__metro.getState().tool,selected:__metro.getState().selected})`));throw error;}
  const events=await page.evaluate(`audit.events.slice(${before}).filter(e=>!e.loop)`)
  assert.equal(events.length,1,tool+' should emit exactly one cue')
  assert.ok(events[0].dispatch.rays<=1,'audio must not introduce another scene pick')
  events[0].dispatchToSoundMs=events[0].time-events[0].dispatch.start
  actions.push({tool,expected,events,wallMs:performance.now()-start})
 }
 await act('block',await point(6.5,5.5,1),'place')
 assert.ok(await page.evaluate('__metro.getState().station.cells.some(c=>c.x===6&&c.y===5&&c.z===1)'))
 await act('select',await point(6.5,5.5,2),'select')
 await act('delete',await point(6.5,5.5,2),'delete')
 await act('pick',await point(2.5,2.5,1.4),'pick')
 await page.evaluate(`__metro.getState().cancelPick();__metro.getState().setTool('move')`);await settle();await page.evaluate(`__metro.getState().liftModule('audio-bench')`);await settle()
 await act('move',await point(4.5,2.5,1),'move')
 const blocker=createModule('bench',6,6,0,'blocker')
 await page.evaluate(`(()=>{const s=__metro.getState();s.commit({...s.station,modules:[...s.station.modules,${JSON.stringify(blocker)}]});})()`);await settle()
 await page.evaluate(`__metro.getState().liftModule('audio-bench')`);await settle()
 await act('move',await point(6.5,6.5,.7),'refused')
 await page.evaluate(`__metro.getState().cancelMove()`)
 report.actions=actions
 // Open settings using an actual pointer gesture; native range Home/End drives React.
 const settings=await page.evaluate(`(()=>{const r=document.querySelector('.settingsMenu summary').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`)
 await click(settings)
 report.labels=await page.evaluate(`Array.from(document.querySelectorAll('.settingsAudio input')).map(e=>e.getAttribute('aria-label'))`)
 assert.ok(JSON.stringify(report.labels)===JSON.stringify(['Sound effects','Ambient sound'])||JSON.stringify(report.labels)===JSON.stringify(['音效','环境音']))
 await page.evaluate(`document.querySelector('.settingsDropdown > button:last-child').click()`);await settle()
 report.otherLabels=await page.evaluate(`Array.from(document.querySelectorAll('.settingsAudio input')).map(e=>e.getAttribute('aria-label'))`)
 assert.notDeepEqual(report.labels,report.otherLabels)
 assert.ok(JSON.stringify([report.labels,report.otherLabels]).includes('Sound effects'))
 const beforeSettings=await page.evaluate('__metro.getState().version')
 async function range(index,key){await page.evaluate(`document.querySelectorAll('.settingsAudio input')[${index}].focus()`);for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key,code:key});await settle()}
 await range(0,'Home');await range(1,'Home')
 assert.equal(await page.evaluate('__metro.getState().version'),beforeSettings,'volume changes must not commit documents')
 await page.evaluate(`__metro.getState().setTool('select')`)
 const count=await page.evaluate('audit.events.length');await click(await point(7.5,5.5,1));await settle()
 assert.equal(await page.evaluate('audit.events.length'),count,'effects zero mutes subsequent cues')
 report.muted=await page.evaluate(`new Promise(r=>setTimeout(()=>{const a=audit.contexts[0].analyser,b=new Float32Array(a.fftSize);a.getFloatTimeDomainData(b);r(Math.max(...b.map(Math.abs)));},200))`)
 assert.ok(report.muted<.00001)
 // Restore ambient, then use real renderer buffers to audition all three source families.
 await click(settings);if(!await page.evaluate('document.querySelector(".settingsMenu").open'))await click(settings)
 await range(1,'End')
 const road=createModule('road',0,-5,0,'audio-road');road.d=160
 await page.evaluate(`(()=>{const s=__metro.getState();s.commit({...s.station,modules:[...s.station.modules,${JSON.stringify(road)}]});__scene.setSimClock(36000);__scene.setPlaying(true);const agents=[];for(let i=0;i<32;i++)agents.push(3+i%4,3+Math.floor(i/4)*.25,1,0,1,i+1);const feed=()=>{__scene.setAgents(new Float32Array(agents),32,1000);__scene.setTrains(new Float32Array([4,4,1,1,1,0,16777215,1,0,0]));};feed();window.audioFixtureTimer=setInterval(feed,100);})()`)
 await waitFor(page.evaluate,`audit.events.some(e=>e.file?.endsWith('/crowd.mp3'))`,{tries:60,every:100,what:'crowd bed'})
 await waitFor(page.evaluate,`audit.events.some(e=>e.file?.endsWith('/train.mp3'))`,{tries:60,every:100,what:'train bed'})
 await waitFor(page.evaluate,`audit.events.some(e=>e.file?.endsWith('/traffic.mp3'))`,{tries:60,every:100,what:'traffic bed'})
 report.ambient=await page.evaluate(`({loops:[...audit.active].filter(s=>s.loop).length,sources:audit.events.filter(e=>e.loop).map(e=>e.file)})`)
 assert.equal(report.ambient.loops,3)
 // Capture frames from the actual renderer; height must reduce the same crowd source gain.
 report.camera=await page.evaluate(`new Promise(resolve=>{const scene=__scene,original=scene.onAudioFrame,frames=[];scene.onAudioFrame=frame=>{original?.(frame);frames.push(frame);if(frames.length===1){const cs=scene.cameraSys;cs.camera.position.z+=100;cs.controls.target.z+=100;cs.controls.update();}else{scene.onAudioFrame=original;resolve(frames);}};})`)
 assert.ok(report.camera[1].position[2]>report.camera[0].position[2]+90)
 report.distanceGains=report.camera.map(frame=>{const source=frame.sources.find(s=>s.kind==='traffic');assert.ok(source);return sourceMix(frame.position,frame.right,source).gain})
 assert.ok(report.distanceGains[1]<report.distanceGains[0]*.5,'camera altitude reduces the same source gain')
 await page.evaluate('clearInterval(window.audioFixtureTimer)')
 await click(settings);if(!await page.evaluate('document.querySelector(".settingsMenu").open'))await click(settings)
 await range(1,'Home');await new Promise(r=>setTimeout(r,100))
 assert.equal(await page.evaluate('[...audit.active].filter(s=>s.loop).length'),0,'ambient mute releases its three voices')
 report.errors=await page.evaluate('audit.errors');assert.deepEqual(report.errors,[])
 report.requests=await page.evaluate('audit.requests')
 await page.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(resolve(output,'settings.png'),Buffer.from(r.data,'base64')))
 await page.send('Page.reload');await waitFor(page.evaluate,'!!window.__metro && !!window.__scene')
 report.persisted=await page.evaluate(`JSON.parse(localStorage.getItem('metro-game.audio'))`)
 assert.deepEqual(report.persisted,{effects:0,ambient:0})
 writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await page?.close();server.close()}
