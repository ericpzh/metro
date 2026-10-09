// Photographs the game's real interface, region by region.
//
//   node tools/render-ui-shots.mjs [--w 1600] [--h 1000] [--out .preview/ui-shots]
//
// Sheet 07 is about the interface, and the only honest way to draw an interface is
// to photograph the one that ships: this boots the built game in headless Chrome,
// drives it into a few real states, and writes PNGs of the whole window and of each
// chrome region — the top bar, the build rail, the 信息栏, the status strip, the 时刻
// window — cropped to the elements' own bounding boxes, at 2× so their labels read.
//
// Nothing about the interface is stated in this file or on the sheet: the region
// names come from the DOM, the labels in the pictures are the ones the components
// render, and the readout values are the running simulation's (see `BottomBar.tsx`
// for 站内人数 / 最挤等级 / 闸机排队 …, `RAIL_FOLDERS` and `INSPECTOR_FOLDERS` in
// `rail/helpers.ts` for the two folder stacks, and `TopBar.tsx` for the speed group).
//
// The regions are found by class name, which is what the app's own layout CSS uses;
// a rename there is a failure here rather than a silently empty crop.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const DIST = join(repo, 'game', 'dist')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const width = Number(arg('w', 1600))
const height = Number(arg('h', 1000))
const DEVICE_SCALE = 1
const outDir = resolve(repo, arg('out', join('.preview', 'ui-shots')))
const PORT = Number(arg('port', 4197))
const DEBUG_PORT = Number(arg('debug-port', 9339))

/**
 * The chrome regions, by the class the app's own layout puts on them.
 *
 * `null` is the whole window — the game exactly as it lays itself out at the size it
 * was given — which is the one picture that needs no selector at all.
 */
const REGIONS = {
  window: null,
  topbar: '.topbar',
  rail: '.rail',
  inspector: '.panel',
  bottombar: '.bottombar',
  stage: '.stage',
  timeWindow: '.timeWindow',
  viewCube: '.viewNav',
  /** The 时刻 window's own pieces: the day's curve, and the clock card that opens it. */
  curve: '.dayCurve',
  clockCard: '.clockCard',
  curveSpans: '.curveSpans',
  knobs: '.knobs',
  calGrid: '.calGrid',
}

/**
 * A calendar date as the 时刻 window's own day button labels it — the real handler for
 * picking the day the station runs, which is what the curve is drawn for.
 */
const pickDate = (month, day, dayType) =>
  `(() => {
    const el = document.querySelector(${JSON.stringify(`[aria-label="${month} 月 ${day} 日 ${dayType}"]`)})
    if (!el) throw new Error('no day button for ${month}/${day} ${dayType}')
    el.click()
    return true
  })()`

/**
 * The states the interface is photographed in, in the order the sheet reads them.
 *
 * Each one is a real state a player can be in: the game running with a crowd at the
 * turnstiles, a build folder folded open, the 信息栏 showing its 视图 toggles, and the
 * 时刻 window up.
 *
 * `folders` is the **whole** folder state the state wants, not a set of toggles.
 * `metro:folder` is what AppShell dispatches for Shift+Q…U and Alt+Q…R and it flips a
 * folder, so a setup written as "open 设备" would mean the opposite on a second run or
 * after another state had already folded it — `setFolders` below works out the presses.
 * The rail opens on `工具` alone and the 信息栏 on all four (`LeftRail.tsx:104`,
 * `Inspector.tsx:36`).
 */
const DEFAULT_FOLDERS = {
  tools: true,
  rail: false,
  equipment: false,
  decor: false,
  surfaces: false,
  rooms: false,
  zones: false,
  info: true,
  view: true,
  exits: true,
  lines: true,
}

