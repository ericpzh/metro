// Staircase geometry — GAME-SPEC.md §5.1.
//
// A stair climbs exactly one storey, like an escalator, but it is walkable in
// both directions and it can turn. The turn is real, not a texture: each flight
// is a capacity-limited graph edge and each half/quarter landing is a walkable
// node between them, so the crowd visibly walks the corner.
//
// The module keeps `from`/`to` so every consumer that treats a stair as a plain
// run still works, and `cfg.flights` as the authoritative list of segments.
// A straight stair declares no flights, and this helper returns the single
// implied run. Pure data — no three, no DOM.

import { ESCALATOR_BAND, STAIR_RAIL_PROUD } from './constants.ts'
import type { Cell, Module, StairFlight, StairStyle, Vec3i } from './types.ts'

export type { StairFlight, StairStyle } from './types.ts'

type StairModule = Extract<Module, { type: 'stair' }>

/**
 * The three widths a stair comes in, cycled with Tab in the builder. Every one is
 * a whole number of **lanes**, each exactly the escalator's step band
 * (`ESCALATOR_BAND`): one lane fits one 1 m cell, handrails included, so a lane
 * stands flush against an escalator or another lane and the pair reads as one
 * bank (§5.1). A wide stair is literally `lanes` narrow stairs side by side —
 * the builder drops one lane piece per cell — so the middle of a wide flight
 * wears the same two balustrades a stair next to an escalator does.
 *
 * `STAIR_WIDTHS` is the tool's setting: the *total* tread width it lays down.
 */
export const STAIR_WIDTH_NARROW = ESCALATOR_BAND
export const STAIR_WIDTH_DOUBLE = 2 * ESCALATOR_BAND
export const STAIR_WIDTH_TRIPLE = 3 * ESCALATOR_BAND
export const STAIR_WIDTHS: readonly number[] = [STAIR_WIDTH_NARROW, STAIR_WIDTH_DOUBLE, STAIR_WIDTH_TRIPLE]

/** The most lanes one stair may be built from (the 3-block width). */
export const STAIR_LANES_MAX = 3

/** The next stair width in the cycle (narrow → double → triple → narrow). */
export function nextStairWidth(width: number): number {
  const i = STAIR_WIDTHS.findIndex((w) => Math.abs(w - width) < 0.05)
  return STAIR_WIDTHS[(i + 1 + STAIR_WIDTHS.length) % STAIR_WIDTHS.length]
}

/**
 * The lanes a tool width lays down: one per escalator band, 1 to
 * `STAIR_LANES_MAX`. A width that is not a whole number of lanes (a station saved
 * with the old 1.6 m stair) reads as the nearest one.
 */
export function stairLanes(width: number): number {
  const lanes = Math.round(width / ESCALATOR_BAND)
  return Math.max(1, Math.min(STAIR_LANES_MAX, lanes))
}

/**
 * A placeable straight stair is a fixed piece, exactly one storey: this many
 * cells of horizontal run for this many blocks of climb (GAME-SPEC's 3 × 6 m
 * footprint, rounded to the 4-block storey grid). The base cell is the lower
 * landing; the run direction follows the placement rotation.
 */
export const STAIR_RUN = 6
export const STAIR_RISE = 4

/**
 * How far a flight's treads stop short of each landing **centre**, metres: half a
 * landing cell at any real flight length, and the reason a run's landing tiles are
 * floor rather than treads. `render/models.ts` lays the treads with this (`inner`)
 * and `sim/openings.ts` reserves that exact space with it (`rampBodyBoxes`), so
 * the drawn flight and the collision body can never disagree: a 3-cell turn flight
 * and a 6-cell straight one alike stop at the edge of the floor they leave and the
 * floor they reach. Without the trim the top tread is coplanar with the landing
 * slab and z-fights it.
 */
export function stairTreadTrim(run: number): number {
  return Math.min(0.5, Math.max(0, (run - 0.4) / 2))
}

/** The unit cell step a stair runs in, for a placement rotation 0..3. */
export function stairFacing(rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 0:
      return [0, 1]
    case 1:
      return [1, 0]
    case 2:
      return [0, -1]
    default:
      return [-1, 0]
  }
}

/**
 * The placement rotation whose run faces the unit step `[dx, dy]` (the inverse
 * of `stairFacing`). Used to lay a run whose direction is already known — a ramp
 * snapped into an exit bay climbs toward the head-house's own +y. Falls back to
 * 0 for a non-axis step, which callers never pass.
 */
