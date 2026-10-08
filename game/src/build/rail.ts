// Rail placement and the platform edges it derives (GAME-SPEC §5.4 track kit,
// §5.9 platforms). A rail is a `track` module: placing one digs the bed cells
// (half a storey of trench, §4.3 track bed) and the screen doors are generated
// automatically wherever the bed runs beside platform floor. A piece is a fixed
// footprint — a car-width bed and a run sized to the bound line's consist — so
// the whole module can be pre-rendered and turned with R like any equipment,
// including across to the other axis. Pure document edits — no React, no three.

import { pillarSupportsBridge } from '../sim/structures.ts'
import { floorSpeed } from '../sim/finishes.ts'
import { boxesOverlap, moduleEnvelope, reservedOpening, trackAt, type ModuleBox } from '../sim/placement.ts'
import { doorCentres, trainLength } from '../sim/stock.ts'
import { rotateLocal, trackCellAt, trackCells, type TrackModule } from '../sim/track.ts'
import type { Cell, LineDef, LineDirection, Module, PsdHeight } from '../sim/types.ts'
import { lineColourFor } from '../data/line-colours.ts'
import { cellKey, nextModuleId, removeModule, type StationState } from './model.ts'

/** Default bed depth in cells: a 2.8 m Type-B car sits inside with clearance. */
export const RAIL_BED_DEPTH = 3

/**
 * Clear headroom a track bore keeps above its bed, in blocks: three open
 * courses, so the ceiling lands one storey (4 m) above the rails — a train's
 * 3.8 m body clears it.
 */
export const TUNNEL_HEADROOM = 3

/**
 * Tag on a block a tunnel raised around itself, suffixed with the owning track's
 * id (`tunnel-shell:<id>`), so removing that track can take its shell with it.
 * Never `AUTO_WALL`, so `syncAutoWalls` leaves it alone.
 */
export const TUNNEL_SHELL = 'tunnel-shell'


export type PlatformEdgeModule = Extract<Module, { type: 'platform-edge' }>

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
    psd: 'full',
    headwayProfile: { peak: 150, offpeak: 240, late: 480 },
    alightPerTrain: 200,
    terminus: 'through',
    direction: dir,
    upTerminus: '',
    downTerminus: '',
    travelSign: 1,
    stations: [],
  }
}

/**
 * Switch a line's 供电 mode and carry it to every track bound to that line — the
 * platform rails and the tunnel runs alike. The renderer reads the mode back off
 * each track's `cfg`, so rebuilding the modules re-cuts all of them together
 * (§5.4 track kit). Pure document edit.
 */
export function setLinePower(state: StationState, lineId: string, power: 'third-rail' | 'catenary'): StationState {
  const lines = state.lines.map((l) => (l.id === lineId ? { ...l, power } : l))
  const modules = state.modules.map((m) =>
    m.type === 'track' && m.cfg.line === lineId ? { ...m, cfg: { ...m.cfg, power } } : m,
  )
  return { ...state, lines, modules }
}

/**
 * True when a cell is walkable platform floor: exposed, no wall/roof above.
 *
 * The **document's** cells, deliberately: the implicit street at z = 0
 * (`sim/ground.ts`) is the world outside the station, not a platform, so it never
 * derives a screen door — a rail laid on virgin ground gets none until the player
 * lays a surface of their own beside it.
 */
export function isPlatformCell(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  const c = cells.find((cc) => cc.x === x && cc.y === y && cc.z === z)
  if (!c || c.fill !== 'solid' || floorSpeed(c) <= 0) return false
  return !cells.some((cc) => cc.x === x && cc.y === y && cc.z === z + 1 && cc.fill === 'solid')
}

/** Contiguous runs in an ascending, de-duplicated list. */
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

/* ------------------------------------------------------------------ pieces */

export interface TrackPiece {
  w: number
  d: number
}

/**
 * The footprint a line's consist needs: a three-cell car-width bed and a run of
 * the whole train, so the dimension is known before the player places anything.
 * A/B/C/L car widths all round up to the bed, so only the length varies by line.
 */
export function trackPieceForLine(line: Pick<LineDef, 'stock' | 'cars'>): TrackPiece {
  return { w: Math.max(1, Math.ceil(trainLength(line))), d: RAIL_BED_DEPTH }
}

