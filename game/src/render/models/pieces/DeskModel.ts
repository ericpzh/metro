// Office desk builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * A free-standing office desk for the 装饰 folder: the 办公室 grid unit (leg
 * panel, desktop, monitor, chair), one cell wide, turning with the placement
 * rotation via `placeLocal`.
 */
function buildDesk(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  slab(g, mats.steel, 0, -0.22, 0.2, 1.0, 0.06, 0.42)
  slab(g, mats.darkSteel, 0, 0, 0.42, 1.1, 0.6, 0.06)
  slab(g, mats.screen, 0, 0, 0.62, 0.44, 0.08, 0.28)
  slab(g, mats.blue, 0, 0.44, 0.24, 0.42, 0.42, 0.08)
  slab(g, mats.blue, 0, 0.58, 0.5, 0.42, 0.08, 0.46)
  return g
}

export class DeskModel extends PieceBuilder {
  readonly kind = 'desk'
  build(mod: Extract<Module, { type: 'desk' }>): THREE.Group {
    return placeLocal(buildDesk(this.ctx.mats), mod)
  }
}

