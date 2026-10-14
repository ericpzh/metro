import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor} from './browser-harness.mjs';
import {MODEL_LIBRARY} from '../model/src/characters/library.js';
const base=process.env.MODEL_PREVIEW_URL??'http://127.0.0.1:5175/',out=resolve('.preview/models/crossbody-straps');mkdirSync(out,{recursive:true});
const selected=process.argv.find(a=>a.startsWith('--variant='))?.slice(10);
const entries=MODEL_LIBRARY.filter(m=>m.bagType==='crossbody'&&(!selected||m.id===selected));assert(entries.length>0,'crossbody variant exists');
const page=await withPage({url:base,debugPort:9431,profile:resolve(`.preview/.chrome-crossbody-straps-${process.pid}`),windowSize:'1300,1000'});
try{
 for(const entry of entries)for(const age of [entry.adultEligible?'adult':null,entry.childEligible?'child':null].filter(Boolean)){
  const url=new URL(base);for(const [key,value] of Object.entries({character:entry.character,hair:entry.hair,bag:entry.bagStyle,age}))url.searchParams.set(key,value);
  await page.send('Page.navigate',{url:url.href});await waitFor(page.evaluate,'window.__modelReady&&!window.__modelPreview.loading&&document.querySelector("#status").textContent===""',{tries:150,every:200});
  for(const profile of [0,1,2])for(const time of [null,0,.28,.56,.84]){
   const report=await page.evaluate(`(async()=>{
    const p=window.__modelPreview,T={Vector3:p.camera.position.constructor};let strap;p.model.traverse(n=>{if(n.userData.carriedBag?.component==='strap')strap=n});
    if(${time}===null)p.stand();else{p.mixer.stopAllAction();p.mixer.clipAction(p.clips[${profile}]).play();p.state.walking=false;p.state.standing=false;p.setTime(${time})}
    const a=strap.geometry.attributes.position,canvas=document.createElement('canvas');canvas.width=p.renderer.domElement.width;canvas.height=p.renderer.domElement.height;const ctx=canvas.getContext('2d'),missing=[];let samples=0;
    const ring=strap.geometry.index.getX(2)-strap.geometry.index.getX(0),rows=a.count/ring;
    const pointAt=(row,fraction)=>{
     const i=row*ring,column=fraction*(ring/2-1),left=Math.floor(column),right=Math.ceil(column);
     const middle=j=>new T.Vector3().fromBufferAttribute(a,i+j).add(new T.Vector3().fromBufferAttribute(a,i+ring-1-j)).multiplyScalar(.5);
     return middle(left).lerp(middle(right),column-left);
    };
    for(const view of ['front','back','shoulder-side']){
     p.setView(view==='shoulder-side'?'side':view);if(view==='shoulder-side')p.camera.position.x=${entry.bagSide==='left'?5:-5};
     const target=1.30*p.model.scale.y;p.camera.zoom=4/p.model.scale.y;p.camera.position.y=target;p.controls.target.y=target;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera);
     ctx.drawImage(p.renderer.domElement,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
     for(let row=0;row<rows;row++){
      const i=row*ring,center=pointAt(row,.5);
      if(center.y<1.24||center.y>1.37)continue;
      if(view==='front'&&center.z<.11||view==='back'&&center.z>-.035||view==='shoulder-side'&&(center.z<-.025||center.z>.095))continue;
      for(const fraction of [.25,.5,.75]){
       const point=pointAt(row,fraction);strap.applyBoneTransform(i,point).applyMatrix4(strap.matrixWorld).project(p.camera);
       const x=Math.round((point.x+1)*canvas.width/2),y=Math.round((1-point.y)*canvas.height/2);let dark=false;
       // One pixel of tolerance handles rasterization of the thin crown edge;
       // the centimetre-scale gaps in the shoulder remain clearly detectable.
       for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const k=((y+dy)*canvas.width+x+dx)*4;if(pixels[k+3]>=240&&pixels[k]<=145)dark=true}
       samples++;if(!dark)missing.push({view,row,fraction,x,y});
      }
     }
    }
    return {samples,missing};
   })()`);
   console.log(entry.id,age,profile,time,report);
   assert(report.samples>60,'front, rear and shoulder crown are sampled across their width');
   if(report.missing.length){const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${entry.id}-${age}-${profile}-${time??'stand'}-failure.png`),Buffer.from(shot.data,'base64'))}
   assert.equal(report.missing.length,0,`${entry.id}: shoulder strap must remain visible across its width in every gait`);
  }
 }
 console.log(selected?'Selected crossbody shoulder strap passes at every eligible age and walking profile.':'Crossbody shoulder straps pass: both sides, all hairstyles and eligible ages, front/rear/crown visibility, standing and every walking profile.');
}finally{await page.close()}
