// Plan 11 A7 ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â the browser verifier for the generic station player.
//
// Runs the packed WebGL build of `Scenes/StationGame.unity` under headless Chrome
// (the same harness `smoke-zoo-playable.mjs` uses) and drives the station through
// the **shared shell port** `window.__metroStationBridge` ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â the same path the React
// UI uses ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â then reads the committed snapshot. It never installs geometry, mutates
// internal state or calls a fixture adapter.
//
// Cases:
//   demo      deep link `/game/<demo>` and `/game/en/<demo>`; the commit must carry
//             the demo's sourceId/sourceHash and the A1 manifest's counts, and the
//             URL must be rewritten to the plain game path after the commit.
//   switch    all requested demos in one page, then Zoo again: each switch commits a
//             new revision and the previous station cannot come back late.
//   new       `station.new` through the UI port: a new revision and an empty station.
//   invalid   `station.open` with a corrupt document: one typed reject
//             (`parse-failed`) and the committed revision/document unchanged.
//   resync    `station.resync` republishes the current commit without a new revision.
//
// Every case has its own timeout; on failure the report carries the last snapshot
// (document elided), the browser errors and a PNG. Run:
//   node tools/unity-web/verify-station-game.mjs <run-dir> [--demo zoo|tanwei|tianhe|all]
//        [--locale both|zh|en] [--timeout-ms 90000] [--serve] [--only case[,case]]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { withPage } from '../browser-harness.mjs'
import { createStaticServer } from './static-pack-server.mjs'

const root = resolve(import.meta.dirname, '../..')
const run = resolve(process.argv[2] ?? '')
if (!run.startsWith(resolve(root, '.preview/unity') + sep)) throw new Error('Expected a run directory under .preview/unity')
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const demoArg = arg('--demo', 'zoo')
const localeArg = arg('--locale', 'both')
const timeoutMs = Number(arg('--timeout-ms', '120000'))
// `--only` runs a subset (prefix match on the case name) so one case can be iterated
// without paying for the whole pass; every case still cold-opens the demo URL itself.
const onlyArg = arg('--only', '')
const onlyCases = onlyArg ? onlyArg.split(',').map(name => name.trim()).filter(Boolean) : null
const wanted = (name) => !onlyCases || onlyCases.some((pattern) => name.startsWith(pattern))
// `--packed` may be absolute or relative to the invocation directory; the Worker
// config needs a real directory, and resolving against the run dir silently produced
// `<run>/station-game/.preview/...` which wrangler then refused.
const packed = resolve(arg('--packed', join(run, 'packed')))
if (!existsSync(packed)) throw new Error('Packed player missing: ' + packed)
const outDir = join(run, 'station-game')
mkdirSync(outDir, { recursive: true })
const report = { status: 'running', generatedBy: 'tools/unity-web/verify-station-game.mjs', cases: [], errors: [], images: [], trace: [] }
const started = Date.now()
const save = () => writeFileSync(join(outDir, 'station-game-report.json'), JSON.stringify(report, null, 2) + '\n')
const mark = (name) => { report.trace.push({ name, ms: Date.now() - started }); save() }

const provenance = JSON.parse(readFileSync(join(root, 'unity/Assets/StationDesigner/Demos/provenance.json'), 'utf8'))
const byId = new Map(provenance.demos.map((demo) => [demo.id, demo]))
const demos = demoArg === 'all' ? provenance.demos.map((demo) => demo.id) : [demoArg]
for (const id of demos) if (!byId.has(id)) throw new Error('Unknown demo: ' + id + ' (known: ' + [...byId.keys()].join(', ') + ')')
const locales = localeArg === 'both' ? ['zh', 'en'] : [localeArg === 'zh' ? 'zh' : 'en']

async function freePort() {
  const socket = createServer()
  await new Promise(ok => socket.listen(0, '127.0.0.1', ok))
  const { port } = socket.address()
  await new Promise(ok => socket.close(ok))
  return port
}

const port = process.env.METRO_STATION_PORT || await freePort()
// Two hosts can serve a pack. `local-worker.mjs` under wrangler is the normal one and
// reassembles the split `.wasm`/`.data` files and the demo deep links. When workerd
// cannot start in the local environment, `METRO_STATIC_SERVER=1` uses the plain Node
// server with the same routing (`static-pack-server.mjs`).
const useStaticServer = process.env.METRO_STATIC_SERVER === '1'
let base
let server
if (useStaticServer) {
  const staticServer = await createStaticServer(packed, Number(port))
  base = staticServer.url
  server = { kill: () => staticServer.close() }
} else {
  base = 'http://127.0.0.1:' + port
  const temp = join(outDir, 'station-temp')
  mkdirSync(temp, { recursive: true })
  const wranglerConfig = join(outDir, 'station-wrangler.jsonc')
  writeFileSync(wranglerConfig, JSON.stringify({
    name: 'metro-station-game', main: join(root, 'tools/unity-web/local-worker.mjs'),
    compatibility_date: '2026-10-01', assets: { directory: packed, binding: 'ASSETS', run_worker_first: true },
  }))
  const wrangler = process.env.METRO_WRANGLER || join(root, 'node_modules/wrangler/bin/wrangler.js')
  server = spawn(process.execPath, [wrangler, 'dev', '--config', wranglerConfig, '--local',
    '--persist-to', join(outDir, 'station-worker'), '--port', String(port), '--ip', '127.0.0.1'],
  { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: temp, TMP: temp } })
}
let ready = false
for (let attempt = 0; attempt < 240 && !ready; attempt++) {
  try { ready = (await fetch(base + '/game/')).ok } catch { ready = false }
  if (!ready) await sleep(500)
}
if (!ready) throw new Error('The local host never answered on ' + base)

let page
const browserErrors = []
const rememberBrowserError = (kind) => (params) => {
  const text = params?.exceptionDetails?.exception?.description ?? params?.exceptionDetails?.text ??
    params?.entry?.text ?? params?.reason?.message ?? JSON.stringify(params).slice(0, 500)
  browserErrors.push({ kind, text: String(text) })
}
const snapshotExpr = `(() => {
  const bridge = window.__metroStationBridge
  if (!bridge) return null
  const s = bridge.getSnapshot()
  const { document, ...summary } = s
  return { ...summary, documentBytes: document ? document.length : 0, path: location.pathname }
})()`

async function currentSnapshot() {
  return page.evaluate(snapshotExpr)
}

/** Poll a page expression, tolerating the execution context changing on navigate. */
async function poll(expression, what, timeout = timeoutMs) {
  const deadline = Date.now() + timeout
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(expression)) return
    } catch (error) {
      lastError = error
    }
    await sleep(200)
  }
  throw new Error(`${what} was never ready: ${expression}${lastError ? ' (last error: ' + lastError.message + ')' : ''}`)
}

async function waitForSnapshot(predicate, what, timeout = timeoutMs) {
  return poll(`(() => {
    const bridge = window.__metroStationBridge
    if (!bridge) return false
    const s = bridge.getSnapshot()
    const { document, ...summary } = s
    return Boolean(${predicate})
  })()`, what, timeout)
}

async function screenshot(name) {
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(outDir, name + '.png'), Buffer.from(shot.data, 'base64'))
  report.images.push(name + '.png')
}

/**
 * Capture just the Unity canvas, so a cross-engine comparison is canvas-to-canvas.
 * `Page.captureScreenshot` clips in CSS pixels; the returned rect lets the report name
 * the exact region the numbers came from.
 */
async function screenshotCanvas(name) {
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const rect = await page.evaluate(`(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, pixels: [canvas.width, canvas.height] }
  })()`)
  if (!rect) return null
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  })
  writeFileSync(join(outDir, name + '.png'), Buffer.from(shot.data, 'base64'))
  report.images.push(name + '.png')
  return rect
}

function caseStart(name) {
  const record = { name, status: 'running', ms: 0 }
  report.cases.push(record)
  mark(name)
  return record
}

async function finishCase(record, ok, detail) {
  record.status = ok ? 'pass' : 'fail'
  record.ms = Date.now() - started
  record.detail = detail ?? null
  if (!ok) {
    report.status = 'failed'
    record.snapshot = await currentSnapshot().catch(() => null)
    record.lastRejects = await page.evaluate('window.__metroStationBridge ? window.__metroStationBridge.getSnapshot().rejects : []').catch(() => [])
    await screenshot('station-game-failure-' + record.name.replace(/[^a-z0-9]+/gi, '-')).catch(() => {})
  }
  save()
  return ok
}

function expectedCounts(id) {
  const demo = byId.get(id)
  return { cells: demo.counts.cells, modules: demo.counts.modules, lines: demo.counts.lines, sha256: demo.outputSha256 }
}

/**
 * Observe what the UI actually asked the host for: wrap the shared port's `send`, the
 * same public seam the React shell uses. This is an observation point, not a shortcut —
 * the case still presses real keys and clicks real buttons, and only counts the commands
 * those inputs produced. A page navigation drops the wrapper with the page.
 */
async function installCommandRecorder() {
  return page.evaluate(`(() => {
    const bridge = window.__metroStationBridge
    if (!bridge) return false
    if (bridge.__metroRecorder) return true
    const original = bridge.send
    bridge.__metroRecorder = []
    bridge.send = function (...args) {
      const id = original.apply(this, args)
      bridge.__metroRecorder.push({ type: args[0], payload: args[1] ?? null, id: typeof id === 'string' ? id : null, at: performance.now() })
      return id
    }
    return true
  })()`)
}

