// Complete, resumable production API-to-render action matrix. No timing captures
// run concurrently. This is not a substitute for the real-pointer latency probes.
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, cpSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpus, platform, release } from 'node:os'
import { pathToFileURL } from 'node:url'
import { editorTreeHash as treeHash } from '../game/scripts/editor-benchmark-build.ts'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const sourceRoot=resolve(process.env.BENCH_SOURCE_DIR??'game/src')
const {referenceStation,EXAMPLE_STATION_IDS}=await import(pathToFileURL(join(sourceRoot,'data/reference-station.ts')).href)
const {editorActionCases}=await import(pathToFileURL(join(sourceRoot,'app/benchmark/editorActionCases.ts')).href)

const profile=process.argv.includes('--profile'),recordOnly=process.argv.includes('--record-only')
const runId=`run-${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${process.pid}`
const root=resolve(process.env.BENCH_ACTION_OUTPUT??`.preview/perf/editor-actions/${profile?'profiles/':''}${runId}`)
const dist=resolve(process.env.BENCH_DIST??'game/dist')
const count=Number(process.env.BENCH_SAMPLES??3)
if(!Number.isInteger(count)||count<1||count>10)throw Error('BENCH_SAMPLES must be 1..10')
const demos=process.env.BENCH_DEMO?.split(',')??[...EXAMPLE_STATION_IDS]
for(const demo of demos)if(!EXAMPLE_STATION_IDS.includes(demo))throw Error(`Unknown demo ${demo}`)
if(new Set(demos).size!==demos.length)throw Error('Duplicate BENCH_DEMO entries')
const filter=process.env.BENCH_CASE?new Set(process.env.BENCH_CASE.split(',')):null
if(filter&&[...filter].some(id=>!demos.some(demo=>editorActionCases(referenceStation(demo)).some(c=>c.id===id))))throw Error('Unknown BENCH_CASE; use --list')
if(process.argv.includes('--list')){console.log(JSON.stringify(demos.map(demo=>({demo,cases:editorActionCases(referenceStation(demo))})),null,2));process.exit(0)}
if(process.env.BENCH_RESUME==='1'&&!process.env.BENCH_ACTION_OUTPUT)throw Error('Resume requires BENCH_ACTION_OUTPUT pointing to the original run directory')
const hash=value=>createHash('sha256').update(value).digest('hex')
mkdirSync(root,{recursive:true})
const metadata={schema:2,targetMs:100,driver:'production-api-to-render',samples:count,profiled:profile,
  resumeRequested:process.env.BENCH_RESUME==='1',
  scope:{demos,caseFilter:filter?[...filter]:null,fullMatrix:!filter&&demos.length===EXAMPLE_STATION_IDS.length},
  generatedAt:new Date().toISOString(),gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceHash:treeHash(sourceRoot),buildHash:treeHash(dist),
  scriptHash:hash(readFileSync(new URL(import.meta.url))),host:{cpu:cpus()[0]?.model,os:`${platform()} ${release()}`,node:process.version},
  sourceMaps:readdirSync(join(dist,'assets')).filter(name=>name.endsWith('.map'))}
const buildStamp=join(dist,'editor-benchmark-build.json')
if(!existsSync(buildStamp)||JSON.parse(readFileSync(buildStamp,'utf8')).sourceHash!==metadata.sourceHash)
  throw Error('Source does not match the compiled build; rebuild or pair BENCH_SOURCE_DIR with its captured BENCH_DIST')
