// Ramps vs solid ground — GAME-SPEC §5.4 / §5.5.
//
// An escalator, stair or lift is placed as a `from`→`to` run, but the floor it
// climbs through has no opening in the cell data. Left alone, the ramp body
// draws straight through the slab ("escalators punching through solid ground").
//
// `carveRampOpenings` removes the solid cells a ramp passes through, so the run
// emerges from a real opening. It is deliberately conservative for stairs:
//   * only cells the ramp actually cuts *above its walking line* are removed;
//     the landing cells at both ends are kept, because the station graph needs
//     them as the ramp's edge nodes;
//   * a vertical run (a lift shaft) is left alone — it spans the same column,
//     so there is nothing to carve cell-by-cell;
//   * an escalator cuts a taller corridor (ESCALATOR_HEADROOM) along its run,
//     so ceiling slabs and wall columns in the way are removed automatically.
//     Placement only needs both landings to be solid floor;
//   * the corridor is as wide as the whole assembly — balustrades and handrails
//     included — so the rails never surface through the blocks left and right
//     of the opening (`rampCorridorHalf`). Every piece is built to fit one cell,
//     so that corridor never reaches into the cell next door;
//   * pure data, no DOM, no three.

import { isWallBlock, type Cell, type Module, type Vec3i } from './types.ts'
import { ESCALATOR_BAND, ESCALATOR_RAIL_PROUD, STAIR_RAIL_PROUD } from './constants.ts'
import { exitFloorAt } from './exits.ts'
import { STAIR_WIDTH_NARROW, stairFlights, stairLandings } from './stairs.ts'

/** Headroom above the walking line that must be clear, metres. */
const HEADROOM = 1.3
/**
 * Clearance an escalator cuts along its run, metres. Tall enough to clear a
 * person and the balustrade and to take out the storey's wall columns above the
 * walking line, so a run can punch through a wall as long as both landings are
 * solid floor. It must not reach the slab of the storey *above* the one the run
 * lands on: a run stops on top of a floor, so everything higher than headroom
 * over the landing belongs to the room it lands in, not to the shaft. The old
 * 3.2 m over-carve reached the concourse roof above the platform runs and the
 * plaza above the exit runs, punching holes in slabs the run never meets.
 * Stairs keep the conservative HEADROOM.
 */
export const ESCALATOR_HEADROOM = 2.2

/**
 * Tag on the lowest solid block directly above a column a ramp carve opened: it
 * is the opening's ceiling, not a plate hanging in space. The level slicer
 * (`render/scene.ts`) cuts it with the rest of the ceiling instead of ghosting
 * it over the active storey.
 */
export const OPENING_CEILING = 'opening-ceiling'
/** A cell must clear the line by this much before it counts as an obstruction. */
const EPS = 0.02
/**
 * The handrail sweeps wider than the treads, so the opening has to clear the
 * whole assembly or the rails emerge through the floor blocks directly either
 * side of the run. An escalator's handrail stands `ESCALATOR_RAIL_PROUD` (0.15 m:
 * a 0.03 stand-off from the glass plus the 0.1 handrail section, a hair clear of
 * the skirt) proud of its step band, so the run sweeps
 * `ESCALATOR_BAND / 2 + 0.15` — 0.49 m, inside its own 1 m cell rather than into
 * the next one. `sim/exits.ts` opens its wellways with the same two numbers.
 */
const ESCALATOR_CORRIDOR_HALF = ESCALATOR_BAND / 2 + ESCALATOR_RAIL_PROUD

/**
 * Half-width a ramp sweeps, including its balustrade and handrail. Carving only
 * the tread width leaves the rails — which sit proud of the treads — poking
 * through the blocks to the left and right of the opening. Both pieces are built
 * to fit one cell, so this stays under 0.5: a block or a wall standing beside a
 * run is never reached, never carved and never thinned.
 */
