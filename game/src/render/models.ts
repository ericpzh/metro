// Procedural module models — the art pass behind PLAN §3 item 6 ("modules are
// ad-hoc boxes") and the reference photos in `docs/`. Every module the builder
// can place is a small three.js group built from boxes and planes, sharing one
// set of materials so the whole catalogue reads as one kit of steel, enamel,
// glass and screens.
//
//   TVM        售票机     stainless body, green housing, an LCD and a 车票 sign
//   vending    自动贩卖机  white cabinet, glass drink display, face-pay strip
//   gate       闸机      navy head, screen / reader / QR, red leaf, lane arrow
//   escalator  扶梯      truss, steps, glass balustrade, black handrail
//   exit       出入口    红色钢架, glass walls, a canopy over an up/down pair
//   PSD        站台门    glass screen, white mullions, orange header, red band
//   train      车辆      A/B/C/L stock, window band, livery, doors, two cabs
//
// Coordinate convention matches the mesher: cell (x,y,z) occupies
// [x,x+1]×[y,y+1]×[z,z+1], +z up. A module at (x,y,z) stands on top of its
// block, so its local origin is the cell centre at height z+1. Escalators, PSDs
// and trains are built in world space because they span more than one cell.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { facilityWallCells, SHOP_WALL_H } from '../build/model.ts'
import { TUNNEL_HEADROOM } from '../build/rail.ts'
import { ESCALATOR_BALUSTRADE, ESCALATOR_SPEED, ESCALATOR_STEP_PITCH, PSD_HALF_HEIGHT } from '../sim/constants.ts'
import { PANEL_SIZE, makeSignBoards, signBoardsOf, signBoardsPanel, signPlate, type SignBoards, type SignLayout, type SignPanelSize } from '../sim/sign.ts'
import { drawSignPanel } from './signFace.ts'
import { billboardSpec, posterFor } from '../sim/billboards.ts'
import { TV_POSTER_RECT } from './stationDisplay.ts'
import { benchSpec } from '../sim/benches.ts'
import { normRot, rotateLocal } from '../sim/track.ts'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_H, EXIT_L, EXIT_REACH, exitRunOpenings, exitSpan } from '../sim/exits.ts'
import { finishOf } from '../sim/finishes.ts'
import { fenceArms, railLandingAt, type FenceArms } from '../sim/fences.ts'
import { gateHasLane, gateSolidFaces } from '../sim/gates.ts'
import type { RampThin } from '../sim/openings.ts'
import { LIFT_STEP, liftStopZs } from '../sim/lifts.ts'
import { STAIR_WIDTH_NARROW, stairFlights, stairLaneMates, stairTreadTrim, stairWallSides, type StairLaneMate, type StairWallSides } from '../sim/stairs.ts'
import { doorCentres, doorRunOffsets, STOCK, type Stock, type StockClass } from '../sim/stock.ts'
import type { TvPairSlot } from '../sim/tvs.ts'
import type { AdArt } from './adArt.ts'
import type { Cell, Face, FinishId, Module, RoomKind, StationData, Vec3i } from '../sim/types.ts'

/* ------------------------------------------------------------------ palette */

const C = {
  steel: 0xb7bdc4,
  darkSteel: 0x3c434c,
  black: 0x1b1e24,
  rubber: 0x14161a,
  gateRed: 0xbc3a2f,
  /** The 闸机's dark navy head — the photo's cabinet top, not the line blue. */
  gateNavy: 0x28356a,
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
  /** The cab's dark windscreen — darker and glossier than the car glass. */
  trainGlass: 0x46525f,
  /** The cream/gold bumper band the photos show under the cab's dark face. */
  trainTrim: 0xe3d49b,
  /** The red 广州 mark on the cab face. */
  trainMark: 0xd8231c,
} as const

/* --------------------------------------------------------------- materials */

export interface ModelMaterials {
  steel: THREE.MeshStandardMaterial
  darkSteel: THREE.MeshStandardMaterial
  black: THREE.MeshStandardMaterial
  rubber: THREE.MeshStandardMaterial
  gateRed: THREE.MeshStandardMaterial
  /** The 闸机's dark navy head, carrying the screen, reader and QR window. */
  gateNavy: THREE.MeshStandardMaterial
  /**
   * The 闸机's lane panel: the black fascia with its lit green arrow, printed as
   * one unlit canvas so the arrow reads as LEDs rather than a painted shape.
   */
  gatePanel: THREE.MeshBasicMaterial
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
  /** Cab windscreen glass: dark, glossy, and distinctly darker than the body. */
  trainGlass: THREE.MeshStandardMaterial
  /** Cab bumper band and cheek swoosh. */
  trainTrim: THREE.MeshStandardMaterial
  /** The red 广州地铁 mark on the cab's nose (see `drawMetroMark`). */
  trainMark: THREE.MeshBasicMaterial
  /** Lit cab head lamps (leading end) — unlit so they read as emissive. */
  headlight: THREE.MeshBasicMaterial
  /** Lit cab tail lamps (trailing end) — unlit red. */
  taillight: THREE.MeshBasicMaterial
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
  /** The 指示牌 overhead sign face: the lit, double-sided wayfinding board. */
  signFace: THREE.MeshBasicMaterial
  /** The 货架 perforated back panel (dark charcoal pegboard). */
  shelfPanel: THREE.MeshStandardMaterial
  /** Base white material for the shelf goods; each instance tints it. */
  shelfGoods: THREE.MeshStandardMaterial
  /**
   * The 垃圾桶 front band: the 可回收物 loop and the 其它垃圾 mark, printed on a
   * transparent ground so the brushed steel shows between them, the way the
   * reference bin's stickers do.
   */
  binLabels: THREE.MeshBasicMaterial
  /** The 灭火器箱 doors' white lettering (灭火器箱 / FIRE EXTINGUISHER BOX / 火119警). */
  fireLabels: THREE.MeshBasicMaterial
  ledGreen: THREE.MeshBasicMaterial
  ledRed: THREE.MeshBasicMaterial
  glow: THREE.MeshBasicMaterial
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
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

/**
 * The lit face of a panel whose pixels someone else owns: a `MeshBasicMaterial` over
 * the texture, which is what a 指示牌 face, a palette thumbnail and a 电视 plate all
 * are.
 *
 * It exists as one function because getting it wrong is silent and total. A mesh
 * handed a **texture** where it expects a material cannot draw — there is no error,
 * only an invisible face — and that is what every sign in the station used to do.
 */
export function litPanelMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map })
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

/**
 * The 可回收物 Möbius loop: a triangle of three thick arrow strokes, each with a
 * head at its end. Drawn rather than set from a font, because the mark is a
 * symbol and every glyph that stands in for it is a different picture.
 */
function drawRecycleMark(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: string): void {
  const corner = (i: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  g.strokeStyle = colour
  g.fillStyle = colour
  g.lineWidth = r * 0.24
  g.lineCap = 'butt'
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = corner(i)
    const [bx, by] = corner((i + 1) % 3)
    // Each side is drawn short of both corners and finished with a head, so the
    // three strokes read as one loop with a direction rather than a closed ring.
    const t0 = 0.16
    const t1 = 0.62
    g.beginPath()
    g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0)
    g.lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1)
    g.stroke()
    const ang = Math.atan2(by - ay, bx - ax)
    const ex = ax + (bx - ax) * t1
    const ey = ay + (by - ay) * t1
    const s = r * 0.34
    g.beginPath()
    g.moveTo(ex + Math.cos(ang) * s, ey + Math.sin(ang) * s)
    g.lineTo(ex + Math.cos(ang + 2.4) * s, ey + Math.sin(ang + 2.4) * s)
    g.lineTo(ex + Math.cos(ang - 2.4) * s, ey + Math.sin(ang - 2.4) * s)
    g.closePath()
    g.fill()
  }
}

/**
 * The 其它垃圾 mark: a lidded bin with a white arrow dropping into it — the
 * "everything else" half of a two-stream pair, in black so it reads against the
 * green loop beside it.
 */
function drawOtherWasteMark(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: string): void {
  g.fillStyle = colour
  g.fillRect(cx - r * 0.55, cy - r * 0.72, r * 1.1, r * 0.2)
  g.fillRect(cx - r * 0.16, cy - r * 0.94, r * 0.32, r * 0.16)
  g.beginPath()
  g.moveTo(cx - r * 0.44, cy - r * 0.44)
  g.lineTo(cx + r * 0.44, cy - r * 0.44)
  g.lineTo(cx + r * 0.3, cy + r * 0.86)
  g.lineTo(cx - r * 0.3, cy + r * 0.86)
  g.closePath()
  g.fill()
  g.fillStyle = '#ffffff'
  g.fillRect(cx - r * 0.07, cy - r * 0.3, r * 0.14, r * 0.5)
  g.beginPath()
  g.moveTo(cx, cy + r * 0.64)
  g.lineTo(cx - r * 0.21, cy + r * 0.24)
  g.lineTo(cx + r * 0.21, cy + r * 0.24)
  g.closePath()
  g.fill()
}

/**
 * The 垃圾桶's front band: the two waste marks the reference bin wears on its
 * stainless lintel — 可回收物 in green on the left, 其它垃圾 in black on the right.
 * Drawn on a transparent ground, so the brushed steel shows between and around
 * them exactly as it does around the printed stickers they are.
 */
function binLabelCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 128
  const g = c.getContext('2d') as CanvasRenderingContext2D
  drawRecycleMark(g, 128, 42, 34, '#1a9c4a')
  drawOtherWasteMark(g, 384, 42, 30, '#20242b')
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#1a9c4a'
  g.font = 'bold 28px "Microsoft YaHei", sans-serif'
  g.fillText('可回收物', 128, 106)
  g.fillStyle = '#20242b'
  g.fillText('其它垃圾', 384, 106)
  return c
}

/**
 * The 灭火器箱's front lettering: the upper door's 灭火器箱 over its English gloss,
 * and the lower door's 火119警 with the oversized emergency number the reference
 * prints. Transparent, so the red steel of the doors keeps its own shading and
 * only the white ink is a panel.
 */
function fireLabelCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 320
  c.height = 400
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  g.font = 'bold 62px "Microsoft YaHei", sans-serif'
  g.fillText('灭火器箱', 160, 60)
  g.font = '19px "Arial Narrow", "Microsoft YaHei", sans-serif'
  g.fillText('FIRE  EXTINGUISHER  BOX', 160, 122)
  // 火119警: the small 火 and 警 flank the number, as the reference prints it.
  const parts: Array<[string, number]> = [
    ['火', 40],
    ['119', 74],
    ['警', 40],
  ]
  const widths = parts.map(([text, size]) => {
    g.font = `bold ${size}px "Microsoft YaHei", sans-serif`
    return g.measureText(text).width
  })
  let x = 160 - widths.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < parts.length; i++) {
    g.font = `bold ${parts[i][1]}px "Microsoft YaHei", sans-serif`
    g.fillText(parts[i][0], x + widths[i] / 2, 286)
    x += widths[i]
  }
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
 * The 广州地铁 mark — the stylised 羊 the network wears. Two strokes rise from
 * the base, bend outward over their top half and run out to the upper corners,
 * with a narrow slot between them.
 *
 * The outline is traced from the reference artwork: the shape is 0.849 as wide
 * as it is tall, each stroke is 0.174 wide at the base, its inner edge sits
 * 0.455 of the way across, and the bend is the arc the strokes share (the
 * quadratics below stand in for it to within a pixel or two). One routine, so
 * the cab's nose and the exit banner wear the same mark rather than two
 * approximations of it.
 *
 * `cx, cy` is the centre of the mark's bounding box and `size` its height.
 */
export function drawMetroMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, colour: string): void {
  const w = size * 0.849
  const left = cx - w / 2
  const top = cy - size / 2
  // u across the mark (0..1), t up from its base (0..1); canvas y runs down.
  const X = (side: number, u: number): number => left + (side === 0 ? u : 1 - u) * w
  const Y = (t: number): number => top + (1 - t) * size
  g.fillStyle = colour
  for (const side of [0, 1]) {
    g.beginPath()
    g.moveTo(X(side, 0.455), Y(0))
    g.lineTo(X(side, 0.455), Y(0.5))
    g.quadraticCurveTo(X(side, 0.455), Y(0.833), X(side, 0.22), Y(1))
    g.lineTo(X(side, 0), Y(1))
    g.quadraticCurveTo(X(side, 0.281), Y(0.8), X(side, 0.281), Y(0.5))
    g.lineTo(X(side, 0.281), Y(0))
    g.closePath()
    g.fill()
  }
}

/**
 * The exit portal header: the metro logo, station name and the exit's name.
 */
function exitHeaderCanvas(stationName: string, exitName: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 96
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#14181d'
  g.fillRect(0, 0, 512, 96)
  // The metro mark, white on the dark board.
  drawMetroMark(g, 40, 48, 46, '#ffffff')
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

/**
 * The 闸机 lane panel: a black fascia with the chunky LED arrow the reference
 * gates show, drawn on a coarse cell grid so it reads as lamps, not a decal. One
 * arrow, pointing **up** — the way through the lane; it has a single head (a
 * shaft under a triangle, never a bar with points at both ends), and an up arrow
 * is mirror-symmetric, so it reads the same on both faces.
 */
function gateArrowCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 76
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#0b0d11'
  g.fillRect(0, 0, 64, 76)
  // The arrow on an 8 × 8 grid of lamps: a four-row head over a shaft.
  const cells: Array<[number, number]> = [
    [3, 0], [4, 0],
    [2, 1], [3, 1], [4, 1], [5, 1],
    [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2],
    [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3],
    [3, 4], [4, 4],
    [3, 5], [4, 5],
    [3, 6], [4, 6],
    [3, 7], [4, 7],
  ]
  g.shadowColor = 'rgba(72,224,138,0.9)'
  g.shadowBlur = 6
  g.fillStyle = '#48e08a'
  for (const [cx, cy] of cells) g.fillRect(2 + cx * 7.5, 8 + cy * 7.5, 7, 7)
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
    gateNavy: new THREE.MeshStandardMaterial({ color: C.gateNavy, roughness: 0.42, metalness: 0.3 }),
    gatePanel: new THREE.MeshBasicMaterial({ map: canvasTexture(64, 76, (g) => g.drawImage(gateArrowCanvas(), 0, 0)) }),
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
    trainGlass: new THREE.MeshStandardMaterial({ color: C.trainGlass, roughness: 0.12, metalness: 0.5 }),
    trainTrim: new THREE.MeshStandardMaterial({ color: C.trainTrim, roughness: 0.4, metalness: 0.25 }),
    trainMark: new THREE.MeshBasicMaterial({ map: canvasTexture(128, 150, (g) => drawMetroMark(g, 64, 75, 140, `#${C.trainMark.toString(16).padStart(6, '0')}`)), transparent: true }),
    headlight: new THREE.MeshBasicMaterial({ color: 0xfff6e2 }),
    taillight: new THREE.MeshBasicMaterial({ color: 0xff2318 }),
    screen: new THREE.MeshBasicMaterial({ map: canvasTexture(128, 96, (g) => g.drawImage(lcdCanvas(), 0, 0)), side: THREE.DoubleSide }),
    vendingPanel: new THREE.MeshBasicMaterial({ map: canvasTexture(128, 576, (g) => g.drawImage(vendingPanelCanvas(), 0, 0)), side: THREE.DoubleSide }),
    vendingBase: new THREE.MeshBasicMaterial({ map: canvasTexture(384, 96, (g) => g.drawImage(vendingBaseCanvas(), 0, 0)), side: THREE.DoubleSide }),
    // The fallback 指示牌 face, for a caller with no station document behind it:
    // the default front at its own size, drawn by the same code a placed sign
    // uses. A real piece gets its own per-face plate from `ModuleContext.signFace`.
    // It is the one plate minted before the pictograms have decoded, so
    // `refreshSignFaceMaterial` reprints it when they land.
    signFace: litPanelMaterial(
      canvasTexture(signPlate(PANEL_SIZE).width, signPlate(PANEL_SIZE).height, (g) => {
        drawSignPanel(g, fallbackSignBoards().front, { lines: [], panel: PANEL_SIZE }, 'left')
      }),
    ),
    shelfPanel: new THREE.MeshStandardMaterial({ map: canvasTexture(128, 256, (g) => g.drawImage(shelfPanelCanvas(), 0, 0)), roughness: 0.6, metalness: 0.35 }),
    shelfGoods: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.05 }),
    // The 垃圾桶 / 灭火器 decorations' printed faces. Both are **transparent** decals
    // rather than lit panels: the ink is white or coloured and everything else must
    // let the brushed steel behind it through, or a bin would wear a grey band and a
    // cabinet a red one over its own shading.
    binLabels: new THREE.MeshBasicMaterial({ map: canvasTexture(512, 128, (g) => g.drawImage(binLabelCanvas(), 0, 0)), transparent: true, side: THREE.DoubleSide }),
    fireLabels: new THREE.MeshBasicMaterial({ map: canvasTexture(320, 400, (g) => g.drawImage(fireLabelCanvas(), 0, 0)), transparent: true, side: THREE.DoubleSide }),
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x48e08a }),
    ledRed: new THREE.MeshBasicMaterial({ color: 0xff5d47 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xf7ecc8, side: THREE.DoubleSide }),
  }
}

/**
 * The boards a sign with nothing of its own is drawn with: the station's default
 * front, and an empty back. One function so the material minted at import time and
 * the reprint that follows the pictograms cannot disagree about what the fallback
 * is.
 */
function fallbackSignBoards(): SignBoards {
  return makeSignBoards(undefined, null)
}

/**
 * Reprint the fallback 指示牌 plate in place.
 *
 * `mats.signFace` is the only board drawn before the pictograms have decoded — it
 * is minted with `createModelMaterials`, which every scene builds in its
 * constructor — so once the art lands this redraws that one canvas over the
 * texture it already owns. A placed sign does not need it: its plate is drawn from
 * the module document, after the art is in hand (`render/scene.ts`).
 */
export function refreshSignFaceMaterial(mats: ModelMaterials): void {
  const canvas = (mats.signFace.map as THREE.CanvasTexture | null)?.image as HTMLCanvasElement | undefined
  const g = canvas?.getContext('2d')
  if (!canvas || !g) return
  drawSignPanel(g, fallbackSignBoards().front, { lines: [], panel: PANEL_SIZE }, 'left')
  const texture = mats.signFace.map
  if (texture) texture.needsUpdate = true
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
 * A plane. `yaw` spins it about z *after* it is tipped upright (order `ZXY`), so
 * the normal is a horizontal direction:
 *   0 → −y (the front/approach face), π → +y, π/2 → +x, −π/2 → −x.
 * `tilt` then leans it back off vertical, so its normal looks up as well — the
 * 闸机's screen sits on the head's sloped shoulder, facing the passenger.
 */
function plate(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, yaw: number, tilt = 0): THREE.Mesh {
  return plateOf(parent, new THREE.PlaneGeometry(w, h), mat, x, y, z, yaw, tilt)
}

/**
 * The same plane around a geometry the caller already owns — how a
 * 装饰 screen mounts the lit face whose UVs are pre-cut to the panel
 * (`render/adArt.ts`). `yaw` and `tilt` turn the plate exactly as `plate` does.
 */
function plateOf(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  yaw: number,
  tilt = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, mat)
  m.position.set(x, y, z)
  m.rotation.order = 'ZXY'
  m.rotation.set(Math.PI / 2 - tilt, 0, yaw)
  parent.add(m)
  return m
}

/** Round the top rim of a cabinet with a slightly inset cap. */
function capTop(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, h = 0.06): void {
  slab(parent, mat, x, y, z + h / 2, sx * 0.94, sy * 0.94, h)
}

/**
 * A **trapezoidal prism**: a box whose top face is shorter than its base, so a
 * cabinet can wear the reference gate's 115° shoulder instead of reading as a
 * plain brick. `y0`/`y1` are the base's near and far faces, `yt0`/`yt1` the top's,
 * and the prism spans `xw` centred on 0 from `z0` to `z1`. Flat-shaded (every
 * triangle keeps its own vertices), which is what the kit's boxy look wants.
 */