export function stairRotFor(dx: number, dy: number): number {
  for (let r = 0; r < 4; r++) {
    const [fx, fy] = stairFacing(r)
    if (fx === dx && fy === dy) return r
  }
  return 0
}

/**
 * The unit step to the right of a run's own direction — the axis its **lanes**
 * (and a switchback's second flight) are laid along. One source, so the lanes the
 * builder drops and the flights `stairFlightsFor` builds always agree.
 */
export function stairRight(rot: number): [number, number] {
  const [fx, fy] = stairFacing(rot)
  const rx = fy
  const ry = -fx
  // Normalise −0 to 0, so callers (and their tests) see plain integers.
  return [rx === 0 ? 0 : rx, ry === 0 ? 0 : ry]
}

/**
 * The lane bases a stair laid at `base` covers: `lanes` cells along
 * `stairRight(rot)`, so lane `i` is a lane-wide stair of its own in the cell next
 * to lane `i − 1`. A one-lane stair (the narrow piece) is just `base`.
 */
export function stairLaneBases(base: Vec3i, rot: number, lanes: number): Vec3i[] {
  const [rx, ry] = stairRight(rot)
  const out: Vec3i[] = []
  for (let i = 0; i < lanes; i++) out.push({ x: base.x + rx * i, y: base.y + ry * i, z: base.z })
  return out
}

/**
 * Where a multi-lane stair goes, given the cell under the pointer. A wide stair
 * covers more than one cell, so the pointer's cell is ambiguous: the plan tries
 * it as the **first** lane (growing along `stairRight`), then shifted back one
 * lane at a time, and takes the first arrangement whose every lane is placeable
 * — so a wide flight dropped next to a stair on its left lands on the right of
 * it, dropped next to one on its right lands on the left of it, and a flight
 * dropped into a gap fills the gap, without the player counting cells.
 *
 * With no arrangement free, the first candidate comes back with `free: false`, so
 * the ghost shows the same red refusal a single piece would.
 */
export interface StairLanePlan {
  /** The lane bases, in order along the run's right. */
  lanes: Vec3i[]
  /** True when every lane passed `placeable`. */
  free: boolean
}

export function planStairLanes(
  base: Vec3i,
  rot: number,
  lanes: number,
  placeable: (p: Vec3i) => boolean,
): StairLanePlan {
  const [rx, ry] = stairRight(rot)
  const at = (back: number, i: number): Vec3i => ({ x: base.x + rx * (i - back), y: base.y + ry * (i - back), z: base.z })
  for (let back = 0; back < lanes; back++) {
    const cells: Vec3i[] = []
    let free = true
    for (let i = 0; i < lanes; i++) {
      const p = at(back, i)
      cells.push(p)
      if (!placeable(p)) free = false
    }
    if (free) return { lanes: cells, free: true }
  }
  const cells: Vec3i[] = []
  for (let i = 0; i < lanes; i++) cells.push(at(0, i))
  return { lanes: cells, free: false }
}

/** Per-flight run and rise: a turn is two half-storey flights at the same slope. */
export const STAIR_FLIGHT_RUN = 3
export const STAIR_FLIGHT_RISE = 2

/** A stair lane of the same flight standing right beside this one. */
export interface StairLaneMate {
  mate: Module
  /** World unit step from this lane's cell to the mate's. */
  step: [number, number]
  /** Which side of the run the mate stands on: −1 left, +1 right. */
  side: -1 | 1
  /**
   * True when the two lanes carry the same `cfg.flight` token — they were placed
   * as one wide stair. Two lanes that merely stand next to each other have their
   * steps joined but keep their own rails.
   */
  sameFlight: boolean
}

/**
 * The one-block straight lanes standing flush beside `m`. Two lanes side by side
 * are **adjacent flights whose steps meet**: each one's treads and risers run out
 * to the cell edge, so there is never a gap between them. Whether they are also
 * *one staircase* — no rail along the seam — is a property of the pieces, not of
 * their being neighbours: only lanes carrying the same `cfg.flight` token (the
 * builder stamps one on every lane of a wide stair it lays in a single action)
 * count as one flight. Two narrow stairs dropped separately keep their rails, so
 * two 0.7 m stairs are two staircases and a 1.4 m stair is one.
 *
 * Only one-block straight flights take part — a turning stair, or a saved
 * single-piece wide stair, is a flight of its own.
 */