export function rampCorridorHalf(m: Module): number {
  if (m.type === 'stair') return (m.cfg.width ?? STAIR_WIDTH_NARROW) / 2 + STAIR_RAIL_PROUD
  return ESCALATOR_CORRIDOR_HALF
}

/**
 * Half-width of a ramp's physical body — the treads / step band, without the
 * handrail. A block whose cell the body only *partially* overlaps (a 1.6 m stair
 * reaches 0.3 m into the columns either side) is kept and drawn as a half-metre
 * panel so the run still fits beside it (`rampThinCells`).
 */
export function rampBodyHalf(m: Module): number {
  if (m.type === 'stair') return (m.cfg.width ?? STAIR_WIDTH_NARROW) / 2
  // The escalator's step band is the shared `ESCALATOR_BAND`, so its half is
  // 0.34 m — well inside one cell, so an adjacent cell is not carved.
  return ESCALATOR_BAND / 2
}

/**
 * Half-width of the *core* opening: the cells the run's centreline actually
 * passes through. Only these are carved (and reserved); every other block the
 * body or rail reaches is kept and thinned instead, so the floor beside a wide
 * stair is not deleted and stays buildable.
 */
export const RAMP_CORE_HALF = 0

/* ------------------------------------------------------- ramp collision box */

/**
 * Half-width a run reserves, metres: its own cell. A run is built to fit inside
 * one tile — body and handrails both — so its envelope is exactly that tile
 * column, and two runs in adjacent cells simply *touch*. The strict-overlap rule
 * therefore already lets a bank stand flush, with no special case: only a wider
 * piece (a 1.6 m stair, whose body genuinely crosses into the next cell) claims
 * more room than the tile it stands in.
 */
const RAMP_TILE_HALF = 0.5
/** Truss depth below the walking line, metres. */
const RAMP_FOOT = 0.5
/** Balustrade height above the walking line, metres. */
const RAMP_HEADROOM = 1.2
/** Vertical padding, so a run never reads as touching the storey above/below. */
const RAMP_CLEAR = 0.15

