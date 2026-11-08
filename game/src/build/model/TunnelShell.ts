// Tunnel structure shared by placement and power edits.
import type { Cell } from '../../sim/types.ts'
import type { StationState } from './State.ts'
import { rotateLocal, trackCells, trackHeadroom, type TrackModule } from '../../sim/track.ts'
import { reservedOpening } from '../../sim/placement.ts'
import { cellKey } from './Cells.ts'

/** Owned shell tag; deliberately distinct from automatically derived walls. */
export const TUNNEL_SHELL = 'tunnel-shell'

export function boreTunnel(state: StationState, track: TrackModule): StationState {
  const d = track.d ?? 1
  const rot = track.rot ?? 0
  const headroom = trackHeadroom(track)
  const bed = trackCells(track)
  const solid = new Set<string>()
  for (const c of state.cells) {
    if (c.fill === 'solid' && c.z >= track.z && c.z <= track.z + headroom + 1)
      solid.add(cellKey(c.x, c.y, c.z))
  }
  const kill = new Set<string>()
  // Clear the bore: only cells inside the run's own footprint are removed.
  for (const [x, y, z] of bed) {
    for (let dz = 1; dz <= headroom; dz++) {
      const k = cellKey(x, y, z + dz)
      if (!solid.has(k)) continue
      solid.delete(k)
      kill.add(k)
    }
  }
  const tag = `${TUNNEL_SHELL}:${track.id}`
  const add: Cell[] = []
  const want = (x: number, y: number, z: number): void => {
    const k = cellKey(x, y, z)
    if (solid.has(k) || reservedOpening(state.modules, x, y, z)) return
    solid.add(k)
    add.push({ x, y, z, fill: 'solid', tags: [tag] })
  }
  for (let i = 0; i < track.w; i++) {
    // Extend the side walls down to the dug bed so their bottoms meet the
    // recessed track slab instead of leaving a one-course gap above it.
    for (const j of [-1, d]) {
      const [dx, dy] = rotateLocal(rot, i, j)
      for (let dz = 0; dz <= headroom + 1; dz++) want(track.x + dx, track.y + dy, track.z + dz)
    }
    // Ceiling across the bore.
    for (let j = 0; j < d; j++) {
      const [dx, dy] = rotateLocal(rot, i, j)
      want(track.x + dx, track.y + dy, track.z + headroom + 1)
    }
  }
  if (kill.size === 0 && add.length === 0) return state
  const cells = kill.size
    ? state.cells.filter(c => c.z <= track.z || c.z > track.z + headroom || !kill.has(cellKey(c.x, c.y, c.z)))
    : state.cells
  return { ...state, cells: cells.concat(add) }
}

export function stripTunnelShell(state: StationState, trackId: string): StationState {
  const tag = `${TUNNEL_SHELL}:${trackId}`
  const cells = state.cells.filter((c) => !c.tags?.includes(tag))
  return cells.length === state.cells.length ? state : { ...state, cells }
}

