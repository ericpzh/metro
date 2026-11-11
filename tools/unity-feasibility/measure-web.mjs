import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {cpus} from 'node:os'
import {serveDir,withPage,waitFor} from '../browser-harness.mjs'
const root=resolve(import.meta.dirname,'../..'), out=resolve(process.argv[2]??'.preview/unity/feasibility'), webName=process.argv[4]??'web-release-visible', web=join(out,webName), reportDir=resolve(process.argv[3]??out)
if (!/^web-release-[a-z-]+$/.test(webName)) throw Error('Invalid Web build name')
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const reportPath=join(reportDir,'report.json'); mkdirSync(reportDir,{recursive:true}); const result={status:'running',startedAt:new Date().toISOString()}; const save=()=>writeFileSync(reportPath,JSON.stringify(result,null,2));save()
let server,page
try {
 server=await serveDir(web,0); const port=server.address().port
 page=await withPage({url:'about:blank',profile:join(out,`chrome-${process.pid}`),debugPort:19335,windowSize:'1384,805',softwareGpu:false})
 const errors=[];page.onEvent('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails?.text??'exception')); page.onEvent('Runtime.consoleAPICalled',e=>{if(e.type==='error')errors.push(e.args.map(a=>a.value??a.description??'').join(' '))});page.onEvent('Network.loadingFailed',e=>{if(!e.canceled)errors.push(e.errorText)});page.onEvent('Network.responseReceived',e=>{if(e.response.status>=400)errors.push(`HTTP ${e.response.status} ${e.response.url}`)})
 await page.send('Network.enable'); await page.send('Runtime.enable'); await page.send('Page.enable')
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__metroLongTasks=[]; new PerformanceObserver(l=>window.__metroLongTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});"})
 const loaded=page.waitForEvent('Page.loadEventFired'); await page.send('Page.navigate',{url:`http://127.0.0.1:${port}/`}); await loaded
 await waitFor(page.evaluate,"!!document.documentElement.dataset.metroFeasibility",{what:'feasibility run',tries:600,delayMs:500})
 const data=await page.evaluate('JSON.parse(document.documentElement.dataset.metroFeasibility)')
 const environment=await page.evaluate(`(()=>{let c=document.querySelector('canvas'),g=c&&c.getContext('webgl2'),e=g&&g.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,canvas:c?[c.width,c.height]:null,gpu:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null,longTasks:window.__metroLongTasks}})()`)
 const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(reportDir,'screenshot.png'),Buffer.from(shot.data,'base64')); const renderEvidence=JSON.parse(execFileSync('python',[join(root,'tools/unity-feasibility/check-render.py'),join(reportDir,'screenshot.png')],{encoding:'utf8'}))
 if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`)
 if(data.status!=='complete'||data.phases.length!==4||data.phases.some(p=>p.ticks<1||p.frames<1||p.admitted<1||p.completed<1))throw Error('Workload did not produce nonempty traversal and queues for each speed')
 Object.assign(result,{status:'passed',sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:true,webName,host:{cpu:cpus()[0]?.model,node:process.version},files:{graph:sha(join(out,'graph.bytes')),runtime:sha(join(root,'unity/Assets/StationDesigner/Scripts/Feasibility/TianheFeasibility.cs')),placeholder:sha(join(root,'unity/Assets/StationDesigner/Scripts/Feasibility/PlaceholderCrowdMesh.cs')),buildScript:sha(join(root,'tools/unity-feasibility/Build.cs')),html:sha(join(web,'index.html')),wasm:sha(join(web,'Build',webName+'.wasm')),data:sha(join(web,'Build',webName+'.data'))},environment,renderEvidence,workload:data,comparison:{status:'not-comparable',reason:'TS baseline exercises World, real routing, station geometry and a separate browser workload. This uses actual graph and synthetic adjacency walking, server queues and placeholder instancing.',typescriptBaseline:'4c0fb66e071e2aee25cd3fc055a010871942004b',typescriptPeakTickMedianMs:[172.5,170.9,176.3]}});save();console.log(JSON.stringify(result))
} catch(e) {result.status='failed';result.error=e.stack??String(e);save();console.error(e);process.exitCode=1} finally {await page?.close(); if(server)await new Promise(ok=>server.close(ok))}





