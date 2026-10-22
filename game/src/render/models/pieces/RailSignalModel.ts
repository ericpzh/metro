import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { RAIL_SIGNAL_SCALE } from '../../../sim/constants.ts'
import { omitModelDetail, setModelDetail, surfaceModelDetail, tubeModelDetail } from '../../modelDetail.ts'

/** Three hooded aspects on a low concrete plinth, reference rail-side decor (§5.7). */
export class RailSignalModel extends PieceBuilder {
  readonly kind = 'rail-signal'
  build(mod: Extract<Module, { type: 'rail-signal' }>): THREE.Group {
    const g = new THREE.Group()
    const mats = this.ctx.mats
    const concrete = this.ctx.finish('floor.concrete')
    const base = slab(g, concrete, 0, 0, 0.07, 0.76, 0.76, 0.14); base.name = 'signal-concrete-base'; surfaceModelDetail(base, 'z')
    const post = slab(g, concrete, 0, 0.08, 0.49, 0.35, 0.35, 0.70); post.name = 'signal-concrete-post'; tubeModelDetail(post)
    omitModelDetail(slab(g, mats.darkSteel, 0, 0.07, 1.68, 0.10, 0.10, 1.82))
    for (let i = 0; i < 3; i++) {
      const z = 1.20 + i * 0.55
      const body = slab(g, mats.darkSteel, 0, 0, z, 0.47, 0.28, 0.50)
      if (i === 0) setModelDetail(body, new THREE.BoxGeometry(.47, .28, 1.71).translate(0, 0, .495))
      else omitModelDetail(body)
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.03, 32), mats.black)
      rim.position.set(0, -0.155, z)
      setModelDetail(rim, new THREE.CircleGeometry(0.205, 4).rotateX(Math.PI / 2).translate(0, -0.015, 0))
      g.add(rim)
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.167, 32), i === 0 ? mats.ledRed : mats.darkSteel)
      lens.name = `signal-lamp-${i}`
      lens.rotation.x = Math.PI / 2
      lens.position.set(0, -0.176, z)
      setModelDetail(lens, new THREE.CircleGeometry(0.167, 6))
      g.add(lens)
      // Upper semicylinder: open underneath, with a deep visor in front of the lens.
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 24, 1, true, 0, Math.PI), mats.darkSteel)
      hood.name = `signal-hood-${i}`
      hood.rotation.y = -Math.PI / 2
      hood.position.set(0, -0.22, z)
      setModelDetail(hood, new THREE.CylinderGeometry(0.22, 0.22, 0.28, 2, 1, true, 0, Math.PI))
      g.add(hood)
    }
    omitModelDetail(slab(g, mats.steel, 0.25, 0.15, 0.31, 0.18, 0.28, 0.40))
    g.scale.setScalar(RAIL_SIGNAL_SCALE)
    return placeLocal(g, mod)
  }
}
