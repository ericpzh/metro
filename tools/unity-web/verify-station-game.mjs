// Plan 11 A7 — the browser verifier for the generic station player.
//
// Runs the packed WebGL build of `Scenes/StationGameLocal.unity` under headless Chrome
// (the same harness `smoke-zoo-playable.mjs` uses) and drives the station through
// the **shared shell port** `window.__metroStationBridge` â€” the same path the React
// UI uses â€” then reads the committed snapshot. It never installs geometry, mutates
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
//        [--locale both|zh|en] [--timeout-ms 90000] [--only case[,case]] [--load-probe]

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const loadProbe = process.argv.includes('--load-probe')
// `--only` runs a subset (prefix match on the case name) so one case can be iterated
// without paying for the whole pass; every case still cold-opens the demo URL itself.
const onlyArg = arg('--only', '')
const onlyCases = onlyArg ? onlyArg.split(',').map(name => name.trim()).filter(Boolean) : null
const wanted = (name) => !onlyCases || onlyCases.some((pattern) => name.startsWith(pattern))
const shortcutFixtureOnly = onlyCases?.length > 0 &&
  onlyCases.every(name => name === 'shortcut-save' || name === 'shortcut-move')
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
// The brush cases edit whichever demo the run opened, so one pack can prove the same
// gestures on Zoo, Tanwei and Tianhe (`--demo <id>`); `ensureDemo` is a no-op when that
// demo is already committed. `station-editing` stays pinned to Zoo: its frozen-ray
// sub-step reads a hard-coded pixel of that station.
const activeDemo = demos[0]
for (const id of demos) if (!byId.has(id)) throw new Error('Unknown demo: ' + id + ' (known: ' + [...byId.keys()].join(', ') + ')')
const locales = localeArg === 'both' ? ['zh', 'en'] : [localeArg === 'zh' ? 'zh' : 'en']
const demoUrl = (id, locale) => base + (locale === 'en' ? '/game/en/' : '/game/') + id +
  (loadProbe ? '?metroLoadProbe=1' : '')

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
let loadFailure = null
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
    if (loadFailure) throw new Error(loadFailure)
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
 * same public seam the React shell uses. This is an observation point, not a shortcut 
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
  // exported fixture by hash and by normalized counts (parsed in-page so 16+ MiB
  // stations like Tianhe Park do not transfer multi-MiB strings over CDP).
  const docInfo = await page.evaluate(`(() => {
    const text = window.__metroStationBridge.getSnapshot().document
    if (!text) return { present: false, length: 0 }
    if (text.length < 1000) return { present: true, length: text.length }
    const parsed = JSON.parse(text)
    return {
      present: true,
      length: text.length,
      cells: parsed.static.cells.length,
      modules: parsed.static.modules.length,
      lines: parsed.static.lines.length,
    }
  })()`)
  if (!docInfo?.present) problems.push('no committed document text')
  else if (docInfo.length < 1000) problems.push('committed document is suspiciously short')
  else {
    if (docInfo.cells !== expected.cells) problems.push('cells ' + docInfo.cells + ' != ' + expected.cells)
    if (docInfo.modules !== expected.modules) problems.push('modules ' + docInfo.modules + ' != ' + expected.modules)
    if (docInfo.lines !== expected.lines) problems.push('lines ' + docInfo.lines + ' != ' + expected.lines)
  }
  return { problems, snapshot }
}

async function runDemoCase(id, locale) {
  const record = caseStart(`demo-${id}-${locale}`)
  const url = demoUrl(id, locale)
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
  const skyWhenHidden = await page.evaluate('(() => ((window.__metroStationBridge.getSnapshot().state ?? {}).render ?? {}).sky ?? null)()')
  if (!skyWhenHidden || skyWhenHidden.shown !== true || skyWhenHidden.clearFlags !== 'Skybox') {
    problems.push('hideUi=true did not activate the skybox (' + JSON.stringify(skyWhenHidden) + ')')
  }
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
  const skyWhenShown = await page.evaluate('(() => ((window.__metroStationBridge.getSnapshot().state ?? {}).render ?? {}).sky ?? null)()')
  if (!skyWhenShown || skyWhenShown.shown !== false || skyWhenShown.clearFlags !== 'SolidColor') {
    problems.push('hideUi=false did not restore solid void clear (' + JSON.stringify(skyWhenShown) + ')')
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
  // The home basis is the **committed** station's framing: wait for the startup commit (it
  // frames the camera once) before reading it, or a late commit moves the baseline the
  // later `camera.home` is compared against.
  try {
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot()
      const c = s.state.camera
      return s.revision >= 0 && !!(c && c.back)
    })()`, 'committed camera', Math.min(timeoutMs, 60000))
  } catch { problems.push('no committed station before the camera case') }
  await sleep(600)
  const start = await page.evaluate(cameraExpr)
  if (!start || !start.back) { problems.push('no camera snapshot published'); return finishCase(record, false, { problems }) }
  // A face snap must change the rendered basis and report the new one. The camera basis
  // is published in document axes, so a top view looks down the document elevation axis:
  // back = (0,0,1) (world forward is -up, mapped through world→document).
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
 * Plan 13 §2  the frame the finish, lighting and glass work is measured on. One
 * canvas-only capture at the home view (no React chrome), with the camera basis and the
 * canvas rect recorded so the comparison against the TypeScript capture names the same
 * region. The numbers themselves come from `tools/unity-parity/compare-captures.mjs`;
 * this case only guarantees the frame exists and is the station's, not a loading screen.
 */
/**
 * Plan 13 §5  the two overlay toggles through the real command path. Turning each on must
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
  // 20 §5: the zone layer must print real **glyphs**, not only coloured quads.
  const overlayState = () => page.evaluate('(() => ((window.__metroStationBridge.getSnapshot().state ?? {}).overlays ?? null))()')
  const zoneLabels = await overlayState()
  if (!zoneLabels) problems.push('no state.overlays payload was published')
  else {
    if (!(zoneLabels.labelCount >= 1)) problems.push('the zone layer printed no label at level ' + zoneLevel)
    if (!(zoneLabels.labelPlates >= zoneLabels.labelCount)) problems.push('only ' + zoneLabels.labelPlates + ' of ' + zoneLabels.labelCount + ' labels have a painted plate')
    if (zoneLabels.painterNote) problems.push('the label painter failed: ' + zoneLabels.painterNote)
    if (!['zh-CN', 'en'].includes(zoneLabels.locale)) problems.push('the label locale is ' + zoneLabels.locale)
    for (const label of zoneLabels.labels ?? []) {
      if (!(label.cells >= 6)) problems.push('label ' + label.text + ' covers only ' + label.cells + ' cells')
      if (!label.text) problems.push('a zone label has no text')
      if (!(label.ink > 0)) problems.push('label ' + label.text + ' painted no glyph pixels')
      if (!label.plate) problems.push('label ' + label.text + ' has no plate')
    }
    // A language switch reprints the labels in the other language, still with glyph ink.
    const before = (zoneLabels.labels ?? []).map((label) => label.text).join('|')
    await page.evaluate(`window.__metroStationBridge.send('exit.locale', { locale: 'en' })`)
    await sleep(1000)
    const english = await overlayState()
    if (!english || english.locale !== 'en') problems.push('the zone labels did not switch to English')
    else {
      const after = (english.labels ?? []).map((label) => label.text).join('|')
      if (after === before) problems.push('the zone labels kept their Chinese text after a language switch')
      if (!(english.labels ?? []).every((label) => label.ink > 0)) problems.push('an English label painted no glyph pixels')
    }
    await page.evaluate(`window.__metroStationBridge.send('exit.locale', { locale: 'zh-CN' })`)
    await sleep(600)
  }
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

async function runDisplayCase() {
  const record = caseStart('station-displays')
  const problems = []
  const send = (type, payload) => page.evaluate(`window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const displays = () => page.evaluate('(() => ((window.__metroStationBridge.getSnapshot().state ?? {}).displays ?? null))()')
  const view = () => page.evaluate('(() => ((window.__metroStationBridge.getSnapshot().state ?? {}).view ?? null))()')
  await waitForSnapshot('s.state.displays != null', 'display contributor installed')
  // A platform storey, so the televisions hang where their boards are about the service.
  await send('view.set', { key: 'level', value: -5 })
  await send('view.set', { key: 'cutaway', value: false })
  await sleep(1200)
  const info = await displays()
  if (!info || info.bound !== true) problems.push('no display world is bound')
  if (!info || (info.faces ?? 0) < 4) problems.push('only ' + (info?.faces ?? 0) + ' television faces bound')
  if (!info || (info.pairFaces ?? 0) < 1) problems.push('no back-to-back pair bound both of its faces')
  if (!info || (info.posters ?? 0) < 2) problems.push('the televisions print only ' + (info?.posters ?? 0) + ' distinct posters')
  const list = info?.list ?? []
  if (list.length === 0) problems.push('no face was sampled for the report')
  const ids = new Set()
  const statuses = new Set()
  for (const face of list) {
    for (const key of ['module', 'track', 'line', 'date', 'poster', 'board']) {
      if (!face[key]) problems.push('face ' + face.module + '/' + face.face + ' has no ' + key)
    }
    if (!Array.isArray(face.status) || face.status.length !== 3) problems.push('face ' + face.module + ' did not print three cards')
    else for (const value of face.status) statuses.add(value)
    if (!face.upright) problems.push('face ' + face.module + ' is not upright: ' + face.basis)
    ids.add(face.module + '#' + face.face)
  }
  if (ids.size !== list.length) problems.push('a face was published twice')
  if (statuses.size < 2) problems.push('every card printed the same status')
  if (!(await view())) problems.push('the view state is missing')
  // The board follows the published minute and the shell's language.
  const before = list[0]?.board ?? ''
  await send('exit.locale', { locale: 'en' })
  await sleep(1200)
  const english = await displays()
  if (!english || english.locale !== 'en') problems.push('the display locale did not switch')
  else if (english.list?.[0]?.board === before) problems.push('the board kept its pixels across a locale switch')
  const englishBoard = english?.list?.[0]?.board ?? ''
  if (englishBoard && !englishBoard.includes('|en|')) problems.push('the English board key does not record the locale')
  await send('exit.locale', { locale: 'zh-CN' })
  await sleep(800)
  const restored = await displays()
  if (!restored || restored.list?.[0]?.board === englishBoard) problems.push('the board did not reprint in Chinese')
  const shot = await screenshot('station-game-displays')
  return finishCase(record, problems.length === 0, { problems, info, english: english?.list?.[0] ?? null, images: shot })
}

