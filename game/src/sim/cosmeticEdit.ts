import type { StationData } from './types.ts'
import { finishDef, finishOf } from './finishes.ts'

/** §4.3: appearance may change without changing the walk graph. Fail closed for
 * metadata, topology, zones, tags and module changes, including future fields. */
export function isCosmeticStationEdit(before: StationData, after: StationData): boolean {
  if (before.cells.length !== after.cells.length) return false
  const { cells: _a, ...a } = before, { cells: _b, ...b } = after
  if (JSON.stringify(a) !== JSON.stringify(b)) return false
  for (let i = 0; i < before.cells.length; i++) {
    const old = before.cells[i], next = after.cells[i]
    if (old === next) continue
    const { finish: _oldFinish, ...oldCell } = old
    const { finish: _nextFinish, ...nextCell } = next
    if (JSON.stringify(oldCell) !== JSON.stringify(nextCell)) return false
    const oldTop = finishOf(old, 'top'), nextTop = finishOf(next, 'top')
    const oldDef = finishDef(oldTop), nextDef = finishDef(nextTop)
    if (oldDef.speed !== nextDef.speed || oldDef.cover !== nextDef.cover
      || (oldTop === 'floor.track') !== (nextTop === 'floor.track')) return false
  }
  return true
}
