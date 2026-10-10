import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import { HANGER_BAR_TOP, HANGER_BAR_DEPTH, HANGER_POST_BAR_TOP, HANGER_POST_WIDTH, HANGER_POST_OFFSET, hangerCells, hangerRoofZ } from '../../../sim/hangers.ts'
import type { HangerModule } from '../../../sim/hangers.ts'

export class HangerModel extends PieceBuilder {
  readonly kind = 'hanger'

  build(mod: HangerModule): THREE.Group {
    const group = new THREE.Group()
    const steel = this.ctx.mats.steel
    const centre = (mod.w - 1) / 2
    const barTop = mod.cfg.mount === 'roof' ? HANGER_BAR_TOP : HANGER_POST_BAR_TOP
    slab(group, steel, centre, 0, barTop - HANGER_BAR_DEPTH / 2, mod.w, HANGER_BAR_DEPTH, HANGER_BAR_DEPTH).name = 'hanger-bar'
    if (mod.cfg.mount === 'post') {
      slab(group, steel, centre, HANGER_POST_OFFSET, HANGER_POST_BAR_TOP / 2, HANGER_POST_WIDTH, HANGER_POST_WIDTH, HANGER_POST_BAR_TOP).name = 'hanger-post'
      slab(group, steel, centre, HANGER_POST_OFFSET, 0.025, 0.36, 0.36, 0.05).name = 'hanger-base'
    } else {
      const run = hangerCells(mod)
      for (const index of [0, mod.w - 1]) {
        const [x, y] = run[index]!
        const roof = hangerRoofZ(this.ctx.data.cells, this.ctx.data.modules, mod, x, y) ?? mod.z + 5
        const height = Math.max(0, roof - (mod.z + 1 + barTop))
        if (height > 0) slab(group, steel, index, 0, barTop + height / 2, 0.08, 0.08, height).name = 'hanger-suspension'
        slab(group, steel, index, 0, barTop, 0.3, 0.3, 0.04).name = 'hanger-clamp'
      }
    }
    return this.placeLocal(group, mod)
  }
}
