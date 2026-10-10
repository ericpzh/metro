// Whether the placement tool can resolve support from a wall/slab when the
// pointer ray itself is over air rather than a solid floor face.
import { isCeilingHung } from '../../sim/placement.ts'
import { isWallMountedType } from '../store/catalog.ts'

export function canPlaceWithoutFloorHit(type: string): boolean {
  return isWallMountedType(type) || isCeilingHung({ type })
}
