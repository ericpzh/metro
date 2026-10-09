import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import { LIGHT_DEPTH, lightCeilingZ, lightOffset, lightSpec, type LightModule } from '../../../sim/lights.ts'

/** Flush ceiling housing and a downward-facing diffuser (§5.7). */
export class LightModel extends PieceBuilder {
  readonly kind = 'light'
  build(mod: LightModule): THREE.Group {
    const g = new THREE.Group()
    const diffuserMat = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: 0xfff8e8, emissive: 0xfff4d8, emissiveIntensity: 1.5, roughness: 0.4 }))
    const { width, depth } = lightSpec(mod)
    const offset = lightOffset(mod)
    const ceiling = lightCeilingZ(mod) - mod.z - 1
    // The diffuser fills the bottom centimetre. A full-depth steel body would
    // put its bottom face on the luminous face, making the two surfaces flicker.
    const diffuserDepth = 0.01
    const housingDepth = LIGHT_DEPTH - diffuserDepth
    if (mod.cfg.variant === 'rectangular') {
      slab(g, this.ctx.mats.steel, offset.x, offset.y, ceiling - housingDepth / 2, width, depth, housingDepth)
      slab(g, diffuserMat, offset.x, offset.y, ceiling - LIGHT_DEPTH + diffuserDepth / 2, width - 0.04, depth - 0.02, diffuserDepth)
    } else {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(width / 2, width / 2, housingDepth, 32), this.ctx.mats.steel)
      housing.rotation.x = Math.PI / 2
      housing.position.z = ceiling - housingDepth / 2
      g.add(housing)
      const diffuser = new THREE.Mesh(new THREE.CylinderGeometry(width / 2 - 0.02, width / 2 - 0.02, diffuserDepth, 32), diffuserMat)
      diffuser.rotation.x = Math.PI / 2
      diffuser.position.z = ceiling - LIGHT_DEPTH + diffuserDepth / 2
      g.add(diffuser)
    }
    return this.placeLocal(g, { ...mod, rot: 0 })
  }
}
