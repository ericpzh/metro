// Fire-extinguisher cabinet (灭火器) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * Fire-extinguisher cabinet (灭火器, 装饰): the reference red steel box, 0.70 ×
 * 0.44 m in plan and 1.10 m tall including its four legs — the drawn height
 * `FLAT_HEIGHT.extinguisher` reserves.
 *
 * The carcass rides a dark base plate on four corner legs, a lid overhangs it on
 * every side, and the front is two red doors laid over a dark backing so the seam
 * between them is a real groove; the upper door prints 灭火器箱 over its English
 * gloss and the lower one 火119警, and a recessed handle sits on the +x side. The
 * front faces local −y.
 */
function buildExtinguisher(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const w = 0.7
  const d = 0.44
  const h = 1.1
  const legH = 0.16
  // Four corner legs, then the base plate they carry the carcass on.
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    for (const y of [-d / 2 + 0.06, d / 2 - 0.06]) slab(g, mats.exitRed, x, y, legH / 2, 0.05, 0.05, legH)
  }
  slab(g, mats.darkSteel, 0, 0, legH + 0.025, w, d, 0.05)
  // The carcass, and the dark backing its two doors close over.
  slab(g, mats.exitRed, 0, 0.01, 0.63, w, d - 0.02, 0.86)
  slab(g, mats.black, 0, -d / 2 + 0.011, 0.63, w - 0.06, 0.017, 0.84)
  // Two doors with a seam between them, then the overhanging lid.
  slab(g, mats.exitRed, 0, -d / 2 - 0.0125, 0.88, w - 0.05, 0.025, 0.32)
  slab(g, mats.exitRed, 0, -d / 2 - 0.0125, 0.47, w - 0.05, 0.025, 0.46)
  slab(g, mats.exitRed, 0, 0, h - 0.025, w + 0.04, d + 0.04, 0.05)
  // The recessed side handle: a dark well with the grip standing in it.
  slab(g, mats.black, w / 2 + 0.0035, 0.05, 0.88, 0.009, 0.16, 0.07)
  slab(g, mats.steel, w / 2 + 0.0125, 0.05, 0.88, 0.02, 0.12, 0.02)
  // The lettering, printed on the doors' own red steel.
  plate(g, mats.fireLabels, 0.64, 0.8, 0, -d / 2 - 0.027, 0.66, 0)
  return g
}

export class ExtinguisherModel extends PieceBuilder {
  readonly kind = 'extinguisher'
  build(mod: Extract<Module, { type: 'extinguisher' }>): THREE.Group {
    return placeLocal(buildExtinguisher(this.ctx.mats), mod)
  }
}

