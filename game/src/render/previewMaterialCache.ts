import * as THREE from 'three'

/** Keep preview shader owners alive between targets; bounded to recent finishes. */
export class PreviewMaterialCache {
  private readonly materials = new Map<string, THREE.Material>()
  private readonly limit: number
  constructor(limit = 16) { this.limit = limit }

  get(base: THREE.Material, tint: THREE.Color, opacity: number): THREE.Material {
    const key = `${base.uuid}:${tint.getHex()}:${opacity}`
    let material = this.materials.get(key)
    if (material) this.materials.delete(key)
    else {
      material = base.clone()
      material.transparent = true
      material.opacity = opacity
      material.depthWrite = false
      if (material.side !== THREE.FrontSide) material.side = THREE.DoubleSide
      const lit = material as THREE.MeshStandardMaterial
      if (lit.color) lit.color = lit.color.clone().lerp(tint, 0.72)
    }
    const clipChanged = (material.clippingPlanes?.length ?? 0) !== (base.clippingPlanes?.length ?? 0)
      || material.clipIntersection !== base.clipIntersection || material.clipShadows !== base.clipShadows
    material.clippingPlanes = base.clippingPlanes?.map(plane => plane.clone()) ?? null
    material.clipIntersection = base.clipIntersection
    material.clipShadows = base.clipShadows
    if (clipChanged) material.needsUpdate = true
    this.materials.set(key, material)
    while (this.materials.size > this.limit) {
      const oldest = this.materials.entries().next().value!
      this.materials.delete(oldest[0])
      oldest[1].dispose()
    }
    return material
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }
}
