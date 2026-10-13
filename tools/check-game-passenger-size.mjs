import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/passenger-size');mkdirSync(out,{recursive:true});
const page=await withPage({url:'http://127.0.0.1:5174/?capture-passengers',profile:resolve(`.preview/.chrome-passenger-size-${process.pid}`),debugPort:9394,windowSize:'1250,700'});
try{
 await waitFor(page.evaluate,'!!window.__passengerCardsReady',{what:'passenger renderer'});
 const report=await page.evaluate(`(async()=>{
  const T=await import('/node_modules/three/build/three.module.js'),{CrowdSystem}=await import('/src/render/scene/systems/CrowdSystem.ts'),{passengerAppearance,PASSENGER_LIBRARY}=await import('/src/render/passengerModel.ts'),{passengerIsChild}=await import('/src/sim/walking.ts');
  const adults=[],used=new Set();
  const choose=(child,sex,target)=>{for(let id=0;id<10000;id++){const a=passengerAppearance(id),model=PASSENGER_LIBRARY[a[0]];if(!used.has(id)&&passengerIsChild(id)===child&&model.character===sex&&Math.abs(a[1]-target)<.015){used.add(id);return id}}throw new Error('no showcase identity')};
  for(let i=0;i<8;i++)adults.push(choose(false,i%2?'female':'male',.82+i*.36/7));
  const boy=choose(true,'male',.59),girl=choose(true,'female',.74),ids=[...adults.slice(0,2),boy,...adults.slice(2,5),girl,...adults.slice(5)];
  const scene=new T.Scene(),renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,400);renderer.setClearColor('#edefec');renderer.outputColorSpace=T.SRGBColorSpace;
  const blob=new T.MeshBasicMaterial({color:'#333333',transparent:true,opacity:.07,depthWrite:false}),ctx={scene,mats:{blob},activeZ:0,levelBase:0,ghost:false,hideUI:true,stateIntervalMs:1000},crowd=new CrowdSystem(ctx);
  const camera=new T.OrthographicCamera(-4.2,4.2,1.4,-1.4,.1,30);camera.up.set(0,0,1);camera.position.set(12,0,2);camera.lookAt(0,0,1);camera.updateMatrixWorld();
  crowd.setAgents(new Float32Array(ids.flatMap((id,i)=>[0,(i-4.5)*.78,0,2,0,id])),ids.length,1000);crowd.renderAgents(ctx.lastStateTime+1000);renderer.render(scene,camera);
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=440;const c=canvas.getContext('2d');c.fillStyle='#edefec';c.fillRect(0,0,1200,440);c.drawImage(renderer.domElement,0,0);c.fillStyle='#4d5350';c.font='15px sans-serif';c.textAlign='center';
  const people=ids.map((id,i)=>{const a=passengerAppearance(id),model=PASSENGER_LIBRARY[a[0]],child=passengerIsChild(id),p=new T.Vector3(0,(i-4.5)*.78,0).project(camera),label=child?(model.character==='male'?'Boy':'Girl'):'Adult';c.fillText(label,(p.x+1)*600,416);c.fillText((a[1]*1.72).toFixed(2)+' m',(p.x+1)*600,434);return {id,child,model:model.id,scale:a.slice(1,4)}});
  const shaderErrors=renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length,png=canvas.toDataURL('image/png').split(',')[1];crowd.dispose();blob.dispose();renderer.dispose();renderer.forceContextLoss();return {people,shaderErrors,png};
 })()`);
 assert.equal(report.people.filter(p=>p.child).length,2);assert.equal(report.shaderErrors,0);writeFileSync(resolve(out,'preview.png'),Buffer.from(report.png,'base64'));delete report.png;writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(report);
}finally{await page.close()}
