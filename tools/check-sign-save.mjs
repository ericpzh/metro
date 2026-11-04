import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '../game/src/persistence/save.ts'
import { hangCeilingLocal } from '../game/src/sim/placement.ts'
import { storeyBand } from '../game/src/sim/constants.ts'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

// Optional diagnostic for the supplied Tianhe save; never modifies that file.
assert.ok(process.argv[2], 'Usage: node tools/check-sign-save.mjs <save-path> [sign-id]')
const input = readFileSync(process.argv[2], 'utf8')
const state = parse(input).state
assert.ok(state, 'save must parse successfully')
const id = process.argv[3] ?? 'sign-ceiling-3287'
const mod = state.modules.find(m => m.id === id)
assert.equal(mod?.type, 'sign', `save must contain ${id}`)
const z = mod.z + 1 + hangCeilingLocal(mod, state.cells, state.modules) - .65
const activeZ = storeyBand(mod.z, state.levelBase)
const output = resolve('.preview/perf/sign-save')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(output, `chrome-${process.pid}`), debugPort: 12000 + process.pid % 30000, softwareGpu: false })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro?.getState().metrics')
  const settle = () => page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  const capture = async name => {
    await settle()
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(resolve(output, `${name}.png`), Buffer.from(shot.data, 'base64'))
  }
  const view = async rear => page.evaluate(`(() => {
    __scene.setOrtho(false);
    const cs = __scene.cameraSys;
    cs.controls.enableDamping = false;
    cs.camera.position.set(${mod.x + (rear ? -7 : 7)}, ${mod.y - 3}, ${z + 2});
    cs.controls.target.set(${mod.x + .5}, ${mod.y + .5}, ${z});
    cs.controls.update(); cs.camera.updateMatrixWorld(true); __scene.requestRender();
  })()`)
  await page.evaluate(`(() => {
    document.querySelector('.tutorialActions .ghost')?.click();
    __metro.getState().commit(${JSON.stringify(state)});
    __metro.setState({ playing: false, activeZ: ${activeZ}, ghostOther: true, autoCeiling: false, cutaway: false });
  })()`)
  await settle()
  await view(false)
  await capture('placed')
  const diagnostic = await page.evaluate(`(() => {
    const root = __scene.modules.moduleMeshes.children.find(g => g.userData.moduleId === ${JSON.stringify(id)});
    return { visible: root.visible, levels: root.userData.levelZs,
      plates: [...__scene.plates.signPlates.keys()].filter(k => k.startsWith(${JSON.stringify(`${id}|`)})),
      meshes: root.children.map(m => ({ visible: m.visible, material: m.material?.type, map: !!m.material?.map,
        side: m.material?.side, pos: m.position.toArray(), layers: m.layers.mask })) };
  })()`)
  assert.equal(diagnostic.visible, true)
  assert.ok(diagnostic.plates.some(k => k.includes('|left|')), 'saved front has a printed plate')
  if (!mod.cfg.back?.length) assert.equal(diagnostic.plates.length, 1, 'saved empty back stays empty')
  for (const quality of ['low', 'high']) for (const level of [activeZ, activeZ + 5]) {
    await page.evaluate(`(() => { __metro.getState().setGraphicsQuality('${quality}');
      __metro.getState().setActiveZ(${level}); __scene.setModulePreview(null); })()`)
    await capture(`${quality}-${level}`)
  }
  await page.evaluate(`__metro.getState().setActiveZ(${activeZ})`)
  await view(true)
  await capture('rear')
  await page.evaluate(`__scene.setModulePreview(__metro.getState().station.modules.find(m => m.id === ${JSON.stringify(id)}), false, 0x168cff)`)
  await capture('hover')
  const report = { observedAt: new Date().toISOString(), saveSha256: createHash('sha256').update(input).digest('hex'),
    build: JSON.parse(readFileSync(resolve('game/dist/editor-benchmark-build.json'), 'utf8')), id, z, diagnostic }
  writeFileSync(resolve(output, 'browser.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await page?.close()
  server.close()
}
