// Concept 07 — the interface.
//
// Every picture on this sheet is a **photograph of the shipping game**, taken by
// `tools/render-ui-shots.mjs` in headless Chrome: the whole window, each chrome
// region cropped to its own bounding box, and the states a player gets by folding a
// folder open or pressing the clock card. So the rail's tiles, the inspector's
// read-outs and the crowd at the turnstiles are the ones the game draws, at the size
// it draws them, rather than a mock of them.
//
// The region names and the colours are the game's own too. The accents below are the
// custom properties at the top of `game/src/styles.css` (`--accent`, `--ink`, `--muted`,
// `--panel`, `--line`), so the sheet is drawn in the palette the interface wears, and
// the boxes the numbered outlines sit on are the ones the capture measured off the DOM.
//
// What is left for this file is the reading layer: the numbered key, the region
// captions, and the vocabulary — which keys the tiles carry, which folders live in
// which column, and what the twelve read-outs are. Nothing here invents a control.
//
// It does not move. An interface sheet is a reference, and a panel that animated
// would read as a demo of the game rather than as the game's own chrome.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUL, T, n, sheet, title } from './iso.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-ui-shots.mjs` leaves its pixels and its index. */
const SHOTS = resolve(repo, process.env.UI_SHOTS_DIR ?? join('.preview', 'ui-shots'))

/**
 * The game's own palette, from the custom properties at the top of
 * `game/src/styles.css`. The sheet is drawn in the colours the interface wears, so a
 * screenshot does not sit in a frame that belongs to a different design.
 */
const G = {
  bg: '#06111d',
  panel: '#0b1b2c',
  line: '#1d3b58',
  text: '#d6e7f7',
  muted: '#7ea6c9',
  accent: '#55b6ff',
  ink: '#8fc4ee',
  good: '#4fd6a3',
  warn: '#ffc861',
  danger: '#ff7d5c',
}

const W = 1600
const H = 1780

/** The hero: the whole window, and the box the numbered outlines are drawn in. */
const HERO_X = 48
const HERO_Y = 176
const HERO_W = 960
const HERO_H = 600

/** The key column beside the hero. */
const KEY_X = 1040
const KEY_W = 512

/**
 * The four regions the columns band shows, left to right.
 *
 * Each note is written to its own column's width — the band is a row of real crops at
 * their own sizes, and a caption that runs past its crop lands on the next one.
 */
const COLUMNS = [
  { shot: 'played', crop: 'rail', x: 48, label: '建造栏 · 工具 展开', note: '工具、模式、开关。' },
  { shot: 'equipment', crop: 'rail', x: 296, label: '建造栏 · 设备 展开', note: '闸机、围栏、扶梯……' },
  { shot: 'view', crop: 'inspector', x: 544, label: '信息栏 · 视图 展开', note: '时钟卡常驻，下面四个文件夹。' },
  { shot: 'time', crop: 'timeWindow', x: 872, label: '时刻 · 客流', note: '一天的客流曲线用手拖；日历上一个日期就是一整趟。' },
]

/**
 * The captured shots, or a clear failure.
 *
 * The render needs a browser and the game's build, so it is a separate step by
 * design (`tools/render-ui-shots.mjs`); a sheet that silently drew nothing would be
 * worse than one that stops.
 */
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
  return { window: { width: index.width, height: index.height }, byShot }
}

/* ------------------------------------------------------------------ helpers */

/** One crop, by the state it was photographed in and the region it is. */
const cropOf = (shots, shot, name) => {
  const c = shots.byShot.get(shot)?.crops.get(name)
  if (!c) throw new Error(`the capture has no \`${shot}.${name}\` — re-run tools/render-ui-shots.mjs`)
  return c
}

/**
 * A crop placed at the size the sheet wants, which is usually the **logical** size it
 * was measured at: the capture supersamples a region at 2× so the sheet can carry it
 * 1:1 and the browser downsamples the pixels, and only the hero is the other way
 * round — photographed below its own size because a full-colour 3D view is most of a
 * megabyte.
 */
const image = (crop, x, y, w = crop.rect.width, h = crop.rect.height) =>
  `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${crop.href}"/>`

/** A caption over a region. */
const head = (x, y, text) => T(x, y, text, { size: 12.5, weight: 800, fill: G.accent, ls: 1.2 })

/* -------------------------------------------------------------------- sheet */

