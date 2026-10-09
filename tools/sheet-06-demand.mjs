// Concept 06 — the crowd's demand.
//
// The screenshots are the game's own **时刻 · 客流** window, photographed by
// `tools/render-ui-shots.mjs` in the four states the calendar derives — 节假日 /
// 工作日 / 周六 / 周日 — by pressing the window's own day buttons. So the curve, the
// grips, the knobs and the calendar are the ones a player authors the day with.
//
// The numbers are the game's too, and they are **imported rather than copied**: the
// modules below are the pure `sim/` files the window and the crowd both read
// (`demand.ts` for the shape and the two factors, `clock.ts` for the calendar), which
// Node can import directly because they carry no DOM. So a knob re-ranged or a
// coefficient retuned changes this sheet's text as well as its pictures, and the sheet
// cannot describe a day the simulation is not running.
//
// The main chart overlays a live preview using the sim's own samples and multipliers.
// In an image embed it demonstrates moving boundaries; opened as SVG it supports dragging.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUL, T, n, sheet, title } from './iso.mjs'
import { demandAnimation } from './demand-animation.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-ui-shots.mjs` leaves its pixels and its index. */
const SHOTS = resolve(repo, process.env.UI_SHOTS_DIR ?? join('.preview', 'ui-shots'))

/** The game's own palette, from the custom properties in `game/src/styles.css`. */
const G = {
  bg: '#06111d',
  line: '#1d3b58',
  text: '#d6e7f7',
  muted: '#7ea6c9',
  accent: '#55b6ff',
  ink: '#8fc4ee',
  warn: '#ffc861',
}

const W = 1600

/** One crop, by the state it was photographed in and the region it is. */
function loadShots() {
  const indexPath = join(SHOTS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(
      `no photographed interface in ${SHOTS} — run:\n  npm run build:game\n  node tools/render-ui-shots.mjs`,
    )
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const byShot = new Map()
  for (const shot of index.shots) {
    const crops = new Map()
    for (const crop of shot.crops) {
      const file = join(SHOTS, crop.file)
      if (!existsSync(file)) throw new Error(`interface image is missing: ${crop.file}`)
      crops.set(crop.name, { ...crop, href: `data:image/png;base64,${readFileSync(file).toString('base64')}` })
    }
    byShot.set(shot.id, { ...shot, crops })
  }
  byShot.demand = index.demand
  return byShot
}

/* -------------------------------------------------------------------- sheet */

export function artDemand() {
  const shots = loadShots()
  const cropOf = (shot, name) => {
    const c = shots.get(shot)?.crops.get(name)
    if (!c) throw new Error(`missing demand capture: ${shot}.${name}`)
    return c
  }
  const image = (crop, x, y, w) => `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(w * crop.rect.height / crop.rect.width)}" href="${crop.href}"/>`
  const g = [title(48, 62, '把早晚高峰，交给你的车站', '拖动蓝色营业边界与黄色高峰边界，试试车站能承受怎样的一天。')]
  const modal = cropOf('time', 'timeWindow'), mx = 48, my = 140, mw = 950
  const scale = mw / modal.rect.width, mh = modal.rect.height * scale
  g.push(image(modal, mx, my, mw))
  const curve = cropOf('time', 'curve'), spans = cropOf('time', 'curveSpans')
  g.push(demandAnimation(
    mx + (curve.box.x - modal.rect.x) * scale,
    my + (curve.box.y - modal.rect.y) * scale,
    curve.rect.width * scale, curve.rect.height * scale,
    { x: mx + (spans.box.x - modal.rect.x) * scale,
      y: my + (spans.box.y - modal.rect.y) * scale,
      w: spans.rect.width * scale, h: spans.rect.height * scale },
    { ...shots.demand, placeBox: b => ({ x: mx + (b.x - modal.rect.x) * scale,
      y: my + (b.y - modal.rect.y) * scale, w: b.width * scale, h: b.height * scale }) },
  ))
  const notes = [
    ['1  调整高峰', ['拖动时间边界，改变高峰持续多久。', '用下方滑块调整客流的强弱。']],
    ['2  换一天试试', ['选择工作日、周末或节假日，', '观察不同日子的客流压力。']],
    ['3  决定从哪里进站', ['每个出入口都能单独设置流量。', '把人群分散到不同入口。']],
  ]
  notes.forEach(([name, lines], i) => {
    const y = 202 + i * 145
    g.push(T(1040, y, name, { size: 23, weight: 800, fill: G.accent }))
    g.push(MUL(1040, y + 38, lines, { size: 18, fill: G.text, lh: 29 }))
  })
  const exits = cropOf('exits', 'inspector')
  g.push(image(exits, 1164, 646, 250))
  const bottom = Math.max(my + mh, 646 + 250 * exits.rect.height / exits.rect.width)
  g.push(T(48, bottom + 48, '增加客流后，运行车站：看看队伍先在哪里变长。', { size: 23, weight: 700, fill: G.warn }))
  return sheet(W, Math.ceil(bottom + 92), g.join(''))
}
