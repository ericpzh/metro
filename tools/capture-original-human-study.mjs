import {resolve} from 'node:path';import {mkdirSync,writeFileSync} from 'node:fs';
import {serveDir,withPage,waitFor} from './browser-harness.mjs';
const out=resolve('model/public/human-candidates/studies');mkdirSync(out,{recursive:true});const server=await serveDir(resolve('model/dist'),4287);let page;
try{page=await withPage({url:'http://127.0.0.1:4287/candidates.html?mode=source&candidate=valid-Asian_F_1_Casual',profile:resolve('.preview/.chrome-original-study'),debugPort:9416,windowSize:'1200,900'});await waitFor(page.evaluate,'window.__candidatePreview?.ready',{tries:120,every:250});const entries=await page.evaluate('window.__candidatePreview.entries');
for(const entry of entries){
 await page.evaluate(`(()=>{const e=document.querySelector('#candidate');e.value=${JSON.stringify(entry.id)};e.dispatchEvent(new Event('change'))})()`);
 await waitFor(page.evaluate,`window.__candidatePreview?.ready && window.__candidatePreview.selected.id===${JSON.stringify(entry.id)}`,{tries:120,every:250});
 const data=await page.evaluate(`window.__candidatePreview.captureOriginal().toDataURL('image/png').split(',')[1]`);
 writeFileSync(resolve(out,entry.id+'-original.png'),Buffer.from(data,'base64'));console.log(entry.id);
}
}finally{await page?.close();server.close()}
