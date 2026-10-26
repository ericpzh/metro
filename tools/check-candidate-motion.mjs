import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/human-candidates/motion');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4291);let page;const results=[];
try{
 page=await withPage({url:'http://127.0.0.1:4291/candidates.html?mode=animated',profile:resolve('.preview/.chrome-candidate-motion'),debugPort:9421,windowSize:'1440,1000'});
 const ready=()=>waitFor(page.evaluate,'window.__candidatePreview?.ready',{tries:120,every:250,what:'motion rig'});await ready();const entries=await page.evaluate('window.__candidatePreview.entries');
 for(const entry of entries.filter(entry=>!process.env.CANDIDATE_FILTER||entry.id===process.env.CANDIDATE_FILTER)){
  await page.evaluate(`(()=>{const e=document.querySelector('#candidate');e.value=${JSON.stringify(entry.id)};e.dispatchEvent(new Event('change'))})()`);await ready();
  const report=await page.evaluate(`(()=>{
   const p=window.__candidatePreview,rows=[];const bones=()=>{const values=[];p.root.traverse(n=>{if(n.isBone)values.push(...n.position.toArray(),...n.quaternion.toArray())});return values};
   for(const id of ['slow','medium','fast']){
    let error=0,stanceError=0,maxExtent=0;const start=p.poseMotion(id,0),a=bones(),duration=1.12;
    for(let i=0;i<24;i++){
     const time=i/24*duration,r=p.poseMotion(id,time);
     for(let side=0;side<2;side++){error=Math.max(error,Math.hypot(...r.feet[side].map((v,j)=>v-r.targets[side][j])));const phase=(r.phase+side*.5)%1;if(phase<.5)stanceError=Math.max(stanceError,Math.abs(r.feet[side][1]-start.targets[side][1]),Math.abs((r.feet[side][2]+phase*r.stride)-(start.targets[side][2]+(side?.5:0)*r.stride)))}
     if(i%6===0)p.root.traverse(mesh=>{if(!mesh.isMesh||!mesh.visible)return;const point=p.camera.position.clone();for(let vertex=0;vertex<mesh.geometry.attributes.position.count;vertex+=Math.max(1,Math.floor(mesh.geometry.attributes.position.count/256))){mesh.getVertexPosition(vertex,point);point.applyMatrix4(mesh.matrixWorld);maxExtent=Math.max(maxExtent,Math.abs(point.x),Math.abs(point.y),Math.abs(point.z))}});
     if(!bones().every(Number.isFinite))throw Error('Nonfinite bone pose');
    }
    p.poseMotion(id,duration);const b=bones();rows.push({id,error,stanceError,stride:start.stride,maxExtent,loopError:Math.max(...a.map((v,i)=>Math.abs(v-b[i])))});
   }
   const renderHash=(time)=>{p.poseMotion('medium',time);p.renderer.render(p.scene,p.illustrationCamera);const gl=p.renderer.getContext(),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let hash=2166136261;for(let i=0;i<pixels.length;i+=41)hash=Math.imul(hash^pixels[i],16777619);return hash};
   return {id:p.selected.id,rows,hashA:renderHash(0),hashB:renderHash(.28),errors:p.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length,status:document.querySelector('#status').textContent,shaderLogs:p.renderer.info.programs.map(program=>program.diagnostics?.fragmentShader?.log).filter(Boolean)};
  })()`);
  const arms=await page.evaluate(`(()=>{
   const p=window.__candidatePreview,tracks=[[],[]];
   for(let i=0;i<24;i++){const r=p.poseMotion('medium',i/24*1.12);for(let side=0;side<2;side++)tracks[side].push(r.hands[side])}
   let projectedMaps=0,finiteUV=true;p.root.traverse(mesh=>{if(!mesh.isMesh||!mesh.visible)return;for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(mat.map?.image?.src?.includes('/studies/'))projectedMaps++;const uv=mesh.geometry.attributes.uv;if(uv)finiteUV&&=Array.from(uv.array).every(Number.isFinite)});
   return {library:p.motion.library,ranges:tracks.map(points=>Math.max(...points.map(point=>point[0]))-Math.min(...points.map(point=>point[0]))),travel:tracks.map(points=>Math.max(...points.map(point=>point[2]))-Math.min(...points.map(point=>point[2]))),projectedMaps,finiteUV};
  })()`);
  if(process.env.CANDIDATE_FILTER)console.log(JSON.stringify(arms));
  assert(arms.library?.mapped.length>=12,entry.id+' uses authored Quaternius upper-body animation');
  assert(arms.travel.every(range=>range>.03),entry.id+' authored arms swing through a walking cycle');
  assert.equal(arms.projectedMaps,0,entry.id+' no snapshot background or occluding hand can be projected onto its body');assert(arms.finiteUV);
  report.arms=arms;
  assert.equal(report.status,'');assert.equal(report.errors,0,JSON.stringify(report.shaderLogs));assert.notEqual(report.hashA,report.hashB,entry.id+' rendered limbs move');
  for(const row of report.rows){assert(row.maxExtent<(entry.height??1.75)*1.25,entry.id+' retarget preserves body scale');assert(row.error<.001,entry.id+' foot IK: '+row.error);assert(row.loopError<1e-5,entry.id+' loop closure');assert(row.stanceError<.001,entry.id+' stance foot velocity/contact: '+row.stanceError)}
  assert(report.rows[0].stride<report.rows[1].stride&&report.rows[1].stride<report.rows[2].stride);
  for(const angle of [0,2,4,8]){await page.evaluate(`(()=>{const e=document.querySelector('#live-angle');e.value=${angle};e.dispatchEvent(new Event('input'));const p=window.__candidatePreview;p.renderer.render(p.scene,p.illustrationCamera)})()`);const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,entry.id+'-'+angle+'.png'),Buffer.from(shot.data,'base64'))}
  results.push(report);console.log(entry.id+' motion passed');
 }
 writeFileSync(resolve(out,'report.json'),JSON.stringify(results,null,2));console.log('All 14 rigs: slow/medium/fast foot contact and speed, loop closure, finite joints, moving rendered pixels and shaders passed.');
}finally{await page?.close();server.close()}
