import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import { VENT_WIDTH, VENT_DEPTH, ventCeilingZ, type VentModule } from '../../../sim/vents.ts'
import { ceilingMountHeight, hangLineOf } from '../../../sim/placement.ts'

/** A flush ceiling grille with a recessed dark duct and separated metal blades (§5.7). */
export class VentModel extends PieceBuilder {
  readonly kind = 'vent'
  build(mod: VentModule): THREE.Group {
    const g = new THREE.Group()
    // The line the grille hangs from: the height the player aimed at when they hung it
    // there by hand, else the **real** slab overhead (`ceilingMountHeight`) — the 4 m grid
    // line floated a 基准高度-1 station's vents a metre below their ceiling.
    const line = hangLineOf(mod)
    const ceiling = line !== undefined
      ? line - mod.z - 1
      // With no slab to read (a ghost in an empty station) the nominal storey line stands in.
      : ceilingMountHeight(this.ctx.data.cells, mod, this.ctx.data.modules) ?? ventCeilingZ(mod) - mod.z - 1
    const border = 0.045
    const opening = VENT_WIDTH - border * 2
    const edge = (VENT_WIDTH - border) / 2
    // Four frame bars meet at their edges. The duct backing sits above the
    // blades, so neither overlapping caps nor coplanar faces can flicker.
    for (const y of [-edge, edge]) slab(g, this.ctx.mats.steel, 0, y, ceiling - VENT_DEPTH / 2, VENT_WIDTH, border, VENT_DEPTH)
    for (const x of [-edge, edge]) slab(g, this.ctx.mats.steel, x, 0, ceiling - VENT_DEPTH / 2, border, opening, VENT_DEPTH)
    slab(g, this.ctx.mats.black, 0, 0, ceiling - 0.0075, opening, opening, 0.015)
    for (let i = 0; i < 9; i++) {
      const y = -opening / 2 + (i + 0.5) * opening / 9
      slab(g, this.ctx.mats.steel, 0, y, ceiling - 0.0425, opening, 0.026, 0.025)
    }
    return this.placeLocal(g, mod)
  }
}