function prism(
  parent: THREE.Object3D,
  mat: THREE.Material,
  xw: number,
  y0: number,
  y1: number,
  yt0: number,
  yt1: number,
  z0: number,
  z1: number,
): THREE.Mesh {
  const hx = xw / 2
  const corner = (x: number, y: number, z: number): [number, number, number] => [x, y, z]
  const c: Array<[number, number, number]> = [
    corner(-hx, y0, z0),
    corner(hx, y0, z0),
    corner(hx, y1, z0),
    corner(-hx, y1, z0),
    corner(-hx, yt0, z1),
    corner(hx, yt0, z1),
    corner(hx, yt1, z1),
    corner(-hx, yt1, z1),
  ]
  // Outward-wound quads: base, top, both shoulders, then the two flanks.
  const quads = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [1, 2, 6, 5],
    [3, 0, 4, 7],
  ]
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (const [x, y, z] of c) {
    pos.push(x, y, z)
    uv.push(x + 0.5, z)
  }
  for (const [a, b, cc, d] of quads) idx.push(a, b, cc, a, cc, d)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2))
  geo.setIndex(idx)
  // Split the shared corners before computing normals: an indexed prism would
  // average them across faces and shade the hard shoulder round.
  const flat = geo.toNonIndexed()
  geo.dispose()
  flat.computeVertexNormals()
  const m = new THREE.Mesh(flat, mat)
  parent.add(m)
  return m
}

/* -------------------------------------------------------------- module kit */

export interface ModuleContext {
  mats: ModelMaterials
  /**
   * The station's ad artwork. A 装饰 screen prints its frozen `cfg.poster`
   * through this, so the pixels and their aspect crop live in one place
   * (`render/adArt.ts`) and the module only names a slug.
   */
  ads: AdArt
  data: StationData
  /** `x,y,z` key -> true for cells whose top finish is the track bed. */
  trackCells: Set<string>
  /**
   * The lit station plate for one 电视, keyed by module id: the line shield, the
   * three 列车开往 cards and the clock. The scene owns it because it is the only
   * place holding both the station document and the live train poses
   * (`render/stationDisplay.ts` draws it).
   */
  tvPlate: (id: string, x: number, y: number) => THREE.Texture
  /**
   * How one 电视 draws itself among the others on its cell: alone, or as one half
   * of a back-to-back pair sharing a single housing (`sim/tvs.ts`). The caller
   * holds the station's module list, which is the only thing that knows whether
   * there is an opposite number beside it and which of the two hangs the pair.
   *
   * Omitted by a caller with no station behind it (a unit test), which reads as a
   * lone 电视 — drawn exactly as it was before a pair could share a cell.
   */
  tvPairSlot?: (id: string) => TvPairSlot
  /**
   * The lit face of one 指示牌, keyed by module id and **face**: a board's two
   * sides print their own boards — 正面 on the left face and 背面 on the right — so
   * a one-sided sign is one plate and a two-sided sign is two (`render/signFace.ts`
   * composes them from `sim/sign.ts`). `panel` is the pair's shared size
   * (`signBoardsPanel`), which is what the plate is cut to: the two faces are two
   * plates on one piece of hardware, so a short back prints on the same steel as a
   * long front. The scene owns it because it is the only place holding the station
   * document the line shields read their colours from.
   *
   * It is a **material**, not a bare texture. A face is a `MeshBasicMaterial` whose
   * map is that texture, and a mesh handed a texture where it expects a material
   * cannot draw at all — which is exactly what every lit sign face in the station
   * used to do, leaving the model's own black panel showing through.
   *
   * Omitted by a caller with no station behind it (a unit test), which falls back
   * to the shared default face.
   */
  signFace?: (id: string, layout: SignLayout, face: 'left' | 'right', panel: SignPanelSize) => THREE.Material
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
    case 'bin':
      return placeLocal(buildBin(ctx.mats), mod)
    case 'extinguisher':
      return placeLocal(buildExtinguisher(ctx.mats), mod)
    case 'billboard':
      return buildBillboard(ctx, mod)
    case 'tv':
      return placeLocal(buildTv(ctx, mod), mod)
    case 'sign':
      return placeLocal(buildSign(ctx, mod), mod)
    case 'gate':
      return placeLocal(buildGate(ctx, mod), mod)
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

/* ------------------------------------------- litter bin and extinguisher box */

/**
 * Litter bin (垃圾桶, 装饰): the reference stainless double bin — 0.88 × 0.42 m in
 * plan and 0.95 m tall, the drawn height `FLAT_HEIGHT.bin` reserves.
 *
 * Two compartments share one stainless shell: the top rim is a front rail, a back
 * rail and a centre bar around two recessed mouths, the front is open below the
 * printed band with the divider and a slatted drain tray between the two bags, and
 * a dark liner fills the shell so every opening reads as a cavity rather than as a
 * face of a solid block. The front faces local −y, so the placement rotation aims
 * the piece like any other equipment.
 */
function buildBin(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const w = 0.88
  const d = 0.42
  const h = 0.95
  // The shell: back and sides, standing on the cell's top face.
  slab(g, mats.steel, 0, d / 2 - 0.025, h / 2, w, 0.05, h)
  for (const x of [-w / 2 + 0.025, w / 2 - 0.025]) slab(g, mats.steel, x, 0, h / 2, 0.05, d, h)
  // The dark liner: what the two mouths and the open front actually show.
  slab(g, mats.darkSteel, 0, 0.02, 0.46, w - 0.12, d - 0.18, 0.84)
  // A slatted drain tray over a dark base, and the divider the bags hang either side of.
  slab(g, mats.black, 0, 0, 0.15, w - 0.12, d - 0.12, 0.02)
  for (let i = 0; i < 5; i++) slab(g, mats.steel, -0.32 + i * 0.16, 0, 0.165, 0.1, d - 0.08, 0.015)
  slab(g, mats.steel, 0, -0.02, 0.535, 0.05, d - 0.08, 0.75)
  // The front band above the openings, carrying the two waste marks. It stands a
  // few millimetres proud of the shell, so the printed decal is a plate on the
  // steel rather than a face coplanar with it.
  slab(g, mats.steel, 0, -d / 2 + 0.02, 0.83, w - 0.06, 0.05, 0.22)
  plate(g, mats.binLabels, 0.76, 0.19, 0, -d / 2 - 0.008, 0.83, 0)
  // The top rim, and the two recessed mouths it frames.
  slab(g, mats.steel, 0, -0.19, 0.925, 0.82, 0.05, 0.05)
  slab(g, mats.steel, 0, 0.19, 0.925, 0.82, 0.05, 0.05)
  slab(g, mats.steel, 0, 0, 0.925, 0.07, 0.38, 0.05)
  for (const x of [-0.2, 0.2]) slab(g, mats.black, x, 0, 0.888, 0.31, d - 0.1, 0.04)
  return g
}

/**
 * Fire-extinguisher cabinet (灭火器, 装饰): the reference red steel box, 0.70 ×
 * 0.44 m in plan and 1.10 m tall including its four legs — the drawn height
 * `FLAT_HEIGHT.extinguisher` reserves.
 *
 * The carcass rides a dark base plate on four corner legs, a lid overhangs it on
 * every side, and the front is two red doors laid over a dark backing so the seam
 * between them is a real groove; the upper door prints 灭火器箱 over its English
 * gloss and the lower one 火119警, and a recessed handle sits on the +x side. The
 * front faces local −y.
 */
function buildExtinguisher(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const w = 0.7
  const d = 0.44
  const h = 1.1
  const legH = 0.16
  // Four corner legs, then the base plate they carry the carcass on.
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    for (const y of [-d / 2 + 0.06, d / 2 - 0.06]) slab(g, mats.exitRed, x, y, legH / 2, 0.05, 0.05, legH)
  }
  slab(g, mats.darkSteel, 0, 0, legH + 0.025, w, d, 0.05)
  // The carcass, and the dark backing its two doors close over.
  slab(g, mats.exitRed, 0, 0.01, 0.63, w, d - 0.02, 0.86)
  slab(g, mats.black, 0, -d / 2 + 0.011, 0.63, w - 0.06, 0.017, 0.84)
  // Two doors with a seam between them, then the overhanging lid.
  slab(g, mats.exitRed, 0, -d / 2 - 0.0125, 0.88, w - 0.05, 0.025, 0.32)
  slab(g, mats.exitRed, 0, -d / 2 - 0.0125, 0.47, w - 0.05, 0.025, 0.46)
  slab(g, mats.exitRed, 0, 0, h - 0.025, w + 0.04, d + 0.04, 0.05)
  // The recessed side handle: a dark well with the grip standing in it.
  slab(g, mats.black, w / 2 + 0.0035, 0.05, 0.88, 0.009, 0.16, 0.07)
  slab(g, mats.steel, w / 2 + 0.0125, 0.05, 0.88, 0.02, 0.12, 0.02)
  // The lettering, printed on the doors' own red steel.
  plate(g, mats.fireLabels, 0.64, 0.8, 0, -d / 2 - 0.027, 0.66, 0)
  return g
}

/* -------------------------------------------------------- wall decoration */

/**
 * Advertisement lightbox (广告牌): a framed, lit poster bolted flat to the wall
 * on the module's local −y face, so the 装饰 rotation picks which wall it hangs
 * on. Its lit face turns into the room (+y). The variant (`sim/billboards.ts`)
 * fixes the run length and the panel's shape: a one-cell landscape, a two-cell
 * 标准 or 大横版, a three-cell 长幅, a tall portrait or a square.
 *
 * The artwork is the module's own `cfg.poster`, frozen at placement — the panel
 * prints one real poster and never changes, so a row of billboards is a row of
 * different campaigns rather than a wall of flicker. `ctx.ads.adFace` crops
 * the image to the panel instead of stretching it, and `userData.adPoster` names
 * the slug the face shows (what the picker and the tests read).
 */
function buildBillboard(ctx: ModuleContext, mod: Extract<Module, { type: 'billboard' }>): THREE.Group {
  const spec = billboardSpec(mod.cfg.variant)
  const poster = posterFor(mod.cfg.poster)
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
  // The lit advertisement, facing into the room. Its geometry carries the UV
  // window that crops the poster to this panel (`ctx.ads.adFace`).
  const face = ctx.ads.adFace(poster.slug, pw, ph)
  const ad = plateOf(g, face.geometry, face.material, 0, -0.315, pz, Math.PI)
  ad.renderOrder = 1
  ad.userData.adPoster = poster.slug
  // A small illuminated 广告 / AD bar under the frame.
  const barZ = pz - ph / 2 - 0.18
  slab(g, ctx.mats.black, 0, -0.36, barZ, Math.min(0.5, pw * 0.7), 0.03, 0.16)
  const label = plate(g, ctx.mats.glow, Math.min(0.42, pw * 0.6), 0.1, 0, -0.335, barZ, Math.PI)
  label.renderOrder = 1
  g.userData.adScreen = ad
  return g
}

