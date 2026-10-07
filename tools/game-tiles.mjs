// The real thing: start the built game in headless Chrome, let the game's own
// palette pass render every module, and take the images it produces.
//
// Nothing here re-implements anything. The page evaluates `getModuleThumbnails()`
// — the exact function the build rail's tiles call — against a live WebGL context,
// so what comes back is the game's own preview render, at the game's own camera
// angle, with the game's own materials, tone mapping and lighting.
//
//   node tools/game-tiles.mjs              -> .preview/game-tiles/<id>.png
//
// Requires `game/dist` (run `npm run build:game`).

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, openSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const DIST = join(repo, 'game', 'dist')
const OUT = join(repo, '.preview', 'game-tiles')
const PORT = 4193
const DEBUG_PORT = 9335

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const server = await new Promise((ok) => {
  const s = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = join(DIST, normalize(url).replace(/^(\.\.[/\\])+/, ''))
    if (!existsSync(file) || url.endsWith('/')) file = join(DIST, 'index.html')
    if (!existsSync(file)) return void res.writeHead(404).end('no')
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  s.listen(PORT, '127.0.0.1', () => ok(s))
})

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => p && existsSync(p))
if (!chromePath) throw new Error('no Chrome or Edge found — set CHROME_PATH')

// A fresh profile per run. A fixed path is the obvious choice and the wrong one:
// a headless Chrome that outlived its parent keeps the directory open, and the
// next run's `rmSync` then fails with EPERM on Windows before it draws anything.
// `GAME_TILES_PROFILE` pins the path for a caller that wants to reuse one.
const profile = process.env.GAME_TILES_PROFILE ?? join(repo, '.preview', `.chrome-game-tiles-${process.pid}`)
rmSync(profile, { recursive: true, force: true })

// Chrome's own log, so a launch that dies (a blocked profile, a missing flag on
// this platform) says why instead of surfacing as a bare ECONNREFUSED. Set
// `GAME_TILES_VERBOSE=1` to let it through to the console.
const chromeLog = join(repo, '.preview', 'game-tiles-chrome.log')
const logFd = openSync(chromeLog, 'w')

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--enable-logging=stderr',
    '--v=0',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1400,900',
    'about:blank',
  ],
  { stdio: ['ignore', logFd, logFd] },
)

try {
  let up = false
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok) { up = true; break }
    } catch {}
    await sleep(250)
  }
  if (!up) {
    const log = existsSync(chromeLog) ? readFileSync(chromeLog, 'utf8').split('\n').slice(-12).join('\n') : '(no log)'
    if (process.env.GAME_TILES_VERBOSE) console.error(log)
    throw new Error(`Chrome never opened its debugging port (${DEBUG_PORT}). Its log, tail:\n${log}`)
  }

  const tab = await (
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(`http://127.0.0.1:${PORT}/`)}`, { method: 'PUT' })
  ).json()

  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((ok, bad) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', bad, { once: true })
  })
  let next = 1
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? j(new Error(m.error.message)) : r(m.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((r, j) => {
      const id = next++
      pending.set(id, { resolve: r, reject: j })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.value
  }

  for (let i = 0; i < 120; i++) {
    if (await evalJs('!!window.__scene && !!window.__metro')) break
    await sleep(500)
  }
  if (!(await evalJs('!!window.__scene && !!window.__metro'))) {
    throw new Error('the game did not boot in the page (is game/dist current?)')
  }

  // The rail builds its tiles lazily; open the folders and wait for the images to
  // appear in the DOM, which means the game's own preview pass has run.
  const collected = await evalJs(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const byText = (t) => [...document.querySelectorAll('button, [role="button"]')].find((n) => (n.textContent || '').trim().startsWith(t))
    const out = {}
    const grab = () => {
      for (const img of document.querySelectorAll('img')) {
        const src = img.getAttribute('src') || ''
        if (!src.startsWith('data:image/png')) continue
        // The tile's own label is the nearest text under the same tile block.
        let node = img
        let label = ''
        for (let up = 0; up < 6 && node; up++) {
          node = node.parentElement
          const t = (node?.textContent || '').trim()
          if (t && t.length < 24) { label = t; break }
        }
        if (label && !out[label]) out[label] = src
      }
    }
    grab()
    for (const folder of ['设备', '装饰']) {
      const el = byText(folder)
      if (el) el.click()
      for (let i = 0; i < 40; i++) { grab(); await sleep(500) }
      if (el) el.click()
      await sleep(300)
    }
    // The sub-menus (楼梯 / 出入口 / 座椅 / 广告牌 / 玻璃板 / 门 / 站名 / 线网图 / 指示牌) fold
    // their variants out under a chevron; click every tile that has one.
    for (const t of [...document.querySelectorAll('button, [role="button"]')]) {
      if (t.querySelector('svg[class*="chevron"], [data-chevron]')) t.click()
    }
    for (let i = 0; i < 30; i++) { grab(); await sleep(500) }
    return out
  })()`)

  mkdirSync(OUT, { recursive: true })
  let written = 0
  for (const [label, src] of Object.entries(collected)) {
    const b64 = src.split(',')[1]
    if (!b64) continue
    const name = label.replace(/[^\p{Script=Han}\w-]+/gu, '_').slice(0, 24) || `tile-${written}`
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(b64, 'base64'))
    written++
  }
  console.log(`game tiles: ${written} written to .preview/game-tiles/`)
  console.log(Object.keys(collected).join(', '))
  ws.close()
} finally {
  chrome.kill()
  server.close()
}
