// Procedural module models — the art pass behind PLAN §3 item 6 ("modules are
// ad-hoc boxes") and the reference photos in `docs/`. Every module the builder
// can place is a small three.js group built from boxes and planes, sharing one
// set of materials so the whole catalogue reads as one kit of steel, enamel,
// glass and screens.
//
//   TVM        售票机     stainless body, green housing, an LCD and a 车票 sign
//   vending    自动贩卖机  white cabinet, glass drink display, face-pay strip
//   gate       闸机      stainless cabinet, red wing, green/red lane lights
//   escalator  扶梯      truss, steps, glass balustrade, black handrail
//   exit       出入口    红色钢架, glass walls, a canopy over an up/down pair
//   PSD        站台门    glass screen, white mullions, orange header, red band
//   train      车辆      A/B/C/L stock, window band, blue livery, sliding doors
//
// Coordinate convention matches the mesher: cell (x,y,z) occupies
// [x,x+1]×[y,y+1]×[z,z+1], +z up. A module at (x,y,z) stands on top of its
// block, so its local origin is the cell centre at height z+1. Escalators, PSDs
// and trains are built in world space because they span more than one cell.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { facilityWallCells, SHOP_WALL_H } from '../build/model.ts'
import { TUNNEL_HEADROOM } from '../build/rail.ts'
import { ESCALATOR_SPEED, ESCALATOR_STEP_PITCH, PSD_HALF_HEIGHT } from '../sim/constants.ts'
import { billboardSpec } from '../sim/billboards.ts'
import { benchSpec } from '../sim/benches.ts'
import { normRot, rotateLocal } from '../sim/track.ts'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_BAY_HALF, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_H, EXIT_L, EXIT_REACH, exitBayCell, exitBayOffsets, exitBays, exitSide, exitWidth } from '../sim/exits.ts'
import { finishOf } from '../sim/finishes.ts'
import { fenceArms, railLandingAt } from '../sim/fences.ts'
import type { RampThin } from '../sim/openings.ts'
import { LIFT_STEP, liftStopZs } from '../sim/lifts.ts'
import { STAIR_WIDTH_NORMAL, stairFlights } from '../sim/stairs.ts'
import { doorCentres, STOCK, type StockClass } from '../sim/stock.ts'
import type { BillboardAspect, Cell, Face, FinishId, Module, RoomKind, StationData, Vec3i } from '../sim/types.ts'

/* ------------------------------------------------------------------ palette */

const C = {
  steel: 0xb7bdc4,
  darkSteel: 0x3c434c,
  black: 0x1b1e24,
  rubber: 0x14161a,
  gateRed: 0xbc3a2f,
  green: 0x1f9c63,
  blue: 0x1b6fd6,
  orange: 0xf0a128,
  /** Third-rail / catenary warning yellow, matching the art kit's `C.psu`. */
  psu: 0xf0c000,
  white: 0xeef1f4,
  exitRed: 0xc22f28,
  glass: 0xa8d8e6,
  trainBody: 0xbcc2ca,
  trainBlue: 0x1f5fd0,
  trainDark: 0x23272e,
  trainRoof: 0x8f959d,
  trainInterior: 0xe6dfd0,
  trainSeat: 0x4d6b8f,
} as const

/* --------------------------------------------------------------- materials */

export interface ModelMaterials {
  steel: THREE.MeshStandardMaterial
  darkSteel: THREE.MeshStandardMaterial
  black: THREE.MeshStandardMaterial
  rubber: THREE.MeshStandardMaterial
  gateRed: THREE.MeshStandardMaterial
  green: THREE.MeshStandardMaterial
  blue: THREE.MeshStandardMaterial
  orange: THREE.MeshStandardMaterial
  /** Warning yellow for the third rail and catenary fittings. */
  psu: THREE.MeshStandardMaterial
  white: THREE.MeshStandardMaterial
  exitRed: THREE.MeshStandardMaterial
  glass: THREE.MeshStandardMaterial
  tintedGlass: THREE.MeshStandardMaterial
  handrail: THREE.MeshStandardMaterial
  trainBody: THREE.MeshStandardMaterial
  trainBlue: THREE.MeshStandardMaterial
  trainDark: THREE.MeshStandardMaterial
  trainRoof: THREE.MeshStandardMaterial
  /** Inside of the train cabin, shown through an open door: back faces only. */
  trainInterior: THREE.MeshStandardMaterial
  trainSeat: THREE.MeshStandardMaterial
  /** Unlit canvases: LCD panels, LED strips, printed headers. */
  screen: THREE.MeshBasicMaterial
  /**
   * The 自动贩卖机 front control strip: the 刷脸支付 header, the promo card, the
   * payment panel, the keypad and the dispenser mouth, printed as one unlit
   * panel so the cabinet reads as a real vending machine.
   */
  vendingPanel: THREE.MeshBasicMaterial
  /** The 自动贩卖机 base band: the service hotline and phone number. */
  vendingBase: THREE.MeshBasicMaterial
  /**
   * The cycles of unlit advertisement posters a 装饰 screen plays (§5.7), one
   * set per aspect so a portrait billboard is not a stretched landscape. Each
   * set is cycled in step by `SceneRenderer.updateAds`.
   */
  adFramesWide: THREE.MeshBasicMaterial[]
  adFramesSquare: THREE.MeshBasicMaterial[]
  adFramesPortrait: THREE.MeshBasicMaterial[]
  /** The 指示牌 overhead sign face: the lit, double-sided wayfinding board. */
  signFace: THREE.MeshBasicMaterial
  /** The 货架 perforated back panel (dark charcoal pegboard). */
  shelfPanel: THREE.MeshStandardMaterial
  /** Base white material for the shelf goods; each instance tints it. */
  shelfGoods: THREE.MeshStandardMaterial
  ledGreen: THREE.MeshBasicMaterial
  ledRed: THREE.MeshBasicMaterial
  glow: THREE.MeshBasicMaterial
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d') as CanvasRenderingContext2D
  draw(g)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 4
  return t
}

/** Brushed stainless, matching the `metal` finish in materials.ts. */
function brushedCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#b7bdc4'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 700; i++) {
    const v = 150 + Math.floor(Math.random() * 70)
    g.fillStyle = `rgba(${v},${v + 4},${v + 8},0.22)`
    g.fillRect(0, Math.floor(Math.random() * 64), 64, 1)
  }
  return c
}

/** The blue ticketing UI on the TVM's LCD. */
function lcdCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#0d2b4a'
  g.fillRect(0, 0, 128, 96)
  g.fillStyle = '#2f7ef2'
  g.fillRect(0, 0, 128, 16)
  g.fillStyle = '#dfe8f5'
  g.font = 'bold 10px sans-serif'
  g.fillText('2 号线', 6, 12)
  g.fillStyle = '#1b4f86'
  for (let r = 0; r < 3; r++) for (let col = 0; col < 4; col++) g.fillRect(6 + col * 30, 24 + r * 20, 26, 16)
  g.fillStyle = '#9ec0e8'
  g.font = '9px sans-serif'
  g.fillText('选择目的地', 8, 36)
  g.fillStyle = '#47c07a'
  g.fillRect(88, 66, 34, 22)
  g.fillStyle = '#06301c'
  g.font = 'bold 9px sans-serif'
  g.fillText('购票', 96, 80)
  return c
}

/** The 车票 / Ticket marquee above a TVM, and the exit's signage. */
function signCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#12181f'
  g.fillRect(0, 0, 256, 64)
  g.strokeStyle = '#e8b23a'
  g.lineWidth = 3
  g.strokeRect(40, 6, 56, 52)
  g.fillStyle = '#e8b23a'
  g.font = 'bold 30px "Microsoft YaHei", sans-serif'
  g.fillText('车票', 48, 46)
  g.fillStyle = '#eef1f4'
  g.font = 'bold 22px sans-serif'
  g.fillText('Ticket', 118, 42)
  return c
}

/**
 * The 指示牌 face: a lit black wayfinding board following the reference photo —
 * white pictograms (lift, toilets, accessible, 出站 / Exit with an escalator),
 * two coloured line badges and a direction arrow. Drawn once per material set
 * and mapped onto both faces of the hung panel.
 */
function wayfindingCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const W = c.width
  const H = c.height
  g.fillStyle = '#0d1116'
  g.fillRect(0, 0, W, H)
  g.strokeStyle = '#3c434c'
  g.lineWidth = 6
  g.strokeRect(6, 6, W - 12, H - 12)

  const white = '#f4f7fa'
  g.strokeStyle = white
  g.fillStyle = white
  g.lineWidth = 6
  g.lineJoin = 'round'
  g.lineCap = 'round'

  // --- lift: a car outline with a person and up/down arrows -----------------
  g.strokeRect(34, 62, 92, 132)
  g.beginPath()
  g.arc(80, 100, 14, 0, Math.PI * 2)
  g.fill()
  g.fillRect(66, 120, 28, 40)
  for (const [ay, dir] of [[78, 1], [176, -1]] as const) {
    g.beginPath()
    g.moveTo(60, ay)
    g.lineTo(80, ay - 16 * dir)
    g.lineTo(100, ay)
    g.stroke()
  }

  // --- toilets: a male and a female figure ---------------------------------
  const figure = (x: number, dress: boolean): void => {
    g.beginPath()
    g.arc(x, 84, 15, 0, Math.PI * 2)
    g.fill()
    if (dress) {
      g.beginPath()
      g.moveTo(x, 104)
      g.lineTo(x - 26, 172)
      g.lineTo(x + 26, 172)
      g.closePath()
      g.fill()
    } else {
      g.fillRect(x - 16, 104, 32, 68)
    }
    g.fillRect(x - 18, 168, 12, 26)
    g.fillRect(x + 6, 168, 12, 26)
  }
  figure(176, false)
  figure(236, true)

  // --- accessible: a seated figure on a wheel ------------------------------
  g.beginPath()
  g.arc(310, 84, 15, 0, Math.PI * 2)
  g.fill()
  g.fillRect(300, 104, 20, 44)
  g.beginPath()
  g.arc(310, 168, 30, 0, Math.PI * 2)
  g.stroke()
  g.beginPath()
  g.moveTo(318, 138)
  g.lineTo(360, 150)
  g.stroke()

  // --- 出站 / Exit with an escalator pictogram ------------------------------
  g.fillStyle = white
  g.font = 'bold 74px "Microsoft YaHei", sans-serif'
  g.textBaseline = 'alphabetic'
  g.fillText('出站', 398, 152)
  g.font = 'bold 34px sans-serif'
  g.fillText('Exit', 402, 202)
  // Escalator glyph: a stepped diagonal with a rider.
  g.beginPath()
  g.moveTo(600, 196)
  g.lineTo(660, 196)
  g.lineTo(660, 170)
  g.lineTo(690, 170)
  g.lineTo(690, 130)
  g.stroke()
  g.beginPath()
  g.arc(676, 96, 13, 0, Math.PI * 2)
  g.fill()

  // --- line badges: 22号线 (orange) and 18号线 (blue) ------------------------
  const badge = (x: number, bg: string, digits: string): void => {
    g.fillStyle = bg
    g.fillRect(x, 54, 150, 148)
    g.fillStyle = '#ffffff'
    g.font = 'bold 46px "Microsoft YaHei", sans-serif'
    g.fillText(digits, x + 14, 116)
    g.font = 'bold 28px "Microsoft YaHei", sans-serif'
    g.fillText('号线', x + 14, 158)
    g.font = 'bold 20px sans-serif'
    g.fillText('Line ' + digits, x + 14, 190)
  }
  badge(716, '#e8541f', '22')
  badge(878, '#1b57c4', '18')

  // --- direction arrow ------------------------------------------------------
  g.strokeStyle = white
  g.lineWidth = 14
  g.beginPath()
  g.moveTo(958, 196)
  g.lineTo(1004, 122)
  g.stroke()
  g.beginPath()
  g.moveTo(982, 110)
  g.lineTo(1012, 112)
  g.lineTo(1008, 142)
  g.stroke()
  return c
}

/**
 * The 货架 back panel: a dark charcoal pegboard, the perforated steel backing of
 * a supermarket gondola. Drawn once per material set and repeated over the
 * panel face.
 */
function shelfPanelCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#343a42'
  g.fillRect(0, 0, 128, 256)
  // Vertical brushed streaks.
  g.fillStyle = '#3d444d'
  for (let x = 4; x < 128; x += 8) g.fillRect(x, 0, 2, 256)
  // Rows of punched holes.
  g.fillStyle = '#24282e'
  for (let y = 10; y < 256; y += 16) {
    for (let x = 8; x < 128; x += 16) {
      g.beginPath()
      g.arc(x + (y % 32 === 10 ? 8 : 0), y, 2.6, 0, Math.PI * 2)
      g.fill()
    }
  }
  return c
}

/**
 * The 自动贩卖机's right-hand control strip, drawn as one vertical panel: the
 * 刷脸支付 header, a red promo card, the payment-icon grid, the keypad and the
 * 取物口 dispenser mouth. Matches the reference photo's right column and maps
 * 1:1 onto the cabinet's 0.32 × 1.44 m front plate.
 */
function vendingPanelCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 576
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.textAlign = 'center'
  // Light metal backing.
  g.fillStyle = '#e7ebf0'
  g.fillRect(0, 0, 128, 576)
  // 刷脸支付 header.
  g.fillStyle = '#1f6fd6'
  g.fillRect(0, 0, 128, 68)
  g.fillStyle = '#ffffff'
  g.font = 'bold 20px "Microsoft YaHei", sans-serif'
  g.fillText('刷脸支付', 64, 34)
  g.font = '10px sans-serif'
  g.fillText('Face scan payment', 64, 52)
  // Red promo card (天猫优选).
  g.fillStyle = '#d3231e'
  g.fillRect(8, 78, 112, 92)
  g.fillStyle = '#ffd54a'
  g.font = 'bold 15px "Microsoft YaHei", sans-serif'
  g.fillText('天猫优选', 64, 112)
  g.fillStyle = '#ffffff'
  g.fillRect(18, 124, 92, 38)
  g.fillStyle = '#d3231e'
  g.font = 'bold 11px "Microsoft YaHei", sans-serif'
  g.fillText('1分钱乘车', 64, 149)
  // Payment method grid.
  g.fillStyle = '#ffffff'
  g.fillRect(8, 180, 112, 120)
  g.strokeStyle = '#cfd6de'
  g.lineWidth = 2
  g.strokeRect(8, 180, 112, 120)
  const icons = ['#07c160', '#1677ff', '#e64340', '#f0a128', '#1f6fd6', '#1b1e24']
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 2; col++) {
      const x = 30 + col * 54
      const y = 198 + r * 36
      g.fillStyle = icons[r * 2 + col]
      g.beginPath()
      g.arc(x, y, 11, 0, Math.PI * 2)
      g.fill()
    }
  }
  // Payment bar.
  g.fillStyle = '#1f6fd6'
  g.fillRect(8, 308, 112, 26)
  g.fillStyle = '#ffffff'
  g.font = 'bold 12px "Microsoft YaHei", sans-serif'
  g.fillText('请选择支付方式', 64, 326)
  // Numeric keypad.
  g.fillStyle = '#f2f5f8'
  g.fillRect(8, 342, 112, 100)
  g.fillStyle = '#3c434c'
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      g.beginPath()
      g.arc(30 + col * 34, 366 + r * 28, 9, 0, Math.PI * 2)
      g.fill()
    }
  }
  // 取物口 dispenser mouth.
  g.fillStyle = '#ffffff'
  g.fillRect(8, 452, 112, 116)
  g.fillStyle = '#9aa4ae'
  g.fillRect(18, 462, 92, 74)
  g.fillStyle = '#1f6fd6'
  g.fillRect(26, 542, 76, 18)
  g.fillStyle = '#ffffff'
  g.font = 'bold 12px "Microsoft YaHei", sans-serif'
  g.fillText('取物口', 64, 556)
  return c
}

