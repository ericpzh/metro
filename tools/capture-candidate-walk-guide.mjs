// Capture synchronized pose references for image/video animation generation.
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';

const id=process.argv[2]??'valid-Asian_F_3_Casual',angle=Number(process.argv[3]??2),frames=Number(process.argv[4]??8),elevation=Number(process.argv[5]??Math.atan(1.3/4)*180/Math.PI),offset=Number(process.argv[6]??0);
if(!Number.isInteger(angle)||angle<0||angle>15)throw Error('Angle must be an integer from 0 to 15');
if(frames!==8&&frames!==16)throw Error('Frame count must be 8 or 16');
if(!Number.isFinite(elevation)||elevation< -30||elevation>75)throw Error('Elevation must be between -30 and 75 degrees');
if(!Number.isFinite(offset)||offset<0||offset>=1)throw Error('Frame offset must be in [0, 1)');
const out=resolve('.preview/human-candidates/walk-guides');mkdirSync(out,{recursive:true});
const server=await serveDir(resolve('model/dist'),4292);let page;
try{
 page=await withPage({url:`http://127.0.0.1:4292/candidates.html?mode=animated&candidate=${encodeURIComponent(id)}`,profile:resolve('.preview/.chrome-walk-guide'),debugPort:9422,windowSize:'1000,900'});
 await waitFor(page.evaluate,`window.__candidatePreview?.ready && window.__candidatePreview.selected.id===${JSON.stringify(id)}`,{tries:120,every:250});
 const data=await page.evaluate(`(()=>{const p=window.__candidatePreview,e=document.querySelector('#live-angle');e.value=${angle};e.dispatchEvent(new Event('input'));p.renderer.setPixelRatio(1);p.renderer.setSize(512,512,false);p.illustrationCamera.left=-1.225;p.illustrationCamera.right=1.225;p.illustrationCamera.position.set(Math.sin(${angle}*Math.PI/8)*4,.875+4*Math.tan(${elevation}*Math.PI/180),Math.cos(${angle}*Math.PI/8)*4);p.illustrationCamera.lookAt(0,.875,0);p.illustrationCamera.updateProjectionMatrix();p.scene.children.find(n=>n.userData.studyGround).visible=false;const sheet=document.createElement('canvas');sheet.width=2048;sheet.height=${frames/4}*512;const ctx=sheet.getContext('2d');for(let frame=0;frame<${frames};frame++){p.poseMotion('medium',(frame+${offset})/${frames}*1.12);p.renderer.render(p.scene,p.illustrationCamera);ctx.drawImage(p.renderer.domElement,frame%4*512,Math.floor(frame/4)*512)}return sheet.toDataURL('image/png').split(',')[1]})()`);
 const path=resolve(out,`${id}-angle-${angle}${frames===8?'':'-'+frames}${process.argv[5]===undefined?'':'-elevation-'+elevation}${offset?'-offset-'+offset:''}.png`);writeFileSync(path,Buffer.from(data,'base64'));console.log(path);
}finally{await page?.close();server.close()}