const snapshot=join(root,`build-${metadata.buildHash.slice(0,12)}-${process.pid}`)
cpSync(dist,snapshot,{recursive:true,errorOnExist:true,force:false})
if(treeHash(snapshot)!==metadata.buildHash)throw Error('Build changed during snapshot; rebuild and retry')
metadata.buildSnapshot=relative(root,snapshot)
const sourceSnapshot=join(root,`source-${metadata.sourceHash.slice(0,12)}-${process.pid}`)
cpSync(sourceRoot,sourceSnapshot,{recursive:true,errorOnExist:true,force:false})
if(treeHash(sourceSnapshot)!==metadata.sourceHash)throw Error('Source changed during snapshot; retry')
metadata.sourceSnapshot=relative(root,sourceSnapshot)
metadata.buildInputs={}
const inputs=join(root,`build-inputs-${process.pid}`);mkdirSync(inputs,{recursive:true})
for(const name of ['vite.config.ts','package.json','package-lock.json']){
  const bytes=readFileSync(join('game',name));metadata.buildInputs[name]=hash(bytes);writeFileSync(join(inputs,name),bytes)
}
cpSync(resolve('game/scripts'),join(inputs,'scripts'),{recursive:true,errorOnExist:true,force:false})
metadata.driverSnapshot=`driver-${process.pid}.mjs`
metadata.browserHarnessSnapshot=`browser-harness-${process.pid}.mjs`
writeFileSync(join(root,`driver-${process.pid}.mjs`),readFileSync(new URL(import.meta.url)))
writeFileSync(join(root,`browser-harness-${process.pid}.mjs`),readFileSync(new URL('./browser-harness.mjs',import.meta.url)))
const reports=[],server=await serveDir(snapshot,0)
const summarize=()=>{
  const results=reports.flatMap(report=>report.cases.flatMap(c=>c.rows.map(row=>({demo:report.demo,case:c.id,...row}))))
  const failures=results.filter(row=>row.status==='error'||row.status==='over-budget')
  return {...metadata,complete:reports.length===demos.length&&reports.every(r=>r.cases.length===r.expectedCases),
    reports,summary:{rows:results.length,pass:results.filter(r=>r.status==='pass').length,unsupported:results.filter(r=>r.status==='unsupported').length,
      failed:failures.length,failures:failures.map(({demo,case:id,action,iteration,status,cpuMs,firstRenderMs,error})=>({demo,case:id,action,iteration,status,cpuMs,firstRenderMs,error}))}}
}
const persist=()=>writeFileSync(join(root,profile?'profile-report.json':'report.json'),JSON.stringify(summarize(),null,2))
try{
  for(const demo of demos){
    const page=await withPage({url:`http://127.0.0.1:${server.address().port}/?bench-editor-actions`,profile:join(root,`chrome-${demo}-${process.pid}`),
      debugPort:22000+process.pid%20000,windowSize:'1440,1000',softwareGpu:process.argv.includes('--software-gpu')})
    try{
      await waitFor(page.evaluate,'!!window.__scene && !!window.__editorActions && !!window.__metro?.getState().metrics')
      await loadExampleStation(page,demo)
      await page.evaluate('__metro.getState().setPlaying(false);new Promise(r=>setTimeout(r,1200))')
      const setup=await page.evaluate('__editorActions.initialize()')
      if(JSON.stringify(setup.cases)!==JSON.stringify(editorActionCases(referenceStation(demo))))throw Error('Source/build case manifests differ; rebuild before benchmarking')
      const environment=await page.evaluate(`(()=>{const s=__scene,r=s.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),rect=r.domElement.getBoundingClientRect();return {browser:navigator.userAgent,gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER),canvas:[rect.width,rect.height],pixelRatio:r.getPixelRatio(),quality:__metro.getState().graphicsQuality,stages:__editorActions.stages}})()`)
      const cases=setup.cases.filter(c=>!filter||filter.has(c.id))
      const report={demo,demoHash:hash(JSON.stringify(referenceStation(demo))),fixture:setup.fixture,origin:setup.origin,environment,expectedCases:cases.length,manifest:cases,cases:[]}
      reports.push(report);persist()
      for(const spec of cases){
        const key=`${demo}-${spec.id.replaceAll(/[^a-zA-Z0-9._-]/g,'_')}-${hash(spec.id).slice(0,12)}`
        const checkpoint=join(root,`${key}.json`)
        let result
        if(process.env.BENCH_RESUME==='1'&&existsSync(checkpoint)){
          const saved=JSON.parse(readFileSync(checkpoint,'utf8'))
          if(saved.scriptHash===metadata.scriptHash&&JSON.stringify(saved.environment)===JSON.stringify(environment)&&JSON.stringify(saved.host)===JSON.stringify(metadata.host)&&saved.profiled===profile&&saved.buildHash===metadata.buildHash&&saved.sourceHash===metadata.sourceHash&&saved.demoHash===report.demoHash&&saved.samples===count&&JSON.stringify(saved.spec)===JSON.stringify(spec))result=saved.result
        }
        if(!result){
          if(profile){await page.send('Profiler.enable');await page.send('Profiler.start')}
          result=await page.evaluate(`__editorActions.runCase(${JSON.stringify(spec.id)},${count})`)
          if(profile){writeFileSync(join(root,`${key}.cpuprofile`),JSON.stringify((await page.send('Profiler.stop')).profile));result.profile=`${key}.cpuprofile`}
          if(result.errors.length||result.glError)throw Error(`${key}: browser/WebGL errors: ${JSON.stringify(result.errors)}/${result.glError}`)
          const image=await page.send('Page.captureScreenshot',{format:'png'})
          writeFileSync(join(root,`${key}.png`),Buffer.from(image.data,'base64'))
          result.screenshot=`${key}.png`
          writeFileSync(checkpoint,JSON.stringify({scriptHash:metadata.scriptHash,environment,host:metadata.host,profiled:profile,buildHash:metadata.buildHash,sourceHash:metadata.sourceHash,demoHash:report.demoHash,samples:count,spec,result},null,2))
        }
        report.cases.push(result);persist()
        const failed=result.rows.filter(r=>r.status==='error'||r.status==='over-budget')
        console.log(`${demo} ${spec.id}: ${result.rows.filter(r=>r.status==='pass').length} pass, ${failed.length} fail, ${result.rows.filter(r=>r.status==='unsupported').length} unsupported`)
      }
    }finally{await page.close()}
  }
}catch(error){metadata.fatalError=String(error?.stack??error);throw error}
finally{server.close();persist()}
const final=summarize()
console.log(`Report: ${join(root,profile?'profile-report.json':'report.json')}`)
const {failures,...counts}=final.summary
console.log(JSON.stringify(counts,null,2))
console.table([...failures].sort((a,b)=>(b.firstRenderMs??b.cpuMs)-(a.firstRenderMs??a.cpuMs)).slice(0,12)
  .map(({demo,case:id,action,firstRenderMs,status})=>({demo,case:id,action,ms:firstRenderMs?.toFixed(1),status})))
for(const failure of failures.filter(row=>row.status==='error').slice(0,5))console.log(`${failure.demo}/${failure.case}/${failure.action}: ${failure.error}`)
if(!recordOnly&&(!final.complete||final.summary.failed))process.exitCode=1