async function recordedCommands() {
  return page.evaluate('(window.__metroStationBridge.__metroRecorder ?? []).map(row => ({ type: row.type, payload: row.payload, id: row.id }))')
}

/** A real key press through the browser's own input path (`Input.dispatchKeyEvent`). */
async function pressKey(key, code, virtualKeyCode, modifiers = 0) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', {
      type, modifiers, key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode,
    })
  }
}

function committedCounts(documentText) {
  const parsed = JSON.parse(documentText)
  return {
    cells: parsed.static.cells.length,
    modules: parsed.static.modules.length,
    lines: parsed.static.lines.length,
  }
}

async function expectDemoCommit(id, locale) {
  const expected = expectedCounts(id)
  await waitForSnapshot(`s.revision >= 0 && s.sourceId === ${JSON.stringify(id)} && s.document && s.documentRevision === s.revision`, `${locale} demo ${id} commit`)
  const snapshot = await currentSnapshot()
  const problems = []
  if (snapshot.sourceId !== id) problems.push('sourceId ' + snapshot.sourceId + ' != ' + id)
  if (snapshot.sourceHash !== expected.sha256) problems.push('sourceHash ' + snapshot.sourceHash + ' != ' + expected.sha256)
  if (!snapshot.path.endsWith('/') && snapshot.path !== `/game/` && snapshot.path !== `/game/en/`) problems.push('URL not rewritten: ' + snapshot.path)
  if (snapshot.path === `/game/${id}` || snapshot.path === `/game/en/${id}`) problems.push('URL still names the demo: ' + snapshot.path)
  // The committed text is the document the shell adopted; compare it with the
  // exported fixture by hash and by normalized counts.
  const documentText = await page.evaluate('window.__metroStationBridge.getSnapshot().document')
  if (!documentText) problems.push('no committed document text')
  else if (documentText.length < 1000) problems.push('committed document is suspiciously short')
  else {
    const counts = committedCounts(documentText)
    if (counts.cells !== expected.cells) problems.push('cells ' + counts.cells + ' != ' + expected.cells)
    if (counts.modules !== expected.modules) problems.push('modules ' + counts.modules + ' != ' + expected.modules)
    if (counts.lines !== expected.lines) problems.push('lines ' + counts.lines + ' != ' + expected.lines)
  }
  return { problems, snapshot }
}

async function runDemoCase(id, locale) {
  const record = caseStart(`demo-${id}-${locale}`)
  const url = base + (locale === 'en' ? '/game/en/' : '/game/') + id
  await page.send('Page.navigate', { url })
  await poll('window.__metroStationBridge !== undefined', `${id}/${locale} shell mount`)
  const { problems, snapshot } = await expectDemoCommit(id, locale)
  const result = await page.evaluate('({ canvas: !!document.querySelector("#unity-canvas"), unity: !!window.metroUnityInstance })')
  if (!result.canvas) problems.push('no #unity-canvas')
  if (!result.unity) problems.push('no window.metroUnityInstance')
  await screenshot(`station-game-${id}-${locale}`)
  return finishCase(record, problems.length === 0, { problems, revision: snapshot.revision, sourceId: snapshot.sourceId })
}

async function runSwitchCase() {
  const record = caseStart('switch-all-demos')
  const problems = []
  let previousRevision = (await currentSnapshot()).revision
  for (const id of [...byId.keys(), 'zoo']) {
    await page.evaluate(`window.__metroStationBridge.send('station.openDemo', ${JSON.stringify({ id })})`)
    const expected = expectedCounts(id)
    await waitForSnapshot(`s.revision > ${previousRevision} && s.sourceId === ${JSON.stringify(id)} && s.document && s.documentRevision === s.revision`, `switch to ${id}`)
    const snapshot = await currentSnapshot()
    if (snapshot.revision <= previousRevision) problems.push(id + ': revision did not increase')
    if (snapshot.sourceId !== id) problems.push(id + ': sourceId ' + snapshot.sourceId)
    if (snapshot.sourceHash !== expected.sha256) problems.push(id + ': sourceHash mismatch')
    previousRevision = snapshot.revision
  }
  await screenshot('station-game-switch-last-zoo')
  return finishCase(record, problems.length === 0, { problems, revision: previousRevision })
}

async function runNewCase() {
  const record = caseStart('new-station')
  const before = await currentSnapshot()
  await page.evaluate(`window.__metroStationBridge.send('station.new')`)
  await waitForSnapshot(`s.revision > ${before.revision} && s.document && s.documentRevision === s.revision`, 'new station commit')
  const after = await currentSnapshot()
  const problems = []
  if (after.revision <= before.revision) problems.push('revision did not increase')
  if (after.sourceId !== 'new') problems.push('sourceId ' + after.sourceId + ' != new')
  const documentText = await page.evaluate('window.__metroStationBridge.getSnapshot().document')
  if (!documentText) problems.push('no new document')
  else {
    const counts = committedCounts(documentText)
    if (counts.cells !== 0 || counts.modules !== 0) problems.push('new station is not empty: ' + JSON.stringify(counts))
  }
  await screenshot('station-game-new')
  return finishCase(record, problems.length === 0, { problems, revision: after.revision })
}

async function runViewToolsCase() {
  const record = caseStart('view-tools')
  const problems = []
  const send = (type, payload) => page.evaluate(`window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const viewExpr = (key) => `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.view ? s.state.view[${JSON.stringify(key)}] : undefined })()`
  // D4's visual half: a toggle must change pixels, not only the published state.
  // Screenshots go back into the page so one canvas compares them here.
  const capture = async () => (await page.send('Page.captureScreenshot', { format: 'png' })).data
  const visualDiff = async (first, second) => page.evaluate(`(async () => {
    const load = (base64) => new Promise((ok, bad) => {
      const image = new Image()
      image.onload = () => ok(image)
      image.onerror = () => bad(new Error('image failed'))
      image.src = 'data:image/png;base64,' + base64
    })
    const a = await load(${JSON.stringify(first)})
    const b = await load(${JSON.stringify(second)})
    const width = Math.min(a.width, b.width), height = Math.min(a.height, b.height)
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    context.drawImage(a, 0, 0)
    const before = context.getImageData(0, 0, width, height).data
    context.clearRect(0, 0, width, height)
    context.drawImage(b, 0, 0)
    const after = context.getImageData(0, 0, width, height).data
    let changed = 0
    for (let i = 0; i < before.length; i += 4) {
      if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 24) changed++
    }
    return changed / (width * height)
  })()`)
  const visual = {}
  // Per-role pixel diffs are recorded for every toggle, but only the roles whose effect
  // is not masked by another visibility rule are *required* here: at the opening storey
  // the storey above is hidden by `showLevels`, so a ceiling slab and its walls can be
  // legitimately invisible. Their per-role behaviour is pinned by
  // `StationVisibilityTests.ZooCellRolesChangeVisibilityAtEveryStorey`; the browser gate
  // requires ground, Hide UI and the combined all-hidden -> all-shown change.
  const minimums = { ground: 0.05, hideUi: 0.005 }
  const captured = {}
  // Measure "show this role" from a fully hidden baseline: hiding a surface only changes
  // pixels when nothing else already covers it, so the baseline hides every role and each
  // toggle makes exactly one role visible again. The roles are then left visible.
  const hidden = [['ceiling', true], ['walls', true], ['ground', true], ['roof', true], ['hideUi', true]]
  const shown = { ceiling: false, walls: false, ground: false, roof: false, hideUi: false }
  for (const [key, value] of hidden) {
    await send('view.set', { key, value })
    await poll(viewExpr(key) + ' === ' + JSON.stringify(value), 'view.' + key + ' baseline', Math.min(timeoutMs, 15000)).catch(() => {})
  }
  await sleep(1000)
  captured.allHidden = await capture()
  for (const key of ['ground', 'roof', 'ceiling', 'walls', 'hideUi']) {
    const before = await capture()
    await send('view.set', { key, value: shown[key] })
    try {
      await poll(viewExpr(key) + ' === ' + JSON.stringify(shown[key]), 'view.' + key, Math.min(timeoutMs, 15000))
    } catch { problems.push('view.set ' + key + ' did not reach the committed state') }
    // The visibility rebuild happens on the next frames after the state changes; a
    // short settle keeps a small role (a ceiling slab) from being measured as zero.
    await sleep(800)
    const after = await capture()
    const changed = await visualDiff(before, after).catch(() => 0)
    visual[key] = +changed.toFixed(4)
    if (minimums[key] !== undefined && changed < minimums[key]) problems.push('view.' + key + ' changed only ' + (changed * 100).toFixed(2) + '% of the canvas')
  }
  captured.allShown = await capture()
  visual.combined = +(await visualDiff(captured.allHidden, captured.allShown).catch(() => 0)).toFixed(4)
  if (visual.combined < 0.05) problems.push('the all-hidden to all-shown view changed only ' + (visual.combined * 100).toFixed(2) + '% of the canvas')
  await screenshot('station-game-view-tools')
  // A level change is a view command, not an edit: the revision must not move.
  const before = await currentSnapshot()
  await send('view.set', { key: 'level', value: 0 })
  await sleep(500)
  const after = await currentSnapshot()
  if (after.revision !== before.revision) problems.push('a view.set changed the document revision')
  return finishCase(record, problems.length === 0, { problems, revision: after.revision, visual })
}

async function runCameraCase() {
  const record = caseStart('camera-cube')
  const problems = []
  const send = (type, payload) => page.evaluate(`window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const cameraExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.camera ?? null })()`
  const start = await page.evaluate(cameraExpr)
  if (!start || !start.back) { problems.push('no camera snapshot published'); return finishCase(record, false, { problems }) }
  // A face snap must change the rendered basis and report the new one. The camera basis
  // is published in document axes, so a top view looks down the document elevation axis:
  // back = (0,0,1) (world forward is -up, mapped through worldÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢document).
  await send('camera.snap', { face: 'top' })
  try {
    await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.camera ?? {}); return c.back && Math.abs(c.back[2]) > 0.9 })()`, 'top snap basis', Math.min(timeoutMs, 20000))
  } catch { problems.push('camera.snap top did not produce a downward basis') }
  await screenshot('station-game-camera-top')
  await send('camera.home', {})
  await sleep(800)
  const home = await page.evaluate(cameraExpr)
  const distance = (a, b) => Array.isArray(a) && Array.isArray(b) ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 9
  if (home && start.back && distance(home.back, start.back) > 0.2) problems.push('camera.home did not return to the home basis')
  await screenshot('station-game-camera-home')
  const before = await currentSnapshot()
  if (before.revision < 0) problems.push('no committed station while moving the camera')
  return finishCase(record, problems.length === 0, { problems, revision: before.revision })
}

