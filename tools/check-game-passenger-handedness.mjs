import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
import human from '../game/src/assets/passenger-approved.json' with {type:'json'};

const out=resolve('.preview/game-passenger-handedness');mkdirSync(out,{recursive:true});
const variants=[human.library.findIndex(m=>!m.bag),...['purse','handbag'].flatMap(type=>['left','right'].map(side=>human.library.findIndex(m=>m.bagType===type&&m.bagSide===side)))];
assert.ok(variants.every(v=>v>=0));
const server=await serveDir(resolve('game/dist'),4297);
const page=await withPage({url:'http://127.0.0.1:4297/?capture-passengers',profile:resolve('.preview/.chrome-passenger-hands'),debugPort:9407,windowSize:'1440,1000'});
const report={cases:[],renders:0};
try {
 await waitFor(page.evaluate,'window.__passengerCardsReady',{tries:160,every:250});
 await page.evaluate('window.__handCards=[]');
 for(const detail of ['full','low'])for(const age of ['adult','child'])for(const action of [3,5,7,10,11])for(const variant of variants){
  const pair=[];
  for(const actionHand of ['right','left']){
   const options={detail,age,activity:action,activityTime:action===7?1.1:action===11?1.5:3,actionHand,cycleVariants:[variant],cycleHeading:0,reuseContext:true};
   const result=await page.evaluate(`(()=>{const cards=window.__passengerCards.capturePassengers(${JSON.stringify(options)});if(${detail==='full'&&age==='adult'&&variant===variants[0]})window.__handCards.push(...cards.filter(c=>c.view==='iso'));return {cards:cards.map(c=>({png:c.png,mode:c.actionHand})),diagnostics:window.__passengerCards.passengerCaptureDiagnostics()}})()`);
   assert.equal(result.diagnostics.shaderErrors,0);assert.equal(result.diagnostics.calls,1);
   assert.deepEqual(result.diagnostics.material,{opacity:1,transparent:false,depthWrite:true,depthTest:true});
   const model=human.library[variant],expected=model.bag?(model.bagSide==='right'?2:1):(actionHand==='right'?1:2);
   assert.ok(result.cards.every(c=>c.mode===expected),'a requested carrying hand must still select the free hand');
   pair.push(result.cards);report.renders+=result.cards.length;
  }
  const held=human.library[variant].bag;
  if(held)assert.deepEqual(pair[0],pair[1],'opposing hand preferences produce exactly the same free-hand pixels when carrying');
  else assert.ok(pair[0].some((card,i)=>card.png!==pair[1][i].png),'the actual GPU image must change when the action changes hands');
  report.cases.push({detail,age,action,variant,bag:human.library[variant].bagStyle,modes:pair.map(p=>p[0].mode)});
 }
 await page.evaluate(`(async()=>{document.body.style.cssText='margin:0;background:#eef0ee;color:#333;font:15px system-ui';const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(5,220px);gap:12px';for(const card of window.__handCards){const cell=document.createElement('div'),image=new Image();image.src=card.png;image.style.cssText='width:192px;height:256px';await image.decode();cell.append(image);const label=document.createElement('div');label.textContent='Action '+card.activity+' · '+(card.actionHand===1?'Right':'Left');cell.append(label);grid.append(cell)}document.body.replaceChildren(grid);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
 const shot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(resolve(out,'hands.png'),Buffer.from(shot.data,'base64'));
 writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log({cases:report.cases.length,renders:report.renders});
}finally{await page.close();server.close()}