export function stairLaneMates(modules: readonly Module[], m: Module): StairLaneMate[] {
  const mine = laneSpan(m)
  if (!mine) return []
  const out: StairLaneMate[] = []
  for (const other of modules) {
    if (other === m || (m.id && other.id === m.id)) continue
    const theirs = laneSpan(other)
    if (!theirs) continue
    if (theirs.lower.z !== mine.lower.z || theirs.upper.z !== mine.upper.z) continue
    // Parallel (either way round): a lane crossing under a perpendicular one is
    // not part of the same flight.
    if (theirs.axis[0] * mine.axis[0] + theirs.axis[1] * mine.axis[1] === 0) continue
    const dx = theirs.lower.x - mine.lower.x
    const dy = theirs.lower.y - mine.lower.y
    if (Math.abs(dx) + Math.abs(dy) !== 1) continue
    // Exactly across the run, not stepped along it.
    if (dx * mine.axis[0] + dy * mine.axis[1] !== 0) continue
    const side = dx * mine.axis[1] - dy * mine.axis[0]
    const token = mine.flight
    out.push({
      mate: other,
      step: [dx, dy],
      side: side > 0 ? 1 : -1,
      sameFlight: !!token && token === theirs.flight,
    })
  }
  return out
}

/**
 * The one-block straight span a lane runs over, or null when the piece is not a
 * lane. The span is ordered bottom → top, so the travel direction never enters
 * the geometry.
 */
function laneSpan(m: Module): { lower: Vec3i; upper: Vec3i; axis: [number, number]; flight?: string } | null {
  if (m.type !== 'stair') return null
  if ((m.cfg.width ?? STAIR_WIDTH_NARROW) > STAIR_WIDTH_NARROW + 1e-9) return null
  const flights = stairFlights(m)
  if (flights.length !== 1) return null
  const f = flights[0]
  if (f.from.z === f.to.z) return null
  const dx = f.to.x - f.from.x
  const dy = f.to.y - f.from.y
  let axis: [number, number]
  if (dx !== 0 && dy === 0) axis = [Math.sign(dx), 0]
  else if (dy !== 0 && dx === 0) axis = [0, Math.sign(dy)]
  else return null
  const lower = f.from.z < f.to.z ? f.from : f.to
  const upper = f.from.z < f.to.z ? f.to : f.from
  return { lower, upper, axis, flight: m.cfg.flight }
}

/**
 * The sides of one flight a wall hugs, in the run's own frame: `left` is the
 * side the run's local `+y` points at (`-stairRight`), `right` the `stairRight`
 * one — the sides `buildStairFlight` builds numbered `+1` and `-1`.
 */
export interface StairWallSides {
  left: boolean
  right: boolean
}

/**
 * Which sides of one flight a **wall hugs from bottom to top** — the sides that
 * need no handrail of their own, because the wall beside them is already the
 * barrier. `buildStair` asks this per flight and drops the rail, its posts and
 * its newel return on a walled side, keeping the stringer the treads meet.
 *
 * A side counts only when the wall runs the flight's **whole length**: every cell
 * the run passes beside must hold a solid block at the height the flight is at
 * when it passes it, so a wall that stops at the half-landing, a stump that only
 * reaches the first few steps, a doorway punched through one course, or a wall
 * standing only on the storey above leaves the rail on. The block is read at each
 * cell's own height — a flight climbs the whole storey over the run — so a
 * two-course stump beside the top of the stairs is not a wall to lean on.
 *
 * "Wall" is any **solid** cell, not only a tagged one: this engine draws every
 * solid cube the same and records who laid a wall in `tags` alone, and the top
 * course of a storey's wall often shares its cell with the floor slab above it,
 * which the auto-wall ring then leaves as floor. A handrail dropped because that
 * slab is there is right: the flight's last steps really do run into it.
 *
 * A flight not laid along a cell axis — nothing a placed stair produces — has no
 * cells to read beside it, so it answers no walls and keeps both of its rails.
 */
