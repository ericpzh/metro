// The road brush asks the same placement verdict during hover, drag and release.
// Cache immutable document inputs so each update walks the road, not road × station.
import type { Cell, Module } from './types.ts'
import { packKey } from './types.ts'
import { rampOpeningsInWindow } from './openings.ts'
import { exitFootprintCells, isExitHeadHouse } from './exits.ts'
import { trackCells } from './track.ts'
import type { Road } from './roads.ts'

interface RoadPlacementIndex {
  solid: Set<number>
  holes: Set<number>
  exits: Set<number>
  track: Set<number>
  trackModules: Set<number>
}
const cache = new WeakMap<readonly Cell[], WeakMap<readonly Module[], RoadPlacementIndex>>()
function roadPlacementIndex(cells: readonly Cell[], modules: readonly Module[]): RoadPlacementIndex {
  let byModules = cache.get(cells)
  if (!byModules) cache.set(cells, byModules = new WeakMap())
  const held = byModules.get(modules)
  if (held) return held
  const index: RoadPlacementIndex = { solid: new Set(), holes: new Set(), exits: new Set(), track: new Set(), trackModules: new Set() }
  const firstCell = new Set<number>()
  for (const c of cells) {
    const key = packKey(c.x, c.y, c.z)
    if (c.fill === 'solid') {
      index.solid.add(key)
    } else if (c.z === 0) index.holes.add(key)
    if (!firstCell.has(key) && c.fill === 'solid' && c.finish?.top === 'floor.track') index.track.add(key)
    firstCell.add(key)
  }
  for (const key of rampOpeningsInWindow(modules, 0, { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity })) {
    const [x, y] = key.split(',').map(Number)
    index.holes.add(packKey(x, y, 0))
  }
  for (const m of modules) {
    if (m.type === 'exit' && isExitHeadHouse(m)) for (const [x, y, z] of exitFootprintCells(m)) index.exits.add(packKey(x, y, z))
    if (m.type === 'track') for (const [x, y, z] of trackCells(m)) {
      const key = packKey(x, y, z); index.track.add(key); index.trackModules.add(key)
    }
  }
  byModules.set(modules, index)
  return index
}
/** §4.1 / §9.5: explicit floor or exit floor wins over a derived ground hole. */
export function roadSurfaceReason(cells: readonly Cell[], modules: readonly Module[], r: Road): '' | 'road-ground' | 'track' | 'occupied' {
  if (r.z < 0) return 'road-ground'
  const index = roadPlacementIndex(cells, modules)
  // Match placementOnTrack's existing anchor rule for a road module.
  const anchor = packKey(r.x, r.y, r.z)
  const track = index.track.has(anchor) || index.trackModules.has(packKey(r.x, r.y, r.z + 1))
  let occupied = false
  for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.d; y++) {
    const key = packKey(x, y, r.z)
    if (!index.solid.has(key) && !index.exits.has(key) && (r.z !== 0 || index.holes.has(key))) return 'road-ground'
    for (let dz = 1; dz <= 4; dz++) occupied ||= index.solid.has(packKey(x, y, r.z + dz))
  }
  return track ? 'track' : occupied ? 'occupied' : ''
}
