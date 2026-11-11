import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {get} from 'node:http'
import {brotliDecompressSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs'
import {join,resolve,sep} from 'node:path'
import {withPage,waitFor} from '../browser-harness.mjs'
import {validateReleaseManifest} from './release-contract.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]??'')
if(!process.argv[2]||!out.startsWith(resolve(root,'.preview/unity')+sep))throw Error('Specify an evidence directory under .preview/unity')
const artifact=join(out,'artifact'),reportPath=join(out,'release-smoke-report.json'),report={status:'running',startedAt:new Date().toISOString(),http:[],browser:[]}
function save(){writeFileSync(reportPath,JSON.stringify(report,null,2))}
save()
const digest=b=>createHash('sha256').update(b).digest('hex')
async function port(){const s=createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r)});const n=s.address().port;await new Promise(r=>s.close(r));return n}
function raw(url){return new Promise((ok,bad)=>{get(url,{headers:{'accept-encoding':'br'}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>ok({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks)}))}).on('error',bad)})}
async function main(){
 const manifest=JSON.parse(readFileSync(join(artifact,'_unity-shell/manifest.json')))
 validateReleaseManifest(manifest,p=>readFileSync(join(artifact,'_unity',manifest.releaseId,p)))
 report.releaseId=manifest.releaseId; report.manifestSha256=digest(readFileSync(join(artifact,'_unity-shell/manifest.json')))
 const wasm=manifest.files.find(f=>f.path.endsWith('.wasm.br')); if(!wasm)throw Error('Brotli WASM missing')
 const wrangler=process.env.METRO_WRANGLER??join(root,'node_modules/wrangler/bin/wrangler.js')
 if(!existsSync(wrangler))throw Error('Wrangler missing')
 for(const mount of ['/game','']){
  const httpPort=await port(),debugPort=await port(),suffix=mount?'game':'root',config=join(out,`wrangler-${suffix}.jsonc`),log=join(out,`wrangler-${suffix}.log`)
  writeFileSync(config,JSON.stringify({name:`metro-unity-local-${suffix}`,main:join(root,'tools/unity-web/release-worker.mjs'),compatibility_date:'2026-10-01',vars:{METRO_MOUNT:mount},assets:{directory:artifact,binding:'ASSETS',run_worker_first:true}},null,2))
  const temp=join(out,'temp-'+suffix);mkdirSync(temp,{recursive:true})
  const fd=openSync(log,'w'),proc=spawn(process.execPath,[wrangler,'dev','--config',config,'--local','--persist-to',join(out,`state-${suffix}`),'--port',String(httpPort),'--ip','127.0.0.1'],{cwd:root,stdio:['ignore',fd,fd],windowsHide:true,env:{...process.env,TEMP:temp,TMP:temp}})
  const base=`http://127.0.0.1:${httpPort}`
  try{
   let ready=false;for(let i=0;i<120;i++){if(proc.exitCode!==null)throw Error(`Wrangler exit ${proc.exitCode}`);try{if((await fetch(base+mount+'/')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}if(!ready)throw Error('Worker not ready')
   const cases=[[mount+'/','zh-CN',null],[mount+'/en/','en',null],[mount+'/en/tianhe','en','tianhe']]
   if (process.env.METRO_SMOKE_REQUIRE_ZOO_ACK === '1') cases.push([mount+'/en/zoo','en','zoo'])
   let page; const errors=[],assetRequests=[]
   try {
    page=await withPage({url:'about:blank',profile:join(out,`chrome-${suffix}-${process.pid}`),debugPort,windowSize:'1280,800'})
    page.onEvent('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails?.text??'exception'))
    page.onEvent('Runtime.consoleAPICalled',e=>{if(e.type==='error')errors.push(e.args.map(a=>a.value??a.description??'error').join(' '))})
    page.onEvent('Network.responseReceived',e=>{if(e.response.status>=400)errors.push(`HTTP ${e.response.status}: ${e.response.url}`);if(e.response.url.includes('/_unity/'))assetRequests.push(e.response.url)})
    page.onEvent('Network.loadingFailed',e=>{if(!e.canceled&&e.errorText!=='net::ERR_ABORTED')errors.push(e.errorText)})
    await page.send('Network.enable');await page.send('Runtime.enable');await page.send('Page.enable')
    for(const [path,locale,demoId] of cases){
     errors.length=0;assetRequests.length=0
     const loaded=page.waitForEvent('Page.loadEventFired');await page.send('Page.navigate',{url:base+path});await loaded
     await waitFor(page.evaluate,"document.documentElement.dataset.metroReady === 'true'",{what:'Unity first frame',tries:360})
     const state=await page.evaluate('({lang:document.documentElement.lang, launch:window.metroLaunch, ready:document.documentElement.dataset.metroReady})')
     if(state.lang!==locale||state.launch?.demoId!==demoId||state.launch?.releaseId!==manifest.releaseId||state.launch?.mount!==mount)throw Error(`Incorrect launch configuration: ${JSON.stringify(state)}`)
     if(!assetRequests.some(u=>u.includes('/_unity/'+manifest.releaseId+'/Build/')&&u.endsWith('.wasm.br')))throw Error('Browser did not request versioned WASM')
     if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`)
     if(demoId==='zoo' && process.env.METRO_SMOKE_REQUIRE_ZOO_ACK === '1') {
      await waitFor(page.evaluate,'!!window.__metroDemoAck',{what:'C# Zoo document acknowledgement',tries:600,every:500})
      const ack=await page.evaluate('window.__metroDemoAck')
      if(ack.status!=='loaded'||ack.id!=='zoo'||ack.cells!==14066||ack.modules!==4299||ack.lines!==1)throw Error(`Zoo C# load failed: ${JSON.stringify(ack)}`)
      if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`)
      state.demoAck=ack
     }
     if(process.env.METRO_SMOKE_REQUIRE_SAVE_PARITY === '1') {
      await waitFor(page.evaluate,'!!window.__metroSaveParity',{what:'C# authored save result',tries:600,every:500})
      const parity=await page.evaluate('window.__metroSaveParity')
      if(parity.status!=='passed'||parity.droppedCells!==0||parity.droppedModules!==0)throw Error(`Authored save proof failed: ${JSON.stringify(parity)}`)
      if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`)
      state.saveParity={status:parity.status,droppedCells:parity.droppedCells,droppedModules:parity.droppedModules}
     }
     report.browser.push({path,...state,assetRequests:[...assetRequests]});save()
    }
   }finally{await page?.close()}
   const assetPath=mount+'/_unity/'+manifest.releaseId+'/'+wasm.path,request=await raw(base+assetPath)
   if(request.status!==200||request.headers['content-type']!=='application/wasm'||request.headers['content-encoding']!=='br'||digest(request.body)!==wasm.sha256)throw Error(`WASM headers/bytes mismatch: ${JSON.stringify({status:request.status,headers:request.headers})}`)
   const decoded=brotliDecompressSync(request.body),head=await fetch(base+assetPath,{method:'HEAD',headers:{'accept-encoding':'br'}}),missing=await fetch(base+mount+'/_unity/'+manifest.releaseId+'/Build/missing',{redirect:'manual'})
   if(head.status!==200||head.headers.get('content-encoding')!=='br'||missing.status!==404)throw Error('HEAD or missing asset mismatch')
   const redir=await fetch(base+mount+'/en/tianhe/?keep=1',{redirect:'manual'})
   if(redir.status!==308||!redir.headers.get('location')?.endsWith(mount+'/en/tianhe?keep=1'))throw Error('Redirect mismatch')
   report.http.push({mount,wasmStatus:request.status,mime:request.headers['content-type'],encoding:request.headers['content-encoding'],encodedSha256:digest(request.body),decodedSha256:digest(decoded),decodedBytes:decoded.length,head:head.status,missing:missing.status,redirect:redir.status});save()
  }finally{proc.kill();closeSync(fd)}
 }
 report.status='passed';save();console.log(JSON.stringify(report,null,2))
}
try{await main()}catch(e){report.status='failed';report.error=e.stack??String(e);save();console.error(e);process.exitCode=1}




