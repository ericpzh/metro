// The platform/tunnel track structure finish is separate from its rails.
import type { FinishId } from '../../sim/types.ts'
import type { Face } from '../../sim/types.ts'
import type { StationState } from './State.ts'

/** Paint one concrete outer face of a station platform or tunnel track. */
export function paintTrackSurface(state: StationState, id: string, face: Face, finish: FinishId | null): StationState {
  const track = state.modules.find((m) => m.id === id && m.type === 'track' && !m.cfg.bridge)
  if (!track || track.type !== 'track' || (track.cfg.surfaceFinishes?.[face] ?? null) === finish) return state
  const cfg = { ...track.cfg }
  const finishes = { ...cfg.surfaceFinishes }
  if (finish === null) delete finishes[face]
  else finishes[face] = finish
  if (Object.keys(finishes).length) cfg.surfaceFinishes = finishes
  else delete cfg.surfaceFinishes
  return { ...state, modules: state.modules.map((m) => m.id === id ? { ...track, cfg } : m) }
}