/**
 * The 电视 and 广告牌 window: a lit pane sits inside a dark slab, and a plane that
 * is coplanar with the slab's surface z-fights it — which reads as a black window
 * rather than as a rendering fault. Every lit pane over a slab stands this far
 * proud of it. The 广告牌 uses 0.025 for the same reason.
 */
const LIT_STAND_OFF = 0.015

/**
 * How deep one 电视's panel is, either side of its own origin — the body of a single
 * screen, and half the body of a back-to-back pair. The pair is exactly two of these
 * and no more (`TV_PAIR_MARGIN` is the only slack), so a merged pair reads as two
 * screens back to back in a slim housing rather than as a metre-deep box: two thin
 * televisions, back to back.
 */
const TV_HALF_DEPTH = 0.05

/**
 * The seam between the two members of a pair, metres: their backing slabs stop this
 * far short of the cell's mid-plane so the two bodies touch but do not coincide. It
 * is also what a lone 电视 has always had between its backing and the screen centre,
 * so the same arithmetic gives both bodies.
 */
const TV_PAIR_MARGIN = 0.01

/**
 * Passenger-information screen (电视, 装饰): a slim dark bezel with a bright
 * screen, hung by two rods from the storey ceiling like the 指示牌. The floor top
 * is the local origin and the ceiling slab is one storey up (`LEVEL_STEPS`, 4 m =
 * local z 3.0), which is exactly what `ceilingMountMissing` required before it
 * could be placed.
 *
 * The screen is **two** lit panes, not one poster. Down the left is the station
 * board — line shield, 本趟 / 下趟 / 第三趟列车开往, the countdown and the clock —
 * drawn by `render/stationDisplay.ts` as one unlit texture, because it is authored
 * information rather than artwork. To its right is the **content window**: the
 * only part that carries artwork, and the only part the scene re-points on its own
 * cadence (`SceneRenderer.updateAdScreens`). A real platform TV is exactly this
 * shape — information beside the feed — so a poster never has to pretend to be a
 * departure board.
 *
 * **The board faces one way only.** The piece hangs against a wall or the platform
 * edge, so there is one viewing side: the local **−y** face. What the other side
 * shows is its own dark backing — a blank panel, which is what the back of a
 * television looks like. Both lit panes therefore ride the −y face of their backing
 * slab; putting one on the slab's centre line buries it, and the window then reads
 * as a black rectangle.
 *
 * **Two of them back to back are one piece of hardware.** A second 电视 on the same
 * cell turned to face the other way (`sim/tvs.ts`) is drawn as a *pair*: one housing,
 * one bezel, one pair of suspension rods, with a lit face each side — the concourse
 * screen a passage walked both ways hangs overhead. The housing is **two panels
 * thick** (`TV_HALF_DEPTH` either side of the cell's centre), because that is all the
 * object is: two thin televisions stood against each other. It deliberately does not
 * fill the cell — a metre-deep box reads as a chunk of concrete hung from the
 * ceiling, which is not what the piece is.
 *
 * Drawing the two solo models instead is not merely twice the geometry: the housing
 * is symmetric about its centre, so the two backings are left-half-coincident and the
 * station board lands exactly coplanar with the far face of the opposite backing. The
 * board then z-fights its neighbour and loses its outer 0.006 m to it
 * (`test/tv-pair.test.mjs` measures both). The pair branch below is what removes that:
 * each member's backing stops `TV_PAIR_MARGIN` short of the seam, and each lit face
 * sits proud of the surface the two screens share.
 */
function buildTv(ctx: ModuleContext, mod: Extract<Module, { type: 'tv' }>): THREE.Group {
  const g = new THREE.Group()
  const mats = ctx.mats
  // The screen is wider than one cell is deep, which is fine for hung hardware —
  // `ceilingMountMissing` only asks for a ceiling, and the piece is decor.
  const sw = 1.42
  const sh = 0.8
  const zc = 2.15 // screen centre above the floor top
  const ceiling = 3.0 // the storey ceiling underside
  // A lone 电视 is one slim panel (0.1 m through). A pair is **two** of them back to
  // back, not a box as deep as the cell: the two screens sit against each other and
  // the housing is only as thick as the pair of them.
  const slot: TvPairSlot = ctx.tvPairSlot?.(mod.id) ?? { hangs: true, depth: 0, rodId: mod.id }
  const paired = slot.depth > 0
  const bodyHalf = TV_HALF_DEPTH * (paired ? 2 : 1)
  const depth = bodyHalf * 2
  // Every lit pane prints on the local −y face, paired or not — that is the model the
  // station has always had. **Which side of the cell that lands on is `placeLocal`'s
  // job, not this one's**: the two members of a pair differ by a half-turn of `rot`,
  // so the same local face and the same local offsets come out on opposite sides of
  // the cell. Turning the panes here as well would cancel that half-turn and drop
  // both screens on one side — see the `depth` note in `sim/tvs.ts`.
  const surface = -bodyHalf
  // One pane's own dark backing, spanning from the body's mid-plane out to the body's
  // face less `TV_PAIR_MARGIN`. On a lone 电视 that is the 0.04 m slab it has always
  // had; on a pair the two of them meet 0.02 m apart down the middle of the cell,
  // where the shared housing hides the seam, instead of occupying each other's space.
  const backingDepth = bodyHalf - TV_PAIR_MARGIN
  const backingCentre = bodyHalf - backingDepth / 2
  // Only the element that hangs the pair carries the suspension: one rod pair and
  // one set of ceiling plates for the object, not two overlapping sets.
  if (!paired || slot.hangs) {
    for (const x of [-0.42, 0.42]) {
      slab(g, mats.steel, x, 0, (zc + sh / 2 + ceiling) / 2, 0.05, 0.05, ceiling - (zc + sh / 2) - 0.04)
      slab(g, mats.darkSteel, x, 0, ceiling - 0.02, 0.16, 0.16, 0.04)
    }
  }
  // An open bezel frame around the screen, so the panel reads as a piece of
  // hardware rather than a floating image. Drawn once for the pair: a second frame
  // in the same cell would be coplanar with this one on all six faces.
  if (!paired || slot.hangs) {
    const bw = 0.07
    slab(g, mats.darkSteel, 0, 0, zc + sh / 2 + bw / 2, sw + 2 * bw, depth, bw)
    slab(g, mats.darkSteel, 0, 0, zc - sh / 2 - bw / 2, sw + 2 * bw, depth, bw)
    for (const x of [-(sw + bw) / 2, (sw + bw) / 2]) slab(g, mats.darkSteel, x, 0, zc, bw, depth, sh)
  }

  // The screen splits into exactly two regions that tile it: the board column on
  // the left, the content window on the right. Each is measured **from its own
  // edge of the opening** rather than from the split, so the two of them add up to
  // the opening exactly and neither can drift into the bezel post or stop short of
  // its neighbour. `TV_POSTER_RECT.w === 1 - TV_POSTER_RECT.x`, so the two halves
  // always meet at the same line.
  const left = -sw / 2
  const right = sw / 2
  const splitX = left + sw * TV_POSTER_RECT.x
  const boardW = splitX - left
  const boardX = left + boardW / 2
  const winW = right - splitX
  const winX = splitX + winW / 2
  // Full height, both of them: the artwork covers its whole half of the panel.
  const boardH = sh

  // Station board: one dark backing with the lit texture on its viewing face. The
  // pixels come from the scene (`ctx.tvPlate`), which is the only place that holds
  // the clock and the live train poses.
  slab(g, mats.black, boardX, -backingCentre, zc, boardW, backingDepth, boardH)
  const plateTex = ctx.tvPlate(mod.id, mod.x + 0.5, mod.y + 0.5)
  // The plate canvas is the **whole screen** — the board column on the left and the
  // region the artwork covers on the right — because that is the surface
  // `drawStationDisplay` lays its column out against. The board mesh is only the
  // column, so it samples the column's own slice of that canvas. Mapping the full
  // width onto the mesh instead squeezes the entire plate into the left
  // `TV_POSTER_RECT.x` of the column and leaves everything right of it as bare
  // backing: dead black between the text and the picture, with nothing in the
  // console to say so. Both the black band and the 2.4x-condensed text around it
  // come from this one omission.
  plateTex.wrapS = THREE.ClampToEdgeWrapping
  plateTex.repeat.set(TV_POSTER_RECT.x, 1)
  plateTex.offset.set(0, 0)
  const plateMesh = plate(g, new THREE.MeshBasicMaterial({ map: plateTex }), boardW, boardH, boardX, surface - LIT_STAND_OFF, zc, 0)
  plateMesh.renderOrder = 1
  plateMesh.userData.adStationPlate = mod.id

  // Content window: the artwork, cropped to the window's aspect. The scene may
  // re-point this at another poster later, so the mesh is registered by role and
  // the module's frozen slug is only the opening frame.
  const winH = sh
  slab(g, mats.black, winX, -backingCentre, zc, winW, backingDepth, winH)
  const poster = posterFor(mod.cfg.poster)
  const face = ctx.ads.adFace(poster.slug, winW, winH)
  // **Proud of its own backing, and clear of it.** Both the board and the window
  // are slabs; a lit pane on the slab's centre line is buried in it, and one on the
  // slab's surface merely z-fights it — either way the window renders as a flat
  // black rectangle with no error anywhere. The pane goes half a slab out plus a
  // stand-off, the same relationship the 广告牌 uses for its poster.
  const screen = plateOf(g, face.geometry, face.material, winX, surface - LIT_STAND_OFF, zc, 0)
  screen.renderOrder = 2
  screen.userData.adPoster = poster.slug
  screen.userData.adWindow = { x: winX, z: zc, w: winW, h: winH }
  // Power / status light on the lower bezel, on this element's own side.
  plate(g, mats.ledGreen, 0.05, 0.05, sw / 2 - 0.09, surface - 0.005, zc - sh / 2, 0)
  g.userData.adScreen = screen
  return g
}

/* ----------------------------------------------------------------- sign */

