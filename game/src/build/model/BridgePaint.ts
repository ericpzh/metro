// The bridge structure's finish is independent of the track bed (§4.3, §5.4).
import type { FinishId } from '../../sim/types.ts'
import type { StationState } from './State.ts'

export function paintBridgeSurface(state: StationState, id: string, finish: FinishId | null): StationState {
  const bridge = state.modules.find((m) => m.id === id && m.type === 'track' && m.cfg.bridge)
  if (!bridge || bridge.type !== 'track' || (bridge.cfg.bridgeFinish ?? null) === finish) return state
  const cfg = { ...bridge.cfg }
  if (finish === null) delete cfg.bridgeFinish
  else cfg.bridgeFinish = finish
  return { ...state, modules: state.modules.map((m) => m.id === id ? { ...bridge, cfg } : m) }
}
