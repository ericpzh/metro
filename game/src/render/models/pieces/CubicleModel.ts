// Restroom cubicle builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * One restroom cubicle for the 装饰 folder: the 厕所 back-row unit (partition
 * on the cell's east edge, WC bowl + tank), facing the room (−y) at rot 0.
 */
function buildCubicle(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  slab(g, mats.steel, 0.47, 0, 0.9, 0.06, 1.0, 1.8)
  slab(g, mats.white, 0, -0.12, 0.2, 0.42, 0.62, 0.4)
  slab(g, mats.white, 0, 0.08, 0.42, 0.42, 0.28, 0.26)
  return g
}

export class CubicleModel extends PieceBuilder {
  readonly kind = 'cubicle'
  build(mod: Extract<Module, { type: 'cubicle' }>): THREE.Group {
    return placeLocal(buildCubicle(this.ctx.mats), mod)
  }
}

