import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Module } from '../../../sim/types.ts'
import { outdoorSurfaceHidden } from '../../../sim/placement.ts'
import { OUTDOOR_SURFACE_HEIGHT, OUTDOOR_TILE_DETAIL_PX } from '../../../sim/constants.ts'
import { PieceBuilder, placeLocal } from '../PieceBuilder.ts'

type Surface = Extract<Module, { type: 'sidewalk' | 'lawn' }>
const geometryCache = new Map<Surface['type'], THREE.BufferGeometry>()
const coarseCache = new Map<Surface['type'], THREE.BufferGeometry>()

/** A subpixel paver seam needs no box faces; keep the same raised tile envelope. */
export function outdoorSurfaceCoarseGeometry(type: Surface['type']): THREE.BufferGeometry {
  const cached = coarseCache.get(type)
  if (cached) return cached
  const geometry = new THREE.BoxGeometry(1, 1, OUTDOOR_SURFACE_HEIGHT)
  geometry.translate(0, 0, OUTDOOR_SURFACE_HEIGHT / 2)
  const normal = geometry.getAttribute('normal')
  const top = new THREE.Color(type === 'lawn' ? 0x70964a : 0xaeb5b7)
  const side = new THREE.Color(type === 'lawn' ? 0x6a6046 : 0x8f9699)
  const colours = new Float32Array(normal.count * 3)
  for (let i = 0; i < normal.count; i++) (normal.getZ(i) > .5 ? top : side).toArray(colours, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  coarseCache.set(type, geometry)
  return geometry
}
/** Two immutable meshes, shared by every placed tile and preview. §4.3. */
export function outdoorSurfaceGeometry(type: Surface['type']): THREE.BufferGeometry {
  const held = geometryCache.get(type)
  if (held) return held
  const h = OUTDOOR_SURFACE_HEIGHT, parts: THREE.BufferGeometry[] = []
  const slab = (colour: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz)
    geometry.translate(x, y, z)
    const color = new THREE.Color(colour), values = new Float32Array(geometry.getAttribute('position').count * 3)
    for (let i = 0; i < values.length; i += 3) { values[i] = color.r; values[i + 1] = color.g; values[i + 2] = color.b }
    geometry.setAttribute('color', new THREE.BufferAttribute(values, 3)); parts.push(geometry)
  }
  slab(type === 'lawn' ? 0x6a6046 : 0x8f9699, 0, 0, (h - .02) / 2, 1, 1, h - .02)
  if (type === 'sidewalk') {
    const colours = [0xaeb5b7, 0xb8bec0, 0xa4adaf]
    for (let row = 0; row < 4; row++) {
      const cuts = row % 2 ? [-.5, -.25, .25, .5] : [-.5, 0, .5]
      for (let i = 0; i < cuts.length - 1; i++) {
        const left = cuts[i], right = cuts[i + 1]
        slab(colours[(row + i) % colours.length], (left + right) / 2, -.375 + row * .25, h - .009, right - left - .008, .242, .018)
      }
    }
  } else {
    const colours = [0x6b9343, 0x70994a, 0x769b4c]
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) slab(colours[(x * 7 + y * 3) % 3], -.375 + x * .25, -.375 + y * .25, h - .01, .25, .25, .02)
  }
  const geometry = mergeGeometries(parts)!
  for (const part of parts) part.dispose()
  geometryCache.set(type, geometry)
  return geometry
}

export class OutdoorSurfaceModel extends PieceBuilder {
  readonly kind = 'sidewalk'
  build(mod: Surface): THREE.Group {
    const group = new THREE.Group()
    // Re-evaluate saved tiles too: placing an exit after paving must expose its wellway.
    if (outdoorSurfaceHidden(this.ctx.data.cells, this.ctx.data.modules, mod)) return placeLocal(group, mod)
    const material = this.ctx.mats.outdoorSurface ?? this.ownedMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }))
    const mesh = new THREE.Mesh(outdoorSurfaceGeometry(mod.type), material)
    mesh.name = 'raised-surface'; mesh.userData.sharedGeometry = true
    mesh.userData.staticInstances = true
    mesh.userData.staticDetailGeometry = outdoorSurfaceCoarseGeometry(mod.type)
    mesh.userData.staticDetailSize = 1
    mesh.userData.staticDetailPixels = OUTDOOR_TILE_DETAIL_PX
    group.add(mesh)
    return placeLocal(group, mod)
  }
}
