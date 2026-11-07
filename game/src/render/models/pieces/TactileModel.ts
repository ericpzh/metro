import * as THREE from 'three'
import { modelNeighbours } from '../../modelNeighbours.ts'
import type { Module } from '../../../sim/types.ts'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import { tactileArms } from '../../../sim/floorDecor.ts'
import { omitModelDetail, surfaceModelDetail } from '../../modelDetail.ts'

/** One instanced dot field, shared by the square junction and the full-width strip. */
function dotField(parent: THREE.Object3D, material: THREE.Material, positions: Array<[number, number]>): void {
  const dots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.025, 0.006, 8), material, positions.length)
  const pose = new THREE.Object3D()
  pose.rotation.x = Math.PI / 2
  for (const [i, [x, y]] of positions.entries()) {
    pose.position.set(x, y, 0.009)
    pose.updateMatrix()
    dots.setMatrixAt(i, pose.matrix)
  }
  dots.instanceMatrix.needsUpdate = true
  parent.add(dots)
  omitModelDetail(dots)
}

/** Thin 盲道 tiles in dark grey-green, with lengthwise ribs or a warning dot field (§9.5). */
export class TactileModel extends PieceBuilder {
  readonly kind = 'tactile'
  build(mod: Extract<Module, { type: 'tactile' }>): THREE.Group {
    const g = new THREE.Group()
    const tactile = this.ctx.mats.tactile ?? this.ctx.mats.psu
    if (mod.cfg.variant === 'guide') {
      surfaceModelDetail(slab(g, tactile, 0, 0, 0.003, 1, 0.45, 0.006), 'z', 1)
      for (const y of [-0.15, -0.05, 0.05, 0.15]) surfaceModelDetail(slab(g, tactile, 0, y, 0.009, 0.9, 0.028, 0.006), 'z', 1)
    } else {
      const arms = tactileArms(mod, modelNeighbours(this.ctx, 'tactile'))
      const strip = mod.cfg.variant === 'warning-strip'
      // A full one-metre tile top meets its run neighbours at both cell ends;
      // only a crosswise connection grows an arm to the adjoining band.
      slab(g, tactile, 0, 0, 0.003, strip ? 1 : 0.45, 0.45, 0.006)
      for (const [dx, dy] of arms) slab(g, tactile, dx * 0.3625, dy * 0.3625, 0.003, dx ? 0.275 : 0.45, dy ? 0.275 : 0.45, 0.006)
      const positions: Array<[number, number]> = []
      if (strip) {
        for (let x = -0.44; x < 0.45; x += 0.08) for (const y of [-0.16, -0.08, 0, 0.08, 0.16]) positions.push([x, y])
        for (const [dx, dy] of arms) for (const across of [-0.16, -0.08, 0, 0.08, 0.16]) for (const along of [0.24, 0.32, 0.4]) {
          positions.push(dx ? [dx * along, across] : [across, dy * along])
        }
      } else {
        for (let x = -0.44; x < 0.45; x += 0.08) for (let y = -0.44; y < 0.45; y += 0.08) {
          if ((Math.abs(x) < 0.2 && Math.abs(y) < 0.2) || arms.some(([dx, dy]) => dx ? x * dx > 0.2 && Math.abs(y) < 0.2 : y * dy > 0.2 && Math.abs(x) < 0.2)) positions.push([x, y])
        }
      }
      dotField(g, tactile, positions)
    }
    return this.placeLocal(g, mod)
  }
}