export function stairWallSides(cells: readonly Cell[], from: Vec3i, to: Vec3i, slide?: StairFlightSlide): StairWallSides {
  const none: StairWallSides = { left: false, right: false }
  const low = from.z <= to.z ? from : to
  const high = from.z <= to.z ? to : from
  const dx = high.x - low.x
  const dy = high.y - low.y
  const run = Math.hypot(dx, dy)
  const rise = high.z - low.z
  if (run < 1e-6 || rise < 1e-3) return none
  const ux = dx / run
  const uy = dy / run
  if (Math.abs(Math.abs(ux) + Math.abs(uy) - 1) > 1e-6) return none

  // One probe per cell of the run per side: the cell the flight passes beside,
  // and the block its walking line is in as it passes. The flight stands on its
  // lower landing's surface (`z + 1`) and climbs `rise` over the run, so the
  // course is interpolated and clamped to the flight's own landing — never taken
  // from the base, or a wall only beside the bottom steps would read as a wall
  // the whole way up.
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`
  const left = new Set<string>()
  const right = new Set<string>()
  const sx = slide?.dx ?? 0
  const sy = slide?.dy ?? 0
  const n = Math.max(1, Math.round(run))
  for (let i = 0; i < n; i++) {
    // The cell the flight's **treads** pass through, not the cell its walking line
    // does: a switchback's return run is slid flush, so it leans on the wall beside
    // the band, not on the wall beside the landing column.
    const cx = low.x + Math.round(ux * i + sx)
    const cy = low.y + Math.round(uy * i + sy)
    const z = Math.min(Math.floor(low.z + 1 + ((i + 0.5) / run) * rise + 1e-9), high.z)
    left.add(key(cx - Math.round(uy), cy + Math.round(ux), z))
    right.add(key(cx + Math.round(uy), cy - Math.round(ux), z))
  }
  const heldLeft = new Set<string>()
  const heldRight = new Set<string>()
  for (const c of cells) {
    if (c.fill !== 'solid') continue
    const k = key(c.x, c.y, c.z)
    if (left.has(k)) heldLeft.add(k)
    if (right.has(k)) heldRight.add(k)
  }
  return { left: heldLeft.size === left.size, right: heldRight.size === right.size }
}

/**
 * The fixed flights a placed stair of `style` runs from `base`, turned by the
 * placement rotation. Every flight climbs at the same slope; a `90` turns one
 * way or the other at the half-landing, and the `180`s are switchbacks whose
 * two flights are parallel with the landing between them — the return flight
 * laid `stairSwitchbackOffset(width)` cells across, so no empty column is left
 * between the runs.
 *
 * `width` is only read by a switchback (its two flights are side by side, so
 * the stair's own width is what separates them); every other shape is a fixed
 * footprint whatever the tool is set to.
 */
export function stairFlightsFor(base: Vec3i, rot: number, style: StairStyle, width = STAIR_WIDTH_NARROW): StairFlight[] {
  const [fx, fy] = stairFacing(rot)
  const [rx, ry] = stairRight(rot)
  const at = (df: number, dr: number, dz: number): Vec3i => ({
    x: base.x + fx * df + rx * dr,
    y: base.y + fy * df + ry * dr,
    z: base.z + dz,
  })
  // The two flights of a switchback lie flush: the return run steps across by
  // one cell per lane, so the well between them is only as wide as the bodies
  // themselves leave and the assembly covers `lanes + 1` cells across.
  const span = stairSwitchbackOffset(width)
  switch (style) {
    case 'right90':
      return [
        { from: base, to: at(STAIR_FLIGHT_RUN, 0, STAIR_FLIGHT_RISE) },
        { from: at(STAIR_FLIGHT_RUN, 0, STAIR_FLIGHT_RISE), to: at(STAIR_FLIGHT_RUN, STAIR_FLIGHT_RUN, STAIR_RISE) },
      ]
    case 'left90':
      return [
        { from: base, to: at(STAIR_FLIGHT_RUN, 0, STAIR_FLIGHT_RISE) },
        { from: at(STAIR_FLIGHT_RUN, 0, STAIR_FLIGHT_RISE), to: at(STAIR_FLIGHT_RUN, -STAIR_FLIGHT_RUN, STAIR_RISE) },
      ]
    case 'right180':
      return [
        { from: base, to: at(STAIR_FLIGHT_RUN, 0, STAIR_FLIGHT_RISE) },
        { from: at(STAIR_FLIGHT_RUN, span, STAIR_FLIGHT_RISE), to: at(0, span, STAIR_RISE) },
      ]
    case 'left180':
      return [
        { from: base, to: at(STAIR_FLIGHT_RUN, 0, STAIR_FLIGHT_RISE) },
        { from: at(STAIR_FLIGHT_RUN, -span, STAIR_FLIGHT_RISE), to: at(0, -span, STAIR_RISE) },
      ]
    case 'straight':
    default:
      return [{ from: base, to: at(STAIR_RUN, 0, STAIR_RISE) }]
  }
}

/**
 * How far the returning flight of a switchback (`right180` / `left180`) lies
 * from the first, in cells: **one cell per lane** of the stair's width.
 *
 * The two runs of a 双跑楼梯 are laid in neighbouring columns — there is no
 * wasted column between them, and no gap a whole cell wide — so the half-landing
 * they meet on covers one cell per lane *plus* the cell the two flights share,
 * and it is the same "right of forward" step `stairLaneBases` walks a wide
 * straight stair along, so a switchback and a bank of lanes stand on one grid.
 *
 * The cell step is the nearest the *paths* can stand, not the nearest the treads
 * can: a run 0.68 m of lane wide leaves that much of the step over. What closes
 * the rest is `stairReturnSlide` — the return run's treads slide across until its
 * balustrade meets the first run's, so the pair really does stand flush.
 */
export function stairSwitchbackOffset(width: number = STAIR_WIDTH_NARROW): number {
  return stairLanes(width)
}

/**
 * How far apart a switchback's two runs stand, **tread centre to tread centre**,
 * in cells: the run's own width plus the two balustrades that stand between them
 * (`STAIR_RAIL_PROUD` is the outer face of a handrail). Laid at this separation
 * the two runs' handrails meet back to back on the seam — the shared centre
 * balustrade a real 双跑楼梯 has — so no floor at all is left between the runs.
 */
export function stairSwitchbackGap(width: number = STAIR_WIDTH_NARROW): number {
  return width + 2 * STAIR_RAIL_PROUD
}

/**
 * How far a walker's line stays clear of a tread's edge, metres: the limit a
 * `stairReturnSlide` may push the stair's own walking line to.
 */
const STAIR_WALK_CLEARANCE = 0.25

/**
 * How far a switchback's **returning flight's treads** slide toward the first
 * run, in cells, so that the two balustrades meet: the cell step its path is laid
 * on (`stairSwitchbackOffset`) less the separation the treads want
 * (`stairSwitchbackGap`) — 0.09 / 0.43 / 0.75 cells at one, two and three lanes.
 *
 * The paths stay on the grid — the half-landing is one cell per lane plus the one
 * the pair shares, and both flights join the graph on cells — so what moves is
 * only the drawn tread band, its balustrade and its collision body. That is the
 * whole of "the runs stand flush": this is what turns a 1.4 m switchback from
 * five blocks of floor into four, and a 2 m one from six into five, and what
 * takes the corridor out of the middle of the stair.
 *
 * The slide is capped so the flight's own walking line never ends up outside the
 * flight: a width that is already nearly a whole number of cells (the narrow
 * 0.7 m run) leaves so little step that the treads barely move.
 *
 * `offset` is the separation the two paths were actually laid at, so a station
 * saved before the runs were flush — an old switchback, its flights three cells
 * apart — tightens as far as its own layout allows and no further.
 */
export function stairReturnSlide(offset: number, width: number = STAIR_WIDTH_NARROW): number {
  const step = offset - stairSwitchbackGap(width)
  const limit = Math.max(0, width / 2 - STAIR_WALK_CLEARANCE)
  return Math.max(0, Math.min(step, limit))
}

/** The ordered flight segments of a stair, bottom → top. */
export function stairFlights(m: StairModule): StairFlight[] {
  return m.cfg.flights && m.cfg.flights.length > 0 ? m.cfg.flights : [{ from: m.from, to: m.to }]
}

/**
 * Every distinct landing cell the stair touches. These are the stair's graph
 * nodes and the cells a carve must never remove (a switchback's two flights
 * land on different cells, and both are protected).
 */
export function stairLandings(m: StairModule): Vec3i[] {
  const out: Vec3i[] = []
  const seen = new Set<string>()
  for (const f of stairFlights(m)) {
    for (const p of [f.from, f.to]) {
      const k = `${p.x},${p.y},${p.z}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
  }
  return out
}

