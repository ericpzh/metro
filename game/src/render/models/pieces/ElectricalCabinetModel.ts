import * as THREE from 'three'
import type { Module } from '../../../sim/types.ts'
import { PieceBuilder, slab } from '../PieceBuilder.ts'

/** A three-bay switchboard with red fascia, meters, breakers and status lamps (§9.5). */
export class ElectricalCabinetModel extends PieceBuilder {
  readonly kind = 'electrical-cabinet'
  build(mod: Extract<Module, { type: 'electrical-cabinet' }>): THREE.Group {
    const g = new THREE.Group()
    const m = this.ctx.mats
    slab(g, m.darkSteel, 1, 0, 0.06, 2.92, 0.92, 0.12)
    slab(g, m.steel, 1, 0, 1.16, 2.92, 0.78, 2.08)
    slab(g, m.gateRed, 1, -0.475, 2.13, 2.92, 0.04, 0.12)
    for (const x of [0, 1, 2]) {
      slab(g, m.steel, x, -0.4, 1.1, 0.95, 0.025, 1.94)
      slab(g, m.steel, x, -0.475, 1.08, 0.015, 0.018, 1.94)
      for (const z of [0.25, 0.93, 1.72, 2.02]) slab(g, m.darkSteel, x, -0.473, z, 0.94, 0.012, 0.012)
      for (const dx of [-0.27, 0, 0.27]) {
        slab(g, m.black, x + dx, -0.49, 1.88, 0.19, 0.035, 0.16)
        slab(g, m.steel, x + dx, -0.511, 1.89, 0.15, 0.01, 0.12)
        const needle = slab(g, m.black, x + dx, -0.52, 1.89, 0.008, 0.008, 0.075)
        needle.rotation.y = -0.4
      }
      for (let i = 0; i < 3; i++) slab(g, [m.green, m.orange, m.gateRed][i], x - 0.22 + i * 0.22, -0.5, 1.59, 0.055, 0.03, 0.055)
      slab(g, m.black, x, -0.49, 1.26, 0.43, 0.06, 0.38)
      slab(g, m.darkSteel, x, -0.53, 1.26, 0.31, 0.025, 0.29)
      slab(g, m.black, x + 0.33, -0.51, 0.63, 0.04, 0.055, 0.2)
      for (let i = 0; i < 12; i++) slab(g, m.darkSteel, x - 0.35 + i * 0.064, -0.483, 0.16, 0.023, 0.012, 0.09)
    }
    // Recess the instruments within the cabinet's reserved floor tile.
    for (const part of g.children) if (part.position.y < -0.46) part.position.y += 0.055
    return this.placeLocal(g, mod)
  }
}
