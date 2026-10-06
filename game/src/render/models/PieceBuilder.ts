// Shared procedural-model kit behind render/models.ts (Lane E, step 0).
// Palette, material printers, canvas/ink helpers, the slab/plate/prism kit,
// ModuleContext, and the PieceBuilder abstract base every piece extends.
// Drawn-from geometry rules (clock dial, booth closed box) stay with the
// builders that own them; only genuinely-shared geometry lives here.

import * as THREE from 'three'
import type { FenceArms } from '../../sim/fences.ts'
import { PANEL_SIZE, makeSignBoards, signPlate } from '../../sim/sign.ts'
import type { SignBoards, SignLayout, SignPanelSize } from '../../sim/sign.ts'
import type { TvPairSlot } from '../../sim/tvs.ts'
import type { FinishId, Module, StationData, CalligraphyAxis, CalligraphyStyle } from '../../sim/types.ts'
import type { AdArt } from '../adArt.ts'
import { calligraphyPlate, drawCalligraphyPanel } from '../calligraphyFace.ts'
import { drawLineMapPlaceholder, lineMapPlaceholderPlate } from '../lineMapFace.ts'
import { LINE_MAP_PANEL_H, LINE_MAP_PANEL_W } from '../../sim/linemaps.ts'
import { drawSignPanel } from '../signFace.ts'

/* ------------------------------------------------------------------ palette */

export const C = {
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
  /**
   * The 门's timber (装饰): a warm walnut for its frame, a paler one for its leaf and a
   * dark one for fittings. One wood per piece — the door is the only piece that wears
   * it — so the tones are named here rather than tinted per mesh.
   */
  wood: 0x8a5a2b,
  woodLight: 0xb98a54,
  woodDark: 0x5a3a1c,
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
  /** The 门 piece's timber: the frame, its paler leaf and a dark tone for fittings. */
  wood: THREE.MeshStandardMaterial
  woodLight: THREE.MeshStandardMaterial
  woodDark: THREE.MeshStandardMaterial
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
  /**
   * The fallback 站名 ink, for a caller with no station document behind it: the
   * neutral name written in 楷书 横排 at the default panel, drawn by the same code a
   * placed piece uses. **Transparent**: an inscription is strokes on the wall, so
   * everything the brush does not cover is the piece's own absence.
   */
  calligraphyInk: THREE.MeshBasicMaterial
  /**
   * The fallback 线网图 board, for a caller with no station document behind it: a real
   * map of an empty network, which prints 尚未铺设线路 in the middle of the plan
   * rather than an empty white rectangle.
   */
  lineMapPlaceholder: THREE.MeshBasicMaterial
  /** The 货架 perforated back panel (dark charcoal pegboard). */
  shelfPanel: THREE.MeshStandardMaterial  /** Base white material for the shelf goods; each instance tints it. */
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
    // The 门's three tones: a walnut frame, a paler leaf, a dark pull. Wood is matte
    // and slightly rough — the one place in the kit that is not metal, enamel or
    // screen — so it reads as timber from the isometric camera.
    wood: new THREE.MeshStandardMaterial({ color: C.wood, roughness: 0.72, metalness: 0.04 }),
    woodLight: new THREE.MeshStandardMaterial({ color: C.woodLight, roughness: 0.7, metalness: 0.04 }),
    woodDark: new THREE.MeshStandardMaterial({ color: C.woodDark, roughness: 0.66, metalness: 0.06 }),
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
    // The fallback 站名 / 线网图 faces, for a caller with no station document and no
    // artwork behind it (a unit test): the neutral name, and the drawn placeholder board
    // for a station with no lines. Both are drawn by the same code those pieces print
    // with, and the map's is cut to the **real panel** (`sim/linemaps.ts`), so a
    // station-less build shows a board of the right shape rather than a placeholder
    // square. Neither is reprinted later — no artwork decodes for either, unlike the
    // sign's pictograms.
    calligraphyInk: new THREE.MeshBasicMaterial({
      map: canvasTexture(
        calligraphyPlate(CALLIGRAPHY_FALLBACK_PANEL).width,
        calligraphyPlate(CALLIGRAPHY_FALLBACK_PANEL).height,
        (g) => drawCalligraphyPanel(g, { text: '地铁站', style: 'kai', axis: 'h', panel: CALLIGRAPHY_FALLBACK_PANEL }),
      ),
      transparent: true,
      side: THREE.FrontSide,
    }),
    lineMapPlaceholder: litPanelMaterial(
      canvasTexture(lineMapPlaceholderPlate(LINE_MAP_FALLBACK_PANEL).width, lineMapPlaceholderPlate(LINE_MAP_FALLBACK_PANEL).height, (g) => {
        drawLineMapPlaceholder(g, { lines: [], stationName: '', panel: LINE_MAP_FALLBACK_PANEL })
      }),
    ),
  }
}