async function runSectionHandleCase() {
  const record = caseStart('section-handle')
  const problems = []
  const send = (type, payload) => page.evaluate(`window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const view = () => page.evaluate('(() => ((window.__metroStationBridge.getSnapshot().state ?? {}).view ?? null))()')
  const handle = async () => (await view())?.sectionHandle ?? null
  // The case may run alone against a URL that has not committed yet, so wait for the station
  // itself and not only for the view rig: an uncommitted view has no section bounds to frame.
  await waitForSnapshot('s.revision >= 0', 'committed station', 30000)
  await waitForSnapshot('s.state.view != null', 'view rig installed', 30000)
  const settle = async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = await handle()
      if (current && current.arrowVisible === true && current.norm && Number(current.span) > 0) return current
      if (attempt === 3) await send('view.set', { key: 'sectionRotate', value: 'next' })
      await sleep(400)
    }
    return await handle()
  }
  await send('view.set', { key: 'level', value: -5 })
  await send('view.set', { key: 'cutaway', value: true })
  await send('view.set', { key: 'sectionSurface', value: true })
  await sleep(1200)
  const state = await settle()
  if (!state || !state.norm) {
    problems.push('the section handle published no control points')
    return finishCase(record, false, { problems })
  }
  if (!(state.span > 0)) problems.push('the cut published no screen axis (span ' + state.span + ')')
  if (state.arrowVisible !== true) problems.push('the arrow is not drawn while the cut and sheet are visible')
  // The shell can hold more than one canvas; the one that covers the viewport is the game's, and
  // a smaller UI canvas would give every grip the wrong origin.
  const rect = await page.evaluate(`(() => {
    const list = Array.from(document.querySelectorAll('canvas')).map((c) => {
      const r = c.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height, area: r.width * r.height }
    }).sort((a, b) => b.area - a.area)
    return list[0] ?? null
  })()`)
  if (!rect) {
    problems.push('no canvas')
    return finishCase(record, false, { problems })
  }
  const point = (norm) => ({ x: rect.x + norm[0] * rect.w, y: rect.y + norm[1] * rect.h })
  const move = async (at) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
    await sleep(220)
    return await handle()
  }
  // Find a point the section actually reports as hovered: the published control points are the
  // authoritative guess, and a small ring around them absorbs the pixel-space conversion.
  const ring = [[0, 0], [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01], [0.02, 0.02], [-0.02, -0.02]]
  const findHover = async (norm) => {
    for (const [dx, dy] of ring) {
      const hover = await move({ x: rect.x + (norm[0] + dx) * rect.w, y: rect.y + (norm[1] + dy) * rect.h })
      if (hover && hover.hovered === true) {
        return { at: { x: rect.x + (norm[0] + dx) * rect.w, y: rect.y + (norm[1] + dy) * rect.h }, handle: hover }
      }
    }
    return null
  }
  const sheet = await findHover(state.norm.sheet)
  if (!sheet) {
    problems.push('the pointer never reached the section sheet (norm ' + JSON.stringify(state.norm) + ')')
    return finishCase(record, false, { problems, state, rect })
  }
  const axis = state.axis ? { x: state.axis[0], y: -state.axis[1] } : { x: 0, y: -1 }
  const length = Math.hypot(axis.x, axis.y) || 1
  const along = { x: axis.x / length, y: axis.y / length }
  const grip = async (from, dx, dy) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 5; step++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + dx * step / 5, y: from.y + dy * step / 5, button: 'left', buttons: 1 })
      await sleep(80)
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + dx, y: from.y + dy, button: 'left', clickCount: 1 })
    await sleep(600)
  }
  const pixels = Math.max(24, Math.min(160, Number(state.span ?? 0) * 1))
  const startOffset = Number((await view())?.sectionOffset ?? 0)
  // The sheet is the reliable grip target; the arrow's own grip is checked when the hover found it.
  const before = { ...startOffset }
  await grip(sheet.at, along.x * pixels, along.y * pixels)
  const moved = await handle()
  const offsetAfterArrow = Number((await view())?.sectionOffset ?? 0)
  if (Math.abs(offsetAfterArrow - before) < 0.4) problems.push('a sheet drag did not slide the cut (' + before + ' -> ' + offsetAfterArrow + ')')
  if (offsetAfterArrow * 2 - Math.round(offsetAfterArrow * 2) > 1e-4) problems.push('the offset left the half-metre snap: ' + offsetAfterArrow)
  // Across the axis: nothing moves.
  const acrossFrom = await handle()
  await grip(sheet.at, -along.y * pixels, along.x * pixels)
  const across = Number((await view())?.sectionOffset ?? 0)
  if (Math.abs(across - offsetAfterArrow) > 1e-4) problems.push('a drag across the axis moved the cut (' + offsetAfterArrow + ' -> ' + across + ')')
  // The cut has moved, so the arrow's own point is re-probed against the **current** handle: the
  // press has to land on the drawn mark, not where it was before the sheet drag.
  const arrow = await findHover((await handle()).norm.shaft)
  let arrowPart = ''
  if (arrow) {
    const beforeArrow = Number((await view())?.sectionOffset ?? 0)
    await grip(arrow.at, along.x * pixels, along.y * pixels)
    const arrowState = await handle()
    arrowPart = arrowState?.part ?? ''
    // The offset moving is the primary evidence; the part names which control took the grip when
    // the runtime reports it (an idle read reports the last gesture's own part).
    if (Math.abs(Number((await view())?.sectionOffset ?? 0) - beforeArrow) < 0.4) problems.push('the arrow grip did not slide the cut')
    if (arrowPart && !arrowPart.startsWith('arrow')) problems.push('the arrow grip was taken by ' + arrowPart)
  } else {
    problems.push('the arrow never reported hover at its published control point')
  }
  // 隐藏剖切面 puts the arrow away and gives the pointer back.
  await send('view.set', { key: 'sectionSurface', value: false })
  await sleep(700)
  const hidden = await handle()
  if (hidden && hidden.arrowVisible !== false) problems.push('the arrow stayed drawn with the sheet hidden')
  const offsetHidden = Number((await view())?.sectionOffset ?? 0)
  await grip(sheet.at, along.x * pixels, along.y * pixels)
  if (Math.abs(Number((await view())?.sectionOffset ?? 0) - offsetHidden) > 1e-4) problems.push('a grip moved the cut while the sheet was hidden')
  await send('view.set', { key: 'sectionSurface', value: true })
  await sleep(500)
  const shot = await screenshot('station-game-section-handle')
  await send('view.set', { key: 'sectionOffset', value: 0 })
  await send('view.set', { key: 'cutaway', value: false })
  await sleep(250)
  return finishCase(record, problems.length === 0, {
    problems, span: state.span, startOffset, offsetAfterArrow, across, part: arrowPart,
    norm: state.norm, rect, images: shot,
  })
}

async function runExplodedViewCase() {
  const record = caseStart('exploded-view')
  const problems = []
  const oracle = JSON.parse(readFileSync(join(root, 'unity/Assets/StationDesigner/Tests/EditMode/station-exploded-view-oracle.json'), 'utf8'))
  const oracleByDemo = new Map((oracle.demos ?? []).map(row => [row.id, row]))
  const traceReport = {
    generatedBy: 'tools/unity-web/verify-station-game.mjs#exploded-view',
    pack: packed,
    runs: {},
  }
  const vecDist = (a, b) => Array.isArray(a) && Array.isArray(b)
    ? Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0))
    : 999
  const sameDir = (a, b) => Array.isArray(a) && Array.isArray(b) &&
    Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > 0.998

  for (let di = 0; di < demos.length; di++) {
    const id = demos[di]
    const expectedOracle = oracleByDemo.get(id)
    for (let li = 0; li < locales.length; li++) {
      const locale = locales[li]
      const tag = `${id}-${locale}`
      const targetPathPrefix = locale === 'en' ? '/game/en/' : '/game/'
      const current = await currentSnapshot().catch(() => null)
      const onDesiredLocale = current && (locale === 'en'
        ? current.path.startsWith('/game/en')
        : !current.path.startsWith('/game/en'))
      if (!(di === 0 && li === 0 && current && current.sourceId === id && onDesiredLocale)) {
        await page.send('Page.navigate', { url: base + targetPathPrefix + id })
        await poll('window.__metroStationBridge !== undefined', `${tag} shell mount`)
      }
      const { problems: commitProblems } = await expectDemoCommit(id, locale)
      for (const p of commitProblems) problems.push(`${tag}: ${p}`)

      await poll(`(() => {
        const loading = document.getElementById('game-loading')
        if (loading && !loading.hidden && getComputedStyle(loading).display !== 'none' && !loading.classList.contains('is-hidden')) return false
        const logo = document.getElementById('unity-logo')
        if (logo && logo.offsetParent !== null && getComputedStyle(logo).display !== 'none') return false
        const s = window.__metroStationBridge.getSnapshot()
        return Boolean(s.revision >= 0 && s.state.camera && s.state.camera.back && s.state.view && s.state.edit)
      })()`, `${tag} editor settled`, Math.min(timeoutMs, 60000))

      const stageCenter = await page.evaluate(`(() => {
        const c = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
        if (!c) return null
        const r = c.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), pixels: [c.width, c.height], parentClass: c.parentElement?.className ?? '' }
      })()`)
      if (!stageCenter) {
        problems.push(`${tag}: missing #unity-canvas before open`)
        continue
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: stageCenter.x, y: stageCenter.y, button: 'left', buttons: 1, clickCount: 1 })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: stageCenter.x, y: stageCenter.y, button: 'left', buttons: 0, clickCount: 1 })
      await page.evaluate(`window.__metroStationBridge.request('camera.home', {})`)
      await page.evaluate(`window.__metroStationBridge.request('sim.play', { playing: false })`)
      await page.evaluate(`new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsub(); reject(new Error('timed out waiting for baseline state snapshot')) }, 30000)
        const unsub = window.__metroStationBridge.subscribe(() => {
          clearTimeout(timer)
          unsub()
          resolve(true)
        })
      })`)

      const editorBefore = await page.evaluate(`(() => {
        const s = window.__metroStationBridge.getSnapshot()
        const c = document.querySelector('#unity-canvas')
        window.__metroOriginalUnityCanvas = c
        return {
          revision: s.revision,
          sourceHash: s.sourceHash,
          documentBytes: s.document ? s.document.length : 0,
          hasExplodedCapability: Boolean(s.capabilities && s.capabilities.exploded === true),
          explodedDrag: (s.state.view?.capabilities?.explodedDrag ?? s.state.capabilities?.explodedDrag) === true,
          level: s.state.view?.level ?? null,
          tool: s.state.tool ?? null,
          undoDepth: s.state.edit?.undoDepth ?? 0,
          redoDepth: s.state.edit?.redoDepth ?? 0,
          selectionKey: s.state.edit?.selectionKey ?? s.state.edit?.selection?.key ?? '',
          camera: s.state.camera,
          pixels: c ? [c.width, c.height] : [0, 0],
        }
      })()`)
      if (!editorBefore.hasExplodedCapability) problems.push(`${tag}: host capabilities missing 'exploded'`)
      if (!editorBefore.explodedDrag) problems.push(`${tag}: state.view.capabilities.explodedDrag is not true`)

      // Ensure the View folder in the inspector rail is open, then click the real Exploded view tile
      await page.evaluate(`window.dispatchEvent(new CustomEvent('metro:tutorial-folders', { detail: { open: ['view'], close: [] } }))`)
      await sleep(100)
      const wantedLabel = locale === 'en' ? 'Exploded view' : '爆炸视图'
      const clickedOpen = await page.evaluate(`(() => {
        const tiles = [...document.querySelectorAll('.viewGrid .bpBlock, .panel .bpBlock')]
        const match = tiles.find(btn => {
          const label = (btn.querySelector('.bpBlockLabel')?.textContent ?? btn.textContent ?? '').trim()
          return label.toLowerCase() === ${JSON.stringify(wantedLabel.toLowerCase())}
        })
        if (!match) return 'missing:' + tiles.map(b => (b.querySelector('.bpBlockLabel')?.textContent ?? b.textContent ?? '').trim()).join('|')
        if (match.disabled) return 'disabled'
        match.click()
        return 'clicked'
      })()`)
      if (clickedOpen !== 'clicked') {
        problems.push(`${tag}: could not click '${wantedLabel}' (${clickedOpen})`)
        continue
      }

      await poll(`(() => {
        const dlg = document.querySelector('dialog.explodedViewer')
        const exp = window.__metroStationBridge.getSnapshot().state.exploded
        return Boolean(dlg && dlg.open && dlg.dataset.ready === 'true' && dlg.dataset.equipped === 'true' &&
          dlg.dataset.unityHost === 'true' && exp && exp.phase === 'ready' && exp.equipped === true)
      })()`, `${tag} exploded ready & equipped`, Math.min(timeoutMs, 60000))
      await sleep(500)

      const openedCheck = await page.evaluate(`(() => {
        const dlg = document.querySelector('dialog.explodedViewer')
        const c = document.querySelector('#unity-canvas')
        const r = c ? c.getBoundingClientRect() : null
        const dpr = window.devicePixelRatio || 1
        const exp = window.__metroStationBridge.getSnapshot().state.exploded
        return {
          inDialog: Boolean(dlg && c && dlg.contains(c)),
          sameNode: Boolean(c && c === window.__metroOriginalUnityCanvas),
          pixels: c ? [c.width, c.height] : [0, 0],
          expectedModalPixels: r ? [Math.round(r.width * dpr), Math.round(r.height * dpr)] : [0, 0],
          toolbarTitle: dlg?.querySelector('.explodedToolbar strong')?.textContent?.trim() ?? '',
          footerButtons: [...(dlg?.querySelectorAll('.explodedLevels button') ?? [])].map(b => b.textContent.trim()),
          exploded: exp,
        }
      })()`)
      if (!openedCheck.inDialog) problems.push(`${tag}: #unity-canvas was not reparented into dialog.explodedViewer`)
      if (!openedCheck.sameNode) problems.push(`${tag}: #unity-canvas DOM node was recreated instead of reparented`)
      if (Math.abs(openedCheck.pixels[0] - openedCheck.expectedModalPixels[0]) > 4 ||
          Math.abs(openedCheck.pixels[1] - openedCheck.expectedModalPixels[1]) > 4) {
        problems.push(`${tag}: #unity-canvas modal backing size ${JSON.stringify(openedCheck.pixels)} did not match modal box ${JSON.stringify(openedCheck.expectedModalPixels)}`)
      }
      if (openedCheck.toolbarTitle !== wantedLabel) {
        problems.push(`${tag}: toolbar title '${openedCheck.toolbarTitle}' != '${wantedLabel}'`)
      }

      const expInitial = openedCheck.exploded
      if (expectedOracle) {
        const gotLevels = (expInitial.rows ?? []).map(r => r.elevation)
        const gotPacked = (expInitial.rows ?? []).map(r => r.packedOffset)
        if (JSON.stringify(gotLevels) !== JSON.stringify(expectedOracle.levels)) {
          problems.push(`${tag}: levels ${JSON.stringify(gotLevels)} != ${JSON.stringify(expectedOracle.levels)}`)
        }
        if (JSON.stringify(gotPacked) !== JSON.stringify(expectedOracle.packedOffsets)) {
          problems.push(`${tag}: packedOffsets ${JSON.stringify(gotPacked)} != ${JSON.stringify(expectedOracle.packedOffsets)}`)
        }
        const expectedGuides = expectedOracle.guideCounts?.total ?? expectedOracle.guides?.length ?? 0
        if (expInitial.activeGuides !== expectedGuides) {
          problems.push(`${tag}: activeGuides ${expInitial.activeGuides} != ${expectedGuides}`)
        }
      }
      await screenshot(`station-game-exploded-${tag}-initial`)

      // 1. WASD held pan, middle-button orbit, right-button pan, and wheel zoom on the standalone camera
      const canvasBox = await page.evaluate(`(() => {
        const r = document.querySelector('dialog.explodedViewer canvas').getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height, cx: Math.round(r.left + r.width * 0.5), cy: Math.round(r.top + r.height * 0.52) }
      })()`)
      const camStart = expInitial.camera
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 })
      await sleep(550)
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 })
      await sleep(300)
      const camAfterW = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded?.camera')
      if (!(vecDist(camAfterW?.target, camStart?.target) > 0.5)) {
        problems.push(`${tag}: holding W did not pan exploded viewer camera`)
      }
      if (!sameDir(camAfterW?.back, camStart?.back)) {
        problems.push(`${tag}: holding W altered exploded viewer camera angle`)
      }

      // Middle-drag orbit
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvasBox.cx, y: canvasBox.cy, button: 'middle', buttons: 4, clickCount: 1 })
      for (let s = 1; s <= 4; s++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvasBox.cx + s * 16, y: canvasBox.cy - s * 6, button: 'middle', buttons: 4 })
        await sleep(35)
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvasBox.cx + 64, y: canvasBox.cy - 24, button: 'middle', buttons: 0, clickCount: 1 })
      await sleep(300)
      const camAfterOrbit = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded?.camera')
      if (!(vecDist(camAfterOrbit?.back, camAfterW?.back) > 0.03)) {
        problems.push(`${tag}: middle-button drag did not orbit exploded camera`)
      }

      // Right-drag pan
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvasBox.cx, y: canvasBox.cy, button: 'right', buttons: 2, clickCount: 1 })
      for (let s = 1; s <= 4; s++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvasBox.cx - s * 18, y: canvasBox.cy + s * 10, button: 'right', buttons: 2 })
        await sleep(35)
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvasBox.cx - 72, y: canvasBox.cy + 40, button: 'right', buttons: 0, clickCount: 1 })
      await sleep(300)
      const camAfterPan = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded?.camera')
      if (!(vecDist(camAfterPan?.target, camAfterOrbit?.target) > 0.4)) {
        problems.push(`${tag}: right-button drag did not pan exploded camera`)
      }

      // Wheel zoom
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvasBox.cx, y: canvasBox.cy, deltaX: 0, deltaY: -240 })
      await sleep(300)
      const camAfterZoom = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded?.camera')
      if (!camAfterZoom || !(camAfterZoom.orthoSize < camAfterPan.orthoSize - 0.1)) {
        problems.push(`${tag}: wheel zoom did not zoom exploded camera (${camAfterPan?.orthoSize} -> ${camAfterZoom?.orthoSize})`)
      }
      // Restore zoom so all packed trays fit comfortably for picking & dragging
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvasBox.cx, y: canvasBox.cy, deltaX: 0, deltaY: 240 })
      await sleep(300)

      // 2. Real left-press tray pick & drag (Plan 19 §5.6: drag -15 m on Zoo, -5 m on Tanwei)
      const dragElev = id === 'zoo' ? -15 : (expInitial.rows[1]?.elevation ?? expInitial.rows[0]?.elevation)
      const pickAim = await page.evaluate(`(async () => {
        const snap = window.__metroStationBridge.getSnapshot()
        const exp = snap.state.exploded
        const cam = exp?.camera
        const docText = await window.__metroStationBridge.readCommittedDocument()
        const doc = docText ? JSON.parse(docText) : null
        const canvas = document.querySelector('dialog.explodedViewer canvas')
        if (!exp || !cam || !doc || !canvas) return null
        const r = canvas.getBoundingClientRect()
        const aspect = r.width / Math.max(1, r.height)
        const halfH = cam.orthoSize
        const halfW = halfH * aspect
        const targetRow = exp.rows.find(row => row.elevation === ${JSON.stringify(dragElev)})
        if (!targetRow) return null
        const cells = (doc.static?.cells ?? []).filter(c =>
          c.z === ${JSON.stringify(dragElev)} &&
          c.fill === 'solid' &&
          !(Array.isArray(c.tags) && c.tags.includes('auto-wall')) &&
          (c.zone === 'paid' || c.zone === 'unpaid' || c.zone === 'platform' || c.room))
        const packDir = ${JSON.stringify(expectedOracle?.direction ?? [1, 1])}
        // Compute higher trays' shifted AABBs to avoid clicking through an upper floor
        const higherBoxes = exp.rows.filter(row => row.elevation > ${JSON.stringify(dragElev)}).map(row => {
          const hc = (doc.static?.cells ?? []).filter(c => c.z >= row.elevation && c.z < row.elevation + 5 && c.fill === 'solid')
          if (!hc.length) return null
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
          for (const c of hc) {
            if (c.x < minX) minX = c.x; if (c.x + 1 > maxX) maxX = c.x + 1
            if (c.y < minY) minY = c.y; if (c.y + 1 > maxY) maxY = c.y + 1
          }
          const ox = packDir[0] * row.packedOffset
          const oy = packDir[1] * row.packedOffset
          return {
            minX: minX + ox - 1, maxX: maxX + ox + 1,
            minY: minY + oy - 1, maxY: maxY + oy + 1,
            minZ: row.elevation, maxZ: row.elevation + 5,
          }
        }).filter(Boolean)

        const project = (pt) => {
          const dx = pt[0] - cam.target[0], dy = pt[1] - cam.target[1], dz = pt[2] - cam.target[2]
          const vx = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2]
          const vy = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2]
          const nx = 0.5 + vx / (2 * halfW)
          const ny = 0.5 - vy / (2 * halfH)
          return { nx, ny, x: Math.round(r.left + nx * r.width), y: Math.round(r.top + ny * r.height) }
        }
        const occluded = (pt) => {
          const bx = cam.back[0], by = cam.back[1], bz = cam.back[2]
          for (const box of higherBoxes) {
            let tmin = 0, tmax = 1e6
            const axes = [
              [pt[0], bx, box.minX, box.maxX],
              [pt[1], by, box.minY, box.maxY],
              [pt[2], bz, box.minZ, box.maxZ],
            ]
            let hit = true
            for (const [p0, d, lo, hi] of axes) {
              if (Math.abs(d) < 1e-6) { if (p0 < lo || p0 > hi) { hit = false; break } }
              else {
                let t1 = (lo - p0) / d, t2 = (hi - p0) / d
                if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
                tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
                if (tmin > tmax) { hit = false; break }
              }
            }
            if (hit) return true
          }
          return false
        }
        let sumX = 0, sumY = 0
        for (const c of cells) { sumX += c.x + 0.5; sumY += c.y + 0.5 }
        const cx = cells.length ? sumX / cells.length : 0
        const cy = cells.length ? sumY / cells.length : 0
        const sorted = [...cells].sort((a, b) =>
          Math.hypot(a.x + 0.5 - cx, a.y + 0.5 - cy) - Math.hypot(b.x + 0.5 - cx, b.y + 0.5 - cy))
        const tox = packDir[0] * targetRow.packedOffset
        const toy = packDir[1] * targetRow.packedOffset
        for (let i = 0; i < sorted.length; i += Math.max(1, Math.floor(sorted.length / 80))) {
          const c = sorted[i]
          const pt = [c.x + 0.5 + tox, c.y + 0.5 + toy, ${JSON.stringify(dragElev)} + 1.0]
          const pr = project(pt)
          if (pr.nx < 0.14 || pr.nx > 0.78 || pr.ny < 0.16 || pr.ny > 0.82) continue
          if (!occluded(pt)) return pr
        }
        for (const c of sorted) {
          const pt = [c.x + 0.5 + tox, c.y + 0.5 + toy, ${JSON.stringify(dragElev)} + 1.0]
          const pr = project(pt)
          if (pr.nx >= 0.12 && pr.nx <= 0.85 && pr.ny >= 0.15 && pr.ny <= 0.85) return pr
        }
        return null
      })()`)

      if (!pickAim) {
        problems.push(`${tag}: could not project an unobstructed floor point for ${dragElev} m`)
      } else {
        const beforeDrag = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded')
        // First click selects the tray (1 pick) and mounts .explodedFloorPanel
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pickAim.x, y: pickAim.y, button: 'left', buttons: 1, clickCount: 1 })
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pickAim.x, y: pickAim.y, button: 'left', buttons: 0, clickCount: 1 })
        await sleep(300)
        const afterSelect = await page.evaluate(`(() => {
          const exp = window.__metroStationBridge.getSnapshot().state.exploded
          const panel = document.querySelector('.explodedFloorPanel')
          const r = panel ? panel.getBoundingClientRect() : null
          return { exp, panelRect: r ? { left: r.left, top: r.top } : null }
        })()`)
        if (afterSelect.exp.pickCount !== beforeDrag.pickCount + 1) {
          problems.push(`${tag}: single left click executed ${afterSelect.exp.pickCount - beforeDrag.pickCount} picks (expected 1)`)
        }
        if (afterSelect.exp.selectedElevation !== dragElev) {
          problems.push(`${tag}: left click selected ${afterSelect.exp.selectedElevation} m instead of ${dragElev} m`)
        }
        if (!afterSelect.panelRect) {
          problems.push(`${tag}: .explodedFloorPanel did not mount after selecting ${dragElev} m`)
        }

        // Now press and drag the selected tray across the viewport (1 pick on press, 0 picks on move)
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pickAim.x, y: pickAim.y, button: 'left', buttons: 1, clickCount: 1 })
        for (let step = 1; step <= 5; step++) {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: pickAim.x + step * 24,
            y: pickAim.y - step * 12,
            button: 'left',
            buttons: 1,
          })
          await sleep(40)
        }
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pickAim.x + 120, y: pickAim.y - 60, button: 'left', buttons: 0, clickCount: 1 })
        await sleep(350)

        const afterDrag = await page.evaluate(`(() => {
          const exp = window.__metroStationBridge.getSnapshot().state.exploded
          const panel = document.querySelector('.explodedFloorPanel')
          const r = panel ? panel.getBoundingClientRect() : null
          return { exp, panelRect: r ? { left: r.left, top: r.top } : null }
        })()`)
        if (afterDrag.exp.pickCount !== afterSelect.exp.pickCount + 1) {
          problems.push(`${tag}: drag gesture executed ${afterDrag.exp.pickCount - afterSelect.exp.pickCount} picks (expected 1 on pointerDown, 0 on pointerMove)`)
        }
        const draggedRow = afterDrag.exp.rows.find(r => r.elevation === dragElev)
        const manualDelta = draggedRow ? Math.hypot(...draggedRow.manualOffset) : 0
        if (!(manualDelta > 1.0)) {
          problems.push(`${tag}: dragging ${dragElev} m moved manualOffset by only ${manualDelta.toFixed(3)} m`)
        }
        for (const other of afterDrag.exp.rows) {
          if (other.elevation !== dragElev && Math.hypot(...other.manualOffset) > 1e-4) {
            problems.push(`${tag}: dragging ${dragElev} m also moved ${other.elevation} m (${JSON.stringify(other.manualOffset)})`)
          }
        }
        if (afterSelect.panelRect && afterDrag.panelRect) {
          const panelShift = Math.hypot(afterDrag.panelRect.left - afterSelect.panelRect.left, afterDrag.panelRect.top - afterSelect.panelRect.top)
          if (!(panelShift > 4)) {
            problems.push(`${tag}: .explodedFloorPanel did not follow dragged tray (${JSON.stringify(afterSelect.panelRect)} -> ${JSON.stringify(afterDrag.panelRect)})`)
          }
        }
        // Verify dashed guide endpoints tracked the dragged tray in world space
        const worldShift = draggedRow ? [draggedRow.manualOffset[0], draggedRow.manualOffset[2], draggedRow.manualOffset[1]] : [0, 0, 0]
        const beforeGuideMap = new Map((beforeDrag.guides ?? []).map(g => [`${g.id}|${g.lowerElevation}|${g.upperElevation}`, g]))
        for (const g of afterDrag.exp.guides ?? []) {
          const orig = beforeGuideMap.get(`${g.id}|${g.lowerElevation}|${g.upperElevation}`)
          if (!orig) continue
          const expLower = g.lowerElevation === dragElev
            ? [orig.lowerWorld[0] + worldShift[0], orig.lowerWorld[1] + worldShift[1], orig.lowerWorld[2] + worldShift[2]]
            : orig.lowerWorld
          const expUpper = g.upperElevation === dragElev
            ? [orig.upperWorld[0] + worldShift[0], orig.upperWorld[1] + worldShift[1], orig.upperWorld[2] + worldShift[2]]
            : orig.upperWorld
          if (vecDist(g.lowerWorld, expLower) > 0.05 || vecDist(g.upperWorld, expUpper) > 0.05) {
            problems.push(`${tag}: guide ${g.id} detached after dragging ${dragElev} m`)
            break
          }
        }
        await screenshot(`station-game-exploded-${tag}-dragged`)

        // 3. Hide near walls, hide floor (incident guides disappear), restore via footer, and Reset
        await page.evaluate(`document.querySelectorAll('.explodedFloorPanel .selected button')[1]?.click()`)
        await sleep(300)
        const afterWallHide = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded')
        const wallRow = afterWallHide.rows.find(r => r.elevation === dragElev)
        if (!wallRow || wallRow.wallsVisible !== false || wallRow.floorVisible !== true) {
          problems.push(`${tag}: wall button did not hide only near walls on ${dragElev} m`)
        }
        if (afterWallHide.activeGuides !== beforeDrag.activeGuides) {
          problems.push(`${tag}: hiding front walls unexpectedly changed guide count (${beforeDrag.activeGuides} -> ${afterWallHide.activeGuides})`)
        }

        const expectedNonIncidentGuides = (beforeDrag.guides ?? []).filter(
          g => g.lowerElevation !== dragElev && g.upperElevation !== dragElev).length
        await page.evaluate(`document.querySelectorAll('.explodedFloorPanel .selected button')[0]?.click()`)
        await sleep(300)
        const afterFloorHide = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded')
        const hiddenRow = afterFloorHide.rows.find(r => r.elevation === dragElev)
        if (!hiddenRow || hiddenRow.floorVisible !== false) {
          problems.push(`${tag}: eye button did not hide ${dragElev} m`)
        }
        if (afterFloorHide.activeGuides !== expectedNonIncidentGuides) {
          problems.push(`${tag}: hiding ${dragElev} m left ${afterFloorHide.activeGuides} guides, expected ${expectedNonIncidentGuides} non-incident guides`)
        }
        await screenshot(`station-game-exploded-${tag}-hidden`)

        // Deselect via another footer button, reselect the hidden level via footer, restore floor & walls, then click Reset
        await page.evaluate(`(() => {
          const btns = [...document.querySelectorAll('.explodedLevels button')]
          const other = btns.find(b => !b.classList.contains('explodedHiddenLevel'))
          other?.click()
        })()`)
        await sleep(250)
        await page.evaluate(`(() => {
          const hiddenBtn = document.querySelector('.explodedLevels button.explodedHiddenLevel')
          hiddenBtn?.click()
        })()`)
        await sleep(250)
        await page.evaluate(`(() => {
          const panelBtns = document.querySelectorAll('.explodedFloorPanel .selected button')
          panelBtns[0]?.click()
          panelBtns[1]?.click()
        })()`)
        await sleep(300)
        await page.evaluate(`document.querySelector('.explodedReset')?.click()`)
        await sleep(300)
        const afterReset = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded')
        if (afterReset.selectedElevation !== null) {
          problems.push(`${tag}: Reset did not clear selectedElevation (${afterReset.selectedElevation})`)
        }
        if (afterReset.rows.some(r => Math.hypot(...r.manualOffset) > 1e-4)) {
          problems.push(`${tag}: Reset left non-zero manualOffset`)
        }
        if (afterReset.activeGuides !== beforeDrag.activeGuides) {
          problems.push(`${tag}: restoring ${dragElev} m + Reset left ${afterReset.activeGuides} guides (expected ${beforeDrag.activeGuides})`)
        }
      }

      // 4. Simulation play/pause inside viewer + game-hotkey suppression + viewport resize
      const tickBeforePlay = await page.evaluate('window.__metroStationBridge.getSnapshot().state.clock?.tick ?? 0')
      await page.evaluate(`(() => {
        const btn = [...document.querySelectorAll('.explodedToolbar .seg button')].find(b => b.textContent.trim() === '16\\u00d7')
        btn?.click()
      })()`)
      await poll(`(() => {
        const c = window.__metroStationBridge.getSnapshot().state.clock
        return Boolean(c && c.playing === true && c.tick > ${Number(tickBeforePlay)})
      })()`, `${tag} live playback inside exploded view`, Math.min(timeoutMs, 20000)).catch(() => {
        problems.push(`${tag}: simulation did not advance while playing in exploded view`)
      })
      // Blur toolbar button so Space hits the viewer's keyboard handler
      await page.evaluate(`document.activeElement?.blur?.()`)
      await pressKey(' ', 'Space', 32)
      await poll(`window.__metroStationBridge.getSnapshot().state.clock?.playing === false`, `${tag} Space pause in exploded view`, 15000)
        .catch(() => problems.push(`${tag}: Space did not pause playback inside exploded view`))

      await pressKey('b', 'KeyB', 66)
      await sleep(200)
      const toolDuringModal = await page.evaluate('window.__metroStationBridge.getSnapshot().state.tool')
      if (toolDuringModal !== editorBefore.tool) {
        problems.push(`${tag}: build hotkey KeyB leaked through exploded modal (${editorBefore.tool} -> ${toolDuringModal})`)
      }

      // Resize viewport while modal is open and restore
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 780, deviceScaleFactor: 1, mobile: false })
      await sleep(350)
      const expResized = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded')
      if (!expResized || expResized.phase !== 'ready') {
        problems.push(`${tag}: viewport resize disrupted exploded session`)
      }
      await page.send('Emulation.clearDeviceMetricsOverride')
      await sleep(300)

      // Record compact tray/guide trace keyed by demo hash and locale
      const finalOpenExp = await page.evaluate('window.__metroStationBridge.getSnapshot().state.exploded')
      traceReport.runs[`${id}:${editorBefore.sourceHash}:${locale}`] = {
        demo: id,
        locale,
        sourceHash: editorBefore.sourceHash,
        generation: finalOpenExp?.generation ?? 0,
        rows: finalOpenExp?.rows ?? [],
        activeGuides: finalOpenExp?.activeGuides ?? 0,
        sampleGuides: (finalOpenExp?.guides ?? []).slice(0, 6),
      }

      // 5. Close via Escape / Back button, verify editor state restoration, reopen once and close again
      if (locale === 'zh') {
        await pressKey('Escape', 'Escape', 27)
      } else {
        await page.evaluate(`document.querySelector('.explodedBack')?.click()`)
      }
      await poll(`!document.querySelector('dialog.explodedViewer') && window.__metroStationBridge.getSnapshot().state.exploded?.phase === 'closed'`,
        `${tag} exploded close`, 15000)
      await sleep(350)

      // Reopen once and close via the opposite control to exercise repeated opens on the same station
      await page.evaluate(`(() => {
        const tiles = [...document.querySelectorAll('.viewGrid .bpBlock, .panel .bpBlock')]
        const match = tiles.find(btn => {
          const label = (btn.querySelector('.bpBlockLabel')?.textContent ?? btn.textContent ?? '').trim()
          return label.toLowerCase() === ${JSON.stringify(wantedLabel.toLowerCase())}
        })
        match?.click()
      })()`)
      await poll(`(() => {
        const dlg = document.querySelector('dialog.explodedViewer')
        const exp = window.__metroStationBridge.getSnapshot().state.exploded
        return Boolean(dlg && dlg.open && dlg.dataset.ready === 'true' && exp && exp.phase === 'ready' && exp.generation > ${Number(finalOpenExp?.generation ?? 0)})
      })()`, `${tag} second open`, 30000)
      if (locale === 'zh') {
        await page.evaluate(`document.querySelector('.explodedBack')?.click()`)
      } else {
        await pressKey('Escape', 'Escape', 27)
      }
      await poll(`!document.querySelector('dialog.explodedViewer') && window.__metroStationBridge.getSnapshot().state.exploded?.phase === 'closed'`,
        `${tag} second close`, 15000)
      await sleep(350)

      const editorAfter = await page.evaluate(`(() => {
        const s = window.__metroStationBridge.getSnapshot()
        const c = document.querySelector('#unity-canvas')
        return {
          inStage: Boolean(c && c.closest('.unityViewport')),
          sameNode: Boolean(c && c === window.__metroOriginalUnityCanvas),
          pixels: c ? [c.width, c.height] : [0, 0],
          revision: s.revision,
          sourceHash: s.sourceHash,
          documentBytes: s.document ? s.document.length : 0,
          level: s.state.view?.level ?? null,
          tool: s.state.tool ?? null,
          undoDepth: s.state.edit?.undoDepth ?? 0,
          redoDepth: s.state.edit?.redoDepth ?? 0,
          selectionKey: s.state.edit?.selectionKey ?? s.state.edit?.selection?.key ?? '',
          camera: s.state.camera,
        }
      })()`)
      if (!editorAfter.inStage) problems.push(`${tag}: #unity-canvas was not returned to .unityViewport on close`)
      if (!editorAfter.sameNode) problems.push(`${tag}: #unity-canvas DOM node was recreated on return`)
      if (JSON.stringify(editorAfter.pixels) !== JSON.stringify(editorBefore.pixels)) {
        problems.push(`${tag}: #unity-canvas pixels changed across open/close`)
      }
      if (editorAfter.revision !== editorBefore.revision) problems.push(`${tag}: exploded session mutated revision (${editorBefore.revision} -> ${editorAfter.revision})`)
      if (editorAfter.sourceHash !== editorBefore.sourceHash) problems.push(`${tag}: exploded session mutated sourceHash`)
      if (editorAfter.documentBytes !== editorBefore.documentBytes) problems.push(`${tag}: exploded session mutated document length`)
      if (editorAfter.level !== editorBefore.level) problems.push(`${tag}: exploded session mutated active level (${editorBefore.level} -> ${editorAfter.level})`)
      if (editorAfter.tool !== editorBefore.tool) problems.push(`${tag}: exploded session mutated active tool (${editorBefore.tool} -> ${editorAfter.tool})`)
      if (editorAfter.undoDepth !== editorBefore.undoDepth || editorAfter.redoDepth !== editorBefore.redoDepth) {
        problems.push(`${tag}: exploded session mutated undo/redo stack`)
      }
      if (editorAfter.selectionKey !== editorBefore.selectionKey) {
        problems.push(`${tag}: exploded session mutated selection (${JSON.stringify(editorBefore.selectionKey)} -> ${JSON.stringify(editorAfter.selectionKey)})`)
      }
      if (vecDist(editorAfter.camera?.position, editorBefore.camera?.position) > 0.05 ||
          vecDist(editorAfter.camera?.target, editorBefore.camera?.target) > 0.05 ||
          !sameDir(editorAfter.camera?.back, editorBefore.camera?.back)) {
        problems.push(`${tag}: editor camera pose was not restored after exploded close (before=${JSON.stringify(editorBefore.camera)}, after=${JSON.stringify(editorAfter.camera)})`)
      }
    }
  }

  // Verify station replacement while viewer is open closes the viewer cleanly without late callback corruption
  const activeDemoBeforeSwitch = await page.evaluate('window.__metroStationBridge.getSnapshot().sourceId')
  const alternateDemo = activeDemoBeforeSwitch === 'zoo' ? 'tanwei' : 'zoo'
  if (byId.has(alternateDemo)) {
    await page.evaluate(`window.__metroStationBridge.send('exploded.open', { viewportWidth: 1280, viewportHeight: 720 })`)
    await poll(`Boolean(document.querySelector('dialog.explodedViewer') && window.__metroStationBridge.getSnapshot().state.exploded?.phase === 'ready')`,
      'pre-switch exploded open', 30000)
    const revBeforeSwitch = await page.evaluate('window.__metroStationBridge.getSnapshot().revision')
    await page.evaluate(`window.__metroStationBridge.send('station.openDemo', { id: ${JSON.stringify(alternateDemo)} })`)
    await waitForSnapshot(`s.revision > ${revBeforeSwitch} && s.sourceId === ${JSON.stringify(alternateDemo)} && s.state.exploded?.phase === 'closed'`,
      `switch to ${alternateDemo} closes exploded view`, Math.min(timeoutMs, 120000))
    await poll(`!document.querySelector('dialog.explodedViewer')`, 'modal unmounted after station switch', 15000)
    await sleep(400)
    const switchedSnap = await currentSnapshot()
    if (switchedSnap.sourceId !== alternateDemo) problems.push(`station switch from open exploded view landed on ${switchedSnap.sourceId}`)
    if (switchedSnap.state?.exploded?.phase !== 'closed') problems.push(`exploded view stayed '${switchedSnap.state?.exploded?.phase}' across station switch`)
    // Restore original demo if other cases follow in the same verifier session
    if (onlyCases === null && activeDemoBeforeSwitch && activeDemoBeforeSwitch !== alternateDemo) {
      await ensureDemo(activeDemoBeforeSwitch)
    }
  }

  writeFileSync(join(outDir, 'station-exploded-trace.json'), JSON.stringify(traceReport, null, 2) + '\n')
  return finishCase(record, problems.length === 0, {
    problems,
    traceFile: 'station-exploded-trace.json',
    runs: Object.keys(traceReport.runs),
  })
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
  // before 06:30" here  the exact instant stays pinned by the EditMode clock suite.
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
 * directly, which is exactly the path a player cannot use  the React adapter dropped
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
  await page.send('Page.bringToFront')
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
  try {
    // The first input can outlast a cold WebGL frame while the demo finishes rendering.
    const position = JSON.stringify(start.position)
    await poll(`${cameraExpr}.position.some((v, i) => Math.abs(v - ${position}[i]) > 0.5)`, 'W moved the camera', 15000)
  } catch (error) {
    problems.push(error.message)
  } finally {
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 })
  }
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

  await pressKey('Home', 'Home', 36)
  await poll(`(() => {
    const target = ${cameraExpr}?.target
    const previous = ${JSON.stringify(stopped.target)}
    return target?.[2] === ${stopped.level + 1} && Math.hypot(...target.map((v, i) => v - previous[i])) > 0.5
  })()`, 'Home centered the active storey')
  const framed = await page.evaluate(cameraExpr)
  if (!sameBasis(framed.back, stopped.back) || Math.abs(framed.distance - stopped.distance) > 0.1 ||
      framed.ortho !== stopped.ortho || framed.fov !== stopped.fov) {
    problems.push('Home changed the orbit, zoom or lens instead of keeping the current view')
  }

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
  // WebGL player reacts to it  so the page is focused again and the host proven live
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
      start: start.position, moved: moved.position, stopped: stopped.position, framed: framed.position,
      beforeLift: beforeLift.position, lifted: lifted.position, dropped: dropped.position,
    },
    commands: cameraCommands.map(row => ({ type: row.type, payload: row.payload })),
    rejects: after.rejects ?? [],
  })
}

