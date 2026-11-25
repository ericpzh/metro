// Reference service counters (§5): white information island / glazed ticket kiosk.
import * as THREE from 'three'
import { omitModelDetail, tubeModelDetail } from '../../modelDetail.ts'
import { PieceBuilder, slab, plate } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import {
  BOOTH_HEADER_BOTTOM,
  BOOTH_HEADER_TOP,
  boothHeaderHang,
  boothScreenPositions,
} from '../../../sim/booths.ts'
import type { Module } from '../../../sim/types.ts'

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
  const front = ((mod.cfg.front ?? 0) % 4 + 4) % 4
  const headerCeilings = mod.cfg.kind === 'info'
    ? boothHeaderHang(ctx.data.cells, ctx.data.modules, mod)
    : null
  if (front === 0) return buildBoothCanonical(ctx, mod, headerCeilings)
  const centerX = mod.x + mod.w / 2
  const centerY = mod.y + mod.h / 2
  const width = front % 2 ? mod.h : mod.w
  const height = front % 2 ? mod.w : mod.h
  const canonical = buildBoothCanonical(ctx, {
    ...mod,
    x: centerX - width / 2,
    y: centerY - height / 2,
    w: width,
    h: height,
  }, headerCeilings)
  canonical.position.set(-centerX, -centerY, 0)
  const oriented = new THREE.Group()
  oriented.position.set(centerX, centerY, 0)
  oriented.rotation.z = (front * Math.PI) / 2
  oriented.add(canonical)
  return oriented
}