/** The panel the kit's fallback inscription is cut to, metres. */
const CALLIGRAPHY_FALLBACK_PANEL = { w: 2, h: 1 }

/** The panel the kit's fallback map board is cut to: the piece's own board. */
const LINE_MAP_FALLBACK_PANEL = { w: LINE_MAP_PANEL_W, h: LINE_MAP_PANEL_H }

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
    if (!mesh.isMesh) return
    // A 广告牌 / 电视 lit face draws a quad `render/adArt.ts` owns and shares with
    // every screen on the same panel; freeing it here would leave the next rebuild
    // drawing a disposed geometry.
    if (!isSharedGeometry(mesh)) mesh.geometry.dispose()
    // **An `InstancedMesh` also owns its instance buffers**, and `geometry.dispose()`
    // does not touch them: three frees `instanceMatrix`/`instanceColor` only on the
    // mesh's own `dispose` event. A contact-blob batch, an escalator's step band and
    // a shelf's goods are all instanced and rebuilt on every edit, so without this
    // every rebuild left a dead GL buffer per batch on the GPU for the session.
    const im = mesh as THREE.InstancedMesh
    if (im.isInstancedMesh) im.dispose()
  })
}

/** True for a mesh whose geometry is owned elsewhere (see `plateOf`). */
export function isSharedGeometry(mesh: THREE.Mesh): boolean {
  return mesh.userData.sharedGeometry === true
}

/* ------------------------------------------------------------------ helpers */

