import type * as THREE from 'three'

/** Two fixed decal footprints share one texture; city changes repaint without rebuilding trains. */
export function trainMarkAtlasUV(mesh: THREE.Mesh, beijing = false): void {
  for (const geometry of [mesh.geometry, mesh.userData.lowDetailGeometry as THREE.BufferGeometry | undefined]) {
    if (!geometry) continue
    const uv = geometry.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + (beijing ? 1 : 0)) / 2)
    uv.needsUpdate = true
  }
}
