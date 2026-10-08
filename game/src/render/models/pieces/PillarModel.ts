import * as THREE from 'three'
import { PieceBuilder, finishSlab, slab } from '../PieceBuilder.ts'
import { pillarWidth, pillarOffset, pillarSupportsBridge, BRIDGE_DECK_DEPTH } from '../../../sim/structures.ts'
import type { PillarModule } from '../../../sim/structures.ts'
export class PillarModel extends PieceBuilder {
  readonly kind = 'pillar'
  build(mod: PillarModule): THREE.Group {
    const g = new THREE.Group()
    const w = pillarWidth(mod)
    const offset = pillarOffset(mod)
    const bridge = this.ctx.data.modules.find((m) => pillarSupportsBridge(mod, m))
    const h = bridge ? bridge.z - BRIDGE_DECK_DEPTH - mod.z - 1 : mod.cfg.height - (mod.cfg.bridgeId ? BRIDGE_DECK_DEPTH + 1 : 0)
    const mat = mod.cfg.finish ? this.ctx.finish(mod.cfg.finish) : mod.cfg.size === 'thick' ? this.ctx.mats.white : this.ctx.mats.darkSteel
    // Keep the slim shaft inside its steel collars. Coincident outer faces and
    // end caps otherwise z-fight, most visibly at the top and every 4 m joint.
    const shaftInset = mod.cfg.size === 'slim' ? 0.04 : 0
    const shaftStart = mod.cfg.size === 'slim' ? 0.1 : 0
    const shaftEnd = mod.cfg.size === 'slim' ? Math.max(shaftStart, h - 0.1) : h
    const shaftH = shaftEnd - shaftStart
    const shaftW = w - shaftInset * 2
    if (shaftH > 0) {
      if (mod.cfg.finish) finishSlab(g, mat, offset.x, offset.y, (shaftStart + shaftEnd) / 2, shaftW, shaftW, shaftH)
      else slab(g, mat, offset.x, offset.y, (shaftStart + shaftEnd) / 2, shaftW, shaftW, shaftH)
    }
    // Steel collars make each four-metre extension legible without enlarging its footprint.
    for (let z = 0; z <= h; z += 4) slab(g, this.ctx.mats.steel, offset.x, offset.y, Math.max(0.05, Math.min(h - 0.05, z)), w, w, 0.1)
    if (bridge) slab(g, this.ctx.mats.steel, offset.x, offset.y, h - 0.05, w, w, 0.1)
    // Slim pillar `rot` selects one of nine in-cell positions; the offset above
    // already expresses that position, so applying it again as a model turn
    // would collapse several edge and corner choices onto the same locations.
    return this.placeLocal(g, mod.cfg.size === 'slim' ? { ...mod, rot: 0 } : mod)
  }
}
