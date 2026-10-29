// Production simulation -> six-float transfer -> instanced High/Low GPU draws.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import {World} from '../game/src/sim/world.ts';
import {createModule,addEquipment,toState} from '../game/src/build/model.ts';
import {AgentRenderState} from '../game/src/sim/types.ts';
import {passengerIsChild} from '../game/src/sim/walking.ts';
import {unpackActivity} from '../game/src/sim/activities.ts';
import {passengerAppearance,PASSENGER_LIBRARY} from '../game/src/render/passengerModel.ts';

const out=resolve('.preview/game-ramp-animation');mkdirSync(out,{recursive:true});
const cells=[];
for(const z of [-5,0])for(let x=-3;x<11;x++)for(let y=-2;y<12;y++) {
  if((z<0&&y<1)||(z===0&&y>8))cells.push({x,y,z,fill:'solid'});
}
let station=toState({name:'Ramp animation',seed:7,cells,modules:[],lines:[]});
for(const [type,x,width,dir] of [['escalator',0,1,'up'],['escalator',2,2,'down'],['stair-straight',6,2,'up']]) {
  station=addEquipment(station,createModule(type,x,0,-5,`${type}-${dir}`,0,width,dir));
}
const world=new World(station,7),riders=[];
let nextId=1;
for(const s of world.graph.servers.filter(s=>s.kind==='escalator'||s.kind==='stair')) {
  for(let i=0;i<4;i++) {
    const child=i%2===1,held=i<2;
    while(true) {
      const m=PASSENGER_LIBRARY[passengerAppearance(nextId)[0]];
      if(passengerIsChild(nextId)===child && (held?['purse','handbag'].includes(m.bagType):!m.bag))break;
      nextId++;
    }
    world.pool.nextId=nextId++;
    const g=world.graph,a=world.pool.spawn({origin:'',stops:[],dest:''},g.nodeX[s.node],g.nodeY[s.node],g.nodeZ[s.node],world.tick);
    world.serve(a,s);a.rideT=a.rideTotal*(.35+i*.14);riders.push(a);
  }
}
function frame() {
  world.tick++;
  for(const a of riders)world.stepRide(a);
  const buffer=new Float32Array(riders.length*6);world.writeTransfer(buffer);return [...buffer];
}
const before=frame(),after=frame(),stairIds=riders.filter(a=>a.rideWalking).map(a=>a.id);
for(let i=0;i<riders.length;i++)assert.equal(after[i*6+3],stairIds.includes(riders[i].id)?AgentRenderState.StairWalking:AgentRenderState.Riding);
const server=await serveDir(resolve('game/dist'),4295);
const page=await withPage({url:'http://127.0.0.1:4295/',profile:resolve('.preview/.chrome-ramp-animation'),debugPort:9405,windowSize:'1440,1000'});
const report={riders:riders.map((a,i)=>({id:a.id,child:passengerIsChild(a.id),stair:a.rideWalking,activity:unpackActivity(after[i*6+4])[0],model:PASSENGER_LIBRARY[passengerAppearance(a.id)[0]].id})),draws:[]};
try {
  await waitFor(page.evaluate,'!!(window.__scene&&window.__metro?.getState().metrics)',{tries:160,every:250});
  await page.evaluate(`(async()=>{
    window.__rampErrors=[];const old=console.error;console.error=(...a)=>{window.__rampErrors.push(a.join(' '));old(...a)};
    window.__metro.getState().setPlaying(false);Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='跳过')?.click();await new Promise(r=>setTimeout(r,100));
    window.__metro.getState().setHideUI(true);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const s=window.__scene;s.setStation(${JSON.stringify(station)});s.setLevel(0,true);s.setHideUI(true);s.setHideRoof(true);s.setHideGround(true);s.setOrtho(false);
    const camera=s.cameraSys.camera;camera.position.set(15,-12,10);camera.zoom=1.25;camera.updateProjectionMatrix();s.cameraSys.controls.target.set(3.5,4,-1);s.cameraSys.controls.enableDamping=false;s.cameraSys.controls.update();
  })()`);
  for(const quality of ['high','low']) {
    const draw=await page.evaluate(`(async()=>{
      const s=window.__scene,c=s.crowd;s.setGraphicsQuality('${quality}');s.setStaticDetail(${quality==='low'?'true':'false'});
      c.setPlaying(true);c.setAgents(new Float32Array(${JSON.stringify(before)}),${riders.length},1000);c.setAgents(new Float32Array(${JSON.stringify(after)}),${riders.length},1000);
      const start=s.ctx.lastStateTime;for(let i=0;i<=20;i++)c.renderAgents(start+i*50,undefined,true);c.setPlaying(false,start+1000);s.requestRender();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return {full:c.agents.count,low:c.agentsLow.count,poses:Array.from(c.renderedPoses.slice(0,${riders.length*4})),activities:Array.from(c.renderedActivities.slice(0,${riders.length*4})),shaderErrors:s.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length};
    })()`);
    assert.equal(draw.shaderErrors,0);assert.equal(draw.full+draw.low,riders.length);
    assert.equal(quality==='high'?draw.full:draw.low,riders.length);
    riders.forEach((a,i)=> {
      assert.ok(a.rideWalking?draw.poses[i*4+3]>.99:draw.poses[i*4+3]<.001,'stairs walk and escalators stand');
      if(!a.rideWalking)assert.ok([7,14].includes(draw.activities[i*4]),'no age or bag silently drops the rail pose');
      const model=PASSENGER_LIBRARY[passengerAppearance(a.id)[0]];
      if(!a.rideWalking&&['purse','handbag'].includes(model.bagType))assert.equal(Math.floor(draw.activities[i*4+3]/3),model.bagSide==='right'?2:1,'the carrying hand cannot reach for a belt');
    });
    report.draws.push({quality,...draw});
    const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${quality}.png`),Buffer.from(shot.data,'base64'));
  }
  assert.deepEqual(await page.evaluate('window.__rampErrors'),[]);
  writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));
  console.log({riders:riders.length,stairs:stairIds.length,children:riders.filter(a=>passengerIsChild(a.id)).length,draws:report.draws.map(({quality,full,low,shaderErrors})=>({quality,full,low,shaderErrors}))});
} finally {await page.close();server.close()}
