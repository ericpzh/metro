// One headless browser, one static server, for tools that need to photograph the
// built game.
//
// Two tools want the same thing: a Chrome pointed at `game/dist`, driven over the
// debugging protocol, that can evaluate an expression in the page and hand back the
// result. `tools/game-tiles.mjs` uses it to capture the build rail's own tiles;
// `tools/render-module-cards.mjs` uses it to render the catalogue's cards. Keeping
// the launch, the CDP plumbing and the teardown here means a fix to any of them
// (a stale profile, a missing flag, a port race) is a fix for both.
//
// The `/json/new` tab, `Runtime.evaluate` and WebSocket details are the only CDP
// this needs; the page does the rest.

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

export function findChrome() {
  const found = CHROME_PATHS.find((p) => p && existsSync(p))
  if (!found) throw new Error('no Chrome or Edge found — set CHROME_PATH')
  return found
}

/** A static server for one built directory, with an SPA fallback. */
export function serveDir(root, port) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = join(root, normalize(url).replace(/^(\.\.[/\\])+/, ''))
    if (!existsSync(file) || url.endsWith('/')) file = join(root, 'index.html')
    if (!existsSync(file)) {
      res.writeHead(404).end('no')
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)))
}

/**
 * Launch Chrome on `url` and return a session whose `eval` runs expressions in the
 * page and resolves their value. `close()` tears everything down.
 *
 * `profile` defaults to a fresh directory per process. A fixed path is the obvious
 * choice and the wrong one: a headless Chrome that outlived its parent holds the
 * directory open, and the next run's `rmSync` then fails with EPERM on Windows
 * before it draws anything.
 */
export async function withPage({ url, profile, debugPort = 9335, windowSize = '1400,900', verbose = false, softwareGpu = process.env.METRO_BROWSER_GPU !== 'hardware' }) {
  const chromePath = findChrome()
  rmSync(profile, { recursive: true, force: true })
  // The profile's parent is often a gitignored scratch directory (`.preview/`)
  // that does not exist on a fresh clone; the log and the profile both live under it.
  mkdirSync(dirname(profile), { recursive: true })
  const logPath = `${profile}.log`
  const logFd = openSync(logPath, 'w')

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      // Browser checks may exercise real game audio, but test runs must stay silent.
      '--mute-audio',
      // SwiftShader: a headless box has no GPU, and the thumbnails are a WebGL
      // pass like any other.
      ...(softwareGpu ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--enable-logging=stderr',
      '--v=0',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      `--window-size=${windowSize}`,
      'about:blank',
    ],
    { stdio: ['ignore', logFd, logFd] },
  )

  let ws
  const close = async () => {
    try {
      ws?.close()
    } catch {
      /* already gone */
    }
    chrome.kill()
  }

  try {
    let up = false
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) {
          up = true
          break
        }
      } catch {
        /* not yet */
      }
      await sleep(250)
    }
    if (!up) {
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').slice(-12).join('\n') : '(no log)'
      if (verbose) console.error(log)
      throw new Error(`Chrome never opened its debugging port (${debugPort}). Its log, tail:\n${log}`)
    }

    const tab = await (
      await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    ).json()
    ws = new WebSocket(tab.webSocketDebuggerUrl)
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok, { once: true })
      ws.addEventListener('error', bad, { once: true })
    })

    let next = 1
    const pending = new Map()
    const eventWaiters = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.method && eventWaiters.has(m.method)) {
        for (const waiter of eventWaiters.get(m.method)) { clearTimeout(waiter.timer); waiter.resolve(m.params) }
        eventWaiters.delete(m.method)
      }
      if (m.id && pending.has(m.id)) {
        const { resolve: r, reject: j, timer } = pending.get(m.id)
        clearTimeout(timer)
        pending.delete(m.id)
        m.error ? j(new Error(m.error.message)) : r(m.result)
      }
    })
    const send = (method, params = {}) =>
      new Promise((r, j) => {
        const id = next++
        const timer = setTimeout(() => { pending.delete(id); j(new Error(`CDP ${method} timed out`)) }, 60000)
        pending.set(id, { resolve: r, reject: j, timer })
        ws.send(JSON.stringify({ id, method, params }))
      })

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
      return r.result.value
    }

    const waitForEvent = (method, timeoutMs = 60000) => new Promise((resolveEvent, reject) => {
      const waiter = { resolve: resolveEvent, reject, timer: setTimeout(() => {
        const waiters = eventWaiters.get(method)
        waiters?.delete(waiter)
        if (!waiters?.size) eventWaiters.delete(method)
        reject(new Error(`timed out waiting for ${method}`))
      }, timeoutMs) }
      if (!eventWaiters.has(method)) eventWaiters.set(method, new Set())
      eventWaiters.get(method).add(waiter)
    })
    const closeSession = async () => {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('browser session closed')) }
      pending.clear()
      for (const waiters of eventWaiters.values()) for (const waiter of waiters) {
        clearTimeout(waiter.timer); waiter.reject(new Error('browser session closed'))
      }
      eventWaiters.clear()
      await close()
    }
    return { evaluate, send, waitForEvent, close: closeSession, chromePath }
  } catch (err) {
    await close()
    throw err
  }
}

