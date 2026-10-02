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

import type { Module, StairFlight, StairStyle, Vec3i } from './types.ts'

export type { StairFlight, StairStyle } from './types.ts'

type StairModule = Extract<Module, { type: 'stair' }>

/**
 * The two widths a stair comes in, cycled with Tab in the builder and used by
 * the demo. `narrow` matches an escalator bay, `normal` is the reference
 * station's current public-stair width.
 */
export const STAIR_WIDTH_NARROW = 1.2
export const STAIR_WIDTH_NORMAL = 1.6
export const STAIR_WIDTHS: readonly number[] = [STAIR_WIDTH_NARROW, STAIR_WIDTH_NORMAL]

/** The next stair width in the cycle (narrow → normal → narrow). */
export function nextStairWidth(width: number): number {
  const i = STAIR_WIDTHS.findIndex((w) => Math.abs(w - width) < 0.05)
  return STAIR_WIDTHS[(i + 1 + STAIR_WIDTHS.length) % STAIR_WIDTHS.length]
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

/** Per-flight run and rise: a turn is two half-storey flights at the same slope. */
export const STAIR_FLIGHT_RUN = 3
export const STAIR_FLIGHT_RISE = 2

/**
 * The fixed flights a placed stair of `style` runs from `base`, turned by the
 * placement rotation. Every flight climbs at the same slope; a `90` turns one
 * way or the other at the half-landing, and `right180` is a switchback whose
 * two flights are parallel with the landing between them.
 */
export function stairFlightsFor(base: Vec3i, rot: number, style: StairStyle): StairFlight[] {
  const [fx, fy] = stairFacing(rot)
  const rx = fy
  const ry = -fx // right of forward, in the x-y plane
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
