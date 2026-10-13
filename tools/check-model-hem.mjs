import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor,serveDir} from './browser-harness.mjs';
const out=resolve('.preview/models/hem-cleanup');mkdirSync(out,{recursive:true});
const fresh=process.argv.includes('--source'),server=fresh?await serveDir(resolve('prototypes/trellis-passenger'),4294):null;
server?.prependListener('request',(_,res)=>res.setHeader('Access-Control-Allow-Origin','*'));
const page=await withPage({url:'http://127.0.0.1:5175/?bag=small',profile:resolve(`.preview/.chrome-hem-${process.pid}`),debugPort:9393,windowSize:'1100,900'});
try{
 await waitFor(page.evaluate,'window.__modelReady===true',{tries:100,every:200});
 const variants=fresh?[['male','1'],['female','small']]:['male','female'].flatMap(character=>['1','small','0'].map(bag=>[character,bag]));
 for(const [character,bag] of variants){
  if(fresh)await page.evaluate(`(async()=>{
   const p=window.__modelPreview;p.stand();p.scene.remove(window.__hemRig?.model??p.model);
   const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),{createFemaleVariant}=await import('/src/characters/female.js'),{trimCoatUnderStraps}=await import('/src/characters/strap-surface.js'),{createWalkClips}=await import('/src/animation/walk-clips.js'),T=await import('/node_modules/three/build/three.module.js');
   const source=await new GLTFLoader().loadAsync('http://127.0.0.1:4294/passenger-b-walk-forward.glb');let rig;
   if(${character==='male'}){const {smoothShoulders}=await import('/src/characters/shoulders.js');smoothShoulders(source.scene);let body;source.scene.traverse(m=>{if(m.userData.coatInterior)body=m});rig={model:source.scene,body}}
   else{rig=createFemaleVariant(source.scene);rig.setBag('small');rig.setHairstyle('bob')}
   rig.body.geometry=trimCoatUnderStraps(rig.body,rig.model.getObjectByName('Backpack_strap_connectors'));p.scene.add(rig.model);window.__hemRig=rig;window.__hemModel=rig.model;window.__hemClips=createWalkClips(rig.model,await(await fetch('/models/walk-profiles.json')).json());window.__hemMixer=new T.AnimationMixer(rig.model);
  })()`);
  else{
   await page.evaluate(`(()=>{const e=document.querySelector('#character');e.value='${character}';e.dispatchEvent(new Event('change'))})()`);await waitFor(page.evaluate,'!window.__modelPreview.loading',{tries:100,every:200});
   await page.evaluate(`(()=>{const e=document.querySelector('#bag');e.value='${bag}';e.dispatchEvent(new Event('change'))})()`);await waitFor(page.evaluate,'!window.__modelPreview.loading',{tries:100,every:200});
   await page.evaluate('(()=>{window.__modelPreview.stand();window.__hemModel=window.__modelPreview.model;window.__hemClips=window.__modelPreview.clips;window.__hemMixer=window.__modelPreview.mixer})()');
  }
  const report=await page.evaluate(`(async()=>{
   const T=await import('/node_modules/three/build/three.module.js'),model=window.__hemModel,mixer=window.__hemMixer;let body;model.traverse(m=>{if(m.userData.coatInterior&&!body)body=m});const a=body.geometry.attributes,skeleton=body.skeleton,spine=skeleton.bones.findIndex(b=>b.name==='Spine'),coat=new T.Color().setRGB(${character==='male'?.66:.74},${character==='male'?.66:.74},${character==='male'?.66:.74},T.SRGBColorSpace).r,shirt=new T.Color().setRGB(${character==='male'?.89:.62},${character==='male'?.89:.62},${character==='male'?.89:.62},T.SRGBColorSpace).r,hem=[],sleeves=[];
   for(let i=0;i<a.position.count;i++){
    const x=Math.abs(a.position.getX(i)),y=a.position.getY(i);if(y<.81||y>.92||Math.abs(a.color.getX(i)-coat)>.001)continue;
    if(x>.12&&x<.195)hem.push(i);else if(x>.255)sleeves.push(i);
   }
   const hips=skeleton.bones.findIndex(b=>b.name==='Hips'),waistInk=new T.Color().setRGB(${character==='male'?.53:.48},${character==='male'?.53:.48},${character==='male'?.53:.48},T.SRGBColorSpace).r,waist=[];
   for(let i=0;i<a.position.count;i++)if(a.position.getY(i)>.80&&a.position.getY(i)<.824&&Math.abs(a.color.getX(i)-waistInk)<.001)waist.push(i);
   let maxDrift=0,maxWaistDrift=0,sleeveMotion=0;const checks=[];
   for(const clip of window.__hemClips)for(const t of [0,.28,.56,.84]){
    mixer.stopAllAction();mixer.clipAction(clip).play();mixer.setTime(t);model.updateMatrixWorld(true);skeleton.update();const inverse=skeleton.bones[spine].matrixWorld.clone().multiply(skeleton.boneInverses[spine]).invert();
    for(const i of hem){const rest=new T.Vector3().fromBufferAttribute(a.position,i),posed=body.applyBoneTransform(i,rest.clone()).applyMatrix4(inverse);maxDrift=Math.max(maxDrift,rest.distanceTo(posed))}
    const hipInverse=skeleton.bones[hips].matrixWorld.clone().multiply(skeleton.boneInverses[hips]).invert();for(const i of waist){const rest=new T.Vector3().fromBufferAttribute(a.position,i),posed=body.applyBoneTransform(i,rest.clone()).applyMatrix4(hipInverse);maxWaistDrift=Math.max(maxWaistDrift,rest.distanceTo(posed))}
    for(const i of sleeves){const rest=new T.Vector3().fromBufferAttribute(a.position,i),posed=body.applyBoneTransform(i,rest.clone()).applyMatrix4(inverse);sleeveMotion=Math.max(sleeveMotion,rest.distanceTo(posed))}
    checks.push([clip.name,t]);
   }
   mixer.stopAllAction();skeleton.pose();model.updateMatrixWorld(true);skeleton.update();
   const geometry=body.geometry.clone(),positions=geometry.attributes.position;for(let i=0;i<positions.count;i++){const v=new T.Vector3().fromBufferAttribute(positions,i);body.applyBoneTransform(i,v).applyMatrix4(body.matrixWorld);positions.setXYZ(i,...v.toArray())}geometry.computeBoundingBox();geometry.computeBoundingSphere();const surface=new T.Mesh(geometry,body.material),ray=new T.Raycaster(),strip=[];
   for(const x of [-.065,-.035,0,.035,.065])for(const y of [.835,.84,.85]){ray.set(new T.Vector3(x,y,1),new T.Vector3(0,0,-1));const h=ray.intersectObject(surface)[0];if(!h||Math.abs(a.color.getX(h.face.a)-shirt)>.001)strip.push({x,y,color:h?a.color.getX(h.face.a):null})}geometry.dispose();
   return {hemVertices:hem.length,maxDrift,waistVertices:waist.length,maxWaistDrift,sleeveMotion,strip,checks:checks.length};
  })()`);
  console.log(character,bag,report);assert(report.hemVertices>500,'sample both lower coat panels');assert(report.maxDrift<1e-6,'hem stays at its rest position relative to torso during all walks');assert(report.waistVertices>500,'sample the trouser waist beside both hands');assert(report.maxWaistDrift<1e-6,'waist remains attached to hips, independently of arm movement');assert(report.sleeveMotion>.01,'sleeves still follow the arms');assert.deepEqual(report.strip,[],'lining does not emerge beneath the front shirt');
  for(const [profile,time] of [[-1,0],[2,0],[2,.28],[2,.56],[2,.84]])for(const view of ['front','three','hem']){
   const png=await page.evaluate(`(()=>{const p=window.__modelPreview,m=window.__hemMixer,model=window.__hemModel;m.stopAllAction();if(${profile}<0){let s;model.traverse(n=>{if(n.isSkinnedMesh)s=n.skeleton});s.pose()}else{m.clipAction(window.__hemClips[${profile}]).play();m.setTime(${time})}model.updateMatrixWorld(true);p.setView('${view==='hem'?'three':view}');p.camera.zoom=3.3;p.camera.position.y=.94;p.controls.target.y=.94;if('${view}'==='hem'){p.camera.position.set(3,2.4,3);p.controls.target.set(0,.83,0);p.camera.zoom=5}p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera);return p.renderer.domElement.toDataURL('image/png').split(',')[1]})()`);
   writeFileSync(resolve(out,`${character}-${bag}-${view}-${profile<0?'stand':time}.png`),Buffer.from(png,'base64'));
  }
 }
 console.log('Hem cleanup passes: concealed lining, torso-fixed coat panels, moving sleeves, all three walks.');
}finally{await page.close();server?.close()}
