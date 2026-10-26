import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const cells = [0, 64].flatMap(x => [-15, -5].flatMap(z => [0, 1].flatMap(dx => [0, 1].map(y => ({ x: x + dx, y, z, fill: 'solid' })))))
const fixture = { ...JSON.parse(readFileSync('game/src/data/demo-station.json', 'utf8')), cells, modules: [], lines: [], name: 'Level group retention' }
const output = resolve('.preview/level-retention')
writeFileSync(resolve(output, 'fixture.json'), JSON.stringify(fixture))
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(output, `chrome-${process.pid}`), debugPort: 15000 + process.pid % 20000 })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  await page.evaluate("document.querySelector('.tutorialActions .ghost')?.click()")
  await page.evaluate(`__metro.getState().commit(${JSON.stringify(fixture)}); __metro.setState({ activeZ: -5, playing: false, autoCeiling: true, ghostOtherLevels: false })`)
  await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  const result = await page.evaluate(`(async () => {
    const s = __scene, chunks = s.chunks;
    const full = __metro.getState().station;
    const retained = chunks.chunkMeshes.filter(m => m.userData.levelZ === -5 && m.geometry.boundingBox.min.x >= 64);
    const rows = [];
    for (const initialZ of [-15, -5]) {
      s.setLevel(initialZ, false);
      for (const action of ['delete', 'fill']) {
        const next = action === 'delete' ? full.cells.filter(c => !(c.x === 0 && c.y === 0 && c.z === -5)) : full.cells;
        const start = performance.now();
        __metro.getState().commit({ ...full, cells: next });
        const commitMs = performance.now() - start;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const feedbackMs = performance.now() - start;
        let sceneChunks = 0;
        s.ctx.scene.traverse(o => { if (o.isMesh && o.userData.cells !== undefined) sceneChunks++; });
        const ownershipErrors = chunks.chunkMeshes.filter(m => m.parent !== chunks.levelGroups.get(m.userData.levelZ)).length;
        const visibility = [];
        for (const z of [-15, -5, -15, -5]) {
          s.setLevel(z, false);
          visibility.push({ z, visible: retained.filter(m => m.visible).length });
        }
        rows.push({ initialZ, action, commitMs, feedbackMs, ownershipErrors, sceneChunks, trackedChunks: chunks.chunkMeshes.length, retained: retained.every(m => chunks.chunkMeshes.includes(m)), visibility });
      }
    }
    return { retainedCount: retained.length, rows, canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], browser: navigator.userAgent };
  })()`)
  assert.ok(result.retainedCount > 0)
  for (const row of result.rows) {
    assert.equal(row.ownershipErrors, 0)
    assert.equal(row.sceneChunks, row.trackedChunks)
    assert.ok(row.retained)
    for (const v of row.visibility) assert.equal(v.visible, v.z === -5 ? result.retainedCount : 0)
  }
  result.fixtureSha256 = createHash('sha256').update(JSON.stringify(fixture)).digest('hex')
  result.buildIndexSha256 = createHash('sha256').update(readFileSync('game/dist/index.html')).digest('hex')
  writeFileSync(resolve(output, 'browser.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await page?.close(); server.close() }
