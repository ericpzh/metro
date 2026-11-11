import { writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { serveDir, waitFor, withPage } from '../browser-harness.mjs'
const out=resolve(process.argv[2]??'.preview/unity/import-review-train-animation'), reportPath=join(out,'animation-report.json')
const report={status:'running',startedAt:new Date().toISOString()}, save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save()
let server,page
try {
 server=await serveDir(join(out,'web'),0); page=await withPage({url:'about:blank',profile:join(out,`chrome-${process.pid}`),debugPort:19343,windowSize:'1280,800'})
 const errors=[];page.onEvent('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails?.text??'exception'));page.onEvent('Runtime.consoleAPICalled',e=>{if(e.type==='error')errors.push(e.args.map(x=>x.value??x.description??'error').join(' '))});page.onEvent('Network.loadingFailed',e=>{if(!e.canceled)errors.push(e.errorText)});page.onEvent('Network.responseReceived',e=>{if(e.response.status>=400)errors.push(`HTTP ${e.response.status}: ${e.response.url}`)})
 await page.send('Runtime.enable');await page.send('Network.enable');await page.send('Page.enable');const loaded=page.waitForEvent('Page.loadEventFired');await page.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await loaded
 const samples=[]
 for (const [name,phase,condition] of [['plus-closed',0,'time===0'],['plus-open',0,'time>=0.99'],['minus-closed',1,'time===0'],['minus-open',1,'time>=0.99']]) {
   await waitFor(page.evaluate,`(()=>{const s=window.__metroTrainDoorFrame;return !!s && s.phase===${phase} && s.${condition}})()`,{what:name,tries:500,every:25})
   const state=await page.evaluate('window.__metroTrainDoorFrame'); const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,`${name}.png`),Buffer.from(shot.data,'base64'));samples.push({name,...state})
 }
 if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`)
 if(samples[1].plusMove<.5 || samples[1].minusMove>.001 || samples[3].minusMove<.5 || samples[3].plusMove>.001) throw Error('Door motion or side isolation failed')
 const diff=JSON.parse(execFileSync('python',[resolve('tools/unity-assets/check-door-pixels.py'),out],{encoding:'utf8'})); if(diff.plus<10 || diff.minus<10)throw Error('Door motion did not change visible pixels')
 Object.assign(report,{status:'passed',samples,pixelDifferences:diff});save();console.log(JSON.stringify(report))
} catch(e){report.status='failed';report.error=e.stack??String(e);save();console.error(e);process.exitCode=1} finally{await page?.close();if(server)await new Promise(ok=>server.close(ok))}