/** The 自动贩卖机's base band: the service hotline printed on blue. */
function vendingBaseCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 384
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#1b6fd6'
  g.fillRect(0, 0, 384, 96)
  // A rounded white panel, inset like the photo's printed plate.
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.moveTo(40, 14)
  g.arcTo(344, 14, 344, 82, 14)
  g.arcTo(344, 82, 40, 82, 14)
  g.arcTo(40, 82, 40, 14, 14)
  g.arcTo(40, 14, 344, 14, 14)
  g.closePath()
  g.fill()
  g.textAlign = 'center'
  g.fillStyle = '#5b6570'
  g.font = '16px "Microsoft YaHei", sans-serif'
  g.fillText('客服热线 / 安美咨询', 192, 40)
  g.fillStyle = '#1b6fd6'
  g.font = 'bold 26px "Microsoft YaHei", sans-serif'
  g.fillText('4001-528-528', 192, 74)
  return c
}

/** A platform-screen header: white, a line band, and the direction sticker. */
function psdHeaderCanvas(colour: string, lineId: string, terminus: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#f4f6f8'
  g.fillRect(0, 0, 1024, 96)
  g.fillStyle = colour
  g.fillRect(0, 0, 1024, 18)
  g.fillStyle = '#ffffff'
  g.font = 'bold 44px "Microsoft YaHei", sans-serif'
  g.fillText('体育西路', 40, 66)
  g.font = '22px "Microsoft YaHei", sans-serif'
  g.fillText('Tiyu Xilu', 250, 66)
  // The line roundel.
  g.fillStyle = colour
  g.beginPath()
  g.arc(920, 58, 26, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = 'bold 30px sans-serif'
  g.textAlign = 'center'
  g.fillText(lineId, 920, 69)
  // Direction sticker. The destination is the line's own terminus for the
  // direction this screen serves (`mod.cfg.dir`), so the header reads the bound
  // line instead of a hardcoded place name. An unset terminus falls back to the
  // direction word.
  g.textAlign = 'left'
  g.fillStyle = '#1b6fd6'
  g.font = 'bold 22px "Microsoft YaHei", sans-serif'
  g.fillText(`◀ ${terminus}方向 →`, 470, 62)
  return c
}

/**
 * One advertisement frame for a 装饰 screen (§5.7). Three bright,
 * unlit posters cycle on the TV and the billboard, so the decoration reads as
 * "playing ads" instead of a dead panel. The canvas is drawn proportionally so
 * the same poster reads on a wide, square or portrait billboard. Kept procedural
 * like every other material — no image assets.
 */
function adCanvas(variant: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const themes: Array<{ bg: string; band: string; title: string; sub: string; accent: string }> = [
    { bg: '#c62828', band: '#ff8a3d', title: '限时优惠', sub: '扫码领券 · 全线通用', accent: '#ffe08a' },
    { bg: '#0d47a1', band: '#42a5f5', title: '新线开通', sub: '扫码乘车 · 快人一步', accent: '#a5f3ff' },
    { bg: '#1b5e20', band: '#66bb6a', title: '买一送一', sub: '车站商铺 · 今日专享', accent: '#d7ff9c' },
  ]
  const t = themes[((variant % themes.length) + themes.length) % themes.length]
  g.fillStyle = t.bg
  g.fillRect(0, 0, w, h)
  // A diagonal light sweep so the panel looks lit.
  g.fillStyle = 'rgba(255,255,255,0.10)'
  g.beginPath()
  g.moveTo(0, h)
  g.lineTo(w * 0.38, 0)
  g.lineTo(w * 0.58, 0)
  g.lineTo(w * 0.2, h)
  g.closePath()
  g.fill()
  g.fillStyle = t.band
  g.fillRect(0, 0, w, Math.round(h * 0.16))
  g.fillStyle = t.accent
  g.font = `bold ${Math.round(h * 0.3)}px "Microsoft YaHei", sans-serif`
  g.fillText(t.title, Math.round(w * 0.06), Math.round(h * 0.58))
  g.fillStyle = '#ffffff'
  g.font = `${Math.round(h * 0.13)}px "Microsoft YaHei", sans-serif`
  g.fillText(t.sub, Math.round(w * 0.07), Math.round(h * 0.83))
  // The metro roundel, bottom-right.
  g.strokeStyle = '#ffffff'
  g.lineWidth = Math.max(2, Math.round(h * 0.022))
  g.beginPath()
  g.arc(w * 0.87, h * 0.72, h * 0.12, -0.7, 3.7)
  g.stroke()
  g.beginPath()
  g.arc(w * 0.87, h * 0.72, h * 0.045, 0, Math.PI * 2)
  g.stroke()
  return c
}

/** One unlit ad material at a poster's canvas size. */
function adMaterial(variant: number, w: number, h: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: canvasTexture(w, h, (g) => g.drawImage(adCanvas(variant, w, h), 0, 0)), side: THREE.DoubleSide })
}