/** A track module payload. Shared by placement and the on-hover ghost. */
export function makeTrack(o: {
  id: string
  lineId: string
  dir: LineDirection
  power: 'third-rail' | 'catenary'
  rot: number
  x: number
  y: number
  z: number
  w: number
  d: number
  tunnel?: boolean
  bridge?: boolean
}): TrackModule {
  return {
    id: o.id,
    type: 'track',
    x: o.x,
    y: o.y,
    z: o.z,
    w: o.w,
    d: o.d,
    rot: o.rot,
    cfg: { line: o.lineId, power: o.power, dir: o.dir, ...(o.tunnel ? { tunnel: true } : {}), ...(o.bridge ? { bridge: true } : {}) },
  }
}

function makeEdge(
  track: TrackModule,
  x: number,
  y: number,
  w: number,
  side: 'left' | 'right',
  dir: LineDirection,
  psd: PsdHeight,
): PlatformEdgeModule {
  return {
    id: `edge-${track.id}-${side}`,
    type: 'platform-edge',
    x,
    y,
    z: track.z,
    w,
    rot: track.rot,
    cfg: { name: '站台门', line: track.cfg.line, dir, side, psd, from: track.id },
  }
}

/**
 * One `platform-edge` per contiguous run of platform floor beside the bed. A
 * platform is any walkable exposed floor cell (nothing solid above it) on the
 * bed's south or north side; an island platform beside both sides yields two
 * edges — the spec's Spanish solution (§5.9). The run follows the track's
 * rotation, so a north–south rail gets north–south screen doors.
 */
export function derivePlatformEdges(state: StationState, track: Module): PlatformEdgeModule[] {
  if (track.type !== 'track' || (track.cfg.tunnel || track.cfg.bridge)) return []
  const line = state.lines.find((l) => l.id === track.cfg.line)
  const dir: LineDirection = track.cfg.dir ?? line?.direction ?? 'up'
  const psd: PsdHeight = line?.psd ?? 'full'
  const rot = track.rot ?? 0
  const d = track.d ?? 1
  const out: PlatformEdgeModule[] = []
  // `side` is read from the screen's own frame, not the track's: it names the
  // side the track lies on (renderer and sim both agree on this). A platform at
  // local j = −1 sits on the track's −y, which puts the track on the edge's +y —
  // its "right"; j = d is the mirror image.
  const sides: Array<{ side: 'left' | 'right'; j: number }> = [
    { side: 'right', j: -1 },
    { side: 'left', j: d },
  ]
  for (const { side, j } of sides) {
    const xs: number[] = []
    for (let i = 0; i < track.w; i++) {
      const [dx, dy] = rotateLocal(rot, i, j)
      if (isPlatformCell(state.cells, track.x + dx, track.y + dy, track.z)) xs.push(i)
    }
    for (const [i0, i1] of runsOf(xs)) {
      const [ox, oy] = rotateLocal(rot, i0, j)
      out.push(makeEdge(track, track.x + ox, track.y + oy, i1 - i0 + 1, side, dir, psd))
    }
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

/**
 * Delete a line together with its rolling stock: every `track` bound to it
 * (platform rails and hand-sized tunnels), the screen doors derived from those
 * tracks, and any tunnel shell they raised. A line with no tracks is simply
 * dropped. Pure, so the caller repoints the rail tool and any 3D selection.
 */
export function removeLineAndTracks(state: StationState, lineId: string): StationState {
  if (!state.lines.some((l) => l.id === lineId)) return state
  let next = state
  for (const m of state.modules) {
    if (m.type === 'track' && m.cfg.line === lineId) {
      next = stripTunnelShell(removeModule(dropDerivedEdges(next, m.id), m.id), m.id)
    }
  }
  return { ...next, lines: next.lines.filter((l) => l.id !== lineId) }
}

/** True when two tracks would share a bed cell. */
export function trackOverlaps(state: StationState, candidate: TrackModule): boolean {
  const mine = new Set(trackCells(candidate).map(([x, y, z]) => cellKey(x, y, z)))
  for (const m of state.modules) {
    if (m.type !== 'track') continue
    for (const [x, y, z] of trackCells(m)) if (mine.has(cellKey(x, y, z))) return true
  }
  return false
}

/** True when a rail rectangle overlaps a track module already on the level. */
export function railOverlaps(state: StationState, rect: RailRect): boolean {
  const w = rect.x1 - rect.x0 + 1
  const d = rect.y1 - rect.y0 + 1
  if (w < 1 || d < 1) return false
  return trackOverlaps(state, makeTrack({ id: 'rect', lineId: '', dir: 'up', power: 'third-rail', rot: 0, x: rect.x0, y: rect.y0, z: rect.z, w, d }))
}

/** Every solid cell of a state, keyed for O(1) lookups. */
function solidKeys(state: StationState): Set<string> {
  const out = new Set<string>()
  for (const c of state.cells) if (c.fill === 'solid') out.add(cellKey(c.x, c.y, c.z))
  return out
}

/**
 * True when a platform run would have a wall crossing its headroom. A platform
 * is open air, so it refuses to be laid through an obstruction (a tunnel bores
 * through instead). Checks the three clear courses above the bed.
 */
export function trackClearanceBlocked(state: StationState, track: TrackModule): boolean {
  if (track.cfg.tunnel) return false
  const solid = solidKeys(state)
  for (const [x, y, z] of trackCells(track)) {
    for (let dz = 1; dz <= TUNNEL_HEADROOM; dz++) if (solid.has(cellKey(x, y, z + dz))) return true
  }
  return false
}

/** The axis-aligned volume a track needs clear: its bed plus its headroom. */
function trackSpace(track: TrackModule): ModuleBox {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of trackCells(track)) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x + 1)
    y1 = Math.max(y1, y + 1)
  }
  return { x0, y0, z0: track.z, x1, y1, z1: track.z + TUNNEL_HEADROOM + 1 }
}

