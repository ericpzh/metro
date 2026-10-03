// Procedural module models — the art pass behind PLAN §3 item 6 ("modules are
// ad-hoc boxes") and the reference photos in `docs/`. Every module the builder
// can place is a small three.js group built from boxes and planes, sharing one
// set of materials so the whole catalogue reads as one kit of steel, enamel,
// glass and screens.
//
//   TVM        售票机     stainless body, green housing, an LCD and a 车票 sign
//   gate       闸机      stainless cabinet, red wing, green/red lane lights
//   escalator  扶梯      truss, steps, glass balustrade, black handrail
//   exit       出入口    红色钢架, glass walls, a canopy over an up/down pair
//   PSD        站台门    glass screen, white mullions, orange header, red band
//   train      车辆      A/B/C stock, window band, blue livery, sliding doors
//
// Coordinate convention matches the mesher: cell (x,y,z) occupies
// [x,x+1]×[y,y+1]×[z,z+1], +z up. A module at (x,y,z) stands on top of its
// block, so its local origin is the cell centre at height z+1. Escalators, PSDs
// and trains are built in world space because they span more than one cell.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { facilityWallCells, SHOP_WALL_H } from '../build/model.ts'
import { TUNNEL_HEADROOM } from '../build/rail.ts'
import { ESCALATOR_SPEED, ESCALATOR_STEP_PITCH } from '../sim/constants.ts'
import { billboardSpec } from '../sim/billboards.ts'
import { normRot, rotateLocal } from '../sim/track.ts'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_BAY_HALF, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_H, EXIT_L, EXIT_REACH, EXIT_SIDE, EXIT_W } from '../sim/exits.ts'
import { finishOf } from '../sim/finishes.ts'
import { fenceArms } from '../sim/fences.ts'
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
   * The cycles of unlit advertisement posters a 装饰 screen plays (§5.7), one
   * set per aspect so a portrait billboard is not a stretched landscape. Each
   * set is cycled in step by `SceneRenderer.updateAds`.
   */
  adFramesWide: THREE.MeshBasicMaterial[]
  adFramesSquare: THREE.MeshBasicMaterial[]
  adFramesPortrait: THREE.MeshBasicMaterial[]
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
 * One advertisement frame for a wall-mounted screen (§5.7 装饰). Three bright,
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
    adFramesWide: [0, 1, 2].map((v) => adMaterial(v, 256, 128)),
    adFramesSquare: [0, 1, 2].map((v) => adMaterial(v, 192, 192)),
    adFramesPortrait: [0, 1, 2].map((v) => adMaterial(v, 144, 256)),
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
    case 'bench':
      return placeLocal(buildBench(ctx.mats), mod)
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

/* ----------------------------------------------------------------- bench */

/**
 * Bench (座椅): a steel seat pan with a blue backrest, sized to the cell so a
 * row of benches tiles into a 1 × n seating run along a platform wall. Sits
 * against the −y face, leaving the +y side clear to walk up from.
 */
function buildBench(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  // Seat pan and the backrest above it.
  slab(g, mats.steel, 0, -0.16, 0.44, 0.9, 0.42, 0.07)
  slab(g, mats.blue, 0, -0.34, 0.68, 0.9, 0.07, 0.42)
  // A leg frame at each end plus one shared centre leg.
  for (const x of [-0.38, 0, 0.38]) slab(g, mats.darkSteel, x, -0.16, 0.2, 0.06, 0.38, 0.4)
  // Back frame rail and a foot rail tying the legs together.
  slab(g, mats.darkSteel, 0, -0.34, 0.44, 0.92, 0.05, 0.05)
  slab(g, mats.darkSteel, 0, -0.16, 0.03, 0.9, 0.36, 0.05)
  return g
}

/* ----------------------------------------------------------------- shelf */

/**
 * One goods-shelf unit (货架): body, two goods strips and top goods. `along`
 * runs with the aisle and `deep` across it, so the same unit is an island row,
 * a wall run, or a free-standing 装饰 piece. `z0` is the floor top.
 */
function shelfUnit(g: THREE.Group, mats: ModelMaterials, cx: number, cy: number, z0: number, along: number, deep: number): void {
  slab(g, mats.darkSteel, cx, cy, z0 + 0.45, along, deep, 0.9)
  slab(g, mats.orange, cx, cy, z0 + 0.35, along + 0.04, deep + 0.04, 0.12)
  slab(g, mats.green, cx, cy, z0 + 0.65, along + 0.04, deep + 0.04, 0.14)
  slab(g, mats.blue, cx, cy, z0 + 0.95, along, Math.max(0.12, deep - 0.04), 0.1)
}

/**
 * A free-standing shelf for the 装饰 folder: the store's own unit, one cell
 * wide, turning with the placement rotation via `placeLocal`.
 */
