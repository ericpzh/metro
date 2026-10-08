import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import { pillarWidth, pillarSupportsBridge, BRIDGE_DECK_DEPTH } from '../../../sim/structures.ts'
import type { PillarModule } from '../../../sim/structures.ts'
export class PillarModel extends PieceBuilder {
  readonly kind = 'pillar'
  build(mod: PillarModule): THREE.Group {
    const g = new THREE.Group()
    const w = pillarWidth(mod)
    const bridge = this.ctx.data.modules.find((m) => pillarSupportsBridge(mod, m))
    const h = bridge ? bridge.z - BRIDGE_DECK_DEPTH - mod.z - 1 : mod.cfg.height
    const mat = mod.cfg.size === 'thick' ? this.ctx.mats.white : this.ctx.mats.darkSteel
    slab(g, mat, 0, 0, h / 2, w, w, h)
    // Steel collars make each four-metre extension legible without enlarging its footprint.
    for (let z = 0; z <= h; z += 4) slab(g, this.ctx.mats.steel, 0, 0, Math.max(0.05, Math.min(h - 0.05, z)), w, w, 0.1)
    if (bridge) slab(g, this.ctx.mats.steel, 0, 0, h - 0.05, w, w, 0.1)
    return this.placeLocal(g, mod)
  }
}
