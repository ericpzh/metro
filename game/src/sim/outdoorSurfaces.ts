import type { Module } from './types.ts'

export const isOutdoorSurface = (m: { type: string }): boolean => m.type === 'sidewalk' || m.type === 'lawn'
export const surfaceKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

const cache = new WeakMap<readonly Module[], { tiles: Map<string, Module>; roads: Extract<Module, { type: 'road' }>[] }>()
/** §4.3: the immutable document owns one support/occupancy lookup for the whole gesture. */
export function outdoorSurfaceIndex(modules: readonly Module[]) {
  let index = cache.get(modules)
  if (!index) {
    index = { tiles: new Map(), roads: [] }
    for (const mod of modules) {
      if (isOutdoorSurface(mod)) index.tiles.set(surfaceKey(mod.x, mod.y, mod.z), mod)
      if (mod.type === 'road') index.roads.push(mod)
    }
    cache.set(modules, index)
  }
  return index
}
