import * as THREE from 'three'
import { slab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { omitModelDetail, panelModelDetail, setModelDetail } from '../../modelDetail.ts'
export function officeChair(mats: ModelMaterials): THREE.Group {
 const g = new THREE.Group()
    // An open mesh chair with armrests, casters and a five-star base.
    const chairY = 0
    slab(g, mats.darkSteel, 0, chairY, 0.28, 0.055, 0.055, 0.39).name = 'chair-column'
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5
      const spoke = slab(g, mats.darkSteel, Math.sin(angle) * 0.095, chairY + Math.cos(angle) * 0.095, 0.085, 0.035, 0.22, 0.035)
      spoke.rotation.z = -angle
      spoke.name = 'chair-spoke'
      slab(g, mats.rubber, Math.sin(angle) * 0.195, chairY + Math.cos(angle) * 0.195, 0.035, 0.05, 0.05, 0.07).name = 'chair-caster'
    }
    slab(g, mats.rubber, 0, chairY, 0.455, 0.35, 0.33, 0.07).name = 'chair-seat'
    for (const x of [-0.17, 0.17]) {
      slab(g, mats.rubber, x, (chairY + 0.18), 0.73, 0.025, 0.026, 0.48)
      slab(g, mats.darkSteel, x, chairY, 0.555, 0.018, 0.025, 0.17)
      slab(g, mats.rubber, x, chairY, 0.635, 0.045, 0.22, 0.025).name = 'chair-armrest'
    }
    for (const z of [0.5, 0.96]) slab(g, mats.rubber, 0, (chairY + 0.18), z, 0.35, 0.03, 0.035)
    for (let i = 0; i < 10; i++) slab(g, mats.darkSteel, 0, (chairY + 0.18), 0.535 + i * 0.04, 0.32, 0.012, 0.018).name = 'chair-mesh'
    let back = false
    for (const mesh of g.children as THREE.Mesh[]) {
      if (mesh.name === 'chair-mesh' && !back) {
        const low = new THREE.BoxGeometry(0.32, 0.012, 0.378).translate(0, 0, 0.18)
        low.setIndex(Array.from(low.index!.array.slice(12, 24))); low.clearGroups()
        setModelDetail(mesh, low)
        back = true
      } else if (!['chair-column', 'chair-seat'].includes(mesh.name)) omitModelDetail(mesh)
      else if (mesh.name === 'keyboard') panelModelDetail(mesh, 'z')
    }
 return g
}