/**
 * Overhead wayfinding sign (指示牌, 装饰): a lit directional board hung by two
 * rods from the storey ceiling, readable from both faces. The floor top is the
 * local origin and the ceiling slab is one storey up (`LEVEL_STEPS`, 4 m = local
 * z 3.0), which is exactly what `ceilingMountMissing` required before the piece
 * could be placed. `placeLocal` turns the board with the placement rotation, so
 * R aims it along the concourse or across it.
 *
 * The two faces are **two boards** (§5.8): 正面 (`cfg.front`) is the panel's left
 * face and 背面 (`cfg.back`) its right, and each prints its own list, drawn by
 * `render/signFace.ts` from the module's own document, with the line shields
 * reading the live station document. Neither is mirrored for the other: a plate is
 * turned `π` from its neighbour (`plate`'s yaw), which is precisely what leaves
 * both right way up for the passenger each one faces — so text and arrows on the
 * back read correctly from behind without any redrawing of the plate.
 *
 * A face with nothing on it is **not** mounted at all, and the model's own black
 * lightbox shows through: that is what the back of a freshly placed sign is, and
 * what a genuinely one-way sign is from behind. The two plates share the pair's
 * panel (`signBoardsPanel`), so the hardware is cut to the longer of the two faces
 * and a short back prints on the same piece of steel as a long front.
 */
function buildSign(ctx: ModuleContext, mod: Extract<Module, { type: 'sign' }>): THREE.Group {
  const g = new THREE.Group()
  // The board's own dimensions, taken from the layout module so the drawn panel
  // and the printed faces cannot disagree about their size (`sim/sign.ts`). A sign
  // **grows with its content**, so the hardware is cut to the settled panel rather
  // than to a constant.
  //
  // A sign with neither face composed — a save written before a board was a
  // document, or one that lost its own — prints the station's default board on the
  // **front** rather than a blank face, which is the board `toState` backfills it
  // with. The front is the one face that is never allowed to be empty: a sign with
  // nothing on either side is a black rectangle in the station with nothing
  // anywhere to say why.
  const boards = signBoardsOf(mod.cfg, ctx.data)
  const panel = signBoardsPanel(boards)
  const W = panel.w
  const H = panel.h
  const T = 0.08
  const zc = 2.35 // panel centre above the floor top
  const ceiling = 3.0 // the storey ceiling underside
  // Suspension rods and their ceiling plates, spaced to the board's own width so a
  // wide sign hangs from two rods that really are under it.
  const rodX = Math.max(0.22, W / 2 - 0.35)
  for (const x of [-rodX, rodX]) {
    slab(g, ctx.mats.steel, x, 0, (zc + H / 2 + ceiling) / 2, 0.05, 0.05, ceiling - (zc + H / 2) - 0.04)
    slab(g, ctx.mats.darkSteel, x, 0, ceiling - 0.02, 0.16, 0.16, 0.04)
  }
  // Panel body: a dark steel frame around a black lightbox.
  slab(g, ctx.mats.darkSteel, 0, 0, zc, W, T, H)
  slab(g, ctx.mats.black, 0, 0, zc, W - 0.03, T + 0.012, H - 0.03)
  // The lit faces, each drawn the right way up and carrying **its own** board: the
  // left face is 正面, the right is 背面, and the two yaws are what turn each plate
  // toward the passenger it serves.
  for (const [y, yaw, face, layout] of [
    [T / 2 + 0.012, Math.PI, 'left', boards.front],
    [-T / 2 - 0.012, 0, 'right', boards.back],
  ] as const) {
    // A face with nothing to print is left as the model's own black panel rather
    // than hanging a blank lit plate — which is what the back of a one-sided sign
    // is, and what the piece's own dark lightbox already looks like.
    if (!signFaceHasInk(layout, face)) continue
    const mat = ctx.signFace ? ctx.signFace(mod.id, layout, face, panel) : ctx.mats.signFace
    const mesh = plate(g, mat, W - 0.06, H - 0.06, 0, y, zc, yaw)
    mesh.renderOrder = 1
  }
  return g
}

/** True when any component of `layout` prints on `face`. */
function signFaceHasInk(layout: SignLayout, face: 'left' | 'right'): boolean {
  return layout.some((c) => c.side === 'both' || c.side === face)
}

/* ------------------------------------------------------------------ gate */

/**
 * The 闸机's own dimensions, from the reference elevation: a 1250 mm machine
 * whose shoulder is at 957 mm, over a 900 mm base, with a head that tapers in at
 * 115° to the horizontal — 25° off vertical — so its flat top is shorter than its
 * base and the machine is no rectangular block. The body takes 440 mm of the
 * cell, leaving the 560 mm a real gate lane is.
 */
const GATE_W = 0.44
const GATE_D = 0.9
const GATE_PLINTH_H = 0.08
const GATE_BODY_TOP = 0.62
const GATE_SHOULDER = 0.957
const GATE_H = 1.25
/** The shoulder's slope off vertical: the reference's 115° is measured to the top. */
const GATE_SHOULDER_TILT = ((115 - 90) * Math.PI) / 180
/** The machine's depth at a height up in the tapered head. */
function gateDepthAt(z: number): number {
  return GATE_D - 2 * (z - GATE_SHOULDER) * Math.tan(GATE_SHOULDER_TILT)
}

/**
 * Turnstile (闸机), after the 广州地铁 reference photos and elevation: a
 * brushed-stainless plinth and body, a dark-navy head carrying the tilted screen,
 * the round card reader, the QR window and the two lane lights, a black fascia
 * with a single up green arrow across the body's lower front, a blue band at the
 * foot, and the translucent red leaf across the lane. The head is a **trapezoid**
 * — its top is shorter than its base, the shoulders sloping at 115° — so the
 * machine is not a rectangular block.
 *
 * The body stands **inside** the cell's −x half, hard against that edge, so its
 * outer face *is* the cell edge: a fence run ends flush on the machine's solid
 * side (`gateSolidFaces` in `sim/gates.ts`) instead of hanging in the lane. The
 * lane — with the leaf — takes the +x half, which is also the graph node the sim
 * routes the crowd through, so nobody walks through the stainless body. **Which
 * hand that is** is not modelled here: `R` turns the whole piece, so the mirrored
 * gate is `rot` 2.
 *
 * A `fence` machine is the same body with the lane's half drawn as **fence**: the
 * run carries on through the machine's own block and meets the neighbouring
 * panels (or a wall) at the cell edge, so a doorless 闸机 closes a barrier line
 * instead of interrupting it.
 *
 * The leaf slides back into the machine as the gate opens (`setGateWing`, driven
 * by `SceneRenderer.updateGates`). A run of gates tiles correctly: each lane is
 * the gap between one gate's body and the next gate's body.
 *
 * Both faces wear the same control cluster, because a two-way gate is walked up
 * to from either side.
 */
function buildGate(ctx: ModuleContext, mod: Extract<Module, { type: 'gate' }>): THREE.Group {
  const mats = ctx.mats
  const lane = gateHasLane(mod)
  const g = new THREE.Group()
  const cx = -(0.5 - GATE_W / 2)
  const inner = -(0.5 - GATE_W)
  const front = GATE_D / 2
  const capBase = GATE_H - 0.04
  const headFront = gateDepthAt(capBase) / 2
  const topFront = gateDepthAt(GATE_H) / 2
  // Plinth, stainless body, navy head — vertical up to the shoulder, then the
  // trapezoid whose top is shorter than its base.
  slab(g, mats.darkSteel, cx, 0, GATE_PLINTH_H / 2, GATE_W - 0.02, GATE_D - 0.03, GATE_PLINTH_H)
  slab(g, mats.steel, cx, 0, (GATE_PLINTH_H + GATE_BODY_TOP) / 2, GATE_W, GATE_D, GATE_BODY_TOP - GATE_PLINTH_H)
  slab(g, mats.gateNavy, cx, 0, (GATE_BODY_TOP + GATE_SHOULDER) / 2, GATE_W, GATE_D, GATE_SHOULDER - GATE_BODY_TOP)
  const head = prism(g, mats.gateNavy, GATE_W, -front, front, -headFront, headFront, GATE_SHOULDER, capBase)
  head.position.x = cx
  const cap = prism(g, mats.darkSteel, GATE_W * 0.94, -headFront * 0.94, headFront * 0.94, -topFront, topFront, capBase, GATE_H)
  cap.position.x = cx
  for (const [fy, yaw] of [
    [-1, 0],
    [1, Math.PI],
  ] as const) {
    // `at(d, depth)` stands `d` off a face, outward, on this face.
    const at = (d: number, depth = GATE_D): number => fy * (depth / 2 + d)
    // The screen rides the sloped shoulder, tipped up at the passenger.
    const midZ = (GATE_SHOULDER + capBase) / 2
    const midFront = -(front + headFront) / 2
    const bezel = plate(g, mats.black, 0.3, 0.25, cx, at(0.004, 2 * midFront), midZ, yaw, GATE_SHOULDER_TILT)
    bezel.renderOrder = 1
    const screen = plate(g, mats.trainGlass, 0.26, 0.2, cx, at(0.014, 2 * midFront), midZ, yaw, GATE_SHOULDER_TILT)
    screen.renderOrder = 2
    // The two lane lights on the vertical face below the shoulder.
    plate(g, mats.ledGreen, 0.08, 0.05, cx - 0.15, at(0.025), 0.92, yaw)
    plate(g, mats.ledRed, 0.08, 0.05, cx + 0.15, at(0.025), 0.92, yaw)
    // The round card reader on its black pad…
    slab(g, mats.black, cx, at(0.012), 0.84, 0.18, 0.03, 0.12)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.016, 16), mats.green)
    ring.position.set(cx, at(0.026), 0.84)
    g.add(ring)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 16), mats.white)
    disc.position.set(cx, at(0.034), 0.84)
    g.add(disc)
    // …and the QR window below it.
    slab(g, mats.black, cx, at(0.012), 0.7, 0.16, 0.03, 0.085)
    plate(g, mats.trainGlass, 0.12, 0.05, cx, at(0.03), 0.7, yaw)
    // The lit lane arrow across the body's lower front — single-headed and
    // pointing up, the way through — and the blue band the reference gates print
    // their 入站 / 出站 sign on at the foot.
    slab(g, mats.black, cx, at(0.012), 0.39, 0.3, 0.03, 0.33)
    const arrow = plate(g, mats.gatePanel, 0.26, 0.29, cx, at(0.03), 0.39, yaw)
    arrow.renderOrder = 3
    slab(g, mats.blue, cx, at(0.014), 0.13, 0.3, 0.03, 0.07)
  }
  if (lane) {
    // The hinge pin on the machine's inner face, then the leaf itself, which
    // `setGateWing` keeps pinned there as it slides in. Its cabinet-side edge is
    // held fixed and the far edge runs back into the machine as the gate opens —
    // the leaf compresses along its length instead of swinging — and a stub
    // always stays proud of the panel, so the door never seems to vanish.
    slab(g, mats.darkSteel, inner + 0.015, 0, 0.51, 0.05, 0.1, 0.74)
    const fullW = 0.56
    const wing = slab(g, mats.gateRed, 0, 0, 0.51, fullW, 0.05, 0.68)
    wing.name = 'wing'
    wing.userData.fullW = fullW
    wing.userData.edgeX = inner
    g.userData.wing = wing
    setGateWing(g, 0)
  } else {
    // Doorless: the lane's half is fence, so the barrier carries on through this
    // cell. The panel meets the neighbouring run at the cell edge — and caps
    // itself there when that neighbour is nothing at all — and a jamb post stands
    // where it leaves the machine.
    const [ox, oy] = rotateLocal(mod.rot, 1, 0)
    const carried = ctx.data.modules.some((m) => {
      if (m.z !== mod.z || m.x !== mod.x + ox || m.y !== mod.y + oy) return false
      if (m.type === 'fence') return true
      // `gateSolidFaces` reads the offset from the other gate back to this cell.
      return m.type === 'gate' && gateSolidFaces(m, -ox, -oy)
    })
    drawFence(
      g,
      mats,
      {
        x0: inner,
        x1: 0.5,
        y0: 0,
        y1: 0,
        capE: !carried,
        capW: false,
        capN: false,
        capS: false,
      },
      false,
    )
    fencePost(g, mats, inner, 0)
  }
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
  // The leaf runs from the machine's inner face toward the far cell edge, so the
  // hinge end stays put as the leaf shrinks into the panel.
  wing.position.x = edgeX + (fullW * s) / 2
}

