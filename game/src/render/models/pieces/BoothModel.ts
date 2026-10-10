// Reference service counters (§5): white information island / glazed ticket kiosk.
import * as THREE from 'three'
import { PieceBuilder, slab, plate, ownedMaterial } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/** Printed fascia belongs to this piece and is released with it on rebuild. */
function serviceSign(ctx: ModuleContext): THREE.Material {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, name: 'booth-service-sign' })
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = 768
    canvas.height = 192
    const ink = canvas.getContext('2d')!
    ink.fillStyle = '#242631'
    ink.fillRect(0, 0, 768, 192)
    ink.strokeStyle = '#ffffff'
    ink.lineWidth = 4
    ink.strokeRect(75, 34, 112, 124)
    for (const x of [105, 159]) {
      ink.beginPath()
      ink.arc(x, 59, 10, 0, Math.PI * 2)
      ink.fillStyle = '#ffffff'
      ink.fill()
      ink.fillRect(x - 10, 76, 20, 40)
    }
    ink.fillRect(96, 112, 7, 34)
    ink.fillRect(109, 112, 7, 34)
    ink.fillRect(133, 109, 48, 5)
    ink.fillRect(137, 114, 5, 31)
    ink.font = '58px "Microsoft YaHei", sans-serif'
    ink.fillText('客服中心', 225, 89)
    ink.font = '30px Arial, sans-serif'
    ink.fillText('Customer Service Center', 228, 139)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    mat.map = tex
  }
  return ownedMaterial(ctx, mat)
}

/** Extrude an x/z profile inward along y for the accessible counter's sloped shoulders. */
function profile(g: THREE.Group, mat: THREE.Material, points: Array<[number, number]>, y: number, depth: number): void {
  const shape = new THREE.Shape()
  points.forEach(([x, z], i) => i ? shape.lineTo(x, z) : shape.moveTo(x, z))
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
  geo.rotateX(Math.PI / 2)
  geo.translate(0, y + depth, 0)
  g.add(new THREE.Mesh(geo, mat))
}