function buildShelf(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  shelfUnit(g, mats, 0, 0, 0, 0.9, 0.5)
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
 * Advertising screen (电视): a slim dark bezel with a bright screen playing
 * ads, hung on the wall on the module's local −y face. Smaller and lower than
 * the billboard so the two read as different pieces. `userData.adScreen` is the
 * screen mesh the scene animates.
 */
function buildTv(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const frames = mats.adFramesWide
  // Bezel and a thin steel shell behind it, plus the wall bracket.
  slab(g, mats.darkSteel, 0, -0.4, 1.45, 1.06, 0.05, 0.86)
  slab(g, mats.black, 0, -0.44, 1.45, 1.02, 0.1, 0.82)
  slab(g, mats.steel, 0, -0.47, 1.45, 0.2, 0.06, 0.2)
  // The glowing ad screen, proud of the shell so it never z-fights the bezel.
  const screen = plate(g, frames[0], 0.92, 0.58, 0, -0.35, 1.45, Math.PI)
  screen.renderOrder = 1
  screen.userData.adSet = frames
  // Power / status light on the lower bezel.
  plate(g, mats.ledGreen, 0.05, 0.05, 0.42, -0.358, 1.12, Math.PI)
  g.userData.adScreen = screen
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
  const at = (x: number, y: number): Module | undefined =>
    ctx.data.modules.find((m) => m.x === x && m.y === y && m.z === mod.z && (m.type === 'fence' || m.type === 'gate'))
  const e = at(mod.x + 1, mod.y) !== undefined
  const w = at(mod.x - 1, mod.y) !== undefined
  const n = at(mod.x, mod.y + 1) !== undefined
  const s = at(mod.x, mod.y - 1) !== undefined
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
 * Street exit portal (出入口): a covered head-house over a pair of escalators,
 * not a square pavilion. The +y end is the street doorway under the metro
 * header; the −y end is the mouth, where the up and down runs pass beneath the
 * long canopy and drop away through an opening in the plaza. Glass sides, red
 * steel frame, a canopy sized to cover the escalators — the reference art.
 */
function buildExit(ctx: ModuleContext, mod: Extract<Module, { type: 'exit' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  const W = EXIT_W // across the two escalator bays
  const L = EXIT_L // enclosed part: local y ∈ [−2, +2]
  const H = EXIT_H // canopy height above the walk
  const REACH = EXIT_REACH // how far the canopy reaches over the escalator run (−y)
  const BACK = EXIT_BACK // canopy overhang past the doorway (+y)
  const hw = W / 2
  const hl = L / 2

  // Walk floor: the street-side walkway plus the side/centre strips that flank
  // the two runs all the way back. The bays themselves stay open where the runs
  // drop through.
  const BACKY = EXIT_BACK_Y // back wall, just past where the runs go under the floor
  slab(g, mats.darkSteel, 0, 1.15, 0.05, W, 1.7, 0.1) // street-side walkway
  const stripLen = 0.3 - BACKY
  const stripY = (0.3 + BACKY) / 2
  // The runs sit at local x = ±1; the floor must leave a handrail-clear opening
  // over each bay, or the balustrade surfaces through the strips beside it.
  const bay = EXIT_BAY_HALF
  const dividerW = 2 * (1 - bay) // centre strip between the two runs
  const sideW = Math.max(0.08, hw - (1 + bay)) // sliver against each glass side
  for (const s of [-1, 1]) slab(g, mats.darkSteel, s * (1 + bay + sideW / 2), stripY, 0.05, sideW, stripLen, 0.1)
  slab(g, mats.darkSteel, 0, stripY, 0.05, dividerW, stripLen, 0.1) // divider between the runs

  // Corner columns of the enclosed part, plus two under the south canopy edge.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) slab(g, mats.exitRed, sx * (hw - 0.12), sy * (hl - 0.12), H / 2 + 0.05, 0.2, 0.2, H)
    slab(g, mats.exitRed, sx * (hw - 0.12), -REACH + 0.3, H / 2 + 0.05, 0.2, 0.2, H)
  }
  // Glass sides run the length of the canopy — the enclosed bay and the glazed
  // escalator run. Both ends stay open: the mouth and the street doorway.
  const glassLen = EXIT_GLASS_Y1 - EXIT_GLASS_Y0
  const glassY = (EXIT_GLASS_Y0 + EXIT_GLASS_Y1) / 2
  for (const sx of [-1, 1]) {
    slab(g, mats.glass, sx * EXIT_SIDE, glassY, 1.65, 0.04, glassLen, 2.7)
  }
  // Canopy: a long roof over the enclosed bay and the escalator run, a blue
  // soffit and an orange fascia all round.
  const roofLen = BACK + REACH
  const roofY = (BACK - REACH) / 2
  const roofW = W + 0.3
  slab(g, mats.darkSteel, 0, roofY, H + 0.07, roofW, roofLen, 0.14)
  slab(g, mats.blue, 0, roofY, H - 0.02, roofW - 0.2, roofLen - 0.2, 0.04)
  slab(g, mats.orange, 0, BACK, H + 0.05, roofW, 0.08, 0.22)
  slab(g, mats.orange, 0, -REACH, H + 0.05, roofW, 0.08, 0.22)
  for (const sx of [-1, 1]) slab(g, mats.orange, sx * roofW / 2, roofY, H + 0.05, 0.08, roofLen, 0.22)
  // Under-canopy light strips down the middle.
  for (let i = 0; i < 3; i++) slab(g, mats.glow, 0, 1.2 - i * 2.0, H - 0.05, 0.16, 0.9, 0.04)

  // Back wall at the far (−y) end, opposite the entrance: the head-house closes
  // behind the two runs, which have dropped under the floor by this point.
  slab(g, mats.white, 0, BACKY, (H + 0.05) / 2, W - 0.12, 0.1, H - 0.1)

  // Header over the street doorway, printed on the outer (+y) face. The exit's
  // own name (A口 / 北门) prints here, so renaming it updates the model.
  slab(g, mats.darkSteel, 0, hl - 0.02, 2.45, W - 0.06, 0.12, 0.62)
  const header = plate(g, new THREE.MeshBasicMaterial({ map: canvasTexture(512, 96, (c) => c.drawImage(exitHeaderCanvas(ctx.data.name || '地铁', mod.cfg.name || '出入口'), 0, 0)) }), W - 0.3, 0.5, 0, hl + 0.06, 2.45, Math.PI)
  header.renderOrder = 1
  // Handrail down the divider between the two runs.
  slab(g, mats.steel, 0, -1.0, 0.95, 0.06, 2.0, 0.06)
  for (const s of [-1, 1]) for (let i = 0; i <= 1; i++) slab(g, mats.steel, 0, s * (0.2 + i * 1.6), 0.5, 0.06, 0.06, 0.9)
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
  const doorH = 2.5
  // Openings that actually fall on this run, ascending.
  const openings = (line ? doorCentres({ stock, cars }) : [])
    .map((off) => cx + off)
    .filter((dx) => dx - doorW / 2 > x0 + 0.1 && dx + doorW / 2 < x0 + len - 0.1)
    .sort((a, b) => a - b)

  // Sill and header run the full length; the glass itself is broken at the doors.
  slab(g, mats.white, cx, yWall, z0 + 0.06, len, 0.18, 0.12)
  slab(g, mats.white, cx, yWall, z0 + 2.85, len, 0.24, 0.3)
  slab(g, mats.darkSteel, cx, yWall, z0 + 3.02, len, 0.28, 0.08)
  // The printed header faces the platform (away from the track), repeated along
  // the run so the station name and direction sticker recur as they really do.
  // FrontSide, not DoubleSide: the track side of a screen has no label, so the
  // sticker must not bleed through (mirrored) to the platform's back.
  const platYaw = toward < 0 ? Math.PI : 0
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
  // The red "mind the gap" threshold, just under the doors so it never crosses
  // an opening, and the under-header light strip.
  slab(g, mats.gateRed, cx, yWall, z0 + 0.14, len, 0.03, 0.07)
  slab(g, mats.glow, cx, yWall - toward * 0.12, z0 + 2.66, len, 0.03, 0.05)

  // Fixed glass infill: everything except the door openings, so an open door
  // actually shows the track instead of a wall of glass.
  const panel = (a: number, b: number): void => {
    const w = b - a
    if (w <= 0.05) return
    slab(g, mats.glass, a + w / 2, yWall, z0 + 1.45, w, 0.04, 2.6)
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
    slab(g, mats.white, px, yWall, z0 + 1.45, 0.08, 0.14, 2.6)
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
      const glass = slab(g, mats.tintedGlass, dx + (s * doorW) / 4, leafY, z0 + 1.42, doorW / 2 - 0.02, 0.05, doorH)
      const frame = slab(g, mats.white, dx + (s * doorW) / 2, leafY, z0 + 1.42, 0.06, 0.12, doorH)
      registerDoorLeaf(glass, s, doorW / 2, leaves)
      registerDoorLeaf(frame, s, doorW / 2, leaves)
    }
    // Green "open" indicator above each pair.
    plate(g, mats.ledGreen, 0.3, 0.06, dx, yWall - toward * 0.14, z0 + 2.7, platYaw)
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
 * One train (车辆) as an A/B/C consist: rounded body, window band, blue livery,
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
