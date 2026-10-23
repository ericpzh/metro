import * as THREE from 'three'
import { modelCellAt } from '../../modelNeighbours.ts'
import { DEFAULT_MATERIAL } from '../../../sim/finishes.ts'
import { PieceBuilder, finishSlab } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { setModelDetail } from '../../modelDetail.ts'

/** Four solid treads fill one cubic metre and meet adjacent blocks flush. */
export class StairBlockModel extends PieceBuilder {
  readonly kind = 'stair'
  build(mod: Extract<Module, { type: 'stair' }>): THREE.Group {
    const g = new THREE.Group()
    const floor = modelCellAt(this.ctx.data.cells, mod.x, mod.y, mod.z)
    const material = this.ctx.finish(mod.cfg.finish ?? floor?.finish?.top ?? DEFAULT_MATERIAL)
    const rise = mod.cfg.blockHeight ?? 1
    const steps = rise === 0.5 ? 2 : 4
    const depth = 1 / steps
    for (let i = 0; i < steps; i++) {
      const height = (i + 1) * rise / steps
      const step = finishSlab(g, material, -0.5 + (i + 0.5) * depth, 0, height / 2, depth, 1, height)
      // Keep a closed outer silhouette but no internal bottom/side faces per step.
      const geometry = step.geometry.clone()
      const indices = Array.from(geometry.index!.array)
      geometry.setIndex(indices.filter((_, index) => (index >= 6 && index < 30) || (i === steps - 1 && index < 6)))
      setModelDetail(step, geometry)
    }
    return this.placeLocal(g, mod)
  }
}
