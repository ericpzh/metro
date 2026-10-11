import { t } from '../../../sim/i18n.ts'
import * as THREE from 'three'
import { PieceBuilder, slab, plate, canvasTexture } from '../PieceBuilder.ts'
import { exitSpan } from '../../../sim/exits.ts'
import { exitHeaderCanvas } from './ExitModel.ts'
import type { Module } from '../../../sim/types.ts'
export class DoorwayExitModel extends PieceBuilder {
  readonly kind = 'exit'
  build(mod: Extract<Module, { type: 'exit' }>): THREE.Group {
    const g = new THREE.Group()
    const { centre, half } = exitSpan(mod)
    const width = half * 2
    // 地面 X向 is a wall-fixed exit panel: the anchor's −y face sits flush
    // against a one-metre block. The old floor feet made it read as a totem.
    slab(g, this.ctx.mats.darkSteel, centre, -0.475, 0.5, width, 0.05, 0.78)
    slab(g, this.ctx.mats.exitRed, centre, -0.441, 0.5, width - 0.06, 0.02, 0.68)
    // Keep the header's pixel density constant as the bay count grows. The
    // artwork's text stays the same physical size; only the gaps between the
    // brand, station name and exit identifier get wider.
    const headerWidth = Math.round(512 * (width - 0.12) / 2.88)
    const map = canvasTexture(headerWidth, 96, (c) => c.drawImage(
      exitHeaderCanvas(this.ctx.data.name || t('metro'), mod.cfg.name, this.ctx.data.nameEn, headerWidth),
      0, 0,
    ))
    const mat = this.ownedMaterial(new THREE.MeshBasicMaterial({ map }))
    plate(g, mat, width - 0.12, 0.48, centre, -0.428, 0.5, Math.PI)
    this.placeLocal(g, mod)
    // The logical exit remains on the floor storey; only the sign follows the
    // exact backing block course the player clicked.
    g.position.z += (mod.cfg.mountZ ?? mod.z + 1) - (mod.z + 1)
    return g
  }
}
