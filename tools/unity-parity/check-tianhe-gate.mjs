import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {serveDir,withPage,waitFor} from '../browser-harness.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]??'.preview/unity/tianhe-gate-comparison'),unityDir=process.argv[3]??'.preview/unity/tianhe-gate-unlit/web',fixture=JSON.parse(readFileSync(join(root,'unity/Assets/StationDesigner/Tests/EditMode/tianhe-gate-oracle.json'),'utf8'))
mkdirSync(out,{recursive:true});const report={status:'running',startedAt:new Date().toISOString(),sourceSha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:true,seed:fixture.seed,gate:fixture.gateModule,engines:[]},save=()=>writeFileSync(join(out,'correctness-report.json'),JSON.stringify(report,null,2)+'\n'),sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');save()
const sources=['tools/unity-parity/tianhe-gate-oracle.mjs','game/tianhe-gate-proof.mjs','unity/Assets/StationDesigner/Runtime/Sim/GatePathSlice.cs','unity/Assets/StationDesigner/Runtime/App/ZooGateSliceView.cs','unity/Assets/StationDesigner/Runtime/Persistence/StationSaveV1.cs','unity/Assets/StationDesigner/Tests/EditMode/tianhe-gate-oracle.json'];report.inputHashes=Object.fromEntries(sources.map(path=>[path,sha(join(root,path))]))
let server,page
try {
 for(const [engine,dir,documentPath] of [['typescript','.preview/unity/tianhe-ts-build','/tianhe-gate-proof.html'],['unity',unityDir,'/']]) {
  server=await serveDir(join(root,dir),0);page=await withPage({url:'about:blank',profile:join(out,`chrome-${engine}-${process.pid}`),debugPort:19361,windowSize:'1280,800',softwareGpu:false,commandTimeoutMs:240000})
  const errors=[];page.onEvent('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails?.exception?.description??e.exceptionDetails?.text??'exception'));page.onEvent('Runtime.consoleAPICalled',e=>{if(e.type==='error')errors.push(e.args.map(a=>a.value??a.description??'').join(' '))});page.onEvent('Network.responseReceived',e=>{if(e.response.status>=400)errors.push(`HTTP ${e.response.status} ${e.response.url}`)});page.onEvent('Network.loadingFailed',e=>{if(!e.canceled)errors.push(e.errorText)})
  await page.send('Runtime.enable');await page.send('Network.enable');await page.send('Page.enable');const loaded=page.waitForEvent('Page.loadEventFired');await page.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}${documentPath}`});await loaded
  await waitFor(async()=>{if(errors.length)throw Error(errors.join('; '));let e=await page.evaluate('window.__metroZooGateError||null');if(e)throw Error(e);return await page.evaluate('!!window.__metroZooGate')},'',{what:`${engine} ready`,tries:600,every:250})
  const view=await page.evaluate(`(()=>{let c=document.querySelector('canvas'),r=c.getBoundingClientRect();return {viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,canvas:[c.width,c.height],rect:{x:r.left,y:r.top,width:r.width,height:r.height}}})()`)
  if(view.canvas[0]!==960||view.canvas[1]!==600)throw Error(`${engine} wrong canvas: ${JSON.stringify(view)}`)
  const samples=[];const capture=async name=>{let shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,`${engine}-${name}.png`),Buffer.from(shot.data,'base64'))};await capture('initial')
  for(const expected of fixture.trace){
   const x=view.rect.x+100*view.rect.width/960,y=view.rect.y+36*view.rect.height/600
   await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})
   await waitFor(async()=>{if(errors.length)throw Error(errors.join('; '));return await page.evaluate(`window.__metroZooGate && window.__metroZooGate.tick===${expected.tick}`)},'',{what:`${engine} tick ${expected.tick}`,tries:120,every:100})
   const actual=await page.evaluate('window.__metroZooGate')
   for(const key of ['tick','state','pathIndex','gateDir','lane','waitCount','dead'])if(actual[key]!==expected[key])throw Error(`${engine} ${key} tick ${expected.tick}: ${actual[key]} != ${expected[key]}`)
   if(actual.queue!==expected.queue.length)throw Error(`${engine} queue tick ${expected.tick}`)
   for(const key of ['x','y','z','cooldown','waitAccum'])if(Math.abs(actual[key]-expected[key])>1e-7)throw Error(`${engine} ${key} tick ${expected.tick}: ${actual[key]} != ${expected[key]}`)
   samples.push(actual);if(expected.tick===3||expected.tick===4)await capture(`tick-${expected.tick}`)
  }
  report.engines.push({engine,view,samples});save();await page.close();page=null;await new Promise(ok=>server.close(ok));server=null
 }
 for(let i=0;i<fixture.trace.length;i++) for(const key of ['syntheticTick','syntheticQueued','syntheticAdmitted','syntheticCompleted']) if(report.engines[0].samples[i][key]!==report.engines[1].samples[i][key])throw Error(`Synthetic queue mismatch at tick ${i+1}: ${key}`)
 const a=report.engines[0].view,b=report.engines[1].view
 if(JSON.stringify(a.viewport)!==JSON.stringify(b.viewport)||JSON.stringify(a.canvas)!==JSON.stringify(b.canvas)||JSON.stringify(a.rect)!==JSON.stringify(b.rect)||a.dpr!==b.dpr)throw Error('Viewport, canvas, position or DPR mismatch')
 report.status='passed';report.limitations='Fixed TS graph/A* route, one actual World passenger and 5,171 separate synthetic crowd agents using the prior fixed-tick-verified graph/queue algorithm. C# supports only the single unobstructed real path. Both scenes render simplified cell/gate proxies; full World and production station rendering are not ported.';save();console.log(JSON.stringify(report))
} catch(e){report.status='failed';report.error=e.stack??String(e);save();console.error(e);process.exitCode=1}finally{await page?.close();if(server)await new Promise(ok=>server.close(ok))}


