// tools/shots.mjs — the concept sheets are photographs of the game now.
//
// Run `node tools/shots.mjs` at the repo root and it writes art/*.svg: one SVG
// per sheet, each holding a composed screenshot of the built game with the demo
// station (åŠ¨ç‰©å›­) loaded. This replaces the hand-drawn generators the sheets
// used to come from (tools/gen-art.mjs and the tools/sheets-*.mjs behind it).
//
// How it works, in order:
//
//   1. `game/dist` is served from a throwaway static server on 127.0.0.1. The
//      game is not rebuilt here — `npm run build:game` is what produces dist.
//   2. Headless Chrome (SwiftShader, so it renders without a GPU) is launched
//      over the DevTools protocol and pointed at that server. The page exposes
//      the live renderer as `window.__scene` and the store as `window.__metro`
//      (`game/src/app/boot.tsx`), which is what a shot aims and configures.
//   3. Each panel is framed by fitting the station's own bounds to the frame,
//      clamped to whichever half a å‰–åˆ‡ cut keeps, and captured. The crowd is
//      advanced at 16x first, so a photograph has people in it.
//   4. The panels are composed into the sheet by `tools/sheet-plan.mjs`, which
//      places each capture in the sheet's own coordinate system. The result is
//      embedded in the SVG as a data URI, so every sheet keeps its old file
//      name, stays one file, and needs no change in `web/`.
//
// Options:
//   --only 03,07       just those sheets
//   --out DIR          write elsewhere (default art/)
//   --width/--height   sheet pixels (default 1920x1080)
//   --chrome PATH      an explicit Chrome/Edge binary
//   --connect          use a browser already listening on --debugPort instead
//                      of starting one — useful to watch a run in a real window,
//                      and the way to shoot on a machine that will not let this
//                      script start a browser itself
//   --port/--debugPort the two localhost ports
//
// Requirements: `game/dist` must exist and be current, and Chrome or Edge must
// be installed (or already running, with --connect). Nothing here touches the
// source of the game.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import { SHEETS, SHOT_CSS, INTERFACE_CSS, STATION } from './sheet-plan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const GAME_DIST = join(repo, 'game', 'dist')

/* ------------------------------------------------------------------ args */

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const has = (name) => args.includes(`--${name}`)

const WIDTH = Number(flag('width', 1920))
const HEIGHT = Number(flag('height', 1080))
const OUT = resolve(repo, flag('out', 'art'))
// Sheets are numbered `01`…`13`; a shell that eats the leading zero (`2` for
// `02`) still names the same sheet.
const num = (s) => String(Number(s))
const onlyArg = args.includes('--only') ? flag('only', '') : ''
const ONLY = onlyArg
  .split(',')
  .map((s) => num(s.trim()))
  .filter((s) => s !== 'NaN' && s !== '0')
const PORT = Number(flag('port', 5399))
const DEBUG_PORT = Number(flag('debugPort', 9333))
const CONNECT = has('connect')
const PROBE = has('probe')

/* ------------------------------------------------------- the game, served */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function serveGame() {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url, 'http://localhost')
      let rel = decodeURIComponent(url.pathname)
      if (rel.endsWith('/')) rel += 'index.html'
      const file = join(GAME_DIST, normalize(rel).replace(/^([/\\])+/, ''))
      if (!file.startsWith(GAME_DIST)) return res.writeHead(403).end('no')
      const target = existsSync(file) ? file : join(GAME_DIST, 'index.html')
      try {
        const body = readFileSync(target)
        res.writeHead(200, {
          'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store',
        })
        res.end(body)
      } catch (err) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end(String(err))
      }
    })()
  })
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)))
}

/* ------------------------------------------------------------- the browser */

function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  for (const c of candidates) if (c && existsSync(c)) return c
  throw new Error('No Chrome or Edge found — pass --chrome PATH (or set CHROME_PATH).')
}

