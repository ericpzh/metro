import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

// Review the production batching path, including moving doors and both roofs.
const output = resolve('.preview/perf/transport-10pct/train-captures')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/?capture-trains`, profile: resolve(output, `chrome-${process.pid}`), debugPort: 9474 })
  await waitFor(page.evaluate, '!!window.__trainCardsReady', { what: 'train capture API' })
  await page.evaluate(`window.__transportErrors=[];addEventListener('error',e=>__transportErrors.push(e.message));addEventListener('unhandledrejection',e=>__transportErrors.push(String(e.reason)))`)
  const reports = []
  for (const stock of process.env.TRANSPORT_STOCKS?.split(',') ?? ['A','B','C','D','L']) for (const power of ['third-rail','catenary']) {
    for (const pose of ['front','side','closed','half','open']) {
      const elevation = pose === 'front' || pose === 'side'
      const baseId = `${elevation ? pose : 'car'}-${stock}`
      const id = `${stock}-${power}-${pose}`
      const frames = ['high','low'].map(detail => ({ id: `${id}-${detail}`, baseId, detail, power, width: elevation ? 640 : 1000, height: elevation ? 320 : 540, doorProgress: pose === 'open' ? 1 : pose === 'half' ? .5 : 0 }))
      const result = await page.evaluate(`__trainCards.captureTrains(${JSON.stringify(frames)})`)
      assert.equal(result.length, 2)
      for (const frame of result) writeFileSync(resolve(output, `${frame.id}.png`), Buffer.from(frame.png.split(',')[1], 'base64'))
      // Compare opaque silhouettes on elevations, where the background is transparent.
      if (elevation) {
        const comparison = await page.evaluate(`(async()=>{const images=await Promise.all(${JSON.stringify(result.map(f=>f.png))}.map(src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i);i.src=src})));const masks=images.map(i=>{const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);const d=x.getImageData(0,0,c.width,c.height).data;return Array.from({length:d.length/4},(_,p)=>d[p*4+3]>32)});let high=0,low=0,both=0;for(let p=0;p<masks[0].length;p++){high+=masks[0][p];low+=masks[1][p];both+=masks[0][p]&&masks[1][p]}return{high,low,coverage:both/high,iou:both/(high+low-both)}})()`)
        reports.push({ id, ...comparison })
        assert.ok(comparison.high > 1000, `${id} nonempty`)
        assert.ok(comparison.coverage > .8 && comparison.iou > .7, `${id} silhouette: ${JSON.stringify(comparison)}`)
      }
    }
    console.log(`${stock} ${power}: High/Low front, side and three door poses rendered`)
  }
  assert.deepEqual(await page.evaluate('__transportErrors'), [])
  const suffix = process.env.TRANSPORT_STOCKS ? `-${process.env.TRANSPORT_STOCKS}` : ''
  writeFileSync(resolve(output, `report${suffix}.json`), JSON.stringify(reports, null, 2))
} finally { await page?.close(); server.close() }
