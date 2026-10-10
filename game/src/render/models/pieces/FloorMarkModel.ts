import * as THREE from 'three'
import type { Module } from '../../../sim/types.ts'
import { floorDecorSpec, floorMarkLine } from '../../../sim/floorDecor.ts'
import { drawFloorMark } from '../../floorMarkArt.ts'
import { PieceBuilder, canvasTexture } from '../PieceBuilder.ts'

export class FloorMarkModel extends PieceBuilder {
  readonly kind = 'floor-mark'
  build(mod: Extract<Module, { type: 'floor-mark' }>): THREE.Group {
    const g = new THREE.Group()
    const { w, d } = floorDecorSpec(mod)
    const texture = canvasTexture(768, 512, (ctx) => drawFloorMark(ctx, mod.cfg.variant, floorMarkLine(mod, this.ctx.data?.lines ?? [])))
    const material = this.ownedMaterial(new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material)
    mesh.position.set((w - 1) / 2, (Math.ceil(d) - 1) / 2, 0.006)
    g.add(mesh)
    this.placeLocal(g, mod)
    g.position.x += mod.cfg.offset?.x ?? 0
    g.position.y += mod.cfg.offset?.y ?? 0
    return g
  }
}
