// Phase 0 TS baseline: browser startup, real click, and resource sizes.
// Use a production game build and keep other measurement workloads idle.
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, normalize, extname, dirname } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from '../browser-harness.mjs'
if (process.argv.includes('--help')) {
  console.log('node tools/unity-baseline/startup.mjs [--gzip] [--output <new-directory>] [--dist <game-build>] [--runs 1..3] [--demos zoo,tanwei,tianhe]')
  process.exit(0)
}
const gzip=process.argv.includes('--gzip'), oi=process.argv.indexOf('--output')
const ri=process.argv.indexOf('--runs'), di=process.argv.indexOf('--demos')
const runs=ri<0?3:Number(process.argv[ri+1]), demos=di<0?['zoo','tanwei','tianhe']:process.argv[di+1]?.split(',')
if (!Number.isInteger(runs)||runs<1||runs>3||!demos?.length||demos.some(d=>!['zoo','tanwei','tianhe'].includes(d))) throw Error('Invalid run count or demo list')
const out=resolve(oi>=0 ? process.argv[oi+1] : `.preview/unity/baseline/startup-${Date.now()}`)
const allowed=resolve('.preview/unity')+'/'
if (!(out.replaceAll('\\','/')+'/').startsWith(allowed.replaceAll('\\','/'))) throw Error('Output must be under .preview/unity')
mkdirSync(dirname(out),{recursive:true});mkdirSync(out,{recursive:false})
const distIndex=process.argv.indexOf('--dist')
const root=resolve(distIndex<0?'game/dist':process.argv[distIndex+1]), cache=new Map(), mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm'}
let server
if(gzip){
 server=createServer((req,res)=>{const url=decodeURIComponent((req.url??'/').split('?')[0]);let file=join(root,normalize(url).replace(/^(\.\.[/\\])+/,''));if(!existsSync(file)||url.endsWith('/'))file=join(root,'index.html');const ext=extname(file),compressed=['.html','.js','.css','.json','.svg','.wasm'].includes(ext);if(!cache.has(file)){const raw=readFileSync(file);cache.set(file,compressed?gzipSync(raw,{level:6}):raw)}const body=cache.get(file);res.writeHead(200,{'content-type':mime[ext]??'application/octet-stream',...(compressed?{'content-encoding':'gzip'}:{}),'content-length':body.length});res.end(body)})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
}else server=await serveDir(root,0)
const rows=[]
try{
 for(let run=1;run<=runs;run++) for(const demo of demos){
  let page
  try{
   page=await withPage({url:'about:blank',profile:join(out,`chrome-${run}-${demo}`),debugPort:20510,windowSize:'1400,900',softwareGpu:false})
   await page.send('Network.enable');await page.send('Page.enable')
   for(const load of ['cold','warm']){
    const loaded=page.waitForEvent('Page.loadEventFired');await page.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await loaded
    await waitFor(page.evaluate,'!!window.__scene && !!window.__metro?.getState().metrics',{what:'game ready',tries:240})
    await loadExampleStation(page,demo)
    const row=await page.evaluate(`(()=>{const s=__metro.getState(),r=performance.getEntriesByType('resource');return {fixture:${JSON.stringify(demo)},load:${JSON.stringify(load)},readyMs:performance.now(),transferBytes:r.reduce((n,x)=>n+x.transferSize,0),encodedBodyBytes:r.reduce((n,x)=>n+x.encodedBodySize,0),heapBytes:performance.memory?.usedJSHeapSize??null,agents:s.stats?.agents??null,trains:Math.floor((__scene.trains?.lastBuffer?.length??0)/10),viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,activeZ:s.activeZ}})()`)
    const point=await page.evaluate("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()")
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
    row.firstInteractionMs=await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(performance.now()))))')
    row.run=run;row.gzip=gzip;rows.push(row);writeFileSync(join(out,'results.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(row))
   }
  }finally{await page?.close()}
 }
}finally{await new Promise(r=>server.close(r))}
