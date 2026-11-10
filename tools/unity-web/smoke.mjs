import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { withPage, waitFor } from '../browser-harness.mjs'
const root=resolve(import.meta.dirname,'../..'), out=resolve(process.argv[2]??'')
if(!process.argv[2] || !out.startsWith(resolve(root,'.preview/unity')+sep)) throw Error('Output directory must be under .preview/unity')
mkdirSync(out,{recursive:true})
const reportPath=join(out,'smoke-report.json')
const report={status:'running',startedAt:new Date().toISOString()}
function saveReport(){writeFileSync(reportPath,JSON.stringify(report,null,2))}
saveReport()
async function main() {
const packed=join(out,'packed'), manifestBytes=readFileSync(join(packed,'manifest.json')), manifest=JSON.parse(manifestBytes)
report.manifestSha256=createHash('sha256').update(manifestBytes).digest('hex')
if (!Array.isArray(manifest.files)) throw Error('Invalid pack manifest')
const actual=[]
function inventory(dir) { for (const entry of readdirSync(dir,{withFileTypes:true})) { const path=join(dir,entry.name); if(entry.isDirectory()) inventory(path); else if(entry.isFile()) {const rel=path.slice(packed.length+1).replaceAll('\\','/'); if(rel!=='manifest.json') actual.push(rel)} else throw Error('Unexpected packed entry') } }
inventory(packed)
const declared=manifest.files.map(file=>file.path)
if (new Set(declared).size!==declared.length || actual.length!==declared.length || actual.some(path=>!declared.includes(path))) throw Error('Packed files do not match manifest')
for (const file of manifest.files) {
 const path=resolve(packed,file.path)
 if(!path.startsWith(packed+sep)) throw Error('Packed manifest path escapes package')
 const bytes=readFileSync(path), digest=createHash('sha256').update(bytes).digest('hex')
 if(bytes.length!==file.bytes || digest!==file.sha256) throw Error(`Packed digest mismatch: ${file.path}`)
}
report.verifiedFiles=actual.length; saveReport()
const wasm=Object.keys(manifest.splitFiles)[0] ?? manifest.files.find(x=>x.path.endsWith('.wasm'))?.path
if(!wasm) throw Error('WASM missing from manifest')
const wrangler=process.env.METRO_WRANGLER ? resolve(process.env.METRO_WRANGLER) : join(root,'node_modules/wrangler/bin/wrangler.js')
if(!existsSync(wrangler)) throw Error('Wrangler missing; run npm ci after stopping processes locking node_modules')
const tmp=join(out,'smoke-temp');mkdirSync(tmp,{recursive:true})
const config=join(out,'wrangler.local.jsonc')
writeFileSync(config,JSON.stringify({name:'metro-unity-local-smoke',main:join(root,'tools/unity-web/local-worker.mjs'),compatibility_date:'2026-10-01',assets:{directory:packed,binding:'ASSETS',run_worker_first:true}},null,2))
async function freePort(){ const server=createServer(); await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok)});const port=server.address().port;await new Promise(ok=>server.close(ok));return port }
const port=await freePort(); let debugPort=await freePort(); while(debugPort===port) debugPort=await freePort()
const base=`http://127.0.0.1:${port}`
const proc=spawn(process.execPath,[wrangler,'dev','--config',config,'--local','--persist-to',join(out,'wrangler-state'),'--port',String(port),'--ip','127.0.0.1'],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,TEMP:tmp,TMP:tmp}})
try {
 let ready=false
 for(let i=0;i<120;i++){ if(proc.exitCode!==null) throw Error(`Wrangler exited ${proc.exitCode}`); try{if((await fetch(base+'/game/')).ok){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,500)) }
 if(!ready) throw Error('Wrangler did not become ready')
 const rows=[]
 for(const route of ['/game/','/game/en/']) {
  let page; const errors=[]
  try {
   page=await withPage({url:'about:blank',profile:join(out,`chrome-${route.includes('/en/')?'en':'zh'}-${process.pid}`),debugPort,windowSize:'1280,800'})
   page.onEvent('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails?.text??'exception'))
   page.onEvent('Runtime.consoleAPICalled',e=>{ if(e.type==='error') errors.push(e.args.map(arg=>arg.value??arg.description??'console error').join(' ')) })
   page.onEvent('Network.responseReceived',e=>{ if(e.response.status>=400) errors.push(`HTTP ${e.response.status}: ${e.response.url}`) })
   page.onEvent('Network.loadingFailed',e=>{ if (!e.canceled && e.errorText !== 'net::ERR_ABORTED') errors.push(e.errorText) })
   await page.send('Network.enable'); await page.send('Runtime.enable'); await page.send('Page.enable')
   const loaded=page.waitForEvent('Page.loadEventFired'); await page.send('Page.navigate',{url:base+route}); await loaded
   for(let load=0;load<2;load++) {
    if(load) { const loaded=page.waitForEvent('Page.loadEventFired'); await page.send('Page.enable'); await page.send('Page.reload',{ignoreCache:true}); await loaded }
    await waitFor(page.evaluate,"document.documentElement.dataset.metroReady === 'true'",{what:'Unity first frame',tries:360})
    const lang=await page.evaluate('document.documentElement.lang')
    if(lang!==(route.includes('/en/')?'en':'zh-CN')) throw Error('Incorrect document language')
    const point=await page.evaluate("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()")
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1})
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
    await waitFor(page.evaluate,"Number(document.documentElement.dataset.metroClicks||0)>0",{what:'Unity click',tries:30})
    const inputPoint=await page.evaluate("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom-38}})()")
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...inputPoint,button:'left',clickCount:1})
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...inputPoint,button:'left',clickCount:1})
    await new Promise(r=>setTimeout(r,300))
    await page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'x',code:'KeyX',windowsVirtualKeyCode:88,nativeVirtualKeyCode:88})
    await page.send('Input.dispatchKeyEvent',{type:'char',key:'x',code:'KeyX',text:'x',unmodifiedText:'x',windowsVirtualKeyCode:88,nativeVirtualKeyCode:88})
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'x',code:'KeyX',windowsVirtualKeyCode:88,nativeVirtualKeyCode:88})
    const debugShot=await page.send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,'input-debug.png'),Buffer.from(debugShot.data,'base64'))
    await waitFor(page.evaluate,"(document.documentElement.dataset.metroText||'').includes('x')",{what:'editable label',tries:30})
    if (!load) { const shot=await page.send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,route.includes('/en/')?'smoke-en.png':'smoke-zh.png'),Buffer.from(shot.data,'base64')) }
    rows.push({route,load:load?'reload':'cold',lang,clicks:await page.evaluate('document.documentElement.dataset.metroClicks'),editedText:await page.evaluate('document.documentElement.dataset.metroText')})
   }
   if(errors.length) throw Error(`Browser errors: ${errors.join('; ')}`)
  } finally {await page?.close()}
 }
 const response=await fetch(base+'/game/_unity/'+wasm,{method:'HEAD'})
 if(!response.ok||!response.headers.get('content-type')?.includes('application/wasm')) throw Error('WASM MIME mismatch')
 const get=await fetch(base+'/game/_unity/'+wasm)
 if (!get.ok) throw Error('WASM GET failed')
 const digest=createHash('sha256').update(Buffer.from(await get.arrayBuffer())).digest('hex')
 const expected=manifest.splitFiles[wasm]?.sha256 ?? manifest.files.find(x=>x.path===wasm)?.sha256
 if (digest!==expected) throw Error('WASM response digest mismatch')
 const fixtures=[]
 for (const name of ['valid-v1','invalid-v1']) {
  const response=await fetch(`${base}/game/_unity/fixtures/${name}.metro.json`)
  if (!response.ok) throw Error(`Fixture transport failed: ${name}`)
  const actual=await response.text(), expected=readFileSync(join(root,'unity/tests/fixtures',`${name}.metro.json`),'utf8')
  if (actual !== expected) throw Error(`Fixture bytes changed: ${name}`)
  fixtures.push({name,bytes:Buffer.byteLength(actual)})
 }
 const license=await fetch(base+'/game/_unity/licenses/OFL.txt')
 if (!license.ok || !(await license.text()).includes('SIL OPEN FONT LICENSE')) throw Error('Font license missing from smoke package')
 Object.assign(report,{status:'passed',rows,wasm:{status:response.status,type:response.headers.get('content-type'),sha256:digest},fixtures}); saveReport();console.log(JSON.stringify(report))
} finally {proc.kill()}

}
try { await main() } catch (error) { report.status='failed'; report.error=error.stack ?? String(error); saveReport(); console.error(error); process.exitCode=1 }