/**
 * Every placed module sharing the track's space — the offending pieces an
 * interfered rail preview collides with. Same rule as
 * `trackInterferenceBlocked`, but returns the modules so the builder can
 * highlight them alongside the red ghost.
 */
export function trackColliders(state: StationState, track: TrackModule): Module[] {
  const box = trackSpace(track)
  const out: Module[] = []
  for (const m of state.modules) {
    if (m.id === track.id || pillarSupportsBridge(m, track)) continue
    const e = moduleEnvelope(m)
    if (e && boxesOverlap(box, e)) out.push(m)
  }
  return out
}

/**
 * True when anything already on the level would share the track's space — a
 * gate, a room, a screen door, a ramp or another rail/tunnel. Interference
 * blocks the placement rather than demolishing what is there.
 */
export function trackInterferenceBlocked(state: StationState, track: TrackModule): boolean {
  return trackColliders(state, track).length > 0
}

/** True when a platform run is not fully supported by solid floor. */
export function trackFloorMissing(state: StationState, track: TrackModule): boolean {
  const solid = solidKeys(state)
  for (const [x, y, z] of trackCells(track)) if (!solid.has(cellKey(x, y, z))) return true
  return false
}

/** Why a track may not be placed, or null when it is eligible. */
export type TrackBlock = 'interference' | 'wall' | 'floor'

export function trackBlockReason(state: StationState, track: TrackModule): TrackBlock | null {
  if (trackInterferenceBlocked(state, track)) return 'interference'
  // A tunnel bores through walls and hangs over void; only a platform is held
  // to open air and solid ground under its whole footprint.
  if (track.cfg.bridge && track.z < 0) return 'floor'
  if (!track.cfg.tunnel) {
    if (trackClearanceBlocked(state, track)) return 'wall'
    if (!track.cfg.bridge && trackFloorMissing(state, track)) return 'floor'
  }
  return null
}

/**
 * Bore a tunnel: clear any wall (or ground) poking into its headroom, then raise
 * a solid side wall either side and a ceiling one storey up wherever those do
 * not already exist. Shell blocks carry the owning track's tag so removing the
 * tunnel takes its shell too, and a reserved opening (a ramp corridor, an exit
 * floor) is never sealed.
 */