const SHOTS = [
  {
    id: 'played',
    note: '游戏在跑：左边建造栏，中间工地，右边信息栏，顶上一排控制，底下一排读数。',
    folders: { tools: true },
    setup: `(() => {
      const st = window.__metro.getState()
      const cs = window.__scene.cameraSys
      const THREE = cs.controls.target.constructor
      st.setTimePanel(false)
      st.setHideUI(false)
      st.setPlaying(false)
      st.setSpeed(1)
      // The camera stands where the **turnstiles** are, read off the station the
      // game loaded, and on the storey the document put them on — a shot of another
      // storey comes back as empty floor. The gates a crowd queues at are the one
      // place the interface and the simulation are in the same picture.
      const gates = st.station.modules.filter((m) => m.type === 'gate')
      if (!gates.length) return false
      const mid = gates.reduce((a, m) => [a[0] + m.x, a[1] + m.y, a[2] + m.z], [0, 0, 0]).map((v) => v / gates.length)
      const span = Math.max(
        Math.max(...gates.map((g) => g.x)) - Math.min(...gates.map((g) => g.x)),
        Math.max(...gates.map((g) => g.y)) - Math.min(...gates.map((g) => g.y)),
      )
      st.setActiveZ(gates[0].z)
      const target = new THREE(mid[0], mid[1], mid[2] + 1.2)
      const dir = new THREE(1, -1.05, 0.78).normalize()
      cs.controls.target.copy(target)
      cs.camera.position.copy(target).addScaledVector(dir, Math.max(22, span * 1.7))
      cs.camera.lookAt(target)
      cs.controls.update()
      cs.pointerInside = false
      return { gates: gates.length, storey: gates[0].z, span }
    })()`,
    crops: [
      // Supersample the overview too, so text and the 3D scene stay sharp when zoomed.
      ['window', 2],
      ['topbar', 2],
      ['bottombar', 2],
      ['rail', 2, 620],
      ['inspector', 2, 620],
      ['viewCube', 2],
    ],
  },
  {
    id: 'equipment',
    note: '设备 文件夹（Shift+E）：一件件可放置的东西，各自占几格、带不带变体。',
    folders: { tools: false, equipment: true },
    crops: [['rail', 2, 620]],
  },
  {
    id: 'surfaces',
    note: '材质 文件夹（Shift+T）：一格六个面，各刷各的。',
    folders: { equipment: false, surfaces: true },
    crops: [['rail', 2, 620]],
  },
  {
    id: 'view',
    note: '信息栏的 视图 文件夹（Alt+W）：图纸怎么画，和车站长什么样分开管。',
    folders: { surfaces: false, info: false, exits: false, lines: false, view: true },
    crops: [['inspector', 2, 620]],
  },
  {
    id: 'time',
    note: '时刻 · 客流：一天的客流曲线用手拖，日历上一个日期就是这一趟的第 1 天。',
    folders: { info: true, exits: true, lines: true },
    setup: `(() => { window.__metro.getState().setTimePanel(true); return true })()`,
    // The window's own pieces are captured beside it, so the sheet's callouts can sit
    // on boxes the DOM reported rather than on positions guessed from the picture.
    crops: [
      ['timeWindow', 2],
      ['curve', 2],
      ['curveSpans', 2],
      ['knobs', 2],
      ['calGrid', 2],
      ['clockCard', 2],
    ],
  },
  // The four day types the calendar derives, each picked on its own date button: the
  // curve is drawn for the day the station is running, so the same chart reads very
  // differently on 元旦 and on a Monday — a holiday carries more than a weekday and a
  // weekend a third of it, and the chart's own base line stays at the reference weekday.
  {
    id: 'time-workday',
    note: '换到 1 月 5 日，工作日。',
    setup: pickDate(1, 5, '工作日'),
    crops: [['curve', 2], ['clockCard', 2]],
  },
  {
    id: 'time-saturday',
    note: '1 月 10 日，周六。',
    setup: pickDate(1, 10, '周六'),
    crops: [['curve', 2], ['clockCard', 2]],
  },
  {
    id: 'time-sunday',
    note: '1 月 11 日，周日。',
    setup: pickDate(1, 11, '周日'),
    crops: [['curve', 2], ['clockCard', 2]],
  },
  {
    id: 'exits',
    note: '出入口：每一条口子自己一条进站速度，和一个开关。',
    folders: { tools: true, info: false, view: false, exits: true, lines: false },
    setup: `(() => { window.__metro.getState().setTimePanel(false); return true })()`,
    crops: [['inspector', 2, 430]],
  },
]