/**
 * Real pointer and keyboard input on the Unity canvas (plan 11 D4): a drag orbits the
 * camera through the same gesture path a user drives, and Ctrl+H asks for home. The
 * basis is the published rendered basis, not a UI counter.
 */
/**
 * Plan 13 §2 — the frame the finish, lighting and glass work is measured on. One
 * canvas-only capture at the home view (no React chrome), with the camera basis and the
 * canvas rect recorded so the comparison against the TypeScript capture names the same
 * region. The numbers themselves come from `tools/unity-parity/compare-captures.mjs`;
 * this case only guarantees the frame exists and is the station's, not a loading screen.
 */
/**
 * Plan 13 §5 — the two overlay toggles through the real command path. Turning each on must
 * change the published view state and the rendered pixels; turning it off must restore
 * them. A capability flag alone is not the acceptance.
 */
async function runOverlayCase() {
  const record = caseStart('overlay-toggles')
  const problems = []
  const view = () => page.evaluate('(() => (window.__metroStationBridge.getSnapshot().state.view ?? null))()')
  const render = () => page.evaluate('(() => ((window.__metroStationBridge.getSnapshot().state ?? {}).render ?? null))()')
  const capture = async () => (await page.send('Page.captureScreenshot', { format: 'png' })).data
  const send = (payload) => page.evaluate(`window.__metroStationBridge.send('view.set', ${JSON.stringify(payload)})`)
  // The view rig installs on commit; a command that lands before that is refused
  // `no-session` (the shell keeps early view rejections silent), so retry until it sticks.
  await waitForSnapshot('s.state.view != null', 'view rig installed')
  const toggle = async (key, value) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      await send({ key, value })
      await sleep(400)
      const state = await view()
      if (state && state[key] === value) return state
    }
    return null
  }
  const overlays = async () => (await render())?.overlays ?? null
  const setLevel = async (level) => {
    await send({ key: 'level', value: level })
    await sleep(500)
  }

  // A zoned storey: walk the ladder until the overlay reports cells (the document opens on
  // its lowest authored metre, and a zone map only paints floors that carry a zone).
  let zoneLevel = null
  let zoneState = null
  for (const level of [-20, -15, -10, -5, 0]) {
    await setLevel(level)
    await toggle('zones', false)
    zoneState = await toggle('zones', true)
    if (!zoneState || zoneState.zones !== true) { problems.push('zones flag did not reach the view state at level ' + level); break }
    await sleep(500)
    const info = await overlays()
    if (info && info.zoneCells > 0) { zoneLevel = level; break }
  }
  if (zoneLevel === null) problems.push('no storey drew a zone cell')
  const zoneShot = await capture()
  writeFileSync(join(outDir, 'station-game-overlay-zones.png'), Buffer.from(zoneShot, 'base64'))
  report.images.push('station-game-overlay-zones.png')

  // Density needs the simulation running with walkers on the storey: resume playback and
  // wait for the crowd to publish poses at this level.
  await toggle('zones', false)
  await page.evaluate(`window.__metroStationBridge.send('sim.play', { playing: true })`)
  const densityLevel = zoneLevel ?? -20
  await setLevel(densityLevel)
  const densityState = await toggle('density', true)
  if (!densityState || densityState.density !== true) problems.push('density flag did not reach the view state')
  let densityCells = 0
  for (let attempt = 0; attempt < 24; attempt++) {
    await sleep(500)
    const info = await overlays()
    if (info && info.densityCells > 0) { densityCells = info.densityCells; break }
  }
  if (densityCells === 0) problems.push('no density cell was painted on the storey with walkers')
  const densityShot = await capture()
  writeFileSync(join(outDir, 'station-game-overlay-density.png'), Buffer.from(densityShot, 'base64'))
  report.images.push('station-game-overlay-density.png')
  if (densityShot === zoneShot) problems.push('the density frame is identical to the zone frame')

  await toggle('density', false)
  await page.evaluate(`window.__metroStationBridge.send('sim.play', { playing: false })`)
  const restored = await view()
  if (restored && (restored.zones || restored.density)) problems.push('turning both overlays off left a flag set')
  const final = await overlays()
  return finishCase(record, problems.length === 0, { problems, zoneLevel, densityLevel, zoneCells: zoneLevel === null ? 0 : (final?.zoneCells ?? 0), densityCells, overlays: final, render: await render() })
}

async function runVisualCase() {
  const record = caseStart('visual-home')
  const problems = []
  // The case may run alone (`--only visual-home`) against a URL that opens the demo, so
  // wait for the commit and the loading shell rather than assuming a demo case ran first.
  try {
    await waitForSnapshot('s.revision >= 0', 'committed station')
    await poll(`(() => {
      const loading = document.getElementById('game-loading')
      if (loading && !loading.hidden && getComputedStyle(loading).display !== 'none' && !loading.classList.contains('is-hidden')) return false
      // The Unity template paints its "Made with Unity" logo as DOM over the canvas until
      // the player presents its first frame; a canvas-only capture before that is a
      // screenshot of the logo, not of the station.
      const logo = document.getElementById('unity-logo')
      if (logo && logo.offsetParent !== null && getComputedStyle(logo).display !== 'none') return false
      const logoTitle = document.getElementById('unity-logo-title-footer')
      if (logoTitle && logoTitle.offsetParent !== null && getComputedStyle(logoTitle).display !== 'none') return false
      return true
    })()`, 'player presented its first frame', Math.min(timeoutMs, 60000))
  } catch (error) {
    problems.push(String(error.message ?? error))
  }
  // A real click on the canvas: it focuses the player (a WebGL build with
  // `runInBackground = 0` renders nothing until the page is interacted with) and gives the
  // pointer router the same event a player produces before the frame is read.
  const focusRect = await page.evaluate(`(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    const r = canvas.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: focusRect.x, y: focusRect.y, button: 'left', buttons: 1, clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: focusRect.x, y: focusRect.y, button: 'left', buttons: 0, clickCount: 1 })
  await page.evaluate(`window.__metroStationBridge.send('camera.home', {})`)
  await sleep(1200)
  // The player presents its first real frame only after a compositor frame has been
  // requested; a capture taken before that is the built-in splash. Warm it up once and
  // discard that frame, then take the measured one.
  await page.send('Page.captureScreenshot', { format: 'png' })
  await sleep(900)
  const rect = await screenshotCanvas('station-game-visual-home')
  if (!rect) problems.push('no Unity canvas to capture')
  // The street is a storey above the opening level: step to the ground so the sidewalk,
  // lawn, street furniture and the lattice are all in the frame (plan 13 §3/§4 evidence).
  await page.evaluate(`window.__metroStationBridge.send('view.set', { key: 'level', value: 0 })`)
  await sleep(900)
  const street = await screenshotCanvas('station-game-visual-street')
  await page.evaluate(`window.__metroStationBridge.send('view.set', { key: 'level', value: -20 })`)
  // Second frame with the ghost/slice pass off: separates "the surface is missing" from
  // "the storey policy hid it" when the two engines are compared.
  await page.evaluate(`window.__metroStationBridge.send('view.set', { key: 'showLevels', value: false })`)
  await sleep(900)
  const flat = await screenshotCanvas('station-game-visual-home-flat')
  await page.evaluate(`window.__metroStationBridge.send('view.set', { key: 'showLevels', value: true })`)
  const camera = await page.evaluate('(() => (window.__metroStationBridge.getSnapshot().state.camera ?? null))()')
  const snapshot = await currentSnapshot()
  if (snapshot.revision < 0) problems.push('no committed station while capturing the frame')
  if (!camera || !camera.back) problems.push('no camera basis published')
  if (rect && rect.width < 400) problems.push('canvas is too small to compare')
  return finishCase(record, problems.length === 0, { problems, revision: snapshot.revision, canvas: rect, flat, street,
    render: (snapshot.state ?? {}).render ?? null,
    camera: camera ? { back: camera.back, eye: camera.eye, zoom: camera.zoom } : null })
}

async function runPointerCameraCase() {
  const record = caseStart('pointer-camera')
  const problems = []
  const cameraExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.camera ?? null })()`
  const start = await page.evaluate(cameraExpr)
  if (!start || !start.back) { problems.push('no camera snapshot published'); return finishCase(record, false, { problems }) }
  const rectExpr = `(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, tag: canvas.id || canvas.className }
  })()`
  let rect = null
  try {
    await poll(`(() => { const r = ${rectExpr}; return r !== null && r.w > 100 && r.h > 100 })()`, 'laid-out canvas', Math.min(timeoutMs, 20000))
    rect = await page.evaluate(rectExpr)
  } catch { rect = await page.evaluate(rectExpr).catch(() => null) }
  if (!rect || !(rect.w > 100)) { problems.push('the Unity canvas is not laid out (' + JSON.stringify(rect) + ')'); return finishCase(record, false, { problems }) }
  const before = await currentSnapshot()
  const distance = (a, b) => Array.isArray(a) && Array.isArray(b) ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 9
  const movedExpr = `(() => {
    const c = (window.__metroStationBridge.getSnapshot().state.camera ?? null)
    if (!c || !c.back) return false
    const b = ${JSON.stringify(start.back.map(Number))}
    return Math.hypot(c.back[0] - b[0], c.back[1] - b[1], c.back[2] - b[2]) > 0.05
  })()`
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'middle', buttons: 4, clickCount: 1 })
  for (let step = 1; step <= 6; step++) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: rect.x + step * 16, y: rect.y + step * 4, button: 'middle', buttons: 4,
    })
    await sleep(40)
  }
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: rect.x + 96, y: rect.y + 24, button: 'middle', buttons: 0, clickCount: 1,
  })
  try {
    await poll(movedExpr, 'pointer orbit', Math.min(timeoutMs, 15000))
  } catch { problems.push('a canvas drag did not orbit the published camera') }
  await screenshot('station-game-pointer-orbit')
  const orbit = await page.evaluate(cameraExpr)
  if (orbit && start.back && distance(orbit.back, start.back) < 0.05) problems.push('the drag left the camera basis unchanged')
  // Ctrl+H is the shell's home shortcut; it must reach the same handler as the cube's Home.
  for (const type of ['rawKeyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', {
      type, modifiers: 2, key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72,
    })
  }
  try {
    await poll(`(() => {
      const c = (window.__metroStationBridge.getSnapshot().state.camera ?? null)
      if (!c || !c.back) return false
      const b = ${JSON.stringify(start.back.map(Number))}
      return Math.hypot(c.back[0] - b[0], c.back[1] - b[1], c.back[2] - b[2]) < 0.2
    })()`, 'ctrl+h home', Math.min(timeoutMs, 15000))
  } catch { problems.push('Ctrl+H did not return the camera home') }
  const after = await currentSnapshot()
  if (after.revision !== before.revision) problems.push('camera input changed the document revision')
  await screenshot('station-game-pointer-home')
  return finishCase(record, problems.length === 0, { problems, revision: after.revision })
}

