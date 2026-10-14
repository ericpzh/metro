import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withPage,waitFor} from './browser-harness.mjs';
const out=resolve('.preview/models/shoulder-line');mkdirSync(out,{recursive:true});
const character=process.argv.find(a=>a.startsWith('--character='))?.split('=')[1];
const bag=process.argv.find(a=>a.startsWith('--bag='))?.split('=')[1];
const page=await withPage({url:'http://127.0.0.1:5175/?character=female&bag=standard-75',profile:resolve(`.preview/.chrome-shoulder-line-${process.pid}`),debugPort:9413,windowSize:'1200,1000'});
try{
 await waitFor(page.evaluate,'window.__modelReady===true');
 async function select(id,value){await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.value='${value}';e.dispatchEvent(new Event('change'))})()`);await waitFor(page.evaluate,'!window.__modelPreview.loading&&document.querySelector("#status").textContent===""')}
 for(const sex of character?[character]:['male','female'])for(const style of bag?[bag]:['1','small','standard-87.5','standard-75']){
  await select('character',sex);await select('bag',style);
  let worst=0;
  for(const profile of ['0','1','2']){
   await select('profile',profile);
   for(const time of [null,0,.28,.56,.84])for(const view of ['front','back']){
    const report=await page.evaluate(`(async()=>{
     const T=await import('/node_modules/three/build/three.module.js'),p=window.__modelPreview;
     if(${time}===null)p.stand();else{p.mixer.stopAllAction();p.mixer.clipAction(p.clips[${profile}]).play();p.state.walking=false;p.state.standing=false;p.setTime(${time})}
     p.setView('${view}');p.camera.zoom=4;p.camera.position.y=1.32;p.controls.target.y=1.32;p.camera.updateProjectionMatrix();p.controls.update();p.renderer.render(p.scene,p.camera);
     const canvas=document.createElement('canvas');canvas.width=p.renderer.domElement.width;canvas.height=p.renderer.domElement.height;
     const ctx=canvas.getContext('2d');ctx.drawImage(p.renderer.domElement,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
     const strap=p.model.getObjectByName('Backpack_strap_connectors');
     const project=(x,y)=>{const point=strap.applyBoneTransform(0,new T.Vector3(x,y,.035)).applyMatrix4(strap.matrixWorld).project(p.camera);return [(point.x+1)*canvas.width/2,(1-point.y)*canvas.height/2]};
     const lines=[];
     for(const sign of [-1,1]){
      const heights=[];
      for(let j=0;j<=68;j++){
       const x=sign*(.070+j*.0025),top=project(x,1.415),bottom=project(x,1.235),px=Math.round(top[0]);let found=null;
       for(let py=Math.ceil(top[1]);py<bottom[1];py++){const id=(py*canvas.width+px)*4;if(pixels[id+3]>240&&pixels[id]<212){found=py;break}}
       heights.push(found);
      }
      lines.push(heights);
     }
     const rises=lines.flatMap(line=>line.slice(1).map((y,i)=>line[i]===null||y===null?0:line[i]-y));
     return {maxRise:Math.max(...rises),lines};
    })()`);
    worst=Math.max(worst,report.maxRise);
    assert(report.lines.every(line=>line.every(y=>y!==null)),'both shoulder outlines are visible');
    // Allow one pixel for rasterization, but reject a visible upward notch.
    assert(report.maxRise<=1,`${sex}/${style}/${profile}/${time}/${view}: a raised corner interrupts the descending shoulder line (${report.maxRise}px)`);
    if(profile==='1'&&time===null){
     if(view==='back'){
      const closed=await page.evaluate(`(async()=>{const T=await import('/node_modules/three/build/three.module.js'),p=window.__modelPreview,strap=p.model.getObjectByName('Backpack_strap_connectors'),surfaces=[];p.model.traverse(m=>{if(m.isMesh&&m.visible&&(m.userData.coatInterior||m===strap))surfaces.push(m)});const ray=new T.Raycaster(),gaps=[];
       for(const sign of [-1,1])for(const x of [.075,.083])for(const y of [1.328,1.335]){
        const origin=strap.applyBoneTransform(0,new T.Vector3(sign*x,y,-1)).applyMatrix4(strap.matrixWorld),end=strap.applyBoneTransform(0,new T.Vector3(sign*x,y,0)).applyMatrix4(strap.matrixWorld),direction=end.sub(origin),scale=direction.length();ray.set(origin,direction.normalize());const hit=ray.intersectObjects(surfaces,false)[0];if(!hit||hit.distance>1.045*scale)gaps.push({x:sign*x,y,distance:hit?.distance});
       }return gaps})()`);
      assert.equal(closed.length,0,`${sex}/${style}: rear shoulder opening exposes the front shirt ${JSON.stringify(closed)}`);
     }
     const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,`${sex}-${style}-${view}.png`),Buffer.from(shot.data,'base64'));
    }
   }
  }
  console.log(sex,style,{worstRisePixels:worst});
 }
 console.log('Shoulder line passes: continuous front/back outlines on both shoulders, standing and every walk.');
}finally{await page.close()}
