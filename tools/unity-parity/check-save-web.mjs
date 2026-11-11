import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { serveDir, withPage, waitFor } from '../browser-harness.mjs'
import { parse, serialize } from '../../game/src/persistence/save.ts'
const out=resolve(process.argv[2] ?? '.preview/unity/save-web-proof'), reportPath=join(out,'web-save-report.json')
const report={status:'running',startedAt:new Date().toISOString()}, save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n')
save(); let server,page
try {
 server=await serveDir(join(out,process.argv[3]??'web'),0)
 page=await withPage({url:'about:blank',profile:join(out,`chrome-${process.pid}`),debugPort:19340,windowSize:'1280,800'})
 const errors=[]
 page.onEvent('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails?.text??'exception'))
 page.onEvent('Runtime.consoleAPICalled',e=>{if(e.type==='error') errors.push(e.args.map(x=>x.value??x.description??'error').join(' '))})
 page.onEvent('Network.loadingFailed',e=>{if(!e.canceled)errors.push(e.errorText)})
 page.onEvent('Network.responseReceived',e=>{if(e.response.status>=400)errors.push(`HTTP ${e.response.status}: ${e.response.url}`)})
 await page.send('Runtime.enable');await page.send('Network.enable');await page.send('Page.enable')
 const loaded=page.waitForEvent('Page.loadEventFired');await page.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await loaded
 await waitFor(page.evaluate,'!!window.__metroSaveParity',{what:'IL2CPP save result',tries:600,every:500})
 const result=await page.evaluate('window.__metroSaveParity')
 if(result.status!=='passed')throw Error(result.error??'Unity parser failed')
 if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`)
 const original=readFileSync('video/demo-station.metro.json','utf8'), expected=parse(original), actual=parse(result.output)
 if(!expected.ok||!actual.ok)throw Error('TypeScript refused authored or Web output')
 deepStrictEqual(actual.state,expected.state);strictEqual(result.droppedCells,expected.droppedCells);strictEqual(result.droppedModules,expected.droppedModules)
 deepStrictEqual(JSON.parse(result.output),JSON.parse(serialize(expected.state,new Date('2020-01-02T03:04:05.000Z'))))
 writeFileSync(join(out,'cs-web-output.json'),result.output)
 Object.assign(report,{status:'passed',fixtureSha256:createHash('sha256').update(original).digest('hex'),outputSha256:createHash('sha256').update(result.output).digest('hex'),droppedCells:result.droppedCells,droppedModules:result.droppedModules,cells:actual.state.cells.length,modules:actual.state.modules.length,lines:actual.state.lines.length,timestamp:JSON.parse(result.output).savedAt});save();console.log(JSON.stringify(report))
} catch(e) {report.status='failed';report.error=e.stack??String(e);save();console.error(e);process.exitCode=1} finally {await page?.close();if(server)await new Promise(ok=>server.close(ok))}
