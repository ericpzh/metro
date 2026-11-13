import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { loadExampleStation, serveDir, withPage, waitFor } from '../browser-harness.mjs'
import { parse as parseStation } from '../../game/src/persistence/save.ts'
import { toData } from '../../game/src/build/model.ts'
import { World } from '../../game/src/sim/world.ts'

const root = resolve(import.meta.dirname, '../..')
const out = resolve(process.argv[2] ?? '')
if (!out.startsWith(resolve(root, '.preview/unity') + sep)) throw Error('Expected a run directory under .preview/unity')
const serve = process.argv.includes('--serve')
const compare = process.argv.includes('--compare')
const c1Only = process.argv.includes('--c1-only')
const packed = join(out, 'packed')
const report = { status: 'running', errors: [], images: [], trace: [] }
const started = Date.now()
// A timestamped step marker in the report: on a long flow the last entry names the
// step that stalled even when the browser stops answering.
const mark = (name) => { report.trace.push({ name, ms: Date.now() - started }); writeFileSync(join(out, 'zoo-playable-report.json'), JSON.stringify(report, null, 2) + '\n') }
const save = () => writeFileSync(join(out, 'zoo-playable-report.json'), JSON.stringify(report, null, 2) + '\n')
async function freePort() {
  const socket = createServer()
  await new Promise(ok => socket.listen(0, '127.0.0.1', ok))
  const { port } = socket.address()
  await new Promise(ok => socket.close(ok))
  return port
}
const port = process.env.METRO_ZOO_PORT || await freePort()
const base = 'http://127.0.0.1:' + port
const url = base + '/game/en/'
const temp = join(out, 'zoo-temp')
mkdirSync(temp, { recursive: true })
const config = join(out, 'zoo-wrangler.jsonc')
writeFileSync(config, JSON.stringify({
  name: 'metro-zoo-playable', main: join(root, 'tools/unity-web/local-worker.mjs'),
  compatibility_date: '2026-10-01', assets: { directory: packed, binding: 'ASSETS', run_worker_first: true },
}))
const wrangler = process.env.METRO_WRANGLER || join(root, 'node_modules/wrangler/bin/wrangler.js')
const server = spawn(process.execPath, [wrangler, 'dev', '--config', config, '--local',
  '--persist-to', join(out, 'zoo-worker'), '--port', String(port), '--ip', '127.0.0.1'],
{ cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: temp, TMP: temp } })

let page, reference
const state = () => page.evaluate('(() => { const {document, ...summary} = window.zooPlayableState ?? {}; return summary })()')
// The walk from the entrance to the platform takes ~90–100 simulated seconds; give a
// service run a window that covers the longest supported approach.
const wait = (predicate, what, tries = 1200) => waitFor(page.evaluate, 'window.zooPlayableState && (' + predicate + ')',
  { tries, every: 125, what })