export function artInterface() {
  const shots = loadShots()
  const g = []

  g.push(
    title(
      48,
      62,
      '游戏界面',
      '一屏四块：顶上控制、左边建造、中间工地、右边读数，底下一排数字。',
    ),
  )

  /* ---------------- the whole screen, with the regions marked ---------------- */
  const win = cropOf(shots, 'played', 'window')
  g.push(image(win, HERO_X, HERO_Y, HERO_W, HERO_H))

  // The scale the window was photographed at, so a region's own box lands on its
  // pixels — the boxes come from the capture's DOM measurements, not from here.
  const sx = win.px.width / shots.window.width
  const sy = win.px.height / shots.window.height
  const inHero = (box) => ({
    x: HERO_X + box.x * sx,
    y: HERO_Y + box.y * sy,
    w: box.width * sx,
    h: box.height * sy,
  })
  const boxOf = (shot, name) => inHero(cropOf(shots, shot, name).box)

  const topbar = boxOf('played', 'topbar')
  const rail = boxOf('played', 'rail')
  const panel = boxOf('played', 'inspector')
  const bottombar = boxOf('played', 'bottombar')
  const cube = boxOf('played', 'viewCube')
  // The stage is what is left between the three columns and the two bars; it is not
  // captured on its own, because a 1068 × 620 photograph of the 3D view is most of a
  // megabyte and the hero already holds it.
  const stage = {
    x: rail.x + rail.w,
    y: topbar.y + topbar.h,
    w: panel.x - (rail.x + rail.w),
    h: bottombar.y - (topbar.y + topbar.h),
  }

  const outline = (b, col) =>
    `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="7 5"/>`
  g.push(outline(topbar, G.accent))
  g.push(outline(rail, G.accent))
  g.push(outline(stage, G.accent))
  g.push(outline(panel, G.accent))
  g.push(outline(bottombar, G.accent))

  const badge = (x, y, num, col = G.accent) =>
    `<circle cx="${n(x)}" cy="${n(y)}" r="13" fill="${col}" stroke="${G.bg}" stroke-width="2.5"/>` +
    T(x, y + 5, String(num), { size: 14, weight: 800, fill: G.bg, anchor: 'middle' })
  // The two full-width bars are thin, so their badges sit where the bar is empty
  // rather than on the first control: the top bar's spacer, the bottom bar's gap
  // before FPS.
  g.push(badge(topbar.x + topbar.w / 2, topbar.y + topbar.h / 2, 1))
  g.push(badge(rail.x + rail.w / 2, rail.y + 30, 2))
  g.push(badge(stage.x + stage.w / 2, stage.y + stage.h / 2, 3))
  g.push(badge(cube.x + cube.w * 0.72, cube.y + cube.h * 0.5, 4, G.good))
  g.push(badge(panel.x + panel.w / 2, panel.y + 30, 5))
  g.push(badge(bottombar.x + bottombar.w * 0.72, bottombar.y + bottombar.h / 2, 6))

  /* ---------------- the key ---------------- */
  g.push(head(KEY_X, 196, '屏幕上有什么'))

  const KEY = [
    {
      n: 1,
      name: '顶栏  ·  1600 × 48',
      lines: [
        '地铁站设计师 · 车站名（点一下改名）· 新建 / 示例车站 / 保存 /',
        '打开 · 播放控制 暂停 1× 4× 16× 64× · 重启。',
        '那五个按钮只有图形，字在鼠标提示里。',
      ],
    },
    {
      n: 2,
      name: '建造栏  ·  232 px',
      lines: ['七个文件夹：工具 轨道 设备 装饰 材质 房间 分区。', 'Shift + Q W E R T Y U 一个键开一个，键印在文件夹上。'],
    },
    {
      n: 3,
      name: '工地',
      lines: ['车站本体，按你选的楼层切片。', '左键建造，右键拆掉，滚轮缩放，Q / E 上下走一层。'],
    },
    {
      n: 4,
      name: '视图立方  ·  高度尺',
      lines: ['顶 底 东 西 北 南六个面、X / Y / Z 轴、视角升降、视场角 45°。', '左边一列是楼层，单位是米：-12m。'],
    },
    {
      n: 5,
      name: '信息栏  ·  300 px',
      lines: [
        '时钟卡常驻：日期、星期、时段（高峰 / 平峰 / 夜间）、营业中。',
        '按它打开「时刻 · 客流」。下面四个文件夹：信息 视图',
        '出入口 线路，Alt + Q W E R 一个键开一个。',
      ],
    },
    {
      n: 6,
      name: '底栏  ·  42 px',
      lines: ['十二个读数：站内人数、最挤等级、闸机 / 扶梯 / 电梯 / 站台门四条', '队列、已上车、已出站、滞留、时间、FPS、方块数。'],
    },
  ]
  let ky = 232
  for (const item of KEY) {
    g.push(badge(KEY_X + 13, ky - 4, item.n))
    g.push(T(KEY_X + 36, ky, item.name, { size: 14, weight: 700, fill: G.text }))
    g.push(MUL(KEY_X + 36, ky + 22, item.lines, { size: 12, fill: G.muted, lh: 18 }))
    ky += 26 + item.lines.length * 18 + 20
  }

  /* ---------------- the two bars, full width ---------------- */
  const topbarCrop = cropOf(shots, 'played', 'topbar')
  const bottombarCrop = cropOf(shots, 'played', 'bottombar')
  const BAR_W = 1504
  const barH = (c) => (BAR_W / c.rect.width) * c.rect.height

  g.push(head(48, 816, '顶栏：车站名、文件、播放控制'))
  g.push(image(topbarCrop, 48, 826, BAR_W, barH(topbarCrop)))
  g.push(
    T(48, 826 + barH(topbarCrop) + 20, '左边是站名，右边全是图标键；中间那组 1× 4× 16× 64× 一次只亮一个。', {
      size: 11.5,
      fill: G.muted,
    }),
  )

  const barY = 826 + barH(topbarCrop) + 42
  g.push(head(48, barY, '底栏：仿真自己报的数'))
  g.push(image(bottombarCrop, 48, barY + 10, BAR_W, barH(bottombarCrop)))
  g.push(
    T(48, barY + 10 + barH(bottombarCrop) + 20, '每一个都来自这一秒的仿真：排队最长的那条会变黄，最挤等级 E / F 变红。', {
      size: 11.5,
      fill: G.muted,
    }),
  )

  /* ---------------- four regions at their own size ---------------- */
  const bandY = barY + 10 + barH(bottombarCrop) + 54
  g.push(head(48, bandY - 16, '四个区域，各自展开的样子'))
  // The tallest crop sets the band, so every caption sits on one line rather than
  // stepping down with whatever each region happens to be.
  const bandH = Math.max(...COLUMNS.map((c) => cropOf(shots, c.shot, c.crop).rect.height))
  for (const col of COLUMNS) {
    const crop = cropOf(shots, col.shot, col.crop)
    g.push(head(col.x, bandY + 12, col.label))
    g.push(image(crop, col.x, bandY + 22))
    g.push(T(col.x, bandY + 22 + bandH + 20, col.note, { size: 11.5, fill: G.muted }))
  }
  const bandBottom = bandY + 22 + bandH + 20
  // The 时刻 window is shorter than the two rails, so its column leaves a hole: the
  // panel's own controls go in it rather than into the caption line.
  const timeCrop = cropOf(shots, 'time', 'timeWindow')
  g.push(
    MUL(872, bandY + 22 + timeCrop.rect.height + 26, [
      '六个把手直接拖：开站、关站、两个高峰的开始与结束。',
      '三个旋钮改早高峰量、晚高峰量和波形陡峭度，',
      '它们只改形状，改不了已经排好的车。',
    ], { size: 11.5, fill: G.muted, lh: 18 }),
  )

  /* ---------------- the vocabulary ---------------- */
  const footY = bandBottom + 42
  g.push(`<rect x="48" y="${footY - 26}" width="1504" height="1" fill="${G.line}"/>`)
  g.push(
    MUL(48, footY, [
      '快捷键印在格子上，鼠标压上去才显形：',
      'Z 选择 · P 吸取 · F 方块 · B 删除 · G 墙 · N 单块 · M 整面',
      'T 分区 · L 站台 · Tab 生成墙壁 · R 旋转 · Ctrl+Z 撤销',
    ], { size: 12, fill: G.muted, lh: 19 }),
  )
  g.push(
    MUL(600, footY, [
      '两个文件夹梯子分属两根柱子，互不抢键：',
      '建造栏用 Shift + Q W E R T Y U，',
      '信息栏用 Alt + Q W E R。视图开关在信息栏里。',
    ], { size: 12, fill: G.muted, lh: 19 }),
  )
  g.push(
    MUL(1120, footY, [
      '没有钱，没有预算，没有小地图。',
      '机器报出来的数字只有底栏那十二个；',
      '格子本身的材质见第 03 张。',
    ], { size: 12, fill: G.muted, lh: 19 }),
  )

  return sheet(W, Math.ceil(footY + 70), g.join(''))
}
