import type { Cell, Module } from './types.ts'
import { blockedCellsByLevel, trackBedKeys } from './placement.ts'
import { rampOpeningsInWindow } from './openings.ts'
import { exitFootprintCells, isExitHeadHouse } from './exits.ts'
import { trackCells } from './track.ts'

export interface BlockIndex {
  (z: number): Set<string>
  track: Set<string>
  opening: (x: number, y: number, z: number) => boolean
  ground: (x: number, y: number, z: number) => boolean
  solid: Set<string>
}

const cache = new WeakMap<readonly Cell[], WeakMap<readonly Module[], BlockIndex>>()

/** Immutable document arrays own the index; a new edit invalidates it naturally.
 * §5: enumerate each ramp's own footprint, never scan all modules per candidate. */
export function blockIndex(cells: readonly Cell[], modules: readonly Module[]): BlockIndex {
  let byModules = cache.get(cells)
  if (!byModules) cache.set(cells, byModules = new WeakMap())
  const held = byModules.get(modules)
  if (held) return held
  const index = blockedCellsByLevel(modules) as BlockIndex
  index.track = trackBedKeys(cells, modules)
  index.solid = new Set(cells.filter(c => c.fill === 'solid').map(c => `${c.x},${c.y},${c.z}`))
  const voidGround = new Set(cells.filter(c => c.z === 0 && c.fill !== 'solid').map(c => `${c.x},${c.y}`))
  const exits = new Set<string>()
  const trackGround = new Set<string>()
  for (const mod of modules) if (mod.type === 'track' && mod.z === 0 && !mod.cfg.tunnel && !mod.cfg.bridge) {
    for (const [x, y] of trackCells(mod)) trackGround.add(`${x},${y}`)
  }
  for (const mod of modules) if (mod.type === 'exit' && isExitHeadHouse(mod)) {
    for (const [x, y, z] of exitFootprintCells(mod)) exits.add(`${x},${y},${z}`)
  }
  const openings = new Map<number, Set<string>>()
  index.opening = (x, y, z) => {
    if (exits.has(`${x},${y},${z}`)) return true
    let at = openings.get(z)
    if (!at) {
      at = rampOpeningsInWindow(modules, z, { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity })
      openings.set(z, at)
    }
    return at.has(`${x},${y}`)
  }
  index.ground = (x, y, z) => z === 0 && !voidGround.has(`${x},${y}`) && !trackGround.has(`${x},${y}`) && !index.opening(x, y, z)
  byModules.set(modules, index)
  return index
}
