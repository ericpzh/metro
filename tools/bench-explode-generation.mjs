// Profile the real open-save and exploded-view interactions separately.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cpus } from 'node:os'
import { createHash } from 'node:crypto'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const path = process.argv[2]
if (!path) throw Error('Pass a .metro.json save path')
const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/explode-generation')
mkdirSync(output,{recursive:true})
const server=await serveDir(resolve('game/dist'),0)
const page=await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(output,`chrome-${process.pid}`),softwareGpu:false,commandTimeoutMs:600000})
try {
  await page.send('Runtime.enable')
  page.onEvent('Runtime.consoleAPICalled', e => { if(e.args[0]?.value === 'EXPLODE_STAGE') console.log(...e.args.map(a=>a.value)) })
  await waitFor(page.evaluate,'!!window.__scene && !!window.__metro',{what:'game shell'})
  const raw=readFileSync(resolve(path),'utf8')
  await page.evaluate(`(()=>{window.__stageTimings=[];const scene=window.__scene;window.__oldStationData=scene.ctx.stationData;function wrap(obj,name,label){const proto=Object.getPrototypeOf(obj),old=proto[name];if(typeof old!=='function')throw Error('Missing '+label);proto[name]=function(...args){const t=performance.now();console.log('EXPLODE_STAGE','start',label);try{return old.apply(this,args)}finally{const ms=performance.now()-t;console.log('EXPLODE_STAGE','end',label,Math.round(ms));window.__stageTimings.push({stage:label,ms,standalone:this instanceof scene.constructor ? !!this.standalonePresentation : null})}}}for(const [obj,name,label] of [[scene,'setStation','scene.setStation'],[scene,'enableExplodedLayout','scene.enableExplodedLayout'],[scene,'setExplodedRampSections','scene.setExplodedRampSections'],[scene.chunks,'prepareStation','chunks.prepareStation'],[scene.chunks,'meshStation','chunks.meshStation'],[scene.modules,'buildModules','modules.buildModules'],[scene.level,'applyLevel','level.applyLevel'],[scene.modules,'syncBatches','modules.syncBatches'],[scene.trains,'prepareForStation','trains.prepareForStation'],[scene.sectionSys,'applyClip','section.applyClip'],[scene.grid,'buildGrid','grid.buildGrid']])wrap(obj,name,label);window.__metro.getState().setPlaying(false)})()`)
  await page.send('Profiler.enable'); await page.send('Profiler.start')
  console.log('Opening saved station...')
  const start=Date.now()
  const loaded=await page.evaluate(`(()=>{const t=performance.now();const result=window.__metro.getState().loadFromText(${JSON.stringify(raw)});return {result,ms:performance.now()-t}})()`)
  const openSaveWallMs=Date.now()-start
  console.log('Save parsed:',JSON.stringify(loaded),'wall ms',openSaveWallMs)
  await waitFor(page.evaluate,`window.__scene.ctx.stationData && window.__scene.ctx.stationData !== window.__oldStationData && window.__scene.framesRendered>0`,{tries:1200,every:500,what:'installed station'})
  const loadProfile=await page.send('Profiler.stop');writeFileSync(resolve(output,'load.cpuprofile'),JSON.stringify(loadProfile.profile))
  console.log('Station installed; starting explode...')
  await page.evaluate('window.__stageTimings=[]')
  if(process.env.BENCH_PROFILE !== '0') await page.send('Profiler.start')
  const explodeStart=Date.now()
  await page.evaluate(`(() => {
    const start = performance.now()
    window.__explodeMilestones = {}
    const watch = new MutationObserver(() => {
      const viewer = document.querySelector('.explodedViewer')
      if (viewer?.dataset.ready === 'true') window.__explodeMilestones.structureMs ??= performance.now() - start
      if (viewer?.dataset.equipped === 'true') {
        window.__explodeMilestones.equipmentMs = performance.now() - start
        watch.disconnect()
      }
    })
    watch.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['data-ready','data-equipped']})
    window.__metro.getState().setExplodedView(true)
  })()`)
  await waitFor(page.evaluate,`document.querySelector('.explodedViewer')?.dataset.ready==='true'`,{tries:1200,every:500,what:'exploded view'})
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const durationMs=Date.now()-explodeStart
  if (await page.evaluate("document.querySelector('.explodedViewer')?.hasAttribute('data-equipped')")) {
    await waitFor(page.evaluate, "document.querySelector('.explodedViewer')?.dataset.equipped==='true'", {tries:1200,every:500,what:'exploded equipment'})
  }
  const milestones = await page.evaluate('window.__explodeMilestones')
  if(process.env.BENCH_PROFILE !== '0') {const profile=await page.send('Profiler.stop');writeFileSync(resolve(output,'explode.cpuprofile'),JSON.stringify(profile.profile))}
  const screenshot=await page.send('Page.captureScreenshot',{format:'png'})
  writeFileSync(resolve(output,'exploded.png'),Buffer.from(screenshot.data,'base64'))
  const stages=await page.evaluate(`({stages:window.__stageTimings,canvas:[...document.querySelector('.explodedViewer canvas')? [document.querySelector('.explodedViewer canvas').width,document.querySelector('.explodedViewer canvas').height]:[]],ready:document.querySelector('.explodedViewer')?.dataset.ready})`)
  const browser=await page.send('Browser.getVersion')
  const sourceHash=JSON.parse(readFileSync(resolve('game/dist/editor-benchmark-build.json'),'utf8')).sourceHash
  const report={fixture:resolve(path),fixtureSha256:createHash('sha256').update(raw).digest('hex'),sourceHash,cpu:cpus()[0]?.model,platform:process.platform,node:process.version,browser:browser.product,mode:'Chrome headless, hardware requested',profiledExplode:process.env.BENCH_PROFILE !== '0',openSave:loaded,openSaveWallMs,explodeWallMs:durationMs,...milestones,...stages}
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
} finally {await page.close();server.close()}