export function slab(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
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
export function plate(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, yaw: number, tilt = 0): THREE.Mesh {
  return plateOf(parent, new THREE.PlaneGeometry(w, h), mat, x, y, z, yaw, tilt)
}

/**
 * The same plane around a geometry the caller already owns — how a
 * 装饰 screen mounts the lit face whose UVs are pre-cut to the panel
 * (`render/adArt.ts`). `yaw` and `tilt` turn the plate exactly as `plate` does.
 *
 * The geometry is `adArt`'s and is **shared** by every screen printing the same
 * panel, so it is tagged: `disposeObject` must not free it with the module group
 * the mesh happens to live in (see `isSharedGeometry`).
 */
export function plateOf(
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
  m.userData.sharedGeometry = true
  m.position.set(x, y, z)
  m.rotation.order = 'ZXY'
  m.rotation.set(Math.PI / 2 - tilt, 0, yaw)
  parent.add(m)
  return m
}

/** Round the top rim of a cabinet with a slightly inset cap. */
export function capTop(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, h = 0.06): void {
  slab(parent, mat, x, y, z + h / 2, sx * 0.94, sy * 0.94, h)
}

/**
 * A **trapezoidal prism**: a box whose top face is shorter than its base, so a
 * cabinet can wear the reference gate's 115° shoulder instead of reading as a
 * plain brick. `y0`/`y1` are the base's near and far faces, `yt0`/`yt1` the top's,
 * and the prism spans `xw` centred on 0 from `z0` to `z1`. Flat-shaded (every
 * triangle keeps its own vertices), which is what the kit's boxy look wants.
 */
export function prism(
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

/**
 * One printed board, as a model mounts it: the material that lights the mesh, and —
 * for a face cut from a **real image** — the quad whose UVs hold the crop window that
 * fits the picture to the panel (`render/panelUv.ts`). A drawn plate has no geometry of
 * its own: it is cut to the panel, so the model mounts a plain `plate` at that size.
 *
 * `texture` names the pixels when the caller mints them, so a plate this system owns can
 * be repainted in place (`PlateSystem.redrawDecorPlates`); a face shared out of an art
 * cache (the 线网图's poster) has none, because nothing about it follows the document.
 */
export interface PrintedFace {
  material: THREE.Material
  geometry?: THREE.BufferGeometry
  texture?: THREE.Texture
}

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
  /**
   * The ink of one 站名, keyed by module id: the station's own name
   * (`StationData.name`, read by the plate system from the live document) written
   * in the piece's hand and cut to the piece's panel. A **material** (carried as a
   * `PrintedFace`, like the 线网图's), for the same reason a 指示牌's face is one — and
   * transparent, because an inscription is brush strokes on the wall rather than a
   * printed board.
   *
   * Omitted by a caller with no station behind it (a unit test), which falls back
   * to the kit's own neutral inscription.
   */
  calligraphyFace?: (
    id: string,
    spec: { style: CalligraphyStyle; axis: CalligraphyAxis; panel: { w: number; h: number } },
  ) => PrintedFace
  /**
   * The printed face of one 线网图: the supplied 线网示意图 (`render/lineMapArt.ts`) once
   * its pixels are in hand, and the drawn placeholder board before that
   * (`render/lineMapFace.ts`). One face serves **both** faces of the free-standing
   * totem.
   *
   * `geometry` is the pre-cut quad a **real image** needs — its UV window is the
   * centred crop that fits the poster to the panel, so a map is never stretched — and
   * is absent for a drawn board, which is cut to the panel and mounts as a plain
   * `plate` at that size.
   *
   * Omitted by a caller with no scene behind it (a unit test), which falls back to the
   * kit's own empty map board.
   */
  lineMapFace?: (id: string, panel: { w: number; h: number }) => PrintedFace
  /** A floor/wall finish material, so a stair can wear the floor it serves. */
  finish: (id: FinishId) => THREE.Material
  /** True when building the translucent placement ghost, not a placed module. */
  preview?: boolean
  /**
   * A sink for the materials a builder mints **for this call alone**.
   *
   * `disposeObject` keeps materials, because almost every one of them is the
   * shared kit in `mats` — but five builders print a canvas of their own (a 电视
   * plate, a 站台门 header, an 出入口 header, the 售票机 marquee, a room's 招牌) and
   * mint a material to wrap it. Those are new on every rebuild, so if nobody
   * records them a 5-minute build session uploads a fresh texture per module per
   * edit and never deletes one. A builder that makes one pushes it here; the scene
   * disposes exactly this list when it rebuilds (`clearModules`), which is safe
   * precisely because nothing shared is ever pushed.
   *
   * Omitted by a caller with no rebuild cycle behind it (a palette thumbnail pass
   * or a unit test); those leak nothing because they run once.
   */
  owned?: THREE.Material[]
}


/** Position a locally-built group at its cell and apply the 90° rotation. */
export function placeLocal(group: THREE.Group, mod: Module): THREE.Group {
  group.position.set(mod.x + 0.5, mod.y + 0.5, mod.z + 1)
  if (mod.rot) group.rotation.z = (mod.rot * Math.PI) / 2
  return group
}

/**
 * A material minted for one build, handed to the context's `owned` sink so the
 * scene can dispose it with the module group it belongs to (see `ModuleContext.owned`).
 * Every use of this is a canvas print that is new on each rebuild and that
 * `disposeObject` would otherwise keep forever.
 */
export function ownedMaterial<T extends THREE.Material>(ctx: ModuleContext, mat: T): T {
  ctx.owned?.push(mat)
  return mat
}

/* ----------------------------------------------------------------- fence */

/** One fence post: a base plate and the 1 m steel upright over it. */
export function fencePost(g: THREE.Group, mats: ModelMaterials, x: number, y: number): void {
  slab(g, mats.darkSteel, x, y, 0.02, 0.16, 0.16, 0.04)
  slab(g, mats.steel, x, y, 0.5, 0.08, 0.08, 1.0)
}

/**
 * Draw the panel `fenceArms` describes: rails and glass along each arm, the
 * centre joint post, and an end post on every capped end. Shared by a 围栏 cell
 * and by the fence half of a **doorless** 闸机, so a run drawn across both reads
 * as one barrier. The arms are in cell-centre metres, ±0.5 being a cell edge.
 */
export function drawFence(g: THREE.Group, mats: ModelMaterials, arms: FenceArms, centrePost = true): void {
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
export function finishSlab(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
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
 * Register a door leaf so `setDoors` / `setDoorsSides` can slide it. `sign` is
 * the direction it opens along x, `travel` how far (metres) it moves at full
 * open, and `side` which bank it belongs to on a consist (its local ±y); a leaf
 * with no side — a screen door or a lift cabin — answers to both banks.
 */
export function registerDoorLeaf(mesh: THREE.Mesh, sign: number, travel: number, out: THREE.Mesh[], side?: number): void {
  mesh.userData.closedX = mesh.position.x
  mesh.userData.openSign = sign
  mesh.userData.travel = travel
  if (side !== undefined) mesh.userData.side = side
  out.push(mesh)
}

/* ---------------------------------------------------------- PieceBuilder */

/**
 * The abstract base every module builder extends (Lane E, R4 + R5).
 *
 * The shared geometry kit (slab/plate/prism/finishSlab) and the fence
 * panels live here as plain functions so the moved builder bodies call them
 * verbatim, and again as protected methods so a subclass reaches the same kit
 * through inheritance. The module context (materials, ad art, station document)
 * is wired once in the constructor; each piece file adds one subclass.
 */
export abstract class PieceBuilder {
  abstract readonly kind: string
  protected ctx: ModuleContext
  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }
  protected slab(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
    return slab(parent, mat, x, y, z, sx, sy, sz)
  }
  protected plate(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, yaw: number, tilt = 0): THREE.Mesh {
    return plate(parent, mat, w, h, x, y, z, yaw, tilt)
  }
  protected plateOf(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, yaw: number, tilt = 0): THREE.Mesh {
    return plateOf(parent, geometry, mat, x, y, z, yaw, tilt)
  }
  protected capTop(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, h = 0.06): void {
    capTop(parent, mat, x, y, z, sx, sy, h)
  }
  protected prism(parent: THREE.Object3D, mat: THREE.Material, xw: number, y0: number, y1: number, yt0: number, yt1: number, z0: number, z1: number): THREE.Mesh {
    return prism(parent, mat, xw, y0, y1, yt0, yt1, z0, z1)
  }
  protected finishSlab(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
    return finishSlab(parent, mat, x, y, z, sx, sy, sz)
  }
  protected metreUv(geo: THREE.BufferGeometry, sx: number, sy: number, sz: number): void {
    metreUv(geo, sx, sy, sz)
  }
  protected placeLocal(group: THREE.Group, mod: Module): THREE.Group {
    return placeLocal(group, mod)
  }
  protected ownedMaterial<T extends THREE.Material>(mat: T): T {
    return ownedMaterial(this.ctx, mat)
  }
  protected drawFence(g: THREE.Group, mats: ModelMaterials, arms: FenceArms, centrePost = true): void {
    drawFence(g, mats, arms, centrePost)
  }
}

