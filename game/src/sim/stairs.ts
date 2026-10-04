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

import { ESCALATOR_BAND } from './constants.ts'
import type { Module, StairFlight, StairStyle, Vec3i } from './types.ts'

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
 * The fixed flights a placed stair of `style` runs from `base`, turned by the
 * placement rotation. Every flight climbs at the same slope; a `90` turns one
 * way or the other at the half-landing, and `right180` is a switchback whose
 * two flights are parallel with the landing between them.
 */
export function stairFlightsFor(base: Vec3i, rot: number, style: StairStyle): StairFlight[] {
  const [fx, fy] = stairFacing(rot)
  const [rx, ry] = stairRight(rot)
  const at = (df: number, dr: number, dz: number): Vec3i => ({
    x: base.x + fx * df + rx * dr,
    y: base.y + fy * df + ry * dr,
    z: base.z + dz,
  })
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
        { from: at(STAIR_FLIGHT_RUN, STAIR_FLIGHT_RUN, STAIR_FLIGHT_RISE), to: at(0, STAIR_FLIGHT_RUN, STAIR_RISE) },
      ]
    case 'straight':
    default:
      return [{ from: base, to: at(STAIR_RUN, 0, STAIR_RISE) }]
  }
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
 * switchback lands on the row of cells between the two flight ends.
 */
export function stairTurnConnectors(m: StairModule): Array<{ a: Vec3i; b: Vec3i }> {
  const flights = stairFlights(m)
  const out: Array<{ a: Vec3i; b: Vec3i }> = []
  for (let i = 0; i + 1 < flights.length; i++) out.push({ a: flights[i].to, b: flights[i + 1].from })
  return out
}

/**
 * Every cell an interior turn landing covers. These are the cells the builder
 * keeps as walkable nodes but the renderer hands to the stair model, so the
 * landing is drawn as a stair platform instead of a reused floor block.
 */
export function stairTurnCells(m: StairModule): Vec3i[] {
  const out: Vec3i[] = []
  const seen = new Set<string>()
  for (const { a, b } of stairTurnConnectors(m)) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
        const k = `${x},${y},${a.z}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ x, y, z: a.z })
      }
    }
  }
  return out
}
