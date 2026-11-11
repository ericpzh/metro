import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {cpus} from 'node:os'
import {serveDir,withPage,waitFor} from '../browser-harness.mjs'
const root=resolve(import.meta.dirname,'../..'), out=resolve(process.argv[2]??'.preview/unity/feasibility/ts-run-1'),reportPath=join(out,'report.json');mkdirSync(out,{recursive:true})
const report={status:'running',startedAt:new Date().toISOString()},save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n'),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');save();let server,page
try {
 server=await serveDir(root,0);page=await withPage({url:'about:blank',profile:join(out,`chrome-${process.pid}`),debugPort:19345,windowSize:'1384,805',softwareGpu:false})
 const errors=[];page.onEvent('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails?.exception?.description??e.exceptionDetails?.text??'exception'));page.onEvent('Runtime.consoleAPICalled',e=>{if(e.type==='error')errors.push(e.args.map(a=>a.value??a.description??'').join(' '))});page.onEvent('Network.loadingFailed',e=>{if(!e.canceled)errors.push(e.errorText)});page.onEvent('Network.responseReceived',e=>{if(e.response.status>=400)errors.push(`HTTP ${e.response.status} ${e.response.url}`)})
 await page.send('Runtime.enable');await page.send('Network.enable');await page.send('Page.enable');await page.send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__metroLongTasks=[];new PerformanceObserver(l=>window.__metroLongTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});"})
 const loaded=page.waitForEvent('Page.loadEventFired');await page.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/tools/unity-feasibility/ts-workload.html`});await loaded
 await waitFor(async()=>{if(errors.length) throw Error('Browser errors: '+errors.join('; ')); return await page.evaluate('!!window.__metroTsFeasibility')},'',{what:'TS synthetic run',tries:600,every:500});const workload=await page.evaluate('window.__metroTsFeasibility')
 const environment=await page.evaluate(`(()=>{let c=document.querySelector('canvas'),g=c&&c.getContext('webgl2'),e=g&&g.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,canvas:c?[c.width,c.height]:null,gpu:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null,longTasks:window.__metroLongTasks}})()`)
 const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'screenshot.png'),Buffer.from(shot.data,'base64')); const renderEvidence=JSON.parse(execFileSync('python',[join(root,'tools/unity-feasibility/check-render.py'),join(out,'screenshot.png')],{encoding:'utf8'}))
 if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`)
 if(workload.nodes!==153720||workload.edges!==1172121||workload.servers!==943||workload.population!==5171||workload.phases.length!==4||workload.phases.some(p=>!p.ticks||!p.frames||!p.admitted||!p.completed))throw Error('Incomplete workload')
 Object.assign(report,{status:'passed',sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:true,host:{cpu:cpus()[0]?.model,node:process.version},files:{graph:sha(join(root,'.preview/unity/feasibility/graph.bytes')),workload:sha(join(root,'tools/unity-feasibility/ts-workload.mjs')),three:sha(join(root,'game/node_modules/three/build/three.module.js'))},environment,renderEvidence,workload,limitations:'Synthetic same graph/queue algorithm; Three.js geometry/rendering differs from Unity, no station geometry or TS World, GPU completion or physical display.'});save();console.log(JSON.stringify(report))
} catch(e){report.status='failed';report.error=e.stack??String(e);save();console.error(e);process.exitCode=1} finally{await page?.close();if(server)await new Promise(ok=>server.close(ok))}