/** Poll a page predicate until it is true, or fail with a message. */
export async function waitFor(evaluate, expression, { tries = 120, every = 500, what = 'the page' } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expression)) return
    await sleep(every)
  }
  throw new Error(`${what} was never ready: ${expression}`)
}

/** Demo-dependent checks opt into their fixture; normal game startup is empty. */
export async function loadExampleStation(page, id = 'zoo') {
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro', { what: 'game shell' })
  await page.evaluate(`(() => {
    document.querySelector('.tutorialActions .ghost')?.click();
    window.__browserFixtureMetrics = window.__metro.getState().metrics;
    window.__metro.getState().loadReference(${JSON.stringify(id)});
  })()`)
  await waitFor(page.evaluate, '!!window.__metro.getState().metrics && window.__metro.getState().metrics !== window.__browserFixtureMetrics && window.__metro.getState().station.modules.length > 0', { what: 'example station worker frame' })
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    delete window.__browserFixtureMetrics;
    resolve();
  })))`)
}

/** Apply the same per-demo view presets as the in-game /benchmark route. */
export async function configureBenchmarkView(page, stationId, mode = 'regular') {
  if (!['zoo', 'tanwei'].includes(stationId) || !['regular', 'explode'].includes(mode)) {
    throw new Error(`Invalid benchmark view: ${stationId}/${mode}`)
  }
  await page.evaluate(`(() => {
    const state = window.__metro.getState();
    const regular = ${JSON.stringify(mode === 'regular')};
    const station = ${JSON.stringify(stationId)};
    state.setHideUI(regular && station === 'tanwei');
    state.setHideGround(regular && station === 'zoo');
    state.setGhostOther(true);
    if (regular && station === 'zoo') state.setActiveZ(-15);
  })()`)
  if (mode !== 'regular') {
    return page.evaluate(`(() => {
      const state = window.__metro.getState();
      return { stationId: ${JSON.stringify(stationId)}, mode: ${JSON.stringify(mode)}, activeZ: state.activeZ,
        hideUI: state.hideUI, hideGround: state.hideGround, ghostOtherLevels: state.ghostOtherLevels,
        camera: 'standalone exploded viewer' };
    })()`)
  }

  await waitFor(page.evaluate, `(() => {
    const scene = window.__scene;
    const state = window.__metro.getState();
    const station = state.station;
    const ctx = scene?.ctx;
    return !!scene && scene.framesRendered > 1 && !!station &&
      ctx.stationData?.cells?.length === station.cells.length && ctx.activeZ === state.activeZ &&
      ctx.hideUI === state.hideUI && ctx.hideGround === state.hideGround &&
      ctx.ghost === state.ghostOtherLevels;
  })()`, { tries: 240, every: 250, what: `${stationId} benchmark renderer` })
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const scene = window.__scene;
    if (${JSON.stringify(stationId)} === 'zoo') {
      scene.setViewDirection(scene.camera.position.clone().set(-1, 1, 1), false);
    }
    scene.zoomBy(2 / 3);
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })))`)
  return page.evaluate(`(() => {
    const state = window.__metro.getState(), scene = window.__scene;
    return { stationId: ${JSON.stringify(stationId)}, mode: ${JSON.stringify(mode)}, activeZ: state.activeZ,
      hideUI: state.hideUI, hideGround: state.hideGround, ghostOtherLevels: state.ghostOtherLevels,
      rendererState: { activeZ: scene.ctx.activeZ, hideUI: scene.ctx.hideUI,
        hideGround: scene.ctx.hideGround, ghostOtherLevels: scene.ctx.ghost },
      camera: ${JSON.stringify(stationId === 'zoo' ? 'TOP/N/W corner' : 'default isometric')},
      zoomFactor: 2 / 3,
      cameraPosition: scene.camera.position.toArray(), cameraTarget: scene.controls.target.toArray() };
  })()`)
}
