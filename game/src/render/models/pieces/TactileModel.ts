import * as THREE from 'three'
import type { Module } from '../../../sim/types.ts'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import { tactileArms } from '../../../sim/floorDecor.ts'

/** Thin 盲道 tiles in dark grey-green, with lengthwise ribs or a warning dot field (§9.5). */
export class TactileModel extends PieceBuilder {
  readonly kind = 'tactile'
  build(mod: Extract<Module, { type: 'tactile' }>): THREE.Group {
    const g = new THREE.Group()
    const tactile = this.ctx.mats.tactile ?? this.ctx.mats.psu
    if (mod.cfg.variant === 'guide') {
      slab(g, tactile, 0, 0, 0.003, 1, 0.45, 0.006)
      for (const y of [-0.15, -0.05, 0.05, 0.15]) slab(g, tactile, 0, y, 0.009, 0.9, 0.028, 0.006)
    } else {
      const arms = tactileArms(mod, this.ctx.data?.modules ?? [])
      slab(g, tactile, 0, 0, 0.003, 0.45, 0.45, 0.006)
      for (const [dx, dy] of arms) slab(g, tactile, dx * 0.3625, dy * 0.3625, 0.003, dx ? 0.275 : 0.45, dy ? 0.275 : 0.45, 0.006)
      const positions: Array<[number, number]> = []
      for (let x = -0.44; x < 0.45; x += 0.08) for (let y = -0.44; y < 0.45; y += 0.08) {
        if ((Math.abs(x) < 0.2 && Math.abs(y) < 0.2) || arms.some(([dx, dy]) => dx ? x * dx > 0.2 && Math.abs(y) < 0.2 : y * dy > 0.2 && Math.abs(x) < 0.2)) positions.push([x, y])
      }
      const dots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.025, 0.006, 8), tactile, positions.length)
      const pose = new THREE.Object3D()
      pose.rotation.x = Math.PI / 2
      for (const [i, [x, y]] of positions.entries()) {
        pose.position.set(x, y, 0.009)
        pose.updateMatrix()
        dots.setMatrixAt(i, pose.matrix)
      }
      dots.instanceMatrix.needsUpdate = true
      g.add(dots)
    }
    return this.placeLocal(g, mod)
  }
}
