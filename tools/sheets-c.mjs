// Concept sheet 09 — the camera, the views, and the widget that drives them.
//
// Every tile on this sheet is a capture, and the sheet draws none of them: the view
// tiles are the stage, driven through the game's own calls by
// `tools/render-view-shots.mjs` (`CameraSystem.setPreset`, the 剖切 and 隐藏UI flags),
// and the 视图控件 tile is the game's own DOM (`.viewNav`), photographed element and
// all. Nothing about a view or a control is stated here — not the geometry, not the
// framing, not the projection, not the widget's labels or its slider range.
//
// What the sheet adds is the key that reaches each [tile] and the reading beside it,
// and the legend below, whose keys come from `app/windows/AppShell.tsx` and
// `ViewCube.tsx`.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { C, T, MUL, title, sheet, n } from './iso.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-view-shots.mjs` leaves its pixels and its index. */
const SHOTS = resolve(repo, process.env.VIEW_SHOTS_DIR ?? join('.preview', 'view-shots'))

/**
 * The view tiles, in reading order, followed by 视图控件 as the **sixth tile** — five
 * views and the control, two rows of three, which is what fills the top of the sheet.
 *
 * Each row is: the captured frame to show, the key that reaches it, its name, and what
 * a reader is meant to take from it. Every frame hides the street plane (隐藏地面),
 * because the station is mostly underground and the pavement is a lid over it; the
 * tiles shot closer than the preset framing say by how much.
 *
 * The five are five **different** views: the isometric, the plan, the cut seen at an
 * angle, the same cut seen square on from the south — the one view that shows the
 * storeys stacked and the circulation between them — and the hall at eye height. A
 * second isometric nearer in (a 站厅 · 贴近看) said nothing the first did not.
 *
 * The 平视 frame is the one the game has no key for: the capture finds a storey with
 * air over its floor and a cell with a clear run to stand in and looks down it, at head
 * height (`tools/render-view-shots.mjs`).
 */
const CARDS = [
  ['iso', '1', '等轴测建造视图 · 3×', '透视。方位 45°、俯仰 30°，推近三倍看站体'],
  ['plan', '2', '平面 / 俯视 · 4×', '正交。全站摊平推近四倍：五个楼层、两条线'],
  ['section', 'C · R · Y', '剖切 · 收起剖切面 · 4×', '剖切面立着切过站体最密的地方：C 剖开、R 转 90° 看进站厅、Y 收起半透明的面'],
  ['elevation', '4 · C · R×2', '正交 X-Z 剖面 · 3×', '剖开再正对着看：楼层怎么叠、楼扶梯怎么穿、闸机在哪一层'],
  ['eye', 'U + 平视', '站厅 · 平视', '站在站厅里，眼高看过去：这是玩家走进去看到的样子'],
]

