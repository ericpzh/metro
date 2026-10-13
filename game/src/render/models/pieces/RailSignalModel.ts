import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { RAIL_SIGNAL_SCALE } from '../../../sim/constants.ts'

/** Three hooded aspects on a low concrete plinth, reference rail-side decor (§5.7). */
export class RailSignalModel extends PieceBuilder {
  readonly kind = 'rail-signal'
  build(mod: Extract<Module, { type: 'rail-signal' }>): THREE.Group {
    const g = new THREE.Group()
    const mats = this.ctx.mats
    const concrete = this.ctx.finish('floor.concrete')
    slab(g, concrete, 0, 0, 0.07, 0.76, 0.76, 0.14).name = 'signal-concrete-base'
    slab(g, concrete, 0, 0.08, 0.49, 0.35, 0.35, 0.70).name = 'signal-concrete-post'
    slab(g, mats.darkSteel, 0, 0.07, 1.68, 0.10, 0.10, 1.82)
    for (let i = 0; i < 3; i++) {
      const z = 1.20 + i * 0.55
      slab(g, mats.darkSteel, 0, 0, z, 0.47, 0.28, 0.50)
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.03, 32), mats.black)
      rim.position.set(0, -0.155, z)
      g.add(rim)
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.167, 32), i === 0 ? mats.ledRed : mats.darkSteel)
      lens.name = `signal-lamp-${i}`
      lens.rotation.x = Math.PI / 2
      lens.position.set(0, -0.176, z)
      g.add(lens)
      // Upper semicylinder: open underneath, with a deep visor in front of the lens.
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 24, 1, true, 0, Math.PI), mats.darkSteel)
      hood.name = `signal-hood-${i}`
      hood.rotation.y = -Math.PI / 2
      hood.position.set(0, -0.22, z)
      g.add(hood)
    }
    slab(g, mats.steel, 0.25, 0.15, 0.31, 0.18, 0.28, 0.40)
    g.scale.setScalar(RAIL_SIGNAL_SCALE)
    return placeLocal(g, mod)
  }
}
