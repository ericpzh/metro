// Bridge-owned supports (§5.4): one thick centre pier per complete eight-metre bay.
import { solidAt } from '../../sim/ground.ts'
import { equipmentReason } from '../../sim/placement.ts'
import { BRIDGE_DECK_DEPTH, pillarSupportsBridge } from '../../sim/structures.ts'
import { rotateLocal, type TrackModule } from '../../sim/track.ts'
import type { Cell, Module } from '../../sim/types.ts'
import type { StationState } from './State.ts'

export function bridgePillarCandidates(cells: readonly Cell[], modules: readonly Module[], bridge: TrackModule): Array<Extract<Module, { type: 'pillar' }>> {
  if (!bridge.cfg.bridge) return []
  const out: Array<Extract<Module, { type: 'pillar' }>> = []
  for (let i = 4; i + 4 <= bridge.w; i += 8) {
    const id = `${bridge.id}:pillar:${i}`
    if (bridge.cfg.removedBridgePillars?.includes(id)) continue
    const [dx, dy] = rotateLocal(bridge.rot, i, Math.floor((bridge.d ?? 1) / 2))
    const x = bridge.x + dx
    const y = bridge.y + dy
    if (modules.some((m) => m.x === x && m.y === y && pillarSupportsBridge(m, bridge))) continue
    // Stand on the highest actual floor below the underside, including the
    // virtual street. Holes have no street surface to sprout a pier from.
    const maxBase = bridge.z - BRIDGE_DECK_DEPTH - 2
    const bases = [0, ...cells.filter((c) => c.x === x && c.y === y && c.fill === 'solid').map((c) => c.z)]
    const z = Math.max(...bases.filter((base) => base <= maxBase && solidAt(cells, modules, x, y, base)))
    if (!Number.isFinite(z)) continue
    out.push({ id, type: 'pillar', x, y, z, rot: 0, cfg: { size: 'thick', height: bridge.z - z, bridgeId: bridge.id } })
  }
  return out
}

/** Backfill bridges and remove owned supports outside the current spacing. */
export function syncBridgePillars(state: StationState): StationState {
  const bridges = state.modules.filter((m): m is TrackModule => m.type === 'track' && m.cfg.bridge === true)
  const supportIds = new Set<string>()
  for (const bridge of bridges) {
    for (let i = 4; i + 4 <= bridge.w; i += 8) {
      const id = `${bridge.id}:pillar:${i}`
      if (!bridge.cfg.removedBridgePillars?.includes(id)) supportIds.add(id)
    }
  }
  const modules = state.modules.filter((m) => m.type !== 'pillar' || !m.cfg.bridgeId || supportIds.has(m.id))
  for (const bridge of bridges) {
    for (const pillar of bridgePillarCandidates(state.cells, modules, bridge)) {
      if (!equipmentReason(state.cells, modules, pillar, true)) modules.push(pillar)
    }
  }
  return modules.length === state.modules.length && modules.every((m, i) => m === state.modules[i]) ? state : { ...state, modules }
}
