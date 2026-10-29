import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {ACTIVITY_NAMES,packActivity} from '../game/src/sim/activities.ts';
import {SOFT_MODEL_LIBRARY as MODEL_LIBRARY} from '../model/src/soft-human/catalog.js';
import {emptyStation} from '../game/src/data/reference-station.ts';
import {buildGraph} from '../game/src/sim/station.ts';
const out=resolve('.preview/game-passenger-activities');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('game/dist'),4293);
const page=await withPage({url:'http://127.0.0.1:4293/?capture-passengers',profile:resolve('.preview/.chrome-game-activities'),debugPort:9403,windowSize:'1440,1000'});
try {
 await waitFor(page.evaluate,'window.__passengerCardsReady',{tries:160,every:250});
 const variants=[...['male','female'].map(character=>MODEL_LIBRARY.findIndex(m=>m.character===character&&!m.bag&&m.outfit==='commuter')),
  MODEL_LIBRARY.findIndex(m=>m.character==='male'&&m.bagStyle==='daypack'),
  MODEL_LIBRARY.findIndex(m=>m.character==='female'&&m.bagType==='purse'&&m.bagSide==='right'),
  MODEL_LIBRARY.findIndex(m=>m.character==='male'&&m.bagType==='crossbody'&&m.bagSide==='right'),
  MODEL_LIBRARY.findIndex(m=>m.character==='female'&&m.outfit&&m.garmentShape!=='trousers'),
  MODEL_LIBRARY.findIndex(m=>m.character==='male'&&m.outfit)];
 await page.evaluate('window.__activityCards=[];window.__activityErrors=[];const oldError=console.error;console.error=(...a)=>{window.__activityErrors.push(a.join(" "));oldError(...a)}');
 const report={captures:[],live:{}};
 for(const detail of ['full','low'])for(const age of ['adult','child'])for(let activity=1;activity<ACTIVITY_NAMES.length;activity++){
  const result=await page.evaluate(`(async()=>{
   const cards=window.__passengerCards.capturePassengers(${JSON.stringify({detail,age,activity,activityTime:activity===5||activity===6?2:activity===7||activity===14?1.1:4,cycleVariants:variants,cycleHeading:0,reuseContext:true})});
   const counts=[],opaque=[];
   for(const card of cards){const image=new Image();image.src=card.png;await image.decode();const c=document.createElement('canvas');c.width=card.width;c.height=card.height;const g=c.getContext('2d');g.drawImage(image,0,0);const p=g.getImageData(0,0,c.width,c.height).data;let count=0,filled=0;for(let i=3;i<p.length;i+=4){if(p[i]>10)count++;if(p[i]===255)filled++}counts.push(count);opaque.push(filled)}
   if(${detail==='full'&&age==='adult'})window.__activityCards.push(...cards);
   return {counts,opaque,diagnostics:window.__passengerCards.passengerCaptureDiagnostics()};
  })()`);
  assert(result.counts.every(n=>n>180),`${detail}/${age}/${activity}: missing body`);
  assert(result.opaque.every(n=>n>40),'body interiors are fully opaque in the actual framebuffer');
  assert.equal(result.diagnostics.shaderErrors,0);assert.equal(result.diagnostics.calls,1,'activities retain one instanced draw');
  assert.deepEqual(result.diagnostics.material,{opacity:1,transparent:false,depthWrite:true,depthTest:true},'every age/activity/LOD uses opaque depth-writing people');
  report.captures.push({detail,age,activity:ACTIVITY_NAMES[activity],...result});
 }
 const errors=await page.evaluate('window.__activityErrors');assert.deepEqual(errors,[]);
 const drape=await page.evaluate(`(async()=>{
  const measures=[],masks=[];window.__seatedSkirtCards=[];
  for(const time of [0,4]){
   const card=window.__passengerCards.capturePassengers({activity:1,activityTime:time,cycleView:'elevation',cycleHeading:0,cycleVariants:[${variants[5]}],reuseContext:true})[0];
   window.__seatedSkirtCards.push(card);const image=new Image();image.src=card.png;await image.decode();const canvas=document.createElement('canvas');canvas.width=card.width;canvas.height=card.height;const g=canvas.getContext('2d');g.drawImage(image,0,0);const pixels=g.getImageData(0,0,card.width,card.height).data;
   const mask=new Uint8Array(card.width*card.height);let left=card.width,right=0,sum=0,count=0;for(let y=0;y<card.height;y++)for(let x=0;x<card.width;x++){const i=(y*card.width+x)*4;if(pixels[i+2]>pixels[i]*1.15&&pixels[i+1]>pixels[i]*1.08&&pixels[i+3]>10){left=Math.min(left,x);right=Math.max(right,x);sum+=x;count++;mask[y*card.width+x]=1}}measures.push({width:right-left,center:sum/count,pixels:count});masks.push(mask);
  }
  let intersection=0,union=0;for(let i=0;i<masks[0].length;i++){intersection+=masks[0][i]&&masks[1][i];union+=masks[0][i]||masks[1][i]}return {standing:measures[0],seated:measures[1],overlap:intersection/union};
 })()`);
 for(const [i,card]of(await page.evaluate('window.__seatedSkirtCards')).entries())writeFileSync(resolve(out,`source-skirt-${i?'seated':'standing'}.png`),Buffer.from(card.png.split(',')[1],'base64'));
 assert(drape.standing.pixels>40&&drape.seated.pixels>40&&drape.overlap<.9,'the integrated skirt surface participates in the seated source pose');report.drape=drape;
 const details=await page.evaluate('window.__activityCards.filter(c=>c.view==="iso"&&[1,3,7,9,10].includes(c.activity)&&[3,5].includes('+JSON.stringify(variants)+'.indexOf(c.variant)))');
 for(const card of details)writeFileSync(resolve(out,`${card.activity}-${MODEL_LIBRARY[card.variant].id}.png`),Buffer.from(card.png.split(',')[1],'base64'));
 await page.evaluate(`(async()=>{document.body.style.cssText='margin:0;height:auto;overflow:visible;background:#eeefed;color:#444;font:14px system-ui';const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(7,192px);gap:8px';for(const card of window.__activityCards.filter(c=>c.view==='iso')){const item=document.createElement('div');const image=new Image();image.src=card.png;image.style.cssText='width:150px;height:200px';await image.decode();item.append(image);const label=document.createElement('div');label.textContent=${JSON.stringify(ACTIVITY_NAMES)}[card.activity];item.append(label);grid.append(item)}document.body.replaceChildren(grid);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
 const shot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(resolve(out,'activity-catalogue.png'),Buffer.from(shot.data,'base64'));
 await page.send('Page.navigate',{url:'http://127.0.0.1:4293/'});
 await waitFor(page.evaluate,'!!(window.__scene&&window.__metro?.getState().metrics)',{tries:160,every:250});
 const data=emptyStation('Activity integration');data.lines=[];
 for(let x=-2;x<18;x++)for(let y=-3;y<4;y++)data.cells.push({x,y,z:0,fill:'solid',zone:'unpaid'});
 data.modules=[['tvm',0],['vending',3],['bench',6],['shelf',9],['cubicle',12],['sink',15]].map(([type,x])=>({id:type,type,x,y:0,z:0,rot:0,w:1,cfg:{variant:type==='bench'?'steel-1':type==='shelf'?'white-tall':undefined}}));
 const graph=buildGraph(data),buffer=[];
 graph.stops.forEach((s,i)=>buffer.push(s.x,s.y,1,3,packActivity(s.activity,4,s.yaw),i+201));
 const live=await page.evaluate(`(async()=>{
  window.__metro.getState().setPlaying(false);Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='跳过')?.click();await new Promise(r=>setTimeout(r,100));const s=window.__scene;
  s.setStation(${JSON.stringify(data)});s.setLevel(0,false);s.setPlaying(true);
  const buffer=new Float32Array(${JSON.stringify(buffer)});s.setAgents(buffer,${buffer.length/6},1000);
  s.crowd.renderAgents(performance.now()+1000,undefined,true);s.setPlaying(false);
  s.cameraSys.controls.target.set(8,0,1);s.cameraSys.camera.position.set(17,-14,13);s.cameraSys.controls.update();s.requestRender();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const c=s.crowd,values=()=>[c.agents,c.agentsLow].flatMap(m=>Array.from(m.geometry.getAttribute('passengerActivity').array).slice(0,m.count*4));
  const before=values();c.renderAgents(performance.now()+5000,undefined,true);
  const after=values();
  const water=c.activitySinks.filter(s=>s.stream.visible).length;
  c.setPlaying(true);const walking=buffer.slice();walking[4*6+3]=1;walking[4*6+4]=0;c.setAgents(walking,6,1000);c.updateGates(1);
  const doorOpened=c.swingDoors.some(d=>Math.abs(d.pivot.rotation.z)>.5);
  c.setAgents(buffer,6,1000);c.updateGates(1);const occupiedDoorClosed=c.swingDoors.every(d=>Math.abs(d.pivot.rotation.z)<.001);c.setPlaying(false);
  return {count:c.agents.count+c.agentsLow.count,source:c.agentCount,activities:before.filter((_,i)=>i%4===0),pauseStable:JSON.stringify(before)===JSON.stringify(after),water,doorOpened,occupiedDoorClosed,shaderErrors:s.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length};
 })()`);
 assert.equal(live.count,buffer.length/6);assert.equal(live.pauseStable,true);assert.equal(live.shaderErrors,0);assert.equal(live.water,1);assert(live.doorOpened&&live.occupiedDoorClosed);report.live=live;
 const sceneShot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'fixtures.png'),Buffer.from(sceneShot.data,'base64'));
 writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log({captures:report.captures.length,live});
}finally{await page.close();server.close()}