async function runClockCase() {
  const record = caseStart('simulation-clock')
  const problems = []
  const send = (type, payload) => page.evaluate(`window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const clockExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.clock ?? null })()`
  const first = await page.evaluate(clockExpr)
  if (!first || !Number.isFinite(first.simTimeSeconds)) { problems.push('no clock snapshot published'); return finishCase(record, false, { problems }) }
  // The session boots at 06:30 (`REFERENCE_BOOT`) and nothing seeks it backwards; the
  // playback case may already have run this tab forward, so the cold-boot pin is "not
  // before 06:30" here — the exact instant stays pinned by the EditMode clock suite.
  if (first.simTimeSeconds < 23400 - 1) problems.push('the clock is before the 06:30 boot (' + first.simTimeSeconds + ')')
  await send('sim.play', { playing: true })
  await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === true })()`, 'clock playing', Math.min(timeoutMs, 15000)).catch(() => problems.push('sim.play did not start the clock'))
  await sleep(2500)
  const later = await page.evaluate(clockExpr)
  if (!(later && later.simTimeSeconds > first.simTimeSeconds)) problems.push('the clock did not advance while playing')
  await send('sim.speed', { speed: 4 })
  await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.speed === 4 })()`, 'clock speed 4', Math.min(timeoutMs, 15000)).catch(() => problems.push('sim.speed 4 was not accepted'))
  await send('sim.play', { playing: false })
  await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === false })()`, 'clock paused', Math.min(timeoutMs, 15000)).catch(() => problems.push('sim.play false did not pause'))
  const after = await currentSnapshot()
  if (after.document && after.revision < 0) problems.push('clock state lost the station')
  await screenshot('station-game-clock')
  return finishCase(record, problems.length === 0, { problems, revision: after.revision })
}

/**
 * Plan 13 §1: playback through ordinary input. The prior clock case called the bridge
 * directly, which is exactly the path a player cannot use — the React adapter dropped
 * the intent before it reached the transport. This case presses Space on the cold tab
 * and clicks the real Play/Pause and speed buttons, then judges the published clock,
 * the visible 信息栏 clock and the commands those inputs produced.
 */
async function runPlaybackCase(locale) {
  const record = caseStart(`playback-input-${locale}`)
  const problems = []
  const clockExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.clock ?? null })()`
  const visibleClockExpr = `(() => { const el = document.querySelector('.clockDigits'); return el ? el.textContent : null })()`
  const pausedCardExpr = `(() => { const el = document.querySelector('.clockCard'); return el ? el.className.includes('paused') : null })()`
  const first = await page.evaluate(clockExpr)
  if (!first || !Number.isFinite(first.simTimeSeconds)) {
    problems.push('no clock snapshot published')
    return finishCase(record, false, { problems })
  }
  const capabilities = await page.evaluate(`(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.simulationCapabilities ?? null })()`)
  if (!capabilities) problems.push('state.simulationCapabilities is not published beside state.clock')
  else {
    for (const flag of ['play', 'speed', 'seek', 'restart']) {
      if (capabilities[flag] !== true) problems.push('the host does not advertise ' + flag + ' (' + JSON.stringify(capabilities) + ')')
    }
    if (typeof capabilities.sessionId !== 'string' || capabilities.sessionId.length === 0) problems.push('the capability block names no session')
  }
  if (first.playing !== false) problems.push('a cold tab opens playing')
  const rejectsBefore = await page.evaluate('window.__metroStationBridge.getSnapshot().rejects.length')
  const shownFirst = await page.evaluate(visibleClockExpr)
  if (shownFirst !== first.clockSeconds) problems.push('the visible clock does not print the C# clock (' + shownFirst + ' != ' + first.clockSeconds + ')')

  if (!(await installCommandRecorder())) return finishCase(record, false, { problems: ['the shared bridge port is not mounted'] })
  // A player clicks the canvas before pressing a key: the canvas takes focus, and the
  // key must still reach the shell's single handler.
  const rectExpr = `(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`
  const rect = await page.evaluate(rectExpr).catch(() => null)
  if (rect) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 })
  } else {
    problems.push('no Unity canvas to click')
  }

  const plays = async () => (await recordedCommands()).filter(row => row.type === 'sim.play')
  const speeds = async () => (await recordedCommands()).filter(row => row.type === 'sim.speed')

  // Space starts playback: exactly one toggle, and the host acknowledges it with a
  // running clock and an advancing tick.
  await pressKey(' ', 'Space', 32)
  try {
    await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === true })()`, locale + ' space play', Math.min(timeoutMs, 20000))
  } catch { problems.push('Space did not start playback') }
  const afterSpace = await page.evaluate(clockExpr)
  const spacePlays = await plays()
  if (spacePlays.length !== 1) problems.push('Space sent ' + spacePlays.length + ' sim.play commands, expected exactly one: ' + JSON.stringify(spacePlays))
  else if (spacePlays[0].payload?.playing !== true) problems.push('Space sent ' + JSON.stringify(spacePlays[0].payload) + ' instead of playing:true')
  if (afterSpace) {
    if (afterSpace.playing !== true) problems.push('the clock was not acknowledged as playing')
    const tickBefore = afterSpace.tick
    const secondsBefore = afterSpace.simTimeSeconds
    await sleep(2000)
    const later = await page.evaluate(clockExpr)
    if (!(later.tick > tickBefore)) problems.push('the tick did not advance while playing (' + tickBefore + ' -> ' + later.tick + ')')
    if (!(later.simTimeSeconds > secondsBefore)) problems.push('sim seconds did not advance while playing')
    const shown = await page.evaluate(visibleClockExpr)
    if (shown !== later.clockSeconds) problems.push('the visible clock is stale while playing (' + shown + ' != ' + later.clockSeconds + ')')
    if (await page.evaluate(pausedCardExpr) === true) problems.push('the clock card still says paused while the host is playing')
    await screenshot('station-game-playback-playing')
  }

  // Space pauses again: one more toggle, and a paused station does not advance.
  await pressKey(' ', 'Space', 32)
  try {
    await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === false })()`, locale + ' space pause', Math.min(timeoutMs, 20000))
  } catch { problems.push('a second Space did not pause playback') }
  const paused = await page.evaluate(clockExpr)
  const pausedPlays = await plays()
  if (pausedPlays.length !== 2) problems.push('two Space presses produced ' + pausedPlays.length + ' sim.play commands, expected exactly two')
  await sleep(1200)
  const stillPaused = await page.evaluate(clockExpr)
  if (!(stillPaused.tick === paused.tick)) problems.push('the tick advanced while paused (' + paused.tick + ' -> ' + stillPaused.tick + ')')
  if (await page.evaluate(pausedCardExpr) !== true) problems.push('the clock card does not say paused while the host is paused')

  // Every speed button is a real click on the real control. A click on a *different*
  // rate is one `sim.speed`, and any click while paused is one `sim.play`; the
  // Play/Pause button then pauses again, so each rate is proven on its own.
  let previousSpeed = paused && Number.isFinite(paused.speed) ? paused.speed : 1
  for (const speed of [4, 1, 16, 64]) {
    const clicks = await page.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.topbar .seg button')]
      const button = buttons.find(row => row.textContent.trim() === ${JSON.stringify(speed + '\u00d7')})
      if (!button) return 'missing'
      if (button.disabled) return 'disabled'
      button.click()
      return 'clicked'
    })()`)
    if (clicks !== 'clicked') { problems.push(`the ${speed}× speed button ${clicks}`); continue }
    await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === true && c.speed === ${speed} })()`, `${speed}x speed`, Math.min(timeoutMs, 15000))
      .catch(() => problems.push('the ' + speed + '× click did not start the host at ' + speed + '×'))
    if (speed !== previousSpeed) {
      const speedCommands = (await speeds()).filter(row => row.payload && row.payload.speed === speed)
      if (speedCommands.length !== 1) problems.push('the ' + speed + '× click sent ' + speedCommands.length + ' sim.speed commands, expected exactly one')
    }
    previousSpeed = speed
    // Pause again through the real Play/Pause button before the next rate.
    const toggled = await page.evaluate(`(() => {
      const button = document.querySelector('.topbar .seg button')
      if (!button) return 'missing'
      if (button.disabled) return 'disabled'
      button.click()
      return 'clicked'
    })()`)
    if (toggled !== 'clicked') { problems.push('the Play/Pause button ' + toggled); continue }
    await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === false })()`, 'play/pause button', Math.min(timeoutMs, 15000))
      .catch(() => problems.push('the Play/Pause button did not pause the host'))
  }
  const playCommands = await plays()
  if (playCommands.length !== 2 + 4 * 2) problems.push('the transport sent ' + playCommands.length + ' sim.play commands, expected ' + (2 + 4 * 2))

  // Space after a speed button is still exactly one toggle: the AppShell blurs the
  // button it dropped focus from, so the keyup cannot re-press it.
  const beforeSpaceToggle = (await plays()).length
  const speedClick = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('.topbar .seg button')].find(row => row.textContent.trim() === '4\u00d7')
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  if (speedClick) await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === true && c.speed === 4 })()`, '4x click playing', Math.min(timeoutMs, 15000)).catch(() => problems.push('clicking 4× did not start the run at 4×'))
  const afterSpeedClick = (await plays()).length
  await pressKey(' ', 'Space', 32)
  try {
    await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === false })()`, 'space after 4x', Math.min(timeoutMs, 20000))
  } catch { problems.push('Space after clicking 4× did not pause') }
  const afterSpaceToggle = (await plays()).length
  const toggleDelta = afterSpaceToggle - afterSpeedClick
  if (afterSpeedClick - beforeSpaceToggle !== 1) problems.push('the 4× click sent ' + (afterSpeedClick - beforeSpaceToggle) + ' sim.play commands, expected one')
  if (toggleDelta !== 1) problems.push('Space after a speed click sent ' + toggleDelta + ' sim.play commands, expected exactly one toggle')
  const rejectsAfter = await page.evaluate('window.__metroStationBridge.getSnapshot().rejects.length')
  if (rejectsAfter !== rejectsBefore) problems.push('the transport was rejected ' + (rejectsAfter - rejectsBefore) + ' time(s)')
  await screenshot('station-game-playback-paused')
  const after = await currentSnapshot()
  if (after.document && after.revision < 0) problems.push('playback lost the committed station')
  // Evidence the plan asks for by name: the command ids the UI sent, the session they
  // went to, and the C# clock/tick each press produced beside the visible readout.
  const finalClock = await page.evaluate(clockExpr)
  const finalShown = await page.evaluate(visibleClockExpr)
  const transport = (await recordedCommands()).filter(row => row.type.startsWith('sim.'))
  return finishCase(record, problems.length === 0, {
    problems,
    revision: after.revision,
    session: capabilities ? capabilities.sessionId : null,
    clock: {
      boot: first.simTimeSeconds,
      playing: afterSpace ? afterSpace.simTimeSeconds : null,
      paused: paused ? paused.simTimeSeconds : null,
      tick: finalClock ? finalClock.tick : null,
      final: finalClock ? finalClock.simTimeSeconds : null,
      visible: finalShown,
      lastPlaying: finalClock ? finalClock.playing : null,
      lastSpeed: finalClock ? finalClock.speed : null,
    },
    commands: transport.map(row => ({ type: row.type, id: row.id, payload: row.payload })),
  })
}

/**
 * Plan 13 §1: held keyboard navigation on the Unity canvas. WASD moves camera and aim
 * together across the plan (the published basis is unchanged), Ctrl+E raises the view
 * and Ctrl+Q lowers it (`panCameraVertical`'s own pair), plain Q stays the storey step,
 * and a release or a lost focus stops the motion.
 */
async function runKeyboardNavigationCase() {
  const record = caseStart('keyboard-navigation')
  const problems = []
  const cameraExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.camera ?? null })()`
  const levelExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return (s.state.view ?? {}).level ?? null })()`
  // The rig is configured by the commit and the camera pose is applied a frame later; a
  // filtered run reaches this case right after the cold open, so wait for a real pose
  // rather than measuring a zeroed one.
  try {
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot()
      const c = s.state.camera
      if (!c || !Array.isArray(c.position)) return false
      return Math.hypot(c.position[0], c.position[1], c.position[2]) > 1
    })()`, 'configured camera', Math.min(timeoutMs, 30000))
    await sleep(400)
  } catch { problems.push('the host never published a configured camera') }
  const start = await page.evaluate(cameraExpr)
  if (!start || !start.position || !start.back) {
    return finishCase(record, false, { problems: ['no camera snapshot published'] })
  }
  const before = await currentSnapshot()
  const distanceOf = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const sameBasis = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > 0.999
  // What the shell asked the camera for, so a case failure names the failing hop.
  await installCommandRecorder()

  // Hold W: the view travels across the plan, the basis (the view angle) is preserved.
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 })
  await sleep(900)
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 })
  // The release is itself a command: sample after it has landed, or the last frames of
  // the hold read as "still moving after the key was released".
  await sleep(400)
  const moved = await page.evaluate(cameraExpr)
  const planar = distanceOf(moved.position, start.position)
  if (!(planar > 0.5)) problems.push('holding W moved the camera ' + planar.toFixed(3) + ' m across the plan')
  if (Math.abs(moved.position[2] - start.position[2]) > 0.1) problems.push('the ground pan changed the eye elevation')
  if (!sameBasis(moved.back, start.back)) problems.push('the ground pan changed the view angle (camera and aim did not move together)')
  await screenshot('station-game-keyboard-w')
  // A released key does not keep moving.
  await sleep(700)
  const stopped = await page.evaluate(cameraExpr)
  const drift = distanceOf(stopped.position, moved.position)
  if (drift > 0.05) problems.push('the camera kept moving ' + drift.toFixed(3) + ' m after the key was released')

  // Ctrl+E raises the view along the elevation axis, at the same rate, without
  // touching the plan; Ctrl+Q is the same pan the other way (`panCameraVertical`: the
  // letter's own direction, not a key name).
  const beforeLift = await page.evaluate(cameraExpr)
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 })
  await sleep(900)
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 })
  const lifted = await page.evaluate(cameraExpr)
  if (!(lifted.position[2] - beforeLift.position[2] > 0.5)) problems.push('Ctrl+E did not raise the view')
  if (Math.hypot(lifted.position[0] - beforeLift.position[0], lifted.position[1] - beforeLift.position[1]) > 0.1) problems.push('Ctrl+E moved the plan as well as the elevation')
  if (!sameBasis(lifted.back, beforeLift.back)) problems.push('Ctrl+E changed the view angle')
  await screenshot('station-game-keyboard-ctrl-e')
  const beforeDrop = await page.evaluate(cameraExpr)
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 81 })
  await sleep(700)
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 81 })
  const dropped = await page.evaluate(cameraExpr)
  if (!(beforeDrop.position[2] - dropped.position[2] > 0.5)) problems.push('Ctrl+Q did not lower the view')

  // A plain Q is the storey step, not the vertical pan: the level moves and the eye
  // does not keep climbing afterwards.
  const levelBefore = await page.evaluate(levelExpr)
  await pressKey('q', 'KeyQ', 81)
  let levelAfter = levelBefore
  try {
    await poll(`(() => { const s = window.__metroStationBridge.getSnapshot(); return ((s.state.view ?? {}).level ?? null) !== ${Number(levelBefore)} })()`, 'plain Q storey step', Math.min(timeoutMs, 15000))
    levelAfter = await page.evaluate(levelExpr)
  } catch { problems.push('a plain Q did not step the storey') }
  const afterStep = await page.evaluate(cameraExpr)
  await sleep(600)
  const afterStepSettled = await page.evaluate(cameraExpr)
  if (distanceOf(afterStepSettled.position, afterStep.position) > 0.05) problems.push('a plain Q left the view still moving')

  // Losing focus releases a held key: a player who alt-tabs must not come back to a
  // camera still sliding. The blur is the event a real tab switch sends, and Unity's
  // WebGL player reacts to it — so the page is focused again and the host proven live
  // before the case ends. An earlier version of this case left the player paused and
  // every later case read a frozen clock.
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 })
  await sleep(400)
  await page.evaluate(`window.dispatchEvent(new Event('blur'))`)
  await sleep(400)
  const blurred = await page.evaluate(cameraExpr)
  await sleep(800)
  const afterBlur = await page.evaluate(cameraExpr)
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 })
  const blurDrift = distanceOf(afterBlur.position, blurred.position)
  if (blurDrift > 0.1) problems.push('blur did not release the held W/A/S/D pan (' + blurDrift.toFixed(3) + ' m)')

  // Focus restored: the player must publish frames again, or the cases after this one
  // would judge a frozen clock (`simulation-clock`, `road-traffic`, `tool-selection`).
  await page.evaluate(`window.dispatchEvent(new Event('focus')); window.focus()`).catch(() => {})
  await page.send('Page.bringToFront').catch(() => {})
  const canvasExpr = `(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`
  const focusRect = await page.evaluate(canvasExpr).catch(() => null)
  if (focusRect) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: focusRect.x, y: focusRect.y, button: 'left', buttons: 1, clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: focusRect.x, y: focusRect.y, button: 'left', buttons: 0, clickCount: 1 })
  }
  const clockOf = `(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return { tick: c.tick ?? -1, playing: c.playing === true } })()`
  const frozen = await page.evaluate(clockOf)
  await page.evaluate(`window.__metroStationBridge.send('sim.play', { playing: true })`)
  try {
    await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === true && c.tick > ${Number(frozen.tick)} })()`, 'player resumed after focus', Math.min(timeoutMs, 25000))
  } catch { problems.push('the player did not resume publishing state after focus returned') }
  await page.evaluate(`window.__metroStationBridge.send('sim.play', { playing: false })`)
  await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === false })()`, 'player paused again', Math.min(timeoutMs, 15000))
    .catch(() => problems.push('the player did not acknowledge the pause after focus returned'))

  const after = await currentSnapshot()
  if (after.revision !== before.revision) problems.push('keyboard navigation changed the document revision')
  const cameraCommands = (await recordedCommands()).filter(row => row.type.startsWith('camera.'))
  return finishCase(record, problems.length === 0, {
    problems, revision: after.revision,
    planarMetres: Number(planar.toFixed(2)),
    liftedMetres: Number((lifted.position[2] - beforeLift.position[2]).toFixed(2)),
    droppedMetres: Number((beforeDrop.position[2] - dropped.position[2]).toFixed(2)),
    level: { before: levelBefore, after: levelAfter },
    positions: {
      start: start.position, moved: moved.position, stopped: stopped.position,
      beforeLift: beforeLift.position, lifted: lifted.position, dropped: dropped.position,
    },
    commands: cameraCommands.map(row => ({ type: row.type, payload: row.payload })),
    rejects: after.rejects ?? [],
  })
}