async function openShortcutFixture() {
  const fixture = {
    format: 'metro-save', formatVersion: 1, gameVersion: '0.2.0',
    savedAt: '2026-01-01T00:00:00.000Z', name: 'Shortcut Fixture', city: 'guangzhou',
    seed: 1, levelBase: -5, storeyHeight: 5,
    static: {
      cells: [{ x: 0, y: 0, z: -5, fill: 'solid' }, { x: 0, y: 0, z: 0, fill: 'solid' }],
      modules: [{ id: 'shortcut-light', type: 'light', x: 0, y: 0, z: -1, rot: 0, ceilingAnchored: true,
        cfg: { variant: 'rectangular', position: 0 } }],
      lines: [],
    },
  }
  const before = await currentSnapshot()
  const payload = { document: JSON.stringify(fixture), sourceId: 'shortcut-fixture' }
  await page.evaluate(`window.__metroStationBridge.send('station.open', ${JSON.stringify(payload)})`)
  await waitForSnapshot(`s.revision === ${before.revision + 1} && s.sourceId === 'shortcut-fixture'`, 'shortcut fixture')
}

async function runShortcutSaveCase() {
  const record = caseStart('shortcut-save')
  await openShortcutFixture()
  const downloadDir = mkdtempSync(join(outDir, 'shortcut-save-'))
  await page.send('Page.bringToFront')
  await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
  await page.evaluate('document.activeElement?.blur()')
  const before = await currentSnapshot()
  await page.evaluate(`window.__metroStationBridge.send('edit.delete', { moduleId: 'shortcut-light' })`)
  await waitForSnapshot(`summary.revision === ${before.revision + 1}`, 'committed light deletion')

  await pressKey('s', 'KeyS', 83, 2)
  const deadline = Date.now() + 10000
  let download
  while (!(download = readdirSync(downloadDir).find(name => name.endsWith('.metro.json'))) && Date.now() < deadline) {
    await sleep(100)
  }
  const problems = []
  if (!download) problems.push('Ctrl+S did not download a .metro.json file')
  else {
    const exported = readFileSync(join(downloadDir, download), 'utf8')
    const committed = await page.evaluate('window.__metroStationBridge.readCommittedDocument()')
    if (exported !== committed) problems.push('Ctrl+S did not export the current Unity document')
    if (JSON.parse(exported).static.modules.some(module => module.id === 'shortcut-light')) {
      problems.push('Ctrl+S exported a stale revision containing the deleted light')
    }
  }

  await pressKey('z', 'KeyZ', 90, 2)
  await waitForSnapshot(`summary.revision === ${before.revision + 2}`, 'Ctrl+Z restored the light')
  if (download) {
    // Chrome reserves Ctrl+L. Set the station's actual file input so the test
    // exercises its production import handler after downloading with Ctrl+S.
    const { root: dom } = await page.send('DOM.getDocument')
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: dom.nodeId, selector: '.topbar input[type="file"]' })
    if (!nodeId) problems.push('the Open file input is missing')
    else {
      await page.send('DOM.setFileInputFiles', { files: [join(downloadDir, download)], nodeId })
      await waitForSnapshot(`summary.revision === ${before.revision + 3}`, 'Open reopened the exported station')
      const reopened = JSON.parse(await page.evaluate('window.__metroStationBridge.readCommittedDocument()'))
      if (reopened.static.modules.some(module => module.id === 'shortcut-light')) {
        problems.push('the reopened save did not contain the exported edit')
      }
    }
  }
  if (!onlyCases && !(await ensureDemo(activeDemo))) problems.push('could not restore the original demo')
  return finishCase(record, problems.length === 0, { problems, download })
}

async function runShortcutMoveCase() {
  const record = caseStart('shortcut-move')
  await openShortcutFixture()
  await page.send('Page.bringToFront')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  await page.evaluate('document.activeElement?.blur()')
  const before = await currentSnapshot()
  await page.evaluate(`window.__metroStationBridge.send('edit.move.start', { moduleId: 'shortcut-light' })`)
  await waitForSnapshot(`summary.state.edit?.carried === 'shortcut-light'`, 'lifted light')
  await installCommandRecorder()

  await pressKey('r', 'KeyR', 82)
  await waitForSnapshot('summary.state.edit?.carriedRotation === 1', 'R rotated the carried light')
  await pressKey('Tab', 'Tab', 9)
  await pressKey('Escape', 'Escape', 27)
  await waitForSnapshot('summary.state.edit?.carried === ""', 'Escape put the light back')
  const commands = await recordedCommands()
  const problems = []
  if (!commands.some(row => row.type === 'edit.move.lightPosition')) problems.push('Tab did not cycle the carried light position')
  if ((await currentSnapshot()).revision !== before.revision) problems.push('rotating or cancelling a carried piece changed the station')
  if (!onlyCases && !(await ensureDemo(activeDemo))) problems.push('could not restore the original demo')
  return finishCase(record, problems.length === 0, { problems })
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
  const signOf = `(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
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
  const committedFront = await page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
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
  const restoredFront = await page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    if (!text) return null
    const module = (JSON.parse(text).static?.modules ?? []).find(row => row.id === ${JSON.stringify(sign.id)})
    return module && module.cfg && module.cfg.front ? JSON.stringify(module.cfg.front) : null
  })()`)
  if (restoredFront && restoredFront.includes('PROBE')) problems.push('the restoring edit left the probe text on the board')
  await screenshot('station-game-sign-commit')
  return finishCase(record, problems.length === 0, { problems, revision: await revision() })
}

/**
 * RCA 15 §5 sub-item 2, the end-to-end proof: the PSD printed header band. The geometry
 * half mints one slot per doorway/route span and poses its node toward the platform; this
 * case proves the **transport**  the browser painted `drawPsdHeader` panels, Unity
 * uploaded them, and every slot shows a non-blank texture. It reads `state.psd.headers`
 * (slots/served/textures/minInk and the per-panel facts), then changes Line 5's ink and
 * up terminus, reopens the committed document, and asserts the new request carries the
 * new painted data and a new content key  the "update after changing line information"
 * check the plan calls out. The demo is reopened afterwards so later cases see Zoo.
 */
async function runPsdHeaderCase() {
  const record = caseStart('psd-header')
  const problems = []
  if (!(await ensureDemo('zoo'))) {
    problems.push('could not commit the Zoo document before reading the PSD headers')
    return finishCase(record, false, { problems })
  }
  const headersExpr = '(() => { const s = window.__metroStationBridge.getSnapshot(); return (s.state.psd && s.state.psd.headers) || null })()'
  const reportExpr = 'window.__metroStationBridge.getSnapshot().revision'
  const waitServed = async (what, differentFrom) => {
    try {
      await poll(`(() => {
        const s = window.__metroStationBridge.getSnapshot()
        const h = s.state.psd && s.state.psd.headers
        if (!h || !(h.slots > 0) || h.served !== h.slots || h.pending !== 0) return false
        ${differentFrom ? `const panel = (h.panels ?? []).find(p => p.kind === 'station' && p.direction === 'up')
        if (!panel || panel.key === ${JSON.stringify(differentFrom)}) return false` : ''}
        return true
      })()`, what, Math.min(timeoutMs, 120000))
      return true
    } catch {
      return false
    }
  }
  await waitServed('initial PSD header paint')
  const initial = await page.evaluate(headersExpr)
  mark('psd-header:headers')
  if (!initial) {
    problems.push('no state.psd.headers published for a station with PSD runs')
    return finishCase(record, false, { problems })
  }
  // Zoo's two 101 m Line 5 runs: 18 station panels + 19 route panels each.
  if (initial.slots !== 74) problems.push('expected 74 PSD header slots for Zoo, got ' + initial.slots)
  if (initial.served !== initial.slots) problems.push('PSD headers served ' + initial.served + '/' + initial.slots + ' slots')
  if (initial.pending !== 0) problems.push(initial.pending + ' PSD header panel(s) never painted')
  if (initial.unported !== 0) problems.push(initial.unported + ' PSD header slot(s) could not be printed')
  if (!(initial.minInk > 0.02)) {
    problems.push('the served PSD header texture reports ink ' + initial.minInk + '; a blank band is not artwork')
  }
  const panels = Array.isArray(initial.panels) ? initial.panels : []
  const kinds = new Set(panels.map(panel => panel.kind))
  if (!kinds.has('route') || !kinds.has('station')) problems.push('the band is missing a route or station panel')
  const directions = new Set(panels.map(panel => panel.direction))
  if (!directions.has('up') || !directions.has('down')) problems.push('both Line 5 directions must print a band')
  for (const panel of panels) {
    if (!(panel.bytes > 1024)) problems.push('panel ' + String(panel.key).slice(0, 8) + ' uploaded only ' + panel.bytes + ' bytes')
    if (!(panel.width >= 1024) || panel.height !== 256) problems.push('panel ' + String(panel.key).slice(0, 8) + ' is ' + panel.width + 'x' + panel.height)
    if (!(panel.ink > 0.02)) problems.push('panel ' + String(panel.key).slice(0, 8) + ' painted no ink')
    if (!(panel.slots > 0)) problems.push('panel ' + String(panel.key).slice(0, 8) + ' is bound to no slot')
  }
  const upStation = panels.find(panel => panel.kind === 'station' && panel.direction === 'up')
  if (!upStation) problems.push('no up station panel was painted')
  if (upStation && upStation.destination !== '文冲') problems.push('the up station panel prints ' + upStation.destination + ', expected 文冲')

  // Change the committed line information, then reopen exactly as a saved edit would.
  // The whole document is edited **inside the page**: a 1.6 MB save carried through a
  // CDP argument and back is the one evaluate in this case big enough to hit the
  // harness's command timeout on a loaded page.
  const before = await page.evaluate(reportExpr)
  if (!(await installCommandRecorder())) problems.push('the shared bridge port is not mounted')
  await page.evaluate(`(() => {
    window.__psdHeaderRequests = []
    window.addEventListener('metro:station-state', (event) => {
      try {
        const message = JSON.parse(event.detail)
        if (message && (message.kind === 'psdHeaderRequest' || message.type === 'psd.requestHeader')) window.__psdHeaderRequests.push(message)
      } catch { /* a non-JSON frame is not a header request */ }
    })
    return true
  })()`)
  const edited = await page.evaluate(`(async () => {
    const bridge = window.__metroStationBridge
    const text = await bridge.readCommittedDocument()
    if (!text) return { ok: false, why: 'no committed document' }
    const edited = JSON.parse(text)
    const line = (edited.static?.lines ?? []).find(candidate => candidate.id === '5')
    if (!line) return { ok: false, why: 'no Line 5 record' }
    line.colour = '#ff3300'
    line.upTerminus = 'Probe End'
    line.upTerminusEn = 'Probe End'
    window.__psdEditedDocument = JSON.stringify(edited)
    return { ok: true }
  })()`)
  mark('psd-header:prepare')
  if (edited && edited.ok) {
    await page.evaluate('window.__metroStationBridge.send("station.open", { document: window.__psdEditedDocument })')
    mark('psd-header:send')
  }
  if (!edited || !edited.ok) {
    problems.push('could not edit the committed line information: ' + (edited ? edited.why : 'evaluate failed'))
  } else {
    try {
      await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'reopen after the line edit', Math.min(timeoutMs, 300000))
    } catch {
      problems.push('reopening the edited document did not commit a revision')
    }
    mark('psd-header:opened')
    const repainted = await waitServed('repaint after the line edit', upStation ? upStation.key : '')
    mark('psd-header:repainted')
    if (!repainted) problems.push('the edited line information never produced a new painted band')
    const requests = await page.evaluate('window.__psdHeaderRequests ?? []')
    mark('psd-header:requests')
    const requested = requests.flatMap(row => Array.isArray(row.payload?.panels) ? row.payload.panels : [])
    const upRequested = requested.filter(panel => panel.direction === 'up' && panel.kind === 'station')
    if (requests.length === 0) problems.push('the reopened station minted no psdHeaderRequest')
    for (const request of requests) {
      if ((request.payload?.panels ?? []).length > 32) problems.push('a psdHeaderRequest carried more than 32 panels')
    }
    if (upRequested.length === 0) problems.push('the reopened station requested no up station panel')
    else {
      const panel = upRequested[0]
      if (panel.colour !== '#ff3300') problems.push('the re-minted request kept the old line ink ' + panel.colour)
      if (panel.destination !== 'Probe End') problems.push('the re-minted request kept the old terminus ' + panel.destination)
      if (upStation && panel.key.slice(0, 16) === upStation.key) {
        problems.push('the painted-data key did not move with the edited line information')
      }
    }
    const commands = await recordedCommands()
    mark('psd-header:commands')
    const ready = commands.filter(row => row.type === 'psd.headerReady')
    const chunks = commands.filter(row => row.type === 'psd.headerChunk')
    if (ready.length === 0) problems.push('the browser never answered a psdHeaderRequest')
    if (chunks.length === 0) problems.push('the browser streamed no psd.headerChunk')
    for (const row of ready) {
      const painted = Array.isArray(row.payload?.painted) ? row.payload.painted : []
      if (painted.length === 0) problems.push('a psd.headerReady carried no painted panels')
      for (const panel of painted) {
        if (!(panel.bytes > 1024)) problems.push('the browser reported a ' + panel.bytes + '-byte panel')
        if (!(panel.ink > 0.02)) problems.push('the browser painted panel ink ' + panel.ink)
      }
    }
    // Put Zoo back: the demo open restores the committed document and its source id.
    if (!(await ensureDemo('zoo'))) problems.push('could not restore the Zoo demo after the line edit')
    else await waitServed('restored PSD header paint')
    mark('psd-header:restored')
  }
  await screenshot('station-game-psd-header')
  mark('psd-header:screenshot')
  return finishCase(record, problems.length === 0, {
    problems,
    slots: initial.slots,
    served: initial.served,
    minInk: initial.minInk,
    panels: panels.map(panel => ({ kind: panel.kind, direction: panel.direction, bytes: panel.bytes, slots: panel.slots })),
    revision: await page.evaluate(reportExpr),
  })
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
      const skip = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '跳过')
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
 * bodies move on a named motion channel  an escalator rider's own world position, the
 * tread the station runs on  not a counter that merely changes. Reads only the
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

