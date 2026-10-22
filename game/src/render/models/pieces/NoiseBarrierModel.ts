import * as THREE from 'three'
import { tubeModelDetail } from '../../modelDetail.ts'
import { PieceBuilder } from '../PieceBuilder.ts'
import { buildBridgeNoiseBarrier } from './BridgeNoiseBarrier.ts'
import { buildBridgeRailing } from './BridgeRailing.ts'
import { bridgeBarrierTop } from '../../../sim/structures.ts'
import { noiseBarrierVariant, noiseBarrierOffset } from '../../../sim/noiseBarriers.ts'
import type { Module } from '../../../sim/types.ts'

/** A ground-standing metre of the bridge's barrier, using the same geometry. */
export class NoiseBarrierModel extends PieceBuilder {
  readonly kind = 'fence'
  build(mod: Extract<Module, { type: 'fence' }>): THREE.Group {
    const g = new THREE.Group()
    const variant = noiseBarrierVariant(mod) ?? 'sound-barrier'
    const base = variant === 'bridge-railing' ? 0.55 : 0.5
    if (variant === 'bridge-railing') buildBridgeRailing(g, this.ctx.mats, 1, 0)
    else buildBridgeNoiseBarrier(g, this.ctx.mats, 1, 0, bridgeBarrierTop(variant), false)
    g.traverse(mesh => { if (mesh instanceof THREE.Mesh && mesh.name === 'bridge-barrier-post') tubeModelDetail(mesh) })
    const [dx, dy] = noiseBarrierOffset(mod.rot)
    g.position.set(mod.x + 0.5 + dx, mod.y + 0.5 + dy, mod.z + 1 - base)
    g.rotation.z = (mod.rot ?? 0) * Math.PI / 2
    return g
  }
}