/* ----------------------------------------------------------------- fence */

/** One fence post: a base plate and the 1 m steel upright over it. */
function fencePost(g: THREE.Group, mats: ModelMaterials, x: number, y: number): void {
  slab(g, mats.darkSteel, x, y, 0.02, 0.16, 0.16, 0.04)
  slab(g, mats.steel, x, y, 0.5, 0.08, 0.08, 1.0)
}

/**
 * Draw the panel `fenceArms` describes: rails and glass along each arm, the
 * centre joint post, and an end post on every capped end. Shared by a 围栏 cell
 * and by the fence half of a **doorless** 闸机, so a run drawn across both reads
 * as one barrier. The arms are in cell-centre metres, ±0.5 being a cell edge.
 */
function drawFence(g: THREE.Group, mats: ModelMaterials, arms: FenceArms, centrePost = true): void {
  const { x0, x1, y0, y1, capE, capW, capN, capS } = arms
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
  // Posts: the centre joint — a plain 围栏 cell's own; the fence half of a
  // doorless 闸机 stands its jamb post against the machine instead — plus an end
  // post on every capped end.
  if (centrePost) fencePost(g, mats, 0, 0)
  if (capE) fencePost(g, mats, 0.46, 0)
  if (capW) fencePost(g, mats, -0.46, 0)
  if (capN) fencePost(g, mats, 0, 0.46)
  if (capS) fencePost(g, mats, 0, -0.46)
}

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
  // A fence connects to another fence, to a gate's **machine** side, and to a
  // stair/escalator landing — the run's handrail reaches that cell, so the fence
  // drops its end cap and butts up to the railing instead of stopping short.
  // A gate is a machine body beside a lane, and only the machine is something a
  // run may butt into: a fence on the lane side ends at the doorway with its own
  // end post, so the opening is left open (`gateSolidFaces`). A **doorless** gate
  // is solid all round, its own half of the block being fence.
  const joined = (x: number, y: number): boolean =>
    ctx.data.modules.some((m) => {
      if (m.z !== mod.z) return false
      if (m.type === 'fence') return m.x === x && m.y === y
      // `gateSolidFaces` reads the offset from the gate back to this fence cell.
      return m.type === 'gate' && m.x === x && m.y === y && gateSolidFaces(m, mod.x - x, mod.y - y)
    }) || railLandingAt(ctx.data.modules, x, y, mod.z)
  const e = joined(mod.x + 1, mod.y)
  const w = joined(mod.x - 1, mod.y)
  const n = joined(mod.x, mod.y + 1)
  const s = joined(mod.x, mod.y - 1)
  drawFence(g, mats, fenceArms(mod.rot, { e, w, n, s }))
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

  const W = ESCALATOR_BALUSTRADE // balustrade spacing
  const rise = 1.0 // handrail height
  // One run, one tile: the handrails reach only 0.49 m from the centreline, so the
  // whole assembly — truss, skirts, glass, rails — stays inside its own cell. Two
  // runs in adjacent cells therefore never touch: each keeps both of its
  // balustrades, and the pair reads as a bank of two rails side by side. Truss and
  // side skirts are trimmed to the run, so the ramp never pokes past its landings
  // into the floor it connects to.
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
  // edge, round the end, and down onto the floor — instead of stopping dead in
  // mid-air, and a flat newel plate closes the foot of each balustrade.
  for (const s of [1, -1]) {
    slab(g, mats.glass, len / 2, (s * W) / 2, rise / 2, len, 0.03, rise)
    slab(g, mats.handrail, len / 2, (s * W) / 2 + s * 0.03, rise, len, 0.1, 0.08)
  }
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
 *
 * A stair is built to fit inside one tile, handrails included, so it keeps both
 * of its railings and may stand flush against an escalator or another stair:
 * each run's own balustrade is the barrier between them. Two lanes of the *same*
 * wide flight are the exception — they drop the rail along the seam and run their
 * treads together, so a 2- or 3-lane stair reads as one wide flight with rails
 * only at its outer edges (`stairLaneMates`). So is a side a **wall hugs from
 * bottom to top** (`stairWallSides`): the wall is the barrier there, so the
 * flight keeps only the stringer it meets the wall with, and grows no handrail,
 * rail posts or newel return of its own — a staircase in a stairwell is railed on
 * its open side alone.
 */