function buildBoothCanonical(
  ctx: ModuleContext,
  mod: Extract<Module, { type: 'booth' }>,
  headerCeilings: readonly [number, number, number, number] | null,
): THREE.Group {
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
  if (info) {
    // Info body and rim share `mats.white`: merge each run vertically to avoid coplanar seams.
    const fullH = top + cap - 0.11
    const fullZ = z + (top + cap + 0.11) / 2
    for (const x of [x0 + depth / 2, x1 - depth / 2]) {
      slab(g, body, x, (y0 + y1) / 2, fullZ, depth, mod.h, fullH)
    }
    slab(g, body, mid, y1 - depth / 2, fullZ, b - a, depth, fullH)
    const lowWidth = Math.min(0.9, (b - a) * 0.36)
    const shoulder = Math.min(0.32, (b - a) * 0.16)
    const topLine: Array<[number, number]> = [
      [a, z + top + cap], [mid - lowWidth / 2 - shoulder, z + top + cap],
      [mid - lowWidth / 2, z + 0.72 + cap], [mid + lowWidth / 2, z + 0.72 + cap],
      [mid + lowWidth / 2 + shoulder, z + top + cap], [b, z + top + cap],
    ]
    profile(g, body, [[a, z + 0.11], [b, z + 0.11], ...[...topLine].reverse()], y0, depth)
  } else {
    for (const x of [x0 + depth / 2, x1 - depth / 2]) {
      slab(g, body, x, (y0 + y1) / 2, z + (top + 0.11) / 2, depth, mod.h, top - 0.11)
      slab(g, rim, x, (y0 + y1) / 2, z + top + cap / 2, depth, mod.h, cap)
    }
    slab(g, body, mid, y1 - depth / 2, z + (top + 0.11) / 2, b - a, depth, top - 0.11)
    slab(g, rim, mid, y1 - depth / 2, z + top + cap / 2, b - a, depth, cap)
    const line: Array<[number, number]> = [[a, z + top], [b, z + top]]
    profile(g, body, [[a, z + 0.11], [b, z + 0.11], ...[...line].reverse()], y0, depth)
    profile(g, rim, [...line, ...[...line].reverse().map(([x, h]): [number, number] => [x, h + cap])], y0, depth)
  }
  // Recessed stainless kick strips sit below the cabinet panels, avoiding coplanar faces.
  for (const y of [y0 + 0.015, y1 - 0.015]) {
    slab(g, info ? mats.steel : mats.darkSteel, mid, y, z + 0.055, mod.w, 0.03, 0.11)
  }
  for (const x of [x0 + 0.015, x1 - 0.015]) {
    slab(g, info ? mats.steel : mats.darkSteel, x, (y0 + y1) / 2, z + 0.055, 0.03, mod.h, 0.11)
  }
  const headerBottom = BOOTH_HEADER_BOTTOM
  const headerTop = BOOTH_HEADER_TOP
  if (info) {
    // Only generate the info overhead canopy when a real ceiling sits within 3 m above it,
    // hanging the rectangular frame by four corner rods from that ceiling.
    if (headerCeilings) {
      const fasciaBottom = headerBottom + 0.045
      for (const x of [x0 + 0.09, x1 - 0.09]) {
        slab(g, mats.darkSteel, x, (y0 + y1) / 2, z + (fasciaBottom + headerTop) / 2, 0.18, mod.h, headerTop - fasciaBottom)
        slab(g, mats.white, x, (y0 + y1) / 2, z + headerBottom + 0.015, 0.18, mod.h, 0.03)
        slab(g, mats.gateRed, x, (y0 + y1) / 2, z + headerBottom + 0.0375, 0.18, mod.h, 0.015)
      }
      for (const y of [y0 + 0.098, y1 - 0.098]) {
        slab(g, mats.darkSteel, mid, y, z + (fasciaBottom + headerTop) / 2, mod.w - 0.36, 0.18, headerTop - fasciaBottom)
        slab(g, mats.white, mid, y, z + headerBottom + 0.015, mod.w - 0.36, 0.18, 0.03)
        slab(g, mats.gateRed, mid, y, z + headerBottom + 0.0375, mod.w - 0.36, 0.18, 0.015)
      }
      for (const y of [y0 + 0.1, y1 - 0.1]) {
        slab(g, mats.headlight, mid, y, z + headerBottom - 0.015, mod.w - 0.36, 0.12, 0.03)
      }
      for (const x of [x0 + 0.1, x1 - 0.1]) {
        slab(g, mats.headlight, x, (y0 + y1) / 2, z + headerBottom - 0.015, 0.12, mod.h - 0.36, 0.03)
      }
      const corners: ReadonlyArray<readonly [number, number]> = [
        [x0 + 0.09, y0 + 0.098],
        [x1 - 0.09, y0 + 0.098],
        [x0 + 0.09, y1 - 0.098],
        [x1 - 0.09, y1 - 0.098],
      ]
      for (let i = 0; i < corners.length; i++) {
        const [rx, ry] = corners[i]!
        const ceilLocal = headerCeilings[i]! - z
        const drop = Math.max(0, ceilLocal - headerTop)
        if (drop > 0.04) {
          const rodH = drop - 0.04
          const rod = slab(g, mats.steel, rx, ry, z + headerTop + rodH / 2, 0.05, 0.05, rodH)
          rod.name = 'booth-suspension-rod'
          tubeModelDetail(rod)
          const plateMesh = slab(g, mats.darkSteel, rx, ry, z + ceilLocal - 0.02, 0.14, 0.14, 0.04)
          plateMesh.name = 'booth-suspension-plate'
          omitModelDetail(plateMesh)
        } else if (drop > 0.005) {
          const bracket = slab(g, mats.darkSteel, rx, ry, z + headerTop + drop / 2, 0.14, 0.14, drop)
          bracket.name = 'booth-suspension-plate'
          omitModelDetail(bracket)
        }
      }
    }
  } else {
    // Open rectangular overhead frame supported by corner posts and glazing.
    for (const x of [x0 + 0.09, x1 - 0.09]) {
      slab(g, mats.binSteel, x, (y0 + y1) / 2, z + (headerBottom + headerTop) / 2, 0.18, mod.h, headerTop - headerBottom)
    }
    for (const y of [y0 + 0.098, y1 - 0.098]) {
      slab(g, mats.binSteel, mid, y, z + (headerBottom + headerTop) / 2, mod.w - 0.36, 0.18, headerTop - headerBottom)
    }
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
  // Counter fittings; staff seats remain individually editable bench modules.
  const { y: screenY, xs: screenXs } = boothScreenPositions(info, mod.w, mod.h, x0, x1, y0)
  for (const x of screenXs) {
    slab(g, mats.black, x, screenY, z + top + cap + 0.0175, 0.28, 0.18, 0.035)
    slab(g, mats.darkSteel, x, screenY, z + top + cap + 0.10, 0.035, 0.04, 0.15)
    slab(g, mats.black, x, screenY, z + top + cap + 0.23, 0.34, 0.045, 0.23)
    plate(g, mats.screen, 0.30, 0.19, x, screenY - 0.024, z + top + cap + 0.23, 0)
  }
  return g
}

export class BoothModel extends PieceBuilder {
  readonly kind = 'booth'
  build(mod: Extract<Module, { type: 'booth' }>): THREE.Group {
    return buildBooth(this.ctx, mod)
  }
}
