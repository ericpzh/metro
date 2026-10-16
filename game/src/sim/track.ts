import { msg } from './i18n.ts'
import { PSD_WALL_OFFSET } from './constants.ts'
// Track geometry and orientation — GAME-SPEC §5.4 track kit, §4.3 track bed.
//
// A track piece is a fixed-footprint bed: `w` cells of run along its local +x
// and `d` cells of depth along local +y, quarter-turned by `rot` so a line can
// run east–west or north–south. This one source of truth is shared by the
// builder (`build/rail.ts`), the occupancy/collision helpers
// (`sim/placement.ts`), the graph (`sim/station.ts`), the train anchor
// (`sim/world.ts`) and the renderer, so none of them can disagree about what
// the piece covers or which way it runs.
//
// Rotation is counter-clockwise: rot 0 runs +x, 1 +y, 2 −x, 3 −y. Continuous
// offsets are allowed, because a run centre is a half-cell. Pure data — no
// three, no DOM.

import type { LineDirection, Module } from './types.ts'

/** Length presets shared by the tunnel and elevated track tools. */
export const TRACK_RUN_LENGTHS = [4, 16, 32, 64, 128] as const
const TRACK_RUN_LABELS = [msg('extra_short'), msg('short'), msg('medium'), msg('long'), msg('extra_long')] as const

export function supportedTrackRunLength(length: number): number {
  return TRACK_RUN_LENGTHS.reduce((closest, candidate) =>
    Math.abs(candidate - length) < Math.abs(closest - length) ? candidate : closest)
}

export function nextTrackRunLength(length: number): number {
  const current = supportedTrackRunLength(length)
  return TRACK_RUN_LENGTHS[(TRACK_RUN_LENGTHS.indexOf(current as (typeof TRACK_RUN_LENGTHS)[number]) + 1) % TRACK_RUN_LENGTHS.length]
}

export function trackRunLengthLabel(length: number): string {
  return TRACK_RUN_LABELS[TRACK_RUN_LENGTHS.indexOf(supportedTrackRunLength(length) as (typeof TRACK_RUN_LENGTHS)[number])]
}

export type TrackModule = Extract<Module, { type: 'track' }>
export type PlatformEdgeModule = Extract<Module, { type: 'platform-edge' }>

/** Normalise a quarter-turn index to 0..3. */
export function normRot(rot: number | undefined): number {
  return ((Math.round(rot ?? 0) % 4) + 4) % 4
}

/**
 * Local offset (i along the run, j across the bed) → world offset, turning
 * counter-clockwise. Accepts fractional offsets for anchor maths.
 */
export function rotateLocal(rot: number | undefined, i: number, j: number): [number, number] {
  switch (normRot(rot)) {
    case 1:
      return [-j, i]
    case 2:
      return [-i, -j]
    case 3:
      return [j, -i]
    default:
      return [i, j]
  }
}

/** The unit run direction of a track at this rotation. */
export function trackFacing(rot: number | undefined): [number, number] {
  return rotateLocal(rot, 1, 0)
}

/** The unit direction across the bed (local +y) of a track at this rotation. */
export function trackSide(rot: number | undefined): [number, number] {
  return rotateLocal(rot, 0, 1)
}

/** Bed depth in cells (legacy modules omit `d` and are one cell deep). */
export function trackDepth(m: Pick<TrackModule, 'd'>): number {
  return m.d ?? 1
}

/** Across-bed offset of the screen-door line on either adjacent platform tile. */
export function trackSideFixtureOffset(depth: number): number {
  return depth / 2 + 0.5 - PSD_WALL_OFFSET
}

/** The vehicle centre across its bed, measured from the bed's local −y edge. */
export function trackTrainCentreV(
  track: TrackModule,
  vehicleWidth: number,
  edges: readonly Pick<PlatformEdgeModule, 'cfg'>[] = [],
  lineDir?: LineDirection,
): number {
  const d = trackDepth(track)
  if (track.cfg.tunnel || track.cfg.bridge) return d / 2
  const dir = track.cfg.dir ?? lineDir ?? 'up'
  const id = track.id
  const edge = edges.find((e) => (id !== undefined && e.cfg.from === id)
    || (e.cfg.from === undefined && e.cfg.line === track.cfg.line && e.cfg.dir === dir))
  if (!edge) return d / 2
  const gap = 0.1
  if (edge.cfg.side === 'left') {
    const low = vehicleWidth / 2
    const high = d - gap - vehicleWidth / 2
    return low <= high ? Math.min(high, Math.max(low, d / 2)) : low
  }
  const low = gap + vehicleWidth / 2
  const high = d - vehicleWidth / 2
  return low <= high ? Math.min(high, Math.max(low, d / 2)) : high
}

