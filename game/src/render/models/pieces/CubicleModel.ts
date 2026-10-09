import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal, ownedMaterial } from '../PieceBuilder.ts'
import { rotateLocal } from '../../../sim/track.ts'
import type { Module } from '../../../sim/types.ts'
import { ceramicMaterial, roundedFixture, turnedFixture, fixtureRing } from './RestroomFixtures.ts'

type Cubicle = Extract<Module, { type: 'cubicle' }>
const WALLS = [[-0.5, 0], [0.5, 0], [0, 0.5]] as const

function wallCentre(mod: Cubicle, x: number, y: number): [number, number] {
  const [dx, dy] = rotateLocal(mod.rot, x, y)
  return [mod.x + 0.5 + dx, mod.y + 0.5 + dy]
}

export class CubicleModel extends PieceBuilder {
  readonly kind = 'cubicle'
  build(mod: Cubicle): THREE.Group {
    const g = new THREE.Group()
    const { mats } = this.ctx
    const partition = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0xc8d9d6, roughness: 0.55 }))
    const porcelain = ceramicMaterial(this.ctx)
    const seat = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0xfafbf8, roughness: 0.3 }))
    // GAME-SPEC §5.7: independent room furniture. Cell-edge panels have no end
    // caps; the earlier cell owns shared walls, including rotated neighbours.
    for (const [x, y] of WALLS) {
      const [wx, wy] = wallCentre(mod, x, y)
      const shared = !this.ctx.preview && this.ctx.data?.modules.some((other) =>
        other.type === 'cubicle' && other.id !== mod.id && other.z === mod.z &&
        (other.x < mod.x || (other.x === mod.x && other.y < mod.y)) &&
        WALLS.some(([ox, oy]) => {
          const [px, py] = wallCentre(other, ox, oy)
          return px === wx && py === wy
        }))
      if (shared) continue
      const panel = slab(g, partition, x, y, 1.05, x ? 0.04 : 1, x ? 1 : 0.04, 1.8)
      panel.name = 'cubicle-partition'
      if (x) for (const fy of [-0.36, 0.36]) {
        slab(g, mats.steel, x, fy, 0.075, 0.045, 0.055, 0.15)
        slab(g, mats.steel, x, fy, 0.015, 0.07, 0.085, 0.03)
      }
    }
    for (const x of [-0.445, 0.445]) slab(g, partition, x, -0.48, 1.05, 0.07, 0.04, 1.8)
    const door = slab(g, partition, 0, -0.48, 1.075, 0.802, 0.035, 1.75)
    door.name = 'cubicle-door'
    slab(g, mats.steel, 0, -0.48, 1.955, 1, 0.055, 0.045)
    for (const z of [0.5, 1.65]) roundedFixture(g, mats.steel, -0.41, -0.505, z, 0.025, 0.03, 0.09, 0.009)
    roundedFixture(g, mats.steel, 0.31, -0.509, 1.08, 0.075, 0.025, 0.12, 0.012)
    slab(g, mats.darkSteel, 0.30, -0.532, 1.055, 0.06, 0.025, 0.018)
    slab(g, mats.green, 0.31, -0.524, 1.11, 0.024, 0.006, 0.014)
    // Hollow ceramic bowl, pedestal, oval seat and rounded cistern.
    turnedFixture(g, porcelain, [[0.14, 0.015], [0.15, 0.05], [0.105, 0.19], [0.13, 0.30]], 0, 0.015, 1, 1.25)
    turnedFixture(g, porcelain, [[0.13, 0.25], [0.18, 0.29], [0.205, 0.36], [0.215, 0.405], [0.19, 0.415], [0.16, 0.37], [0.10, 0.30], [0.065, 0.285]], 0, -0.08, 1, 1.38)
    fixtureRing(g, seat, 0, -0.08, 0.435, 0.197, 0.023, 1, 1.38)
    const water = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0xabcdd1, roughness: 0.16 }))
    turnedFixture(g, water, [[0.082, 0.301], [0, 0.301]], 0, -0.08, 1, 1.15)
    roundedFixture(g, porcelain, 0, 0.295, 0.59, 0.38, 0.19, 0.42, 0.035)
    roundedFixture(g, seat, 0, 0.295, 0.812, 0.395, 0.205, 0.035, 0.015)
    slab(g, mats.steel, 0.115, 0.192, 0.72, 0.075, 0.018, 0.025)
    for (const x of [-0.10, 0.10]) slab(g, mats.steel, x, 0.16, 0.433, 0.04, 0.055, 0.02)
    roundedFixture(g, mats.steel, -0.468, -0.12, 0.77, 0.035, 0.15, 0.14, 0.01)
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.11, 20), seat)
    roll.position.set(-0.415, -0.12, 0.77)
    g.add(roll)
    return placeLocal(g, mod)
  }
}