/**
 * Plan 21 §6.4: live station metrics, paginated 1-minute history (`stats.history`), and
 * `ChartsPanel` / `BottomBar` verification across Chinese and English.
 */
async function runStationStatisticsCase(locale) {
  const record = caseStart(`station-statistics-${locale}`)
  const problems = []
  const wantLang = locale === 'en' ? 'en' : 'zh-CN'
  const copy = locale === 'en'
    ? {
        railTile: 'Statistics charts',
        modalTitle: 'Data',
        hudOpenLabel: 'Open the data window',
        chartTitles: ['Average crowd level', 'In-station numbers', 'Passenger totals'],
        modes: { cumulative: 'Cumulative', perMinute: 'Per minute' },
        empty: 'No data yet',
        hudLabels: [
          'Passengers inside', 'Average crowd level', 'Gate queue', 'Escalator queue',
          'Lift queue', 'Platform door queue', 'Boarded', 'Exited', 'Left behind', 'Time',
        ],
        losLabels: { A: 'Free flow', B: 'Comfortable', C: 'Busy', D: 'Crowded', E: 'Very crowded', F: 'Overcrowded' },
      }
    : {
        railTile: '统计图',
        modalTitle: '数据',
        hudOpenLabel: '打开数据窗口',
        chartTitles: ['平均拥挤等级', '站内数值', '客流累计'],
        modes: { cumulative: '累计', perMinute: '每分钟' },
        empty: '暂无数据',
        hudLabels: [
          '站内人数', '平均拥挤等级', '闸机排队', '扶梯排队',
          '电梯排队', '站台门排队', '已上车', '已出站', '滞留', '时间',
        ],
        losLabels: { A: '畅通', B: '顺畅', C: '有点挤', D: '拥挤', E: '很挤', F: '挤爆' },
      }

  const send = (type, payload) => page.evaluate(
    `window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload ?? {})})`)

  const pad2 = (n) => String(n).padStart(2, '0')
  const clockTextOf = (seconds) => {
    const t = ((Math.round(seconds) % 86400) + 86400) % 86400
    return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}`
  }
  const stampClockOf = (simTime) => {
    const t = ((Math.floor(simTime) % 86400) + 86400) % 86400
    return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}`
  }
  const niceMax = (max) => {
    if (!Number.isFinite(max) || max <= 0) return 1
    const magnitude = 10 ** Math.floor(Math.log10(max))
    for (const step of [1, 2, 5]) {
      const candidate = step * magnitude
      if (candidate >= max) return candidate
    }
    return 10 * magnitude
  }
  const expectedPoints = (values, top) => {
    const count = values.length
    const x = (i) => 40 + (count <= 1 ? 0 : (i / (count - 1)) * 430)
    const y = (v) => 10 + 104 - Math.min(1, Math.max(0, top > 0 ? v / top : 0)) * 104
    return values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  }
  const expectedTimeLabels = (times, slots = 7) => {
    if (times.length === 0) return []
    const shown = Math.min(slots, times.length)
    const out = []
    for (let i = 0; i < shown; i++) {
      const at = shown === 1 ? 0 : Math.round((i / (shown - 1)) * (times.length - 1))
      out.push(clockTextOf(times[at]))
    }
    return out
  }

  const switchUiLanguage = async (target) => {
    const current = await page.evaluate('document.documentElement.lang || "zh-CN"')
    if (current === target) return true
    const clicked = await page.evaluate(`(() => {
      const details = document.querySelector('details.settingsMenu')
      if (details) details.open = true
      const buttons = [...document.querySelectorAll('details.settingsMenu button.settingsAction, button.settingsAction')]
      const langBtn = buttons.find(btn => {
        const label = (btn.getAttribute('aria-label') ?? btn.getAttribute('title') ?? '').trim()
        return label.startsWith('切换语言') || label.startsWith('Switch language')
      })
      if (!langBtn) return false
      langBtn.click()
      if (details) details.open = false
      return true
    })()`)
    if (!clicked) return false
    try {
      await poll(`(document.documentElement.lang || 'zh-CN') === ${JSON.stringify(target)}`, `language ${target}`, 10000)
      return true
    } catch {
      return false
    }
  }

  const pauseAt1x = async (what) => {
    await send('sim.play', { playing: false })
    await send('sim.speed', { speed: 1 })
    await poll(`(() => {
      const c = window.__metroStationBridge.getSnapshot().state.clock ?? {}
      return c.playing === false && c.speed === 1
    })()`, what, Math.min(timeoutMs, 20000))
  }

  const readHudAndDom = async () => page.evaluate(`(() => {
    const hudButton = document.querySelector('.bottombarMetrics[role="button"]')
    const hud = [...document.querySelectorAll('.bottombarMetrics .metric')].map(el => ({
      label: el.querySelector('.metricLabel')?.textContent?.trim() ?? '',
      value: el.querySelector('b')?.textContent?.trim() ?? '',
    }))
    const dialog = document.querySelector('.chartsWindow[role="dialog"]')
    if (!dialog) {
      return {
        hudAriaLabel: hudButton?.getAttribute('aria-label') ?? '',
        hudTabIndex: hudButton?.getAttribute('tabindex') ?? '',
        hud,
        open: false,
      }
    }
    const blocks = [...dialog.querySelectorAll('.timeBlock')].map(block => {
      const heading = block.querySelector('.timeBlockHead > span')?.textContent?.trim() ?? ''
      const modes = [...block.querySelectorAll('.chartModes .chartMode')].map(btn => ({
        text: btn.textContent?.trim() ?? '',
        pressed: btn.getAttribute('aria-pressed') === 'true',
      }))
      const chips = [...block.querySelectorAll('.chartLegend .chartChip')].map(btn => ({
        text: btn.textContent?.trim() ?? '',
        pressed: btn.getAttribute('aria-pressed') === 'true',
      }))
      const empty = block.querySelector('.chartEmpty')?.textContent?.trim() ?? null
      const svg = block.querySelector('svg.chart')
      const ticks = svg ? [...svg.querySelectorAll('text.chartTick')].map(t => ({
        text: t.textContent?.trim() ?? '',
        x: Number(t.getAttribute('x')),
        y: Number(t.getAttribute('y')),
      })) : []
      const yTicks = ticks.filter(t => Math.abs(t.y - 125) >= 0.5)
      const xTicks = ticks.filter(t => Math.abs(t.y - 125) < 0.5).map(t => t.text)
      const polylines = svg ? [...svg.querySelectorAll('polyline.chartLine')].map(p => ({
        points: p.getAttribute('points') ?? '',
        stroke: p.style?.stroke ?? p.getAttribute('stroke') ?? '',
      })) : []
      const dots = svg ? svg.querySelectorAll('circle.chartDot').length : 0
      return { heading, modes, chips, empty, yTicks, xTicks, polylines, dots }
    })
    return {
      hudAriaLabel: hudButton?.getAttribute('aria-label') ?? '',
      hudTabIndex: hudButton?.getAttribute('tabindex') ?? '',
      hud,
      open: true,
      title: dialog.querySelector('.timeTitle')?.textContent?.trim() ?? '',
      blocks,
    }
  })()`)

  const initialLang = await page.evaluate('document.documentElement.lang || "zh-CN"')
  let zooEvidence = null
  let fixtureEvidence = null

  try {
    if (!(await switchUiLanguage(wantLang))) {
      problems.push(`could not switch UI language to ${wantLang}`)
      return finishCase(record, false, { problems })
    }
    await page.evaluate(`(() => {
      document.querySelector('.tutorialActions .ghost')?.click()
      const close = document.querySelector('.chartsWindow .timeClose')
      if (close) close.click()
    })()`)
    await sleep(100)

    // 1. Open Zoo, verify capability & descriptor shape (no embedded values array), and sample >= 3 minutes.
    if (!(await ensureDemo('zoo'))) {
      problems.push('could not commit Zoo before station-statistics')
      return finishCase(record, false, { problems })
    }
    const initCheck = await page.evaluate(`(() => {
      const s = window.__metroStationBridge.getSnapshot()
      const stats = s.state.statistics ?? null
      return {
        capability: Boolean(s.capabilities && s.capabilities.stationStatistics === true),
        available: Boolean(stats && stats.available === true),
        runId: stats?.runId ?? '',
        hasEmbeddedValues: Boolean(stats?.history && 'values' in stats.history),
      }
    })()`)
    if (!initCheck.capability) problems.push('capabilities.stationStatistics is not true')
    if (!initCheck.available || !initCheck.runId) problems.push('state.statistics is unavailable on Zoo')
    if (initCheck.hasEmbeddedValues) problems.push('state.statistics.history leaked embedded values array')

    // Monday 2026-01-05 08:00 morning peak (avoiding 2026-01-01 New Year holiday).
    const mondayMorningPeak = 4 * 86400 + 28800
    await send('sim.seek', { simTimeSeconds: mondayMorningPeak })
    await poll(`(() => {
      const stats = window.__metroStationBridge.getSnapshot().state.statistics
      return Boolean(stats && stats.runId && stats.runId !== ${JSON.stringify(initCheck.runId)} && stats.history?.count === 0)
    })()`, `${locale} zoo seek reset`, 15000)

    const zooRunAfterSeek = await page.evaluate('window.__metroStationBridge.getSnapshot().state.statistics.runId')
    await send('sim.speed', { speed: 64 })
    await send('sim.play', { playing: true })
    await poll(`(() => {
      const stats = window.__metroStationBridge.getSnapshot().state.statistics
      return Boolean(stats && stats.runId === ${JSON.stringify(zooRunAfterSeek)} && stats.history && stats.history.count >= 3 && (stats.metrics?.population ?? 0) > 0)
    })()`, `${locale} zoo >= 3 history samples`, Math.min(timeoutMs, 90000))
    await pauseAt1x(`${locale} zoo paused`)
    await sleep(350)

    // 2. Open panel from the Inspector View rail, close with Escape, reopen from HUD click and keyboard Enter.
    // Focus the tab with a real CDP bringToFront + mouse click so Chromium routes Input.dispatchKeyEvent to DOM keydown.
    await page.send('Page.bringToFront').catch(() => {})
    await page.evaluate(`window.focus()`).catch(() => {})
    await page.evaluate(`window.dispatchEvent(new CustomEvent('metro:tutorial-folders', { detail: { open: ['view'], close: [] } }))`)
    await sleep(100)
    const railTarget = await page.evaluate(`(() => {
      const tiles = [...document.querySelectorAll('.viewGrid .bpBlock, .panel .bpBlock')]
      const match = tiles.find(btn => {
        const label = btn.querySelector('.bpBlockLabel')?.textContent?.trim() ?? btn.textContent?.trim() ?? ''
        return label.toLowerCase() === ${JSON.stringify(copy.railTile.toLowerCase())}
      })
      if (!match) return { ok: false, why: 'missing:' + tiles.map(b => b.querySelector('.bpBlockLabel')?.textContent?.trim() ?? '').join('|') }
      match.scrollIntoView({ block: 'nearest' })
      const exactLabel = match.querySelector('.bpBlockLabel')?.textContent?.trim() ?? ''
      const r = match.getBoundingClientRect()
      return { ok: true, label: exactLabel, x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    if (!railTarget.ok) {
      problems.push(`could not find Statistics charts rail tile (${railTarget.why})`)
    } else {
      if (railTarget.label !== copy.railTile) {
        problems.push(`rail tile label '${railTarget.label}' != '${copy.railTile}'`)
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: railTarget.x, y: railTarget.y, button: 'left', buttons: 1, clickCount: 1 })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: railTarget.x, y: railTarget.y, button: 'left', buttons: 0, clickCount: 1 })
    }
    await poll(`Boolean(document.querySelector('.chartsWindow[role="dialog"]'))`, `${locale} open from rail`, 10000)

    await pressKey('Escape', 'Escape', 27)
    await poll(`!document.querySelector('.chartsWindow[role="dialog"]')`, `${locale} close with Escape`, 10000)

    const hudRect = await page.evaluate(`(() => {
      const el = document.querySelector('.bottombarMetrics[role="button"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + Math.min(80, r.width / 2), y: r.top + r.height / 2 }
    })()`)
    if (hudRect) {
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hudRect.x, y: hudRect.y, button: 'left', buttons: 1, clickCount: 1 })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hudRect.x, y: hudRect.y, button: 'left', buttons: 0, clickCount: 1 })
    }
    await poll(`Boolean(document.querySelector('.chartsWindow[role="dialog"]'))`, `${locale} open from HUD click`, 10000)
    await page.evaluate(`document.querySelector('.chartsWindow .timeClose')?.click()`)
    await poll(`!document.querySelector('.chartsWindow[role="dialog"]')`, `${locale} close with timeClose`, 10000)

    await page.evaluate(`document.querySelector('.bottombarMetrics[role="button"]')?.focus()`)
    await pressKey('Enter', 'Enter', 13)
    await poll(`Boolean(document.querySelector('.chartsWindow[role="dialog"]'))`, `${locale} open from HUD Enter`, 10000)
    await sleep(250)

    // 3. Verify Zoo HUD metrics & plotted charts at the exact paused tick, LOS axis orientation, series toggle, and paused stability.
    const zooState = await page.evaluate(`(() => {
      const s = window.__metroStationBridge.getSnapshot()
      return {
        revision: s.revision,
        clock: s.state.clock ?? null,
        statistics: s.state.statistics ?? null,
      }
    })()`)
    const zooHistory = await page.evaluate(`window.__metroStationBridge.request('stats.history', {
      runId: ${JSON.stringify(zooState.statistics.runId)},
      from: 0,
      limit: 128,
    })`)
    const zooDom = await readHudAndDom()
    zooEvidence = { state: zooState, history: zooHistory, dom: zooDom }

    if (zooDom.hudAriaLabel !== copy.hudOpenLabel) {
      problems.push(`HUD aria-label '${zooDom.hudAriaLabel}' != '${copy.hudOpenLabel}'`)
    }
    if (zooDom.hudTabIndex !== '0') problems.push(`HUD tabIndex '${zooDom.hudTabIndex}' != '0'`)
    if (!zooDom.open || zooDom.title !== copy.modalTitle) {
      problems.push(`modal title '${zooDom.title}' != '${copy.modalTitle}'`)
    }
    if (zooState.clock?.tick !== zooState.statistics?.metrics?.tick) {
      problems.push(`clock.tick (${zooState.clock?.tick}) != statistics.metrics.tick (${zooState.statistics?.metrics?.tick})`)
    }

    const zm = zooState.statistics.metrics
    const expectedZooHud = [
      [copy.hudLabels[0], await page.evaluate(`(${Number(zm.population)}).toLocaleString()`)],
      [copy.hudLabels[1], `${zm.crowdLos} ${copy.losLabels[zm.crowdLos]}`],
      [copy.hudLabels[2], String(zm.gateQueue)],
      [copy.hudLabels[3], String(zm.escalatorQueue)],
      [copy.hudLabels[4], String(zm.liftQueue)],
      [copy.hudLabels[5], String(zm.doorQueue)],
      [copy.hudLabels[6], String(zm.boarded)],
      [copy.hudLabels[7], String(zm.exited)],
      [copy.hudLabels[8], String(zm.leftBehind)],
      [copy.hudLabels[9], stampClockOf(zm.simTime)],
    ]
    if (zooDom.hud.length !== expectedZooHud.length) {
      problems.push(`HUD rendered ${zooDom.hud.length} metrics, expected ${expectedZooHud.length}`)
    } else {
      for (let i = 0; i < expectedZooHud.length; i++) {
        const [wantLabel, wantVal] = expectedZooHud[i]
        const got = zooDom.hud[i]
        if (got.label !== wantLabel || got.value !== wantVal) {
          problems.push(`HUD[${i}] '${got.label}: ${got.value}' != '${wantLabel}: ${wantVal}'`)
        }
      }
    }

    const zooF32 = new Float32Array(zooHistory.values ?? [])
    const zooCount = Number(zooHistory.count ?? 0)
    const zooStride = Number(zooHistory.stride ?? 13)
    const zooCol = (c) => Array.from({ length: zooCount }, (_, r) => zooF32[r * zooStride + c])
    const zooTimes = zooCol(0)
    const wantZooX = expectedTimeLabels(zooTimes)

    if (zooDom.blocks.length !== 3) {
      problems.push(`ChartsPanel rendered ${zooDom.blocks.length} chart blocks, expected 3`)
    } else {
      for (let b = 0; b < 3; b++) {
        if (zooDom.blocks[b].heading !== copy.chartTitles[b]) {
          problems.push(`block[${b}] heading '${zooDom.blocks[b].heading}' != '${copy.chartTitles[b]}'`)
        }
        if (JSON.stringify(zooDom.blocks[b].xTicks) !== JSON.stringify(wantZooX)) {
          problems.push(`block[${b}] xTicks ${JSON.stringify(zooDom.blocks[b].xTicks)} != ${JSON.stringify(wantZooX)}`)
        }
      }
      const losTicks = zooDom.blocks[0].yTicks
      const tickA = losTicks.find(t => t.text === 'A')
      const tickF = losTicks.find(t => t.text === 'F')
      if (!tickA || !tickF || !(tickA.y < tickF.y)) {
        problems.push(`LOS axis must put A above F, got ${JSON.stringify(losTicks)}`)
      }
      const wantLosPts = expectedPoints(zooCol(2).map(idx => 5 - idx), 5)
      if (zooDom.blocks[0].polylines[0]?.points !== wantLosPts) {
        problems.push(`Zoo LOS polyline '${zooDom.blocks[0].polylines[0]?.points}' != '${wantLosPts}'`)
      }
    }

    // Series chip toggle hides and restores a line cleanly.
    const linesBeforeToggle = zooDom.blocks[1]?.polylines?.length ?? 0
    await page.evaluate(`document.querySelectorAll('.chartsWindow .timeBlock')[1]?.querySelector('.chartLegend .chartChip')?.click()`)
    await sleep(120)
    const afterChipOff = await readHudAndDom()
    if (afterChipOff.blocks[1]?.chips[0]?.pressed !== false) problems.push('clicking first station series chip did not set aria-pressed=false')
    if ((afterChipOff.blocks[1]?.polylines?.length ?? -1) !== linesBeforeToggle - 1) {
      problems.push(`hiding one station series changed polyline count ${linesBeforeToggle} -> ${afterChipOff.blocks[1]?.polylines?.length}`)
    }
    await page.evaluate(`document.querySelectorAll('.chartsWindow .timeBlock')[1]?.querySelector('.chartLegend .chartChip')?.click()`)
    await sleep(120)
    const afterChipOn = await readHudAndDom()
    if ((afterChipOn.blocks[1]?.polylines?.length ?? -1) !== linesBeforeToggle) {
      problems.push('re-enabling station series chip did not restore polyline')
    }

    // Paused history must not synthesize extra samples while paused.
    await sleep(1000)
    const zooAfterPauseWait = await page.evaluate('window.__metroStationBridge.getSnapshot().state.statistics')
    if (zooAfterPauseWait.runId !== zooState.statistics.runId || zooAfterPauseWait.history.count !== zooState.statistics.history.count) {
      problems.push(`paused Zoo statistics drifted (${JSON.stringify(zooState.statistics.history)} -> ${JSON.stringify(zooAfterPauseWait.history)})`)
    }
    await screenshot(`station-game-statistics-zoo-${locale}`)

    // 4. Short-headway deterministic fixture for nonzero boarded, exited, leftBehind, and per-minute chart deltas.
    const prevRev = await page.evaluate('window.__metroStationBridge.getSnapshot().revision')
    const fixtureJson = await page.evaluate(`(() => {
      const cells = []
      for (let x = 0; x <= 4; x++) {
        for (let y = 1; y <= 6; y++) {
          cells.push({ x, y, z: 0, fill: 'solid', zone: 'unpaid', finish: { top: 'floor.concrete' } })
        }
      }
      for (const y of [2, 3, 4]) {
        cells.push({ x: 5, y, z: 0, fill: 'solid', zone: 'paid', finish: { top: 'floor.concrete' } })
      }
      for (let x = 6; x <= 42; x++) {
        for (let y = 1; y <= 4; y++) {
          cells.push({ x, y, z: 0, fill: 'solid', zone: 'paid', finish: { top: 'floor.concrete' } })
        }
      }
      const modules = [
        { id: 'exit-a', type: 'exit', x: 1, y: 1, z: 0, rot: 0, cfg: { name: 'A', inRate: 1800, open: true, covered: false, bays: 2 } },
        { id: 'exit-b', type: 'exit', x: 1, y: 2, z: 0, rot: 0, cfg: { name: 'B', inRate: 1800, open: true, covered: false, bays: 2 } },
        { id: 'exit-c', type: 'exit', x: 1, y: 3, z: 0, rot: 0, cfg: { name: 'C', inRate: 1800, open: true, covered: false, bays: 2 } },
        { id: 'exit-d', type: 'exit', x: 1, y: 4, z: 0, rot: 0, cfg: { name: 'D', inRate: 1800, open: true, covered: false, bays: 2 } },
        { id: 'exit-e', type: 'exit', x: 1, y: 5, z: 0, rot: 0, cfg: { name: 'E', inRate: 1800, open: true, covered: false, bays: 2 } },
        { id: 'exit-f', type: 'exit', x: 1, y: 6, z: 0, rot: 0, cfg: { name: 'F', inRate: 1800, open: true, covered: false, bays: 2 } },
        { id: 'gate-in-1', type: 'gate', x: 5, y: 2, z: 0, rot: 0, cfg: { dir: 'in', door: 'lane' } },
        { id: 'gate-in-2', type: 'gate', x: 5, y: 3, z: 0, rot: 0, cfg: { dir: 'in', door: 'lane' } },
        { id: 'gate-out', type: 'gate', x: 5, y: 4, z: 0, rot: 0, cfg: { dir: 'out', door: 'lane' } },
        { id: 'track-1', type: 'track', x: 6, y: -2, z: 0, rot: 0, w: 36, d: 3, cfg: { line: '5', power: 'third-rail', dir: 'up' } },
        { id: 'edge-1', type: 'platform-edge', x: 10, y: 1, z: 0, rot: 0, w: 2, cfg: { line: '5', from: 'track-1', side: 'left', psd: 'full', dir: 'up' } },
      ]
      const lines = [{
        id: '5',
        name: '5号线',
        nameEn: 'Line 5',
        colour: '#c70541',
        stock: 'L',
        cars: 2,
        power: 'third-rail',
        psd: 'full',
        direction: 'up',
        upTerminus: '文冲',
        upTerminusEn: 'Wenchong',
        downTerminus: '滘口',
        downTerminusEn: 'Jiaokou',
        alightPerTrain: 18,
        headwayProfile: { peak: 60, offpeak: 60, late: 60 },
      }]
      return JSON.stringify({
        format: 'metro-save',
        formatVersion: 1,
        gameVersion: '0.2.0',
        savedAt: '2026-01-01T00:00:00.000Z',
        name: '统计测试站',
        nameEn: 'Statistics Fixture',
        city: 'guangzhou',
        seed: 20260105,
        levelBase: 0,
        storeyHeight: 5,
        service: { from: 21600, to: 84600 },
        peaks: [{ from: 25200, to: 34200 }, { from: 61200, to: 68400 }],
        static: { cells, modules, lines },
      })
    })()`)
    await send('station.open', { document: fixtureJson })
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot()
      return s.revision > ${prevRev} && s.state.statistics && s.state.statistics.runId !== ${JSON.stringify(zooState.statistics.runId)} && s.state.statistics.history?.count === 0
    })()`, `${locale} short-headway fixture open`, Math.min(timeoutMs, 60000))
    await sleep(200)
    const emptyOpenDom = await readHudAndDom()
    if (emptyOpenDom.open && emptyOpenDom.blocks.some(b => b.empty !== copy.empty)) {
      problems.push(`freshly opened fixture did not show empty state '${copy.empty}'`)
    }

    await send('sim.seek', { simTimeSeconds: mondayMorningPeak })
    await poll(`(() => {
      const c = window.__metroStationBridge.getSnapshot().state.clock
      return Boolean(c && Math.abs(c.simTimeSeconds - ${mondayMorningPeak}) < 2)
    })()`, `${locale} fixture seek to Monday peak`, 15000)
    const fixtureRunId = await page.evaluate('window.__metroStationBridge.getSnapshot().state.statistics.runId')

    await send('sim.speed', { speed: 64 })
    await send('sim.play', { playing: true })
    await poll(`(async () => {
      const s = window.__metroStationBridge.getSnapshot()
      const stats = s.state.statistics
      const m = stats?.metrics
      if (!stats || stats.runId !== ${JSON.stringify(fixtureRunId)}) return false
      if (!(stats.history?.count >= 4 && m && m.boarded > 0 && m.exited > 0 && m.leftBehind > 0)) return false
      const page = await window.__metroStationBridge.request('stats.history', { runId: stats.runId, from: 0, limit: 128 })
      const vals = page.values ?? []
      const stride = page.stride ?? 13
      const rows = page.count ?? 0
      let sawBoardedDelta = false, sawExitedDelta = false, sawLeftBehindDelta = false
      for (let r = 1; r < rows; r++) {
        if (vals[r * stride + 10] > 0) sawBoardedDelta = true
        if (vals[r * stride + 11] > 0) sawExitedDelta = true
        if (vals[r * stride + 12] > 0) sawLeftBehindDelta = true
      }
      return sawBoardedDelta && sawExitedDelta && sawLeftBehindDelta
    })()`, `${locale} fixture nonzero throughput & per-minute deltas`, Math.min(timeoutMs, 90000))
    await pauseAt1x(`${locale} fixture paused`)
    await sleep(350)

    const revBeforeHistReq = await page.evaluate('window.__metroStationBridge.getSnapshot().revision')
    const fixState = await page.evaluate(`(() => {
      const s = window.__metroStationBridge.getSnapshot()
      return {
        revision: s.revision,
        clock: s.state.clock ?? null,
        statistics: s.state.statistics ?? null,
      }
    })()`)
    const fixHistory = await page.evaluate(`window.__metroStationBridge.request('stats.history', {
      runId: ${JSON.stringify(fixState.statistics.runId)},
      from: 0,
      limit: 128,
    })`)
    const revAfterHistReq = await page.evaluate('window.__metroStationBridge.getSnapshot().revision')
    if (revAfterHistReq !== revBeforeHistReq) {
      problems.push(`stats.history mutated document revision (${revBeforeHistReq} -> ${revAfterHistReq})`)
    }

    const fixF32 = new Float32Array(fixHistory.values ?? [])
    const fixCount = Number(fixHistory.count ?? 0)
    const fixStride = Number(fixHistory.stride ?? 13)
    const fixCol = (c) => Array.from({ length: fixCount }, (_, r) => fixF32[r * fixStride + c])

    // Check row 0 zero deltas and row r >= 1 exact per-minute differences.
    if (fixCount < 3) problems.push(`expected >= 3 fixture rows, got ${fixCount}`)
    else {
      if (fixF32[10] !== 0 || fixF32[11] !== 0 || fixF32[12] !== 0) {
        problems.push(`row 0 per-minute deltas must be 0, got [${fixF32[10]}, ${fixF32[11]}, ${fixF32[12]}]`)
      }
      for (let r = 1; r < fixCount; r++) {
        for (const [totIdx, dIdx, name] of [[7, 10, 'boarded'], [8, 11, 'exited'], [9, 12, 'leftBehind']]) {
          const wantDelta = fixF32[r * fixStride + totIdx] - fixF32[(r - 1) * fixStride + totIdx]
          const gotDelta = fixF32[r * fixStride + dIdx]
          if (Math.abs(gotDelta - wantDelta) > 1e-3) {
            problems.push(`row ${r} ${name}PerMin ${gotDelta} != ${wantDelta}`)
          }
        }
      }
    }

    // Ensure cumulative mode is selected and verify SVG polylines match cols 7..9.
    await page.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.chartsWindow .chartModes .chartMode')]
      const btn = buttons.find(b => b.textContent?.trim() === ${JSON.stringify(copy.modes.cumulative)})
      btn?.click()
    })()`)
    await sleep(120)
    const cumulativeDom = await readHudAndDom()
    const cumSeries = [fixCol(7), fixCol(8), fixCol(9)]
    const cumTop = niceMax(Math.max(0, ...cumSeries.flat()))
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const wantPts = expectedPoints(cumSeries[sIdx], cumTop)
      const gotPts = cumulativeDom.blocks[2]?.polylines[sIdx]?.points ?? ''
      if (gotPts !== wantPts) {
        problems.push(`cumulative polyline[${sIdx}] '${gotPts}' != '${wantPts}'`)
      }
    }

    // Switch to Per-minute mode and verify SVG polylines match cols 10..12.
    await page.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.chartsWindow .chartModes .chartMode')]
      const btn = buttons.find(b => b.textContent?.trim() === ${JSON.stringify(copy.modes.perMinute)})
      btn?.click()
    })()`)
    await sleep(120)
    const perMinuteDom = await readHudAndDom()
    const pmSeries = [fixCol(10), fixCol(11), fixCol(12)]
    const pmTop = niceMax(Math.max(0, ...pmSeries.flat()))
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const wantPts = expectedPoints(pmSeries[sIdx], pmTop)
      const gotPts = perMinuteDom.blocks[2]?.polylines[sIdx]?.points ?? ''
      if (gotPts !== wantPts) {
        problems.push(`per-minute polyline[${sIdx}] '${gotPts}' != '${wantPts}'`)
      }
    }

    await screenshot(`station-game-statistics-${locale}`)
    fixtureEvidence = {
      state: fixState,
      history: fixHistory,
      cumulativeDom,
      perMinuteDom,
    }
    writeFileSync(
      join(outDir, `station-statistics-${locale}.json`),
      JSON.stringify({ locale, wantLang, zoo: zooEvidence, fixture: fixtureEvidence }, null, 2) + '\n',
    )

    // 5. Seek preserves cumulative boarded while resetting history & minting a new runId; Restart clears both!
    const boardedBeforeSeek = fixState.statistics.metrics.boarded
    await send('sim.seek', { simTimeSeconds: mondayMorningPeak + 1800 })
    await poll(`(() => {
      const stats = window.__metroStationBridge.getSnapshot().state.statistics
      return Boolean(stats && stats.runId !== ${JSON.stringify(fixState.statistics.runId)} && stats.history?.count === 0)
    })()`, `${locale} post-fixture seek reset`, 15000)
    await sleep(200)
    const afterSeekStats = await page.evaluate('window.__metroStationBridge.getSnapshot().state.statistics')
    const afterSeekDom = await readHudAndDom()
    if (afterSeekStats.metrics.boarded !== boardedBeforeSeek) {
      problems.push(`sim.seek altered cumulative boarded (${boardedBeforeSeek} -> ${afterSeekStats.metrics.boarded})`)
    }
    if (afterSeekDom.blocks.some(b => b.empty !== copy.empty)) {
      problems.push(`ChartsPanel did not show '${copy.empty}' immediately after sim.seek`)
    }

    await send('sim.restart', {})
    await poll(`(() => {
      const stats = window.__metroStationBridge.getSnapshot().state.statistics
      return Boolean(stats && stats.runId !== ${JSON.stringify(afterSeekStats.runId)} && stats.history?.count === 0 && stats.metrics?.boarded === 0 && stats.metrics?.population === 0)
    })()`, `${locale} post-fixture restart reset`, 15000)
    await sleep(200)
    const afterRestartDom = await readHudAndDom()
    if (afterRestartDom.blocks.some(b => b.empty !== copy.empty)) {
      problems.push(`ChartsPanel did not show '${copy.empty}' immediately after sim.restart`)
    }

    await pressKey('Escape', 'Escape', 27)
    await poll(`!document.querySelector('.chartsWindow[role="dialog"]')`, `${locale} final Escape close`, 10000)
  } finally {
    await switchUiLanguage(initialLang).catch(() => {})
    await page.evaluate(`(() => {
      try {
        localStorage.removeItem('metro-game.language.zh-CN')
        localStorage.removeItem('metro-game.language.en')
      } catch { /* ignore */ }
    })()`).catch(() => {})
  }

  const after = await currentSnapshot()
  return finishCase(record, problems.length === 0, {
    problems,
    locale,
    revision: after.revision,
    zooRunId: zooEvidence?.state?.statistics?.runId ?? null,
    zooSamples: zooEvidence?.history?.count ?? 0,
    fixtureRunId: fixtureEvidence?.state?.statistics?.runId ?? null,
    fixtureSamples: fixtureEvidence?.history?.count ?? 0,
    fixtureMetrics: fixtureEvidence?.state?.statistics?.metrics ?? null,
    evidenceFile: `station-statistics-${locale}.json`,
  })
}