export interface RampBox {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

/**
 * The world-space bounding box a ramp occupies: its footprint widened by the
 * half-width, dropping the truss depth below the lower landing and rising the
 * balustrade above the higher one. A turning stair's box spans every flight, so
 * it reserves the whole corner it turns through.
 */
export function rampEnvelope(m: Module): RampBox | null {
  const segs = rampSegments(m)
  if (!segs) return null
  // A run reserves its own cell; only a body wider than a cell claims more.
  const half = Math.max(RAMP_TILE_HALF, rampBodyHalf(m))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let lo = Infinity
  let hi = -Infinity
  for (const s of segs) {
    const ax = s.from.x + 0.5
    const ay = s.from.y + 0.5
    const bx = s.to.x + 0.5
    const by = s.to.y + 0.5
    x0 = Math.min(x0, ax, bx)
    x1 = Math.max(x1, ax, bx)
    y0 = Math.min(y0, ay, by)
    y1 = Math.max(y1, ay, by)
    lo = Math.min(lo, s.from.z, s.to.z)
    hi = Math.max(hi, s.from.z, s.to.z)
  }
  return {
    x0: x0 - half,
    x1: x1 + half,
    y0: y0 - half,
    y1: y1 + half,
    z0: lo + 1 - RAMP_FOOT - RAMP_CLEAR,
    z1: hi + 1 + RAMP_HEADROOM + RAMP_CLEAR,
  }
}

function boxesOverlap(a: RampBox, b: RampBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0
}

/**
 * True when a candidate ramp would share space with an existing one — the rule
 * that stops a second escalator being dropped immediately below a first. Two
 * runs in adjacent cells are not a clash: each reserves its own tile, so their
 * boxes touch rather than overlap, and a bank of escalators and stairs stands
 * flush with every run keeping its own balustrade. That balustrade is also the
 * barrier the crowd walks around (`rampWalls` in `sim/station.ts`).
 */
export function rampBlocked(modules: readonly Module[], candidate: Module): boolean {
  const c = rampEnvelope(candidate)
  if (!c) return false
  for (const m of modules) {
    if (m === candidate || (candidate.id && m.id === candidate.id)) continue
    const e = rampEnvelope(m)
    if (e && boxesOverlap(c, e)) return true
  }
  return false
}

interface Ramp {
  from: Vec3i
  to: Vec3i
  /** Vertical clearance above the walking line this run carves, metres. */
  headroom?: number
  /** Half-width of the physical body (treads / step band), metres. */
  bodyHalf: number
  /** Half-width the handrail sweeps, metres. */
  railHalf: number
}

/**
 * Both ends of an escalator run must stand on solid floor — the lower base and
 * the upper landing — or on an exit's floor: any cell an exit covers counts,
 * even a hole a ramp carved there. Everything in between (ceiling slabs, wall
 * columns) is carved on placement, so intermediate solids never block it.
 */
export function escalatorBasesSolid(cells: readonly Cell[], modules: readonly Module[], m: Module): boolean {
  if (m.type !== 'escalator') return true
  const has = (p: Vec3i): boolean =>
    cells.some((c) => c.fill === 'solid' && c.x === p.x && c.y === p.y && c.z === p.z) || exitFloorAt(modules, p.x, p.y, p.z)
  return has(m.from) && has(m.to)
}

/**
 * The straight segments a ramp sweeps: an escalator or lift has one, a stair
 * has one per flight (its turn is a landing the flights meet at).
 */
function rampSegments(m: Module): Ramp[] | null {
  const bodyHalf = rampBodyHalf(m)
  const railHalf = rampCorridorHalf(m)
  if (m.type === 'escalator' || m.type === 'lift') return [{ from: m.from, to: m.to, bodyHalf, railHalf }]
  if (m.type === 'stair') return stairFlights(m).map((s) => ({ from: s.from, to: s.to, bodyHalf, railHalf }))
  return null
}

/**
 * Every corridor the placed ramps carve, with the per-type headroom `intrudes`
 * reads: an escalator cuts the taller wall/ceiling corridor, a stair or lift the
 * conservative one. The carve and the block-brush reservation share this single
 * list, so a hand-built block is refused in exactly the cells the carve opens.
 */
function rampList(modules: readonly Module[]): Ramp[] {
  const ramps: Ramp[] = []
  for (const m of modules) {
    if (m.type === 'stair') {
      const bodyHalf = rampBodyHalf(m)
      const railHalf = rampCorridorHalf(m)
      for (const s of stairFlights(m)) ramps.push({ from: s.from, to: s.to, bodyHalf, railHalf })
    } else if (m.type === 'escalator' || m.type === 'lift') {
      const headroom = m.type === 'escalator' ? ESCALATOR_HEADROOM : undefined
      ramps.push({ from: m.from, to: m.to, headroom, bodyHalf: rampBodyHalf(m), railHalf: rampCorridorHalf(m) })
    }
  }
  return ramps
}

/**
 * True when a solid cell lies within `half` of a ramp's centreline and above its
 * walking line by no more than the headroom — i.e. the run has to pass through
 * it. The lateral test uses the cell's *near edge* (half a cell closer than its
 * centre), so a block only counts when the swept half-width reaches into it.
 * `headroom` is the clearance above the line; escalators use
 * ESCALATOR_HEADROOM so wall columns along the way are cleared, stairs keep the
 * conservative HEADROOM. A vertical run (lift) has no sweep.
 */
function within(c: Cell, r: Ramp, half: number): boolean {
  const ax = r.from.x + 0.5
  const ay = r.from.y + 0.5
  const az = r.from.z + 1
  const dx = r.to.x + 0.5 - ax
  const dy = r.to.y + 0.5 - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return false
  const px = c.x + 0.5
  const py = c.y + 0.5
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0 || t > 1) return false
  const lateral = Math.abs((px - ax) * dy - (py - ay) * dx) / Math.sqrt(len2)
  if (Math.max(0, lateral - 0.5) > half) return false
  const h = az + (r.to.z + 1 - az) * t
  const headroom = r.headroom ?? HEADROOM
  // Above the line (so the ramp surfaces through it) but within headroom, and
  // strictly inside the cell rather than exactly at its top (the landing).
  return c.z + 1 > h + EPS && c.z < h + headroom
}

