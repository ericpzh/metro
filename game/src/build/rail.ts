// Rail placement and the platform edges it derives (GAME-SPEC §5.4 track kit,
// §5.9 platforms). A rail is a `track` module: placing one digs the bed cells
// (half a storey of trench, §4.3 track bed) and the screen doors are generated
// automatically wherever the bed runs beside platform floor. Pure document
// edits — no React, no three.

import { floorSpeed } from '../sim/finishes.ts'
import { doorCentres, trainLength } from '../sim/stock.ts'
import type { Cell, LineDef, LineDirection, Module } from '../sim/types.ts'
import { lineColourFor } from '../data/line-colours.ts'
import { cellKey, nextModuleId, type StationState } from './model.ts'

/** Default bed depth in cells: a 2.8 m Type-B car sits inside with clearance. */
export const RAIL_BED_DEPTH = 3

export interface RailRect {
  x0: number
  y0: number
  x1: number
  y1: number
  z: number
}

/** Normalise two dragged corners into an inclusive rail rectangle. */
export function railRect(a: readonly [number, number, number], b: readonly [number, number, number], z: number): RailRect {
  return {
    x0: Math.min(a[0], b[0]),
    y0: Math.min(a[1], b[1]),
    x1: Math.max(a[0], b[0]),
    y1: Math.max(a[1], b[1]),
    z,
  }
}

/** A fresh line for the first rail a player lays, so placement never stalls. */
export function defaultLine(id: string, dir: LineDirection, power: 'third-rail' | 'catenary'): LineDef {
  return {
    id,
    name: `${id}号线`,
    colour: lineColourFor(id),
    stock: 'B',
    cars: 6,
    power,
    headwayProfile: { peak: 150, offpeak: 240, late: 480 },
    alightPerTrain: 200,
    terminus: 'through',
    direction: dir,
    travelSign: 1,
    stations: [],
  }
}

/** True when a cell is walkable platform floor: exposed, no wall/roof above. */
export function isPlatformCell(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  const c = cells.find((cc) => cc.x === x && cc.y === y && cc.z === z)
  if (!c || c.fill !== 'solid' || floorSpeed(c) <= 0) return false
  return !cells.some((cc) => cc.x === x && cc.y === y && cc.z === z + 1 && cc.fill === 'solid')
}

/** Contiguous x-runs in an ascending, de-duplicated list. */
function runsOf(xs: readonly number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start: number | null = null
  let prev = Number.NaN
  for (const x of xs) {
    if (start === null) start = x
    else if (x !== prev + 1) {
      runs.push([start, prev])
      start = x
    }
    prev = x
  }
  if (start !== null) runs.push([start, prev])
  return runs
}

function makeEdge(
  track: Extract<Module, { type: 'track' }>,
  x0: number,
  x1: number,
  row: number,
  side: 'left' | 'right',
  dir: LineDirection,
): Extract<Module, { type: 'platform-edge' }> {
  return {
    id: `edge-${track.id}-${side}`,
    type: 'platform-edge',
    x: x0,
    y: row,
    z: track.z,
    w: x1 - x0 + 1,
    cfg: { name: '站台门', line: track.cfg.line, dir, side, from: track.id },
  }
}

/**
 * One `platform-edge` per contiguous run of platform floor beside the bed. A
 * platform is any walkable exposed floor cell (nothing solid above it) on the
 * bed's south or north side; an island platform beside both sides yields two
 * edges — the spec's Spanish solution (§5.9).
 */
export function derivePlatformEdges(state: StationState, track: Module): Array<Extract<Module, { type: 'platform-edge' }>> {
  if (track.type !== 'track') return []
  const line = state.lines.find((l) => l.id === track.cfg.line)
  const dir: LineDirection = track.cfg.dir ?? line?.direction ?? 'up'
  const d = track.d ?? 1
  const out: Array<Extract<Module, { type: 'platform-edge' }>> = []
  const sides: Array<{ side: 'left' | 'right'; row: number }> = [
    { side: 'left', row: track.y - 1 },
    { side: 'right', row: track.y + d },
  ]
  for (const { side, row } of sides) {
    const xs: number[] = []
    for (let x = track.x; x < track.x + track.w; x++) {
      if (isPlatformCell(state.cells, x, row, track.z)) xs.push(x)
    }
    for (const [x0, x1] of runsOf(xs)) out.push(makeEdge(track, x0, x1, row, side, dir))
  }
  return out
}