async function runPaintCase() {
  const record = caseStart('material-paint')
  const problems = []
  const before = await currentSnapshot()
  // Paint on a tiny slice of the demo rather than on all 14 066 cells: the commit path
  // is the same host transaction, and rebuilding a full station in the headless
  // software renderer blocks far past any sane verifier budget.
  const tiny = await page.evaluate(`(async () => {
    const raw = await window.__metroStationBridge.readCommittedDocument()
    if (!raw) return null
    const source = JSON.parse(raw)
    const cells = source.static.cells.filter(cell => cell.fill === 'solid').slice(0, 3)
    source.name = 'Paint probe'
    source.nameEn = 'Paint probe'
    source.static = { cells, modules: [], lines: [] }
    return { document: JSON.stringify(source), cell: [cells[0].x, cells[0].y, cells[0].z], finish: (cells[0].finish && cells[0].finish.top) || null }
  })()`)
  if (!tiny || !tiny.document) { problems.push('could not build the paint probe document'); return finishCase(record, false, { problems }) }
  await page.evaluate(`window.__metroStationBridge.send('station.open', { document: ${JSON.stringify(tiny.document)} })`)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision > ${before.revision} && window.__metroStationBridge.getSnapshot().document && window.__metroStationBridge.getSnapshot().document.length < 20000`, 'tiny paint probe commit', Math.min(timeoutMs, 60000))
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
  const document = await page.evaluate('window.__metroStationBridge.readCommittedDocument()')
  if (!document || !document.includes('floor.marble')) problems.push('the committed document does not carry the painted finish')
  await screenshot('station-game-paint')
  // Restore the surface so the probe station is left as it was found.
  await send({ cell: tiny.cell, face: 'top', finish: tiny.finish ?? 'floor.concrete', mode: 'single' })
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision > ${painted}`, 'paint restore commit', Math.min(timeoutMs, 60000))
  } catch { problems.push('the restoring paint did not commit') }
  const restored = await page.evaluate('window.__metroStationBridge.readCommittedDocument()')
  if (restored && restored.includes('floor.marble')) problems.push('the restoring paint left the painted finish behind')
  return finishCase(record, problems.length === 0, { problems, revision: await revision() })
}

/**
 * Plan 27 §1/§3: **F** through the real player surface. The block brush is the first
 * milestone of the build-tool port, so its whole gesture is proved here rather than in a
 * bridge call: a real key press changes the committed tool, a still pointer over an editable
 * surface draws a ghost, a click commits exactly the ghost's cell once, the secondary button
 * digs it back out, and undo restores the document.
 *
 * The assertions are deliberately separate (tool, aim, accepted cell, ghost, save,
 * revision) because the original failure was a dispatch gap: the rail and the command
 * looked right while no plan ever reached the pointer.
 */
async function runStationBlockToolCase() {
  const record = caseStart('station-block-tool')
  const problems = []
  if (!(await ensureDemo(activeDemo))) {
    problems.push('could not commit the demo document before the block brush case')
    return finishCase(record, false, { problems })
  }
  const snapshot = () => page.evaluate(`(() => {
    const s = window.__metroStationBridge.getSnapshot()
    return { revision: s.revision, tool: s.state.tool, rightClaim: s.state.rightClaim, cells: s.state.edit?.cells ?? null }
  })()`)
  const revision = async () => (await snapshot()).revision
  const send = (type, payload) => page.evaluate(
    `window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const documentCells = () => page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    return text ? (JSON.parse(text).static?.cells ?? []) : []
  })()`)
  const solidAt = async (cell) => (await documentCells()).some(
    record => record.x === cell[0] && record.y === cell[1] && record.z === cell[2] && record.fill === 'solid')
  // Edit on the street storey with the cutaway off, exactly as the editing case does: a
  // higher block placed from the concourse is above the slice and correctly unpickable. The
  // view handler may not be registered on the first tick of a cold player, so send until it
  // answers.
  for (let attempt = 0; attempt < 10; attempt++) {
    await send('view.set', { key: 'cutaway', value: false })
    await send('view.set', { key: 'level', value: 0 })
    await sleep(300)
    const level = await page.evaluate('window.__metroStationBridge.getSnapshot().state.level')
    if (level === 0) break
  }
  await send('camera.home', {})
  await sleep(1500)
  const rect = await page.evaluate(`(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })()`)
  if (!rect || !(rect.w > 100)) {
    problems.push('the Unity canvas is not laid out')
    return finishCase(record, false, { problems })
  }
  const at = (u, v) => ({ x: Math.round(rect.x + u * rect.w), y: Math.round(rect.y + v * rect.h) })
  const moveTo = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(250)
  }
  const clickAt = async (u, v, button = 'left') => {
    const p = at(u, v)
    const buttons = button === 'right' ? 2 : 1
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(120)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, buttons, clickCount: 1 })
    await sleep(40)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, buttons: 0, clickCount: 1 })
    await sleep(250)
  }
  const probe = async (payload, probeId) => {
    await send('edit.probe', { ...payload, probeId })
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot().state
      const p = s.edit && s.edit.probe
      return !!(p && p.probeId === ${JSON.stringify(probeId)})
    })()`, 'probe ' + probeId, Math.min(timeoutMs, 30000))
    return page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
  }

  // 1. A real `F` press selects 方块 on both sides: the rail's store and the host's
  //    committed tool. This is the dispatch the reported defect lost.
  await pressKey('f', 'KeyF', 70)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().state.tool === 'block'`, 'F commits the block tool', 15000)
  } catch {
    problems.push('F did not commit the block tool: ' + JSON.stringify((await snapshot()).tool))
  }
  let state = await snapshot()
  if (state.tool !== 'block') problems.push('the committed tool is still ' + state.tool + ' after F')
  if (state.rightClaim !== 'erase') problems.push('the block brush does not own the secondary button: ' + state.rightClaim)

  // 2. A still pointer over editable floor shows the ghost, and a hover changes no revision.
  const target = await probe({ kind: 'block', z: 0 }, 'block-cell')
  if (!target || typeof target.u !== 'number') {
    problems.push('no block probe for the block brush')
    return finishCase(record, false, { problems })
  }
  let before = await revision()
  const cellsBefore = (await documentCells()).length
  await moveTo(target.u, target.v)
  try {
    await poll(`(() => {
      const c = window.__metroStationBridge.getSnapshot().state.edit?.cells
      return !!(c && Array.isArray(c.accepted) && c.accepted.length > 0)
    })()`, 'block ghost', 15000)
  } catch {
    problems.push('a still pointer over an editable surface drew no block ghost')
  }
  state = await snapshot()
  const planCell = state.cells && state.cells.accepted && state.cells.accepted[0]
  if (!planCell) problems.push('the block ghost accepted no cell')
  if (planCell && (planCell[0] !== target.x || planCell[1] !== target.y || planCell[2] !== target.z)) {
    problems.push('the ghost cell ' + JSON.stringify(planCell) + ' is not the probed placement ' +
      JSON.stringify([target.x, target.y, target.z]))
  }
  if ((await revision()) !== before) problems.push('the block ghost changed the document revision')
  // 2a. The plan is **drawn on the game camera**, not only published (plan 28 §1/§5): the
  //     renderer built ghost objects for the accepted cells and the render loop drew them at
  //     least once. A badge beside an invisible ghost — the reported defect — fails here.
  const ghost = await page.evaluate('(() => ((window.__metroStationBridge.getSnapshot().state.edit ?? {}).ghost ?? null))()')
  if (!ghost || !(ghost.count > 0)) {
    problems.push('the accepted cell plan drew no preview objects: ' + JSON.stringify(ghost))
  } else if (!(ghost.visible > 0)) {
    problems.push('the preview objects were built but never rendered: ' + JSON.stringify(ghost))
  } else if (ghost.kind !== 'cells') {
    problems.push('the drawn layer is not the cell ghost: ' + JSON.stringify(ghost))
  }

  // 2b. The untouched virtual street is a no-op: hovering grade floor draws no accepted cell
  //     and no refusal, and a click there never edits. Zoo may have no visible virgin ground
  //     inside its built footprint, in which case the step is recorded as unavailable rather
  //     than failing a station-shaped fixture (the planner's own grade rule is pinned in
  //     `StationCellPlannerTests`).
  let gradeFixture = 'none'
  try {
    const grade = await probe({ kind: 'grade', z: 0 }, 'block-grade')
    gradeFixture = 'z=' + grade.z + ' cell=' + JSON.stringify(grade.cell)
    before = await revision()
    await moveTo(grade.u, grade.v)
    await sleep(400)
    const atGrade = await snapshot()
    if (atGrade.cells && Array.isArray(atGrade.cells.accepted) && atGrade.cells.accepted.length > 0) {
      problems.push('the block brush previewed an accepted cell on untouched virtual ground')
    }
    if (atGrade.cells && Array.isArray(atGrade.cells.blocked) && atGrade.cells.blocked.length > 0) {
      problems.push('the block brush refused the virtual street instead of ignoring it')
    }
    await clickAt(grade.u, grade.v)
    if ((await revision()) !== before) problems.push('a click on untouched virtual ground committed a revision')
    // Back to the editable cell for the commit below.
    await moveTo(target.u, target.v)
  } catch {
    gradeFixture = 'unavailable'
  }

  // 3. The click lays exactly the ghost's cell, in one revision.
  await clickAt(target.u, target.v)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'block click commit',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('the block click did not commit exactly one revision (now ' + (await revision()) + ')')
  }
  if (planCell && !(await solidAt(planCell))) {
    problems.push('the committed document has no block at the ghost cell ' + JSON.stringify(planCell))
  }

  // 4. The secondary button digs that block out again: one more revision, no block left.
  const dug = planCell
  before = await revision()
  await clickAt(target.u, target.v, 'right')
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'right-click erase commit',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('the right click erased nothing (revision ' + (await revision()) + ')')
  }
  if (dug && (await solidAt(dug))) problems.push('the right click left the block in the save')

  // 5. Undo walks the history back: the erase's inverse restores the block, and the place's
  //    inverse removes it again  so the case leaves the demo exactly as it found it. A case
  //    that edited the shared station and moved on would break every later case that does not
  //    reload it (`ensureDemo` is a no-op when the demo is already committed).
  before = await revision()
  await send('edit.undo', {})
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'block undo',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('undo after a block edit did not commit')
  }
  if (dug && !(await solidAt(dug))) problems.push('undo did not restore the dug block')
  before = await revision()
  await send('edit.undo', {})
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'block restore undo',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('the restoring undo did not commit')
  }
  if (dug && (await solidAt(dug))) problems.push('the second undo left the placed block in the save')
  const cellsAfter = (await documentCells()).length
  if (cellsAfter !== cellsBefore) {
    problems.push('the case did not restore the demo document (' + cellsBefore + ' → ' + cellsAfter + ' cells)')
  }
  await screenshot('station-game-block-tool')
  // Leave the session on the shell's own default tool: the brush's press state, its plan and
  // its claim are session facts, and a later case that never sets a tool must not inherit them.
  await send('tool.set', { tool: 'select', settings: {} })
  await sleep(200)
  return finishCase(record, problems.length === 0, {
    problems, revision: await revision(), cell: dug, gradeFixture,
  })
}