/**
 * The true opening: the cell the run's centreline passes through, so it must be
 * carved (a floor/ceiling) — unless it is a wall, which is kept and thinned.
 */
function intrudes(c: Cell, r: Ramp): boolean {
  return within(c, r, RAMP_CORE_HALF)
}

/**
 * A partial overlap: the ramp's body (or, for a wall, its handrail) reaches into
 * this cell. The block is kept and drawn half a metre thick instead of fully
 * carved, so a wide stair's side columns stay as floor and a railing fits
 * against a wall.
 */
function overlaps(c: Cell, r: Ramp, wall: boolean): boolean {
  return within(c, r, wall ? r.railHalf : r.bodyHalf)
}

/**
 * True when a hand-built solid block at `(x, y, z)` would sit inside a ramp's
 * opening — the corridor `carveRampOpenings` clears for a stair, escalator or
 * lift. The block brush asks this before it lays a cell, so a player cannot cover
 * up an auto-generated hole and seal a run in. A protected landing never answers
 * true: it sits exactly on the walking line, not above it.
 */
export function rampOpeningAt(modules: readonly Module[], x: number, y: number, z: number): boolean {
  if (modules.length === 0) return false
  const cell: Cell = { x, y, z, fill: 'solid' }
  for (const r of rampList(modules)) {
    if (intrudes(cell, r)) return true
  }
  return false
}

/**
 * Remove every solid cell that a ramp passes through, in place. Returns how many
 * were removed. Safe to call more than once (idempotent once carved).
 */
export function carveRampOpenings(cells: Cell[], modules: readonly Module[]): number {
  const ramps = rampList(modules)
  // Landing cells are the ramp's graph nodes; never carve them, even when two
  // runs share a column (an up and a down escalator side by side), and never
  // carve a stair's half/quarter landing between two flights.
  const protect = new Set<string>()
  const protectPoint = (p: Vec3i): void => {
    protect.add(`${p.x},${p.y},${p.z}`)
  }
  for (const m of modules) {
    if (m.type === 'stair') {
      // A stair's half/quarter landings are its interior graph nodes — never carve them.
      for (const p of stairLandings(m)) protectPoint(p)
    } else if (m.type === 'escalator' || m.type === 'lift') {
      // An escalator cuts the full wall/ceiling corridor along its run; only
      // its two landing cells are kept as graph nodes.
      protectPoint(m.from)
      protectPoint(m.to)
    }
  }
  if (ramps.length === 0) return 0
  const kill = new Set<number>()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (c.fill !== 'solid') continue
    if (protect.has(`${c.x},${c.y},${c.z}`)) continue
    // A wall is never carved: the ramp's rail is allowed to touch it. It is
    // drawn half a metre thick instead (`rampThinWalls`), so the wall stays
    // solid and the run still fits beside it.
    if (isWallBlock(c)) continue
    for (const r of ramps) {
      if (intrudes(c, r)) {
        kill.add(i)
        break
      }
    }
  }
  if (kill.size === 0) return 0
  // Remember how high the carve opened each column, before compaction.
  const opened = new Map<string, number>()
  for (const i of kill) {
    const c = cells[i]
    const col = `${c.x},${c.y}`
    const prev = opened.get(col)
    if (prev === undefined || c.z > prev) opened.set(col, c.z)
  }
  let w = 0
  for (let i = 0; i < cells.length; i++) {
    if (kill.has(i)) continue
    cells[w++] = cells[i]
  }
  cells.length = w
  // Tag the lowest solid block left directly above each opening. Removing the
  // support leaves it looking like a plate hanging in space, but it is really
  // the ceiling over the shaft and must be cut with the storey it covers.
  const ceiling = new Map<string, number>()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const openedZ = opened.get(`${c.x},${c.y}`)
    if (openedZ === undefined || c.z <= openedZ) continue
    const prev = ceiling.get(`${c.x},${c.y}`)
    if (prev === undefined || c.z < cells[prev].z) ceiling.set(`${c.x},${c.y}`, i)
  }
  for (const i of ceiling.values()) {
    const c = cells[i]
    if (c.tags?.includes(OPENING_CEILING)) continue
    cells[i] = { ...c, tags: [...(c.tags ?? []), OPENING_CEILING] }
  }
  return kill.size
}