/**
 * Packet F3 through the real bridge: one sign face edit is one commit, the committed
 * document carries the new marks, a repeat is an idempotent ack, and restoring the
 * original content is one more commit. This is the browser half the EditMode suite
 * cannot prove (the C# painter/cache re-request path).
 */
async function runSignCommitCase() {
  const record = caseStart('sign-commit')
  const problems = []
  if (!(await ensureDemo('zoo'))) {
    problems.push('could not commit the Zoo document before editing a sign')
    return finishCase(record, false, { problems })
  }
  const revision = () => page.evaluate('window.__metroStationBridge.getSnapshot().revision')
  const send = (payload, expectedRevision) => page.evaluate(
    `window.__metroStationBridge.send('sign.commit', ${JSON.stringify(payload)}, { expectedRevision: ${Number(expectedRevision)} })`)
  const signOf = `(() => {
    const text = window.__metroStationBridge.getSnapshot().document
    if (!text) return null
    const modules = JSON.parse(text).static?.modules ?? []
    const module = modules.find(row => row.type === 'sign' && row.cfg && Array.isArray(row.cfg.front))
    return module ? { id: module.id, front: module.cfg.front, back: module.cfg.back ?? [] } : null
  })()`
  const sign = await page.evaluate(signOf)
  if (!sign) return finishCase(record, false, { problems: ['no sign with an explicit front board'] })
  const before = await revision()
  // A short ASCII probe: a label row prints at most 24 characters, and this file's
  // old fixture text had been double-encoded into a 70-character latin string, which the
  // current label limit correctly refused.
  const probe = [{ id: 'probe-1', kind: 'text', text: 'PROBE', x: 0.5, y: 0.5, scale: 1, side: 'both' }]
  await send({ signId: sign.id, face: 'front', content: probe }, before)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'sign commit', Math.min(timeoutMs, 300000))
  } catch { problems.push('sign.commit did not commit a revision') }
  const committedRevision = await revision()
  if (committedRevision !== before + 1) problems.push('the sign edit moved the revision by ' + (committedRevision - before))
  const committedFront = await page.evaluate(`(() => {
    const text = window.__metroStationBridge.getSnapshot().document
    if (!text) return null
    const module = (JSON.parse(text).static?.modules ?? []).find(row => row.id === ${JSON.stringify(sign.id)})
    return module && module.cfg && module.cfg.front ? JSON.stringify(module.cfg.front) : null
  })()`)
  if (!committedFront || !committedFront.includes('PROBE')) problems.push('the committed document does not carry the edited face')
  try {
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot()
      const last = s.state.sign && s.state.sign.lastCommit
      return Boolean(last && last.signId === ${JSON.stringify(sign.id)} && typeof last.contentKey === 'string' && last.contentKey.length > 0)
    })()`, 'sign.lastCommit', Math.min(timeoutMs, 20000))
  } catch { problems.push('the state frame never published sign.lastCommit for the edited sign') }
  // A repeat of the same edit is an idempotent ack: no second revision, no rejection.
  await send({ signId: sign.id, face: 'front', content: probe }, committedRevision)
  await sleep(1500)
  const repeatedRevision = await revision()
  if (repeatedRevision !== committedRevision) problems.push('an identical sign edit moved the revision')
  // Put the original board back so the demo is left as it was found.
  await send({ signId: sign.id, face: 'front', content: sign.front }, repeatedRevision)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${repeatedRevision + 1}`, 'sign restore', Math.min(timeoutMs, 300000))
  } catch { problems.push('restoring the original sign face did not commit') }
  const restoredFront = await page.evaluate(`(() => {
    const text = window.__metroStationBridge.getSnapshot().document
    if (!text) return null
    const module = (JSON.parse(text).static?.modules ?? []).find(row => row.id === ${JSON.stringify(sign.id)})
    return module && module.cfg && module.cfg.front ? JSON.stringify(module.cfg.front) : null
  })()`)
  if (restoredFront && restoredFront.includes('PROBE')) problems.push('the restoring edit left the probe text on the board')
  await screenshot('station-game-sign-commit')
  return finishCase(record, problems.length === 0, { problems, revision: await revision() })
}

