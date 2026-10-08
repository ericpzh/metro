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
import {
  DEFAULT_DEMAND,
  DEFAULT_DEMAND_INPUT,
  DEMAND_AM_HOUR,
  DEMAND_FLOOR,
  DEMAND_LIMITS,
  DEMAND_MIDDAY,
  DEMAND_MIDDAY_HOUR,
  DEMAND_PM_HOUR,
  DEMAND_SIGMA,
  DAY_TYPE_FACTOR,
  PERIOD_FACTOR,
} from '../game/src/sim/demand.ts'
import { CALENDAR_YEAR, DAY_TYPE_LABELS, DEFAULT_CALENDAR } from '../game/src/sim/clock.ts'
import { demandAnimation } from './demand-animation.mjs'

const timeText = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`
const spanText = span => `${timeText(span.from)}–${timeText(span.to)}`

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

/** The window, and the box it is drawn in. Its parts are badged from their own boxes. */
const MODAL_X = 48
const MODAL_Y = 172
const MODAL_W = 738

/** The four days the calendar can derive, as the window's own date buttons name them. */
const DAYS = [
  { shot: 'time', dayType: 'holiday', date: '1 月 1 日', col: G.warn, note: '元旦，节假日：曲线顶在基准线上面。' },
  { shot: 'time-workday', dayType: 'weekday', date: '1 月 5 日', col: G.accent, note: '周一，工作日：这就是基准，参考日型。' },
  { shot: 'time-saturday', dayType: 'saturday', date: '1 月 10 日', col: G.ink, note: '周六：轴还是顶到 110%，线却缩到一半。' },
  { shot: 'time-sunday', dayType: 'sunday', date: '1 月 11 日', col: G.ink, note: '周日：比周六再薄一点。' },
]

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
  return byShot
}

/* -------------------------------------------------------------------- sheet */

export function artDemand() {
  const shots = loadShots()
  const cropOf = (shot, name) => {
    const c = shots.get(shot)?.crops.get(name)
    if (!c) throw new Error(`the capture has no \`${shot}.${name}\` — re-run tools/render-ui-shots.mjs`)
    return c
  }
  const image = (crop, x, y, w = crop.rect.width, h = crop.rect.height) =>
    `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${crop.href}"/>`
  const head = (x, y, text, col = G.accent) => T(x, y, text, { size: 12.5, weight: 800, fill: col, ls: 1.2 })

  const g = []
  g.push(
    title(
      48,
      62,
      '一天的客流，自己拖',
      `拖动蓝色营业边界与黄色高峰边界，预览一天的客流变化；箭头键微调。每个出口自己的进站速度，再由时段和日历塑形。`,
    ),
  )

  /* ---------------- the window, with its parts marked ---------------- */
  const modal = cropOf('time', 'timeWindow')
  const scale = MODAL_W / modal.rect.width
  const modalH = modal.rect.height * scale
  g.push(image(modal, MODAL_X, MODAL_Y, MODAL_W, modalH))

  const at = (crop) => ({
    x: MODAL_X + (crop.box.x + crop.box.width / 2 - modal.rect.x) * scale,
    y: MODAL_Y + (crop.box.y + crop.box.height / 2 - modal.rect.y) * scale,
  })
  const badge = (p, num, col = G.accent, r = 14) =>
    `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${r}" fill="${col}" stroke="${G.bg}" stroke-width="2.5"/>` +
    T(p.x, p.y + 5, String(num), { size: 15, weight: 800, fill: G.bg, anchor: 'middle' })
  // The spans row is a line of text across the whole panel, so its badge goes at the
  // end of the row rather than on the middle of what it names.
  const spans = cropOf('time', 'curveSpans')
  const curve = cropOf('time', 'curve')
  g.push(demandAnimation(
    MODAL_X + (curve.box.x - modal.rect.x) * scale,
    MODAL_Y + (curve.box.y - modal.rect.y) * scale,
    curve.rect.width * scale, curve.rect.height * scale,
    { x: MODAL_X + (spans.box.x - modal.rect.x) * scale,
      y: MODAL_Y + (spans.box.y - modal.rect.y) * scale,
      w: spans.rect.width * scale, h: spans.rect.height * scale },
  ))
  g.push(badge({ x: MODAL_X + 16, y: at(curve).y }, 1, G.accent, 12))
  g.push(
    badge(
      {
        x: MODAL_X + (spans.box.x + spans.box.width - modal.rect.x) * scale - 18,
        y: MODAL_Y + (spans.box.y + spans.box.height / 2 - modal.rect.y) * scale,
      },
      2,
      G.accent,
      12,
    ),
  )
  g.push(badge(at(cropOf('time', 'knobs')), 3))
  // The month grid is a field of numbers, so its badge sits in the legend row under it
  // rather than on a date.
  const grid = cropOf('time', 'calGrid')
  g.push(
    badge(
      {
        x: MODAL_X + (grid.box.x + grid.box.width - modal.rect.x) * scale - 18,
        y: MODAL_Y + (grid.box.y + grid.box.height - modal.rect.y) * scale + 14,
      },
      4,
    ),
  )

  const KEY_X = MODAL_X + MODAL_W + 36
  const KEY_W = 1552 - KEY_X
  g.push(head(KEY_X, 200, '窗口里有什么'))
  const KEY = [
    { n: 1, name: '客流曲线', lines: ['看一天的客流变化。纵轴以工作日峰值为 100%，虚线表示基准。'] },
    { n: 2, name: '三段时间', lines: [`营业 ${spanText(DEFAULT_DEMAND_INPUT.service)} · 早高峰 ${spanText(DEFAULT_DEMAND_INPUT.peaks[0])} · 晚高峰 ${spanText(DEFAULT_DEMAND_INPUT.peaks[1])}。拖蓝色或黄色把手，预览边界变化。`] },
    { n: 3, name: '三个旋钮', lines: ['早高峰量、晚高峰量、波形陡峭度：只改形状，不改已经排好的车。'] },
    { n: 4, name: '日历', lines: [`${CALENDAR_YEAR} 年一整年，节假日和调休上班日都排好了。点一个日期，它就是这一趟的第 1 天。`] },
  ]
  let ky = 240
  for (const item of KEY) {
    g.push(badge({ x: KEY_X + 14, y: ky - 4 }, item.n, G.accent, 12))
    g.push(T(KEY_X + 36, ky, item.name, { size: 14, weight: 700, fill: G.text }))
    g.push(MUL(KEY_X + 36, ky + 22, item.lines, { size: 12, fill: G.muted, lh: 19 }))
    ky += 30 + item.lines.length * 19 + 16
  }
  // What the window is *for*: the shape, not the volume.
  g.push(`<rect x="${n(KEY_X)}" y="${n(ky + 6)}" width="${n(KEY_W)}" height="1" fill="${G.line}"/>`)
  g.push(head(KEY_X, ky + 34, '拖这个窗口，改的是形状'))
  g.push(
    MUL(KEY_X, ky + 60, [
      '实际进站速度 = 出入口自己的速度 ×（波形 × 时段系数 × 日历系数）。',
      '所以这里动的是曲线的高度和宽窄，出入口那里动的是总量。',
      '站台上的人、底栏的排队、最挤等级，都是这一条线放出来的人算的 ——',
      '窗口画的是哪条线，仿真放的就是哪条线。',
    ], { size: 12, fill: G.muted, lh: 20 }),
  )

  /* ---------------- the four day types the calendar derives ---------------- */
  const bandY = MODAL_Y + modalH + 66
  g.push(head(48, bandY - 16, '同一条曲线，四种日子'))
  g.push(
    T(300, bandY - 16, '日历系数只缩放高度，不动形状 —— 所以换一天，线不变，线的位置变。', { size: 12, fill: G.muted }),
  )

  const CELL_W = 580
  const CELL_H = 292
  DAYS.forEach((day, i) => {
    const cx = 48 + (i % 2) * 600
    const cy = bandY + Math.floor(i / 2) * CELL_H
    const card = cropOf(day.shot, 'clockCard')
    const curve = cropOf(day.shot, 'curve')
    g.push(
      T(cx, cy + 12, `${day.date}  ·  ${DAY_TYPE_LABELS[day.dayType]}`, { size: 13.5, weight: 800, fill: day.col }) +
        T(cx + 200, cy + 12, `× ${DAY_TYPE_FACTOR[day.dayType].toFixed(2)}`, { size: 13.5, weight: 800, fill: G.muted, mono: true }),
    )
    // The clock card is what says which day this is; the curve is what the day costs.
    g.push(image(card, cx + (CELL_W - card.rect.width) / 2, cy + 24))
    g.push(image(curve, cx, cy + 24 + card.rect.height + 12))
    g.push(T(cx, cy + 24 + card.rect.height + 12 + curve.rect.height + 20, day.note, { size: 11.5, fill: G.muted }))
  })

  // The per-exit speed is not in the 时刻 window at all: it belongs to each 出入口.
  const exits = cropOf('exits', 'inspector')
  const EX = 1252
  g.push(head(EX, bandY, '每个口子自己的速度'))
  g.push(image(exits, EX, bandY + 12))
  g.push(
    MUL(EX, bandY + 24 + exits.rect.height, [
      '进站速度是每个出入口自己的：',
      '0 – 6000 人/时，加上一个开关。',
      '关掉它，人就改走别的口子 ——',
      '波形管“什么时候来”，它管“从哪儿进”。',
    ], { size: 11.5, fill: G.muted, lh: 18 }),
  )

  /* ---------------- the model the pictures come from ---------------- */
  const numY = bandY + 2 * CELL_H + 46
  g.push(`<rect x="48" y="${n(numY - 30)}" width="1504" height="1" fill="${G.line}"/>`)
  g.push(head(48, numY, '曲线是这三个东西乘出来的'))

  const col = (x, title_, lines) => {
    g.push(T(x, numY + 26, title_, { size: 13, weight: 700, fill: G.text }))
    g.push(MUL(x, numY + 48, lines, { size: 11.5, fill: G.muted, lh: 18 }))
  }
  col(48, '波形 —— 一条底加三个高斯', [
    `底面 ${DEMAND_FLOOR} · 午间 ${DEMAND_MIDDAY_HOUR}:00 σ ${DEMAND_SIGMA.midday} h（高 ${DEMAND_MIDDAY}）`,
    `早高峰 ${String(DEMAND_AM_HOUR).padStart(2, '0')}:00 σ ${DEMAND_SIGMA.am} h`,
    `晚高峰 ${DEMAND_PM_HOUR}:00 σ ${DEMAND_SIGMA.pm} h`,
  ])
  col(560, '两档系数 —— 相乘', [
    `时段：高峰 ${PERIOD_FACTOR.peak} · 平峰 ${PERIOD_FACTOR.offpeak} · 夜间 ${PERIOD_FACTOR.late}`,
    `日历：工作日 ${DAY_TYPE_FACTOR.weekday} · 周六 ${DAY_TYPE_FACTOR.saturday} · 周日 ${DAY_TYPE_FACTOR.sunday}`,
    `节假日 ${DAY_TYPE_FACTOR.holiday} —— 比工作日还高，而且来得没预兆`,
  ])
  col(1080, '三个旋钮，写在档里', [
    `早高峰量 ${DEMAND_LIMITS.amPeak[0]} – ${DEMAND_LIMITS.amPeak[1]}（默认 ${DEFAULT_DEMAND.amPeak}）`,
    `晚高峰量 ${DEMAND_LIMITS.pmPeak[0]} – ${DEMAND_LIMITS.pmPeak[1]}（默认 ${DEFAULT_DEMAND.pmPeak}）`,
    `波形陡峭度 ${DEMAND_LIMITS.sharpness[0]} – ${DEMAND_LIMITS.sharpness[1]}（默认 ${DEFAULT_DEMAND.sharpness}）`,
  ])

  g.push(
    T(48, numY + 124, `这一年的节假日和调休上班日是排好的：${DEFAULT_CALENDAR.holidays.length} 个节假日、${DEFAULT_CALENDAR.workdays.length} 个调休上班日。窗口里的图、底栏的读数、站台上的人，读的都是同一份。`, {
      size: 11.5,
      fill: G.muted,
    }),
  )

  return sheet(W, Math.ceil(numY + 160), g.join(''))
}
