import * as THREE from 'three'
import { setModelDetail, surfaceModelDetail } from '../../modelDetail.ts'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import { LIGHT_DEPTH, lightCeilingZ, lightOffset, lightSpec, type LightModule } from '../../../sim/lights.ts'
import { hangCeilingLocal } from '../../../sim/placement.ts'

/** Flush ceiling housing and a downward-facing diffuser (§5.7). */
export class LightModel extends PieceBuilder {
  readonly kind = 'light'
  build(mod: LightModule): THREE.Group {
    const g = new THREE.Group()
    const diffuserMat = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: 0xfff8e8, emissive: 0xfff4d8, emissiveIntensity: 1.5, roughness: 0.4, side: THREE.DoubleSide }))
    const { width, depth } = lightSpec(mod)
    const offset = lightOffset(mod)
    // The line the housing hangs from: the **top block** over its own cell (`hangCeilingLocal`),
    // else the real slab overhead — and with no slab to read (a ghost in an empty station) the
    // nominal storey line stands in. The 5 m grid line floated a 基准高度-1 station's lights a
    // metre below their ceiling.
    const ceiling = hangCeilingLocal(mod, this.ctx.data.cells, this.ctx.data.modules, lightCeilingZ(mod) - mod.z - 1)
    // The diffuser fills the bottom centimetre. A full-depth steel body would
    // put its bottom face on the luminous face, making the two surfaces flicker.
    const diffuserDepth = 0.01
    const housingDepth = LIGHT_DEPTH - diffuserDepth
    if (mod.cfg.variant === 'rectangular') {
      surfaceModelDetail(slab(g, this.ctx.mats.steel, offset.x, offset.y, ceiling - housingDepth / 2, width, depth, housingDepth), 'z')
      surfaceModelDetail(slab(g, diffuserMat, offset.x, offset.y, ceiling - LIGHT_DEPTH + diffuserDepth / 2, width - 0.04, depth - 0.02, diffuserDepth), 'z', -1)
    } else {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(width / 2, width / 2, housingDepth, 32), this.ctx.mats.steel)
      housing.rotation.x = Math.PI / 2
      setModelDetail(housing, new THREE.CylinderGeometry(width / 2, width / 2, housingDepth, 6, 1, true))
      housing.position.z = ceiling - housingDepth / 2
      g.add(housing)
      const diffuser = new THREE.Mesh(new THREE.CylinderGeometry(width / 2 - 0.02, width / 2 - 0.02, diffuserDepth, 32), diffuserMat)
      diffuser.rotation.x = Math.PI / 2
      setModelDetail(diffuser, new THREE.CircleGeometry(width / 2 - .02, 6).rotateX(Math.PI / 2).translate(0, -diffuserDepth / 2, 0))
      diffuser.position.z = ceiling - LIGHT_DEPTH + diffuserDepth / 2
      g.add(diffuser)
    }
    return this.placeLocal(g, { ...mod, rot: 0 })
  }
}