const screenshot = async (name) => {
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, name + '.png'), Buffer.from(shot.data, 'base64'))
  report.images.push(name + '.png')
}
const point = (x, y) => page.evaluate(`(() => {
  const r = document.querySelector('#unity-canvas').getBoundingClientRect()
  return { x: r.left + r.width * ${x}, y: r.top + r.height * ${y} }
})()`)
async function click(x, y) {
  const p = await point(x, y)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, buttons: 0 })
  await sleep(100)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(160)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
  await sleep(100)
}
async function control(name) {
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('#metro-unity-ui button')].find(b => (b.getAttribute('aria-label') || b.querySelector('.bpBlockLabel, .folderName')?.textContent.trim() || b.textContent.trim()) === ${JSON.stringify(name)});
    if (!button) throw Error('Missing control: ' + ${JSON.stringify(name)});
    button.scrollIntoView({block:'nearest'});
  })()`)
  await sleep(300)
  const rect = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('#metro-unity-ui button')].find(b => (b.getAttribute('aria-label') || b.querySelector('.bpBlockLabel, .folderName')?.textContent.trim() || b.textContent.trim()) === ${JSON.stringify(name)});
    if (!button || button.disabled) throw Error('Unavailable control: ' + ${JSON.stringify(name)});
    const r = button.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rect, buttons: 0 })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', buttons: 1, clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 })
  await sleep(100)
}
async function selectLevel(level) {
  const current = (await state()).level
  for (let next = current; next !== level; next += next > level ? -5 : 5) {
    const key = next > level ? 'q' : 'e', code = next > level ? 'KeyQ' : 'KeyE'
    await page.send('Input.dispatchKeyEvent', {type:'keyDown', key, code, windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})
    await page.send('Input.dispatchKeyEvent', {type:'keyUp', key, code, windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})
    await sleep(100)
  }
}
async function focusService() {
  // The original shell has no service-area shortcut; frame the fixture for
  // the canvas edits while exercising the actual shared construction tiles.
  await page.evaluate(`window.metroUnityInstance.SendMessage('ZooPlayable', 'BrowserCommand', JSON.stringify({type:'focusService'}))`)
}
async function closeTutorial() {
  await page.evaluate(`(() => { const skip = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skip'); if (skip) skip.click() })()`)
}
const clickSlot = async name => {
  const p = (await state())[name]
  await click(p.x, p.y)
}
async function clickCell(x, y) {
  const s = await state(), a = (17 * (x - 59) - 14 * (y - 18)) / 10
  const b = (8 * (y - 18) - 9 * (x - 59)) / 10
  const p = { x: s.gatePoint.x + a * (s.alternatePoint.x - s.gatePoint.x) + b * (s.connectorPoint.x - s.gatePoint.x),
    y: s.gatePoint.y + a * (s.alternatePoint.y - s.gatePoint.y) + b * (s.connectorPoint.y - s.gatePoint.y) }
  await click(p.x, p.y)
}
async function pan(fromX, fromY, toX, toY) {
  const from = await point(fromX, fromY), to = await point(toX, toY)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'right', buttons: 2, clickCount: 1 })
  await sleep(120)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, buttons: 2 })
  await sleep(120)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'right', clickCount: 1 })
}
async function navigate(destination) {
  const loaded = page.waitForEvent('Page.loadEventFired')
  await page.send('Page.navigate', { url: destination })
  await loaded
}
async function captureReference() {
  reference = await serveDir(join(root, 'game/dist'), 0)
  await navigate('http://127.0.0.1:' + reference.address().port + '/')
  await loadExampleStation(page)
  for (const [name, level, yaw, pitch, size, x, y] of [
    ['exterior', 0, -23, 53, 52, 68, 19],
    ['concourse', -5, -23, 53, 52, 68, 19],
    ['platform', -15, -12, 66, 15, 64, 10.5],
  ]) {
    await page.evaluate(`(() => {
      const state = window.__metro.getState();
      state.setActiveZ(${level});
      state.setHideGround(${level < 0});
      state.setGhostOther(true);
      state.setHideUI(false);
    })()`)
    await waitFor(page.evaluate, 'window.__scene.ctx.activeZ === ' + level, { what: name + ' reference level' })
    await page.evaluate(`(() => {
      const scene = window.__scene, view = scene.captureEditorView();
      const rad = Math.PI / 180, yaw = ${yaw} * rad, pitch = ${pitch} * rad;
      const direction = view.target.clone().set(-Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch));
      scene.setEdgeScrolling(false);
      scene.setViewDirection(direction, true);
      const next = scene.captureEditorView();
      next.target.set(${x}, ${y}, ${level + 1});
      next.position.copy(next.target).addScaledVector(direction, 160);
      next.zoom = ${size} / (scene.ctx.bounds.getSize(next.target.clone()).length() * .7);
      scene.restoreEditorView(next);
    })()`)
    await screenshot('typescript-' + name)
  }
}

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) break } catch {}
    if (i === 119) throw Error('Zoo Wrangler server did not start')
    await sleep(500)
  }
  console.log(url)
  if (serve) {
    await new Promise((ok, fail) => server.once('exit', code => code === 0 ? ok() : fail(Error('Wrangler stopped: ' + code))))
  } else {
    save()
    page = await withPage({ url: 'about:blank', profile: join(out, 'zoo-chrome-' + process.pid),
      debugPort: await freePort(), windowSize: '1280,800', softwareGpu: false, commandTimeoutMs: 420000, startupAttempts: 720 })
    page.onEvent('Runtime.exceptionThrown', e => report.errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text))
    page.onEvent('Runtime.consoleAPICalled', e => {
      if (e.type === 'error') report.errors.push(e.args.map(a => a.value ?? a.description).join(' '))
    })
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await navigate(url)
    await wait('zooPlayableState.connected || zooPlayableState.cells > 0', 'Zoo loaded')
    await wait("!!document.querySelector('#metro-unity-ui .viewCube')", 'shared UI mounted')
    await closeTutorial()
    const trainDoorView = async () => {
      // Frame the platform door bank the train actually opens on, beside the screen.
      await page.evaluate("window.metroUnityInstance.SendMessage('ZooPlayable', 'BrowserCommand', JSON.stringify({type:'focusTrainDoors'}))")
      await sleep(250)
      await screenshot('unity-train-doors')
    }
    const fixture = JSON.parse(readFileSync(join(root, 'unity/Assets/StationDesigner/Zoo/ZooSave.json'), 'utf8'))
    const generated = fixture.static.modules.filter(m => m.type !== 'bin' &&
      !(m.type === 'bench' && m.cfg?.variant === 'steel-2')).map(({ id, type }) => ({ id, type }))
    writeFileSync(join(out, 'generated-module-ids.json'), JSON.stringify(generated, null, 2) + '\n')
    report.generatedModules = { count: generated.length, inventory: 'generated-module-ids.json' }
    const initial = await state()
    // The resolver's view counts and keys are published with the document state.
    report.visual = {
      prefabViews: initial.prefabViews, liveViews: initial.liveViews, generatedViews: initial.generatedViews,
      batchedViews: initial.batchedViews,
      fallbackViews: initial.fallbackViews, unresolvedViews: initial.unresolvedViews,
      keys: initial.visualKeys, unresolved: initial.unresolved,
    }
    assert.ok(initial.prefabViews + initial.liveViews + initial.batchedViews > 4200,
      'every module should be drawn by the catalogue (prefab, live view or batched shape): ' + JSON.stringify(report.visual))
    assert.equal(initial.fallbackViews, 0, 'no Zoo module should need the placeholder fallback: ' + JSON.stringify(initial.unresolved))
    assert.equal(initial.unresolvedViews, 0, 'every Zoo module should resolve a view')
    // The exact key set Zoo resolves: a dropped mapping fails the run.
    const expectedKeys = [
          "ac-unit",
          "bench-steel-1",
          "bench-steel-2",
          "billboard-large",
          "billboard-panorama",
          "billboard-portrait",
          "billboard-square",
          "billboard-standard",
          "bin",
          "booth",
          "calligraphy-wei-h",
          "cctv",
          "cctv-post",
          "checkout",
          "clock",
          "cubicle",
          "desk",
          "door-steel-1",
          "electrical-cabinet",
          "escalator",
          "exit-uncovered-2",
          "extinguisher",
          "fence",
          "fence-gate",
          "fence-iron",
          "floor-mark-boarding",
          "floor-mark-direction",
          "gate",
          "glass-3x2",
          "guidepost",
          "lawn",
          "lift",
          "light-circular",
          "light-rectangular",
          "linemap-wall",
          "monitor-ceiling",
          "monitor-wall",
          "platform-edge",
          "psd-end",
          "psd-end-cover",
          "rail-signal",
          "road",
          "shelf-cooler-dark",
          "shelf-white-short",
          "shelf-wire",
          "sidewalk",
          "sign-ceiling",
          "sign-wall",
          "sink",
          "stair-right180",
          "stair-straight",
          "tactile-guide",
          "tactile-warning",
          "tactile-warning-strip",
          "track-run",
          "tree",
          "tv-double",
          "tvm",
          "vending",
          "vent"
    ]
    for (const key of expectedKeys) {
      assert.ok(initial.visualKeys.includes(key), 'missing resolved visual key: ' + key)
    }
    assert.equal(initial.formation, 'L.6.third-rail@zoo')
    assert.ok(Math.abs(initial.trainScale - .98) < 1e-3, 'the promoted consist keeps its baked 0.98 scale')
    assert.ok(initial.trainDoorSide === 'plus' || initial.trainDoorSide === 'minus', 'the platform door bank is bound')
    assert.deepEqual([initial.cells, initial.modules, initial.lines],
      [fixture.static.cells.length, fixture.static.modules.length, fixture.static.lines.length])
    assert.equal(initial.connected, true)
    if (!c1Only) {
    await screenshot('unity-exterior')
    // A wheel event over the rail belongs to the DOM, not the camera.
    const railPoint = await page.evaluate(`(() => { const r = document.querySelector('.leftShell .rail').getBoundingClientRect(); return {x:r.left+20,y:r.top+100} })()`)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...railPoint, deltaX: 0, deltaY: -120 })
    await sleep(250)
    assert.equal((await state()).zoom, initial.zoom, 'rail scrolling changed the camera')

    const drag = async (button, buttons) => {
      const from = await point(.53, .48), to = await point(.59, .54)
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button, buttons, clickCount: 1 })
      await sleep(100)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, buttons })
      await sleep(100)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button, clickCount: 1 })
    }
    await drag('middle', 4)
    await wait('zooPlayableState.yaw !== ' + initial.yaw, 'pointer orbit')
    await drag('right', 2)
    await wait('zooPlayableState.targetX !== ' + initial.targetX, 'pointer pan')
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...await point(.5, .5), deltaX: 0, deltaY: -120 })
    await wait('zooPlayableState.zoom < ' + initial.zoom, 'wheel zoom')
    await control('Reset view')
    await wait('zooPlayableState.zoom === ' + initial.zoom, 'reset view')
    report.cameraControls = true

    await selectLevel(-5)
    await wait('zooPlayableState.level === -5', 'level cutaway')
    await screenshot('unity-concourse')
    await focusService()
    await wait('zooPlayableState.level === -15 && zooPlayableState.zoom === 15', 'service area')
    await screenshot('unity-platform')

    await control('Delete')
    await wait("zooPlayableState.tool === 'Delete'", 'delete tool')
    await clickSlot('floorPoint')
    await wait('!zooPlayableState.floor && !zooPlayableState.connected', 'remove approach')
    await control('Pause')
    await wait("!zooPlayableState.running && zooPlayableState.message.includes('Blocked')", 'blocked service')
    await screenshot('unity-blocked')
    await clickSlot('gatePoint')
    await wait('!zooPlayableState.gate', 'remove gate')
    await control('Equipment')
    await control('Fare gate')
    await wait("zooPlayableState.tool === 'Gate'", 'gate tool')
    await clickSlot('gatePoint')
    await wait('zooPlayableState.gate', 'restore authored gate')

    const downloads = join(out, 'zoo-download-' + process.pid)
    mkdirSync(downloads)
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
    await control('Save')
    const file = join(downloads, 'edited-zoo.metro.json')
    for (let i = 0; i < 120 && !existsSync(file); i++) await sleep(125)
    const edited = JSON.parse(readFileSync(file, 'utf8'))
    const order = (records, key) => [...records].sort((a, b) => key(a).localeCompare(key(b)))
    const cellKey = ({ x, y, z }) => [x, y, z].join(',')
    assert.deepEqual(order(edited.static.cells, cellKey),
      order(fixture.static.cells.filter(c => cellKey(c) !== '59,19,-15'), cellKey))
    assert.deepEqual(order(edited.static.modules, m => m.id), order(fixture.static.modules, m => m.id))
    assert.deepEqual(edited.static.lines, fixture.static.lines)
    for (const field of ['name', 'nameEn', 'city', 'seed', 'levelBase', 'service', 'peaks', 'demand', 'calendar'])
      assert.deepEqual(edited[field], fixture[field], 'Changed Zoo metadata: ' + field)
    report.saved = file

    async function restoreFloorAndRun(capture) {
      await control('Block')
      await wait("zooPlayableState.tool === 'Floor'", 'floor tool')
      await clickSlot('floorPoint')
      await wait('zooPlayableState.connected', 'restore approach')
      await control('Pause')
      await wait('zooPlayableState.running', 'service started')
      await control('Pause')
      await wait("!zooPlayableState.running && zooPlayableState.message.includes('paused')", 'service paused')
      await control('Pause')
      await wait('zooPlayableState.running', 'service resumed')
      await wait('zooPlayableState.queued > 0', 'passengers queue')
      if (capture) await screenshot('unity-queue')
      await wait('zooPlayableState.boarded === 5 && zooPlayableState.doorsOpen && zooPlayableState.doorMovement > .01', 'passengers board', 1800)
      const doorState = await state()
      report.trainDoors = {
        movement: doorState.doorMovement, bank: doorState.trainDoorSide,
        formation: doorState.formation, scale: doorState.trainScale,
      }
      if (capture) { await screenshot('unity-boarding'); await trainDoorView() }
      return await state()
    }
    report.firstService = await restoreFloorAndRun(true)

    await navigate(url)
    await wait('zooPlayableState.floor', 'fresh fixture')
    await wait("!!document.querySelector('#metro-unity-ui .viewCube')", 'shared UI remounted')
    await closeTutorial()
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true })
    const beforeInvalid = await state()
    const invalidChooser = page.waitForEvent('Page.fileChooserOpened')
    await control('Open')
    const invalidSelection = await invalidChooser
    await page.send('DOM.setFileInputFiles', { files: [join(root, 'unity/tests/fixtures/invalid-v1.metro.json')], backendNodeId: invalidSelection.backendNodeId })
    await wait("zooPlayableState.message.includes('Could not open')", 'invalid save refused')
    const afterInvalid = await state()
    assert.deepEqual([afterInvalid.cells, afterInvalid.modules, afterInvalid.lines, afterInvalid.floor, afterInvalid.gate],
      [beforeInvalid.cells, beforeInvalid.modules, beforeInvalid.lines, beforeInvalid.floor, beforeInvalid.gate])
    report.invalidImportPreservedStation = true
    const changedLine = structuredClone(fixture)
    changedLine.static.lines = []
    const changedLineFile = join(out, 'unsupported-line.metro.json')
    writeFileSync(changedLineFile, JSON.stringify(changedLine))
    const lineChooser = page.waitForEvent('Page.fileChooserOpened')
    await control('Open')
    const lineSelection = await lineChooser
    await page.send('DOM.setFileInputFiles', { files: [changedLineFile], backendNodeId: lineSelection.backendNodeId })
    await wait("zooPlayableState.message.includes('Unsupported Zoo line edit')", 'changed fixed line refused')
    const chooser = page.waitForEvent('Page.fileChooserOpened')
    await control('Open')
    const selection = await chooser
    await page.send('DOM.setFileInputFiles', { files: [file], backendNodeId: selection.backendNodeId })
    await wait("!zooPlayableState.floor && zooPlayableState.message.includes('Zoo opened')", 'edited Zoo reopened')
    report.reopened = await state()
    await focusService()
    await wait('zooPlayableState.level === -15', 'reopened service area')
    report.reopenedService = await restoreFloorAndRun(false)
    }
    // C1: edit an ordinary route tile, prove a detour runs, and then remove
    // its distant connecting tile. Reopen the second save before refusal.
    await page.evaluate(`window.metroUnityInstance.SendMessage('ZooPlayable', 'BrowserCommand', JSON.stringify({type:'focusApproach'}))`)
    await wait('zooPlayableState.level === -15 && zooPlayableState.targetY === 27', 'approach framing')
    const beforeAlternate = await state()
    await control('Delete')
    await clickSlot('alternatePoint')
    await wait('zooPlayableState.revision > ' + beforeAlternate.revision + ' && zooPlayableState.connected', 'alternate floor edit')
    const alternateState = await state()
    assert.notEqual(alternateState.routeWaypoints, beforeAlternate.routeWaypoints, 'route did not change')
    await control('Pause')
    await wait('zooPlayableState.boarded === 5', 'alternate approach boarded', 1800)
    const boardedAlternate = await state()
    await screenshot('unity-alternate')
    const alternateDownloads = join(out, 'zoo-alternate-download-' + process.pid)
    mkdirSync(alternateDownloads)
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: alternateDownloads })
    await control('Save')
    const alternateFile = join(alternateDownloads, 'edited-zoo.metro.json')
    for (let i = 0; i < 120 && !existsSync(alternateFile); i++) await sleep(125)
    const renamedAlternate = JSON.parse(readFileSync(alternateFile, 'utf8'))
    renamedAlternate.nameEn = 'Zoo Route Test'
    const renamedFile = join(out, 'zoo-alternate-renamed.metro.json')
    writeFileSync(renamedFile, JSON.stringify(renamedAlternate))
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true })
    const alternateChooser = page.waitForEvent('Page.fileChooserOpened')
    await control('Open')
    const alternateSelection = await alternateChooser
    await page.send('DOM.setFileInputFiles', { files: [renamedFile], backendNodeId: alternateSelection.backendNodeId })
    await wait('zooPlayableState.connected && zooPlayableState.message.includes("Zoo opened")', 'alternate save reopened')
    await wait("document.querySelector('#metro-unity-ui').textContent.includes('Zoo Route Test')", 'opened station metadata in shared UI')
    mark('cut-preparation-start')
    // Close the other three approaches before removing the last connector.
    // TypeScript confirms that the selected path survives these edits and that
    // the final removal disconnects the whole graph, including other gates.
    await focusService()
    await wait('zooPlayableState.targetX === 64 && zooPlayableState.targetY === 10.5', 'cut preparation framing')
    mark('pan-1')
    await pan(.65, .40, .42, .525)
    mark('pan-2')
    await pan(.55, .40, .47, .40)
    mark('pan-3')
    await wait('zooPlayableState.targetX > 73 && zooPlayableState.targetY > 12', 'other approaches framing')
    mark('other-approaches-framed')
    await control('Delete')
    mark('delete-tool')
    for (const [x, y] of [[77, 14], [78, 14], [80, 18]]) {
      const revision = (await state()).revision
      mark(`click-cell-${x},${y}`)
      await clickCell(x, y)
      mark(`clicked-cell-${x},${y}`)
      await wait(`zooPlayableState.revision > ${revision} && zooPlayableState.connected`, `remove alternate approach ${x},${y}`)
      mark(`removed-cell-${x},${y}`)
    }
    mark('focus-approach-2')
    await page.evaluate(`window.metroUnityInstance.SendMessage('ZooPlayable', 'BrowserCommand', JSON.stringify({type:'focusApproach'}))`)
    mark('focus-approach-2-sent')
    await wait('zooPlayableState.targetX === 67 && zooPlayableState.targetY === 27', 'landing framing')
    mark('landing-framed')
    // The view cube covers the connector at the first framing. Pan with a real
    // right drag so that its canvas position is clear of the shared UI.
    mark('pan-4')
    await pan(.55, .40, .43, .65)
    mark('pan-5')
    await wait('zooPlayableState.targetX > 69 && zooPlayableState.targetY > 30', 'connector framing')
    const beforeLastApproach = (await state()).revision
    mark('click-last-approach')
    await clickCell(73, 36)
    mark('clicked-last-approach')
    await wait(`zooPlayableState.revision > ${beforeLastApproach} && zooPlayableState.connected`, 'last alternate landing removed')
    mark('last-approach-removed')
    report.preparedApproach = await state()
    mark('click-connector')
    await clickSlot('connectorPoint')
    mark('clicked-connector')
    await wait('!zooPlayableState.connected', 'connecting floor removed')
    mark('connector-removed')
    const blockedDownloads = join(out, 'zoo-disconnected-download-' + process.pid)
    mkdirSync(blockedDownloads)
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: blockedDownloads })
    await control('Save')
    const blockedFile = join(blockedDownloads, 'edited-zoo.metro.json')
    for (let i = 0; i < 120 && !existsSync(blockedFile); i++) await sleep(125)
    report.disconnectedSave = blockedFile
    const loadedBlocked = parseStation(readFileSync(blockedFile, 'utf8'))
    assert.equal(loadedBlocked.ok, true, 'TypeScript could not open the browser save')
    const blockedWorld = new World(toData(loadedBlocked.state), 7654321)
    const blockedExit = blockedWorld.graph.exits.find(e => e.name === 'B').node
    const blockedGate = blockedWorld.graph.nodeIndex.get('59,18,-15')
    assert.equal(blockedWorld.path.search(blockedExit, blockedGate, { stepFree: false, luggage: false }), null,
      'TypeScript still found a route through the reopened browser save')
    report.typescriptReopenedDisconnected = true
    mark('reopen-blocked-chooser')
    const blockedChooser = page.waitForEvent('Page.fileChooserOpened')
    await control('Open')
    mark('reopen-blocked-open-clicked')
    const blockedSelection = await blockedChooser
    await page.send('DOM.setFileInputFiles', { files: [blockedFile], backendNodeId: blockedSelection.backendNodeId })
    await wait('!zooPlayableState.connected && zooPlayableState.message.includes("Zoo opened")', 'disconnected save reopened')
    await control('Pause')
    await wait('!zooPlayableState.running && zooPlayableState.message.includes("Blocked")', 'reopened route refusal')
    await screenshot('unity-reopened-disconnected')
    report.alternateService = boardedAlternate
    report.reopenedDisconnected = await state()
    if (c1Only) {
      const unsupported = structuredClone(fixture)
      unsupported.static.lines = []
      const invalidLineFile = join(out, 'unsupported-line.metro.json')
      writeFileSync(invalidLineFile, JSON.stringify(unsupported))
      const chooser = page.waitForEvent('Page.fileChooserOpened')
      await control('Open')
      const selection = await chooser
      await page.send('DOM.setFileInputFiles', { files: [invalidLineFile], backendNodeId: selection.backendNodeId })
      await wait("zooPlayableState.message.includes('Unsupported Zoo line edit') && !zooPlayableState.connected", 'changed fixed line refused')
      report.fixedLineRejected = true
    }
    if (report.errors.length) throw Error(report.errors.join('\n'))
    if (compare) await captureReference()
    report.status = 'passed'
    save()
    console.log(JSON.stringify(report))
  }
} catch (error) {
  if (!serve) {
    report.status = 'failed'
    report.error = String(error.stack ?? error)
    try { report.lastState = await state(); await screenshot('unity-failure') } catch {}
    save()
  }
  throw error
} finally {
  await page?.close()
  reference?.close()
  server.kill()
}

