import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { withPage, waitFor } from '../browser-harness.mjs'

const root=resolve(import.meta.dirname,'../..'), out=resolve(process.argv[2]??'')
if (!process.argv[2] || !out.startsWith(resolve(root,'.preview/unity')+sep)) throw Error('Expected run directory under .preview/unity')
const requiredCases = new Set(process.argv.slice(3))
for (const flag of requiredCases) if (!['--require-second','--require-detour'].includes(flag)) throw Error(`Unknown option ${flag}`)
const packed=join(out,'packed'), report={status:'running', stages:[], errors:[], requiredCases:[...requiredCases]}
const save=()=>writeFileSync(join(out,'first-playable-report.json'),JSON.stringify(report,null,2))
save()
async function port() { const s=createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p }
const workerPort=await port(), debugPort=await port(), base=`http://127.0.0.1:${workerPort}`
const temp=join(out,'first-playable-temp'); mkdirSync(temp,{recursive:true})
const config=join(out,'first-playable-wrangler.jsonc')
writeFileSync(config,JSON.stringify({name:'metro-first-playable',main:join(root,'tools/unity-web/local-worker.mjs'),compatibility_date:'2026-10-01',assets:{directory:packed,binding:'ASSETS',run_worker_first:true}}))
const wrangler=process.env.METRO_WRANGLER || join(root,'node_modules/wrangler/bin/wrangler.js')
const server=spawn(process.execPath,[wrangler,'dev','--config',config,'--local','--persist-to',join(out,'first-playable-worker'),'--port',String(workerPort),'--ip','127.0.0.1'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,TEMP:temp,TMP:temp}})
let page
try {
  for(let i=0;i<120;i++) { try { if((await fetch(base+'/game/')).ok) break } catch {} if(i===119) throw Error('Worker did not start'); await new Promise(r=>setTimeout(r,500)) }
  async function open(profile) {
    const p=await withPage({url:'about:blank',profile:join(out,profile),debugPort,windowSize:'1280,800'})
    p.onEvent('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails?.text??'exception'))
    p.onEvent('Runtime.consoleAPICalled',e=>{if(e.type==='error')report.errors.push(e.args.map(a=>a.value??a.description).join(' '))})
    await p.send('Network.enable'); await p.send('Runtime.enable'); await p.send('Page.enable')
    const loaded=p.waitForEvent('Page.loadEventFired'); await p.send('Page.navigate',{url:base+'/game/'}); await loaded
    await waitFor(p.evaluate,'!!window.firstPlayableState',{what:'first playable ready',tries:360})
    return p
  }
  async function click(x,y) { const pos=await page.evaluate(`(()=>{let r=document.querySelector('canvas').getBoundingClientRect();return {x:r.left+${x},y:r.top+${y}}})()`); await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1}); await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',clickCount:1}) }
  const state=()=>page.evaluate('window.firstPlayableState')
  async function wait(expr,what) { await waitFor(page.evaluate,expr,{what,tries:180}) }
  async function run(expectedGate=0) {
    const observed=[]; let queuePosition, detourApproach=false
    await click(237,32)
    for(let i=0;i<200;i++) { const s=await state(); if(observed.at(-1)!==s.stage) observed.push(s.stage); if(Math.abs(s.passengerX-2.5)<.15 && Math.abs(s.passengerY-2.5)<.15) detourApproach=true; if(s.stage==='Queuing') queuePosition={x:s.passengerX,y:s.passengerY}; if(s.boarded===1) {
      const required=['WalkingToGate','Queuing','ThroughGate','Platform','Boarded']; let next=0
      for(const stage of observed) if(stage===required[next]) next++
      if(next!==required.length) throw Error(`Missing ordered stages: ${observed.join(', ')}`)
      if(!(s.doorMovement>.01)) throw Error('Platform train door did not open')
      if(expectedGate===2 && !detourApproach) throw Error('Passenger did not walk the detour approach')
      if(expectedGate && (!queuePosition || Math.abs(queuePosition.x-(expectedGate===2?2.5:2.5))>.6 || Math.abs(queuePosition.y-(expectedGate===2?2.5:1.5))>.3)) throw Error(`Passenger queued away from selected gate: ${JSON.stringify(queuePosition)}`)
      report.stages.push(observed); return queuePosition
    } await new Promise(r=>setTimeout(r,100)) }
    throw Error('Passenger did not board')
  }
  page=await open('first-playable-chrome-1')
  await click(237,32); await wait("window.firstPlayableState.message.includes('first')",'incomplete route message'); report.incompleteRouteRefused=true
  await click(50,32)
  const slot=await page.evaluate("(()=>{let r=document.querySelector('canvas').getBoundingClientRect();return {x:r.width/2-r.height*.05,y:r.height/2}})()")
  await click(slot.x,slot.y); await wait('window.firstPlayableState.floor','floor placement')
  await click(145,32); await click(slot.x,slot.y); await wait('window.firstPlayableState.gate','gate placement')
  await run()
  const shot=await page.send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,'first-playable-boarding.png'),Buffer.from(shot.data,'base64'))
  await page.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out})
  await click(325,32)
  const download=join(out,'first-station.metro.json')
  for(let i=0;i<100&&!existsSync(download);i++) await new Promise(r=>setTimeout(r,100))
  if(!existsSync(download)) throw Error('Save download missing')
  JSON.parse(readFileSync(download,'utf8'))
  // Start a fresh page in the same browser session; no in-memory station survives navigation.
  const loaded=page.waitForEvent('Page.loadEventFired'); await page.send('Page.navigate',{url:base+'/game/'}); await loaded
  await waitFor(page.evaluate,'!!window.firstPlayableState',{what:'reopened page ready',tries:360})
  if((await state()).floor || (await state()).gate) throw Error('Fresh page unexpectedly retained edits')
  await page.send('Page.setInterceptFileChooserDialog',{enabled:true})
  const chooser=page.waitForEvent('Page.fileChooserOpened'); await click(415,32); const chosen=await chooser
  await page.send('DOM.setFileInputFiles',{files:[download],backendNodeId:chosen.backendNodeId})
  await wait('window.firstPlayableState.floor && window.firstPlayableState.gate','reopened edits'); report.restored=await state()
  await run()
  const invalid=join(out,'invalid-station.json'); writeFileSync(invalid,'not json')
  const badChooser=page.waitForEvent('Page.fileChooserOpened'); await click(415,32); const bad=await badChooser
  await page.send('DOM.setFileInputFiles',{files:[invalid],backendNodeId:bad.backendNodeId})
  await wait("window.firstPlayableState.message.includes('Could not open')",'invalid import message')
  if(!(await state()).floor || !(await state()).gate) throw Error('Invalid import changed the station')
  report.invalidImportPreservedEdits=true
  if (requiredCases.has('--require-second') && (await state()).secondFloorScreenX === undefined) throw Error('Required second layout bridge fields missing')
  if ((await state()).secondFloorScreenX !== undefined) {
  // A fresh station: put the second gate on its fixed slab without an
  // approach, proving that a disconnected gate cannot start service.
  const secondLoaded=page.waitForEvent('Page.loadEventFired'); await page.send('Page.navigate',{url:base+'/game/'}); await secondLoaded
  await waitFor(page.evaluate,'!!window.firstPlayableState',{what:'second layout ready',tries:360})
  let s=await state(); await click(145,32); await click(s.secondGateScreenX,s.secondGateScreenY)
  await wait('window.firstPlayableState.secondGate','second gate placement')
  await click(237,32); await wait("window.firstPlayableState.message.includes('disconnected')",'disconnected route explanation')
  report.disconnectedMessage=(await state()).message
  s=await state(); await click(50,32); await click(s.secondFloorScreenX,s.secondFloorScreenY)
  await wait('window.firstPlayableState.secondFloor','second approach floor')
  report.secondGateQueue=await run(1)
  const secondShot=await page.send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,'second-layout-boarding.png'),Buffer.from(secondShot.data,'base64'))
  const secondDownloads=join(out,'second-layout-download'); mkdirSync(secondDownloads,{recursive:true})
  await page.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:secondDownloads}); await click(325,32)
  const secondSave=join(secondDownloads,'first-station.metro.json')
  for(let i=0;i<100&&!existsSync(secondSave);i++) await new Promise(r=>setTimeout(r,100))
  if(!existsSync(secondSave)) throw Error('Second layout save missing')
  const secondReopen=page.waitForEvent('Page.loadEventFired'); await page.send('Page.navigate',{url:base+'/game/'}); await secondReopen
  await waitFor(page.evaluate,'!!window.firstPlayableState',{what:'second layout reopen ready',tries:360})
  const secondChooser=page.waitForEvent('Page.fileChooserOpened'); await click(415,32); const secondChosen=await secondChooser
  await page.send('DOM.setFileInputFiles',{files:[secondSave],backendNodeId:secondChosen.backendNodeId})
  await wait('window.firstPlayableState.secondFloor && window.firstPlayableState.secondGate','second layout restored')
  report.secondRestored=await state(); report.secondReopenedQueue=await run(1)
  }
  if (requiredCases.has('--require-detour')) {
    const detourLoaded=page.waitForEvent('Page.loadEventFired'); await page.send('Page.navigate',{url:base+'/game/'}); await detourLoaded
    await waitFor(page.evaluate,'!!window.firstPlayableState',{what:'detour ready',tries:360})
    let d=await state(); if(d.detourApproachScreenX===undefined || d.detourFloorScreenX===undefined) throw Error('Required detour bridge fields missing')
    await click(50,32); await click(d.detourFloorScreenX,d.detourFloorScreenY); await wait('window.firstPlayableState.detourFloor','detour gate floor')
    await click(145,32); await click(d.detourFloorScreenX,d.detourFloorScreenY); await wait('window.firstPlayableState.detourGate','detour gate')
    await click(237,32); await wait("window.firstPlayableState.message.includes('disconnected')",'detour disconnected explanation')
    await click(50,32); await click(d.detourApproachScreenX,d.detourApproachScreenY); await wait('window.firstPlayableState.detourApproach','detour approach')
    report.detourQueue=await run(2)
    const shot=await page.send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,'detour-boarding.png'),Buffer.from(shot.data,'base64'))
    const dir=join(out,'detour-download'); mkdirSync(dir,{recursive:true}); await page.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir}); await click(325,32)
    const file=join(dir,'first-station.metro.json'); for(let i=0;i<100&&!existsSync(file);i++) await new Promise(r=>setTimeout(r,100))
    if(!existsSync(file)) throw Error('Detour save missing')
    const reload=page.waitForEvent('Page.loadEventFired'); await page.send('Page.navigate',{url:base+'/game/'}); await reload
    await waitFor(page.evaluate,'!!window.firstPlayableState',{what:'detour reopen ready',tries:360})
    const chooser=page.waitForEvent('Page.fileChooserOpened'); await click(415,32); const chosen=await chooser
    await page.send('DOM.setFileInputFiles',{files:[file],backendNodeId:chosen.backendNodeId})
    await wait('window.firstPlayableState.detourApproach && window.firstPlayableState.detourFloor && window.firstPlayableState.detourGate','detour restored')
    report.detourRestored=await state(); report.detourReopenedQueue=await run(2); report.detourSave=file
  }
  if(report.errors.length) throw Error(report.errors.join('; '))
  report.status='passed'; report.save=download; report.final=await state(); save(); console.log(JSON.stringify(report))
} catch(e) {
  report.status='failed'; report.error=String(e.stack||e)
  if(page) { try { report.lastState=await page.evaluate('window.firstPlayableState'); const shot=await page.send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,'first-playable-failure.png'),Buffer.from(shot.data,'base64')) } catch {} }
  save(); throw e
}
finally { await page?.close(); server.kill() }