/** Drop the edges auto-derived from `trackId`, so regeneration is idempotent. */
export function dropDerivedEdges(state: StationState, trackId: string): StationState {
  const modules = state.modules.filter((m) => !(m.type === 'platform-edge' && m.cfg.from === trackId))
  return modules.length === state.modules.length ? state : { ...state, modules }
}

/** Re-derive a rail's screen doors after the platform floor has changed. */
export function regenerateRailEdges(state: StationState, trackId: string): StationState {
  const track = state.modules.find((m) => m.id === trackId)
  if (!track || track.type !== 'track') return state
  const cleaned = dropDerivedEdges(state, trackId)
  return { ...cleaned, modules: [...cleaned.modules, ...derivePlatformEdges(cleaned, track)] }
}

/** True when a rail rectangle overlaps a track module already on the level. */
export function railOverlaps(state: StationState, rect: RailRect): boolean {
  for (const m of state.modules) {
    if (m.type !== 'track' || m.z !== rect.z) continue
    const d = m.d ?? 1
    if (rect.x0 <= m.x + m.w - 1 && rect.x1 >= m.x && rect.y0 <= m.y + d - 1 && rect.y1 >= m.y) return true
  }
  return false
}

export interface PlaceRailOptions {
  lineId: string
  dir: LineDirection
  power: 'third-rail' | 'catenary'
}

/**
 * Dig the bed and place the track run, then derive its screen doors. The bed
 * cells are removed (one course), so the mesher exposes the platform edge as a
 * half-metre drop and the module supplies the recessed slab and rails. Any
 * equipment standing on the bed goes with it.
 */
export function placeRail(state: StationState, rect: RailRect, opts: PlaceRailOptions): StationState {
  const w = rect.x1 - rect.x0 + 1
  const d = rect.y1 - rect.y0 + 1
  if (w < 1 || d < 1) return state
  if (railOverlaps(state, rect)) return state
  const track: Extract<Module, { type: 'track' }> = {
    id: nextModuleId(state.modules, 'track'),
    type: 'track',
    x: rect.x0,
    y: rect.y0,
    z: rect.z,
    w,
    d,
    cfg: { line: opts.lineId, power: opts.power, dir: opts.dir },
  }
  const dug = new Set<string>()
  for (let x = rect.x0; x <= rect.x1; x++) for (let y = rect.y0; y <= rect.y1; y++) dug.add(cellKey(x, y, rect.z))
  const cells = state.cells.filter((c) => !dug.has(cellKey(c.x, c.y, c.z)))
  const modules = state.modules.filter((m) => !dug.has(cellKey(m.x, m.y, m.z)))
  const withTrack: StationState = { ...state, cells, modules: [...modules, track] }
  return { ...withTrack, modules: [...withTrack.modules, ...derivePlatformEdges(withTrack, track)] }
}

/** The track module covering a cell, so the inspector can show the rail panel. */
export function railModuleAt(state: StationState, x: number, y: number, z: number): Extract<Module, { type: 'track' }> | undefined {
  for (const m of state.modules) {
    if (m.type !== 'track') continue
    const d = m.d ?? 1
    if (z === m.z && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + d) return m
  }
  return undefined
}

/** Read-only summary for the rail panel: length, consist and derived doors. */
export function railSummary(track: Extract<Module, { type: 'track' }>, line: LineDef | undefined): {
  length: number
  cars: number
  trainLength: number
  doors: number
} {
  if (!line) return { length: track.w, cars: 0, trainLength: 0, doors: 0 }
  return {
    length: track.w,
    cars: line.cars,
    trainLength: Math.round(trainLength(line)),
    // Door count comes from the stock's door cadence; the panel only reads it.
    doors: doorCentres(line).length,
  }
}
