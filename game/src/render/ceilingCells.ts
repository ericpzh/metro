import { storeyBand } from '../sim/constants.ts'
import { packKey, shapeOf, type Cell } from '../sim/types.ts'

/** Explicit plates and untagged, single-course slabs over usable room space.
 * Classification is view-only: never retag the document or change walkability.
 */
export function ceilingCells(cells: readonly Cell[], base: number, height: number): Set<number> {
  const solid = new Map(cells.filter(c => c.fill === 'solid').map(c => [packKey(c.x, c.y, c.z), c]))
  const result = new Set<number>()
  for (const c of cells) {
    if (c.fill !== 'solid') continue
    const key = packKey(c.x, c.y, c.z)
    const floorZ = storeyBand(c.z, base, height)
    // A slab near the editing floor is never an overhead ceiling for that floor,
    // even if an older save or a construction operation gave it a ceiling tag.
    // From below, the ordinary upper-storey slice still hides it.
    // Raised platform floors (Tanwei's z=11 platforms in the 10 m storey)
    // must get the same protection as a slab exactly on the editing plane.
    if (c.z - floorZ < 3) continue
    if (c.tags?.includes('suspended-ceiling')) {
      result.add(key)
      continue
    }
    // Ramp carving tags the slab over its opening, including the upper floor's
    // own course. That slab is a ceiling from below, but must remain visible
    // when editing its own floor. The ordinary upper-storey slice handles it.
    if (c.tags?.includes('opening-ceiling')) {
      result.add(key)
      continue
    }
    // Keep editing-grid floors, wall tops, shaped blocks and stacked solids.
    if (shapeOf(c) || c.tags?.includes('wall') || solid.has(packKey(c.x, c.y, c.z - 1)) ||
        solid.has(packKey(c.x, c.y, c.z + 1))) continue
    const floor = solid.get(packKey(c.x, c.y, floorZ))
    if (!floor || shapeOf(floor) || floor.tags?.some(t => t === 'suspended-ceiling' || t === 'opening-ceiling')) continue
    let clear = true
    for (let z = floorZ + 1; z < c.z; z++) {
      if (solid.has(packKey(c.x, c.y, z))) { clear = false; break }
    }
    if (clear && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      solid.has(packKey(c.x + dx, c.y + dy, c.z)))) result.add(key)
  }
  return result
}