function launchChrome(binary) {
  const profile = join(tmpdir(), `metro-shots-${process.pid}`)
  const child = spawn(
    binary,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      `--crash-dumps-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--mute-audio',
      // No crash handler and no first-run work: both want to touch the user
      // profile, which is the first thing a locked-down or CI machine refuses.
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--no-service-autorun',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      // Software rendering: a build machine has no GPU, and SwiftShader is what
      // makes WebGL work under --headless either way.
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  return { child, profile }
}

async function debuggerUp() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok) return true
    } catch {
      /* not up yet */
    }
    await sleep(200)
  }
  return false
}

/** A CDP page: promise-based send, plus evaluate and screenshot sugar. */
class Page {
  constructor(ws, targetId) {
    this.ws = ws
    this.targetId = targetId
    this.id = 0
    this.pending = new Map()
    this.errors = []
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text)
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((ok, fail) => {
      this.pending.set(id, { resolve: ok, reject: fail })
      setTimeout(() => {
        if (this.pending.delete(id)) fail(new Error(`CDP timeout: ${method}`))
      }, 120000)
    })
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }

  /** A full-viewport PNG of the page, or one rect of it. */
  async png(clip) {
    const r = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    })
    return Buffer.from(r.data, 'base64')
  }

  async metrics(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    })
    await sleep(600)
  }
}

async function openPage(width, height) {
  const tab = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', fail, { once: true })
  })
  const page = new Page(ws, tab.id)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Log.enable')
  await page.metrics(width, height)
  return page
}

/* --------------------------------------------------------------- the shots */

/**
 * Size the canvas to a panel, so a capture has the panel's own aspect ratio and
 * its full pixels. The size is locked over the game's own `100%`, which its
 * ResizeObserver would otherwise put straight back.
 */
async function frameCanvas(page, w, h) {
  await page.eval(`(() => {
    const c = document.querySelector('canvas')
    c.style.setProperty('width', '${w}px', 'important')
    c.style.setProperty('height', '${h}px', 'important')
    return true
  })()`)
  const box = await page.eval(`(() => {
    const r = document.querySelector('canvas').getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  })()`)
  // The canvas is resized through its own ResizeObserver, so the renderer picks
  // the new size up a frame later. Wait for it to actually own those pixels —
  // capturing a clip of the wrong size is how a panel came back empty.
  for (let i = 0; i < 40; i++) {
    const ready = await page.eval(`(() => {
      const el = window.__scene.renderer.domElement
      return el.clientWidth === ${w} && el.clientHeight === ${h} && el.width === ${w} && el.height === ${h}
    })()`)
    if (ready) break
    await sleep(100)
  }
  return box
}

/**
 * Aim the camera and fit the station — or the half a å‰–åˆ‡ cut keeps — into the
 * frame's box, in the frame's own pixels. All the arithmetic happens in the
 * page, because it is three.js' vectors and the live renderer's bounds box the
 * numbers are for.
 *
 * `cam` is:
 *   * `from`  the world direction the station is seen from (normalised here),
 *   * `at`    the point the camera looks at,
 *   * `ortho` true for a flat projection, `up` for the camera's up vector,
 *   * `region` an explicit `{x,y,z: [min,max]}` to frame instead of the whole
 *     station, for a detail the whole station would shrink to nothing,
 *   * `pad`   breathing room around the framed region (1.06 is 6%),
 *   * `useKept` clamps the framed box to the half a å‰–åˆ‡ cut keeps, so a section
 *     fills its panel instead of floating in the middle of the removed half.
 */
async function aim(page, cam, box) {
  // A long lens. A building-view 45-degree lens would have to stand kilometres
  // back to frame a 131 m station and would splay its far end; 8 degrees is
  // nearly flat, and at this size the station's own depth still separates the
  // levels a section sheet is about.
  const fov = cam.fov ?? 8
  const pad = cam.pad ?? 1.06
  const region = cam.region ?? null
  const fit = await page.eval(`(() => {
    const s = window.__scene
    const cs = s.cameraSys
    const c = cs.camera
    const THREE = c.position.constructor
    // The frame the picture has to fill is the canvas itself: it was sized to
    // the panel, so its CSS pixels *are* the panel's. Measure it in CSS pixels —
    // never through the drawing buffer, which devicePixelRatio scales.
    const el = s.renderer.domElement
    const canvasW = el.clientWidth || window.innerWidth
    const canvasH = el.clientHeight || window.innerHeight
    const bounds = s.ctx.bounds
    const region = ${JSON.stringify(region)}
    const min = region ? new THREE(region.x[0], region.y[0], region.z[0]) : bounds.min
    const max = region ? new THREE(region.x[1], region.y[1], region.z[1]) : bounds.max
    const corners = []
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push(new THREE(x, y, z))
    if (${!!cam.useKept}) {
      const sec = window.__metro.getState().section
      const a = sec.orientation.azimuth * Math.PI / 180
      const n = [Math.sin(a), Math.cos(a), 0]
      const off = sec.offset || 0
      const an = sec.anchor
      for (const p of corners) {
        const d = n[0] * (p.x - an[0]) + n[1] * (p.y - an[1]) - off
        if (d > 0) { p.x -= n[0] * d; p.y -= n[1] * d }
      }
    }
    // The render loop runs controls.update() every frame, and OrbitControls
    // re-derives the camera's position from its own spherical state — hundreds of
    // metres out that arithmetic loses the camera and a shot came back blank.
    // Take the controls out of the loop while the photograph is taken; the next
    // aim() puts them back, and the camera's own placement stands.
    cs.controls.enabled = true
    // The perspective camera's aspect has to be the panel's: it is only ever set
    // when the window resizes, and a panel-shaped canvas never fires one.
    const aspect = canvasW / canvasH
    c.aspect = aspect
    c.fov = ${fov}
    const at = new THREE(${cam.at[0]}, ${cam.at[1]}, ${cam.at[2]})
    const worldUp = new THREE(${(cam.up || [0, 0, 1]).join(', ')})
    const unit = new THREE(${cam.from[0]}, ${cam.from[1]}, ${cam.from[2]}).normalize()
    const xAxis = new THREE().crossVectors(worldUp, unit)
    if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0)
    xAxis.normalize()
    const yAxis = new THREE().crossVectors(unit, xAxis).normalize()
    let ex = 0, ey = 0, ez = 0
    for (const p of corners) {
      const d = p.clone().sub(at)
      ex = Math.max(ex, Math.abs(d.dot(xAxis)))
      ey = Math.max(ey, Math.abs(d.dot(yAxis)))
      ez = Math.max(ez, Math.abs(d.dot(unit)))
    }
    // The content has to land inside this pixel box on the canvas, so solve it at
    // the box's **near face** rather than at the aim point: what has to fit in the
    // frame is the closest thing in the picture, and with a long lens that face
    // stands a whole box-depth nearer the camera, so a fit computed at the centre
    // would let the station grow straight out of the frame.
    // The lens covers z tan(fov/2) vertically, times the aspect horizontally, at a
    // distance z — so the distance is the larger of the two demands.
    const tan = Math.tan((${fov} * Math.PI / 180) / 2)
    const dist = ${pad} * Math.max(ey / tan, ex / (tan * aspect)) + ez
    c.position.copy(at).addScaledVector(unit, dist)
    c.near = Math.max(0.5, dist - ez * 2 - 50)
    c.far = dist + ez * 4 + 400
    c.updateProjectionMatrix()
    c.lookAt(at)
    cs.orthoOn = false
    cs.controls.enableZoom = true
    cs.controls.target.copy(at)
    cs.controls.enabled = false
    // Park the pointer in the middle of the canvas. CameraSystem's edge pan shoves
    // the camera whenever the pointer sits inside the canvas near an edge, and a
    // headless browser's pointer rests at (0, 0) — the top-left corner, which pans
    // continuously and walked the station out of every frame.
    cs.pointerX = canvasW / 2
    cs.pointerY = canvasH / 2
    cs.pointerButtons = 0
    cs.canvasW = canvasW
    cs.canvasH = canvasH
    let onScreen = null
    if (${!!process.env.SHOT_DEBUG}) {
      c.updateMatrixWorld(true)
      let mx = 0, my = 0
      for (const p of corners) {
        const v = p.clone().project(c)
        mx = Math.max(mx, Math.abs(v.x))
        my = Math.max(my, Math.abs(v.y))
      }
      onScreen = [Math.round(mx * canvasW), Math.round(my * canvasH)]
    }
    return { dist, ex, ey, ez, canvasW, canvasH, aspect, onScreen }
  })()`)
  await sleep(1200)
  return fit
}

/** The store flags (and the two renderer toggles) a shot runs with. */
async function setView(page, view = {}) {
  await page.eval(`(() => {
    const st = window.__metro.getState()
    const s = window.__scene
    const v = ${JSON.stringify(view)}
    if (v.hideUI !== undefined) st.setHideUI(v.hideUI)
    if (v.hideWalls !== undefined) st.setHideWalls(v.hideWalls)
    if (v.cutaway !== undefined) st.setCutaway(v.cutaway)
    if (v.hideSectionSurface !== undefined) st.setHideSectionSurface(v.hideSectionSurface)
    if (v.activeZ !== undefined) st.setActiveZ(v.activeZ)
    if (v.ghostOther !== undefined) st.setGhostOther(v.ghostOther)
    if (v.autoCeiling !== undefined) st.setAutoCeiling(v.autoCeiling)
    if (v.overlayOn !== undefined) st.setOverlay(v.overlayOn)
    if (v.gridVisible !== undefined) s.setGridVisible(v.gridVisible)
    if (v.azimuth !== undefined) {
      let g = 0
      while (window.__metro.getState().section.orientation.azimuth !== v.azimuth && g++ < 8) window.__metro.getState().rotateSection()
    }
    if (v.section) {
      if (v.section.anchor) window.__metro.getState().placeSection(v.section.anchor)
      if (v.section.offset !== undefined) window.__metro.getState().setSectionOffset(v.section.offset)
    }
    return true
  })()`)
  await sleep(700)
}

/**
 * Choose the stylesheet the sheet is photographed under: the clean frame (the
 * station and nothing else), the interface frame (the game as it is played), or
 * none at all.
 */
async function frame(page, css) {
  const text = css === null ? null : JSON.stringify(css)
  await page.eval(`(() => {
    let el = document.getElementById('shot-css')
    if (${text} === null) {
      if (el) el.remove()
      return true
    }
    if (!el) { el = document.createElement('style'); el.id = 'shot-css'; document.head.appendChild(el) }
    el.textContent = ${text}
    return true
  })()`)
  await sleep(600)
}

/* ----------------------------------------------------------- the composing */

/** One SVG per sheet, with every panel placed in the sheet's own pixels. */
function sheetSvg(sheet, panels, width, height) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${sheet.file.replace(/\.svg$/, '')}">`,
    `<title>${sheet.file.replace(/\.svg$/, '')}</title>`,
  ]
  panels.forEach((png, i) => {
    const p = sheet.panels[i]
    const [x, y, w, h] = p.place
    const href = 'data:image/png;base64,' + png.toString('base64')
    const id = `p${i}`
    parts.push(`<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs>`)
    // The capture is a fixed WIDTHxHEIGHT frame; `viewBox` plus `slice` scales
    // it to cover its rectangle, cropping the excess rather than distorting it.
    parts.push(
      `<image clip-path="url(#${id})" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="${href}"/>`,
    )
  })
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}

