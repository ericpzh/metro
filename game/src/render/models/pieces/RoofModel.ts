import * as THREE from 'three'
import { PieceBuilder, finishSlab } from '../PieceBuilder.ts'
import { DEFAULT_ROOF_FINISH, ROOF_THICKNESS, TRUSS_ROOF_BASE, TRUSS_ROOF_EAVE, trussRoofRidge } from '../../../sim/structures.ts'
import type { Module } from '../../../sim/types.ts'

type Point = [number, number, number]

/** One structural member between two points, kept within the module footprint. */
function member(group: THREE.Group, mat: THREE.Material, a: Point, b: Point, width: number): void {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const direction = end.clone().sub(start)
  const mesh = finishSlab(group, mat, 0, 0, 0, width, direction.length(), width)
  mesh.position.copy(start.add(end).multiplyScalar(0.5))
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
}

export class RoofModel extends PieceBuilder {
  readonly kind = 'roof'

  build(mod: Extract<Module, { type: 'roof' }>): THREE.Group {
    const group = new THREE.Group()
    // The finish brush paints the roof sheets; the supporting truss stays steel.
    const mat = this.ctx.finish(mod.cfg.finish ?? DEFAULT_ROOF_FINISH)
    if (!mod.cfg.variant) {
      finishSlab(group, mat, (mod.w - 1) / 2, (mod.d - 1) / 2, TRUSS_ROOF_BASE + ROOF_THICKNESS / 2, mod.w, mod.d, ROOF_THICKNESS)
      return this.placeLocal(group, mod)
    }

    const length = mod.w
    const metal = this.ctx.mats.steel
    const width = mod.d
    const centreX = (length - 1) / 2
    const crestY = (width - 1) / 2
    const eaveY = width - 0.5
    const ridgeZ = trussRoofRidge(width)
    const roofThickness = 0.12
    const upper = (y: number): number => ridgeZ - (ridgeZ - TRUSS_ROOF_EAVE) * Math.abs(y - crestY) / (width / 2)

    // A shallow pitched shell: two continuous sheet runs, with the crest along X.
    // The eaves sit just inside the footprint after the sheets are tilted.
    for (const side of [-1, 1]) {
      const y0 = side < 0 ? -0.48 : crestY
      const y1 = side < 0 ? crestY : eaveY - 0.02
      const z0 = upper(y0)
      const z1 = upper(y1)
      const sheet = finishSlab(group, mat, centreX, (y0 + y1) / 2, (z0 + z1) / 2 + roofThickness / 2, length, Math.hypot(y1 - y0, z1 - z0), roofThickness)
      sheet.rotation.x = Math.atan2(z1 - z0, y1 - y0)
    }

    // All purlins and trusses run parallel to the central crest. None sits on
    // the supporting floor; the structure is wholly above the four-metre posts.
    for (let y = 0; y < width; y += 1) {
      member(group, metal, [0, y, upper(y) - 0.1], [length - 1, y, upper(y) - 0.1], 0.11)
    }

    if (mod.cfg.variant === 'tapered-truss') {
      // The second form draws each side of the roof down to one longitudinal
      // bottom chord beneath the crest. Its V-shaped cross braces leave the
      // sides open instead of making a wide horizontal rail at the bottom.
      const bottomZ = TRUSS_ROOF_BASE + 0.08
      member(group, metal, [0, crestY, bottomZ], [length - 1, crestY, bottomZ], 0.16)
      for (let x = 0; x < length; x += 1) {
        for (const y of [0, width - 1]) {
          member(group, metal, [x, crestY, bottomZ], [x, y, upper(y) - 0.12], 0.11)
          if (x < length - 1) member(group, metal, [x, crestY, bottomZ], [x + 1, y, upper(y) - 0.12], 0.08)
        }
      }
    } else {
      // The original open web is turned ninety degrees: its triangular runs
      // now follow the crest, with one run roughly every four metres across.
      const trussYs = new Set<number>([0, width - 1])
      for (let y = 4; y < width - 1; y += 4) trussYs.add(y)
      const lowerZ = TRUSS_ROOF_BASE + 0.78
      for (const y of trussYs) {
        member(group, metal, [0, y, lowerZ], [length - 1, y, lowerZ], 0.16)
        for (let x = 0; x < length; x += 1) {
          member(group, metal, [x, y, lowerZ], [x, y, upper(y) - 0.12], 0.1)
          if (x < length - 1) member(group, metal, [x, y, lowerZ], [x + 1, y, upper(y) - 0.12], 0.09)
        }
      }
    }

    return this.placeLocal(group, mod)
  }
}
