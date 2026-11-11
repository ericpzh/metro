import {writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {serveDir,withPage,waitFor} from '../browser-harness.mjs'
const root=resolve(process.argv[2]??'.preview/unity/feasibility'),out=resolve(process.argv[3]??'.preview/unity/feasibility/startup-profile');mkdirSync(out,{recursive:true})
let server,page
try {
 server=await serveDir(join(root,'web-release-visible'),0);page=await withPage({url:'about:blank',profile:join(out,`chrome-${process.pid}`),debugPort:19348,windowSize:'1384,805',softwareGpu:false})
 await page.send('Runtime.enable');await page.send('Page.enable');await page.send('Profiler.enable');await page.send('Profiler.setSamplingInterval',{interval:1000});await page.send('Profiler.start')
 const loaded=page.waitForEvent('Page.loadEventFired');await page.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await loaded
 await waitFor(page.evaluate,'!!document.querySelector("canvas")',{what:'canvas',tries:240,every:250})
 await new Promise(ok=>setTimeout(ok,7000));const result=await page.send('Profiler.stop');writeFileSync(join(out,'startup.cpuprofile'),JSON.stringify(result.profile));console.log(`Saved startup CPU profile to ${out}`)
}finally{await page?.close();if(server)await new Promise(ok=>server.close(ok))}