/**
 * H3 through the bridge: the crowd block reports which profile is bound. The public
 * pack has no catalogue and must publish nobody and no recipe ids; the local pack
 * binds the 440-row library and must publish real recipe ids into the state frame.
 */
async function runPassengerProfileCase() {
  const record = caseStart('passenger-profile')
  const problems = []
  const crowdExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.crowd ?? null })()`
  const first = await page.evaluate(crowdExpr)
  if (!first) {
    problems.push('no crowd state published')
    return finishCase(record, false, { problems })
  }
  const send = (type, payload) => page.evaluate(`window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const profile = first.catalogue ?? { bound: false, count: 0, rights: '' }
  if (!profile.bound) {
    // The session still publishes real passenger poses (the service runs); what the
    // public profile must never do is name an internal recipe, because there is no
    // catalogue to select one from and no crowd renderer draws the bodies.
    if ((first.passengers ?? []).some(passenger => passenger.recipe)) problems.push('a public-profile passenger carries an internal recipe id')
  } else {
    if (profile.rights !== 'INTERNAL_REVIEW_ONLY') problems.push('the local catalogue reports rights ' + profile.rights)
    await send('sim.speed', { speed: 64 })
    await send('sim.play', { playing: true })
    try {
      await poll(`(() => {
        const c = window.__metroStationBridge.getSnapshot().state.crowd
        return Boolean(c && c.catalogue && c.catalogue.bound && c.published > 0 &&
          c.passengers.some(passenger => typeof passenger.recipe === 'string' && passenger.recipe.length > 0))
      })()`, 'local crowd recipes', Math.min(timeoutMs, 120000))
    } catch { problems.push('the local profile published no passenger recipe ids') }
    const crowd = await page.evaluate(crowdExpr)
    const recipes = new Set((crowd?.passengers ?? []).map(passenger => passenger.recipe).filter(Boolean))
    if (recipes.size === 0) problems.push('no distinct recipe id reached the state frame')
    await send('sim.play', { playing: false })
    await send('sim.speed', { speed: 1 })
    // Capture the crowd itself: dismiss the first-run tutorial, frame the home view
    // and zoom in. This is evidence that the published recipes are drawn, not just
    // counted.
    await page.evaluate(`(() => {
      const skip = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'ÃƒÂ¨Ã‚Â·Ã‚Â³ÃƒÂ¨Ã‚Â¿Ã¢â‚¬Â¡')
      if (skip) skip.click()
    })()`).catch(() => {})
    await send('camera.home', {})
    await send('camera.zoom', { delta: -360 })
    await send('camera.zoom', { delta: -360 })
    await sleep(750)
    await screenshot('station-game-passenger-crowd')
  }
  await screenshot('station-game-passenger-profile')
  const after = await currentSnapshot()
  return finishCase(record, problems.length === 0, {
    problems, revision: after.revision, profile: profile.bound ? 'soft-human' : 'public-stand-in',
  })
}

