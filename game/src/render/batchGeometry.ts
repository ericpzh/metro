import * as THREE from 'three'

/** Bake reflections with matching winding, so FrontSide meshes keep their outside. */
export function bakedGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  geometry.clearGroups()
  geometry.applyMatrix4(matrix)
  if (matrix.determinant() < 0) {
    for (const attribute of Object.values(geometry.attributes)) {
      const a = attribute as THREE.BufferAttribute
      for (let i = 0; i < a.count; i += 3) for (let j = 0; j < a.itemSize; j++) {
        const value = a.getComponent(i + 1, j)
        a.setComponent(i + 1, j, a.getComponent(i + 2, j))
        a.setComponent(i + 2, j, value)
      }
    }
  }
  return geometry
}

export function attributeKey(geometry: THREE.BufferGeometry): string {
  return Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join('|')
}

/** Content identity, not allocation identity: procedural copies can instance. */
export function geometryKey(geometry: THREE.BufferGeometry): string {
  let hash = 2166136261
  for (const a of [...Object.values(geometry.attributes), ...(geometry.index ? [geometry.index] : [])]) {
    const bytes = new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength)
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619)
  }
  return `${attributeKey(geometry)}|${geometry.getAttribute('position').count}|${geometry.index?.count ?? 0}|${hash >>> 0}`
}

export function equalGeometry(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  if (a === b) return true
  if (geometryKey(a) !== geometryKey(b)) return false
  const aa = [...Object.values(a.attributes), ...(a.index ? [a.index] : [])]
  const bb = [...Object.values(b.attributes), ...(b.index ? [b.index] : [])]
  for (let i = 0; i < aa.length; i++) {
    if (aa[i].array.length !== bb[i].array.length) return false
    for (let j = 0; j < aa[i].array.length; j++) if (aa[i].array[j] !== bb[i].array[j]) return false
  }
  return true
}

// Layer 31 keeps original surfaces available to the module raycaster while the
// normal cameras draw only the batches. Roots, bounds and rig references survive.
export const BATCH_SOURCE_LAYER = 31
