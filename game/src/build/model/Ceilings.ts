// Suspended ceilings use ordinary editable blocks in the service metre.
import type { StationState } from './State.ts'
import { addCells, cellKey } from './Cells.ts'
import { isCeilingHung } from '../../sim/placement.ts'
import { storeyBand } from '../../sim/constants.ts'
export const SUSPENDED_CEILING = 'suspended-ceiling'

/** The normal placement preview and release both lower existing hung decor to the new slab. */
export function prepareSuspendedCeiling(state: StationState, coordinates: Array<[number, number, number]>): StationState {
  const planes = new Map<string, number[]>()
  for (const [x,y,z] of coordinates) {
    const key = `${x},${y}`
    const levels = planes.get(key) ?? []
    levels.push(z)
    planes.set(key, levels)
  }
  const modules = state.modules.map(m => {
    if (!isCeilingHung(m)) return m
    const band = storeyBand(m.z,state.levelBase,state.storeyHeight)
    const ceiling = planes.get(`${m.x},${m.y}`)?.find(z => storeyBand(z,state.levelBase,state.storeyHeight) === band)
    if (ceiling === undefined) return m
    return { ...m, z: ceiling - 1, ceilingAnchored: true }
  })
  return { ...state, modules }
}

export function addSuspendedCeiling(state: StationState, coordinates: Array<[number, number, number]>) {
  const prepared = prepareSuspendedCeiling(state, coordinates)
  const existing = new Set(state.cells.filter(c => c.fill === 'solid').map(c => cellKey(c.x,c.y,c.z)))
  const result = addCells(state.cells, coordinates, prepared.modules)
  if (!result.changed) return { state, changed: 0, blocked: result.blocked }
  const cells = result.cells.map(c => c.fill !== 'solid' || existing.has(cellKey(c.x,c.y,c.z)) ? c : {
    ...c, tags: [...(c.tags ?? []), SUSPENDED_CEILING],
    finish: { top: 'ceil.baffle', bottom: 'ceil.baffle', n: 'ceil.baffle', s: 'ceil.baffle', e: 'ceil.baffle', w: 'ceil.baffle' },
  })
  const solid = new Set(cells.filter(c => c.fill === 'solid').map(c => cellKey(c.x,c.y,c.z)))
  const modules = prepared.modules.map((m,i) => m !== state.modules[i] && !solid.has(cellKey(m.x,m.y,m.z+1)) ? state.modules[i] : m)
  return { state: { ...state, cells, modules }, changed: result.changed, blocked: result.blocked }
}
