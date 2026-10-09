import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal, ownedMaterial } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { ceramicMaterial, roundedFixture, turnedFixture, fixtureRing } from './RestroomFixtures.ts'

export class SinkModel extends PieceBuilder {
  readonly kind = 'sink'
  build(mod: Extract<Module, { type: 'sink' }>): THREE.Group {
    const g = new THREE.Group()
    const { mats } = this.ctx
    const porcelain = ceramicMaterial(this.ctx)
    const chrome = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0xcbd4d9, metalness: 0.65, roughness: 0.2 }))
    // GAME-SPEC §5.7: front-wall basin, facing +y, with a recessed bowl.
    turnedFixture(g, porcelain, [[0.085, 0.01], [0.105, 0.045], [0.075, 0.25], [0.065, 0.57], [0.13, 0.72]], 0, -0.06, 1, 1.1)
    turnedFixture(g, porcelain, [[0.10, 0.59], [0.19, 0.65], [0.27, 0.76], [0.29, 0.815], [0.27, 0.835], [0.245, 0.81], [0.20, 0.75], [0.10, 0.70], [0.025, 0.695]], 0, 0, 1.18, 0.84)
    fixtureRing(g, porcelain, 0, 0, 0.827, 0.276, 0.016, 1.18, 0.84)
    roundedFixture(g, porcelain, 0, -0.265, 0.813, 0.67, 0.15, 0.055, 0.024)
    turnedFixture(g, chrome, [[0.026, 0.697], [0, 0.697]], 0, 0)
    turnedFixture(g, mats.darkSteel, [[0.008, 0.699], [0, 0.699]], 0, 0)
    roundedFixture(g, mats.darkSteel, 0, -0.161, 0.779, 0.034, 0.009, 0.013, 0.005)
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.27, 0.84), new THREE.Vector3(0, -0.27, 0.985),
      new THREE.Vector3(0, -0.21, 1.03), new THREE.Vector3(0, -0.12, 1.025),
      new THREE.Vector3(0, -0.09, 0.99),
    ])
    g.add(new THREE.Mesh(new THREE.TubeGeometry(path, 24, 0.018, 10, false), chrome))
    roundedFixture(g, chrome, 0, -0.27, 0.842, 0.07, 0.07, 0.025, 0.01)
    roundedFixture(g, chrome, 0, -0.285, 0.946, 0.038, 0.095, 0.014, 0.006)
    slab(g, mats.darkSteel, 0, -0.09, 0.977, 0.026, 0.026, 0.007)
    for (const x of [-0.21, 0.21]) {
      slab(g, mats.steel, x, -0.30, 0.65, 0.035, 0.04, 0.22)
      slab(g, mats.steel, x, -0.21, 0.74, 0.035, 0.20, 0.025)
    }
    return placeLocal(g, mod)
  }
}
