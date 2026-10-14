import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor} from './browser-harness.mjs';
import {MODEL_LIBRARY} from '../model/src/characters/library.js';
const base=process.env.MODEL_PREVIEW_URL??'http://127.0.0.1:5175/',out=resolve('.preview/models/carried-bags');mkdirSync(out,{recursive:true});
const page=await withPage({url:base,debugPort:9421,profile:resolve(`.preview/.chrome-carried-check-${process.pid}`),windowSize:'1000,1000'});
try{
 const ready=()=>waitFor(page.evaluate,'window.__modelReady&&!window.__modelPreview.loading&&document.querySelector("#status").textContent===""',{tries:150,every:200});
 await ready();
 for(const entry of MODEL_LIBRARY.filter(m=>m.bagType)){
  const age=entry.adultEligible?'adult':'child',url=new URL(base);for(const [key,value] of Object.entries({character:entry.character,hair:entry.hair,bag:entry.bagStyle,age}))url.searchParams.set(key,value);
  await page.send('Page.navigate',{url:url.href});await ready();
  const download=await page.evaluate('document.querySelector("#download").getAttribute("href")');assert(download.endsWith(entry.file));
  const report=await page.evaluate(`(async()=>{
   const T=await import('/node_modules/three/build/three.module.js'),p=window.__modelPreview,meshes=[];p.model.traverse(m=>{if(m.userData.carriedBag)meshes.push(m)});
   const expected=${JSON.stringify(entry)},sign=expected.bagSide==='left'?-1:1,side=sign<0?'Left':'Right';
   if(meshes.length!==(expected.bagType==='shoulder'?2:3))throw Error('missing accessory or hidden opposite bag leaked into export');
   if(p.model.getObjectByName('Clean_backpack_panel')||p.model.getObjectByName('Backpack_strap_connectors'))throw Error('side bag still has backpack');
   const bag=meshes.find(m=>m.userData.carriedBag.component==='body'),handle=meshes.find(m=>m.userData.carriedBag.component==='handle');
   const joint=expected.bagType==='purse'?side+'Hand':'Spine';
   for(const mesh of meshes){
    const info=mesh.userData.carriedBag,a=mesh.geometry.attributes;if(info.type!==expected.bagType||info.side!==expected.bagSide)throw Error('wrong bag side/type');
    if(info.component==='strap')for(let i=0;i<a.position.count;i++)if(!Number.isFinite(a.position.getX(i)+a.position.getY(i)+a.position.getZ(i))||a.position.getY(i)<.98||a.position.getY(i)>1.43)throw Error('strap vertex escaped the shoulder-to-bag region');
    for(let i=0;i<a.position.count;i++){let sum=0;for(let k=0;k<4;k++){const weight=a.skinWeight.array[i*4+k],name=mesh.skeleton.bones[a.skinIndex.array[i*4+k]].name;sum+=weight;if(weight>.0001&&name!==joint&&!(expected.bagType==='shoulder'&&info.component==='strap'&&name===side+'Arm'))throw Error('bag attached to wrong limb')}if(Math.abs(sum-1)>.0001)throw Error('invalid weights')}
   }
   let gripIndex=0;if(handle){const a=handle.geometry.attributes.position;for(let i=1;i<a.count;i++)if(a.getY(i)>a.getY(gripIndex))gripIndex=i}
   const poses=[],v=new T.Vector3();
   for(const profile of [0,1,2])for(const time of [null,0,.28,.56,.84]){
    if(time===null)p.stand();else{p.mixer.stopAllAction();p.mixer.clipAction(p.clips[profile]).play();p.state.walking=false;p.state.standing=false;p.setTime(time)}
    p.model.updateMatrixWorld(true);const box=new T.Box3(),a=bag.geometry.attributes.position;
    for(const mesh of meshes)if(mesh.userData.carriedBag.component==='strap'){
     const positions=mesh.geometry.attributes.position,index=mesh.geometry.index,points=[];
     for(let i=0;i<positions.count;i++){const point=new T.Vector3().fromBufferAttribute(positions,i);mesh.applyBoneTransform(i,point).applyMatrix4(mesh.matrixWorld);points.push(point)}
     for(let i=0;i<index.count;i+=3){const ids=[0,1,2].map(j=>index.getX(i+j));for(let j=0;j<3;j++)if(points[ids[j]].distanceTo(points[ids[(j+1)%3]])>.1*Math.max(...p.model.scale.toArray()))throw Error('strap has stretched or dangling triangles')}
    }
    for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i);bag.applyBoneTransform(i,v).applyMatrix4(bag.matrixWorld);box.expandByPoint(v)}
    for(const mesh of meshes)if(mesh.userData.carriedBag.component==='flap'){
     const accessory=new T.Box3(),positions=mesh.geometry.attributes.position;
     for(let i=0;i<positions.count;i++){v.fromBufferAttribute(positions,i);mesh.applyBoneTransform(i,v).applyMatrix4(mesh.matrixWorld);accessory.expandByPoint(v)}
     const bodyCenter=box.getCenter(new T.Vector3()),flapCenter=accessory.getCenter(new T.Vector3());
     if(flapCenter.distanceTo(bodyCenter)>.085*Math.max(...p.model.scale.toArray()))throw Error('flap detached from bag body');
    }
    if(sign*box.getCenter(new T.Vector3()).x/p.model.scale.x<.20||box.min.y/p.model.scale.y<.30||box.max.y/p.model.scale.y>1.30)throw Error('bag crossed sides, reached floor, or moved above shoulder');
    if(time===null){
     const size=box.getSize(new T.Vector3()).divide(p.model.scale);
     if(size.z<size.x*2)throw Error('bag broad face must run along the side of the body');
     if(expected.bagType!=='purse'){
      const elbow=bag.skeleton.bones.find(b=>b.name===side+'Forearm').getWorldPosition(new T.Vector3());
      const outer=sign>0?box.max.x:-box.min.x,inner=sign>0?box.min.x:-box.max.x;
      if(outer>=sign*elbow.x-.005*p.model.scale.x||inner<.210*p.model.scale.x)throw Error('side bag must sit between torso and carrying arm');
     }
    }
    if(handle){v.fromBufferAttribute(handle.geometry.attributes.position,gripIndex);handle.applyBoneTransform(gripIndex,v).applyMatrix4(handle.matrixWorld);const hand=handle.skeleton.bones.find(b=>b.name===joint).getWorldPosition(new T.Vector3());if(v.distanceTo(hand)>.065*Math.max(...p.model.scale.toArray()))throw Error('purse handle detached from palm')}
    if(time===null||time===.56)for(const view of ['front','back','side','three','opposite-side','below-bag','below-shoulder']){
     p.setView(['opposite-side','below-bag','below-shoulder'].includes(view)?'side':view);
     if(view==='opposite-side')p.camera.position.x*=-1;
     if(view==='below-bag'){p.camera.position.set(sign*5,.25,3);p.controls.target.y=.9*p.model.scale.y}
     if(view==='below-shoulder'){p.camera.position.set(-sign*5,.7,.3);p.controls.target.y=1.3*p.model.scale.y}
     p.controls.update();p.renderer.render(p.scene,p.camera);
    }
    poses.push({profile,time,size:box.getSize(new T.Vector3()).toArray()});
   }
   const errors=p.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length;
   return {meshes:meshes.length,joint,poses:poses.length,shaderErrors:errors};
  })()`);
  assert.equal(report.shaderErrors,0);assert.equal(report.poses,15);console.log(entry.id,report);
  if(entry.hair==='bob'||entry.hair==='short')for(const view of ['front','three','side','back']){
   await page.evaluate(`(()=>{const p=window.__modelPreview;p.stand();p.setView('${view}');if('${view}'==='side'||'${view}'==='three')p.camera.position.x*= ${entry.bagSide==='left'?-1:1};p.camera.zoom=${age==='child'?1.6:1.35};p.camera.position.y=${age==='child'?.55:.85};p.controls.target.y=p.camera.position.y;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
   const shot=await page.send('Page.captureScreenshot',{format:'png',clip:{x:390,y:90,width:470,height:735,scale:1}});writeFileSync(resolve(out,`${entry.id}-${age}-${view}.png`),Buffer.from(shot.data,'base64'));
  }
 }
 // Direct links and selector choices enforce the same age/sex restrictions.
 for(const [age,character,styles] of [['child','female',['0','small','crossbody-left','crossbody-right']],['child','male',['0','small','crossbody-left','crossbody-right']],['adult','female',null],['adult','male',null]]){
  const url=new URL(base);url.searchParams.set('age',age);url.searchParams.set('character',character);url.searchParams.set('bag',character==='female'&&age==='adult'?'crossbody-left':'purse-left');
  await page.send('Page.navigate',{url:url.href});await ready();
  const state=await page.evaluate('({bag:window.__modelPreview.state.bag,choices:[...document.querySelector("#bag").options].map(o=>o.value)})');
  assert.equal(state.bag,false,'restricted direct links clear the bag');
  if(styles)assert.deepEqual(state.choices,styles);
  if(age==='adult')assert(state.choices.every(v=>character==='female'?!v.startsWith('crossbody-'):!v.startsWith('purse-')));
 }
 console.log('Carried bags pass: every hairstyle, both sides, sideways faces, placement between arm and torso, attached flaps, palm grip, no dangling strap triangles, all three walks, seven views including underside, downloads, age/sex rules and WebGL.');
}finally{await page.close()}
