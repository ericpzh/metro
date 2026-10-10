import * as THREE from 'three'
import type { Module } from '../../../sim/types.ts'
import { PieceBuilder, slab } from '../PieceBuilder.ts'

/** Floor-standing industrial chiller: coil banks, twin top fans and service pipes (§9.5). */
export class AcUnitModel extends PieceBuilder {
  readonly kind = 'ac-unit'
  build(mod: Extract<Module, { type: 'ac-unit' }>): THREE.Group {
    const g = new THREE.Group()
    const m = this.ctx.mats
    for (const y of [-0.25, 1.25]) slab(g, m.darkSteel, 1, y, 0.09, 2.88, 0.16, 0.18)
    slab(g, m.steel, 1, 0.5, 1.34, 2.86, 1.86, 2.34)
    for (const y of [-0.44, 1.44]) {
      slab(g, m.darkSteel, 1, y, 1.68, 2.64, 0.025, 1.48)
      for (let i = 0; i < 22; i++) slab(g, m.black, 1, y + (y < 0 ? -0.016 : 0.016), 1.02 + i * 0.063, 2.58, 0.012, 0.017)
      for (const x of [-0.35, 0.55, 1.45, 2.35]) slab(g, m.steel, x, y, 1.68, 0.045, 0.075, 1.54)
      for (const x of [0.3, 1.7]) {
        slab(g, m.steel, x, y, 0.52, 1.24, 0.04, 0.48)
        slab(g, m.black, x + 0.42, y + (y < 0 ? -0.035 : 0.035), 0.55, 0.12, 0.025, 0.025)
      }
    }
    for (const x of [0.25, 1.75]) {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.51, 0.51, 0.17, 32), m.steel)
      housing.rotation.x = Math.PI / 2
      housing.position.set(x, 0.5, 2.6)
      g.add(housing)
      const fan = new THREE.Mesh(new THREE.CircleGeometry(0.46, 32), m.black)
      fan.position.set(x, 0.5, 2.688)
      g.add(fan)
      for (let i = 0; i < 8; i++) {
        const guard = slab(g, m.steel, x, 0.5, 2.697, 0.91, 0.012, 0.006)
        guard.rotation.z = i * Math.PI / 8
      }
      for (const radius of [0.18, 0.32, 0.45]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.006, 4, 32), m.steel)
        ring.position.set(x, 0.5, 2.694)
        g.add(ring)
      }
    }
    // Pipes stay inside the reserved 3 × 2 m footprint.
    for (const x of [0.45, 1.55]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.3, 12), m.steel)
      pipe.position.set(x, -0.32, 0.3)
      g.add(pipe)
    }
    return this.placeLocal(g, mod)
  }
}
