import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { loadExampleStation, serveDir, withPage, waitFor } from '../browser-harness.mjs'

const root = resolve(import.meta.dirname, '../..')
const out = resolve(process.argv[2] ?? '')
if (!out.startsWith(resolve(root, '.preview/unity') + sep)) throw Error('Expected a run directory under .preview/unity')
const serve = process.argv.includes('--serve')
const compare = process.argv.includes('--compare')
const packed = join(out, 'packed')
const report = { status: 'running', errors: [], images: [] }
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
const url = base + '/game/'
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
const state = () => page.evaluate('window.zooPlayableState')
const wait = (predicate, what) => waitFor(page.evaluate, 'window.zooPlayableState && (' + predicate + ')',
  { tries: 480, every: 125, what })
const screenshot = async (name) => {
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, name + '.png'), Buffer.from(shot.data, 'base64'))
  report.images.push(name + '.png')
}
const point = (x, y) => page.evaluate(`(() => {
  const r = document.querySelector('canvas').getBoundingClientRect()
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
const toolbar = x => click(x / 960, 22 / 600)
const clickSlot = async name => {
  const p = (await state())[name]
  await click(p.x, p.y)
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
      debugPort: await freePort(), windowSize: '1280,800', softwareGpu: false })
    page.onEvent('Runtime.exceptionThrown', e => report.errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text))
    page.onEvent('Runtime.consoleAPICalled', e => {
      if (e.type === 'error') report.errors.push(e.args.map(a => a.value ?? a.description).join(' '))
    })
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await navigate(url)
    await wait('zooPlayableState.connected || zooPlayableState.cells > 0', 'Zoo loaded')
    const fixture = JSON.parse(readFileSync(join(root, 'unity/Assets/StationDesigner/Zoo/ZooSave.json'), 'utf8'))
    const generated = fixture.static.modules.filter(m => m.type !== 'bin' &&
      !(m.type === 'bench' && m.cfg?.variant === 'steel-2')).map(({ id, type }) => ({ id, type }))
    writeFileSync(join(out, 'generated-module-ids.json'), JSON.stringify(generated, null, 2) + '\n')
    report.generatedModules = { count: generated.length, inventory: 'generated-module-ids.json' }
    const initial = await state()
    assert.deepEqual([initial.cells, initial.modules, initial.lines],
      [fixture.static.cells.length, fixture.static.modules.length, fixture.static.lines.length])
    assert.equal(initial.connected, true)
    await screenshot('unity-exterior')

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
    await toolbar(652)
    await wait('zooPlayableState.zoom === ' + initial.zoom, 'reset view')
    report.cameraControls = true

    await toolbar(545)
    await wait('zooPlayableState.level === -5', 'level cutaway')
    await screenshot('unity-concourse')
    await toolbar(754)
    await wait('zooPlayableState.level === -15 && zooPlayableState.zoom === 15', 'service area')
    await screenshot('unity-platform')

    await toolbar(239)
    await wait("zooPlayableState.tool === 'Delete'", 'delete tool')
    await clickSlot('floorPoint')
    await wait('!zooPlayableState.floor && !zooPlayableState.connected', 'remove approach')
    await toolbar(318)
    await wait("!zooPlayableState.running && zooPlayableState.message.includes('Blocked')", 'blocked service')
    await screenshot('unity-blocked')
    await clickSlot('gatePoint')
    await wait('!zooPlayableState.gate', 'remove gate')
    await toolbar(170)
    await wait("zooPlayableState.tool === 'Gate'", 'gate tool')
    await clickSlot('gatePoint')
    await wait('zooPlayableState.gate', 'restore authored gate')

    const downloads = join(out, 'zoo-download-' + process.pid)
    mkdirSync(downloads)
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
    await toolbar(389)
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
      await toolbar(112)
      await wait("zooPlayableState.tool === 'Floor'", 'floor tool')
      await clickSlot('floorPoint')
      await wait('zooPlayableState.connected', 'restore approach')
      await toolbar(318)
      await wait('zooPlayableState.running', 'service started')
      await toolbar(318)
      await wait("!zooPlayableState.running && zooPlayableState.message.includes('paused')", 'service paused')
      await toolbar(318)
      await wait('zooPlayableState.running', 'service resumed')
      await wait('zooPlayableState.queued > 0', 'passengers queue')
      if (capture) await screenshot('unity-queue')
      await wait('zooPlayableState.boarded === 5 && zooPlayableState.doorsOpen && zooPlayableState.doorMovement > .01', 'passengers board')
      if (capture) await screenshot('unity-boarding')
      return await state()
    }
    report.firstService = await restoreFloorAndRun(true)

    await navigate(url)
    await wait('zooPlayableState.floor', 'fresh fixture')
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true })
    const chooser = page.waitForEvent('Page.fileChooserOpened')
    await toolbar(451)
    const selection = await chooser
    await page.send('DOM.setFileInputFiles', { files: [file], backendNodeId: selection.backendNodeId })
    await wait("!zooPlayableState.floor && zooPlayableState.message.includes('Zoo opened')", 'edited Zoo reopened')
    report.reopened = await state()
    await toolbar(754)
    await wait('zooPlayableState.level === -15', 'reopened service area')
    report.reopenedService = await restoreFloorAndRun(false)
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