const server = await serveDir(DIST, PORT)
const session = await withPage({
  url: `http://127.0.0.1:${PORT}/`,
  profile: join(repo, '.preview', `.chrome-ui-shots-${process.pid}`),
  debugPort: DEBUG_PORT,
  windowSize: `${width},${height}`,
  verbose: Boolean(process.env.UI_VERBOSE),
})

/** One crop: the element's own box, or the whole viewport for `window`. */
const rectOf = (selector) =>
  session.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  })()`)

const shoot = async (clip) => {
  const r = await session.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    // CDP multiplies clip scale by device scale. Keep the requested output scale
    // independent of DPR.
    clip: { ...clip, scale: (clip.scale ?? 1) / DEVICE_SCALE },
  })
  if (!r?.data) throw new Error('no pixels came back')
  return Buffer.from(r.data, 'base64')
}

try {
  // Pin the viewport to the size the sheet wants before the game reads it, so the
  // app lays itself out for exactly these pixels.
  await session.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: DEVICE_SCALE,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  })

  await waitFor(session.evaluate, '!!window.__scene && !!window.__metro', { what: 'the game' })
  // The demo station builds chunk by chunk; a dressed station takes a few seconds.
  await session.evaluate('new Promise((ok) => setTimeout(ok, 6000))')
  await session.evaluate("(() => { window.__metro.getState().renameStation('地铁站'); return true })()")

  if (process.argv.includes('--probe')) {
    // What the station actually holds, so a camera can be aimed at real numbers
    // rather than at a guess: the modules by type, where the gate bank is, and the
    // box the loaded document occupies.
    const info = await session.evaluate(`(() => {
      const st = window.__metro.getState()
      const counts = {}
      for (const m of st.station.modules) counts[m.type] = (counts[m.type] || 0) + 1
      const gates = st.station.modules.filter((m) => m.type === 'gate')
      const gz = {}
      for (const g of gates) gz[g.z] = (gz[g.z] || 0) + 1
      const bounds = window.__scene.ctx.bounds
      const cs = window.__scene.cameraSys
      return {
        name: st.station.name,
        cells: st.station.cells.length,
        modules: st.station.modules.length,
        counts,
        gateZ: gz,
        gateMid: gates.length
          ? gates.reduce((a, m) => [a[0] + m.x, a[1] + m.y, a[2] + m.z], [0, 0, 0]).map((v) => +(v / gates.length).toFixed(1))
          : null,
        gateSpread: gates.length
          ? [Math.max(...gates.map((g) => g.x)) - Math.min(...gates.map((g) => g.x)), Math.max(...gates.map((g) => g.y)) - Math.min(...gates.map((g) => g.y))]
          : null,
        bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
        activeZ: st.activeZ,
        camera: cs.camera.position.toArray().map((v) => +v.toFixed(1)),
        target: cs.controls.target.toArray().map((v) => +v.toFixed(1)),
      }
    })()`)
    console.log(JSON.stringify(info, null, 1))
    await session.close()
    server.close()
    process.exit(0)
  }

  // The sheet is the interface as it is played, so nothing is hidden here — not the
  // nav cube, not the toast strip. The one thing switched off is the pointer's edge
  // pan, which would otherwise walk the camera off the station: a headless browser's
  // pointer rests at (0, 0), which is inside the canvas and against its edge.
  await session.evaluate(`(() => {
    const s = window.__scene
    const cs = s.cameraSys
    cs.pointerX = Math.round(window.innerWidth / 2)
    cs.pointerY = Math.round(window.innerHeight / 2)
    cs.pointerInside = false
    cs.pointerButtons = 0
    return true
  })()`)

  // A crowd, so the picture is a station with people in it and the readouts are live
  // ones. 16× until the platforms have filled, then back to real time so the
  // photographed frame is an ordinary one.
  await session.evaluate(`(() => { const st = window.__metro.getState(); st.setSpeed(16); st.setPlaying(true); return true })()`)
  await session.evaluate('new Promise((ok) => setTimeout(ok, 9000))')
  await session.evaluate(`(() => { const st = window.__metro.getState(); st.setPlaying(false); st.setSpeed(1); return true })()`)
  await session.evaluate('new Promise((ok) => setTimeout(ok, 1500))')

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const index = []
  let demand = null
  // Which folders are open, tracked here because `metro:folder` flips one rather
  // than naming a state: the presses a state needs are the ones it differs by.
  const folders = { ...DEFAULT_FOLDERS }
  const setFolders = async (target = {}) => {
    for (const [key, open] of Object.entries({ ...folders, ...target })) {
      if (folders[key] === open) continue
      await session.evaluate(`window.dispatchEvent(new CustomEvent('metro:folder', { detail: ${JSON.stringify(key)} }))`)
      folders[key] = open
      await session.evaluate('new Promise((ok) => setTimeout(ok, 260))')
    }
  }

  for (const shot of SHOTS) {
    await setFolders(shot.folders)
    if (shot.setup) await session.evaluate(shot.setup)
    await session.evaluate('new Promise((ok) => setTimeout(ok, 900))')
    // Keep the pointer parked mid-canvas between states too.
    await session.evaluate(`(() => {
      const cs = window.__scene.cameraSys
      cs.pointerX = Math.round(window.innerWidth / 2)
      cs.pointerY = Math.round(window.innerHeight / 2)
      cs.pointerInside = false
      return true
    })()`)
    await session.evaluate('new Promise((ok) => setTimeout(ok, 300))')

    const crops = []
    for (const [name, scale, maxH] of shot.crops) {
      const selector = REGIONS[name]
      const box = selector === null ? { x: 0, y: 0, width, height } : await rectOf(selector)
      if (!box || box.width < 4 || box.height < 4) {
        throw new Error(`${shot.id}: no box for \`${name}\` (${selector ?? 'the window'}) — did the class change?`)
      }
      // A region taller than the sheet has room for is cropped to its **top**,
      // where the folder stack and the first open folder are; the rail scrolls, so
      // its tail is not a different interface, only more of the same list. The
      // element's own full box is reported beside the captured rect, because a
      // sheet that labels a region wants the region and not the crop of it.
      const rect = maxH && box.height > maxH ? { ...box, height: maxH } : box
      const png = await shoot({ ...rect, scale })
      const file = `${shot.id}-${name}.png`
      writeFileSync(join(outDir, file), png)
      const px = { width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) }
      crops.push({ name, file, selector, box, rect, scale, px, kb: Math.round(png.length / 1024) })
      console.log(`  ${shot.id.padEnd(10)} ${name.padEnd(11)} ${rect.width}x${rect.height} @${scale}x -> ${px.width}x${px.height}  ${Math.round(png.length / 1024)} kB`)
    }
    if (shot.id === 'time') demand = await session.evaluate(`(() => {
      const s = window.__metro.getState().station
      const rect = el => { const b = el.getBoundingClientRect(); return { x:b.x, y:b.y, width:b.width, height:b.height } }
      return {
        input: { service:s.service, peaks:s.peaks, knobs:s.demand },
        baseRate: s.modules.reduce((sum,m) => m.type === 'exit' && m.cfg.open ? sum + Math.max(0,m.cfg.inRate) : sum, 0),
        sliders: [...document.querySelectorAll('.knob')].map(el => ({
          label:el.querySelector('.knobLabel').textContent,
          range:rect(el.querySelector('input')), value:rect(el.querySelector('.knobValue')),
        })),
      }
    })()`)
    index.push({ id: shot.id, note: shot.note, crops })
  }

  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ width, height, demand, shots: index }, null, 1))
  console.log(`ui shots: ${index.length} states -> ${outDir}`)
} finally {
  await session.close()
  server.close()
}
