// Wash basin builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * A wash basin for the 装饰 folder: the 厕所 front-wall unit (basin + tap),
 * facing the room (+y) at rot 0.
 */
function buildSink(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  slab(g, mats.steel, 0, -0.08, 0.45, 0.6, 0.5, 0.14)
  slab(g, mats.steel, 0, -0.08, 0.62, 0.06, 0.06, 0.24)
  return g
}

export class SinkModel extends PieceBuilder {
  readonly kind = 'sink'
  build(mod: Extract<Module, { type: 'sink' }>): THREE.Group {
    return placeLocal(buildSink(this.ctx.mats), mod)
  }
}