/** Every world cell a track's bed covers. */
export function trackCells(m: Pick<TrackModule, 'x' | 'y' | 'z' | 'w' | 'd' | 'rot'>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const d = trackDepth(m)
  for (let i = 0; i < m.w; i++) {
    for (let j = 0; j < d; j++) {
      const [dx, dy] = rotateLocal(m.rot, i, j)
      out.push([m.x + dx, m.y + dy, m.z])
    }
  }
  return out
}

/** True when `(x, y, z)` is one of this track's bed cells. */
export function trackCellAt(m: TrackModule, x: number, y: number, z: number): boolean {
  if (z !== m.z) return false
  const [i, j] = rotateLocal(-(m.rot ?? 0), x - m.x, y - m.y)
  return i >= -1e-9 && i < m.w - 1e-9 && j >= -1e-9 && j < trackDepth(m) - 1e-9
}

/** World cell-centre coordinates of the bed centre — the run's midpoint. */
export function trackCentre(m: TrackModule): [number, number] {
  const [dx, dy] = rotateLocal(m.rot, (m.w - 1) / 2, (trackDepth(m) - 1) / 2)
  return [m.x + 0.5 + dx, m.y + 0.5 + dy]
}

/**
 * The module origin that puts a `w × d` piece's centre on the anchor cell, so
 * the long run grows evenly either side of the highlighted tile. For an even
 * run the anchor is the lower-middle cell.
 */
export function trackOriginForCentre(
  rot: number | undefined,
  x: number,
  y: number,
  w: number,
  d: number,
): [number, number] {
  const [dx, dy] = rotateLocal(rot, -Math.floor((w - 1) / 2), -Math.floor((d - 1) / 2))
  return [x + dx, y + dy]
}

/** Every world cell a platform-edge run covers (one cell deep, along local +x). */
export function edgeCells(m: PlatformEdgeModule): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < m.w; i++) {
    const [dx, dy] = rotateLocal(m.rot, i, 0)
    out.push([m.x + dx, m.y + dy, m.z])
  }
  return out
}

/**
 * Which side of the bed a track's 第三轨 sits on, as a local +y sign: +1 the
 * local +y edge, −1 the local −y edge (GAME-SPEC §5.4 track kit).
 *
 * A conductor rail runs on the left of the travel direction — the outer wall in
 * a bore — and jumps across before a station so it stays off the platform side.
 * `up` travels local +x, so its left is local +y; `down` travels local −x, so
 * its left is local −y. A tunnel or 轨道桥 keeps that left whatever the station
 * holds; a platform rail takes the side with no 屏蔽门, and only falls back to
 * the travel left when both sides (or neither side) carry screens.
 */
export function thirdRailSide(
  track: Pick<TrackModule, 'cfg'>,
  edges: readonly Pick<PlatformEdgeModule, 'cfg'>[] = [],
  lineDir?: LineDirection,
): 1 | -1 {
  const dir = track.cfg.dir ?? lineDir ?? 'up'
  const left: 1 | -1 = dir === 'down' ? -1 : 1
  if (track.cfg.tunnel || track.cfg.bridge) return left
  const trackId = (track as { id?: string }).id
  const line = track.cfg.line
  const relevant = edges.filter((e) => {
    if (trackId !== undefined && e.cfg.from === trackId) return true
    // Edges that predate `cfg.from` match by line and direction instead.
    return e.cfg.from === undefined && e.cfg.line === line && e.cfg.dir === dir
  })
  const hasLeft = relevant.some((e) => e.cfg.side === 'left')
  const hasRight = relevant.some((e) => e.cfg.side === 'right')
  if (hasLeft && !hasRight) return -1
  if (hasRight && !hasLeft) return 1
  return left
}
