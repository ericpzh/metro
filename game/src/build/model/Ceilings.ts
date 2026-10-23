// Suspended ceilings use ordinary editable blocks in the service metre.
import type { StationState } from './State.ts'
import { addCells, cellKey } from './Cells.ts'
export const SUSPENDED_CEILING = 'suspended-ceiling'

export function addSuspendedCeiling(state: StationState, coordinates: Array<[number, number, number]>) {
  const existing = new Set(state.cells.filter(c => c.fill === 'solid').map(c => cellKey(c.x,c.y,c.z)))
  const result = addCells(state.cells, coordinates, state.modules)
  if (!result.changed) return { state, changed: 0, blocked: result.blocked }
  const cells = result.cells.map(c => c.fill !== 'solid' || existing.has(cellKey(c.x,c.y,c.z)) ? c : {
    ...c, tags: [...(c.tags ?? []), SUSPENDED_CEILING],
    finish: { top: 'ceil.baffle', bottom: 'ceil.baffle', n: 'ceil.baffle', s: 'ceil.baffle', e: 'ceil.baffle', w: 'ceil.baffle' },
  })
  return { state: { ...state, cells }, changed: result.changed, blocked: result.blocked }
}
