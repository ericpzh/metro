// Litter bin (垃圾桶) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab, plate, placeLocal } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/* ------------------------------------------- litter bin and extinguisher box */

/**
 * Litter bin (垃圾桶, 装饰): the reference stainless double bin — 0.88 × 0.42 m in
 * plan and 0.95 m tall, the drawn height `FLAT_HEIGHT.bin` reserves.
 *
 * Two compartments share one stainless shell: the top rim is a front rail, a back
 * rail and a centre bar around two recessed mouths, the front is open below the
 * printed band with the divider and a slatted drain tray between the two bags, and
 * a dark liner fills the shell so every opening reads as a cavity rather than as a
 * face of a solid block. The front faces local −y, so the placement rotation aims
 * the piece like any other equipment.
 */
function buildBin(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const w = 0.88
  const d = 0.42
  const h = 0.95
  // The shell: back and sides, standing on the cell's top face.
  slab(g, mats.steel, 0, d / 2 - 0.025, h / 2, w, 0.05, h)
  for (const x of [-w / 2 + 0.025, w / 2 - 0.025]) slab(g, mats.steel, x, 0, h / 2, 0.05, d, h)
  // The dark liner: what the two mouths and the open front actually show.
  slab(g, mats.darkSteel, 0, 0.02, 0.46, w - 0.12, d - 0.18, 0.84)
  // A slatted drain tray over a dark base, and the divider the bags hang either side of.
  slab(g, mats.black, 0, 0, 0.15, w - 0.12, d - 0.12, 0.02)
  for (let i = 0; i < 5; i++) slab(g, mats.steel, -0.32 + i * 0.16, 0, 0.165, 0.1, d - 0.08, 0.015)
  slab(g, mats.steel, 0, -0.02, 0.535, 0.05, d - 0.08, 0.75)
  // The front band above the openings, carrying the two waste marks. It stands a
  // few millimetres proud of the shell, so the printed decal is a plate on the
  // steel rather than a face coplanar with it.
  slab(g, mats.steel, 0, -d / 2 + 0.02, 0.83, w - 0.06, 0.05, 0.22)
  plate(g, mats.binLabels, 0.76, 0.19, 0, -d / 2 - 0.008, 0.83, 0)
  // The top rim, and the two recessed mouths it frames.
  slab(g, mats.steel, 0, -0.19, 0.925, 0.82, 0.05, 0.05)
  slab(g, mats.steel, 0, 0.19, 0.925, 0.82, 0.05, 0.05)
  slab(g, mats.steel, 0, 0, 0.925, 0.07, 0.38, 0.05)
  for (const x of [-0.2, 0.2]) slab(g, mats.black, x, 0, 0.888, 0.31, d - 0.1, 0.04)
  return g
}

export class BinModel extends PieceBuilder {
  readonly kind = 'bin'
  build(mod: Extract<Module, { type: 'bin' }>): THREE.Group {
    return placeLocal(buildBin(this.ctx.mats), mod)
  }
}

