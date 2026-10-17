import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const output = resolve('.preview/road-vehicles'); mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/?capture-road-vehicles`, profile: resolve(output, `chrome-${process.pid}`), debugPort: 9467 })
  await waitFor(page.evaluate, '!!window.__roadVehiclesReady', { what: 'production road vehicle models' })
  await page.evaluate(`window.__vehicleErrors=[];addEventListener('error',e=>__vehicleErrors.push(e.message));addEventListener('unhandledrejection',e=>__vehicleErrors.push(String(e.reason)))`)
  const reports = []
  for (const detail of ['high', 'low']) for (const rear of [false, true]) {
    const result = await page.evaluate(`window.__roadVehicles.captureRoadVehicles(${rear}, '${detail}')`)
    assert.equal(result.models.length, 6)
    for (const m of result.models) { assert.ok(m.submittedTriangles > 0, m.variant); assert.ok(m.draws <= 9, m.variant) }
    writeFileSync(resolve(output, `${detail}-${rear ? 'rear' : 'front'}.png`), Buffer.from(result.png.split(',')[1], 'base64'))
    reports.push(...result.models)
    console.log(result.models)
  }
  const counts = Object.fromEntries(reports.map(m => [`${m.variant}:${m.detail}`, m.colorTriangles]))
  for (const variant of ['suv','sedan','bus-orange','bus-mosaic','moped','bicycle']) assert.ok(counts[`${variant}:low`] < counts[`${variant}:high`], `${variant} has an authored Low reduction (${counts[`${variant}:low`]} vs ${counts[`${variant}:high`]})`)
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(reports, null, 2))
  assert.deepEqual(await page.evaluate('__vehicleErrors'), [])
} finally { await page?.close(); server.close() }
