// Vending machine (自动贩卖机) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, capTop, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/* --------------------------------------------------------------- vending */

/**
 * Vending machine (自动贩卖机): a tall white cabinet with a glass-fronted drink
 * display on the left and a face-pay control strip on the right, following the
 * reference photo. The same 1 × 1 m footprint as a TVM; the front faces −y.
 */
function buildVending(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  // Plinth and the white cabinet (its front face sits at y = −0.30).
  slab(g, mats.darkSteel, 0, 0.01, 0.06, 0.72, 0.58, 0.12)
  slab(g, mats.white, 0, 0.01, 0.97, 0.76, 0.62, 1.7)
  capTop(g, mats.darkSteel, 0, 0.01, 1.82, 0.78, 0.64)

  // The blue 温馨提示 banner across the top of the front.
  slab(g, mats.blue, 0, -0.301, 1.785, 0.72, 0.02, 0.07)

  // --- left glass display: dark cavity, five shelves, rows of drinks --------
  slab(g, mats.black, -0.17, -0.304, 1.01, 0.4, 0.012, 1.38)
  const drinks = [mats.orange, mats.green, mats.blue, mats.psu, mats.white, mats.gateRed]
  const shelfZ = [0.42, 0.68, 0.94, 1.2, 1.46]
  for (let s = 0; s < shelfZ.length; s++) {
    const z = shelfZ[s]
    slab(g, mats.steel, -0.17, -0.326, z - 0.011, 0.4, 0.036, 0.022)
    for (let col = 0; col < 4; col++) {
      const x = -0.32 + col * 0.1
      slab(g, drinks[(s * 4 + col) % drinks.length], x, -0.326, z + 0.095, 0.07, 0.036, 0.19)
      slab(g, mats.darkSteel, x, -0.326, z + 0.2, 0.045, 0.032, 0.022)
    }
  }
  // Glass door and its steel frame, with a handle at the opening edge.
  slab(g, mats.glass, -0.17, -0.354, 1.01, 0.42, 0.014, 1.4)
  slab(g, mats.darkSteel, -0.385, -0.354, 1.01, 0.03, 0.04, 1.4)
  slab(g, mats.darkSteel, 0.045, -0.354, 1.01, 0.03, 0.04, 1.4)
  slab(g, mats.darkSteel, -0.17, -0.354, 0.305, 0.46, 0.04, 0.03)
  slab(g, mats.darkSteel, -0.17, -0.354, 1.715, 0.46, 0.04, 0.03)
  slab(g, mats.darkSteel, 0.005, -0.366, 1.01, 0.025, 0.03, 0.5)

  // --- right control strip and the base hotline band ------------------------
  plate(g, mats.vendingPanel, 0.32, 1.44, 0.19, -0.306, 1.02, 0)
  plate(g, mats.vendingBase, 0.66, 0.165, -0.01, -0.306, 0.215, 0)
  return g
}

export class VendingModel extends PieceBuilder {
  readonly kind = 'vending'
  build(mod: Extract<Module, { type: 'vending' }>): THREE.Group {
    return placeLocal(buildVending(this.ctx.mats), mod)
  }
}

