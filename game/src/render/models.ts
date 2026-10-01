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
import { ESCALATOR_STEP_PITCH } from '../sim/constants.ts'
import { EXIT_BACK, EXIT_BACK_Y, EXIT_GLASS_Y0, EXIT_GLASS_Y1, EXIT_H, EXIT_L, EXIT_REACH, EXIT_SIDE, EXIT_W } from '../sim/exits.ts'
import { doorCentres, STOCK, type StockClass } from '../sim/stock.ts'
import type { Module, StationData } from '../sim/types.ts'

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
function psdHeaderCanvas(colour: string, lineId: string): HTMLCanvasElement {
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
  // Direction sticker.
  g.textAlign = 'left'
  g.fillStyle = '#1b6fd6'
  g.font = 'bold 22px "Microsoft YaHei", sans-serif'
  g.fillText('◀ 番禺广场方向 →', 470, 62)
  return c
}

/** The exit portal header: the metro logo, station name and the exit letter. */
function exitHeaderCanvas(name: string, letter: string): HTMLCanvasElement {
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
  g.fillStyle = '#f0a128'
  g.font = 'bold 30px "Microsoft YaHei", sans-serif'
  g.fillText(name, 78, 60)
  g.fillStyle = '#fff'
  g.font = 'bold 20px sans-serif'
  g.fillText(letter, 430, 60)
  g.fillStyle = '#1f9c63'
  g.fillRect(410, 22, 52, 52)
  g.fillStyle = '#fff'
  g.font = 'bold 40px sans-serif'
  g.textAlign = 'center'
  g.fillText(letter, 436, 66)
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
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x48e08a }),
    ledRed: new THREE.MeshBasicMaterial({ color: 0xff5d47 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xf7ecc8, side: THREE.DoubleSide }),
  }
}

