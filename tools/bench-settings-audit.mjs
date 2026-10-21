import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, loadExampleStation } from './browser-harness.mjs'

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/settings-audit.json')
mkdirSync(resolve('.preview/perf'), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({url:`http://127.0.0.1:${server.address().port}/`,profile:resolve(`.preview/perf/settings-${process.pid}`),debugPort:9434,windowSize:'1440,1000'})
  await loadExampleStation(page, process.env.BENCH_DEMO ?? 'zoo')
  await page.evaluate(`__metro.getState().seekToDate({year:2026,month:1,day:5})`)
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  await page.evaluate(`(() => {
    window.__audit={samples:[],work:{},errors:[]};
    addEventListener('error',e=>__audit.errors.push(e.message));
    addEventListener('unhandledrejection',e=>__audit.errors.push(String(e.reason)));
    for(const [obj,key] of [[__scene,'setStation'],[__scene.chunks,'prepareStation'],[__scene.chunks,'meshStation'],[__scene.modules,'buildModules'],[__scene.modules.batches,'invalidateViews'],[__scene,'requestRender'],[__scene.renderer,'render']]){
      const fn=obj[key].bind(obj); obj[key]=(...args)=>{const t=performance.now();const r=fn(...args);const w=__audit.work[key]??={calls:0,ms:0};w.calls++;w.ms+=performance.now()-t;if(key==='requestRender')(w.stacks??=[]).push(new Error().stack);return r;};
    }
  })()`)
  const key = async (key, code, windowsVirtualKeyCode) => {
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode})
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode})
  }
  const kinds=process.env.BENCH_REMAINING==='1'?['line-name','terminus','colour','station-name','exit-name','exit-open','population','restart']:process.env.BENCH_METADATA==='1'?['line-name']:['headway','demand','service','peak','undo','redo']
  for(const kind of kinds) {
    if(['demand','service','peak'].includes(kind)) await page.evaluate('__metro.getState().setTimePanel(true)')
    for(let i=0;i<2;i++) {
      if(kind==='headway') await page.evaluate(`(()=>{const el=document.querySelector('.headwayNum');el.scrollIntoView();el.focus()})()`)
      if(kind==='line-name') await page.evaluate(`(()=>{const el=document.querySelector('.lineDeleteBtn').parentElement.querySelector('input');el.scrollIntoView();el.focus()})()`)
      if(kind==='terminus') await page.evaluate(`(()=>{const el=document.querySelector('.lineDeleteBtn').closest('.disclosure').querySelectorAll('.lineNameInput')[1];el.scrollIntoView();el.focus()})()`)
      if(['exit-name','exit-open','population'].includes(kind)) await page.evaluate(`(()=>{const range=document.querySelector('input[max="6000"]');const el=${JSON.stringify(kind)}==='population'?range:range.closest('.card').querySelector(${JSON.stringify(kind==='exit-name'?'input.lineNameInput':'input[type="checkbox"]')});el.scrollIntoView();el.focus()})()`)
      if(kind==='demand') await page.evaluate(`(()=>{const el=document.querySelector('.knob input');el.scrollIntoView();el.focus()})()`)
      if(kind==='service'||kind==='peak') await page.evaluate(`(()=>{const el=document.querySelectorAll('.curveGripHit')[${kind==='service'?0:2}];if(!el)throw Error('Missing curve grip');el.scrollIntoView();el.focus()})()`)
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      await page.evaluate(`(()=>{__audit.work={};__audit.start=performance.now();__audit.v=__metro.getState().version;__audit.cpu=0;__audit.metrics=__metro.getState().metrics})()`)
      if(kind==='headway') { await key('ArrowUp','ArrowUp',38); await key('Tab','Tab',9) }
      else if(['line-name','terminus','exit-name'].includes(kind)) { await page.send('Input.insertText',{text:'x'}); await key('Tab','Tab',9) }
      else if(kind==='exit-open') await key(' ','Space',32)
      else if(kind==='population') await key('ArrowRight','ArrowRight',39)
      else if(kind==='colour') await page.evaluate(`(()=>{const s=__metro.getState();s.updateLine(s.station.lines[0].id,{colour:${i?'"#884422"':'"#228844"'}})})()`)
      else if(kind==='station-name') await page.evaluate(`(()=>{const s=__metro.getState();s.renameStation(s.station.name+'x')})()`)
      else if(kind==='restart') {await page.evaluate('__metro.getState().restartSim()');for(let tries=0;tries<100;tries++){if(await page.evaluate('__metro.getState().metrics!==__audit.metrics'))break;await new Promise(r=>setTimeout(r,10));}}
      else if(['demand','service','peak'].includes(kind)) await key('ArrowRight','ArrowRight',39)
      else await page.evaluate(`(()=>{const t=performance.now();__metro.getState().${kind}();__audit.cpu=performance.now()-t})()`)
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      await page.evaluate(`__audit.samples.push({kind:${JSON.stringify(kind)},iteration:${i},ms:performance.now()-__audit.start,cpu:__audit.cpu,commits:Math.abs(__metro.getState().version-__audit.v),work:{...__audit.work}})`)
    }
  }
  const report=await page.evaluate(`({...__audit,fixture:{name:__metro.getState().station.name,seed:__metro.getState().station.seed,cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length,level:__metro.getState().activeZ,population:__metro.getState().metrics.population},userAgent:navigator.userAgent})`)
  writeFileSync(output,JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2))
  if(process.env.BENCH_SCREENSHOT==='1') {
    const shot=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(output.replace(/\.json$/,'.png'),Buffer.from(shot.data,'base64'))
    const ink=await page.evaluate(`(()=>{const out={};for(const root of __scene.modules.moduleMeshes.children)root.traverse(m=>{if(!m.isMesh)return;for(const mat of Array.isArray(m.material)?m.material:[m.material]){const c=mat.map?.image;if(!c?.toDataURL)continue;if(m.name==='psd-station-header'&&!out.psd)out.psd=c.toDataURL();if(root.userData.moduleType==='exit'&&c.width===512&&c.height===96&&!out.exit)out.exit=c.toDataURL();}});return out})()`)
    for(const [kind,data] of Object.entries(ink))writeFileSync(output.replace(/\.json$/,`-${kind}.png`),Buffer.from(data.split(',')[1],'base64'))
  }
  if(report.errors.length||report.samples.some(s=>s.commits!==(s.kind==='restart'?0:1))) throw Error('Interaction failed')
  if(process.env.BENCH_ASSERT_FAST==='1'&&report.samples.some(s=>Object.keys(s.work).some(k=>!['requestRender','render'].includes(k)))) throw Error('Nonstructural edit rebuilt scene resources')
  if(process.env.BENCH_ASSERT_FAST==='1'&&report.samples.some(s=>['exit-open','population'].includes(s.kind)&&(s.work.requestRender?.calls??0)>0)) throw Error('Invisible edit requested a 3D redraw')
} finally {await page?.close();server.close()}
