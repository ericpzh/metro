import * as THREE from 'three'
import { PieceBuilder, slab, ownedMaterial } from '../PieceBuilder.ts'
import { roadLayout, roadPoint, roadInkIntervals } from '../../../sim/roads.ts'
import type { Road } from '../../../sim/roads.ts'

export class RoadModel extends PieceBuilder {
  readonly kind = 'road'
  build(r: Road): THREE.Group {
    const g = new THREE.Group()
    const asphalt = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: .96 }))
    const yellow = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0xf7c83c, roughness: .8 }))
    // Surface tops coincide at every overlap; one plane avoids coplanar side faces.
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), asphalt)
    surface.position.set(r.x + r.w / 2, r.y + r.d / 2, r.z + 1.025)
    g.add(surface)
    const { width, lanes, laneWidth, acrossX, length } = roadLayout(r)
    const ink = (across: number, dashed: boolean, material: THREE.Material) => {
      for (const [a, b] of roadInkIntervals(r, this.ctx.data.modules, across)) {
        for (let from = dashed ? Math.floor(a / 6) * 6 : a; from < b; from += dashed ? 6 : length + 1) {
          const lo = Math.max(a, from), hi = Math.min(b, dashed ? from + 3 : b)
          if (hi <= lo) continue
          const [x, y] = roadPoint(r, across, (lo + hi) / 2)
          slab(g, material, x, y, r.z + 1.035, acrossX ? .12 : hi - lo, acrossX ? hi - lo : .12, .008)
        }
      }
    }
    ink(.16, false, this.ctx.mats.white); ink(width - .16, false, this.ctx.mats.white)
    for (let lane = 1; lane < lanes; lane++) {
      if (r.cfg.direction === 'two-way' && lane === lanes / 2) {
        ink(width / 2 - .13, false, yellow); ink(width / 2 + .13, false, yellow)
      } else ink(lane * laneWidth, true, this.ctx.mats.white)
    }
    return g
  }
}