export function disposeModelMaterials(m: ModelMaterials): void {
  for (const mat of Object.values(m) as THREE.Material[]) {
    const t = (mat as THREE.MeshStandardMaterial).map
    if (t) t.dispose()
    mat.dispose()
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
}

function isTrack(ctx: ModuleContext, x: number, y: number, z: number): boolean {
  return ctx.trackCells.has(`${x},${y},${z}`)
}

/**
 * Build one placed module. Returns a group in world space, or null for a module
 * with nothing to draw. The caller owns disposal.
 */
export function buildModule(mod: Module, ctx: ModuleContext): THREE.Object3D | null {
  switch (mod.type) {
    case 'tvm':
      return placeLocal(buildTvm(ctx.mats), mod)
    case 'gate':
      return placeLocal(buildGate(ctx.mats), mod)
    case 'exit': {
      const group = buildExit(ctx, mod)
      group.position.set(mod.x + 0.5, mod.y + 0.5, mod.z + 1)
      group.rotation.z = exitYaw(ctx, mod)
      return group
    }
    case 'escalator':
      return buildEscalator(ctx.mats, mod)
    case 'stair':
      return buildStair(ctx.mats, mod)
    case 'lift':
      return buildLift(ctx.mats, mod)
    case 'platform-edge':
      return buildPsd(ctx, mod)
    case 'track':
      return buildTrack(ctx.mats, mod)
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

/* ------------------------------------------------------------------ gate */

/** Turnstile cabinet (闸机): steel, a red wing and lane lights. */
function buildGate(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  slab(g, mats.darkSteel, 0, 0, 0.05, 0.44, 0.98, 0.1)
  slab(g, mats.steel, 0, 0, 0.58, 0.42, 0.94, 0.96)
  capTop(g, mats.darkSteel, 0, 0, 1.06, 0.46, 0.98, 0.08)
  // Reader pad and the pass / stop lights on the walk-up face.
  slab(g, mats.black, 0, -0.28, 1.12, 0.3, 0.24, 0.03)
  plate(g, mats.ledGreen, 0.12, 0.07, -0.08, -0.14, 0.86, 0)
  plate(g, mats.ledRed, 0.12, 0.07, 0.12, -0.14, 0.86, 0)
  // The red translucent wing, hinged on the cabinet and reaching into the lane.
  const wing = slab(g, mats.gateRed, 0.45, 0.06, 0.52, 0.5, 0.05, 0.66)
  wing.name = 'wing'
  // Blue accent stripe (the station's line colour family).
  slab(g, mats.blue, 0, 0, 0.2, 0.43, 0.95, 0.05)
  return g
}

/* -------------------------------------------------------------- escalator */

function buildEscalator(mats: ModelMaterials, mod: Extract<Module, { type: 'escalator' }>): THREE.Group {
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
  // Steps: a ridged ramp at walk level, one step per sim step pitch.
  const nSteps = Math.max(4, Math.round(len / ESCALATOR_STEP_PITCH))
  for (let i = 0; i < nSteps; i++) {
    const x = (i + 0.5) * (len / nSteps)
    slab(g, mats.darkSteel, x, 0, -0.03, len / nSteps, W - 0.12, 0.08)
  }
  // Glass balustrades and black handrails.
  slab(g, mats.glass, len / 2, W / 2, rise / 2, len, 0.03, rise)
  slab(g, mats.glass, len / 2, -W / 2, rise / 2, len, 0.03, rise)
  slab(g, mats.handrail, len / 2, W / 2 + 0.03, rise, len, 0.1, 0.08)
  slab(g, mats.handrail, len / 2, -W / 2 - 0.03, rise, len, 0.1, 0.08)
  // Newel ends and the comb plates at both landings.
  slab(g, mats.steel, 0.05, 0, -0.02, 0.5, W, 0.06)
  slab(g, mats.steel, len - 0.05, 0, -0.02, 0.5, W, 0.06)
  slab(g, mats.orange, 0.05, 0, 0.24, 0.5, W - 0.2, 0.03)
  slab(g, mats.orange, len - 0.05, 0, 0.24, 0.5, W - 0.2, 0.03)
  // Direction chevrons on the skirt, facing outward from each balustrade.
  for (let i = 0; i < 3; i++) {
    const x = len * (0.3 + i * 0.22)
    plate(g, mats.ledGreen, 0.22, 0.12, x, W / 2 + 0.04, 0.55, Math.PI)
    plate(g, mats.ledGreen, 0.22, 0.12, x, -W / 2 - 0.04, 0.55, 0)
  }
  return g
}

function buildStair(mats: ModelMaterials, mod: Extract<Module, { type: 'stair' }>): THREE.Group {
  const a = new THREE.Vector3(mod.from.x + 0.5, mod.from.y + 0.5, mod.from.z + 1)
  const b = new THREE.Vector3(mod.to.x + 0.5, mod.to.y + 0.5, mod.to.z + 1)
  const len = a.distanceTo(b)
  const t = b.clone().sub(a).normalize()
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), t).normalize()
  const n = new THREE.Vector3().crossVectors(t, side).normalize()
  const g = new THREE.Group()
  g.position.copy(a)
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, side, n))
  slab(g, mats.darkSteel, len / 2, 0, -0.16, len, 2.4, 0.32)
  const steps = Math.max(3, Math.round(len / 0.35))
  for (let i = 0; i < steps; i++) slab(g, mats.steel, (i + 0.5) * (len / steps), 0, -0.02, len / steps, 2.3, 0.06)
  // Handrails on both sides.
  for (const s of [1, -1]) {
    slab(g, mats.handrail, len / 2, s * 1.15, 0.9, len, 0.08, 0.08)
    slab(g, mats.steel, len / 2, s * 1.15, 0.45, len, 0.05, 0.05)
    for (let i = 0; i <= 2; i++) slab(g, mats.steel, (i / 2) * len, s * 1.15, 0.5, 0.06, 0.06, 1.0)
  }
  return g
}

function buildLift(mats: ModelMaterials, mod: Extract<Module, { type: 'lift' }>): THREE.Group {
  const g = new THREE.Group()
  g.position.set(mod.x + 0.5, mod.y + 0.5, mod.from.z + 1)
  slab(g, mats.darkSteel, 0, 0, 1.3, 1.8, 1.8, 2.6)
  slab(g, mats.steel, 0, -0.9, 1.3, 1.5, 0.06, 2.2)
  slab(g, mats.black, 0, -0.92, 1.3, 1.0, 0.03, 2.1)
  slab(g, mats.darkSteel, 0, 0, 2.66, 2.0, 2.0, 0.12)
  plate(g, mats.ledGreen, 0.4, 0.12, 0, -0.95, 2.4, 0)
  return g
}

/* ------------------------------------------------------------------ exit */

/**
 * Which way the exit faces: its −y (local) end is the mouth that opens onto the
 * escalator run climbing from underground, its +y end is the street doorway. We
 * aim −y at the *midpoint* of the nearest ramp — the run, not just its top
 * landing — so an exit with a down run on one side and an up run on the other
 * (the normal two-escalator exit) still faces straight down the pair instead of
 * snapping sideways to whichever landing is a hair closer.
 */