/** The captured views, or a clear failure: a sheet that drew no camera would be worse. */
function loadShots() {
  const indexPath = join(SHOTS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(`no view shots in ${SHOTS} — run:\n  npm run build:game\n  node tools/render-view-shots.mjs`)
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const byId = new Map(index.views.map((v) => [v.id, v]))
  return {
    get(id) {
      const view = byId.get(id)
      if (!view) throw new Error(`no captured view "${id}" in ${indexPath}`)
      const file = join(SHOTS, view.file)
      if (!existsSync(file)) throw new Error(`view image is missing: ${view.file}`)
      return { ...view, href: `data:image/png;base64,${readFileSync(file).toString('base64')}` }
    },
  }
}

/* =================================================================== *
 * 09  CAMERA AND VIEWS
 * =================================================================== */
export function artViews() {
  const shots = loadShots()

  const X0 = 48
  const COLS = 3
  const CW = 478
  const CH = 272
  const GAP_X = 16
  const GAP_Y = 16
  const BOX_H = 172
  const boxW = CW - 24
  const W = X0 * 2 + COLS * CW + (COLS - 1) * GAP_X
  const TOP = 172
  /** The grid: the six views, the control in the seventh cell, two rows of three. */
  const rows = Math.ceil((CARDS.length + 1) / COLS)

  const g = []
  g.push(
    title(
      X0,
      62,
      '几个视角，同一座站',
      '动物园站：街上那层收起来，站点就在下面；用 1 / 2 / C 和 视图 里的开关各看一遍。',
    ),
  )

  /**
   * The width a key needs in its chip, at the 12 px the chips are set in: a CJK glyph is
   * a full em wide, everything else about 0.6 of one, plus the padding either side.
   */
  const keyChipW = (key) =>
    20 + [...key].reduce((w, ch) => w + (/[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 12 : 7.2), 0)

  /** One view: the frame's pixels, the key that reaches it, and what it is for. */
  const card = (col, row, id, key, label, note) => {
    const x = X0 + col * (CW + GAP_X)
    const y = TOP + row * (CH + GAP_Y)
    const shot = shots.get(id)
    const scale = Math.max(boxW / shot.width, BOX_H / shot.height)
    const iw = shot.width * scale
    const ih = shot.height * scale
    g.push(`<rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="14" fill="#111926" stroke="#243040"/>`)
    g.push(`<rect x="${x + 12}" y="${y + 12}" width="${boxW}" height="${BOX_H}" rx="9" fill="#0b1119"/>`)
    // The photograph, centred in the window and cropped by it — no letterbox, because
    // a view is a picture of a place rather than a diagram that must not be clipped.
    g.push(
      `<clipPath id="v-${id}"><rect x="${x + 12}" y="${y + 12}" width="${boxW}" height="${BOX_H}" rx="9"/></clipPath>` +
        `<image x="${n(x + CW / 2 - iw / 2)}" y="${n(y + 12 + (BOX_H - ih) / 2)}" width="${n(iw)}" height="${n(ih)}" clip-path="url(#v-${id})" href="${shot.href}"/>`,
    )
    // The key it answers to, as a chip in the corner — **sized to the key**, because the
    // keys are not all one character: `C · R · Y` is three of them, and a chip drawn to a
    // fixed 34 units leaves the last one hanging out over the picture.
    const kw = keyChipW(key)
    g.push(`<rect x="${n(x + CW - 12 - kw)}" y="${y + 18}" width="${n(kw)}" height="22" rx="6" fill="#1b2530" stroke="#2b3746"/>`)
    g.push(T(x + CW - 12 - kw / 2, y + 33, key, { size: 12, weight: 800, fill: '#9fd7ee', anchor: 'middle', mono: true }))
    g.push(T(x + 18, y + CH - 48, label, { size: 15.5, weight: 700, fill: '#eaf0f6' }))
    g.push(T(x + 18, y + CH - 26, note, { size: 12, fill: '#8fa0b3' }))
  }

  CARDS.forEach(([id, key, label, note], i) => card(i % COLS, Math.floor(i / COLS), id, key, label, note))

  // The sixth tile is the control itself — **photographed, not drawn**. It is the
  // game's own DOM (`.viewNav`), captured by the same pass that takes the views, so the
  // card cannot drift from the widget the player has: the cube's face labels, the ⌂
  // button, the two pan arrows, the depth rail and the 视场角 slider are all the
  // shipping ones, and the sheet states nothing about them it did not photograph.
  {
    const col = COLS - 1
    // The cell **after the last view**, which is what fills the grid: five views make
    // the widget the sixth tile, and the block tops out at two rows of three.
    const row = Math.floor(CARDS.length / COLS)
    const x = X0 + col * (CW + GAP_X)
    const y = TOP + row * (CH + GAP_Y)
    const shot = shots.get('widget')
    // **A tile the size of all the others.** The widget is a tall panel — its depth rail
    // stands beside the cube — and the window it goes in is a wide short one, so its
    // photograph is fitted **inside** the window: scaled by whichever side runs out
    // first and centred, which leaves the padding either side of it. Drawing it at the
    // window's full width, as this did, is what made the sixth tile twice the height of
    // the other five and left the grid looking broken. Nothing of the widget is cropped.
    const fit = Math.min(boxW / shot.width, BOX_H / shot.height)
    const iw = shot.width * fit
    const ih = shot.height * fit
    g.push(`<rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="14" fill="#111926" stroke="#243040"/>`)
    g.push(`<rect x="${x + 12}" y="${y + 12}" width="${boxW}" height="${BOX_H}" rx="9" fill="#0b1119"/>`)
    g.push(
      `<clipPath id="v-widget"><rect x="${x + 12}" y="${y + 12}" width="${boxW}" height="${BOX_H}" rx="9"/></clipPath>` +
        `<image x="${n(x + 12 + (boxW - iw) / 2)}" y="${n(y + 12 + (BOX_H - ih) / 2)}" width="${n(iw)}" height="${n(ih)}" clip-path="url(#v-widget)" href="${shot.href}"/>`,
    )
    g.push(T(x + 18, y + CH - 48, '视图控件', { size: 15.5, weight: 700, fill: '#eaf0f6' }))
    g.push(T(x + 18, y + CH - 26, '视图右上角就是它：拖立方转视角，箭头升降，滑块调镜头', { size: 12, fill: '#8fa0b3' }))
  }

  const ctrls = [
    ['中键拖拽', '360° 环绕：方位和俯仰都随便'],
    ['滚轮', '缩放；正交视图下是推拉'],
    ['指针推到画布边缘', '平移视图'],
    ['W A S D', '平移，按住 Shift 加速'],
    ['Ctrl + Q / E', '升降视图（相机和瞄准点一起动）'],
    ['1 / 2 / 4 / 5', '等轴测 / 平面 / 正交立面 / 正交侧立面'],
    ['3', '回到上一个自定义角度'],
    ['O', '切换正交 ↔ 透视'],
    ['Home', '框住当前楼层'],
    ['Ctrl + H', '回到默认视角（等轴测、透视、45°）'],
    ['C，再按 R', '剖切开 / 关，R 把切面转 90°'],
    ['X', 'X 光：其他楼层变虚影'],
    ['Y', '隐藏剖切面，只留切开的模型'],
    ['U', '隐藏UI：格网、楼层切片、界面一起收起来'],
    ['空格', '暂停 / 运行仿真'],
  ]

  /* ---- the controls, in the game's own keys ---- */
  // Below the grid: the six tiles are one size, so the row after the second one is free
  // and the legend takes the whole of it.
  const ly = TOP + rows * (CH + GAP_Y) + 24
  // **Sized to its content**: the pairs in two columns, the header above them, and a
  // row's worth of air under the last one. 空格 is the foot of the left column, and it
  // is the row a reader sees hanging out of the bottom when the panel's height is a
  // number someone typed rather than the rows it actually holds.
  const ROW = 24
  const KEY_W = 158
  const KEY_DX = KEY_W + 12
  const COL_DX = 520
  const ctrlRows = Math.ceil(ctrls.length / 2)
  const legendH = 66 + ctrlRows * ROW + 30
  g.push(`<rect x="${X0}" y="${ly}" width="${W - X0 * 2}" height="${legendH}" rx="14" fill="#111926" stroke="#243040"/>`)
  g.push(T(X0 + 24, ly + 34, '视口操作', { size: 14, weight: 800, fill: C.yellow, ls: 1.4 }))
  ctrls.forEach(([k, v], i) => {
    const x = X0 + 24 + (i % 2) * COL_DX
    const y = ly + 66 + Math.floor(i / 2) * ROW
    g.push(`<rect x="${x}" y="${y - 15}" width="${KEY_W}" height="20" rx="5" fill="#0f1620" stroke="#243040"/>`)
    g.push(T(x + 9, y, k, { size: 11, fill: '#9fd7ee', mono: true, weight: 700 }))
    g.push(T(x + KEY_DX, y, v, { size: 11.5, fill: '#a9b8c8' }))
  })
  g.push(T(X0 + 1024, ly + 66, '为什么这对搭站的人重要', { size: 12, weight: 800, fill: C.yellow, ls: 1.2 }))
  g.push(
    MUL(
      X0 + 1024,
      ly + 92,
      [
        '转着看，能知道空间对不对味；正交立面，才知道',
        '它行不行。竖向交通、净高、楼层叠合、竖井多深，',
        '只有 X-Z 视图会老实告诉你——所以两样都得有，',
        '落在同一个模型上，不用导出。',
      ],
      { size: 12, fill: '#a9b8c8', lh: 20 },
    ),
  )
  g.push(T(X0 + 1024, ly + 176, '正交视图 = 图纸。透视视图 = 现场。', { size: 12, fill: '#7d8ea3' }))

  const H = ly + legendH + 26
  return sheet(W, H, g.join(''))
}
