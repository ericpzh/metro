import type { Module, Vec3i } from '../../sim/types.ts'
import { outdoorSurfaceIndex, surfaceKey } from '../../sim/outdoorSurfaces.ts'
import { checkModulePlacements } from '../validation.ts'
import type { StationState } from './State.ts'

/** §4.3/§9.5: independent tiles validate against one snapshot, then publish one array. */
export function editOutdoorSurfaces(state: StationState, cells: readonly (readonly [number, number, number])[], type: 'sidewalk' | 'lawn', rot: number, remove = false) {
  const { tiles } = outdoorSurfaceIndex(state.modules)
  const seen = new Set<string>(), removals = new Set<string>(), candidates: Module[] = []
  const ids = new Set(state.modules.map(m => m.id))
  let serial = state.modules.length + 1
  for (const [x, y, z] of cells) {
    const key = surfaceKey(x, y, z)
    if (seen.has(key)) continue
    seen.add(key)
    const held = tiles.get(key)
    if (remove) { if (held?.type === type) removals.add(held.id); continue }
    if (held?.type === type) continue
    let id: string
    do { id = `${type}-${serial++}` } while (ids.has(id))
    ids.add(id)
    const at: Vec3i = { x, y, z }
    candidates.push({ ...at, id, type, rot, cfg: {} })
  }
  const check = checkModulePlacements(state, candidates.map(module => ({ id: module.id, module, layer: true })))
  const added = candidates.filter(m => !check.refused.has(m.id))
  const next = added.length || removals.size ? { ...state, modules: [...state.modules.filter(m => !removals.has(m.id)), ...added] } : state
  return { state: next, check }
}