/** The distinct floor heights a stair reaches, for level slicing. */
export function stairLevels(m: StairModule): number[] {
  const zs = stairLandings(m).map((p) => p.z)
  return [...new Set(zs)].sort((a, b) => a - b)
}

/**
 * The interior turn landings of a stair: each pair of consecutive flights and
 * the landing they meet on. A 90° turn lands on one cell (a = b); a 180°
 * switchback lands on the row of cells between the two flight ends — one cell
 * per lane plus the one the pair shares (`stairSwitchbackOffset`).
 */
export function stairTurnConnectors(m: StairModule): Array<{ a: Vec3i; b: Vec3i }> {
  const flights = stairFlights(m)
  const out: Array<{ a: Vec3i; b: Vec3i }> = []
  for (let i = 0; i + 1 < flights.length; i++) out.push({ a: flights[i].to, b: flights[i + 1].from })
  return out
}

/** The world-cell slide of one flight's tread band, from its own walking line. */
export interface StairFlightSlide {
  dx: number
  dy: number
}

/** No slide: the flight's treads are centred on its walking line. */
const NO_SLIDE: StairFlightSlide = { dx: 0, dy: 0 }

/**
 * How far each flight's **treads** are slid across from its own walking line, in
 * cells — one entry per flight, in the same order as `stairFlights`.
 *
 * Only a switchback moves: its first run stands on the cell it was placed on,
 * exactly as a straight stair does, and its **returning** flight slides toward it
 * until the two balustrades meet (`stairReturnSlide`), which is what takes the
 * wasted floor out of the middle of the stair. Everything drawn, carved,
 * reserved and barred for that flight follows the band, so the handrail the crowd
 * walks along is the handrail it can see; the flight's *landings* stay on the
 * cells they were laid on, so the graph and the half-landing do not move.
 */
