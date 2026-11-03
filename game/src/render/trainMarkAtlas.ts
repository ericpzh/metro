import type * as THREE from 'three'

/** Fixed city decal footprints share one texture; switches retain all train geometry. */
export function trainMarkAtlasUV(mesh: THREE.Mesh, slot: boolean | 'chengdu' = false): void {
  for (const geometry of [mesh.geometry, mesh.userData.lowDetailGeometry as THREE.BufferGeometry | undefined]) {
    if (!geometry) continue
    const uv = geometry.getAttribute('uv')
    const offset = slot === 'chengdu' ? 2 : slot ? 1 : 0
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + offset) / 3)
    uv.needsUpdate = true
  }
}
