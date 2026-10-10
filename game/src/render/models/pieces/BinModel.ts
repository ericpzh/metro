// Stainless two-stream station bin (垃圾桶, GAME-SPEC §5.7).

import * as THREE from 'three'
import { PieceBuilder, slab, plate, placeLocalAtEdge } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/* ------------------------------------------- litter bin and extinguisher box */

/**
 * Litter bin (垃圾桶, 装饰): the reference stainless double bin — 0.88 × 0.42 m in
 * plan and 0.95 m tall, the drawn height `FLAT_HEIGHT.bin` reserves.
 *
 * The enclosed cabinet carries two white sorting stickers under a sloping crown.
 * Each mouth is an actual four-sided hopper with a dark well below it, so the
 * opening keeps its depth from above and from the approach face (local −y).
 */
function buildBin(mats: ModelMaterials): THREE.Group {
  const g = new THREE.Group()
  const steel = mats.binSteel
  const w = 0.88
  const d = 0.42
  // A recessed toe and projecting folded sill, as on the photographed cabinet.
  slab(g, mats.darkSteel, 0, 0, 0.025, 0.79, 0.34, 0.05)
  slab(g, steel, 0, 0, 0.065, w, d, 0.03)
  slab(g, steel, 0, 0, 0.09, 0.84, 0.39, 0.02)
  slab(g, steel, 0, 0.187, 0.45, 0.82, 0.026, 0.7)
  for (const x of [-0.407, 0.407]) slab(g, steel, x, 0, 0.45, 0.026, 0.4, 0.7)
  slab(g, steel, 0, -0.187, 0.45, 0.79, 0.026, 0.7)
  // A folded perimeter around the removable front, with the print clear of it.
  for (const x of [-0.39, 0.39]) slab(g, mats.darkSteel, x, -0.201, 0.448, 0.002, 0.002, 0.674)
  slab(g, mats.darkSteel, 0, -0.201, 0.113, 0.78, 0.002, 0.002)
  plate(g, mats.binLabels, 0.76, 0.57, 0, -0.204, 0.49, 0)
  slab(g, steel, 0, -0.193, 0.818, w, 0.034, 0.036)
  slab(g, steel, 0, 0.18, 0.933, w, 0.06, 0.034)

  type Point = [number, number, number]
  // Individually wound faces give the hoppers inward normals and the folded
  // crown outward normals without making a transparent, double-sided shell.
  const face = (a: Point, b: Point, c: Point, e: Point, inward = false) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...e], 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    geo.setIndex(inward ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3])
    geo.computeVertexNormals()
    g.add(new THREE.Mesh(geo, steel))
  }
  // Sloped side caps and centre bridge frame two open trapezoidal mouths.
  for (const [left, right] of [[-0.44, -0.395], [-0.022, 0.022], [0.395, 0.44]]) {
    face([left, -0.176, 0.836], [right, -0.176, 0.836], [right, 0.15, 0.95], [left, 0.15, 0.95])
  }
  face([-0.44, -0.176, 0.8], [-0.44, -0.176, 0.836], [-0.44, 0.15, 0.95], [-0.44, 0.15, 0.8])
  face([0.44, 0.15, 0.8], [0.44, 0.15, 0.95], [0.44, -0.176, 0.836], [0.44, -0.176, 0.8])
  for (const x of [-0.2085, 0.2085]) {
    const l = x - 0.1865, r = x + 0.1865
    const bl = x - 0.125, br = x + 0.125
    face([l, -0.176, 0.836], [bl, -0.09, 0.755], [br, -0.09, 0.755], [r, -0.176, 0.836], true)
    face([r, 0.15, 0.95], [br, 0.08, 0.755], [bl, 0.08, 0.755], [l, 0.15, 0.95], true)
    face([l, 0.15, 0.95], [bl, 0.08, 0.755], [bl, -0.09, 0.755], [l, -0.176, 0.836], true)
    face([r, -0.176, 0.836], [br, -0.09, 0.755], [br, 0.08, 0.755], [r, 0.15, 0.95], true)
    slab(g, mats.black, x, -0.005, 0.732, 0.25, 0.17, 0.012)
  }
  return g
}

export class BinModel extends PieceBuilder {
  readonly kind = 'bin'
  build(mod: Extract<Module, { type: 'bin' }>): THREE.Group {
    return placeLocalAtEdge(buildBin(this.ctx.mats), mod, 0.436)
  }
}

