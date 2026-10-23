import * as THREE from 'three'

/** Keep preview shader owners alive between targets; bounded to recent finishes. */
export class PreviewMaterialCache {
  private readonly materials = new Map<string, THREE.Material>()
  private readonly limit: number
  private readonly active = new Set<string>()
  private pinning = false
  constructor(limit = 16) { this.limit = limit }

  /** Start replacing one preview root. Never evict a material in its new draw. */
  begin(): void { this.active.clear(); this.pinning = true }

  get(base: THREE.Material, tint: THREE.Color, opacity: number, depthTest = base.depthTest): THREE.Material {
    const key = `${base.uuid}:${tint.getHex()}:${opacity}:${depthTest}`
    let material = this.materials.get(key)
    if (material) this.materials.delete(key)
    else material = base.clone()
    const clipChanged = (material.clippingPlanes?.length ?? 0) !== (base.clippingPlanes?.length ?? 0)
      || material.clipIntersection !== base.clipIntersection || material.clipShadows !== base.clipShadows
    material.copy(base)
    material.transparent = true
    material.opacity = opacity
    material.depthWrite = false
    material.depthTest = depthTest
    if (material.side !== THREE.FrontSide) material.side = THREE.DoubleSide
    const lit = material as THREE.MeshStandardMaterial
    if (lit.color) lit.color.lerp(tint, 0.72)
    material.clippingPlanes = base.clippingPlanes?.map(plane => plane.clone()) ?? null
    material.clipIntersection = base.clipIntersection
    material.clipShadows = base.clipShadows
    if (clipChanged) material.needsUpdate = true
    this.materials.set(key, material)
    if (this.pinning) this.active.add(key)
    this.trim()
    return material
  }

  /** After a root is cleared its materials become bounded dormant entries. */
  release(): void { this.active.clear(); this.pinning = false; this.trim() }

  private trim(): void {
    while (this.materials.size > this.limit) {
      const oldest = [...this.materials].find(([key]) => !this.active.has(key))
      if (!oldest) break
      this.materials.delete(oldest[0])
      oldest[1].dispose()
    }
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
    this.active.clear()
    this.pinning = false
  }
}