/**
 * Plan 13 §1, the service half: at a running service time the clock advances and real
 * bodies move on a named motion channel — an escalator rider's own world position, the
 * tread the station runs on — not a counter that merely changes. Reads only the
 * published state frame.
 */
async function runServiceMotionCase() {
  const record = caseStart('service-motion')
  const problems = []
  if (!(await ensureDemo('zoo'))) problems.push('could not commit the Zoo document before sampling service motion')
  const send = (type, payload) => page.evaluate(`window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const sampleExpr = `(() => {
    const s = window.__metroStationBridge.getSnapshot()
    const clock = s.state.clock ?? null
    const crowd = s.state.crowd ?? null
    return {
      clock: clock ? { simTimeSeconds: clock.simTimeSeconds, tick: clock.tick, playing: clock.playing, speed: clock.speed, clockSeconds: clock.clockSeconds, serviceOpen: clock.serviceOpen } : null,
      queued: s.state.queued ?? null,
      boarded: s.state.boarded ?? null,
      published: crowd ? crowd.published : 0,
      passengers: crowd && Array.isArray(crowd.passengers)
        ? crowd.passengers.map(row => ({ id: row.id, x: row.x, y: row.y, z: row.z, activity: row.activity, state: row.state }))
        : [],
    }
  })()`
  await send('sim.speed', { speed: 16 })
  await send('sim.play', { playing: true })
  // A freshly committed station starts its crowding from one body: the earlier sign
  // commits installed a new session, so let the street demand populate before the
  // first sample, or the two samples share almost no ids.
  await poll(`(() => { const c = window.__metroStationBridge.getSnapshot().state.crowd; return Boolean(c && c.published >= 8) })()`, 'crowd populated', Math.min(timeoutMs, 90000))
    .catch(() => {})
  const first = await page.evaluate(sampleExpr)
  if (!first || !first.clock) {
    problems.push('no clock snapshot published')
    return finishCase(record, false, { problems })
  }
  if (!first.clock.serviceOpen) problems.push('the station is outside its service window at the sample (' + first.clock.clockSeconds + ')')
  // 15 simulated seconds per real second at 16x.
  await sleep(3500)
  const later = await page.evaluate(sampleExpr)
  const advanced = later.clock.simTimeSeconds - first.clock.simTimeSeconds
  if (!(advanced > 20)) problems.push('the clock advanced ' + advanced.toFixed(1) + ' simulated seconds at 16x')
  if (!(later.published > 0)) problems.push('the station published no passengers at a service time')
  const before = new Map(first.passengers.map(row => [row.id, row]))
  const moved = []
  for (const row of later.passengers) {
    const was = before.get(row.id)
    if (!was) continue
    const metres = Math.hypot(row.x - was.x, row.y - was.y, row.z - was.z)
    if (metres > 0.5) moved.push({ id: row.id, metres: Number(metres.toFixed(2)), activity: row.activity, state: row.state })
  }
  if (!(moved.length >= 3)) problems.push('only ' + moved.length + ' passenger(s) moved while the station ran')
  const channel = moved.find(row => /escalator|walkway/.test(row.activity)) ?? moved.find(row => row.state === 'riding')
  if (!channel) problems.push('no moving body was riding an escalator or walkway (the motion channel)')
  await screenshot('station-game-service-motion')
  await send('sim.play', { playing: false })
  await send('sim.speed', { speed: 1 })
  await poll(`(() => { const c = (window.__metroStationBridge.getSnapshot().state.clock ?? {}); return c.playing === false && c.speed === 1 })()`, 'service motion paused', Math.min(timeoutMs, 15000))
    .catch(() => problems.push('the station did not settle back to paused at 1x'))
  const after = await currentSnapshot()
  return finishCase(record, problems.length === 0, {
    problems,
    revision: after.revision,
    clock: { from: first.clock.clockSeconds, to: later.clock.clockSeconds, advancedSeconds: Number(advanced.toFixed(1)), speed: later.clock.speed },
    passengers: { before: first.published, after: later.published, moved: moved.length },
    channel: channel ?? null,
    moved: moved.slice(0, 6),
  })
}

async function runPaintCase() {
  const record = caseStart('material-paint')
  const problems = []
  const before = await currentSnapshot()
  // Paint on a tiny slice of the demo rather than on all 14 066 cells: the commit path
  // is the same host transaction, and rebuilding a full station in the headless
  // software renderer blocks far past any sane verifier budget.
  const tiny = await page.evaluate(`(() => {
    const source = JSON.parse(window.__metroStationBridge.getSnapshot().document)
    const cells = source.static.cells.filter(cell => cell.fill === 'solid').slice(0, 3)
    source.name = 'Paint probe'
    source.nameEn = 'Paint probe'
    source.static = { cells, modules: [], lines: [] }
    return { document: JSON.stringify(source), cell: [cells[0].x, cells[0].y, cells[0].z], finish: (cells[0].finish && cells[0].finish.top) || null }
  })()`)
  if (!tiny || !tiny.document) { problems.push('could not build the paint probe document'); return finishCase(record, false, { problems }) }
  await page.evaluate(`window.__metroStationBridge.send('station.open', { document: ${JSON.stringify(tiny.document)} })`)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision > ${before.revision} && window.__metroStationBridge.getSnapshot().document.length < 20000`, 'tiny paint probe commit', Math.min(timeoutMs, 60000))
  } catch { problems.push('the tiny paint probe station did not open') }
  const probeRevision = await page.evaluate('window.__metroStationBridge.getSnapshot().revision')
  const send = (payload) => page.evaluate(`window.__metroStationBridge.send('face.paint', ${JSON.stringify(payload)})`)
  const revision = () => page.evaluate('window.__metroStationBridge.getSnapshot().revision')
  await send({ cell: tiny.cell, face: 'top', finish: 'floor.marble', mode: 'single' })
  let painted = probeRevision
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision > ${probeRevision}`, 'paint commit', Math.min(timeoutMs, 60000))
    painted = await revision()
  } catch { problems.push('face.paint never committed a revision') }
  const document = await page.evaluate('window.__metroStationBridge.getSnapshot().document')
  if (document && !document.includes('floor.marble')) problems.push('the committed document does not carry the painted finish')
  await screenshot('station-game-paint')
  // Restore the surface so the probe station is left as it was found.
  await send({ cell: tiny.cell, face: 'top', finish: tiny.finish ?? 'floor.concrete', mode: 'single' })
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision > ${painted}`, 'paint restore commit', Math.min(timeoutMs, 60000))
  } catch { problems.push('the restoring paint did not commit') }
  const restored = await page.evaluate('window.__metroStationBridge.getSnapshot().document')
  if (restored && restored.includes('floor.marble')) problems.push('the restoring paint left the painted finish behind')
  return finishCase(record, problems.length === 0, { problems, revision: await revision() })
}

async function runToolCase() {
  const record = caseStart('tool-selection')
  const problems = []
  const send = (tool) => page.evaluate(`window.__metroStationBridge.send('tool.set', { tool: ${JSON.stringify(tool)} })`)
  const toolExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.tool ?? null })()`
  const before = await currentSnapshot()
  for (const tool of ['paint', 'delete']) {
    await send(tool)
    try {
      await poll(toolExpr + ' === ' + JSON.stringify(tool), 'tool.' + tool, Math.min(timeoutMs, 15000))
    } catch { problems.push('tool.set ' + tool + ' did not reach the committed state') }
  }
  // An unknown tool is refused by name and must not move the committed selection.
  await send('demolish')
  const rejectExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); const last = s.rejects[s.rejects.length - 1]; return last ? last.code : null })()`
  try {
    await poll(rejectExpr + ' === "unknown-tool"', 'unknown-tool reject', Math.min(timeoutMs, 15000))
  } catch { problems.push('an unknown tool name was not rejected with unknown-tool') }
  const committed = await page.evaluate(toolExpr)
  if (committed !== 'delete') problems.push('a rejected tool.set moved the committed tool (' + committed + ')')
  const after = await currentSnapshot()
  if (after.revision !== before.revision) problems.push('a tool.set changed the document revision')
  await screenshot('station-game-tool')
  return finishCase(record, problems.length === 0, { problems, revision: after.revision })
}

/**
 * The road cases judge the Zoo records specifically, so make sure the committed station
 * is the Zoo document even when the run started from another demo (`--demo all`).
 */