/**
 * Plan 27 §4 through the real player surface: **G** raises a storey-high wall column and its
 * secondary button lifts it again, **B** takes a placed piece, and **Ctrl+Z** puts it back.
 *
 * Each step proves the same chain as the 方块 case  key press → committed tool, still pointer
 * → ghost, click → exactly one revision, and the document really changed  because the
 * original defect was a dispatch gap where every one of those looked plausible on its own.
 */
/**
 * Plan 28 §3/§5 through the real player surface: **one case per Structure tile**.
 *
 * Every tile is driven the way the player drives it — `tool.set` arms the palette, a real hover
 * resolves the plan, and the renderer must have drawn it (`state.edit.ghost.visible > 0`, the
 * camera's own answer, not a plan array) — then a click commits exactly one revision and the
 * save really gains the family. A tile whose probe cannot find a target on Zoo records
 * `unavailable` rather than failing a station-shaped fixture, exactly as the block case does for
 * virgin ground; the *renderer* assertion is the one that must never be skipped once a plan is
 * published, because a badge beside an invisible ghost is the defect this plan repairs.
 */
async function runStationStructureTilesCase() {
  const record = caseStart('station-structure-tiles')
  const problems = []
  if (!(await ensureDemo(activeDemo))) {
    problems.push('could not commit the demo document before the Structure tile case')
    return finishCase(record, false, { problems })
  }
  const revision = () => page.evaluate('window.__metroStationBridge.getSnapshot().revision')
  const editState = () => page.evaluate('window.__metroStationBridge.getSnapshot().state.edit ?? null')
  const send = (type, payload) => page.evaluate(
    `window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const modules = () => page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    return text ? (JSON.parse(text).static?.modules ?? []) : []
  })()`)
  const tool = async (name, settings) => {
    await send('tool.set', { tool: name, settings: settings ?? {} })
    try {
      await poll(`window.__metroStationBridge.getSnapshot().state.tool === ${JSON.stringify(name)}`,
        'tool ' + name, 15000)
    } catch { /* the click below reports the effect */ }
    await sleep(200)
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    await send('view.set', { key: 'cutaway', value: false })
    await send('view.set', { key: 'level', value: 0 })
    await sleep(300)
    if (await page.evaluate('window.__metroStationBridge.getSnapshot().state.level') === 0) break
  }
  await send('camera.home', {})
  await sleep(1500)
  const rect = await page.evaluate(`(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })()`)
  if (!rect || !(rect.w > 100)) {
    problems.push('the Unity canvas is not laid out')
    return finishCase(record, false, { problems })
  }
  const at = (u, v) => ({ x: Math.round(rect.x + u * rect.w), y: Math.round(rect.y + v * rect.h) })
  const moveTo = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(300)
  }
  const clickAt = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(120)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(60)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(350)
  }
  const probe = async (payload, probeId) => {
    await send('edit.probe', { ...payload, probeId })
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot().state
      const p = s.edit && s.edit.probe
      return !!(p && p.probeId === ${JSON.stringify(probeId)})
    })()`, 'probe ' + probeId, Math.min(timeoutMs, 30000))
    return page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
  }
  const undo = async () => {
    const before = await revision()
    await send('edit.undo', {})
    try {
      await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`,
        'structure undo', Math.min(timeoutMs, 30000))
    } catch { problems.push('undo after a Structure edit did not commit') }
  }

  // The tiles that resolve a **fresh piece** through the ordinary placement: the two pillars and
  // the roof plate/bays. Each asserts the ghost is drawn, then one release is one revision.
  const tiles = [
    { palette: 'pillar-thick', probe: { kind: 'place', toolType: 'pillar-thick', rotation: 0 }, type: 'pillar' },
    { palette: 'pillar-slim', probe: { kind: 'place', toolType: 'pillar-slim', rotation: 0 }, type: 'pillar' },
    { palette: 'roof', probe: { kind: 'place', toolType: 'roof', rotation: 0 }, type: 'roof' },
    { palette: 'roof-tapered', probe: { kind: 'place', toolType: 'roof-tapered', rotation: 0, width: 4 }, type: 'roof' },
    { palette: 'roof-canopy', probe: { kind: 'place', toolType: 'roof-canopy', rotation: 0, width: 4 }, type: 'roof' },
  ]
  const results = {}
  for (const tile of tiles) {
    results[tile.palette] = 'unavailable'
    await tool('module', {
      moduleType: tile.palette, rotation: 0, roofWidth: 4, pillarLength: 5,
    })
    let target = null
    try { target = await probe(tile.probe, 'structure-' + tile.palette) } catch { await sleep(1200) }
    if (!target || typeof target.u !== 'number') continue
    const countBefore = (await modules()).filter((m) => m.type === tile.type).length
    await moveTo(target.u, target.v)
    const aimed = await editState()
    const ghost = aimed?.ghost ?? null
    const planned = Boolean(aimed?.plan?.candidate) || Boolean(aimed?.cells?.accepted?.length)
    if (planned && !(ghost && ghost.count > 0)) {
      problems.push(tile.palette + ': the plan drew no preview objects: ' + JSON.stringify(ghost))
    } else if (planned && !(ghost.visible > 0)) {
      problems.push(tile.palette + ': the preview was built but never rendered: ' + JSON.stringify(ghost))
    }
    const before = await revision()
    await clickAt(target.u, target.v)
    const after = await revision()
    if (after === before) {
      // A probe can aim at a cell the gesture then refuses (a slab over a wall); the refusal must
      // at least be published, so the player is told rather than left with a dead button.
      const notice = (await editState())?.notice ?? null
      if (!notice) problems.push(tile.palette + ': the click changed nothing and published no outcome')
      results[tile.palette] = 'refused:' + (notice?.code ?? '') + ':' + (notice?.kind ?? '')
      continue
    }
    if (after !== before + 1) problems.push(tile.palette + ': the click committed ' + (after - before) + ' revisions')
    const countAfter = (await modules()).filter((m) => m.type === tile.type).length
    if (countAfter !== countBefore + 1) {
      problems.push(tile.palette + ': the save gained ' + (countAfter - countBefore) + ' ' + tile.type + ' records, not one')
    }
    await undo()
    const countRestored = (await modules()).filter((m) => m.type === tile.type).length
    if (countRestored !== countBefore) problems.push(tile.palette + ': undo did not remove the piece')
    results[tile.palette] = 'placed'
  }

  // The rail tools hang off existing track, so they are driven from a track probe: the hover must
  // publish a rail plan the renderer drew, and the press commits it in one revision.
  const railTiles = [
    { name: 'rail', tool: 'rail', settings: { lineId: '5', railDir: 'up', rotationRail: 0 }, probe: { kind: 'cell', z: 0 } },
    { name: 'tunnel', tool: 'tunnel', settings: { tunnelLength: 4 }, probe: { kind: 'module', moduleType: 'track' } },
    { name: 'bridge', tool: 'module', settings: { moduleType: 'bridge', bridgeLength: 8, bridgeRailing: 'railing' }, probe: { kind: 'module', moduleType: 'track' } },
  ]
  for (const tile of railTiles) {
    results[tile.name] = 'unavailable'
    await tool(tile.tool, tile.settings)
    let target = null
    try { target = await probe(tile.probe, 'structure-' + tile.name) } catch { await sleep(1200) }
    if (!target || typeof target.u !== 'number') continue
    const tracksBefore = (await modules()).filter((m) => m.type === 'track').length
    await moveTo(target.u, target.v)
    const aimed = await editState()
    const railPlan = aimed?.railPlan ?? null
    const ghost = aimed?.ghost ?? null
    if (!railPlan) {
      results[tile.name] = 'unavailable:no-plan'
      continue
    }
    if (!(ghost && ghost.visible > 0)) {
      problems.push(tile.name + ': the rail plan drew no rendered preview: ' + JSON.stringify(ghost))
    }
    const before = await revision()
    await clickAt(target.u, target.v)
    const after = await revision()
    if (after === before) {
      const notice = (await editState())?.notice ?? null
      if (!notice) problems.push(tile.name + ': the press changed nothing and published no outcome')
      results[tile.name] = 'refused:' + (notice?.code ?? '') + ':' + (notice?.kind ?? '')
      continue
    }
    if (after !== before + 1) problems.push(tile.name + ': the press committed ' + (after - before) + ' revisions')
    const tracksAfter = (await modules()).filter((m) => m.type === 'track').length
    if (tracksAfter <= tracksBefore) problems.push(tile.name + ': the press committed no track')
    if (tile.name === 'bridge') {
      const bridged = (await modules()).find((m) => m.type === 'track' && m.cfg?.bridge)
      if (!bridged) problems.push('bridge: the committed track has no cfg.bridge')
    }
    await undo()
    results[tile.name] = 'placed'
  }

  await send('tool.set', { tool: 'select', settings: {} })
  await sleep(200)
  const unavailable = Object.entries(results).filter(([, value]) => String(value).startsWith('unavailable')).map(([key]) => key)
  await screenshot('station-game-structure-tiles')
  return finishCase(record, problems.length === 0, {
    problems, tiles: results, unavailable, revision: await revision(),
  })
}

async function runStationWallDeleteCase() {
  const record = caseStart('station-wall-delete')
  const problems = []
  if (!(await ensureDemo(activeDemo))) {
    problems.push('could not commit the demo document before the wall/delete case')
    return finishCase(record, false, { problems })
  }
  const snapshot = () => page.evaluate(`(() => {
    const s = window.__metroStationBridge.getSnapshot()
    return { revision: s.revision, tool: s.state.tool, cells: s.state.edit?.cells ?? null }
  })()`)
  const revision = async () => (await snapshot()).revision
  const send = (type, payload) => page.evaluate(
    `window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const documentCells = () => page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    return text ? (JSON.parse(text).static?.cells ?? []) : []
  })()`)
  const documentModules = () => page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    return text ? (JSON.parse(text).static?.modules ?? []) : []
  })()`)
  const solidAt = async (cell, list) => (list ?? await documentCells()).some(
    entry => entry.x === cell[0] && entry.y === cell[1] && entry.z === cell[2] && entry.fill === 'solid')
  for (let attempt = 0; attempt < 10; attempt++) {
    await send('view.set', { key: 'cutaway', value: false })
    await send('view.set', { key: 'level', value: 0 })
    await sleep(300)
    const level = await page.evaluate('window.__metroStationBridge.getSnapshot().state.level')
    if (level === 0) break
  }
  await send('camera.home', {})
  await sleep(1500)
  const rect = await page.evaluate(`(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })()`)
  if (!rect || !(rect.w > 100)) {
    problems.push('the Unity canvas is not laid out')
    return finishCase(record, false, { problems })
  }
  const at = (u, v) => ({ x: Math.round(rect.x + u * rect.w), y: Math.round(rect.y + v * rect.h) })
  const moveTo = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(250)
  }
  const clickAt = async (u, v, button = 'left') => {
    const p = at(u, v)
    const buttons = button === 'right' ? 2 : 1
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(120)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, buttons, clickCount: 1 })
    await sleep(40)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, buttons: 0, clickCount: 1 })
    await sleep(250)
  }
  const probe = async (payload, probeId) => {
    await send('edit.probe', { ...payload, probeId })
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot().state
      const p = s.edit && s.edit.probe
      return !!(p && p.probeId === ${JSON.stringify(probeId)})
    })()`, 'probe ' + probeId, Math.min(timeoutMs, 30000))
    return page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
  }

  // 1. G commits the 墙 tool, and a still pointer draws the column it would lay.
  await pressKey('g', 'KeyG', 71)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().state.tool === 'wall'`, 'G commits the wall tool', 15000)
  } catch {
    problems.push('G did not commit the wall tool: ' + JSON.stringify((await snapshot()).tool))
  }
  if ((await snapshot()).tool !== 'wall') problems.push('the committed tool is not wall after G')
  const target = await probe({ kind: 'block', z: 0 }, 'wall-cell')
  if (!target || typeof target.u !== 'number') {
    problems.push('no block probe for the wall tool')
    return finishCase(record, false, { problems })
  }
  let before = await revision()
  await moveTo(target.u, target.v)
  try {
    await poll(`(() => {
      const c = window.__metroStationBridge.getSnapshot().state.edit?.cells
      return !!(c && c.kind === 'wall' && Array.isArray(c.accepted) && c.accepted.length > 0)
    })()`, 'wall column ghost', 15000)
  } catch {
    problems.push('a still pointer drew no wall column ghost')
  }
  if ((await revision()) !== before) problems.push('the wall ghost changed the document revision')
  const column = ((await snapshot()).cells?.accepted ?? []).map(cell => [cell[0], cell[1], cell[2]])
  if (column.length < 2) problems.push('the wall ghost accepted fewer than two courses: ' + JSON.stringify(column))

  // 2. The click raises exactly that column, in one revision.
  await clickAt(target.u, target.v)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'wall click commit',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('the wall click did not commit exactly one revision (now ' + (await revision()) + ')')
  }
  const afterWall = await documentCells()
  const missing = []
  for (const cell of column) if (!(await solidAt(cell, afterWall))) missing.push(cell)
  if (missing.length > 0) problems.push('the committed save is missing wall courses ' + JSON.stringify(missing))

  // 3. The secondary button lifts the column again: one revision, and every course is gone.
  before = await revision()
  await clickAt(target.u, target.v, 'right')
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'wall erase commit',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('the right click on the wall committed no revision (now ' + (await revision()) + ')')
  }
  const afterErase = await documentCells()
  const left = []
  for (const cell of column) if (await solidAt(cell, afterErase)) left.push(cell)
  if (left.length > 0) problems.push('the right click left wall courses ' + JSON.stringify(left))

  // 4. B takes a placed piece on the press and its release, and one Ctrl+Z restores it. The
  //    bench is placed through the same pointer path first: Zoo's street storey has no bench
  //    in the framed viewport, and a probe only answers for what is on screen.
  const modulesBefore = (await documentModules()).length
  await send('tool.set', { tool: 'module', settings: { moduleType: 'bench-steel-1', rotation: 0 } })
  try {
    await poll(`window.__metroStationBridge.getSnapshot().state.tool === 'module'`, 'module tool for the bench', 15000)
  } catch { problems.push('the module tool did not commit for the bench placement') }
  let place = null
  for (let attempt = 1; attempt <= 3 && !place; attempt++) {
    try { place = await probe({ kind: 'place', toolType: 'bench-steel-1', rotation: 0 }, 'wall-bench-place-' + attempt) } catch { await sleep(800) }
  }
  let bench = null
  if (!place || place.kind !== 'place') {
    problems.push('no place probe for the delete fixture')
  } else {
    before = await revision()
    await clickAt(place.u, place.v)
    try {
      await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'bench place commit',
        Math.min(timeoutMs, 30000))
    } catch {
      problems.push('the delete fixture bench was not placed (now ' + (await revision()) + ')')
    }
    bench = (await documentModules()).find(module => module.type === 'bench'
      && module.x === place.x && module.y === place.y && module.z === place.z) ?? null
    if (!bench) problems.push('the committed document has no bench at the probed cell')
  }
  if (bench) {
    // Aim at the bench's **drawn** body, not the cell it was dropped on.
    let bodyPixel = { u: place.u, v: place.v }
    try {
      await send('edit.probe', { kind: 'inspect', moduleId: bench.id, probeId: 'wall-bench-inspect' })
      await poll(`(() => {
        const p = (window.__metroStationBridge.getSnapshot().state.edit ?? {}).probe
        return !!(p && p.probeId === 'wall-bench-inspect' && p.boxUv)
      })()`, 'bench inspect', 15000)
      const inspect = await page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
      if (inspect?.boxUv) bodyPixel = { u: inspect.boxUv[0], v: inspect.boxUv[1] }
    } catch { /* the place pixel still lands on the seat */ }
    await pressKey('b', 'KeyB', 66)
    try {
      await poll(`window.__metroStationBridge.getSnapshot().state.tool === 'delete'`, 'B commits the delete tool', 15000)
    } catch {
      problems.push('B did not commit the delete tool: ' + JSON.stringify((await snapshot()).tool))
    }
    before = await revision()
    await clickAt(bodyPixel.u, bodyPixel.v)
    try {
      await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'bench delete commit',
        Math.min(timeoutMs, 30000))
    } catch {
      problems.push('the delete click committed no revision (now ' + (await revision()) + ')')
    }
    if ((await documentModules()).some(module => module.id === bench.id)) {
      problems.push('the deleted bench is still in the save')
    }
    before = await revision()
    await pressKey('z', 'KeyZ', 90, 2)
    try {
      await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'bench undo commit',
        Math.min(timeoutMs, 30000))
    } catch {
      problems.push('Ctrl+Z did not commit (now ' + (await revision()) + ')')
    }
    if (!(await documentModules()).some(module => module.id === bench.id)) {
      problems.push('Ctrl+Z did not restore the deleted bench')
    }
    // A second Ctrl+Z undoes the fixture placement, so the demo is left as it was found.
    before = await revision()
    await pressKey('z', 'KeyZ', 90, 2)
    try {
      await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'fixture undo commit',
        Math.min(timeoutMs, 30000))
    } catch {
      problems.push('the fixture-restoring Ctrl+Z did not commit')
    }
    const modulesAfter = (await documentModules()).length
    if (modulesAfter !== modulesBefore) {
      problems.push('the case did not restore the demo (' + modulesBefore + ' → ' + modulesAfter + ' modules)')
    }
  }
  await screenshot('station-game-wall-delete')
  // Leave the shell on its own default tool and the demo as it was found.
  await send('tool.set', { tool: 'select', settings: {} })
  await sleep(200)
  return finishCase(record, problems.length === 0, {
    problems, revision: await revision(), column: column.length, bench: bench?.id ?? null,
  })
}

/**
 * Plan 27 §5/§6 through the real player surface: a **围栏 run** dragged as one line of panels,
 * and a **材质** face painted by the brush, each committing one revision and coming back with
 * one undo. The run is the first catalogue family whose gesture is a drag rather than a press,
 * and the brush is the first face edit, so both prove a transport that a command case cannot.
 */
async function runStationRunPaintCase() {
  const record = caseStart('station-run-paint')
  const problems = []
  if (!(await ensureDemo(activeDemo))) {
    problems.push('could not commit the demo document before the run/paint case')
    return finishCase(record, false, { problems })
  }
  const snapshot = () => page.evaluate(`(() => {
    const s = window.__metroStationBridge.getSnapshot()
    return {
      revision: s.revision, tool: s.state.tool,
      cells: s.state.edit?.cells ?? null, paint: s.state.edit?.paint ?? null,
    }
  })()`)
  const revision = async () => (await snapshot()).revision
  const send = (type, payload) => page.evaluate(
    `window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const documentModules = () => page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    return text ? (JSON.parse(text).static?.modules ?? []) : []
  })()`)
  const documentHasFinish = () => page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    if (!text) return false
    return (JSON.parse(text).static?.cells ?? []).some(cell => cell.finish && cell.finish.top === 'floor.marble')
  })()`)
  for (let attempt = 0; attempt < 10; attempt++) {
    await send('view.set', { key: 'cutaway', value: false })
    await send('view.set', { key: 'level', value: 0 })
    await sleep(300)
    const level = await page.evaluate('window.__metroStationBridge.getSnapshot().state.level')
    if (level === 0) break
  }
  await send('camera.home', {})
  await sleep(1500)
  const rect = await page.evaluate(`(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })()`)
  if (!rect || !(rect.w > 100)) {
    problems.push('the Unity canvas is not laid out')
    return finishCase(record, false, { problems })
  }
  const at = (u, v) => ({ x: Math.round(rect.x + u * rect.w), y: Math.round(rect.y + v * rect.h) })
  const moveTo = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(200)
  }
  const dragDown = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(220)
  }
  const dragTo = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 })
    await sleep(120)
  }
  const dragUp = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(300)
  }
  const probe = async (payload, probeId) => {
    await send('edit.probe', { ...payload, probeId })
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot().state
      const p = s.edit && s.edit.probe
      return !!(p && p.probeId === ${JSON.stringify(probeId)})
    })()`, 'probe ' + probeId, Math.min(timeoutMs, 30000))
    return page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
  }

  // 1. A 围栏 run: arm the family, drag a line, and release one line of panels.
  await send('tool.set', { tool: 'module', settings: { moduleType: 'fence', rotation: 0 } })
  try {
    await poll(`window.__metroStationBridge.getSnapshot().state.tool === 'module'`, 'fence family armed', 15000)
  } catch { problems.push('the 围栏 palette did not commit') }
  const target = await probe({ kind: 'block', z: 0 }, 'run-cell')
  if (!target || typeof target.u !== 'number') {
    problems.push('no block probe for the run case')
    return finishCase(record, false, { problems })
  }
  const fencesBefore = (await documentModules()).filter(module => module.type === 'fence').length
  let before = await revision()
  await moveTo(target.u, target.v)
  await dragDown(target.u, target.v)
  // 12 px per step so the drag is deliberate but stays on the same storey.
  await dragTo(target.u, target.v + 0.08)
  // The move is coalesced per animation frame and the state frame publishes the ghost at 10 Hz,
  // so wait for the grown plan rather than reading the press's single cell.
  try {
    await poll(`(() => {
      const c = window.__metroStationBridge.getSnapshot().state.edit?.cells
      return !!(c && c.kind === 'run' && Array.isArray(c.accepted) && c.accepted.length >= 2)
    })()`, 'run ghost grows', 15000)
  } catch {
    const last = await snapshot()
    problems.push('the run ghost accepted fewer than two panels: ' + JSON.stringify(last.cells))
  }
  await dragUp(target.u, target.v + 0.08)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'fence run commit',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('the fence run did not commit one revision (now ' + (await revision()) + ')')
  }
  const fencesAfter = (await documentModules()).filter(module => module.type === 'fence').length
  if (fencesAfter <= fencesBefore) {
    problems.push('the committed save gained no fence panels (' + fencesBefore + ' → ' + fencesAfter + ')')
  }
  before = await revision()
  await send('edit.undo', {})
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'fence run undo',
      Math.min(timeoutMs, 30000))
  } catch { problems.push('undo after the fence run did not commit') }
  const fencesRestored = (await documentModules()).filter(module => module.type === 'fence').length
  if (fencesRestored !== fencesBefore) {
    problems.push('one undo did not restore the fence count (' + fencesBefore + ' → ' + fencesRestored + ')')
  }

  // 2. The 材质 brush: one click paints the picked face, and one undo takes it back.
  await send('tool.set', { tool: 'paint', settings: { paintMode: 'single', paintFinish: 'floor.marble' } })
  try {
    await poll(`window.__metroStationBridge.getSnapshot().state.tool === 'paint'`, 'paint tool armed', 15000)
  } catch { problems.push('the 材质 tool did not commit') }
  const faceTarget = await probe({ kind: 'block', z: 0 }, 'paint-cell')
  before = await revision()
  await moveTo(faceTarget.u, faceTarget.v)
  const hovered = await snapshot()
  if (!hovered.paint || !Array.isArray(hovered.paint.cells) || hovered.paint.cells.length === 0) {
    problems.push('the brush drew no face ghost: ' + JSON.stringify(hovered.paint))
  }
  if ((await revision()) !== before) problems.push('the paint ghost changed the document revision')
  const p = at(faceTarget.u, faceTarget.v)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(40)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(300)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'paint commit',
      Math.min(timeoutMs, 30000))
  } catch { problems.push('the paint click did not commit one revision (now ' + (await revision()) + ')') }
  if (!(await documentHasFinish())) problems.push('the committed save carries no floor.marble face')
  before = await revision()
  await send('edit.undo', {})
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'paint undo',
      Math.min(timeoutMs, 30000))
  } catch { problems.push('undo after a paint did not commit') }
  if (await documentHasFinish()) problems.push('one undo left the painted face in the save')
  await screenshot('station-game-run-paint')
  await send('tool.set', { tool: 'select', settings: {} })
  await sleep(200)
  return finishCase(record, problems.length === 0, {
    problems, revision: await revision(), fences: fencesAfter - fencesBefore,
  })
}

/**
 * The 分区 (zone) brush on the real player surface. A fare label is a `zone` field on a floor
 * record, so the case proves the same chain the other brush cases do  committed tool →
 * still-pointer ghost → one click, one revision → the save carries the label → the claimed
 * secondary button takes it off again  and restores the demo with the shared history.
 */
async function runStationZoneCase() {
  const record = caseStart('station-zone-paint')
  const problems = []
  if (!(await ensureDemo(activeDemo))) {
    problems.push('could not commit the demo document before the zone case')
    return finishCase(record, false, { problems })
  }
  const snapshot = () => page.evaluate(`(() => {
    const s = window.__metroStationBridge.getSnapshot()
    return {
      revision: s.revision, tool: s.state.tool, rightClaim: s.state.rightClaim,
      zone: s.state.edit?.zone ?? null,
    }
  })()`)
  const revision = async () => (await snapshot()).revision
  const send = (type, payload) => page.evaluate(
    `window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const documentCells = () => page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    return text ? (JSON.parse(text).static?.cells ?? []) : []
  })()`)
  const zoneAt = async (cell) => {
    const found = (await documentCells()).find(
      record => record.x === cell[0] && record.y === cell[1] && record.z === cell[2])
    return found ? (found.zone ?? null) : null
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    await send('view.set', { key: 'cutaway', value: false })
    await send('view.set', { key: 'level', value: 0 })
    await sleep(300)
    const level = await page.evaluate('window.__metroStationBridge.getSnapshot().state.level')
    if (level === 0) break
  }
  await send('camera.home', {})
  await sleep(1500)
  const rect = await page.evaluate(`(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })()`)
  if (!rect || !(rect.w > 100)) {
    problems.push('the Unity canvas is not laid out')
    return finishCase(record, false, { problems })
  }
  const at = (u, v) => ({ x: Math.round(rect.x + u * rect.w), y: Math.round(rect.y + v * rect.h) })
  const moveTo = async (u, v) => {
    const p = at(u, v)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(250)
  }
  const clickAt = async (u, v, button = 'left') => {
    const p = at(u, v)
    const buttons = button === 'right' ? 2 : 1
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
    await sleep(120)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, buttons, clickCount: 1 })
    await sleep(40)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, buttons: 0, clickCount: 1 })
    await sleep(250)
  }
  const probe = async (payload, probeId) => {
    await send('edit.probe', { ...payload, probeId })
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot().state
      const p = s.edit && s.edit.probe
      return !!(p && p.probeId === ${JSON.stringify(probeId)})
    })()`, 'probe ' + probeId, Math.min(timeoutMs, 30000))
    return page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
  }

  // 1. The committed tool is 分区 and it owns the secondary button, so the eraser reaches C#.
  await send('tool.set', { tool: 'zone', settings: { zoneBrush: 'paid' } })
  try {
    await poll(`window.__metroStationBridge.getSnapshot().state.tool === 'zone'`, 'zone tool armed', 15000)
  } catch { problems.push('the 分区 tool did not commit: ' + JSON.stringify((await snapshot()).tool)) }
  const armed = await snapshot()
  if (armed.tool !== 'zone') problems.push('the committed tool is still ' + armed.tool + ' after arming 分区')
  if (armed.rightClaim !== 'erase') problems.push('the 分区 brush does not own the secondary button: ' + armed.rightClaim)

  // 2. A still pointer over a floor cell tints exactly that cell and changes no revision.
  const target = await probe({ kind: 'zone', z: 0 }, 'zone-cell')
  if (!target || typeof target.u !== 'number' || !Array.isArray(target.cell)) {
    problems.push('no floor probe for the 分区 brush')
    return finishCase(record, false, { problems })
  }
  const cell = target.cell
  const cellsBefore = (await documentCells()).length
  let before = await revision()
  await moveTo(target.u, target.v)
  try {
    await poll(`(() => {
      const z = window.__metroStationBridge.getSnapshot().state.edit?.zone
      return !!(z && Array.isArray(z.floor) && z.floor.length === 1)
    })()`, 'zone ghost', 15000)
  } catch {
    problems.push('a still pointer over a floor cell drew no 分区 tint: ' + JSON.stringify((await snapshot()).zone))
  }
  const hovered = await snapshot()
  const tinted = hovered.zone && hovered.zone.floor && hovered.zone.floor[0]
  if (tinted && (tinted[0] !== cell[0] || tinted[1] !== cell[1] || tinted[2] !== cell[2])) {
    problems.push('the tint ' + JSON.stringify(tinted) + ' is not the probed floor ' + JSON.stringify(cell))
  }
  if ((await revision()) !== before) problems.push('the 分区 ghost changed the document revision')

  // 3. One click labels exactly that cell, in one revision.
  await clickAt(target.u, target.v)
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'zone click commit',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('the 分区 click did not commit exactly one revision (now ' + (await revision()) + ')')
  }
  if ((await zoneAt(cell)) !== 'paid') {
    problems.push('the committed save has no 付费区 label at ' + JSON.stringify(cell))
  }

  // 4. The claimed secondary button erases the label again: one more revision, no zone left.
  before = await revision()
  await clickAt(target.u, target.v, 'right')
  try {
    await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'zone erase commit',
      Math.min(timeoutMs, 30000))
  } catch {
    problems.push('the secondary press did not erase the label (now ' + (await revision()) + ')')
  }
  if ((await zoneAt(cell)) !== null) problems.push('the label survived the 分区 eraser at ' + JSON.stringify(cell))

  // 5. The shared history takes both edits back, leaving the demo as it was found.
  for (let step = 0; step < 2; step++) {
    before = await revision()
    await send('edit.undo', {})
    try {
      await poll(`window.__metroStationBridge.getSnapshot().revision === ${before + 1}`, 'zone undo ' + step,
        Math.min(timeoutMs, 30000))
    } catch { problems.push('undo ' + step + ' after the 分区 edits did not commit') }
  }
  const cellsAfter = (await documentCells()).length
  if (cellsAfter !== cellsBefore) {
    problems.push('the case did not restore the demo document (' + cellsBefore + ' → ' + cellsAfter + ' cells)')
  }
  if ((await zoneAt(cell)) !== null) problems.push('the restored document still carries the test label')

  await send('tool.set', { tool: 'select', settings: {} })
  await screenshot('station-game-zone-paint')
  await sleep(200)
  return finishCase(record, problems.length === 0, {
    problems, revision: await revision(), cell,
  })
}