/**
 * One solid block a ramp has kept and must draw half a metre thick: a wall the
 * handrail touches (`kind: 'wall'`), or a floor block a wide stair's body
 * partially enters (`kind: 'floor'`).
 */
export interface RampThin {
  x: number
  y: number
  z: number
  /**
   * Unit step from the ramp outward to the keep-half of the cell: [1,0] when the
   * ramp is on the −x side, [−1,0] when it is on +x, and the same for y. The half
   * a metre nearest the ramp is left clear for the body and its handrail.
   */
  side: [number, number]
  kind: 'wall' | 'floor'
}

/** The outward side of a cell from a ramp segment, snapped to the dominant axis. */
function outwardSide(c: Cell, r: Ramp): [number, number] | null {
  const ax = r.from.x + 0.5
  const ay = r.from.y + 0.5
  const dx = r.to.x + 0.5 - ax
  const dy = r.to.y + 0.5 - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return null
  const px = c.x + 0.5
  const py = c.y + 0.5
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  const cx = ax + t * dx
  const cy = ay + t * dy
  let nx = -dy
  let ny = dx
  const nl = Math.hypot(nx, ny)
  if (nl < 1e-6) return null
  nx /= nl
  ny /= nl
  const d = (px - cx) * nx + (py - cy) * ny
  if (Math.abs(d) < 1e-3) return null
  const s = d > 0 ? 1 : -1
  if (Math.abs(nx) >= Math.abs(ny)) return [nx * s > 0 ? 1 : -1, 0]
  return [0, ny * s > 0 ? 1 : -1]
}

/**
 * Every solid block a ramp has kept, with the side the half-metre panel goes on.
 * The renderer hides the full voxel and draws this panel instead (the same trick
 * a facility room uses), so the run's body and handrail sit in the clear half
 * while the block the player built stays solid. A wall is thinned when the
 * handrail reaches it; a floor is thinned only when the body genuinely reaches
 * past its cell boundary (a wide stair — an escalator's 0.9 m band does not, so
 * its side floor stays a full block). Derived from cells+modules, so it follows
 * an edit without the document storing anything extra.
 */
export function rampThinCells(cells: readonly Cell[], modules: readonly Module[]): RampThin[] {
  const ramps = rampList(modules)
  if (ramps.length === 0) return []
  const out: RampThin[] = []
  for (const cell of cells) {
    if (cell.fill !== 'solid') continue
    const wall = isWallBlock(cell)
    for (const r of ramps) {
      if (!overlaps(cell, r, wall)) continue
      // A non-wall block only needs thinning when the body crosses into it; if
      // the body stays within its own cell, a full block is the correct floor.
      if (!wall && r.bodyHalf <= 0.5 + 1e-9) continue
      const side = outwardSide(cell, r)
      if (side) out.push({ x: cell.x, y: cell.y, z: cell.z, side, kind: wall ? 'wall' : 'floor' })
      break
    }
  }
  return out
}
