import type * as THREE from 'three'
import type { StationData } from '../sim/types.ts'

type Update = (data: StationData) => void

/** Artwork is mutable ink on immutable geometry (§5.4). Bind the original
 * resources before batching so later edits preserve their geometry and UVs. */
export function bindArtwork(group: THREE.Object3D, update: Update): void {
  const bindings = (group.userData.artworkBindings ??= []) as Update[]
  bindings.push(update)
}

export function bindArtworkTexture(group: THREE.Object3D, texture: THREE.Texture, draw: (g: CanvasRenderingContext2D, data: StationData) => void): void {
  bindArtwork(group, data => {
    const canvas = texture.image as HTMLCanvasElement
    const g = canvas.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, canvas.width, canvas.height)
    draw(g, data)
    texture.needsUpdate = true
  })
}

export function prepareArtwork(group: THREE.Object3D): void {
  const updates: Update[] = []
  group.traverse(child => updates.push(...(child.userData.artworkBindings ?? []) as Update[]))
  group.userData.preparedArtwork = updates
}

export function repaintArtwork(group: THREE.Object3D, data: StationData): boolean {
  const updates = group.userData.preparedArtwork as Update[] | undefined
  if (!updates?.length) return false
  for (const update of updates) update(data)
  return true
}