async function ensureDemo(id) {
  const current = await page.evaluate('window.__metroStationBridge.getSnapshot().sourceId')
  if (current === id) return true
  await page.evaluate(`window.__metroStationBridge.send('station.openDemo', { id: ${JSON.stringify(id)} })`)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().sourceId === ${JSON.stringify(id)}`, 'demo ' + id, Math.min(timeoutMs, 240000))
    return true
  } catch { return false }
}

async function runRoadGeometryCase() {
  const record = caseStart('road-geometry')
  const problems = []
  if (!(await ensureDemo('zoo'))) problems.push('could not commit the Zoo document before reading its roads')
  // Geometry is judged from the committed save text, exactly the record a reopen reads:
  // the two authored Zoo roads, their explicit endpoints, direction and width.
  const roads = await page.evaluate(`(() => {
    const text = window.__metroStationBridge.getSnapshot().document
    if (!text) return null
    return (JSON.parse(text).static?.modules ?? [])
      .filter(module => module.type === 'road')
      .map(module => ({ id: module.id, w: module.w, d: module.d, rot: module.rot, cfg: module.cfg ?? null }))
  })()`)
  if (!roads) problems.push('no committed document to read roads from')
  else {
    if (roads.length !== 2) problems.push('Zoo committed ' + roads.length + ' road modules, expected 2')
    const expect = {
      'road-3717': { from: [31, 3], to: [111, 3], direction: 'one-way', w: 86, d: 6, rot: 3 },
      'road-3976': { from: [34, -9], to: [108, -9], direction: 'two-way', w: 86, d: 12, rot: 3 },
    }
    for (const [id, wanted] of Object.entries(expect)) {
      const road = roads.find(row => row.id === id)
      if (!road) { problems.push(id + ' is not in the committed document'); continue }
      if (!road.cfg) { problems.push(id + ' lost its cfg'); continue }
      if (JSON.stringify(road.cfg.from) !== JSON.stringify(wanted.from)) problems.push(id + ' from is ' + JSON.stringify(road.cfg.from))
      if (JSON.stringify(road.cfg.to) !== JSON.stringify(wanted.to)) problems.push(id + ' to is ' + JSON.stringify(road.cfg.to))
      if (road.cfg.direction !== wanted.direction) problems.push(id + ' direction is ' + road.cfg.direction)
      if (road.w !== wanted.w || road.d !== wanted.d || road.rot !== wanted.rot)
        problems.push(id + ' footprint is ' + [road.w, road.d, road.rot].join('/'))
    }
    const published = await page.evaluate(`(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.roads ?? null })()`)
    if (!published) problems.push('the host does not publish a road state summary')
    else {
      if (published.records !== 2) problems.push('the road summary reports ' + published.records + ' records, expected 2')
      if (!(published.drawn >= 2)) problems.push('only ' + published.drawn + ' road(s) were drawn')
      const ends = Object.fromEntries((published.endpoints ?? []).map(row => [row.id, row]))
      for (const [id, wanted] of Object.entries({
        'road-3717': { from: [31, 3], to: [111, 3] },
        'road-3976': { from: [34, -9], to: [108, -9] },
      })) {
        const row = ends[id]
        if (!row) { problems.push('the road summary has no endpoint row for ' + id); continue }
        if (JSON.stringify(row.from) !== JSON.stringify(wanted.from)) problems.push(id + ' summary from ' + JSON.stringify(row.from))
        if (JSON.stringify(row.to) !== JSON.stringify(wanted.to)) problems.push(id + ' summary to ' + JSON.stringify(row.to))
      }
    }
  }
  await screenshot('station-game-road-geometry')
  const after = await currentSnapshot()
  return finishCase(record, problems.length === 0, { problems, revision: after.revision })
}

async function runTrafficCase() {
  const record = caseStart('road-traffic')
  const problems = []
  if (!(await ensureDemo('zoo'))) problems.push('could not commit the Zoo document before sampling its traffic')
  const send = (type, payload) => page.evaluate(`window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const roadExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); return s.state.roads ?? null })()`
  await send('sim.play', { playing: true })
  const first = await page.evaluate(roadExpr)
  if (!first) { problems.push('no road state summary'); return finishCase(record, false, { problems }) }
  const visible = first.vehicles?.visible ?? 0
  if (!(visible > 0)) problems.push('no vehicles were rendered on the committed roads (' + JSON.stringify(first.vehicles) + ')')
  if ((first.vehicles?.fallback ?? 0) > 0) problems.push('vehicles fell back to generated bodies instead of the promoted prefabs')
  if (!(first.simCars > 0)) problems.push('the traffic simulation has no cars')
  await sleep(2500)
  const later = await page.evaluate(roadExpr)
  if (!later) problems.push('the road summary disappeared while playing')
  else {
    if (!((later.vehicles?.visible ?? 0) > 0)) problems.push('vehicles disappeared while playing')
    if (first.simTime === later.simTime) problems.push('the vehicles never advanced with the session clock')
    // The Zoo two-way road must carry both directions; the renderer counts what it drew.
    const cars = later.vehicles?.cars ?? 0
    if (cars < 2) problems.push('only ' + cars + ' car(s) were drawn on a two-way road')
  }
  await send('sim.play', { playing: false })
  await screenshot('station-game-road-traffic')
  const after = await currentSnapshot()
  return finishCase(record, problems.length === 0, { problems, revision: after.revision })
}

async function runInvalidCase() {
  const record = caseStart('invalid-document-rollback')
  const before = await currentSnapshot()
  await page.evaluate(`window.__metroStationBridge.send('station.open', { document: '{"format":"not-a-station"}' })`)
  const rejectsExpr = `(() => { const s = window.__metroStationBridge.getSnapshot(); const last = s.rejects[s.rejects.length - 1]; return last ? last.code : null })()`
  await poll(rejectsExpr + ' === "parse-failed"', 'parse-failed reject', Math.min(timeoutMs, 30000))
  const after = await currentSnapshot()
  const problems = []
  if (after.revision !== before.revision) problems.push('rejected open changed revision')
  if (after.sourceId !== before.sourceId) problems.push('rejected open changed the station')
  if (after.documentBytes !== before.documentBytes) problems.push('rejected open changed the committed document')
  await screenshot('station-game-invalid')
  return finishCase(record, problems.length === 0, { problems, revision: after.revision })
}

async function runResyncCase() {
  const record = caseStart('resync')
  const before = await currentSnapshot()
  await page.evaluate(`window.__metroStationBridge.resync()`)
  await sleep(500)
  const after = await currentSnapshot()
  const problems = []
  if (after.revision !== before.revision) problems.push('resync changed revision')
  if (after.sourceId !== before.sourceId) problems.push('resync changed the station')
  if (after.documentBytes === 0) problems.push('resync committed no document')
  await screenshot('station-game-resync')
  return finishCase(record, problems.length === 0, { problems, revision: after.revision })
}

async function main() {
  mark('launch')
  page = await withPage({
    url: base + (locales[0] === 'en' ? '/game/en/' : '/game/') + demos[0],
    profile: join(outDir, 'chrome-profile'),
    debugPort: Number(process.env.METRO_STATION_DEBUG_PORT || 9337),
    commandTimeoutMs: timeoutMs,
  })
  page.onEvent('Runtime.exceptionThrown', rememberBrowserError('exception'))
  page.onEvent('Log.entryAdded', rememberBrowserError('log'))
  await page.send('Runtime.enable')
  await page.send('Log.enable')
  // A filtered run skips the demo cases that normally wait for the cold open, so wait
  // for the initial commit here before the selected case reads the station.
  if (onlyCases) await poll('window.__metroStationBridge && window.__metroStationBridge.getSnapshot().revision >= 0', 'initial commit')
  for (const locale of locales) {
    for (const id of demos) if (wanted(`demo-${id}-${locale}`)) await runDemoCase(id, locale)
    // Playback runs on the tab that just cold-opened this locale: a real Space press and
    // real Play/Pause and speed clicks, which is the hop that was broken (plan 13 §1).
    if (wanted(`playback-input-${locale}`)) await runPlaybackCase(locale)
  }
  if (wanted('switch-all-demos') && (demoArg === 'all' || demos.length > 1)) await runSwitchCase()
  // The feature cases read and edit the committed demo, so they run before `new`
  // replaces it: reloading a 14 k-cell station is the expensive install path, and the
  // browser must not pay it twice in one run.
  if (wanted('view-tools')) await runViewToolsCase()
  if (wanted('camera-cube')) await runCameraCase()
  if (wanted('pointer-camera')) await runPointerCameraCase()
    if (wanted('visual-home')) await runVisualCase()
    if (wanted('overlay-toggles')) await runOverlayCase()
  if (wanted('keyboard-navigation')) await runKeyboardNavigationCase()
  if (wanted('tool-selection')) await runToolCase()
  if (wanted('road-geometry')) await runRoadGeometryCase()
  if (wanted('simulation-clock')) await runClockCase()
  if (wanted('road-traffic')) await runTrafficCase()
  if (wanted('sign-commit')) await runSignCommitCase()
  if (wanted('passenger-profile')) await runPassengerProfileCase()
  // Still on Zoo here (the paint case replaces the station), so the service sample does
  // not pay for another 14 k-cell install.
  if (wanted('service-motion')) await runServiceMotionCase()
  if (wanted('material-paint')) await runPaintCase()
  if (wanted('new-station')) await runNewCase()
  if (wanted('invalid-document-rollback')) await runInvalidCase()
  if (wanted('resync')) await runResyncCase()
  report.errors = browserErrors
  report.status = report.cases.every((test) => test.status === 'pass') ? 'passed' : 'failed'
  save()
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, report: join(outDir, 'station-game-report.json') }))
  process.exitCode = report.status === 'passed' ? 0 : 1
}

main()
  .catch(async (error) => {
    report.status = 'failed'
    report.errors = [...browserErrors, { kind: 'verifier', text: String(error?.stack ?? error) }]
    if (page) {
      report.lastSnapshot = await currentSnapshot().catch(() => null)
      await screenshot('station-game-failure').catch(() => {})
    }
    save()
    console.error(String(error?.stack ?? error))
    process.exitCode = 1
  })
  .finally(async () => {
    try { page?.close() } catch { }
    try { server.kill() } catch { }
  })
