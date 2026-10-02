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
//     of the opening (`rampCorridorHalf`);
//   * pure data, no DOM, no three.

import type { Cell, Module, Vec3i } from './types.ts'
import { exitFloorAt } from './exits.ts'
import { STAIR_WIDTH_NORMAL, stairFlights, stairLandings } from './stairs.ts'

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
 * side of the run. An escalator's handrail sits at ±(W/2 + 0.03) with a 0.1
 * section, so its corridor is 1.2 m overall.
 */
const ESCALATOR_CORRIDOR_HALF = 0.6
/** A stair handrail runs this far proud of the tread edge, metres. */
const STAIR_RAIL_PROUD = 0.105

/**
 * Half-width a ramp sweeps, including its balustrade and handrail. Carving only
 * the tread width leaves the rails — which sit proud of the treads — poking
 * through the blocks to the left and right of the opening.
 */
export function rampCorridorHalf(m: Module): number {
  if (m.type === 'stair') return (m.cfg.width ?? STAIR_WIDTH_NORMAL) / 2 + STAIR_RAIL_PROUD
  return ESCALATOR_CORRIDOR_HALF
}

/* ------------------------------------------------------- ramp collision box */

/** Half-width of a ramp's envelope, metres (an escalator is ~1.2 m overall). */
const RAMP_HALF = 0.7
/** Truss depth below the walking line, metres. */
const RAMP_FOOT = 0.5
/** Balustrade height above the walking line, metres. */
const RAMP_HEADROOM = 1.2
/** Padding so two ramps in adjacent columns do not read as touching. */
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
  // A stair is as wide as its treads; an escalator keeps its balustrade half.
  const half = m.type === 'stair' ? Math.max(RAMP_HALF, (m.cfg.width ?? STAIR_WIDTH_NORMAL) / 2) : RAMP_HALF
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
    x0: x0 - half - RAMP_CLEAR,
    x1: x1 + half + RAMP_CLEAR,
    y0: y0 - half - RAMP_CLEAR,
    y1: y1 + half + RAMP_CLEAR,
    z0: lo + 1 - RAMP_FOOT - RAMP_CLEAR,
    z1: hi + 1 + RAMP_HEADROOM + RAMP_CLEAR,
  }
}

function boxesOverlap(a: RampBox, b: RampBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0
}

/**
 * True when a candidate ramp would share space with an existing one — the rule
 * that stops a second escalator being dropped immediately below a first.
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
  /** Half-width of the swept corridor, handrails included, metres. */
  half: number
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
  const half = rampCorridorHalf(m)
  if (m.type === 'escalator' || m.type === 'lift') return [{ from: m.from, to: m.to, half }]
  if (m.type === 'stair') return stairFlights(m).map((s) => ({ from: s.from, to: s.to, half }))
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
      const half = rampCorridorHalf(m)
      for (const s of stairFlights(m)) ramps.push({ from: s.from, to: s.to, half })
    } else if (m.type === 'escalator' || m.type === 'lift') {
      const headroom = m.type === 'escalator' ? ESCALATOR_HEADROOM : undefined
      ramps.push({ from: m.from, to: m.to, headroom, half: rampCorridorHalf(m) })
    }
  }
  return ramps
}

/**
 * True when a solid cell intrudes into the headroom above a ramp's walking
 * line — i.e. the ramp has to pass through it to surface. `headroom` is the
 * clearance above the line; escalators use ESCALATOR_HEADROOM so wall columns
 * along the way are removed, stairs keep the conservative HEADROOM.
 */
function intrudes(c: Cell, r: Ramp): boolean {
  const ax = r.from.x + 0.5
  const ay = r.from.y + 0.5
  const az = r.from.z + 1
  const dx = r.to.x + 0.5 - ax
  const dy = r.to.y + 0.5 - ay
  const len2 = dx * dx + dy * dy
  // A vertical run (lift) has no horizontal sweep: nothing to carve.
  if (len2 < 1e-6) return false
  const px = c.x + 0.5
  const py = c.y + 0.5
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0 || t > 1) return false
  const lateral = Math.abs((px - ax) * dy - (py - ay) * dx) / Math.sqrt(len2)
  // The handrail sweeps `r.half` each side of the centreline. A cell is in the
  // way when its nearest edge — half a cell closer than its centre — falls
  // inside that, so the blocks to the left and right are removed too.
  if (Math.max(0, lateral - 0.5) > r.half) return false
  const h = az + (r.to.z + 1 - az) * t
  const headroom = r.headroom ?? HEADROOM
  // Above the line (so the ramp surfaces through it) but within headroom, and
  // strictly inside the cell rather than exactly at its top (the landing).
  return c.z + 1 > h + EPS && c.z < h + headroom
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