async function runStationEditingCase() {
  const record = caseStart('station-editing')
  const problems = []
  if (!(await ensureDemo('zoo'))) {
    problems.push('could not commit the Zoo document before editing it')
    return finishCase(record, false, { problems })
  }
  const revision = () => page.evaluate('window.__metroStationBridge.getSnapshot().revision')
  const editState = () => page.evaluate('window.__metroStationBridge.getSnapshot().state.edit ?? null')
  const send = (type, payload) => page.evaluate(
    `window.__metroStationBridge.send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`)
  const tool = async (name, settings) => {
    await send('tool.set', { tool: name, settings: settings ?? {} })
    // The pointer event carries the tool generation the shell last saw, so a click must
    // wait for the committed tool's state frame (0.1 s) before it can be accepted.
    try { await poll(`window.__metroStationBridge.getSnapshot().state.tool === ${JSON.stringify(name)}`, 'tool ' + name, 15000) } catch { /* the click below reports the effect */ }
    await sleep(150)
  }
  // Edit on the street storey: Zoo opens on the sunken concourse, and a piece placed on a
  // higher block from there is above the cutaway (correctly unpickable). The view handler
  // may not be registered on the first tick of a cold player, so send until it answers.
  for (let attempt = 0; attempt < 10; attempt++) {
    await send('view.set', { key: 'cutaway', value: false })
    await send('view.set', { key: 'level', value: 0 })
    await sleep(300)
    const level = await page.evaluate('window.__metroStationBridge.getSnapshot().state.level')
    const cutaway = await page.evaluate('window.__metroStationBridge.getSnapshot().state.view?.cutaway ?? false')
    if (level === 0 && cutaway === false) break
  }
  await sleep(900)
  // `view.set level` slices the station but does not reframe the camera (an edit keeps the
  // view). Home after the level change puts the street storey in the viewport, which is
  // what a player sees after stepping storeys and pressing Home.
  await send('camera.home', {})
  await sleep(1500)
  const modules = () => page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
    return text ? (JSON.parse(text).static?.modules ?? []) : []
  })()`)
  const probe = async (payload, probeId) => {
    await send('edit.probe', { ...payload, probeId })
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot().state
      const p = s.edit && s.edit.probe
      return !!(p && p.probeId === ${JSON.stringify(probeId)})
    })()`, 'probe ' + probeId, Math.min(timeoutMs, 30000))
    return page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
  }
  // Where a module is actually drawn: the picker's own measured-body pixel from
  // `edit.probe { kind: "inspect" }`. A placement probe aims at a sampled cell, which is
  // not necessarily the cell the ray lands on, so later clicks must use the body pixel.
  const inspect = async (moduleId, probeId) => {
    await send('edit.probe', { kind: 'inspect', moduleId, probeId })
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot().state
      const p = s.edit && s.edit.probe
      return !!(p && p.probeId === ${JSON.stringify(probeId)} && p.boxUv)
    })()`, 'inspect ' + probeId, Math.min(timeoutMs, 30000))
    return page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
  }
  const rect = await page.evaluate(`(() => {
    const canvas = document.querySelector('#unity-canvas') ?? document.querySelector('canvas')
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })()`)
  if (!rect || !(rect.w > 100)) {
    problems.push('the Unity canvas is not laid out')
    return finishCase(record, false, { problems })
  }
  // A real pointer press on the canvas exactly where the probe's own pick resolved.
  const clickAt = async (u, v) => {
    const x = Math.round(rect.x + u * rect.w)
    const y = Math.round(rect.y + v * rect.h)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
    await sleep(50)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(30)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(150)
  }
  const waitRevision = async (expected, label) => {
    try {
      await poll(`window.__metroStationBridge.getSnapshot().revision === ${expected}`, label, Math.min(timeoutMs, 30000))
      return true
    } catch {
      problems.push(label + ' did not reach revision ' + expected)
      return false
    }
  }

  // 1. Place one static prop through the real pointer path: hover resolves a candidate,
  //    the press commits exactly that candidate, and one revision carries it.
  await tool('module', { moduleType: 'bench-steel-1', rotation: 0 })
  // A cold player needs its cell view built before a probe can resolve a pixel; retry the
  // probe rather than failing the whole case on the first tick.
  let placeTarget = null
  for (let attempt = 1; attempt <= 3 && !placeTarget; attempt++) {
    try { placeTarget = await probe({ kind: 'place', toolType: 'bench-steel-1', rotation: 0 }, 'place-' + attempt) } catch { await sleep(1500) }
  }
  if (!placeTarget || placeTarget.kind !== 'place') {
    problems.push('no place probe')
    return finishCase(record, false, { problems })
  }
  let before = await revision()
  let placedInspect = null
  await clickAt(placeTarget.u, placeTarget.v)
  if (await waitRevision(before + 1, 'pointer place')) {
    const placed = (await modules()).find(m => m.type === 'bench'
      && m.x === placeTarget.x && m.y === placeTarget.y && m.z === placeTarget.z)
    if (!placed) problems.push('the committed document has no bench at the probed cell')
    else {
      const state = await editState()
      if (state?.selectionKey !== placed.id) problems.push('the committed bench is not the selection')
      // Diagnostic: can the scene picker see the newly placed bench at all after the
      // commit rebuilt the world?
      try {
        await send('edit.probe', { kind: 'inspect', moduleId: placed.id, probeId: 'inspect-placed' })
        await poll(`(() => {
          const p = (window.__metroStationBridge.getSnapshot().state.edit ?? {}).probe
          return !!(p && p.probeId === 'inspect-placed')
        })()`, 'placed inspect', 15000)
        placedInspect = await page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.probe')
      } catch { placedInspect = { error: 'inspect timeout' } }
      let placedPixel = placedInspect?.boxUv
        ? { u: placedInspect.boxUv[0], v: placedInspect.boxUv[1] }
        : placeTarget
      try {
        const placedProbe = await probe({ kind: 'module', moduleType: 'bench', moduleId: placed.id }, 'placed-bench')
        if (placedProbe?.moduleId !== placed.id) problems.push('the placed bench is not pickable: ' + JSON.stringify(placedProbe))
        else if (typeof placedProbe.u === 'number' && typeof placedProbe.v === 'number') {
          // The module probe aims at the bench's **drawn** body; the place pixel aimed at the
          // cell it was dropped on, and the commit's rebuild can leave that pixel meeting the
          // pavement a cell nearer the camera instead of the seat. A player aims at the seat.
          placedPixel = { u: placedProbe.u, v: placedProbe.v }
        }
      } catch { problems.push('the placed bench is not pickable: probe timeout') }

      // 2. Hover previews never bump the revision: three pointer moves over open floor.
      before = await revision()
      for (const offset of [0.02, 0.04, 0.06]) {
        await page.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: Math.round(rect.x + (placeTarget.u + offset) * rect.w),
          y: Math.round(rect.y + (placeTarget.v + offset) * rect.h), button: 'none', buttons: 0,
        })
        await sleep(30)
      }
      await sleep(150)
      if (await revision() !== before) problems.push('a hover preview changed the document revision')
      const trace = await page.evaluate('window.__metroStationBridge.getSnapshot().state.edit.trace ?? []')
      if (!trace.some(entry => entry.type === 'pointer.down' && entry.committed)) {
        problems.push('the interaction trace has no committed pointer.down')
      }
      if (trace.some(entry => entry.type === 'pointer.move' && entry.committed)) {
        problems.push('a hover move committed a revision')
      }
      if (trace.filter(entry => entry.type === 'pointer.down').some(entry => !entry.picked)) {
        problems.push('a pointer.down was routed without a scene pick')
      }

      // 3. Eyedropper: the bench just placed stands under the place pixel, so that is the
      //    pixel a player would point at. The host names the picked module and the shell
      //    arms the rail through `paletteIdForModule`.
      await tool('pick')
      await clickAt(placedPixel.u, placedPixel.v)
      await sleep(250)
      const picked = await editState()
      if (picked?.pick?.moduleId !== placed.id) problems.push('the eyedropper did not publish the picked module')
      try {
        await poll(`window.__metroStationBridge.getSnapshot().state.tool === 'module'`, 'picked tool', 15000)
      } catch { problems.push('the shell did not arm the palette for the picked module') }

      // 4. Selection: the 选择 tool publishes the module identity the inspector reads.
      await tool('select')
      await clickAt(placedPixel.u, placedPixel.v)
      await sleep(200)
      const selected = await editState()
      if (selected?.selectionKind !== 'module' || selected.selectionKey !== placed.id) {
        problems.push('a select click did not publish a module selection')
      }

      // 5. Move: the bench just placed stands under the pixel the place click used, so that
      //    same pixel lifts it; a fresh-placement probe picks a different free cell to drop
      //    it on (the carried bench still occupies its old cell, so the probe cannot return
      //    it). One revision, the same id, a new position.
      await tool('move')
      before = await revision()
      let movedFrom = null
      let movedTo = null
      await clickAt(placedPixel.u, placedPixel.v)
      try {
        await poll(`(() => {
          const s = window.__metroStationBridge.getSnapshot().state
          return s.edit && s.edit.carried === ${JSON.stringify(placed.id)}
        })()`, 'carried bench', 15000)
        movedFrom = { x: placed.x, y: placed.y }
      } catch {
        const liftState = await editState()
        problems.push('clicking the placed bench did not lift it for a move: ' + JSON.stringify({
          carried: liftState?.carried ?? null,
          selection: liftState?.selectionKey ?? null,
          trace: (liftState?.trace ?? []).slice(-2),
        }))
      }
      if (movedFrom) {
        const target = await probe({ kind: 'place', toolType: 'bench-steel-1', rotation: 0 }, 'move-to')
        if (!target || (target.x === movedFrom.x && target.y === movedFrom.y)) {
          problems.push('no distinct drop target for the move')
        } else {
          await clickAt(target.u, target.v)
          if (await waitRevision(before + 1, 'pointer move')) {
            movedTo = target
            const moved = (await modules()).find(m => m.id === placed.id)
            if (!moved) problems.push('the moved bench left the document')
            else if (moved.x !== target.x || moved.y !== target.y) problems.push('the bench did not land on the aimed cell')
            const state = await editState()
            if (state?.carried) problems.push('the move draft survived a valid drop')
          }
        }
      }

      // 6. An invalid drop leaves both the saved object and the draft in place. The bench
      //    now stands under the drop pixel (or the place pixel when the drop was skipped).
      before = await revision()
      let cancelAt = movedTo ?? placedPixel
      try {
        const afterMove = await inspect(placed.id, 'inspect-moved')
        if (afterMove?.boxUv) cancelAt = { u: afterMove.boxUv[0], v: afterMove.boxUv[1] }
      } catch { /* the moved pixel is the next best aim */ }
      await tool('move')
      await clickAt(cancelAt.u, cancelAt.v)
      const carried = await editState()
      const cancelFrom = carried?.carried
        ? (await modules()).find(m => m.id === carried.carried)
        : null
      if (cancelFrom) {
        const refused = await probe({ kind: 'refused', toolType: 'bench-steel-1', rotation: 0 }, 'invalid-drop')
        if (refused?.kind === 'refused') {
          await clickAt(refused.u, refused.v)
          await sleep(250)
          if (await revision() !== before) problems.push('an invalid drop committed a revision')
          const still = await editState()
          if (!still?.carried) problems.push('an invalid drop dropped the carried draft')
        } else problems.push('no refused placement probe')
        await send('edit.cancel', {})
        await sleep(150)
        const cancelled = await editState()
        if (cancelled?.carried) problems.push('edit.cancel did not put the piece back')
        const restored = (await modules()).find(m => m.id === cancelFrom.id)
        if (restored && (restored.x !== cancelFrom.x || restored.y !== cancelFrom.y)) problems.push('a cancel moved the saved object')
      } else problems.push('a move click did not lift a bench for the invalid-drop check')

      // 7. Undo/redo: the last commit is the move (or the place when no drop was available).
      //    Each is one revision, and the committed envelope is restored.
      before = await revision()
      await send('edit.undo', {})
      if (await waitRevision(before + 1, 'undo')) {
        const afterUndo = (await modules()).find(m => m.id === placed.id)
        if (movedTo) {
          if (!afterUndo) problems.push('undoing the move removed the bench')
          else if (afterUndo.x !== movedFrom.x || afterUndo.y !== movedFrom.y) problems.push('undo did not restore the moved bench')
        } else if (afterUndo) problems.push('undo did not remove the placed bench')
      }
      before = await revision()
      await send('edit.redo', {})
      if (await waitRevision(before + 1, 'redo')) {
        const afterRedo = (await modules()).find(m => m.id === placed.id)
        if (movedTo) {
          if (!afterRedo || afterRedo.x !== movedTo.x || afterRedo.y !== movedTo.y) problems.push('redo did not re-apply the move')
        } else if (!afterRedo) problems.push('redo did not restore the placed bench')
      }

      // Restore Zoo to its clean authored document before exercising the fixed -10 m targets.
      if (movedTo) {
        before = await revision()
        await send('edit.undo', {})
        await waitRevision(before + 1, 'cleanup move undo')
      }
      before = await revision()
      await send('edit.undo', {})
      await waitRevision(before + 1, 'cleanup place undo')

      // 8. Fixed, independently chosen Zoo targets at -10 m (`StationScenePickerTests.ZooMinusTenFixedTargetsMatchBrowserCanvasSequence`):
      //    Step from 0 m Home down to -10 m and zoom to 0.45x so the north concourse balcony
      //    around `bin-754` (58, 38, -10) and `(57, 37, -10)`  directly beneath the hidden 0 m
      //    street / VirtualGround slab at (69, 22, 0)  is projected directly from camera math
      //    rather than chosen by `edit.probe`.
      await send('view.set', { key: 'level', value: 0 })
      await sleep(250)
      await send('camera.home', {})
      await sleep(400)
      await send('view.set', { key: 'level', value: -10 })
      try {
        await poll('window.__metroStationBridge.getSnapshot().state.level === -10', 'level -10', 15000)
      } catch { problems.push('view.set level -10 did not settle') }
      await send('camera.zoom', { factor: 0.45 })
      await sleep(600)

      const cam = await page.evaluate('window.__metroStationBridge.getSnapshot().state.camera ?? null')
      if (!cam || !Array.isArray(cam.position) || !Array.isArray(cam.right) || !Array.isArray(cam.up) || !Array.isArray(cam.back)) {
        problems.push('camera snapshot missing basis for independent -10 m projection')
      } else {
        const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        const projectDoc = (pt) => {
          const d = [pt[0] - cam.position[0], pt[1] - cam.position[1], pt[2] - cam.position[2]]
          const cx = dot3(d, cam.right)
          const cy = dot3(d, cam.up)
          const cz = -dot3(d, cam.back)
          const halfH = cam.ortho ? cam.orthoSize : cz * Math.tan((cam.fov * Math.PI) / 360)
          const halfW = halfH * (rect.w / rect.h)
          return { u: 0.5 + 0.5 * (cx / halfW), v: 0.5 - 0.5 * (cy / halfH) }
        }
        const hoverAt = async (u, v) => {
          const x = Math.round(rect.x + u * rect.w)
          const y = Math.round(rect.y + v * rect.h)
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
          await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          await sleep(150)
        }
        const clickWithoutHover = async (u, v) => {
          const x = Math.round(rect.x + u * rect.w)
          const y = Math.round(rect.y + v * rect.h)
          await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
          await sleep(30)
          await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
          await sleep(200)
        }
        const rightTapAt = async (u, v) => {
          const x = Math.round(rect.x + u * rect.w)
          const y = Math.round(rect.y + v * rect.h)
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
          await sleep(50)
          await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
          await sleep(30)
          await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
          await sleep(200)
        }

        const fixedBinUv = projectDoc([58.5, 38.5, -8.55])      // bin-754 @ (58, 38, -10)
        const fixedCellUv = projectDoc([57.5, 37.2, -9.0])      // open concourse floor @ (57, 37, -10)
        const fixedDropUv = projectDoc([60.5, 37.5, -9.0])      // open concourse floor @ (60, 37, -10)
        const fixedVoidUv = projectDoc([50.0, 45.0, 0.0])       // above hidden 0 m grade -> void miss
        const screenshotUv = projectDoc([56.5, 37.6, -9.0])     // (56, 37, -10) directly under (72, 14, 0) / sidewalk-1717

        // 8a. Select at -10 m: concourse cell, authored bin-754, and void miss clearing selection.
        await tool('select')
        await clickAt(fixedCellUv.u, fixedCellUv.v)
        await sleep(150)
        let subState = await editState()
        if (subState?.selectionKind !== 'cell' || subState?.selectionKey !== '57,37,-10') {
          problems.push('fixed -10 m cell select expected cell:57,37,-10, got ' + JSON.stringify({
            kind: subState?.selectionKind, key: subState?.selectionKey,
          }))
        }

        await clickAt(fixedBinUv.u, fixedBinUv.v)
        await sleep(150)
        subState = await editState()
        if (subState?.selectionKind !== 'module' || subState?.selectionKey !== 'bin-754') {
          problems.push('fixed -10 m module select expected module:bin-754, got ' + JSON.stringify({
            kind: subState?.selectionKind, key: subState?.selectionKey,
          }))
        }

        await clickAt(fixedVoidUv.u, fixedVoidUv.v)
        await sleep(150)
        subState = await editState()
        if (subState?.selectionKind !== '' || subState?.selectionKey !== '') {
          problems.push('void miss at -10 m did not clear selection: ' + JSON.stringify({
            kind: subState?.selectionKind, key: subState?.selectionKey,
          }))
        }

        // 8b. Eyedropper (`pick`) on fixed -10 m bin-754.
        await tool('pick')
        await clickAt(fixedBinUv.u, fixedBinUv.v)
        await sleep(250)
        subState = await editState()
        if (subState?.pick?.moduleId !== 'bin-754') {
          problems.push('eyedropper at -10 m did not pick bin-754: ' + JSON.stringify(subState?.pick ?? null))
        }

        // 8c. Placement at -10 m: hover preview matches fixture plan without revision bump,
        //     occupied bin-754 refuses without revision bump, open (57, 37, -10) commits in +1 revision.
        await tool('module', { moduleType: 'bench-steel-1', rotation: 0 })
        before = await revision()
        await hoverAt(fixedCellUv.u, fixedCellUv.v)
        if (await revision() !== before) problems.push('-10 m hover preview mutated revision')
        subState = await editState()
        const hoverCand = subState?.plan?.candidate
        if (!subState?.plan?.ok || hoverCand?.x !== 57 || hoverCand?.y !== 37 || hoverCand?.z !== -10) {
          problems.push('-10 m hover plan did not match fixture (57, 37, -10): ' + JSON.stringify(subState?.plan ?? null))
        }

        await clickAt(fixedBinUv.u, fixedBinUv.v)
        await sleep(200)
        if (await revision() !== before) problems.push('refused -10 m placement on occupied bin-754 mutated revision')

        await clickAt(fixedCellUv.u, fixedCellUv.v)
        if (await waitRevision(before + 1, '-10 m pointer place')) {
          const subPlaced = (await modules()).find(m => m.type === 'bench' && m.x === 57 && m.y === 37 && m.z === -10)
          if (!subPlaced) problems.push('-10 m placed bench missing at (57, 37, -10)')
          else {
            // 8d. Move pickup & drop at -10 m: (57, 37, -10) -> (60, 37, -10) in one commit.
            const placedSeatUv = projectDoc([57.5, 37.5, -8.55])
            await tool('move')
            before = await revision()
            await clickAt(placedSeatUv.u, placedSeatUv.v)
            try {
              await poll(`(window.__metroStationBridge.getSnapshot().state.edit ?? {}).carried === ${JSON.stringify(subPlaced.id)}`, '-10 m carried bench', 15000)
            } catch {
              problems.push('-10 m move pickup did not lift ' + subPlaced.id)
            }
            if (await revision() !== before) problems.push('-10 m move pickup mutated revision')

            await clickAt(fixedDropUv.u, fixedDropUv.v)
            if (await waitRevision(before + 1, '-10 m pointer move')) {
              const subMoved = (await modules()).find(m => m.id === subPlaced.id)
              if (!subMoved || subMoved.x !== 60 || subMoved.y !== 37 || subMoved.z !== -10) {
                problems.push('-10 m moved bench did not land at (60, 37, -10): ' + JSON.stringify(subMoved ?? null))
              }
              const postDrop = await editState()
              if (postDrop?.carried) problems.push('-10 m move draft survived valid drop')

              // Assert one scene resolution per routed editing event in the recent trace.
              const subTrace = postDrop?.trace ?? []
              if (subTrace.some(entry => ['pointer.down', 'pointer.move', 'pointer.rightTap'].includes(entry.type) && entry.picks !== 1)) {
                problems.push('routed editing event did not resolve exactly 1 scene pick: ' + JSON.stringify(subTrace))
              }
              if (subTrace.some(entry => entry.type === 'pointer.move' && entry.committed)) {
                problems.push('-10 m hover move committed a revision')
              }

              // 8e. Select right-tap deletes the -10 m bench in one undoable commit; undo/redo verify and restore clean Zoo.
              const movedSeatUv = projectDoc([60.5, 37.5, -8.55])
              await tool('select')
              before = await revision()
              await rightTapAt(movedSeatUv.u, movedSeatUv.v)
              if (await waitRevision(before + 1, '-10 m right-tap delete')) {
                if ((await modules()).some(m => m.id === subPlaced.id)) {
                  problems.push('right-tap delete left the -10 m bench in the document')
                }
                const delTrace = (await editState())?.trace ?? []
                if (!delTrace.some(entry => entry.type === 'pointer.rightTap' && entry.picks === 1 && entry.committed)) {
                  problems.push('right-tap delete did not record a single-pick committed trace entry')
                }

                before = await revision()
                await send('edit.undo', {})
                if (await waitRevision(before + 1, '-10 m undo delete')) {
                  if (!(await modules()).some(m => m.id === subPlaced.id)) problems.push('undo did not restore right-tap deleted bench')
                }
                before = await revision()
                await send('edit.redo', {})
                if (await waitRevision(before + 1, '-10 m redo delete')) {
                  if ((await modules()).some(m => m.id === subPlaced.id)) problems.push('redo did not re-apply right-tap delete')
                }
                // Undo delete, move, and place so Zoo returns to its exact authored state.
                for (const label of ['-10 m restore delete', '-10 m restore move', '-10 m restore place']) {
                  before = await revision()
                  await send('edit.undo', {})
                  await waitRevision(before + 1, label)
                }
              }
            }
          }
        }

        // 8f. Toggle the view and click the EXACT same pixel again without an intervening hover:
        //     `screenshotUv` aims at (56, 37, -10) directly through 0 m `sidewalk-1717` / `(72, 14, 0)`.
        await tool('select')
        await clickAt(screenshotUv.u, screenshotUv.v)
        await sleep(150)
        subState = await editState()
        if (subState?.selectionKind !== 'cell' || subState?.selectionKey !== '56,37,-10') {
          problems.push('frozen ray at -10 m expected cell:56,37,-10, got ' + JSON.stringify({
            kind: subState?.selectionKind, key: subState?.selectionKey,
          }))
        }

        await send('view.set', { key: 'hideUi', value: true })
        try {
          await poll('window.__metroStationBridge.getSnapshot().state.view?.hideUi === true', 'hideUi on', 10000)
        } catch { problems.push('hideUi on did not settle') }
        await sleep(150)
        const seqBeforeNoHover = ((await editState())?.trace ?? []).at(-1)?.seq ?? 0
        await clickWithoutHover(screenshotUv.u, screenshotUv.v)
        subState = await editState()
        if (subState?.selectionKind !== 'module' || subState?.selectionKey !== 'sidewalk-1717') {
          problems.push('frozen ray after hideUi=true without hover expected module:sidewalk-1717, got ' + JSON.stringify({
            kind: subState?.selectionKind, key: subState?.selectionKey,
          }))
        }
        const between = (subState?.trace ?? []).filter(entry => entry.seq > seqBeforeNoHover)
        if (between.some(entry => entry.type === 'pointer.move')) {
          problems.push('clickWithoutHover unexpectedly dispatched a pointer.move before clicking')
        }

        await send('view.set', { key: 'hideUi', value: false })
        try {
          await poll('window.__metroStationBridge.getSnapshot().state.view?.hideUi === false', 'hideUi off', 10000)
        } catch { problems.push('hideUi off did not settle') }
        await sleep(150)
        await clickWithoutHover(screenshotUv.u, screenshotUv.v)
        subState = await editState()
        if (subState?.selectionKind !== 'cell' || subState?.selectionKey !== '56,37,-10') {
          problems.push('frozen ray after hideUi=false without hover expected cell:56,37,-10, got ' + JSON.stringify({
            kind: subState?.selectionKind, key: subState?.selectionKey,
          }))
        }
      }

      // Restore 0 m Home framing for downstream cases.
      await send('view.set', { key: 'level', value: 0 })
      await sleep(250)
      await send('camera.home', {})
      await sleep(400)
    }
  }
  await screenshot('station-game-station-editing')
  return finishCase(record, problems.length === 0, {
    problems, revision: await revision(), probe: placeTarget, placedInspect,
  })
}

async function runExitFacesCase() {
  const record = caseStart('exit-faces')
  const problems = []
  if (!(await ensureDemo('zoo'))) {
    problems.push('could not commit the Zoo document before checking its exit faces')
    return finishCase(record, false, { problems })
  }
  // The oracle records the street plates in zh-CN (plus the en letter/header rows). The
  // preceding locale cases leave the shell in en, so reset the *face* locale before the
  // comparison: the painter identity is the subject here, not the locale switch (which
  // has its own oracle rows).
  await page.evaluate("window.__metroStationBridge.send('exit.locale', { locale: 'zh-CN' })")
  // The street renderer binds replaceable exit/guidepost faces and asks the shell's
  // painter for them through the `exit.*` seam; the host publishes the result as
  // `state.exit.faces`. A face only counts once its PNG was applied and the plate has ink.
  try {
    await poll(`(() => {
      const s = window.__metroStationBridge.getSnapshot().state
      const f = s.exit && s.exit.faces
      return !!(f && f.bound > 0 && f.pending === 0 && f.served === f.bound)
    })()`, 'exit faces settled', Math.min(timeoutMs, 45000))
  } catch { problems.push('the exit faces did not bind and serve') }
  const faces = await page.evaluate(`(() => {
    const s = window.__metroStationBridge.getSnapshot().state
    return s.exit && s.exit.faces ? s.exit.faces : null
  })()`)
  if (!faces) return finishCase(record, false, { problems: [...problems, 'no state.exit.faces payload'] })
  if (faces.pending !== 0) problems.push('exit faces still pending: ' + faces.pending)
  if (faces.served !== faces.bound) problems.push('served faces ' + faces.served + ' of ' + faces.bound)
  if (!(faces.minInk > 0)) problems.push('a served exit face is blank (minInk ' + faces.minInk + ')')
  // The TypeScript painter's recorded content key is the oracle: the host's applied
  // key must be that key (the report publishes a short prefix), so a face cannot be
  // silently painted by a different painter/fact set.
  let oracle = null
  try {
    oracle = JSON.parse(readFileSync(join(root, 'unity/Assets/StationDesigner/Tests/EditMode/station-exit-faces-oracle.json'), 'utf8'))
  } catch { problems.push('cannot read the exit-face oracle') }
  const expected = new Map()
  for (const row of oracle?.rows ?? []) {
    const moduleId = row.facts?.moduleId
    const key = row.facts?.key ?? row.key
    if (!moduleId || !key) continue
    if (!expected.has(moduleId)) expected.set(moduleId, new Set())
    expected.get(moduleId).add(key)
  }
  const served = (faces.faces ?? []).filter(face => face.served)
  for (const face of served) {
    const keys = expected.get(face.moduleId)
    if (!keys) continue
    const short = String(face.key ?? '')
    if (![...keys].some(key => key.startsWith(short))) {
      problems.push('face ' + face.moduleId + '/' + face.painter + ' key ' + short + ' is not a recorded painter key')
    }
  }
  // The plan's own identity chain: B and C, fascia and linked guidepost, must be the
  // recorded pixels and must differ from each other.
  const keyOf = moduleId => served.filter(face => face.moduleId === moduleId).map(face => String(face.key ?? ''))
  const wants = (moduleId, prefix) => keyOf(moduleId).some(key => prefix.startsWith(key) || key.startsWith(prefix))
  const identity = [
    ['exit-uncovered-2-258', '63893dc4'],
    ['exit-uncovered-2-398', '2d1a93e6'],
    ['guidepost-399', '7c50ab75'],
    ['guidepost-400', 'cf281c64'],
  ]
  for (const [moduleId, prefix] of identity) {
    if (!wants(moduleId, prefix)) problems.push(moduleId + ' is not painted with its recorded face (' + prefix + ')')
  }
  if (wants('exit-uncovered-2-258', '63893dc4') && wants('exit-uncovered-2-398', '2d1a93e6') &&
      keyOf('exit-uncovered-2-258').join() === keyOf('exit-uncovered-2-398').join()) {
    problems.push('exit B and exit C share one face texture')
  }
  await screenshot('station-game-exit-faces')
  return finishCase(record, problems.length === 0, {
    problems,
    bound: faces.bound, served: faces.served, textures: faces.textures,
    requests: faces.requests, painted: faces.painted, minInk: faces.minInk,
    keys: Object.fromEntries(identity.map(([moduleId]) => [moduleId, keyOf(moduleId)])),
  })
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
  const roads = await page.evaluate(`(async () => {
    const text = await window.__metroStationBridge.readCommittedDocument()
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
  // Zoo's roads sit at street grade (0 m); select 0 m with ground shown so unified storey
  // visibility displays the street and its vehicles even when --only road-traffic cold-opens at -20 m.
  await send('view.set', { key: 'level', value: 0 })
  await send('view.set', { key: 'ground', value: false })
  await poll(`(() => { const v = window.__metroStationBridge.getSnapshot().state.view; return Boolean(v && v.level === 0 && v.ground === false) })()`, 'road-traffic street view', Math.min(timeoutMs, 15000)).catch(() => {})
  await send('sim.play', { playing: true })
  await sleep(300)
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
    url: loadProbe ? 'about:blank' : demoUrl(shortcutFixtureOnly ? '' : demos[0], locales[0]),
    profile: join(outDir, 'chrome-profile'),
    debugPort: Number(process.env.METRO_STATION_DEBUG_PORT || 9337),
    commandTimeoutMs: timeoutMs,
  })
  page.onEvent('Runtime.exceptionThrown', rememberBrowserError('exception'))
  page.onEvent('Log.entryAdded', rememberBrowserError('log'))
  if (loadProbe) {
    report.loadStages = []
    report.wasmGrowth = []
    page.onEvent('Page.javascriptDialogOpening', ({ message }) => {
      report.loadDialog = message
      save()
      void page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    })
    page.onEvent('Runtime.consoleAPICalled', ({ args }) => {
      for (const { value } of args ?? []) {
        if (typeof value !== 'string') continue
        if (value.startsWith('[MetroLoad]')) report.loadStages.push(value.trim())
        else if (value.startsWith('[MetroWasm]')) report.wasmGrowth.push(value.trim())
        else if (value.includes('abort("OOM")')) {
          loadFailure = 'Unity aborted while growing the Wasm heap'
          report.loadFailure = value
        } else continue
        save()
      }
    })
  }
  await page.send('Runtime.enable')
  await page.send('Log.enable')
  if (loadProbe) {
    await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const grow = WebAssembly.Memory.prototype.grow;
      WebAssembly.Memory.prototype.grow = function (pages) {
        const before = this.buffer.byteLength;
        try {
          const result = grow.call(this, pages);
          console.info('[MetroWasm] before=' + before + ' pages=' + pages + ' after=' + this.buffer.byteLength);
          return result;
        } catch (error) {
          console.info('[MetroWasm] before=' + before + ' pages=' + pages + ' failed=' + error.name);
          throw error;
        }
      };
    })()` })
  }
  // A filtered run skips the demo cases that normally wait for the cold open, so wait
  // for the initial commit here before the selected case reads the station.
  if (loadProbe && !wanted(`demo-${demos[0]}-${locales[0]}`)) {
    await page.send('Page.navigate', { url: demoUrl(demos[0], locales[0]) })
  }
  if (onlyCases && (!loadProbe || !wanted(`demo-${demos[0]}-${locales[0]}`))) {
    await poll('window.__metroStationBridge && window.__metroStationBridge.getSnapshot().revision >= 0', 'initial commit')
  }
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
  if (wanted('exploded-view')) await runExplodedViewCase()
  if (wanted('camera-cube')) await runCameraCase()
  if (wanted('pointer-camera')) await runPointerCameraCase()
    if (wanted('visual-home')) await runVisualCase()
    if (wanted('overlay-toggles')) await runOverlayCase()
    if (wanted('station-displays')) await runDisplayCase()
    if (wanted('section-handle')) await runSectionHandleCase()
  if (wanted('keyboard-navigation')) await runKeyboardNavigationCase()
  if (wanted('shortcut-save')) await runShortcutSaveCase()
  if (wanted('shortcut-move')) await runShortcutMoveCase()
  if (wanted('tool-selection')) await runToolCase()
  if (wanted('station-editing')) await runStationEditingCase()
  // After `station-editing`: that case's frozen-ray sub-step reads a fixed pixel whose
  // module-versus-cell answer depends on the world the block brush last installed, so the
  // brush's own case runs once the editing case has taken its measurement. Both restore the
  // demo they edit; `ensureDemo` is a no-op while Zoo is already committed.
  if (wanted('station-block-tool')) await runStationBlockToolCase()
  if (wanted('station-structure-tiles')) await runStationStructureTilesCase()
  if (wanted('station-wall-delete')) await runStationWallDeleteCase()
  if (wanted('station-run-paint')) await runStationRunPaintCase()
  // The 分区 brush is the third face/floor edit on the same street storey; it edits one cell
  // and restores it through the shared history, so it stays beside the two brushes above.
  if (wanted('station-zone-paint')) await runStationZoneCase()
  if (wanted('exit-faces')) await runExitFacesCase()
  if (wanted('road-geometry')) await runRoadGeometryCase()
  if (wanted('simulation-clock')) await runClockCase()
  if (wanted('road-traffic')) await runTrafficCase()
  // The printed band installs the station twice (the line edit and the restore), so it
  // runs before the sign commit's own three installs rather than after them.
  if (wanted('psd-header')) await runPsdHeaderCase()
  if (wanted('sign-commit')) await runSignCommitCase()
  if (wanted('passenger-profile')) await runPassengerProfileCase()
  // Still on Zoo here (the paint case replaces the station), so the service sample does
  // not pay for another 14 k-cell install.
  if (wanted('service-motion')) await runServiceMotionCase()
  for (const locale of locales) if (wanted(`station-statistics-${locale}`)) await runStationStatisticsCase(locale)
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
    save()
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