function buildStair(ctx: ModuleContext, mod: Extract<Module, { type: 'stair' }>): THREE.Group {
  const g = new THREE.Group()
  const width = mod.cfg.width ?? STAIR_WIDTH_NARROW
  const surface = stairSurface(ctx, mod)
  const flights = stairFlights(mod)
  // Only the module's outer landings stand on a floor of their own; an interior
  // turn landing carries the rail around the corner, so a return there would drop
  // a newel in the middle of the platform.
  const outer = new Set([mod.from, mod.to].map((p) => `${p.x},${p.y},${p.z}`))
  const mates = stairLaneMates(ctx.data.modules, mod)
  for (const f of flights) {
    g.add(buildStairFlight(ctx.mats, surface, f.from, f.to, width, outer, mates, stairWallSides(ctx.data.cells, f.from, f.to)))
  }
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
 * Both sides carry a stringer and a handrail, and each handrail levels off at
 * its landing and turns down into a newel post on the floor.
 *
 * `mates` are the lane flights standing flush beside this one
 * (`stairLaneMates`). Every one of them **joins the steps**: this lane's treads
 * and risers run out to the cell edge, so two lanes side by side never leave a
 * gap between them. Only a mate of the *same* flight — the same `cfg.flight`
 * token, i.e. another lane of one wide stair placed in a single action — also
 * loses this side's stringer, handrail and posts, so a 2- or 3-lane stair reads
 * as one wide flight railed at its outer edges, while two stairs dropped
 * separately keep the rail down the middle between their joined steps. `local +y`
 * is `(-uy, ux)` in world space, which is how a world step becomes a local side.
 *
 * `walls` are the sides a wall hugs from bottom to top (`stairWallSides`), which
 * keep their stringer but lose the handrail, its posts and its newel return: the
 * wall is the barrier on that side, and a rail standing against it is the same
 * balustrade drawn twice — the treads still stop at their own edge, so the
 * stringer stays to meet the wall.
 */
function buildStairFlight(
  mats: ModelMaterials,
  surface: THREE.Material,
  from: Vec3i,
  to: Vec3i,
  width: number,
  outer: ReadonlySet<string> = new Set(),
  mates: readonly StairLaneMate[] = [],
  walls: StairWallSides = { left: false, right: false },
): THREE.Group {
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
  // `joinSides` reach the cell edge so the steps meet; `openSides` go further and
  // give up their rail, because they are the same staircase as the lane there.
  // `wallSides` give up only the rail, posts and return: a wall hugs them.
  const joinSides = new Set<number>()
  const openSides = new Set<number>()
  const wallSides = new Set<number>()
  if (run > 1e-6) {
    const ux = dx / run
    const uy = dy / run
    for (const mate of mates) {
      const s = Math.sign(mate.step[0] * -uy + mate.step[1] * ux)
      if (s === 0) continue
      joinSides.add(s)
      if (mate.sameFlight) openSides.add(s)
    }
    // Local +y is the run's left (`-stairRight`), which is the side `walls.left`
    // names; the sides are otherwise the same numbers the mates above are.
    if (walls.left) wallSides.add(1)
    if (walls.right) wallSides.add(-1)
  }
  const yLo = joinSides.has(-1) ? -0.5 : -half
  const yHi = joinSides.has(1) ? 0.5 : half
  const yMid = (yLo + yHi) / 2
  const yWide = yHi - yLo
  // Trim half a landing cell at each end, so the treads start at the edge of the
  // floor the flight leaves and stop at the edge of the floor it reaches —
  // otherwise the top tread is coplanar with the landing slab and z-fights it.
  // Shared with `rampBodyBoxes`, which reserves exactly the tiles this sweeps, so
  // a landing tile really is free floor in the collision model too.
  const inner = stairTreadTrim(run)
  const stairRun = run - inner * 2
  if (stairRun < 0.2 || rise < 1e-3) {
    // Degenerate flight: a level platform, so the piece is never invisible.
    finishSlab(g, surface, Math.max(run, 0.5) / 2, yMid, -STAIR_TREAD_T / 2, Math.max(run, 0.5), yWide, STAIR_TREAD_T)
    return g
  }

  const steps = Math.max(2, Math.round(rise / STAIR_RISE))
  const stepRise = rise / steps
  const going = stairRun / steps
  for (let i = 0; i < steps; i++) {
    // Tread: level, its top on the step line.
    finishSlab(g, surface, inner + i * going + going / 2, yMid, (i + 1) * stepRise - STAIR_TREAD_T / 2, going + 0.002, yWide, STAIR_TREAD_T)
    // Riser under the leading edge, from the tread below up to this one.
    finishSlab(g, surface, inner + i * going, yMid, i * stepRise + stepRise / 2, 0.05, yWide, stepRise)
  }

  // Side stringers, a soffit and a handrail run the incline. `theta` tilts a
  // beam about the width axis so its length follows the slope.
  const midX = inner + stairRun / 2
  const theta = Math.atan2(rise, stairRun)
  const slopeLen = Math.hypot(stairRun, rise)
  for (const s of [1, -1]) {
    if (openSides.has(s)) continue
    // The stringer runs the incline on every side the flight keeps, a walled one
    // included: the treads stop at their own edge, so the stringer is what meets
    // the wall.
    const beam = slab(g, mats.darkSteel, midX, s * (half + 0.05), rise / 2 - 0.2, slopeLen + 0.12, 0.09, 0.32)
    beam.rotation.y = -theta
    // A wall hugging this side is already the barrier: no handrail, no rail posts.
    if (wallSides.has(s)) continue
    const rail = slab(g, mats.handrail, midX, s * (half + 0.07), rise / 2 + 0.95, slopeLen, 0.07, 0.07)
    rail.rotation.y = -theta
    for (let i = 0; i <= 2; i++) {
      const u = inner + (i / 2) * stairRun
      slab(g, mats.steel, u, s * (half + 0.07), ((u - inner) / stairRun) * rise + 0.47, 0.05, 0.05, 0.94)
    }
  }
  // The soffit runs under the whole joined width, overhanging only on a free
  // side — and never past a cell edge, where the neighbouring lane's own soffit
  // carries on.
  const sLo = yLo - (joinSides.has(-1) ? 0 : 0.03)
  const sHi = yHi + (joinSides.has(1) ? 0 : 0.03)
  const soffit = slab(g, mats.darkSteel, midX, (sLo + sHi) / 2, rise / 2 - 0.26, slopeLen + 0.06, sHi - sLo, 0.06)
  soffit.rotation.y = -theta
  // The outer handrails level off at each landing and turn down into a newel
  // post on the floor, so a stair rail wraps round and reaches the ground instead
  // of stopping dead above the last tread — a walled side has no rail to return.
  // `o` is the outward direction along the run: the lower landing is −x, the
  // upper +x.
  for (const s of [1, -1]) {
    if (openSides.has(s) || wallSides.has(s)) continue
    const y = s * (half + 0.07)
    for (const o of [-1, 1]) {
      const end = o < 0 ? lower : upper
      if (!outer.has(`${end.x},${end.y},${end.z}`)) continue
      const xEnd = o < 0 ? inner : inner + stairRun
      const floor = o < 0 ? 0 : rise // the landing this end stands on
      const zEnd = floor + STAIR_RAIL_H
      // The horizontal over-run (overlapping the inclined rail's tip, so the
      // mitre between the two leaves no gap), the quarter turn, and the post it
      // turns into.
      slab(g, mats.handrail, xEnd + o * (STAIR_LEAD / 2 - 0.02), y, zEnd, STAIR_LEAD, 0.07, 0.07)
      const turn = new THREE.Mesh(stairReturnGeo(), mats.handrail)
      turn.position.set(xEnd + o * STAIR_LEAD, y, zEnd - STAIR_RETURN_R)
      if (o < 0) turn.rotation.z = Math.PI // bulge outward at both ends
      g.add(turn)
      const post = zEnd - STAIR_RETURN_R - floor
      slab(g, mats.steel, xEnd + o * (STAIR_LEAD + STAIR_RETURN_R), y, floor + post / 2, 0.07, 0.07, post)
    }
  }
  return g
}

/** Handrail height above the walking line — the escalator's black rail height. */
const STAIR_RAIL_H = 0.95
/** How far a stair handrail runs level over its landing, metres. */
const STAIR_LEAD = 0.34
/** Radius of the turn that carries it down into the newel, metres. */
const STAIR_RETURN_R = 0.25

/**
 * The quarter-turn a stair handrail makes into its newel post: an arc in the
 * x-z plane from the +x side (tangent vertical, where the post is) up to the top
 * (tangent horizontal, where the level over-run is). Built fresh per use — the
 * caller disposes a module's geometry with its group, so it must not be shared.
 */
function stairReturnGeo(): THREE.TorusGeometry {
  const geo = new THREE.TorusGeometry(STAIR_RETURN_R, 0.035, 8, 12, Math.PI / 2)
  geo.rotateX(Math.PI / 2) // into the x-z plane: +x → +z
  return geo
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
 * floor, frame and glass, and the run openings and interior dividers follow the
 * runs actually placed (`exitRunOpenings`), so two runs descend side by side
 * under one roof.
 *
 * The house is built around the bay group (`exitSpan`): one full block of
 * floor at each end, so a 单向 is 3 blocks across, a 双向 4 and a 三向 5. Its
 * centre — `xc` — is the middle of that plan, which for an even width falls on a
 * cell boundary.
 */
function buildExit(ctx: ModuleContext, mod: Extract<Module, { type: 'exit' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  const { centre: xc, half: hw } = exitSpan(mod)
  const W = hw * 2 // across the run group plus its side blocks
  const L = EXIT_L // enclosed part: local y ∈ [−2, +2]
  const H = EXIT_H // canopy height above the walk
  const REACH = EXIT_REACH // how far the canopy reaches over the escalator run (−y)
  const BACK = EXIT_BACK // canopy overhang past the street doorway (+y)
  const hl = L / 2
  const covered = mod.cfg.covered !== false
  const side = hw - 0.06 // the glass line, just inside the frame
  const BACKY = EXIT_BACK_Y // back wall, just past where the runs go under the floor

  // Head-house floor: one thin plate over the whole plan the exit claims, so no
  // hollow cell shows between the railings. It runs from one full block before
  // the first run to one full block past the last, and the plaza floor never
  // shows through it. Only a column a run actually descends through is left
  // open — and only along the middle of the descent, never the top-landing row or
  // the mouth-most row the back rail stands on.
  const padLo = xc - hw
  const padHi = xc + hw
  const yHi = Math.ceil(EXIT_BACK + 0.5) - 0.5 // cell-aligned street edge
  const landingBack = -0.5 // back edge of the run's top-landing cell (local y)
  const corridorBack = BACKY + 1 // the mouth-most cell stays floored under the rail
  // Walkway plus the top-landing row: solid full width.
  slab(g, mats.darkSteel, xc, (landingBack + yHi) / 2, 0.05, W, yHi - landingBack, 0.1)
  // The mouth-most row, solid full width so the back rail sits on the pad.
  slab(g, mats.darkSteel, xc, (BACKY + corridorBack) / 2, 0.05, W, corridorBack - BACKY, 0.1)
  // The descending corridor between them opens only at a run column.
  const stripLen = landingBack - corridorBack
  const stripY = (landingBack + corridorBack) / 2
  const strip = (cx: number, w: number): void => {
    if (w > 0.02) slab(g, mats.darkSteel, cx, stripY, 0.05, w, stripLen, 0.1)
  }
  // The columns runs actually land in (`exitRunOpenings`) and the width each one
  // needs. A run fits its own block, so the floor keeps a full block beside it —
  // the black pad on each side covers the whole cell.
  const runs = exitRunOpenings(ctx.data.modules, mod)
  let prev = padLo
  for (const run of runs) {
    // A run descends here: leave a handrail-clear opening, or the balustrade
    // surfaces through the strips beside it.
    strip((prev + (run.column - run.half)) / 2, run.column - run.half - prev)
    prev = run.column + run.half
  }
  strip((prev + padHi) / 2, padHi - prev)

  /**
   * The interior dividers a head-house rails for itself: the midpoint between
   * two runs with an empty block between them. Runs standing side by side share
   * the two balustrades their own models already draw on the boundary, so nothing
   * is drawn between those two — a rail there would cut through both of them.
   */
  const dividers: number[] = []
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i]
    const b = runs[i + 1]
    if (b.column - a.column >= 2) dividers.push((a.column + b.column) / 2)
  }

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

  // The canopy profile, shared by the roof, the glazing and the sign: it rises
  // toward the street doorway (+y), so the sign side stands tallest.
  const FLOOR_TOP = 0.3
  const ry0 = -REACH
  const ry1 = BACK
  const waveAmp = 0.16
  const periods = 0.85
  const heightAt = (t: number): number => H + 0.4 * (t - 0.5) - waveAmp * Math.sin(t * Math.PI * 2 * periods)
  const topAt = (y: number): number => heightAt((y - ry0) / (ry1 - ry0))

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
      for (const sx of [-1, 1]) slab(g, mats.exitRed, xc + sx * frameX, fy, frameTop / 2, 0.16, 0.16, frameTop)
      slab(g, mats.exitRed, xc, fy, frameTop - 0.08, frameX * 2 + 0.16, 0.16, 0.16)
    }
    // Base frame: side members along the run plus the far cross tie only — the
    // street doorway stays clear, so no red beam runs across the entrance floor.
    const baseY0 = frameYs[0]
    const baseY1 = frameYs[frameYs.length - 1]
    for (const sx of [-1, 1]) slab(g, mats.exitRed, xc + sx * frameX, (baseY0 + baseY1) / 2, 0.2, 0.14, baseY1 - baseY0 + 0.3, 0.2)
    slab(g, mats.exitRed, xc, baseY0, 0.2, frameX * 2, 0.14, 0.2)

    // Blue waved canopy, rising toward the street doorway (+y). `heightAt` is
    // the profile the roof, the glazing and the sign share, so the glass meets
    // the roof edge with no gap and the sign hangs off the roof itself.
    // The canopy overhangs the frame, but never past the plan the exit claims
    // (a 单向 is only three blocks, so its roof is trimmed to the floor edge).
    const roofW = Math.min(frameX * 2 + 0.6, W)
    buildWavyRoof(g, mats.blue, xc, ry0, ry1, roofW, 22, heightAt)

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
    for (const sx of [-1, 1]) sideGlass(xc + sx * side)
    // Glass back wall (glazed like the sides); its head follows the roof there.
    const zBack = topAt(BACKY)
    slab(g, mats.glass, xc, BACKY, (zBack + FLOOR_TOP) / 2, side * 2, 0.05, zBack - FLOOR_TOP)

    // Under-canopy light strips down the middle, tucked under the wave.
    for (let i = 0; i < 3; i++) {
      const ly = 1.2 - i * 2.0
      slab(g, mats.glow, xc, ly, topAt(ly) - 0.1, 0.16, 0.9, 0.04)
    }

    // Handrail down each divider between two runs.
    for (const cx of dividers) {
      slab(g, mats.steel, cx, -1.0, 0.95, 0.06, 2.0, 0.06)
      for (const s of [-1, 1]) for (let j = 0; j <= 1; j++) slab(g, mats.steel, cx, s * (0.2 + j * 1.6), 0.5, 0.06, 0.06, 0.9)
    }
  } else {
    // 无盖: no canopy, frame or walls — a railing stands where each wall was, all
    // the way along the sides and across the back, plus each divider between runs.
    for (const sx of [-1, 1]) railZ(xc + sx * side, EXIT_GLASS_Y0, EXIT_GLASS_Y1)
    railX(BACKY, xc - side, xc + side)
    for (const cx of dividers) railZ(cx, BACKY, EXIT_GLASS_Y1)
  }

  // The exit's own name (A口 / 北门) prints on the header board, so renaming it in
  // the inspector updates the model.
  //
  // 有盖 hangs the board off the canopy at the street doorway: its top edge meets
  // the roof underside, so the sign reads as part of the head-house rather than
  // floating on a frame. 无盖 has no roof — and nothing to hang from — so the board
  // is fixed over the *mouth* railing instead: it lies over that fence's glass and
  // faces back up the runs, toward the wellway the crowd descends, so the railing
  // carries it and it needs no posts of its own. Both read from the same side
  // (+y, the head-house's own length), which is where a passenger stands.
  const signBoard = 0.62
  const signY = covered ? hl - 0.02 : BACKY
  const signZ = covered ? topAt(hl + 0.06) - signBoard / 2 - 0.02 : 0.52
  slab(g, mats.darkSteel, xc, signY, signZ, W - 0.06, 0.12, signBoard)
  const header = plate(g, new THREE.MeshBasicMaterial({ map: canvasTexture(512, 96, (c) => c.drawImage(exitHeaderCanvas(ctx.data.name || '地铁', mod.cfg.name || '出入口'), 0, 0)) }), W - 0.3, 0.5, xc, signY + 0.08, signZ, Math.PI)
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
  // Openings that actually fall on this run, ascending. The cadence is measured
  // from the *consist* centre, which is the rail's run centre — not this edge's,
  // which may cover only part of the bed (a platform shorter than its rail, or a
  // run split by a wall). Anchoring on the rail is what keeps every opening on
  // the car door it exists to meet (§1.13); an edge that has lost its rail falls
  // back to assuming it is centred on the consist.
  const rail = mod.cfg.from ? ctx.data.modules.find((m) => m.id === mod.cfg.from) : undefined
  const bed = rail?.type === 'track' ? rail : undefined
  const bedW = bed?.w ?? len
  // The edge's own first cell, in rail-local metres along the run.
  const i0 = bed ? rotateLocal(-(bed.rot ?? 0), mod.x - bed.x, mod.y - bed.y)[0] : (bedW - len) / 2
  const openings = doorRunOffsets({ stock, cars }, bedW)
    .map((at) => at - i0 + x0)
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
 * One train (车辆) as an A/B/C/L consist: rounded body, window band, livery,
 * sliding doors at the timetable's door centres and two bogies per car. Both
 * ends wear the same cab (§1.12), and only the lamps tell them apart: the
 * leading end lights white, the trailing end red. Built in world space with the
 * origin at the train centre on the track surface.
 *
 * The cab is a re-skin of the end car's last 2 m, not an extension, so the
 * body stays exactly `cars × carLength` long and the door cadence keeps lining
 * up with the screen doors it was derived from (§1.13). It stops just short of
 * the car's first passenger door, which stands `DOOR_END_INSET` in from the car
 * end. Only the coupler hangs past the nose, as it does on the real car.
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
      // The nose accent belongs to the cabs now (`buildCab` draws their cream
      // swoosh); a rising patch on every car only muddied the window band.
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
          registerDoorLeaf(m, leaf, s.doorWidth / 2, doors, side)
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

  // A cab at each end (車头), identical but for the lamps: the leading one burns
  // white, the trailing one red — the only difference the reference photos show
  // between the two ends of a consist.
  const lead = (total / 2) * (pose.dirSign >= 0 ? 1 : -1)
  const leadOut = pose.dirSign >= 0 ? 1 : -1
  buildCab(g, mats, s, lead, leadOut, true)
  buildCab(g, mats, s, -lead, -leadOut, false)
  // The train keeps its own pose; the caller moves the group.
  g.position.set(pose.x, pose.y, pose.z)
  return g
}