/* ------------------------------------------------------------------- main */

async function main() {
  if (!existsSync(GAME_DIST)) {
    console.error('game/dist is missing — run: npm run build:game')
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })

  const wanted = SHEETS.filter((s) => ONLY.length === 0 || ONLY.includes(num(s.id)))
  if (!wanted.length) {
    console.error(`no such sheet: ${ONLY.join(', ')}`)
    process.exit(1)
  }
  console.log(`shots: ${wanted.length} sheet(s) at ${WIDTH}x${HEIGHT} — out ${OUT}`)

  const server = await serveGame()
  let child = null
  if (CONNECT) {
    // Wait for a browser the user started, and leave it alone when the run ends.
    if (!(await debuggerUp())) {
      server.close()
      throw new Error(`nothing is listening on 127.0.0.1:${DEBUG_PORT} — start Chrome with --remote-debugging-port=${DEBUG_PORT}`)
    }
    console.log(`connect: 127.0.0.1:${DEBUG_PORT} (an existing browser)`)
  } else {
    const binary = findChrome(flag('chrome'))
    const launched = launchChrome(binary)
    child = launched.child
    if (!(await debuggerUp())) {
      child.kill()
      server.close()
      throw new Error(
        `Chrome did not open its debugging port (${DEBUG_PORT}). Start one by hand and pass --connect:\n` +
          `  "${binary}" --headless=new --remote-debugging-port=${DEBUG_PORT} about:blank`,
      )
    }
    console.log(`chrome: ${binary}`)
  }

  const page = await openPage(WIDTH, HEIGHT)
  await page.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
  // The demo station builds chunk by chunk; six seconds is a dressed station.
  await sleep(6000)
  if (!(await page.eval('!!window.__scene && !!window.__metro'))) {
    child?.kill()
    server.close()
    throw new Error('the game did not expose __scene/__metro — is game/dist current?')
  }
  await frame(page, SHOT_CSS)

  const report = []
  for (const sheet of wanted) {
    process.stdout.write(`  ${sheet.id}  ${sheet.file} … `)
    // The interface sheet is the game as it is played: its own layout, and the
    // station left exactly where the game puts it, so the canvas is not resized
    // for it and the capture is the whole window.
    await frame(page, sheet.interface ? INTERFACE_CSS : SHOT_CSS)
    if (!sheet.interface) {
      await page.eval(`(() => { window.__metro.getState().setHideUI(true); window.__scene.setGridVisible(false); return true })()`)
    }
    if (sheet.crowd) {
      // 16x until the station has a crowd, then back to real time so the
      // photographed frame is an ordinary one.
      await page.eval(`(() => { const st = window.__metro.getState(); st.setSpeed(16); st.setPlaying(true); return true })()`)
      await sleep(sheet.crowd)
      await page.eval(`(() => { window.__metro.getState().setSpeed(1); return true })()`)
      await sleep(1200)
    }

    const panels = []
    for (const panel of sheet.panels) {
      const [x, y, w, h] = panel.place
      const full = panel.cam === undefined
      if (sheet.interface) {
        // No resizing and no fit: the frame is the whole window, exactly as the
        // game lays itself out.
        if (panel.view) await setView(page, panel.view)
        await sleep(700)
        panels.push(await page.png())
        continue
      }
      if (!full) {
        await setView(page, panel.view)
        // The canvas becomes the panel, so the capture is the whole frame.
        const box = await frameCanvas(page, w, h)
        const fit = await aim(page, panel.cam, [w, h])
        if (process.env.SHOT_DEBUG) {
          console.log(
            `        fit ${w}x${h} dist=${fit.dist.toFixed(1)} ex=${fit.ex.toFixed(1)} ey=${fit.ey.toFixed(1)} ez=${fit.ez.toFixed(1)}` +
              ` aspect=${fit.aspect.toFixed(3)} needs ${(fit.ex * 2).toFixed(0)}x${(fit.ey * 2).toFixed(0)}m covers ${JSON.stringify(fit.onScreen)}`,
          )
        }
        if (PROBE) {
          console.log(
            `\n      [${x},${y},${w},${h}] canvas=${fit.canvasW}x${fit.canvasH}  d=${fit.dist.toFixed(1)}m` +
              `  content ${(fit.ex * 2).toFixed(0)}x${(fit.ey * 2).toFixed(0)}x${(fit.ez * 2).toFixed(0)}m`,
          )
        }
        if (process.env.SHOT_DEBUG) {
          const onScreen = await page.eval('JSON.stringify(window.__shotBox)')
          console.log(`        fits ${onScreen} of ${w}x${h}`)
        }
        if (!PROBE) {
          const shot = await page.png({ x: box.x, y: box.y, width: box.width, height: box.height })
          if (process.env.SHOT_DEBUG) {
            const dbg = await page.eval(`(() => {
              const cs = window.__scene.cameraSys
              const c = cs.camera
              const p = new (c.position.constructor)(67, 14, -9)
              const q = p.clone().project(c)
              return {
                pos: c.position.toArray().map((n) => Math.round(n)),
                target: cs.controls.target.toArray().map((n) => Math.round(n)),
                onScreen: [Math.round((q.x * 0.5 + 0.5) * window.innerWidth), Math.round((1 - (q.y * 0.5 + 0.5)) * window.innerHeight)],
                ptr: [cs.pointerX, cs.pointerY], inside: cs.pointerInside, enabled: cs.controls.enabled,
                client: [c.domElement ? 0 : 0],
                canvasEl: [window.__scene.renderer.domElement.clientWidth, window.__scene.renderer.domElement.clientHeight],
                png: ${shot.length},
                camKind: cs.orthoOn ? 'ortho' : 'perspective',
                orthoOn: cs.orthoOn, fov: c.fov,
              }
            })()`)
            console.log('\n        debug ' + JSON.stringify(dbg))
          }
          panels.push(shot)
        }
        continue
      }
      if (panel.view) await setView(page, panel.view)
      if (PROBE) continue
      panels.push(await page.png())
    }
    if (PROBE) continue

    const svg = sheetSvg(sheet, panels, WIDTH, HEIGHT)
    writeFileSync(join(OUT, sheet.file), svg)
    const kb = Math.round(svg.length / 1024)
    report.push({ file: sheet.file, kb })
    console.log(`${kb} kB`)
  }

  page.ws.close()
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${page.targetId}`).catch(() => {})
  child?.kill()
  server.close()

  console.log(`\nshots: wrote ${report.length} sheet(s) to ${OUT}`)
  if (page.errors.length) {
    console.log('page errors during the run:')
    for (const e of page.errors.slice(0, 5)) console.log('  ' + String(e).slice(0, 200))
  }
  void STATION
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