function exitYaw(ctx: ModuleContext, mod: Extract<Module, { type: 'exit' }>): number {
  const ex = mod.x + 0.5
  const ey = mod.y + 0.5
  let bx = 0
  let by = 0
  let best = Infinity
  for (const m of ctx.data.modules) {
    if (m.type !== 'escalator' && m.type !== 'stair' && m.type !== 'lift') continue
    const mx = (m.from.x + m.to.x + 1) / 2
    const my = (m.from.y + m.to.y + 1) / 2
    const d = (mx - ex) ** 2 + (my - ey) ** 2
    if (d < best) {
      best = d
      bx = mx - ex
      by = my - ey
    }
  }
  const fallback = ((mod.rot ?? 0) * Math.PI) / 2
  if (best === Infinity || best > 196 || (bx === 0 && by === 0)) return fallback
  // Local −y maps to world (sinθ, −cosθ); solve for it to point at (bx, by),
  // then snap to the nearest quarter turn so the footprint stays axis-aligned.
  const theta = Math.atan2(bx, -by)
  return Math.round(theta / (Math.PI / 2)) * (Math.PI / 2)
}

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
  for (const s of [-1, 1]) slab(g, mats.darkSteel, s * (hw - 0.28), stripY, 0.05, 0.56, stripLen, 0.1)
  slab(g, mats.darkSteel, 0, stripY, 0.05, 0.8, stripLen, 0.1) // divider between the runs

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

  // Header over the street doorway, printed on the outer (+y) face.
  const letter = (mod.cfg.name || 'C').slice(0, 1)
  slab(g, mats.darkSteel, 0, hl - 0.02, 2.45, W - 0.06, 0.12, 0.62)
  const header = plate(g, new THREE.MeshBasicMaterial({ map: canvasTexture(512, 96, (c) => c.drawImage(exitHeaderCanvas(ctx.data.name || '地铁', letter), 0, 0)) }), W - 0.3, 0.5, 0, hl + 0.06, 2.45, Math.PI)
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
  const x0 = mod.x
  const len = mod.w
  const z0 = mod.z + 1
  // Which side is the track on? The screen sits just inside the platform edge.
  const toward = isTrack(ctx, mod.x, mod.y - 1, mod.z) ? -1 : isTrack(ctx, mod.x, mod.y + 1, mod.z) ? 1 : -1
  const yWall = mod.y + 0.5 + toward * 0.34
  const cx = x0 + len / 2

  // The line decides the door cadence; the screen is cut open where it lands.
  const line = ctx.data.lines.find((l) => l.id === mod.cfg.line) ?? ctx.data.lines[0]
  const colour = line?.colour ?? '#1b6fd6'
  const lineId = line?.id ?? '2'
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
  const platYaw = toward < 0 ? Math.PI : 0
  const headerMap = canvasTexture(1024, 96, (c) => c.drawImage(psdHeaderCanvas(colour, lineId), 0, 0))
  headerMap.wrapS = THREE.RepeatWrapping
  headerMap.repeat.set(Math.max(1, Math.round(len / 10)), 1)
  const header = plate(
    g,
    new THREE.MeshBasicMaterial({ map: headerMap, side: THREE.DoubleSide }),
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
  return g
}

/* ------------------------------------------------------------------ track */

function buildTrack(mats: ModelMaterials, mod: Extract<Module, { type: 'track' }>): THREE.Group {
  const g = new THREE.Group()
  const cx = mod.x + mod.w / 2
  const y = mod.y + 0.5
  const z = mod.z + 1
  // Two rails on sleepers down the middle of the bed.
  for (const s of [-1, 1]) slab(g, mats.steel, cx, y + s * 0.72, z + 0.1, mod.w, 0.1, 0.1)
  const nSleepers = Math.max(2, Math.round(mod.w / 0.6))
  for (let i = 0; i < nSleepers; i++) {
    slab(g, mats.black, mod.x + ((i + 0.5) / nSleepers) * mod.w, y, z + 0.03, 0.24, 1.9, 0.08)
  }
  // Third rail.
  slab(g, mats.darkSteel, cx, y - 1.05, z + 0.12, mod.w, 0.08, 0.08)
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
}

/**
 * One train (车辆) as an A/B/C consist: rounded body, window band, blue livery,
 * sliding doors at the timetable's door centres and two bogies per car. Built in
 * world space with the origin at the train centre on the track surface.
 */
export function buildTrain(mats: ModelMaterials, pose: TrainPose): THREE.Group {
  const g = new THREE.Group()
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
