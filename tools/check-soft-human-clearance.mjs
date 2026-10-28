import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/soft-human/clearance');mkdirSync(out,{recursive:true});const server=await serveDir(resolve('model/dist'),4289);let page;
try{
 page=await withPage({url:'http://127.0.0.1:4289/soft-human.html',profile:resolve(`.preview/.chrome-soft-clearance-${process.pid}`),debugPort:9429,windowSize:'1440,1000'});
 await waitFor(page.evaluate,'window.__softHuman?.ready',{what:'soft clearance',tries:100,every:250});await page.evaluate("document.querySelector('#play').click()");
 await page.evaluate(`window.__collisionSampleCache=new WeakMap();window.__measurePenetration=()=>{
  const p=window.__softHuman,c=p.character,colliders=[],v=c.body.position.clone(),m=c.body.matrixWorld.clone(),epsilon=.002;
  p.equipment.root.updateMatrixWorld(true);c.body.updateMatrixWorld(true);c.body.skeleton.update();
  p.equipment.root.traverseVisible(o=>{if(!o.isMesh||['interaction-water','sink-water'].includes(o.name)||!(['BoxGeometry','TorusGeometry','LatheGeometry','CylinderGeometry','TubeGeometry'].includes(o.geometry.type)||(o.geometry.type==='ExtrudeGeometry'&&['escalator-balustrade','undercroft','landing-deck'].includes(o.name))))return;const g=o.geometry;g.computeBoundingBox();for(let i=0;i<(o.isInstancedMesh?o.count:1);i++){m.copy(o.matrixWorld);if(o.isInstancedMesh){const instance=m.clone();o.getMatrixAt(i,instance);m.multiply(instance)}colliders.push({mesh:o.name||o.uuid,type:g.type,parameters:g.parameters,plane:o.name==='escalator-balustrade'?'xz':'xy',polygon:g.type==='ExtrudeGeometry'?g.parameters.shapes.getPoints(48):null,path:g.type==='TubeGeometry'?g.parameters.path.getPoints(64):null,box:g.boundingBox.clone(),world:g.boundingBox.clone().applyMatrix4(m),inverse:m.clone().invert()})}});
  function contains(d,q){const a=d.parameters;if(d.type==='TorusGeometry'){const yAxis=d.box.max.y-d.box.min.y<d.box.max.z-d.box.min.z;return Math.hypot((yAxis?Math.hypot(q.x,q.z):Math.hypot(q.x,q.y))-a.radius,yAxis?q.y:q.z)<a.tube-epsilon;}if(d.type==='TubeGeometry'){for(let i=1;i<d.path.length;i++){const start=d.path[i-1],end=d.path[i],dx=end.x-start.x,dy=end.y-start.y,dz=end.z-start.z,t=Math.max(0,Math.min(1,((q.x-start.x)*dx+(q.y-start.y)*dy+(q.z-start.z)*dz)/(dx*dx+dy*dy+dz*dz)));if(Math.hypot(q.x-start.x-t*dx,q.y-start.y-t*dy,q.z-start.z-t*dz)<a.radius-epsilon)return true}return false}if(d.type==='ExtrudeGeometry'){const u=q.x,v=d.plane==='xz'?q.z:q.y,thickness=d.plane==='xz'?q.y:q.z,lo=d.plane==='xz'?d.box.min.y:d.box.min.z,hi=d.plane==='xz'?d.box.max.y:d.box.max.z;if(thickness<=lo+epsilon||thickness>=hi-epsilon)return false;let inside=false;for(let i=0,j=d.polygon.length-1;i<d.polygon.length;j=i++){const b=d.polygon[i],c=d.polygon[j];if((b.y>v)!==(c.y>v)&&u<(c.x-b.x)*(v-b.y)/(c.y-b.y)+b.x)inside=!inside}return inside}if(d.type==='LatheGeometry'){const r=Math.hypot(q.x,q.y),z=q.z,poly=a.points;let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const b=poly[i],c=poly[j];if((b.y>z)!==(c.y>z)&&r<(c.x-b.x)*(z-b.y)/(c.y-b.y)+b.x)inside=!inside}return inside}if(d.type==='CylinderGeometry')return Math.abs(q.y)<a.height/2-epsilon&&Math.hypot(q.x,q.z)<Math.min(a.radiusTop,a.radiusBottom)-epsilon;return q.x>d.box.min.x+epsilon&&q.x<d.box.max.x-epsilon&&q.y>d.box.min.y+epsilon&&q.y<d.box.max.y-epsilon&&q.z>d.box.min.z+epsilon&&q.z<d.box.max.z-epsilon}
  let samples=window.__collisionSampleCache.get(c.body.geometry);if(!samples){samples=[];const seen=new Set(),a=c.body.geometry.attributes;for(let i=0;i<a.position.count;i++){const key=[...a.position.array.slice(i*3,i*3+3),...a.skinIndex.array.slice(i*4,i*4+4),...a.skinWeight.array.slice(i*4,i*4+4)].map(v=>v.toFixed(6)).join(',');if(!seen.has(key)){seen.add(key);samples.push(i)}}window.__collisionSampleCache.set(c.body.geometry,samples)}let count=0;const hits=[],local=v.clone();for(const i of samples){c.body.getVertexPosition(i,v).applyMatrix4(c.body.matrixWorld);for(const d of colliders){if(!d.world.containsPoint(v))continue;local.copy(v).applyMatrix4(d.inverse);if(contains(d,local)){count++;if(hits.length<8)hits.push({i,mesh:d.mesh,type:d.type,point:v.toArray()});break}}}return {count,hits,colliders:colliders.length,bodySamples:samples.length};
 }`);
 const report=[];
 const actions=process.argv.includes('--wash')?['wash']:process.argv.includes('--escalators')?['escalator','escalator-left']:process.argv.includes('--seated')?['sit','toilet']:process.argv.includes('--all')?await page.evaluate('window.__softHuman.actions.filter(a=>a.activity).map(a=>a.id)'):['sit','toilet','escalator','escalator-left'];
 for(const age of ['adult','child'])for(const action of actions){
  const duration=await page.evaluate(`(()=>{const p=window.__softHuman;p.character.setAge('${age}');p.wardrobe.set('stripe','crossbody-right');p.character.cap.visible=true;p.selectAction('${action}');return p.actions.find(a=>a.id==='${action}').duration})()`);
  const samples=[];for(let t=0;t<duration;t+=process.argv.includes('--seated')?.125:.25){const result=await page.evaluate(`(()=>{const p=window.__softHuman;p.setTime(${t});return window.__measurePenetration()})()`);if(result.count)samples.push({t,...result})}
  report.push({age,action,samples});
  await page.evaluate("window.__softHuman.setTime(4)");
  for(const angle of [0,1.57,3.14]){await page.evaluate(`(()=>{const p=window.__softHuman,center=p.character.body.position.clone();center.y+=.85*p.character.body.scale.y;p.controls.target.copy(center);p.camera.position.copy(center).add({x:Math.sin(${angle})*2.6,y:.45,z:Math.cos(${angle})*2.6});p.controls.update();p.renderer.render(p.scene,p.camera)})()`);const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${age}-${action}-${angle}.png`),Buffer.from(shot.data,'base64'))}
  if(process.argv.includes('--seated'))for(const t of [0,.9,1.3,1.8,2.5,8.5,9.3]){
   await page.evaluate(`(()=>{const p=window.__softHuman;p.setTime(${t});const center=p.character.body.position.clone();center.y+=.85*p.character.body.scale.y;p.controls.target.copy(center);p.camera.position.copy(center).add({x:3.2,y:.30,z:0});p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
   const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${age}-${action}-t-${t}.png`),Buffer.from(shot.data,'base64'));
  }
 }
 writeFileSync(resolve(out,process.argv.includes('--wash')?'wash-report.json':process.argv.includes('--escalators')?'escalators-report.json':process.argv.includes('--seated')?'seated-report.json':'report.json'),JSON.stringify(report,null,2));const failures=report.filter(r=>r.samples.length);console.log(JSON.stringify(report.map(r=>({age:r.age,action:r.action,badFrames:r.samples.length,first:r.samples[0]?{t:r.samples[0].t,count:r.samples[0].count,hit:r.samples[0].hits[0]}:null}))));assert.equal(failures.length,0,'body penetrates production equipment; see clearance report');
}finally{await page?.close();server.close()}