function boreTunnel(state: StationState, track: TrackModule): StationState {
  const d = track.d ?? 1
  const rot = track.rot ?? 0
  const solid = solidKeys(state)
  const kill = new Set<string>()
  // Clear the bore: only cells inside the run's own footprint are removed.
  for (const [x, y, z] of trackCells(track)) {
    for (let dz = 1; dz <= TUNNEL_HEADROOM; dz++) {
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
    // Side walls, full storey tall, on both long sides.
    for (const j of [-1, d]) {
      const [dx, dy] = rotateLocal(rot, i, j)
      for (let dz = 1; dz <= TUNNEL_HEADROOM + 1; dz++) want(track.x + dx, track.y + dy, track.z + dz)
    }
    // Ceiling across the bore.
    for (let j = 0; j < d; j++) {
      const [dx, dy] = rotateLocal(rot, i, j)
      want(track.x + dx, track.y + dy, track.z + TUNNEL_HEADROOM + 1)
    }
  }
  if (kill.size === 0 && add.length === 0) return state
  const cells = state.cells.filter((c) => !kill.has(cellKey(c.x, c.y, c.z)))
  cells.push(...add)
  return { ...state, cells }
}

/**
 * The low-level commit: refuse an overlapping rail, dig the bed, append the
 * track, bore it if it is a tunnel, and derive its screen doors. No platform
 * clearance check — `commitTrack` adds that, and `resizeTrack` deliberately
 * skips it so a consist edit never silently refuses.
 */
function commitTrackRaw(state: StationState, track: TrackModule): StationState {
  if (trackOverlaps(state, track)) return state
  const dug = new Set(trackCells(track).map(([x, y, z]) => cellKey(x, y, z)))
  const cells = state.cells.filter((c) => !dug.has(cellKey(c.x, c.y, c.z)))
  const modules = state.modules.filter((m) => !dug.has(cellKey(m.x, m.y, m.z)))
  let next: StationState = { ...state, cells, modules: [...modules, track] }
  if (track.cfg.tunnel) next = boreTunnel(next, track)
  return { ...next, modules: [...next.modules, ...derivePlatformEdges(next, track)] }
}

/**
 * Dig a track's bed cells and append it, then derive its screen doors. The bed
 * cells are removed (one course), so the mesher exposes the platform edge as a
 * half-metre drop and the module supplies the recessed slab and rails. Anything
 * that would share the track's space, a platform with a wall in its headroom, or
 * a platform not resting on solid floor refuses and returns the same state
 * object, so callers can tell "no change".
 */
export function commitTrack(state: StationState, track: TrackModule): StationState {
  if (trackBlockReason(state, track) !== null) return state
  return commitTrackRaw(state, track)
}

/** Remove the shell blocks a tunnel raised (tagged with the track's id). */
export function stripTunnelShell(state: StationState, trackId: string): StationState {
  const tag = `${TUNNEL_SHELL}:${trackId}`
  const cells = state.cells.filter((c) => !c.tags?.includes(tag))
  return cells.length === state.cells.length ? state : { ...state, cells }
}

export interface PlaceTrackOptions {
  lineId: string
  dir: LineDirection
  power: 'third-rail' | 'catenary'
  rot: number
  x: number
  y: number
  z: number
  w: number
  d: number
}

/** Place a fixed-footprint track piece (dig + track module + derived doors). */
export function placeTrack(state: StationState, opts: PlaceTrackOptions): StationState {
  if (opts.w < 1 || opts.d < 1) return state
  const track = makeTrack({ id: nextModuleId(state.modules, 'track'), ...opts })
  return commitTrack(state, track)
}

export interface PlaceRailOptions {
  lineId: string
  dir: LineDirection
  power: 'third-rail' | 'catenary'
}

/**
 * The original rectangle placement, kept for tests and authored documents. A
 * rectangle is always axis-aligned; the player-facing tool places fixed pieces
 * instead (see `placeTrack`).
 */
export function placeRail(state: StationState, rect: RailRect, opts: PlaceRailOptions): StationState {
  const w = rect.x1 - rect.x0 + 1
  const d = rect.y1 - rect.y0 + 1
  if (w < 1 || d < 1) return state
  const track = makeTrack({ id: nextModuleId(state.modules, 'track'), lineId: opts.lineId, dir: opts.dir, power: opts.power, rot: 0, x: rect.x0, y: rect.y0, z: rect.z, w, d })
  return commitTrack(state, track)
}

/** The track module covering a cell, so the inspector can show the rail panel. */
export function railModuleAt(state: StationState, x: number, y: number, z: number): TrackModule | undefined {
  for (const m of state.modules) {
    if (m.type === 'track' && trackCellAt(m, x, y, z)) return m
  }
  return undefined
}

/**
 * The end of `src` a tunnel should grow from. With a hovered cell `at`, the
 * nearer end is preferred (so the preview appears where the pointer is); if that
 * end already carries a track the other free end is used instead. With no `at`,
 * the forward (+x) free end is chosen. When neither end is free the preferred
 * end is returned and the placement is refused by the usual interference check.
 */
export function freeTunnelEnd(state: StationState, src: TrackModule, at?: readonly [number, number, number]): 1 | -1 {
  const rot = src.rot ?? 0
  const d = src.d ?? 1
  const used = (i: number): boolean => {
    for (let j = 0; j < d; j++) {
      const [dx, dy] = rotateLocal(rot, i, j)
      if (trackAt(state.modules, src.x + dx, src.y + dy, src.z)) return true
    }
    return false
  }
  const forwardFree = !used(src.w)
  const backwardFree = !used(-1)
  let prefer: 1 | -1 = 1
  if (at) {
    // The hovered cell's position along the run decides which end is nearer.
    const [i] = rotateLocal(-rot, at[0] - src.x, at[1] - src.y)
    prefer = i > (src.w - 1) / 2 ? 1 : -1
  }
  if (prefer > 0) return forwardFree ? 1 : backwardFree ? -1 : 1
  return backwardFree ? -1 : forwardFree ? 1 : -1
}

/**
 * A tunnel run that continues `src` off one end. `end` is +1 for the forward
 * (local +x) end, −1 for the other; `length` is in whole metres. The piece keeps
 * the source's axis, rotation and bed depth, so it lines up cell-for-cell, and
 * the caller refuses it if it would overlap another track.
 */
export function makeTunnel(src: TrackModule, end: 1 | -1, length: number, id: string): TrackModule {
  const w = Math.max(1, Math.round(length))
  const [dx, dy] = end > 0 ? rotateLocal(src.rot, src.w, 0) : rotateLocal(src.rot, -w, 0)
  return makeTrack({
    id,
    lineId: src.cfg.line,
    dir: src.cfg.dir ?? 'up',
    power: src.cfg.power,
    rot: src.rot ?? 0,
    x: src.x + dx,
    y: src.y + dy,
    z: src.z,
    w,
    d: src.d ?? 1,
    tunnel: true,
  })
}

/**
 * Extend an existing rail with a tunnel run, automatically off whichever end has
 * no track on it. Refuses (same state object) when no such rail exists or the
 * run would interfere with anything, so the caller can tell "no change".
 */
export function makeBridge(src: TrackModule, end: 1 | -1, length: number, id: string): TrackModule {
  const tunnel = makeTunnel(src, end, length, id)
  const { tunnel: _tunnel, ...cfg } = tunnel.cfg
  return { ...tunnel, cfg: { ...cfg, bridge: true } }
}

export function placeTunnel(state: StationState, sourceId: string, length: number, at?: readonly [number, number, number]): StationState {
  const src = state.modules.find((m) => m.id === sourceId)
  if (!src || src.type !== 'track') return state
  return commitTrack(state, makeTunnel(src, freeTunnelEnd(state, src, at), length, nextModuleId(state.modules, 'track')))
}

/** Re-derive a rail's doors if a line's consist changed its run length. */
export function resizeTrack(state: StationState, track: TrackModule, w: number): StationState {
  if (w < 1 || w === track.w) return state
  const resized: TrackModule = { ...track, w }
  const cleaned = dropDerivedEdges(state, track.id)
  const modules = cleaned.modules.filter((m) => m.id !== track.id)
  // A consist edit re-cuts the bed; it must not silently refuse on a wall.
  return commitTrackRaw({ ...cleaned, modules }, resized)
}

/** Read-only summary for the rail panel: length, consist and derived doors. */
export function railSummary(track: TrackModule, line: LineDef | undefined): {
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
