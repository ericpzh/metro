import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/models/bag-cleanup');mkdirSync(out,{recursive:true});
const page=await withPage({url:'http://127.0.0.1:5175/?bag=small',profile:resolve(`.preview/.chrome-pack-outline-${process.pid}`),debugPort:9394,windowSize:'1300,1000'});
try{
 await waitFor(page.evaluate,'window.__modelReady===true',{tries:100,every:200});
 async function select(id,value){await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.value='${value}';e.dispatchEvent(new Event('change'))})()`);await waitFor(page.evaluate,'!window.__modelPreview.loading',{tries:100,every:200})}
 for(const character of ['male','female'])for(const bag of ['1','small']){
  await select('character',character);await select('bag',bag);await select('profile','2');
  for(const time of [null,0,.28,.56,.84]){
   const report=await page.evaluate(`(async()=>{
    const T=await import('/node_modules/three/build/three.module.js'),p=window.__modelPreview;
    if(${time}===null)p.stand();else{p.mixer.stopAllAction();p.mixer.clipAction(p.clips[2]).play();p.state.walking=false;p.state.standing=false;p.setTime(${time})}
    p.setView('back');p.camera.zoom=2.7;p.camera.position.y=1.23;p.controls.target.y=1.23;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera);
    const s=p.model.getObjectByName('Backpack_strap_connectors'),a=s.geometry.attributes.position;
    const canvas=document.createElement('canvas');canvas.width=p.renderer.domElement.width;canvas.height=p.renderer.domElement.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(p.renderer.domElement,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let samples=0;const shards=[];
    for(let row=0;row<a.count/10;row++){
     const i=row*10,center=new T.Vector3().fromBufferAttribute(a,i+2).add(new T.Vector3().fromBufferAttribute(a,i+7)).multiplyScalar(.5);
     if(center.y<1.215||center.y>1.355||center.z>-.02)continue;
     // Sample within both edges, not only the old fit check's centre line.
     for(const j of [1,2,3]){
      const point=new T.Vector3().fromBufferAttribute(a,i+j).add(new T.Vector3().fromBufferAttribute(a,i+9-j)).multiplyScalar(.5);
      s.applyBoneTransform(i+j,point).applyMatrix4(s.matrixWorld).project(p.camera);
      const x=Math.round((point.x+1)*canvas.width/2),y=Math.round((1-point.y)*canvas.height/2),offset=(y*canvas.width+x)*4;
      samples++;if(pixels[offset+3]<240||pixels[offset]>145)shards.push([x,y,pixels[offset],pixels[offset+3]]);
     }
    }
    return {samples,shards};
   })()`);
   console.log(character,bag,time,report);
   assert(report.samples>40,'both upper rear ribbons are checked across their width');
   assert.equal(report.shards.length,0,'upper straps have no exposed pale coat triangles or background holes');
   for(const view of ['back','side','three']){
    await page.evaluate(`(()=>{const p=window.__modelPreview;p.setView('${view}');p.camera.zoom=2.7;p.camera.position.y=1.23;p.controls.target.y=1.23;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera)})()`);
    const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${character}-${bag}-${time??'stand'}-${view}.png`),Buffer.from(shot.data,'base64'));
   }
  }
 }
 console.log('Backpack outline passes: both sizes/sexes, upper strap edges and four moving arm phases.');
}finally{await page.close()}