function buildBooth(ctx: ModuleContext, mod: Extract<Module, { type: 'booth' }>): THREE.Group {
  const { mats } = ctx
  const g = new THREE.Group()
  const info = mod.cfg.kind === 'info'
  const x0 = mod.x, x1 = mod.x + mod.w
  const y0 = mod.y, y1 = mod.y + mod.h
  const z = mod.z + 1
  // Measure inward from the footprint; the overhead frame fits the existing 2.4 m envelope.
  const depth = Math.min(0.55, mod.w / 3, mod.h / 3)
  const cap = 0.08
  const top = info ? 1.02 : 0.96
  const body = info ? mats.white : mats.binSteel
  const rim = info ? mats.white : mats.steel
  const a = x0 + depth, b = x1 - depth
  const mid = (a + b) / 2
  // Side runs own the corners; the back and service face butt between them.
  for (const x of [x0 + depth / 2, x1 - depth / 2]) {
    slab(g, body, x, (y0 + y1) / 2, z + (top + 0.11) / 2, depth, mod.h, top - 0.11)
    slab(g, rim, x, (y0 + y1) / 2, z + top + cap / 2, depth, mod.h, cap)
  }
  slab(g, body, mid, y1 - depth / 2, z + (top + 0.11) / 2, b - a, depth, top - 0.11)
  slab(g, rim, mid, y1 - depth / 2, z + top + cap / 2, b - a, depth, cap)
  const lowWidth = Math.min(0.9, (b - a) * 0.36)
  const shoulder = Math.min(0.32, (b - a) * 0.16)
  const line: Array<[number, number]> = info ? [
    [a, z + top], [mid - lowWidth / 2 - shoulder, z + top],
    [mid - lowWidth / 2, z + 0.72], [mid + lowWidth / 2, z + 0.72],
    [mid + lowWidth / 2 + shoulder, z + top], [b, z + top],
  ] : [[a, z + top], [b, z + top]]
  profile(g, body, [[a, z + 0.11], [b, z + 0.11], ...[...line].reverse()], y0, depth)
  profile(g, rim, [...line, ...[...line].reverse().map(([x, h]): [number, number] => [x, h + cap])], y0, depth)
  // Recessed stainless kick strips sit below the cabinet panels, avoiding coplanar faces.
  for (const y of [y0 + 0.015, y1 - 0.015]) {
    slab(g, info ? mats.steel : mats.darkSteel, mid, y, z + 0.055, mod.w, 0.03, 0.11)
  }
  for (const x of [x0 + 0.015, x1 - 0.015]) {
    slab(g, info ? mats.steel : mats.darkSteel, x, (y0 + y1) / 2, z + 0.055, 0.03, mod.h, 0.11)
  }
  const headerBottom = 2.08
  const headerTop = 2.4
  // The trim occupies its own vertical band below the fascia. Embedding it in
  // the dark frame gave both materials the same outer faces (visible z-fighting).
  const fasciaBottom = info ? headerBottom + 0.045 : headerBottom
  const band = info ? mats.darkSteel : mats.binSteel
  // Open rectangular overhead frame: the staff bay remains visible from above.
  for (const x of [x0 + 0.09, x1 - 0.09]) {
    slab(g, band, x, (y0 + y1) / 2, z + (fasciaBottom + headerTop) / 2, 0.18, mod.h, headerTop - fasciaBottom)
  }
  for (const y of [y0 + 0.098, y1 - 0.098]) {
    slab(g, band, mid, y, z + (fasciaBottom + headerTop) / 2, mod.w - 0.36, 0.18, headerTop - fasciaBottom)
  }
  if (info) {
    // White underside light and burgundy seam follow the suspended frame.
    for (const x of [x0 + 0.09, x1 - 0.09]) {
      slab(g, mats.white, x, (y0 + y1) / 2, z + headerBottom + 0.015, 0.18, mod.h, 0.03)
      slab(g, mats.gateRed, x, (y0 + y1) / 2, z + headerBottom + 0.0375, 0.18, mod.h, 0.015)
    }
    for (const y of [y0 + 0.098, y1 - 0.098]) {
      slab(g, mats.white, mid, y, z + headerBottom + 0.015, mod.w - 0.36, 0.18, 0.03)
      slab(g, mats.gateRed, mid, y, z + headerBottom + 0.0375, mod.w - 0.36, 0.18, 0.015)
    }
    for (const y of [y0 + 0.1, y1 - 0.1]) {
      slab(g, mats.headlight, mid, y, z + headerBottom - 0.015, mod.w - 0.36, 0.12, 0.03)
    }
    for (const x of [x0 + 0.1, x1 - 0.1]) {
      slab(g, mats.headlight, x, (y0 + y1) / 2, z + headerBottom - 0.015, 0.12, mod.h - 0.36, 0.03)
    }
  } else {
    const post = 0.08
    const glassBottom = top + cap
    // Corner mullions frame clear glazing; the front transfer gap is an actual opening.
    for (const x of [x0 + post / 2, x1 - post / 2]) {
      for (const y of [y0 + post / 2, y1 - post / 2]) {
        slab(g, mats.darkSteel, x, y, z + (glassBottom + headerBottom) / 2, post, post, headerBottom - glassBottom)
      }
      slab(g, mats.glass, x, (y0 + y1) / 2, z + (glassBottom + headerBottom) / 2, 0.025, mod.h - 2 * post, headerBottom - glassBottom)
    }
    slab(g, mats.glass, mid, y1 - 0.04, z + (glassBottom + headerBottom) / 2, mod.w - 2 * post, 0.025, headerBottom - glassBottom)
    const bays = Math.max(1, Math.floor((mod.w - 0.16) / 1.6))
    const bayWidth = (mod.w - 2 * post) / bays
    for (let i = 0; i < bays; i++) {
      const x = x0 + post + bayWidth * (i + 0.5)
      const sill = glassBottom + 0.16
      slab(g, mats.glass, x, y0 + 0.04, z + (sill + headerBottom) / 2, bayWidth - 0.03, 0.025, headerBottom - sill)
      slab(g, mats.steel, x, y0 + 0.04, z + sill, bayWidth - 0.03, 0.045, 0.035)
      if (i > 0) slab(g, mats.darkSteel, x - bayWidth / 2, y0 + 0.04, z + (glassBottom + headerBottom) / 2, 0.03, 0.06, headerBottom - glassBottom)
    }
  }
  const sign = serviceSign(ctx)
  const signW = Math.min(mod.w - 0.4, 2.4)
  for (const [y, yaw] of [[y0 + 0.004, 0], [y1 - 0.004, Math.PI]]) {
    plate(g, sign, signW, 0.29, mid, y, z + 2.245, yaw)
  }
  // Counter fittings; staff seats remain individually editable bench modules.
  const screenXs = info ? [a + (b - a) * 0.16] : [a + (b - a) * 0.2, b - (b - a) * 0.2]
  for (const x of screenXs) {
    const y = y0 + depth * 0.67
    slab(g, mats.black, x, y, z + top + cap + 0.025, 0.28, 0.18, 0.035)
    slab(g, mats.darkSteel, x, y, z + top + cap + 0.10, 0.035, 0.04, 0.15)
    slab(g, mats.black, x, y, z + top + cap + 0.23, 0.34, 0.045, 0.23)
    plate(g, mats.screen, 0.30, 0.19, x, y - 0.024, z + top + cap + 0.23, 0)
  }
  return g
}

export class BoothModel extends PieceBuilder {
  readonly kind = 'booth'
  build(mod: Extract<Module, { type: 'booth' }>): THREE.Group {
    return buildBooth(this.ctx, mod)
  }
}