/**
 * One cab end (车头), the assembly the reference photographs show: the silver
 * shell carried on to the nose, the dark face mask with the tall centre
 * windscreen and the two crew-door windows, the red 广州 mark, the twin lamp
 * clusters low at the corners, the marker bars high at the corners, the cream
 * bumper band and cheek swoosh, the number plates and the coupler hanging under
 * the nose.
 *
 * `nose` is the consist-local x of the end face and `outward` the sign that end
 * faces (+1 for the leading end of a `dirSign >= 0` train). `head` selects the
 * lamps: white head lamps on the end that leads, red tail lamps on the end that
 * trails. Both ends wear the same body.
 */
function buildCab(g: THREE.Group, mats: ModelMaterials, s: Stock, nose: number, outward: number, head: boolean): void {
  const d = outward
  const lamp = head ? mats.headlight : mats.taillight
  const faceW = s.width * 0.86
  /** A box `dist` metres out along the nose's own axis, thickness `sx`. */
  const out = (mat: THREE.Material, dist: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh =>
    slab(g, mat, nose + d * dist, y, z, sx, sy, sz)

  // Shell, roof cap and underframe continue the car's silhouette to the nose.
  out(mats.trainBody, -1, 0, 1.72, 2, s.width, 2.44)
  out(mats.trainRoof, -1, 0, 3.05, 2, s.width - 0.2, 0.2)
  out(mats.trainDark, -1, 0, 0.42, 2, s.width - 0.1, 0.5)
  // The dark face mask, proud of the end wall so it reads from any angle.
  out(mats.trainDark, -0.03, 0, 1.98, 0.14, faceW, 1.94)
  // Cream bumper band under the mask.
  out(mats.trainTrim, 0.05, 0, 0.98, 0.16, faceW, 0.3)
  // Windows: the tall centre windscreen and the two crew-door windows beside it.
  out(mats.trainGlass, 0.06, 0, 2.24, 0.05, s.width * 0.22, 0.92)
  for (const wy of [-1, 1]) out(mats.trainGlass, 0.06, wy * s.width * 0.3, 2.16, 0.05, s.width * 0.2, 0.76)
  // The 广州地铁 mark below the windscreen, in the nose's own plane.
  plate(g, mats.trainMark, 0.46, 0.54, nose + d * 0.09, 0, 1.46, d > 0 ? Math.PI / 2 : -Math.PI / 2)
  // Marker bars high at the corners, sunk in a dark housing.
  for (const wy of [-1, 1]) {
    out(mats.trainDark, 0.03, wy * s.width * 0.29, 2.78, 0.08, 0.5, 0.16)
    out(lamp, 0.08, wy * s.width * 0.29, 2.78, 0.06, 0.42, 0.09)
  }
  // Twin-lens lamp clusters low at the corners.
  for (const wy of [-1, 1]) {
    const cy = wy * s.width * 0.31
    out(mats.trainDark, 0.04, cy, 1.38, 0.1, 0.62, 0.42)
    for (const wx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 10), lamp)
      // A cylinder's axis is +y; the cab's outward axis is ±x, so tip it over.
      lens.rotation.z = Math.PI / 2
      lens.position.set(nose + d * 0.1, cy + wx * 0.14, 1.38)
      g.add(lens)
    }
    // Number plate on the skirt corner.
    out(mats.white, 0.05, wy * s.width * 0.33, 0.72, 0.05, 0.32, 0.13)
  }
  // Coupler hanging under the nose.
  out(mats.darkSteel, 0.3, 0, 0.42, 0.5, 0.6, 0.46)
  out(mats.gateRed, 0.45, 0, 0.45, 0.12, 0.34, 0.26)
}

/**
 * Register a door leaf so `setDoors` / `setDoorsSides` can slide it. `sign` is
 * the direction it opens along x, `travel` how far (metres) it moves at full
 * open, and `side` which bank it belongs to on a consist (its local ±y); a leaf
 * with no side — a screen door or a lift cabin — answers to both banks.
 */
function registerDoorLeaf(mesh: THREE.Mesh, sign: number, travel: number, out: THREE.Mesh[], side?: number): void {
  mesh.userData.closedX = mesh.position.x
  mesh.userData.openSign = sign
  mesh.userData.travel = travel
  if (side !== undefined) mesh.userData.side = side
  out.push(mesh)
}

/**
 * Slide the two door banks of a consist independently (GAME-SPEC §1.13): `plus`
 * drives the leaves on the consist's local +y, `minus` those on local −y, each
 * 0 shut to 1 fully open. A side with no platform screen doors is simply left at
 * 0, so a train never opens onto the tunnel wall. Leaves with no side (a screen
 * door, a lift cabin) follow `plus`.
 */
export function setDoorsSides(root: THREE.Object3D, plus: number, minus: number): void {
  const doors = (root.userData.doors as THREE.Mesh[] | undefined) ?? []
  for (const d of doors) {
    const side = (d.userData.side as number | undefined) ?? 1
    const t = side >= 0 ? plus : minus
    const closed = (d.userData.closedX as number) ?? d.position.x
    const sign = (d.userData.openSign as number) ?? 1
    const travel = (d.userData.travel as number) ?? 0.32
    d.position.x = closed + sign * travel * t
  }
}

/**
 * Slide every registered door leaf of `root` to progress `t` (0 shut, 1 fully
 * open). The caller owns the easing/progress; this only places the geometry.
 */
export function setDoors(root: THREE.Object3D, t: number): void {
  setDoorsSides(root, t, t)
}
