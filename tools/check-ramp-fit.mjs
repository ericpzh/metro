// Production-browser fixture for continuous terrain contact under wide runs.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createModule } from '../game/src/build/model.ts'
import { rampSlopeCuts } from '../game/src/sim/openings.ts'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const output = resolve('.preview/ramp-fit')
mkdirSync(output, { recursive: true })
const modules = [createModule('escalator', 0, 0, 0, 'escalator', 0, 3), createModule('stair-straight', 5, 0, 0, 'stair', 0, 2.04)]
const cuts = rampSlopeCuts(modules)
const cells = new Map()
for (const key of cuts.keys()) {
  const z = key % 8192 - 4096
  const t = (key - z - 4096) / 8192
  const y = t % 8192 - 4096
  const x = (t - y - 4096) / 8192 - 4096
  for (let level = 0; level <= z; level++) cells.set(`${x},${y},${level}`, { x, y, z: level, fill: 'solid' })
}
for (let x = -4; x <= 8; x++) for (let y = -2; y <= 12; y++) cells.set(`${x},${y},0`, { x, y, z: 0, fill: 'solid' })
const fixture = { ...JSON.parse(readFileSync('game/src/data/demo-station.json', 'utf8')), name: 'Ramp contact', cells: [...cells.values()], modules, lines: [] }
writeFileSync(resolve(output, 'fixture.json'), JSON.stringify(fixture, null, 2))
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(output, `chrome-${process.pid}`), debugPort: 15000 + process.pid % 20000 })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  await page.evaluate(`__metro.getState().commit(${JSON.stringify(fixture)}); __metro.setState({ activeZ: 0, playing: false, autoCeiling: false, ghostOtherLevels: true })`)
  await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  const result = await page.evaluate(`(async () => {
    const s = __scene, cs = s.cameraSys;
    s.setOrtho(false); cs.controls.enableDamping = false;
    cs.camera.position.set(18, -13, 12); cs.controls.target.set(2, 4, 2);
    cs.controls.update(); cs.camera.updateMatrixWorld(true); s.requestRender();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const times = [], commits = [];
    const modules = __metro.getState().station.modules;
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      __metro.getState().commit({ ...__metro.getState().station, modules: i % 2 === 0 ? modules.filter(m => m.id !== 'stair') : modules });
      commits.push(performance.now() - start);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - start);
    }
    return { action: 'delete/restore wide stair, alternating', commitMs: commits, feedbackMs: times, canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], slopeCells: s.ctx.slopeCuts.size, chunks: s.chunks.chunkMeshes.length, userAgent: navigator.userAgent };
  })()`)
  assert.ok(result.slopeCells > 20)
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(output, 'contact.png'), Buffer.from(screenshot.data, 'base64'))
  result.buildIndexSha256 = createHash('sha256').update(readFileSync('game/dist/index.html')).digest('hex')
  result.fixtureSha256 = createHash('sha256').update(JSON.stringify(fixture)).digest('hex')
  writeFileSync(resolve(output, 'browser.json'), JSON.stringify(result, null, 2))
  console.log(result)
} finally { await page?.close(); server.close() }
