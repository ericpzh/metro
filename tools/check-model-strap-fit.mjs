import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {withPage,waitFor} from './browser-harness.mjs';

const debugPort=Number(process.argv.find(a=>a.startsWith('--port='))?.split('=')[1]??9398);
const page=await withPage({url:'http://127.0.0.1:5175/?character=male&hair=short&bag=1',profile:resolve(`.preview/.chrome-straps-${process.pid}`),debugPort,windowSize:'1440,1000'});
try{
 await waitFor(page.evaluate,'window.__modelReady===true',{tries:100,every:200});
 const characterArg=process.argv.find(a=>a.startsWith('--character='))?.split('=')[1];
 const bagArg=process.argv.find(a=>a.startsWith('--bag='))?.split('=')[1];
 for(const character of characterArg?[characterArg]:['male','female']){
  await page.evaluate(`(()=>{const e=document.querySelector('#character');e.value='${character}';e.dispatchEvent(new Event('change'))})()`);
  await waitFor(page.evaluate,'!window.__modelPreview.loading',{tries:100,every:200});
  for(const bag of bagArg?[bagArg]:['1','small']){
  await page.evaluate(`(()=>{const e=document.querySelector('#bag');e.value='${bag}';e.dispatchEvent(new Event('change'))})()`);
  await waitFor(page.evaluate,'!window.__modelPreview.loading',{tries:100,every:200});
  for(const time of [null,0,.28,.56,.84]){
   const fit=await page.evaluate(`(async()=>{
    const T=await import('/node_modules/three/build/three.module.js'),p=window.__modelPreview;
    if(${time}===null)p.stand();else{p.mixer.stopAllAction();p.mixer.clipAction(p.clips[2]).play();p.state.walking=false;p.state.standing=false;p.setTime(${time});}
    p.model.updateMatrixWorld(true);
    const strap=p.model.getObjectByName('Backpack_strap_connectors');let body;
    p.model.traverse(m=>{if(m.userData.coatInterior&&!body)body=m});
    // Pose the surface once. Raycasting the full SkinnedMesh re-skins hundreds
    // of thousands of vertices for every probe, obscuring useful fit feedback.
    const backing=p.model.getObjectByName('Jacket_back_fill'),surfaces=[body,...(backing?[backing]:[])].map(mesh=>{
     const geometry=mesh.geometry.clone(),positions=geometry.attributes.position,v=new T.Vector3();
     for(let i=0;i<positions.count;i++){v.fromBufferAttribute(positions,i);mesh.applyBoneTransform(i,v).applyMatrix4(mesh.matrixWorld);positions.setXYZ(i,v.x,v.y,v.z)}
     geometry.computeBoundingBox();geometry.computeBoundingSphere();const surface=new T.Mesh(geometry,mesh.material);surface.userData.source=mesh;return surface;
    });
    const a=strap.geometry.attributes.position,ray=new T.Raycaster(),gaps=[];
    for(let i=0;i<a.count;i++)if(strap.skeleton.bones[strap.geometry.attributes.skinIndex.getX(i)].name!=='Spine')throw new Error('strap attached to an arm');
    for(let i=0;i<a.count;i+=60){
     const original=new T.Vector3();for(let j=0;j<10;j++)original.add(new T.Vector3().fromBufferAttribute(a,i+j).multiplyScalar(.1));
     if(original.z<-.09||original.y<.905||original.y>1.37)continue;
     const outward=new T.Vector3(original.x/.205,T.MathUtils.smoothstep(original.y,1.29,1.335),(original.z-.035)/.135).normalize();
     const center=strap.applyBoneTransform(i,original.clone()).applyMatrix4(strap.matrixWorld);
     const normal=strap.applyBoneTransform(i,original.clone().add(outward)).applyMatrix4(strap.matrixWorld).sub(center).normalize();
     ray.set(center.clone().addScaledVector(normal,.10),normal.clone().negate());
     const hit=ray.intersectObjects(surfaces,false).find(hit=>[hit.face.a,hit.face.b,hit.face.c].every(id=>{
      const mesh=hit.object.userData.source;let arms=0;for(let j=0;j<4;j++)if(/arm|hand/i.test(mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.array[id*4+j]].name))arms+=mesh.geometry.attributes.skinWeight.array[id*4+j];
      return arms<.005;
     }));
     if(hit)gaps.push({gap:center.clone().sub(hit.point).dot(normal),section:original.y>1.28?'shoulder':original.y<1.06?'lower':original.z<0?'rear':'front',...(center.clone().sub(hit.point).dot(normal)<-.0005?{center:original.toArray(),hit:hit.point.toArray(),color:body.geometry.attributes.color.getX(hit.face.a),vertices:[hit.face.a,hit.face.b,hit.face.c].map(id=>new T.Vector3().fromBufferAttribute(body.geometry.attributes.position,id).toArray())}:{})});
    }
    p.camera.zoom=2.7;p.camera.position.set(-3.7,1.23,-3.7);p.controls.target.set(0,1.23,0);p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera);
    for(const surface of surfaces)surface.geometry.dispose();
    return {samples:gaps.length,min:Math.min(...gaps.map(v=>v.gap)),max:Math.max(...gaps.map(v=>v.gap)),intersections:gaps.filter(v=>v.center),sections:Object.fromEntries(['front','shoulder','lower','rear'].map(section=>{const selected=gaps.filter(v=>v.section===section);return [section,{count:selected.length,min:Math.min(...selected.map(v=>v.gap)),max:Math.max(...selected.map(v=>v.gap))}]}))};
   })()`);
   console.log(character,bag,time,fit);
   assert(fit.samples>=8,'front straps are sampled along both sides');
   assert(fit.max<.012,'strap remains within 12 mm of the torso over its shoulder and lower return');
   assert(fit.sections.front.max<.005,'front webbing follows the chest within 5 mm');
   assert(fit.min>-.0005,'torso does not cut through the strap, including its shoulder and lower return');
   for(const section of ['front','shoulder','lower'])assert(fit.sections[section].count>=4,`${section} is checked on both sides`);
   const shot=await page.send('Page.captureScreenshot',{format:'png'});
   writeFileSync(resolve(`.preview/models/${character}-${bag}-strap-fit-${time??'stand'}.png`),Buffer.from(shot.data,'base64'));
  }
  }
 }
 console.log('Strap fit passes: both sides remain close to the coat in standing and four walking poses.');
}finally{await page.close()}
