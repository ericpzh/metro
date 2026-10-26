import type { StationData } from '../sim/types.ts'
import { sameModuleMetadata } from './moduleDependencies.ts'

/**
 * A top-face paint edit changes chunks, but not equipment (§4.3). Stairs inherit
 * their starting floor's finish, so those cells are explicit exceptions. All
 * structural, side-finish, module and station metadata edits take the full build.
 * RoomModel reads side finishes; lifts/hangers/ramp joins read cell geometry.
 */
export function canRetainPaintedModules(before: StationData, after: StationData): boolean {
  if (before.cells.length !== after.cells.length) return false
  if (!sameModuleMetadata(before, after)) return false
  const stairStarts = new Set<string>()
  for (const mod of after.modules) {
    if (mod.type !== 'stair') continue
    stairStarts.add(`${mod.x},${mod.y},${mod.z}`)
    if (mod.from) stairStarts.add(`${mod.from.x},${mod.from.y},${mod.from.z}`)
  }
  for (let i = 0; i < before.cells.length; i++) {
    const old = before.cells[i], next = after.cells[i]
    if (old === next) continue
    const { finish: oldFinish, ...oldCell } = old
    const { finish: nextFinish, ...nextCell } = next
    if (JSON.stringify(oldCell) !== JSON.stringify(nextCell)) return false
    const { top: oldTop, ...oldFaces } = oldFinish ?? {}
    const { top: nextTop, ...nextFaces } = nextFinish ?? {}
    if (JSON.stringify(oldFaces) !== JSON.stringify(nextFaces)) return false
    if (oldTop !== nextTop && stairStarts.has(`${next.x},${next.y},${next.z}`)) return false
  }
  return true
}
