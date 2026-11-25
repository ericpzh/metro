// Bridge-owned supports (§5.4): one thick centre pier per complete eight-metre bay.
import { registerDocumentCache } from '../../sim/documentCaches.ts'
import { groundHoleReader, GROUND_Z } from '../../sim/ground.ts'
import { equipmentReason } from '../../sim/placement.ts'
import { BRIDGE_DECK_DEPTH, pillarSupportsBridge } from '../../sim/structures.ts'
import { rotateLocal, type TrackModule } from '../../sim/track.ts'
import type { Cell, Module } from '../../sim/types.ts'
import type { StationState } from './State.ts'

const bridgePresenceCache = new WeakMap<readonly Module[], boolean>()
let lastBridgePresence: { modules: readonly Module[]; len: number; has: boolean } | null = null

const isBridgeOrOwnedPillar = (m: Module): boolean =>
  (m.type === 'track' && m.cfg.bridge === true) || (m.type === 'pillar' && !!m.cfg.bridgeId)

export function hasBridgeOrBridgePillar(modules: readonly Module[]): boolean {
  const cached = bridgePresenceCache.get(modules)
  if (cached !== undefined) return cached
  if (lastBridgePresence && !lastBridgePresence.has && modules.length >= lastBridgePresence.len &&
    modules.length - lastBridgePresence.len <= 64) {
    const prev = lastBridgePresence.modules
    let samePrefix = true
    for (let i = 0; i < lastBridgePresence.len; i++) {
      if (modules[i] !== prev[i]) { samePrefix = false; break }
    }
    if (samePrefix) {
      let has = false
      for (let i = lastBridgePresence.len; i < modules.length; i++) {
        if (isBridgeOrOwnedPillar(modules[i])) { has = true; break }
      }
      bridgePresenceCache.set(modules, has)
      lastBridgePresence = { modules, len: modules.length, has }
      return has
    }
  }
  let has = false
  for (let i = 0; i < modules.length; i++) {
    if (isBridgeOrOwnedPillar(modules[i])) { has = true; break }
  }
  bridgePresenceCache.set(modules, has)
  lastBridgePresence = { modules, len: modules.length, has }
  return has
}

registerDocumentCache((_cells, modules, _liveCells, liveModules) => {
  if (modules !== liveModules) {
    bridgePresenceCache.delete(modules)
    if (lastBridgePresence?.modules === modules) lastBridgePresence = null
  }
})

export function bridgePillarCandidates(cells: readonly Cell[], modules: readonly Module[], bridge: TrackModule): Array<Extract<Module, { type: 'pillar' }>> {
  if (!bridge.cfg.bridge) return []
  const sites: Array<{ id: string; x: number; y: number; z: number }> = []
  const columns = new Map<number, Map<number, typeof sites[number]>>()
  const supported = new Set<string>()
  for (const module of modules) {
    if (pillarSupportsBridge(module, bridge)) supported.add(`${module.x},${module.y}`)
  }
  for (let i = 4; i + 4 <= bridge.w; i += 8) {
    const id = `${bridge.id}:pillar:${i}`
    if (bridge.cfg.removedBridgePillars?.includes(id)) continue
    const [dx, dy] = rotateLocal(bridge.rot, i, Math.floor((bridge.d ?? 1) / 2))
    const x = bridge.x + dx
    const y = bridge.y + dy
    if (supported.has(`${x},${y}`)) continue
    const site = { id, x, y, z: -Infinity }
    sites.push(site)
    let row = columns.get(x)
    if (!row) columns.set(x, row = new Map())
    row.set(y, site)
  }
  if (!sites.length) return []
  // Read all candidate columns in one pass, then check the implicit street
  // only where it could be the highest support under the bridge.
  const maxBase = bridge.z - BRIDGE_DECK_DEPTH - 2
  for (const c of cells) {
    const site = columns.get(c.x)?.get(c.y)
    if (site && c.fill === 'solid' && c.z <= maxBase && c.z > site.z) site.z = c.z
  }
  const out: Array<Extract<Module, { type: 'pillar' }>> = []
  let groundHole: ReturnType<typeof groundHoleReader> | undefined
  for (const site of sites) {
    const { id, x, y } = site
    let { z } = site
    if (GROUND_Z <= maxBase && GROUND_Z > z &&
      !(groundHole ??= groundHoleReader(cells, modules))(x, y)) z = GROUND_Z
    if (!Number.isFinite(z)) continue
    out.push({ id, type: 'pillar', x, y, z, rot: 0, cfg: { size: 'thick', height: bridge.z - z, bridgeId: bridge.id } })
  }
  return out
}

/** Backfill bridges and remove owned supports outside the current spacing. */
export function syncBridgePillars(state: StationState): StationState {
  if (!hasBridgeOrBridgePillar(state.modules)) return state
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
