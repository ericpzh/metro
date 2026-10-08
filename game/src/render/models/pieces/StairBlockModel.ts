import * as THREE from 'three'
import { PieceBuilder, finishSlab } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/** Four solid treads fill one cubic metre and meet adjacent blocks flush. */
export class StairBlockModel extends PieceBuilder {
  readonly kind = 'stair'
  build(mod: Extract<Module, { type: 'stair' }>): THREE.Group {
    const g = new THREE.Group()
    const floor = this.ctx.data.cells.find((c) => c.x === mod.x && c.y === mod.y && c.z === mod.z)
    const material = this.ctx.finish(mod.cfg.finish ?? floor?.finish?.top ?? 'floor.granite')
    const rise = mod.cfg.blockHeight ?? 1
    const steps = rise === 0.5 ? 2 : 4
    const depth = 1 / steps
    for (let i = 0; i < steps; i++) {
      const height = (i + 1) * rise / steps
      finishSlab(g, material, -0.5 + (i + 0.5) * depth, 0, height / 2, depth, 1, height)
    }
    return this.placeLocal(g, mod)
  }
}