export function stairFlightSlides(m: StairModule): StairFlightSlide[] {
  const flights = stairFlights(m)
  const out: StairFlightSlide[] = flights.map(() => NO_SLIDE)
  if (flights.length !== 2) return out
  const width = m.cfg.width ?? STAIR_WIDTH_NARROW
  const [first, second] = flights
  // The across step from the first flight's line to the second's: both flights
  // are straight, so this is the run's right (`stairRight` of the run direction).
  const rx = second.from.x - first.from.x
  const ry = second.from.y - first.from.y
  const run = Math.hypot(first.to.x - first.from.x, first.to.y - first.from.y)
  if (run < 1e-6) return out
  const ux = (first.to.x - first.from.x) / run
  const uy = (first.to.y - first.from.y) / run
  // Component of the step across the run, in cells; its sign says which hand the
  // return flight is on.
  const across = rx * -uy + ry * ux
  const offset = Math.abs(across)
  const slide = stairReturnSlide(offset, width)
  if (slide < 1e-6) return out
  const side = across === 0 ? 0 : across > 0 ? -1 : 1 // slide back toward the first run
  const dx = -uy * side * slide
  const dy = ux * side * slide
  // Normalise −0 to 0, so callers (and their tests) see plain numbers.
  out[1] = { dx: dx === 0 ? 0 : dx, dy: dy === 0 ? 0 : dy }
  return out
}

/**
 * Every cell an interior turn landing covers. These are the cells the builder
 * keeps as walkable nodes but the renderer hands to the stair model, so the
 * landing is drawn as a stair platform instead of a reused floor block.
 *
 * The row runs between the two flight ends, and it is as wide as the **treads**
 * that end there: a switchback's return run is slid flush (`stairFlightSlides`),
 * so its band reaches across the cell its path stands in, and the landing holds
 * that floor too. A 90° turn lands on one cell (a = b) and stays one cell.
 */
export function stairTurnCells(m: StairModule): Vec3i[] {
  const flights = stairFlights(m)
  const slides = stairFlightSlides(m)
  const width = m.cfg.width ?? STAIR_WIDTH_NARROW
  const half = Math.max(0.5, width / 2)
  const out: Vec3i[] = []
  const seen = new Set<string>()
  for (let i = 0; i + 1 < flights.length; i++) {
    const a = flights[i].to
    const b = flights[i + 1].from
    const acx = a.x + 0.5 + slides[i].dx
    const acy = a.y + 0.5 + slides[i].dy
    const bcx = b.x + 0.5 + slides[i + 1].dx
    const bcy = b.y + 0.5 + slides[i + 1].dy
    const acrossIsX = a.x !== b.x
    const acrossIsY = a.y !== b.y
    const x0 = acrossIsX ? Math.floor(Math.min(acx, bcx) - half + 1e-9) : Math.min(a.x, b.x)
    const x1 = acrossIsX ? Math.ceil(Math.max(acx, bcx) + half - 1e-9) - 1 : Math.max(a.x, b.x)
    const y0 = acrossIsY ? Math.floor(Math.min(acy, bcy) - half + 1e-9) : Math.min(a.y, b.y)
    const y1 = acrossIsY ? Math.ceil(Math.max(acy, bcy) + half - 1e-9) - 1 : Math.max(a.y, b.y)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y},${a.z}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ x, y, z: a.z })
      }
    }
  }
  return out
}
