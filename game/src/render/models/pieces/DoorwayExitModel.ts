import * as THREE from 'three'
import { PieceBuilder, slab, plate, canvasTexture } from '../PieceBuilder.ts'
import { exitSpan, exitDoorwayOffset } from '../../../sim/exits.ts'
import { exitHeaderCanvas } from './ExitModel.ts'
import type { Module } from '../../../sim/types.ts'
export class DoorwayExitModel extends PieceBuilder {
  readonly kind = 'exit'
  build(mod: Extract<Module, { type: 'exit' }>): THREE.Group {
    const g = new THREE.Group()
    const { centre, half } = exitSpan(mod)
    const width = half * 2
    for (const side of [-1, 1]) {
      const x = centre + side * (half - 0.12)
      slab(g, this.ctx.mats.exitRed, x, 0, 1.4, 0.24, 0.28, 2.8)
      slab(g, this.ctx.mats.steel, x, 0, 0.08, 0.24, 0.4, 0.16)
    }
    slab(g, this.ctx.mats.exitRed, centre, 0, 2.86, width, 0.28, 0.24)
    slab(g, this.ctx.mats.darkSteel, centre, 0, 3.25, width, 0.16, 0.58)
    const map = canvasTexture(512, 96, (c) => c.drawImage(exitHeaderCanvas(this.ctx.data.name || '地铁', mod.cfg.name, this.ctx.data.nameEn), 0, 0))
    const mat = this.ownedMaterial(new THREE.MeshBasicMaterial({ map }))
    plate(g, mat, width - 0.16, 0.48, centre, 0.09, 3.25, Math.PI)
    plate(g, mat, width - 0.16, 0.48, centre, -0.09, 3.25, 0)
    this.placeLocal(g, mod)
    const [dx, dy] = exitDoorwayOffset(mod.rot)
    g.position.x += dx
    g.position.y += dy
    return g
  }
}
