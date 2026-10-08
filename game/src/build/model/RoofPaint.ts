// The roof's 材质 gesture (§4.3): one tile, or its connected roof in 整面 mode.
import type { FinishId, Module } from '../../sim/types.ts'
import { trackCells } from '../../sim/track.ts'
import type { StationState } from './State.ts'

export function paintRoofSurface(state: StationState, id: string, finish: FinishId | null, surface = false): StationState {
  const roof = state.modules.find((m): m is Extract<Module, { type: 'roof' }> => m.id === id && m.type === 'roof')
  if (!roof) return state
  const ids = new Set([id])
  if (surface) {
    const roofs = state.modules.filter((m): m is Extract<Module, { type: 'roof' }> => m.type === 'roof' && m.z === roof.z)
    const byCell = new Map(roofs.flatMap((m) => trackCells(m).map(([x, y]) => [`${x},${y}`, m] as const)))
    const queue: typeof roofs = [roof]
    for (let i = 0; i < queue.length; i++) {
      const m = queue[i]
      for (const [x, y] of trackCells(m)) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const neighbour = byCell.get(`${x + dx},${y + dy}`)
          if (!neighbour || ids.has(neighbour.id)) continue
          ids.add(neighbour.id)
          queue.push(neighbour)
        }
      }
    }
  }
  let changed = false
  const modules = state.modules.map((m) => {
    if (m.type !== 'roof' || !ids.has(m.id) || (m.cfg.finish ?? null) === finish) return m
    const cfg = { ...m.cfg }
    if (finish === null) delete cfg.finish
    else cfg.finish = finish
    changed = true
    return { ...m, cfg }
  })
  return changed ? { ...state, modules } : state
}
