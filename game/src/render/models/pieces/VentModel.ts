import * as THREE from 'three'
import { omitModelDetail, surfaceModelDetail } from '../../modelDetail.ts'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import { VENT_WIDTH, VENT_DEPTH, ventCeilingZ, type VentModule } from '../../../sim/vents.ts'
import { hangCeilingLocal } from '../../../sim/placement.ts'

/** A flush ceiling grille with a recessed dark duct and separated metal blades (§5.7). */
export class VentModel extends PieceBuilder {
  readonly kind = 'vent'
  build(mod: VentModule): THREE.Group {
    const g = new THREE.Group()
    // The line the grille hangs from: the **top block** over its own cell (`hangCeilingLocal`),
    // else the real slab overhead — and with no slab to read (a ghost in an empty station) the
    // nominal storey line stands in. The 5 m grid line floated a 基准高度-1 station's vents a
    // metre below their ceiling.
    const ceiling = hangCeilingLocal(mod, this.ctx.data.cells, this.ctx.data.modules, ventCeilingZ(mod) - mod.z - 1)
    const border = 0.045
    const opening = VENT_WIDTH - border * 2
    const edge = (VENT_WIDTH - border) / 2
    // Four frame bars meet at their edges. The duct backing sits above the
    // blades, so neither overlapping caps nor coplanar faces can flicker.
    for (const y of [-edge, edge]) surfaceModelDetail(slab(g, this.ctx.mats.steel, 0, y, ceiling - VENT_DEPTH / 2, VENT_WIDTH, border, VENT_DEPTH), 'z')
    for (const x of [-edge, edge]) surfaceModelDetail(slab(g, this.ctx.mats.steel, x, 0, ceiling - VENT_DEPTH / 2, border, opening, VENT_DEPTH), 'z')
    surfaceModelDetail(slab(g, this.ctx.mats.black, 0, 0, ceiling - 0.0075, opening, opening, 0.015), 'z')
    for (let i = 0; i < 9; i++) {
      const y = -opening / 2 + (i + 0.5) * opening / 9
      const blade = slab(g, this.ctx.mats.steel, 0, y, ceiling - 0.0425, opening, 0.026, 0.025)
      if (i === 1 || i === 4 || i === 7) surfaceModelDetail(blade, 'z')
      else omitModelDetail(blade)
    }
    return this.placeLocal(g, mod)
  }
}