/** The exit portal header: the metro logo, station name and the exit's name. */
function exitHeaderCanvas(stationName: string, exitName: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#14181d'
  g.fillRect(0, 0, 512, 96)
  // Guangzhou Metro roundel, simplified.
  g.strokeStyle = '#fff'
  g.lineWidth = 5
  g.beginPath()
  g.arc(40, 48, 20, -0.6, 3.6)
  g.stroke()
  g.beginPath()
  g.arc(40, 48, 8, 0, Math.PI * 2)
  g.stroke()
  // Station name, then the exit's own name in the green identifier box, so
  // renaming an exit in the inspector reprints this header.
  g.fillStyle = '#f0a128'
  g.font = 'bold 30px "Microsoft YaHei", sans-serif'
  g.fillText(stationName, 78, 60)
  const label = (exitName || '口').slice(0, 2)
  g.fillStyle = '#1f9c63'
  g.fillRect(392, 18, 96, 60)
  g.fillStyle = '#fff'
  g.font = `bold ${label.length > 1 ? 32 : 42}px "Microsoft YaHei", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, 440, 50)
  return c
}

export function createModelMaterials(): ModelMaterials {
  const brushed = canvasTexture(64, 64, (g) => {
    const src = brushedCanvas()
    g.drawImage(src, 0, 0)
  })
  brushed.wrapS = brushed.wrapT = THREE.RepeatWrapping

  const steel = new THREE.MeshStandardMaterial({ map: brushed, color: 0xffffff, roughness: 0.34, metalness: 0.72 })
  const glass = new THREE.MeshStandardMaterial({
    color: C.glass,
    roughness: 0.06,
    metalness: 0.0,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
  })
  const tintedGlass = new THREE.MeshStandardMaterial({
    color: 0x8fb6c4,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  })
  return {
    steel,
    darkSteel: new THREE.MeshStandardMaterial({ color: C.darkSteel, roughness: 0.55, metalness: 0.4 }),
    black: new THREE.MeshStandardMaterial({ color: C.black, roughness: 0.6, metalness: 0.2 }),
    rubber: new THREE.MeshStandardMaterial({ color: C.rubber, roughness: 0.8, metalness: 0.05 }),
    gateRed: new THREE.MeshStandardMaterial({ color: C.gateRed, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
    green: new THREE.MeshStandardMaterial({ color: C.green, roughness: 0.3, metalness: 0.15 }),
    blue: new THREE.MeshStandardMaterial({ color: C.blue, roughness: 0.3, metalness: 0.2 }),
    orange: new THREE.MeshStandardMaterial({ color: C.orange, roughness: 0.4, metalness: 0.1 }),
    psu: new THREE.MeshStandardMaterial({ color: C.psu, roughness: 0.5, metalness: 0.15 }),
    white: new THREE.MeshStandardMaterial({ color: C.white, roughness: 0.45, metalness: 0.05 }),
    exitRed: new THREE.MeshStandardMaterial({ color: C.exitRed, roughness: 0.4, metalness: 0.35 }),
    glass,
    tintedGlass,
    handrail: new THREE.MeshStandardMaterial({ color: C.rubber, roughness: 0.55, metalness: 0.1 }),
    trainBody: new THREE.MeshStandardMaterial({ color: C.trainBody, roughness: 0.35, metalness: 0.55 }),
    trainBlue: new THREE.MeshStandardMaterial({ color: C.trainBlue, roughness: 0.3, metalness: 0.4 }),
    trainDark: new THREE.MeshStandardMaterial({ color: C.trainDark, roughness: 0.45, metalness: 0.3 }),
    trainRoof: new THREE.MeshStandardMaterial({ color: C.trainRoof, roughness: 0.5, metalness: 0.4 }),
    trainInterior: new THREE.MeshStandardMaterial({ color: C.trainInterior, roughness: 0.85, metalness: 0.05, side: THREE.BackSide }),
    trainSeat: new THREE.MeshStandardMaterial({ color: C.trainSeat, roughness: 0.7, metalness: 0.1 }),
    screen: new THREE.MeshBasicMaterial({ map: canvasTexture(128, 96, (g) => g.drawImage(lcdCanvas(), 0, 0)), side: THREE.DoubleSide }),
    vendingPanel: new THREE.MeshBasicMaterial({ map: canvasTexture(128, 576, (g) => g.drawImage(vendingPanelCanvas(), 0, 0)), side: THREE.DoubleSide }),
    vendingBase: new THREE.MeshBasicMaterial({ map: canvasTexture(384, 96, (g) => g.drawImage(vendingBaseCanvas(), 0, 0)), side: THREE.DoubleSide }),
    adFramesWide: [0, 1, 2].map((v) => adMaterial(v, 256, 128)),
    adFramesSquare: [0, 1, 2].map((v) => adMaterial(v, 192, 192)),
    adFramesPortrait: [0, 1, 2].map((v) => adMaterial(v, 144, 256)),
    signFace: new THREE.MeshBasicMaterial({ map: canvasTexture(1024, 256, (g) => g.drawImage(wayfindingCanvas(), 0, 0)) }),
    shelfPanel: new THREE.MeshStandardMaterial({ map: canvasTexture(128, 256, (g) => g.drawImage(shelfPanelCanvas(), 0, 0)), roughness: 0.6, metalness: 0.35 }),
    shelfGoods: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.05 }),
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x48e08a }),
    ledRed: new THREE.MeshBasicMaterial({ color: 0xff5d47 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xf7ecc8, side: THREE.DoubleSide }),
  }
}

export function disposeModelMaterials(m: ModelMaterials): void {
  for (const value of Object.values(m)) {
    const list = Array.isArray(value) ? value : [value]
    for (const mat of list as THREE.Material[]) {
      const t = (mat as THREE.MeshStandardMaterial).map
      if (t) t.dispose()
      mat.dispose()
    }
  }
}

/** Free every geometry a module group owns. Materials are shared, so kept. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) mesh.geometry.dispose()
  })
}

/* ------------------------------------------------------------------ helpers */

function slab(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

/**
 * A vertical plane. `yaw` spins it about z *after* it is tipped upright
 * (order `ZXY`), so the normal is a horizontal direction:
 *   0 → −y (the front/approach face), π → +y, π/2 → +x, −π/2 → −x.
 */
function plate(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, yaw: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  m.position.set(x, y, z)
  m.rotation.order = 'ZXY'
  m.rotation.set(Math.PI / 2, 0, yaw)
  parent.add(m)
  return m
}

/** Round the top rim of a cabinet with a slightly inset cap. */
function capTop(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, h = 0.06): void {
  slab(parent, mat, x, y, z + h / 2, sx * 0.94, sy * 0.94, h)
}

/* -------------------------------------------------------------- module kit */

export interface ModuleContext {
  mats: ModelMaterials
  data: StationData
  /** `x,y,z` key -> true for cells whose top finish is the track bed. */
  trackCells: Set<string>
  /** A floor/wall finish material, so a stair can wear the floor it serves. */
  finish: (id: FinishId) => THREE.Material
  /** True when building the translucent placement ghost, not a placed module. */
  preview?: boolean
}

/**
 * Build one placed module. Returns a group in world space, or null for a module
 * with nothing to draw. The caller owns disposal.
 */
export function buildModule(mod: Module, ctx: ModuleContext): THREE.Object3D | null {
  switch (mod.type) {
    case 'tvm':
      return placeLocal(buildTvm(ctx.mats), mod)
    case 'vending':
      return placeLocal(buildVending(ctx.mats), mod)
    case 'bench':
      return buildBench(ctx, mod)
    case 'shelf':
      return placeLocal(buildShelf(ctx.mats), mod)
    case 'desk':
      return placeLocal(buildDesk(ctx.mats), mod)
    case 'cubicle':
      return placeLocal(buildCubicle(ctx.mats), mod)
    case 'sink':
      return placeLocal(buildSink(ctx.mats), mod)
    case 'billboard':
      return buildBillboard(ctx, mod)
    case 'tv':
      return placeLocal(buildTv(ctx.mats), mod)
    case 'sign':
      return placeLocal(buildSign(ctx.mats), mod)
    case 'gate':
      return placeLocal(buildGate(ctx.mats), mod)
    case 'fence':
      return buildFence(ctx, mod)
    case 'exit':
      return placeLocal(buildExit(ctx, mod), mod)
    case 'escalator':
      return buildEscalator(ctx, mod)
    case 'stair':
      return buildStair(ctx, mod)
    case 'lift':
      return buildLift(ctx, mod)
    case 'platform-edge':
      return buildPsd(ctx, mod)
    case 'track':
      return buildTrack(ctx.mats, mod, ctx.preview)
    case 'shop':
      return buildRoom(ctx, mod)
    case 'booth':
      return buildBooth(ctx.mats, mod)
    case 'retail':
      return buildRoom(ctx, { ...mod, type: 'shop', cfg: { kind: 'store' } } as Extract<Module, { type: 'shop' }>)
    default:
      return null
  }
}

/** Position a locally-built group at its cell and apply the 90° rotation. */
function placeLocal(group: THREE.Group, mod: Module): THREE.Group {
  group.position.set(mod.x + 0.5, mod.y + 0.5, mod.z + 1)
  if (mod.rot) group.rotation.z = (mod.rot * Math.PI) / 2
  return group
}

/* ------------------------------------------------------------------- TVM */

/** Ticket machine (售票机): stainless body, green housing, LCD and a sign. */
function buildTvm(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  // Plinth and body.
  slab(g, mats.darkSteel, 0, 0.02, 0.06, 0.72, 0.64, 0.12)
  slab(g, mats.steel, 0, 0, 0.62, 0.68, 0.6, 1.0)
  // Green upper housing and the front cover around the slot.
  slab(g, mats.green, 0, 0, 1.3, 0.68, 0.6, 0.36)
  slab(g, mats.green, 0, -0.29, 0.62, 0.6, 0.06, 0.5)
  capTop(g, mats.darkSteel, 0, 0, 1.48, 0.72, 0.64)
  // Tilted LCD in a dark bezel.
  slab(g, mats.black, 0, -0.28, 1.03, 0.56, 0.06, 0.42)
  plate(g, mats.screen, 0.46, 0.3, 0, -0.315, 1.05, 0)
  // Card reader and the ticket slot.
  slab(g, mats.black, 0.24, -0.3, 1.28, 0.12, 0.04, 0.16)
  slab(g, mats.black, -0.12, -0.31, 0.42, 0.3, 0.03, 0.06)
  slab(g, mats.darkSteel, 0.2, -0.31, 0.7, 0.16, 0.03, 0.12)
  // The 车票 marquee on two posts.
  slab(g, mats.darkSteel, -0.26, 0, 1.56, 0.04, 0.04, 0.2)
  slab(g, mats.darkSteel, 0.26, 0, 1.56, 0.04, 0.04, 0.2)
  slab(g, mats.black, 0, 0, 1.72, 0.8, 0.08, 0.3)
  const sign = plate(g, new THREE.MeshBasicMaterial({ map: canvasTexture(256, 64, (c) => c.drawImage(signCanvas(), 0, 0)) }), 0.74, 0.24, 0, -0.05, 1.72, 0)
  sign.renderOrder = 1
  return g
}

/* --------------------------------------------------------------- vending */

/**
 * Vending machine (自动贩卖机): a tall white cabinet with a glass-fronted drink
 * display on the left and a face-pay control strip on the right, following the
 * reference photo. The same 1 × 1 m footprint as a TVM; the front faces −y.
 */
function buildVending(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  // Plinth and the white cabinet (its front face sits at y = −0.30).
  slab(g, mats.darkSteel, 0, 0.01, 0.06, 0.72, 0.58, 0.12)
  slab(g, mats.white, 0, 0.01, 0.97, 0.76, 0.62, 1.7)
  capTop(g, mats.darkSteel, 0, 0.01, 1.82, 0.78, 0.64)

  // The blue 温馨提示 banner across the top of the front.
  slab(g, mats.blue, 0, -0.301, 1.785, 0.72, 0.02, 0.07)

  // --- left glass display: dark cavity, five shelves, rows of drinks --------
  slab(g, mats.black, -0.17, -0.304, 1.01, 0.4, 0.012, 1.38)
  const drinks = [mats.orange, mats.green, mats.blue, mats.psu, mats.white, mats.gateRed]
  const shelfZ = [0.42, 0.68, 0.94, 1.2, 1.46]
  for (let s = 0; s < shelfZ.length; s++) {
    const z = shelfZ[s]
    slab(g, mats.steel, -0.17, -0.326, z - 0.011, 0.4, 0.036, 0.022)
    for (let col = 0; col < 4; col++) {
      const x = -0.32 + col * 0.1
      slab(g, drinks[(s * 4 + col) % drinks.length], x, -0.326, z + 0.095, 0.07, 0.036, 0.19)
      slab(g, mats.darkSteel, x, -0.326, z + 0.2, 0.045, 0.032, 0.022)
    }
  }
  // Glass door and its steel frame, with a handle at the opening edge.
  slab(g, mats.glass, -0.17, -0.354, 1.01, 0.42, 0.014, 1.4)
  slab(g, mats.darkSteel, -0.385, -0.354, 1.01, 0.03, 0.04, 1.4)
  slab(g, mats.darkSteel, 0.045, -0.354, 1.01, 0.03, 0.04, 1.4)
  slab(g, mats.darkSteel, -0.17, -0.354, 0.305, 0.46, 0.04, 0.03)
  slab(g, mats.darkSteel, -0.17, -0.354, 1.715, 0.46, 0.04, 0.03)
  slab(g, mats.darkSteel, 0.005, -0.366, 1.01, 0.025, 0.03, 0.5)

  // --- right control strip and the base hotline band ------------------------
  plate(g, mats.vendingPanel, 0.32, 1.44, 0.19, -0.306, 1.02, 0)
  plate(g, mats.vendingBase, 0.66, 0.165, -0.01, -0.306, 0.215, 0)
  return g
}

/* ----------------------------------------------------------------- bench */

/**
 * Bench (座椅, 装饰): one of the `sim/benches.ts` variants. The `steel` family is
 * the platform bench — a stainless seat pan on two posts with no back — while
 * the `seat` family is an upholstered seat with a back and arm rests that chains
 * into a row (a 2 m bench is two seats sharing a middle arm). Both run along
 * local +x with their back on the local −y side, so a run tiles against a
 * platform wall and the placement rotation turns the whole piece. The group is
 * placed at the run's centre, so a two-cell bench spans both of its cells.
 */
function buildBench(ctx: ModuleContext, mod: Extract<Module, { type: 'bench' }>): THREE.Group {
  const spec = benchSpec(mod.cfg.variant)
  const g = spec.style === 'steel' ? steelBench(ctx.mats, spec.w) : seatBench(ctx.mats, spec.w)
  const [dx, dy] = rotateLocal(mod.rot, (spec.w - 1) / 2, 0)
  g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2
  return g
}

/** The stainless platform bench: a seat pan on two posts, with no back. */
function steelBench(mats: ModelMaterials, w: number): THREE.Group {
  const g = new THREE.Group()
  const span = w === 1 ? 0.9 : 1.9
  // Seat pan, with a turned-down front lip over a heavier apron.
  slab(g, mats.steel, 0, -0.02, 0.46, span, 0.4, 0.06)
  slab(g, mats.steel, 0, 0.17, 0.4, span, 0.05, 0.14)
  slab(g, mats.darkSteel, 0, -0.02, 0.4, span - 0.08, 0.3, 0.03)
  // A post and a floor plate near each end.
  for (const x of [-span / 2 + 0.18, span / 2 - 0.18]) {
    slab(g, mats.steel, x, -0.02, 0.24, 0.07, 0.16, 0.42)
    slab(g, mats.darkSteel, x, -0.02, 0.015, 0.16, 0.22, 0.03)
  }
  return g
}

/** The upholstered seat: a blue cushion and back on a white frame, one per metre. */
function seatBench(mats: ModelMaterials, w: number): THREE.Group {
  const g = new THREE.Group()
  const seats = w
  const span = w === 1 ? 0.9 : 1.9
  const seatW = span / seats
  // A blue cushion and back for each seat, so a 2 m piece reads as two chained seats.
  for (let s = 0; s < seats; s++) {
    const cx = -span / 2 + seatW * (s + 0.5)
    slab(g, mats.white, cx, -0.04, 0.4, seatW - 0.08, 0.4, 0.05)
    slab(g, mats.trainSeat, cx, -0.04, 0.46, seatW - 0.12, 0.42, 0.08)
    slab(g, mats.white, cx, -0.38, 0.78, seatW - 0.08, 0.05, 0.6)
    slab(g, mats.trainSeat, cx, -0.32, 0.78, seatW - 0.12, 0.1, 0.56)
  }
  // A white arm frame at every seat edge, plus a rear top rail tying them together.
  for (let i = 0; i <= seats; i++) {
    const bx = -span / 2 + seatW * i
    slab(g, mats.white, bx, -0.04, 0.24, 0.07, 0.16, 0.44)
    slab(g, mats.white, bx, 0.08, 0.64, 0.07, 0.34, 0.06)
    slab(g, mats.white, bx, 0.23, 0.57, 0.06, 0.06, 0.14)
    slab(g, mats.darkSteel, bx, -0.04, 0.015, 0.14, 0.16, 0.03)
  }
  slab(g, mats.white, 0, -0.4, 1.08, span, 0.05, 0.05)
  return g
}

/* ----------------------------------------------------------------- shelf */

/** Overall height of a 货架 gondola above the floor top, metres. */
const SHELF_H = 1.9

/**
 * The goods on one shelf deck: a row of small, colourful packages (bags, boxes
 * and jars) drawn as one InstancedMesh, so a whole shelf costs a single draw
 * call. Instance colours vary by slot, so the row reads as a stocked shelf
 * without a mesh per product. `baseZ` is the deck top, `cx`/`cy` the unit centre.
 */
function shelfGoodsRow(g: THREE.Group, mats: ModelMaterials, cx: number, cy: number, baseZ: number, along: number, seed: number): void {
  const slots = 6
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.shelfGoods, slots)
  const m = new THREE.Matrix4()
  const col = new THREE.Color()
  const colours = [C.orange, C.gateRed, C.green, C.blue, C.psu, C.white, C.trainSeat, 0xb0703c]
  const spread = along - 0.12
  for (let i = 0; i < slots; i++) {
    const x = cx - spread / 2 + (spread * i) / (slots - 1)
    // A deterministic mix of product shapes and colours per shelf.
    const kind = (i + seed) % 3
    const w = kind === 0 ? 0.13 : kind === 1 ? 0.15 : 0.1
    const d = kind === 0 ? 0.08 : kind === 1 ? 0.11 : 0.1
    const h = kind === 0 ? 0.2 : kind === 1 ? 0.09 : 0.12
    m.makeScale(w, d, h)
    m.setPosition(x, cy, baseZ + h / 2)
    mesh.setMatrixAt(i, m)
    col.setHex(colours[(i * 3 + seed * 5) % colours.length])
    mesh.setColorAt(i, col)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  g.add(mesh)
}

/**
 * One goods-shelf unit (货架): a supermarket gondola following the reference —
 * a charcoal frame with a perforated back panel, five steel shelves each with a
 * white price rail, and a row of colourful goods. The stocked front faces the
 * local −y side (the game's default view) and the back panel sits on +y, so
 * `storeShelfSpots` turns a wall run to back onto its wall. `along` runs with
 * the aisle and `deep` across it, so the same unit is an island row, a wall run,
 * or a free-standing 装饰 piece. `z0` is the floor top.
 */
function shelfUnit(g: THREE.Group, mats: ModelMaterials, cx: number, cy: number, z0: number, along: number, deep: number): void {
  const x0 = cx - along / 2
  const x1 = cx + along / 2
  const yFront = cy - deep / 2
  const yBack = cy + deep / 2
  // Base plinth and the perforated back panel against the local +y edge.
  slab(g, mats.darkSteel, cx, cy, z0 + 0.09, along, deep, 0.18)
  slab(g, mats.shelfPanel, cx, yBack - 0.035, z0 + SHELF_H / 2, along - 0.06, 0.05, SHELF_H)
  // Two side uprights and a top cap.
  for (const x of [x0 + 0.03, x1 - 0.03]) slab(g, mats.darkSteel, x, cy, z0 + SHELF_H / 2, 0.06, deep, SHELF_H)
  slab(g, mats.darkSteel, cx, cy, z0 + SHELF_H - 0.03, along, deep, 0.06)
  // Five shelves, each a steel deck with a white price rail at the front.
  const levels = [0.42, 0.7, 0.98, 1.26, 1.54]
  for (let i = 0; i < levels.length; i++) {
    const deckZ = z0 + levels[i]
    slab(g, mats.steel, cx, cy - 0.02, deckZ, along - 0.12, deep - 0.1, 0.03)
    slab(g, mats.white, cx, yFront + 0.05, deckZ + 0.045, along - 0.12, 0.03, 0.07)
    shelfGoodsRow(g, mats, cx, cy - 0.02, deckZ + 0.015, along, i)
  }
}

/**
 * A free-standing shelf for the 装饰 folder: the store's own unit, one cell
 * wide, turning with the placement rotation via `placeLocal`.
 */
function buildShelf(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  shelfUnit(g, mats, 0, 0, 0, 0.96, 0.5)
  return g
}

/**
 * A free-standing office desk for the 装饰 folder: the 办公室 grid unit (leg
 * panel, desktop, monitor, chair), one cell wide, turning with the placement
 * rotation via `placeLocal`.
 */
function buildDesk(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  slab(g, mats.steel, 0, -0.22, 0.2, 1.0, 0.06, 0.42)
  slab(g, mats.darkSteel, 0, 0, 0.42, 1.1, 0.6, 0.06)
  slab(g, mats.screen, 0, 0, 0.62, 0.44, 0.08, 0.28)
  slab(g, mats.blue, 0, 0.44, 0.24, 0.42, 0.42, 0.08)
  slab(g, mats.blue, 0, 0.58, 0.5, 0.42, 0.08, 0.46)
  return g
}

/**
 * One restroom cubicle for the 装饰 folder: the 厕所 back-row unit (partition
 * on the cell's east edge, WC bowl + tank), facing the room (−y) at rot 0.
 */
function buildCubicle(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  slab(g, mats.steel, 0.47, 0, 0.9, 0.06, 1.0, 1.8)
  slab(g, mats.white, 0, -0.12, 0.2, 0.42, 0.62, 0.4)
  slab(g, mats.white, 0, 0.08, 0.42, 0.42, 0.28, 0.26)
  return g
}

/**
 * A wash basin for the 装饰 folder: the 厕所 front-wall unit (basin + tap),
 * facing the room (+y) at rot 0.
 */
function buildSink(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  slab(g, mats.steel, 0, -0.08, 0.45, 0.6, 0.5, 0.14)
  slab(g, mats.steel, 0, -0.08, 0.62, 0.06, 0.06, 0.24)
  return g
}

/* -------------------------------------------------------- wall decoration */

/** The poster frame set matching a billboard's aspect. */
function adSet(mats: ModelMaterials, aspect: BillboardAspect): THREE.MeshBasicMaterial[] {
  if (aspect === 'portrait') return mats.adFramesPortrait
  if (aspect === 'square') return mats.adFramesSquare
  return mats.adFramesWide
}

/**
 * Advertisement lightbox (广告牌): a framed, lit poster bolted flat to the wall
 * on the module's local −y face, so the 装饰 rotation picks which wall it hangs
 * on. Its lit face turns into the room (+y). The variant (`sim/billboards.ts`)
 * fixes the run length and the poster's aspect ratio: a one-cell landscape, a
 * tall portrait, a square, or a two-cell banner. `userData.adScreen` is the
 * poster mesh the scene cycles through the matching ad frames.
 */
function buildBillboard(ctx: ModuleContext, mod: Extract<Module, { type: 'billboard' }>): THREE.Group {
  const spec = billboardSpec(mod.cfg.variant)
  const frames = adSet(ctx.mats, spec.aspect)
  const g = new THREE.Group()
  // Place the group at the run's centre and turn it with the placement rotation,
  // so the poster hangs on the local −y wall for every variant and run length.
  const [dx, dy] = rotateLocal(mod.rot, (mod.w - 1) / 2, 0)
  g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1)
  g.rotation.z = (normRot(mod.rot) * Math.PI) / 2
  const { panelW: pw, panelH: ph, panelZ: pz } = spec
  // Housing flat against the wall, with a steel edge frame around it.
  slab(g, ctx.mats.darkSteel, 0, -0.42, pz, pw + 0.08, 0.16, ph + 0.2)
  slab(g, ctx.mats.steel, 0, -0.34, pz, pw + 0.12, 0.04, ph + 0.24)
  // The lit advertisement, facing into the room.
  const ad = plate(g, frames[0], pw, ph, 0, -0.315, pz, Math.PI)
  ad.renderOrder = 1
  ad.userData.adSet = frames
  // A small illuminated 广告 / AD bar under the frame.
  const barZ = pz - ph / 2 - 0.18
  slab(g, ctx.mats.black, 0, -0.36, barZ, Math.min(0.5, pw * 0.7), 0.03, 0.16)
  const label = plate(g, ctx.mats.glow, Math.min(0.42, pw * 0.6), 0.1, 0, -0.335, barZ, Math.PI)
  label.renderOrder = 1
  g.userData.adScreen = ad
  return g
}

/**
 * Advertising screen (电视, 装饰): a slim dark bezel with a bright screen playing
 * ads, hung by two rods from the storey ceiling like the 指示牌 — its face is
 * readable from either side. The floor top is the local origin and the ceiling
 * slab is one storey up (`LEVEL_STEPS`, 4 m = local z 3.0), which is exactly
 * what `ceilingMountMissing` required before it could be placed.
 * `userData.adScreen` is the screen mesh the scene animates.
 */
function buildTv(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const frames = mats.adFramesWide
  const sw = 1.0
  const sh = 0.72
  const zc = 2.15 // screen centre above the floor top
  const ceiling = 3.0 // the storey ceiling underside
  const depth = 0.1
  // Suspension rods and their ceiling plates.
  for (const x of [-0.38, 0.38]) {
    slab(g, mats.steel, x, 0, (zc + sh / 2 + ceiling) / 2, 0.05, 0.05, ceiling - (zc + sh / 2) - 0.04)
    slab(g, mats.darkSteel, x, 0, ceiling - 0.02, 0.16, 0.16, 0.04)
  }
  // An open bezel frame around the screen, so the ad reads from both faces.
  const bw = 0.07
  slab(g, mats.darkSteel, 0, 0, zc + sh / 2 + bw / 2, sw + 2 * bw, depth, bw)
  slab(g, mats.darkSteel, 0, 0, zc - sh / 2 - bw / 2, sw + 2 * bw, depth, bw)
  for (const x of [-(sw + bw) / 2, (sw + bw) / 2]) slab(g, mats.darkSteel, x, 0, zc, bw, depth, sh)
  // The glowing ad screen, DoubleSide, so it plays on both faces.
  const screen = plate(g, frames[0], sw, sh, 0, 0, zc, 0)
  screen.renderOrder = 1
  screen.userData.adSet = frames
  // Power / status light on the lower bezel.
  plate(g, mats.ledGreen, 0.05, 0.05, sw / 2 - 0.1, -depth / 2 - 0.005, zc - sh / 2, 0)
  g.userData.adScreen = screen
  return g
}

/* ----------------------------------------------------------------- sign */

/**
 * Overhead wayfinding sign (指示牌, 装饰): a lit black directional board hung by
 * two rods from the storey ceiling, readable from both faces. The floor top is
 * the local origin and the ceiling slab is one storey up (`LEVEL_STEPS`, 4 m =
 * local z 3.0), which is exactly what `ceilingMountMissing` required before the
 * piece could be placed. `placeLocal` turns the board with the placement
 * rotation, so R aims it along the concourse or across it.
 */
function buildSign(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const W = 1.9
  const H = 0.5
  const T = 0.08
  const zc = 2.35 // panel centre above the floor top
  const ceiling = 3.0 // the storey ceiling underside
  // Suspension rods and their ceiling plates.
  for (const x of [-0.6, 0.6]) {
    slab(g, mats.steel, x, 0, (zc + H / 2 + ceiling) / 2, 0.05, 0.05, ceiling - (zc + H / 2) - 0.04)
    slab(g, mats.darkSteel, x, 0, ceiling - 0.02, 0.16, 0.16, 0.04)
  }
  // Panel body: a dark steel frame around a black lightbox.
  slab(g, mats.darkSteel, 0, 0, zc, W, T, H)
  slab(g, mats.black, 0, 0, zc, W - 0.03, T + 0.012, H - 0.03)
  // The lit face on both sides, each drawn the right way up.
  for (const [y, yaw] of [[T / 2 + 0.012, Math.PI], [-T / 2 - 0.012, 0]] as const) {
    const face = plate(g, mats.signFace, W - 0.06, H - 0.06, 0, y, zc, yaw)
    face.renderOrder = 1
  }
  return g
}

/* ------------------------------------------------------------------ gate */

/**
 * Turnstile cabinet (闸机): steel, a red wing and lane lights.
 *
 * The cabinet stands on the cell's −x edge and the clear lane runs down the cell
 * centre — which is exactly the graph node the sim routes the crowd through. So
 * a passenger walks through the open lane, never through the stainless block.
 * The red leaf slides back into the cabinet as the gate opens (see
 * `setGateWing`); `SceneRenderer.updateGates` drives it as an agent arrives and
 * shuts it behind them. A run of gates tiles correctly: each lane is the gap
 * between one gate's cabinet and the next gate's cabinet.
 */
function buildGate(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const CAB = -0.5 // cabinet centre, on the cell's −x edge
  slab(g, mats.darkSteel, CAB, 0, 0.05, 0.44, 0.98, 0.1)
  slab(g, mats.steel, CAB, 0, 0.58, 0.42, 0.94, 0.96)
  capTop(g, mats.darkSteel, CAB, 0, 1.06, 0.46, 0.98, 0.08)
  // Reader pad and the pass / stop lights on the walk-up face.
  slab(g, mats.black, CAB, -0.28, 1.12, 0.3, 0.24, 0.03)
  plate(g, mats.ledGreen, 0.12, 0.07, CAB - 0.08, -0.14, 0.86, 0)
  plate(g, mats.ledRed, 0.12, 0.07, CAB + 0.12, -0.14, 0.86, 0)
  // The red wing is a sliding leaf, not a hinged one: its cabinet-side edge is
  // pinned to the cabinet face, and the far edge runs back into the cabinet as
  // the gate opens — the leaf compresses along its length instead of swinging.
  // A stub is always left proud of the panel, so the door never reaches zero
  // width and appears to vanish. The scene drives it through `setGateWing`.
  const WING = 0.58
  const edgeX = CAB + 0.21
  const wing = slab(g, mats.gateRed, edgeX + WING / 2, 0, 0.52, WING, 0.06, 0.66)
  wing.name = 'wing'
  wing.userData.fullW = WING
  wing.userData.edgeX = edgeX
  g.userData.wing = wing
  setGateWing(g, 0)
  // Blue accent stripe (the station's line colour family).
  slab(g, mats.blue, CAB, 0, 0.2, 0.43, 0.95, 0.05)
  return g
}

/** Metres of wing left proud of the cabinet when the gate is fully open. */
const WING_STUB = 0.06
/**
 * Set a turnstile's sliding wing. `open` 0 has the leaf shut across the lane,
 * 1 has it slid back into the cabinet. The leaf is compressed along its length
 * with the cabinet-side edge held fixed, so it reads as sliding into the panel
 * rather than rotating; a small stub always stays outside the panel.
 */
export function setGateWing(root: THREE.Object3D, open: number): void {
  const wing = root.userData.wing as THREE.Mesh | undefined
  if (!wing) return
  const fullW = (wing.userData.fullW as number) ?? 0.58
  const edgeX = (wing.userData.edgeX as number) ?? 0
  const s = 1 - open * (1 - WING_STUB / fullW)
  wing.scale.x = s
  wing.position.x = edgeX + (fullW * s) / 2
}

/* ----------------------------------------------------------------- fence */

/**
 * Fence (围栏, §5.2): a 1 m high, very thin metal frame around a glass panel,
 * standing through the middle of its block. One panel per cell; a dragged run
 * lays one per cell along the drag, and the rotation (R for a single, the drag
 * direction for a run) picks the main axis of a lone panel.
 *
 * Every panel is built from its neighbours, not from a fixed main axis, so all
 * joints are clean at 90°: a cell draws a half panel from its centre post to
 * each edge a fence or gate neighbour touches, and nothing toward an open edge.
 * A dead end (degree 1) or an isolated panel (degree 0, using `rot`) caps itself
 * to the far edge with an end post; a cell at an L, T or + junction has no cap,
 * so nothing overhangs past the turn. Because the geometry is derived from the
 * neighbours, dragging a new segment against an existing end regenerates that
 * end's block the moment it is committed — the old end post and overhang go.
 */
function buildFence(ctx: ModuleContext, mod: Extract<Module, { type: 'fence' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  // A fence connects to another fence or gate, and also to a stair/escalator
  // landing — the run's handrail reaches that cell, so the fence drops its end
  // cap and butts up to the railing instead of stopping short.
  const joined = (x: number, y: number): boolean =>
    ctx.data.modules.some((m) => (m.type === 'fence' || m.type === 'gate') && m.x === x && m.y === y && m.z === mod.z) ||
    railLandingAt(ctx.data.modules, x, y, mod.z)
  const e = joined(mod.x + 1, mod.y)
  const w = joined(mod.x - 1, mod.y)
  const n = joined(mod.x, mod.y + 1)
  const s = joined(mod.x, mod.y - 1)
  const { x0, x1, y0, y1, capE, capW, capN, capS } = fenceArms(mod.rot, { e, w, n, s })

  const POST = 0.08
  const post = (x: number, y: number): void => {
    slab(g, mats.darkSteel, x, y, 0.02, 0.16, 0.16, 0.04)
    slab(g, mats.steel, x, y, 0.5, POST, POST, 1.0)
  }
  // A panel run along X from x0 to x1 through the centre: top and bottom rails
  // with the glass between them. The glass spans the run exactly, so consecutive
  // cells' glass meets at the shared edge and the centre posts cover the seam.
  const railX = (a: number, b: number): void => {
    const len = b - a
    const cx = (a + b) / 2
    slab(g, mats.steel, cx, 0, 0.955, len, 0.07, 0.09)
    slab(g, mats.steel, cx, 0, 0.06, len, 0.07, 0.08)
    slab(g, mats.glass, cx, 0, 0.52, len, 0.03, 0.76)
  }
  const railY = (a: number, b: number): void => {
    const len = b - a
    const cy = (a + b) / 2
    slab(g, mats.steel, 0, cy, 0.955, 0.07, len, 0.09)
    slab(g, mats.steel, 0, cy, 0.06, 0.07, len, 0.08)
    slab(g, mats.glass, 0, cy, 0.52, 0.03, len, 0.76)
  }
  if (x1 - x0 > 1e-6) railX(x0, x1)
  if (y1 - y0 > 1e-6) railY(y0, y1)
  // Posts: the centre joint always, plus an end post on every capped end.
  post(0, 0)
  if (capE) post(0.46, 0)
  if (capW) post(-0.46, 0)
  if (capN) post(0, 0.46)
  if (capS) post(0, -0.46)
  // The orientation is baked into the geometry (neighbour arms + caps), so the
  // group is positioned but never rotated — a 180° turn is the same panel.
  g.position.set(mod.x + 0.5, mod.y + 0.5, mod.z + 1)
  return g
}

/* --------------------------------------------------- ramp-adjacent blocks */

/**
 * The half-metre blocks that stand in for a solid voxel a stair or escalator
 * runs against (`rampThinCells`, `sim/openings.ts`). The chunk mesher hides the
 * full voxel (see `hiddenCells`); each block is drawn in the half of the cell
 * *away* from the run, so the body and its handrail have the near half to
 * themselves while the wall or floor the player built stays solid. A floor keeps
 * its top finish (it is still a floor), a wall the finish on the face the run
 * sees. `userData.wall` lets 隐藏墙壁 fade it. One group per cell, tagged with its
 * cell so the caller can key it to the storey band.
 */
export function buildRampThins(ctx: ModuleContext, thins: readonly RampThin[]): THREE.Group[] {
  const T = 0.5
  const cellAt = new Map<string, Cell>()
  for (const c of ctx.data.cells) cellAt.set(`${c.x},${c.y},${c.z}`, c)
  const out: THREE.Group[] = []
  for (const t of thins) {
    const [sx, sy] = t.side
    const cell = cellAt.get(`${t.x},${t.y},${t.z}`) ?? {}
    // The face the ramp sees: opposite the outward side.
    const face: Face = sx > 0 ? 'w' : sx < 0 ? 'e' : sy > 0 ? 's' : 'n'
    const mat = ctx.finish(finishOf(cell, t.kind === 'floor' ? 'top' : face))
    let cx = t.x + 0.5
    let cy = t.y + 0.5
    let px = 1
    let py = 1
    if (sx !== 0) {
      px = T
      cx = t.x + (sx > 0 ? 1 - T / 2 : T / 2)
    } else {
      py = T
      cy = t.y + (sy > 0 ? 1 - T / 2 : T / 2)
    }
    const g = new THREE.Group()
    const mesh = finishSlab(g, mat, cx, cy, t.z + 0.5, px, py, 1)
    // Only a wall half block takes the 隐藏墙壁 fade; a floor half block is floor.
    mesh.userData.wall = t.kind === 'wall'
    g.userData.cell = [t.x, t.y, t.z]
    out.push(g)
  }
  return out
}

/* -------------------------------------------------------------- escalator */

/**
 * One escalator's rolling step band. The treads are world-horizontal (a real
 * escalator keeps its steps level as the chain climbs), so a run reads as a
 * staircase instead of a smooth ramp; `rollEscalator` then slides them up the
 * incline and wraps them at the comb plates, so the band really turns over.
 */
export interface EscalatorRoll {
  /** Instanced meshes sharing one matrix per step (tread + yellow nosing). */
  parts: THREE.InstancedMesh[]
  /** The step count (one instance each). */
  count: number
  /** Unit vector up the incline, from the lower landing to the upper one. */
  climb: THREE.Vector3
  /** Run length along the incline, metres. */
  runLen: number
  /** Step pitch along the incline, metres. */
  pitch: number
  /** +1 when the band carries a→b (which ascends), −1 when it descends. */
  dir: number
  /** Distance the band has rolled, wrapped into [0, runLen). */
  phase: number
  /** Tread yaw within the world-aligned band. */
  yaw: number
}

/** Wrap `v` into [0, m). */
function wrapMod(v: number, m: number): number {
  return ((v % m) + m) % m
}

// Scratch, reused across escalators and frames (rollEscalator runs every frame).
const _rot = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()

/** Advance a step band by `simDt` simulated seconds and repose every step. */
export function rollEscalator(roll: EscalatorRoll, simDt: number): void {
  roll.phase = wrapMod(roll.phase + roll.dir * ESCALATOR_SPEED * simDt, roll.runLen)
  _rot.makeRotationZ(roll.yaw)
  for (let i = 0; i < roll.count; i++) {
    const u = wrapMod(i * roll.pitch + roll.phase, roll.runLen)
    _p.copy(roll.climb).multiplyScalar(u)
    _m.makeTranslation(_p.x, _p.y, _p.z).multiply(_rot)
    for (const part of roll.parts) part.setMatrixAt(i, _m)
  }
  for (const part of roll.parts) part.instanceMatrix.needsUpdate = true
}

function buildEscalator(ctx: ModuleContext, mod: Extract<Module, { type: 'escalator' }>): THREE.Group {
  const mats = ctx.mats
  const a = new THREE.Vector3(mod.from.x + 0.5, mod.from.y + 0.5, mod.from.z + 1)
  const b = new THREE.Vector3(mod.to.x + 0.5, mod.to.y + 0.5, mod.to.z + 1)
  const len = a.distanceTo(b)
  const t = b.clone().sub(a).normalize()
  const up = new THREE.Vector3(0, 0, 1)
  const side = new THREE.Vector3().crossVectors(up, t).normalize()
  const n = new THREE.Vector3().crossVectors(t, side).normalize()
  const g = new THREE.Group()
  g.position.copy(a)
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, side, n))

  const W = 1.04 // balustrade spacing
  const rise = 1.0 // handrail height
  // Truss and side skirts — trimmed to the run, so the ramp never pokes past
  // its landings into the floor it connects to.
  slab(g, mats.darkSteel, len / 2, 0, -0.3, len, W, 0.34)
  slab(g, mats.steel, len / 2, W / 2, 0.0, len, 0.06, 0.62)
  slab(g, mats.steel, len / 2, -W / 2, 0.0, len, 0.06, 0.62)

  // The step band lives in a child that cancels the truss's rotation, so a box
  // left unrotated about z keeps its top face level and the run reads as steps.
  const ascends = b.z >= a.z
  const lower = ascends ? a : b
  const climb = t.clone().multiplyScalar(ascends ? 1 : -1) // unit, lower → upper
  const runPerM = Math.hypot(climb.x, climb.y) // horizontal advance per metre climbed
  const band = new THREE.Group()
  band.quaternion.copy(g.quaternion).invert()
  band.position.copy(lower).sub(a).applyQuaternion(band.quaternion)
  g.add(band)

  const yaw = Math.atan2(climb.y, climb.x)
  const stepW = W - 0.14
  const nSteps = Math.max(4, Math.round(len / ESCALATOR_STEP_PITCH))
  const pitch = len / nSteps // along the incline
  const stepRise = Math.max(0.05, climb.z * pitch) // vertical rise per step
  const stepRun = Math.max(0.05, runPerM * pitch) // horizontal advance per step
  // A step is a tread at the incline line with a riser standing on its upper
  // edge, plus the yellow nosing along the leading edge (real escalator steps).
  const tread = new THREE.BoxGeometry(stepRun * 1.02, stepW, 0.06).translate(0, 0, -0.03)
  const riser = new THREE.BoxGeometry(0.05, stepW, stepRise).translate(stepRun / 2, 0, stepRise / 2)
  const nosing = new THREE.BoxGeometry(0.06, stepW, 0.08).translate(stepRun / 2 - 0.03, 0, -0.01)
  const stepGeo = mergeGeometries([tread, riser])
  tread.dispose()
  riser.dispose()
  const steps = new THREE.InstancedMesh(stepGeo ?? new THREE.BufferGeometry(), mats.steel, nSteps)
  steps.frustumCulled = false // the band is reposed every frame
  band.add(steps)
  const noseMesh = new THREE.InstancedMesh(nosing, mats.orange, nSteps)
  noseMesh.frustumCulled = false
  band.add(noseMesh)

  // Glass balustrades and black handrails. The handrail wraps the end of the
  // glass at both landings — a half-turn in the balustrade plane from the top
  // edge, round the end, and down into the newel — instead of stopping dead.
  slab(g, mats.glass, len / 2, W / 2, rise / 2, len, 0.03, rise)
  slab(g, mats.glass, len / 2, -W / 2, rise / 2, len, 0.03, rise)
  slab(g, mats.handrail, len / 2, W / 2 + 0.03, rise, len, 0.1, 0.08)
  slab(g, mats.handrail, len / 2, -W / 2 - 0.03, rise, len, 0.1, 0.08)
  const railReturn = new THREE.TorusGeometry(rise / 2, 0.045, 8, 18, Math.PI)
  railReturn.rotateX(Math.PI / 2) // into the balustrade plane (local x-z)
  railReturn.rotateY(Math.PI / 2) // sweep top → +x → bottom
  for (const endX of [0, len]) {
    for (const s of [1, -1]) {
      const rail = new THREE.Mesh(railReturn, mats.handrail)
      rail.position.set(endX, s * (W / 2 + 0.03), rise / 2)
      if (endX === 0) rail.rotation.z = Math.PI // bulge the other way at the start
      g.add(rail)
    }
  }
  // Newel ends at both landings. The comb plates are separate: they are level
  // plates on the floor of each storey where the steps emerge. Each is pushed
  // out past the run's last tread (which overhangs the landing node) so the
  // rotating steps pass clear of it instead of clipping through.
  slab(g, mats.steel, 0.05, 0, -0.02, 0.5, W, 0.06)
  slab(g, mats.steel, len - 0.05, 0, -0.02, 0.5, W, 0.06)
  const hdir = new THREE.Vector3(climb.x, climb.y, 0).normalize()
  const plateLen = 0.5
  // The band's outer tread overhangs the landing node by about `stepRun / 2`.
  // The plate starts just past that and is pulled a quarter tile (0.25 m) back
  // in from the previous stand-off, so it sits at the foot of the run.
  const inner = stepRun / 2 - 0.15
  for (const dir of [-1, 1]) {
    const end = dir < 0 ? new THREE.Vector3() : climb.clone().multiplyScalar(len)
    const out = hdir.clone().multiplyScalar(dir * (inner + plateLen / 2))
    const comb = slab(band, mats.orange, end.x + out.x, end.y + out.y, end.z + 0.04, plateLen, W - 0.2, 0.05)
    comb.rotation.z = yaw
  }
  // Direction chevrons on the skirt, facing outward from each balustrade.
  for (let i = 0; i < 3; i++) {
    const x = len * (0.3 + i * 0.22)
    plate(g, mats.ledGreen, 0.22, 0.12, x, W / 2 + 0.04, 0.55, Math.PI)
    plate(g, mats.ledGreen, 0.22, 0.12, x, -W / 2 - 0.04, 0.55, 0)
  }
  const roll: EscalatorRoll = {
    parts: [steps, noseMesh],
    count: nSteps,
    climb,
    runLen: len,
    pitch,
    dir: ascends ? 1 : -1,
    phase: 0,
    yaw,
  }
  rollEscalator(roll, 0) // seat the band before its first animated frame
  g.userData.escalator = roll

  // Placement ghost only: a bright arrow over the run showing travel direction.
  // Local +x already runs `from → to` (the travel direction), so the arrow always
  // points that way — up an up escalator, down a down one.
  if (ctx.preview) {
    const arrowZ = rise + 0.5
    slab(g, mats.ledGreen, len * 0.33, 0, arrowZ, len * 0.5, 0.18, 0.1)
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 4), mats.ledGreen)
    head.rotation.z = -Math.PI / 2 // cone points +y by default; aim it +x
    head.position.set(len * 0.62, 0, arrowZ)
    g.add(head)
  }
  return g
}

/**
 * A staircase (楼梯). One storey of *real* steps, walked both ways: level treads
 * with a riser under each leading edge, not a ramp with grooves. A straight
 * stair is a single flight; a turning style is two flights meeting at a half or
 * quarter landing, which the model draws as a platform in the same surface and
 * the same slab thickness as the treads (the caller keeps the sim nodes).
 *
 * The stair wears the floor it climbs from — the top finish of its lower
 * landing — so a granite hall gets a granite staircase, not a steel one.
 */
function buildStair(ctx: ModuleContext, mod: Extract<Module, { type: 'stair' }>): THREE.Group {
  const g = new THREE.Group()
  const width = mod.cfg.width ?? STAIR_WIDTH_NORMAL
  const surface = stairSurface(ctx, mod)
  const flights = stairFlights(mod)
  for (const f of flights) g.add(buildStairFlight(ctx.mats, surface, f.from, f.to, width))
  for (let i = 0; i + 1 < flights.length; i++) g.add(buildStairLanding(ctx.mats, surface, flights[i], flights[i + 1], width))
  return g
}

/** Tread slab thickness — the stair's walking surface matches a floor slab. */
const STAIR_TREAD_T = 0.09
/** Target riser height; the flight's rise is divided into whole steps. */
const STAIR_RISE = 1 / 6

/**
 * The floor finish a stair wears: the top finish of the cell at its lower
 * landing, falling back to granite. So a stair in a tiled hall is tiled.
 */
function stairSurface(ctx: ModuleContext, mod: Extract<Module, { type: 'stair' }>): THREE.Material {
  const at = ctx.data.cells.find((c) => c.x === mod.from.x && c.y === mod.from.y && c.z === mod.from.z)
  return ctx.finish(at?.finish?.top ?? 'floor.granite')
}

/**
 * Stretch a box's per-face UVs from 0..1 to one repeat per metre, so a finish
 * material tiles across the stair at the same scale it tiles across the floor.
 */
function metreUv(geo: THREE.BufferGeometry, sx: number, sy: number, sz: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const dims: Array<[number, number]> = [
    [sz, sy],
    [sz, sy], // +x, -x
    [sx, sz],
    [sx, sz], // +y, -y
    [sx, sy],
    [sx, sy], // +z, -z
  ]
  for (let f = 0; f < 6; f++) {
    const [u, v] = dims[f]
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i
      uv.setXY(k, uv.getX(k) * u, uv.getY(k) * v)
    }
  }
  uv.needsUpdate = true
}

/**
 * A slab wearing a finish material. Finish materials read `vertexColors`, so the
 * geometry gets a flat white colour attribute — the AO the mesher bakes in is
 * only meaningful for chunk cells.
 */
function finishSlab(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(sx, sy, sz)
  metreUv(geo, sx, sy, sz)
  const n = geo.attributes.position.count
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

/**
 * One straight flight, in world space, with +x up the horizontal run and +z up.
 * `run` is the horizontal distance, `rise` the storey climb; the treads stay
 * level and the risers stand on each leading edge, so it reads as a staircase.
 */
function buildStairFlight(mats: ModelMaterials, surface: THREE.Material, from: Vec3i, to: Vec3i, width: number): THREE.Group {
  const lower = from.z <= to.z ? from : to
  const upper = from.z <= to.z ? to : from
  const dx = upper.x - lower.x
  const dy = upper.y - lower.y
  const run = Math.hypot(dx, dy)
  const rise = upper.z - lower.z
  const g = new THREE.Group()
  g.position.set(lower.x + 0.5, lower.y + 0.5, lower.z + 1)
  g.rotation.z = Math.atan2(dy, dx) // +x now points up the run

  const half = width / 2
  // Trim half a landing cell at each end, so the treads start at the edge of the
  // floor the flight leaves and stop at the edge of the floor it reaches —
  // otherwise the top tread is coplanar with the landing slab and z-fights it.
  const inner = Math.min(0.5, Math.max(0, (run - 0.4) / 2))
  const stairRun = run - inner * 2
  if (stairRun < 0.2 || rise < 1e-3) {
    // Degenerate flight: a level platform, so the piece is never invisible.
    finishSlab(g, surface, Math.max(run, 0.5) / 2, 0, -STAIR_TREAD_T / 2, Math.max(run, 0.5), width, STAIR_TREAD_T)
    return g
  }

  const steps = Math.max(2, Math.round(rise / STAIR_RISE))
  const stepRise = rise / steps
  const going = stairRun / steps
  for (let i = 0; i < steps; i++) {
    // Tread: level, its top on the step line.
    finishSlab(g, surface, inner + i * going + going / 2, 0, (i + 1) * stepRise - STAIR_TREAD_T / 2, going + 0.002, width, STAIR_TREAD_T)
    // Riser under the leading edge, from the tread below up to this one.
    finishSlab(g, surface, inner + i * going, 0, i * stepRise + stepRise / 2, 0.05, width, stepRise)
  }

  // Side stringers, a soffit and a handrail run the incline. `theta` tilts a
  // beam about the width axis so its length follows the slope.
  const midX = inner + stairRun / 2
  const theta = Math.atan2(rise, stairRun)
  const slopeLen = Math.hypot(stairRun, rise)
  for (const s of [1, -1]) {
    const beam = slab(g, mats.darkSteel, midX, s * (half + 0.05), rise / 2 - 0.2, slopeLen + 0.12, 0.09, 0.32)
    beam.rotation.y = -theta
    const rail = slab(g, mats.handrail, midX, s * (half + 0.07), rise / 2 + 0.95, slopeLen, 0.07, 0.07)
    rail.rotation.y = -theta
    for (let i = 0; i <= 2; i++) {
      const u = inner + (i / 2) * stairRun
      slab(g, mats.steel, u, s * (half + 0.07), ((u - inner) / stairRun) * rise + 0.47, 0.05, 0.05, 0.94)
    }
  }
  const soffit = slab(g, mats.darkSteel, midX, 0, rise / 2 - 0.26, slopeLen + 0.06, width + 0.06, 0.06)
  soffit.rotation.y = -theta
  return g
}

/**
 * A stair's turn landing: a platform spanning the two flight ends, one stair
 * width deep on every side the agent crosses, so the perpendicular width never
 * pinches at the corner. Built from the same surface and slab thickness as the
 * treads, over a shallow frame — never a reused 1 m floor block. A balustrade
 * runs the edges a flight does not attach to, wrapping the outside of the turn
 * and carrying the flight handrails around it.
 */
function buildStairLanding(
  mats: ModelMaterials,
  surface: THREE.Material,
  fin: { from: Vec3i; to: Vec3i },
  fout: { from: Vec3i; to: Vec3i },
  width: number,
): THREE.Group {
  const g = new THREE.Group()
  const a = fin.to
  const b = fout.from
  const ax = a.x + 0.5
  const ay = a.y + 0.5
  const bx = b.x + 0.5
  const by = b.y + 0.5
  const cx = (ax + bx) / 2
  const cy = (ay + by) / 2
  const sx = Math.abs(bx - ax) + width
  const sy = Math.abs(by - ay) + width
  const top = a.z + 1
  const x0 = cx - sx / 2
  const x1 = cx + sx / 2
  const y0 = cy - sy / 2
  const y1 = cy + sy / 2
  finishSlab(g, surface, cx, cy, top - STAIR_TREAD_T / 2, sx, sy, STAIR_TREAD_T)
  slab(g, mats.darkSteel, cx, cy, top - STAIR_TREAD_T - 0.14, sx - 0.18, sy - 0.18, 0.28)

  // Which perimeter edges a flight attaches to: the side the flight body sits
  // on, snapped to the dominant axis. The others get a balustrade.
  const attached = new Set<string>()
  const attachEdge = (from: Vec3i, to: Vec3i): void => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    attached.add(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 'n' : 's')
  }
  attachEdge(fin.to, fin.from) // the incoming flight, behind the landing
  attachEdge(fout.from, fout.to) // the outgoing flight, beyond the landing

  const RAIL = 0.95
  const rail = (edge: string): void => {
    if (edge === 's' || edge === 'n') {
      const y = edge === 's' ? y0 + 0.04 : y1 - 0.04
      slab(g, mats.handrail, cx, y, top + RAIL, sx, 0.06, 0.06)
      for (const px of [x0 + 0.07, x1 - 0.07]) slab(g, mats.steel, px, y, top + RAIL / 2, 0.05, 0.05, RAIL)
    } else {
      const x = edge === 'w' ? x0 + 0.04 : x1 - 0.04
      slab(g, mats.handrail, x, cy, top + RAIL, 0.06, sy, 0.06)
      for (const py of [y0 + 0.07, y1 - 0.07]) slab(g, mats.steel, x, py, top + RAIL / 2, 0.05, 0.05, RAIL)
    }
  }
  for (const edge of ['s', 'n', 'w', 'e']) if (!attached.has(edge)) rail(edge)
  return g
}

/**
 * Headroom above the top landing, so the cabin and its call panel fit: the shaft
 * runs on to just under the slab above that floor. It must stay below that slab,
 * so a platform piece tops out at the concourse ceiling (0 m), never through the
 * street floor.
 */
const LIFT_HEADROOM = 2.6

/** True when `(x, y, z)` is walkable floor: solid, with nothing solid above it. */
function floorAt(data: StationData, x: number, y: number, z: number): boolean {
  const solid = (zz: number): boolean => data.cells.some((c) => c.fill === 'solid' && c.x === x && c.y === y && c.z === zz)
  return solid(z) && !solid(z + 1)
}

/**
 * An elevator (电梯). A 2 × 2 m vertical shaft with a moving 1.5 × 1.5 m cabin:
 * a steel frame and back/side walls around an open front, a threshold and a
 * call panel at every floor the shaft actually serves, and a cabin whose doors
 * slide apart. Only real landings get a sill/panel — a shaft that runs past a
 * floorless level shows nothing there. The cabin group is left in
 * `userData.liftCabin` and its two leaves are registered as doors, so
 * `SceneRenderer.setLifts` can travel the cabin and ease the doors from the sim
 * car state. Built in world space so one model spans every storey of the shaft;
 * the group origin is the centre of the 2 × 2 plan.
 */
function buildLift(ctx: ModuleContext, mod: Extract<Module, { type: 'lift' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  g.position.set(mod.x + 1, mod.y + 1, mod.from.z + 1)
  if (mod.rot) g.rotation.z = (mod.rot * Math.PI) / 2

  const runH = Math.max(LIFT_STEP, mod.to.z - mod.from.z)
  const H = runH + LIFT_HEADROOM
  const outer = 0.94 // wall centre-line, so the assembly reads as 2 m across
  const inner = 0.72 // 1.44 m clear carriage
  const midH = H / 2

  // Four corner posts and the back/side walls; the front (local −y) stays open.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) slab(g, mats.darkSteel, sx * outer, sy * outer, midH, 0.14, 0.14, H)
  }
  slab(g, mats.steel, 0, outer, midH, 1.74, 0.12, H)
  slab(g, mats.steel, -outer, 0, midH, 0.12, 1.74, H)
  slab(g, mats.steel, outer, 0, midH, 0.12, 1.74, H)

  // A threshold sill and a call panel at every real landing in the column.
  for (const z of liftStopZs(mod.from.z, mod.to.z)) {
    if (!floorAt(ctx.data, mod.x, mod.y, z)) continue
    const L = z - mod.from.z
    slab(g, mats.darkSteel, 0, -outer + 0.02, L + 0.03, 1.9, 0.22, 0.06)
    slab(g, mats.black, 0.6, -outer - 0.03, L + 1.35, 0.3, 0.04, 0.18)
    slab(g, mats.ledGreen, 0.6, -outer - 0.05, L + 1.35, 0.12, 0.02, 0.07)
  }
  slab(g, mats.darkSteel, 0, 0, H + 0.06, 2.04, 2.04, 0.14)

  // The cabin: floor, roof, back and sides, with the two door leaves at the
  // front. Its local origin is the cabin floor, so the renderer only sets z.
  const cabin = new THREE.Group()
  g.add(cabin)
  g.userData.liftCabin = cabin
  slab(cabin, mats.steel, 0, 0, 0.05, 1.5, 1.5, 0.1)
  slab(cabin, mats.darkSteel, 0, 0, 2.42, 1.54, 1.54, 0.12)
  slab(cabin, mats.steel, 0, inner, 1.24, 1.5, 0.06, 2.32)
  slab(cabin, mats.steel, -inner, 0, 1.24, 0.06, 1.44, 2.32)
  slab(cabin, mats.steel, inner, 0, 1.24, 0.06, 1.44, 2.32)
  // Interior light and a mirror panel on the back wall.
  slab(cabin, mats.glow, 0, 0, 2.3, 0.9, 0.9, 0.04)
  plate(cabin, mats.screen, 0.9, 1.2, 0, inner - 0.04, 1.3, Math.PI)
  const doors: THREE.Mesh[] = []
  const leafW = 0.72
  for (const s of [-1, 1]) {
    const leaf = slab(cabin, mats.black, (s * leafW) / 2, -inner + 0.02, 1.24, leafW, 0.06, 2.15)
    registerDoorLeaf(leaf, s, 0.7, doors)
  }
  g.userData.doors = doors
  return g
}

/* ------------------------------------------------------------------ exit */

/**
 * A blue canopy with a gentle wave along the run: a strip of thin slabs whose
 * heights follow `heightAt`, each tilted to meet its neighbour, so the folded
 * surface reads as the reference art's waved roof. `heightAt(t)` maps 0 at the
 * mouth (−y, over the runs) to 1 at the street doorway (+y); the shared profile
 * is what lets the side glass follow the same edge with no gap. Built flat in
 * the exit's local frame (before the placement rotation), `cx` the plan centre.
 */
function buildWavyRoof(
  g: THREE.Group,
  mat: THREE.Material,
  cx: number,
  y0: number,
  y1: number,
  w: number,
  n: number,
  heightAt: (t: number) => number,
): void {
  const step = (y1 - y0) / n
  for (let i = 0; i < n; i++) {
    const ya = y0 + i * step
    const za = heightAt(i / n)
    const zb = heightAt((i + 1) / n)
    const seg = slab(g, mat, cx, ya + step / 2, (za + zb) / 2, w, Math.hypot(step, zb - za) + 0.03, 0.1)
    // Tilt the segment so its long (y) axis follows the slope between crests.
    seg.rotation.x = Math.atan2(zb - za, step)
  }
}

/**
 * Street exit portal (出入口): a head-house over one, two or three escalator
 * bays, not a square pavilion. The +y end is the street doorway under the metro
 * header; the −y end is the mouth, where the runs pass beneath the long canopy
 * and drop away through an opening in the plaza. The reference art is a red
 * steel portal frame wrapping a blue waved roof over glazed sides and back.
 *
 * 有盖 (covered, the default) draws the canopy, frame and glass; 无盖 (open)
 * drops the roof and walls and runs a railing where each wall stood, so the
 * sim barrier is identical and only the look changes. The bay count widens the
 * floor, frame and run openings to match `exitBayOffsets`.
 */
function buildExit(ctx: ModuleContext, mod: Extract<Module, { type: 'exit' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  const bays = exitBays(mod)
  const offsets = exitBayOffsets(bays)
  const W = exitWidth(bays) // across the run bays
  const L = EXIT_L // enclosed part: local y ∈ [−2, +2]
  const H = EXIT_H // canopy height above the walk
  const REACH = EXIT_REACH // how far the canopy reaches over the escalator run (−y)
  const BACK = EXIT_BACK // canopy overhang past the street doorway (+y)
  const hw = W / 2
  const hl = L / 2
  const covered = mod.cfg.covered !== false
  const side = exitSide(bays)
  const bay = EXIT_BAY_HALF
  const BACKY = EXIT_BACK_Y // back wall, just past where the runs go under the floor

  // Head-house floor: one thin plate over the whole cell footprint the exit
  // claims, so no hollow cell shows between the railings. The footprint is the
  // odd (2·bays + 1)-cell block the exit covers (three blocks for a 单向), and
  // the plaza floor never shows through it. Only a bay a run actually descends
  // through is left open — and only along the middle of the descent, never the
  // top-landing row or the mouth-most row the back rail stands on.
  const hwFloor = (2 * bays + 1) / 2
  const yHi = Math.ceil(EXIT_BACK + 0.5) - 0.5 // cell-aligned street edge
  const landingBack = -0.5 // back edge of the run's top-landing cell (local y)
  const corridorBack = BACKY + 1 // the mouth-most cell stays floored under the rail
  // Walkway plus the top-landing row: solid full width.
  slab(g, mats.darkSteel, 0, (landingBack + yHi) / 2, 0.05, hwFloor * 2, yHi - landingBack, 0.1)
  // The mouth-most row, solid full width so the back rail sits on the pad.
  slab(g, mats.darkSteel, 0, (BACKY + corridorBack) / 2, 0.05, hwFloor * 2, corridorBack - BACKY, 0.1)
  // The descending corridor between them opens only at a run bay.
  const stripLen = landingBack - corridorBack
  const stripY = (landingBack + corridorBack) / 2
  const strip = (cx: number, w: number): void => {
    if (w > 0.02) slab(g, mats.darkSteel, cx, stripY, 0.05, w, stripLen, 0.1)
  }
  // True when a ramp's upper landing sits in this bay, so the pad must open for
  // it. The bay's world cell is turned by the exit's rotation, so a rotated
  // head-house still finds its run; anything else is covered by the pad.
  const runAtBay = (o: number): boolean => {
    const [bx, by, bz] = exitBayCell(mod, o)
    return ctx.data.modules.some((mm) => {
      if (mm.type !== 'escalator' && mm.type !== 'stair' && mm.type !== 'lift') return false
      const top = mm.from.z >= mm.to.z ? mm.from : mm.to
      return top.x === bx && top.y === by && top.z === bz
    })
  }
  let prev = -hwFloor
  for (const o of offsets) {
    if (!runAtBay(o)) continue // empty bay: the pad runs straight through it
    // A run descends here: leave a handrail-clear opening, or the balustrade
    // surfaces through the strips beside it.
    strip((prev + (o - bay)) / 2, o - bay - prev)
    prev = o + bay
  }
  strip((prev + hwFloor) / 2, hwFloor - prev)

  // 无盖 railing: the 围栏 glass panel, not a bare steel rail — a steel top and
  // bottom rail with a glass sheet between them and a post at each joint. Built
  // along a fixed local x (railZ) or y (railX), so it reads as the same fence
  // piece the player places by hand.
  const post = (x: number, y: number): void => {
    slab(g, mats.darkSteel, x, y, 0.02, 0.16, 0.16, 0.04)
    slab(g, mats.steel, x, y, 0.5, 0.08, 0.08, 1.0)
  }
  const railZ = (cx: number, y0: number, y1: number): void => {
    const len = y1 - y0
    const cy = (y0 + y1) / 2
    slab(g, mats.steel, cx, cy, 0.955, 0.07, len, 0.09)
    slab(g, mats.steel, cx, cy, 0.06, 0.07, len, 0.08)
    slab(g, mats.glass, cx, cy, 0.52, 0.03, len, 0.76)
    const n = Math.max(1, Math.round(len / 1.4))
    for (let i = 0; i <= n; i++) post(cx, y0 + (len * i) / n)
  }
  const railX = (cy: number, x0: number, x1: number): void => {
    const len = x1 - x0
    const cx = (x0 + x1) / 2
    slab(g, mats.steel, cx, cy, 0.955, len, 0.07, 0.09)
    slab(g, mats.steel, cx, cy, 0.06, len, 0.07, 0.08)
    slab(g, mats.glass, cx, cy, 0.52, len, 0.03, 0.76)
    const n = Math.max(1, Math.round(len / 1.4))
    for (let i = 0; i <= n; i++) post(x0 + (len * i) / n, cy)
  }

  if (covered) {
    // The reference head-house is a red steel frame, not a row of pillars: on
    // each side a post runs up to a top beam that wraps over the blue canopy,
    // the frames are tied at the base by red steel parallel to the ground, and
    // the glass hangs inside. Because it is all glass, the back is a glazed
    // wall too; the roof rises toward the street doorway (+y) so the sign side
    // stands tallest, and the side glass follows the wave with no gap.
    const frameX = side + 0.03 // posts just outside the glass
    const frameTop = H + 0.55 // top beam, just clear of the wave crest
    const frameYs = [BACKY + 0.3, (BACKY + EXIT_GLASS_Y1) / 2, EXIT_GLASS_Y1 - 0.15]
    for (const fy of frameYs) {
      for (const sx of [-1, 1]) slab(g, mats.exitRed, sx * frameX, fy, frameTop / 2, 0.16, 0.16, frameTop)
      slab(g, mats.exitRed, 0, fy, frameTop - 0.08, frameX * 2 + 0.16, 0.16, 0.16)
    }
    // Base frame: side members along the run plus the far cross tie only — the
    // street doorway stays clear, so no red beam runs across the entrance floor.
    const baseY0 = frameYs[0]
    const baseY1 = frameYs[frameYs.length - 1]
    for (const sx of [-1, 1]) slab(g, mats.exitRed, sx * frameX, (baseY0 + baseY1) / 2, 0.2, 0.14, baseY1 - baseY0 + 0.3, 0.2)
    slab(g, mats.exitRed, 0, baseY0, 0.2, frameX * 2, 0.14, 0.2)

    // Blue waved canopy, rising toward the street doorway (+y). `heightAt` is
    // the profile both the roof and the glazing share, so the glass meets the
    // roof edge with no gap.
    const FLOOR_TOP = 0.3
    const ry0 = -REACH
    const ry1 = BACK
    const waveAmp = 0.16
    const periods = 0.85
    const heightAt = (t: number): number => H + 0.4 * (t - 0.5) - waveAmp * Math.sin(t * Math.PI * 2 * periods)
    const topAt = (y: number): number => heightAt((y - ry0) / (ry1 - ry0))
    // The canopy overhangs the frame, but never past the block the exit claims
    // (the 单向 is only three cells, so its roof is trimmed to the floor edge).
    const roofW = Math.min(frameX * 2 + 0.6, hwFloor * 2)
    buildWavyRoof(g, mats.blue, 0, ry0, ry1, roofW, 22, heightAt)

    // Glass sides, each panel tilted to follow the roof, top edge tucked into it.
    const sideGlass = (x: number): void => {
      const n = 16
      const step = (EXIT_GLASS_Y1 - EXIT_GLASS_Y0) / n
      for (let i = 0; i < n; i++) {
        const ya = EXIT_GLASS_Y0 + i * step
        const yb = ya + step
        const za = topAt(ya)
        const zb = topAt(yb)
        const theta = Math.atan2(zb - za, step)
        const zmid = (za + zb) / 2
        const h = (zmid - FLOOR_TOP) / Math.cos(theta)
        const panel = slab(g, mats.glass, x, (ya + yb) / 2, (zmid + FLOOR_TOP) / 2, 0.04, Math.hypot(step, zb - za), h)
        panel.rotation.x = theta
      }
    }
    for (const sx of [-1, 1]) sideGlass(sx * side)
    // Glass back wall (glazed like the sides); its head follows the roof there.
    const zBack = topAt(BACKY)
    slab(g, mats.glass, 0, BACKY, (zBack + FLOOR_TOP) / 2, side * 2, 0.05, zBack - FLOOR_TOP)

    // Under-canopy light strips down the middle, tucked under the wave.
    for (let i = 0; i < 3; i++) {
      const ly = 1.2 - i * 2.0
      slab(g, mats.glow, 0, ly, topAt(ly) - 0.1, 0.16, 0.9, 0.04)
    }

    // Handrail down each divider between two runs.
    for (let i = 0; i < offsets.length - 1; i++) {
      const cx = (offsets[i] + offsets[i + 1]) / 2
      slab(g, mats.steel, cx, -1.0, 0.95, 0.06, 2.0, 0.06)
      for (const s of [-1, 1]) for (let j = 0; j <= 1; j++) slab(g, mats.steel, cx, s * (0.2 + j * 1.6), 0.5, 0.06, 0.06, 0.9)
    }
  } else {
    // 无盖: no canopy, frame or walls — a railing stands where each wall was, all
    // the way along the sides and across the back, plus each divider between runs.
    for (const sx of [-1, 1]) railZ(sx * side, EXIT_GLASS_Y0, EXIT_GLASS_Y1)
    railX(BACKY, -side, side)
    for (let i = 0; i < offsets.length - 1; i++) railZ((offsets[i] + offsets[i + 1]) / 2, BACKY, EXIT_GLASS_Y1)
  }

  // Header over the street doorway, printed on the outer (+y) face. The exit's
  // own name (A口 / 北门) prints here, so renaming it updates the model. The open
  // variant hangs it on two posts instead of under a canopy.
  if (!covered) {
    for (const sx of [-1, 1]) slab(g, mats.steel, sx * (hw - 0.12), hl - 0.12, 1.2, 0.08, 0.08, 2.4)
  }
  slab(g, mats.darkSteel, 0, hl - 0.02, 2.45, W - 0.06, 0.12, 0.62)
  const header = plate(g, new THREE.MeshBasicMaterial({ map: canvasTexture(512, 96, (c) => c.drawImage(exitHeaderCanvas(ctx.data.name || '地铁', mod.cfg.name || '出入口'), 0, 0)) }), W - 0.3, 0.5, 0, hl + 0.06, 2.45, Math.PI)
  header.renderOrder = 1
  return g
}


/* ------------------------------------------------------------ platform door */

/** Platform screen doors (站台门) along a `platform-edge` run. */
function buildPsd(ctx: ModuleContext, mod: Extract<Module, { type: 'platform-edge' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  // Local frame: the group sits on the origin cell's centre, the run along +x,
  // one cell deep. `side` says which way the track lies (left = local −y), so
  // the screen faces it.
  const x0 = -0.5
  const len = mod.w
  const z0 = 1
  const toward = mod.cfg.side === 'right' ? 1 : -1
  const yWall = toward * 0.34
  const cx = x0 + len / 2

  // The line decides the door cadence; the screen is cut open where it lands.
  const line = ctx.data.lines.find((l) => l.id === mod.cfg.line) ?? ctx.data.lines[0]
  const colour = line?.colour ?? '#1b6fd6'
  const lineId = line?.id ?? '2'
  // The header's destination is the bound line's terminus for this screen's
  // direction, so an up platform points where the up track runs and a down one
  // the other way (the terminus fields are the per-line inputs).
  const terminus =
    ((mod.cfg.dir === 'down' ? line?.downTerminus : line?.upTerminus) ?? '').trim() || (mod.cfg.dir === 'down' ? '下行' : '上行')
  const cars = line?.cars ?? 6
  const stock = (line?.stock ?? 'B') as StockClass
  const doorW = STOCK[stock].doorWidth
  // 屏蔽门 全高 / 半高. The half-height screen (半高) stands 1.5 m and carries
  // the line header as stickers on its glass instead of a printed top band; the
  // full-height screen keeps the storey-tall glass and the header band above it.
  const half = (mod.cfg.psd ?? line?.psd) === 'half'
  const doorH = half ? 1.15 : 2.5
  // Half stack from the local floor at z0: 0.12 sill + 1.26 glass + 0.12 cap.
  const glassH = half ? PSD_HALF_HEIGHT - 0.24 : 2.6
  const glassMid = half ? z0 + 0.12 + glassH / 2 : z0 + 1.45
  const leafMid = half ? z0 + 0.12 + doorH / 2 : z0 + 1.42
  const platYaw = toward < 0 ? Math.PI : 0
  // Openings that actually fall on this run, ascending.
  const openings = (line ? doorCentres({ stock, cars }) : [])
    .map((off) => cx + off)
    .filter((dx) => dx - doorW / 2 > x0 + 0.1 && dx + doorW / 2 < x0 + len - 0.1)
    .sort((a, b) => a - b)

  // Sill and head run the full length; the glass itself is broken at the doors.
  slab(g, mats.white, cx, yWall, z0 + 0.06, len, 0.18, 0.12)
  if (half) {
    // A low cap rail closes the half screen at 1.5 m.
    slab(g, mats.white, cx, yWall, z0 + PSD_HALF_HEIGHT - 0.06, len, 0.2, 0.12)
    slab(g, mats.darkSteel, cx, yWall, z0 + PSD_HALF_HEIGHT, len, 0.24, 0.05)
  } else {
    slab(g, mats.white, cx, yWall, z0 + 2.85, len, 0.24, 0.3)
    slab(g, mats.darkSteel, cx, yWall, z0 + 3.02, len, 0.28, 0.08)
    // The printed header faces the platform (away from the track), repeated along
    // the run so the station name and direction sticker recur as they really do.
    // FrontSide, not DoubleSide: the track side of a screen has no label, so the
    // sticker must not bleed through (mirrored) to the platform's back.
    const headerMap = canvasTexture(1024, 96, (c) => c.drawImage(psdHeaderCanvas(colour, lineId, terminus), 0, 0))
    headerMap.wrapS = THREE.RepeatWrapping
    headerMap.repeat.set(Math.max(1, Math.round(len / 10)), 1)
    const header = plate(
      g,
      new THREE.MeshBasicMaterial({ map: headerMap, side: THREE.FrontSide }),
      len,
      0.3,
      cx,
      yWall - toward * 0.13,
      z0 + 2.85,
      platYaw,
    )
    header.renderOrder = 1
    // The under-header light strip.
    slab(g, mats.glow, cx, yWall - toward * 0.12, z0 + 2.66, len, 0.03, 0.05)
  }
  // The red "mind the gap" threshold, just under the doors so it never crosses
  // an opening.
  slab(g, mats.gateRed, cx, yWall, z0 + 0.14, len, 0.03, 0.07)

  // Fixed glass infill: everything except the door openings, so an open door
  // actually shows the track instead of a wall of glass. A half screen prints
  // the line header as a sticker on each fixed panel — the top band it loses is
  // moved down onto the glass, which is where the reference art puts it.
  const stickerMap = half ? canvasTexture(1024, 96, (c) => c.drawImage(psdHeaderCanvas(colour, lineId, terminus), 0, 0)) : null
  const stickerMat = stickerMap ? new THREE.MeshBasicMaterial({ map: stickerMap, side: THREE.FrontSide }) : null
  const panel = (a: number, b: number): void => {
    const w = b - a
    if (w <= 0.05) return
    slab(g, mats.glass, a + w / 2, yWall, glassMid, w, 0.04, glassH)
    if (!stickerMat) return
    // The 1024×96 header keeps its aspect, inset from the panel's mullions.
    const sw = Math.min(w - 0.24, 2.8)
    if (sw < 0.7) return
    const sticker = plate(g, stickerMat, sw, sw * (96 / 1024), a + w / 2, yWall - toward * 0.05, glassMid, platYaw)
    sticker.renderOrder = 1
  }
  let cursor = x0
  for (const dx of openings) {
    panel(cursor, dx - doorW / 2)
    cursor = dx + doorW / 2
  }
  panel(cursor, x0 + len)

  // Mullions: a jamb at each side of every doorway, plus infill posts across the
  // wider fixed panels — never a bar across an opening.
  const postAt = (px: number): void => {
    slab(g, mats.white, px, yWall, glassMid, 0.08, 0.14, glassH)
  }
  for (const dx of openings) {
    postAt(dx - doorW / 2)
    postAt(dx + doorW / 2)
  }
  for (let px = x0 + 2.4; px < x0 + len; px += 2.4) {
    if (openings.some((dx) => Math.abs(px - dx) < doorW / 2 + 0.1)) continue
    postAt(px)
  }

  // Door leaves at the timetable's door centres. Each leaf is the tinted glass
  // panel plus its outer frame; both slide clear of the opening (doorW/2) as the
  // train berths, the tinted panel parking over the fixed glass beside it. They
  // sit a hair on the platform side of the fixed glass so they never z-fight it.
  const leafY = yWall - toward * 0.05
  const leaves: THREE.Mesh[] = []
  g.userData.line = mod.cfg.line
  for (const dx of openings) {
    for (const s of [-1, 1]) {
      const glass = slab(g, mats.tintedGlass, dx + (s * doorW) / 4, leafY, leafMid, doorW / 2 - 0.02, 0.05, doorH)
      const frame = slab(g, mats.white, dx + (s * doorW) / 2, leafY, leafMid, 0.06, 0.12, doorH)
      registerDoorLeaf(glass, s, doorW / 2, leaves)
      registerDoorLeaf(frame, s, doorW / 2, leaves)
    }
    // Green "open" indicator above each pair.
    plate(g, mats.ledGreen, 0.3, 0.06, dx, yWall - toward * 0.14, half ? z0 + 1.34 : z0 + 2.7, platYaw)
  }
  g.userData.doors = leaves
  g.position.set(mod.x + 0.5, mod.y + 0.5, mod.z)
  if (mod.rot) g.rotation.z = (mod.rot * Math.PI) / 2
  // 隐藏墙壁 fades the whole screen along with the block walls.
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.wall = true
  })
  return g
}

/* ------------------------------------------------------------------ track */

/**
 * A flat arrow lying on the bed, pointing along local +x (or −x when `flip`).
 * Used only by the placement ghost, so the player sees which way the track's
 * 上行/下行 direction runs before committing.
 */
function buildDirectionArrow(mat: THREE.Material, x: number, y: number, z: number, flip: boolean): THREE.Group {
  const g = new THREE.Group()
  const shape = new THREE.Shape()
  // A bold arrow: shaft from −1.1 to 0.4, head reaching 1.6, ~1.4 m across.
  const shaft = 0.22
  const headBase = 0.4
  const headHalf = 0.72
  shape.moveTo(-1.1, -shaft)
  shape.lineTo(headBase, -shaft)
  shape.lineTo(headBase, -headHalf)
  shape.lineTo(1.6, 0)
  shape.lineTo(headBase, headHalf)
  shape.lineTo(headBase, shaft)
  shape.lineTo(-1.1, shaft)
  shape.closePath()
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat)
  g.add(mesh)
  g.position.set(x, y, z)
  // The shape lies flat on the bed; flip it 180° for a 下行 run.
  if (flip) g.rotation.z = Math.PI
  return g
}

function buildTrack(mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, preview = false): THREE.Group {
  const g = new THREE.Group()
  const d = mod.d ?? 1
  // Build in the track's local frame: the run along +x, the amount across +y,
  // the origin cell's centre at (0, 0). The group is then turned and moved into
  // the world, so a quarter-turned piece runs north–south.
  const cx = (mod.w - 1) / 2
  const cy = (d - 1) / 2
  // The bed is a trench: placing the rail dug the cell, so the platform top
  // drops half a metre to this slab. The exposed block sides form the trench
  // walls; the module only supplies the bed and the power supply on top.
  slab(g, mats.black, cx, cy, 0.25, mod.w, d, 0.5)
  // Two rails on sleepers down the middle of the bed.
  for (const s of [-1, 1]) slab(g, mats.steel, cx, cy + s * 0.72, 0.6, mod.w, 0.1, 0.1)
  const nSleepers = Math.max(2, Math.round(mod.w / 0.6))
  for (let i = 0; i < nSleepers; i++) {
    slab(g, mats.black, ((i + 0.5) / nSleepers) * mod.w - 0.5, cy, 0.55, 0.24, Math.max(1.9, d - 0.2), 0.08)
  }
  // The line's 供电 decides the model: a conductor rail beside the running
  // rails, or an overhead wire hung over them. Both are drawn for every piece
  // bound to the line, platform and tunnel alike, so a power switch re-cuts all
  // of them when the module meshes are rebuilt.
  if (mod.cfg.power === 'catenary') buildCatenary(g, mats, mod, cx, cy, d)
  else buildThirdRail(g, mats, mod.w, cx, cy)
  // The ghost carries the travel direction (上行/下行) as arrows along the run.
  if (preview) {
    const flip = mod.cfg.dir === 'down'
    const n = Math.max(1, Math.min(8, Math.round(mod.w / 18)))
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * mod.w - 0.5
      g.add(buildDirectionArrow(mats.glow, x, cy, 0.82, flip))
    }
  }
  g.position.set(mod.x + 0.5, mod.y + 0.5, mod.z)
  if (mod.rot) g.rotation.z = (mod.rot * Math.PI) / 2
  return g
}

/** 第三轨: a guarded conductor rail along the outer −y edge of the bed. */
function buildThirdRail(g: THREE.Group, mats: ModelMaterials, w: number, cx: number, cy: number): void {
  const ty = cy - 1.05
  // The live rail, sitting on ceramic insulators above the sleepers.
  slab(g, mats.darkSteel, cx, ty, 0.62, w, 0.09, 0.09)
  // A yellow protective cover arches over it, as a capping board on a real
  // conductor rail does, so the third rail reads at a glance.
  slab(g, mats.psu, cx, ty - 0.12, 0.8, w, 0.34, 0.05)
  slab(g, mats.psu, cx, ty - 0.28, 0.7, w, 0.05, 0.22)
  const n = Math.max(2, Math.round(w / 4))
  for (let i = 0; i < n; i++) {
    slab(g, mats.white, ((i + 0.5) / n) * w - 0.5, ty, 0.51, 0.1, 0.1, 0.14)
  }
}

/**
 * 接触网: an overhead contact wire over the running rails, hung from a ceiling.
 * A bored tunnel already has its shell ceiling at `TUNNEL_HEADROOM + 1`, so the
 * wire hangs from that. A platform has no ceiling of its own, and a mast cannot
 * fit in the 3 m bed beside a 3 m car (on an island platform it would grow
 * through the screen doors), so the model draws a covered trackway and hangs
 * the wire from it. Either way the wire rides *below* the 4 m storey line, so it
 * stays out of the floor slab above.
 */
function buildCatenary(g: THREE.Group, mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>, cx: number, cy: number, d: number): void {
  const w = mod.w
  // The ceiling to hang from: the bore shell for a tunnel, a drawn canopy for a
  // platform. The wire sits just under it, clear of a consist's 3.65 m roof.
  // The platform canopy stops short of the 4 m storey line, so it never fights
  // the floor slab of the level above.
  const ceilingBottom = mod.cfg.tunnel ? TUNNEL_HEADROOM + 1 : TUNNEL_HEADROOM + 0.88
  const wireZ = ceilingBottom - 0.1
  if (!mod.cfg.tunnel) {
    // A flat canopy over the bed, with a fascia beam down each long edge.
    slab(g, mats.white, cx, cy, ceilingBottom + 0.05, w, d, 0.1)
    for (const j of [-0.5, d - 0.5]) slab(g, mats.darkSteel, cx, j, ceilingBottom + 0.04, w, 0.12, 0.12)
  }
  // Contact wire down the track centre, on short hangers from the ceiling.
  slab(g, mats.steel, cx, cy, wireZ, w, 0.05, 0.05)
  const n = Math.max(2, Math.round(w / 4))
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * w - 0.5
    slab(g, mats.steel, x, cy, (wireZ + ceilingBottom) / 2, 0.05, 0.05, ceilingBottom - wireZ)
    slab(g, mats.psu, x, cy, wireZ + 0.04, 0.1, 0.1, 0.05)
  }
}

/* --------------------------------------- walled rooms and the booth */

function shopSignTexture(text: string, bg: string): THREE.CanvasTexture {
  return canvasTexture(256, 64, (c) => {
    c.fillStyle = bg
    c.fillRect(0, 0, 256, 64)
    c.fillStyle = '#fff'
    c.font = 'bold 30px "Microsoft YaHei", sans-serif'
    c.textAlign = 'center'
    c.fillText(text, 128, 42)
  })
}

/** Sign text/colour and the fit-out hint, per walled-room kind. */
const ROOM_STYLE: Record<RoomKind, { sign: string; bg: string }> = {
  store: { sign: '商店', bg: '#1f9c63' },
  toilet: { sign: '厕所', bg: '#2f8f7f' },
  office: { sign: '办公室', bg: '#b5792a' },
}

/**
 * Walled facility room (商店 / 厕所 / 办公室): its solid perimeter walls are
 * drawn here as thin 0.5 m panels — the chunk mesher hides the full wall voxels
 * (see `hiddenCells`), so the inner half of every wall cell is free for
 * furniture. The fit-out (`cfg.kind`) fills the zone and picks the sign; the
 * wall, doorway and opening logic is shared. World space, origin at the floor.
 */
function buildRoom(ctx: ModuleContext, mod: Extract<Module, { type: 'shop' }>): THREE.Group {
  const g = new THREE.Group()
  const mats = ctx.mats
  const kind = mod.cfg.kind ?? 'store'
  const z0 = mod.z + 1
  const x0 = mod.x
  const x1 = mod.x + mod.w - 1
  const y0 = mod.y
  const y1 = mod.y + mod.h - 1
  /** Half a block: the wall leaves room for a shelf against it. */
  const WALL_T = 0.5
  /** Door fit-out for 厕所 / 办公室: leaf height and frame thickness. */
  const DOOR_H = 2.05
  const FRAME_T = 0.09

  // NO fit-out draws its furniture here: shelves, desks, cubicles and sinks are
  // modules of their own (stocked by `placeFacility`, migrated by
  // `ensureRoomFurniture`), so each unit is individually right-clickable.

  // Thin walls, wearing the finish painted on each cell's inward face. A side
  // the shop did not wall itself — because an existing full wall block already
  // encloses it — still gets a half-width panel, so the room reads the same
  // all the way round.
  const cellAt = new Map<string, Cell>()
  const solid = new Set<string>()
  for (const c of ctx.data.cells) {
    cellAt.set(`${c.x},${c.y},${c.z}`, c)
    if (c.fill === 'solid') solid.add(`${c.x},${c.y},${c.z}`)
  }
  const wallMat = (key: string, face: Face): THREE.Material => ctx.finish(finishOf(cellAt.get(key) ?? {}, face))
  const encloses = (x: number, y: number): boolean => solid.has(`${x},${y},${mod.z}`) && solid.has(`${x},${y},${mod.z + 1}`)

  // Group the wall by column, so a full-height run is one panel rather than a
  // stack of unit boxes whose coincident faces fight at every joint.
  interface WallCol {
    x: number
    y: number
    zLo: number
    zHi: number
    key: string
  }
  const columns = new Map<string, WallCol>()
  const addCol = (x: number, y: number, zLo: number, zHi: number): void => {
    const col = `${x},${y}`
    const e = columns.get(col)
    if (e) {
      if (zLo < e.zLo) e.zLo = zLo
      if (zHi > e.zHi) e.zHi = zHi
    } else columns.set(col, { x, y, zLo, zHi, key: `${x},${y},${zLo}` })
  }
  for (const [x, y, z] of facilityWallCells(ctx.data.cells, mod)) addCol(x, y, z, z)
  const doorHere = new Set((mod.cfg.door ?? []).map(([x, y]) => `${x},${y}`))
  const sideCol = (x: number, y: number): void => {
    if (columns.has(`${x},${y}`) || doorHere.has(`${x},${y}`)) return
    const ox = x === x0 ? x - 1 : x === x1 ? x + 1 : x
    const oy = y === y0 ? y - 1 : y === y1 ? y + 1 : y
    if (encloses(ox, oy)) addCol(x, y, mod.z + 1, mod.z + SHOP_WALL_H)
  }
  for (let x = x0; x <= x1; x++) {
    sideCol(x, y0)
    sideCol(x, y1)
  }
  for (let y = y0; y <= y1; y++) {
    sideCol(x0, y)
    sideCol(x1, y)
  }

  for (const { x, y, zLo, zHi, key } of columns.values()) {
    const h = zHi - zLo + 1
    const cz = (zLo + zHi + 1) / 2
    // On a corner the y-panel stops where the x-panel starts, so the two outer
    // faces meet at an edge instead of lying coplanar.
    if (y === y0 || y === y1) {
      const a = x === x0 ? x0 + WALL_T : x
      const b = x === x1 ? x1 + 1 - WALL_T : x + 1
      const cy = y === y0 ? y + WALL_T / 2 : y + 1 - WALL_T / 2
      // The panel's inside face is the one the room sees and the player clicks:
      // south/north walls show their n/s face, west/east walls their e/w face.
      finishSlab(g, wallMat(key, y === y0 ? 'n' : 's'), (a + b) / 2, cy, cz, b - a, WALL_T, h).userData.wall = true
    }
    if (x === x0 || x === x1) {
      const cxx = x === x0 ? x + WALL_T / 2 : x + 1 - WALL_T / 2
      finishSlab(g, wallMat(key, x === x0 ? 'e' : 'w'), cxx, y + 0.5, cz, WALL_T, 1, h).userData.wall = true
    }
  }

  const door = mod.cfg.door ?? []
  const wallSide = (x: number, y: number): 's' | 'n' | 'w' | 'e' | null =>
    x === x0 ? 'w' : x === x1 ? 'e' : y === y0 ? 's' : y === y1 ? 'n' : null

  // 厕所 / 办公室 close their openings with a real door — jamb, leaf and
  // handle. A 商店 keeps its open shop front, so this is skipped for `store`.
  if (kind !== 'store' && door.length > 0) {
    const LEAF_T = 0.06
    const addDoor = (s: 's' | 'n' | 'w' | 'e', dLo: number, dHi: number): void => {
      const alongX = s === 's' || s === 'n'
      const plane = s === 's' ? y0 + WALL_T / 2 : s === 'n' ? y1 + 1 - WALL_T / 2 : s === 'w' ? x0 + WALL_T / 2 : x1 + 1 - WALL_T / 2
      const start = dLo
      const end = dHi + 1
      const width = end - start
      const axis = (c: number): [number, number] => (alongX ? [c, plane] : [plane, c])
      // Frame: a jamb at each end and a lintel across the top, in the wall
      // plane, so the cut opening keeps a proper surround.
      const jamb = (a: number): void => {
        const [jx, jy] = axis(a)
        slab(g, mats.darkSteel, jx, jy, z0 + (DOOR_H + FRAME_T) / 2, alongX ? FRAME_T : WALL_T + 0.02, alongX ? WALL_T + 0.02 : FRAME_T, DOOR_H + FRAME_T)
      }
      jamb(start)
      jamb(end)
      const [lx, ly] = axis((start + end) / 2)
      slab(g, mats.darkSteel, lx, ly, z0 + DOOR_H + FRAME_T / 2, alongX ? width + FRAME_T : WALL_T + 0.02, alongX ? WALL_T + 0.02 : FRAME_T, FRAME_T)

      // A closed leaf across the opening (a pair, meeting in the middle, once
      // the opening is wide enough that one leaf would read as a gate), with a
      // vision panel and a handle so it reads as a door, not a wall.
      const double = width > 1.9
      const leafW = double ? width / 2 : width - 0.05
      const centres = double ? [start + leafW / 2, end - leafW / 2] : [(start + end) / 2]
      for (const c of centres) {
        const [px, py] = axis(c)
        slab(g, mats.white, px, py, z0 + DOOR_H / 2, alongX ? leafW : LEAF_T, alongX ? LEAF_T : leafW, DOOR_H)
        slab(g, mats.glass, px, py, z0 + 1.45, alongX ? leafW * 0.5 : LEAF_T + 0.012, alongX ? LEAF_T + 0.012 : leafW * 0.5, 0.45)
        // Handle on the free edge nearest the middle of the run.
        const hc = c <= (start + end) / 2 ? c + leafW / 2 - 0.1 : c - leafW / 2 + 0.1
        const [hx, hy] = axis(hc)
        slab(g, mats.steel, hx, hy, z0 + 1.0, alongX ? 0.06 : LEAF_T + 0.06, alongX ? LEAF_T + 0.06 : 0.06, 0.14)
      }
    }
    // Group the opening cells by wall and door each contiguous run separately.
    const bySide = new Map<'s' | 'n' | 'w' | 'e', Set<number>>()
    for (const [x, y] of door) {
      const s = wallSide(x, y)
      if (!s) continue
      const set = bySide.get(s) ?? new Set<number>()
      set.add(s === 's' || s === 'n' ? x : y)
      bySide.set(s, set)
    }
    for (const [s, set] of bySide) {
      const coords = [...set].sort((a, b) => a - b)
      let runLo = coords[0]
      let prev = coords[0]
      for (let i = 1; i < coords.length; i++) {
        if (coords[i] === prev + 1) {
          prev = coords[i]
          continue
        }
        addDoor(s, runLo, prev)
        runLo = coords[i]
        prev = coords[i]
      }
      addDoor(s, runLo, prev)
    }
  }

  // Hanging sign over the doorway, on the same wall as the opening and sized to
  // span it. A fixed 2 m sign drifts off the wall once the room front is wider;
  // matching the opening's run keeps both ends mounted on the wall each side.
  let side: 's' | 'n' | 'w' | 'e' = 's'
  let first = 0
  for (const [x, y] of door) {
    const s = wallSide(x, y)
    if (!s) continue
    side = s
    first = s === 's' || s === 'n' ? x : y
    break
  }
  const alongCoord = (x: number, y: number): number => (side === 's' || side === 'n' ? x : y)
  const cells = new Set<number>()
  for (const [x, y] of door) if (wallSide(x, y) === side) cells.add(alongCoord(x, y))
  // The contiguous opening run containing the first door cell.
  let lo = first
  let hi = first
  while (cells.has(hi + 1)) hi++
  while (cells.has(lo - 1)) lo--
  const opened = cells.size > 0
  const span = opened ? hi - lo + 1 : 2.0
  const centre = (lo + hi + 1) / 2
  let sx = mod.x + mod.w / 2
  let sy = mod.y + 0.5
  let yaw = 0
  if (side === 's' || side === 'n') {
    if (opened) sx = centre
    sy = side === 's' ? y0 + 0.5 : y1 + 0.5
    yaw = side === 's' ? 0 : Math.PI
  } else {
    if (opened) sy = centre
    sx = side === 'w' ? x0 + 0.5 : x1 + 0.5
    yaw = side === 'w' ? -Math.PI / 2 : Math.PI / 2
  }
  const alongY = side === 's' || side === 'n'
  const plateW = Math.max(0.6, span - 0.2)
  // A shop front hangs its sign at eye level over the open bay; a door has to
  // clear its own lintel, so the sign rides above the frame.
  const signZ = z0 + (kind === 'store' ? 1.9 : DOOR_H + 0.42)
  slab(g, mats.darkSteel, sx, sy, signZ + 0.3, alongY ? span : 0.08, alongY ? 0.08 : span, 0.1)
  const sign = plate(g, new THREE.MeshBasicMaterial({ map: shopSignTexture(ROOM_STYLE[kind].sign, ROOM_STYLE[kind].bg), side: THREE.DoubleSide }), plateW, 0.5, sx, sy, signZ, yaw)
  sign.renderOrder = 1
  return g
}

/**
 * Ticket booth (售票亭): a service desk ringing the floor, with a glass screen
 * above the counter. There is no solid voxel base and no doorway — the desk is
 * a thin counter the crowd is served across, open overhead. World space,
 * origin at the floor.
 */
function buildBooth(mats: ModelMaterials, mod: Extract<Module, { type: 'booth' }>): THREE.Group {
  const g = new THREE.Group()
  const z0 = mod.z + 1
  const x0 = mod.x
  const y0 = mod.y
  const x1 = mod.x + mod.w - 1
  const y1 = mod.y + mod.h - 1
  const DESK = 0.9 // counter height, metres
  const GLASS_TOP = 2.0
  const DEPTH = 0.55 // counter depth — a desk, not a wall
  // Desk counter + glass screen along each perimeter edge. Corners overlap
  // harmlessly; the counter never closes overhead, so the booth reads open.
  const runX = (y: number): void => {
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5
      const cy = y + 0.5
      slab(g, mats.steel, cx, cy, z0 + DESK / 2, 1.0, DEPTH, DESK)
      slab(g, mats.darkSteel, cx, cy, z0 + DESK, 1.02, DEPTH + 0.06, 0.06)
      slab(g, mats.glass, cx, cy, z0 + (DESK + GLASS_TOP) / 2, 1.0, 0.04, GLASS_TOP - DESK)
      slab(g, mats.darkSteel, cx, cy, z0 + GLASS_TOP, 1.0, 0.07, 0.06)
    }
  }
  const runY = (x: number): void => {
    for (let y = y0; y <= y1; y++) {
      const cx = x + 0.5
      const cy = y + 0.5
      slab(g, mats.steel, cx, cy, z0 + DESK / 2, DEPTH, 1.0, DESK)
      slab(g, mats.darkSteel, cx, cy, z0 + DESK, DEPTH + 0.06, 1.02, 0.06)
      slab(g, mats.glass, cx, cy, z0 + (DESK + GLASS_TOP) / 2, 0.04, 1.0, GLASS_TOP - DESK)
      slab(g, mats.darkSteel, cx, cy, z0 + GLASS_TOP, 0.07, 1.0, 0.06)
    }
  }
  runX(y0)
  runX(y1)
  runY(x0)
  runY(x1)
  // The staff benches are `bench` modules of their own, so each is
  // individually deletable; nothing solid is drawn inside the counter.
  // Sign over the front (south) counter.
  const cx = mod.x + mod.w / 2
  const sign = plate(g, new THREE.MeshBasicMaterial({ map: shopSignTexture('售票', '#1b6fd6'), side: THREE.DoubleSide }), 1.8, 0.5, cx, y0 + 0.5, z0 + 2.2, 0)
  sign.renderOrder = 1
  return g
}

/* ------------------------------------------------------------------ trains */

export interface TrainPose {
  x: number
  y: number
  z: number
  cars: number
  stock: StockClass
  doorsOpen: boolean
  colour: string
  dirSign: number
  /** Yaw (radians) that turns the consist's local +x onto the track's run axis. */
  yaw: number
}

/**
 * One train (车辆) as an A/B/C/L consist: rounded body, window band, blue livery,
 * sliding doors at the timetable's door centres and two bogies per car. Built in
 * world space with the origin at the train centre on the track surface.
 */
export function buildTrain(mats: ModelMaterials, pose: TrainPose): THREE.Group {
  const g = new THREE.Group()
  g.rotation.z = pose.yaw
  const s = STOCK[pose.stock]
  const total = s.length * pose.cars
  const blue = new THREE.MeshStandardMaterial({ color: new THREE.Color(pose.colour), roughness: 0.3, metalness: 0.4 })
  const carDoors = doorCentres({ stock: pose.stock, cars: pose.cars })
  const doors: THREE.Mesh[] = []
  g.userData.doors = doors

  for (let c = 0; c < pose.cars; c++) {
    const carStart = c * s.length
    const carCentre = carStart + s.length / 2 - total / 2
    const bodyLen = s.length - 0.25
    const halfLen = bodyLen / 2
    // Doors in this car. `doorCentres` offsets are already measured from the
    // consist centre, the same frame the car centres use.
    const inCar = carDoors.filter((off) => off > carCentre - s.length / 2 && off < carCentre + s.length / 2).sort((a, b) => a - b)
    // A car-side run that stops short of each doorway, so the body skin has a
    // real hole at every door.
    const sideRuns = (minX: number, maxX: number, pad: number): Array<[number, number]> => {
      const out: Array<[number, number]> = []
      let cur = minX
      for (const off of inCar) {
        const a = off - s.doorWidth / 2 - pad
        const b = off + s.doorWidth / 2 + pad
        if (b <= minX || a >= maxX) continue
        if (a > cur) out.push([cur, Math.min(a, maxX)])
        cur = Math.max(cur, b)
      }
      if (cur < maxX) out.push([cur, maxX])
      return out
    }

    // Car shell. A narrower core with full-width end walls is skinned by side
    // panels that stop at each doorway, so a door opening is a real hole into
    // the cabin rather than a darker panel on a solid block.
    const coreW = s.width - 0.6
    const skinY = s.width / 2 - 0.03
    const doorZ0 = 0.57
    const doorZ1 = 2.63
    const doorH = doorZ1 - doorZ0
    const doorZMid = (doorZ0 + doorZ1) / 2
    slab(g, mats.trainBody, carCentre, 0, 1.75, bodyLen, coreW, 2.5)
    for (const e of [-1, 1]) slab(g, mats.trainBody, carCentre + e * (halfLen - 0.04), 0, 1.75, 0.08, s.width, 2.5)
    slab(g, mats.trainRoof, carCentre, 0, 3.05, bodyLen, s.width - 0.2, 0.2)
    slab(g, mats.trainDark, carCentre, 0, 0.42, bodyLen, s.width - 0.1, 0.5)
    for (const side of [-1, 1]) {
      const y = side * skinY
      // Full-length sill and header, then infill panels between the doors.
      slab(g, mats.trainBody, carCentre, y, 0.51, bodyLen, 0.06, 0.12)
      slab(g, mats.trainBody, carCentre, y, 2.82, bodyLen, 0.06, 0.38)
      for (const [a, b] of sideRuns(carCentre - halfLen, carCentre + halfLen, 0)) {
        slab(g, mats.trainBody, (a + b) / 2, y, doorZMid, b - a, 0.06, doorH)
      }
    }

    // Window band and livery on both sides, broken at the doorways.
    for (const side of [-1, 1]) {
      const face = (side * s.width) / 2
      for (const [a, b] of sideRuns(carCentre - (bodyLen - 1.4) / 2, carCentre + (bodyLen - 1.4) / 2, 0.05)) {
        slab(g, mats.trainDark, (a + b) / 2, face + side * 0.01, 2.35, b - a, 0.06, 0.95)
      }
      for (const [a, b] of sideRuns(carCentre - bodyLen / 2, carCentre + bodyLen / 2, 0.05)) {
        slab(g, blue, (a + b) / 2, face + side * 0.02, 1.05, b - a, 0.05, 0.34)
      }
      // Livery nose: a rising accent over the end cars.
      slab(g, blue, carCentre + (pose.dirSign >= 0 ? bodyLen / 2 - 0.9 : -bodyLen / 2 + 0.9), face + side * 0.02, 1.5, 1.6, 0.05, 0.7)
    }

    // Sliding doors over a modelled cabin: two leaves per side part to reveal an
    // open interior — a lit cavity with a bench and grab poles.
    for (const dx of inCar) {
      for (const side of [-1, 1]) {
        const face = (side * s.width) / 2
        // The cavity is an open box drawn from the inside (back faces only), so
        // its rear wall, floor, ceiling and jambs read as the car interior.
        const cavity = new THREE.Mesh(new THREE.BoxGeometry(s.doorWidth, 0.26, doorH), mats.trainInterior)
        cavity.position.set(dx, side * (skinY - 0.13), doorZMid)
        g.add(cavity)
        // A bench along the back wall and two grab poles.
        slab(g, mats.trainSeat, dx, side * (skinY - 0.18), doorZ0 + 0.28, s.doorWidth - 0.24, 0.16, 0.36)
        for (const px of [-1, 1]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, doorH - 0.12, 8), mats.steel)
          // A cylinder's axis is +y; the cabin's up is +z, so tip it upright.
          pole.rotation.x = Math.PI / 2
          pole.position.set(dx + px * (s.doorWidth / 3), side * (skinY - 0.16), doorZMid)
          g.add(pole)
        }
        // Ceiling strip light.
        slab(g, mats.glow, dx, side * (skinY - 0.16), doorZ1 - 0.07, s.doorWidth - 0.16, 0.12, 0.04)
        for (const leaf of [-1, 1]) {
          const m = slab(g, mats.trainDark, dx + (leaf * s.doorWidth) / 4, face + side * 0.03, 1.6, s.doorWidth / 2 - 0.03, 0.05, 2.1)
          registerDoorLeaf(m, leaf, s.doorWidth / 2, doors)
        }
      }
    }
    // Two bogies.
    for (const b of [-1, 1]) {
      const bx = carCentre + (b * s.length) / 3
      slab(g, mats.black, bx, 0, 0.35, 2.2, 1.9, 0.4)
      for (const wy of [-1, 1]) {
        // A rail wheel's axle runs across the car (+y), which is the cylinder's
        // default axis, so it needs no rotation — radius 0.36 puts the tread on
        // the rail at z = 0.
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 10), mats.rubber)
        wheel.position.set(bx, (wy * 1.5) / 2 + wy * 0.2, 0.36)
        g.add(wheel)
      }
    }
  }

  // Rounded cab on the leading end.
  const front = (total / 2) * (pose.dirSign >= 0 ? 1 : -1)
  const cabLen = 2.4
  const cabMid = front - (pose.dirSign * cabLen) / 2
  slab(g, mats.trainBody, cabMid, 0, 1.7, cabLen, s.width * 0.96, 2.4)
  slab(g, mats.trainDark, cabMid + pose.dirSign * 0.2, 0, 2.45, cabLen - 0.4, s.width * 0.9, 0.8)
  slab(g, mats.trainRoof, cabMid - pose.dirSign * 0.4, 0, 3.0, cabLen - 0.6, s.width - 0.4, 0.25)
  // Headlights and the number plate.
  for (const wy of [-1, 1]) slab(g, mats.glow, front - pose.dirSign * 0.05, wy * 0.85, 0.75, 0.12, 0.3, 0.16)
  slab(g, mats.black, front - pose.dirSign * 0.05, 0, 1.4, 0.08, 1.5, 0.5)
  // The train keeps its own pose; the caller moves the group.
  g.position.set(pose.x, pose.y, pose.z)
  return g
}

/**
 * Register a door leaf so a single `setDoors(root, t)` can slide every leaf in
 * a group. `sign` is the direction it opens along x, `travel` how far (metres)
 * it moves at full open. Used by both the train and the platform screen doors.
 */
function registerDoorLeaf(mesh: THREE.Mesh, sign: number, travel: number, out: THREE.Mesh[]): void {
  mesh.userData.closedX = mesh.position.x
  mesh.userData.openSign = sign
  mesh.userData.travel = travel
  out.push(mesh)
}

/**
 * Slide every registered door leaf of `root` to progress `t` (0 shut, 1 fully
 * open). The caller owns the easing/progress; this only places the geometry.
 */
export function setDoors(root: THREE.Object3D, t: number): void {
  const doors = (root.userData.doors as THREE.Mesh[] | undefined) ?? []
  for (const d of doors) {
    const closed = (d.userData.closedX as number) ?? d.position.x
    const sign = (d.userData.openSign as number) ?? 1
    const travel = (d.userData.travel as number) ?? 0.32
    d.position.x = closed + sign * travel * t
  }
}
